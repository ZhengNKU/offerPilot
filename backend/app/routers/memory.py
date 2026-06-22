"""项目记忆库 CRUD API 路由。

提供前端「职业记忆看板→项目记忆库」Tab 所需的数据查询和手动编辑能力。
AI 自动提取的项目经历通过 services/project_memory_agent 写入。
"""
import asyncio
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app import models, schemas
from app.database import get_db
from app.routers.auth import get_current_user_optional

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/memory", tags=["Project Memory"])


# ============================================================================
# 辅助函数
# ============================================================================

def _project_to_dict(pm: models.ProjectMemory) -> dict:
    """ProjectMemory ORM 对象 → 前端友好的 dict。"""
    return {
        "id": pm.id,
        "project_name": pm.project_name,
        "summary": pm.summary,
        "description": pm.description,
        "category": pm.category,
        "sub_tags": pm.sub_tags or [],
        "tech_stack": pm.tech_stack or [],
        "metrics": pm.metrics or {},
        "role": pm.role,
        "team_size": pm.team_size,
        "duration": pm.duration,
        "mastery_level": pm.mastery_level,
        "mention_count": pm.mention_count,
        "last_mentioned_at": pm.last_mentioned_at.isoformat() if pm.last_mentioned_at else None,
        "last_mentioned_session_id": pm.last_mentioned_session_id,
        "last_mentioned_summary": pm.last_mentioned_summary,
        "importance": pm.importance,
        "source_type": pm.source_type,
        "version": pm.version,
        "last_updated_by": pm.last_updated_by,
        "created_at": pm.created_at.isoformat() if pm.created_at else None,
        "updated_at": pm.updated_at.isoformat() if pm.updated_at else None,
    }


def _require_user(current_user):
    """未登录返回 401；已登录返回 user。"""
    if not current_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="请先登录以使用项目记忆功能",
        )
    return current_user


# ============================================================================
# 查询类端点
# ============================================================================

@router.get("/projects/tags")
async def list_tags(
    db: AsyncSession = Depends(get_db),
):
    """返回标签字典（主分类 + 辅助标签），供前端下拉选择器使用。"""
    stmt = (
        select(models.ProjectTag)
        .where(models.ProjectTag.is_active.is_(True))
        .order_by(models.ProjectTag.tag_type, models.ProjectTag.sort_order)
    )
    result = await db.execute(stmt)
    tags = result.scalars().all()

    categories = []
    sub_tags = []
    for t in tags:
        item = {
            "tag_name": t.tag_name,
            "tag_key": t.tag_key,
            "color_class": t.color_class,
        }
        if t.tag_type == "category":
            categories.append(item)
        else:
            sub_tags.append(item)

    return {"categories": categories, "sub_tags": sub_tags}


@router.get("/projects/stats")
async def get_project_stats(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user_optional),
):
    """项目统计：总数、分类分布、技术栈云。"""
    user = _require_user(current_user)

    # 分类分布
    cat_stmt = (
        select(models.ProjectMemory.category, func.count())
        .where(models.ProjectMemory.user_id == user.id)
        .group_by(models.ProjectMemory.category)
    )
    cat_result = await db.execute(cat_stmt)
    category_distribution = {row[0]: row[1] for row in cat_result.all()}

    # 总数
    total_stmt = (
        select(func.count())
        .select_from(models.ProjectMemory)
        .where(models.ProjectMemory.user_id == user.id)
    )
    total = (await db.execute(total_stmt)).scalar() or 0

    # 技术栈收集
    tech_stmt = (
        select(models.ProjectMemory.tech_stack)
        .where(models.ProjectMemory.user_id == user.id)
    )
    tech_result = await db.execute(tech_stmt)
    tech_counter: dict[str, int] = {}
    for (stack,) in tech_result.all():
        for tech in (stack or []):
            tech_counter[tech] = tech_counter.get(tech, 0) + 1
    top_tech = sorted(tech_counter.items(), key=lambda x: x[1], reverse=True)[:20]

    return {
        "total": total,
        "category_distribution": category_distribution,
        "top_tech_stack": [{"name": k, "count": v} for k, v in top_tech],
    }


@router.get("/projects")
async def list_projects(
    category: Optional[str] = Query(None, description="按主分类筛选"),
    sort: str = Query("importance", description="排序: importance/mastery/updated/mentions"),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user_optional),
):
    """获取当前用户的项目记忆列表。"""
    user = _require_user(current_user)

    base = select(models.ProjectMemory).where(models.ProjectMemory.user_id == user.id)

    if category:
        base = base.where(models.ProjectMemory.category == category)

    # 排序
    sort_map = {
        "importance": models.ProjectMemory.importance.desc(),
        "mastery": models.ProjectMemory.mastery_level.desc(),
        "updated": models.ProjectMemory.updated_at.desc(),
        "mentions": models.ProjectMemory.mention_count.desc(),
    }
    order = sort_map.get(sort, models.ProjectMemory.importance.desc())
    base = base.order_by(order)

    # 总数
    count_stmt = select(func.count()).select_from(base.subquery())
    total = (await db.execute(count_stmt)).scalar() or 0

    # 分页
    stmt = base.limit(limit).offset(offset)
    result = await db.execute(stmt)
    projects = [_project_to_dict(pm) for pm in result.scalars().all()]

    # 分类分布（不受分页影响）
    cat_stmt = (
        select(models.ProjectMemory.category, func.count())
        .where(models.ProjectMemory.user_id == user.id)
        .group_by(models.ProjectMemory.category)
    )
    cat_result = await db.execute(cat_stmt)
    category_distribution = {row[0]: row[1] for row in cat_result.all()}

    return {
        "projects": projects,
        "total": total,
        "category_distribution": category_distribution,
    }


@router.get("/projects/{project_id}")
async def get_project(
    project_id: int,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user_optional),
):
    """获取单个项目记忆详情。"""
    user = _require_user(current_user)

    stmt = select(models.ProjectMemory).where(models.ProjectMemory.id == project_id)
    result = await db.execute(stmt)
    pm = result.scalars().first()
    if not pm:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="项目记忆不存在")
    if pm.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权访问该项目记忆")

    return _project_to_dict(pm)


# ============================================================================
# 写入类端点
# ============================================================================

@router.post("/projects", status_code=status.HTTP_201_CREATED)
async def create_project(
    body: schemas.ProjectMemoryCreate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user_optional),
):
    """手动新增一条项目记忆。"""
    user = _require_user(current_user)

    # 检查项目名唯一性
    dup_stmt = select(models.ProjectMemory).where(
        models.ProjectMemory.user_id == user.id,
        models.ProjectMemory.project_name == body.project_name.strip(),
    )
    dup = (await db.execute(dup_stmt)).scalars().first()
    if dup:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"项目 '{body.project_name}' 已存在，请使用编辑功能更新",
        )

    pm = models.ProjectMemory(
        user_id=user.id,
        project_name=body.project_name.strip(),
        summary=body.summary,
        category=body.category,
        sub_tags=body.sub_tags,
        tech_stack=body.tech_stack,
        metrics=body.metrics,
        role=body.role,
        team_size=body.team_size,
        duration=body.duration,
        source_type="manual",
        last_updated_by="user",
        version=1,
        mastery_level=50,
        importance=50,
        mention_count=0,
    )
    db.add(pm)
    await db.commit()
    await db.refresh(pm)

    logger.info(f"[memory] 用户手动创建项目记忆 id={pm.id} name='{pm.project_name}'")
    return _project_to_dict(pm)


@router.put("/projects/{project_id}")
async def update_project(
    project_id: int,
    body: schemas.ProjectMemoryUpdate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user_optional),
):
    """手动编辑项目记忆。只更新传了的字段。"""
    user = _require_user(current_user)

    stmt = select(models.ProjectMemory).where(models.ProjectMemory.id == project_id)
    result = await db.execute(stmt)
    pm = result.scalars().first()
    if not pm:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="项目记忆不存在")
    if pm.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权编辑该项目记忆")

    # 如果改了项目名，检查唯一性
    if body.project_name and body.project_name.strip() != pm.project_name:
        dup_stmt = select(models.ProjectMemory).where(
            models.ProjectMemory.user_id == user.id,
            models.ProjectMemory.project_name == body.project_name.strip(),
        )
        dup = (await db.execute(dup_stmt)).scalars().first()
        if dup:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"项目 '{body.project_name}' 已存在",
            )
        pm.project_name = body.project_name.strip()

    # 更新已传字段
    for field_name in (
        "summary", "description", "category", "sub_tags", "tech_stack",
        "metrics", "role", "team_size", "duration",
    ):
        val = getattr(body, field_name, None)
        if val is not None:
            setattr(pm, field_name, val)

    if body.mastery_level is not None:
        pm.mastery_level = body.mastery_level
    if body.importance is not None:
        pm.importance = body.importance

    pm.last_updated_by = "user"
    pm.version += 1

    await db.commit()
    await db.refresh(pm)

    logger.info(f"[memory] 用户手动更新项目记忆 id={pm.id} name='{pm.project_name}' v{pm.version}")
    return _project_to_dict(pm)


@router.delete("/projects/{project_id}")
async def delete_project(
    project_id: int,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user_optional),
):
    """删除一条项目记忆。"""
    user = _require_user(current_user)

    stmt = select(models.ProjectMemory).where(models.ProjectMemory.id == project_id)
    result = await db.execute(stmt)
    pm = result.scalars().first()
    if not pm:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="项目记忆不存在")
    if pm.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权删除该项目记忆")

    await db.delete(pm)
    await db.commit()

    logger.info(f"[memory] 用户删除项目记忆 id={project_id} name='{pm.project_name}'")
    return {"message": "删除成功"}


@router.post("/projects/{project_id}/refresh")
async def refresh_project(
    project_id: int,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user_optional),
):
    """手动触发 LLM 重新提取该项目记忆。

    从源简历文件中重新提取文本，并针对该项目重新生成 summary/标签/技术栈。
    这是一个异步操作，立即返回 202，实际工作在后台完成。
    """
    user = _require_user(current_user)

    stmt = select(models.ProjectMemory).where(models.ProjectMemory.id == project_id)
    result = await db.execute(stmt)
    pm = result.scalars().first()
    if not pm:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="项目记忆不存在")
    if pm.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权刷新该项目记忆")

    if not pm.source_file_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="该项目记忆没有关联的源简历文件，无法自动刷新。请手动编辑。",
        )

    # 从 COS 获取源文件并重新提取文本
    from app.routers.file import get_cos_client, bucket

    file_stmt = select(models.UploadedFile).where(models.UploadedFile.id == pm.source_file_id)
    file_result = await db.execute(file_stmt)
    db_file = file_result.scalars().first()
    if not db_file:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="源简历文件已不存在，无法自动刷新。请手动编辑。",
        )

    try:
        import asyncio as _asyncio
        cos_client = get_cos_client()
        response = await _asyncio.to_thread(
            cos_client.get_object, Bucket=bucket, Key=db_file.cos_key
        )
        body_stream = response["Body"]
        if hasattr(body_stream, "get_raw_stream"):
            content_bytes = body_stream.get_raw_stream().read()
        else:
            content_bytes = body_stream.read()
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"从云存储下载源文件失败: {str(e)}",
        )

    from app.utils.resume_parser import extract_resume_text

    try:
        resume_text = extract_resume_text(content_bytes, db_file.filename)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"解析源文件失败: {str(e)}",
        )

    # 启动异步子智能体（fire-and-forget）
    from app.services.project_memory_agent import _run_project_memory_sub_agent

    asyncio.create_task(
        _run_project_memory_sub_agent({
            "user_id": user.id,
            "file_id": db_file.id,
            "resume_text": resume_text,
        })
    )

    logger.info(
        f"[memory] 手动触发项目记忆刷新 "
        f"project_id={project_id} name='{pm.project_name}'"
    )
    return {
        "message": "刷新任务已启动，请稍后查看结果",
        "project_id": project_id,
    }


# ============================================================================
# 能力成长曲线
# ============================================================================

FIVE_DIMENSION_KEYS = ("expression", "logic", "project_depth", "ownership", "system_design")


def _extract_five_scores(analysis_result: Optional[dict]) -> Optional[dict[str, int]]:
    """从 analysis_result JSONB 中安全提取五个维度评分。

    返回 None 表示无效（无 scores 或任一维度缺失/非数字）。
    """
    if not isinstance(analysis_result, dict):
        return None
    scores_raw = analysis_result.get("scores")
    if not isinstance(scores_raw, dict):
        return None
    out = {}
    for k in FIVE_DIMENSION_KEYS:
        v = scores_raw.get(k)
        if not isinstance(v, (int, float)):
            return None
        out[k] = int(v)
    return out


def _compute_axis_labels(total: int) -> list:
    """X 轴 6 个刻度对应的 analysis_index 列表。

    - total ≤ 6: labels = [1, 2, 3, 4, 5, 6]（固定展示 1-6 次）
    - total > 6: 均匀采样 6 个整数，首尾固定 1 和 total
    """
    if total <= 0:
        return [1, 2, 3, 4, 5, 6]
    if total <= 6:
        return [1, 2, 3, 4, 5, 6]
    # 均匀采样 6 个点
    labels = []
    for i in range(6):
        idx = round(1 + i * (total - 1) / 5)
        labels.append(idx)
    return labels


@router.get("/growth-curve")
async def get_growth_curve(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user_optional),
):
    """返回当前用户所有已完成面试分析的五个维度评分时间序列。

    仅取 interview_sessions（音频上传 + 文本记录），不包含实时模拟面试与简历分析。
    """
    if not current_user:
        return {"points": [], "total_analyses": 0, "axis_labels": [1, 2, 3, 4, 5, 6]}

    stmt = (
        select(models.InterviewSession)
        .where(
            models.InterviewSession.user_id == current_user.id,
            models.InterviewSession.status == "completed",
        )
        .order_by(models.InterviewSession.created_at.asc())
    )
    result = await db.execute(stmt)
    sessions = result.scalars().all()

    points = []
    for s in sessions:
        scores = _extract_five_scores(s.analysis_result)
        if scores is None:
            continue
        # 判断类型：audio_url == "text_mode" 为文本记录模式
        session_type = "text" if s.audio_url == "text_mode" else "audio"
        points.append({
            "session_id": s.id,
            "session_title": s.title or "",
            "type": session_type,
            "analysis_time": s.created_at.isoformat() if s.created_at else None,
            "scores": scores,
        })

    # 按 analysis_time 升序（已由 SQL 保证），分配 analysis_index
    for i, pt in enumerate(points):
        pt["analysis_index"] = i + 1

    total = len(points)
    axis_labels = _compute_axis_labels(total)

    logger.info(
        f"[memory] growth-curve user_id={current_user.id} total={total}"
    )
    return {
        "points": points,
        "total_analyses": total,
        "axis_labels": axis_labels,
    }
