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
from app.utils.llm import (
    _run_with_optional_tools,
    _strip_codeblock,
    _safe_json_parse,
)

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
    enable_network: bool = True,
    web_context: str = "",
) -> tuple[str, str]:
    """构建批量生成的 system + user prompt。

    enable_network: True 时 system prompt 追加联网检索真实面经的指令（让 LLM 自己在
    循环里调 web_search）。现在批量生成走"预取一次、多题共享"，改为传 web_context 注入，
    enable_network 一般传 False（不在 LLM 循环内联网）。
    web_context: 整轮预取好的真实面经文本；非空时直接注入 user prompt，供所有 chunk 共享。

    返回 (system_prompt, user_content)。
    """
    # 列出所有细化能力
    ability_lines = []
    for item in sub_abilities:
        ability_lines.append(f"  - {item['core']} → {item['sub']}")
    ability_list = "\n".join(ability_lines)

    # 联网工具说明仅在启用时注入，避免污染 prompt
    if enable_network:
        tool_block = (
            "\n联网检索真实面经（推荐使用）：为了让生成的题目更具代表性、更贴近当下"
            "招聘考察侧重点，请在生成前调用 `web_search(query, count=5)` 工具搜索目标"
            "岗位/公司近期的真实面经、考点偏好或行业热门话题。示例查询：\n"
            "  - 「字节跳动 后端 P7 Redis 缓存 真实面经」\n"
            "  - 「腾讯 PCG 客户端 性能优化 面试考点」\n"
            "  - 「阿里云 高级前端 P6 React 面试真题」\n"
            "搜索 1-2 次即可（不必对每个细化能力都搜），让题目反映真实行业考察方向。"
            "联网失败时直接基于训练语料生成即可，不要因为工具失败而中断。\n"
        )
    else:
        tool_block = ""

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
        f"{tool_block}"
    )

    web_block = ""
    if web_context:
        web_block = (
            f"\n真实面经与考点参考（联网检索预取，请据此让题目更贴近当下考察方向）：\n"
            f"{web_context}\n"
        )

    user_content = (
        f"目标岗位：{target_role} | 职级：{target_grade} | 经验：{experience_years}\n"
        f"上下文参考：\n{recalled_text}\n"
        f"{web_block}\n"
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


async def _prefetch_web_context(
    target_role: str,
    target_grade: str,
    experience_years: str,
) -> str:
    """整轮预取一次真实面经，供所有 chunk 共享（"预取一次、多题共享"）。

    替代此前每个 chunk 在各自 LLM 循环里 web_search 的做法：
      - 只发 1 次搜索，不再 N 个 chunk 各自联网、各自空等；
      - 命中则注入各 chunk 的 prompt；失败/降级则退回纯语料（返回 ""）。
    """
    from app.services.mcp_client import search_web

    query = " ".join(
        p for p in [target_role, target_grade, "面试真题 高频考点 真实面经"] if p and p.strip()
    ).strip()
    timeout_s = float(getattr(settings, "WEB_SEARCH_TIMEOUT_S", 12.0))
    try:
        res = await asyncio.wait_for(search_web(query, count=5), timeout=timeout_s)
    except (asyncio.TimeoutError, Exception) as e:
        logger.info(f"[question_generator] 联网预取失败/超时，退回纯语料生成: {e!r}")
        return ""
    # 降级占位串统一以「（」开头；真实结果是「1. [title](url)」列表
    if not res or res.lstrip().startswith("（"):
        return ""
    return res[:3000]


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
    enable_network: bool = True,
    ctx: Optional[dict] = None,
    web_context: str = "",
) -> list[dict]:
    """调用 LLM 批量生成面试题（内部使用，单次调用）。
    返回 [{"sub_ability_name": ..., "core_ability_name": ..., "questions": [...]}, ...]
    """
    t0 = asyncio.get_event_loop().time()
    system_prompt, user_content = _build_batch_prompt(
        target_role, target_grade, experience_years, sub_abilities, recalled_text,
        enable_network=enable_network, web_context=web_context,
    )

    # 单个 Chunk Task (最多 2 个能力项) 赋予 32,000 Token 上限配额，确保多长均绝对够用不截断
    estimated_tokens = max(32000, len(sub_abilities) * 16000)
    max_tokens = min(estimated_tokens, 48000)

    logger.info(
        f"[question_generator] BATCH LLM START user={user_id} "
        f"abilities={len(sub_abilities)} max_tokens={max_tokens} enable_network={enable_network}"
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

    res_data = await _run_with_optional_tools(
        payload, enable_network, sync=False, timeout=300.0, ctx=ctx,
    )
    content = res_data["choices"][0]["message"]["content"]
    finish_reason = res_data["choices"][0].get("finish_reason")
    elapsed = asyncio.get_event_loop().time() - t0
    logger.info(
        f"[question_generator] BATCH LLM DONE user={user_id} "
        f"elapsed={elapsed:.1f}s len={len(content)} finish_reason={finish_reason}"
    )

    expected_n = len(sub_abilities)
    content_clean = _strip_codeblock(content)
    parsed = _safe_json_parse(content_clean, log_label="question_generator_batch")

    # 如果 JSON 被截断，尝试修复：截到最后一个完整 ability 的 } 边界，补上闭合括号
    # 注意：截到 `},` 而不是 `"sub_ability_name"` 起点
    if not parsed or "abilities" not in parsed:
        last_ability_end = content_clean.rfind('},')
        if last_ability_end > 0:
            # 截到 `},`（含闭合括号），后面丢弃，补上 ]} 闭合外层 abilities 数组
            truncated = content_clean[:last_ability_end + 1] + "\n]}\n"
            parsed = _safe_json_parse(truncated, log_label="question_generator_batch_truncated")
            if isinstance(parsed, dict) and "abilities" in parsed:
                rescued = len(parsed["abilities"])
                logger.warning(
                    f"[question_generator] BATCH LLM JSON was truncated for user={user_id} "
                    f"(finish_reason={finish_reason}), "
                    f"rescued {rescued}/{expected_n} abilities from partial output"
                )

    if not isinstance(parsed, dict) or "abilities" not in parsed:
        logger.error(
            f"[question_generator] BATCH LLM invalid JSON for user={user_id} "
            f"(finish_reason={finish_reason}): {content_clean[:500]}"
        )
        # 不再静默返回 []，让外层 regenerate_with_retry 的指数退避能真正触发
        raise RuntimeError(
            f"question_generator: JSON parse failed for user={user_id} "
            f"(finish_reason={finish_reason}, len={len(content)})"
        )

    abilities = parsed["abilities"]
    # 完整性校验：rescued 数量必须等于请求的细化能力数，
    # 否则宁可 raise 重试也不要把残缺缓存写下去
    if len(abilities) < expected_n:
        logger.error(
            f"[question_generator] BATCH LLM partial result for user={user_id}: "
            f"got {len(abilities)}/{expected_n} abilities, raising for retry"
        )
        raise RuntimeError(
            f"question_generator: partial rescue ({len(abilities)}/{expected_n}) "
            f"for user={user_id}"
        )

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
    enable_network: bool = True,
    ctx: Optional[dict] = None,
) -> list[dict]:
    """按核心能力分组，并行调用 LLM 生成面试题。

    将 sub_abilities 按 core 分组，每组一个并行 LLM 调用。
    4 个核心能力各 5 个细化标签 → 4 路并行，总耗时 ≈ 最长单路耗时。

    enable_network / ctx: 透传给每组 LLM 调用；模拟面试场景下推荐 enable_network=True
    让 LLM 先 web_search 真实面经，再生成题目。
    """
    # 按 core 分组
    groups: dict[str, list[dict]] = {}
    for sa in sub_abilities:
        core = sa.get("core", "默认")
        groups.setdefault(core, []).append(sa)

    # 预取一次联网面经，多 chunk 共享（替代每个 chunk 在 LLM 循环里各自 web_search，
    # 消除 N 次联网空等；命中则注入 prompt，失败则退回纯语料）
    web_context = ""
    if enable_network:
        web_context = await _prefetch_web_context(target_role, target_grade, experience_years)
        logger.info(
            f"[question_generator] 联网预取{'命中' if web_context else '空/降级'} "
            f"user={user_id} chars={len(web_context)}"
        )

    # 限制最多 2 路并发生成，防止 12 路极速并发触发下游限流
    sem = asyncio.Semaphore(2)

    async def _call_one(label_name: str, items: list[dict]) -> list[dict]:
        async with sem:
            t0 = asyncio.get_event_loop().time()
            logger.info(
                f"[question_generator] PARALLEL chunk={label_name!r} START "
                f"user={user_id} subs={len(items)}"
            )
            # 联网已在整轮预取阶段完成并注入 web_context，chunk 内不再 LLM 循环联网
            result = await _call_llm_batch(
                user_id, target_role, target_grade, experience_years,
                items, recalled_text, enable_network=False, ctx=ctx,
                web_context=web_context,
            )
            elapsed = asyncio.get_event_loop().time() - t0
            qs = sum(len(ab.get("questions", [])) for ab in result)
            logger.info(
                f"[question_generator] PARALLEL chunk={label_name!r} DONE "
                f"user={user_id} elapsed={elapsed:.1f}s abilities={len(result)} questions={qs}"
            )
            return result

    # 将超过 2 个子能力的大组进一步分片 (Chunk Size = 2)
    # 避免单次 LLM 输出来长达 2.6 万字（50题），引发截断与 JSON 解析语法报错
    CHUNK_SIZE = 2
    chunk_tasks = []
    chunk_labels = []
    for core_name, items in groups.items():
        for i in range(0, len(items), CHUNK_SIZE):
            sub_chunk = items[i:i + CHUNK_SIZE]
            label = f"{core_name}-P{i//CHUNK_SIZE + 1}"
            chunk_labels.append(label)
            chunk_tasks.append(_call_one(label, sub_chunk))

    logger.info(
        f"[question_generator] PARALLEL START user={user_id} "
        f"groups={len(groups)} chunks={len(chunk_tasks)} total={len(sub_abilities)} enable_network={enable_network}"
    )

    # 并行执行所有切片 Task
    t0 = asyncio.get_event_loop().time()
    results = await asyncio.gather(*chunk_tasks)

    # 合并结果
    all_abilities = []
    for ab_list in results:
        all_abilities.extend(ab_list)

    elapsed = asyncio.get_event_loop().time() - t0
    total_qs = sum(len(ab.get("questions", [])) for ab in all_abilities)
    logger.info(
        f"[question_generator] PARALLEL ALL DONE user={user_id} "
        f"elapsed={elapsed:.1f}s total_abilities={len(all_abilities)} total_questions={total_qs}"
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
    enable_network: bool = True,
) -> list[dict]:
    """统一入口：批量重新生成用户所有细化能力的面试题，缓存到 Redis + PG。

    返回 abilities 列表，格式同 LLM 输出：
    [{"sub_ability_name":..., "core_ability_name":..., "questions":[...]}, ...]

    trigger_reason: 日志追踪用，如 "cache_miss" / "ability_change" / "manual"
    enable_network: True 时 LLM 会先 web_search 真实面经再生成题目（推荐默认开启）；
    False 时退回纯训练语料生成。模拟面试场景下联网失败不影响整体流程。
    """
    t0 = asyncio.get_event_loop().time()
    logger.info(
        f"[question_generator] REGENERATE START user={user_id} reason={trigger_reason!r} "
        f"enable_network={enable_network}"
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
    # 透传 enable_network；ctx 暂不传（web_search 不依赖 db/user_id，
    # 未来若需 recall_user_history 再补 db/user_id）
    abilities = await _call_llm_batch_parallel(
        user_id, target_role, target_grade, experience_years, sa_list, recalled_text,
        enable_network=enable_network,
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
    enable_network: bool = True,
) -> list[dict]:
    """带重试的批量重新生成（3次指数退避）。

    trigger 场景（能力标签变更）使用。
    如果用户无细化能力标签，直接返回空，不重试。

    enable_network: 透传给 regenerate_and_cache_all_questions。
    """
    for attempt in range(1, max_retries + 1):
        try:
            abilities = await regenerate_and_cache_all_questions(
                db, user_id, redis_client,
                trigger_reason=trigger_reason, enable_network=enable_network,
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
    *,
    enable_network: bool = True,
) -> list[dict]:
    """查询单个细化能力的面试题。

    流程：Redis → (过期) → 批量重生成 → (失败3次) → PG 兜底

    enable_network: 透传到 regenerate_with_retry；模拟面试推荐默认开启。
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
        db, user_id, redis_client,
        trigger_reason="cache_miss", enable_network=enable_network,
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
    *,
    enable_network: bool = True,
) -> list[dict]:
    """用预生成的能力标签数据直接批量生成面试题（不查 DB）。

    用于能力标签生成流程：标签尚未入库时先生成面试题，成功后再一起入库。
    返回 abilities 列表，格式同 regenerate_and_cache_all_questions。

    enable_network: 模拟面试推荐默认开启（LLM 先 web_search 真实面经再生成题目）。
    """
    t0 = asyncio.get_event_loop().time()
    logger.info(
        f"[question_generator] GENERATE_WITH_ABILITIES START user={user_id} "
        f"count={len(abilities_data)} enable_network={enable_network}"
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
        enable_network=enable_network,
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
