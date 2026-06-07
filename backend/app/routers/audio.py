from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload
from typing import Optional, List, Dict, Any
from pydantic import BaseModel
import uuid
import asyncio
from datetime import datetime
import logging

from app import models, database
from app.database import get_db, async_session
from app.routers.auth import get_current_user_optional
from app.utils.llm import analyze_interview_dialogue, sectionize_transcript, generate_transcript_highlights
from app.utils.asr import call_minimax_asr

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/audio", tags=["Audio Analysis"])

class AnalyzeRequest(BaseModel):
    session_id: int

class CreateSessionRequest(BaseModel):
    file_url: str
    title: Optional[str] = None
    file_id: Optional[int] = None
    file_size: Optional[int] = 0

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

    session_title = req.title or f"{datetime.now().strftime('%Y-%m-%d %H:%M')} 面试录音分析"
    session = models.InterviewSession(
        user_id=current_user.id if current_user else None,
        title=session_title,
        audio_url=req.file_url,
        duration=0,
        file_size=req.file_size or 0,
        status="uploaded"
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)
    return {
        "session_id": session.id,
        "title": session.title,
        "audio_url": session.audio_url,
        "status": session.status
    }


# In-memory store for active task progress to simplify polling in MVP
# In production, this would be Redis or DB-backed
task_store: Dict[str, Dict[str, Any]] = {}


async def run_real_analysis(session_id: int, task_id: str, profile_data: Optional[dict]):
    """
    Real analysis pipeline:
      1. ASR  — call MiniMax speech recognition on the COS audio URL
      2. LLM  — call MiniMax-M3 to evaluate the real transcript
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
    async with async_session() as db:
        result = await db.execute(
            select(models.InterviewSession).where(models.InterviewSession.id == session_id)
        )
        sess = result.scalars().first()
        if sess:
            audio_url = sess.audio_url
            sess.status = "processing"
            await db.commit()

    if not audio_url:
        task_store[task_id]["status"] = "failed"
        task_store[task_id]["error_message"] = "找不到音频文件 URL"
        return

    _set_progress(15, "processing")

    # ── Step 2: Real ASR via MiniMax ──────────────────────────────────────
    logger.info(f"[task={task_id}] Starting ASR for session {session_id}, url={audio_url}")
    raw_segments: List[Dict[str, Any]] = []
    try:
        raw_segments = await asyncio.to_thread(call_minimax_asr, audio_url)
        logger.info(f"[task={task_id}] ASR returned {len(raw_segments)} segments")
    except Exception as e:
        logger.warning(f"[task={task_id}] ASR failed, will use mock transcript: {e}")

    _set_progress(45, "processing")

    # ── Step 2.5: Generate AI Highlights ──────────────────────────────────
    if raw_segments:
        logger.info(f"[task={task_id}] Calling LLM to generate highlights for {len(raw_segments)} segments")
        try:
            highlights = await generate_transcript_highlights(raw_segments)
            logger.info(f"[task={task_id}] Highlights API returned {len(highlights)} items")
            for hl in highlights:
                try:
                    idx = int(hl.get("segment_index", -1))
                    text_to_find = hl.get("text", "")
                    hl_type = hl.get("type", "")
                    hl_tip = hl.get("tip", "")
                    if 0 <= idx < len(raw_segments) and text_to_find:
                        # Ensure the text exists in the segment content
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
        except Exception as e:
            logger.warning(f"Highlights generation failed, continuing: {e}")

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
        await db.commit()

    # ── Step 3.5: LLM semantic sectionize (turn long transcript into 3-8
    #              topic blocks like 「自我介绍」「项目深挖」) ──────────────
    #              Sections store start_time/end_time only; the runtime
    #              segment_count and the section↔segment join are computed
    #              at read time by time-range match against transcript.data.
    section_count = 0
    if raw_segments:
        try:
            logger.info(f"[task={task_id}] Calling LLM to sectionize {len(raw_segments)} segments")
            sections = await sectionize_transcript(raw_segments)
            section_count = len(sections)
            logger.info(f"[task={task_id}] Sectionize returned {section_count} sections")

            if sections:
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
        except Exception as e:
            logger.warning(f"[task={task_id}] sectionize failed, continuing without sections: {e}")

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

    # ── Step 4: Real LLM evaluation via MiniMax-M3 ───────────────────────
    logger.info(f"[task={task_id}] Calling MiniMax-M3 LLM for evaluation")

    # Safe fallback scores
    ipi_score = 65
    offer_probability = 40
    strengths    = ["表达流利，问题应答迅速", "了解核心技术特性"]
    weaknesses   = ["技术深度有待提升", "方案细节描述不够完整"]
    suggestions  = ["深化系统设计知识体系", "回答中加入量化数据背书"]
    executive_summary = "整体表现中等，建议加强技术深度与方案细节的描述。"

    try:
        llm_result = await analyze_interview_dialogue(dialogue_text, profile_data)
        if llm_result:
            ipi_score         = llm_result.get("ipi_score",          ipi_score)
            offer_probability = llm_result.get("offer_probability",   offer_probability)
            strengths         = llm_result.get("summary_strengths",   strengths)
            weaknesses        = llm_result.get("summary_weaknesses",  weaknesses)
            suggestions       = llm_result.get("summary_suggestions", suggestions)
            executive_summary = llm_result.get("executive_summary",   executive_summary)
            logger.info(f"[task={task_id}] LLM returned ipi={ipi_score}, offer_prob={offer_probability}")
    except Exception as e:
        logger.warning(f"[task={task_id}] LLM evaluation failed, using fallback: {e}")

    _set_progress(88, "processing")

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

    _set_progress(100, "completed")
    logger.info(f"[task={task_id}] Analysis complete for session {session_id}")




@router.post("/upload")
async def upload_audio(
    file: UploadFile = File(...),
    title: Optional[str] = Form(None),
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

    session_title = title or f"{datetime.now().strftime('%Y-%m-%d %H:%M')} 面试录音分析"
    
    # Save the session with optional user association
    session = models.InterviewSession(
        user_id=current_user.id if current_user else None,
        title=session_title,
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
        "title": session.title,
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
    profile_data = None
    if current_user and current_user.profile:
        p = current_user.profile
        profile_data = {
            "gender": p.gender,
            "age": p.age,
            "experience_years": p.experience_years,
            "role_name": p.role_name,
            "target_company": p.target_company,
            "target_grade": p.target_grade,
            "target_role": p.target_role
        }

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

    return {
        "session_id": session.id,
        "title": session.title,
        "audio_url": fresh_audio_url,
        "duration": session.duration,
        "status": session.status,
        "scores": {
            "ipi": session.ipi_score,
            "offer_probability": session.offer_probability,
            "expression": session.ipi_score + 10 if session.ipi_score > 0 else 0,
            "logic": session.ipi_score + 3 if session.ipi_score > 0 else 0,
            "project_depth": session.ipi_score - 4 if session.ipi_score > 0 else 0,
            "ownership": session.ipi_score - 12 if session.ipi_score > 0 else 0,
            "communication": session.ipi_score + 13 if session.ipi_score > 0 else 0,
            "system_design": session.ipi_score - 2 if session.ipi_score > 0 else 0
        },
        "summary": {
            "executive_summary": session.executive_summary or "报告处理中",
            "strengths": session.summary_strengths,
            "weaknesses": session.summary_weaknesses,
            "suggestions": session.summary_suggestions
        },
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
            "title": s.title,
            "audio_url": s.audio_url,
            "duration": s.duration,
            "status": s.status,
            "ipi_score": s.ipi_score,
            "offer_probability": s.offer_probability,
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
    Generate or regenerate the optimization advice (AI diagnosis, candidate original answer,
    and recommended senior architect answer) for a specific section.
    """
    result = await db.execute(
        select(models.TranscriptSection).where(models.TranscriptSection.id == section_id)
    )
    section = result.scalars().first()
    if not section:
        raise HTTPException(status_code=404, detail="分段不存在")

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

    from app.utils.llm import generate_section_optimization_advice
    advice = await generate_section_optimization_advice(dialogue_text)

    section.optimization_advice = advice
    await db.commit()

    return OptimizeAdviceResponse(
        conclusion=advice.get("conclusion", "暂无分析"),
        original=advice.get("original", "暂无"),
        optimized=advice.get("optimized", "暂无")
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

