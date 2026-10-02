import base64
import json
import os
import urllib.parse
from datetime import datetime
import httpx
import logging
from typing import Dict, Any, Optional
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives import hashes, serialization

from app.config import settings

logger = logging.getLogger(__name__)

def _resolve_key_material(key_val: str, pem_type: str) -> Optional[bytes]:
    """
    解析支付宝密钥配置为 PEM bytes。支持三种形式：
    1. 文件路径（绝对 / 相对 backend 目录 / 相对项目根目录）
    2. 带 PEM 头的直接内容
    3. 裸 Base64 内容（控制台一键复制的无头密钥），自动补 PEM 头（PRIVATE KEY / PUBLIC KEY）
    """
    if not key_val:
        return None
    base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    repo_root = os.path.dirname(base_dir)
    for p in (key_val, os.path.join(base_dir, key_val), os.path.join(repo_root, key_val)):
        if os.path.isfile(p):
            with open(p, "rb") as f:
                return f.read()
    content = key_val
    if "-----BEGIN" in content:
        return content.encode("utf-8")
    cleaned = "".join(content.split())
    return (f"-----BEGIN {pem_type}-----\n{cleaned}\n-----END {pem_type}-----").encode("utf-8")

def _load_alipay_private_key():
    pem = _resolve_key_material(settings.ALIPAY_PRIVATE_KEY_PATH, "PRIVATE KEY")
    if not pem:
        return None
    try:
        return serialization.load_pem_private_key(pem, password=None)
    except Exception as e:
        logger.error(f"Failed to load Alipay private key: {e}")
        return None

def _load_alipay_public_key():
    pem = _resolve_key_material(settings.ALIPAY_PUBLIC_KEY_PATH, "PUBLIC KEY")
    if not pem:
        return None
    try:
        return serialization.load_pem_public_key(pem)
    except Exception as e:
        logger.error(f"Failed to load Alipay public key: {e}")
        return None

def sign_alipay_params(params: Dict[str, Any]) -> str:
    """
    支付宝 RSA2 签名：按 key 排序拼接为 k1=v1&k2=v2，再做 SHA256withRSA 签名
    """
    sorted_items = sorted(
        [(k, v) for k, v in params.items() if k != "sign" and v is not None and v != ""]
    )
    query_str = "&".join(f"{k}={v}" for k, v in sorted_items)
    
    private_key = _load_alipay_private_key()
    if not private_key:
        raise RuntimeError("ALIPAY_PRIVATE_KEY_PATH not configured or file not found")
        
    signature = private_key.sign(
        query_str.encode("utf-8"),
        padding.PKCS1v15(),
        hashes.SHA256()
    )
    return base64.b64encode(signature).decode("utf-8")

def verify_alipay_signature(params: Dict[str, Any]) -> bool:
    """
    支付宝异步通知 RSA2 验签
    """
    sign = params.get("sign")
    if not sign:
        return False
        
    sorted_items = sorted(
        [(k, v) for k, v in params.items() if k not in ("sign", "sign_type") and v is not None and v != ""]
    )
    query_str = "&".join(f"{k}={v}" for k, v in sorted_items)
    
    public_key = _load_alipay_public_key()
    if not public_key:
        logger.error("ALIPAY_PUBLIC_KEY_PATH not configured; cannot verify Alipay signature")
        return False
        
    try:
        public_key.verify(
            base64.b64decode(sign),
            query_str.encode("utf-8"),
            padding.PKCS1v15(),
            hashes.SHA256()
        )
        return True
    except Exception as e:
        logger.warning(f"Alipay signature verification failed: {e}")
        return False

def _resolve_gateway_url() -> str:
    """决定支付宝网关地址：显式配置优先，其次按沙箱开关选网关。"""
    if settings.ALIPAY_GATEWAY_URL:
        return settings.ALIPAY_GATEWAY_URL
    if settings.ALIPAY_SANDBOX:
        # 沙箱网关：https://openapi-sandbox.dl.alipaydev.com/gateway.do
        return "https://openapi-sandbox.dl.alipaydev.com/gateway.do"
    return "https://openapi.alipay.com/gateway.do"

def _resolve_public_base_url() -> str:
    """对外可访问的 base URL，写法沿用 routers/audio.py 的既有惯例。"""
    return (settings.PUBLIC_BASE_URL or "").rstrip("/")

def alipay_credentials_ready() -> bool:
    """APP_ID 与应用私钥是否都已配置。缺任一项都只能走 mock 下单。

    必须连私钥一起判断——本地 .env 常常填了 APP_ID 但密钥为空，
    只看 APP_ID 会真的去请求网关，然后签名抛异常导致下单 500。
    """
    return bool(settings.ALIPAY_APP_ID) and _load_alipay_private_key() is not None

def build_alipay_pay_short_link(order_no: str) -> str:
    """二维码里真正要编码的短链（实测 63 字符）。

    不直接编码网关 URL 的原因：网关 URL 约 790 字符，既超出
    `orders.qr_code_url` 的 String(512)，生成的二维码也会密到手机扫不动。
    """
    base = _resolve_public_base_url()
    if not base:
        # 生产必须配 PUBLIC_BASE_URL，否则二维码指向本机地址、手机扫不到。
        # 这里只兜底本地开发（与 frontend/src/lib/api.ts 的 API_BASE 默认值一致）。
        logger.warning("PUBLIC_BASE_URL not set; falling back to localhost for the pay short link.")
        base = "http://localhost:8001"
    return f"{base}/api/billing/pay/{order_no}"

def _build_common_params(
    method: str,
    biz_content: Dict[str, Any],
    *,
    include_notify: bool = True,
    extra: Optional[Dict[str, str]] = None,
) -> Dict[str, str]:
    """构造支付宝公共请求参数并完成 RSA2 签名。

    `extra` 用于追加 notify_url 之外的可选公共参数（如 return_url）；它必须在
    签名之前并入——支付宝验签覆盖除 sign/sign_type 外的**全部**参数，
    签完再往 params 里塞 return_url 会让签名与实际请求不一致。
    """
    params: Dict[str, str] = {
        "app_id": settings.ALIPAY_APP_ID,
        "method": method,
        "charset": "utf-8",
        "sign_type": settings.ALIPAY_SIGN_TYPE or "RSA2",
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "version": "1.0",
        # 必须 ensure_ascii=True。用 ensure_ascii=False 时 biz_content 里是原始 UTF-8 中文字节，
        # 而支付宝网关并不按我们声明的 charset 解码 POST body（回退 GBK），中文解出来就变了样，
        # RSA2 签名必然对不上 —— 报 isv.invalid-signature「验签出错，请确认charset参数…」。
        # 实测（正式网关）：纯 ASCII 的 biz_content 验签通过，含任何非 ASCII 字符即失败；
        # 转成 \uXXXX 转义后整个请求体全 ASCII，网关用何种字符集解码结果都一样，验签稳定通过。
        "biz_content": json.dumps(biz_content, ensure_ascii=True),
    }
    if include_notify and settings.ALIPAY_NOTIFY_URL:
        params["notify_url"] = settings.ALIPAY_NOTIFY_URL
    if extra:
        params.update({k: v for k, v in extra.items() if v})
    params["sign"] = sign_alipay_params(params)
    return params

async def _post_gateway(common_params: Dict[str, str], timeout: float = 10.0) -> Dict[str, Any]:
    """POST 支付宝网关并返回完整 JSON 响应。

    支付宝正常响应为 UTF-8 JSON；个别网关错误页可能是 GBK/GB18030，
    需兜底解码并把非 JSON 内容打进日志，否则 resp.json() 直接抛
    UnicodeDecodeError，看不到真实报错。
    """
    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.post(_resolve_gateway_url(), data=common_params)
        if resp.status_code != 200:
            logger.error(f"Alipay gateway failed: status={resp.status_code}, body={resp.text}")
            raise RuntimeError(f"Alipay API Error: {resp.text}")

        content = resp.content
        text = None
        for enc in ("utf-8", "gbk", "gb18030"):
            try:
                text = content.decode(enc)
                break
            except UnicodeDecodeError:
                continue
        if text is None:
            raise RuntimeError(f"Alipay API undecodable response: {content[:200]!r}")
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            logger.error(f"Alipay gateway non-JSON response: {text[:500]}")
            raise RuntimeError(f"Alipay API non-JSON response: {text[:200]}")

async def create_alipay_precreate_order(
    order_no: str,
    amount_cents: int,
    subject: str,
) -> Dict[str, Any]:
    """
    调用支付宝统一收单线下交易预创建接口 (alipay.trade.precreate)，获取 qr_code
    """
    # 模拟模式：未配 APP_ID 或应用私钥时直接返回 mock 二维码（前端会显示「模拟扫码已支付」按钮）。
    if not alipay_credentials_ready():
        logger.warning("Alipay credentials not configured; returning mock qr_code for development.")
        return {
            "qr_code": f"https://qr.alipay.com/mock_{order_no}",
            "is_mock": True
        }

    total_amount_str = f"{amount_cents / 100:.2f}"
    biz_content = {
        "out_trade_no": order_no,
        "total_amount": total_amount_str,
        "subject": subject[:128],
        "timeout_express": "15m",
    }
    common_params = _build_common_params("alipay.trade.precreate", biz_content, include_notify=True)
    data = await _post_gateway(common_params)

    response_data = data.get("alipay_trade_precreate_response", {})
    if response_data.get("code") != "10000":
        # sub_code 才是可诊断的信息（如 ACQ.ACCESS_FORBIDDEN=收单产品未签约、
        # isv.invalid-signature=验签失败）。只抛 sub_msg 的话日志里只剩
        # 「ACCESS_FORBIDDEN」这种无上下文的结果，排障时无从下手。
        sub_code = response_data.get("sub_code") or ""
        sub_msg = response_data.get("sub_msg") or response_data.get("msg") or ""
        logger.error(
            f"Alipay precreate failed: out_trade_no={order_no}, "
            f"code={response_data.get('code')}, sub_code={sub_code}, sub_msg={sub_msg}"
        )
        raise RuntimeError(f"Alipay precreate error: [{sub_code}] {sub_msg}" if sub_code else f"Alipay precreate error: {sub_msg}")

    return {
        "qr_code": response_data.get("qr_code"),
        "is_mock": False,
    }

def build_alipay_wap_pay_url(
    order_no: str,
    amount_cents: int,
    subject: str,
    expire_at: datetime,
) -> str:
    """构造「手机网站支付」(alipay.trade.wap.pay) 的收银台跳转 URL。

    为什么用手机网站支付而不是电脑网站支付：二维码是**手机扫**的，落到 PC 收银台
    (excashier) 上体验割裂。wap.pay 直达移动收银台(mclient)，与「扫码支付」这个
    入口天然匹配。反向也成立——若要回 PC 收银台，只需把 method 换回
    `alipay.trade.page.pay`、product_code 换 `FAST_INSTANT_TRADE_PAY`，其余不动。

    与当面付的区别：这是**跳转式**产品，没有原生二维码，网关返回的是一个需要
    浏览器打开/重定向过去的 URL。用 GET 方式请求网关即得到该 URL
    （POST 方式返回的是自动提交表单的 HTML，这里用不上）。

    调用方在短链被访问时**现签现用**，而不是下单时预生成：支付宝会校验
    timestamp 的有效窗口，下单十分钟后才扫码的话预生成的签名会失效。

    超时用 `timeout_express`(相对时长) 而不是 `time_expire`(绝对时刻)：
    `time_expire` 按北京时间(GMT+8)解释，而库里存的是 `utcnow()` 的 UTC 值，
    直接传过去会得到「8 小时前就过期」的交易。相对时长没有时区歧义，
    按订单剩余时间算同样能保证用户拿不到超出订单本身的新窗口。
    """
    remaining_secs = int((expire_at - datetime.utcnow()).total_seconds())
    timeout_minutes = max(1, (remaining_secs + 59) // 60)

    base = _resolve_public_base_url()

    biz_content: Dict[str, Any] = {
        "out_trade_no": order_no,
        "total_amount": f"{amount_cents / 100:.2f}",
        "subject": subject[:128],
        # 手机网站支付场景仅支持这一个产品码，必填
        "product_code": "QUICK_WAP_WAY",
        "timeout_express": f"{timeout_minutes}m",
    }
    if base:
        # quit_url 是**业务**参数（不是公共参数），所以进 biz_content 而不是 extra。
        # 用户中途点「退出」时回到站内，不给的话停在支付宝自己的页面上。
        biz_content["quit_url"] = f"{base}/home"

    extra: Dict[str, str] = {}
    if base:
        # 付款完成后支付宝把手机浏览器送回站内；不配则停在自己的成功页
        extra["return_url"] = f"{base}/home"

    params = _build_common_params(
        "alipay.trade.wap.pay", biz_content, include_notify=True, extra=extra
    )
    return f"{_resolve_gateway_url()}?{urllib.parse.urlencode(params)}"

async def query_alipay_order(order_no: str) -> Optional[Dict[str, Any]]:
    """
    主动向支付宝查询订单交易状态 (alipay.trade.query)
    文档：https://opendocs.alipay.com/open/02ekfg
    支持本地/沙箱环境无法接收公网 Webhook 时，前端轮询主动拉取结果并履约。
    """
    if not alipay_credentials_ready():
        return None

    biz_content = {"out_trade_no": order_no}
    common_params = _build_common_params("alipay.trade.query", biz_content, include_notify=False)
    try:
        data = await _post_gateway(common_params, timeout=8.0)
    except Exception as e:
        logger.warning(f"Alipay query order {order_no} failed: {e}")
        return None

    response_data = data.get("alipay_trade_query_response", {})
    if response_data.get("code") != "10000":
        sub_code = response_data.get("sub_code") or ""
        # ACQ.TRADE_NOT_EXIST 是常态而不是故障：电脑网站支付的交易要等用户真正打开
        # 收银台才在支付宝侧建单，而前端每 2s 轮询一次，用户还在扫码的这段时间每次
        # 查单都会拿到这个码。按故障打 warning 的话日志会被刷屏、真错误反被淹没。
        if sub_code == "ACQ.TRADE_NOT_EXIST":
            logger.debug(f"Alipay order {order_no} not created yet (cashier not opened)")
            return None
        logger.warning(
            f"Alipay query order {order_no} not OK: code={response_data.get('code')}, "
            f"sub_code={sub_code}, msg={response_data.get('sub_msg') or response_data.get('msg')}"
        )
        return None
    return response_data
