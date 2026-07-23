"""
管理端内容审核查询接口

仅 admin 账号可访问:
- GET /api/admin/moderation-logs           审计日志列表(分页 + scene/suggestion/user_id 过滤)
- GET /api/admin/moderation-logs/stats     简略统计(各 scene / suggestion 的条数)

注:与 `routers/feedback.py` 中的 "admin" 判断保持一致(都是 username == "admin");
    未来想做 RBAC 再切到 role-based。
"""
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app import models, schemas
from app.database import get_db
from app.routers.auth import get_current_user

router = APIRouter(prefix="/api/admin", tags=["Admin"])


async def require_admin(current_user: models.User = Depends(get_current_user)) -> models.User:
    """admin 守卫。与 feedback.py 中 `if current_user.username == "admin"` 一致。"""
    if current_user.username != "admin":
        raise HTTPException(status_code=403, detail="仅管理员可访问")
    return current_user


@router.get("/moderation-logs", response_model=schemas.ModerationListResponse)
async def list_audit_logs(
    scene: Optional[str] = None,
    suggestion: Optional[str] = None,
    user_id: Optional[int] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    _admin: models.User = Depends(require_admin),
):
    """
    列出 ModerationAuditLog,可按 scene / suggestion / user_id 过滤。

    分页按 created_at DESC(最新在最前)。
    """
    query = select(models.ModerationAuditLog)
    if scene:
        query = query.where(models.ModerationAuditLog.scene == scene)
    if suggestion:
        query = query.where(models.ModerationAuditLog.suggestion == suggestion)
    if user_id is not None:
        query = query.where(models.ModerationAuditLog.user_id == user_id)

    # 总数(分页元数据)
    count_q = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_q)).scalar_one()

    # 当前页
    rows = (await db.execute(
        query.order_by(models.ModerationAuditLog.created_at.desc())
             .offset((page - 1) * page_size)
             .limit(page_size)
    )).scalars().all()

    return schemas.ModerationListResponse(
        items=[schemas.ModerationAuditOut.model_validate(r) for r in rows],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/moderation-logs/stats")
async def moderation_stats(
    db: AsyncSession = Depends(get_db),
    _admin: models.User = Depends(require_admin),
):
    """
    简略统计:最近 7 天内各 scene / suggestion 的条数。
    轻量聚合,无分页,直接 GROUP BY。
    """
    # 各 scene 的 Block / Review / Pass 计数
    scene_q = (
        select(
            models.ModerationAuditLog.scene,
            models.ModerationAuditLog.suggestion,
            func.count().label("cnt"),
        )
        .group_by(
            models.ModerationAuditLog.scene,
            models.ModerationAuditLog.suggestion,
        )
    )
    rows = (await db.execute(scene_q)).all()

    by_scene: dict = {}
    for scene, suggestion, cnt in rows:
        by_scene.setdefault(scene, {"Block": 0, "Review": 0, "Pass": 0})
        by_scene[scene][suggestion] = cnt

    # 总计
    total = sum(s.get("Block", 0) + s.get("Review", 0) + s.get("Pass", 0) for s in by_scene.values())
    blocked_total = sum(s.get("Block", 0) + s.get("Review", 0) for s in by_scene.values())

    return {
        "total": total,
        "blocked_total": blocked_total,
        "by_scene": by_scene,
    }
