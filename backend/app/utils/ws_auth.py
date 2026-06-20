"""
WebSocket 鉴权工具。

WebSocket 不能直接用 HTTPBearer，所以单独从首条消息 `{"type":"auth","token":"..."}` 读 token，
然后复用 auth.py 的 verify_access_token + Redis 黑名单 + User 查询逻辑。

只用于实时语音面试的 WS 端点；HTTP 接口继续用 get_current_user / get_current_user_optional。
"""
from typing import Optional
import logging
import redis.asyncio as aioredis
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload

from app import models
from app.utils.security import verify_access_token

logger = logging.getLogger(__name__)


async def get_current_user_from_ws(
    token: Optional[str],
    db: AsyncSession,
    redis_client: aioredis.Redis,
) -> Optional[models.User]:
    """
    从 WebSocket 首条消息中提取 token 并校验，返回 User 或 None。

    返回值约定（区别于 HTTP 路径的 raise 401）：
    - token 为空 / 格式错 → None（WS 路径只让 close code 区分，调用方负责 4001）
    - token 在黑名单 → None
    - verify_access_token 返回 None → None
    - user_id 在 DB 查不到 → None
    - 合法 token + 合法 user → models.User
    """
    if not token or not isinstance(token, str):
        return None

    try:
        # 1. 黑名单
        is_blacklisted = await redis_client.get(f"auth:blacklist:{token}")
        if is_blacklisted:
            logger.info("[ws_auth] token 在黑名单中")
            return None

        # 2. JWT 验签 + 解码
        user_id = verify_access_token(token)
        if not user_id:
            logger.info("[ws_auth] verify_access_token 返回 None")
            return None

        # 3. DB 查询
        result = await db.execute(
            select(models.User)
            .options(selectinload(models.User.profile))
            .where(models.User.id == user_id)
        )
        user = result.scalars().first()
        if not user:
            logger.info(f"[ws_auth] user_id={user_id} 在 DB 中不存在")
            return None
        return user
    except Exception as e:
        logger.exception(f"[ws_auth] 异常: {e}")
        return None
