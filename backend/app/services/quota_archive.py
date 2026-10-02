from datetime import datetime, timedelta
from typing import Optional
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from app import models
from app.services.quota import (
    get_effective_membership,
    TIER_QUOTAS,
    TIER_WINDOW_DAYS,
    _count_used,
    EXTRA_QUOTA_FIELDS,
    _ALL_FEATURES
)
import logging

logger = logging.getLogger(__name__)

async def get_or_create_extra_quota(db: AsyncSession, user_id: int) -> models.UserExtraQuota:
    stmt = select(models.UserExtraQuota).where(models.UserExtraQuota.user_id == user_id)
    res = await db.execute(stmt)
    extra = res.scalars().first()
    if not extra:
        extra = models.UserExtraQuota(
            user_id=user_id,
            resume_remain=0,
            record_remain=0,
            audio_remain=0,
            live_remain_min=0,
            advisor_remain=0,
        )
        db.add(extra)
        await db.flush()
    return extra

async def archive_and_transfer_cycle_quota(db: AsyncSession, user: models.User):
    """
    Called when a user purchases a new subscription while their current one is active.
    Calculates the unused cycle quota for the current subscription, transfers it to
    the permanent UserExtraQuota, and archives the usages within the current rolling window.
    This ensures that when the new subscription starts, the user gets their new full cycle quota,
    and their previously unused quota is not overwritten but accumulated as permanent extra quota.
    """
    eff = await get_effective_membership(db, user)
    quota_dict = TIER_QUOTAS.get(eff, TIER_QUOTAS["free"])
    window_days = TIER_WINDOW_DAYS.get(eff)
    
    extra = await get_or_create_extra_quota(db, user.id)
    
    for feat in _ALL_FEATURES:
        max_count = quota_dict.get(feat, 0)
        used = await _count_used(db, user, feat, window_days=window_days)
        cycle_remain = max(0, max_count - used)
        
        # Transfer unused cycle quota to extra quota
        if cycle_remain > 0:
            field = EXTRA_QUOTA_FIELDS[feat]
            current_extra = getattr(extra, field, 0)
            setattr(extra, field, current_extra + cycle_remain)
            logger.info(f"Transferred {cycle_remain} unused {feat} quota to extra for user {user.id}")
            
        # Archive usages in the window so they don't count against the new subscription
        if window_days is not None and window_days > 0:
            cutoff = datetime.utcnow() - timedelta(days=window_days)
            stmt = update(models.UserQuotaUsage).where(
                models.UserQuotaUsage.user_id == user.id,
                models.UserQuotaUsage.feature == feat,
                models.UserQuotaUsage.used_at >= cutoff
            ).values(feature=feat + "_archived")
            await db.execute(stmt)
        else:
            # If no window (e.g. test or free), archive all
            stmt = update(models.UserQuotaUsage).where(
                models.UserQuotaUsage.user_id == user.id,
                models.UserQuotaUsage.feature == feat
            ).values(feature=feat + "_archived")
            await db.execute(stmt)
    from app.routers.live import MEMBERSHIP_MONTHLY_MINUTES, period_key_for
    from sqlalchemy import func
    limit_min = MEMBERSHIP_MONTHLY_MINUTES.get(eff, 0)
    now = datetime.utcnow()
    mk = period_key_for("month", now)
    
    used_res = await db.execute(
        select(func.coalesce(func.sum(models.UserLiveMinutes.total_seconds), 0))
        .where(
            models.UserLiveMinutes.user_id == user.id,
            models.UserLiveMinutes.period_type == "month",
            models.UserLiveMinutes.period_key == mk,
        )
    )
    used_min = int(used_res.scalar() or 0) // 60
    cycle_remain_live = max(0, limit_min - used_min)
    
    if cycle_remain_live > 0:
        extra.live_remain_min += cycle_remain_live
        logger.info(f"Transferred {cycle_remain_live} unused live quota to extra for user {user.id}")
        
    # Archive live usage by renaming the period_key so it no longer counts
    stmt = update(models.UserLiveMinutes).where(
        models.UserLiveMinutes.user_id == user.id,
        models.UserLiveMinutes.period_type == "month",
        models.UserLiveMinutes.period_key == mk
    ).values(period_key=mk + "_archived")
    await db.execute(stmt)

    await db.flush()
