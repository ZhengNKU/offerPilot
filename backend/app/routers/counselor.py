"""AI 职业顾问路由（SSE 流式对话 + 会话 CRUD）。

端点：
  POST   /api/counselor/chat                - SSE 流式对话
  GET    /api/counselor/sessions            - 列出会话
  GET    /api/counselor/sessions/{id}       - 会话详情
  DELETE /api/counselor/sessions/{id}       - 删除会话

权限：所有端点必须登录。
"""
import asyncio
import json
import logging
from datetime import datetime, timedelta
from typing import List, Optional

import redis.asyncio as aioredis
from fastapi import APIRouter, Depends, HTTPException, Query, status, BackgroundTasks
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app import models
from app.database import get_db, get_redis
from app.routers.auth import get_current_user
from app.services.counselor_agent import stream_chat

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/counselor", tags=["Counselor"])


# 进程内停止信号表：key=session_id，value=asyncio.Event
# 仅在 FastAPI 单进程内有效（跨进程需要 Redis pub/sub，本次不做）
_stop_signals: dict[int, asyncio.Event] = {}


# ============================================================================
# Pydantic Schemas
# ============================================================================

class ChatRequest(BaseModel):
    session_id: Optional[int] = Field(None, description="已存在会话的 id；新会话传 null")
    message: str = Field(..., min_length=1, max_length=4000, description="用户提问")


class SessionListItem(BaseModel):
    id: int
    title: str
    summary: Optional[str] = None
    message_count: int
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class MessageItem(BaseModel):
    id: int
    role: str
    content: str
    citations: list
    recalled_chunks: list = []
    created_at: Optional[str] = None


class SessionDetail(BaseModel):
    id: int
    title: str
    summary: Optional[str] = None
    message_count: int
    has_summary: bool
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    messages: List[MessageItem]


# ============================================================================
# 速率限制
# ============================================================================

DAILY_LIMIT = {
    None: 1,     # 免费：1 次/天（≈30次/月）
    "test": 30,   # 内测：30 次/天；注册起 30 天后过期降级为免费
}


async def _check_rate_limit(redis_client: aioredis.Redis, user_id: int, membership: Optional[str]) -> int:
    """返回用户今日剩余可用次数；-1 表示超限。"""
    today = datetime.now().strftime("%Y%m%d")
    key = f"counselor:daily:{user_id}:{today}"
    used = int(await redis_client.get(key) or 0)
    limit = DAILY_LIMIT.get(membership, DAILY_LIMIT[None])
    if used >= limit:
        return -1
    # 原子 +1，并设置 25h 过期（保证跨天计数稳定）
    new_val = await redis_client.incr(key)
    if new_val == 1:
        await redis_client.expire(key, 25 * 3600)
    return max(0, limit - int(new_val))


# ============================================================================
# GET /stats - 获取统计数据
# ============================================================================

@router.get("/stats")
async def get_counselor_stats(
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """获取 AI 职业顾问统计数据（面试记录数、简历分析数、项目记忆数、评估维度数、时间跨度）。"""
    # 1. 面试分析记录 (completed)
    interview_stmt = select(func.count(models.InterviewSession.id)).where(
        models.InterviewSession.user_id == current_user.id,
        models.InterviewSession.status == "completed"
    )
    interview_count = (await db.execute(interview_stmt)).scalar() or 0

    # 2. 简历分析记录
    resume_stmt = select(func.count(models.ResumeAnalysis.id)).where(
        models.ResumeAnalysis.user_id == current_user.id
    )
    resume_count = (await db.execute(resume_stmt)).scalar() or 0

    # 3. 项目记忆库
    project_stmt = select(func.count(models.ProjectMemory.id)).where(
        models.ProjectMemory.user_id == current_user.id
    )
    project_count = (await db.execute(project_stmt)).scalar() or 0

    # 4. 时间跨度（从用户注册时间计算）
    time_span_str = "1个月"
    if current_user.created_at:
        now = datetime.now()
        diff_years = now.year - current_user.created_at.year
        diff_months = now.month - current_user.created_at.month
        total_months = diff_years * 12 + diff_months
        if total_months < 1:
            time_span_str = "1个月"
        elif total_months >= 12:
            years = int(total_months / 12)
            time_span_str = f"{years}年"
        else:
            time_span_str = f"{total_months}个月"

    return {
        "interview_count": interview_count,
        "resume_count": resume_count,
        "project_count": project_count,
        "dimension_count": 8,
        "experience_years": time_span_str,
    }


# ============================================================================
# POST /chat - SSE 流式对话
# ============================================================================

@router.post("/chat")
async def chat(
    body: ChatRequest,
    db: AsyncSession = Depends(get_db),
    redis_client: aioredis.Redis = Depends(get_redis),
    current_user: models.User = Depends(get_current_user),
):
    """SSE 流式对话。

    Event 流（Content-Type: text/event-stream）：
      - meta    → {"session_id": int, "user_message_id": int, "message_count": int, "remaining_quota": int}
      - token   → {"text": "..."}   每个 LLM token
      - done    → {"msg_id": int, "citations": [...], "recalled_chunks": [...], "context_summary": {...}}
      - error   → {"message": "..."}
    """
    # 1. 速率限制
    # 内测用户超 30 天试用期 → 按免费算
    eff_membership = current_user.membership
    if eff_membership and eff_membership.lower() == "test":
        from app.services.quota import _is_trial_expired
        if _is_trial_expired(current_user):
            eff_membership = None
    remaining = await _check_rate_limit(redis_client, current_user.id, eff_membership)
    if remaining < 0:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"今日咨询次数已用完（{DAILY_LIMIT.get(eff_membership, 20)} 次/天），明天再来或升级会员",
        )

    # 2. 获取/创建 session
    session_id = body.session_id
    if session_id is None:
        # title 直接用用户问题截断（≤30 字），这样即使中途停止，历史会话列表也有可读标识
        initial_title = (body.message or "新会话")[:30]
        sess = models.CounselorSession(
            user_id=current_user.id,
            title=initial_title,
            message_count=0,
            status="active",
        )
        db.add(sess)
        await db.commit()
        await db.refresh(sess)
        session_id = sess.id
    else:
        sess = await db.get(models.CounselorSession, session_id)
        if not sess or sess.user_id != current_user.id:
            raise HTTPException(status_code=404, detail="会话不存在或无权访问")

    # 2.5 注册本会话的停止事件，供 stop API 触发
    stop_event = asyncio.Event()
    _stop_signals[session_id] = stop_event

    # 3. SSE 事件生成器
    async def event_gen():
        # 记录最终状态，finally 写入 session.status
        final_status: dict[str, str] = {"value": "stopped"}
        try:
            async for event in stream_chat(
                db=db,
                user_id=current_user.id,
                session_id=session_id,
                user_message=body.message,
                stop_event=stop_event,
            ):
                # event["data"] 已经是 dict；meta 事件里附加剩余 quota
                if event.get("event") == "meta" and isinstance(event.get("data"), dict):
                    event["data"]["remaining_quota"] = remaining
                    event["data"]["session_id"] = session_id
                # agent 自己在 done/stopped/error 之后会更新 session.status
                if event.get("event") == "done":
                    final_status["value"] = "completed"
                elif event.get("event") == "stopped":
                    final_status["value"] = "stopped"
                elif event.get("event") == "error":
                    final_status["value"] = "failed"
                data_str = event["data"] if isinstance(event["data"], str) else json.dumps(event["data"], ensure_ascii=False)
                yield f"event: {event['event']}\ndata: {data_str}\n\n"
        except asyncio.CancelledError:
            # 客户端断开（SSE 链路中断）；agent 已在外层 try/finally 落过 status
            logger.info(f"[counselor] SSE client disconnected, session={session_id}")
            raise
        except Exception as e:
            logger.error(f"[counselor] SSE 顶层异常: {e!r}")
            # 2026-07-25+: 统一报错文案
            try:
                from app.utils.error_messages import (
                    FEATURE_COUNSEL as FEATURE_NAME_COUNSEL,
                    format_failure,
                )
                reason = str(e) or "未知原因"
                if len(reason) > 200:
                    reason = reason[:200] + "..."
                user_message = format_failure(FEATURE_NAME_COUNSEL, reason)
            except Exception:
                user_message = "AI 职业顾问失败：未知原因"
            yield f"event: error\ndata: {json.dumps({'message': user_message}, ensure_ascii=False)}\n\n"
            # 兜底写入 failed
            try:
                sess2 = await db.get(models.CounselorSession, session_id)
                if sess2:
                    sess2.status = "failed"
                    await db.commit()
            except Exception as db_e:
                logger.error(f"[counselor] 写 failed 状态到 DB 失败 session_id={session_id}: {db_e}")
        finally:
            _stop_signals.pop(session_id, None)
            logger.debug(f"[counselor] stop_signal cleared for session={session_id}, final={final_status['value']}")

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # 禁用 nginx 缓冲
        },
    )


# ============================================================================
# POST /sessions/{id}/stop - 主动停止正在进行的会话
# ============================================================================

@router.post("/sessions/{session_id}/stop")
async def stop_session(
    session_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """主动停止会话：
    1) 把 session.status 设为 stopped（落库，对调试/列表可见）
    2) 触发进程内 stop_event，stream_chat 的下一个 token 循环会跳出，走 partial save 路径
    """
    sess = await db.get(models.CounselorSession, session_id)
    if not sess or sess.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="会话不存在")
    if sess.status not in ("active", "streaming"):
        # 已经在 completed/stopped/failed 状态，幂等返回
        return {"message": "已停止", "status": sess.status}
    sess.status = "stopped"
    await db.commit()
    ev = _stop_signals.get(session_id)
    if ev is not None:
        ev.set()
    logger.info(f"[counselor] stop signal set for session={session_id}")
    return {"message": "已停止", "status": "stopped"}


# ============================================================================
# GET /sessions - 列出会话
# ============================================================================

@router.get("/sessions", response_model=dict)
async def list_sessions(
    limit: int = Query(10, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """列出会话（按更新时间倒序，仅保留最近30天内的会话）"""
    thirty_days_ago = datetime.utcnow() - timedelta(days=30)
    base = select(models.CounselorSession).where(
        models.CounselorSession.user_id == current_user.id,
        models.CounselorSession.updated_at >= thirty_days_ago
    )
    total_stmt = select(func.count()).select_from(base.subquery())
    total = (await db.execute(total_stmt)).scalar() or 0

    stmt = base.order_by(models.CounselorSession.updated_at.desc()).limit(limit).offset(offset)
    result = await db.execute(stmt)
    sessions = result.scalars().all()

    items = [
        SessionListItem(
            id=s.id,
            title=s.title,
            summary=s.summary,
            message_count=s.message_count,
            created_at=s.created_at.isoformat() if s.created_at else None,
            updated_at=s.updated_at.isoformat() if s.updated_at else None,
        )
        for s in sessions
    ]
    return {"sessions": [s.model_dump() for s in items], "total": total}


# ============================================================================
# GET /sessions/{id} - 会话详情
# ============================================================================

@router.get("/sessions/{session_id}", response_model=dict)
async def get_session(
    session_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    sess = await db.get(models.CounselorSession, session_id)
    if not sess or sess.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="会话不存在")

    msg_stmt = (
        select(models.CounselorMessage)
        .where(models.CounselorMessage.session_id == session_id)
        .order_by(models.CounselorMessage.id.asc())
    )
    result = await db.execute(msg_stmt)
    messages = result.scalars().all()

    frontend_messages = []
    for m in messages:
        try:
            if m.content.strip().startswith("[") or m.content.strip().startswith("{"):
                round_msgs = json.loads(m.content)
                for idx, sub_m in enumerate(round_msgs):
                    frontend_messages.append({
                        "id": m.id * 10 + idx,
                        "role": sub_m.get("role", "user"),
                        "content": sub_m.get("content", ""),
                        "citations": m.citations or [] if sub_m.get("role") == "assistant" else [],
                        "recalled_chunks": m.recalled_chunks or [] if sub_m.get("role") == "assistant" else [],
                        "tool_calls": sub_m.get("tool_calls", []) if sub_m.get("role") == "assistant" else [],
                        "reasoning_content": sub_m.get("reasoning_content", "") if sub_m.get("role") == "assistant" else "",
                        "created_at": m.created_at.isoformat() if m.created_at else None,
                    })
            else:
                frontend_messages.append({
                    "id": m.id,
                    "role": "user",
                    "content": m.content,
                    "citations": m.citations or [],
                    "recalled_chunks": m.recalled_chunks or [],
                    "tool_calls": [],
                    "reasoning_content": "",
                    "created_at": m.created_at.isoformat() if m.created_at else None,
                })
        except Exception as json_e:
            logger.warning(
                f"[counselor] JSON 解析消息失败 session_id={session_id} "
                f"msg_id={m.id} role={m.role}: {json_e}"
            )
            frontend_messages.append({
                "id": m.id,
                "role": m.role or "user",  # 保留原始 role,不硬编码 user
                "content": m.content,
                "citations": m.citations or [],
                "recalled_chunks": m.recalled_chunks or [],
                "tool_calls": [],
                "reasoning_content": "",
                "created_at": m.created_at.isoformat() if m.created_at else None,
            })

    return {
        "session": {
            "id": sess.id,
            "title": sess.title,
            "summary": sess.summary,
            "has_summary": bool(sess.summary),
            "message_count": sess.message_count,
            "created_at": sess.created_at.isoformat() if sess.created_at else None,
            "updated_at": sess.updated_at.isoformat() if sess.updated_at else None,
            "messages": frontend_messages,
        }
    }


# ============================================================================
# DELETE /sessions/{id} - 删除会话
# ============================================================================

@router.delete("/sessions/{session_id}")
async def delete_session(
    session_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    sess = await db.get(models.CounselorSession, session_id)
    if not sess or sess.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="会话不存在")
    await db.delete(sess)
    await db.commit()
    return {"message": "删除成功"}


# ============================================================================
# GET /advisor-insights - 获取 AI 顾问专属意见与冷启动基准
# ============================================================================

DEFAULT_BENCHMARK = {
    "focus_areas": [
        "架构表达框架建立",
        "项目指标定量细化",
        "系统设计 trade-off 表达"
    ],
    "interview_trends": [
        "系统设计出现频率上升 23%",
        "分布式相关问题增加明显",
        "面试官更关注工程落地细节"
    ],
    "recommended_actions": [
        "完成 3 次真题模拟面试",
        "优化 2 个核心项目描述",
        "补充架构师深度表达训练"
    ],
    "career_suggestions": [
        "建议向 Staff Engineer 方向准备",
        "提升技术影响力和领导力表达",
        "密切关注一线大厂架构能力变化"
    ],
    "is_customized": False
}

@router.get("/advisor-insights")
async def get_advisor_insights(
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """
    获取当前用户的 AI 顾问意见建议（总览看板）。
    如果不存在任何数据，则写入 generating 状态并异步触发行业通用建议生成。
    """
    stmt = select(models.UserAdvisorInsight).where(models.UserAdvisorInsight.user_id == current_user.id)
    result = await db.execute(stmt)
    insight = result.scalars().first()

    # 已存在有效数据：直接返回
    if insight and not (
        isinstance(insight.insights, dict)
        and insight.insights.get("status") == "generating"
    ):
        return {
            **insight.insights,
            "updated_at": insight.updated_at.isoformat() if insight.updated_at else None
        }

    # 获取用户求职目标岗位
    profile_stmt = select(models.UserProfile).where(models.UserProfile.user_id == current_user.id)
    profile_result = await db.execute(profile_stmt)
    profile = profile_result.scalars().first()
    target_role = (profile.target_role if profile else None) or "高级工程师"

    # 自愈：写入 / 覆盖 generating 记录并触发后台异步生成任务
    generating_insights = {"status": "generating", "target_role": target_role, "is_customized": False}
    if insight:
        insight.insights = generating_insights
    else:
        insight = models.UserAdvisorInsight(
            user_id=current_user.id,
            insights=generating_insights
        )
        db.add(insight)
    await db.commit()

    from app.services.advisor_generator import trigger_general_advisor_insights
    background_tasks.add_task(
        trigger_general_advisor_insights,
        current_user.id,
        target_role,
    )

    return {
        "status": "generating",
        "target_role": target_role,
        "is_customized": False,
        "updated_at": None
    }
