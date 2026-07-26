import logging
import json
import re
import asyncio
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from app import models
from app.config import settings
from app.utils.llm import call_llm_stream, _run_with_optional_tools, _strip_codeblock

logger = logging.getLogger(__name__)

# 默认最大重试次数（在 LLM 调用 + JSON 解析层面整体重试）。
# 透传 HTTP / 网络层重试已由 ``_RESILIENT_SESSION`` 处理，这里只对
# 「模型返回的内容无法被``_safe_json_parse``拆出合法 JSON」这一类
# 失败重试 —— 这是 reasoning 模型偶发 CoT 漏出、字符截断等场景的主因。
DEFAULT_MAX_RETRIES = 3


def _safe_json_parse(text: str) -> dict:
    """鲁棒地从 LLM 输出解析 JSON。

    策略：
      1) ``_strip_codeblock`` 去围栏 / 去 ```` 块；
      2) 直接 ``json.loads``；
      3) 失败则用正则抠出第一个完整的 ``{...}`` 块（DOTALL）再试一次；
      4) 还不行就抛 ``JSONDecodeError`` 让上层走兜底。
    """
    cleaned = _strip_codeblock(text)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass

    obj_match = re.search(r"\{.*\}", cleaned, flags=re.DOTALL)
    if obj_match:
        try:
            return json.loads(obj_match.group(0))
        except json.JSONDecodeError:
            pass

    raise json.JSONDecodeError(
        "No recoverable JSON object in LLM output", cleaned, 0
    )


async def _call_llm_with_retry(
    payload: dict,
    max_retries: int = DEFAULT_MAX_RETRIES,
    enable_network: bool = False,
) -> dict:
    """对 LLM 调用 + JSON 解析整体重试，最多 ``max_retries`` 次。

    网络/超时/5xx 已由 ``call_llm_stream`` / ``_run_with_optional_tools`` 内部会话重试，
    这里补齐的是「模型能响应但内容无法解析」这一类典型失败。每次失败都重新发请求，
    给模型一次新机会（运气好时第二次就给干净 JSON 了）。

    enable_network:
      - True：走 ``_run_with_optional_tools``，挂载 web_search 等工具（AI 职业顾问联网生成）
      - False：走 ``call_llm_stream``，纯 LLM（默认，向后兼容）
    """
    last_exc: Optional[BaseException] = None
    for attempt in range(1, max_retries + 1):
        try:
            if enable_network:
                # AI 职业顾问：允许 LLM 调用 web_search 检索行业最新招聘趋势 / 薪资参考等
                res_data = await _run_with_optional_tools(
                    payload, True, sync=False, timeout=180.0,
                )
            else:
                res_data = await asyncio.to_thread(call_llm_stream, payload, 180.0)
            content = res_data["choices"][0]["message"]["content"]
            parsed = _safe_json_parse(content)
            if attempt > 1:
                logger.info(f"advisor LLM+JSON parse succeeded on attempt {attempt}/{max_retries}")
            return parsed
        except (json.JSONDecodeError, KeyError, IndexError, TypeError) as e:
            last_exc = e
            logger.warning(
                f"advisor LLM parse failed (attempt {attempt}/{max_retries}): "
                f"{type(e).__name__}: {e}"
            )
            if attempt < max_retries:
                # 小幅指数退避（1.0s, 1.5s, ...），避免连续失败时打满网关
                await asyncio.sleep(1.0 + (attempt - 1) * 0.5)
                continue

    raise RuntimeError(
        f"advisor LLM generation failed after {max_retries} attempts: {last_exc}"
    ) from last_exc


async def _cleanup_generating_placeholder(db: AsyncSession, user_id: int):
    """生成失败时清理 UserAdvisorInsight 表里的 generating 占位行。

    仅当 ``insights.status == "generating"`` 时才删，避免误删已被
    之前生成覆盖的有效数据（如周更 focus_areas 路径）。
    """
    try:
        await db.rollback()
        stmt = select(models.UserAdvisorInsight).where(
            models.UserAdvisorInsight.user_id == user_id
        )
        result = await db.execute(stmt)
        row = result.scalars().first()
        if row is None:
            return
        if isinstance(row.insights, dict) and row.insights.get("status") == "generating":
            await db.delete(row)
            await db.commit()
            logger.info(
                f"Cleaned up 'generating' placeholder for user {user_id} "
                f"after failed advisor generation"
            )
    except Exception as cleanup_err:
        logger.error(
            f"Failed to clean up placeholder for user {user_id}: {cleanup_err}",
            exc_info=True,
        )


async def generate_general_advisor_insights(db: AsyncSession, user_id: int, target_role: str):
    """
    使用 AI 为指定的目标岗位生成行业通用基准建议，并入库保存到 user_advisor_insights 缓存表。
    新注册或修改目标岗位时触发，生成完整的 4 大维度（本周重点提升、近期面试趋势、推荐行动、职业发展建议）。
    """
    logger.info(f"Starting general advisor insights generation for user {user_id}, target_role: {target_role}")
    
    prompt = f"""用户现在的目标岗位是：『{target_role}』。
该用户刚刚注册我们的平台，目前没有任何面试记录和简历。
请基于这个目标岗位，生成一份行业通用的基准能力与职业发展规划建议。

建议需包含以下 4 个维度（每部分严格输出 3 条，表述要专业、深入、切中行业痛点）：
1. 本周重点提升 (focus_areas): 具体的技术模块、面试表达框架或技能漏洞。
2. 近期面试趋势 (interview_trends): 大厂高频考察的方向或行业招聘热点。
3. 推荐行动 (recommended_actions): 具体的提升行动（例如：完成模拟面试、优化简历描述等）。
4. 职业发展建议 (career_suggestions): 中长期的职业方向或能力规划。

【联网工具（可选）】
为了让近期面试趋势、推荐行动、职业发展建议更贴近当下行业招聘现状，可以调用 `web_search(query, count=5)` 工具检索目标岗位近期大厂面试考点偏好、行业薪资参考或最新招聘趋势。仅在本地训练语料不足时调用；联网失败时直接基于训练语料生成即可，不要因为工具失败而中断。

【输出长度严格限制】
每一个生成的建议条目字数必须严格限制在 10 到 18 个汉字以内。
表述必须极度简明扼要，一行能展示完，严禁任何长篇大论，严禁包含任何括号、说明性后缀或多余解释。
例如："微服务高可用方案设计"、"补充核心项目定量指标"等。

你必须且只能返回严格符合以下结构的 JSON 字符串（不要包含任何 markdown 块或导言）：
{{
  "focus_areas": ["第一个重点项", "第二个重点项", "第三个重点项"],
  "interview_trends": ["第一个趋势", "第二个趋势", "第三个趋势"],
  "recommended_actions": ["第一个推荐行动", "第二个推荐行动", "第三个推荐行动"],
  "career_suggestions": ["第一个职业建议", "第二个职业建议", "第三个职业建议"]
}}
"""

    payload = {
        "model": settings.DEEPSEEK_MODEL_FAST,
        "messages": [
            {"role": "system", "content": "You are a professional AI career advisor. Output raw JSON only."},
            {"role": "user", "content": prompt}
        ],
        "temperature": 0.2
    }

    try:
        parsed_data = await _call_llm_with_retry(payload, enable_network=True)
        
        # 加上 flag 字段 is_customized = False，标明这是通用建议
        parsed_data["is_customized"] = False
        parsed_data["target_role"] = target_role
        
        # 验证 JSON 结构完整性
        required_keys = ["focus_areas", "interview_trends", "recommended_actions", "career_suggestions"]
        for key in required_keys:
            if key not in parsed_data or not isinstance(parsed_data[key], list):
                parsed_data[key] = []
                
        # 查找是否已有缓存记录
        stmt = select(models.UserAdvisorInsight).where(models.UserAdvisorInsight.user_id == user_id)
        result = await db.execute(stmt)
        insight = result.scalars().first()
        
        if insight:
            insight.insights = parsed_data
        else:
            insight = models.UserAdvisorInsight(
                user_id=user_id,
                insights=parsed_data
            )
            db.add(insight)
            
        await db.commit()
        logger.info(f"Successfully generated and saved general advisor insights for user {user_id}")
    except Exception as e:
        logger.error(f"Failed to generate advisor insights for user {user_id}: {e}", exc_info=True)
        # 清掉 generating 占位行，让前端下一次轮询可以重新触发
        await _cleanup_generating_placeholder(db, user_id)


async def generate_custom_advisor_insights(db: AsyncSession, user_id: int):
    """
    使用 AI 结合用户的简历、项目记忆和最近面试记录，生成定制化的建议。
    根据用户最新要求：
    1. 『职业发展建议』与『本周重点提升』由注册/岗位变更或每周定时任务控制，此处完全保持原样，不作修改。
    2. 『近期面试趋势』：每次评估均触发更新，但每次只覆盖/更新最新的一条记录（即 index 0 项），其余 2 条保持原样。
    3. 『推荐行动』：由 AI 结合上下文及原有行动判断是否需要更新，若无需更新则保留历史推荐行动。
    """
    logger.info(f"Starting custom advisor insights generation for user {user_id}")
    
    # 1. 查找用户求职目标职位
    profile_stmt = select(models.UserProfile).where(models.UserProfile.user_id == user_id)
    profile_result = await db.execute(profile_stmt)
    profile = profile_result.scalars().first()
    if not profile or not profile.target_role:
        logger.warning(f"No profile/target_role found for user {user_id}. Cannot generate custom insights.")
        return

    target_role = profile.target_role

    # 2. 查找已有的建议记录，提取原有各项
    stmt = select(models.UserAdvisorInsight).where(models.UserAdvisorInsight.user_id == user_id)
    result = await db.execute(stmt)
    insight = result.scalars().first()

    existing_focus_areas = []
    existing_trends = []
    existing_recommended_actions = []
    existing_career_suggestions = []
    
    if insight and insight.insights:
        existing_focus_areas = insight.insights.get("focus_areas") or []
        existing_trends = insight.insights.get("interview_trends") or []
        existing_recommended_actions = insight.insights.get("recommended_actions") or []
        existing_career_suggestions = insight.insights.get("career_suggestions") or []

    # 兜底初始化默认值
    if not existing_focus_areas:
        existing_focus_areas = [
            "架构表达框架建立",
            "项目指标定量细化",
            "系统设计 trade-off 表达"
        ]
    if len(existing_trends) < 3:
        existing_trends = [
            "系统设计出现频率上升 23%",
            "分布式相关问题增加明显",
            "面试官更关注工程落地细节"
        ]
    if not existing_recommended_actions:
        existing_recommended_actions = [
            "完成 3 次真题模拟面试",
            "优化 2 个核心项目描述",
            "补充架构师深度表达训练"
        ]
    if not existing_career_suggestions:
        existing_career_suggestions = [
            "建议向 Staff Engineer 方向准备",
            "提升技术影响力和领导力表达",
            "密切关注一线大厂架构能力变化"
        ]

    # 3. 获取候选人完整背景数据 (UserProfile, ProjectMemory, ResumeAnalysis, completed Interviews)
    from app.routers.live import _fetch_candidate_context_full
    try:
        ctx_str, _, _, _ = await _fetch_candidate_context_full(db, user_id, target_role)
    except Exception as e:
        logger.error(f"Error fetching candidate context for user {user_id}: {e}")
        ctx_str = f"目标岗位: {target_role}"

    # 4. 构造定制化建议 Prompt
    prompt = f"""你是一个资深的 AI 职业顾问专家。当前候选人刚刚完成了一次新的简历/面试评估。你需要为其评估并生成『近期面试趋势』与『推荐行动』。

【候选人背景上下文】
{ctx_str}

【原有建议记录（用于增量评估）】
- 原有近期面试趋势首条 (latest_trend): "{existing_trends[0]}"
- 原有推荐行动 (existing_actions): {json.dumps(existing_recommended_actions, ensure_ascii=False)}

【大模型决策逻辑与输出约束】
1. 近期面试趋势 (new_trend):
   - 你需要根据候选人的最新表现，生成 1 条全新的、针对本次面试/简历分析的最新面试趋势。
   - 例如："系统设计出现频率上升 23%"、"高并发缓存一致性考察增加"等。
2. 推荐行动 (recommended_actions):
   - 评估当前最新的表现和已有的推荐行动。
   - 如果现有的行动（{existing_recommended_actions}）仍然有效/适用，且没有发现候选人出现新的严重知识漏洞或急需改进的痛点，请在 `need_update` 字段中返回 false。
   - 只有当现有行动已经不合时宜、或候选人在最新面试中暴露了新的需要紧急攻克的短板时，才在 `need_update` 中返回 true，并在 `recommended_actions` 字段中给出全新拟定的 3 条行动建议。

【联网工具（可选）】
为了让近期面试趋势更贴近当下行业招聘现状，可以调用 `web_search(query, count=5)` 工具检索目标岗位近期大厂面试考点偏好或行业最新趋势。仅在本地上下文与训练语料不足时调用；联网失败时直接基于本地上下文作答即可，不要因为工具失败而中断。

【字数长度严格限制】
每一个生成的建议条目字数必须严格限制在 10 到 18 个汉字以内。
表述必须极度简明扼要，一行能展示完，严禁任何长篇大论，严禁包含任何括号、说明性后缀或多余解释。

你必须且只能返回严格符合以下结构的 JSON 字符串（不要包含任何 markdown 块或导言）：
{{
  "new_trend": "新生成的1条面试趋势（10-18个字，严禁包含任何括号或说明）",
  "need_update": true,  // 或 false，代表是否需要更新推荐行动
  "recommended_actions": ["行动1", "行动2", "行动3"] // 如果 need_update 为 false，此数组可以为空 []
}}
"""

    payload = {
        "model": settings.DEEPSEEK_MODEL_FAST,
        "messages": [
            {"role": "system", "content": "You are a professional AI career advisor. Output raw JSON only."},
            {"role": "user", "content": prompt}
        ],
        "temperature": 0.3
    }

    try:
        parsed_data = await _call_llm_with_retry(payload, enable_network=True)

        # 6. 处理『近期面试趋势』：仅覆盖最新的一条记录（即 index 0 项），后 2 条保持原样
        new_trend = parsed_data.get("new_trend") or "面试考察工程落地细节明显"
        updated_trends = [new_trend] + existing_trends[1:]
        
        # 7. 处理『推荐行动』：AI 判断是否需要更新
        need_update = parsed_data.get("need_update")
        new_actions = parsed_data.get("recommended_actions")
        
        # 自愈：如果原先数据库里的推荐行动完全为空，则强制进行首次生成覆盖
        if not existing_recommended_actions:
            need_update = True
            
        if need_update and isinstance(new_actions, list) and len(new_actions) >= 3:
            updated_actions = new_actions[:3]
            logger.info(f"AI Advisor determined recommended_actions NEED update for user {user_id}")
        else:
            updated_actions = existing_recommended_actions
            logger.info(f"AI Advisor determined recommended_actions DO NOT need update for user {user_id}")

        # 8. 组装并融入保留不变的 focus_areas 和 career_suggestions
        final_insights = {
            "focus_areas": existing_focus_areas,
            "interview_trends": updated_trends,
            "recommended_actions": updated_actions,
            "career_suggestions": existing_career_suggestions,
            "is_customized": True,
            "target_role": target_role
        }

        # 写入或更新缓存记录
        if insight:
            insight.insights = final_insights
        else:
            insight = models.UserAdvisorInsight(
                user_id=user_id,
                insights=final_insights
            )
            db.add(insight)
            
        await db.commit()
        logger.info(f"Successfully generated and saved CUSTOM advisor insights for user {user_id}")
    except Exception as e:
        logger.error(f"Failed to generate custom advisor insights for user {user_id}: {e}", exc_info=True)


async def trigger_custom_advisor_insights(user_id: int):
    """
    用独立的、安全的数据库连接会话，异步执行定制化 AI 顾问建议生成。
    """
    from app.database import async_session
    async with async_session() as db:
        await generate_custom_advisor_insights(db, user_id)


async def trigger_general_advisor_insights(user_id: int, target_role: str):
    """BackgroundTasks 安全包装器：用独立 async_session() 跑 generate_general_advisor_insights。

    注意：**不要**在路由里直接 ``background_tasks.add_task(generate_general_advisor_insights, db, ...)``，
    请求返回后 ``db`` 会被依赖项释放，而 background task 仍在用它 commit → 隐性失败。
    """
    from app.database import async_session
    async with async_session() as db:
        await generate_general_advisor_insights(db, user_id, target_role)


async def generate_weekly_focus_areas(db: AsyncSession, user_id: int):
    """
    每周定时任务触发更新用户的『本周重点提升』。
    保持其他 3 个维度（近期面试趋势、推荐行动、职业发展建议）不变。
    """
    logger.info(f"Starting weekly focus areas refresh for user {user_id}")
    
    # 1. 查找用户求职目标职位
    profile_stmt = select(models.UserProfile).where(models.UserProfile.user_id == user_id)
    profile_result = await db.execute(profile_stmt)
    profile = profile_result.scalars().first()
    if not profile or not profile.target_role:
        logger.warning(f"No profile/target_role found for user {user_id}. Cannot refresh weekly focus areas.")
        return

    target_role = profile.target_role

    # 2. 查找已有建议记录
    stmt = select(models.UserAdvisorInsight).where(models.UserAdvisorInsight.user_id == user_id)
    result = await db.execute(stmt)
    insight = result.scalars().first()
    if not insight or not insight.insights:
        logger.warning(f"No existing advisor insights found for user {user_id}. Generating general insights instead.")
        await generate_general_advisor_insights(db, user_id, target_role)
        return

    existing_insights = dict(insight.insights)

    # 3. 获取候选人完整背景数据
    from app.routers.live import _fetch_candidate_context_full
    try:
        ctx_str, _, _, _ = await _fetch_candidate_context_full(db, user_id, target_role)
    except Exception as e:
        logger.error(f"Error fetching candidate context for user {user_id}: {e}")
        ctx_str = f"目标岗位: {target_role}"

    prompt = f"""你是一个资深的 AI 职业顾问专家。你需要基于以下候选人的画像、简历、项目记忆与模拟面试表现历史，为其生成一份新的『本周重点提升』建议。

【候选人背景上下文】
{ctx_str}

【建议生成维度与输出约束】
建议只包含本周重点提升 (focus_areas) 这一个维度（严格输出 3 条，表述要专业、深入、切中候选人当前的实际能力短板与技术痛点，严禁长篇大论）：
1. 本周重点提升 (focus_areas): 具体需要强化的技术痛点、系统设计漏洞或表达模式（参考候选人被扣分或扣分频次高的维度）。

【联网工具（可选）】
为了让本周重点提升更贴近候选人目标岗位当下大厂考察热点，可以调用 `web_search(query, count=5)` 工具检索目标岗位近期高频考点。仅在本地上下文与训练语料不足时调用；联网失败时直接基于本地上下文作答即可，不要因为工具失败而中断。

【输出长度严格限制】
每一个生成的建议条目字数必须严格限制在 10 到 18 个汉字以内。
表述必须极度简明扼要，一行能展示完，严禁任何长篇大论，严禁包含任何括号、说明性后缀或多余解释。
例如："微服务高可用方案设计"、"补充核心项目定量指标"等。

你必须且只能返回严格符合以下结构的 JSON 字符串（不要包含任何 markdown 块或导言）：
{{
  "focus_areas": ["第一个重点项", "第二个重点项", "第三个重点项"]
}}
"""

    payload = {
        "model": settings.DEEPSEEK_MODEL_FAST,
        "messages": [
            {"role": "system", "content": "You are a professional AI career advisor. Output raw JSON only."},
            {"role": "user", "content": prompt}
        ],
        "temperature": 0.3
    }

    try:
        parsed_data = await _call_llm_with_retry(payload, enable_network=True)

        new_focus_areas = parsed_data.get("focus_areas") or []
        if len(new_focus_areas) >= 3:
            existing_insights["focus_areas"] = new_focus_areas
            insight.insights = existing_insights
            await db.commit()
            logger.info(f"Successfully refreshed weekly focus areas for user {user_id}")
        else:
            logger.warning(f"Generated focus areas invalid format for user {user_id}")
    except Exception as e:
        logger.error(f"Failed to refresh weekly focus areas for user {user_id}: {e}", exc_info=True)
