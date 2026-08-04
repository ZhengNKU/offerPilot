from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload
import asyncio
import logging
import re
from datetime import datetime
from pydantic import BaseModel
from typing import Optional
from urllib.parse import quote

from app import models
from app.database import get_db
from app.routers.auth import get_current_user_optional
from app.routers.file import get_cos_client, bucket, delete_file_from_storage
from app.utils.resume_parser import extract_resume_text, parse_resume_structure
from app.services.embedding_indexer import schedule_index
from app.utils.llm import analyze_resume_text
from app.utils.docx_resume_writer import rewrite_resume_docx, BulletMatchError
from app.utils.pdf_to_docx import convert_pdf_to_docx
from app.services.quota import FEATURE_RESUME, check_and_consume
from app.utils.privacy import desensitize_text, desensitize_parsed_structure
from app.utils.error_messages import (
    FEATURE_RESUME as FEATURE_NAME_RESUME,
    format_failure,
    REASON_COS_DOWNLOAD_FAILED,
    REASON_FILE_PARSE_FAILED,
    REASON_FILE_EMPTY,
    REASON_LLM_EMPTY,
    REASON_LLM_JSON_PARSE,
    REASON_LLM_TIMEOUT,
    REASON_LLM_MISSING_FIELD,
)

logger = logging.getLogger(__name__)

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

    # 1.5 配额扣减已移到第 6 步 LLM 分析成功之后(2026-07-25+)
    # 旧代码在入口 check_and_consume,但 COS 下载 / 解析 / LLM 任一失败会
    # 让用户白扔一次额度。改为"成功才扣":失败统一不扣,成功后才写 user_quota_usage。
    # 重分析通过"该 file_id 已有 ResumeAnalysis 记录"识别,不重复扣。

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
        logger.exception(f"[resume] COS 下载失败 file_id={db_file.id}: {e!r}")
        await delete_file_from_storage(db, db_file)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=format_failure(FEATURE_NAME_RESUME, REASON_COS_DOWNLOAD_FAILED)
        )

    # 4. Parse file to text
    try:
        resume_text = extract_resume_text(content_bytes, db_file.filename)
    except ValueError as ve:
        # 文件格式错误属于用户输入问题,直接显示 ve 信息并清理文件
        await delete_file_from_storage(db, db_file)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=format_failure(FEATURE_NAME_RESUME, f"文件格式不支持：{ve}")
        )
    except Exception as e:
        logger.exception(f"[resume] 解析失败 file_id={db_file.id}: {e!r}")
        await delete_file_from_storage(db, db_file)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=format_failure(FEATURE_NAME_RESUME, REASON_FILE_PARSE_FAILED)
        )

    if not resume_text.strip():
        await delete_file_from_storage(db, db_file)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=format_failure(FEATURE_NAME_RESUME, REASON_FILE_EMPTY)
        )

    # 5.5 服务端解析简历结构并进行隐私脱敏处理
    parsed_structure = parse_resume_structure(resume_text)
    resume_text = desensitize_text(resume_text)
    parsed_structure = desensitize_parsed_structure(parsed_structure)

    # ★ 异步项目记忆提取（fire-and-forget，不阻塞主流程，使用已脱敏的 resume_text）
    if current_user:
        from app.services.project_memory_agent import _run_project_memory_sub_agent
        asyncio.create_task(
            _run_project_memory_sub_agent({
                "user_id": current_user.id,
                "file_id": db_file.id,
                "resume_text": resume_text,
            })
        )

    # 5. Extract profile details to supply target expectations to LLM
    profile_data = None
    if current_user and current_user.profile:
        p = current_user.profile
        profile_data = {
            "name": current_user.username,
            "status": "在职" if p.job_status == "active" else "离职" if p.job_status == "resigned" else "应届生" if p.job_status == "fresh_grad" else "在校生",
            "experience_years": f"{p.experience_years or '在校'}{p.experience_months or '0个月'}",
            "company_name": p.company_name or "暂无",
            "role_name": p.role_name or "暂无",
            "salary": f"{p.salary_min or 0}K - {p.salary_max or 0}K",
            "target_company": p.target_company or "暂无",
            "target_role": p.target_role or "暂无",
            "target_grade": p.target_grade or "暂无",
            "target_salary": f"{p.target_salary_min or 0}K - {p.target_salary_max or 0}K"
        }

    # 6. Analyze resume text using LLM（传 parsed_structure 让 LLM 只优化 bullets、保持结构不变）
    # 2026-07-25+: analyze_resume_text 失败会 raise,这里捕获并把 reason 透出并清理文件
    try:
        analysis_result = await analyze_resume_text(
            resume_text, profile_data, parsed_structure=parsed_structure
        )
    except Exception as e:
        logger.exception(f"[resume] LLM 分析失败 file_id={db_file.id}: {e!r}")
        await delete_file_from_storage(db, db_file)
        # e 可能是我们自己包的 "AI 返回 JSON 解析失败" 或 "AI 返回为空" 等
        reason = str(e) or "AI 调用失败"
        if len(reason) > 200:
            reason = reason[:200] + "..."
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=format_failure(FEATURE_NAME_RESUME, reason)
        )
    if not analysis_result:
        await delete_file_from_storage(db, db_file)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=format_failure(FEATURE_NAME_RESUME, REASON_LLM_EMPTY)
        )

    # 6.5 把服务端解析出的原文结构覆盖回 LLM 输出（LLM 只负责 bullet 诊断，结构必须原文回填）
    _merge_parsed_structure(analysis_result, parsed_structure)

    # 6.6 用画像标注的公司/岗位/薪资覆盖 LLM 提取值（画像是用户主动维护的真值源；未填写统一展示中划线 '-'）
    profile_section = analysis_result.get("profile")
    if isinstance(profile_section, dict):
        if current_user:
            # 候选人姓名直接使用账号注册用户名
            profile_section["name"] = current_user.username
            if current_user.profile:
                p = current_user.profile
                annotated_salary = _format_salary_range(p.salary_min, p.salary_max)
                if annotated_salary:
                    profile_section["salary"] = annotated_salary

                # 当前公司：若用户未显式填写，统一显示 '-'，避免 AI 错误抓取实习经历公司
                if p.company_name and p.company_name.strip() and p.company_name.strip() not in ("暂无", "暂无公司", "-"):
                    profile_section["company"] = p.company_name.strip()
                else:
                    profile_section["company"] = "-"

                # 当前岗位：若用户未显式填写，统一显示 '-'，避免 AI 错误抓取实习经历岗位
                if p.role_name and p.role_name.strip() and p.role_name.strip() not in ("暂无", "-"):
                    profile_section["role"] = p.role_name.strip()
                    profile_section["title"] = p.role_name.strip()
                else:
                    profile_section["role"] = "-"
                    profile_section["title"] = "-"
        else:
            # 未登录或无 profile：如果 LLM 给的不是有效公司/岗位（或是暂无），统一降级为 '-'
            if not profile_section.get("name") or profile_section.get("name") in ("基本信息", "个人信息", "简历信息", "个人简历", "求职意向", "基本资料"):
                profile_section["name"] = "候选人"
            if not profile_section.get("company") or profile_section.get("company") in ("暂无", "暂无公司", "无", "None", "null", "未填写"):
                profile_section["company"] = "-"
            if not profile_section.get("role") or profile_section.get("role") in ("暂无", "无", "None", "null", "未填写"):
                profile_section["role"] = "-"
                profile_section["title"] = "-"

    # 6.7 兜底清洗 LLM 给的 structure_analysis（缺字段 / status 拼错 / score 越界 → 占位值）
    _normalize_structure_analysis(analysis_result)

    # 6.75 兜底清洗 profile 字段：所有 "暂无"/"无"/None 类值统一降级为 '-'（不依赖 LLM 或用户画像）
    if isinstance(profile_section, dict):
        for _key in ("company", "role", "title"):
            _v = profile_section.get(_key)
            if not _v or str(_v).strip() in ("暂无", "暂无公司", "无", "None", "null", "未填写", ""):
                profile_section[_key] = "-"

    # 6.8 计算综合评分 5 维度真实分项 + 顶层加权分数（替代前端硬编码的假数据）
    # 各维度字段溯源：
    #   - keyword_match         ← match_analysis.match_score（LLM 评估的目标岗位匹配度）
    #   - experience_value      ← avg(structure_analysis.work_experience.score, projects.score)
    #   - quantification        ← avg(work_experience, projects, business_outcomes).score
    #   - resume_completeness   ← ats_pass_rate × 60% + structure_analysis.education.score × 40%
    #   - expression_quality    ← 100 - 风险扣分（高×15 + 中×8 + 低×3，下限 0）
    # 顶层 score_breakdown.weighted = 加权平均（30/30/20/10/10），同时覆盖到 analysis_result["score"]
    # （即前端展示的"简历综合评分"），保证顶层数字也可追溯到 5 维度。
    breakdown = _compute_score_breakdown(analysis_result)
    analysis_result["score_breakdown"] = breakdown
    analysis_result["score"] = breakdown["weighted"]
    analysis_result["optimized_score"] = min(100, breakdown["weighted"] + 10)  # 优化后预估：当前分 + 10

    # 6.9 计算并补充四大核心指标（总字数、风险点、优化建议数、岗位匹配度）
    _enrich_metrics(analysis_result, resume_text=resume_text)

    # ── 配额扣减:仅本文件第一次分析成功才扣,重分析免费 ──
    # 2026-07-25+ 改为"分析成功才扣"模型
    if current_user and db_file.user_id == current_user.id:
        from sqlalchemy import func as _func
        prev_count_res = await db.execute(
            select(_func.count(models.ResumeAnalysis.id)).where(
                models.ResumeAnalysis.file_id == db_file.id
            )
        )
        prev_count = prev_count_res.scalar() or 0
        if prev_count == 0:
            try:
                await check_and_consume(db, current_user, FEATURE_RESUME)
                logger.info(
                    f"[resume] 简历分析成功,扣额度 user_id={current_user.id} "
                    f"file_id={db_file.id}"
                )
            except HTTPException as quota_exc:
                # 配额耗尽 — 标 403 让前端展示升级提示
                raise quota_exc
        else:
            logger.info(
                f"[resume] 简历重分析(file_id={db_file.id} 已有 {prev_count} 条历史),不重复扣"
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

    # 触发 AI 职业顾问索引（fire-and-forget；失败不影响主流程）
    if current_user:
        schedule_index({
            "kind": "resume_analysis",
            "user_id": current_user.id,
            "resume_analysis_id": record.id,
        })
        
        # 异步触发 AI 职业顾问定制建议建议更新
        from app.services.advisor_generator import trigger_custom_advisor_insights
        asyncio.create_task(
            trigger_custom_advisor_insights(current_user.id)
        )

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


@router.get("/analyses/{analysis_id}/download")
async def download_resume_analysis(
    analysis_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: Optional[models.User] = Depends(get_current_user_optional)
):
    """下载简历（DOCX 改写版）。

    保留原简历的字体/颜色/图标/分栏/表格等所有样式，只把工作经历 bullets 的文字
    就地替换为 LLM 优化后的版本。源文件是 PDF 时先转 DOCX 再改写；
    bullet 识别率 < 80% 时返回 500，请用户检查简历排版后重试。
    """
    stmt = select(models.ResumeAnalysis).where(models.ResumeAnalysis.id == analysis_id)
    ra = (await db.execute(stmt)).scalars().first()
    if not ra:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="简历分析记录不存在")
    if ra.user_id is not None:
        if not current_user or current_user.id != ra.user_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权访问该简历分析记录")

    analysis_data = ra.result_json or {}
    if not analysis_data.get("work_experiences"):
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="该简历分析记录缺少结构化数据，请重新上传简历生成新分析"
        )

    # 用画像标注的薪资覆盖展示值
    if current_user and current_user.profile and isinstance(analysis_data.get("profile"), dict):
        annotated_salary = _format_salary_range(
            current_user.profile.salary_min, current_user.profile.salary_max
        )
        if annotated_salary:
            analysis_data["profile"]["salary"] = annotated_salary

    # 拉源文件信息（需要 db_file 用于 COS key 和 filename）
    file_stmt = select(models.UploadedFile).where(models.UploadedFile.id == ra.file_id)
    db_file = (await db.execute(file_stmt)).scalars().first()
    if not db_file:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="简历源文件记录缺失，请重新上传简历"
        )

    src_ext = (db_file.filename or "").rsplit(".", 1)[-1].lower()
    if src_ext not in ("docx", "pdf"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"原文件格式不支持 DOCX 改写: {src_ext}"
        )

    profile = analysis_data.get("profile") or {}
    raw_name = (profile.get("name") or "").strip() or "候选人"
    safe_name = _sanitize_filename(raw_name)
    today = datetime.now().strftime("%Y-%m-%d")

    try:
        # 1) 从 COS 下载原文件
        content_bytes = await _download_from_cos(db_file.cos_key)

        # 2) PDF 源文件先转 DOCX（CPU 密集 + 阻塞，丢到线程池）
        if src_ext == "pdf":
            logger.info(
                "[docx_writer] converting PDF -> DOCX for analysis_id=%s (%.1f KB)",
                analysis_id, len(content_bytes) / 1024,
            )
            content_bytes = await asyncio.to_thread(convert_pdf_to_docx, content_bytes)

        # 3) 就地改写 bullet 文字（保留 run 样式）
        docx_bytes = await asyncio.to_thread(
            rewrite_resume_docx, content_bytes, analysis_data
        )
    except HTTPException:
        raise
    except BulletMatchError as e:
        logger.warning(
            "[docx_writer] bullet match failed for analysis_id=%s (%s)",
            analysis_id, e,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=format_failure(FEATURE_NAME_RESUME, "简历排版与诊断结果不匹配，请重新上传简历"),
        ) from e
    except Exception as e:
        logger.exception("[docx_writer] failed for analysis_id=%s", analysis_id)
        reason = str(e) or "DOCX 生成失败"
        if len(reason) > 200:
            reason = reason[:200] + "..."
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=format_failure(FEATURE_NAME_RESUME, reason),
        ) from e

    return _make_file_response(docx_bytes, safe_name, today)


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

    res_data = dict(ra.result_json) if ra.result_json else {}
    if current_user and "profile" in res_data and isinstance(res_data["profile"], dict):
        prof = res_data["profile"]
        prof["name"] = current_user.username
        if current_user.profile:
            p = current_user.profile
            if p.company_name and p.company_name.strip() and p.company_name.strip() not in ("暂无", "暂无公司", "-"):
                prof["company"] = p.company_name.strip()
            else:
                prof["company"] = "-"

            if p.role_name and p.role_name.strip() and p.role_name.strip() not in ("暂无", "-"):
                prof["role"] = p.role_name.strip()
                prof["title"] = p.role_name.strip()
            else:
                prof["role"] = "-"
                prof["title"] = "-"

    _enrich_metrics(res_data)

    return {
        "id": ra.id,
        "file_id": ra.file_id,
        "created_at": ra.created_at.isoformat() if ra.created_at else None,
        **res_data,
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


def _sanitize_filename(name: str) -> str:
    """剔除 Windows / macOS / Linux 都不允许的字符，控制长度。"""
    # 替换为下划线
    cleaned = re.sub(r'[\\/:*?"<>|\r\n\t]+', "_", name).strip("._ ")
    if not cleaned:
        cleaned = "候选人"
    return cleaned[:32]


def _safe_int(v) -> Optional[int]:
    if v is None:
        return None
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def _format_salary_range(min_v: Optional[int], max_v: Optional[int]) -> Optional[str]:
    """把 (min_k, max_k) 拼成 "25K-35K"。两边都为空返回 None。"""
    if min_v is None and max_v is None:
        return None
    if min_v is None:
        return f"{max_v}K"
    if max_v is None:
        return f"{min_v}K"
    return f"{min_v}K - {max_v}K"


async def _download_from_cos(cos_key: str) -> bytes:
    """从 COS 下载原文件，analyze / download_resume_analysis 路由复用。"""
    try:
        client = get_cos_client()
        response = await asyncio.to_thread(
            client.get_object,
            Bucket=bucket,
            Key=cos_key,
        )
        body_stream = response['Body']
        if hasattr(body_stream, 'get_raw_stream'):
            return body_stream.get_raw_stream().read()
        return body_stream.read()
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"从云存储下载简历失败: {str(e)}"
        ) from e


def _make_file_response(file_bytes: bytes, safe_name: str, today: str):
    """构造带 RFC 5987 中文文件名的 DOCX 下载 Response。"""
    filename = f"面试驾到_简历_{safe_name}_{today}.docx"
    encoded_filename = quote(filename)
    content_disposition = (
        f"attachment; "
        f'filename="InterviewVAR_Resume_{today}.docx"; '  # ASCII fallback
        f"filename*=UTF-8''{encoded_filename}"
    )
    return Response(
        content=file_bytes,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={
            "Content-Disposition": content_disposition,
            "Content-Length": str(len(file_bytes)),
            "Cache-Control": "private, max-age=300",
            "X-Content-Type-Options": "nosniff",
        },
    )


def _merge_parsed_structure(analysis_result: dict, parsed_structure: dict) -> None:
    """把服务端解析出的原文结构覆盖到 LLM 输出上。

    目的：保证 PDF/页面里看到的公司名、岗位、时间、bullet 原文 = 简历原文 verbatim。
    LLM 只负责为每条 bullet 附加诊断/优化信息（optimizedText/originalTag/originalDesc/...）。

    匹配策略：
      1. 优先按 originalText 文本匹配（最稳）。
      2. 同一 work_experience 内按位置顺序兜底（防止 LLM 改写了原文导致文本不匹配）。
    未匹配上的 LLM 诊断会被丢弃（不替换原文）。
    """
    import copy

    parsed_jobs = parsed_structure.get("work_experiences") or []
    llm_jobs = analysis_result.get("work_experiences") or []
    if not parsed_jobs:
        return

    # work_experiences 整体覆盖：原文结构为准，bullet 顺序保持
    new_jobs: list[dict] = []
    for i, pj in enumerate(parsed_jobs):
        new_job = {
            "company": pj.get("company", ""),
            "role": pj.get("role", ""),
            "period": pj.get("period", ""),
            "bullets": [],
        }
        # 找对应位置的 LLM job（同位置最佳，没有就 1:1 用第一个）
        lj = llm_jobs[i] if i < len(llm_jobs) else None
        llm_bullets = (lj or {}).get("bullets") or []

        for j, pb in enumerate(pj.get("bullets") or []):
            pb_text = pb.strip()
            llm_match = None
            # 策略 1: 按原文匹配
            for lb in llm_bullets:
                if isinstance(lb, dict) and (lb.get("originalText") or "").strip() == pb_text:
                    llm_match = lb
                    break
            # 策略 2: 按位置兜底
            if llm_match is None and j < len(llm_bullets):
                cand = llm_bullets[j]
                llm_match = cand if isinstance(cand, dict) else None

            if llm_match:
                merged = copy.deepcopy(llm_match)
                merged["originalText"] = pb_text  # 强制覆盖为解析器原文（最严保真）
                
                # 规范化标签与样式类名：确保 亮点 为绿色 (#5DECCB)，风险 为红色/粉色 (#FF7A95)
                orig_tag = merged.get("originalTag")
                if orig_tag == "亮点":
                    merged["originalTagClass"] = "text-[#5DECCB] bg-[#5DECCB]/10 border-[#5DECCB]/20"
                elif orig_tag == "风险":
                    merged["originalTagClass"] = "text-[#FF7A95] bg-[#FF7A95]/10 border-[#FF7A95]/20"
                
                # 规范化优化后的标签样式为绿色
                if merged.get("optimizedTag") == "已优化":
                    merged["optimizedTagClass"] = "text-[#5DECCB] bg-[#5DECCB]/10 border-[#5DECCB]/20"

                # optimizedText 不能与原文一字不差（否则就毫无意义），如果 LLM 偷懒原样返回则清空
                opt = (merged.get("optimizedText") or "").strip()
                if opt and opt == pb_text:
                    merged.pop("optimizedText", None)
                    merged.pop("optimizedTag", None)
                    merged.pop("optimizedTagClass", None)
                new_job["bullets"].append(merged)
            else:
                # LLM 没诊断到（罕见），原样塞一条无诊断的 bullet
                new_job["bullets"].append({
                    "originalText": pb_text,
                    "originalTag": "亮点",
                    "originalTagClass": "text-[#5DECCB] bg-[#5DECCB]/10 border-[#5DECCB]/20",
                    "originalDesc": "",
                })
        new_jobs.append(new_job)

    analysis_result["work_experiences"] = new_jobs

    # profile 基础字段：years/phone/email 用解析器原文
    parser_profile = parsed_structure.get("profile") or {}
    llm_profile = analysis_result.get("profile")
    if isinstance(llm_profile, dict) and parser_profile:
        # years：LLM 经常编造"3年"（截断），解析器提取的更精确
        v = parser_profile.get("years")
        if v:
            llm_profile["years"] = v
        # phone/email 也带上（虽然 PDF 不一定用，但前端可能展示）
        for key in ("phone", "email"):
            v = parser_profile.get(key)
            if v:
                llm_profile[key] = v


def _enrich_metrics(analysis_result: dict, resume_text: Optional[str] = None) -> None:
    """计算并挂载四大核心指标：word_count, risks_count, suggestions_count, match_score。

    2026-07-25+: 不再使用硬编码魔数回退。数据缺失时保持原字段为 None,
    让前端根据字段是否为 null 来决定展示"暂无"而不是伪造数字。
    """
    if not isinstance(analysis_result, dict):
        return

    # 1. 总字数
    if resume_text and resume_text.strip():
        analysis_result["word_count"] = len(resume_text.strip())
    elif "word_count" not in analysis_result or not isinstance(analysis_result["word_count"], int):
        t_len = 0
        for exp in analysis_result.get("work_experiences") or []:
            for b in exp.get("bullets") or []:
                t_len += len(b.get("originalText") or b.get("optimizedText") or "")
        for proj in analysis_result.get("projects") or []:
            for b in proj.get("bullets") or []:
                t_len += len(b.get("originalText") or b.get("optimizedText") or "")
        analysis_result["word_count"] = t_len if t_len > 0 else None

    # 2. 风险点数量
    risks = analysis_result.get("risks")
    if risks is None and isinstance(analysis_result.get("risk_analysis"), dict):
        risks = analysis_result["risk_analysis"].get("risks")
    if isinstance(risks, list):
        analysis_result["risks_count"] = len(risks)
    else:
        r_cnt = 0
        for exp in analysis_result.get("work_experiences") or []:
            for b in exp.get("bullets") or []:
                if b.get("originalTag") == "风险":
                    r_cnt += 1
        analysis_result["risks_count"] = r_cnt if r_cnt > 0 else None

    # 3. 优化建议数量
    opt_suggs = analysis_result.get("optimization_suggestions") or analysis_result.get("ai_suggestions")
    if isinstance(opt_suggs, list) and len(opt_suggs) > 0:
        analysis_result["suggestions_count"] = len(opt_suggs)
    else:
        analysis_result["suggestions_count"] = None

    # 4. 岗位匹配度
    match_score = (analysis_result.get("match_analysis") or {}).get("match_score")
    if match_score is None and isinstance(analysis_result.get("score_breakdown"), dict):
        match_score = (analysis_result["score_breakdown"].get("keyword_match") or {}).get("score")
    if match_score is None:
        match_score = analysis_result.get("score")  # 也可能是 None
    analysis_result["match_score"] = match_score


# 简历结构地图：统一 7 段 section 键名（技术岗/非技术岗分析侧重点由 LLM prompt 区分）。
# 专业能力=professional_capability（技术岗侧重技术栈，非技术岗侧重工具/方法论），
# 作品/案例=works_portfolio（技术岗侧重开源贡献，非技术岗侧重案例/演讲/专利），
# 管理/协作经验=management（社招按带人/统筹评估，应届生按团队协作/组织经历评估，不因无管理经验判「缺失」）。
_STRUCTURE_SECTION_KEYS: tuple = (
    "education",
    "work_experience",
    "projects",
    "professional_capability",
    "works_portfolio",
    "business_outcomes",
    "management",
)

_STRUCTURE_VALID_STATUS: frozenset = frozenset({"优秀", "亮点", "风险", "缺失"})


def _normalize_structure_analysis(analysis_result: dict) -> None:
    """兜底清洗 LLM 返回的 structure_analysis（双轨 schema）。

    LLM 可能漏字段 / status 拼错（如 "優异"） / score 越界 / section 缺失。
    全部归一化为前端能直接消费的结构：
      - 7 个 section 缺一不可，缺失的用占位对象填充
      - status 不在枚举内 → "优秀"
      - score 不是 0-100 整数 → clamp 到 [0, 100]
      - desc / advice / before / after 缺字段 → 空字符串 / 空数组
      - 顶层 track 缺省时按 "technical" 兜底，保证老报告按原 schema 渲染
    """
    section_keys = _STRUCTURE_SECTION_KEYS

    raw = analysis_result.get("structure_analysis")
    if not isinstance(raw, dict):
        raw = {}

    normalized: dict = {}
    for key in section_keys:
        sec = raw.get(key)
        if not isinstance(sec, dict):
            sec = {}

        status = sec.get("status")
        if not isinstance(status, str) or status.strip() not in _STRUCTURE_VALID_STATUS:
            status = "优秀"
        else:
            status = status.strip()

        score = sec.get("score")
        try:
            score_int = int(score)
        except (TypeError, ValueError):
            score_int = 80
        score_int = max(0, min(100, score_int))

        desc = sec.get("desc")
        if not isinstance(desc, str):
            desc = "暂无分析"

        advice = sec.get("advice")
        if not isinstance(advice, list):
            advice = []
        advice = [str(a) for a in advice if a is not None][:3]

        before = sec.get("before")
        if not isinstance(before, str):
            before = ""

        after = sec.get("after")
        if not isinstance(after, str):
            after = ""

        normalized[key] = {
            "status": status,
            "score": score_int,
            "desc": desc,
            "advice": advice,
            "before": before,
            "after": after,
        }

    analysis_result["structure_analysis"] = normalized


# ──────────────────────────────────────────────────────────────────
# 综合评分 5 维度真实分项计算
# 替代前端硬编码的 85/82/78/92/88 占位假数据
# 维度选择原则：跨岗位通用，不偏向技术岗
# ──────────────────────────────────────────────────────────────────

# 风险等级 → 扣分（用于"表达专业度"维度，间接反映错别字/拼写/空洞表达）
_RISK_PENALTY = {"高风险": 15, "中风险": 8, "低风险": 3}

# 5 维度权重（必须合计 1.0）
# 设计目标：跨岗位通用 —— 技术/销售/运营/产品/设计均可适用
_BREAKDOWN_WEIGHTS = {
    "keyword_match": 0.30,       # 关键词匹配度：与目标 JD 的核心词覆盖
    "experience_value": 0.30,    # 工作经历含金量：履历规模/决策力
    "quantification": 0.20,      # 成果量化程度：数字指标（QPS/GMV/转化率/留存/用户量等跨岗位通用）
    "resume_completeness": 0.10, # 简历完整度：结构完整 + ATS 可读
    "expression_quality": 0.10,  # 表达专业度：用词规范、无错别字、动作词精准
}


def _safe_get_score(d: dict, key: str = "score") -> int:
    """从 dict 安全读取指定 key 的数值（缺字段 / 类型错 / 越界 → 0）。"""
    if not isinstance(d, dict):
        return 0
    try:
        v = int(d.get(key, 0))
    except (TypeError, ValueError):
        return 0
    return max(0, min(100, v))


def _compute_score_breakdown(analysis_result: dict) -> dict:
    """从已有 LLM 评估字段计算 5 维度真实分数 + 加权综合分。

    返回结构：
      {
        "dimensions": [
          {"key": "keyword_match", "label": "关键词匹配度", "score": 75, "weight": 0.30, "source": "match_analysis.match_score"},
          ...
        ],
        "weighted": 78,        # 加权综合分（0-100 整数），同时覆盖 analysis_result["score"]
        "formula": "Σ(维度分 × 权重)，权重 30/30/20/10/10",  # 公式描述（前端展示用）
      }
    """
    structure = analysis_result.get("structure_analysis") or {}
    risks = analysis_result.get("risks") or []
    match_analysis = analysis_result.get("match_analysis") or {}

    # 1. 关键词匹配度 ← match_analysis.match_score（LLM 给的目标岗位匹配度）
    keyword_match = _safe_get_score(match_analysis, "match_score")

    # 2. 工作经历含金量 ← avg(work_experience.score, projects.score)
    we_score = _safe_get_score(structure.get("work_experience"), "score")
    proj_score = _safe_get_score(structure.get("projects"), "score")
    experience_value = (we_score + proj_score) // 2 if (we_score + proj_score) else 0

    # 3. 成果量化程度 ← business_outcomes.score + work_experience.score 平均
    #    业务成果 section 专门统计 QPS/GMV/转化率/留存/用户量等数字指标；
    #    跨岗位通用 —— 技术岗看 QPS/性能，销售岗看 GMV/客户数，运营岗看转化率/留存。
    bo_score = _safe_get_score(structure.get("business_outcomes"), "score")
    quantification_scores = [s for s in (we_score, proj_score, bo_score) if s > 0]
    quantification = round(sum(quantification_scores) / len(quantification_scores)) if quantification_scores else 0

    # 4. 简历完整度 ← ats_pass_rate × 60% + education 完整度 × 40%
    #    2026-07-20+：取消 personal_info 之后，简历基础完整度的兜底维度切到 education 段
    #    （教育背景作为新 idx=0，是结构完整度的最低基线信号）。
    ats_raw = analysis_result.get("ats_pass_rate")
    try:
        ats_compatibility = max(0, min(100, int(ats_raw))) if ats_raw is not None else 0
    except (TypeError, ValueError):
        ats_compatibility = 0
    edu_score = _safe_get_score(structure.get("education"), "score")
    resume_completeness = round(ats_compatibility * 0.6 + edu_score * 0.4)

    # 5. 表达专业度 = 100 - sum(风险扣分)，下限 0
    #    风险点（高/中/低）通常对应错别字、拼写不规范、指标空洞、口语化表达等问题，
    #    跨岗位通用 —— 不只针对技术岗。
    risk_penalty = sum(_RISK_PENALTY.get(r.get("severity", ""), 0) for r in risks if isinstance(r, dict))
    expression_quality = max(0, 100 - risk_penalty)

    dimensions = [
        {
            "key": "keyword_match",
            "label": "关键词匹配度",
            "score": keyword_match,
            "weight": _BREAKDOWN_WEIGHTS["keyword_match"],
            "source": "match_analysis.match_score",
        },
        {
            "key": "experience_value",
            "label": "工作经历含金量",
            "score": experience_value,
            "weight": _BREAKDOWN_WEIGHTS["experience_value"],
            "source": "avg(structure_analysis.work_experience.score, projects.score)",
        },
        {
            "key": "quantification",
            "label": "成果量化程度",
            "score": quantification,
            "weight": _BREAKDOWN_WEIGHTS["quantification"],
            "source": "avg(structure_analysis.{work_experience, projects, business_outcomes}.score)",
        },
        {
            "key": "resume_completeness",
            "label": "简历完整度",
            "score": resume_completeness,
            "weight": _BREAKDOWN_WEIGHTS["resume_completeness"],
            "source": "ats_pass_rate × 60% + structure_analysis.education.score × 40%",
        },
        {
            "key": "expression_quality",
            "label": "表达专业度",
            "score": expression_quality,
            "weight": _BREAKDOWN_WEIGHTS["expression_quality"],
            "source": "100 - sum(高风险×15 + 中风险×8 + 低风险×3)",
        },
    ]

    weighted = round(sum(d["score"] * d["weight"] for d in dimensions))

    return {
        "dimensions": dimensions,
        "weighted": weighted,
        "formula": "Σ(维度分 × 权重)，权重 30% + 30% + 20% + 10% + 10%",
    }
