"""项目记忆库 CRUD API 路由。

提供前端「职业记忆看板→项目记忆库」Tab 所需的数据查询和手动编辑能力。
AI 自动提取的项目经历通过 services/project_memory_agent 写入。
"""
import asyncio
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload

from app import models, schemas
from app.database import get_db
from app.routers.auth import get_current_user_optional
from app.services.embedding_indexer import schedule_index, delete_source_embeddings

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

    # 触发 AI 职业顾问索引
    schedule_index({
        "kind": "project_memory",
        "user_id": user.id,
        "project_id": pm.id,
    })

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

    # 触发 AI 职业顾问索引（更新即重新切片 + embedding）
    schedule_index({
        "kind": "project_memory",
        "user_id": user.id,
        "project_id": pm.id,
    })

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

    # 同步删除 AI 职业顾问向量索引
    try:
        deleted = await delete_source_embeddings("project_memory", project_id)
        logger.info(f"[memory] 已清理 {deleted} 条项目记忆向量索引")
    except Exception as e:
        logger.error(f"[memory] 清理向量索引失败: {e!r}")

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
        # 直接读结构化列；display_title 由后端拼接给前端历史列表展示用
        display_title = " · ".join(
            x for x in [s.company, s.role, s.round] if x
        ) or "未命名面试分析"
        points.append({
            "session_id": s.id,
            "session_title": display_title,
            "type": session_type,
            "analysis_time": s.created_at.isoformat() if s.created_at else None,
            "scores": scores,
            "company": s.company or "",
            "role": s.role or "",
            "round": s.round or "",
            "date": s.date or "",
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


# ============================================================================
# 分析时间轴（全量历史记录聚合接口）
# ============================================================================

@router.get("/timeline")
async def get_timeline(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user_optional),
):
    """返回当前用户的全量分析历史（时间轴），合并三个数据源：

    - interview_sessions（录音/文字面试）
    - resume_analyses（简历分析）
    - interview_live_sessions（实时模拟面试）

    按 created_at 倒序排列，供前端 memory 时间轴和 home 最近活动共用。
    """
    if not current_user:
        return {"items": []}

    items: list[dict] = []

    # 1. 面试会话（音频 + 文字）
    audio_result = await db.execute(
        select(models.InterviewSession)
        .where(models.InterviewSession.user_id == current_user.id)
        .order_by(models.InterviewSession.created_at.desc())
    )
    for s in audio_result.scalars().all():
        # 直接读结构化列，title 不参与数据解析
        company = s.company or ""
        role = s.role or ("面试记录" if s.audio_url == "text_mode" else "录音分析")
        round_label = s.round or ""

        grade = "待提升候选人"
        if s.ipi_score >= 80:
            grade = "优秀候选人"
        elif s.ipi_score >= 70:
            grade = "中级候选人"

        items.append({
            "id": str(s.id),
            "type": "text" if s.audio_url == "text_mode" else "audio",
            "title": " · ".join(x for x in [company, role, round_label] if x) or "未命名面试分析",
            "score": s.ipi_score or 0,
            "grade": grade,
            "company": company,
            "role": role,
            "round": round_label,
            "date": s.date or (s.created_at.date().isoformat() if s.created_at else None),
            "details": s.executive_summary or "",
            "created_at": s.created_at.isoformat() if s.created_at else None,
        })

    # 2. 简历分析
    resume_result = await db.execute(
        select(models.ResumeAnalysis, models.UploadedFile.filename)
        .join(models.UploadedFile, models.ResumeAnalysis.file_id == models.UploadedFile.id)
        .where(models.ResumeAnalysis.user_id == current_user.id)
        .order_by(models.ResumeAnalysis.created_at.desc())
    )
    for ra, filename in resume_result.all():
        items.append({
            "id": str(ra.id),
            "type": "resume",
            "title": f"简历优化 · {filename or '简历'}",
            "score": ra.score or 0,
            "grade": "优秀简历" if (ra.score or 0) >= 85 else ("良好简历" if (ra.score or 0) >= 70 else "待提升简历"),
            "company": "个人简历",
            "role": filename or "未知岗位",
            "round": "简历深度分析",
            "details": f"ATS通过率 {ra.ats_pass_rate or 0}%。评分 {ra.score or 0}分，预计优化后 {ra.optimized_score or 0}分。",
            "created_at": ra.created_at.isoformat() if ra.created_at else None,
            "ats_pass_rate": ra.ats_pass_rate,
            "optimized_score": ra.optimized_score,
        })

    # 3. 实时模拟面试
    live_result = await db.execute(
        select(models.InterviewLiveSession)
        .where(models.InterviewLiveSession.user_id == current_user.id)
        .order_by(models.InterviewLiveSession.created_at.desc())
    )
    interview_type_label: dict[str, str] = {
        "tech_8gu": "技术面·八股",
        "tech_project": "技术面·项目",
        "tech_scenario": "技术面·场景",
        "hr_comprehensive": "HR面",
    }
    difficulty_label: dict[str, str] = {
        "Lv1": "友善", "Lv2": "偏友好", "Lv3": "有压力", "Lv4": "严苟",
    }
    for l in live_result.scalars().all():
        dur_min = round((l.duration_sec or 0) / 60)
        live_role = interview_type_label.get(l.interview_type, "实时模拟")
        live_round = difficulty_label.get(l.difficulty, l.difficulty or "—")
        live_score = l.ipi_score or 0
        items.append({
            "id": str(l.session_id or l.id),
            "liveId": l.id,
            "type": "live",
            "title": f"实时模拟面试 · {l.target_role or '面试'}",
            "score": live_score,
            "grade": "已完成" if l.status == "completed" else (
                {"created": "等待开始", "ws_connecting": "连接中", "live": "进行中",
                 "ending": "正在结束", "ended": "已结束", "analyzing": "分析中",
                 "failed": "评估失败"}.get(l.status, "未知状态")
            ),
            "company": l.company_style or "—",
            "role": live_role,
            "round": f"{dur_min}分钟 · {live_round}" if dur_min > 0 else live_round,
            "details": f"{live_role} · {live_round}" + (f" · {l.persona_cn}" if l.persona_cn else ""),
            "created_at": l.created_at.isoformat() if l.created_at else None,
            "interview_type": l.interview_type,
            "difficulty": l.difficulty,
            "duration_sec": l.duration_sec,
            "status": l.status,
            "persona_cn": l.persona_cn,
        })

    # 按 created_at 倒序
    items.sort(key=lambda x: x.get("created_at") or "", reverse=True)

    logger.info(f"[memory] timeline user_id={current_user.id} total={len(items)}")
    return {"items": items}


# ── 知识库能力看板 ──────────────────────────────────────────

@router.get("/knowledge/abilities")
async def get_knowledge_abilities(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user_optional),
):
    """获取当前用户的知识库能力卡片列表。

    返回 4 个核心能力（各含 5 个细化能力）+ 生成快照元数据。
    未生成时返回空列表。
    """
    user = _require_user(current_user)

    core_stmt = (
        select(models.KnowledgeCoreAbility)
        .where(models.KnowledgeCoreAbility.user_id == user.id)
        .order_by(models.KnowledgeCoreAbility.sort_order)
        .options(selectinload(models.KnowledgeCoreAbility.sub_abilities))
    )
    result = await db.execute(core_stmt)
    cores = result.scalars().all()

    if not cores:
        return {
            "abilities": [],
            "generated_at": None,
            "from_role": None,
            "from_years": None,
            "from_grade": None,
        }

    abilities = []
    for ca in cores:
        abilities.append({
            "id": ca.id,
            "name": ca.name,
            "sort_order": ca.sort_order,
            "sub_abilities": [
                {
                    "id": sa.id,
                    "name": sa.name,
                    "sort_order": sa.sort_order,
                    "question_count": sa.question_count,
                }
                for sa in ca.sub_abilities
            ],
        })

    first_core = cores[0]
    return {
        "abilities": abilities,
        "generated_at": first_core.created_at.isoformat() if first_core.created_at else None,
        "from_role": first_core.generated_from_role,
        "from_years": first_core.generated_from_years,
        "from_grade": first_core.generated_from_grade,
    }


@router.post("/knowledge/generate")
async def generate_knowledge_abilities(
    rematch: bool = Query(False, description="是否回填所有历史面试记录来重新计数"),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user_optional),
):
    """触发 LLM 生成/重新生成知识库能力卡片，返回最新数据。

    从 user_profiles 读取目标岗位 / 年限 / 职级。
    已有数据时会先清除再重新生成。

    - rematch=false（默认）：清空所有计数，生成新能力，后续分析自然累加
    - rematch=true：生成新能力后扫描所有历史面试记录回填计数
    """
    user = _require_user(current_user)

    profile_stmt = select(models.UserProfile).where(
        models.UserProfile.user_id == user.id
    )
    profile_result = await db.execute(profile_stmt)
    profile = profile_result.scalars().first()

    if not profile or not profile.target_role:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="请先在职业驾驶舱设置目标岗位",
        )

    from app.services.knowledge_ability_service import KnowledgeAbilityService

    await KnowledgeAbilityService.regenerate_for_user(db, user.id, rematch=rematch)

    # 重新查询并返回最新数据
    core_stmt = (
        select(models.KnowledgeCoreAbility)
        .where(models.KnowledgeCoreAbility.user_id == user.id)
        .order_by(models.KnowledgeCoreAbility.sort_order)
        .options(selectinload(models.KnowledgeCoreAbility.sub_abilities))
    )
    result = await db.execute(core_stmt)
    cores = result.scalars().all()

    abilities = []
    for ca in cores:
        abilities.append({
            "id": ca.id,
            "name": ca.name,
            "sort_order": ca.sort_order,
            "sub_abilities": [
                {
                    "id": sa.id,
                    "name": sa.name,
                    "sort_order": sa.sort_order,
                    "question_count": sa.question_count,
                }
                for sa in ca.sub_abilities
            ],
        })

    first_core = cores[0] if cores else None
    return {
        "abilities": abilities,
        "generated_at": first_core.created_at.isoformat() if first_core and first_core.created_at else None,
        "from_role": first_core.generated_from_role if first_core else None,
        "from_years": first_core.generated_from_years if first_core else None,
        "from_grade": first_core.generated_from_grade if first_core else None,
    }


@router.post("/knowledge/match-session")
async def match_knowledge_session(
    body: dict,
    db: AsyncSession = Depends(get_db),
):
    """内部端点：将面试分析中发现的问题匹配到细化能力并递增计数。

    由 audio.py / live.py 分析管道在完成后调用，不对外开放。
    """
    user_id = body.get("user_id")
    session_id = body.get("session_id")
    issues = body.get("issues", [])

    if not user_id or not issues:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="user_id and issues are required",
        )

    from app.services.knowledge_ability_service import KnowledgeAbilityService

    await KnowledgeAbilityService.match_session_issues(db, int(user_id), issues)
    return {"matched": True, "session_id": session_id, "issues_count": len(issues)}
