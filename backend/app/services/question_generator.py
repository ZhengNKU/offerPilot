"""面试题批量生成服务。

核心设计：
- 一次 LLM 调用生成用户所有细化能力的面试题（批量，而非逐条）
- Redis 为主缓存（6 小时 TTL），PG 为兜底
- 所有生成逻辑统一入口：regenerate_and_cache_all_questions()
- 无定时任务
"""
import asyncio
import json
import logging
from typing import Optional

from sqlalchemy import text as sa_text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app import models
from app.config import settings
from app.services.embedding import embed_for_query
from app.utils.llm import call_llm_stream, _strip_codeblock, _safe_json_parse

logger = logging.getLogger(__name__)

# Redis 缓存 TTL
REDIS_CACHE_TTL = 6 * 3600  # 6 小时


# ============================================================================
# 批量生成：一次 LLM 调用生成所有细化能力的面试题
# ============================================================================


def _build_batch_prompt(
    target_role: str,
    target_grade: str,
    experience_years: str,
    sub_abilities: list[dict],  # [{"core": "Redis", "sub": "缓存穿透"}, ...]
    recalled_text: str,
) -> tuple[str, str]:
    """构建批量生成的 system + user prompt。

    返回 (system_prompt, user_content)。
    """
    # 列出所有细化能力
    ability_lines = []
    for item in sub_abilities:
        ability_lines.append(f"  - {item['core']} → {item['sub']}")
    ability_list = "\n".join(ability_lines)

    system_prompt = (
        "你是资深AI面试教练。针对以下所有细化能力知识点，为每个知识点各生成10道个性化面试题，"
        "难度匹配用户职级和年限。\n"
        "返回严格JSON（不含Markdown标记）：\n"
        '{"abilities":[{"sub_ability_name":"细化能力名称1","core_ability_name":"所属核心能力1",'
        '"questions":[{"title":"题目标题(15-30字)","freq":14,"aiAnswer":{'
        '"core":"核心策略(40-60字)","s":"场景(20-40字)","t":"任务(20-40字)",'
        '"a":["步骤1(15-30字)","步骤2(15-30字)","步骤3(15-30字)"],'
        '"r":"结果(20-40字)","keyPoints":["要点1","要点2"],"followUps":["追问1","追问2"]'
        '}},{"title":"...",...}]},...]}\n'
        "每个细化能力恰好10道题。每道题总字数200字以内。freq从14递减到5。a恰好3条。followUps恰好2条。"
        f"共{len(sub_abilities)}个细化能力，每个10题。"
    )

    user_content = (
        f"目标岗位：{target_role} | 职级：{target_grade} | 经验：{experience_years}\n"
        f"上下文参考：\n{recalled_text}\n\n"
        f"需要生成面试题的细化能力列表：\n{ability_list}\n\n"
        f"请为以上每个细化能力各生成10道紧扣该知识点的面试题。"
    )

    return system_prompt, user_content


async def _do_vector_recall(
    db: AsyncSession,
    user_id: int,
    target_role: str,
    target_grade: str,
    experience_years: str,
    timeout: float = 3.0,
) -> str:
    """向量召回 user_analysis_embeddings 中的相关片段。"""
    query_text = (
        f"面试知识点汇总。"
        f"目标岗位{target_role}，职级{target_grade}，经验{experience_years}。"
    )
    recall_result: dict = {"text": ""}

    async def _recall():
        try:
            q_vec = await embed_for_query(query_text)
            qvec_str = "[" + ",".join(f"{v:.6f}" for v in q_vec) + "]"
            sql = sa_text("""
                SELECT content, chunk_title, source_type,
                       1 - (embedding <=> CAST(:qvec AS vector)) AS similarity
                FROM user_analysis_embeddings
                WHERE user_id = :uid
                ORDER BY embedding <=> CAST(:qvec AS vector)
                LIMIT 10
            """)
            result = await db.execute(sql, {"qvec": qvec_str, "uid": user_id, "k": 10})
            chunks = []
            for row in result:
                if row.similarity >= 0.35:
                    chunks.append(
                        f"[{row.chunk_title}]({row.source_type}) {row.content}"
                    )
            if chunks:
                t = "\n---\n".join(chunks)
                recall_result["text"] = (
                    t[:3000] + ("\n...(truncated)" if len(t) > 3000 else "")
                )
        except Exception as e:
            logger.debug(f"[question_generator] recall skipped: {e}")

    task = asyncio.create_task(_recall())
    try:
        await asyncio.wait_for(task, timeout=timeout)
    except (asyncio.TimeoutError, Exception):
        pass
    return recall_result["text"] or "（暂无历史分析数据）"


def _patch_questions(questions: list[dict]) -> list[dict]:
    """后处理：补全 LLM 可能遗漏的字段。"""
    default_answer = {
        "core": "", "s": "", "t": "", "a": [], "r": "",
        "keyPoints": [], "followUps": [],
    }
    for q in questions:
        ans = q.setdefault("aiAnswer", {})
        for k, v in default_answer.items():
            ans.setdefault(k, v)
        for list_key in ("a", "keyPoints", "followUps"):
            if not isinstance(ans.get(list_key), list):
                ans[list_key] = []
        q.setdefault("title", "")
        q.setdefault("freq", 5)
    return questions[:10]


async def _call_llm_batch(
    user_id: int,
    target_role: str,
    target_grade: str,
    experience_years: str,
    sub_abilities: list[dict],
    recalled_text: str,
) -> list[dict]:
    """调用 LLM 批量生成面试题（内部使用，单次调用）。

    返回 [{"sub_ability_name": ..., "core_ability_name": ..., "questions": [...]}, ...]
    """
    t0 = asyncio.get_event_loop().time()
    system_prompt, user_content = _build_batch_prompt(
        target_role, target_grade, experience_years, sub_abilities, recalled_text
    )

    # 每能力约 3500 tokens（10题×200字×1.5tok/字 + STAR结构开销）
    estimated_tokens = max(4000, len(sub_abilities) * 3500 + 2000)
    max_tokens = min(estimated_tokens, 32000)  # deepseek-chat 输出上限

    logger.info(
        f"[question_generator] BATCH LLM START user={user_id} "
        f"abilities={len(sub_abilities)} max_tokens={max_tokens}"
    )

    payload = {
        "model": settings.DEEPSEEK_MODEL_FAST,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ],
        "response_format": {"type": "json_object"},
        "temperature": 0.4,
        "max_tokens": max_tokens,
    }

    res_data = await asyncio.to_thread(call_llm_stream, payload, 300.0)
    content = res_data["choices"][0]["message"]["content"]
    elapsed = asyncio.get_event_loop().time() - t0
    logger.info(
        f"[question_generator] BATCH LLM DONE user={user_id} "
        f"elapsed={elapsed:.1f}s len={len(content)}"
    )

    content_clean = _strip_codeblock(content)
    parsed = _safe_json_parse(content_clean, log_label="question_generator_batch")

    # 如果 JSON 被截断，尝试修复：去掉最后不完整的 ability，补上闭合括号
    if not parsed or "abilities" not in parsed:
        # 找到最后一个完整的 "sub_ability_name" 后的 }] 或直接尝试截断修复
        last_complete = content_clean.rfind('"sub_ability_name"')
        if last_complete > 0:
            # 从最后一个完整 ability 的结尾截断，补上 ]}
            truncated = content_clean[:last_complete].rstrip(", \t\n\r") + "\n]}\n"
            parsed = _safe_json_parse(truncated, log_label="question_generator_batch_truncated")
            if parsed and "abilities" in parsed:
                rescued = len(parsed["abilities"])
                logger.warning(
                    f"[question_generator] BATCH LLM JSON was truncated for user={user_id}, "
                    f"rescued {rescued} abilities from partial output"
                )

    if not parsed or "abilities" not in parsed:
        logger.error(
            f"[question_generator] BATCH LLM invalid JSON for user={user_id}: "
            f"{content_clean[:500]}"
        )
        return []

    abilities = parsed["abilities"]
    for ab in abilities:
        ab.setdefault("sub_ability_name", "")
        ab.setdefault("core_ability_name", "")
        qs = ab.setdefault("questions", [])
        ab["questions"] = _patch_questions(qs)

    total_qs = sum(len(ab.get("questions", [])) for ab in abilities)
    logger.info(
        f"[question_generator] BATCH parsed {len(abilities)} abilities, "
        f"{total_qs} total questions for user={user_id}"
    )
    return abilities


async def _call_llm_batch_parallel(
    user_id: int,
    target_role: str,
    target_grade: str,
    experience_years: str,
    sub_abilities: list[dict],
    recalled_text: str,
) -> list[dict]:
    """按核心能力分组，并行调用 LLM 生成面试题。

    将 sub_abilities 按 core 分组，每组一个并行 LLM 调用。
    4 个核心能力各 5 个细化标签 → 4 路并行，总耗时 ≈ 最长单路耗时。
    """
    # 按 core 分组
    groups: dict[str, list[dict]] = {}
    for sa in sub_abilities:
        core = sa.get("core", "默认")
        groups.setdefault(core, []).append(sa)

    # 打印分组详情
    group_summary = ", ".join(
        f"{name}({len(items)}个)" for name, items in groups.items()
    )
    logger.info(
        f"[question_generator] PARALLEL START user={user_id} "
        f"groups={len(groups)} total={len(sub_abilities)} | {group_summary}"
    )

    async def _call_one(core_name: str, items: list[dict]) -> list[dict]:
        t0 = asyncio.get_event_loop().time()
        logger.info(
            f"[question_generator] PARALLEL group={core_name!r} START "
            f"user={user_id} subs={len(items)}"
        )
        try:
            result = await _call_llm_batch(
                user_id, target_role, target_grade, experience_years,
                items, recalled_text,
            )
            elapsed = asyncio.get_event_loop().time() - t0
            qs = sum(len(ab.get("questions", [])) for ab in result)
            logger.info(
                f"[question_generator] PARALLEL group={core_name!r} DONE "
                f"user={user_id} elapsed={elapsed:.1f}s abilities={len(result)} questions={qs}"
            )
            return result
        except Exception as e:
            elapsed = asyncio.get_event_loop().time() - t0
            logger.error(
                f"[question_generator] PARALLEL group={core_name!r} FAILED "
                f"user={user_id} elapsed={elapsed:.1f}s: {e}"
            )
            return []

    # 并行执行
    t0 = asyncio.get_event_loop().time()
    tasks = [
        _call_one(core_name, items)
        for core_name, items in groups.items()
    ]
    results = await asyncio.gather(*tasks)

    # 合并结果 + 按组统计
    all_abilities = []
    group_stats = []
    for core_name, ab_list in zip(groups.keys(), results):
        qs = sum(len(ab.get("questions", [])) for ab in ab_list)
        group_stats.append(f"{core_name}({len(ab_list)}ab/{qs}q)")
        all_abilities.extend(ab_list)

    elapsed = asyncio.get_event_loop().time() - t0
    total_qs = sum(len(ab.get("questions", [])) for ab in all_abilities)
    logger.info(
        f"[question_generator] PARALLEL DONE user={user_id} "
        f"elapsed={elapsed:.1f}s groups={len(groups)} "
        f"abilities={len(all_abilities)} questions={total_qs} | "
        f"{' | '.join(group_stats)}"
    )
    return all_abilities


# ============================================================================
# Redis 缓存
# ============================================================================


def _redis_key(user_id: int) -> str:
    return f"knowledge:questions:batch:{user_id}"


async def _redis_get(user_id: int, redis_client) -> Optional[dict]:
    """从 Redis 读取缓存的面试题数据。返回 None 表示未命中。"""
    key = _redis_key(user_id)
    try:
        raw = await redis_client.get(key)
        if raw:
            data = json.loads(raw)
            logger.debug(
                f"[question_generator] Redis HIT key={key} "
                f"abilities={len(data.get('abilities',[]))}"
            )
            return data
        logger.debug(f"[question_generator] Redis MISS key={key}")
    except Exception as e:
        logger.warning(f"[question_generator] Redis GET failed key={key}: {e}")
    return None


async def _redis_set(user_id: int, data: dict, redis_client):
    """将面试题数据写入 Redis，TTL 6 小时。"""
    try:
        await redis_client.set(
            _redis_key(user_id),
            json.dumps(data, ensure_ascii=False),
            ex=REDIS_CACHE_TTL,
        )
        logger.info(
            f"[question_generator] Redis SET OK user={user_id} "
            f"abilities={len(data.get('abilities',[]))}"
        )
    except Exception as e:
        logger.warning(f"[question_generator] Redis SET failed for user={user_id}: {e}")


async def _redis_delete(user_id: int, redis_client):
    """删除用户的 Redis 缓存（能力标签变更时调用）。"""
    try:
        await redis_client.delete(_redis_key(user_id))
        logger.info(f"[question_generator] Redis DEL user={user_id}")
    except Exception:
        pass


# ============================================================================
# PG 兜底（读写 knowledge_question_cache 表）
# ============================================================================


async def _pg_save_batch(
    db: AsyncSession, user_id: int, abilities: list[dict]
):
    """将批量生成的面试题写入 PG（先删后插）。"""
    from sqlalchemy import delete as sa_delete

    await db.execute(
        sa_delete(models.KnowledgeQuestionCache).where(
            models.KnowledgeQuestionCache.user_id == user_id
        )
    )
    for ab in abilities:
        db.add(
            models.KnowledgeQuestionCache(
                user_id=user_id,
                sub_ability_name=ab["sub_ability_name"],
                core_ability_name=ab.get("core_ability_name", ""),
                questions=ab.get("questions", []),
            )
        )
    await db.commit()
    logger.info(
        f"[question_generator] PG SAVE user={user_id} rows={len(abilities)}"
    )


async def _pg_query_sub(
    db: AsyncSession, user_id: int, sub_ability_name: str
) -> list[dict]:
    """从 PG 查询指定细化能力的面试题（兜底用）。"""
    result = await db.execute(
        select(models.KnowledgeQuestionCache).where(
            models.KnowledgeQuestionCache.user_id == user_id,
            models.KnowledgeQuestionCache.sub_ability_name == sub_ability_name,
        )
    )
    row = result.scalars().first()
    return row.questions if row else []


# ============================================================================
# 统一入口：regenerate_and_cache_all_questions
# ============================================================================


async def regenerate_and_cache_all_questions(
    db: AsyncSession,
    user_id: int,
    redis_client=None,
    *,
    trigger_reason: str = "",
) -> list[dict]:
    """统一入口：批量重新生成用户所有细化能力的面试题，缓存到 Redis + PG。

    返回 abilities 列表，格式同 LLM 输出：
    [{"sub_ability_name":..., "core_ability_name":..., "questions":[...]}, ...]

    trigger_reason: 日志追踪用，如 "cache_miss" / "ability_change" / "manual"
    """
    t0 = asyncio.get_event_loop().time()
    logger.info(
        f"[question_generator] REGENERATE START user={user_id} reason={trigger_reason!r}"
    )

    # 1. 查用户画像
    profile_result = await db.execute(
        select(models.UserProfile).where(models.UserProfile.user_id == user_id)
    )
    profile = profile_result.scalars().first()
    if not profile or not profile.target_role:
        logger.info(f"[question_generator] user={user_id} no profile, skip")
        return []

    target_role = profile.target_role or ""
    target_grade = profile.target_grade or ""
    experience_years = profile.experience_years or "1-3年"

    # 2. 查所有细化能力
    sub_result = await db.execute(
        select(models.KnowledgeSubAbility).where(
            models.KnowledgeSubAbility.user_id == user_id
        )
    )
    sub_abilities = sub_result.scalars().all()
    if not sub_abilities:
        logger.info(f"[question_generator] user={user_id} no sub_abilities")
        return []

    # 查核心能力名映射
    core_ids = {sa.core_ability_id for sa in sub_abilities}
    core_result = await db.execute(
        select(models.KnowledgeCoreAbility).where(
            models.KnowledgeCoreAbility.id.in_(core_ids)
        )
    )
    core_map = {ca.id: ca.name for ca in core_result.scalars().all()}

    sa_list = [
        {"core": core_map.get(sa.core_ability_id, ""), "sub": sa.name}
        for sa in sub_abilities
    ]

    # 3. 向量召回
    recalled_text = await _do_vector_recall(
        db, user_id, target_role, target_grade, experience_years
    )

    # 4. 并行 LLM 生成（按核心能力分组）
    abilities = await _call_llm_batch_parallel(
        user_id, target_role, target_grade, experience_years, sa_list, recalled_text
    )

    if not abilities:
        logger.error(f"[question_generator] REGENERATE FAILED (empty LLM result) user={user_id}")
        return []

    # 5. 写 Redis
    cache_data = {
        "abilities": abilities,
        "generated_at": int(asyncio.get_event_loop().time()),
    }
    if redis_client:
        await _redis_set(user_id, cache_data, redis_client)

    # 6. 写 PG
    await _pg_save_batch(db, user_id, abilities)

    total_elapsed = asyncio.get_event_loop().time() - t0
    logger.info(
        f"[question_generator] REGENERATE DONE user={user_id} "
        f"abilities={len(abilities)} total_elapsed={total_elapsed:.1f}s"
    )
    return abilities


async def regenerate_with_retry(
    db: AsyncSession,
    user_id: int,
    redis_client=None,
    *,
    trigger_reason: str = "",
    max_retries: int = 3,
) -> list[dict]:
    """带重试的批量重新生成（3次指数退避）。

    trigger 场景（能力标签变更）使用。
    如果用户无细化能力标签，直接返回空，不重试。
    """
    for attempt in range(1, max_retries + 1):
        try:
            abilities = await regenerate_and_cache_all_questions(
                db, user_id, redis_client, trigger_reason=trigger_reason,
            )
            if abilities:
                return abilities
            # 空结果：可能是用户无细化能力，不重试直接返回
            logger.warning(
                f"[question_generator] regenerate returned empty for user={user_id}, "
                f"likely no sub_abilities"
            )
            return []
        except Exception as e:
            logger.error(
                f"[question_generator] RETRY attempt {attempt}/{max_retries} "
                f"FAILED for user={user_id}: {e}", exc_info=True
            )
            if attempt < max_retries:
                delay = 2 ** attempt
                await asyncio.sleep(delay)
    return []


# ============================================================================
# 查询入口（供 memory.py 端点调用）
# ============================================================================


async def get_questions_for_sub_ability(
    db: AsyncSession,
    user_id: int,
    sub_ability_name: str,
    redis_client=None,
) -> list[dict]:
    """查询单个细化能力的面试题。

    流程：Redis → (过期) → 批量重生成 → (失败3次) → PG 兜底
    """
    # 1. 尝试 Redis
    if redis_client:
        cached = await _redis_get(user_id, redis_client)
        if cached and cached.get("abilities"):
            for ab in cached["abilities"]:
                if ab.get("sub_ability_name") == sub_ability_name:
                    logger.info(
                        f"[question_generator] Redis HIT user={user_id} "
                        f"sub={sub_ability_name!r}"
                    )
                    return ab.get("questions", [])[:10]
            # Redis 有数据但没找到这个 sub_ability → 说明是新增的标签，触发全量重生成
            logger.info(
                f"[question_generator] Redis PARTIAL MISS user={user_id} "
                f"sub={sub_ability_name!r} → regenerating all"
            )

    # 2. Redis 过期/不存在 → 批量重生成 + 写 Redis + PG
    logger.info(
        f"[question_generator] Redis MISS user={user_id} → regenerating all"
    )
    abilities = await regenerate_with_retry(
        db, user_id, redis_client, trigger_reason="cache_miss"
    )
    if abilities:
        for ab in abilities:
            if ab.get("sub_ability_name") == sub_ability_name:
                return ab.get("questions", [])[:10]
        # 重生成成功但没有找到对应 sub_ability（可能是 LLM 输出格式问题）
        logger.warning(
            f"[question_generator] regenerated but sub={sub_ability_name!r} "
            f"not found in LLM output, falling back to PG"
        )

    # 3. 重生成失败 → PG 兜底
    logger.info(
        f"[question_generator] falling back to PG for user={user_id} "
        f"sub={sub_ability_name!r}"
    )
    questions = await _pg_query_sub(db, user_id, sub_ability_name)
    if questions:
        logger.info(
            f"[question_generator] PG FALLBACK OK user={user_id} "
            f"sub={sub_ability_name!r} questions={len(questions)}"
        )
    return questions[:10] if questions else []


# ============================================================================
# 缓存失效（能力标签变更时调用）
# ============================================================================


async def generate_and_cache_with_abilities(
    db: AsyncSession,
    user_id: int,
    abilities_data: list[dict],  # [{"core": "Redis", "sub": "缓存穿透"}, ...]
    target_role: str,
    target_grade: str,
    experience_years: str,
    redis_client=None,
) -> list[dict]:
    """用预生成的能力标签数据直接批量生成面试题（不查 DB）。

    用于能力标签生成流程：标签尚未入库时先生成面试题，成功后再一起入库。
    返回 abilities 列表，格式同 regenerate_and_cache_all_questions。
    """
    t0 = asyncio.get_event_loop().time()
    logger.info(
        f"[question_generator] GENERATE_WITH_ABILITIES START user={user_id} "
        f"count={len(abilities_data)}"
    )

    t_recall = asyncio.get_event_loop().time()
    recalled_text = await _do_vector_recall(
        db, user_id, target_role, target_grade, experience_years
    )
    logger.debug(
        f"[question_generator] GENERATE_WITH_ABILITIES recall done "
        f"user={user_id} elapsed={asyncio.get_event_loop().time() - t_recall:.1f}s"
    )

    abilities = await _call_llm_batch_parallel(
        user_id, target_role, target_grade, experience_years,
        abilities_data, recalled_text,
    )
    if not abilities:
        logger.error(
            f"[question_generator] GENERATE_WITH_ABILITIES FAILED "
            f"(empty LLM result) user={user_id}"
        )
        return []

    # 写 Redis
    t_cache = asyncio.get_event_loop().time()
    cache_data = {
        "abilities": abilities,
        "generated_at": int(asyncio.get_event_loop().time()),
    }
    if redis_client:
        await _redis_set(user_id, cache_data, redis_client)

    # 写 PG
    await _pg_save_batch(db, user_id, abilities)

    total_elapsed = asyncio.get_event_loop().time() - t0
    logger.info(
        f"[question_generator] GENERATE_WITH_ABILITIES DONE user={user_id} "
        f"abilities={len(abilities)} total_elapsed={total_elapsed:.1f}s "
        f"cache_write={asyncio.get_event_loop().time() - t_cache:.1f}s"
    )
    return abilities


async def invalidate_and_regenerate(
    db: AsyncSession,
    user_id: int,
    redis_client=None,
):
    """能力标签变更后：删除 Redis 缓存 → 批量重生成 → 写 Redis + PG。

    供 trigger_knowledge_generation / trigger_knowledge_match 调用。
    """
    if redis_client:
        await _redis_delete(user_id, redis_client)
    await regenerate_with_retry(db, user_id, redis_client, trigger_reason="ability_change")
