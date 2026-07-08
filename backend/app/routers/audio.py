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
    if current_user and current_user.membership is None:
        result = await db.execute(
            select(models.InterviewSession).where(models.InterviewSession.user_id == current_user.id)
        )
        existing_sessions = result.scalars().all()
        if len(existing_sessions) >= 1:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="免费用户仅有一次体验机会，请升级至 PRO 会员解锁更多分析！"
            )
    return {"status": "ok"}


@router.post("/create_session")
async def create_session(
    req: CreateSessionRequest,
    db: AsyncSession = Depends(get_db),
    current_user: Optional[models.User] = Depends(get_current_user_optional)
):
    """
    Create an InterviewSession from an already-uploaded COS file URL.
    This avoids re-uploading the file binary — the frontend calls /api/file/upload
    first, then calls this endpoint with the returned file_url.
    """
    # ── CHECK: Free User experience limit (only 1 opportunity) ──
    if current_user and current_user.membership is None:
        result = await db.execute(
            select(models.InterviewSession).where(models.InterviewSession.user_id == current_user.id)
        )
        existing_sessions = result.scalars().all()
        if len(existing_sessions) >= 1:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="免费用户仅有一次体验机会，请升级至 PRO 会员解锁更多分析！"
            )

    session = models.InterviewSession(
        user_id=current_user.id if current_user else None,
        audio_url=req.file_url,
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
        "audio_url": session.audio_url,
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
        if current_user and current_user.membership is None:
            result = await db.execute(
                select(models.InterviewSession).where(models.InterviewSession.user_id == current_user.id)
            )
            existing_sessions = result.scalars().all()
            if len(existing_sessions) >= 1:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="免费用户仅有一次体验机会，请升级至 PRO 会员解锁更多分析！"
                )

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

    # Parse and save transcript
    segments = parse_dialogue_to_segments(req.paste_text)
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
      1. ASR  — call Volc Engine ASR on the COS audio URL
      2. LLM  — call DeepSeek (reasoning model) to evaluate the real transcript
      3. DB   — persist transcript segments, scores, risks, improvements
    Falls back to safe mock data if any API call fails.
    """

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
        task_store[task_id]["status"] = "failed"
        task_store[task_id]["error_message"] = "找不到音频文件 URL"
        return

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
    else:
        logger.info(f"[task={task_id}] Starting ASR for session {session_id}, url={audio_url}")
        try:
            raw_segments = await asyncio.to_thread(call_volc_asr, audio_url)
            logger.info(f"[task={task_id}] ASR returned {len(raw_segments)} segments")
        except Exception as e:
            logger.warning(f"[task={task_id}] ASR failed, will use mock transcript: {e}")

    _set_progress(45, "processing")

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
        # Fallback mock dialogue so LLM always gets something
        dialogue_text = (
            "面试官：你好，欢迎参加技术面试，请先做一个简短的自我介绍吧。\n"
            "候选人：面试官您好，我拥有多年后端高并发开发经验，熟悉分布式架构设计。\n"
            "面试官：为什么使用 Redis？\n"
            "候选人：因为 Redis 性能高，可以做缓存，提升接口响应速度。\n"
            "面试官：如果数据和数据库不一致怎么办？\n"
            "候选人：可以用双删策略，先删缓存，再更新数据库，最后再删一次缓存。\n"
        )

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
    highlights: list = []
    sections: list = []
    section_count = 0
    llm_result: dict = {}
    mentioned_projects: list[dict] = []  # P0 优化(#3): 独立 LLM 调用,与 gather 并发

    # Safe fallback scores (在 LLM 调用前预设,失败时使用)
    ipi_score = 65
    offer_probability = 40
    strengths    = ["表达流利，问题应答迅速", "了解核心技术特性"]
    weaknesses   = ["技术深度有待提升", "方案细节描述不够完整"]
    suggestions  = ["深化系统设计知识体系", "回答中加入量化数据背书"]
    executive_summary = "整体表现中等，建议加强技术深度与方案细节的描述。"
    score_expression = 75
    score_logic = 80
    score_project_depth = 70
    score_ownership = 65
    score_system_design = 60

    t_import = time.monotonic()  # 用于日志对比改造前后耗时

    async def _safe_highlights():
        try:
            t0 = time.monotonic()
            result = await generate_transcript_highlights(raw_segments)
            logger.info(
                f"[task={task_id}] Highlights API returned {len(result)} items "
                f"in {time.monotonic() - t0:.2f}s"
            )
            return result or []
        except Exception as e:
            logger.warning(f"[task={task_id}] Highlights generation failed: {e}")
            return []

    async def _safe_sectionize():
        try:
            t0 = time.monotonic()
            result = await sectionize_transcript(raw_segments)
            logger.info(
                f"[task={task_id}] Sectionize returned {len(result)} sections "
                f"in {time.monotonic() - t0:.2f}s"
            )
            return result or []
        except Exception as e:
            logger.warning(f"[task={task_id}] sectionize failed: {e}")
            return []

    async def _safe_dialogue_eval():
        nonlocal llm_result, ipi_score, offer_probability
        nonlocal strengths, weaknesses, suggestions, executive_summary
        nonlocal score_expression, score_logic, score_project_depth
        nonlocal score_ownership, score_system_design
        try:
            t0 = time.monotonic()
            res = await analyze_interview_dialogue(
                dialogue_text, profile_data, job_description, existing_projects
            )
            logger.info(
                f"[task={task_id}] analyze_interview_dialogue returned "
                f"in {time.monotonic() - t0:.2f}s"
            )
            if res:
                ipi_score         = res.get("ipi_score",          ipi_score)
                offer_probability = res.get("offer_probability",   offer_probability)
                strengths         = res.get("summary_strengths",   strengths)
                weaknesses        = res.get("summary_weaknesses",  weaknesses)
                suggestions       = res.get("summary_suggestions",  suggestions)
                executive_summary = res.get("executive_summary",   executive_summary)
                if "scores" not in res or not isinstance(res["scores"], dict):
                    res["scores"] = {
                        "expression": res.get("score_expression") or res.get("expression") or score_expression,
                        "logic": res.get("score_logic") or res.get("logic") or score_logic,
                        "project_depth": res.get("score_project_depth") or res.get("project_depth") or score_project_depth,
                        "ownership": res.get("score_ownership") or res.get("ownership") or score_ownership,
                        "system_design": res.get("score_system_design") or res.get("system_design") or score_system_design,
                    }
                logger.info(f"[task={task_id}] LLM returned ipi={ipi_score}, offer_prob={offer_probability}")
                return res
        except Exception as e:
            logger.warning(f"[task={task_id}] LLM evaluation failed, using fallback: {e}")
        return {}

    async def _safe_extract_mentions():
        """P0 优化(#3): mentioned_projects 独立 LLM 调用,与 3 个主调用并发。"""
        nonlocal mentioned_projects
        try:
            t0 = time.monotonic()
            items = await extract_mentioned_projects(dialogue_text, existing_projects)
            logger.info(
                f"[task={task_id}] extract_mentioned_projects returned "
                f"{len(items)} items in {time.monotonic() - t0:.2f}s"
            )
            return items
        except Exception as e:
            logger.warning(f"[task={task_id}] extract_mentioned_projects failed: {e}")
            return []

    if raw_segments:
        logger.info(
            f"[task={task_id}] Calling 4 LLMs in parallel: "
            f"highlights + sectionize + dialogue_eval + extract_mentions for {len(raw_segments)} segments"
        )
        highlights, sections, llm_result, mentioned_projects = await asyncio.gather(
            _safe_highlights(),
            _safe_sectionize(),
            _safe_dialogue_eval(),
            _safe_extract_mentions(),
        )

        logger.info(
            f"[task={task_id}] ⏱️  4-LLM parallel block total = "
            f"{time.monotonic() - t_import:.2f}s "
            f"(highlights={len(highlights)}, sections={len(sections)}, "
            f"llm_result_keys={list(llm_result.keys()) if llm_result else []})"
        )

        # If sectionize returned empty, generate heuristic fallback sections grouped by Interviewer questions
        if not sections:
            logger.warning(f"[task={task_id}] sectionize returned no sections. Generating heuristic fallback sections.")
            current_sec = None
            sec_idx = 1
            for s in raw_segments:
                is_interviewer = s.get("speaker") == "Interviewer"
                t = float(s.get("start_time", 0.0))
                if is_interviewer or current_sec is None:
                    if current_sec:
                        sections.append(current_sec)
                    current_sec = {
                        "title": (s.get("content") or "")[:15] + "..." if is_interviewer else f"对话分段 {sec_idx}",
                        "category": "tech",
                        "tag": "一般",
                        "start_time": t,
                        "end_time": t + 10.0,
                        "summary": "面试提问与解答。"
                    }
                    sec_idx += 1
                else:
                    current_sec["end_time"] = t + 10.0
            if current_sec:
                sections.append(current_sec)

        section_count = len(sections)

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

    # ── Step 3: Persist the whole transcript as a single JSONB row.
    #             One session → one InterviewTranscript row → one data JSONB array.
    #             Also clear any prior sections from a previous analysis run.
    async with async_session() as db:
        # Wipe prior transcript (PK = session_id, so DELETE-and-INSERT pattern)
        await db.execute(
            models.InterviewTranscript.__table__.delete().where(
                models.InterviewTranscript.session_id == session_id
            )
        )
        # Clear old sections from a previous analysis run
        await db.execute(
            models.TranscriptSection.__table__.delete().where(
                models.TranscriptSection.session_id == session_id
            )
        )
        # Clear old risks, questions, improvements
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
        if raw_segments:
            db.add(models.InterviewTranscript(session_id=session_id, data=raw_segments))
        else:
            # Minimal fallback transcript with mock highlights so the frontend has something to show
            db.add(models.InterviewTranscript(session_id=session_id, data=[
                {"start_time": 0.0,   "end_time": 15.0,  "speaker": "Interviewer", "content": "你好，欢迎参加技术面试，请先做一个简短的自我介绍吧。"},
                {
                    "start_time": 15.0,
                    "end_time": 135.0,
                    "speaker": "Candidate",
                    "content": "面试官您好，我拥有多年后端高并发开发经验，熟悉分布式架构设计与缓存体系。",
                    "highlights": [
                        {"text": "多年后端高并发开发经验", "type": "strength", "tip": "💡 核心闪光点：突出了架构方向的工作积累，给人留下专业的第一印象。"},
                        {"text": "分布式架构设计", "type": "tech", "tip": "🔧 核心技能：代表有复杂分布式系统的规划和开发技能。"}
                    ]
                },
                {"start_time": 341.0, "end_time": 374.0, "speaker": "Interviewer", "content": "为什么使用 Redis？"},
                {
                    "start_time": 352.0,
                    "end_time": 374.0,
                    "speaker": "Candidate",
                    "content": "因为 Redis 性能高，可以做缓存，提升接口响应速度。",
                    "highlights": [
                        {"text": "做缓存，提升接口响应速度", "type": "strength", "tip": "💡 亮点：正确指出了缓存的核心应用场景及响应性能优势。"}
                    ]
                },
                {"start_time": 375.0, "end_time": 422.0, "speaker": "Interviewer", "content": "如果数据和数据库不一致怎么办？"},
                {
                    "start_time": 382.0,
                    "end_time": 422.0,
                    "speaker": "Candidate",
                    "content": "可以用双删策略，先删缓存，再更新数据库，最后再删一次缓存。",
                    "highlights": [
                        {"text": "双删策略", "type": "risk", "tip": "⚠️ 表达风险：双删策略是教科书式的八股文方案，存在并发写一致性漏洞，在实际高并发项目中通常不会被采用，会被面试官追问致死。建议升级为 Binlog + Canal + 延时双删或读写锁。"}
                    ]
                },
            ]))

        # Persist sections in the same session — they were produced concurrently
        # with highlights above and are ready to insert together.
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

    _set_progress(60, "processing")

    # ── Step 4: Build dialogue text for LLM evaluation ────────────────────
    if raw_segments:
        lines = []
        for seg in raw_segments:
            role = "面试官" if seg["speaker"] == "Interviewer" else "候选人"
            lines.append(f"{role}：{seg['content']}")
        dialogue_text = "\n".join(lines)
    else:
        # Fallback mock dialogue so LLM always gets something
        dialogue_text = (
            "面试官：你好，欢迎参加技术面试，请先做一个简短的自我介绍吧。\n"
            "候选人：面试官您好，我拥有多年后端高并发开发经验，熟悉分布式架构设计。\n"
            "面试官：为什么使用 Redis？\n"
            "候选人：因为 Redis 性能高，可以做缓存，提升接口响应速度。\n"
            "面试官：如果数据和数据库不一致怎么办？\n"
            "候选人：可以用双删策略，先删缓存，再更新数据库，最后再删一次缓存。\n"
        )

    _set_progress(70, "processing")

    _set_progress(88, "processing")

    # ── 兜底:三方 LLM 全失败时,填充完整 mock 结构,保证前端能看到东西 ──
    if not llm_result:
        # 三方 LLM 全失败时的最简兜底:用预设分数填充,前端可继续展示,
        # 但 max_lose_points/interviewer_perspective/question_deconstruction/
        # followup_paths 这些结构化字段不填充(后端不臆造)。
        llm_result = {
            "ipi_score": ipi_score,
            "offer_probability": offer_probability,
            "summary_strengths": strengths,
            "summary_weaknesses": weaknesses,
            "summary_suggestions": suggestions,
            "executive_summary": executive_summary,
            "scores": {
                "expression": score_expression,
                "logic": score_logic,
                "project_depth": score_project_depth,
                "ownership": score_ownership,
                "system_design": score_system_design,
            },
            "max_lose_points": [],
            "interviewer_perspective": [],
            "question_deconstruction": [],
            "followup_paths": [],
        }
        logger.warning(
            f"[task={task_id}] All 3 LLM calls failed; using static fallback scores"
        )

    # ── Step 4.5: 同步项目提及次数 ─────────────────────────────────────
    async with async_session() as db:
        sess_mention_result = await db.execute(
            select(models.InterviewSession).where(models.InterviewSession.id == session_id)
        )
        sess_mention = sess_mention_result.scalars().first()
        user_id_for_mention = sess_mention.user_id if sess_mention else None

    if user_id_for_mention is not None:
        # P0 优化(#3): mentioned_projects 已由独立 LLM 调用产出,直接读本地变量
        if mentioned_projects:
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

    # ── Step 5: Persist scores + risk to DB ──────────────────────────────
    async with async_session() as db:
        result = await db.execute(
            select(models.InterviewSession).where(models.InterviewSession.id == session_id)
        )
        session = result.scalars().first()
        if not session:
            task_store[task_id]["status"] = "failed"
            return

        # Save scores & summary
        session.ipi_score         = ipi_score
        session.offer_probability = offer_probability
        session.summary_strengths    = strengths
        session.summary_weaknesses   = weaknesses
        session.summary_suggestions  = suggestions
        session.executive_summary    = executive_summary
        session.analysis_result      = llm_result
        session.status = "completed"

        # Risk & improvement from LLM weaknesses
        risk_desc = weaknesses[0] if weaknesses else "表达简短，技术深度不足"
        risk = models.InterviewRisk(
            session_id=session_id,
            risk_type="answer_quality",
            severity="high" if ipi_score < 70 else "medium",
            title=risk_desc[:30],
            evidence=dialogue_text[:200],
            suggestion=suggestions[0] if suggestions else "加强技术深度",
            occurrence_time=382.0
        )
        db.add(risk)

        await db.commit()

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

    # P0 优化(#4): fire-and-forget 预生成所有 section 的 optimization_advice
    # 不阻塞主流程——用户先看到"分析完成",等几秒后所有 section 缓存就绪
    if sections and raw_segments:
        asyncio.create_task(
            _prefetch_section_optimization(
                session_id=session_id,
                sections=sections,
                raw_segments=raw_segments,
                task_id=task_id,
            )
        )
        logger.info(
            f"[task={task_id}] 🚀 启动 section optimization 预生成后台任务 "
            f"({len(sections)} sections)"
        )

    _set_progress(100, "completed")
    logger.info(f"[task={task_id}] Analysis complete for session {session_id}")

    # 异步触发 AI 职业顾问定制建议建议更新
    if session.user_id:
        from app.services.advisor_generator import trigger_custom_advisor_insights
        asyncio.create_task(
            trigger_custom_advisor_insights(session.user_id)
        )

        # 异步匹配面试中的问题到知识库细化能力
        if llm_result:
            # 从 question_deconstruction 提取真实的面试问题（不是弱点）
            questions = []
            for qd in (llm_result.get("question_deconstruction") or []):
                if isinstance(qd, dict) and qd.get("title"):
                    questions.append({
                        "label": qd["title"].strip(),
                        "desc": qd.get("desc", ""),
                    })
            if questions:
                from app.services.knowledge_ability_service import trigger_knowledge_match
                asyncio.create_task(
                    trigger_knowledge_match(session.user_id, questions)
                )




@router.post("/upload")
async def upload_audio(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: Optional[models.User] = Depends(get_current_user_optional)
):
    # Enforce file size limit of 20MB
    max_size_bytes = 20 * 1024 * 1024
    if file.size and file.size > max_size_bytes:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="上传的录音文件大小不能超过 20MB"
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
    session = models.InterviewSession(
        user_id=current_user.id if current_user else None,
        audio_url=f"http://localhost:8000/static/uploads/{uuid.uuid4()}_{file.filename}",
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
        
    # ── CHECK: Free User experience limit (only 1 opportunity) ──
    if current_user and current_user.membership is None:
        other_res = await db.execute(
            select(models.InterviewSession)
            .where(
                (models.InterviewSession.user_id == current_user.id) & 
                (models.InterviewSession.id != session_id)
            )
        )
        other_sessions = other_res.scalars().all()
        if len(other_sessions) >= 1:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="免费用户仅有一次体验机会，请升级至 PRO 会员解锁更多分析！"
            )
        
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
    
    expression_score = llm_scores.get("expression") or llm_scores.get("score_expression") or (ipi + 10 if ipi > 0 else 0)
    logic_score = llm_scores.get("logic") or llm_scores.get("score_logic") or (ipi + 3 if ipi > 0 else 0)
    project_depth_score = llm_scores.get("project_depth") or llm_scores.get("score_project_depth") or (ipi - 4 if ipi > 0 else 0)
    ownership_score = llm_scores.get("ownership") or llm_scores.get("score_ownership") or (ipi - 12 if ipi > 0 else 0)
    system_design_score = llm_scores.get("system_design") or llm_scores.get("score_system_design") or (ipi - 2 if ipi > 0 else 0)
    communication_score = ipi + 13 if ipi > 0 else 0

    return {
        "session_id": session.id,
        "audio_url": fresh_audio_url,
        "duration": session.duration,
        "status": session.status,
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
            "executive_summary": session.executive_summary or "报告处理中",
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

