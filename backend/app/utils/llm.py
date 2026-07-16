import requests
import logging
import asyncio
import json
import re
import time
from typing import Dict, Any, AsyncIterator, Awaitable, Callable, Optional, List
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from app.config import settings

logger = logging.getLogger(__name__)


def _build_resilient_session() -> requests.Session:
    """构造一个能扛瞬时 SSL / 连接抖动的 requests Session。

    现象：DeepSeek 网关偶发在 TLS 握手或流式首包时返回 SSLEOFError
    ("UNEXPECTED_EOF_WHILE_READING")，单次直连 100% 失败。
    解决：自动重试 SSL/连接类错误 + 指数退避，最多 4 次。
    """
    session = requests.Session()
    retries = Retry(
        total=4,
        connect=4,
        read=2,
        status=2,
        backoff_factor=0.8,
        backoff_jitter=0.5,
        status_forcelist=(429, 500, 502, 503, 504, 529),
        allowed_methods=frozenset(["POST"]),
        raise_on_status=False,
        respect_retry_after_header=True,
    )
    adapter = HTTPAdapter(max_retries=retries, pool_maxsize=10)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    return session


_RESILIENT_SESSION = _build_resilient_session()

def call_llm_sync(payload: dict) -> dict:
    url = f"{settings.DEEPSEEK_BASE_URL}/chat/completions"
    headers = {
        "Authorization": f"Bearer {settings.DEEPSEEK_API_KEY}",
        "Content-Type": "application/json"
    }
    # 120s: long transcripts (e.g. 89 segments) can take well over 30s for
    # reasoning models to finish; 30s caused "Read timed out" in sectionize.
    response = _RESILIENT_SESSION.post(url, headers=headers, json=payload, timeout=120.0)
    response.raise_for_status()
    return response.json()


def _strip_codeblock(text: str) -> str:
    """Strip fences so json.loads can parse the body. Two kinds of fences show
    up in LLM output:
      1) <think>...</think>  — DeepSeek reasoning model (and most reasoning models) prefix
         their answer with a chain-of-thought block. We need to drop that
         block before looking for the JSON body.
      2) ```json ... ```     — model wraps JSON in a code fence.
    """
    cleaned = text.strip()
    # 1) Reasoning blocks: greedy-strip all <think>...</think> regions
    cleaned = re.sub(r"<think>.*?</think>", "", cleaned, flags=re.DOTALL)
    cleaned = cleaned.strip()
    # 2) Code fences: try to match ```json ... ``` or ``` ... ```
    fence_match = re.search(r"^```(?:json)?\s*\n(.*?)\n```\s*$", cleaned, flags=re.DOTALL)
    if fence_match:
        cleaned = fence_match.group(1)
    else:
        # Fallback: drop a single leading ``` line and any trailing backticks
        if cleaned.startswith("```"):
            lines = cleaned.split("\n")
            if lines and (lines[0].startswith("```json") or lines[0].startswith("```")):
                cleaned = "\n".join(lines[1:])
        cleaned = cleaned.rstrip("`").strip()
    return cleaned


def _repair_llm_json(text: str) -> str:
    """尝试修复 LLM 返回的常见 JSON 格式错误。

    DeepSeek reasoning model 在输出大型 JSON 时偶发下列问题，本函数按优先级尝试修复：
      1. 尾逗号（"key": value, }  →  "key": value }）
      2. 字符串值中含未转义换行符
      3. 缺失逗号（相邻属性间漏了逗号）
      4. 单引号替代双引号

    返回值是修复后的文本字符串。如果修复失败，返回原文本。
    """
    repaired = text.strip()

    # ── 策略1: 删除尾逗号 ──
    # "value", } → "value" }   /   "value", ] → "value" ]
    repaired = re.sub(r',\s*([}\]])', r'\1', repaired)

    # ── 策略2: 修复 JSON 字符串内的未转义换行符（常见于 summary 字段） ──
    # 只在 JSON 字符串值内部（双引号之间）修复
    def _escape_newlines_in_strings(match: re.Match) -> str:
        """JSON 字符串值内的 raw 换行 → \\n"""
        full = match.group(0)
        key = match.group(1)
        # 只处理 "key": "value..." 中的 value 部分
        # 更简单的方式：正则匹配所有 JSON 字符串值，替换其中的控制字符
        return full

    # 匹配 "key": "value..." 模式，对 value 中的控制字符做转义
    def _fix_string_values(s: str) -> str:
        """在 JSON 字符串值内转义未转义的控制字符（\\n \\r \\t）。"""
        result = []
        i = 0
        in_string = False
        escape_next = False
        while i < len(s):
            ch = s[i]
            if escape_next:
                result.append(ch)
                escape_next = False
                i += 1
                continue
            if ch == '\\':
                result.append(ch)
                escape_next = True
                i += 1
                continue
            if ch == '"':
                in_string = not in_string
                result.append(ch)
                i += 1
                continue
            if in_string:
                # 在 JSON 字符串值内的裸控制字符需要转义
                if ch == '\n':
                    result.append('\\n')
                elif ch == '\r':
                    result.append('\\r')
                elif ch == '\t':
                    result.append('\\t')
                elif ord(ch) < 0x20:
                    result.append(f'\\u{ord(ch):04x}')
                else:
                    result.append(ch)
            else:
                result.append(ch)
            i += 1
        return ''.join(result)

    repaired = _fix_string_values(repaired)

    # ── 策略3: 尝试用 json.loads 的错误位置信息修复缺失逗号 ──
    # 如果仍有 "Expecting ',' delimiter" 错误，在错误位置尝试插入逗号
    try:
        json.loads(repaired)
        return repaired
    except json.JSONDecodeError as e:
        # 如果错误是 "Expecting ',' delimiter"，尝试在出错位置插入逗号
        if "Expecting ','" in str(e) and e.pos > 0:
            # 在 pos 之前找合适位置插入逗号
            before = repaired[:e.pos]
            after = repaired[e.pos:]
            # 在错误位置之前插入逗号（但不要插在空白中间）
            insert_pos = e.pos
            # 向前找到最近的换行或非空白字符末尾
            while insert_pos > 0 and repaired[insert_pos - 1] in ' \t':
                insert_pos -= 1
            repaired = repaired[:insert_pos] + ',' + repaired[insert_pos:]
            # 清理可能的双逗号
            repaired = repaired.replace(',,', ',')

    return repaired


def _safe_json_parse(text: str, log_label: str = "") -> dict | list | None:
    """安全解析 LLM 返回的 JSON 文本，带修复和日志。

    返回值：
        解析成功的 dict/list；所有修复均失败时返回 None
    """
    # 尝试1: 直接解析
    try:
        return json.loads(text)
    except json.JSONDecodeError as e1:
        logger.warning(
            f"[{log_label}] 直接 JSON 解析失败: {e1}。尝试修复..."
        )

    # 尝试2: 修复后解析
    try:
        repaired = _repair_llm_json(text)
        result = json.loads(repaired)
        logger.info(f"[{log_label}] JSON 修复成功")
        return result
    except json.JSONDecodeError as e2:
        logger.error(
            f"[{log_label}] JSON 修复后仍解析失败: {e2}\n"
            f"  原始内容(前500字符): {text[:500]!r}\n"
            f"  原始内容(后200字符): {text[-200:]!r}"
        )

    return None


# ============================================================================
# Tool Calling 增强：在 call_llm_sync / call_llm_stream_chunks 基础上
# 增加 LLM 自主 tool_calls 决策的循环。协议遵循 OpenAI-compatible tool_calls 规范。
# 设计要点：
#   - payload 不被原地修改；tools / tool_choice 在副本上挂载
#   - 每轮把 assistant message 完整追加到 messages，再追加每个 tool result
#     （role="tool", tool_call_id= 跟 tool_call.id 对齐）
#   - max_iters 用尽时强制 tool_choice="none" 收尾，避免死循环
# ============================================================================

async def call_llm_sync_with_tools(
    payload: dict,
    tools: list,
    ctx: Optional[dict] = None,
    max_iters: int = 4,
) -> dict:
    """同步 LLM 调用 + tool calling 循环。

    Args:
        payload:    标准 chat/completions payload（不会被原地修改）
        tools:      List[ToolSpec]；空列表时退化为普通 call_llm_sync
        ctx:        传给 tool handler 的运行时上下文（db / user_id / logger）
        max_iters:  最多触发几轮工具；达到后强制 tool_choice="none" 收尾

    Returns:
        最终响应 dict（兼容 OpenAI 格式），正常情况 choices[0].message.content 非空。
        调用方用法与原有 call_llm_sync 兼容：直接 res["choices"][0]["message"]["content"]。
    """
    # lazy import: 避免 tool_registry ↔ utils/llm 循环
    from app.services.tool_registry import to_openai_tools, dispatch_tool

    if not tools:
        return await asyncio.to_thread(call_llm_sync, payload)

    cur_payload: dict = dict(payload)
    cur_payload["tools"] = to_openai_tools(tools)
    cur_payload["tool_choice"] = "auto"
    messages: list = list(cur_payload.get("messages") or [])

    log = (ctx or {}).get("logger", logger) if isinstance(ctx, dict) else logger
    last_resp: Optional[dict] = None

    for i in range(max_iters):
        cur_payload["messages"] = messages
        resp = await asyncio.to_thread(call_llm_sync, cur_payload)
        last_resp = resp
        msg = resp["choices"][0]["message"]
        tool_calls = msg.get("tool_calls") or []

        if not tool_calls:
            log.info(f"[call_llm_sync_with_tools] iter={i} no tool_calls, done")
            return resp

        # 跑本轮所有 tool_calls，按 OpenAI 协议：assistant msg 先入，再逐个 tool result
        messages.append(msg)
        for tc in tool_calls:
            fn = tc.get("function", {}) or {}
            name = fn.get("name", "")
            try:
                args = json.loads(fn.get("arguments") or "{}")
            except json.JSONDecodeError:
                args = {}
            log.info(
                f"[call_llm_sync_with_tools] iter={i} call tool={name} "
                f"args_keys={list(args.keys()) if isinstance(args, dict) else []}"
            )
            result, _status = await dispatch_tool(name, args, ctx or {})
            messages.append({
                "role": "tool",
                "tool_call_id": tc.get("id"),
                "content": result,
            })

    # 兜底:达到 max_iters 强制收尾，确保调用方仍能拿到 content
    log.warning(
        f"[call_llm_sync_with_tools] 达到 max_iters={max_iters}, 强制收尾"
    )
    cur_payload["messages"] = messages
    cur_payload["tool_choice"] = "none"
    return await asyncio.to_thread(call_llm_sync, cur_payload)


# ── 流式 Tool Calling ─────────────────────────────────────────────
# 流式下 tool_calls 是 delta 累积：同一 index 在多轮 chunk 里把
# `function.arguments` 一块一块拼起来。本文件 _stream_one_with_tools 做
# chunk 解析 + retry；call_llm_stream_with_tokens 做主循环编排。

async def _stream_one_with_tools(
    stream_payload: dict,
    log: logging.Logger,
):
    """执行一次流式 LLM 调用（含 tool_calls 解析 + 指数退避重试），产出统一事件：

    yield 字典结构：
      - {"kind": "content",       "piece": str}
      - {"kind": "tool_call_delta","index": int, "delta": dict}
      - {"kind": "finish",        "reason": str | None}

    解析依据：
      - content 来自 delta.content
      - tool_calls 来自 delta.tool_calls（list，每个元素含 index、function.arguments 增量）
      - finish 来自 choices[0].finish_reason
    """
    url = f"{settings.DEEPSEEK_BASE_URL}/chat/completions"
    headers = {
        "Authorization": f"Bearer {settings.DEEPSEEK_API_KEY}",
        "Content-Type": "application/json",
    }
    retryable_status = {429, 500, 502, 503, 504, 529}
    max_attempts = 4

    def _do_request():
        return requests.post(
            url, headers=headers, json=stream_payload, timeout=300.0,
            proxies={"http": None, "https": None}, stream=True,
        )

    last_exc: Optional[Exception] = None
    for attempt in range(max_attempts):
        try:
            resp = await asyncio.to_thread(_do_request)
            if resp.status_code in retryable_status:
                raise requests.HTTPError(
                    f"{resp.status_code} retryable from DeepSeek upstream",
                    response=resp,
                )
            resp.raise_for_status()
            for raw in resp.iter_lines(decode_unicode=True):
                if not raw:
                    continue
                line = raw.strip()
                if not line.startswith("data:"):
                    continue
                data = line[len("data:"):].strip()
                if data == "[DONE]":
                    return
                try:
                    chunk = json.loads(data)
                except json.JSONDecodeError:
                    continue
                try:
                    choice = chunk["choices"][0]
                    delta = choice.get("delta") or {}
                    # reasoning piece
                    reasoning_piece = delta.get("reasoning_content")
                    if reasoning_piece:
                        yield {"kind": "reasoning", "piece": reasoning_piece}
                    # content piece
                    piece = delta.get("content")
                    if piece:
                        yield {"kind": "content", "piece": piece}
                    # tool_calls 增量（OpenAI 流式协议：每个 chunk 可能给同一 index 的不同字段）
                    for tc in (delta.get("tool_calls") or []):
                        yield {
                            "kind": "tool_call_delta",
                            "index": tc.get("index", 0),
                            "delta": tc,
                        }
                    # finish
                    finish = choice.get("finish_reason")
                    if finish:
                        yield {"kind": "finish", "reason": finish}
                        return
                except (KeyError, IndexError, TypeError):
                    continue
            return
        except requests.HTTPError as e:
            last_exc = e
            status_code = e.response.status_code if e.response is not None else None
            if status_code not in retryable_status or attempt == max_attempts - 1:
                raise
            wait = 1.5 * (2 ** attempt)
            log.warning(
                f"[stream_with_tools] upstream {status_code}, "
                f"retry {attempt + 1}/{max_attempts - 1} after {wait:.1f}s"
            )
            await asyncio.sleep(wait)
        except (requests.ConnectionError, requests.Timeout) as e:
            last_exc = e
            if attempt == max_attempts - 1:
                raise
            wait = 1.5 * (2 ** attempt)
            log.warning(
                f"[stream_with_tools] {type(e).__name__}, "
                f"retry {attempt + 1}/{max_attempts - 1} after {wait:.1f}s"
            )
            await asyncio.sleep(wait)
    raise last_exc if last_exc else RuntimeError("stream_with_tools exhausted retries")


async def call_llm_stream_with_tokens(
    payload: dict,
    tools: list,
    ctx: Optional[dict] = None,
    max_iters: int = 4,
    on_tool_event: Optional[Callable[[str, dict], Awaitable[None]]] = None,
    on_reasoning_event: Optional[Callable[[str], Awaitable[None]]] = None,
) -> AsyncIterator[str]:
    """流式 LLM + tool calling 循环，逐 chunk yield content 文本片段。

    工具调用期间不 yield content；调用 on_tool_event("start"/"end", info) 给上层
    hook（典型用途：counselor_agent.stream_chat 在 SSE 协议里转发 tool_call 事件）。

    Args:
        payload:        标准 chat/completions payload（不原地修改）
        tools:          List[ToolSpec]；空时退化为 call_llm_stream_chunks
        ctx:            tool handler 运行时上下文
        max_iters:      最多触发几轮工具
        on_tool_event:  async 钩子，签名 async def hook(phase: str, info: dict) -> None
                        phase ∈ {"start", "end"}；info 含 name / arguments / call_id / result_chars 等

    Yields:
        str:  LLM 生成的纯文本片段（content pieces）

    Returns:
        None（async generator 自然结束）
    """
    from app.services.tool_registry import to_openai_tools, dispatch_tool

    log = (ctx or {}).get("logger", logger) if isinstance(ctx, dict) else logger

    async def _emit(phase: str, info: dict):
        if on_tool_event is None:
            return
        try:
            await on_tool_event(phase, info)
        except Exception as e:
            log.warning(f"[call_llm_stream_with_tokens] on_tool_event({phase}) 异常: {e!r}")

    if not tools:
        async for piece in call_llm_stream_chunks(payload):
            yield piece
        return

    cur_payload: dict = dict(payload)
    cur_payload["tools"] = to_openai_tools(tools)
    cur_payload["tool_choice"] = "auto"
    stream_payload: dict = {**cur_payload, "stream": True}
    messages: list = list(cur_payload.get("messages") or [])

    for i in range(max_iters):
        stream_payload["messages"] = messages
        # 本轮累积
        content_parts: list[str] = []
        streamed_calls: dict[int, dict] = {}  # index -> {id, name, args_str}
        finish_reason: Optional[str] = None

        try:
            async for event in _stream_one_with_tools(stream_payload, log):
                kind = event["kind"]
                if kind == "content":
                    content_parts.append(event["piece"])
                    yield event["piece"]
                elif kind == "reasoning":
                    if on_reasoning_event:
                        try:
                            await on_reasoning_event(event["piece"])
                        except Exception as e:
                            log.warning(f"[call_llm_stream_with_tokens] on_reasoning_event 异常: {e!r}")
                elif kind == "tool_call_delta":
                    idx = event["index"]
                    delta = event["delta"]
                    slot = streamed_calls.setdefault(idx, {"id": None, "name": None, "args_str": ""})
                    if "id" in delta and delta["id"]:
                        slot["id"] = delta["id"]
                    fn = delta.get("function", {}) or {}
                    if "name" in fn and fn["name"]:
                        slot["name"] = fn["name"]
                    if "arguments" in fn and fn["arguments"] is not None:
                        slot["args_str"] += fn["arguments"]
                elif kind == "finish":
                    finish_reason = event["reason"]
        except Exception as e:
            # 让上层（如 counselor_agent）走已有的 CancelledError / 异常路径
            log.error(f"[call_llm_stream_with_tokens] iter={i} 流式出错: {e!r}")
            raise

        if not streamed_calls:
            # 工具未触发，正常完成
            log.info(f"[call_llm_stream_with_tokens] iter={i} no tool_calls, done")
            return

        # ── 跑所有 tool_calls ──
        # 1) 构造 assistant message（与 OpenAI 协议一致：tool_calls 数组）
        assistant_tool_calls = []
        tool_results = []  # 与上述 idx 一一对应
        for idx in sorted(streamed_calls.keys()):
            slot = streamed_calls[idx]
            name = slot["name"] or ""
            try:
                args = json.loads(slot["args_str"] or "{}")
            except json.JSONDecodeError:
                args = {}
            call_id = slot["id"] or f"call_{i}_{idx}"

            log.info(
                f"[call_llm_stream_with_tokens] iter={i} call tool={name} "
                f"args_keys={list(args.keys()) if isinstance(args, dict) else []}"
            )
            await _emit("start", {"name": name, "arguments": args, "call_id": call_id, "iter": i})
            t0 = time.monotonic()
            result, status = await dispatch_tool(name, args, ctx or {})
            elapsed_ms = int((time.monotonic() - t0) * 1000)
            await _emit("end", {
                "name": name,
                "call_id": call_id,
                "iter": i,
                "success": status == "ok",
                "result_chars": len(result or ""),
                "elapsed_ms": elapsed_ms,
                "result": result,
            })

            assistant_tool_calls.append({
                "id": call_id,
                "type": "function",
                "function": {"name": name, "arguments": slot["args_str"] or "{}"},
            })
            tool_results.append({"id": call_id, "content": result})

        # 2) 追加 assistant + tool messages，下一轮 LLM 看得到 tool 结果
        assistant_msg = {
            "role": "assistant",
            "content": "".join(content_parts) if content_parts else None,
            "tool_calls": assistant_tool_calls,
        }
        # 移除 None 字段避免 protocol 报「must be string」
        cleaned_assistant = {k: v for k, v in assistant_msg.items() if v is not None}
        messages.append(cleaned_assistant)
        for tr in tool_results:
            messages.append({"role": "tool", "tool_call_id": tr["id"], "content": tr["content"]})

    # 兜底：max_iters 用尽强制收尾（关闭 tool 选择，纯文本回答）
    log.warning(f"[call_llm_stream_with_tokens] 达到 max_iters={max_iters}, 强制收尾")
    stream_payload["messages"] = messages
    stream_payload["tool_choice"] = "none"
    async for piece in _stream_one_with_tools(stream_payload, log):
        if piece["kind"] == "content":
            yield piece["piece"]


# ── 通用 LLM 调用 wrapper ────────────────────────────────────────
# 把「带 tool calling」与「不带 tool calling」两条路径统一到一个入口，
# 6 个 JSON 输出场景（面试分析 5 个 + 简历分析 2 个 + 项目提取）都通过它调 LLM。
#
# 设计要点：
#   - 失败兜底：tool calling 任一步抛错，由 tool_registry 内部 try/except
#     降级为「联网检索失败，已降级为不检索」等占位文本，主流程不会断。
#   - 返回 dict：调用方按 OpenAI 兼容格式 res["choices"][0]["message"]["content"]
#     读取，流式模式由本函数内部消费并拼接。
#   - ctx 默认 None：ctx=None 时 recall_user_history / query_match_rate 会拿到
#     「上下文不可用」降级，仅 web_search 仍可工作——刚好满足「联网检索失败
#     也没关系」的场景。
async def _run_with_optional_tools(
    payload: dict,
    enable_network: bool = True,
    *,
    sync: bool = False,
    timeout: float = 300.0,
    ctx: Optional[dict] = None,
    max_iters: int = 4,
) -> dict:
    """通用 LLM 调用 wrapper：可选启用 tool calling（web_search 等）。

    Args:
        payload:    标准 chat/completions payload（不被原地修改）
        enable_network: True 时挂载 tool_registry.all_tools()；False 时退化
                      到纯 LLM 调用（与改造前等价）
        sync:       True → 同步模式（call_llm_sync / call_llm_sync_with_tools）
                    False → 流式模式（call_llm_stream / call_llm_stream_with_tokens），
                    流式模式下本函数内部消费所有 piece 并聚合成 dict
        timeout:    仅 sync=False 且 enable_network=False 时传给 call_llm_stream；
                    其他路径由内部自适应超时（300s）
        ctx:        tool handler 运行时上下文；None 时仅 web_search 可用
        max_iters:  tool calling 最大迭代轮数

    Returns:
        OpenAI 兼容 dict：`{"choices": [{"message": {"content": str}}]}`
    """
    # lazy import：避免 utils/llm ↔ tool_registry 形成循环 import
    from app.services.tool_registry import all_tools as _all_tools

    if not enable_network:
        if sync:
            return await asyncio.to_thread(call_llm_sync, payload)
        return await asyncio.to_thread(call_llm_stream, payload, timeout)

    if sync:
        return await call_llm_sync_with_tools(
            payload, _all_tools(), ctx=ctx, max_iters=max_iters,
        )

    # 流式 + tool calling：消费所有 content piece，tool_call 事件丢弃
    # （分析场景不需要把工具事件透传给前端；tool 内部已运行并把结果塞回 messages）
    text_parts: list[str] = []
    async for piece in call_llm_stream_with_tokens(
        payload, _all_tools(), ctx=ctx, max_iters=max_iters,
    ):
        text_parts.append(piece)
    return {"choices": [{"message": {"content": "".join(text_parts)}}]}


async def analyze_interview_dialogue(
    dialogue_text: str,
    profile_data: Optional[dict] = None,
    job_description: Optional[str] = None,
    existing_projects: Optional[list[dict]] = None,
    enable_network: bool = True
) -> Dict[str, Any]:
    """
    Calls DeepSeek reasoning model API to analyze the interview dialogue and return evaluation results in JSON.

    P0 优化（#3 拆分 prompt）: mentioned_projects 提取已拆分为独立函数
    `extract_mentioned_projects()`。本函数不再返回 mentioned_projects 字段，
    prompt 同步瘦身以降低 reasoning 耗时。`existing_projects` 参数保留向后兼容，
    当前未使用。
    """
    system_prompt = (
        "你是一个专业的 AI 面试教练。你需要根据候选人的面试对话内容进行深度评估。\n"
        "如果提供了候选人的职业画像（工作经验、岗位名称、目标公司、目标职级等），请结合该画像的期望要求进行评估。\n"
        "如果提供了目标岗位的岗位详情（JD / Job Description），请着重结合该岗位的技能、职责及期望，深入匹配并评估候选人的技术水平、项目契合度以及表达逻辑。\n"
        "联网工具（可选）：当对话中提及具体公司名、岗位名、行业趋势或最新技术话题，且你需要参考真实行业信息来更准确地评估时，可以调用 `web_search(query, count=5)` 工具实时检索互联网公开信息（公司背景、岗位要求、行业资讯、面试经验、最新技术趋势、薪资参考等）。仅在对话上下文不足时使用；联网工具返回失败时直接基于已有对话继续评估即可，不要因为工具失败而中断。\n"
        "你必须以 JSON 格式返回评估结果，无需 any Markdown 标记或其它多余的前后导言，只返回纯 JSON 对象字符串。\n"
        "JSON 结构必须严格符合以下属性格式：\n"
        "\n"
        "{\n"
        "  \"ipi_score\": 75, // 综合素质评分（0-100之间的整数）\n"
        "  \"offer_probability\": 60, // 拿到Offer的概率百分比（0-100之间的整数）\n"
        "  \"summary_strengths\": [\"优势1\", \"优势2\"], // 优势列表（2个）\n"
        "  \"summary_weaknesses\": [\"不足1\", \"不足2\"], // 不足列表（2个）\n"
        "  \"summary_suggestions\": [\"改进建议1\", \"改进建议2\"], // 建议列表（2个）\n"
        "  \"executive_summary\": \"一段简短的综合性总结评价...\",\n"
        "  \"scores\": {\n"
        "    \"expression\": 80, // 细节深度评分（0-100之间的整数）\n"
        "    \"logic\": 85, // 逻辑自洽评分（0-100之间的整数）\n"
        "    \"project_depth\": 70, // 业务理解评分（0-100之间的整数）\n"
        "    \"ownership\": 75, // 数据指标评分（0-100之间的整数）\n"
        "    \"system_design\": 65 // 技术广度评分（0-100之间的整数）\n"
        "  },\n"
        "  \"max_lose_points\": [\n"
        "    { \"rank\": 1, \"label\": \"失分点标题，如：选型依据不足\", \"tag\": \"高风险\", \"desc\": \"失分具体描述，如：缺少问题背景和选型对比，无法体现技术决策能力\" },\n"
        "    { \"rank\": 2, \"label\": \"失分点标题，如：没有 Trade-off 分析\", \"tag\": \"中风险\", \"desc\": \"失分具体描述，如：回答较表面，缺乏权衡思考和方案对比\" },\n"
        "    { \"rank\": 3, \"label\": \"失分点标题，如：项目贡献模糊\", \"tag\": \"中风险\", \"desc\": \"失分具体描述，如：未突出个人贡献和负责的核心模块\" }\n"
        "  ], // 最大失分点 TOP 3（固定3项，按风险等级从高到低排序，tag只能为'高风险'或'中风险'）\n"
        "  \"interviewer_perspective\": [\n"
        "    { \"label\": \"考察技术话题，如：Redis 相关问题\", \"val\": \"验证的核心能力，如：验证缓存设计能力\" },\n"
        "    { \"label\": \"考察技术话题，如：一致性问题\", \"val\": \"验证的核心能力，如：验证分布式系统架构能力\" },\n"
        "    { \"label\": \"考察技术话题，如：项目真实度\", \"val\": \"验证的核心能力，如：验证真实项目经验\" }\n"
        "  ], // 面试官视角：真正验证什么（3-4项，结合对话中的考点提问）\n"
        "  \"question_deconstruction\": [\n"
        "    { \"stage\": \"第 1 关 · 基础引入\", \"title\": \"考点技术问题，如：为什么使用 Redis？\", \"desc\": \"考查目的细节描述\" },\n"
        "    { \"stage\": \"第 2 关 · 方案对比\", \"title\": \"考点技术问题，如：为什么不用本地缓存？\", \"desc\": \"考查目的细节描述\" }\n"
        "  ], // 问题拆解（3-4项，梳理面试官层层深入的提问关卡）\n"
        "  \"followup_paths\": [\n"
        "    { \"title\": \"阶段问题，如：Q1 自我介绍 · 引导切入\", \"desc\": \"具体的引导或追问描述\", \"tag\": \"良好\" },\n"
        "    { \"title\": \"阶段问题，如：Q3 Redis 选型 · 主动深挖\", \"desc\": \"具体的引导或追问描述\", \"tag\": \"风险\" }\n"
        "  ] // 追问路径（3-4项，tag只能是'良好'、'一般'或'风险'之一，真实呈现追问轨迹）\n"
        "}"
    )

    user_content = f"面试对话内容：\n{dialogue_text}\n"
    if profile_data:
        user_content += f"\n候选人画像：\n{json.dumps(profile_data, ensure_ascii=False)}\n"
    if job_description:
        user_content += f"\n岗位详情 (Job Description)：\n{job_description}\n"

    payload = {
        "model": settings.DEEPSEEK_MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content}
        ],
        "response_format": {"type": "json_object"}
    }
    
    try:
        # P0 优化(#2): 改用流式调用 call_llm_stream。
        # DeepSeek reasoning model 在大 JSON 输出场景下偶发网关断连(RemoteDisconnected),
        # 流式可以降低断连概率 + 内置指数退避重试。
        res_data = await _run_with_optional_tools(
            payload, enable_network, sync=False, timeout=180.0
        )
        content = res_data["choices"][0]["message"]["content"]
        content_clean = _strip_codeblock(content)
        parsed_data = _safe_json_parse(content_clean, log_label="dialogue")
        if parsed_data is None:
            logger.error("[dialogue] unable to parse DeepSeek response as JSON after repair")
            return {}
        return parsed_data
    except Exception as e:
        logger.error(f"Failed calling DeepSeek API: {str(e)}")

    return {}


async def generate_match_rate_via_llm(
    profile_payload: dict,
) -> int:
    """
    调用 DeepSeek 综合评估候选人与求职目标的匹配度，返回 0-100 整数。

    Args:
        profile_payload: 候选人当前画像 + 求职目标画像，结构如下：
            {
                "current": {
                    "experience_years": "3年", "role_name": "前端工程师",
                    "company_name": "字节跳动", "salary_min": 30000, "salary_max": 45000,
                    "school": "清华大学", "degree": "本科", "age": 26,
                    "job_status": "active",
                },
                "target": {
                    "target_company": "腾讯", "target_role": "高级前端工程师",
                    "target_grade": "P7", "target_salary_min": 50000, "target_salary_max": 70000,
                },
            }

    Returns:
        0-100 的整数。规则：
            - target_company 为空 → 直接返回 0（与 match_scorer.compute_match_rate 短路保持一致）
            - LLM 调用失败 / JSON 解析失败 → 返回 None（调用方决定 fallback）
    """
    target = profile_payload.get("target") or {}
    target_company = (target.get("target_company") or "").strip()
    if not target_company:
        # 与后端规则算法保持一致的短路：目标公司为空 → 0
        logger.info("[match_rate_llm] target_company is empty, short-circuit to 0")
        return 0

    system_prompt = (
        "你是一位资深的 AI 求职匹配度评估专家，"
        "擅长基于候选人的当前画像与求职目标，综合评估其跳槽/转岗的匹配度。\n"
        "你必须以 JSON 格式返回评估结果，不要返回 Markdown 或前后导言。\n"
        "\n"
        "## 评分维度（请综合考虑，不必逐项打分）\n"
        "1. **学校背景**：985/211/C9/双一流/海外名校显著加分；普通本科中性；无学校名轻度扣分。\n"
        "2. **学历**：博士 > 硕士 > 本科 > 专科 > 其他。\n"
        "3. **年龄**：与目标职级匹配度（如 28 岁冲 P7 略显年轻，40+ 申请 P5 偏保守）。\n"
        "4. **求职状态**：在职加分（说明市场价值仍在）；离职略减；应届/在校中性。\n"
        "5. **公司梯队跃迁**：跨级跳（跳 2 级以上）难度大扣分；平级/降级保守合理加分。\n"
        "6. **岗位相似度**：当前岗位与目标岗位领域一致（如都是前端）大幅加分；跨领域降分。\n"
        "7. **薪资涨幅预期**：目标薪资相对当前涨幅 15-30% 最佳；涨 50%+ 不现实扣分；几乎不涨动力不足。\n"
        "8. **经验年限 vs 目标职级**：经验足够支撑目标职级为最佳；差距过大或保守申请都应中性。\n"
        "\n"
        "## 输出格式\n"
        "严格返回以下 JSON 对象：\n"
        "{\n"
        '  "match_rate": 72,\n'
        '  "reason": "简短一句话说明主要扣加分原因（30-80字）"\n'
        "}\n"
        "\n"
        "## 关键约束\n"
        "1. match_rate 必须是 0-100 的整数。\n"
        "2. 即使各维度都很好，最高也不要超过 95；最低不要低于 5（除非画像极差）。\n"
        "3. 不要编造候选人没提供的字段。\n"
    )

    user_content = (
        "以下是候选人当前画像与求职目标，请综合评估匹配度：\n"
        f"{json.dumps(profile_payload, ensure_ascii=False, indent=2)}\n"
    )

    payload = {
        "model": settings.DEEPSEEK_MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ],
        "response_format": {"type": "json_object"},
        "temperature": 0.3,
        "max_tokens": 512,
    }

    try:
        res_data = await asyncio.to_thread(call_llm_sync, payload)
        content = res_data["choices"][0]["message"]["content"]
        content_clean = _strip_codeblock(content)
        parsed = _safe_json_parse(content_clean, log_label="match_rate_llm")
        if not isinstance(parsed, dict):
            logger.error("[match_rate_llm] DeepSeek returned non-dict JSON")
            return None
        rate = parsed.get("match_rate")
        if not isinstance(rate, (int, float)):
            logger.error(f"[match_rate_llm] invalid match_rate type: {type(rate).__name__}")
            return None
        rate_int = int(round(rate))
        rate_int = max(0, min(100, rate_int))
        logger.info(
            f"[match_rate_llm] rate={rate_int} reason={parsed.get('reason', '')[:60]!r}"
        )
        return rate_int
    except Exception as e:
        logger.error(f"[match_rate_llm] DeepSeek call failed: {e}")
        return None


async def extract_mentioned_projects(
    dialogue_text: str,
    existing_projects: Optional[list[dict]] = None,
    enable_network: bool = True
) -> list[dict]:
    """
    P0 优化(#3): 从面试对话中识别候选人讨论到的项目经历。

    与 analyze_interview_dialogue 拆分的好处:
      - 本函数 prompt 极轻(只输出项目提及列表),reasoning 耗时比主体评估少 50%+
      - 与 analyze_interview_dialogue 并发执行,端到端不增加任何时间
      - 失败/为空不影响主流程,主流程不会因项目识别失败而卡住

    Args:
        dialogue_text: 完整面试对话文本
        existing_projects: 用户已有的项目记忆 [{"id": int, "project_name": str, "category": str}, ...]
            LLM 在 mentioned_projects 中会直接填 matched_existing_id,供 mention_service 累加 mention_count。

    Returns:
        [{"project_name": str, "discussion_depth": int, "matched_existing_id": int|null}, ...]
        LLM 调用失败或无项目时返回空列表 []。
    """
    existing_projects = existing_projects or []
    system_prompt = (
        "你是一个专业的 AI 面试分析助手。你的任务是从一段面试对话中识别候选人具体讨论过的项目经历。\n"
        "\n"
        "识别标准（满足任一即算项目提及）：\n"
        "  - 候选人主动介绍自己做过/负责过的具体项目\n"
        "  - 面试官针对某个项目进行追问（技术细节、架构选型、指标等）\n"
        "  - 候选人在回答技术问题时引用具体项目案例\n"
        "\n"
        "以下情况不算项目提及：\n"
        "  - 泛泛而谈的技术讨论未关联具体项目（如「我们一般用 Redis 做缓存」）\n"
        "  - 假设性的场景题回答（如「如果让我设计...」）\n"
        "  - 纯理论/八股文回答未涉及具体项目\n"
        "\n"
        "联网工具（可选）：如果候选人提到的项目名你不确定是真实存在的产品/开源项目/业内项目，可以调用 `web_search(query, count=5)` 工具查证（避免把虚构项目当真实项目收录）；联网失败时直接基于对话文本判断即可。\n"
        "\n"
        "每个识别到的项目输出：\n"
        "  - project_name: 使用对话中实际提到的名称，最多 30 字\n"
        "  - discussion_depth: 0-100 整数，评估讨论深度\n"
        "  - matched_existing_id: 整数或 null\n"
        "      如果下方「候选人已有项目」列表中有项目名相似的，填对应 id；\n"
        "      如果没有，填 null。\n"
        "\n"
        "你必须返回严格符合以下结构的 JSON 对象（不要返回任何 Markdown 标记或其它前后导言）：\n"
        "{\n"
        '  "mentioned_projects": [\n'
        '    {"project_name": "项目名", "discussion_depth": 75, "matched_existing_id": 3}\n'
        "  ]\n"
        "}\n"
        "如果完全没有讨论任何具体项目，返回空数组。\n"
    )

    user_content = f"面试对话内容：\n{dialogue_text}\n"
    if existing_projects:
        user_content += (
            f"\n候选人已有项目记忆（matched_existing_id 从下列 id 中选取，无匹配填 null）：\n"
            f"{json.dumps(existing_projects, ensure_ascii=False)}\n"
        )

    payload = {
        "model": settings.DEEPSEEK_MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ],
        "response_format": {"type": "json_object"},
    }

    try:
        res_data = await _run_with_optional_tools(payload, enable_network)
        content = res_data["choices"][0]["message"]["content"]
        content_clean = _strip_codeblock(content)
        parsed = _safe_json_parse(content_clean, log_label="mentions")
        if parsed is None:
            logger.error("[mentions] unable to parse DeepSeek response as JSON after repair")
            return []
        items = parsed.get("mentioned_projects") or []
        # 防御性规整:只保留必要字段,matched_existing_id 必须 int 或 None
        cleaned: list[dict] = []
        for it in items:
            if not isinstance(it, dict):
                continue
            name = (it.get("project_name") or "").strip()
            if not name:
                continue
            depth = it.get("discussion_depth")
            if not isinstance(depth, (int, float)):
                depth = 50
            mid = it.get("matched_existing_id")
            if not isinstance(mid, int) or mid <= 0:
                mid = None
            cleaned.append({
                "project_name": name[:30],
                "discussion_depth": int(depth),
                "matched_existing_id": mid,
            })
        return cleaned
    except Exception as e:
        logger.error(f"[mentions] extract_mentioned_projects failed: {e}")
        return []


async def sectionize_transcript(
    segments: List[Dict[str, Any]],
    enable_network: bool = True,
) -> List[Dict[str, Any]]:
    """
    Use DeepSeek reasoning model to semantically split a transcript (list of ASR segments)
    into 3-8 topical sections like 「自我介绍」「项目深挖」「Redis 追问」.

    Input  segments: [{start_time, end_time, speaker, content}, ...]  (seconds)
    Output sections:  [{title, category, tag, start_time, end_time, summary}, ...]

    IMPORTANT contract: start_time / end_time in output MUST be picked from
    the input segment timestamps. The function enforces this by snapping any
    out-of-range value to the nearest known segment boundary, and discards
    sections that don't overlap any segment.

    enable_network: True 时允许 LLM 调用 web_search 了解候选人口中的具体公司/岗位背景，
    以便更准确地给段位打 tag（仅在对话出现明确公司/岗位名词时使用；默认开启）。
    """
    if not segments:
        return []

    # Build a compact dialogue list for the prompt
    dialogue_lines = []
    for s in segments:
        role = "面试官" if s.get("speaker") == "Interviewer" else "候选人"
        content = (s.get("content") or "").strip().replace("\n", " ")
        dialogue_lines.append(
            f"[{float(s['start_time']):.2f}, {float(s['end_time']):.2f}] {role}：{content}"
        )
    dialogue_text = "\n".join(dialogue_lines)

    min_t = min(float(s["start_time"]) for s in segments)
    max_t = max(float(s["end_time"])   for s in segments)

    system_prompt = (
        "你是一个专业的 AI 面试分析助手。你的任务是把一段面试转写按话题切成若干个语义段。\n"
        "输入是一份带时间戳的对话列表，格式：「[start_time, end_time] speaker：content」。\n"
        "\n"
        "你需要：\n"
        "1. 识别出面试中实际发生的话题块（如「自我介绍」「项目深挖」「技术追问」「算法题」「反问环节」等）\n"
        "2. 把整段对话分成 3-8 个语义段\n"
        "3. 为每个段给出 2-6 字中文标题\n"
        "\n"
        "联网工具（可选）：当对话中提及具体公司名、岗位名或行业术语，且你不确定它属于哪个话题类别（如「这家公司一面是不是常考系统设计」），可以调用 `web_search(query, count=5)` 工具查证；联网失败时直接基于对话判断即可。\n"
        "\n"
        "你必须返回严格符合以下结构的 JSON 对象（不要返回任何 Markdown 标记或其它前后导言）：\n"
        "{\n"
        '  "sections": [\n'
        "    {\n"
        '      "title": "2-6字中文标题",\n'
        '      "category": "self_intro | project | tech | system_design | behavioral | reverse_question | other",\n'
        '      "tag": "良好 | 一般 | 风险",\n'
        '      "start_time": <浮点数秒>,\n'
        '      "end_time": <浮点数秒>,\n'
        '      "summary": "一句话小评（30-80字）",\n'
        '      "advantages": ["优势1", "优势2"],\n'
        '      "shortcomings": ["不足1", "不足2"],\n'
        '      "review_points": ["复习重点1", "复习重点2"]\n'
        "    }\n"
        "  ]\n"
        "}\n"
        "\n"
        "严格要求：\n"
        "1. start_time 和 end_time 必须从输入对话的真实时间戳里挑选，不允许凭空生成\n"
        "2. 段与段在时间上必须连续覆盖：第 1 段 start_time = 对话最早时间，最后一段 end_time = 对话最晚时间；前一段 end_time ≤ 下一段 start_time\n"
        "3. category 必须是上面列出的枚举值之一\n"
        "4. tag 评价整段表现：表达流畅且技术到位=良好；明显卡顿或答错=风险；其他=一般\n"
        "5. advantages 提取候选人在本话题回答中的闪光点（1-3个），若无则为空数组\n"
        "6. shortcomings 指出候选人在本话题中回答的薄弱环节、答错点或不完善方案（1-3个），若无则为空数组\n"
        "7. review_points 指出本话题对应应该深度掌握或复习的技术名词或方案（1-3个）\n"
    )

    user_content = f"对话列表（共 {len(segments)} 句，时间范围 {min_t:.2f}s - {max_t:.2f}s）：\n{dialogue_text}\n"

    payload = {
        "model": settings.DEEPSEEK_MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user",   "content": user_content},
        ],
        "response_format": {"type": "json_object"},
    }

    raw_sections: List[Dict[str, Any]] = []
    try:
        # sync=True 走 call_llm_sync_with_tools 或 call_llm_sync，与原行为等价
        res_data = await _run_with_optional_tools(payload, enable_network, sync=True)
        content = res_data["choices"][0]["message"]["content"]
        content_clean = _strip_codeblock(content)
        # DEBUG: log raw content to diagnose empty-content returns
        logger.info(f"[sectionize] raw content (first 300): {content_clean[:300]!r}")
        parsed = _safe_json_parse(content_clean, log_label="sectionize")
        if isinstance(parsed, dict):
            raw_sections = parsed.get("sections") or []
        elif isinstance(parsed, list):
            raw_sections = parsed
    except Exception as e:
        logger.error(f"[sectionize] DeepSeek call failed: {e}")
        # Dump the whole response so we can see what LLM actually returned
        try:
            logger.error(f"[sectionize] raw response_data dump: {json.dumps(res_data, ensure_ascii=False)[:2000]}")
        except Exception:
            logger.error(f"[sectionize] raw response_data (no json): {res_data!r}")
        return []

    if not raw_sections:
        logger.warning("[sectionize] DeepSeek returned no sections")
        return []

    # Validate & snap to known segment boundaries
    valid_cats = {"self_intro", "project", "tech", "system_design",
                  "behavioral", "reverse_question", "other"}
    valid_tags = {"良好", "一般", "风险", None, ""}

    cleaned: List[Dict[str, Any]] = []
    for sec in raw_sections:
        try:
            st = float(sec.get("start_time", 0))
            et = float(sec.get("end_time",   0))
        except (TypeError, ValueError):
            continue
        if et <= st:
            continue

        # Snap to nearest real segment boundaries
        st = _snap_to_segments(st, segments)
        et = _snap_to_segments(et, segments)
        if et <= st:
            continue

        title = (sec.get("title") or "").strip()[:64]
        if not title:
            continue
        category = sec.get("category") or "other"
        if category not in valid_cats:
            category = "other"
        tag = sec.get("tag")
        if tag not in valid_tags:
            tag = "一般"
        summary = (sec.get("summary") or "").strip() or None
        advantages = sec.get("advantages") or []
        shortcomings = sec.get("shortcomings") or []
        review_points = sec.get("review_points") or []

        cleaned.append({
            "title":     title,
            "category":  category,
            "tag":       tag,
            "start_time": st,
            "end_time":   et,
            "summary":   summary,
            "advantages": advantages,
            "shortcomings": shortcomings,
            "review_points": review_points
        })

    if not cleaned:
        return []

    # Enforce time coverage: first.start = min_t, last.end = max_t
    cleaned.sort(key=lambda s: s["start_time"])
    cleaned[0]["start_time"]  = min_t
    cleaned[-1]["end_time"]   = max_t

    # Drop duplicates / overlaps
    deduped: List[Dict[str, Any]] = []
    for s in cleaned:
        if deduped and s["start_time"] < deduped[-1]["end_time"]:
            # merge into previous
            deduped[-1]["end_time"] = max(deduped[-1]["end_time"], s["end_time"])
        else:
            deduped.append(s)

    logger.info(f"[sectionize] Produced {len(deduped)} sections")
    return deduped


def _snap_to_segments(t: float, segments: List[Dict[str, Any]]) -> float:
    """Snap a timestamp to the nearest real segment boundary."""
    if not segments:
        return t
    starts = [float(s["start_time"]) for s in segments]
    ends   = [float(s["end_time"])   for s in segments]
    candidates = starts + ends
    if not candidates:
        return t
    return min(candidates, key=lambda x: abs(x - t))


async def generate_section_optimization_advice(
    dialogue_text: str,
    enable_network: bool = True
) -> Dict[str, Any]:
    """
    Generate diagnostic conclusion, candidate original answer, and high-score answer recommendation.

    enable_network: True 时允许 LLM 调用 web_search 查询该考点在大厂面试中的最新
    高分回答思路（如「字节跳动 后端 P7 Redis 缓存架构 真实面经」），让高分话术更
    贴合行业现状；工具失败时直接基于对话上下文作答即可。
    """
    system_prompt = (
        "你是一个顶尖的大厂架构师和 AI 面试教练。你需要对下面这段面试对话中候选人的回答进行深度诊断，并生成优化建议。\n"
        "你需要提供三个部分：\n"
        "1. AI 诊断结论：指出候选人回答中的核心技术漏洞、不完美的设计选择、或者表达欠缺（比如对于提到的技术点指出其优缺点或潜在问题）。字数 80-150 字。\n"
        "2. 候选人原版回答：从对话中提取或提炼出候选人的主要回答内容，保持其口语化和原样。\n"
        "3. 大厂架构师版高分话术推荐：编写一个近乎完美、符合大厂架构师/高级开发期望的回答话术，突出技术深度、Trade-off 权衡、真实项目经验、以及正确的解决方案。字数 150-300 字，可以包含对核心概念的强调（不要使用 Markdown 标记；如需高亮关键词，请使用 <strong class='text-[#5DECCB] font-black'> 与 </strong>，注意 HTML 属性必须用单引号；可以合理使用 <br /><br /> 换行分段）。\n"
        "\n"
        "联网工具（可选）：为了让高分话术更贴近目标公司/岗位的真实考察侧重点，可以调用 `web_search(query, count=5)` 工具检索相关公司/岗位/技术点的最新面经、考点偏好或行业最佳实践。仅在对话上下文不足时调用；联网失败时直接基于对话作答即可，不要因此中断。\n"
        "如果 web_search 返回的是降级文案（如「联网检索超过 Ns 仍未返回」「联网检索失败，已降级为不检索」），**不要再调用 web_search**，直接基于已知上下文作答。\n"
        "\n"
        "你必须返回严格符合以下结构的 JSON 对象（不要包含任何 Markdown 标记或其它前后导言，只返回纯 JSON 对象）：\n"
        "{\n"
        "  \"conclusion\": \"AI 诊断结论内容...\",\n"
        "  \"original\": \"候选人原版回答内容...\",\n"
        "  \"optimized\": \"大厂架构师版高分话术推荐内容...\"\n"
        "}"
    )

    payload = {
        "model": settings.DEEPSEEK_MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"面试对话片段：\n{dialogue_text}"}
        ],
        "response_format": {"type": "json_object"}
    }

    try:
        # 优化建议是"一次性返回 JSON 给前端"的场景，不需要服务端流式。
        # 走 sync 路径省掉 SSE/stream chunk 装配开销，DeepSeek 直连超时也更可控。
        res_data = await _run_with_optional_tools(payload, enable_network, sync=True)
        content = res_data["choices"][0]["message"]["content"]
        content_clean = _strip_codeblock(content)
        parsed_data = _safe_json_parse(content_clean, log_label="optimize")
        if parsed_data is None:
            logger.error("[optimize] unable to parse DeepSeek response as JSON after repair")
            return {
                "conclusion": "分析失败，请稍后重试",
                "original": "无法提取原版回答",
                "optimized": "暂无高分话术推荐",
            }
        return parsed_data
    except Exception as e:
        logger.error(f"Failed to generate optimization advice: {e}")
        return {
            "conclusion": "分析失败，请稍后重试",
            "original": "无法提取原版回答",
            "optimized": "暂无高分话术推荐"
        }


async def generate_transcript_highlights(
    segments: List[Dict[str, Any]],
    enable_network: bool = True
) -> List[Dict[str, Any]]:
    """
    Calls DeepSeek reasoning model LLM to analyze candidate's utterances, returning highlights
    with type ('strength', 'risk', 'tech') and 'tip' explanation.

    enable_network: True 时允许 LLM 调用 web_search 验证候选人提到的「前沿技术」
    是否属实/是否仍为主流（避免把过时技术误标为 strength）；工具失败时直接
    基于对话判断即可。
    """
    if not segments:
        return []

    # Build a dialogue list with indices so the LLM can reference segment index
    dialogue_lines = []
    for idx, s in enumerate(segments):
        role = "面试官" if s.get("speaker") == "Interviewer" else "候选人"
        content = (s.get("content") or "").strip().replace("\n", " ")
        dialogue_lines.append(f"[{idx}] {role}：{content}")
    dialogue_text = "\n".join(dialogue_lines)

    system_prompt = (
        "你是一个专业的 AI 面试分析助手。你的任务是在候选人的回答中找出亮点、表达风险和专业词汇，并给出解析（高亮提示）。\n"
        "输入是一份带索引的对话列表，格式：「[索引] speaker：content」。\n"
        "\n"
        "你需要分析每个候选人的回答，找出以下三类需要高亮的部分：\n"
        "1. strength (亮点)：阐述清晰、论据充分、体现大厂高并发架构思维或有数据量化背书的内容；\n"
        "2. risk (风险)：口癖、啰嗦、语病、逻辑硬伤、没有深度或明显的常识/技术方案错误；\n"
        "3. tech (核心词)：核心技术名词、架构方法论或业务指标词（如 Redis、SLA、双删、QPS 等）。\n"
        "\n"
        "联网工具（可选）：当候选人提到某个具体技术名词或方案，且你不确定它是否仍是当下主流/最佳实践时，可以调用 `web_search(query, count=5)` 工具查证。仅在判断存疑时调用；联网失败时直接基于对话判断即可。\n"
        "\n"
        "你必须返回严格符合以下结构的 JSON 对象（不要返回任何 Markdown 标记或其它前后导言，只返回纯 JSON 对象）：\n"
        "{\n"
        '  "highlights": [\n'
        "    {\n"
        '      "segment_index": <整数索引，必须在输入的索引范围内>,\n'
        '      "text": "对应内容里的具体文本子串，必须和该索引对应回答中的原文字符串完全相同",\n'
        '      "type": "strength | risk | tech",\n'
        '      "tip": "浮动框显示的 AI 分析提示话语（30-80字）"\n'
        "    }\n"
        "  ]\n"
        "}\n"
        "\n"
        "严格要求：\n"
        "1. text 中的内容必须能从对应 segment_index 的原文字串中完全匹配上，不能做任何字词的删改或拼写调整。\n"
        "2. 高亮内容不要太长，尽量是 4-20 个字的关键短句或词语。\n"
        "3. 高亮总数量要适中（每个回答片段 1-3 个高亮即可）。\n"
        "4. 不要在提示话语（tip）中提及具体的段落索引或段号（如‘与第76段重复’），因为前台用户不知道具体的段落索引。如需表达内容重复，应直接说‘存在内容重复’或‘与前面的回答内容重复’。\n"
    )

    payload = {
        "model": settings.DEEPSEEK_MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"对话列表：\n{dialogue_text}"}
        ],
        "response_format": {"type": "json_object"}
    }

    try:
        res_data = await _run_with_optional_tools(payload, enable_network)
        content = res_data["choices"][0]["message"]["content"]
        content_clean = _strip_codeblock(content)
        parsed = _safe_json_parse(content_clean, log_label="highlights")
        if parsed is None:
            logger.error("[highlights] unable to parse DeepSeek response as JSON after repair")
            return []
        return parsed.get("highlights") or []
    except Exception as e:
        logger.error(f"Failed to generate highlights: {e}")
        return []


def call_llm_stream(payload: dict, timeout: float = 300.0) -> dict:
    """
    流式调用 DeepSeek API，把所有 chunk 拼接后返回与非流式格式一致的 dict。
    用于：简历分析等长输出场景，避免 DeepSeek 网关长 idle timeout
    在推理 + 大 JSON 输出过程中主动断开连接（RemoteDisconnected）。

    重试策略：DeepSeek 上游偶发 429 / 5xx / 529(Overloaded)。stream 模式下
    urllib3 的 Retry adapter 帮不上（response 已建立连接才 raise），手写指数退避。
    """
    url = f"{settings.DEEPSEEK_BASE_URL}/chat/completions"
    headers = {
        "Authorization": f"Bearer {settings.DEEPSEEK_API_KEY}",
        "Content-Type": "application/json"
    }
    stream_payload = {**payload, "stream": True}
    retryable_status = {429, 500, 502, 503, 504, 529}
    max_attempts = 4

    last_exc: Optional[Exception] = None
    for attempt in range(max_attempts):
        try:
            content_parts: list[str] = []
            with requests.post(
                url, headers=headers, json=stream_payload, timeout=timeout,
                proxies={"http": None, "https": None}, stream=True,
            ) as resp:
                if resp.status_code in retryable_status:
                    # 抬到 HTTPError，由下面的 except 决定是否重试
                    raise requests.HTTPError(
                        f"{resp.status_code} retryable from DeepSeek upstream",
                        response=resp,
                    )
                resp.raise_for_status()
                for raw in resp.iter_lines(decode_unicode=True):
                    if not raw:
                        continue
                    line = raw.strip()
                    if not line.startswith("data:"):
                        continue
                    data = line[len("data:"):].strip()
                    if data == "[DONE]":
                        break
                    try:
                        chunk = json.loads(data)
                    except json.JSONDecodeError:
                        continue
                    try:
                        delta = chunk["choices"][0].get("delta") or {}
                        piece = delta.get("content")
                        if piece:
                            content_parts.append(piece)
                    except (KeyError, IndexError, TypeError):
                        continue
            return {
                "choices": [{"message": {"content": "".join(content_parts)}}]
            }
        except requests.HTTPError as e:
            last_exc = e
            status_code = e.response.status_code if e.response is not None else None
            if status_code not in retryable_status or attempt == max_attempts - 1:
                raise
            wait = 1.5 * (2 ** attempt)  # 1.5s, 3s, 6s
            logger.warning(
                "[DeepSeek stream]upstream %s, retry %d/%d after %.1fs",
                status_code, attempt + 1, max_attempts - 1, wait,
            )
            time.sleep(wait)
        except (requests.ConnectionError, requests.Timeout) as e:
            last_exc = e
            if attempt == max_attempts - 1:
                raise
            wait = 1.5 * (2 ** attempt)
            logger.warning(
                "[DeepSeek stream]%s, retry %d/%d after %.1fs",
                type(e).__name__, attempt + 1, max_attempts - 1, wait,
            )
            time.sleep(wait)
    raise last_exc if last_exc else RuntimeError("call_llm_stream exhausted retries")


async def call_llm_stream_chunks(payload: dict, timeout: float = 300.0):
    """
    逐 chunk yield 文本片段（async generator），供 SSE 消费。

    与 call_llm_stream 的区别：
      - call_llm_stream: 消费完整流，拼接后返回 dict（用于 JSON 解析）
      - call_llm_stream_chunks: 逐 chunk yield 字符串片段（用于 SSE 流式输出）

    重试策略：DeepSeek 上游偶发 429/5xx/529(Overloaded)。stream 模式下
    urllib3 的 Retry adapter 帮不上（response 已建立连接才 raise），手写指数退避。
    """
    url = f"{settings.DEEPSEEK_BASE_URL}/chat/completions"
    headers = {
        "Authorization": f"Bearer {settings.DEEPSEEK_API_KEY}",
        "Content-Type": "application/json"
    }
    stream_payload = {**payload, "stream": True}
    retryable_status = {429, 500, 502, 503, 504, 529}
    max_attempts = 4

    def _do_request():
        return requests.post(
            url, headers=headers, json=stream_payload, timeout=timeout,
            proxies={"http": None, "https": None}, stream=True,
        )

    last_exc: Optional[Exception] = None
    for attempt in range(max_attempts):
        try:
            resp = await asyncio.to_thread(_do_request)
            if resp.status_code in retryable_status:
                raise requests.HTTPError(
                    f"{resp.status_code} retryable from DeepSeek upstream",
                    response=resp,
                )
            resp.raise_for_status()

            for raw in resp.iter_lines(decode_unicode=True):
                if not raw:
                    continue
                line = raw.strip()
                if not line.startswith("data:"):
                    continue
                data = line[len("data:"):].strip()
                if data == "[DONE]":
                    break
                try:
                    chunk = json.loads(data)
                except json.JSONDecodeError:
                    continue
                try:
                    delta = chunk["choices"][0].get("delta") or {}
                    piece = delta.get("content")
                    if piece:
                        yield piece
                except (KeyError, IndexError, TypeError):
                    continue
            # 正常结束，退出重试循环
            return
        except requests.HTTPError as e:
            last_exc = e
            status_code = e.response.status_code if e.response is not None else None
            if status_code not in retryable_status or attempt == max_attempts - 1:
                raise
            wait = 1.5 * (2 ** attempt)
            logger.warning(
                "[DeepSeek stream_chunks]upstream %s, retry %d/%d after %.1fs",
                status_code, attempt + 1, max_attempts - 1, wait,
            )
            await asyncio.sleep(wait)
        except (requests.ConnectionError, requests.Timeout) as e:
            last_exc = e
            if attempt == max_attempts - 1:
                raise
            wait = 1.5 * (2 ** attempt)
            logger.warning(
                "[DeepSeek stream_chunks]%s, retry %d/%d after %.1fs",
                type(e).__name__, attempt + 1, max_attempts - 1, wait,
            )
            await asyncio.sleep(wait)
    raise last_exc if last_exc else RuntimeError("call_llm_stream_chunks exhausted retries")


async def analyze_resume_text(
    resume_text: str,
    profile_data: Optional[dict] = None,
    parsed_structure: Optional[dict] = None,
    enable_network: bool = True
) -> Dict[str, Any]:
    """
    Calls DeepSeek (reasoning model) to analyze the extracted resume text and return structured analysis in JSON.
    使用流式调用绕开 DeepSeek 网关长 idle timeout，禁用系统代理。

    parsed_structure: 服务端正则解析出的结构化简历（公司/岗位/时间/bullets 等原文），
    传给 LLM 仅作为 "verbatim 参照表"，避免 LLM 把 "ByteDance" 改写成 "字节跳动"、
    改写公司名/时间等原文。LLM 仍可在结构上自由发挥，但所有公司名/岗位/时间/原文 bullet
    必须 verbatim 等于解析器给出的值。

    enable_network: True 时允许 LLM 调用 web_search 查询候选人目标公司的最新
    招聘 JD、技术栈要求、岗位画像或行业薪资参考，使 match_analysis 维度评分与
    recommended_keywords 更贴合当下招聘趋势；工具失败时直接基于简历 + profile
    判断即可，不要因为联网失败而中断。
    """
    from datetime import datetime
    current_date = datetime.now().strftime("%Y-%m-%d")

    system_prompt = (
        f"【系统时间上下文】当前北京时间是：{current_date}。在提取或计算候选人的工作年限（例如将 '2023.07 - 至今' 或其他时间段与当前时间对比）时，请严格以该时间作为当前的'至今/Present'基准进行逻辑计算，避免算错工作年限。\n"
        "你是一个专业的 AI 简历分析教练。你的任务是对候选人的简历进行深度雷区检测与优化建议。\n"
        "联网工具（可选）：为了让 match_analysis、recommended_keywords、risks 更贴近招聘现状，可以调用 `web_search(query, count=5)` 工具实时检索目标公司最新 JD、技术栈要求、行业薪资参考或岗位画像。仅在简历上下文不足时调用；联网工具返回失败时直接基于简历和 profile 继续分析即可，不要因为工具失败而中断。\n"
        "你需要根据提取出的简历文本内容，结合候选人的求职期望画像（如果提供了），完成以下工作：\n"
        "1. 计算简历综合评分（0-100，当前表现）以及优化后预计提升的综合评分（0-100）。\n"
        "2. 计算大厂 ATS 机器可读性通过率百分比（0-100）。\n"
        "3. 提取候选人基础档案：姓名、求职状态、当前职级职位、工作年限、当前公司、当前岗位、当前薪资；并结合目标画像提取目标公司、目标岗位、目标职级、目标薪资。\n"
        "4. 重构并优化工作经历（work_experiences）：\n"
        "   - 对于工作经历中的每一条核心描述（bullets），同时保留原始描述（originalText）和优化后的描述（optimizedText）。\n"
        "   - 给出该描述在原始简历中的诊断风险（originalTag 为 '风险'，originalDesc 说明缺失或问题所在；或者 originalTag 为 '亮点'）并赋予对应样式类名。\n"
        "   - 给出优化后的标签（optimizedTag 为 '已优化'）与样式类名。\n"
        "   - **【最重要！严禁虚构无关业务场景】**：优化后的描述（optimizedText）必须基于候选人简历原文的**真实项目背景与技术路线**进行表达重构。**严禁凭空捏造与原项目完全无关的高并发/大流量业务场景**（例如：如果原简历不涉及电商、大促、秒杀等，绝对不能在优化版中将其改写或虚构成“大促压测”、“双十一流量洪峰保障”等无中生有的场景；如果原简历没有提到相关技术栈，绝不能虚构其参与了该技术的研发）。所有优化的目标是润色表述和体现技术深度，而非伪造工作背景。\n"
        "5. 诊断并列出简历中的所有风险点（risks），包含风险标题、详细说明、严重程度（高风险/中风险/低风险）。\n"
        "6. 进行目标岗位画像匹配度分析（match_analysis），包括匹配得分、文字说明、具体各维度的覆盖情况（coverages）。\n"
        "7. 输出简历优化的核心AI建议（optimization_suggestions），每条建议包含标题和详细描述。\n"
        "8. 分析关键词覆盖率（keywords_analysis），找出已覆盖的高频词（current_keywords）和推荐补齐的核心行业热点词（recommended_keywords）。\n"
        "9. 提供 ATS 兼容性各项检测指标结果（ats_checks），每一项包括检测名、状态（通过/警告）及具体指标评分情况。\n"
        "\n"
        "10. **输出简历的完整结构分析地图（structure_analysis）**：把简历按 8 个固定 section 切片，\n"
        "    给出每个 section 的健康度诊断和黄金润色范例。**关键约束**：\n"
        "    - 8 个 section key 必须严格使用下面 schema 列出的英文 key，不要新增也不要省略\n"
        "    - 每个 section 必须输出 status / score / desc / advice / before / after 六个字段\n"
        "    - status 必须是 \"优秀\" / \"亮点\" / \"风险\" / \"缺失\" 之一\n"
        "    - score 必须是 0-100 的整数\n"
        "    - advice 是 1-3 条字符串的数组\n"
        "    - 工作经历 / 项目经历 section 的 before / after 优先用简历中真实 bullets 的 originalText / optimizedText；\n"
        "      其他 section（教育 / 开源 / 业务成果 / 管理 / 技术栈 / 个人信息）原简历可能没对应内容，按目标岗位画像自由生成合理范例\n"
        "\n"
        "你必须返回严格符合以下结构的 JSON 对象（不要返回任何 Markdown 标记或其它前后导言，只返回纯 JSON 对象，且属性键和值必须使用双引号）：\n"
        "{\n"
        "  \"score\": 84, \n"
        "  \"optimized_score\": 89, \n"
        "  \"ats_pass_rate\": 92, \n"
        "  \"profile\": {\n"
        "    \"name\": \"候选人姓名\",\n"
        "    \"status\": \"在职/离职/在校生\",\n"
        "    \"title\": \"当前职位名称\",\n"
        "    \"years\": \"工作年限\",\n"
        "    \"company\": \"当前公司名称\",\n"
        "    \"role\": \"当前岗位名\",\n"
        "    \"salary\": \"当前薪资，如 30K * 16\",\n"
        "    \"targetCompany\": \"目标公司，如 字节跳动\",\n"
        "    \"targetRole\": \"目标岗位名\",\n"
        "    \"targetGrade\": \"目标职级，如 P7\",\n"
        "    \"targetSalary\": \"目标期望薪资，如 40K-50K\"\n"
        "  },\n"
        "  \"work_experiences\": [\n"
        "    {\n"
        "      \"company\": \"公司名称\",\n"
        "      \"role\": \"职位/岗位名\",\n"
        "      \"period\": \"工作时间段，如 2022.07 - 至今\",\n"
        "      \"bullets\": [\n"
        "        {\n"
        "          \"originalText\": \"原始描述句子\",\n"
        "          \"optimizedText\": \"使用STAR原则优化后、包含量化业绩与大厂架构思维的资深表述\",\n"
        "          \"originalTag\": \"风险/亮点\",\n"
        "          \"originalTagClass\": \"如果是风险请填 'text-[#FF7A95] bg-[#FF7A95]/10 border-[#FF7A95]/20'，如果是亮点请填 'text-[#5DECCB] bg-[#5DECCB]/10 border-[#5DECCB]/20'\", \n"
        "          \"originalDesc\": \"诊断说明说明为什么是风险或亮点\",\n"
        "          \"optimizedTag\": \"已优化\",\n"
        "          \"optimizedTagClass\": \"text-[#5DECCB] bg-[#5DECCB]/10 border-[#5DECCB]/20\"\n"
        "        }\n"
        "      ]\n"
        "    }\n"
        "  ],\n"
        "  \"risks\": [\n"
        "    {\n"
        "      \"title\": \"核心业绩缺少量化指标\",\n"
        "      \"desc\": \"具体风险点详细解析说明...\",\n"
        "      \"severity\": \"高风险/中风险/低风险\"\n"
        "    }\n"
        "  ],\n"
        "  \"match_analysis\": {\n"
        "    \"match_score\": 83,\n"
        "    \"match_desc\": \"岗位契合度总体评估描述...\",\n"
        "    \"coverages\": [\n"
        "      {\n"
        "        \"item\": \"匹配评估的技术项/业务项\",\n"
        "        \"status\": \"完美覆盖/基础具备/描述较弱\",\n"
        "        \"percent\": \"90%\"\n"
        "      }\n"
        "    ]\n"
        "  },\n"
        "  \"optimization_suggestions\": [\n"
        "    {\n"
        "      \"title\": \"建议 1：重塑“动作词”，剔除事务型字眼\",\n"
        "      \"desc\": \"具体建议内容详细阐述...\"\n"
        "    }\n"
        "  ],\n"
        "  \"keywords_analysis\": {\n"
        "    \"current_keywords\": [\"高频词1\", \"高频词2\"],\n"
        "    \"recommended_keywords\": [\"推荐补齐词1\", \"推荐补齐词2\"]\n"
        "  },\n"
        "  \"ats_checks\": [\n"
        "    {\n"
        "      \"name\": \"检查项名称\",\n"
        "      \"status\": \"通过/警告\",\n"
        "      \"score\": \"诊断简述评分\"\n"
        "    }\n"
        ",\n"
        "  \"structure_analysis\": {\n"
        "    \"personal_info\": { \"status\": \"优秀\", \"score\": 90, \"desc\": \"...\", \"advice\": [\"...\"], \"before\": \"...\", \"after\": \"...\" },\n"
        "    \"work_experience\": { \"status\": \"优秀\", \"score\": 90, \"desc\": \"...\", \"advice\": [\"...\"], \"before\": \"...\", \"after\": \"...\" },\n"
        "    \"projects\": { \"status\": \"优秀\", \"score\": 90, \"desc\": \"...\", \"advice\": [\"...\"], \"before\": \"...\", \"after\": \"...\" },\n"
        "    \"tech_stack\": { \"status\": \"优秀\", \"score\": 90, \"desc\": \"...\", \"advice\": [\"...\"], \"before\": \"...\", \"after\": \"...\" },\n"
        "    \"education\": { \"status\": \"优秀\", \"score\": 90, \"desc\": \"...\", \"advice\": [\"...\"], \"before\": \"...\", \"after\": \"...\" },\n"
        "    \"open_source\": { \"status\": \"优秀\", \"score\": 90, \"desc\": \"...\", \"advice\": [\"...\"], \"before\": \"...\", \"after\": \"...\" },\n"
        "    \"business_outcomes\": { \"status\": \"优秀\", \"score\": 90, \"desc\": \"...\", \"advice\": [\"...\"], \"before\": \"...\", \"after\": \"...\" },\n"
        "    \"management\": { \"status\": \"优秀\", \"score\": 90, \"desc\": \"...\", \"advice\": [\"...\"], \"before\": \"...\", \"after\": \"...\" }\n"
        "  }\n"
        "}\n"
    )

    user_content = ""
    if parsed_structure:
        user_content += (
            "\n【verbatim 参照表 - 服务端解析的原文结构】\n"
            "以下公司名、岗位、时间、bullet 原文是从简历里 verbatim 抽出的，"
            "你输出的 work_experiences / profile 里所有这些字段必须 1:1 等于下表，"
            "禁止翻译/规范化/合并/拆分（如 \"ByteDance\" 不得改写为 \"字节跳动\"，"
            "\"2022.07-2024.06\" 不得改写为 \"2022年7月 - 2024年6月\"）。"
            "对 bullet 你只需给出诊断/优化版本（optimizedText/originalTag/...），originalText 必须原样照抄。\n"
            f"{json.dumps(parsed_structure, ensure_ascii=False, indent=2)}\n"
        )
    user_content += f"\n简历文本内容：\n{resume_text}\n"
    if profile_data:
        user_content += f"\n求职期望画像信息：\n{json.dumps(profile_data, ensure_ascii=False)}\n"

    payload = {
        "model": settings.DEEPSEEK_MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content}
        ],
        "response_format": {"type": "json_object"}
    }

    try:
        logger.info(f"[resume] analyzing resume_text len={len(resume_text)} chars")
        res_data = await _run_with_optional_tools(
            payload, enable_network, sync=False, timeout=300.0
        )
        content = res_data["choices"][0]["message"]["content"]
        logger.info(f"[resume] received content len={len(content)} chars")
        content_clean = _strip_codeblock(content)
        parsed_data = _safe_json_parse(content_clean, log_label="resume")
        if parsed_data is None:
            logger.error("[resume] unable to parse DeepSeek response as JSON after repair")
            return {}
        return parsed_data
    except Exception as e:
        logger.error(f"Failed to analyze resume via DeepSeek: {e}")
        return {}


async def extract_project_experiences(
    resume_text: str,
    parsed_structure: dict,
    existing_projects: list[dict],
    enable_network: bool = True
) -> list[dict]:
    """
    从简历原文中提取项目经历的结构化信息。

    Args:
        resume_text: 简历纯文本全文
        parsed_structure: 服务端正则解析的结构化简历 {profile, work_experiences}
        existing_projects: 用户已有的项目记忆 [{"id": int, "project_name": str, "category": str}, ...]
            LLM 会对照此列表标注 is_duplicate 和 matched_existing_id
        enable_network: True 时允许 LLM 调用 web_search 验证简历提到的「开源项目 /
        业内产品 / 技术名词」是否真实存在，避免把虚构项目入库；联网失败时直接
        基于简历原文提取即可。

    Returns:
        提取出的项目列表；LLM 调用失败时返回空列表 []
    """
    system_prompt = (
        "你是一个专业的 AI 简历解析与项目分析助手。你的任务是从候选人的简历原文中，提取出所有项目经历的结构化信息。\n"
        "联网工具（可选）：当简历提到你不确定真实性的开源项目/业内产品/技术名词（如某个冷门开源库名），可以调用 `web_search(query, count=5)` 工具查证。仅在存疑时调用；联网失败时直接基于简历原文提取即可，不要因为工具失败而中断。\n"
        "\n"
        "## 核心要求\n"
        "1. **逐项目提取**：从简历中识别出每一个独立的项目经历，不要遗漏、不要合并不同项目\n"
        "2. **精准命名**：project_name 使用简历中实际出现的项目名称，最多 30 个汉字\n"
        "3. **深度提炼**：summary 基于简历原文提炼，突出项目的核心价值、技术亮点和业务成果，控制在 150-300 字\n"
        "4. **准确分类**：根据项目的核心业务属性，从下面的标签体系中选择最匹配的主分类\n"
        "5. **技术栈提取**：列出项目中明确使用或重点涉及的核心技术栈\n"
        "6. **量化指标**：提取项目中提到的所有可量化数据（QPS、用户量、延迟、成本节省等）\n"
        "\n"
        "## 标签体系说明\n"
        "| 分类标签 | 适用场景 |\n"
        "|----------|---------|\n"
        "| AI工程 | 推荐系统、模型推理、NLP/CV、特征平台、向量检索、大模型应用 |\n"
        "| 数据工程 | 数仓建设、ETL管道、数据治理、实时/离线计算、OLAP分析 |\n"
        "| 交易骨干 | 订单系统、支付结算、交易链路、对账系统、资金安全 |\n"
        "| 基础平台 | 中间件、API网关、Service Mesh、配置中心、可观测性、消息队列 |\n"
        "| 增长工程 | 营销系统、AB实验、推送通知、广告系统、增长策略 |\n"
        "| 安全合规 | 风控系统、反欺诈、内容安全、合规审计、权限管理 |\n"
        "| 公共组件 | SDK开发、通用库、脚手架、开发工具链、代码生成 |\n"
        "| 运维效能 | CI/CD、容器化、发布系统、容量规划、成本优化 |\n"
        "\n"
        "## 辅助标签（可多选）\n"
        "从以下标签中为该打的项目打上合适的标签（sub_tags），没有合适的可以不打：\n"
        "- 核心项目：简历中最重要/最核心的项目\n"
        "- 大流量：涉及高并发/大流量场景\n"
        "- 从0到1：从零搭建\n"
        "- 跨团队：跨部门/跨团队协作\n"
        "- 业务增长：带来显著业务增长\n"
        "- 成本优化：大幅降低成本\n"
        "- 技术重构：大型技术重构/迁移\n"
        "\n"
        "## 角色推断\n"
        "根据简历描述推断候选人在项目中担任的角色（role），选项：核心开发 / 技术负责人 / 架构师 / 项目负责人 / 参与开发\n"
        "\n"
        "## 评分要求\n"
        "- mastery_level（0-100）：根据简历中对项目的描述深度、指标数据完善度、技术细节丰富度、候选人在项目中的主导程度综合评估\n"
        "- importance（0-100）：根据项目规模、业务价值、技术复杂度、与主流大厂技术栈匹配度综合评估\n"
        "\n"
        "## 已有的项目记忆\n"
        "下面列出了用户已有的项目记忆。如果你提取出的某个项目与已有项目实质上是同一个（项目名可能略有不同但描述的是同一实际项目），"
        "请在输出中标注 is_duplicate: true，并填写 matched_existing_id（对应的已有项目ID）。\n"
        "已有项目列表：\n"
        f"{json.dumps(existing_projects, ensure_ascii=False)}\n"
        "\n"
        "## 输出格式\n"
        "你必须返回严格符合以下结构的 JSON 对象（不要返回任何 Markdown 标记或其他前后导言）：\n"
        "{\n"
        '  "projects": [\n'
        "    {\n"
        '      "project_name": "项目名称（最多30字）",\n'
        '      "summary": "项目简介：基于简历原文提炼的核心描述，突出技术价值与业务成果（150-300字）",\n'
        '      "category": "AI工程/数据工程/交易骨干/基础平台/增长工程/安全合规/公共组件/运维效能",\n'
        '      "sub_tags": ["核心项目", "大流量"],\n'
        '      "tech_stack": ["Redis", "Kafka", "Spring Boot", "MySQL"],\n'
        '      "metrics": {"qps": "10W+", "latency_p99": "50ms", "users": "3000万DAU"},\n'
        '      "role": "技术负责人",\n'
        '      "duration": "2022.07 - 至今",\n'
        '      "mastery_level": 85,\n'
        '      "importance": 90,\n'
        '      "is_duplicate": false,\n'
        '      "matched_existing_id": null\n'
        "    }\n"
        "  ]\n"
        "}\n"
        "\n"
        "## 重要约束\n"
        "- project_name 必须来自简历原文，禁止自己编造\n"
        "- summary 必须基于简历原文提炼，禁止虚构不存在的业务场景和技术\n"
        "- category 必须从标签体系中选择，如果无法准确判断选 '基础平台'\n"
        "- mastery_level 和 importance 必须是 0-100 的整数\n"
        "- metrics 只提取简历中明确存在的量化数据，不要编造\n"
        "- tech_stack 只列简历中明确提到的技术名词\n"
        "- 如果简历中某段工作经历主要是日常工作维护而非独立项目，可以不提取为项目\n"
    )

    user_content = (
        f"## 简历原文\n{resume_text}\n\n"
        f"## 服务端解析的结构化数据\n{json.dumps(parsed_structure, ensure_ascii=False)}\n"
    )

    payload = {
        "model": settings.DEEPSEEK_MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ],
        "response_format": {"type": "json_object"},
        "temperature": 0.3,
        "max_tokens": 8192,
    }

    try:
        logger.info(
            f"[project_extract] extracting projects from resume len={len(resume_text)} "
            f"existing_projects={len(existing_projects)}"
        )
        res_data = await _run_with_optional_tools(
            payload, enable_network, sync=False, timeout=120.0
        )
        content = res_data["choices"][0]["message"]["content"]
        logger.info(f"[project_extract] received content len={len(content)} chars")
        content_clean = _strip_codeblock(content)

        # 使用安全解析（自带修复 + 原始内容日志 dump）
        parsed = _safe_json_parse(content_clean, log_label="project_extract")
        if parsed is None:
            # JSON 修复失败，用更严格约束的 prompt 重试一次
            logger.warning("[project_extract] JSON 修复失败，使用严格约束重试一次...")
            retry_payload = dict(payload)
            # 追加更严格的 JSON 格式指令
            retry_payload["messages"] = list(payload["messages"]) + [
                {"role": "user", "content": (
                    "重要提醒：你上一次返回的 JSON 格式有语法错误（缺少逗号或存在非法字符），"
                    "无法被解析器读取。请严格检查并确保本次输出是合法的 JSON。记住：\n"
                    "1. 对象属性之间必须有逗号分隔\n"
                    "2. 字符串值中的换行、Tab、反斜杠必须转义（\\n \\t \\\\）\n"
                    "3. 不要在最后一个属性后面加逗号\n"
                    "4. summary 字段如果包含引号，请用中文引号「」替代，避免 JSON 转义失败\n"
                    "请重新输出完整结果。"
                )}
            ]
            retry_data = await asyncio.to_thread(call_llm_stream, retry_payload, 120.0)
            retry_content = retry_data["choices"][0]["message"]["content"]
            logger.info(f"[project_extract] 重试返回 content len={len(retry_content)} chars")
            retry_clean = _strip_codeblock(retry_content)
            parsed = _safe_json_parse(retry_clean, log_label="project_extract_retry")
            if parsed is None:
                logger.error("[project_extract] 重试后 JSON 仍无法解析，放弃本次提取")
                return []

        projects = parsed.get("projects") or []
        logger.info(f"[project_extract] extracted {len(projects)} projects")
        return projects
    except Exception as e:
        logger.error(f"[project_extract] failed: {e}")
        return []
