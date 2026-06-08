from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload
import asyncio
from pydantic import BaseModel
from typing import Optional

from app import models
from app.database import get_db
from app.routers.auth import get_current_user_optional
from app.routers.file import get_cos_client, bucket
from app.utils.resume_parser import extract_resume_text
from app.utils.llm import analyze_resume_text

router = APIRouter(prefix="/api/resume", tags=["Resume Analysis"])

class ResumeAnalyzeRequest(BaseModel):
    file_id: int

@router.post("/analyze")
async def analyze_resume(
    req: ResumeAnalyzeRequest,
    db: AsyncSession = Depends(get_db),
    current_user: Optional[models.User] = Depends(get_current_user_optional)
):
    # 1. Fetch file from DB
    result = await db.execute(select(models.UploadedFile).where(models.UploadedFile.id == req.file_id))
    db_file = result.scalars().first()
    if not db_file:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="简历文件不存在"
        )

    if db_file.file_type != "resume":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="该文件不是简历文件"
        )

    # 2. Permission check: if file belongs to a user, check ownership
    if db_file.user_id is not None:
        if not current_user or current_user.id != db_file.user_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="无权访问该简历文件"
            )

    # 3. Download file from COS
    try:
        client = get_cos_client()
        response = await asyncio.to_thread(
            client.get_object,
            Bucket=bucket,
            Key=db_file.cos_key
        )
        body_stream = response['Body']
        if hasattr(body_stream, 'get_raw_stream'):
            content_bytes = body_stream.get_raw_stream().read()
        else:
            content_bytes = body_stream.read()
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"从云存储下载简历失败: {str(e)}"
        )

    # 4. Parse file to text
    try:
        resume_text = extract_resume_text(content_bytes, db_file.filename)
    except ValueError as ve:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(ve)
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"解析简历内容失败: {str(e)}。请确保文件未损坏，或尝试将其导出为标准格式后重试。"
        )

    if not resume_text.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="未能从简历文件中提取出有效的文本，请检查文件排版或转换方式。"
        )

    # 5. Extract profile details to supply target expectations to LLM
    profile_data = None
    if current_user and current_user.profile:
        p = current_user.profile
        profile_data = {
            "name": current_user.username,
            "status": "在职" if p.job_status == "active" else "离职" if p.job_status == "resigned" else "在校生",
            "experience_years": f"{p.experience_years or '在校/应届'}{p.experience_months or '0个月'}",
            "company_name": p.company_name or "暂无",
            "role_name": p.role_name or "暂无",
            "salary": f"{p.salary_min or 0}K - {p.salary_max or 0}K",
            "target_company": p.target_company or "暂无",
            "target_role": p.target_role or "暂无",
            "target_grade": p.target_grade or "暂无",
            "target_salary": f"{p.target_salary_min or 0}K - {p.target_salary_max or 0}K"
        }

    # 6. Analyze resume text using LLM
    analysis_result = await analyze_resume_text(resume_text, profile_data)
    if not analysis_result:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="大模型简历诊断任务失败，请稍后重试。"
        )

    # 7. Persist to DB
    record = models.ResumeAnalysis(
        user_id=current_user.id if current_user else None,
        file_id=db_file.id,
        score=_safe_int(analysis_result.get("score")),
        optimized_score=_safe_int(analysis_result.get("optimized_score")),
        ats_pass_rate=_safe_int(analysis_result.get("ats_pass_rate")),
        result_json=analysis_result,
    )
    db.add(record)
    await db.commit()
    await db.refresh(record)

    return {
        "id": record.id,
        "file_id": record.file_id,
        "created_at": record.created_at.isoformat() if record.created_at else None,
        **analysis_result,
    }


@router.get("/analyses")
async def list_resume_analyses(
    db: AsyncSession = Depends(get_db),
    current_user: Optional[models.User] = Depends(get_current_user_optional)
):
    """
    当前用户的所有简历诊断历史概要。
    未登录用户：返回空列表（历史报告跟用户绑定）。
    """
    if not current_user:
        return {"items": []}

    stmt = (
        select(models.ResumeAnalysis, models.UploadedFile.filename)
        .join(models.UploadedFile, models.ResumeAnalysis.file_id == models.UploadedFile.id)
        .where(models.ResumeAnalysis.user_id == current_user.id)
        .order_by(models.ResumeAnalysis.created_at.desc())
    )
    rows = (await db.execute(stmt)).all()

    items = []
    for ra, filename in rows:
        items.append({
            "id": ra.id,
            "file_id": ra.file_id,
            "filename": filename,
            "score": ra.score,
            "optimized_score": ra.optimized_score,
            "ats_pass_rate": ra.ats_pass_rate,
            "created_at": ra.created_at.isoformat() if ra.created_at else None,
        })
    return {"items": items}


@router.get("/analyses/{analysis_id}")
async def get_resume_analysis(
    analysis_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: Optional[models.User] = Depends(get_current_user_optional)
):
    stmt = select(models.ResumeAnalysis).where(models.ResumeAnalysis.id == analysis_id)
    ra = (await db.execute(stmt)).scalars().first()
    if not ra:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="简历分析记录不存在")
    if ra.user_id is not None:
        if not current_user or current_user.id != ra.user_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权访问该简历分析记录")

    return {
        "id": ra.id,
        "file_id": ra.file_id,
        "created_at": ra.created_at.isoformat() if ra.created_at else None,
        **ra.result_json,
    }


@router.delete("/analyses/{analysis_id}")
async def delete_resume_analysis(
    analysis_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: Optional[models.User] = Depends(get_current_user_optional)
):
    stmt = select(models.ResumeAnalysis).where(models.ResumeAnalysis.id == analysis_id)
    ra = (await db.execute(stmt)).scalars().first()
    if not ra:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="简历分析记录不存在")
    if ra.user_id is not None:
        if not current_user or current_user.id != ra.user_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权访问该简历分析记录")

    await db.delete(ra)
    await db.commit()
    return {"message": "删除成功"}


def _safe_int(v) -> Optional[int]:
    if v is None:
        return None
    try:
        return int(v)
    except (TypeError, ValueError):
        return None
