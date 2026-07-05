"""项目记忆异步子智能体。

从简历原文中提取项目经历，智能去重后写入项目记忆库。
完全独立于简历分析主流程：
  - 独立的数据库 session
  - 独立的 LLM 调用
  - 异常绝不向上传播（静默失败）
"""
import difflib
import logging
import re
import traceback
from typing import Optional

from sqlalchemy.future import select

from app.database import async_session
from app.models import ProjectMemory
from app.utils.llm import extract_project_experiences
from app.utils.resume_parser import parse_resume_structure
from app.services.embedding_indexer import schedule_index, schedule_batch_index

logger = logging.getLogger(__name__)


async def _run_project_memory_sub_agent(payload: dict) -> None:
    """异步子智能体外层入口：fire-and-forget。

    所有异常在此层被静默捕获，绝不向上传播。
    """
    try:
        await _run_project_memory_sub_agent_impl(payload)
    except Exception:
        logger.error(
            f"[project_memory_agent] ❌ 子智能体异常终止 "
            f"user_id={payload.get('user_id')}: {traceback.format_exc()}"
        )


async def _run_project_memory_sub_agent_impl(payload: dict) -> None:
    """异步子智能体核心逻辑。

    从简历原文中提取项目经历，去重后写入数据库。
    每一步都有独立的 try/except——单步失败不阻断后续步骤。
    """
    user_id = payload["user_id"]
    file_id = payload["file_id"]
    resume_text = payload["resume_text"]

    logger.info(
        f"[project_memory_agent] 子智能体启动 "
        f"user_id={user_id} file_id={file_id} resume_len={len(resume_text)}"
    )

    # ── Step A: 服务端结构化解析（子智能体独立执行） ──
    parsed_structure: dict = {}
    try:
        parsed_structure = parse_resume_structure(resume_text)
        logger.info(
            f"[project_memory_agent] 解析完成: "
            f"work_experiences={len(parsed_structure.get('work_experiences', []))}"
        )
    except Exception:
        logger.error(
            f"[project_memory_agent] 解析失败，子智能体终止: {traceback.format_exc()}"
        )
        return

    # ── Step B: 查询用户已有项目记忆（独立 DB session） ──
    existing_projects: list[dict] = []
    try:
        async with async_session() as db:
            stmt = (
                select(ProjectMemory)
                .where(ProjectMemory.user_id == user_id)
            )
            result = await db.execute(stmt)
            for ep in result.scalars().all():
                existing_projects.append({
                    "id": ep.id,
                    "project_name": ep.project_name,
                    "category": ep.category,
                })
        logger.info(
            f"[project_memory_agent] 已有项目: {len(existing_projects)} 个"
        )
    except Exception:
        logger.error(
            f"[project_memory_agent] 查询已有项目失败（降级为空列表继续）: "
            f"{traceback.format_exc()}"
        )
        existing_projects = []

    # ── Step C: 调用 LLM 提取项目经历（独立 LLM 调用） ──
    extracted_projects: list[dict] = []
    try:
        extracted_projects = await extract_project_experiences(
            resume_text=resume_text,
            parsed_structure=parsed_structure,
            existing_projects=existing_projects,
        )
        logger.info(
            f"[project_memory_agent] LLM 提取完成: 共 {len(extracted_projects)} 个项目"
        )
    except Exception:
        logger.error(
            f"[project_memory_agent] LLM 提取失败（子智能体终止）: "
            f"{traceback.format_exc()}"
        )
        return

    if not extracted_projects:
        logger.info("[project_memory_agent] 未提取到项目经历，子智能体结束")
        return

    # ── Step D+E: 去重 + 写入/更新（独立 DB session） ──
    upsert_results: list[dict] = []
    try:
        async with async_session() as db:
            for proj in extracted_projects:
                try:
                    action, proj_id = await upsert_project_memory(
                        db=db,
                        user_id=user_id,
                        project=proj,
                        source_file_id=file_id,
                    )
                    upsert_results.append({
                        "project_name": proj.get("project_name", "未知"),
                        "action": action,
                        "project_id": proj_id,
                    })
                except Exception:
                    logger.error(
                        f"[project_memory_agent] 单项目写入失败 "
                        f"[{proj.get('project_name', '未知')}]: {traceback.format_exc()}"
                    )
                    continue

            await db.commit()

            # P0 优化 O4：批量触发 AI 职业顾问索引
            # 旧逻辑：每个新插入/更新的项目都单独 schedule_index → N 次串行 embed API 调用
            # 新逻辑：一次性 schedule_batch_index → 1 次 batch embed + 并发 upsert
            index_payloads = [
                {
                    "kind": "project_memory",
                    "user_id": user_id,
                    "project_id": r["project_id"],
                }
                for r in upsert_results
            ]
            if index_payloads:
                try:
                    schedule_batch_index(index_payloads)
                except Exception:
                    # 降级：批量失败时退回逐个 schedule
                    logger.warning(
                        f"[project_memory_agent] schedule_batch_index 失败，降级为逐个 schedule_index"
                    )
                    for p in index_payloads:
                        try:
                            schedule_index(p)
                        except Exception:
                            pass
    except Exception:
        logger.error(
            f"[project_memory_agent] 数据库写入失败: {traceback.format_exc()}"
        )
        return

    # ── 完成日志 ──
    new_count = sum(1 for r in upsert_results if r["action"] == "insert")
    update_count = sum(1 for r in upsert_results if r["action"] == "update")
    logger.info(
        f"[project_memory_agent] ✅ 子智能体完成 "
        f"user_id={user_id} "
        f"提取={len(extracted_projects)} "
        f"新增={new_count} "
        f"更新={update_count} "
        f"项目列表={[r['project_name'] for r in upsert_results]}"
    )


# ============================================================================
# 去重 + 写入逻辑
# ============================================================================

async def upsert_project_memory(
    db,
    user_id: int,
    project: dict,
    source_resume_analysis_id: Optional[int] = None,
    source_file_id: Optional[int] = None,
) -> tuple[str, int]:
    """智能去重写入。返回 (操作类型 "insert"/"update", 项目记录ID)。

    4 级去重链：
      1. LLM 已明确标注 is_duplicate + matched_existing_id
      2. 精确 project_name 匹配（同一用户下）
      3. 核心关键词模糊匹配（SequenceMatcher ≥ 0.85）
      4. 确认为新项目 → INSERT
    """
    project_name = (project.get("project_name") or "").strip()
    if not project_name:
        raise ValueError("project_name 不能为空")

    # ── 优先级1: LLM 已明确标注重复 ──
    if project.get("is_duplicate") and project.get("matched_existing_id"):
        existing = await db.get(ProjectMemory, project["matched_existing_id"])
        if existing and existing.user_id == user_id:
            _update_project(existing, project, source_resume_analysis_id)
            return ("update", existing.id)

    # ── 优先级2: 精确名称匹配 ──
    stmt = select(ProjectMemory).where(
        ProjectMemory.user_id == user_id,
        ProjectMemory.project_name == project_name,
    )
    result = await db.execute(stmt)
    existing = result.scalars().first()
    if existing:
        _update_project(existing, project, source_resume_analysis_id)
        return ("update", existing.id)

    # ── 优先级3: 核心关键词匹配 ──
    core_name = _extract_core_name(project_name)
    all_stmt = select(ProjectMemory).where(ProjectMemory.user_id == user_id)
    all_result = await db.execute(all_stmt)
    for ep in all_result.scalars().all():
        ep_core = _extract_core_name(ep.project_name)
        if difflib.SequenceMatcher(None, core_name, ep_core).ratio() >= 0.85:
            _update_project(ep, project, source_resume_analysis_id)
            return ("update", ep.id)

    # ── 优先级4: 确认为新项目 → INSERT ──
    new_record = ProjectMemory(
        user_id=user_id,
        project_name=project_name,
        summary=(project.get("summary") or "")[:2000],
        category=project.get("category") or "基础平台",
        sub_tags=project.get("sub_tags") or [],
        tech_stack=project.get("tech_stack") or [],
        metrics=project.get("metrics") or {},
        role=project.get("role"),
        duration=project.get("duration"),
        mastery_level=_safe_int(project.get("mastery_level"), 50),
        importance=_safe_int(project.get("importance"), 50),
        source_type="resume_analysis",
        source_resume_analysis_id=source_resume_analysis_id,
        source_file_id=source_file_id,
        version=1,
        last_updated_by="ai",
        mention_count=0,
    )
    db.add(new_record)
    await db.flush()
    return ("insert", new_record.id)


# ============================================================================
# 内部辅助函数
# ============================================================================

def _update_project(
    existing: ProjectMemory,
    project: dict,
    source_resume_analysis_id: Optional[int] = None,
) -> None:
    """更新已有项目记忆（AI 提取信息合并到现有记录）。"""
    existing.version += 1
    existing.last_updated_by = "ai"

    # 覆盖字段（AI 最新分析结果更准确）
    if project.get("summary"):
        existing.summary = project["summary"][:2000]
    if project.get("category"):
        existing.category = project["category"]
    if project.get("sub_tags") is not None:
        existing.sub_tags = project["sub_tags"]
    if project.get("tech_stack") is not None:
        existing.tech_stack = project["tech_stack"]
    if project.get("metrics") is not None:
        existing.metrics = project["metrics"]
    if project.get("role"):
        existing.role = project["role"]
    if project.get("duration"):
        existing.duration = project["duration"]

    # mastery_level：只在新估值更高时提升
    new_mastery = _safe_int(project.get("mastery_level"), existing.mastery_level)
    if new_mastery > existing.mastery_level:
        existing.mastery_level = new_mastery

    # importance 直接覆盖
    existing.importance = _safe_int(project.get("importance"), existing.importance)

    if source_resume_analysis_id is not None:
        existing.source_resume_analysis_id = source_resume_analysis_id

    # mention_count 不覆盖（独立累加体系）


def _extract_core_name(name: str) -> str:
    """提取项目名的核心部分，去掉通用后缀和括号内容。

    "高并发订单系统" → "高并发订单"
    "支付系统重构(二期)" → "支付系统重构"
    """
    suffixes = [
        "系统", "平台", "引擎", "服务", "中心", "模块",
        "工具", "组件", "框架", "应用", "网关", "中台",
    ]
    # 去掉括号及内容
    cleaned = re.sub(r'\s*[（(][^)）]*[)）]', '', name).strip()
    for sfx in suffixes:
        if cleaned.endswith(sfx) and len(cleaned) - len(sfx) >= 2:
            cleaned = cleaned[:-len(sfx)]
            break
    return cleaned


def _safe_int(v, default: int = 0) -> int:
    """安全转换为 int，失败返回 default。"""
    if v is None:
        return default
    try:
        return int(v)
    except (TypeError, ValueError):
        return default
