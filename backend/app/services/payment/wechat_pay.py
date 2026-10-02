import base64
import json
import os
import time
import uuid
import httpx
import logging
from typing import Dict, Any, Optional
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.config import settings

logger = logging.getLogger(__name__)

def _load_private_key():
    key_val = settings.WECHAT_PAY_PRIVATE_KEY_PATH or os.environ.get("WECHAT_PAY_PRIVATE_KEY", "")
    if not key_val:
        return None
    try:
        # 兼容相对路径：支持当前工作目录、backend目录、以及项目根目录
        base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        repo_root = os.path.dirname(base_dir)
        candidate_paths = [
            key_val,
            os.path.join(base_dir, key_val),
            os.path.join(repo_root, key_val),
        ]
        for p in candidate_paths:
            if os.path.isfile(p):
                with open(p, "rb") as f:
                    return serialization.load_pem_private_key(f.read(), password=None)
        # 否则尝试作为直接传入的 PEM 文本内容解析
        if "-----BEGIN" in key_val:
            return serialization.load_pem_private_key(key_val.encode("utf-8"), password=None)
        return None
    except Exception as e:
        logger.error(f"Failed to load WeChat Pay private key: {e}")
        return None

def sign_sha256_rsa(message: str) -> Optional[str]:
    private_key = _load_private_key()
    if not private_key:
        return None
    signature = private_key.sign(
        message.encode("utf-8"),
        padding.PKCS1v15(),
        hashes.SHA256()
    )
    return base64.b64encode(signature).decode("utf-8")

def build_wechat_auth_header(method: str, url_path: str, body_str: str) -> Optional[str]:
    mch_id = settings.WECHAT_PAY_MCHID
    serial_no = settings.WECHAT_PAY_CERT_SERIAL_NO or getattr(settings, 'WECHAT_PAY_SERIAL_NO', '')
    if not mch_id or not serial_no:
        return None
    
    timestamp = str(int(time.time()))
    nonce_str = uuid.uuid4().hex[:32]
    
    # 构造签名串：HTTP方法\nURL\n时间戳\n随机串\n请求报文主体\n
    sign_str = f"{method}\n{url_path}\n{timestamp}\n{nonce_str}\n{body_str}\n"
    signature = sign_sha256_rsa(sign_str)
    if not signature:
        return None
        
    return (
        f'WECHATPAY2-SHA256-RSA2048 '
        f'mchid="{mch_id}",'
        f'nonce_str="{nonce_str}",'
        f'signature="{signature}",'
        f'timestamp="{timestamp}",'
        f'serial_no="{serial_no}"'
    )

async def create_wechat_native_order(
    order_no: str,
    amount_cents: int,
    description: str,
) -> Dict[str, Any]:
    """
    调用微信支付 V3 Native 统一下单接口，获取 code_url
    文档：https://pay.weixin.qq.com/doc/v3/merchant/4012791874
    """
    priv_key = _load_private_key()
    if not settings.WECHAT_PAY_MCHID or not settings.WECHAT_PAY_APPID or not priv_key:
        logger.warning("WeChat Pay credentials or private key not configured/found; returning mock code_url for development.")
        return {
            "code_url": f"weixin://wxpay/bizpayurl?pr=mock_{order_no}",
            "is_mock": True
        }

    url = "https://api.mch.weixin.qq.com/v3/pay/transactions/native"
    path = "/v3/pay/transactions/native"
    payload = {
        "appid": settings.WECHAT_PAY_APPID,
        "mchid": settings.WECHAT_PAY_MCHID,
        "description": description[:120],
        "out_trade_no": order_no,
        "notify_url": settings.WECHAT_PAY_NOTIFY_URL,
        "amount": {
            "total": amount_cents,
            "currency": "CNY"
        }
    }
    body_str = json.dumps(payload, ensure_ascii=False)
    auth_header = build_wechat_auth_header("POST", path, body_str)
    
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Authorization": auth_header,
        "User-Agent": "OfferPilot/1.0"
    }

    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(url, content=body_str, headers=headers)
        if resp.status_code != 200:
            logger.error(f"WeChat Pay native order failed: status={resp.status_code}, body={resp.text}")
            raise RuntimeError(f"WeChat Pay Error: {resp.text}")
        data = resp.json()
        return {
            "code_url": data.get("code_url"),
            "is_mock": False
        }

def decrypt_wechat_resource(nonce: str, ciphertext: str, associated_data: str) -> Dict[str, Any]:
    """
    解密微信支付回调的 AES-256-GCM 密文
    """
    api_v3_key = settings.WECHAT_PAY_API_V3_KEY
    if not api_v3_key:
        raise ValueError("WECHAT_PAY_API_V3_KEY is not configured")
        
    key_bytes = api_v3_key.encode("utf-8")
    nonce_bytes = nonce.encode("utf-8")
    ad_bytes = associated_data.encode("utf-8") if associated_data else b""
    raw_data = base64.b64decode(ciphertext)
    
    aesgcm = AESGCM(key_bytes)
    decrypted_bytes = aesgcm.decrypt(nonce_bytes, raw_data, ad_bytes)
    return json.loads(decrypted_bytes.decode("utf-8"))

async def query_wechat_order(order_no: str) -> Optional[Dict[str, Any]]:
    """
    主动向微信支付 V3 查询订单交易状态
    文档：https://pay.weixin.qq.com/doc/v3/merchant/4012791876
    支持本地开发环境在无法接收公网 Webhook 回调时，前端轮询自动主动拉取结果并履约。
    """
    mch_id = settings.WECHAT_PAY_MCHID
    if not mch_id or not settings.WECHAT_PAY_APPID:
        return None

    url_path = f"/v3/pay/transactions/out-trade-no/{order_no}?mchid={mch_id}"
    url = f"https://api.mch.weixin.qq.com{url_path}"
    auth_header = build_wechat_auth_header("GET", url_path, "")
    if not auth_header:
        return None

    headers = {
        "Accept": "application/json",
        "Authorization": auth_header,
        "User-Agent": "OfferPilot/1.0"
    }

    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(url, headers=headers)
            if resp.status_code == 200:
                return resp.json()
            elif resp.status_code == 404:
                return None
            else:
                logger.warning(f"WeChat Pay query order {order_no} status {resp.status_code}: {resp.text}")
                return None
    except Exception as e:
        logger.warning(f"WeChat Pay query order {order_no} failed: {e}")
        return None
