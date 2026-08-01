from __future__ import annotations

import asyncio
import json
import logging
import threading
from datetime import timedelta
from typing import Optional

import httpx
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client
from mcp.types import CallToolResult, TextContent

from app.config import settings

logger = logging.getLogger(__name__)


# ──────────────────────────────────────────────────────────────────────
# 常驻 MCP 会话（按 URL + API Key 单例）
# ──────────────────────────────────────────────────────────────────────
class _McpSession:
    """单条常驻 streamableHttp + 单个 ClientSession 的复用容器。

    关键设计：
      - `_run()` 在一个常驻任务里 await streamable_http_client(...) 上下文管理器，
        里面再 await ClientSession(...) 上下文管理器；SDK 内部自行驱动 HTTP 请求，
        只要任务不退出，会话就一直存活。
      - 首次 _ensure() 建连 + list_tools() 发现可用工具；之后 search_web() 直接复用。
      - 任何时候探测到会话挂了，下次 _ensure 会重建。
    """

    # session.call_tool() 默认 read_timeout_seconds=60s 偏长；这里收紧到 11s，
    # 给外层 WEB_SEARCH_TIMEOUT_S=12s 留 1s 余量。
    _CALL_READ_TIMEOUT_S = 11.0

    # _ready.wait() 上限（initialize + list_tools 收尾）
    _READY_TIMEOUT_S = 15.0

    def __init__(self, url: str, api_key: str):
        self.url = url
        self.api_key = api_key
        self._lock = asyncio.Lock()
        self._ready = asyncio.Event()
        self._session: Optional[ClientSession] = None
        self._runner: Optional[asyncio.Task] = None
        # 工具名缓存：首次连接时通过 list_tools() 发现
        self._search_tool_name: Optional[str] = None

    @property
    def ready(self) -> bool:
        return self._ready.is_set() and self._session is not None

    async def _run(self):
        """常驻任务：保持 streamableHttp + ClientSession 一直活着；任一异常即退出。"""
        try:
            async with httpx.AsyncClient(
                headers={"Authorization": f"Bearer {self.api_key}"},
                timeout=httpx.Timeout(30.0, connect=10.0),
            ) as http_client:
                async with streamable_http_client(
                    self.url,
                    http_client=http_client,
                    terminate_on_close=True,
                ) as (read_stream, write_stream, _get_sid):
                    async with ClientSession(read_stream, write_stream) as session:
                        await session.initialize()

                        # 发现可用工具
                        tools_result = await session.list_tools()
                        tool_names = [t.name for t in tools_result.tools]
                        logger.info(f"[mcp] 已连接阿里百炼 MCP，可用工具: {tool_names}")
                        # 优先找 WebSearch/web_search，否则取第一个
                        self._search_tool_name = (
                            next((n for n in tool_names if "web" in n.lower() or "search" in n.lower()), None)
                            or (tool_names[0] if tool_names else None)
                        )
                        if not self._search_tool_name:
                            logger.warning("[mcp] 阿里百炼 MCP 未发现任何工具")

                        self._session = session
                        self._ready.set()
                        logger.info("[mcp] WebSearch MCP 会话已建立（streamableHttp）")
                        # 阻塞直到被取消
                        await asyncio.Future()
        except asyncio.CancelledError:
            raise
        except Exception as ex:
            logger.warning(f"[mcp] 会话异常退出: {ex!r}")
        finally:
            self._ready.clear()
            self._session = None

    async def _ensure(self):
        """惰性建连：首次调用 / 上次连接挂了再调用时重建。"""
        if self.ready and self._runner is not None and not self._runner.done():
            return
        async with self._lock:
            if self.ready and self._runner is not None and not self._runner.done():
                return
            await self._cancel_runner()
            self._runner = asyncio.get_running_loop().create_task(
                self._run(), name="aliyun-mcp-session"
            )
            try:
                await asyncio.wait_for(self._ready.wait(), timeout=self._READY_TIMEOUT_S)
            except asyncio.TimeoutError:
                await self._cancel_runner()
                raise RuntimeError(
                    f"MCP 会话建立超时（{self._READY_TIMEOUT_S:.0f}s 内未完成 initialize）"
                )

    async def _cancel_runner(self):
        runner = self._runner
        self._runner = None
        if runner is None or runner.done():
            return
        runner.cancel()
        try:
            await runner
        except (asyncio.CancelledError, Exception):
            pass

    async def call_tool_text(
        self, name: str, arguments: dict, *, timeout_s: Optional[float] = None
    ) -> str:
        """走官方 session.call_tool() 调一次工具，返回拼接后的文本。"""
        await self._ensure()
        assert self._session is not None
        rt_s = timeout_s if timeout_s is not None else self._CALL_READ_TIMEOUT_S
        result: CallToolResult = await self._session.call_tool(
            name=name,
            arguments=arguments,
            read_timeout_seconds=timedelta(seconds=rt_s),
        )
        if getattr(result, "isError", False):
            raise RuntimeError(f"MCP tools/call 返回 isError=True: {result.content!r}")
        chunks: list[str] = []
        for item in result.content or []:
            if isinstance(item, TextContent):
                chunks.append(item.text or "")
            else:
                try:
                    chunks.append(json.dumps(item.model_dump(by_alias=True, exclude_none=True), ensure_ascii=False))
                except Exception:
                    chunks.append(str(item))
        return "\n".join(chunks)

    async def close(self):
        await self._cancel_runner()


# ──────────────────────────────────────────────────────────────────────
# 模块级单例 + 公共 API
# ──────────────────────────────────────────────────────────────────────
_session: Optional[_McpSession] = None
_session_lock = threading.Lock()


def _get_session() -> _McpSession:
    """惰性创建 / 复用 _McpSession 单例（线程安全）。"""
    global _session
    with _session_lock:
        if _session is None:
            url = (
                getattr(settings, "ALIYUN_MCP_SEARCH_URL", "")
                or "https://dashscope.aliyuncs.com/api/v1/mcps/WebSearch/mcp"
            )
            api_key = settings.DASHSCOPE_API_KEY or ""
            if not api_key:
                logger.error("[mcp] DASHSCOPE_API_KEY 未配置，联网搜索不可用")
            _session = _McpSession(url, api_key)
        return _session


async def search_web(query: str, count: int = 5) -> str:
    """调用阿里百炼 WebSearch MCP 工具联网检索。

    走官方 MCP 协议：常驻 streamableHttp + ClientSession，
    单次 search_web 只是 call_tool 一次。
    外层 asyncio.wait_for 取消时，SDK 内部只会丢掉本次等待，不会拆共享会话。
    """
    api_key = settings.DASHSCOPE_API_KEY or ""
    if not api_key:
        return "（未配置阿里百炼 DASHSCOPE_API_KEY，已降级为纯大模型推理）"

    sess = _get_session()
    try:
        # 等连接建立完成，工具名已缓存
        tool_name = sess._search_tool_name
        if not tool_name:
            # 先触发建连
            await sess._ensure()
            tool_name = sess._search_tool_name
        if not tool_name:
            return "（阿里百炼 MCP 未发现可用搜索工具，已降级为纯大模型推理）"

        raw_text = await sess.call_tool_text(
            name=tool_name,
            arguments={"query": query, "count": count},
        )
    except asyncio.CancelledError:
        raise
    except Exception as ex:
        logger.warning(f"[mcp] 阿里百炼 MCP 调用异常，降级为纯大模型推理: {ex!r}")
        try:
            await sess.close()
        except Exception:
            pass
        return "（阿里百炼联网检索不可用，已降级为纯大模型推理）"

    if not raw_text or not raw_text.strip():
        return "（未找到相关互联网搜索结果）"
    return raw_text


async def close_web_search_session():
    """进程关闭时可调用，主动拆掉常驻 MCP 会话。"""
    global _session
    sess = _session
    _session = None
    if sess is not None:
        try:
            await sess.close()
        except Exception:
            pass
