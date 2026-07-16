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
from app.routers.file import get_cos_client, bucket
from app.utils.resume_parser import extract_resume_text, parse_resume_structure
from app.services.embedding_indexer import schedule_index
from app.utils.llm import analyze_resume_text
from app.utils.docx_resume_writer import rewrite_resume_docx, BulletMatchError
from app.utils.pdf_to_docx import convert_pdf_to_docx
from app.services.quota import FEATURE_RESUME, check_and_consume

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

    # 1.5 配额检查（30 天滚动窗口，按会员等级 FREE=1 / PRO=10 / MAX=30）
    # 旧代码此处完全没有免费次数判断，所有用户（包括非会员）都能无限分析。
    # 新逻辑：check_and_consume 会写一条 user_quota_usage，删除历史 ResumeAnalysis
    # 不会重置配额。仅"自己的简历"扣配额，跨用户访问由下面的 ownership 检查兜底。
    if current_user and db_file.user_id == current_user.id:
        await check_and_consume(db, current_user, FEATURE_RESUME)

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

    # ★ 异步项目记忆提取（fire-and-forget，不阻塞主流程）
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

    # 5.5 服务端解析简历结构（原文保真，避免 LLM 把 "ByteDance" 规范成"字节跳动"）
    parsed_structure = parse_resume_structure(resume_text)

    # 6. Analyze resume text using LLM（传 parsed_structure 让 LLM 只优化 bullets、保持结构不变）
    analysis_result = await analyze_resume_text(
        resume_text, profile_data, parsed_structure=parsed_structure
    )
    if not analysis_result:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="大模型简历诊断任务失败，请稍后重试。"
        )

    # 6.5 把服务端解析出的原文结构覆盖回 LLM 输出（LLM 只负责 bullet 诊断，结构必须原文回填）
    _merge_parsed_structure(analysis_result, parsed_structure)

    # 6.6 用画像标注的薪资覆盖 LLM 提取值（画像是用户主动维护的真值源，简历解析容易出现偏差）
    if current_user and current_user.profile:
        p = current_user.profile
        annotated_salary = _format_salary_range(p.salary_min, p.salary_max)
        profile_section = analysis_result.get("profile")
        if isinstance(profile_section, dict):
            if annotated_salary:
                profile_section["salary"] = annotated_salary

    # 6.7 兜底清洗 LLM 给的 structure_analysis（缺字段 / status 拼错 / score 越界 → 占位值）
    _normalize_structure_analysis(analysis_result)

    # 6.8 计算综合评分 5 维度真实分项 + 顶层加权分数（替代前端硬编码的假数据）
    # 各维度字段溯源：
    #   - keyword_match         ← match_analysis.match_score（LLM 评估的目标岗位匹配度）
    #   - experience_value      ← avg(structure_analysis.work_experience.score, projects.score)
    #   - quantification        ← avg(work_experience, projects, business_outcomes).score
    #   - resume_completeness   ← ats_pass_rate × 60% + structure_analysis.personal_info.score × 40%
    #   - expression_quality    ← 100 - 风险扣分（高×15 + 中×8 + 低×3，下限 0）
    # 顶层 score_breakdown.weighted = 加权平均（30/30/20/10/10），同时覆盖到 analysis_result["score"]
    # （即前端展示的"简历综合评分"），保证顶层数字也可追溯到 5 维度。
    breakdown = _compute_score_breakdown(analysis_result)
    analysis_result["score_breakdown"] = breakdown
    analysis_result["score"] = breakdown["weighted"]
    analysis_result["optimized_score"] = min(100, breakdown["weighted"] + 10)  # 优化后预估：当前分 + 10

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
            detail="简历排版与诊断结果不匹配，DOCX 改写失败。请检查简历后重新上传分析。",
        ) from e
    except Exception as e:
        logger.exception("[docx_writer] failed for analysis_id=%s", analysis_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="DOCX 生成失败，请稍后重试"
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
    filename = f"面试VAR_简历_{safe_name}_{today}.docx"
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
    if not parsed_jobs or not llm_jobs:
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

    # profile 基础字段：name/phone/email/years 用解析器原文（LLM 经常编出错的）
    parser_profile = parsed_structure.get("profile") or {}
    llm_profile = analysis_result.get("profile")
    if isinstance(llm_profile, dict) and parser_profile:
        for key in ("name",):
            v = parser_profile.get(key)
            if v:
                llm_profile[key] = v
        # years：LLM 经常编造"3年"（截断），解析器提取的更精确
        v = parser_profile.get("years")
        if v:
            llm_profile["years"] = v
        # phone/email 也带上（虽然 PDF 不一定用，但前端可能展示）
        for key in ("phone", "email"):
            v = parser_profile.get(key)
            if v:
                llm_profile[key] = v


_STRUCTURE_SECTION_KEYS: tuple = (
    "personal_info",
    "work_experience",
    "projects",
    "tech_stack",
    "education",
    "open_source",
    "business_outcomes",
    "management",
)

_STRUCTURE_VALID_STATUS: frozenset = frozenset({"优秀", "亮点", "风险", "缺失"})


def _normalize_structure_analysis(analysis_result: dict) -> None:
    """兜底清洗 LLM 返回的 structure_analysis。

    LLM 可能漏字段 / status 拼错（如 "優异"） / score 越界 / section 缺失。
    全部归一化为前端能直接消费的结构：
      - 8 个 section 缺一不可，缺失的用占位对象填充
      - status 不在枚举内 → "优秀"
      - score 不是 0-100 整数 → clamp 到 [0, 100]
      - desc / advice / before / after 缺字段 → 空字符串 / 空数组
    """
    raw = analysis_result.get("structure_analysis")
    if not isinstance(raw, dict):
        raw = {}

    normalized: dict = {}
    for key in _STRUCTURE_SECTION_KEYS:
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

    # 4. 简历完整度 ← ats_pass_rate × 60% + personal_info 完整度 × 40%
    ats_raw = analysis_result.get("ats_pass_rate")
    try:
        ats_compatibility = max(0, min(100, int(ats_raw))) if ats_raw is not None else 0
    except (TypeError, ValueError):
        ats_compatibility = 0
    pi_score = _safe_get_score(structure.get("personal_info"), "score")
    resume_completeness = round(ats_compatibility * 0.6 + pi_score * 0.4)

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
            "source": "ats_pass_rate × 60% + structure_analysis.personal_info.score × 40%",
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
