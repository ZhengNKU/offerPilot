"""
实时面试并发限流 + 排队：Redis ZSET 槽位管理器。

设计要点
--------
- 活跃槽用 ZSET `live:active`：member=live_id，score=过期时间戳(now+TTL)。
  ZCARD 即当前活跃并发数；每次 acquire/enqueue 先 ZREMRANGEBYSCORE 清过期，
  因此进程崩溃遗留的僵尸槽最迟在 TTL 秒后被下一次调用顺手回收。
- 排队用 ZSET `live:queue`：member=live_id，score=入队时间戳，天然 FIFO；
  ZRANK 即当前排位；ZSET 便于任意位置移除（前端中途取消/断线）。
- 判满 + 占位、判队满 + 入队均在单条 Lua 内完成，原子无竞态，多 worker 亦安全。
- 全部方法 fail-open：Redis 抖动/异常时不阻断业务（放行 / 视作队首），仅告警。

关键不变式：本模块只负责"占/放槽位"，绝不触碰时长额度。所有"建桥前退出"
（队满 4429 / 排队超时 4408 / 排队中断线）都发生在 duration_sec 产生之前，
因此永不扣减用户的实时面试时长额度。
"""
from __future__ import annotations

import logging
import time

logger = logging.getLogger(__name__)

ACTIVE_KEY = "live:active"
QUEUE_KEY = "live:queue"

# 清过期 → 判满 → 占位（原子）。返回 1=拿到槽，0=已满。
_LUA_ACQUIRE = """
redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, ARGV[1])
if redis.call('ZCARD', KEYS[1]) < tonumber(ARGV[3]) then
  redis.call('ZADD', KEYS[1], tonumber(ARGV[1]) + tonumber(ARGV[4]), ARGV[2])
  return 1
end
return 0
"""

# 仅当自己仍在活跃集合内才续期，避免误复活已释放/已超时的槽。返回 1=续期成功，0=未在集合。
_LUA_HEARTBEAT = """
if redis.call('ZSCORE', KEYS[1], ARGV[2]) then
  redis.call('ZADD', KEYS[1], tonumber(ARGV[1]) + tonumber(ARGV[3]), ARGV[2])
  return 1
end
return 0
"""

# 清超时残留 → 若已在队则回排名 → 判队满(-1) → 入队并回排名(0基)。
_LUA_ENQUEUE = """
redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, ARGV[4])
local existing = redis.call('ZRANK', KEYS[1], ARGV[2])
if existing then return existing end
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[3]) then return -1 end
redis.call('ZADD', KEYS[1], tonumber(ARGV[1]), ARGV[2])
return redis.call('ZRANK', KEYS[1], ARGV[2])
"""


class SlotManager:
    """无状态槽位管理器；每次用时用全局 Redis 连接池 new 一个即可。"""

    def __init__(self, redis, *, cap: int, queue_max: int, slot_ttl: int, queue_max_wait: int):
        self._r = redis
        self._cap = cap
        self._queue_max = queue_max
        self._slot_ttl = slot_ttl
        # 队列里超过 (max_wait + ttl) 仍未被清走的，视作残留，enqueue 时顺手清理
        self._queue_stale_after = queue_max_wait + slot_ttl
        self._acquire = redis.register_script(_LUA_ACQUIRE)
        self._heartbeat = redis.register_script(_LUA_HEARTBEAT)
        self._enqueue = redis.register_script(_LUA_ENQUEUE)

    async def acquire(self, live_id: int | str) -> bool:
        """尝试占用一个活跃槽。成功 True，满 False；Redis 异常 → fail-open 放行 True。"""
        now = time.time()
        try:
            r = await self._acquire(
                keys=[ACTIVE_KEY],
                args=[now, str(live_id), self._cap, self._slot_ttl],
            )
            return int(r) == 1
        except Exception as e:
            logger.warning(f"[slots] acquire live_id={live_id} Redis 异常, fail-open 放行: {e}")
            return True

    async def heartbeat(self, live_id: int | str) -> bool:
        """续期活跃槽 TTL（watchdog 每 5s 调用）。异常静默忽略。"""
        now = time.time()
        try:
            r = await self._heartbeat(
                keys=[ACTIVE_KEY],
                args=[now, str(live_id), self._slot_ttl],
            )
            return int(r) == 1
        except Exception as e:
            logger.debug(f"[slots] heartbeat live_id={live_id} 异常(忽略): {e}")
            return False

    async def release(self, live_id: int | str) -> None:
        """释放活跃槽 + 从队列移除（幂等，可重复调用）。"""
        try:
            await self._r.zrem(ACTIVE_KEY, str(live_id))
            await self._r.zrem(QUEUE_KEY, str(live_id))
        except Exception as e:
            logger.warning(f"[slots] release live_id={live_id} 异常: {e}")

    async def enqueue(self, live_id: int | str) -> int:
        """入队并返回排位(0基)。-1 表示队列已满；Redis 异常 → fail-open 视作队首(0)。"""
        now = time.time()
        try:
            r = await self._enqueue(
                keys=[QUEUE_KEY],
                args=[now, str(live_id), self._queue_max, now - self._queue_stale_after],
            )
            return int(r)
        except Exception as e:
            logger.warning(f"[slots] enqueue live_id={live_id} Redis 异常, fail-open 视作队首: {e}")
            return 0

    async def dequeue(self, live_id: int | str) -> None:
        """从队列移除（前端取消/断线/拿到槽后调用）。"""
        try:
            await self._r.zrem(QUEUE_KEY, str(live_id))
        except Exception as e:
            logger.debug(f"[slots] dequeue live_id={live_id} 异常(忽略): {e}")

    async def queue_position(self, live_id: int | str) -> int | None:
        """当前排位(0基)；不在队列返回 None；异常 fail-open 视作队首(0)。"""
        try:
            r = await self._r.zrank(QUEUE_KEY, str(live_id))
            return int(r) if r is not None else None
        except Exception as e:
            logger.debug(f"[slots] queue_position live_id={live_id} 异常(忽略): {e}")
            return 0

    async def active_count(self) -> int:
        """当前活跃并发数（会先清过期，读到的是有效值）。异常返回 -1。"""
        try:
            await self._r.zremrangebyscore(ACTIVE_KEY, 0, time.time())
            return int(await self._r.zcard(ACTIVE_KEY))
        except Exception as e:
            logger.debug(f"[slots] active_count 异常: {e}")
            return -1

    async def queue_len(self) -> int:
        """当前队列长度。异常返回 -1。"""
        try:
            return int(await self._r.zcard(QUEUE_KEY))
        except Exception as e:
            logger.debug(f"[slots] queue_len 异常: {e}")
            return -1


def make_slot_manager(redis) -> SlotManager:
    """按当前配置构造 SlotManager。"""
    from app.config import settings

    return SlotManager(
        redis,
        cap=settings.LIVE_MAX_CONCURRENT,
        queue_max=settings.LIVE_QUEUE_MAX,
        slot_ttl=settings.LIVE_SLOT_TTL,
        queue_max_wait=settings.LIVE_QUEUE_MAX_WAIT,
    )


def estimate_eta_sec(position: int, duration_min: int, cap: int) -> int:
    """粗估排队等待秒数：前面每凑满 cap 个人，需等一整场时长。"""
    import math

    duration_sec = max(1, int(duration_min)) * 60
    waves = math.ceil((position + 1) / max(1, cap))
    return waves * duration_sec
