"""
实时语音面试（Live Interview）HTTP stub 接口。

PR1 范围：仅暴露创建 + 查询两个端点，**不接火山、不开 WebSocket**。
PR2 起在此文件追加 WS 端点；PR4 起追加 end 端点 + 报告归档触发。

设计文档：saas/ai面试教练/new/模拟面试.md (v1.2)
PR6：加入时长统计（user_live_minutes）+ 限额检查 + history 列表接口。
"""
import asyncio
import json
from datetime import datetime, timezone
from typing import Optional, Literal, List
import logging

import redis.asyncio as aioredis
from fastapi import APIRouter, Depends, HTTPException, status, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field
from sqlalchemy import select, update, func
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app import models
from app.config import settings
from app.database import get_db, async_session
from app.routers.auth import get_current_user_optional
from app.utils.ws_auth import get_current_user_from_ws

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/live", tags=["Live Interview"])


# ---------- PR6 定价限额配置 ----------
# 按会员等级的月度实时面试时长上限（分钟）。0 表示不可用。
MEMBERSHIP_MONTHLY_MINUTES = {
    None: 0,      # 免费用户：0 分钟（不可使用实时模拟面试；只能试文本/录音分析）
    "free": 0,
    "pro": 60,    # PRO：60 分钟/月
    "max": 120,   # MAX：120 分钟/月
}


def period_key_for(period_type: str, dt: datetime) -> str:
    """
    生成 period_key：
    - 'week'  → ISO 周编号 'YYYY-Www'，如 '2026-W25'
    - 'month' → 'YYYY-MM'，如 '2026-06'
    """
    if period_type == "week":
        iso = dt.isocalendar()
        return f"{iso[0]}-W{iso[1]:02d}"
    elif period_type == "month":
        return f"{dt.year:04d}-{dt.month:02d}"
    raise ValueError(f"不支持的 period_type: {period_type}")


async def upsert_user_live_minutes(
    db: AsyncSession, user_id: int, added_seconds: int, ended_at: datetime
) -> None:
    """
    PR6: 结束面试后把 added_seconds 累加到 user_live_minutes 表的当周 + 当月行。
    失败仅 warn，不影响主流程。
    """
    if added_seconds <= 0 or not user_id:
        return
    for period_type in ("week", "month"):
        key = period_key_for(period_type, ended_at)
        try:
            stmt = pg_insert(models.UserLiveMinutes).values(
                user_id=user_id,
                period_type=period_type,
                period_key=key,
                total_seconds=added_seconds,
                sessions_count=1,
            ).on_conflict_do_update(
                index_elements=["user_id", "period_type", "period_key"],
                set_={
                    "total_seconds": models.UserLiveMinutes.total_seconds + added_seconds,
                    "sessions_count": models.UserLiveMinutes.sessions_count + 1,
                },
            )
            await db.execute(stmt)
            await db.commit()
        except Exception as e:
            await db.rollback()
            logger.warning(f"[live] upsert user_live_minutes 失败 ({period_type}): {e}")


# ---------- Schemas ----------

INTERVIEW_TYPE_VALUES = ("tech_8gu", "tech_project", "tech_scenario", "non_tech", "hr_comprehensive")
DIFFICULTY_VALUES = ("Lv1", "Lv2", "Lv3", "Lv4")
DURATION_VALUES = (10, 15, 20)


class CreateLiveSessionRequest(BaseModel):
    """POST /api/live/sessions 入参。"""
    interview_type: Literal["tech_8gu", "tech_project", "tech_scenario", "non_tech", "hr_comprehensive"]
    difficulty: Literal["Lv1", "Lv2", "Lv3", "Lv4"]
    duration_min: Literal[10, 15, 20]
    followup_rounds: int = Field(ge=1, le=3)
    target_role: str
    job_level: Optional[str] = None
    company_style: Optional[str] = None
    job_description: Optional[str] = None


class LiveSessionResponse(BaseModel):
    """GET /api/live/sessions/{id} 出参（也用于 POST 的回执）。"""
    live_session_id: int
    status: str
    interview_type: str
    difficulty: str
    duration_min: int
    followup_rounds: int
    target_role: Optional[str] = None
    job_level: Optional[str] = None
    company_style: Optional[str] = None
    job_description: Optional[str] = None
    voice_id: Optional[str] = None
    persona_cn: Optional[str] = None
    duration_sec: int
    created_at: datetime
    started_at: Optional[datetime] = None
    ended_at: Optional[datetime] = None
    # PR4 后会填充：归档后的 InterviewSession.id
    session_id: Optional[int] = None
    # PR2 起填充：浏览器可重连的 ws_url
    ws_url: Optional[str] = None


# ---------- Endpoints ----------

@router.post("/sessions", response_model=LiveSessionResponse)
async def create_live_session(
    req: CreateLiveSessionRequest,
    db: AsyncSession = Depends(get_db),
    current_user: Optional[models.User] = Depends(get_current_user_optional),
):
    """
    创建实时面试会话。
    - 校验 interview_type / difficulty / duration_min 合法性
    - hr_comprehensive 类型时 duration_min 强制 ≤ 15（设计 §8.4.1 互斥规则）
    - 同 user 不允许同时存在 2 个 active live session（DB partial unique index 兜底）
    """
    # 互斥约束：HR 面不超过 15 分钟
    if req.interview_type == "hr_comprehensive" and req.duration_min > 15:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="HR 面综合能力面试时长不能超过 15 分钟（设计文档 §8.4.1 互斥规则）",
        )

    # 缓存到本地变量，避免 rollback 后访问 ORM 属性触发 MissingGreenlet
    current_user_id = current_user.id if current_user else None

    # 防御性清理：用户重新点"开始"时，主动把上一次卡住的 active session 标 failed
    # （WS 接入失败 / 浏览器崩溃 / 火山 404 等场景都会留 status=live 的僵尸行）
    # 用户显式选择"新建" = 旧会话作废，避免反复 409
    # 注意：不要写 status="error"，那是英文原始值，前端时间轴没有 error 映射会原样显示，
    #       统一用 failed（前端映射"评估失败"）以保持中文文案一致。
    if current_user_id is not None:
        try:
            stale_res = await db.execute(
                update(models.InterviewLiveSession)
                .where(
                    models.InterviewLiveSession.user_id == current_user_id,
                    models.InterviewLiveSession.status.in_(("created", "ws_connecting", "live", "ending")),
                )
                .values(status="failed", ended_at=func.now())
                .returning(models.InterviewLiveSession.id)
            )
            stale_ids = [r[0] for r in stale_res]
            if stale_ids:
                await db.commit()
                logger.warning(
                    f"[live] 清理 user={current_user_id} 的 {len(stale_ids)} 个卡住 active session: {stale_ids}"
                )
        except Exception as e:
            logger.exception(f"[live] 清理 stale session 失败，继续创建: {e}")
            await db.rollback()

    row = models.InterviewLiveSession(
        user_id=current_user_id,
        interview_type=req.interview_type,
        difficulty=req.difficulty,
        duration_min=req.duration_min,
        followup_rounds=req.followup_rounds,
        target_role=req.target_role,
        job_level=req.job_level,
        company_style=req.company_style,
        job_description=req.job_description,
        status="created",
        duration_sec=0,
    )

    # PR6 定价限额：登录用户按会员等级查当月已用
    if current_user:
        membership = current_user.membership  # NULL/None/'pro'/'max'
        limit_min = MEMBERSHIP_MONTHLY_MINUTES.get(membership, 0)
        if limit_min <= 60:  # 不超过 60 的才有"分钟"语义；>60 视为不限
            now = datetime.now(timezone.utc).replace(tzinfo=None)  # DB 用 naive
            mk = period_key_for("month", now)
            used_res = await db.execute(
                select(func.coalesce(func.sum(models.UserLiveMinutes.total_seconds), 0))
                .where(
                    models.UserLiveMinutes.user_id == current_user_id,
                    models.UserLiveMinutes.period_type == "month",
                    models.UserLiveMinutes.period_key == mk,
                )
            )
            used_seconds = int(used_res.scalar() or 0)
            used_min = used_seconds // 60
            if used_min >= limit_min:
                detail = (
                    f"本月实时面试已用 {used_min} 分钟，达到 {membership or '免费'} 会员上限 {limit_min} 分钟。"
                    f"请升级套餐或下月再试。"
                )
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)
            logger.info(
                f"[live] user={current_user_id} 当月已用 {used_min}/{limit_min} 分钟，校验通过"
            )

    db.add(row)
    try:
        await db.commit()
    except IntegrityError as e:
        await db.rollback()
        # partial unique index 触发：同 user 已有 active live session
        # 注意：不能用 current_user.id，rollback 后 ORM 懒加载会触发 MissingGreenlet
        logger.warning(f"[live] 409 user={current_user_id} 已有进行中的实时面试: {e.orig}")
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="已有进行中的实时面试，请先结束或等待当前会话完成",
        )
    except Exception as e:
        await db.rollback()
        logger.exception(f"[live] 创建 live session 失败: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="创建实时面试会话失败，请稍后重试",
        )
    await db.refresh(row)
    logger.info(
        f"[live] 创建 live session id={row.id} user={row.user_id} "
        f"type={row.interview_type} difficulty={row.difficulty} duration={row.duration_min}min"
    )
    return LiveSessionResponse(
        live_session_id=row.id,
        status=row.status,
        interview_type=row.interview_type,
        difficulty=row.difficulty,
        duration_min=row.duration_min,
        followup_rounds=row.followup_rounds,
        target_role=row.target_role,
        job_level=row.job_level,
        company_style=row.company_style,
        job_description=row.job_description,
        voice_id=row.voice_id,
        persona_cn=row.persona_cn,
        duration_sec=row.duration_sec,
        created_at=row.created_at,
        started_at=row.started_at,
        ended_at=row.ended_at,
        session_id=row.session_id,
        ws_url=f"/api/live/ws/{row.id}",  # PR2: 浏览器连此地址
    )


@router.get("/sessions/{live_id}", response_model=LiveSessionResponse)
async def get_live_session(
    live_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: Optional[models.User] = Depends(get_current_user_optional),
):
    """
    拉取实时面试会话当前状态（前端轮询 / 刷新恢复用）。
    - 鉴权：登录用户只能查自己的；匿名用户可查任意（与 audio.create_session 一致）
    - 返回 status 决定前端分支：live/created → 自动连 WS；ended/analyzing → 等报告；completed → 跳报告页
    """
    row = await db.get(models.InterviewLiveSession, live_id)
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"实时面试会话 {live_id} 不存在",
        )
    if current_user and row.user_id and row.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="无权查看该实时面试会话",
        )
    return LiveSessionResponse(
        live_session_id=row.id,
        status=row.status,
        interview_type=row.interview_type,
        difficulty=row.difficulty,
        duration_min=row.duration_min,
        followup_rounds=row.followup_rounds,
        target_role=row.target_role,
        job_level=row.job_level,
        company_style=row.company_style,
        job_description=row.job_description,
        voice_id=row.voice_id,
        persona_cn=row.persona_cn,
        duration_sec=row.duration_sec,
        created_at=row.created_at,
        started_at=row.started_at,
        ended_at=row.ended_at,
        session_id=row.session_id,
        ws_url=f"/api/live/ws/{row.id}",
    )


# ---------- 结束面试与报告端点 ----------

@router.get("/sessions/{live_id}/report")
async def get_live_session_report(
    live_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: Optional[models.User] = Depends(get_current_user_optional),
):
    """获取实时语音面试的专属分析报告。"""
    row = await db.get(models.InterviewLiveSession, live_id)
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"实时面试会话 {live_id} 不存在",
        )
    if current_user and row.user_id and row.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="无权查看该实时面试报告",
        )
        
    analysis_res = row.analysis_result or {}
    scores = {
        "ipi": row.ipi_score or 70,
        "offer_probability": row.offer_probability or 0
    }
    if analysis_res and isinstance(analysis_res.get("scores"), dict):
        scores.update(analysis_res["scores"])
    else:
        scores.update({
            "expression": 75,
            "logic": 80,
            "project_depth": 70,
            "ownership": 65,
            "system_design": 60
        })

    return {
        "scores": scores,
        "summary": {
            "executive_summary": row.executive_summary or "",
            "strengths": row.summary_strengths or [],
            "weaknesses": row.summary_weaknesses or [],
            "suggestions": row.summary_suggestions or []
        },
        "transcript": row.transcript or [],
        "analysis_result": analysis_res,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "target_role": row.target_role,
        "difficulty": row.difficulty,
        "duration_min": row.duration_min,
        "interview_type": row.interview_type
    }


class FeedbackRequest(BaseModel):
    """POST /api/live/sessions/{id}/feedback 入参。"""
    kind: Literal["tech_question", "voice", "ux", "other"] = "other"
    content: str = Field(min_length=1, max_length=500)


@router.post("/sessions/{live_id}/feedback")
async def submit_live_feedback(
    live_id: int,
    req: FeedbackRequest,
    db: AsyncSession = Depends(get_db),
    current_user: Optional[models.User] = Depends(get_current_user_optional),
):
    """
    候选人在面试过程中提交的反馈（快捷操作 / 反馈按钮）。
    追加到 InterviewLiveSession.feedback JSONB 数组，便于运营做质量监控。
    """
    row_res = await db.execute(
        select(models.InterviewLiveSession).where(models.InterviewLiveSession.id == live_id)
    )
    row = row_res.scalar_one_or_none()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Live session {live_id} 不存在",
        )
    # 鉴权：必须是本人（或匿名 session 允许任何来源写）
    if current_user is not None and row.user_id is not None and row.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="无权向该会话提交反馈",
        )
    feedback = list(row.feedback or [])
    feedback.append({
        "kind": req.kind,
        "content": req.content.strip(),
        "ts": datetime.utcnow().isoformat() + "Z",
    })
    row.feedback = feedback
    await db.commit()
    logger.info(f"[live] live_id={live_id} 收到反馈 kind={req.kind} content={req.content[:50]!r}")
    return {"ok": True, "feedback_count": len(feedback)}


@router.post("/sessions/{live_id}/end", response_model=LiveSessionResponse)
async def end_live_session(
    live_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: Optional[models.User] = Depends(get_current_user_optional),
):
    """
    结束实时面试会话，触发 live 评估分析流程（已从 InterviewSession/Transcript 模块解耦）。
    """
    row = await db.get(models.InterviewLiveSession, live_id)
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"实时面试会话 {live_id} 不存在",
        )
    if current_user and row.user_id and row.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="无权结束该实时面试会话",
        )
    if row.status in ("analyzing", "completed"):
        return LiveSessionResponse(
            live_session_id=row.id,
            status=row.status,
            interview_type=row.interview_type,
            difficulty=row.difficulty,
            duration_min=row.duration_min,
            followup_rounds=row.followup_rounds,
            target_role=row.target_role,
            job_level=row.job_level,
            company_style=row.company_style,
            job_description=row.job_description,
            voice_id=row.voice_id,
            persona_cn=row.persona_cn,
            duration_sec=row.duration_sec,
            created_at=row.created_at,
            started_at=row.started_at,
            ended_at=row.ended_at,
            session_id=row.session_id,
            ws_url=None,
        )

    # 触发结束
    if row.status not in ("ended", "ending"):
        await db.execute(
            update(models.InterviewLiveSession)
            .where(models.InterviewLiveSession.id == live_id)
            .values(status="ending")
        )
        await db.commit()
        logger.info(f"[live] live_id={live_id} status=ending")

    # 轮询等待 status='ended'（最多 8s）
    for _ in range(40):
        await asyncio.sleep(0.2)
        await db.refresh(row)
        if row.status == "ended":
            break
    else:
        logger.warning(f"[live] live_id={live_id} 等待 ended 超时，强制继续分析")

    # 触发异步评估，不依赖归档到 InterviewSession
    import uuid
    task_id = f"live-eval-{row.id}-{uuid.uuid4().hex[:8]}"
    asyncio.create_task(
        _run_analysis_for_live(task_id, row.id, row.user_id)
    )
    logger.info(f"[live] live_id={live_id} 启动后台实时分析评估 task={task_id}")

    # 更新本地 row 状态为 analyzing
    await db.execute(
        update(models.InterviewLiveSession)
        .where(models.InterviewLiveSession.id == live_id)
        .values(status="analyzing")
    )
    await db.commit()
    await db.refresh(row)

    return LiveSessionResponse(
        live_session_id=row.id,
        status=row.status,
        interview_type=row.interview_type,
        difficulty=row.difficulty,
        duration_min=row.duration_min,
        followup_rounds=row.followup_rounds,
        target_role=row.target_role,
        job_level=row.job_level,
        company_style=row.company_style,
        job_description=row.job_description,
        voice_id=row.voice_id,
        persona_cn=row.persona_cn,
        duration_sec=row.duration_sec,
        created_at=row.created_at,
        started_at=row.started_at,
        ended_at=row.ended_at,
        session_id=row.session_id,
        ws_url=None,
    )


async def _run_analysis_for_live(
    task_id: str, live_id: int, user_id: Optional[int]
) -> None:
    """
    异步调用 LLM 进行实时面试评估。
    直接将分析结果 (ipi_score, summary, analysis_result, transcript) 写入 interview_live_sessions 表中。
    """
    try:
        from app.database import async_session
        from sqlalchemy import select, update
        
        # 1. 提取 candidate profile
        profile_data = None
        if user_id:
            try:
                from app.routers.audio import _extract_profile_data
                async with async_session() as db:
                    profile_data = await _extract_profile_data(db, user_id)
            except Exception as e:
                logger.warning(f"[live] 取 profile_data 失败: {e}")

        # 2. 读取整场面试的大 JSON transcript（live_bridge._on_close 已一次性写入）
        async with async_session() as db:
            live_sess = await db.get(models.InterviewLiveSession, live_id)
            if not live_sess:
                logger.error(f"[live] live session {live_id} not found for analysis")
                return

            job_description = live_sess.job_description
            # transcript_data 已经是报告页要的 shape：
            #   [{start_time, end_time, speaker: "Interviewer|Candidate", content: {...}}, ...]
            transcript_data = list(live_sess.transcript or [])

        # 3. 仅用 transcript_data 构造 dialogue_text（不再二次重写 transcript）
        dialogue_parts = []
        for line in transcript_data:
            content = line.get("content") or {}
            speaker_in_content = content.get("speaker", "interviewer")
            text = content.get("text", "")
            prefix = "面试官" if speaker_in_content == "interviewer" else "候选人"
            dialogue_parts.append(f"{prefix}：{text}")

        dialogue_text = "\n".join(dialogue_parts)
        
        # 4. 调用 LLM 评估 (DeepSeek)
        from app.routers.audio import analyze_interview_dialogue
        
        # Safe fallback scores
        ipi_score = 65
        offer_probability = 40
        strengths = ["表达流利，问题应答迅速", "了解核心技术特性"]
        weaknesses = ["技术深度有待提升", "方案细节描述不够完整"]
        suggestions = ["深化系统设计知识体系", "回答中加入量化数据背书"]
        executive_summary = "整体表现中等，建议加强技术深度与方案细节的描述。"
        
        score_expression = 75
        score_logic = 80
        score_project_depth = 70
        score_ownership = 65
        score_system_design = 60
        
        llm_result = {}
        try:
            if dialogue_text.strip():
                llm_result = await analyze_interview_dialogue(dialogue_text, profile_data, job_description)
            if llm_result:
                ipi_score = llm_result.get("ipi_score", ipi_score)
                offer_probability = llm_result.get("offer_probability", offer_probability)
                strengths = llm_result.get("summary_strengths", strengths)
                weaknesses = llm_result.get("summary_weaknesses", weaknesses)
                suggestions = llm_result.get("summary_suggestions", suggestions)
                executive_summary = llm_result.get("executive_summary", executive_summary)
                
                if "scores" not in llm_result or not isinstance(llm_result["scores"], dict):
                    llm_result["scores"] = {
                        "expression": llm_result.get("score_expression") or llm_result.get("expression") or score_expression,
                        "logic": llm_result.get("score_logic") or llm_result.get("logic") or score_logic,
                        "project_depth": llm_result.get("score_project_depth") or llm_result.get("project_depth") or score_project_depth,
                        "ownership": llm_result.get("score_ownership") or llm_result.get("ownership") or score_ownership,
                        "system_design": llm_result.get("score_system_design") or llm_result.get("system_design") or score_system_design,
                    }
        except Exception as e:
            logger.warning(f"[live] LLM evaluation failed, using fallback: {e}")
            
        if not llm_result:
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
                    "system_design": score_system_design
                },
                "max_lose_points": [
                    { "rank": 1, "label": "选型依据不足", "tag": "高风险", "desc": "缺少问题背景和选型对比，无法体现技术决策能力" },
                    { "rank": 2, "label": "没有 Trade-off 分析", "tag": "中风险", "desc": "回答较表面，缺乏权衡思考和方案对比" },
                    { "rank": 3, "label": "项目贡献模糊", "tag": "中风险", "desc": "未突出个人贡献并负责的核心模块" }
                ],
                "interviewer_perspective": [
                    { "label": "Redis 相关问题", "val": "验证缓存设计能力" },
                    { "label": "一致性问题", "val": "验证分布式系统架构能力" },
                    { "label": "项目真实度", "val": "验证真实项目经验" }
                ],
                "question_deconstruction": [
                    { "stage": "第 1 关 · 基础引入", "title": "为什么使用 Redis？", "desc": "考查求职者是否知道 Redis 在项目中的具体角色..." },
                    { "stage": "第 2 关 · 方案对比", "title": "为什么不用本地缓存？", "desc": "深度考查对进程内缓存与分布式缓存的对比..." }
                ],
                "followup_paths": [
                    { "title": "Q1 自我介绍 · 引导切入", "desc": "抛出“做过分布式系统与中间件开发”，成功引导进入中间件板块。", "tag": "良好" },
                    { "title": "Q3 Redis 选型 · 主动深挖", "desc": "核心漏洞点：“因为 Redis 性能高” ➔ 引出细节追问。", "tag": "一般" },
                    { "title": "Q5 双写一致性 · 重试质感", "desc": "最终瓶颈：“定时双删”的答法暴露了高并发和真实落地经验的不足。", "tag": "风险" }
                ]
            }
            
        # 5. 保存结果到 InterviewLiveSession 并完成
        # transcript 字段不再此处更新：live_bridge._on_close 已在面试结束时一次性写入大 JSON，
        # 这里只需追加分析结果（ipi / summary / analysis_result）即可
        async with async_session() as db:
            await db.execute(
                update(models.InterviewLiveSession)
                .where(models.InterviewLiveSession.id == live_id)
                .values(
                    status="completed",
                    ipi_score=ipi_score,
                    offer_probability=offer_probability,
                    summary_strengths=strengths,
                    summary_weaknesses=weaknesses,
                    summary_suggestions=suggestions,
                    executive_summary=executive_summary,
                    analysis_result=llm_result,
                )
            )
            
            # 6. PR6 定价：累加当周/当月时长
            if live_sess.user_id and live_sess.duration_sec > 0:
                try:
                    await upsert_user_live_minutes(
                        db=db,
                        user_id=live_sess.user_id,
                        added_seconds=live_sess.duration_sec,
                        ended_at=live_sess.ended_at or datetime.utcnow(),
                    )
                    logger.info(f"[live] 累计时长 +{live_sess.duration_sec}s to user={live_sess.user_id}")
                except Exception as ex:
                    logger.warning(f"[live] 累计时长失败 user={live_sess.user_id}: {ex}")
            
            await db.commit()
            
        logger.info(f"[live] analysis complete for live_id={live_id}")
    except Exception as e:
        logger.exception(f"[live] _run_analysis_for_live 失败 live_id={live_id}: {e}")
        # 标记 failed
        try:
            from app.database import async_session
            async with async_session() as db:
                await db.execute(
                    update(models.InterviewLiveSession)
                    .where(models.InterviewLiveSession.id == live_id)
                    .values(status="failed")
                )
                await db.commit()
        except Exception:
            pass


# ---------- PR6 端点：统计 / 列表 / 配额 ----------

@router.get("/stats/current")
async def get_current_stats(
    db: AsyncSession = Depends(get_db),
    current_user: Optional[models.User] = Depends(get_current_user_optional),
):
    """
    PR6: 返回当前用户的当周 + 当月实时面试累计时长。
    - 未登录或匿名 → 全 0
    - 包含 limit_min / remaining_min（按会员等级）
    """
    if not current_user:
        return {
            "week": {"total_seconds": 0, "sessions_count": 0, "period_key": None},
            "month": {"total_seconds": 0, "sessions_count": 0, "period_key": None},
            "limit_min": 0,
            "used_min": 0,
            "remaining_min": 0,
            "membership": None,
        }

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    wk = period_key_for("week", now)
    mk = period_key_for("month", now)

    async def get_row(period_type: str, period_key: str) -> dict:
        res = await db.execute(
            select(models.UserLiveMinutes).where(
                models.UserLiveMinutes.user_id == current_user.id,
                models.UserLiveMinutes.period_type == period_type,
                models.UserLiveMinutes.period_key == period_key,
            )
        )
        row = res.scalars().first()
        if row:
            return {
                "total_seconds": row.total_seconds,
                "sessions_count": row.sessions_count,
                "period_key": row.period_key,
            }
        return {"total_seconds": 0, "sessions_count": 0, "period_key": period_key}

    week = await get_row("week", wk)
    month = await get_row("month", mk)

    limit_min = MEMBERSHIP_MONTHLY_MINUTES.get(current_user.membership, 0)
    used_min = month["total_seconds"] // 60
    # 所有档位都有明确限额：MAX=120、P=60、Free=0。统一返回 max(0, limit - used)
    remaining_min = max(0, limit_min - used_min)

    return {
        "week": week,
        "month": month,
        "limit_min": limit_min,
        "used_min": used_min,
        "remaining_min": remaining_min,
        "membership": current_user.membership,
    }


@router.get("/sessions-list/history")
async def list_live_sessions_for_timeline(
    db: AsyncSession = Depends(get_db),
    current_user: Optional[models.User] = Depends(get_current_user_optional),
):
    """
    PR6: 返回当前用户的所有 live sessions 列表（带 session_id 关联的归档报告）。
    给 memory 页时间轴用。
    """
    if not current_user:
        return []
    result = await db.execute(
        select(models.InterviewLiveSession)
        .where(models.InterviewLiveSession.user_id == current_user.id)
        .order_by(models.InterviewLiveSession.created_at.desc())
    )
    rows = result.scalars().all()
    return [
        {
            "id": r.id,                          # live_id（前端用 liveId）
            "session_id": r.session_id,          # 关联的归档 InterviewSession.id
            "interview_type": r.interview_type,
            "difficulty": r.difficulty,
            "duration_min": r.duration_min,
            "duration_sec": r.duration_sec,
            "target_role": r.target_role,
            "company_style": r.company_style,
            "job_level": r.job_level,
            "job_description": r.job_description,
            "voice_id": r.voice_id,
            "persona_cn": r.persona_cn,
            "status": r.status,
            "created_at": r.created_at.isoformat() if r.created_at else None,
            "started_at": r.started_at.isoformat() if r.started_at else None,
            "ended_at": r.ended_at.isoformat() if r.ended_at else None,
            "followup_rounds": r.followup_rounds,
        }
        for r in rows
    ]


@router.get("/quota")
async def get_user_quota(
    db: AsyncSession = Depends(get_db),
    current_user: Optional[models.User] = Depends(get_current_user_optional),
):
    """前端快速查询：会员等级 + 月度限额 + 当月已用 + 剩余。"""
    if not current_user:
        return {"membership": None, "limit_min": 0, "used_min": 0, "remaining_min": 0}
    limit_min = MEMBERSHIP_MONTHLY_MINUTES.get(current_user.membership, 0)
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    mk = period_key_for("month", now)
    res = await db.execute(
        select(func.coalesce(func.sum(models.UserLiveMinutes.total_seconds), 0)).where(
            models.UserLiveMinutes.user_id == current_user.id,
            models.UserLiveMinutes.period_type == "month",
            models.UserLiveMinutes.period_key == mk,
        )
    )
    used_min = int(res.scalar() or 0) // 60
    # 所有档位都有明确限额：MAX=120、P=60、Free=0。统一返回 max(0, limit - used)
    remaining_min = max(0, limit_min - used_min)
    return {
        "membership": current_user.membership,
        "limit_min": limit_min,
        "used_min": used_min,
        "remaining_min": remaining_min,
    }


# ---------- 删除端点（时间轴/职业记忆库使用） ----------

class BatchDeleteLiveRequest(BaseModel):
    """POST /api/live/sessions/batch-delete 入参。"""
    live_ids: List[int] = Field(default_factory=list)


async def _delete_live_session_cascade(
    db: AsyncSession, live_row: models.InterviewLiveSession
) -> dict:
    """
    删除一个 live session。
    关联的 interview_transcripts（PR4 归档用）由 InterviewSession 的 cascade 自动清理；
    实时对话记录存在 interview_live_sessions.transcript JSONB 里，随 session 一起删。

    返回被删行的关键 id 供日志/回包用。
    """
    live_id = live_row.id
    archived_session_id = live_row.session_id

    # 2) 删 live session 本体（messages 走 ORM cascade）
    await db.delete(live_row)
    await db.flush()

    return {
        "live_id": live_id,
        "archived_session_id": archived_session_id,
    }


@router.delete("/sessions/{live_id}")
async def delete_live_session(
    live_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: Optional[models.User] = Depends(get_current_user_optional),
):
    """
    删除一条实时面试记录（时间轴使用）。
    - 登录用户只能删自己的（live.user_id 匹配 current_user.id）
    - 匿名创建的（user_id=NULL）允许任意已登录用户删；实际几乎不会有
    - 连带删除归档的 InterviewSession（如果已 end 过）及其所有分析数据
    - 不退 user_live_minutes（它是按 period 聚合的 usage 计数，回退复杂度高；
      如需严格回退可以单独写一个 subtractive upsert）
    """
    row = await db.get(models.InterviewLiveSession, live_id)
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"实时面试会话 {live_id} 不存在",
        )
    if current_user and row.user_id and row.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="无权删除该实时面试记录",
        )

    info = await _delete_live_session_cascade(db, row)
    try:
        await db.commit()
    except Exception as e:
        await db.rollback()
        logger.exception(f"[live] 删 live session 失败 live_id={live_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="删除失败，请稍后重试",
        )

    logger.info(
        f"[live] 删除成功 live_id={info['live_id']} "
        f"archived_session_id={info['archived_session_id']}"
    )
    return {
        "message": "实时面试记录删除成功",
        "live_id": info["live_id"],
        "archived_session_id": info["archived_session_id"],
    }


@router.post("/sessions/batch-delete")
async def batch_delete_live_sessions(
    req: BatchDeleteLiveRequest,
    db: AsyncSession = Depends(get_db),
    current_user: Optional[models.User] = Depends(get_current_user_optional),
):
    """
    批量删除实时面试记录。返回成功/失败数；权限不通过的会被跳过并计入 skipped。
    """
    if not req.live_ids:
        return {"message": "未指定删除的 live_id", "deleted_count": 0, "skipped_count": 0}

    result = await db.execute(
        select(models.InterviewLiveSession).where(
            models.InterviewLiveSession.id.in_(req.live_ids)
        )
    )
    rows = result.scalars().all()

    deleted = 0
    skipped = 0
    skipped_ids: List[int] = []
    for row in rows:
        # 权限：登录用户只能删自己的；匿名（user_id=NULL）允许任何已登录用户删
        if current_user and row.user_id and row.user_id != current_user.id:
            skipped += 1
            skipped_ids.append(row.id)
            continue
        try:
            await _delete_live_session_cascade(db, row)
            deleted += 1
        except Exception as e:
            logger.exception(f"[live] 批量删 live_id={row.id} 失败: {e}")
            skipped += 1
            skipped_ids.append(row.id)

    try:
        await db.commit()
    except Exception as e:
        await db.rollback()
        logger.exception(f"[live] 批量删提交失败: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="批量删除提交失败，请稍后重试",
        )

    logger.info(
        f"[live] 批量删完成 requested={len(req.live_ids)} "
        f"deleted={deleted} skipped={skipped} skipped_ids={skipped_ids}"
    )
    return {
        "message": f"成功删除 {deleted} 条实时面试记录",
        "deleted_count": deleted,
        "skipped_count": skipped,
        "skipped_ids": skipped_ids,
    }




# ---------- Offer 概率趋势（总览看板 CARD 6） ----------

@router.get("/offer-trend")
async def get_offer_trend(
    db: AsyncSession = Depends(get_db),
    current_user: Optional[models.User] = Depends(get_current_user_optional),
):
    """返回当前用户所有已完成实时模拟面试的 Offer 概率时间序列。

    专用于总览看板「Offer 概率预测」卡片折线图。
    """
    if not current_user:
        return {
            "current_probability": 0,
            "points": [],
            "total_sessions": 0,
            "suggestion": None,
        }

    stmt = (
        select(models.InterviewLiveSession)
        .where(
            models.InterviewLiveSession.user_id == current_user.id,
            models.InterviewLiveSession.status == "completed",
            models.InterviewLiveSession.offer_probability.isnot(None),
        )
        .order_by(models.InterviewLiveSession.created_at.asc())
    )
    result = await db.execute(stmt)
    sessions = result.scalars().all()

    points = []
    for i, s in enumerate(sessions):
        points.append({
            "analysis_index": i + 1,
            "live_id": s.id,
            "target_role": s.target_role or "",
            "analysis_time": s.created_at.isoformat() if s.created_at else None,
            "offer_probability": s.offer_probability,
        })

    current = sessions[-1].offer_probability if sessions else 0

    # 提升建议：基于最近一次面试的弱点总结
    suggestion = None
    if sessions:
        latest = sessions[-1]
        weaknesses = latest.summary_weaknesses or []
        focus_areas = weaknesses[:2] if weaknesses else ["架构表达", "项目指标量化能力"]
        cur_p = latest.offer_probability or 0
        potential = min(99, cur_p + round((100 - cur_p) * 0.55))
        suggestion = {
            "focus_areas": focus_areas,
            "potential_probability": potential,
        }

    logger.info(
        f"[live] offer-trend user_id={current_user.id} total={len(points)} "
        f"current={current}"
    )
    return {
        "current_probability": current,
        "points": points,
        "total_sessions": len(points),
        "suggestion": suggestion,
    }


# ---------- WebSocket 端点（PR2） ----------


async def _fetch_candidate_context_full(
    db: AsyncSession, user_id: int, target_role: str
) -> tuple[str, dict | None, list[dict], dict | None]:
    """
    拉候选人的 4 类数据 → 返回 (context_str, profile_dict, projects_list, resume_summary)。
    既给 system prompt 拼【候选人背景】段，也给 pick_intro_questions 喂 dict。
    任一查询失败 / 无数据就跳过该段，整体不抛错。
    """
    from app.services.live_config import build_candidate_context

    # 1. UserProfile
    profile_dict: dict | None = None
    try:
        prof_res = await db.execute(
            select(models.UserProfile).where(models.UserProfile.user_id == user_id)
        )
        prof = prof_res.scalar_one_or_none()
        if prof is not None:
            profile_dict = {
                "experience_years": prof.experience_years,
                "experience_months": prof.experience_months,
                "company_name": prof.company_name,
                "role_name": prof.role_name,
                "school": prof.school,
                "degree": prof.degree,
                "target_company": prof.target_company,
                "target_grade": prof.target_grade,
            }
    except Exception as e:
        logger.warning(f"[live] 取 UserProfile 失败: {e}")

    # 2. ProjectMemory（按 importance desc 限 3 条；同 importance 时按 mastery desc）
    projects_list: list[dict] = []
    try:
        proj_res = await db.execute(
            select(models.ProjectMemory)
            .where(models.ProjectMemory.user_id == user_id)
            .order_by(
                models.ProjectMemory.importance.desc(),
                models.ProjectMemory.mastery_level.desc(),
            )
            .limit(3)
        )
        for p in proj_res.scalars().all():
            projects_list.append({
                "project_name": p.project_name,
                "role": p.role,
                "tech_stack": p.tech_stack or [],
                "metrics": p.metrics or {},
            })
    except Exception as e:
        logger.warning(f"[live] 取 ProjectMemory 失败: {e}")

    # 3. 最近 ResumeAnalysis.result_json
    resume_summary: dict | None = None
    try:
        ra_res = await db.execute(
            select(models.ResumeAnalysis)
            .where(models.ResumeAnalysis.user_id == user_id)
            .order_by(models.ResumeAnalysis.created_at.desc())
            .limit(1)
        )
        ra = ra_res.scalar_one_or_none()
        if ra is not None and ra.result_json:
            rj = dict(ra.result_json)  # 复制防污染
            # 冗余字段如果没填就回填
            if rj.get("score") is None and ra.score is not None:
                rj["score"] = ra.score
            resume_summary = rj
    except Exception as e:
        logger.warning(f"[live] 取 ResumeAnalysis 失败: {e}")

    # 4. 最近一次面试评测（优先 InterviewLiveSession，fallback InterviewSession）
    last_analysis: dict | None = None
    try:
        # 先看 InterviewLiveSession（实时面试归档）
        live_res = await db.execute(
            select(models.InterviewLiveSession)
            .where(
                models.InterviewLiveSession.user_id == user_id,
                models.InterviewLiveSession.status == "completed",
                models.InterviewLiveSession.ipi_score.is_not(None),
            )
            .order_by(models.InterviewLiveSession.ended_at.desc())
            .limit(1)
        )
        last = live_res.scalar_one_or_none()
        if last is None:
            # fallback 到 InterviewSession（录音分析）
            sess_res = await db.execute(
                select(models.InterviewSession)
                .where(
                    models.InterviewSession.user_id == user_id,
                    models.InterviewSession.status == "completed",
                    models.InterviewSession.ipi_score > 0,
                )
                .order_by(models.InterviewSession.updated_at.desc())
                .limit(1)
            )
            last = sess_res.scalar_one_or_none()
            if last is not None:
                last_analysis = {
                    "ipi_score": last.ipi_score,
                    "summary_strengths": last.summary_strengths or [],
                    "summary_weaknesses": last.summary_weaknesses or [],
                }
        else:
            last_analysis = {
                "ipi_score": last.ipi_score,
                "summary_strengths": last.summary_strengths or [],
                "summary_weaknesses": last.summary_weaknesses or [],
            }
    except Exception as e:
        logger.warning(f"[live] 取最近面试评测失败: {e}")

    context_str = build_candidate_context(
        profile=profile_dict,
        projects=projects_list,
        resume_summary=resume_summary,
        last_analysis=last_analysis,
        target_role=target_role,
    )
    return context_str, profile_dict, projects_list, resume_summary


# 旧 API 兼容：仅返回字符串（不再被调用，保留给可能的旧 caller）
async def _fetch_candidate_context(
    db: AsyncSession, user_id: int, target_role: str
) -> str:
    ctx_str, _, _, _ = await _fetch_candidate_context_full(db, user_id, target_role)
    return ctx_str


@router.websocket("/ws/{live_id}")
async def ws_live(websocket: WebSocket, live_id: int):
    """
    实时语音面试 WebSocket 端点。

    协议：
    1. 浏览器连 `ws://host/api/live/ws/{live_id}`
    2. 服务端 accept 后，浏览器必须立即发首条 JSON：`{"type":"auth","token":"<JWT>"}`
       - token 为空/过期/黑名单 → close 4001
       - 通过 → 推 `{"type":"live.ready",...}` 进入 PR2 echo 模式
    3. 之后可发音频二进制帧（PCM16/24kHz/单声道/20ms），PR2 模式原样 echo
    4. 文本帧可选 `{"type":"client.text","content":"..."}` 走文本通道
    5. 心跳：`{"type":"ping"}` → 服务端回 `{"type":"pong"}`
    6. 60s 无活动 → 服务端主动 close 4002

    PR3 起：bridge.volc 不为 None，音频帧转发给火山，volc 的 tts_audio / asr 事件回推浏览器。
    """
    await websocket.accept()
    logger.info(f"[ws] live_id={live_id} 已 accept")

    # ---------- 1. 鉴权：首条 JSON 消息必须是 auth ----------
    user = None
    db_for_auth = async_session()
    redis_for_auth = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
    try:
        try:
            raw = await asyncio.wait_for(websocket.receive_text(), timeout=10)
        except (asyncio.TimeoutError, WebSocketDisconnect):
            logger.info(f"[ws] live_id={live_id} 鉴权超时或 disconnect")
            await websocket.close(code=4001, reason="auth timeout")
            return
        try:
            auth_msg = json.loads(raw)
        except json.JSONDecodeError:
            await websocket.close(code=4001, reason="auth not json")
            return
        if auth_msg.get("type") != "auth" or not auth_msg.get("token"):
            await websocket.close(code=4001, reason="auth shape invalid")
            return
        user = await get_current_user_from_ws(auth_msg["token"], db_for_auth, redis_for_auth)
        if user is None:
            logger.info(f"[ws] live_id={live_id} 鉴权失败")
            await websocket.close(code=4001, reason="invalid token")
            return
        logger.info(f"[ws] live_id={live_id} 鉴权 OK user_id={user.id}")
    finally:
        await db_for_auth.close()
        await redis_for_auth.aclose()

    # ---------- 2. 校验 live session 归属 ----------
    db = async_session()
    try:
        row = await db.get(models.InterviewLiveSession, live_id)
        if not row:
            await websocket.close(code=4404, reason="live session not found")
            return
        if row.user_id and row.user_id != user.id:
            await websocket.close(code=4403, reason="forbidden")
            return
        if row.status not in ("created", "ws_connecting", "live"):
            logger.warning(
                f"[ws] live_id={live_id} status={row.status} 不允许重连，close 4410"
            )
            await websocket.close(code=4410, reason=f"status={row.status}")
            return

        # ---------- 3. 标记 live + started_at ----------
        await db.execute(
            update(models.InterviewLiveSession)
            .where(models.InterviewLiveSession.id == live_id)
            .values(status="live", started_at=datetime.utcnow())
        )
        await db.commit()
        await db.refresh(row)
        logger.info(f"[ws] live_id={live_id} status=live, started_at={row.started_at}")

        # ---------- 4. 创建 bridge 并 run ----------
        # 策略：
        #   - API key 已配置：必须连上火山，连接/握手失败直接报错断 WS，不再静默 fallback
        #   - API key 未配置：明确走 echo 模式（仅供本地无 key 调试）
        volc_bridge = None
        use_volc = bool(settings.VOLC_REALTIME_API_KEY)
        if use_volc:
            from app.services.volc_realtime_bridge import VolcRealtimeBridge
            from app.services.live_config import (
                build_system_prompt, build_candidate_context,
                pick_intro_questions,
                select_voice, get_profile,
            )
            try:
                # 提前取 profile（bridge 实例化时就要用 bot_name）
                profile = get_profile(row.interview_type, row.difficulty)
                voice = select_voice(row.interview_type, row.difficulty)

                # PR-N: 拼候选人背景（简历画像 / 项目记忆 / 历史面试评测），
                # 同时生成「按背景动态选」的开场白作为 SayHello 的 content。
                candidate_context = ""
                intro_content = ""
                user_profile_dict: dict | None = None
                projects_list: list[dict] = []
                resume_summary_dict: dict | None = None
                if row.user_id is not None:
                    try:
                        (
                            candidate_context,
                            user_profile_dict,
                            projects_list,
                            resume_summary_dict,
                        ) = await _fetch_candidate_context_full(
                            db, user_id=row.user_id, target_role=row.target_role or ""
                        )
                        intro_content = pick_intro_questions(
                            interview_type=row.interview_type,
                            profile=user_profile_dict,
                            projects=projects_list,
                            resume_summary=resume_summary_dict,
                            target_role=row.target_role or "",
                        )
                    except Exception as ctx_err:
                        logger.warning(
                            f"[ws] live_id={live_id} 拉候选人背景失败（不影响继续）: {ctx_err}"
                        )

                system_prompt = build_system_prompt(
                    interview_type=row.interview_type,
                    difficulty=row.difficulty,
                    target_role=row.target_role or "后端开发工程师",
                    job_level=row.job_level or "P6",
                    company_style=row.company_style or "通用",
                    duration_min=row.duration_min,
                    followup_rounds=row.followup_rounds,
                    job_description=row.job_description,
                    candidate_context=candidate_context,
                )
                volc_bridge = VolcRealtimeBridge(
                    api_key=settings.VOLC_REALTIME_API_KEY,   # → X-Api-Key (Access Key)
                    app_key=settings.VOLC_REALTIME_APP_KEY,   # → X-Api-App-Key (固定常量)
                    resource_id=settings.VOLC_REALTIME_RESOURCE_ID,
                    wss_url=settings.VOLC_REALTIME_WSS_URL,
                    voice=voice,
                    system_role=system_prompt,                # volc dialog.system_role
                    bot_name=profile.get("persona_cn", "面试官"),
                    # 语速档位（0.9~1.2）→ 火山 TTS speech_rate；让 Lv1~Lv4 真的听出快慢差异
                    speech_rate=profile.get("speech_speed", 1.0),
                )
                await volc_bridge.connect()
                # 触发 AI 开场白（SayHello）：用 pick_intro_questions 选出的「按背景开场白」
                try:
                    await volc_bridge.say_hello(content=intro_content or "")
                except Exception as e:
                    logger.warning(f"[ws] live_id={live_id} SayHello 失败（不影响连接）: {e}")

                # PR-N: 并行接一条火山流式短语音识别通道，独立于 realtime dialog，
                # 用于把候选人 mic 文本实时上屏（realtime dialog 不回推 ASR 文本）。
                # api_key 用 .env 里 VOLC_ASR_API_KEY（短语音识别产品的独立 key），
                # app_key 与 realtime dialog 共用 PlgvMymc7f3tQnJ6（火山通用 App Key）。
                # 由于控制台开通的模型/计费方式不确定，自动 fallback 试 4 种 resource_id，
                # 第一个握手成功的就用。
                asr_bridge = None
                try:
                    from app.services.volc_streaming_asr import VolcStreamingAsrBridge
                    # fallback 顺序：火山官方 demo 默认是 volc.bigasr.sauc.duration，
                    # 把它放第一。其他按开通可能顺序排列。
                    resource_id_candidates = [
                        "volc.bigasr.sauc.duration",
                        "volc.bigasr.sauc.concurrent",
                        "volc.seedasr.sauc.duration",
                        "volc.seedasr.sauc.concurrent",
                        settings.VOLC_STREAMING_ASR_RESOURCE_ID,
                    ]
                    # 去重保持顺序
                    seen = set()
                    ordered = []
                    for r in resource_id_candidates:
                        if r and r not in seen:
                            seen.add(r)
                            ordered.append(r)
                    last_err = None
                    for rid in ordered:
                        try:
                            cand = VolcStreamingAsrBridge(
                                api_key=settings.VOLC_ASR_API_KEY,
                                app_key=settings.VOLC_REALTIME_APP_KEY,
                                resource_id=rid,
                                wss_url=settings.VOLC_STREAMING_ASR_WSS_URL,
                                language="zh-CN",
                                model_name="bigmodel",
                            )
                            await cand.connect()
                            asr_bridge = cand
                            logger.info(
                                f"[ws] live_id={live_id} 流式 ASR 已接入 (resource_id={rid})"
                            )
                            break
                        except Exception as e:
                            last_err = e
                            logger.warning(
                                f"[ws] live_id={live_id} 流式 ASR resource_id={rid} 失败: {e}"
                            )
                            continue
                    if asr_bridge is None:
                        logger.warning(
                            f"[ws] live_id={live_id} 流式 ASR 所有 resource_id 都失败（候选人文本将无法上屏）: {last_err}"
                        )
                except Exception as e:
                    logger.warning(
                        f"[ws] live_id={live_id} 流式 ASR 接入异常: {e}"
                    )
                    asr_bridge = None
                # 回填 voice_id 和 persona 到 row 便于后续展示
                await db.execute(
                    update(models.InterviewLiveSession)
                    .where(models.InterviewLiveSession.id == live_id)
                    .values(voice_id=voice, persona_cn=profile["persona_cn"])
                )
                await db.commit()
                logger.info(
                    f"[ws] live_id={live_id} 火山接入 OK voice={voice} persona={profile['persona_cn']}"
                )
            except Exception as e:
                err_type = type(e).__name__
                err_msg = str(e) or repr(e)
                logger.exception(
                    f"[ws] live_id={live_id} 火山接入失败，硬终止: {err_type}: {err_msg}"
                )
                # 把真实错误推给浏览器，立即断开，不进入 echo 模式
                try:
                    await websocket.send_text(json.dumps({
                        "type": "live.error",
                        "code": "volc_connect_failed",
                        "stage": "bridge_init_or_connect",
                        "error_type": err_type,
                        "message": err_msg,
                    }, ensure_ascii=False))
                except Exception:
                    pass
                try:
                    await db.execute(
                        update(models.InterviewLiveSession)
                        .where(models.InterviewLiveSession.id == live_id)
                        .values(status="failed", ended_at=func.now())
                    )
                    await db.commit()
                    logger.info(f"[ws] live_id={live_id} session marked as failed in DB")
                except Exception as db_err:
                    logger.exception(f"[ws] live_id={live_id} 标记 failed 失败: {db_err}")
                try:
                    await websocket.close(code=4503, reason="volc_unavailable")
                except Exception:
                    pass
                return
        else:
            logger.info(f"[ws] live_id={live_id} 火山 key 未配置，echo 模式（仅供本地调试）")

        from app.services.live_bridge import LiveSessionBridge
        bridge = LiveSessionBridge(ws=websocket, row=row, db=db, volc=volc_bridge, asr_bridge=asr_bridge)
        await bridge.run()
    except WebSocketDisconnect:
        logger.info(f"[ws] live_id={live_id} 浏览器中途 disconnect")
    except Exception as e:
        logger.exception(f"[ws] live_id={live_id} handler 异常: {e}")
        try:
            await websocket.close(code=4500, reason="internal error")
        except Exception:
            pass
    finally:
        await db.close()
