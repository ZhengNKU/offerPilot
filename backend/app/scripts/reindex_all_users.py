"""一次性回填脚本：把所有用户的现有分析记录写入向量库。

使用方式：
  cd backend && python -m app.scripts.reindex_all_users [--user-id <id>] [--source-types ...]

参数：
  --user-id:      只回填指定用户（默认所有用户）
  --source-types: 逗号分隔的 source_type 列表（默认全部）
  --dry-run:      只打印计划，不实际写入
"""
import argparse
import asyncio
import logging
import sys
from pathlib import Path

# 让脚本能从 backend/ 目录直接运行
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from sqlalchemy import select
from app.database import async_session
from app import models
from app.services.embedding_indexer import (
    chunk_interview_summary,
    chunk_interview_section,
    chunk_resume_analysis,
    chunk_project_memory,
    _upsert_chunks,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger("reindex")


async def reindex_user(user_id: int, source_types: list[str], dry_run: bool) -> dict:
    """回填一个用户的所有分析。返回统计 dict。"""
    stats = {"project_memory": 0, "interview_summary": 0, "interview_section": 0,
             "resume_analysis": 0, "live_interview": 0, "errors": 0}

    if "project_memory" in source_types:
        async with async_session() as db:
            result = await db.execute(
                select(models.ProjectMemory).where(models.ProjectMemory.user_id == user_id)
            )
            projects = result.scalars().all()
        for pm in projects:
            if dry_run:
                log.info(f"  [dry-run] would index project_memory id={pm.id} name={pm.project_name!r}")
                stats["project_memory"] += 1
                continue
            try:
                chunks = chunk_project_memory(pm)
                n = await _upsert_chunks(user_id, "project_memory", pm.id, chunks)
                stats["project_memory"] += n
            except Exception as e:
                log.error(f"  project_memory id={pm.id} failed: {e!r}")
                stats["errors"] += 1

    if "interview_summary" in source_types:
        async with async_session() as db:
            result = await db.execute(
                select(models.InterviewSession).where(
                    models.InterviewSession.user_id == user_id,
                    models.InterviewSession.analysis_result.isnot(None),
                )
            )
            sessions = result.scalars().all()
        for sess in sessions:
            if dry_run:
                log.info(f"  [dry-run] would index interview_summary id={sess.id}")
                stats["interview_summary"] += 1
                continue
            try:
                chunks = chunk_interview_summary(
                    sess.analysis_result,
                    " · ".join(x for x in [sess.company, sess.role, sess.round] if x) or f"面试{sess.id}",
                )
                n = await _upsert_chunks(user_id, "interview_summary", sess.id, chunks)
                stats["interview_summary"] += n
            except Exception as e:
                log.error(f"  interview_summary id={sess.id} failed: {e!r}")
                stats["errors"] += 1

    if "interview_section" in source_types:
        async with async_session() as db:
            result = await db.execute(
                select(models.TranscriptSection, models.InterviewSession)
                .join(models.InterviewSession, models.TranscriptSection.session_id == models.InterviewSession.id)
                .where(models.InterviewSession.user_id == user_id)
            )
            rows = result.all()
        for section, sess in rows:
            if dry_run:
                log.info(f"  [dry-run] would index interview_section id={section.id}")
                stats["interview_section"] += 1
                continue
            try:
                chunks = chunk_interview_section(section)
                n = await _upsert_chunks(user_id, "interview_section", section.id, chunks)
                stats["interview_section"] += n
            except Exception as e:
                log.error(f"  interview_section id={section.id} failed: {e!r}")
                stats["errors"] += 1

    if "resume_analysis" in source_types:
        async with async_session() as db:
            result = await db.execute(
                select(models.ResumeAnalysis).where(models.ResumeAnalysis.user_id == user_id)
            )
            ras = result.scalars().all()
        for ra in ras:
            if dry_run:
                log.info(f"  [dry-run] would index resume_analysis id={ra.id}")
                stats["resume_analysis"] += 1
                continue
            try:
                file_name = "简历"
                if ra.file_id:
                    f = await db.get(models.UploadedFile, ra.file_id)
                    if f:
                        file_name = f.filename
                chunks = chunk_resume_analysis(ra.result_json, file_name)
                n = await _upsert_chunks(user_id, "resume_analysis", ra.id, chunks)
                stats["resume_analysis"] += n
            except Exception as e:
                log.error(f"  resume_analysis id={ra.id} failed: {e!r}")
                stats["errors"] += 1

    if "live_interview" in source_types:
        async with async_session() as db:
            result = await db.execute(
                select(models.InterviewLiveSession).where(
                    models.InterviewLiveSession.user_id == user_id,
                    models.InterviewLiveSession.analysis_result.isnot(None),
                )
            )
            lives = result.scalars().all()
        for live in lives:
            if dry_run:
                log.info(f"  [dry-run] would index live_interview id={live.id}")
                stats["live_interview"] += 1
                continue
            try:
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
                title = f"{live.target_role or '面试'} · 实时面试{live.id}"
                chunks = chunk_interview_summary(analysis, title)
                n = await _upsert_chunks(user_id, "live_interview", live.id, chunks)
                stats["live_interview"] += n
            except Exception as e:
                log.error(f"  live_interview id={live.id} failed: {e!r}")
                stats["errors"] += 1

    return stats


async def main_async():
    parser = argparse.ArgumentParser(description="回填向量库")
    parser.add_argument("--user-id", type=int, default=None, help="指定用户 id（默认所有）")
    parser.add_argument(
        "--source-types",
        type=str,
        default="project_memory,interview_summary,interview_section,resume_analysis,live_interview",
        help="逗号分隔的 source_type 列表",
    )
    parser.add_argument("--dry-run", action="store_true", help="只打印计划，不实际写入")
    args = parser.parse_args()

    source_types = [s.strip() for s in args.source_types.split(",") if s.strip()]
    log.info(f"Reindex config: user_id={args.user_id} source_types={source_types} dry_run={args.dry_run}")

    async with async_session() as db:
        if args.user_id:
            user_ids = [args.user_id]
        else:
            result = await db.execute(select(models.User.id))
            user_ids = [r[0] for r in result.all()]
    log.info(f"Will process {len(user_ids)} users")

    total_stats = {"project_memory": 0, "interview_summary": 0, "interview_section": 0,
                   "resume_analysis": 0, "live_interview": 0, "errors": 0}
    for uid in user_ids:
        log.info(f"=== Reindexing user_id={uid} ===")
        stats = await reindex_user(uid, source_types, args.dry_run)
        for k, v in stats.items():
            total_stats[k] += v
        log.info(f"  user_id={uid} done: {stats}")

    log.info(f"=== All done ===")
    log.info(f"Total: {total_stats}")


if __name__ == "__main__":
    asyncio.run(main_async())
