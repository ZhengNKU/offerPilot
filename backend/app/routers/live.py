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
from app.database import get_db, async_session, _get_redis_pool, get_redis
from app.routers.auth import get_current_user_optional
from app.utils.moderation_dep import moderated
from app.utils.ws_auth import get_current_user_from_ws
from app.services.live_slots import make_slot_manager, estimate_eta_sec
from app.services.live_config import _fetch_live_web_context

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/live", tags=["Live Interview"])


# ---------- PR6 定价限额配置 ----------
# 按会员等级的月度实时面试时长上限（分钟）。0 表示不可用。
# 内测版本：test 档 = 20 分钟/月（2026-07-18+）
MEMBERSHIP_MONTHLY_MINUTES = {
    None: 0,      # 免费用户：0 分钟（不可使用实时模拟面试；只能试文本/录音分析）
    "free": 0,
    "test": 10,   # 内测用户：10 分钟/月（统一）；注册起 30 天后过期降级为 0
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


async def _cleanup_zombie_session(
    db: AsyncSession,
    row: models.InterviewLiveSession,
    *,
    slots: Optional["object"] = None,
    log_prefix: str = "[live]",
) -> bool:
    """
    检测并清理僵尸 live session。返回 True 表示确实清理了，False 表示非僵尸。

    行为：mark abandoned + 补 duration_sec（按 now - created_at 兜底，clamp 到 duration_min*60）
          + 扣减额度（复用 upsert_user_live_minutes）+ 释放槽位（幂等）。

    调用方需要在清理后自行 db.refresh(row)（如需返回最新 status 给前端）。
    """
    if row.status != "live":
        return False
    base_dt = row.created_at
    if base_dt is None:
        return False

    now = datetime.utcnow()
    elapsed = (now - base_dt).total_seconds()
    # 5min 缓冲 = DURATION_BUFFER_S(60) + PING_TIMEOUT_S(180) + 60s slack
    max_lifetime = row.duration_min * 60 + 300
    if elapsed <= max_lifetime:
        return False  # 还在合理生命周期内

    # 兜底时长：clamp 到请求时长，避免因 created_at 太早而扣超
    dur_sec = min(int(elapsed), row.duration_min * 60)
    if dur_sec < 1:
        dur_sec = 1  # 保底 1 秒（与 end_live_session 的 abandon 路径一致）

    try:
        await db.execute(
            update(models.InterviewLiveSession)
            .where(models.InterviewLiveSession.id == row.id)
            .values(status="abandoned", duration_sec=dur_sec, ended_at=now)
        )
        await db.commit()
        logger.warning(
            f"{log_prefix} 僵尸 session live_id={row.id} elapsed={int(elapsed)}s "
            f"> max_lifetime={max_lifetime}s，已 mark abandoned + duration_sec={dur_sec}"
        )
    except Exception as ex:
        logger.warning(f"{log_prefix} 僵尸清理 DB 失败 live_id={row.id}: {ex}")
        await db.rollback()
        return False

    # 扣减额度（用户已用就要扣，与正常 abandon 一致）
    if row.user_id and dur_sec > 0:
        try:
            await upsert_user_live_minutes(
                db=db, user_id=row.user_id,
                added_seconds=dur_sec, ended_at=now,
            )
            logger.info(f"{log_prefix} 僵尸清理 累计时长 +{dur_sec}s to user={row.user_id}")
        except Exception as ex:
            logger.warning(f"{log_prefix} 僵尸清理扣减额度失败 user={row.user_id}: {ex}")

    # 释放槽位（如果有；release 幂等）
    if slots is not None:
        try:
            await slots.release(row.id)
        except Exception as ex:
            logger.debug(f"{log_prefix} 僵尸清理 release slot 异常(忽略): {ex}")

    return True


# ---------- Schemas ----------

INTERVIEW_TYPE_VALUES = ("tech_8gu", "tech_project", "tech_scenario", "non_tech", "hr_comprehensive")
DIFFICULTY_VALUES = ("Lv1", "Lv2", "Lv3", "Lv4")
DURATION_VALUES = (10, 15, 20)


class CreateLiveSessionRequest(BaseModel):
    """POST /api/live/sessions 入参。"""
    interview_type: Literal["tech_8gu", "tech_project", "tech_scenario", "non_tech", "hr_comprehensive"]
    difficulty: Literal["Lv1", "Lv2", "Lv3", "Lv4"]
    # 实际面试时长（PR-QUOTA-CAP）：正常 10/15/20；剩余配额不足时被截断到剩余，
    # 所以放宽到 int 1-20（前端 quota 感知按钮已做截断，这里是兜底）。
    duration_min: int = Field(ge=1, le=20)
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
    # 2026-07-25+: 分析失败时填入标准格式报错文案
    error_message: Optional[str] = None


# ---------- Endpoints ----------

@router.post("/sessions", response_model=LiveSessionResponse)
async def create_live_session(
    req: CreateLiveSessionRequest,
    _moderation: None = Depends(moderated("live", "job_description")),
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
    # 2026-08-07+: 对 status='live' 且超龄的 stale 行走 _cleanup_zombie_session
    #   → 走 abandon 路径（按 now-created_at 扣额度 + 释放槽），不再是裸标 failed
    if current_user_id is not None:
        try:
            stale_q = await db.execute(
                select(models.InterviewLiveSession)
                .where(
                    models.InterviewLiveSession.user_id == current_user_id,
                    models.InterviewLiveSession.status.in_(("created", "ws_connecting", "live", "ending")),
                )
            )
            stale_rows = list(stale_q.scalars())
            if stale_rows:
                redis_pool = await _get_redis_pool()
                slots = make_slot_manager(redis_pool)
                zombie_n = 0
                for stale_row in stale_rows:
                    # 走僵尸检测：live 且超龄 → 自动 abandon（扣额度 + 释放槽）
                    if await _cleanup_zombie_session(db, stale_row, slots=slots, log_prefix="[live/cleanup]"):
                        zombie_n += 1
                        continue
                    # 非僵尸（created/ws_connecting 或短期 live）→ 标 failed
                    try:
                        await db.execute(
                            update(models.InterviewLiveSession)
                            .where(models.InterviewLiveSession.id == stale_row.id)
                            .values(status="failed", ended_at=func.now())
                        )
                        await db.commit()
                    except Exception as ex:
                        logger.warning(f"[live] 标 failed 异常 stale_id={stale_row.id}: {ex}")
                        await db.rollback()
                logger.warning(
                    f"[live] 清理 user={current_user_id} 的 {len(stale_rows)} 个卡住 active session"
                    f"（{zombie_n} 个走 zombie abandon）：{[r.id for r in stale_rows]}"
                )
        except Exception as e:
            logger.exception(f"[live] 清理 stale session 失败，继续创建: {e}")
            await db.rollback()

    # PR6 定价限额：登录用户按会员等级查当月已用
    # 同时计算 effective_duration_min：剩余配额 < 请求时长时，按剩余配额截断（PR-QUOTA-CAP）。
    effective_duration_min = req.duration_min
    if current_user:
        membership = current_user.membership  # NULL/None/'test'
        # 内测用户超 30 天试用期 → 降级为免费（0 分钟）
        if membership and membership.lower() == "test":
            from app.services.quota import _is_trial_expired
            if _is_trial_expired(current_user):
                membership = None
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
            # 配额截断：剩余配额 < 请求时长 → 实际面试时长 = 剩余配额
            remaining_min = max(0, limit_min - used_min)
            if remaining_min > 0 and effective_duration_min > remaining_min:
                logger.info(
                    f"[live] user={current_user_id} 请求 {effective_duration_min} 分钟超出剩余 {remaining_min} 分钟，截断"
                )
                effective_duration_min = remaining_min
            logger.info(
                f"[live] user={current_user_id} 当月已用 {used_min}/{limit_min} 分钟，effective_duration_min={effective_duration_min} 校验通过"
            )

    row = models.InterviewLiveSession(
        user_id=current_user_id,
        interview_type=req.interview_type,
        difficulty=req.difficulty,
        duration_min=effective_duration_min,
        followup_rounds=req.followup_rounds,
        target_role=req.target_role,
        job_level=req.job_level,
        company_style=req.company_style,
        job_description=req.job_description,
        status="created",
        duration_sec=0,
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
        ws_url=f"/api/live/ws/{row.id}",
        error_message=row.error_message,
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
    if await _cleanup_zombie_session(db, row, log_prefix="[live/get]"):
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
        ws_url=f"/api/live/ws/{row.id}",
        error_message=row.error_message,
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

    # 2026-07-25+: 分析失败时直接返回报错,不再合成假分数
    if row.status == "failed":
        return {
            "status": "failed",
            "error_message": row.error_message or "模拟面试分析失败",
            "scores": None,
            "summary": None,
            "transcript": row.transcript or [],
            "analysis_result": None,
            "created_at": row.created_at.isoformat() if row.created_at else None,
            "target_role": row.target_role,
            "difficulty": row.difficulty,
            "duration_min": row.duration_min,
            "interview_type": row.interview_type,
        }

    # 放弃（用户在二次确认后离开页面）：明确告知前端「无报告」
    if row.status == "abandoned":
        return {
            "status": "abandoned",
            "error_message": "面试已终止，未生成分析报告",
            "scores": None,
            "summary": None,
            "transcript": row.transcript or [],
            "analysis_result": None,
            "created_at": row.created_at.isoformat() if row.created_at else None,
            "target_role": row.target_role,
            "difficulty": row.difficulty,
            "duration_min": row.duration_min,
            "interview_type": row.interview_type,
        }

    # 分析尚未完成(analyzing/ended 等)同样不合成假分数
    if row.status not in ("completed",):
        return {
            "status": row.status,
            "error_message": None,
            "scores": None,
            "summary": None,
            "transcript": row.transcript or [],
            "analysis_result": None,
            "created_at": row.created_at.isoformat() if row.created_at else None,
            "target_role": row.target_role,
            "difficulty": row.difficulty,
            "duration_min": row.duration_min,
            "interview_type": row.interview_type,
        }

    scores = {
        "ipi": row.ipi_score,
        "offer_probability": row.offer_probability,
    }
    if analysis_res and isinstance(analysis_res.get("scores"), dict):
        scores.update(analysis_res["scores"])

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
    _moderation: None = Depends(moderated("live:feedback", "content")),
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
    abandon: bool = False,
    db: AsyncSession = Depends(get_db),
    current_user: Optional[models.User] = Depends(get_current_user_optional),
):
    """
    结束实时面试会话。

    参数：
    - abandon=False（默认）：正常结束，触发 live 评估分析流程（已从 InterviewSession/Transcript 模块解耦）。
    - abandon=True：放弃流程（用户主动离开页面触发），
      仅标记 status="abandoned" + 扣减时长，**不**触发分析 / 不生成报告。
      用于用户在二次确认后切换页面 / 刷新 / 关闭标签等场景。
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

    # ----- abandon 路径：放弃分析，扣减时长 -----
    if abandon:
        # 已 analyzing / completed / abandoned → 直接返回当前状态
        if row.status in ("analyzing", "completed", "abandoned"):
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
                error_message=row.error_message,
            )

        # 通知后端把 live_session 标 ending（如果还在 live），让 watchdog 主动关 WS
        if row.status not in ("ended", "ending"):
            await db.execute(
                update(models.InterviewLiveSession)
                .where(models.InterviewLiveSession.id == live_id)
                .values(status="ending")
            )
            await db.commit()
            logger.info(f"[live] live_id={live_id} status=ending (abandon 触发)")

        # 轮询等待 status='ended'（最多 8s）—— bridge._on_close 写完 transcript 后会置 ended
        for _ in range(40):
            await asyncio.sleep(0.2)
            await db.refresh(row)
            if row.status == "ended":
                break
        else:
            logger.warning(f"[live] live_id={live_id} abandon 等待 ended 超时，强制标 abandoned")

        # 计算实际消耗秒数（若 DB 中 duration_sec 为 0，靠 started_at 动态补算）
        start_dt = row.started_at or row.created_at
        dur_sec = row.duration_sec if (row.duration_sec and row.duration_sec > 0) else (
            int((datetime.utcnow() - start_dt).total_seconds()) if start_dt else 0
        )
        if dur_sec <= 0:
            dur_sec = 1  # 保底 1 秒

        # 标记 abandoned + 补写 duration_sec（不触发 _run_analysis_for_live）
        await db.execute(
            update(models.InterviewLiveSession)
            .where(models.InterviewLiveSession.id == live_id)
            .values(status="abandoned", duration_sec=dur_sec)
        )
        await db.commit()
        logger.info(f"[live] live_id={live_id} status=abandoned, duration_sec={dur_sec} (放弃，不生成报告)")

        # 扣减时长（用户已用，就要扣；与正常完成走同一份 quota 表）
        if row.user_id and dur_sec > 0:
            try:
                await upsert_user_live_minutes(
                    db=db,
                    user_id=row.user_id,
                    added_seconds=dur_sec,
                    ended_at=row.ended_at or datetime.utcnow(),
                )
                logger.info(
                    f"[live] 累计时长 +{dur_sec}s to user={row.user_id} (abandon)"
                )
            except Exception as ex:
                logger.warning(f"[live] 累计时长失败 user={row.user_id}: {ex}")

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

    # ----- 正常结束路径 -----
    if row.status in ("analyzing", "completed", "abandoned"):
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
            error_message=row.error_message,
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
        # 2026-07-25+: 失败直接 raise 到外层 try/except,不再用任何 safe mock 兜底
        from app.routers.audio import analyze_interview_dialogue
        if not dialogue_text.strip():
            raise RuntimeError("没有可分析的对话内容(面试可能没有正常进行)")
        llm_result = await analyze_interview_dialogue(dialogue_text, profile_data, job_description)
        if not llm_result:
            raise RuntimeError("AI 评估返回为空")

        # 校验关键字段(任一为空/缺失即视为 LLM 输出异常,直接 raise)
        for name, val in [
            ("ipi_score", llm_result.get("ipi_score")),
            ("offer_probability", llm_result.get("offer_probability")),
            ("summary_strengths", llm_result.get("summary_strengths")),
            ("summary_weaknesses", llm_result.get("summary_weaknesses")),
            ("summary_suggestions", llm_result.get("summary_suggestions")),
            ("executive_summary", llm_result.get("executive_summary")),
            ("scores", llm_result.get("scores")),
        ]:
            if val is None or val == "" or val == [] or val == {}:
                raise RuntimeError(f"AI 返回缺少关键字段：{name}")

        ipi_score         = llm_result["ipi_score"]
        offer_probability = llm_result["offer_probability"]
        strengths         = llm_result["summary_strengths"]
        weaknesses        = llm_result["summary_weaknesses"]
        suggestions       = llm_result["summary_suggestions"]
        executive_summary = llm_result["executive_summary"]

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
            
            # 异步触发 AI 职业顾问定制建议建议更新
            if live_sess.user_id:
                from app.services.advisor_generator import trigger_custom_advisor_insights
                asyncio.create_task(
                    trigger_custom_advisor_insights(live_sess.user_id)
                )

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
                        asyncio.create_task(
                            trigger_knowledge_match(live_sess.user_id, questions)
                        )
            
        # 7. RAG 索引：fire-and-forget 把本次分析结果和逐字对话写入向量库
            if live_sess.user_id:
                from app.services.embedding_indexer import schedule_index
                schedule_index({
                    "kind": "live_interview",
                    "user_id": live_sess.user_id,
                    "live_session_id": live_id,
                })

        logger.info(f"[live] analysis complete for live_id={live_id}")
    except Exception as e:
        logger.exception(f"[live] _run_analysis_for_live 失败 live_id={live_id}: {e}")
        # 标记 failed,并写入标准格式的 error_message 给前端展示
        try:
            from app.utils.error_messages import (
                FEATURE_LIVE as FEATURE_NAME_LIVE,
                format_failure,
            )
            reason = str(e) or "未知原因"
            if len(reason) > 200:
                reason = reason[:200] + "..."
            user_message = format_failure(FEATURE_NAME_LIVE, reason)
        except Exception as fmt_err:
            logger.error(f"[live] format_failure 自身异常: {fmt_err}")
            user_message = "模拟面试失败：未知原因"
        try:
            from app.database import async_session
            async with async_session() as db:
                await db.execute(
                    update(models.InterviewLiveSession)
                    .where(models.InterviewLiveSession.id == live_id)
                    .values(status="failed", error_message=user_message)
                )
                await db.commit()
        except Exception as db_err:
            logger.error(f"[live] 写 failed 状态到 DB 失败 live_id={live_id}: {db_err}")


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
            "score": r.ipi_score or 0,
            "ipi_score": r.ipi_score or 0,
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

    logger.debug(
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
    redis_for_auth = _get_redis_pool()
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
        # redis 使用全局连接池，不 close

    # ---------- 2. 校验 live session 归属 ----------
    # 复用鉴权阶段的全局 Redis 连接池构造槽位管理器（并发限流 + 排队）
    slots = make_slot_manager(redis_for_auth)
    slot_held = False
    db = async_session()
    try:
        row = await db.get(models.InterviewLiveSession, live_id)
        if not row:
            await websocket.close(code=4404, reason="live session not found")
            return
        if row.user_id and row.user_id != user.id:
            await websocket.close(code=4403, reason="forbidden")
            return
        if await _cleanup_zombie_session(db, row, slots=slots, log_prefix="[ws]"):
            await websocket.close(code=4420, reason="previous session expired, please start new")
            return
        if row.status not in ("created", "ws_connecting", "live"):
            logger.warning(
                f"[ws] live_id={live_id} status={row.status} 不允许重连，close 4410"
            )
            await websocket.close(code=4410, reason=f"status={row.status}")
            return

        # ---------- 2.5 并发限流 + 排队（建桥前占槽）----------
        # 红线：本段所有退出分支都在 status='live' 与 bridge.run() 之前，
        #       绝不产生 duration_sec、不触发 /end 分析，因此永不扣时长额度。
        if await slots.acquire(live_id):
            slot_held = True
        else:
            pos = await slots.enqueue(live_id)
            if pos < 0:
                # 活跃槽满 + 队列也满 → 快速拒绝，不排队
                logger.info(f"[ws] live_id={live_id} 并发+队列已满，close 4429")
                try:
                    await websocket.send_text(json.dumps({
                        "type": "live.error",
                        "code": "server_busy",
                        "message": "当前模拟面试人数已满，请稍后再试",
                    }, ensure_ascii=False))
                except Exception:
                    pass
                await websocket.close(code=4429, reason="server busy")
                return

            # ---------- 排队循环 ----------
            logger.info(f"[ws] live_id={live_id} 进入排队，初始位置={pos}")
            waited = 0.0
            poll = settings.LIVE_QUEUE_POLL_INTERVAL
            try:
                while True:
                    cur_pos = await slots.queue_position(live_id)
                    if cur_pos is None:
                        cur_pos = pos
                    # 队首则尝试抢槽（抢到即出队进入正式流程）
                    if cur_pos == 0 and await slots.acquire(live_id):
                        await slots.dequeue(live_id)
                        slot_held = True
                        logger.info(f"[ws] live_id={live_id} 排队结束，已获得槽位")
                        break
                    # 推送当前排位给前端
                    try:
                        await websocket.send_text(json.dumps({
                            "type": "live.queue",
                            "position": cur_pos + 1,
                            "ahead": cur_pos,
                            "eta_sec": estimate_eta_sec(
                                cur_pos, row.duration_min, settings.LIVE_MAX_CONCURRENT
                            ),
                        }, ensure_ascii=False))
                    except Exception:
                        # 推送失败通常意味着前端已断开
                        await slots.dequeue(live_id)
                        return
                    # 在 poll 窗口内监听前端取消/断线
                    try:
                        raw_q = await asyncio.wait_for(websocket.receive(), timeout=poll)
                    except asyncio.TimeoutError:
                        raw_q = None
                    except WebSocketDisconnect:
                        await slots.dequeue(live_id)
                        return
                    if raw_q is not None:
                        if raw_q.get("type") == "websocket.disconnect":
                            await slots.dequeue(live_id)
                            return
                        txt = raw_q.get("text")
                        if txt:
                            try:
                                qmsg = json.loads(txt)
                            except json.JSONDecodeError:
                                qmsg = {}
                            if qmsg.get("type") == "client.cancel_queue":
                                logger.info(f"[ws] live_id={live_id} 用户取消排队")
                                await slots.dequeue(live_id)
                                try:
                                    await websocket.close(code=1000, reason="queue cancelled")
                                except Exception:
                                    pass
                                return
                        # 其他消息（排队中误发的 audio/ping 等）忽略
                    waited += poll
                    if waited >= settings.LIVE_QUEUE_MAX_WAIT:
                        logger.info(f"[ws] live_id={live_id} 排队超时 close 4408")
                        await slots.dequeue(live_id)
                        try:
                            await websocket.send_text(json.dumps({
                                "type": "live.error",
                                "code": "queue_timeout",
                                "message": "排队等待超时，请稍后重试",
                            }, ensure_ascii=False))
                        except Exception:
                            pass
                        await websocket.close(code=4408, reason="queue timeout")
                        return
            except WebSocketDisconnect:
                await slots.dequeue(live_id)
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
                # tech_* 走联网预取真实面经（仅用于对齐当下考点，失败/超时降级）
                web_context = ""
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
                    except Exception as ctx_err:
                        logger.warning(
                            f"[ws] live_id={live_id} 拉候选人背景失败（不影响继续）: {ctx_err}"
                        )

                # tech_* 联网预取：Redis 缓存命中 < 100ms；首次 miss 走 _prefetch_web_context
                # 带 3s 超时，失败/非 tech_* 静默降级为 ""，不影响面试启动。
                if row.interview_type in ("tech_8gu", "tech_project", "tech_scenario") and row.target_role:
                    try:
                        web_context = await _fetch_live_web_context(
                            target_role=row.target_role or "",
                            target_grade=row.job_level or "",
                            experience_years=(user_profile_dict or {}).get("experience_years", "") or "",
                        )
                    except Exception as web_err:
                        logger.info(
                            f"[ws] live_id={live_id} 联网预取异常（不影响继续）: {web_err!r}"
                        )
                        web_context = ""

                # pick_intro_questions 现在是 async（tech_* 走 LLM 动态出题，
                # 失败降级硬编码）；不影响 hr_*/non_tech 行为。
                intro_content = await pick_intro_questions(
                    interview_type=row.interview_type,
                    profile=user_profile_dict,
                    projects=projects_list,
                    resume_summary=resume_summary_dict,
                    target_role=row.target_role or "",
                    web_context=web_context,
                    target_grade=row.job_level or "",
                    experience_years=(user_profile_dict or {}).get("experience_years", "") or "",
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
                    web_context=web_context,
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
                    # 火山服务端空闲超时：原默认 60s 太短，候选人思考停顿超过 1 分钟
                    # 会被 DialogAudioIdleTimeoutError(52000042) 强制断连。改成 180s，
                    # 与本地 watchdog PING_TIMEOUT_S=180 对齐，留 3 分钟思考窗口。
                    recv_timeout=180,
                )
                await volc_bridge.connect()
                # 触发 AI 开场白（SayHello）：用 pick_intro_questions 选出的「按背景开场白」
                try:
                    await volc_bridge.say_hello(content=intro_content or "")
                except Exception as e:
                    logger.warning(f"[ws] live_id={live_id} SayHello 失败（不影响连接）: {e}")

                # PR-N: 并行接一条火山流式短语音识别通道，独立于 realtime dialog，
                # 用于把候选人 mic 文本实时上屏（realtime dialog 不回推 ASR 文本）。
                # api_key 用 .env 里 VOLC_STREAMING_ASR_API_KEY（短语音识别产品的独立 key），
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
                                api_key=settings.VOLC_STREAMING_ASR_API_KEY,
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
        bridge = LiveSessionBridge(ws=websocket, row=row, db=db, volc=volc_bridge, asr_bridge=asr_bridge, slots=slots)
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
        # 释放并发槽位（双保险：即便 bridge 未跑到 _on_close 也确保释放；ZREM 幂等）
        if slot_held:
            try:
                await slots.release(live_id)
            except Exception as e:
                logger.warning(f"[ws] live_id={live_id} 释放槽位失败: {e}")
        await db.close()


@router.get("/_stats")
async def live_slots_stats(
    current_user=Depends(get_current_user_optional),
    redis: aioredis.Redis = Depends(get_redis),
):
    """实时面试并发/排队水位（登录用户可见），便于线上观测。

    curl -H "Authorization: Bearer <token>" http://host/api/live/_stats
    """
    if current_user is None:
        raise HTTPException(status_code=401, detail="需要登录")
    slots = make_slot_manager(redis)
    return {
        "active": await slots.active_count(),
        "queue": await slots.queue_len(),
        "cap": settings.LIVE_MAX_CONCURRENT,
        "queue_max": settings.LIVE_QUEUE_MAX,
    }
