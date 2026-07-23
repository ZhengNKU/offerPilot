"""知识库能力卡片生成与匹配服务。

提供：
- LLM 驱动的 4 核心能力 × 5 细化能力生成
- 面试分析结果 → 细化能力的语义匹配与计数累加
- 历史面试记录的全量重新匹配
"""
import asyncio
import json
import logging
import re
from typing import Optional

from sqlalchemy import delete, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app import models
from app.config import settings
from app.utils.llm import call_llm_stream, _strip_codeblock

logger = logging.getLogger(__name__)

DEFAULT_MAX_RETRIES = 3


# ── JSON 解析工具 ──────────────────────────────────────────────

def _safe_json_parse(text: str) -> dict:
    """鲁棒地从 LLM 输出解析 JSON。

    策略：
      1) ``_strip_codeblock`` 去围栏 / 去 ``` 块 / 去 <think> 块；
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


async def _call_llm_with_retry(payload: dict, max_retries: int = DEFAULT_MAX_RETRIES) -> dict:
    """对 LLM 调用 + JSON 解析整体重试，最多 ``max_retries`` 次。

    网络/超时/5xx 已由 ``call_llm_stream`` 内部会话重试，这里补齐的是
    「模型能响应但内容无法解析」这一类典型失败。
    """
    last_exc: Optional[BaseException] = None
    for attempt in range(1, max_retries + 1):
        try:
            res_data = await asyncio.to_thread(call_llm_stream, payload, 180.0)
            content = res_data["choices"][0]["message"]["content"]
            parsed = _safe_json_parse(content)
            if attempt > 1:
                logger.info(f"knowledge LLM+JSON parse succeeded on attempt {attempt}/{max_retries}")
            return parsed
        except (json.JSONDecodeError, KeyError, IndexError, TypeError) as e:
            last_exc = e
            logger.warning(
                f"knowledge LLM parse failed (attempt {attempt}/{max_retries}): "
                f"{type(e).__name__}: {e}"
            )
            if attempt < max_retries:
                await asyncio.sleep(1.0 + (attempt - 1) * 0.5)
                continue

    raise RuntimeError(
        f"knowledge LLM generation failed after {max_retries} attempts: {last_exc}"
    ) from last_exc


# ── 关键词匹配回退词典 ─────────────────────────────────────────

# 当 LLM 匹配不可用时，基于 issue label 中的关键词做规则匹配
# 格式：关键词 → 细化能力名（候选）
_KEYWORD_RULES: list[tuple[str, str]] = [
    ("缓存", "缓存设计"),
    ("分布式", "分布式系统"),
    ("锁", "并发控制"),
    ("事务", "事务管理"),
    ("数据库", "数据库优化"),
    ("索引", "数据库优化"),
    ("SQL", "数据库优化"),
    ("消息队列", "消息中间件"),
    ("MQ", "消息中间件"),
    ("Kafka", "消息中间件"),
    ("微服务", "微服务架构"),
    ("服务", "微服务架构"),
    ("架构", "系统设计"),
    ("设计模式", "系统设计"),
    ("系统设计", "系统设计"),
    ("并发", "并发编程"),
    ("多线程", "并发编程"),
    ("线程池", "并发编程"),
    ("网络", "网络协议"),
    ("HTTP", "网络协议"),
    ("TCP", "网络协议"),
    ("算法", "算法与数据结构"),
    ("数据结构", "算法与数据结构"),
    ("排序", "算法与数据结构"),
    ("安全", "安全防护"),
    ("加密", "安全防护"),
    ("认证", "安全防护"),
    ("测试", "测试策略"),
    ("单元测试", "测试策略"),
    ("性能", "性能优化"),
    ("优化", "性能优化"),
    ("调优", "性能优化"),
    ("部署", "运维部署"),
    ("CI/CD", "运维部署"),
    ("Docker", "运维部署"),
    ("K8s", "运维部署"),
    ("日志", "可观测性"),
    ("监控", "可观测性"),
    ("链路", "可观测性"),
    ("API", "接口设计"),
    ("REST", "接口设计"),
    ("RPC", "接口设计"),
]


def _keyword_match(issue_label: str, sub_ability_names: list[str]) -> Optional[str]:
    """基于关键词规则匹配 issue 到最相关的细化能力。

    返回匹配到的细化能力名称，或 None。
    """
    label_lower = issue_label.lower()
    best_match: Optional[str] = None
    best_len = 0

    for keyword, target in _KEYWORD_RULES:
        if keyword.lower() in label_lower:
            # 只匹配存在于当前用户细化能力列表中的名称
            for sa_name in sub_ability_names:
                if target.lower() == sa_name.lower() or target in sa_name:
                    if len(keyword) > best_len:
                        best_len = len(keyword)
                        best_match = sa_name

    return best_match


# ── 核心服务类 ─────────────────────────────────────────────────

class KnowledgeAbilityService:
    """知识库能力卡片生成与匹配服务"""

    # ── 生成 ────────────────────────────────────────────────

    @staticmethod
    async def generate_abilities(
        db: AsyncSession,
        user_id: int,
        target_role: str,
        experience_years: str,
        target_grade: str,
    ) -> list[models.KnowledgeCoreAbility]:
        """调用 LLM 生成 4 个核心能力 + 各 5 个细化能力，写入数据库并返回。"""
        logger.info(
            f"Generating knowledge abilities for user {user_id}: "
            f"role={target_role}, years={experience_years}, grade={target_grade}"
        )

        prompt = f"""你是一位资深的职业规划顾问。根据以下用户信息，为其生成"知识库能力看板"：

【用户画像】
- 目标岗位：{target_role}
- 工作年限：{experience_years}
- 目标职级：{target_grade}

【生成要求】
1. 输出 4 个"核心能力板块"，覆盖该岗位面试中最关键的能力维度
2. 每个核心能力下生成 5 个"细化能力子项"，具体到可考察的知识点或技能点
3. 细化能力必须与目标岗位高度相关，避免泛泛而谈
4. 命名简洁精准（2-6字），便于前端卡片展示
5. 4 个核心能力的命名维度可以参考但不限于：
   - 专业硬技能（技术栈/工具/方法论）
   - 业务与行业理解
   - 问题解决与架构思维
   - 沟通协作与影响力
   - 项目实践与落地能力

【输出格式 - 严格 JSON】
{{
  "core_abilities": [
    {{
      "name": "核心能力名称",
      "sub_abilities": ["细化1", "细化2", "细化3", "细化4", "细化5"]
    }}
  ]
}}

你必须且只能返回严格符合以上结构的 JSON 字符串，不要包含任何 markdown 块或导言。"""

        payload = {
            "model": settings.DEEPSEEK_MODEL,
            "messages": [
                {"role": "system", "content": "You are a senior career advisor. Output raw JSON only."},
                {"role": "user", "content": prompt},
            ],
            "temperature": 0.3,
            "response_format": {"type": "json_object"},
        }

        try:
            parsed = await _call_llm_with_retry(payload)
        except Exception as e:
            logger.error(
                f"Failed to generate knowledge abilities for user {user_id} "
                f"after {DEFAULT_MAX_RETRIES} attempts: {e}"
            )
            # 回退：基于岗位关键词生成默认模板
            return await KnowledgeAbilityService._generate_fallback(
                db, user_id, target_role, experience_years, target_grade
            )

        core_abilities_data = parsed.get("core_abilities", [])
        if not isinstance(core_abilities_data, list) or len(core_abilities_data) == 0:
            logger.warning(f"LLM returned empty/malformed core_abilities for user {user_id}, using fallback")
            return await KnowledgeAbilityService._generate_fallback(
                db, user_id, target_role, experience_years, target_grade
            )

        # 确保恰好 4 个核心能力
        if len(core_abilities_data) < 4:
            logger.warning(f"LLM returned only {len(core_abilities_data)} core abilities, padding with fallback")
            fallback = await KnowledgeAbilityService._generate_fallback(
                db, user_id, target_role, experience_years, target_grade
            )
            # 只取不足的部分补充
            needed = 4 - len(core_abilities_data)
            for fb in fallback[:needed]:
                core_abilities_data.append({
                    "name": fb.name,
                    "sub_abilities": [sa.name for sa in fb.sub_abilities],
                })

        core_abilities_data = core_abilities_data[:4]  # 裁剪到 4 个

        core_objs: list[models.KnowledgeCoreAbility] = []
        for ca_idx, ca_data in enumerate(core_abilities_data):
            ca_name = ca_data.get("name", f"核心能力{ca_idx + 1}")[:32]
            sub_names = ca_data.get("sub_abilities", [])
            if not isinstance(sub_names, list):
                sub_names = []
            # 确保恰好 5 个
            if len(sub_names) < 5:
                for i in range(len(sub_names), 5):
                    sub_names.append(f"技能点{i + 1}")
            sub_names = sub_names[:5]

            core = models.KnowledgeCoreAbility(
                user_id=user_id,
                name=ca_name,
                sort_order=ca_idx + 1,
                generated_from_role=target_role,
                generated_from_years=experience_years,
                generated_from_grade=target_grade,
            )
            db.add(core)
            await db.flush()  # 获取 core.id

            for sa_idx, sa_name in enumerate(sub_names):
                sa_name_clean = str(sa_name)[:32]
                sub = models.KnowledgeSubAbility(
                    core_ability_id=core.id,
                    user_id=user_id,
                    name=sa_name_clean,
                    sort_order=sa_idx + 1,
                )
                db.add(sub)

            core_objs.append(core)

        await db.commit()

        # Reload to populate relationships
        reloaded = []
        for c in core_objs:
            await db.refresh(c, ["sub_abilities"])
            reloaded.append(c)

        logger.info(
            f"Successfully generated {len(reloaded)} core abilities "
            f"with {sum(len(c.sub_abilities) for c in reloaded)} sub-abilities "
            f"for user {user_id}"
        )
        return reloaded

    @staticmethod
    async def generate_abilities_data(
        target_role: str,
        experience_years: str,
        target_grade: str,
        user_id: int = 0,
    ) -> list[dict]:
        """调用 LLM 生成能力标签原始数据（不写 DB）。

        返回 [{"core": "核心能力名", "subs": ["细化1", "细化2", ...]}, ...]
        用于面试题先生成后入库的流程。
        """
        logger.info(
            f"Generating abilities data (no DB) for user {user_id}: "
            f"role={target_role}, years={experience_years}, grade={target_grade}"
        )

        prompt = f"""你是一位资深的职业规划顾问。根据以下用户信息，为其生成"知识库能力看板"：

【用户画像】
- 目标岗位：{target_role}
- 工作年限：{experience_years}
- 目标职级：{target_grade}

【生成要求】
1. 输出 4 个"核心能力板块"，覆盖该岗位面试中最关键的能力维度
2. 每个核心能力下生成 5 个"细化能力子项"，具体到可考察的知识点或技能点
3. 细化能力必须与目标岗位高度相关，避免泛泛而谈
4. 命名简洁精准（2-6字），便于前端卡片展示

【输出格式 - 严格 JSON】
{{
  "core_abilities": [
    {{
      "name": "核心能力名称",
      "sub_abilities": ["细化1", "细化2", "细化3", "细化4", "细化5"]
    }}
  ]
}}

你必须且只能返回严格符合以上结构的 JSON 字符串，不要包含任何 markdown 块或导言。"""

        payload = {
            "model": settings.DEEPSEEK_MODEL,
            "messages": [
                {"role": "system", "content": "You are a senior career advisor. Output raw JSON only."},
                {"role": "user", "content": prompt},
            ],
            "temperature": 0.3,
            "response_format": {"type": "json_object"},
        }

        parsed = await _call_llm_with_retry(payload)
        core_abilities_data = parsed.get("core_abilities", [])
        if not isinstance(core_abilities_data, list) or len(core_abilities_data) == 0:
            raise ValueError("LLM returned empty core_abilities")

        # 转换为统一格式 [{"core": "...", "subs": ["...", ...]}, ...]
        result = []
        for ca in core_abilities_data[:4]:
            subs = ca.get("sub_abilities", [])
            if not isinstance(subs, list):
                subs = []
            subs = [str(s)[:32] for s in subs[:5]]
            while len(subs) < 5:
                subs.append(f"技能点{len(subs) + 1}")
            result.append({
                "core": str(ca.get("name", ""))[:32],
                "subs": subs,
            })

        logger.info(
            f"Generated abilities data for user {user_id}: "
            f"{len(result)} cores, {sum(len(r['subs']) for r in result)} subs"
        )
        return result

    @staticmethod
    async def _generate_fallback(
        db: AsyncSession,
        user_id: int,
        target_role: str,
        experience_years: str,
        target_grade: str,
    ) -> list[models.KnowledgeCoreAbility]:
        """当 LLM 不可用时，基于岗位关键词生成预设模板。"""
        logger.info(f"Using fallback template generation for user {user_id}, role={target_role}")

        # 基于目标岗位关键词选择模板
        role_lower = target_role.lower()
        is_backend = any(kw in role_lower for kw in ["后端", "java", "go", "python", "后台", "服务端", "backend"])
        is_frontend = any(kw in role_lower for kw in ["前端", "frontend", "h5", "web", "react", "vue"])
        is_data = any(kw in role_lower for kw in ["数据", "data", "算法", "algorithm", "机器学习", "ai", "nlp"])
        is_product = any(kw in role_lower for kw in ["产品", "product", "pm"])
        is_devops = any(kw in role_lower for kw in ["运维", "devops", "sre", "云原生", "云"])

        if is_backend:
            template = [
                ("专业硬技能", ["编程语言深度", "框架与中间件", "数据库与存储", "API与协议设计", "代码质量与重构"]),
                ("系统架构思维", ["分布式系统", "高并发设计", "高可用与容灾", "性能调优", "容量规划"]),
                ("业务与行业理解", ["领域建模", "需求分析拆解", "技术选型决策", "成本与ROI意识", "合规与安全"]),
                ("工程素养", ["问题定位排查", "技术文档表达", "跨团队协作", "技术影响力", "持续学习迭代"]),
            ]
        elif is_frontend:
            template = [
                ("专业硬技能", ["JS/TS语言深度", "主流框架原理", "CSS布局与动画", "浏览器与性能", "工程化工具链"]),
                ("架构与设计", ["组件化设计", "状态管理", "跨端方案", "渲染性能优化", "前端安全"]),
                ("业务与行业理解", ["用户体验思维", "数据可视化", "无障碍设计", "SEO与首屏优化", "AB实验分析"]),
                ("工程素养", ["问题定位排查", "技术文档表达", "跨团队协作", "技术影响力", "持续学习迭代"]),
            ]
        elif is_data:
            template = [
                ("专业硬技能", ["Python/SQL深度", "特征工程", "模型选型与调参", "数据处理pipeline", "AB实验设计"]),
                ("算法与推理", ["统计学基础", "机器学习理论", "深度学习框架", "因果推断", "模型可解释性"]),
                ("业务与行业理解", ["指标体系建设", "数据驱动决策", "用户行为分析", "归因分析", "数据合规"]),
                ("工程素养", ["大数据平台", "模型部署服务", "数据质量治理", "技术文档表达", "跨团队协作"]),
            ]
        elif is_product:
            template = [
                ("专业硬技能", ["需求分析", "用户研究", "数据分析", "竞品调研", "原型设计"]),
                ("策略与规划", ["产品路线图", "优先级管理", "商业模式", "增长策略", "风险管控"]),
                ("行业与业务理解", ["行业趋势洞察", "用户心理把握", "政策法规认知", "技术可行性判断", "市场定位"]),
                ("软素质", ["跨部门推动", "沟通表达", "项目管理", "团队领导力", "复盘迭代"]),
            ]
        elif is_devops:
            template = [
                ("专业硬技能", ["Linux系统", "容器与K8s", "CI/CD流水线", "IaC与配置管理", "脚本与自动化"]),
                ("架构与稳定性", ["高可用架构", "容量规划", "灾备与容灾", "安全加固", "成本优化"]),
                ("可观测性", ["监控告警体系", "日志与链路追踪", "SLO与错误预算", "On-Call响应", "故障复盘"]),
                ("工程素养", ["问题定位排查", "技术文档表达", "跨团队协作", "技术影响力", "持续学习迭代"]),
            ]
        else:
            # 通用模板
            template = [
                ("专业硬技能", ["核心技术栈", "工具链与方法论", "行业标准与规范", "质量保障", "技术深度"]),
                ("系统与架构思维", ["系统设计", "性能与可扩展性", "稳定性与韧性", "技术选型", "架构演进"]),
                ("业务与行业理解", ["领域知识", "业务指标分析", "需求洞察", "竞品与市场", "合规与风险管理"]),
                ("软素质与影响力", ["沟通表达", "跨团队协作", "项目推进", "技术领导力", "持续学习"]),
            ]

        core_objs: list[models.KnowledgeCoreAbility] = []
        for ca_idx, (ca_name, sub_names) in enumerate(template):
            core = models.KnowledgeCoreAbility(
                user_id=user_id,
                name=ca_name,
                sort_order=ca_idx + 1,
                generated_from_role=target_role,
                generated_from_years=experience_years,
                generated_from_grade=target_grade,
            )
            db.add(core)
            await db.flush()

            for sa_idx, sa_name in enumerate(sub_names):
                sub = models.KnowledgeSubAbility(
                    core_ability_id=core.id,
                    user_id=user_id,
                    name=sa_name,
                    sort_order=sa_idx + 1,
                )
                db.add(sub)

            core_objs.append(core)

        await db.commit()

        # Reload to populate relationships
        reloaded = []
        for c in core_objs:
            await db.refresh(c, ["sub_abilities"])
            reloaded.append(c)

        logger.info(f"Fallback generation complete for user {user_id}: {len(reloaded)} core abilities")
        return reloaded

    @staticmethod
    async def save_abilities_to_db(
        db: AsyncSession,
        user_id: int,
        abilities_data: list[dict],
        target_role: str = "",
        experience_years: str = "",
        target_grade: str = "",
    ):
        """将预生成的能力标签数据写入 DB（先删后插）。

        abilities_data 格式: [{"core": "核心能力名", "subs": ["细化1", ...]}, ...]
        """
        # 删除旧数据
        await db.execute(
            delete(models.KnowledgeSubAbility).where(
                models.KnowledgeSubAbility.user_id == user_id
            )
        )
        await db.execute(
            delete(models.KnowledgeCoreAbility).where(
                models.KnowledgeCoreAbility.user_id == user_id
            )
        )
        await db.flush()

        for ca_idx, ca_data in enumerate(abilities_data):
            core = models.KnowledgeCoreAbility(
                user_id=user_id,
                name=ca_data["core"][:32],
                sort_order=ca_idx + 1,
                generated_from_role=target_role,
                generated_from_years=experience_years,
                generated_from_grade=target_grade,
            )
            db.add(core)
            await db.flush()

            for sa_idx, sa_name in enumerate(ca_data.get("subs", [])[:5]):
                db.add(models.KnowledgeSubAbility(
                    core_ability_id=core.id,
                    user_id=user_id,
                    name=str(sa_name)[:32],
                    sort_order=sa_idx + 1,
                ))

        await db.commit()
        logger.info(
            f"Saved abilities to DB for user {user_id}: "
            f"{len(abilities_data)} cores"
        )

    @staticmethod
    async def regenerate_for_user(db: AsyncSession, user_id: int, *, rematch: bool = False):
        """删除旧数据 + 重新生成。可选是否回填历史面试记录。

        Args:
            rematch: 若为 True，则在生成后扫描所有历史面试记录重新匹配计数。
                     默认 False——仅清空并生成新能力，让后续分析自然累加。
        """
        logger.info(f"Regenerating knowledge abilities for user {user_id} (rematch={rematch})")

        # 1. 删除旧数据（级联删除子能力）
        await db.execute(
            delete(models.KnowledgeSubAbility).where(
                models.KnowledgeSubAbility.user_id == user_id
            )
        )
        await db.execute(
            delete(models.KnowledgeCoreAbility).where(
                models.KnowledgeCoreAbility.user_id == user_id
            )
        )
        await db.commit()

        # 2. 读取用户画像
        profile_result = await db.execute(
            select(models.UserProfile).where(models.UserProfile.user_id == user_id)
        )
        profile = profile_result.scalars().first()
        if not profile or not profile.target_role:
            logger.warning(f"No target_role for user {user_id}, skipping knowledge generation")
            return

        target_role = profile.target_role or ""
        experience_years = profile.experience_years or "1-3年"
        target_grade = profile.target_grade or ""

        # 3. 生成新能力
        await KnowledgeAbilityService.generate_abilities(
            db, user_id, target_role, experience_years, target_grade
        )

        # 4. 仅在明确请求时回填历史面试记录计数
        if rematch:
            await KnowledgeAbilityService.rematch_all_transcripts(db, user_id)

    # ── 匹配 ────────────────────────────────────────────────

    @staticmethod
    async def match_session_issues(
        db: AsyncSession,
        user_id: int,
        issues: list[dict],
    ):
        """将面试分析中发现的问题匹配到细化能力并递增计数。

        每条 issue 只匹配到一个细化能力；每个细化能力每次调用最多 +1。
        同一 label 的 issue 自动去重。

        Args:
            db: 数据库会话
            user_id: 用户ID
            issues: 问题列表，每项格式 {"type": "max_lose"|"weakness"|"interviewer_perspective",
                     "label": "问题标签", "desc": "详细描述（可选）"}
        """
        if not issues:
            return

        # ── 去重：相同 label 的 issue 只保留一条 ──
        seen_labels: set[str] = set()
        deduped_issues: list[dict] = []
        for issue in issues:
            label = (issue.get("label") or "").strip()
            if label and label not in seen_labels:
                seen_labels.add(label)
                deduped_issues.append(issue)
        issues = deduped_issues

        if not issues:
            return

        # 获取用户所有细化能力
        result = await db.execute(
            select(models.KnowledgeSubAbility)
            .where(models.KnowledgeSubAbility.user_id == user_id)
        )
        sub_abilities = result.scalars().all()

        if not sub_abilities:
            logger.debug(f"No sub-abilities for user {user_id}, skipping match")
            return

        sa_names = [sa.name for sa in sub_abilities]
        sa_name_to_id: dict[str, int] = {}
        # 大小写不敏感索引
        sa_name_lower_to_id: dict[str, int] = {}
        for sa in sub_abilities:
            sa_name_to_id[sa.name] = sa.id
            sa_name_lower_to_id[sa.name.lower()] = sa.id

        # 构建问题文本列表（每个问题是面试官问的一道题）
        question_texts: list[str] = []
        for issue in issues:
            label = issue.get("label", "")
            desc = issue.get("desc", "")
            text = f"{label} {desc}".strip()
            if text:
                question_texts.append(text)

        if not question_texts:
            return

        # 每道题匹配一个细化能力，同一子能力本场最多 +1
        matched_sa_ids: set[int] = set()

        try:
            sa_list_text = "\n".join(
                f"- {sa.name}" for sa in sub_abilities
            )
            questions_text = "\n".join(
                f"{i}. {t}" for i, t in enumerate(question_texts)
            )

            match_prompt = f"""你是面试能力评估专家。以下是面试中向候选人提出的问题。请判断每道题在考查哪个细化能力。

细化能力列表：
{sa_list_text}

面试问题：
{questions_text}

对每道题，判断它最相关的是哪个细化能力（必须从上表中选一个）。

输出格式 - 严格 JSON：
{{"matches": [{{"question_index": 0, "sub_ability_name": "细化能力名称"}}, ...]}}"""

            payload = {
                "model": settings.DEEPSEEK_MODEL_FAST,
                "messages": [
                    {"role": "system", "content": "You are an interview evaluator. Output raw JSON only."},
                    {"role": "user", "content": match_prompt},
                ],
                "temperature": 0.1,
                "response_format": {"type": "json_object"},
            }

            parsed = await _call_llm_with_retry(payload, max_retries=2)
            llm_matches = parsed.get("matches", [])

            if isinstance(llm_matches, list):
                for m in llm_matches:
                    sa_name = m.get("sub_ability_name", "")
                    sa_id = sa_name_to_id.get(sa_name)
                    if sa_id is None:
                        sa_id = sa_name_lower_to_id.get(sa_name.lower())
                    if sa_id:
                        matched_sa_ids.add(sa_id)  # set 自动去重

            logger.info(
                f"LLM match for user {user_id}: {len(question_texts)} questions → "
                f"{len(matched_sa_ids)} unique sub-abilities"
            )
        except Exception as e:
            logger.warning(
                f"LLM match failed for user {user_id}, falling back to keyword: {e}"
            )
            for qt in question_texts:
                matched_name = _keyword_match(qt, sa_names)
                if matched_name:
                    sa_id = sa_name_to_id.get(matched_name)
                    if sa_id:
                        matched_sa_ids.add(sa_id)

        # 每个命中的细化能力 +1（set 自动保证同一子能力本场只 +1）
        if matched_sa_ids:
            for sa_id in matched_sa_ids:
                await db.execute(
                    update(models.KnowledgeSubAbility)
                    .where(models.KnowledgeSubAbility.id == sa_id)
                    .values(question_count=models.KnowledgeSubAbility.question_count + 1)
                )
            await db.commit()
            logger.info(
                f"Updated question_count for user {user_id}: "
                f"{len(matched_sa_ids)} sub-abilities, each +1"
            )

    @staticmethod
    async def rematch_all_transcripts(db: AsyncSession, user_id: int):
        """重新扫描当前用户所有历史面试记录，按会话独立匹配并更新计数。

        每场会话中每个细化能力最多 +1（无论该会话中有多少个 issue 匹配到它）。
        覆盖 InterviewSession（录音/文本模式）和 InterviewLiveSession（实时面试）。
        """
        logger.info(f"Rematching all transcripts for user {user_id}")

        # 先清零所有计数
        await db.execute(
            update(models.KnowledgeSubAbility)
            .where(models.KnowledgeSubAbility.user_id == user_id)
            .values(question_count=0)
        )
        await db.commit()

        total_matched = 0

        # 辅助函数：从 analysis_result 提取面试问题
        def extract_questions(ar: dict) -> list[dict]:
            """从 question_deconstruction 提取面试官提出的真实问题"""
            seen: set[str] = set()
            result: list[dict] = []
            for qd in ar.get("question_deconstruction") or []:
                if isinstance(qd, dict) and qd.get("title"):
                    label = qd["title"].strip()
                    if label and label not in seen:
                        seen.add(label)
                        result.append({"label": label, "desc": qd.get("desc", "")})
            return result

        # 1. InterviewSession（录音/文本模式）——逐会话匹配
        session_result = await db.execute(
            select(models.InterviewSession)
            .where(
                models.InterviewSession.user_id == user_id,
                models.InterviewSession.status == "completed",
                models.InterviewSession.analysis_result.isnot(None),
            )
        )
        sessions = session_result.scalars().all()

        for sess in sessions:
            ar = sess.analysis_result
            if not isinstance(ar, dict):
                continue
            sess_questions = extract_questions(ar)
            if sess_questions:
                await KnowledgeAbilityService.match_session_issues(db, user_id, sess_questions)
                total_matched += 1

        # 2. InterviewLiveSession（实时面试）——逐会话匹配
        live_result = await db.execute(
            select(models.InterviewLiveSession)
            .where(
                models.InterviewLiveSession.user_id == user_id,
                models.InterviewLiveSession.status == "completed",
                models.InterviewLiveSession.analysis_result.isnot(None),
            )
        )
        live_sessions = live_result.scalars().all()

        for ls in live_sessions:
            ar = ls.analysis_result
            if not isinstance(ar, dict):
                continue
            sess_questions = extract_questions(ar)
            if sess_questions:
                await KnowledgeAbilityService.match_session_issues(db, user_id, sess_questions)
                total_matched += 1

        logger.info(
            f"Rematch for user {user_id} complete: "
            f"{len(sessions)} audio + {len(live_sessions)} live sessions, "
            f"{total_matched} with issues matched"
        )


# ── 后台任务触发器 ─────────────────────────────────────────────

# 防止同一用户并发触发生成
_inflight_generations: set[int] = set()


async def trigger_knowledge_generation(user_id: int):
    """后台任务：生成能力标签 → 生成面试题 → 一起入库。

    流程：
    1. LLM 生成能力标签（不写 DB）
    2. LLM 批量生成所有标签的面试题
    3. 面试题成功后 → 能力标签入库 + 面试题写 Redis&PG
    失败重试 3 次（指数退避）。
    """
    # 防止同一用户并发触发生成（同一用户同时只允许一个生成任务运行）
    if user_id in _inflight_generations:
        logger.info(
            f"[trigger_knowledge_generation] user={user_id} already generating, skip duplicate"
        )
        return
    _inflight_generations.add(user_id)

    from app.database import async_session

    try:
        async with async_session() as db:
            # 读取用户画像
            profile_result = await db.execute(
                select(models.UserProfile).where(models.UserProfile.user_id == user_id)
            )
            profile = profile_result.scalars().first()
            if not profile or not profile.target_role:
                logger.info(f"[trigger_knowledge_generation] user={user_id} no target_role, skip")
                return

        target_role = profile.target_role or ""
        experience_years = profile.experience_years or "1-3年"
        target_grade = profile.target_grade or ""

        # 复用全局 Redis 连接池（不再每请求新建连接）
        from app.database import _get_redis_pool
        redis_client = _get_redis_pool()

        for attempt in range(1, 4):
            try:
                logger.info(
                    f"[trigger_knowledge_generation] START user={user_id} attempt={attempt}"
                )

                # ① LLM 生成能力标签（不写 DB）
                abilities_data = await KnowledgeAbilityService.generate_abilities_data(
                    target_role, experience_years, target_grade, user_id
                )
                if not abilities_data:
                    raise ValueError("abilities_data is empty")

                # ② 展开为 question_generator 需要的格式
                sa_list = []
                for ca in abilities_data:
                    for sub in ca["subs"]:
                        sa_list.append({"core": ca["core"], "sub": sub})

                # ③ LLM 批量生成面试题 + 写 Redis + PG
                from app.services.question_generator import (
                    generate_and_cache_with_abilities,
                )
                result = await generate_and_cache_with_abilities(
                    db, user_id, sa_list,
                    target_role, target_grade, experience_years,
                    redis_client,
                    enable_network=False,  # 后台任务关闭联网搜索，避免 web_search 超时阻塞
                )
                if not result:
                    raise ValueError("question generation returned empty")

                # ④ 面试题成功后 → 能力标签入库
                await KnowledgeAbilityService.save_abilities_to_db(
                    db, user_id, abilities_data,
                    target_role, experience_years, target_grade,
                )

                logger.info(
                    f"[trigger_knowledge_generation] DONE user={user_id} "
                    f"abilities={len(abilities_data)} questions_abilities={len(result)}"
                )
                return  # 成功

            except Exception as e:
                logger.error(
                    f"[trigger_knowledge_generation] attempt {attempt}/3 FAILED "
                    f"user={user_id}: {e}", exc_info=True
                )
                if attempt < 3:
                    delay = 2 ** attempt
                    await asyncio.sleep(delay)
    finally:
        _inflight_generations.discard(user_id)


async def trigger_knowledge_match(user_id: int, issues: list[dict]):
    """后台任务：匹配面试分析结果中的问题到知识库细化能力 + 刷新面试题。

    使用独立的 async_session()，不依赖请求上下文中的 db 会话。
    """
    if not user_id or not issues:
        return

    from app.database import async_session

    async with async_session() as db:
        try:
            logger.info(
                f"[trigger_knowledge_match] START user={user_id} issues={len(issues)}"
            )
            await KnowledgeAbilityService.match_session_issues(db, user_id, issues)
            logger.info(
                f"[trigger_knowledge_match] match OK user={user_id}"
            )
        except Exception as e:
            logger.error(
                f"[trigger_knowledge_match] match FAILED user={user_id}: {e}",
                exc_info=True,
            )
            return

        # 匹配完成后批量刷新面试题（写 Redis + PG）
        try:
            from app.database import _get_redis_pool
            redis_client = _get_redis_pool()
            try:
                from app.services.question_generator import (
                    invalidate_and_regenerate,
                )
                logger.info(
                    f"[trigger_knowledge_match] batch question refresh START user={user_id}"
                )
                await invalidate_and_regenerate(db, user_id, redis_client)
                logger.info(
                    f"[trigger_knowledge_match] batch question refresh DONE user={user_id}"
                )
            finally:
                pass  # redis 使用全局连接池，不 close
        except Exception as e:
            logger.error(
                f"[trigger_knowledge_match] batch question refresh FAILED user={user_id}: {e}",
                exc_info=True,
            )
