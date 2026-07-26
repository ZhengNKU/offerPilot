import logging
import json
import asyncio
import itertools
import httpx
from urllib.parse import urljoin
from typing import Optional
from app.config import settings

logger = logging.getLogger(__name__)

# SSE 长连接：read=None，否则长连接会被 read 超时（原来的 6s）周期性掐断。
_SSE_TIMEOUT = httpx.Timeout(connect=3.5, read=None, write=4.0, pool=3.5)
# POST 交互：正常握手/检索请求，给 15s read 上限。
_POST_TIMEOUT = httpx.Timeout(connect=3.5, read=15.0, write=4.0, pool=3.5)


class _McpSseSession:
    """进程内复用的腾讯云 WebSearch MCP over SSE 会话。

    关键设计（同时解决"取消拆连接阻塞"与"每次重新握手"两个问题）：
      - 一条 SSE GET 长连接 + 一个 POST client 常驻复用，只在断线时重建；
      - 每次检索用唯一自增 id，响应按 id 路由到各自的调用方，支持并发共享；
      - 单次 call_search 被外层 wait_for 取消时，只丢弃自己的等待（pop 掉 id），
        绝不 aclose 共享连接 —— 因此取消能在一个事件循环 tick 内干净返回，
        不会再出现 threshold=4s 却 elapsed 28~58s 的拆连接阻塞。
    """

    def __init__(self, sse_url: str):
        self.sse_url = sse_url
        self._lock = asyncio.Lock()
        self._sse_client: Optional[httpx.AsyncClient] = None
        self._post_client: Optional[httpx.AsyncClient] = None
        self._post_url: Optional[str] = None
        self._responses: dict[int, dict] = {}
        self._pending: set[int] = set()          # 仍在等待响应的 id，防止晚到响应泄漏
        self._listener: Optional[asyncio.Task] = None
        self._initialized = False
        self._ids = itertools.count(2)            # id=1 保留给 initialize

    def _healthy(self) -> bool:
        return (
            self._initialized
            and self._post_url is not None
            and self._post_client is not None
            and self._listener is not None
            and not self._listener.done()
        )

    async def _listen(self):
        """常驻 SSE 监听：解析 endpoint / message 事件，按 id 落到 _responses。"""
        try:
            async with self._sse_client.stream(
                "GET", self.sse_url, headers={"Accept": "text/event-stream"}
            ) as resp:
                if resp.status_code != 200:
                    logger.error(f"[mcp] SSE GET 响应非 200: {resp.status_code}")
                    return
                current_event = None
                async for line in resp.aiter_lines():
                    if not line:
                        continue
                    if line.startswith("event:"):
                        current_event = line[6:].strip()
                    elif line.startswith("data:"):
                        data_str = line[5:].strip()
                        if current_event == "endpoint":
                            self._post_url = urljoin(self.sse_url, data_str)
                        elif current_event == "message":
                            try:
                                msg = json.loads(data_str)
                                rid = msg.get("id")
                                if rid is not None and rid in self._pending:
                                    self._responses[rid] = msg
                            except Exception:
                                pass
        except asyncio.CancelledError:
            raise
        except Exception as ex:
            logger.debug(f"[mcp] SSE listener 结束: {ex!r}")
        finally:
            # 连接断了：标记未初始化，下次 call 触发重连
            self._initialized = False

    async def _connect_locked(self):
        """在 _lock 保护下建立连接并完成 MCP 握手。"""
        await self._teardown()
        self._sse_client = httpx.AsyncClient(timeout=_SSE_TIMEOUT)
        self._post_client = httpx.AsyncClient(timeout=_POST_TIMEOUT)
        self._responses = {}
        self._pending = set()
        self._post_url = None
        self._listener = asyncio.create_task(self._listen())

        # 1. 等 endpoint（最长 4.5s）
        for _ in range(45):
            if self._post_url:
                break
            if self._listener.done():
                raise RuntimeError("SSE listener 提前结束，未拿到 endpoint")
            await asyncio.sleep(0.1)
        if not self._post_url:
            raise RuntimeError("未获得 MCP SSE endpoint（超时）")

        # 2. initialize 握手（id=1）
        self._pending.add(1)
        try:
            await self._post_client.post(self._post_url, json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {},
                    "clientInfo": {"name": "OfferPilotMCPClient", "version": "1.0.0"},
                },
            })
            for _ in range(25):
                if 1 in self._responses:
                    break
                await asyncio.sleep(0.1)
            # 3. notifications/initialized
            await self._post_client.post(
                self._post_url, json={"jsonrpc": "2.0", "method": "notifications/initialized"}
            )
        finally:
            self._pending.discard(1)
            self._responses.pop(1, None)

        self._initialized = True
        logger.info("[mcp] WebSearch MCP 会话已建立（复用）")

    async def _ensure(self):
        if self._healthy():
            return
        async with self._lock:
            if self._healthy():
                return
            await self._connect_locked()

    async def call_search(self, query: str, count: int) -> str:
        await self._ensure()
        rid = next(self._ids)
        self._pending.add(rid)
        try:
            await self._post_client.post(self._post_url, json={
                "jsonrpc": "2.0",
                "id": rid,
                "method": "tools/call",
                "params": {"name": "wsa-SearchPro", "arguments": {"Query": query}},
            })
            # 轮询自己的 id；外层 wait_for 会更早取消（取消时下方 finally 只 pop id，不拆连接）
            for _ in range(300):
                if rid in self._responses:
                    break
                await asyncio.sleep(0.1)

            res_obj = self._responses.get(rid)
            if not res_obj:
                logger.warning("[mcp] tools/call 未在规定时间内返回")
                return ""
            if "error" in res_obj:
                err_msg = res_obj["error"].get("message", "")
                logger.warning(f"[mcp] MCP 返回错误: {err_msg}")
                return f"（腾讯云联网检索提示: {err_msg}）"
            content_items = res_obj.get("result", {}).get("content", [])
            if not content_items:
                return "（未找到相关互联网搜索结果）"
            raw_text = content_items[0].get("text", "")
            return _format_tencent_search_json(raw_text, count)
        finally:
            self._pending.discard(rid)
            self._responses.pop(rid, None)

    async def _teardown(self):
        """有界地拆掉当前连接（仅进程退出或重连时调用，不在单次取消路径里跑）。"""
        if self._listener is not None and not self._listener.done():
            self._listener.cancel()
            try:
                await asyncio.wait_for(asyncio.shield(self._listener), timeout=1.0)
            except Exception:
                pass
        for client in (self._post_client, self._sse_client):
            if client is not None:
                try:
                    await asyncio.wait_for(client.aclose(), timeout=1.0)
                except Exception:
                    pass
        self._listener = None
        self._sse_client = None
        self._post_client = None
        self._post_url = None
        self._initialized = False


# 进程内单例（按 URL 绑定；绑定创建时所在的事件循环，uvicorn 单循环下安全）
_session: Optional[_McpSseSession] = None


async def search_web(query: str, count: int = 5) -> str:
    """调用联网搜索工具。通过标准 MCP Protocol (over SSE) 与腾讯云 WebSearch MCP 通信。

    内部复用一条常驻 MCP 会话（避免每次重新握手）。被外层 wait_for 取消时，
    仅放弃本次等待，不会拆共享连接 —— 取消可在阈值内干净返回。
    """
    global _session

    tc_url = getattr(settings, "TENCENT_MCP_SEARCH_URL", "") or "https://mcp-api.tencent-cloud.com/sse/c2453837744fd833"
    if not tc_url:
        return "（未配置腾讯云 WebSearch MCP 端点，已降级为纯大模型推理）"

    if _session is None or _session.sse_url != tc_url:
        _session = _McpSseSession(tc_url)

    try:
        res = await _session.call_search(query, count)
        if res:
            return res
    except asyncio.CancelledError:
        # 让外层 wait_for 干净取消（不吞异常、不拆连接）
        raise
    except Exception as e:
        logger.warning(f"[mcp] WebSearch MCP 调用异常，降级为纯大模型推理: {e!r}")
        # 出错多半意味着连接坏了，重置以便下次重连
        try:
            await _session._teardown()
        except Exception:
            pass

    return "（腾讯云联网检索不可用，已降级为纯大模型推理）"


async def close_web_search_session():
    """进程关闭时可调用，主动拆掉常驻 MCP 会话（可选，进程退出本身也会释放）。"""
    global _session
    if _session is not None:
        try:
            await _session._teardown()
        except Exception:
            pass
        _session = None


def _format_tencent_search_json(raw_text: str, count: int = 5) -> str:
    """将腾讯云 WebSearch 返回的原始 JSON/文本转换为优雅的 Markdown 链接与摘要列表"""
    if not raw_text:
        return "（未找到相关互联网搜索结果）"

    try:
        data = json.loads(raw_text)
        # 腾讯云原生结构: {"Response": {"Pages": ["{\"title\":..., \"url\":..., \"passage\":...}"]}}
        pages_raw = data.get("Response", {}).get("Pages", [])
        if pages_raw:
            formatted_lines = []
            for i, page_str in enumerate(pages_raw[:count], 1):
                try:
                    p = json.loads(page_str) if isinstance(page_str, str) else page_str
                    title = (p.get("title") or "网页搜索结果").strip()
                    page_url = p.get("url") or ""
                    snippet = (p.get("passage") or p.get("snippet") or "").strip()
                    site = p.get("site") or ""
                    site_str = f" (来源: {site})" if site else ""
                    formatted_lines.append(f"{i}. [{title}]({page_url}){site_str}\n   摘要: {snippet}")
                except Exception:
                    continue
            if formatted_lines:
                return "\n\n".join(formatted_lines)
    except Exception:
        pass

    return raw_text[:2000]
