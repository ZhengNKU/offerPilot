import asyncio
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import models
from app.config import settings
from app.database import async_session
from app.routers.file import delete_file_from_storage

logger = logging.getLogger(__name__)


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
    """在后台永久运行，每隔 CLEANUP_INTERVAL_HOURS 小时清理一次。"""
    interval_seconds = max(60, settings.FILE_CLEANUP_INTERVAL_HOURS * 3600)
    logger.info("文件清理任务已启动，周期 %s 小时", settings.FILE_CLEANUP_INTERVAL_HOURS)
    while True:
        try:
            await cleanup_expired_files()
        except Exception:
            logger.exception("文件清理任务执行异常")
        await asyncio.sleep(interval_seconds)
