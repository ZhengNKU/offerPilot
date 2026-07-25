"""后台清理任务：日志 + 过期文件 + 孤儿 COS 对象。"""

import asyncio
import glob
import logging
import os
import re
import time
from datetime import datetime, timedelta, timezone

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import models
from app.config import settings
from app.database import async_session
from app.routers.file import get_cos_client
from app.routers.file import bucket as cos_bucket

logger = logging.getLogger(__name__)


# ──────────── 日志清理 ────────────

_PROTECTED_LOG_NAMES = {"backend.log", "backend-error.log"}
_DATE_SUFFIX_RE = re.compile(r"^(?P<base>.+?)-(?P<date>\d{4}-\d{2}-\d{2})\.(?P<ext>log|out|err)$")


def _default_log_dir() -> str:
    return os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
        "logs",
    )


def _all_log_dirs() -> list[str]:
    dirs = [_default_log_dir()]
    extra = settings.LOG_CLEANUP_DIRS.strip()
    if extra:
        for d in extra.split(","):
            d = d.strip()
            if d:
                dirs.append(d)
    seen, out = set(), []
    for d in dirs:
        if d not in seen:
            seen.add(d)
            out.append(d)
    return out


def _looks_like_rotated_log(filename: str) -> bool:
    return filename.endswith((".log", ".out", ".err")) and filename not in _PROTECTED_LOG_NAMES


def cleanup_old_logs(retention_days: int | None = None) -> int:
    """删 retention_days 天前的 .log/.out/.err 文件。跳过正在被写入的活动日志。"""
    days = retention_days if retention_days is not None else settings.LOG_RETENTION_DAYS
    cutoff = time.time() - days * 86400
    deleted = 0
    seen_dirs: set[str] = set()
    for log_dir in _all_log_dirs():
        if not os.path.isdir(log_dir) or log_dir in seen_dirs:
            continue
        seen_dirs.add(log_dir)

        # 带日期后缀的轮转文件
        rotated_pattern = os.path.join(log_dir, "*-[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9].log")
        for path in glob.glob(rotated_pattern):
            m = _DATE_SUFFIX_RE.match(os.path.basename(path))
            if not m:
                continue
            try:
                file_date = datetime.strptime(m.group("date"), "%Y-%m-%d").timestamp()
            except ValueError:
                continue
            if file_date >= cutoff:
                continue
            try:
                os.remove(path)
                deleted += 1
            except OSError as e:
                logger.warning("删日志失败 %s: %s", path, e)

        # 无日期段的孤立日志按 mtime 判定
        for name in os.listdir(log_dir):
            if not _looks_like_rotated_log(name) or _DATE_SUFFIX_RE.match(name):
                continue
            path = os.path.join(log_dir, name)
            if not os.path.isfile(path):
                continue
            try:
                if os.path.getmtime(path) >= cutoff:
                    continue
            except OSError:
                continue
            try:
                os.remove(path)
                deleted += 1
            except OSError as e:
                logger.warning("删孤立日志失败 %s: %s", path, e)

    if deleted:
        logger.info("日志清理: 删 %d 个（保留 %d 天）", deleted, days)
    else:
        logger.info("日志清理: 无过期（保留 %d 天）", days)
    return deleted


async def run_periodic_log_cleanup():
    """每 LOG_CLEANUP_INTERVAL_HOURS 小时清一次旧日志。"""
    interval_seconds = max(60, settings.LOG_CLEANUP_INTERVAL_HOURS * 3600)
    logger.info("日志清理任务已启动，周期 %s 小时", settings.LOG_CLEANUP_INTERVAL_HOURS)
    while True:
        try:
            loop = asyncio.get_running_loop()
            await loop.run_in_executor(None, cleanup_old_logs)
        except Exception:
            logger.exception("日志清理任务异常")
        await asyncio.sleep(interval_seconds)


# ──────────── 过期文件 + 孤儿 COS 兜底 ────────────

# 孤儿扫描时跳过最近 1h 的对象，避免删掉"上传到 COS 但 DB INSERT 还没 commit"的 in-flight 文件
ORPHAN_SKIP_RECENT_SECONDS = 3600


async def find_expired_files(db: AsyncSession) -> list[models.UploadedFile]:
    """按 UploadedFile.retention_days 字段（上传时锁定的）找出过期文件。

    排除项：
      - file_type == "screenshot"  → 截图不参与自动清理
      - cos_key == ""              → 已清过的行，避免重复打 COS
      - created_at 较新            → 按最长保留期预过滤，减少 result set
    """
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    max_retention = max(settings.FILE_RETENTION_DAYS_TEST, settings.FILE_RETENTION_DAYS_FREE)
    oldest_relevant = now - timedelta(days=max_retention)

    stmt = select(models.UploadedFile).where(
        and_(
            models.UploadedFile.file_type != "screenshot",
            models.UploadedFile.cos_key != "",
            models.UploadedFile.created_at < oldest_relevant,
        )
    )
    candidates = list((await db.execute(stmt)).scalars().all())

    expired: list[models.UploadedFile] = []
    for f in candidates:
        # 访客文件：立即删
        if f.user_id is None:  
            expired.append(f)
            continue
        days = f.retention_days if f.retention_days is not None else settings.FILE_RETENTION_DAYS_FREE
        if days <= 0 or (now - timedelta(days=days)) > f.created_at:
            expired.append(f)
    return expired


async def _list_cos_uploads(client, skip_recent_seconds: int = 0) -> set[str]:
    """列 COS uploads/ 前缀所有对象。skip_recent_seconds > 0 时跳过最近 N 秒的对象。"""
    keys: set[str] = set()
    marker = ""
    threshold = (
        datetime.now(timezone.utc) - timedelta(seconds=skip_recent_seconds)
        if skip_recent_seconds > 0 else None
    )
    while True:
        resp = await asyncio.to_thread(
            client.list_objects,
            Bucket=cos_bucket,
            Prefix="uploads/",
            Marker=marker,
            MaxKeys=1000,
        )
        for obj in resp.get("Contents", []):
            if threshold and obj.get("LastModified"):
                lm_raw = obj["LastModified"]
                # COS SDK 在不同版本下 LastModified 可能是 datetime 或 ISO 字符串
                if isinstance(lm_raw, str):
                    lm = datetime.fromisoformat(lm_raw.replace("Z", "+00:00"))
                else:
                    lm = lm_raw
                    if lm.tzinfo is None:
                        lm = lm.replace(tzinfo=timezone.utc)
                if lm > threshold:
                    continue
            keys.add(obj["Key"])
        if not resp.get("IsTruncated"):
            break
        marker = resp.get("NextMarker") or ""
        if not marker:
            break
    return keys


async def _db_cos_keys(db: AsyncSession) -> set[str]:
    res = await db.execute(
        select(models.UploadedFile.cos_key).where(models.UploadedFile.cos_key != "")
    )
    return {row[0] for row in res.all()}


async def cleanup_expired_files() -> int:
    """清两类 COS 对象：
      1) retention_days 已过期的 UploadedFile  → 删 COS + 删 DB 行
      2) 孤儿：COS 里有但 DB 里没的          → 删 COS

    DB 行删除的级联影响（由 FK 约束处理，无需代码介入）：
      - resume_analyses.file_id          → SET NULL（保留 LLM 报告）
      - project_memories.source_file_id  → SET NULL（保留项目记忆）
    """
    client = get_cos_client()

    # 第一步：清过期文件
    deleted = 0
    async with async_session() as db:
        try:
            expired = await find_expired_files(db)
        except Exception:
            logger.exception("查询过期文件失败")
            expired = []

        for db_file in expired:
            try:
                await asyncio.to_thread(
                    client.delete_object, Bucket=cos_bucket, Key=db_file.cos_key
                )
                file_id, file_user = db_file.id, db_file.user_id
                await db.delete(db_file)
                await db.commit()
                deleted += 1
                logger.info("已清过期文件 file_id=%s user_id=%s", file_id, file_user)
            except Exception:
                logger.exception("删过期文件失败 file_id=%s", db_file.id)

    # 第二步：扫孤儿（DB 没有但 COS 还在的对象）
    # 非生产环境跳过，防止本地和线上共用 COS 桶时误删线上文件
    try:
        if settings.ENVIRONMENT != "production":
            logger.info(
                "ENVIRONMENT=%s, 跳过孤儿扫描（仅 production 执行）",
                settings.ENVIRONMENT,
            )
        else:
            cos_keys = await _list_cos_uploads(client, skip_recent_seconds=ORPHAN_SKIP_RECENT_SECONDS)
            async with async_session() as db:
                db_keys = await _db_cos_keys(db)
            orphans = cos_keys - db_keys
            if orphans:
                logger.warning("孤儿扫描: %d 个（COS=%d, DB=%d）", len(orphans), len(cos_keys), len(db_keys))
                for k in orphans:
                    try:
                        await asyncio.to_thread(client.delete_object, Bucket=cos_bucket, Key=k)
                        deleted += 1
                        logger.info("孤儿已删: %s", k)
                    except Exception:
                        logger.exception("孤儿删除失败: %s", k)
            else:
                logger.info("孤儿扫描: 无孤儿（COS=%d, DB=%d）", len(cos_keys), len(db_keys))
    except Exception:
        logger.exception("孤儿扫描异常")

    return deleted


async def run_periodic_cleanup():
    """每 FILE_CLEANUP_INTERVAL_HOURS 小时跑一次：过期文件 + 孤儿 COS。"""
    interval_seconds = max(60, settings.FILE_CLEANUP_INTERVAL_HOURS * 3600)
    logger.info("文件清理任务已启动，周期 %s 小时", settings.FILE_CLEANUP_INTERVAL_HOURS)
    while True:
        try:
            await cleanup_expired_files()
        except Exception:
            logger.exception("文件清理任务异常")
        await asyncio.sleep(interval_seconds)
