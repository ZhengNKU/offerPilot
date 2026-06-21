"""项目提及计数服务。

职责：
1. 读取 LLM 已匹配好的 mentioned_projects（含 matched_existing_id）
2. 累加 mention_count（同一 session 同一项目只计 1 次）
3. 记录最近一次提及时间

匹配逻辑已完全委托给 analyze_interview_dialogue 的大模型，
本服务只做去重 + 计数落库。
"""

import logging
from datetime import datetime

from app.database import async_session
from app.models import ProjectMemory

logger = logging.getLogger(__name__)


async def sync_project_mentions(
    user_id: int,
    mentioned_projects: list[dict],
    session_id: int,
) -> dict:
    """同步项目提及计数。

    LLM 已在 mentioned_projects 中填好 matched_existing_id，
    本函数只做去重 + increment。

    Args:
        user_id: 用户ID
        mentioned_projects: LLM 输出，每个元素格式：
            {"project_name": str, "discussion_depth": int, "matched_existing_id": int|null}
        session_id: InterviewSession ID

    Returns:
        {"matched": 3, "unmatched": 1, "errors": 0}
    """
    if not mentioned_projects:
        return {"matched": 0, "unmatched": 0, "errors": 0}

    stats = {"matched": 0, "unmatched": 0, "errors": 0}

    try:
        # ── 收集 LLM 匹配到的 project_id（去重） ──
        matched_project_ids: set[int] = set()

        for proj in mentioned_projects:
            matched_id = proj.get("matched_existing_id")
            if matched_id is not None and isinstance(matched_id, int) and matched_id > 0:
                if matched_id not in matched_project_ids:
                    matched_project_ids.add(matched_id)
                    stats["matched"] += 1
            else:
                stats["unmatched"] += 1

        # ── 写入：mention_count += 1 + 最近提及摘要 ──
        if matched_project_ids:
            now_utc = datetime.utcnow()
            # 获取 session 标题（格式: 公司 · 岗位 · 日期）
            session_title = ""
            async with async_session() as db:
                from app.models import InterviewSession
                sess = await db.get(InterviewSession, session_id)
                if sess and sess.title:
                    # 从 "中兴通讯 · 后端开发工程师 · 2026-06-21" 中提取公司+岗位
                    parts = sess.title.split(" · ")
                    session_title = "".join(parts[:2]) if len(parts) >= 2 else sess.title
                # 格式化: 2026/06/21·中兴通讯后端开发工程师面试
                date_str = now_utc.strftime("%Y/%m/%d")
                summary = f"{date_str}·{session_title}面试" if session_title else date_str

                for pid in matched_project_ids:
                    try:
                        pm = await db.get(ProjectMemory, pid)
                        if pm:
                            pm.mention_count = (pm.mention_count or 0) + 1
                            pm.last_mentioned_at = now_utc
                            pm.last_mentioned_session_id = session_id
                            pm.last_mentioned_summary = summary
                    except Exception as e:
                        logger.error(
                            f"[mention_service] 写入失败 pid={pid}: {e}"
                        )
                        stats["errors"] += 1
                await db.commit()

        logger.info(
            f"[mention_service] ✅ 同步完成 user={user_id} "
            f"session={session_id} matched={stats['matched']} "
            f"unmatched={stats['unmatched']} errors={stats['errors']}"
        )

    except Exception as e:
        logger.error(
            f"[mention_service] ❌ 同步异常 user={user_id} "
            f"session={session_id}: {e}"
        )
        stats["errors"] = len(mentioned_projects)

    return stats
