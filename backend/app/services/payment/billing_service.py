import uuid
from datetime import datetime, timedelta
from typing import Dict, Any, Optional
import logging
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app import models
from app.services.payment.plans import get_plan, PlanDefinition
from app.services.payment.wechat_pay import create_wechat_native_order, query_wechat_order
from app.services.payment.alipay_pay import (
    alipay_credentials_ready,
    build_alipay_pay_short_link,
    query_alipay_order,
)

logger = logging.getLogger(__name__)

async def get_user_active_subscription(db: AsyncSession, user_id: int) -> Optional[models.UserSubscription]:
    """
    获取用户当前最晚到期的有效周期订阅
    """
    now = datetime.utcnow()
    stmt = (
        select(models.UserSubscription)
        .where(
            models.UserSubscription.user_id == user_id,
            models.UserSubscription.status == "active",
            models.UserSubscription.end_time > now,
        )
        .order_by(models.UserSubscription.end_time.desc())
        .limit(1)
    )
    res = await db.execute(stmt)
    return res.scalars().first()

async def get_or_create_extra_quota(db: AsyncSession, user_id: int) -> models.UserExtraQuota:
    """
    获取或初始化用户的加油包永久额度资产行
    """
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

async def create_billing_order(
    db: AsyncSession,
    user: models.User,
    plan_id: str,
    payment_channel: str,
) -> models.Order:
    """
    创建支付订单并调用渠道预下单获取二维码
    """
    plan = get_plan(plan_id)
    if not plan:
        raise ValueError(f"未知的会员/加油包方案: {plan_id}")

    if payment_channel not in ("wechat", "alipay"):
        raise ValueError(f"不支持的支付渠道: {payment_channel}")

    now = datetime.utcnow()
    # 格式: OP + YYYYMMDDHHMMSS + 6位UUID大写
    order_no = f"OP{now.strftime('%Y%m%d%H%M%S')}{uuid.uuid4().hex[:6].upper()}"
    expired_at = now + timedelta(minutes=15)

    # 调用支付网关获取二维码
    qr_code_url = ""
    description = f"面试驾到-{plan.name}"

    if payment_channel == "wechat":
        result = await create_wechat_native_order(
            order_no=order_no,
            amount_cents=plan.price_cents,
            description=description,
        )
        qr_code_url = result.get("code_url") or ""
    elif payment_channel == "alipay":
        # 走「手机网站支付」，它是跳转式产品、没有原生二维码。这里只落一条指向本服务的短链，
        # 真正带签名的网关 URL 由 GET /api/billing/pay/{order_no} 在被扫码那一刻现签现用
        # （支付宝校验 timestamp 窗口，预生成的签到用户扫码时早就失效了）。
        if not alipay_credentials_ready():
            logger.warning("Alipay credentials not configured; returning mock qr_code for development.")
            qr_code_url = f"https://qr.alipay.com/mock_{order_no}"
        else:
            qr_code_url = build_alipay_pay_short_link(order_no)

    # 构造并写入订单表
    order = models.Order(
        order_no=order_no,
        user_id=user.id,
        plan_id=plan.id,
        plan_category=plan.category,
        plan_name=plan.name,
        amount=plan.price_cents,
        payment_channel=payment_channel,
        status="pending",
        qr_code_url=qr_code_url,
        expired_at=expired_at,
        snapshot_benefits={
            "days": plan.days,
            "benefits": plan.benefits,
            "advisor_daily": plan.advisor_daily,
        },
    )
    db.add(order)
    await db.commit()
    await db.refresh(order)
    return order

async def fulfill_payment_order(
    db: AsyncSession,
    order_no: str,
    trade_no: str,
) -> bool:
    """
    核心履约发货逻辑 (含 SELECT FOR UPDATE 行级互斥锁，严格防并发与重复回调)
    """
    stmt = select(models.Order).where(models.Order.order_no == order_no).with_for_update()
    res = await db.execute(stmt)
    order = res.scalars().first()

    if not order:
        logger.error(f"履约失败: 订单 {order_no} 不存在")
        return False

    # 幂等校验：已支付则直接返回成功
    if order.status == "paid":
        return True

    now = datetime.utcnow()
    order.status = "paid"
    order.trade_no = trade_no
    order.paid_at = now

    plan = get_plan(order.plan_id)
    if not plan:
        logger.error(f"订单 {order_no} 的方案 {order.plan_id} 在配置表中未找到")
        await db.commit()
        return True

    user = await db.get(models.User, order.user_id)
    if not user:
        logger.error(f"订单 {order_no} 关联的用户 {order.user_id} 不存在")
        await db.commit()
        return True

    # 1. 周期会员升级与续费逻辑
    if plan.category == "subscription":
        active_sub = await get_user_active_subscription(db, user.id)
        if active_sub:
            # 原有会员有效期未满 -> 在现有结束时间上顺延！原有效天数 100% 保留
            # 叠加购买：计算当前旧周期的剩余额度，将其转移到加油包（永久保留），并重置使用记录
            from app.services.quota_archive import archive_and_transfer_cycle_quota
            await archive_and_transfer_cycle_quota(db, user)

            start_time = active_sub.end_time
            end_time = start_time + timedelta(days=plan.days)
        else:
            # 原会员已过期或新开通 -> 从当前时刻起算
            start_time = now
            end_time = now + timedelta(days=plan.days)

        new_sub = models.UserSubscription(
            user=user,
            user_id=user.id,
            order_id=order.id,
            tier=plan.code,
            start_time=start_time,
            end_time=end_time,
            status="active",
        )
        db.add(new_sub)
        # 会员等级立即升级为新购买档位
        user.membership = plan.code

    # 2. 单次加油包逻辑 (永久有效 · 随用随抵)
    elif plan.category == "pack":
        extra = await get_or_create_extra_quota(db, user.id)
        benefits = plan.benefits
        extra.resume_remain += benefits.get("resume", 0)
        extra.record_remain += benefits.get("record", 0)
        extra.audio_remain += benefits.get("audio", 0)
        extra.live_remain_min += benefits.get("live", 0)
        extra.advisor_remain += benefits.get("advisor", 0)

    await db.commit()
    logger.info(f"订单 {order_no} 履约成功! 用户ID: {user.id}, 档位: {plan.name}")
    return True

async def query_order_status(
    db: AsyncSession,
    order_no: str,
    user_id: int,
) -> Optional[Dict[str, Any]]:
    """
    查询订单状态（供前端轮询）
    """
    stmt = select(models.Order).where(
        models.Order.order_no == order_no,
        models.Order.user_id == user_id,
    )
    res = await db.execute(stmt)
    order = res.scalars().first()
    if not order:
        return None

    # 超时自动标记 expired
    now = datetime.utcnow()
    if order.status == "pending" and order.expired_at < now:
        order.status = "expired"
        await db.commit()

    # 主动向微信支付查单一次（支持本地开发环境在无公网 Webhook 时的自动扫码履约）
    if order.status == "pending" and order.payment_channel == "wechat":
        try:
            wechat_res = await query_wechat_order(order.order_no)
            if wechat_res and wechat_res.get("trade_state") == "SUCCESS":
                tx_id = wechat_res.get("transaction_id", "")
                await fulfill_payment_order(db, order.order_no, tx_id)
                await db.refresh(order)
        except Exception as e:
            logger.warning(f"主动轮询微信订单状态异常 (order_no={order.order_no}): {e}")

    # 主动向支付宝查单一次（本地/沙箱环境无公网 Webhook 时的自动扫码履约）
    elif order.status == "pending" and order.payment_channel == "alipay":
        try:
            alipay_res = await query_alipay_order(order.order_no)
            if alipay_res and alipay_res.get("trade_status") in ("TRADE_SUCCESS", "TRADE_FINISHED"):
                trade_no = alipay_res.get("trade_no", "")
                await fulfill_payment_order(db, order.order_no, trade_no)
                await db.refresh(order)
        except Exception as e:
            logger.warning(f"主动轮询支付宝订单状态异常 (order_no={order.order_no}): {e}")

    return {
        "order_no": order.order_no,
        "status": order.status,
        "plan_id": order.plan_id,
        "plan_name": order.plan_name,
        "amount": round(order.amount / 100, 2),
        "payment_channel": order.payment_channel,
        "paid_at": order.paid_at.isoformat() if order.paid_at else None,
        "expired_at": order.expired_at.isoformat() if order.expired_at else None,
    }
