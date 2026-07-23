from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase
from app.config import settings
import redis.asyncio as aioredis

engine = create_async_engine(settings.DATABASE_URL, echo=False)
async_session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

class Base(DeclarativeBase):
    pass

# FastAPI Dependency for PostgreSQL Database Session
async def get_db():
    async with async_session() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise

# ── Redis 连接池（复用以避免每请求建连/断连导致 TIME_WAIT 风暴）────
# Windows 下 TCP 连接关闭后会在 TIME_WAIT 状态停留 120s，
# 高频创建/销毁连接会在极短时间内耗尽系统临时端口，导致所有 I/O 阻塞。
_redis_pool: aioredis.Redis | None = None


def _get_redis_pool() -> aioredis.Redis:
    """获取全局 Redis 连接池实例（供非 FastAPI 上下文使用）。

    首次调用时建立连接池，后续复用。"""
    global _redis_pool
    if _redis_pool is None:
        _redis_pool = aioredis.from_url(
            settings.REDIS_URL,
            decode_responses=True,
            max_connections=20,
            socket_keepalive=True,
            health_check_interval=30,
        )
    return _redis_pool


async def get_redis() -> aioredis.Redis:
    """FastAPI 依赖：从持久连接池中获取 Redis 客户端。"""
    yield _get_redis_pool()
