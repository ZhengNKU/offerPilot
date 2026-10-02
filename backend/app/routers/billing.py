from datetime import datetime
from typing import Dict, Any, Optional
import logging
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import HTMLResponse, RedirectResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import models
from app.config import settings
from app.database import get_db
from app.routers.auth import get_current_user
from app.services.payment.billing_service import (
    create_billing_order,
    query_order_status,
    fulfill_payment_order,
    get_user_active_subscription,
    get_or_create_extra_quota,
)
from app.services.payment.wechat_pay import decrypt_wechat_resource
from app.services.payment.alipay_pay import (
    alipay_credentials_ready,
    build_alipay_wap_pay_url,
    verify_alipay_signature,
)
from app.services.payment.plans import get_plan

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/billing", tags=["Billing & Payments"])


class CreateOrderRequest(BaseModel):
    plan_id: str
    channel: str  # "wechat" | "alipay"


def _pay_notice(title: str, detail: str) -> HTMLResponse:
    """扫码后遇到订单异常时给手机看的一页提示。

    不用裸 JSON：扫码的是手机浏览器，用户读不懂 {"detail": ...}。
    也不直接跳首页：那样看不出订单到底怎么了。这里自带一小段 HTML，
    不依赖前端有对应路由。
    """
    base = (settings.PUBLIC_BASE_URL or "").rstrip("/")
    home = f"{base}/home" if base else "/home"
    return HTMLResponse(
        content=f"""<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title}</title></head>
<body style="margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f7f8fa;color:#1f2329;font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif">
<div style="text-align:center;padding:32px">
<div style="font-size:18px;font-weight:600;margin-bottom:8px">{title}</div>
<div style="font-size:14px;color:#646a73;margin-bottom:24px">{detail}</div>
<a href="{home}" style="display:inline-block;padding:10px 22px;border-radius:999px;background:#1677ff;color:#fff;text-decoration:none;font-size:14px">返回网站</a>
</div></body></html>"""
    )


@router.get("/pay/{order_no}")
async def api_pay_redirect(order_no: str, db: AsyncSession = Depends(get_db)):
    """
    二维码里编码的短链：手机扫码后落到这里，再 302 到支付宝收银台。

    公开无鉴权——扫码入口必须公开，且付款人可能不是下单账号本人。
    order_no 自带 6 位随机后缀，最坏情况是他人替这笔订单付款，
    不构成越权获取任何东西。
    """
    stmt = select(models.Order).where(models.Order.order_no == order_no)
    res = await db.execute(stmt)
    order = res.scalars().first()
    if not order:
        return _pay_notice("订单不存在", "请回到电脑页面重新下单。")

    if order.status == "paid":
        return _pay_notice("该订单已支付", "无需重复付款，可以直接回到网站使用。")

    now = datetime.utcnow()
    if order.expired_at <= now:
        return _pay_notice("订单已过期", "请回到电脑页面重新下单。")

    # 支付宝要求 timeout_express 不短于 1 分钟，卡在临界点上网关会直接报错；
    # 留 2 分钟余量，不够就当作已过期，别让用户扫进去才发现付不了。
    if (order.expired_at - now).total_seconds() < 120:
        return _pay_notice("订单即将过期", "请回到电脑页面重新下单。")

    if not alipay_credentials_ready():
        return _pay_notice("支付通道未配置", "请联系客服处理。")

    # 属性在下面这一句里就地读完：中间没有 await，不会踩 ORM 异步惰性加载的坑。
    url = build_alipay_wap_pay_url(
        order_no=order.order_no,
        amount_cents=order.amount,
        subject=f"面试驾到-{order.plan_name}",
        expire_at=order.expired_at,
    )
    logger.info(f"支付宝收银台跳转: order_no={order.order_no}, amount={order.amount}")
    return RedirectResponse(url=url, status_code=status.HTTP_302_FOUND)


@router.post("/create_order")
async def api_create_order(
    req: CreateOrderRequest,
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    创建支付订单并生成二维码链接
    """
    plan = get_plan(req.plan_id)
    if not plan:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"无效的方案档位: {req.plan_id}",
        )

    try:
        order = await create_billing_order(
            db=db,
            user=current_user,
            plan_id=req.plan_id,
            payment_channel=req.channel,
        )
        return {
            "order_no": order.order_no,
            "plan_id": order.plan_id,
            "plan_name": order.plan_name,
            "amount": round(order.amount / 100, 2),
            "payment_channel": order.payment_channel,
            "qr_code_url": order.qr_code_url,
            "expired_at": order.expired_at.isoformat(),
        }
    except Exception as e:
        logger.error(f"创建订单失败: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"下单失败: {str(e)}",
        )


@router.get("/order/{order_no}/status")
async def api_query_order_status(
    order_no: str,
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    查询订单状态（供前端轮询）
    """
    result = await query_order_status(db, order_no, current_user.id)
    if not result:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="未找到对应订单",
        )
    return result


@router.post("/order/{order_no}/dev_simulate_pay")
async def api_dev_simulate_pay(
    order_no: str,
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    开发测试环境辅助接口：仅在开发/未绑定真实微信支付时允许模拟支付成功，
    真实调用 fulfill_payment_order 完成履约、写入 subscriptions 并更新 user.membership。
    """
    stmt = select(models.Order).where(
        models.Order.order_no == order_no,
        models.Order.user_id == current_user.id,
    )
    res = await db.execute(stmt)
    order = res.scalars().first()
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="未找到对应订单")

    if order.status == "paid":
        return {"message": "订单已履约", "status": order.status}

    success = await fulfill_payment_order(db, order.order_no, f"DEV_MOCK_TX_{int(datetime.utcnow().timestamp())}")
    return {"message": "模拟支付履约成功", "status": "paid", "success": success}


@router.post("/webhook/wechat")
async def api_wechat_webhook(request: Request, db: AsyncSession = Depends(get_db)):
    """
    微信支付 V3 异步通知回调
    """
    try:
        body = await request.json()
        event_type = body.get("event_type")
        resource = body.get("resource", {})

        if event_type == "TRANSACTION.SUCCESS":
            # 解密密文
            decrypted = decrypt_wechat_resource(
                nonce=resource.get("nonce", ""),
                ciphertext=resource.get("ciphertext", ""),
                associated_data=resource.get("associated_data", ""),
            )
            out_trade_no = decrypted.get("out_trade_no")
            transaction_id = decrypted.get("transaction_id", "")
            trade_state = decrypted.get("trade_state")

            if trade_state == "SUCCESS" and out_trade_no:
                await fulfill_payment_order(db, out_trade_no, transaction_id)

        return {"code": "SUCCESS", "message": "成功"}
    except Exception as e:
        logger.error(f"微信支付回调处理异常: {e}", exc_info=True)
        # 即使失败也需按微信规范应答
        return {"code": "FAIL", "message": str(e)}


@router.post("/webhook/alipay")
async def api_alipay_webhook(request: Request, db: AsyncSession = Depends(get_db)):
    """
    支付宝异步通知回调
    """
    try:
        form_data = await request.form()
        params = dict(form_data)
        out_trade_no = params.get("out_trade_no")
        trade_no = params.get("trade_no", "")
        trade_status = params.get("trade_status")

        # 验签
        is_valid = verify_alipay_signature(params)
        if not is_valid:
            logger.warning(f"支付宝回调签名校验失败: {out_trade_no}")
            return Response(content="fail", media_type="text/plain")

        if trade_status in ("TRADE_SUCCESS", "TRADE_FINISHED") and out_trade_no:
            await fulfill_payment_order(db, out_trade_no, trade_no)

        return Response(content="success", media_type="text/plain")
    except Exception as e:
        logger.error(f"支付宝回调处理异常: {e}", exc_info=True)
        return Response(content="fail", media_type="text/plain")


@router.get("/my_plan")
async def api_get_my_plan(
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    获取当前用户的会员周期与加油包资产明细
    """
    active_sub = await get_user_active_subscription(db, current_user.id)
    extra = await get_or_create_extra_quota(db, current_user.id)

    now = datetime.utcnow()
    has_active_sub = active_sub is not None and active_sub.end_time > now

    membership = active_sub.tier if has_active_sub else "free"
    expire_at = active_sub.end_time.isoformat() if has_active_sub else None
    remaining_days = max(0, (active_sub.end_time - now).days) if has_active_sub else 0

    return {
        "membership": membership,
        "has_active_sub": has_active_sub,
        "expire_at": expire_at,
        "remaining_days": remaining_days,
        "extra_quota": {
            "resume": extra.resume_remain,
            "record": extra.record_remain,
            "audio": extra.audio_remain,
            "live_min": extra.live_remain_min,
            "advisor": extra.advisor_remain,
        },
    }
