"""Embedding 索引服务（AI 职业顾问 RAG 用）。

负责：
  1. 把不同来源的分析结果（面试/简历/项目）切片成 chunk
  2. 调用 embed_for_storage（type=db）获取 1536 维向量
  3. 幂等 upsert 到 user_analysis_embeddings 表
  4. 提供删除接口（按 source_type+source_id）

调用模式：fire-and-forget 后台任务，由 router 在主流程 commit 后触发：
  - 单条记录错误不影响主流程
  - 失败不重试（避免阻塞主流程），但有完整日志便于排查

chunk 切分原则：
  - 每条 chunk 必须语义自包含
  - 内容长度控制在 500-1000 中文字（保证 embedding 质量）
  - meta JSONB 存结构化元数据（公司、时间、评分等），便于后续按字段过滤
"""
import asyncio
import json
import logging
import traceback
from typing import Optional

from sqlalchemy import select, delete
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.database import async_session
from app import models
from app.services.embedding import embed_for_storage, truncate_to_token_limit

logger = logging.getLogger(__name__)


# ============================================================================
# 1. 切片函数：把分析结果切成 chunk 列表
# ============================================================================

def chunk_interview_summary(analysis: dict, session_title: str) -> list[dict]:
    """
    把 interview_sessions.analysis_result 切成 4 段。
    返回：[{"index": int, "title": str, "content": str, "meta": dict}, ...]
    """
    chunks = []
    session_meta = {
        "ipi_score": analysis.get("ipi_score"),
        "offer_probability": analysis.get("offer_probability"),
        "session_title": session_title,
    }

    # Chunk 0: 综合评价（executive_summary + strengths/weaknesses/suggestions）
    exec_sum = (analysis.get("executive_summary") or "").strip()
    strengths = analysis.get("summary_strengths") or []
    weaknesses = analysis.get("summary_weaknesses") or []
    suggestions = analysis.get("summary_suggestions") or []
    if exec_sum or strengths or weaknesses or suggestions:
        text = (
            f"面试综合评价（{session_title}）\n"
            f"IPI 综合评分：{analysis.get('ipi_score', 'N/A')}，Offer 概率：{analysis.get('offer_probability', 'N/A')}%\n\n"
            f"总结：{exec_sum}\n\n"
            f"优势：{' / '.join(strengths)}\n"
            f"不足：{' / '.join(weaknesses)}\n"
            f"建议：{' / '.join(suggestions)}"
        )
        chunks.append({
            "index": 0,
            "title": f"{session_title} · 综合评价",
            "content": truncate_to_token_limit(text),
            "meta": session_meta,
        })

    # Chunk 1: 五维评分
    scores = analysis.get("scores") or {}
    if isinstance(scores, dict) and scores:
        text = (
            f"五维评分（{session_title}）\n"
            f"表达力：{scores.get('expression', 'N/A')}\n"
            f"逻辑性：{scores.get('logic', 'N/A')}\n"
            f"项目深度：{scores.get('project_depth', 'N/A')}\n"
            f"数据指标：{scores.get('ownership', 'N/A')}\n"
            f"技术广度：{scores.get('system_design', 'N/A')}"
        )
        chunks.append({
            "index": 1,
            "title": f"{session_title} · 五维评分",
            "content": truncate_to_token_limit(text),
            "meta": {**session_meta, "scores": scores},
        })

    # Chunk 2: 最大失分点 TOP 3
    lose_points = analysis.get("max_lose_points") or []
    if isinstance(lose_points, list) and lose_points:
        lines = [f"面试最大失分点（{session_title}）"]
        for p in lose_points:
            if not isinstance(p, dict):
                continue
            lines.append(f"#{p.get('rank', '?')} [{p.get('tag', '?')}] {p.get('label', '')}\n  {p.get('desc', '')}")
        chunks.append({
            "index": 2,
            "title": f"{session_title} · 失分点",
            "content": truncate_to_token_limit("\n".join(lines)),
            "meta": session_meta,
        })

    # Chunk 3: 面试官视角 + 问题拆解 + 追问路径
    perspective = analysis.get("interviewer_perspective") or []
    question_decon = analysis.get("question_deconstruction") or []
    followups = analysis.get("followup_paths") or []
    if perspective or question_decon or followups:
        lines = [f"面试考点分析（{session_title}）"]
        if perspective:
            lines.append("\n面试官真正在验证：")
            for p in perspective:
                if isinstance(p, dict):
                    lines.append(f"- 考察：{p.get('label', '')} → 验证：{p.get('val', '')}")
        if question_decon:
            lines.append("\n问题拆解：")
            for q in question_decon:
                if isinstance(q, dict):
                    lines.append(f"- {q.get('stage', '')} · {q.get('title', '')}\n  {q.get('desc', '')}")
        if followups:
            lines.append("\n追问路径：")
            for f in followups:
                if isinstance(f, dict):
                    lines.append(f"- [{f.get('tag', '?')}] {f.get('title', '')}\n  {f.get('desc', '')}")
        chunks.append({
            "index": 3,
            "title": f"{session_title} · 考点分析",
            "content": truncate_to_token_limit("\n".join(lines)),
            "meta": session_meta,
        })

    return chunks


def chunk_interview_section(section) -> list[dict]:
    """单个 TranscriptSection → 1 个 chunk。"""
    title = section.title or "未命名段落"
    summary = (section.summary or "").strip()
    advantages = section.advantages or []
    shortcomings = section.shortcomings or []
    review_points = section.review_points or []
    text_parts = [f"面试片段：{title}（{section.category or 'other'}，{section.tag or '一般'}）"]
    if summary:
        text_parts.append(f"\n小评：{summary}")
    if advantages:
        text_parts.append(f"\n亮点：{' / '.join(advantages)}")
    if shortcomings:
        text_parts.append(f"\n薄弱：{' / '.join(shortcomings)}")
    if review_points:
        text_parts.append(f"\n复习重点：{' / '.join(review_points)}")
    return [{
        "index": 0,
        "title": f"面试片段 · {title}",
        "content": truncate_to_token_limit("\n".join(text_parts)),
        "meta": {
            "category": section.category,
            "tag": section.tag,
            "start_time": section.start_time,
            "end_time": section.end_time,
            "session_id": section.session_id,
        },
    }]


def chunk_resume_analysis(result_json: dict, file_name: str) -> list[dict]:
    """把 resume_analyses.result_json 切成 3 段。"""
    chunks = []
    base_meta = {
        "file_name": file_name,
        "score": result_json.get("score"),
        "optimized_score": result_json.get("optimized_score"),
        "ats_pass_rate": result_json.get("ats_pass_rate"),
    }

    # Chunk 0: 简历评分 + 候选人画像
    profile = result_json.get("profile") or {}
    if isinstance(profile, dict) and profile:
        text = (
            f"简历分析（{file_name}）\n"
            f"当前评分：{result_json.get('score', 'N/A')} → 优化后：{result_json.get('optimized_score', 'N/A')}\n"
            f"ATS 通过率：{result_json.get('ats_pass_rate', 'N/A')}%\n\n"
            f"候选人画像：\n"
            f"- 姓名：{profile.get('name', '?')}\n"
            f"- 当前：{profile.get('company', '?')} / {profile.get('title', '?')} / {profile.get('role', '?')}\n"
            f"- 工作年限：{profile.get('years', '?')}\n"
            f"- 薪资：{profile.get('salary', '?')}\n"
            f"- 目标：{profile.get('targetCompany', '?')} / {profile.get('targetRole', '?')} / {profile.get('targetGrade', '?')}\n"
            f"- 目标薪资：{profile.get('targetSalary', '?')}"
        )
        chunks.append({
            "index": 0,
            "title": f"简历分析 · {profile.get('name', file_name)} 画像",
            "content": truncate_to_token_limit(text),
            "meta": base_meta,
        })

    # Chunk 1: 风险点 + 优化建议
    risks = result_json.get("risks") or []
    suggestions = result_json.get("optimization_suggestions") or []
    if risks or suggestions:
        lines = [f"简历优化建议（{file_name}）"]
        if risks:
            lines.append("\n风险点：")
            for r in risks:
                if isinstance(r, dict):
                    lines.append(f"- [{r.get('severity', '?')}] {r.get('title', '')}\n  {r.get('desc', '')}")
        if suggestions:
            lines.append("\n优化建议：")
            for s in suggestions:
                if isinstance(s, dict):
                    lines.append(f"- {s.get('title', '')}\n  {s.get('desc', '')}")
        chunks.append({
            "index": 1,
            "title": f"简历分析 · 风险与建议",
            "content": truncate_to_token_limit("\n".join(lines)),
            "meta": base_meta,
        })

    # Chunk 2: 岗位匹配度 + 关键词
    match = result_json.get("match_analysis") or {}
    kw = result_json.get("keywords_analysis") or {}
    if match or kw:
        text_parts = [f"简历匹配度分析（{file_name}）"]
        if isinstance(match, dict) and match:
            text_parts.append(f"\n岗位匹配度：{match.get('match_score', '?')} / 100")
            text_parts.append(f"评估：{match.get('match_desc', '')}")
            coverages = match.get("coverages") or []
            if coverages:
                text_parts.append("\n覆盖情况：")
                for c in coverages:
                    if isinstance(c, dict):
                        text_parts.append(f"- [{c.get('status', '?')}] {c.get('item', '')}：{c.get('percent', '')}")
        if isinstance(kw, dict) and kw:
            current = kw.get("current_keywords") or []
            recommended = kw.get("recommended_keywords") or []
            if current:
                text_parts.append(f"\n已覆盖关键词：{', '.join(current)}")
            if recommended:
                text_parts.append(f"\n建议补齐：{', '.join(recommended)}")
        chunks.append({
            "index": 2,
            "title": f"简历分析 · 匹配度与关键词",
            "content": truncate_to_token_limit("\n".join(text_parts)),
            "meta": base_meta,
        })

    return chunks


def chunk_project_memory(pm) -> list[dict]:
    """单个 ProjectMemory → 1 个 chunk。"""
    summary = (pm.summary or "").strip()
    desc = (pm.description or "").strip()
    text_parts = [
        f"项目：{pm.project_name}",
        f"分类：{pm.category or '其他'}",
    ]
    if pm.role:
        text_parts.append(f"角色：{pm.role}")
    if pm.duration:
        text_parts.append(f"时间：{pm.duration}")
    if pm.team_size:
        text_parts.append(f"团队规模：{pm.team_size}人")
    if summary:
        text_parts.append(f"\n简介：{summary}")
    if desc:
        text_parts.append(f"\n详细：{desc}")
    if pm.tech_stack:
        text_parts.append(f"\n技术栈：{', '.join(pm.tech_stack)}")
    if pm.metrics and isinstance(pm.metrics, dict):
        metrics_str = ", ".join(f"{k}={v}" for k, v in pm.metrics.items())
        if metrics_str:
            text_parts.append(f"\n量化指标：{metrics_str}")
    if pm.sub_tags:
        text_parts.append(f"\n标签：{', '.join(pm.sub_tags)}")

    return [{
        "index": 0,
        "title": f"项目记忆 · {pm.project_name}",
        "content": truncate_to_token_limit("\n".join(text_parts)),
        "meta": {
            "category": pm.category,
            "sub_tags": pm.sub_tags or [],
            "importance": pm.importance,
            "mastery_level": pm.mastery_level,
            "mention_count": pm.mention_count,
        },
    }]


# ============================================================================
# 2. 索引写入：调 embedding + 幂等 upsert
# ============================================================================

async def _upsert_chunks(
    user_id: int,
    source_type: str,
    source_id: int,
    chunks: list[dict],
) -> int:
    """
    把切片 + embedding 写入 user_analysis_embeddings。
    幂等：同 (source_type, source_id) 旧 chunk 全部删除后再插入新 chunk，
    保证每次索引反映最新内容。
    返回成功写入的 chunk 数。
    """
    if not chunks:
        # 如果没有 chunk，删除旧数据后返回
        async with async_session() as db:
            await db.execute(
                delete(models.UserAnalysisEmbedding).where(
                    models.UserAnalysisEmbedding.source_type == source_type,
                    models.UserAnalysisEmbedding.source_id == source_id,
                )
            )
            await db.commit()
        return 0

    # 1. 调 embedding API
    texts = [c["content"] for c in chunks]
    try:
        vectors = await embed_for_storage(texts)
    except Exception as e:
        logger.error(
            f"[indexer] embed_for_storage 失败 user_id={user_id} "
            f"source={source_type}/{source_id} chunks={len(chunks)}: {e!r}"
        )
        return 0

    if len(vectors) != len(chunks):
        logger.error(
            f"[indexer] 向量数 ({len(vectors)}) 与 chunk 数 ({len(chunks)}) 不一致"
        )
        return 0

    # 2. 写 DB：先删旧 chunk，再 bulk insert
    async with async_session() as db:
        try:
            await db.execute(
                delete(models.UserAnalysisEmbedding).where(
                    models.UserAnalysisEmbedding.source_type == source_type,
                    models.UserAnalysisEmbedding.source_id == source_id,
                )
            )

            rows = [
                {
                    "user_id": user_id,
                    "source_type": source_type,
                    "source_id": source_id,
                    "chunk_index": c["index"],
                    "chunk_title": c["title"],
                    "content": c["content"],
                    "meta": c["meta"],
                    "embedding": vec,
                }
                for c, vec in zip(chunks, vectors)
            ]
            # 用 bulk insert（不走 ORM 关系，性能更好）
            await db.execute(models.UserAnalysisEmbedding.__table__.insert(), rows)
            await db.commit()
            logger.info(
                f"[indexer] indexed user_id={user_id} source={source_type}/{source_id} "
                f"chunks={len(rows)}"
            )
            return len(rows)
        except Exception as e:
            await db.rollback()
            logger.error(
                f"[indexer] DB 写入失败 user_id={user_id} "
                f"source={source_type}/{source_id}: {e!r}\n{traceback.format_exc()}"
            )
            return 0


# ============================================================================
# 3. 业务入口：fire-and-forget 后台任务
# ============================================================================

def schedule_index(payload: dict) -> None:
    """fire-and-forget 启动索引任务。

    payload 必须包含：
      - kind: 'interview_summary' | 'interview_section' | 'resume_analysis' | 'project_memory' | 'live_interview'
      - 其余字段按 kind 不同
    """
    asyncio.create_task(_index_with_safety(payload))


async def _index_with_safety(payload: dict) -> None:
    """所有异常在此层捕获，绝不向上传播。"""
    try:
        kind = payload.get("kind")
        if kind == "interview_summary":
            await _index_interview_summary(payload)
        elif kind == "interview_section":
            await _index_interview_section(payload)
        elif kind == "interview_sections_bulk":
            await _index_interview_sections_bulk(payload)
        elif kind == "resume_analysis":
            await _index_resume_analysis(payload)
        elif kind == "project_memory":
            await _index_project_memory(payload)
        elif kind == "live_interview":
            await _index_live_interview(payload)
        else:
            logger.error(f"[indexer] unknown kind: {kind!r}")
    except Exception:
        logger.error(
            f"[indexer] 未捕获异常 kind={payload.get('kind')}: {traceback.format_exc()}"
        )


async def _index_interview_summary(payload: dict) -> None:
    user_id = payload["user_id"]
    session_id = payload["session_id"]
    async with async_session() as db:
        sess = await db.get(models.InterviewSession, session_id)
        if not sess or not sess.analysis_result:
            return
        chunks = chunk_interview_summary(sess.analysis_result, sess.title or f"面试{session_id}")
    if chunks:
        await _upsert_chunks(user_id, "interview_summary", session_id, chunks)


async def _index_interview_section(payload: dict) -> None:
    user_id = payload["user_id"]
    section_id = payload["section_id"]
    async with async_session() as db:
        sec = await db.get(models.TranscriptSection, section_id)
        if not sec:
            return
        # 取 user_id from session
        sess = await db.get(models.InterviewSession, sec.session_id)
        if not sess or not sess.user_id:
            return
        chunks = chunk_interview_section(sec)
    if chunks:
        await _upsert_chunks(sess.user_id, "interview_section", section_id, chunks)


async def _index_interview_sections_bulk(payload: dict) -> None:
    """一次性索引某场面试的所有 sections。"""
    user_id = payload["user_id"]
    session_id = payload["session_id"]
    async with async_session() as db:
        stmt = select(models.TranscriptSection).where(
            models.TranscriptSection.session_id == session_id
        )
        sections = (await db.execute(stmt)).scalars().all()
        for sec in sections:
            chunks = chunk_interview_section(sec)
            if chunks:
                await _upsert_chunks(user_id, "interview_section", sec.id, chunks)


async def _index_resume_analysis(payload: dict) -> None:
    user_id = payload["user_id"]
    resume_analysis_id = payload["resume_analysis_id"]
    async with async_session() as db:
        ra = await db.get(models.ResumeAnalysis, resume_analysis_id)
        if not ra or not ra.result_json:
            return
        file_name = "简历"
        if ra.file_id:
            f = await db.get(models.UploadedFile, ra.file_id)
            if f:
                file_name = f.filename
        chunks = chunk_resume_analysis(ra.result_json, file_name)
    if chunks:
        await _upsert_chunks(user_id, "resume_analysis", resume_analysis_id, chunks)


async def _index_project_memory(payload: dict) -> None:
    user_id = payload["user_id"]
    project_id = payload["project_id"]
    async with async_session() as db:
        pm = await db.get(models.ProjectMemory, project_id)
        if not pm or pm.user_id != user_id:
            return
        chunks = chunk_project_memory(pm)
    if chunks:
        await _upsert_chunks(user_id, "project_memory", project_id, chunks)


async def _index_live_interview(payload: dict) -> None:
    """实时面试报告（结构与 interview_summary 类似）"""
    user_id = payload["user_id"]
    live_session_id = payload["live_session_id"]
    async with async_session() as db:
        live = await db.get(models.InterviewLiveSession, live_session_id)
        if not live or not live.analysis_result:
            return
        title = f"{live.target_role or '面试'} · 实时面试{live_session_id}"
        # 组装一个与 interview_summary 结构类似的 dict
        analysis = dict(live.analysis_result)
        analysis.setdefault("ipi_score", live.ipi_score)
        analysis.setdefault("offer_probability", live.offer_probability)
        if live.summary_strengths and not analysis.get("summary_strengths"):
            analysis["summary_strengths"] = live.summary_strengths
        if live.summary_weaknesses and not analysis.get("summary_weaknesses"):
            analysis["summary_weaknesses"] = live.summary_weaknesses
        if live.summary_suggestions and not analysis.get("summary_suggestions"):
            analysis["summary_suggestions"] = live.summary_suggestions
        if live.executive_summary and not analysis.get("executive_summary"):
            analysis["executive_summary"] = live.executive_summary
        chunks = chunk_interview_summary(analysis, title)
    if chunks:
        await _upsert_chunks(user_id, "live_interview", live_session_id, chunks)


# ============================================================================
# 4. 删除接口
# ============================================================================

async def delete_source_embeddings(source_type: str, source_id: int) -> int:
    """删除某来源的所有 chunk。返回删除条数。"""
    async with async_session() as db:
        result = await db.execute(
            delete(models.UserAnalysisEmbedding).where(
                models.UserAnalysisEmbedding.source_type == source_type,
                models.UserAnalysisEmbedding.source_id == source_id,
            )
        )
        await db.commit()
        return result.rowcount or 0
