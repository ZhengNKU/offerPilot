"""通用 Tool Registry — LLM Tool Calling 的工具统一注册中心。

调用方式：
  1. 注册工具：在本文件 DEFAULT_TOOLS 中追加一个 ToolSpec，或新建文件并 import
  2. LLM 调用栈：utils/llm.call_llm_*_with_tools(tools=registry.all_tools(), ctx=ctx)
  3. handler 签名: async def handler(args: dict, ctx: dict) -> str

ctx dict 约定（调用方在 LLM 调用栈处组装）：
  - db:        AsyncSession                当前 DB 会话
  - user_id:   int                         当前用户 ID
  - logger:    logging.Logger              可选：调用方 logger

ToolSpec.to_openai() 返回 OpenAI-compatible function schema，结构：
  {"type": "function", "function": {"name", "description", "parameters"}}
作为 chat/completions 的 `tools` 参数元素。

设计原则：
  - 内置工具「轻封装」已有 service 函数（如 mcp_client.search_web），不重复实现
  - 工具尽量无副作用、不发起别的 LLM 调用（query_match_rate 例外：复用现成实现）
  - 加新 tool = 新建一个 ToolSpec + 在 DEFAULT_TOOLS 中追加，不动 LLM 调用栈
"""
from dataclasses import dataclass
from typing import Awaitable, Callable
import asyncio
import logging
import time

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.embedding import embed_for_query, truncate_to_token_limit

# 注意:generate_match_rate_via_llm 在 _query_match_rate_handler 内 lazy import,
# 避免 tool_registry ↔ utils/llm 形成循环 import。

logger = logging.getLogger(__name__)

ToolCtx = dict       # db (AsyncSession), user_id (int), logger (Logger)
ToolHandler = Callable[[dict, ToolCtx], Awaitable[str]]


# ──────────────────────────────────────────────────────────────────
# Tool 调用硬超时（防止 LLM tool calling 循环被一次慢响应拖垮）
# ──────────────────────────────────────────────────────────────────
DEFAULT_WEB_SEARCH_TIMEOUT_S: float = 8.0


# ──────────────────────────────────────────────────────────────────
# 核心类型
# ──────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class ToolSpec:
    """LLM Tool Calling 工具的声明。

    handler 签名: async def handler(args: dict, ctx: dict) -> str
        args  是 LLM 通过 tools/call 传的 JSON 已解析 dict（按 parameters schema）
        ctx   是 runtime 注入的上下文（db / user_id / logger）
        返回  是给 LLM 看的 tool result 文本
    """
    name: str
    description: str
    parameters: dict
    handler: ToolHandler

    def to_openai(self) -> dict:
        """转 OpenAI-compatible function 描述（chat/completions tools 数组元素）。"""
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters,
            },
        }


# ──────────────────────────────────────────────────────────────────
# 内置 Tool 1: web_search —— 包装 mcp_client.search_web
# ──────────────────────────────────────────────────────────────────

async def _web_search_handler(args: dict, ctx: ToolCtx) -> str:
    """薄封装 mcp_client.search_web；query/count 由 LLM 传入。
    """
    log = (ctx or {}).get("logger", logger)
    ctx = ctx or {}

    # 同一请求内若已被降级过一次，后续 web_search 直接走 no-network 短路，
    if ctx.get("_web_search_disabled"):
        return "（联网检索此前已被禁用/超时降级；请基于已知上下文作答，无需再次调用 web_search）"

    query = (args.get("query") or "").strip()
    if not query:
        return "（未提供 query，未触发联网检索）"
    count = int(args.get("count") or 5)
    count = max(1, min(10, count))   # 上限保护

    timeout_s = float(ctx.get("web_search_timeout") or DEFAULT_WEB_SEARCH_TIMEOUT_S)

    # lazy import: mcp_client 是叶子模块，import 成本可忽略
    from app.services.mcp_client import search_web as _search_web_impl
    t0 = time.monotonic()
    try:
        result = await asyncio.wait_for(
            _search_web_impl(query, count=count),
            timeout=timeout_s,
        )
    except asyncio.TimeoutError:
        elapsed_ms = int((time.monotonic() - t0) * 1000)
        ctx["_web_search_disabled"] = True
        log.warning(
            f"[tool_registry] web_search 超时降级 after {elapsed_ms}ms "
            f"(threshold={timeout_s:.1f}s, query={query!r}) → 本请求内后续 web_search 短路"
        )
        return (
            f"（联网检索超过 {timeout_s:.0f}s 仍未返回，已降级为不检索；"
            "请基于已知上下文作答，无需再次调用 web_search）"
        )
    except Exception as e:
        elapsed_ms = int((time.monotonic() - t0) * 1000)
        ctx["_web_search_disabled"] = True
        log.warning(f"[tool_registry] web_search 异常降级 after {elapsed_ms}ms: {e!r} → 本请求内后续 web_search 短路")
        return "（联网检索失败，已降级为不检索）"
    return result or "（未找到相关互联网搜索结果）"


WEB_SEARCH = ToolSpec(
    name="web_search",
    description=(
        "通过阿里云百炼 WebSearch 实时检索互联网公开信息。"
        "适用场景：公司背景、岗位要求、行业资讯、面试经验、最新技术趋势、薪资参考等。"
        "返回结果为 Markdown 链接列表（标题 + URL + 摘要），引用时务必保留链接便于用户直达。"
        "查询「本地知识库」（项目记忆 / 历史面试 / 简历细节）请勿调用本工具，应使用 recall_user_history。"
    ),
    parameters={
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "搜索关键词，简短直接，无需 Markdown 或引号",
            },
            "count": {
                "type": "integer",
                "description": "返回页面数量，默认 5，上限 10",
                "minimum": 1,
                "maximum": 10,
                "default": 5,
            },
        },
        "required": ["query"],
    },
    handler=_web_search_handler,
)


# ──────────────────────────────────────────────────────────────────
# 内置 Tool 2: recall_user_history —— pgvector Top-K 召回
# ──────────────────────────────────────────────────────────────────

async def _recall_user_history_handler(args: dict, ctx: ToolCtx) -> str:
    """按 query 向量召回用户的「历史面试分析 / 简历分析」Top-K 块。

    SQL 与 counselor_agent.recall_relevant 一致（仅去掉外层参数化，改从 ctx 取）。
    LLM 自主决定「用户提到具体历史小细节但 system prompt 未覆盖」时调用。
    """
    log = (ctx or {}).get("logger", logger)
    db: AsyncSession = (ctx or {}).get("db")
    user_id: int = (ctx or {}).get("user_id")
    if db is None or user_id is None:
        return "（上下文不可用，无法执行历史分析召回）"

    query = (args.get("query") or "").strip()
    if not query:
        return "（未提供 query，未触发历史分析召回）"
    top_k = int(args.get("top_k") or 3)
    top_k = max(1, min(8, top_k))

    try:
        q_vec = await embed_for_query(truncate_to_token_limit(query))
    except Exception as e:
        log.error(f"[tool_registry] embed_for_query 失败: {e!r}")
        return "（向量检索初始化失败）"

    qvec_str = "[" + ",".join(f"{v:.6f}" for v in q_vec) + "]"
    sql = text("""
        SELECT id, source_type, source_id, chunk_index, chunk_title, content, meta,
               1 - (embedding <=> CAST(:qvec AS vector)) AS similarity
        FROM user_analysis_embeddings
        WHERE user_id = :uid
        ORDER BY embedding <=> CAST(:qvec AS vector)
        LIMIT :k
    """)
    rows: list[dict] = []
    # 可选按 source_type 白名单过滤（防止 SQL 注入：仅放行已知 source_type）
    allowed_source_types = {
        "interview_summary", "interview_section", "interview_sections_bulk",
        "resume_analysis", "project_memory", "live_interview",
    }
    requested_src = args.get("source_types") or []
    if not isinstance(requested_src, list):
        requested_src = []
    src_filter: list[str] = [s for s in requested_src if isinstance(s, str) and s in allowed_source_types]

    try:
        if src_filter:
            sql = text("""
                SELECT id, source_type, source_id, chunk_index, chunk_title, content, meta,
                       1 - (embedding <=> CAST(:qvec AS vector)) AS similarity
                FROM user_analysis_embeddings
                WHERE user_id = :uid AND source_type = ANY(:src)
                ORDER BY embedding <=> CAST(:qvec AS vector)
                LIMIT :k
            """)
            params = {"qvec": qvec_str, "uid": user_id, "k": top_k, "src": src_filter}
        else:
            sql = text("""
                SELECT id, source_type, source_id, chunk_index, chunk_title, content, meta,
                       1 - (embedding <=> CAST(:qvec AS vector)) AS similarity
                FROM user_analysis_embeddings
                WHERE user_id = :uid
                ORDER BY embedding <=> CAST(:qvec AS vector)
                LIMIT :k
            """)
            params = {"qvec": qvec_str, "uid": user_id, "k": top_k}

        for r in await db.execute(sql, params):
            sim = float(r[7])
            if sim < 0.35:
                continue
            rows.append({
                "similarity": sim,
                "source_type": r[1],
                "source_id": r[2],
                "chunk_index": r[3],
                "chunk_title": r[4],
                "content": r[5] or "",
            })
    except Exception as e:
        log.error(f"[tool_registry] pgvector 召回失败: {e!r}")
        return "（数据库召回失败）"

    if not rows:
        return "（未找到与该 query 相关的历史分析）"

    lines: list[str] = []
    for i, c in enumerate(rows, 1):
        lines.append(
            f"{i}. [similarity={c['similarity']:.2f}] "
            f"{c['source_type']}#{c['source_id']}#{c['chunk_index']} - {c['chunk_title']}\n"
            f"   内容：{c['content'][:500]}"
        )
    return "\n\n".join(lines)


RECALL_USER_HISTORY = ToolSpec(
    name="recall_user_history",
    description=(
        "按关键词向量召回候选人此前的「面试分析 / 简历分析 / 项目记忆」片段，"
        "用于回溯细节（例如「我说过的那个 Redis 缓存方案」「我某次面试里 offer 概率」「我优化过的某个项目」）。"
        "当你需要某条具体历史记录里的小细节，但用户上下文未给出时调用本工具。"
        "可用 source_types 圈定类型（面试：[\"interview_summary\", \"live_interview\"]；简历：[\"resume_analysis\"]；"
        "项目：[\"project_memory\"]），不传则跨所有类型召回。"
    ),
    parameters={
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "本次要查找的具体细节（中文关键词，不必完整问句）",
            },
            "top_k": {
                "type": "integer",
                "description": "返回块数，默认 3，上限 8",
                "minimum": 1,
                "maximum": 8,
                "default": 3,
            },
            "source_types": {
                "type": "array",
                "items": {
                    "type": "string",
                    "enum": [
                        "interview_summary",
                        "interview_section",
                        "interview_sections_bulk",
                        "resume_analysis",
                        "project_memory",
                        "live_interview",
                    ],
                },
                "description": (
                    "可选，过滤 source_type。"
                    "面试分析用 [\"interview_summary\", \"live_interview\", \"interview_sections_bulk\"], "
                    "简历用 [\"resume_analysis\"], 项目用 [\"project_memory\"], "
                    "不传则跨全部类型（默认）"
                ),
            },
        },
        "required": ["query"],
    },
    handler=_recall_user_history_handler,
)


# ──────────────────────────────────────────────────────────────────
# 内置 Tool 3: query_match_rate —— 调 generate_match_rate_via_llm
# ──────────────────────────────────────────────────────────────────

async def _query_match_rate_handler(args: dict, ctx: ToolCtx) -> str:
    """包装 generate_match_rate_via_llm：算 0-100 整数 + 简评。

    LLM 根据用户问句中提到的「目标公司 / 目标岗位 / 目标职级」调本工具。
    """
    log = (ctx or {}).get("logger", logger)
    db: AsyncSession = (ctx or {}).get("db")
    user_id: int = (ctx or {}).get("user_id")
    if db is None or user_id is None:
        return "（上下文不可用，无法计算匹配度）"

    target_company = (args.get("target_company") or "").strip()
    target_role = (args.get("target_role") or "").strip()
    target_grade = (args.get("target_grade") or "").strip()
    if not target_company:
        return "（未提供 target_company，无法计算匹配度。请根据用户输入解析公司名后再调用。）"

    # lazy import 避免 tool_registry ↔ counselor_agent 循环
    from app.services.counselor_agent import fetch_user_profile
    try:
        profile = await fetch_user_profile(db, user_id)
    except Exception as e:
        log.warning(f"[tool_registry] fetch_user_profile 失败: {e!r}")
        return "（用户画像读取失败）"

    profile_payload = {
        "current": {
            "experience_years": profile.get("experience_years"),
            "role_name": profile.get("role_name"),
            "company_name": profile.get("company_name"),
            "school": profile.get("school"),
            "degree": profile.get("degree"),
            "age": profile.get("age"),
            "job_status": profile.get("job_status"),
            "salary_min": None,
            "salary_max": None,
        },
        "target": {
            "target_company": target_company,
            "target_role": target_role,
            "target_grade": target_grade,
            "target_salary_min": None,
            "target_salary_max": None,
        },
    }

    try:
        # lazy import 避免 tool_registry ↔ utils/llm 循环
        from app.utils.llm import generate_match_rate_via_llm as _match_rate
        rate = await _match_rate(profile_payload)
    except Exception as e:
        log.warning(f"[tool_registry] generate_match_rate_via_llm 失败: {e!r}")
        return "（匹配度评估失败）"

    if rate is None:
        return "（匹配度评估返回为空）"
    return (
        f"匹配度评分：{rate}/100"
        f"（基于「{target_company} · {target_role or '未指定岗位'} · {target_grade or '未指定职级'}」）"
    )


QUERY_MATCH_RATE = ToolSpec(
    name="query_match_rate",
    description=(
        "快速评估候选人与目标公司 / 岗位 / 职级的整体匹配度（0-100）。"
        "当用户问「我跟 XX 公司匹配度怎么样」「我冲 P7 有戏吗」「我的简历够进腾讯吗」时调用。"
        "需要 LLM 先根据上下文推断 target_company / target_role / target_grade 再调用。"
    ),
    parameters={
        "type": "object",
        "properties": {
            "target_company": {
                "type": "string",
                "description": "目标公司名，如「字节跳动」「腾讯」（必填）",
            },
            "target_role": {
                "type": "string",
                "description": "目标岗位名，如「后端工程师」「数据分析师」，可为空",
            },
            "target_grade": {
                "type": "string",
                "description": "目标职级，如「P7」「高级」，可为空",
            },
        },
        "required": ["target_company"],
    },
    handler=_query_match_rate_handler,
)


# ──────────────────────────────────────────────────────────────────
# Registry 入口
# ──────────────────────────────────────────────────────────────────

DEFAULT_TOOLS: tuple[ToolSpec, ...] = (WEB_SEARCH, RECALL_USER_HISTORY, QUERY_MATCH_RATE)
_INDEX: dict[str, ToolSpec] = {t.name: t for t in DEFAULT_TOOLS}


def all_tools() -> list[ToolSpec]:
    """默认可用工具的列表（按 DEFAULT_TOOLS 顺序）。

    调用方可以按场景裁剪：
        selected = [t for t in all_tools() if t.name in {"web_search"}]
    """
    return list(DEFAULT_TOOLS)


def to_openai_tools(tools: list[ToolSpec]) -> list[dict]:
    """ToolSpec 列表 → OpenAI-compatible function schema 列表。"""
    return [t.to_openai() for t in tools]


async def dispatch_tool(name: str, args: dict, ctx: ToolCtx) -> tuple[str, str]:
    """异步派发工具调用。

    返回 (result_text, status):
      - ("…", "ok")    工具正常返回
      - ("…", "error") 工具抛错或未注册（result 中给出人类可读的降级描述）
    """
    log = (ctx or {}).get("logger", logger)
    spec = _INDEX.get(name)
    if spec is None:
        log.warning(f"[tool_registry] 未注册 tool: {name}")
        return f"（未注册工具 {name}）", "error"

    t0 = time.monotonic()
    try:
        result = await spec.handler(args or {}, ctx or {})
    except Exception as e:
        elapsed_ms = int((time.monotonic() - t0) * 1000)
        log.error(f"[tool_registry] {name} handler 异常 after {elapsed_ms}ms: {e!r}")
        return f"（{name} 执行失败：{e!r}）", "error"
    elapsed_ms = int((time.monotonic() - t0) * 1000)
    log.info(f"[tool_registry] {name} returned {len(result or '')} chars in {elapsed_ms}ms")
    return result or "", "ok"
