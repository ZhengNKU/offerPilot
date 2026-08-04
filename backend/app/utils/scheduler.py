"""周期任务调度 leader 选举（Redis 分布式锁）。

uvicorn --workers 2 时，每个 worker 都会 import app.main 并跑 startup_event。
如果不加锁，周期任务（日志清理 / 文件清理 / pending presign 清理 / 内容巡检）
会被两个 worker 各跑一遍，启动日志也打两遍。本模块用 Redis SET NX EX 做
leader 选举：

  - 抢到锁的 worker 是调度 leader，唯一执行周期任务体 + 启动期一次性任务
  - 其余 worker 每 LEADER_HEARTBEAT_S 秒轮询补位：leader 崩溃后锁 TTL 过期，
    自动 failover（最迟约 TTL+HEARTBEAT 秒内接管）
  - 锁带 TTL 且由常驻心跳持续续约；进程退出 / Redis 连接断开后锁自然过期，
    不会留下死锁

周期循环的正确用法（见 cleanup.py / content_moderation.py）：

    from app.utils.scheduler import is_scheduler_leader
    while True:
        if is_scheduler_leader():
            ...执行任务体，并打印"已启动"（仅首次成为 leader 时）...
            await asyncio.sleep(interval)   # leader 执行完睡满一个周期
        else:
            await asyncio.sleep(30)          # 非 leader 短轮询等待接管
"""

import asyncio
import logging
import secrets

import redis as sync_redis

from app.config import settings
from app.database import _get_redis_pool

logger = logging.getLogger(__name__)

# leader 锁：心跳每 LEADER_HEARTBEAT_S 续约一次；TTL = 3 倍心跳，
# leader 崩溃后最多 LEADER_TTL_S 秒锁过期，其他 worker 才能接管。
LEADER_LOCK_KEY = "offerpilot:scheduler:leader"
LEADER_HEARTBEAT_S = 30
LEADER_TTL_S = LEADER_HEARTBEAT_S * 3

# 启动期一次性任务（种子数据 / 启动日志清理）互斥锁。
# 与 leader 锁是两把独立的锁：种子只需"整个集群跑一次"，
# 不要求持有者是周期任务 leader。
STARTUP_ONCE_KEY = "offerpilot:scheduler:startup-once"
STARTUP_ONCE_TTL_S = 600  # 10 分钟足够跑完种子；即使留下死锁，TTL 也会自动释放

# 启动日志去重：多 worker 下每条启动日志只打印一次。
LOG_ONCE_KEY = "offerpilot:log-once"

# 非 leader worker 的轮询间隔（秒）。不要小于 LEADER_HEARTBEAT_S，否则抢锁竞争无意义。
NON_LEADER_POLL_S = LEADER_HEARTBEAT_S

_token = secrets.token_hex(16)
_am_leader = False
_leader_logged = False

# 同步 Redis 客户端（仅用于 log_once 的启动日志去重；懒加载，不阻塞 async 主路径）
_sync_redis: sync_redis.Redis | None = None


def _get_sync_redis() -> sync_redis.Redis:
    """懒加载同步 Redis 客户端，供模块导入期 / async 外的场景做日志去重。"""
    global _sync_redis
    if _sync_redis is None:
        _sync_redis = sync_redis.from_url(
            settings.REDIS_URL,
            socket_connect_timeout=1,
            socket_timeout=1,
        )
    return _sync_redis


def log_once(key: str, msg: str) -> None:
    """让一条日志在整个集群（多 worker）只打印一次。

    用 Redis SET NX 标记：先抢到标记的 worker 打印，其余 worker 跳过。
    适用于所有 worker 都会执行的启动期日志（pgvector 校验、种子等）——
    这些工作本身幂等，但日志不想打两遍。

    与 is_scheduler_leader() 的差异：leader 状态是"持续持有锁"，
    启动瞬间可能还没决出 leader；log_once 用原子 SET NX，谁先到谁打印，
    不受心跳时序影响。Redis 不可用时退化为每个 worker 各自打印（与旧行为一致）。
    """
    try:
        ok = _get_sync_redis().set(f"{LOG_ONCE_KEY}:{key}", "1", nx=True, ex=3600)
        if not ok:
            return
    except Exception:
        pass  # Redis 不可用：降级为各自打印
    logging.info(msg)


async def _heartbeat() -> None:
    """常驻心跳：持续争取 / 续约 leader 锁，维护 _am_leader 状态。

    只由 startup_event 里 start_leader_heartbeat() 启动一个任务；
    周期循环通过 is_scheduler_leader() 同步读取本状态，不做 Redis 调用。
    """
    global _am_leader, _leader_logged
    redis = _get_redis_pool()
    while True:
        try:
            if _am_leader:
                # 续约：只在仍持有锁时刷新 TTL。get=True 返回旧值，
                # 若锁已被别的进程用新 token 接管，则让位，避免双 leader。
                old = await redis.set(
                    LEADER_LOCK_KEY, _token, ex=LEADER_TTL_S, xx=True, get=True
                )
                _am_leader = old == _token
            else:
                _am_leader = bool(
                    await redis.set(LEADER_LOCK_KEY, _token, nx=True, ex=LEADER_TTL_S)
                )
        except Exception:
            logger.exception("[scheduler] leader 心跳异常，按非 leader 处理")
            _am_leader = False
            await asyncio.sleep(LEADER_HEARTBEAT_S)
            continue

        if _am_leader and not _leader_logged:
            logger.info("[scheduler] 本进程成为周期任务调度 leader（多 worker 下仅 leader 执行）")
            _leader_logged = True
        elif not _am_leader and _leader_logged:
            # 让位后再接管时，重新打一条 leader 日志
            _leader_logged = False

        await asyncio.sleep(LEADER_HEARTBEAT_S)


def start_leader_heartbeat() -> asyncio.Task:
    """在 startup 中调用：后台常驻维护 leader 状态。"""
    return asyncio.create_task(_heartbeat())


def is_scheduler_leader() -> bool:
    """周期任务在执行前调用：本 worker 当前是否为调度 leader。

    纯内存读取，由心跳任务维护，无 Redis 调用，周期循环可放心高频调用。
    """
    return _am_leader


async def run_startup_once(coro_fn) -> None:
    """启动期一次性任务只在一个 worker 执行（种子数据 / 启动日志清理）。

    用独立 Redis key 做互斥：抢到锁的 worker 执行，其余 worker 直接跳过。
    种子任务本身幂等（INSERT ON CONFLICT / 查空跳过），重复执行无害；
    Redis 不可用时降级为各自执行，保证功能不因 Redis 故障而缺失。

    coro_fn：一个不带参数的 async 协程函数（如 _seed_featured_guides）。

    每个任务用独立的锁 key（按函数名），避免同进程内多个一次性任务互相挤掉。
    """
    redis = _get_redis_pool()
    lock_key = f"{STARTUP_ONCE_KEY}:{coro_fn.__name__}"
    try:
        won = bool(await redis.set(lock_key, _token, nx=True, ex=STARTUP_ONCE_TTL_S))
        if not won:
            return  # 别的 worker 已经在跑 / 已跑完
    except Exception:
        logger.warning("[scheduler] startup-once 锁获取失败，降级为各自执行（幂等安全）")
    await coro_fn()
