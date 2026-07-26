from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload
from typing import Optional, List, Dict, Any
from pydantic import BaseModel
import uuid
import asyncio
import time
import logging

from app import models, database
from app.database import get_db, async_session
from app.routers.auth import get_current_user_optional
from app.utils.llm import analyze_interview_dialogue, sectionize_transcript, generate_transcript_highlights, generate_section_optimization_advice, extract_mentioned_projects
from app.utils.asr import call_volc_asr
from app.services.embedding_indexer import schedule_index
from app.services.quota import (
    FEATURE_AUDIO,
    FEATURE_RECORD,
    check_and_consume,
    get_remaining,
    get_status,
)
from app.utils.error_messages import (
    FEATURE_AUDIO as FEATURE_NAME_AUDIO,
    FEATURE_RECORD as FEATURE_NAME_RECORD,
    format_failure,
    REASON_UNKNOWN,
)

from app.utils.privacy import desensitize_text
from app.utils.moderation_dep import moderated

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/audio", tags=["Audio Analysis"])

class AnalyzeRequest(BaseModel):
    session_id: int

class CreateSessionRequest(BaseModel):
    file_url: str
    file_id: Optional[int] = None
    file_size: Optional[int] = 0
    job_description: Optional[str] = None
    # 用户在 debugger 落地页填的元数据（与 record 模式统一）
    company: Optional[str] = None
    role: Optional[str] = None
    round: Optional[str] = None
    date: Optional[str] = None
    grade: Optional[str] = None
    salary: Optional[str] = None

@router.get("/check_limit")
async def check_limit(
    db: AsyncSession = Depends(get_db),
    current_user: Optional[models.User] = Depends(get_current_user_optional)
):
    """
    Check if a free user has reached their trial limit of 1 session.
    """
    # 旧逻辑：用 InterviewSession.count() 判断，用户删除记录即可绕过。
    # 新逻辑：基于 user_quota_usage 表的 30 天滚动窗口，无法通过删除业务记录绕过。
    if current_user and current_user.membership is None:
        if await get_remaining(db, current_user, FEATURE_AUDIO) <= 0:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="免费用户 30 天内仅可使用 1 次面试录音分析，请升级至 PRO 会员解锁更多！"
            )
    return {"status": "ok"}


@router.post("/create_session")
async def create_session(
    req: CreateSessionRequest,
    _moderation: None = Depends(moderated("jd:audio", "job_description")),
    db: AsyncSession = Depends(get_db),
    current_user: Optional[models.User] = Depends(get_current_user_optional)
):
    """
    Create an InterviewSession from an already-uploaded COS file URL.
    This avoids re-uploading the file binary — the frontend calls /api/file/upload
    first, then calls this endpoint with the returned file_url.
    """
    # ── 配额扣减移到 _run_real_analysis_impl 分析成功之后再扣 ──
    # 2026-07-25+ 改为"分析成功才扣"模型:
    #   失败(ASR 失败 / LLM 失败)→ 不扣,用户能立刻重试不浪费额度
    #   重跑已成功的分析 → 看 session.quota_charged,不重复扣
    if current_user:
        pass  # quota_charged 会在 run_real_analysis 成功后置 True

    # req.file_url 可能是三种格式之一，统一抽出 cos_key 后再存：
    #   1) 老数据：签名 URL (https://...?sign=...) → 抽 path
    #   2) 新数据：非签名 cos 路径 (https://bucket.cos.region.myqcloud.com/uploads/xxx)
    #   3) 纯 cos_key (uploads/xxx)
    # 存 cos_key 即可：① 消除"DB 泄漏 = 1h 签名 URL 即明文"风险
    #                 ② 后续 audio.py 报告页 re-sign 逻辑按 path 解析也对得上
    # 最后统一 unquote 一次，兼容"uploads/abc%20def.wav"这种 URL-encoded 形式
    import urllib.parse
    raw = req.file_url
    if raw.startswith("uploads/") or "/" not in raw:
        cos_key = urllib.parse.unquote(raw)
    else:
        parsed = urllib.parse.urlparse(raw)
        path = parsed.path.lstrip("/")
        cos_key = urllib.parse.unquote(path) if path else raw

    session = models.InterviewSession(
        user_id=current_user.id if current_user else None,
        audio_url=cos_key,  # 存 cos_key 而非签名 URL，**不再有 1h-bomb**
        duration=0,
        file_size=req.file_size or 0,
        status="uploaded",
        job_description=req.job_description,
        # 结构化元数据(独立列)
        company=req.company,
        role=req.role,
        round=req.round,
        date=req.date,
        grade=req.grade,
        salary=req.salary,
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)
    return {
        "session_id": session.id,
        "audio_url": session.audio_url,  # 此时已是 cos_key
        "status": session.status,
    }


class CreateRecordSessionRequest(BaseModel):
    session_id: Optional[int] = None
    paste_text: str
    company: Optional[str] = None
    role: Optional[str] = None
    round: Optional[str] = None
    date: Optional[str] = None
    grade: Optional[str] = None
    salary: Optional[str] = None
    job_description: Optional[str] = None

def parse_dialogue_to_segments(raw_text: str) -> list:
    import re
    lines = raw_text.split("\n")
    segments = []
    count = 0
    prev_speaker = "Candidate"
    
    for idx, line in enumerate(lines):
        clean_line = line.strip()
        if not clean_line:
            continue
        # Extract timestamp in brackets/parentheses like (00:00) or [00:00]
        time_match = re.search(r'[\(\[\uff08\uff3b]([0-9]{2}:[0-9]{2})[\)\]\uff09\uff3d]', clean_line)
        start_time = 0.0
        if time_match:
            time_str = time_match.group(1)
            parts = time_str.split(":")
            start_time = float(int(parts[0]) * 60 + int(parts[1]))
            remaining_text = clean_line.replace(time_match.group(0), "").strip()
        else:
            start_time = float(count * 95)
            remaining_text = clean_line
        
        # Check speakers
        is_interviewer = re.match(r'^(面试官|Q|q|问)\d*\s*[：:\s]', remaining_text)
        is_user = re.match(r'^(我|您|A|a|答)\d*\s*[：:\s]', remaining_text)
        
        speaker = "Candidate"
        content_val = remaining_text
        
        if is_interviewer:
            speaker = "Interviewer"
            content_val = re.sub(r'^(面试官|Q|q|问)\d*\s*[：:\s]', '', remaining_text).strip()
        elif is_user:
            speaker = "Candidate"
            content_val = re.sub(r'^(我|您|A|a|答)\d*\s*[：:\s]', '', remaining_text).strip()
        else:
            # Heuristics
            parts = line.split(":", 1)
            if len(parts) == 2:
                speaker = parts[0].strip()
                content_val = parts[1].strip()
            else:
                speaker = "Candidate" if idx % 2 == 1 else "Interviewer"
                content_val = line.strip()
        
        segments.append({
            "start_time": start_time + (idx * 10.0),
            "end_time": start_time + (idx * 10.0) + 10.0,
            "speaker": speaker,
            "content": content_val
        })
    return segments

@router.post("/create_record_session")
async def create_record_session(
    req: CreateRecordSessionRequest,
    _moderation: None = Depends(moderated("record", "paste_text", "job_description")),
    db: AsyncSession = Depends(get_db),
    current_user: Optional[models.User] = Depends(get_current_user_optional)
):
    """
    Create or update an InterviewSession for text/record analysis.
    This parses the raw pasted text into transcripts and saves/updates the session.
    """
    session = None
    if req.session_id:
        result = await db.execute(
            select(models.InterviewSession).where(models.InterviewSession.id == req.session_id)
        )
        session = result.scalars().first()
        if session:
            # ── 配额扣减移到分析成功之后(由 _run_real_analysis_impl 统一处理) ──
            # 2026-07-25+ 不再在入口 check_and_consume,改为在 ASR+LLM 成功后再扣
            # 重分析时通过 session.quota_charged 标志判断是否已扣过
            # Update fields of the existing session
            session.company = req.company or session.company
            session.role = req.role or session.role
            session.round = req.round or session.round
            session.date = req.date or session.date
            session.grade = req.grade if req.grade is not None else session.grade
            session.salary = req.salary if req.salary is not None else session.salary
            session.job_description = req.job_description
            session.status = "uploaded"
            
            # Reset scores & summaries to clean slate for re-analysis
            session.ipi_score = 0
            session.offer_probability = 0
            session.summary_strengths = []
            session.summary_weaknesses = []
            session.summary_suggestions = []
            session.executive_summary = None
            session.analysis_result = None
            
            # Wipe prior related tables (cascade-like cleanup before re-analyze)
            await db.execute(
                models.InterviewTranscript.__table__.delete().where(
                    models.InterviewTranscript.session_id == session.id
                )
            )
            await db.execute(
                models.TranscriptSection.__table__.delete().where(
                    models.TranscriptSection.session_id == session.id
                )
            )
            await db.execute(
                models.InterviewRisk.__table__.delete().where(
                    models.InterviewRisk.session_id == session.id
                )
            )
            await db.execute(
                models.AnswerImprovement.__table__.delete().where(
                    models.AnswerImprovement.session_id == session.id
                )
            )
            await db.execute(
                models.InterviewQuestion.__table__.delete().where(
                    models.InterviewQuestion.session_id == session.id
                )
            )
            await db.commit()

    if not session:
        # Create a new session
        # 2026-07-25+: 配额扣减移到分析成功之后(由 _run_real_analysis_impl 统一处理)
        # 这里不再 check_and_consume,避免"上传就扣一次但分析失败额度白扔"
        if current_user:
            pass  # quota_charged 会在 run_real_analysis 成功后置 True


        session = models.InterviewSession(
            user_id=current_user.id if current_user else None,
            audio_url="text_mode",
            duration=0,
            file_size=len(req.paste_text.encode('utf-8')),
            status="uploaded",
            job_description=req.job_description,
            # 结构化元数据(独立列)
            company=req.company,
            role=req.role,
            round=req.round,
            date=req.date,
            grade=req.grade,
            salary=req.salary,
        )
        db.add(session)
        await db.commit()
        await db.refresh(session)

    # Parse and save transcript (with privacy desensitization)
    cleaned_text = desensitize_text(req.paste_text)
    segments = parse_dialogue_to_segments(cleaned_text)
    transcript = models.InterviewTranscript(
        session_id=session.id,
        data=segments
    )
    db.add(transcript)
    await db.commit()

    return {
        "session_id": session.id,
        "status": session.status
    }


# In-memory store for active task progress to simplify polling in MVP
# In production, this would be Redis or DB-backed
task_store: Dict[str, Dict[str, Any]] = {}


async def run_real_analysis(session_id: int, task_id: str, profile_data: Optional[dict]):
    """
    Real analysis pipeline:
      1. ASR  — call Volc Engine ASR on the COS audio URL (cos_key 需先 presign 成可下载 URL)
      2. LLM  — call DeepSeek (reasoning model) to evaluate the real transcript
      3. DB   — persist transcript segments, scores, risks, improvements

    失败策略（2026-07-25+）:
      - ASR 失败（提交失败/轮询失败/返回 0 段）→ task=failed + 退额度 + 报错文案,不写 mock
      - LLM 任一调用失败 → 同上
      - 段数/评分/亮点等任何缺漏 → 同上
      - 不再使用 safe mock dialogue / safe fallback scores / 启发式 section / 兜底 mock transcript
    """
    # 上层 try/except 兜住所有未捕获异常：失败一律走 _fail_analysis
    try:
        await _run_real_analysis_impl(session_id, task_id, profile_data)
    except Exception as e:
        logger.exception(
            f"[task={task_id}] 面试分析失败 session_id={session_id}: {e!r}"
        )
        # 根据 session 类型决定"录音分析"还是"记录分析"前缀
        feature_label = FEATURE_NAME_AUDIO
        try:
            async with async_session() as db:
                sess_res = await db.execute(
                    select(models.InterviewSession).where(models.InterviewSession.id == session_id)
                )
                sess = sess_res.scalars().first()
                if sess and sess.audio_url in ("text_mode", "live"):
                    feature_label = FEATURE_NAME_RECORD
        except Exception:
            pass
        # 把具体异常 reason 透出来,避免"请稍后重试"这种假大空
        reason = str(e) or REASON_UNKNOWN
        # 截断过长的 reason(LLM/SDK 异常堆栈可能很长)
        if len(reason) > 200:
            reason = reason[:200] + "..."
        await _fail_analysis(
            session_id=session_id,
            task_id=task_id,
            user_message=format_failure(feature_label, reason),
            log_prefix=f"[task={task_id}]",
        )


async def _fail_analysis(
    *,
    session_id: int,
    task_id: str,
    user_message: str,
    log_prefix: str,
) -> None:
    """
    统一的失败处理：标 task=failed、写 session.status=failed。

    2026-07-25+ 改为"分析成功才扣额度"模型,失败不扣,所以这里不再 refund_quota。
    """
    task_store[task_id]["status"] = "failed"
    task_store[task_id]["error_message"] = user_message

    try:
        async with async_session() as db:
            sess_res = await db.execute(
                select(models.InterviewSession).where(models.InterviewSession.id == session_id)
            )
            sess = sess_res.scalars().first()
            if sess:
                # 2026-07-25+: 同时把标准格式的 error_message 写到 session,
                # 让前端调 get_session_report 时能直接拿到失败原因
                sess.status = "failed"
                sess.error_message = user_message
                await db.commit()
    except Exception as e:
        logger.error(f"{log_prefix} 写 session.status=failed 失败: {e!r}")


async def _run_real_analysis_impl(session_id: int, task_id: str, profile_data: Optional[dict]):
    def _set_progress(pct: int, status_str: str = "processing"):
        task_store[task_id]["progress"] = pct
        task_store[task_id]["status"] = status_str

    # ── Step 0: Mark as started ───────────────────────────────────────────
    _set_progress(5)

    # ── Step 1: Fetch audio URL from DB ──────────────────────────────────
    audio_url: Optional[str] = None
    job_description: Optional[str] = None
    async with async_session() as db:
        result = await db.execute(
            select(models.InterviewSession).where(models.InterviewSession.id == session_id)
        )
        sess = result.scalars().first()
        if sess:
            audio_url = sess.audio_url
            job_description = sess.job_description
            sess.status = "processing"
            await db.commit()

    if not audio_url:
        raise RuntimeError("找不到对应的面试记录")

    _set_progress(15, "processing")

    # ── Step 2: Real ASR via Volc Engine or load from DB (for text/live mode) ─
    # PR4: 'live' 走与 text_mode 相同分支 —— 实时模式 ASR 在火山端完成，
    #      bridge 已把 transcript 写入 InterviewTranscript.data，直接读出。
    raw_segments: List[Dict[str, Any]] = []
    if audio_url in ("text_mode", "live"):
        async with async_session() as db:
            tx_res = await db.execute(
                select(models.InterviewTranscript).where(models.InterviewTranscript.session_id == session_id)
            )
            tx = tx_res.scalars().first()
            if tx and tx.data:
                raw_segments = tx.data
        logger.info(
            f"[task={task_id}] Loaded {len(raw_segments)} segments from DB for {audio_url} session"
        )
        # 记录/实时模式：raw_segments 必须非空(空说明用户没贴文本或 bridge 没回填)
        if not raw_segments:
            raise RuntimeError("没有可分析的对话内容(请检查文本是否粘贴或面试是否正常结束)")
    else:
        # 录音模式：DB 里存的是 cos_key(uploads/xxx),火山 ASR 没法直接 GET,必须先 presign
        from app.routers.file import get_cos_client, bucket
        import urllib.parse
        parsed = urllib.parse.urlparse(audio_url)
        cos_key = urllib.parse.unquote(parsed.path.lstrip("/")) if parsed.path else audio_url
        if not cos_key.startswith("uploads/"):
            raise RuntimeError("音频文件路径不合法")
        try:
            cos_client = get_cos_client()
            presigned_url: str = await asyncio.to_thread(
                cos_client.get_presigned_download_url,
                Bucket=bucket,
                Key=cos_key,
                Expired=3600,  # 1h,ASR 通常 30-60s,余量足够
            )
        except Exception as e:
            logger.exception(f"{log_prefix} COS presign 失败: {e!r}")
            raise RuntimeError("音频文件无法访问") from e

        logger.info(
            f"[task={task_id}] Starting ASR for session {session_id}, "
            f"cos_key={cos_key} (presigned)"
        )
        # ── ASR 是阻塞调用（典型 30-60s），期间前端只能看到 15% 卡住。
        #    在后台开一个"虚拟进度"协程，每隔几秒推一点进度（不超过 45%），
        #    ASR 真正完成后取消它，立刻 _set_progress(45)。
        async def _fake_asr_progress():
            try:
                curr = 15
                while curr < 44:
                    await asyncio.sleep(2.5)
                    inc = 3 if curr < 30 else (2 if curr < 40 else 1)
                    curr = min(44, curr + inc)
                    _set_progress(curr, "processing")
            except asyncio.CancelledError:
                pass

        fake_progress_task = asyncio.create_task(_fake_asr_progress())
        try:
            # 失败直接抛出,由外层 _run_real_analysis 走 _fail_analysis
            raw_segments = await asyncio.to_thread(call_volc_asr, presigned_url)
            logger.info(f"[task={task_id}] ASR returned {len(raw_segments)} segments")
        finally:
            fake_progress_task.cancel()
            try:
                await fake_progress_task
            except asyncio.CancelledError:
                pass

        if not raw_segments:
            # ASR 调用本身没抛,但返回空段(典型场景:火山下载成功但音频无语音/损坏)
            raise RuntimeError("音频无有效语音内容")

    _set_progress(45, "processing")

    # ── Step 2.1: 隐私脱敏处理 (2026-07-20+) ─────────────────────────────────
    if raw_segments:
        for seg in raw_segments:
            if "content" in seg and isinstance(seg["content"], str):
                seg["content"] = desensitize_text(seg["content"])

    # ── Step 2.0: 预热(纯 CPU/DB,无 LLM) ───────────────────────────────────
    #              把 analyze_interview_dialogue 需要的 dialogue_text 和
    #              existing_projects 提前到 gather 之前准备,这样三方 LLM 调用
    #              可以真正并发,端到端省下 analyze 的 30-90s。
    dialogue_text: str = ""
    if raw_segments:
        lines = []
        for seg in raw_segments:
            role = "面试官" if seg["speaker"] == "Interviewer" else "候选人"
            lines.append(f"{role}：{seg['content']}")
        dialogue_text = "\n".join(lines)
    else:
        # raw_segments 在上面已经被强校验非空,这里只是兜底
        raise RuntimeError("dialogue_text 构造时 raw_segments 为空,逻辑异常")

    # 查询用户已有项目记忆(供 LLM 匹配 mentioned_projects)
    existing_projects: list[dict] = []
    async with async_session() as db:
        sess_proj_result = await db.execute(
            select(models.InterviewSession).where(models.InterviewSession.id == session_id)
        )
        sess_proj = sess_proj_result.scalars().first()
        if sess_proj and sess_proj.user_id:
            pm_result = await db.execute(
                select(models.ProjectMemory).where(
                    models.ProjectMemory.user_id == sess_proj.user_id
                )
            )
            existing_projects = [
                {"id": pm.id, "project_name": pm.project_name}
                for pm in pm_result.scalars().all()
            ]
    logger.info(
        f"[task={task_id}] Pre-warmed dialogue_text(len={len(dialogue_text)}) "
        f"existing_projects={len(existing_projects)}"
    )

    # ── Step 2.5 + 3.5 (parallel): Highlights + Sectionize + Eval ──────────
    #              三个 LLM 调用都只依赖 raw_segments/dialogue_text/profile/jd,
    #              无相互依赖,完全可并发。Wall-clock = max(...) 而非 sum。
    #              改造前:highlights+sectionize → analyze 串行 3 段
    #              改造后:max(highlights, sectionize, analyze) 单段
    #              实测 13 段录音:从 ~90s 降到 ~40s(主要省掉 analyze 的 30-90s)。
    #              2026-07-25+: 任一 LLM 失败直接 raise,不再有 safe fallback
    highlights: list = []
    sections: list = []
    llm_result: dict = {}
    mentioned_projects: list[dict] = []  # P0 优化(#3): 独立 LLM 调用,与 gather 并发

    t_import = time.monotonic()  # 用于日志对比改造前后耗时

    async def _call_highlights():
        t0 = time.monotonic()
        result = await generate_transcript_highlights(raw_segments)
        logger.info(
            f"[task={task_id}] Highlights API returned {len(result)} items "
            f"in {time.monotonic() - t0:.2f}s"
        )
        return result or []

    async def _call_sectionize():
        t0 = time.monotonic()
        result = await sectionize_transcript(raw_segments)
        logger.info(
            f"[task={task_id}] Sectionize returned {len(result)} sections "
            f"in {time.monotonic() - t0:.2f}s"
        )
        return result or []

    async def _call_dialogue_eval():
        t0 = time.monotonic()
        res = await analyze_interview_dialogue(
            dialogue_text, profile_data, job_description, existing_projects
        )
        logger.info(
            f"[task={task_id}] analyze_interview_dialogue returned "
            f"in {time.monotonic() - t0:.2f}s"
        )
        return res or {}

    async def _call_extract_mentions():
        """P0 优化(#3): mentioned_projects 独立 LLM 调用,与 3 个主调用并发。"""
        t0 = time.monotonic()
        items = await extract_mentioned_projects(dialogue_text, existing_projects)
        logger.info(
            f"[task={task_id}] extract_mentioned_projects returned "
            f"{len(items)} items in {time.monotonic() - t0:.2f}s"
        )
        return items or []

    if raw_segments:
        logger.info(
            f"[task={task_id}] Calling 4 LLMs in parallel: "
            f"highlights + sectionize + dialogue_eval + extract_mentions for {len(raw_segments)} segments"
        )

        # ── LLM 是 30-90s 阻塞操作，期间前端看不到中间进度 ──
        #    同样开 fake_progress 协程模拟（从 45 → 60），gather 完成时取消它。
        async def _fake_llm_progress():
            try:
                curr = 46
                _set_progress(curr, "processing")
                while curr < 64:
                    await asyncio.sleep(1.8)
                    inc = 2 if curr < 54 else 1
                    curr = min(64, curr + inc)
                    _set_progress(curr, "processing")
            except asyncio.CancelledError:
                pass

        llm_fake_task = asyncio.create_task(_fake_llm_progress())
        try:
            # gather 任一异常会直接 raise 到外层 _run_real_analysis 走 _fail_analysis
            highlights, sections, llm_result, mentioned_projects = await asyncio.gather(
                _call_highlights(),
                _call_sectionize(),
                _call_dialogue_eval(),
                _call_extract_mentions(),
            )
        finally:
            llm_fake_task.cancel()
            try:
                await llm_fake_task
            except asyncio.CancelledError:
                pass

        logger.info(
            f"[task={task_id}] ⏱️  4-LLM parallel block total = "
            f"{time.monotonic() - t_import:.2f}s "
            f"(highlights={len(highlights)}, sections={len(sections)}, "
            f"llm_result_keys={list(llm_result.keys()) if llm_result else []})"
        )

        # 关键校验:4 个 LLM 结果必须都有内容,否则视为失败
        # 不再用启发式 / mock 数据填充,直接抛错让外层走失败处理
        if not llm_result:
            raise RuntimeError("AI 评估返回为空")
        if not sections:
            raise RuntimeError("AI 章节切分返回为空")

        # 从 llm_result 提取各项指标(没有再报错,不再 fallback 到硬编码值)
        ipi_score = llm_result.get("ipi_score")
        offer_probability = llm_result.get("offer_probability")
        strengths = llm_result.get("summary_strengths")
        weaknesses = llm_result.get("summary_weaknesses")
        suggestions = llm_result.get("summary_suggestions")
        executive_summary = llm_result.get("executive_summary")
        scores_dict = llm_result.get("scores")
        for name, val in [
            ("ipi_score", ipi_score),
            ("offer_probability", offer_probability),
            ("summary_strengths", strengths),
            ("summary_weaknesses", weaknesses),
            ("summary_suggestions", suggestions),
            ("executive_summary", executive_summary),
            ("scores", scores_dict),
        ]:
            if val is None or val == "" or val == [] or val == {}:
                raise RuntimeError(f"AI 返回缺少关键字段：{name}")

        # Merge highlights into raw_segments (same logic as before, but on the
        # in-memory list we already have — no extra await needed).
        for hl in highlights:
            try:
                idx = int(hl.get("segment_index", -1))
                text_to_find = hl.get("text", "")
                hl_type = hl.get("type", "")
                hl_tip = hl.get("tip", "")
                if 0 <= idx < len(raw_segments) and text_to_find:
                    if text_to_find in raw_segments[idx].get("content", ""):
                        if "highlights" not in raw_segments[idx]:
                            raw_segments[idx]["highlights"] = []
                        raw_segments[idx]["highlights"].append({
                            "text": text_to_find,
                            "type": hl_type,
                            "tip": hl_tip
                        })
            except Exception as ex:
                logger.warning(f"Error merging highlight: {ex}")

    _set_progress(65, "processing")

    # 把 transcript/sections 写入 + 配额扣减 + scores 写入放在同一个事务里，
    # 任一步失败都不会有脏数据残留在数据库。
    async with async_session() as db:
        # ── Wipe prior data ──
        await db.execute(
            models.InterviewTranscript.__table__.delete().where(
                models.InterviewTranscript.session_id == session_id
            )
        )
        await db.execute(
            models.TranscriptSection.__table__.delete().where(
                models.TranscriptSection.session_id == session_id
            )
        )
        await db.execute(
            models.InterviewRisk.__table__.delete().where(
                models.InterviewRisk.session_id == session_id
            )
        )
        await db.execute(
            models.AnswerImprovement.__table__.delete().where(
                models.AnswerImprovement.session_id == session_id
            )
        )
        await db.execute(
            models.InterviewQuestion.__table__.delete().where(
                models.InterviewQuestion.session_id == session_id
            )
        )

        # ── Insert transcript ──
        if raw_segments:
            db.add(models.InterviewTranscript(session_id=session_id, data=raw_segments))
        else:
            raise RuntimeError("写 transcript 时 raw_segments 为空,逻辑异常")

        # ── Insert sections ──
        for idx, sec in enumerate(sections):
            db.add(models.TranscriptSection(
                session_id=session_id,
                section_index=idx,
                title=sec["title"],
                category=sec["category"],
                tag=sec.get("tag") or "一般",
                start_time=sec["start_time"],
                end_time=sec["end_time"],
                summary=sec.get("summary"),
                advantages=sec.get("advantages") or [],
                shortcomings=sec.get("shortcomings") or [],
                review_points=sec.get("review_points") or [],
            ))

        # ── Load session ──
        sess_result = await db.execute(
            select(models.InterviewSession).where(models.InterviewSession.id == session_id)
        )
        session = sess_result.scalars().first()
        if not session:
            raise RuntimeError("结果保存失败：记录已不存在")

        # ── 配额扣减(分析成功才扣) ──
        if session.user_id and not session.quota_charged:
            feature = (
                FEATURE_RECORD
                if session.audio_url in ("text_mode", "live")
                else FEATURE_AUDIO
            )
            user_for_quota = await db.get(models.User, session.user_id)
            if user_for_quota:
                try:
                    await check_and_consume(db, user_for_quota, feature)
                    session.quota_charged = True
                    logger.info(
                        f"[task={task_id}] 分析成功,扣额度 user_id={session.user_id} "
                        f"feature={feature} session.quota_charged=True"
                    )
                except HTTPException as quota_exc:
                    raise RuntimeError(
                        f"本次分析已完成但额度已用完,本次不计入消耗（{quota_exc.detail}）"
                    ) from quota_exc

        # ── 写入 scores & summary ──
        session.ipi_score         = ipi_score
        session.offer_probability = offer_probability
        session.summary_strengths    = strengths
        session.summary_weaknesses   = weaknesses
        session.summary_suggestions  = suggestions
        session.executive_summary    = executive_summary
        session.analysis_result      = llm_result
        session.status = "completed"

        # ── Risk ──
        risk_desc = weaknesses[0] if weaknesses else "表达简短，技术深度不足"
        db.add(models.InterviewRisk(
            session_id=session_id,
            risk_type="answer_quality",
            severity="high" if ipi_score < 70 else "medium",
            title=risk_desc[:30],
            evidence=dialogue_text[:200],
            suggestion=suggestions[0] if suggestions else "加强技术深度",
            occurrence_time=382.0
        ))

        # ── 统一提交：以上任一步抛异常都不会落库 ──
        await db.commit()

    # ── Step 4.5: 同步项目提及次数（fire-and-forget，失败不影响主流程） ────
    async with async_session() as db:
        sess_mention_result = await db.execute(
            select(models.InterviewSession).where(models.InterviewSession.id == session_id)
        )
        sess_mention = sess_mention_result.scalars().first()
        user_id_for_mention = sess_mention.user_id if sess_mention else None

    if user_id_for_mention is not None and mentioned_projects:
        try:
            from app.services.project_mention_service import sync_project_mentions
            mention_stats = await sync_project_mentions(
                user_id=user_id_for_mention,
                mentioned_projects=mentioned_projects,
                session_id=session_id,
            )
            logger.info(
                f"[task={task_id}] 项目提及同步完成: "
                f"matched={mention_stats['matched']} "
                f"unmatched={mention_stats['unmatched']}"
            )
        except Exception as e:
            logger.error(
                f"[task={task_id}] 项目提及同步失败（不影响主流程）: {e}"
            )

    _set_progress(85, "processing")

    # 触发 AI 职业顾问索引（fire-and-forget；失败不影响主流程）
    if session.user_id:
        schedule_index({
            "kind": "interview_summary",
            "user_id": session.user_id,
            "session_id": session_id,
        })
        schedule_index({
            "kind": "interview_sections_bulk",
            "user_id": session.user_id,
            "session_id": session_id,
        })

    # [P0 优化#4 已移除] 不再预生成所有 section 的 optimization_advice
    # 改为按需生成：用户点击某个 section 的「生成优化建议」时，仅对当前 section
    # 调一次 LLM，避免「点一下全生成」的错觉，也节省 LLM 成本。
    # _prefetch_section_optimization 函数保留以备后用。

    _set_progress(100, "completed")
    logger.info(f"[task={task_id}] Analysis complete for session {session_id}")

    # 异步非阻塞派发：AI 职业顾问行动建议 + 200道题库生成器保留联网（enable_network=True），
    # 但完全独立运行，绝对不占用主任务或阻塞【生成优化建议】与前端 API
    if session.user_id is not None:
        user_id_val: int = session.user_id
        from app.services.advisor_generator import trigger_custom_advisor_insights
        async def _safe_bg_advisor(target_uid: int):
            try:
                await trigger_custom_advisor_insights(target_uid)
            except Exception as ex:
                logger.warning(f"[audio] 异步 AI 职业顾问生成失败（不影响主流程）: {ex!r}")

        asyncio.create_task(_safe_bg_advisor(user_id_val))

        # 异步匹配面试中的问题到知识库细化能力
        if llm_result:
            questions = []
            for qd in (llm_result.get("question_deconstruction") or []):
                if isinstance(qd, dict) and qd.get("title"):
                    questions.append({
                        "label": qd["title"].strip(),
                        "desc": qd.get("desc", ""),
                    })
            if questions:
                from app.services.knowledge_ability_service import trigger_knowledge_match
                async def _safe_bg_knowledge(target_uid: int, q_list: list):
                    try:
                        await trigger_knowledge_match(target_uid, q_list)
                    except Exception as ex:
                        logger.warning(f"[audio] 异步知识库能力题库匹配失败（不影响主流程）: {ex!r}")

                asyncio.create_task(_safe_bg_knowledge(user_id_val, questions))




@router.post("/upload")
async def upload_audio(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: Optional[models.User] = Depends(get_current_user_optional)
):
    # Enforce file size limit of 50MB
    max_size_bytes = 50 * 1024 * 1024
    if file.size and file.size > max_size_bytes:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="上传的录音文件大小不能超过 50MB"
        )

    # Enforce format constraints
    filename = file.filename or ""
    ext = filename.split('.')[-1].lower() if '.' in filename else ""
    if ext not in ["wav", "mp3"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="上传失败，录音仅支持 WAV 或 MP3 格式"
        )

    # Save the session with optional user association
    from app.config import settings as _settings
    base = (_settings.PUBLIC_BASE_URL or "").rstrip("/")
    audio_url = f"{base}/uploads/{uuid.uuid4()}_{file.filename}" if base else f"/uploads/{uuid.uuid4()}_{file.filename}"

    session = models.InterviewSession(
        user_id=current_user.id if current_user else None,
        audio_url=audio_url,
        duration=1822, # Simulated 30 mins
        file_size=file.size or 0,
        status="uploaded"
    )

    db.add(session)
    await db.commit()
    await db.refresh(session)

    return {
        "session_id": session.id,
        "audio_url": session.audio_url,
        "status": session.status,
        "duration": session.duration
    }


@router.post("/analyze")
async def analyze_audio(
    req: AnalyzeRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: Optional[models.User] = Depends(get_current_user_optional)
):
    session_id = req.session_id
    result = await db.execute(select(models.InterviewSession).where(models.InterviewSession.id == session_id))
    session = result.scalars().first()
    if not session:
        raise HTTPException(status_code=404, detail="面试会话不存在")

    task_id = str(uuid.uuid4())
    task_store[task_id] = {
        "session_id": session_id,
        "status": "pending",
        "progress": 0,
        "error_message": None
    }
    
    # Profile payload preparation - NULL/Empty if guest user (not logged in)
    profile_data = await _extract_profile_data(db, current_user.id if current_user else None)

    # Dispatch real analysis workflow to background task thread
    background_tasks.add_task(run_real_analysis, session_id, task_id, profile_data)
    
    # Update Session status to processing
    session.status = "processing"
    await db.commit()
    
    return {
        "task_id": task_id,
        "session_id": session_id,
        "status": "pending"
    }


async def _extract_profile_data(db: AsyncSession, user_id: Optional[int]) -> Optional[dict]:
    """
    PR4 helper: 从 user_id 取 UserProfile，抽 7 个字段供 run_real_analysis 用。
    暴露在模块级供 live.py 的 end 端点复用。
    """
    if not user_id:
        return None
    from sqlalchemy.future import select
    from sqlalchemy.orm import selectinload
    result = await db.execute(
        select(models.User)
        .options(selectinload(models.User.profile))
        .where(models.User.id == user_id)
    )
    user = result.scalars().first()
    if not user or not user.profile:
        return None
    p = user.profile
    return {
        "gender": p.gender,
        "age": p.age,
        "experience_years": p.experience_years,
        "role_name": p.role_name,
        "target_company": p.target_company,
        "target_grade": p.target_grade,
        "target_role": p.target_role,
    }


@router.get("/task/{id}")
async def get_task_status(id: str):
    if id not in task_store:
        raise HTTPException(status_code=404, detail="分析任务不存在")
    return task_store[id]


# ── DEBUG: Test ASR directly ────────────────────────────────────────────────
class DebugASRRequest(BaseModel):
    audio_url: str

@router.post("/debug/asr")
async def debug_asr(body: DebugASRRequest):
    """
    Test endpoint: submit an audio URL to Volc ASR and return raw parsed segments.
    Usage: POST /api/audio/debug/asr  {"audio_url": "<COS_URL>"}
    """
    from app.utils.asr import call_volc_asr
    try:
        segments = await asyncio.to_thread(call_volc_asr, body.audio_url)
        return {
            "audio_url": body.audio_url,
            "segment_count": len(segments),
            "segments": segments
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/debug/resectionize/{session_id}")
async def debug_resectionize(session_id: int):
    """
    Re-run LLM sectionize on an existing session's transcript without re-running
    ASR. Useful when sectionize timed out previously and you want to retry cheaply.
    """
    async with async_session() as db:
        res = await db.execute(
            select(models.InterviewTranscript.data)
            .where(models.InterviewTranscript.session_id == session_id)
        )
        raw_segments = res.scalar()

        if not raw_segments:
            raise HTTPException(status_code=404, detail="No transcript for this session")

        # Clear old sections before re-sectionizing
        await db.execute(
            models.TranscriptSection.__table__.delete().where(
                models.TranscriptSection.session_id == session_id
            )
        )
        await db.commit()

    sections = await sectionize_transcript(raw_segments)

    if not sections:
        raise HTTPException(status_code=500, detail="sectionize returned no sections")

    async with async_session() as db:
        for idx, sec in enumerate(sections):
            db.add(models.TranscriptSection(
                session_id=session_id,
                section_index=idx,
                title=sec["title"],
                category=sec["category"],
                tag=sec.get("tag") or "一般",
                start_time=sec["start_time"],
                end_time=sec["end_time"],
                summary=sec.get("summary"),
                advantages=sec.get("advantages") or [],
                shortcomings=sec.get("shortcomings") or [],
                review_points=sec.get("review_points") or [],
            ))
        await db.commit()

    return {
        "session_id":   session_id,
        "section_count": len(sections),
        "sections":      sections,
    }


@router.get("/report/{id}")
async def get_session_report(id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(models.InterviewSession)
        .options(selectinload(models.InterviewSession.transcript))
        .options(selectinload(models.InterviewSession.questions))
        .options(selectinload(models.InterviewSession.risks))
        .options(selectinload(models.InterviewSession.improvements))
        .where(models.InterviewSession.id == id)
    )
    session = result.scalars().first()
    if not session:
        raise HTTPException(status_code=404, detail="面试报告未找到")

    # Transcript lives in interview_transcripts.data (JSONB); default to [] if absent
    transcript_data = sorted(
        (session.transcript.data if session.transcript else []),
        key=lambda s: float(s.get("start_time") or 0),
    )

    # Generate a fresh presigned URL so it never expires for the frontend player
    fresh_audio_url = session.audio_url
    try:
        from app.routers.file import get_cos_client, bucket
        import urllib.parse
        parsed = urllib.parse.urlparse(session.audio_url)
        path = parsed.path
        if path.startswith("/"):
            path = path[1:]
        cos_key = urllib.parse.unquote(path)

        # Verify it's a COS key uploads
        if cos_key.startswith("uploads/"):
            client = get_cos_client()
            fresh_audio_url = await asyncio.to_thread(
                client.get_presigned_download_url,
                Bucket=bucket,
                Key=cos_key,
                Expired=7200,  # 2 hours
            )
    except Exception as e:
        logger.warning(f"Failed to generate fresh presigned URL: {e}")

    analysis_res = getattr(session, "analysis_result", None) or {}
    llm_scores = analysis_res.get("scores", {}) if isinstance(analysis_res, dict) else {}

    ipi = session.ipi_score
    offer_prob = session.offer_probability

    # 2026-07-25+: 失败状态时,显式返回 error_message,不再合成假分数 / 假摘要
    # 前端应当根据 status == "failed" 走错误展示分支,而不是渲染"零分报告"
    if session.status == "failed":
        return {
            "session_id": session.id,
            "audio_url": fresh_audio_url,
            "duration": session.duration,
            "status": "failed",
            "error_message": session.error_message or "录音分析失败",
            "job_description": session.job_description,
            "company": session.company or "",
            "role": session.role or "",
            "round": session.round or "",
            "date": session.date or "",
            "display_title": " · ".join(
                x for x in [session.company, session.role, session.round] if x
            ) or "未命名面试分析",
            # 失败时所有分数/摘要字段显式置 None,绝不用 0 / "报告处理中" 之类兜底
            "scores": None,
            "summary": None,
            "analysis_result": None,
            "transcript": [],
        }

    # 成功状态:从 LLM 真实结果取分数,缺失即 None(不再用 ipi 合成假分数)
    expression_score = (
        llm_scores.get("expression") or llm_scores.get("score_expression")
    ) if llm_scores else None
    logic_score = (
        llm_scores.get("logic") or llm_scores.get("score_logic")
    ) if llm_scores else None
    project_depth_score = (
        llm_scores.get("project_depth") or llm_scores.get("score_project_depth")
    ) if llm_scores else None
    ownership_score = (
        llm_scores.get("ownership") or llm_scores.get("score_ownership")
    ) if llm_scores else None
    system_design_score = (
        llm_scores.get("system_design") or llm_scores.get("score_system_design")
    ) if llm_scores else None
    # communication 不在 5 维度 LLM 输出里,直接 None,前端应当按 LLM 的 5 维度展示
    communication_score = None

    return {
        "session_id": session.id,
        "audio_url": fresh_audio_url,
        "duration": session.duration,
        "status": session.status,
        "error_message": session.error_message,  # 成功时为 None
        "job_description": session.job_description,
        "company": session.company or "",
        "role": session.role or "",
        "round": session.round or "",
        "date": session.date or "",
        "display_title": " · ".join(
            x for x in [session.company, session.role, session.round] if x
        ) or "未命名面试分析",
        "scores": {
            "ipi": ipi,
            "offer_probability": offer_prob,
            "expression": expression_score,
            "logic": logic_score,
            "project_depth": project_depth_score,
            "ownership": ownership_score,
            "communication": communication_score,
            "system_design": system_design_score
        },
        "summary": {
            "executive_summary": session.executive_summary,
            "strengths": session.summary_strengths,
            "weaknesses": session.summary_weaknesses,
            "suggestions": session.summary_suggestions
        },
        "analysis_result": analysis_res,
        "transcript": [
            {
                "start_time": s.get("start_time"),
                "end_time":   s.get("end_time"),
                "speaker":    s.get("speaker"),
                "content":    s.get("content"),
                "highlights": s.get("highlights"),
            }
            for s in transcript_data
        ],
    }


@router.get("/session/{id}/sections")
async def get_session_sections(id: int, db: AsyncSession = Depends(get_db)):
    """
    Return the LLM-segmented topical sections for a session, ordered by
    section_index. Each section carries start_time / end_time (seconds)
    so the frontend can jump the audio player to that range on click.
    segment_count is computed at request time by matching transcript.data
    segments against each section's start_time / end_time range.
    """
    # Load sections
    sec_result = await db.execute(
        select(models.TranscriptSection)
        .where(models.TranscriptSection.session_id == id)
        .order_by(models.TranscriptSection.section_index.asc())
    )
    sections = sec_result.scalars().all()

    # Load transcript JSONB once
    tr_result = await db.execute(
        select(models.InterviewTranscript.data)
        .where(models.InterviewTranscript.session_id == id)
    )
    transcript_data = tr_result.scalar() or []

    def _count_in_range(sec_st: float, sec_et: float) -> int:
        return sum(
            1 for s in transcript_data
            if sec_st - 1e-3 <= float(s.get("start_time") or 0) <= sec_et + 1e-3
        )

    return {
        "session_id": id,
        "section_count": len(sections),
        "sections": [
            {
                "id":            s.id,
                "section_index": s.section_index,
                "title":         s.title,
                "category":      s.category,
                "tag":           s.tag,
                "start_time":    s.start_time,
                "end_time":      s.end_time,
                "summary":       s.summary,
                "segment_count": _count_in_range(s.start_time, s.end_time),
                "advantages":    s.advantages or [],
                "shortcomings":  s.shortcomings or [],
                "review_points":  s.review_points or [],
                "optimization_advice": s.optimization_advice,
            }
            for s in sections
        ],
    }


@router.get("/timeline/{id}")
async def get_session_timeline(id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(models.InterviewRisk).where(models.InterviewRisk.session_id == id))
    risks = result.scalars().all()
    
    timeline = []
    for r in risks:
        timeline.append({
            "time": "08:42" if not r.occurrence_time else f"{int(r.occurrence_time//60):02d}:{int(r.occurrence_time%60):02d}",
            "type": "risk" if r.severity == "high" else "warning",
            "severity": r.severity,
            "title": r.title
        })
    return timeline


@router.get("/risks/{id}")
async def get_session_risks(id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(models.InterviewRisk).where(models.InterviewRisk.session_id == id))
    risks = result.scalars().all()
    return risks


@router.get("/improvements/{id}")
async def get_session_improvements(id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(models.AnswerImprovement).where(models.AnswerImprovement.session_id == id))
    improvements = result.scalars().all()
    
    return [
        {
            "question": "介绍一下你在架构升级中为什么选择 Redis？",
            "original_answer": imp.original_answer,
            "optimized_answer": imp.optimized_answer
        } for imp in improvements
    ]


@router.get("/quota/status")
async def quota_status(
    db: AsyncSession = Depends(get_db),
    current_user: Optional[models.User] = Depends(get_current_user_optional)
):
    """
    返回当前用户的各功能配额使用情况，用于前端显示"剩余次数 + 升级提示"。

    返回结构：
      {
        "membership": "free" | "test",
        "audio":   {"used": N, "max": N, "remaining": N},
        "record":  {"used": N, "max": N, "remaining": N},
        "resume":  {"used": N, "max": N, "remaining": N}
      }

    未登录用户：membership="free"，所有 used=0，remaining=max。
    """
    return await get_status(db, current_user)


@router.get("/sessions")
async def list_sessions(
    db: AsyncSession = Depends(get_db),
    current_user: Optional[models.User] = Depends(get_current_user_optional)
):
    if not current_user:
        return []
    result = await db.execute(
        select(models.InterviewSession)
        .where(models.InterviewSession.user_id == current_user.id)
        .order_by(models.InterviewSession.created_at.desc())
    )
    sessions = result.scalars().all()
    
    return [
        {
            "id": s.id,
            "audio_url": s.audio_url,
            "duration": s.duration,
            "status": s.status,
            "ipi_score": s.ipi_score,
            "offer_probability": s.offer_probability,
            "company": s.company or "",
            "role": s.role or "",
            "round": s.round or "",
            "date": s.date or "",
            "display_title": " · ".join(
                x for x in [s.company, s.role, s.round] if x
            ) or "未命名面试分析",
            "executive_summary": s.executive_summary or "",
            "created_at": s.created_at.isoformat() if s.created_at else None
        }
        for s in sessions
    ]


class OptimizeAdviceResponse(BaseModel):
    conclusion: str
    original: str
    optimized: str

@router.post("/section/{section_id}/optimize", response_model=OptimizeAdviceResponse)
async def optimize_section_advice(section_id: int, db: AsyncSession = Depends(get_db)):
    """
    获取某段的"优化建议"。

    P0 优化(#4): 主分析时会预生成所有 section 的 optimization_advice 缓存。
    此端点优先读缓存,缓存缺失或用户主动 ?force=1 时才实时生成。
    """
    force = False  # TODO: 通过 query param 暴露,目前保持向后兼容
    result = await db.execute(
        select(models.TranscriptSection).where(models.TranscriptSection.id == section_id)
    )
    section = result.scalars().first()
    if not section:
        raise HTTPException(status_code=404, detail="分段不存在")

    # ── 缓存命中:直接返回,不触发 LLM 调用 ──
    cached = section.optimization_advice
    if cached and not force:
        logger.info(
            f"[section/optimize] cache hit section_id={section_id} "
            f"keys={list(cached.keys()) if isinstance(cached, dict) else 'N/A'}"
        )
        return OptimizeAdviceResponse(
            conclusion=cached.get("conclusion", "暂无分析"),
            original=cached.get("original", "暂无"),
            optimized=cached.get("optimized", "暂无")
        )

    # ── 缓存未命中:实时生成 ──
    tr_result = await db.execute(
        select(models.InterviewTranscript.data)
        .where(models.InterviewTranscript.session_id == section.session_id)
    )
    transcript_data = tr_result.scalar() or []

    section_dialogue = [
        utt for utt in transcript_data
        if section.start_time - 1e-3 <= float(utt.get("start_time") or 0) <= section.end_time + 1e-3
    ]

    lines = []
    for utt in section_dialogue:
        role = "面试官" if utt.get("speaker") == "Interviewer" else "候选人"
        lines.append(f"{role}：{utt.get('content')}")
    dialogue_text = "\n".join(lines)

    if not dialogue_text.strip():
        dialogue_text = f"无此时间段对白记录。段落名：{section.title}"

    advice = await generate_section_optimization_advice(dialogue_text)

    section.optimization_advice = advice
    await db.commit()

    return OptimizeAdviceResponse(
        conclusion=advice.get("conclusion", "暂无分析"),
        original=advice.get("original", "暂无"),
        optimized=advice.get("optimized", "暂无")
    )


async def _prefetch_section_optimization(
    session_id: int,
    sections: List[Dict[str, Any]],
    raw_segments: List[Dict[str, Any]],
    task_id: str,
):
    """
    P0 优化(#4): 主分析完成后,fire-and-forget 预生成所有 section 的
    optimization_advice,并发 + 信号量限流。

    设计要点:
      - 不阻塞主流程:`run_real_analysis` 在 _set_progress(100) 之前启动此任务,
        完成后立即 return,用户在前端先看到"分析完成"
      - 信号量限流:DeepSeek 网关对 8+ 并发会 429,Semaphore(3) 是安全值
      - 失败隔离:单个 section 失败不影响其它 section
      - 缓存命中下次访问:optimize_section_advice 端点优先读 DB
    """
    if not sections or not raw_segments:
        return

    # 用普通 list 表示 section dialogue_text 缓存,避免重复切片
    sem = asyncio.Semaphore(3)

    async def _process_one(section_id: int, dialogue_text: str) -> None:
        async with sem:
            try:
                t0 = time.monotonic()
                advice = await generate_section_optimization_advice(dialogue_text)
                # 单独 DB session,失败不影响主流程
                async with async_session() as db:
                    sec_row = await db.get(models.TranscriptSection, section_id)
                    if sec_row:
                        sec_row.optimization_advice = advice
                        await db.commit()
                logger.info(
                    f"[task={task_id}] section_id={section_id} "
                    f"prefetch optimization in {time.monotonic() - t0:.2f}s"
                )
            except Exception as e:
                logger.warning(
                    f"[task={task_id}] section_id={section_id} "
                    f"prefetch optimization failed: {e}"
                )

    # 计算每个 section 的 dialogue_text(在主协程里做,避免并发任务再读 transcript)
    section_jobs: List[tuple[int, str]] = []
    async with async_session() as db:
        # 取所有 section 行,得到 id(用于后续回写)
        sec_result = await db.execute(
            select(models.TranscriptSection)
            .where(models.TranscriptSection.session_id == session_id)
            .order_by(models.TranscriptSection.section_index.asc())
        )
        sec_rows = sec_result.scalars().all()
        for idx, sec_row in enumerate(sec_rows):
            sec_def = sections[idx] if idx < len(sections) else None
            if not sec_def:
                continue
            # 切片该段对话
            st = float(sec_def.get("start_time", 0))
            et = float(sec_def.get("end_time", st))
            segs = [
                s for s in raw_segments
                if st - 1e-3 <= float(s.get("start_time") or 0) <= et + 1e-3
            ]
            lines = []
            for utt in segs:
                role = "面试官" if utt.get("speaker") == "Interviewer" else "候选人"
                lines.append(f"{role}：{utt.get('content')}")
            dialogue_text = "\n".join(lines) or f"无此时间段对白记录。段落名：{sec_def.get('title', '')}"
            section_jobs.append((sec_row.id, dialogue_text))

    if not section_jobs:
        return

    logger.info(
        f"[task={task_id}] prefetch section optimization: {len(section_jobs)} sections, "
        f"concurrency=3"
    )
    t0 = time.monotonic()
    await asyncio.gather(*[_process_one(sid, dt) for sid, dt in section_jobs])
    logger.info(
        f"[task={task_id}] ⏱️  prefetch all sections optimization done in "
        f"{time.monotonic() - t0:.2f}s"
    )


async def delete_session_audio_file(audio_url: str, db: AsyncSession):
    """
    Parses the audio_url to extract the cos_key, deletes the file from COS,
    and removes the matching row from UploadedFile in the DB.
    """
    import urllib.parse
    try:
        parsed = urllib.parse.urlparse(audio_url)
        path = parsed.path
        if path.startswith("/"):
            path = path[1:]
        cos_key = urllib.parse.unquote(path)

        if cos_key.startswith("uploads/"):
            from app.routers.file import get_cos_client, bucket
            # 1. Delete from COS S3 client
            try:
                client = get_cos_client()
                await asyncio.to_thread(
                    client.delete_object,
                    Bucket=bucket,
                    Key=cos_key,
                )
                logger.info(f"Successfully deleted COS object: {cos_key}")
            except Exception as e:
                logger.warning(f"Failed to delete COS object {cos_key}: {e}")

            # 2. Delete from database UploadedFile records
            uploaded_res = await db.execute(
                select(models.UploadedFile).where(models.UploadedFile.cos_key == cos_key)
            )
            db_file = uploaded_res.scalars().first()
            if db_file:
                await db.delete(db_file)
                logger.info(f"Successfully deleted UploadedFile record for cos_key: {cos_key}")
    except Exception as e:
        logger.warning(f"Error in delete_session_audio_file for {audio_url}: {e}")


@router.delete("/session/{id}")
async def delete_session(
    id: int,
    db: AsyncSession = Depends(get_db),
    current_user: Optional[models.User] = Depends(get_current_user_optional)
):
    """
    Delete a specific interview session, including its audio file in COS
    and all associated cascade database records.
    """
    result = await db.execute(
        select(models.InterviewSession).where(models.InterviewSession.id == id)
    )
    session = result.scalars().first()
    if not session:
        raise HTTPException(status_code=404, detail="面试会话不存在")
        
    # Permission check: If session has user_id, ensure current user matches.
    if session.user_id is not None:
        if not current_user or current_user.id != session.user_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="无权删除该会话记录"
            )
            
    # Clean up COS file and UploadedFile DB record
    await delete_session_audio_file(session.audio_url, db)
    
    # Delete session (cascade deletes all related tables: transcript, sections, risks, etc.)
    await db.delete(session)
    await db.commit()
    
    return {"message": "会话记录删除成功"}


class BatchDeleteRequest(BaseModel):
    session_ids: List[int]


@router.post("/sessions/batch-delete")
async def batch_delete_sessions(
    req: BatchDeleteRequest,
    db: AsyncSession = Depends(get_db),
    current_user: Optional[models.User] = Depends(get_current_user_optional)
):
    """
    Batch delete interview sessions, including their audio files in COS
    and all associated cascade database records.
    """
    if not req.session_ids:
        return {"message": "未指定删除的会话ID", "deleted_count": 0}
        
    result = await db.execute(
        select(models.InterviewSession).where(models.InterviewSession.id.in_(req.session_ids))
    )
    sessions = result.scalars().all()
    
    deleted_count = 0
    for session in sessions:
        # Permission check: If session has user_id, ensure current user matches.
        if session.user_id is not None:
            if not current_user or current_user.id != session.user_id:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="无权删除其中部分或全部会话记录"
                )
        
        # Clean up files
        await delete_session_audio_file(session.audio_url, db)
        
        # Delete session
        await db.delete(session)
        deleted_count += 1
        
    await db.commit()
    return {"message": f"成功删除 {deleted_count} 条会话记录", "deleted_count": deleted_count}

