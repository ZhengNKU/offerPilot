"""使用次数配额 helper —— 集中维护配额逻辑。

配额策略（按会员等级差异化）：
  - FREE（membership is None）：每个功能**永久** 1 次，不限时间窗口。
    计数走全表 COUNT(*)，旧记录永远不"过期"。
  - PRO：每个功能 30 天内 10 次。
  - MAX：每个功能 30 天内 30 次。

为什么用 user_quota_usage 表存每次使用时刻：
  - 删除业务记录（InterviewSession / ResumeAnalysis）不会重置配额
    （这是本次修复的核心 bug）
  - PRO/MAX 的 30 天窗口天然支持，无需复杂的"过期"判断
  - FREE 永久 1 次 = 全表 COUNT 即可，逻辑统一

调用方：
  - routers/audio.py 的 5 个入口（check_limit / create_session /
    create_record_session / analyze_audio / 重跑 session 分支）
  - routers/resume.py 的 analyze_resume 入口
  - routers/audio.py 的 GET /api/quota/status（只读，不扣减）
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import models
from app.config import settings


# 功能标识符常量（与 UserQuotaUsage.feature 字段对齐）
FEATURE_AUDIO = "audio"    # 面试录音分析
FEATURE_RECORD = "record"   # 面试记录分析（粘贴文本 / 重跑 session）
FEATURE_RESUME = "resume"   # 简历分析

_ALL_FEATURES = (FEATURE_AUDIO, FEATURE_RECORD, FEATURE_RESUME)


_FEATURE_LABELS = {
    FEATURE_AUDIO: "面试录音分析",
    FEATURE_RECORD: "面试记录分析",
    FEATURE_RESUME: "简历分析",
}


# 内测免费试用天数
TRIAL_DAYS = 30


def _is_trial_expired(user: models.User) -> bool:
    """判断内测用户（test）是否已超过 30 天试用期。

    试用期过后自动降级为 FREE 配额（永久 1 次），配额和额度提示均改回 FREE 语义。
    """
    plan = (user.membership or "").lower()
    if plan != "test":
        return False
    if user.created_at is None:
        return True  # 没有创建时间也降级，保守兜底
    elapsed = datetime.utcnow() - user.created_at.replace(tzinfo=None)
    return elapsed >= timedelta(days=TRIAL_DAYS)


def _is_free_user(user: Optional[models.User]) -> bool:
    """判断是否为"非会员"或"内测用户"（membership 为 None / "free" / "test" / 未知值）。

    所有用户当前均为一次性累计配额（不滚窗），PRO/MAX 暂未上线。
    """
    if user is None:
        return False  # 未登录不视为 FREE，由路由层拦截
    plan = (user.membership or "").lower()
    # 已过试用期的 test 按 free 处理
    if plan == "test" and _is_trial_expired(user):
        return True
    return True


# 允许「知识库题目过期后自动重新生成」的付费档位。
# PRO/MAX 尚未上线 → 当前无人命中该集合 = 所有用户都走 PG 永久缓存，不再烧 LLM token。
# PRO/MAX 上线后无需改动业务代码，membership 落到这两个值即自动恢复刷新能力。
PAID_MEMBERSHIPS = {"pro", "max"}


def is_paid_user(user: Optional[models.User]) -> bool:
    """是否为已生效的付费会员。

    内测（test）不算付费；已过 30 天试用期的 test 更不算。
    """
    if user is None:
        return False
    plan = (user.membership or "").lower()
    if plan == "test":
        return False
    return plan in PAID_MEMBERSHIPS


def can_refresh_knowledge(user: Optional[models.User]) -> bool:
    """知识库题目是否允许因缓存过期而重新调用 LLM 生成。

    - 免费 / 内测 → False：首次生成后永久复用 PG 里的 knowledge_question_cache，
      Redis TTL 过期只是回落到 PG 读取，不触发任何 LLM 调用。
    - 付费（PRO/MAX）→ True：保持「过期后用户点开题谱时静默重生成」的体验。

    注意：这个开关只管「刷新」。首次生成、以及换目标岗位后的重建
    （trigger_knowledge_generation）不受此限制，所有档位一视同仁。
    """
    return is_paid_user(user)


async def can_refresh_knowledge_by_id(db: AsyncSession, user_id: int) -> bool:
    """按 user_id 查库再判定，供只有 user_id 的 service 层（question_generator）调用。

    查不到用户 / 查询异常一律按 False 兜底（宁可不刷新，也不误烧 token）。
    """
    try:
        result = await db.execute(
            select(models.User).where(models.User.id == user_id)
        )
        user = result.scalars().first()
    except Exception:
        return False
    return can_refresh_knowledge(user)


def get_quota_for(user: Optional[models.User]) -> dict:
    """根据会员等级返回该用户的功能配额表。

    返回 dict[feature, max_count]。
    未登录用户 / 异常 membership 一律按 FREE 算（保守兜底）。
    """
    if user is None:
        return settings.QUOTA_FREE
    plan = (user.membership or "").lower()
    if plan == "test":
        if _is_trial_expired(user):
            return settings.QUOTA_FREE
        return settings.QUOTA_TEST
    # None 或其他未知值 → FREE
    return settings.QUOTA_FREE


async def _count_used(
    db: AsyncSession,
    user: models.User,
    feature: str,
    *,
    windowed: bool,
) -> int:
    """统计已用次数。

    windowed=True  → 按 30 天窗口过滤（PRO/MAX 用）
    windowed=False → 全表 COUNT（FREE 用，永久累计）
    """
    stmt = select(func.count(models.UserQuotaUsage.id)).where(
        models.UserQuotaUsage.user_id == user.id,
        models.UserQuotaUsage.feature == feature,
    )
    if windowed:
        cutoff = datetime.utcnow() - timedelta(days=settings.QUOTA_WINDOW_DAYS)
        stmt = stmt.where(models.UserQuotaUsage.used_at >= cutoff)
    res = await db.execute(stmt)
    return res.scalar() or 0


async def get_remaining(db: AsyncSession, user: Optional[models.User], feature: str) -> int:
    """返回当前剩余次数（>=0）。未登录用户按 FREE 配额算剩余。"""
    if feature not in _ALL_FEATURES:
        raise ValueError(f"unknown feature: {feature!r}")
    if user is None:
        return settings.QUOTA_FREE.get(feature, 0)

    quota_dict = get_quota_for(user)
    max_count = quota_dict.get(feature, 0)
    used = await _count_used(db, user, feature, windowed=not _is_free_user(user))
    return max(0, max_count - used)


async def get_status(db: AsyncSession, user: Optional[models.User]) -> dict:
    """返回 {feature: {used, remaining, max}, membership} 结构给前端展示。"""
    membership = (user.membership if user else None) or "free"
    quota_dict = get_quota_for(user)
    windowed = user is not None and not _is_free_user(user)

    out: dict = {"membership": membership}
    for feat in _ALL_FEATURES:
        max_count = quota_dict.get(feat, 0)
        if user is None:
            used = 0
        else:
            used = await _count_used(db, user, feat, windowed=windowed)
        out[feat] = {
            "used": used,
            "max": max_count,
            "remaining": max(0, max_count - used),
        }
    return out


async def check_and_consume(
    db: AsyncSession,
    user: Optional[models.User],
    feature: str,
) -> int:
    """检查配额并记录本次使用。

    - 返回扣减后的剩余次数（>=0）
    - 未登录：抛 403（路由层应提前拦截）
    - 配额耗尽：抛 403，文案带会员升级提示
    - 通过：写入一条 UserQuotaUsage 并 commit，返回 remaining-1

    配额语义：
      - FREE 用户：永久 1 次，旧记录不"过期"
      - PRO 用户：30 天内 10 次
      - MAX 用户：30 天内 30 次

    并发说明：本实现采用"先 SELECT COUNT 再 INSERT"两步式，理论上极端并发（同
    用户同一功能毫秒级并发）可能让配额多扣 1 次。面试分析是重操作（LLM 30-90s），
    并发窗口极小；如未来需要严格并发控制，可在 User 表加 audio_used_at /
    record_used_at / resume_used_at 三个 DateTime 字段做乐观锁。
    """
    if feature not in _ALL_FEATURES:
        raise ValueError(f"unknown feature: {feature!r}")

    if user is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="请先登录后再使用此功能",
        )

    quota_dict = get_quota_for(user)
    max_count = quota_dict.get(feature, 0)
    if max_count <= 0:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"当前会员等级不支持{_FEATURE_LABELS[feature]}，请升级会员",
        )

    is_free = _is_free_user(user)
    used = await _count_used(db, user, feature, windowed=not is_free)

    if used >= max_count:
        plan = (user.membership or "").lower()
        if plan == "test":
            detail = (
                f"您的内测{_FEATURE_LABELS[feature]}额度已用完（{max_count} 次），"
                f"内测期间无重置，敬请期待正式版！"
            )
        else:
            detail = (
                f"您已使用过{_FEATURE_LABELS[feature]}的免费体验，"
                f"剩余次数不足，敬请期待后续更多功能！"
            )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=detail,
        )

    # 通过：记录本次使用
    # 注意：只用 flush 不 commit，让调用方控制事务边界，
    # 避免调用方同一 session 里的其他 pending 更改被提前提交。
    db.add(models.UserQuotaUsage(user_id=user.id, feature=feature))
    await db.flush()
    return max_count - used - 1