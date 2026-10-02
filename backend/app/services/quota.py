"""使用次数配额 helper —— 集中维护配额与加油包双轨制消耗逻辑。

配额策略（按会员等级差异化与双轨制）：
  - FREE（普通免费用户）：简历 1 次 / 记录 1 次 / 录音 0 次（关闭）
  - TEST（内测体验用户）：简历 3 次 / 记录 3 次 / 录音 2 次（30 天试用期后自动降级为 FREE）
  - WEEK_PRO（周度进阶版）：简历 5 次 / 记录 5 次 / 录音 3 次（7天窗口）
  - WEEK_MAX（周度旗舰版）：简历 10 次 / 记录 10 次 / 录音 5 次（7天窗口）
  - MONTH_PRO（月度专业版）：简历 30 次 / 记录 30 次 / 录音 10 次（30天窗口）
  - MONTH_MAX（月度至尊版）：简历 30 次 / 记录 30 次 / 录音 20 次（30天窗口）

双轨制扣减机制：
  - 用户发起分析时，优先扣减当前周期会员的自然配额；
  - 若周期会员配额已用尽（或免费用户），自动检测并扣减用户的永久加油包资产（user_extra_quotas）；
  - 真正实现“额度随用随抵，加油包永久有效，周期到期无损保留加油包”。
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import models
from app.config import settings


# 功能标识符常量（与 UserQuotaUsage.feature 及 UserExtraQuota 字段对齐）
FEATURE_AUDIO = "audio"    # 面试录音分析
FEATURE_RECORD = "record"   # 面试记录分析（粘贴文本 / 重跑 session）
FEATURE_RESUME = "resume"   # 简历分析

_ALL_FEATURES = (FEATURE_AUDIO, FEATURE_RECORD, FEATURE_RESUME)

_FEATURE_LABELS = {
    FEATURE_AUDIO: "面试录音分析",
    FEATURE_RECORD: "面试记录分析",
    FEATURE_RESUME: "简历分析",
}

EXTRA_QUOTA_FIELDS = {
    FEATURE_AUDIO: "audio_remain",
    FEATURE_RECORD: "record_remain",
    FEATURE_RESUME: "resume_remain",
}

# 6 档位周期配额表 (audio, record, resume)
TIER_QUOTAS = {
    "free": {"audio": 0, "record": 1, "resume": 1},
    "test": {"audio": 2, "record": 3, "resume": 3},
    "week_pro": {"audio": 3, "record": 5, "resume": 5},
    "week_max": {"audio": 5, "record": 10, "resume": 10},
    "month_pro": {"audio": 10, "record": 30, "resume": 30},
    "month_max": {"audio": 20, "record": 30, "resume": 30},
}

# 周期窗口天数
TIER_WINDOW_DAYS = {
    "week_pro": 7,
    "week_max": 7,
    "month_pro": 30,
    "month_max": 30,
}

# 内测免费试用天数
TRIAL_DAYS = 30


def _is_trial_expired(user: models.User) -> bool:
    """判断内测用户（test）是否已超过 30 天试用期。"""
    plan = (user.membership or "").lower()
    if plan != "test":
        return False
    if user.created_at is None:
        return True
    elapsed = datetime.utcnow() - user.created_at.replace(tzinfo=None)
    return elapsed >= timedelta(days=TRIAL_DAYS)


async def get_effective_membership(db: AsyncSession, user: Optional[models.User]) -> str:
    """获取用户当前实际生效的 membership。
    - 若用户无 membership 或为 free，返回 'free'
    - 若为 test，检查是否超过 30 天试用期；过期返回 'free'
    - 若为付费订阅档（week_pro / week_max / month_pro / month_max），检查在 user_subscriptions 中是否有未到期的 active 订阅，无/到期返回 'free'
    """
    if user is None:
        return "free"
    plan = (user.membership or "").lower()
    if not plan or plan == "free":
        return "free"
    if plan == "test":
        if _is_trial_expired(user):
            return "free"
        return "test"

    # 付费订阅档：检查有效订阅
    now = datetime.utcnow()
    stmt = (
        select(models.UserSubscription)
        .where(
            models.UserSubscription.user_id == user.id,
            models.UserSubscription.status == "active",
            models.UserSubscription.end_time > now,
        )
        .order_by(models.UserSubscription.end_time.desc())
        .limit(1)
    )
    res = await db.execute(stmt)
    active_sub = res.scalars().first()
    if not active_sub:
        # 订阅已到期，自动判定回退为 free
        return "free"
    return active_sub.tier.lower()


PAID_MEMBERSHIPS = {"week_pro", "week_max", "month_pro", "month_max", "pro", "max"}


async def is_paid_user(db: AsyncSession, user: Optional[models.User]) -> bool:
    """是否为当前有效的付费会员。"""
    eff = await get_effective_membership(db, user)
    return eff in PAID_MEMBERSHIPS


async def can_refresh_knowledge_by_id(db: AsyncSession, user_id: int) -> bool:
    """按 user_id 判定是否允许知识库重新生成。"""
    try:
        result = await db.execute(
            select(models.User).where(models.User.id == user_id)
        )
        user = result.scalars().first()
    except Exception:
        return False
    return await is_paid_user(db, user)


async def _count_used(
    db: AsyncSession,
    user: models.User,
    feature: str,
    *,
    window_days: Optional[int],
) -> int:
    """统计当前窗口内已用次数。"""
    stmt = select(func.count(models.UserQuotaUsage.id)).where(
        models.UserQuotaUsage.user_id == user.id,
        models.UserQuotaUsage.feature == feature,
    )
    if window_days is not None and window_days > 0:
        cutoff = datetime.utcnow() - timedelta(days=window_days)
        stmt = stmt.where(models.UserQuotaUsage.used_at >= cutoff)
    res = await db.execute(stmt)
    return res.scalar() or 0


async def get_remaining(db: AsyncSession, user: Optional[models.User], feature: str) -> int:
    """返回当前总剩余次数（周期可用 + 加油包可用）。"""
    if feature not in _ALL_FEATURES:
        raise ValueError(f"unknown feature: {feature!r}")
    if user is None:
        return TIER_QUOTAS["free"].get(feature, 0)

    eff = await get_effective_membership(db, user)
    quota_dict = TIER_QUOTAS.get(eff, TIER_QUOTAS["free"])
    max_count = quota_dict.get(feature, 0)
    window_days = TIER_WINDOW_DAYS.get(eff)
    used = await _count_used(db, user, feature, window_days=window_days)
    cycle_remain = max(0, max_count - used)

    # 加上加油包
    field = EXTRA_QUOTA_FIELDS[feature]
    stmt = select(models.UserExtraQuota).where(models.UserExtraQuota.user_id == user.id)
    res = await db.execute(stmt)
    extra = res.scalars().first()
    extra_remain = getattr(extra, field, 0) if extra else 0

    return cycle_remain + extra_remain


async def get_status(db: AsyncSession, user: Optional[models.User]) -> dict:
    """返回完整的额度状态（周期 + 加油包明细）给前端展示。"""
    eff = await get_effective_membership(db, user)
    quota_dict = TIER_QUOTAS.get(eff, TIER_QUOTAS["free"])
    window_days = TIER_WINDOW_DAYS.get(eff)

    extra = None
    if user:
        stmt = select(models.UserExtraQuota).where(models.UserExtraQuota.user_id == user.id)
        res = await db.execute(stmt)
        extra = res.scalars().first()

    out: dict = {"membership": eff}
    for feat in _ALL_FEATURES:
        max_count = quota_dict.get(feat, 0)
        if user is None:
            used = 0
        else:
            used = await _count_used(db, user, feat, window_days=window_days)
        cycle_remain = max(0, max_count - used)
        field = EXTRA_QUOTA_FIELDS[feat]
        extra_remain = getattr(extra, field, 0) if extra else 0
        total_remaining = cycle_remain + extra_remain

        out[feat] = {
            "used": used,
            "max": max_count,
            "cycle_remaining": cycle_remain,
            "extra_remaining": extra_remain,
            "remaining": total_remaining,
        }
    return out


async def check_and_consume(
    db: AsyncSession,
    user: Optional[models.User],
    feature: str,
) -> int:
    """检查配额并扣减（双轨制）：
    - 优先扣除周期会员配额；
    - 周期额度用完时，自动划扣加油包储备余额；
    - 均耗尽时抛出友好 403 异常引导续费/加购。
    """
    if feature not in _ALL_FEATURES:
        raise ValueError(f"unknown feature: {feature!r}")

    if user is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="请先登录后再使用此功能",
        )

    eff = await get_effective_membership(db, user)
    quota_dict = TIER_QUOTAS.get(eff, TIER_QUOTAS["free"])
    max_count = quota_dict.get(feature, 0)
    window_days = TIER_WINDOW_DAYS.get(eff)
    used = await _count_used(db, user, feature, window_days=window_days)
    cycle_remain = max(0, max_count - used)

    # 1. 优先使用周期会员配额
    if cycle_remain > 0:
        db.add(models.UserQuotaUsage(user_id=user.id, feature=feature))
        await db.flush()
        # 返回总剩余
        field = EXTRA_QUOTA_FIELDS[feature]
        stmt = select(models.UserExtraQuota).where(models.UserExtraQuota.user_id == user.id)
        res = await db.execute(stmt)
        extra = res.scalars().first()
        extra_remain = getattr(extra, field, 0) if extra else 0
        return (cycle_remain - 1) + extra_remain

    # 2. 周期配额为 0，尝试消耗单次加油包
    field = EXTRA_QUOTA_FIELDS[feature]
    stmt = (
        select(models.UserExtraQuota)
        .where(models.UserExtraQuota.user_id == user.id)
        .with_for_update()
    )
    res = await db.execute(stmt)
    extra = res.scalars().first()
    extra_remain = getattr(extra, field, 0) if extra else 0

    if extra_remain > 0:
        setattr(extra, field, extra_remain - 1)
        await db.flush()
        return extra_remain - 1

    # 3. 均已耗尽
    detail = (
        f"您的{_FEATURE_LABELS[feature]}额度已用完，"
        f"您可以续费/升级会员套餐，或购买按需即用的额度加油包继续使用！"
    )
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail=detail,
    )
