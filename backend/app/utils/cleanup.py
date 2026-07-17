import asyncio
import glob
import logging
import os
import re
import time
from datetime import datetime, timedelta, timezone

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import models
from app.config import settings
from app.database import async_session
from app.routers.file import delete_file_from_storage

logger = logging.getLogger(__name__)

# ────────────────────────────────────────────────────────────────────────────
#  日志清理（与文件清理分开，独立的轮转节奏）
# ────────────────────────────────────────────────────────────────────────────

# 不删除当前正在被 TimedRotatingFileHandler 写入的活动日志文件
_PROTECTED_LOG_NAMES = {"backend.log", "backend-error.log"}

# 匹配带日期段后缀的轮转后日志：backend-2026-07-10.log 等
_DATE_SUFFIX_RE = re.compile(r"^(?P<base>.+?)-(?P<date>\d{4}-\d{2}-\d{2})\.(?P<ext>log|out|err)$")


def _default_log_dir() -> str:
    """默认日志目录：项目内的 logs/ 目录（与 main.py 中的 log_dir 路径一致）。

    容器内为 `/app/logs`，与 docker-compose 中 `/data/logs:/app/logs` 挂载点对齐；
    此时容器内清掉的文件会立即反映到宿主机 /data/logs，无需也无法感知宿主机路径。
    裸机/直接进程跑的场景可由 LOG_CLEANUP_DIRS 显式追加（如 /data/logs）。
    """
    return os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
        "logs",
    )


def _all_log_dirs() -> list[str]:
    """汇总本次要扫描的日志目录：默认目录 + LOG_CLEANUP_DIRS 环境变量追加的额外目录。

    Docker 部署留空即可 —— `/app/logs` 已经覆盖宿主机 `/data/logs`。
    裸机部署可在 .env 里加 `LOG_CLEANUP_DIRS=/data/logs`。
    """
    dirs: list[str] = [_default_log_dir()]
    extra = settings.LOG_CLEANUP_DIRS.strip()
    if extra:
        for raw in extra.split(","):
            d = raw.strip()
            if d:
                dirs.append(d)
    # 去重保序
    seen: set[str] = set()
    out: list[str] = []
    for d in dirs:
        if d not in seen:
            seen.add(d)
            out.append(d)
    return out


def _looks_like_rotated_log(filename: str) -> bool:
    """判断文件名是否为可清理的日志文件。"""
    if not filename.endswith((".log", ".out", ".err")):
        return False
    if filename in _PROTECTED_LOG_NAMES:
        return False
    return True


def cleanup_old_logs(retention_days: int | None = None) -> int:
    """清理保留天数之外的旧日志文件。

    扫描路径（按出现顺序，去重）：
      1. 项目内 logs/ 目录（默认）—— 容器内为 `/app/logs`，通过 docker-compose
         映射到宿主机 `/data/logs`，容器内清理即可生效
      2. LOG_CLEANUP_DIRS 指定的额外目录（可选，逗号分隔，用于裸机部署）

    只删 .log/.out/.err 文件，且跳过仍在被实时写入的 backend.log 与 backend-error.log。
    """
    days = retention_days if retention_days is not None else settings.LOG_RETENTION_DAYS
    cutoff = time.time() - days * 86400

    scanned_dirs = _all_log_dirs()
    deleted = 0
    seen_dirs: set[str] = set()
    for log_dir in scanned_dirs:
        if not os.path.isdir(log_dir) or log_dir in seen_dirs:
            continue
        seen_dirs.add(log_dir)

        # 1) 带日期段后缀的轮转文件：按文件名里的日期段判定
        rotated_pattern = os.path.join(log_dir, "*-[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9].log")
        for path in glob.glob(rotated_pattern):
            name = os.path.basename(path)
            m = _DATE_SUFFIX_RE.match(name)
            if not m:
                continue
            try:
                file_date = datetime.strptime(m.group("date"), "%Y-%m-%d").timestamp()
            except ValueError:
                continue
            if file_date < cutoff:
                try:
                    os.remove(path)
                    deleted += 1
                    logger.info("已清理过期日志文件: %s (日期早于 %d 天)", path, days)
                except OSError as e:
                    logger.warning("删除日志文件失败 %s: %s", path, e)

        # 2) 无日期段的孤立日志（如 uvicorn.log / uvicorn.out.log / restart.out.log）：
        #    按文件 mtime 判定
        for name in os.listdir(log_dir):
            if not _looks_like_rotated_log(name):
                continue
            if _DATE_SUFFIX_RE.match(name):
                # 上一步 glob 已覆盖（防御性二次过滤，避免重复删）
                continue
            path = os.path.join(log_dir, name)
            if not os.path.isfile(path):
                continue
            try:
                mtime = os.path.getmtime(path)
            except OSError:
                continue
            if mtime < cutoff:
                try:
                    os.remove(path)
                    deleted += 1
                    logger.info("已清理孤立旧日志 (mtime 早于 %d 天): %s", days, path)
                except OSError as e:
                    logger.warning("删除孤立旧日志失败 %s: %s", path, e)

    if deleted == 0:
        logger.info(
            "日志清理任务：未发现过期日志文件（扫描目录=%s, 保留=%d 天）",
            scanned_dirs, days,
        )
    else:
        logger.info(
            "日志清理任务完成，共删除 %d 个过期日志文件（保留 %d 天，扫描目录=%s）",
            deleted, days, scanned_dirs,
        )
    return deleted


async def run_periodic_log_cleanup():
    """在后台永久运行，每天清理一次超过 LOG_RETENTION_DAYS 天的旧日志文件。

    设计要点：
      - 与文件清理任务解耦，互不影响（一个失败不会拖死另一个）
      - cleanup_old_logs() 是同步 IO，丢到默认 executor 跑避免阻塞事件循环
    """
    interval_seconds = max(60, settings.LOG_CLEANUP_INTERVAL_HOURS * 3600)
    scanned_dirs = _all_log_dirs()
    logger.info(
        "日志清理任务已启动，周期 %s 小时，保留 %d 天，扫描目录=%s",
        settings.LOG_CLEANUP_INTERVAL_HOURS, settings.LOG_RETENTION_DAYS, scanned_dirs,
    )
    while True:
        try:
            loop = asyncio.get_running_loop()
            await loop.run_in_executor(None, cleanup_old_logs)
        except Exception:
            logger.exception("日志清理任务执行异常")
        await asyncio.sleep(interval_seconds)


# ────────────────────────────────────────────────────────────────────────────
#  过期上传文件清理（已有逻辑保留）
# ────────────────────────────────────────────────────────────────────────────


def _retention_days_for(membership: str | None) -> int:
    """根据会员等级返回对应的文件保留天数。免费档包括未登录访客。"""
    if membership == "max":
        return settings.FILE_RETENTION_DAYS_MAX
    if membership == "pro":
        return settings.FILE_RETENTION_DAYS_PRO
    return settings.FILE_RETENTION_DAYS_FREE


async def find_expired_files(db: AsyncSession) -> list[models.UploadedFile]:
    """查找所有已超过保留期限的文件，按用户当前会员等级判定。"""
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    free_cutoff = now - timedelta(days=settings.FILE_RETENTION_DAYS_FREE)
    pro_cutoff = now - timedelta(days=settings.FILE_RETENTION_DAYS_PRO)
    max_cutoff = now - timedelta(days=settings.FILE_RETENTION_DAYS_MAX)

    stmt = (
        select(models.UploadedFile)
        .outerjoin(models.User, models.UploadedFile.user_id == models.User.id)
        .where(
            or_(
                # 访客没有登录 -> 不保存，立即删除
                models.UploadedFile.user_id.is_(None),
                # 用户当前未在线/未登录 (is_online 为 False) -> 不保存，立即删除
                and_(
                    models.UploadedFile.user_id.is_not(None),
                    models.User.is_online.is_(False),
                ),
                # 已登录且在线的免费用户 (membership IS NULL) -> 免费档
                and_(
                    models.User.is_online.is_(True),
                    models.User.membership.is_(None),
                    models.UploadedFile.created_at < free_cutoff,
                ),
                # 已登录且在线的 Pro 用户
                and_(
                    models.User.is_online.is_(True),
                    models.User.membership == "pro",
                    models.UploadedFile.created_at < pro_cutoff,
                ),
                # 已登录且在线的 Max 用户
                and_(
                    models.User.is_online.is_(True),
                    models.User.membership == "max",
                    models.UploadedFile.created_at < max_cutoff,
                ),
            )
        )
    )
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def cleanup_expired_files() -> int:
    """清理一次过期文件，返回删除条数。出错不会抛出，由调用方记录日志。"""
    async with async_session() as db:
        try:
            expired = await find_expired_files(db)
        except Exception:
            logger.exception("查询过期文件失败")
            return 0

        if not expired:
            logger.info("文件清理任务：未发现过期文件")
            return 0

        deleted = 0
        for db_file in expired:
            try:
                await delete_file_from_storage(db, db_file)
                deleted += 1
                logger.info(
                    "已清理过期文件 file_id=%s user_id=%s cos_key=%s",
                    db_file.id, db_file.user_id, db_file.cos_key,
                )
            except Exception:
                logger.exception("删除过期文件失败 file_id=%s", db_file.id)
        logger.info("文件清理任务完成，共删除 %s 条", deleted)
        return deleted


async def run_periodic_cleanup():
    """在后台永久运行，每隔 FILE_CLEANUP_INTERVAL_HOURS 小时清理一次过期上传文件。"""
    interval_seconds = max(60, settings.FILE_CLEANUP_INTERVAL_HOURS * 3600)
    logger.info("文件清理任务已启动，周期 %s 小时", settings.FILE_CLEANUP_INTERVAL_HOURS)
    while True:
        try:
            await cleanup_expired_files()
        except Exception:
            logger.exception("文件清理任务执行异常")
        await asyncio.sleep(interval_seconds)
