"""阿里百炼 Embedding API 客户端（AI 职业顾问 RAG 用）。

Qwen3-Embedding（text-embedding-v4），走 OpenAI 兼容协议 /v1/embeddings，
复用同一把 DASHSCOPE_API_KEY（与 MCP 联网搜索同 key）。

模型特性：
  - 对称嵌入（同空间），不再区分写入 / 查询
  - 可选维度：2048 / 1536 / 1024(默认) / 768 / 512 / 256 / 128 / 64
  - 我们的代码固定 1536 维，与原 pgvector Vector(1536) 列保持兼容
  - 单批上限 10 条
"""
import asyncio
import logging
import time
from typing import Optional
import httpx
from app.config import settings

logger = logging.getLogger(__name__)

# ── 进程级令牌桶（节流用，避免瞬时打爆 QPS） ──
_BUCKET: dict = {"tokens": float(settings.EMBEDDING_QPS), "ts": time.monotonic()}
_BUCKET_LOCK = asyncio.Lock()


async def _take_token() -> None:
    """阻塞直到获得 1 个令牌。"""
    async with _BUCKET_LOCK:
        while True:
            now = time.monotonic()
            elapsed = now - _BUCKET["ts"]
            _BUCKET["tokens"] = min(
                float(settings.EMBEDDING_QPS),
                _BUCKET["tokens"] + elapsed * settings.EMBEDDING_QPS,
            )
            _BUCKET["ts"] = now
            if _BUCKET["tokens"] >= 1:
                _BUCKET["tokens"] -= 1
                return
            _BUCKET_LOCK.release()
            try:
                await asyncio.sleep(0.05)
            finally:
                _BUCKET_LOCK.acquire()


async def _call_dashscope_embeddings(
    texts: list[str],
) -> list[list[float]]:
    """调用阿里百炼 OpenAI 兼容 /v1/embeddings。

    Args:
        texts: 待嵌入的文本列表（每条 ≤ 8192 token，留余量 → 见 truncate_to_token_limit）

    Returns:
        向量列表，每条 EMBEDDING_DIM 维（默认 1536），与输入顺序一一对应

    Raises:
        RuntimeError: API 返回业务错误
        httpx.TimeoutException / httpx.ConnectError: 网络异常（由调用方重试）
    """
    if not settings.DASHSCOPE_API_KEY:
        raise RuntimeError("DASHSCOPE_API_KEY 未配置，请在 .env 中填入阿里百炼 API Key")

    url = f"{settings.DASHSCOPE_EMBEDDING_BASE_URL.rstrip('/')}/embeddings"
    headers = {
        "Authorization": f"Bearer {settings.DASHSCOPE_API_KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": settings.DASHSCOPE_EMBEDDING_MODEL,
        "input": texts,                 # OpenAI 兼容：单字符串或字符串列表都行
        "encoding_format": "float",     # 明确要 float，避免 base64
        # 不传 dimensions：用 model 默认输出维度（DASHSCOPE_EMBEDDING_DIM）
        # 若需自定义维度，加 "dimensions": settings.DASHSCOPE_EMBEDDING_DIM
    }
    # 但 OpenAI / DashScope 兼容都支持自定义 dimensions；既然默认就是 1536，
    # 显式传也没坏处：
    payload["dimensions"] = settings.DASHSCOPE_EMBEDDING_DIM

    async with httpx.AsyncClient(timeout=settings.EMBEDDING_TIMEOUT_S) as client:
        resp = await client.post(url, headers=headers, json=payload)

    if resp.status_code != 200:
        # 阿里百炼典型错误：401 鉴权失败 / 429 限流 / 400 输入超限
        raise RuntimeError(
            f"DashScope embedding error: status={resp.status_code} "
            f"body={resp.text[:500]}"
        )

    data = resp.json()
    # OpenAI 兼容返回: {"data":[{"embedding":[...], "index":0}, ...], "model":"...", "usage":{...}}
    items = data.get("data") or []
    if len(items) != len(texts):
        raise RuntimeError(
            f"DashScope embedding 返回向量数 ({len(items)}) "
            f"与请求文本数 ({len(texts)}) 不一致"
        )
    # 按 index 排序（OpenAI 兼容协议规定 data 数组按 index 排序，但保险起见）
    items = sorted(items, key=lambda x: x.get("index", 0))
    return [item["embedding"] for item in items]


async def _call_with_retry(
    texts: list[str],
    max_attempts: int = 4,
) -> list[list[float]]:
    """带指数退避的重试：401 / 429 / 5xx / 网络异常。"""
    last_exc: Optional[Exception] = None
    for attempt in range(max_attempts):
        await _take_token()
        try:
            return await _call_dashscope_embeddings(texts)
        except RuntimeError as e:
            err_str = str(e)
            last_exc = e
            # 鉴权失败 / 输入非法 → 不重试
            if "status=401" in err_str or "status=400" in err_str:
                raise
            # 限流 / 5xx / 其他 → 指数退避
            if attempt < max_attempts - 1:
                wait = 1.5 * (2 ** attempt)
                logger.warning(
                    f"[embedding] 失败 retry {attempt+1}/{max_attempts-1} "
                    f"after {wait:.1f}s: {err_str[:200]}"
                )
                await asyncio.sleep(wait)
        except (httpx.TimeoutException, httpx.ConnectError) as e:
            last_exc = e
            if attempt < max_attempts - 1:
                wait = 1.5 * (2 ** attempt)
                logger.warning(
                    f"[embedding] 网络异常 retry {attempt+1}/{max_attempts-1} "
                    f"after {wait:.1f}s: {e!r}"
                )
                await asyncio.sleep(wait)
    raise last_exc if last_exc else RuntimeError("embedding call exhausted retries")


# ── 业务函数：调用方按用途选 ──
# Qwen 对称嵌入（不区分 db/query），但函数名保留以兼容业务调用方：
#   embed_for_storage —— 写入向量库时用（type=db 历史叫法）
#   embed_for_query   —— 检索时用（type=query 历史叫法）
# 两者实现完全相同（同一空间），仅保留两套 API 避免改动 5 个调用方。

async def embed_for_storage(texts: list[str]) -> list[list[float]]:
    """写入向量库时用：自动按 EMBEDDING_BATCH_SIZE 切批。返回顺序与输入一一对应。"""
    if not texts:
        return []
    out: list[list[float]] = []
    for i in range(0, len(texts), settings.EMBEDDING_BATCH_SIZE):
        batch = texts[i:i + settings.EMBEDDING_BATCH_SIZE]
        # 单批重试（如果整批失败，单独重试每条便于定位问题）
        try:
            vecs = await _call_with_retry(batch)
        except Exception as e:
            logger.error(
                f"[embedding] embed_for_storage 整批失败 (len={len(batch)}),"
                f"逐条降级重试: {e!r}"
            )
            for t in batch:
                v = await _call_with_retry([t])
                out.append(v[0])
            continue
        out.extend(vecs)
    return out


async def embed_for_query(text: str) -> list[float]:
    """检索文本时用：返回单条向量。"""
    vecs = await _call_with_retry([text])
    return vecs[0]


def truncate_to_token_limit(text: str, max_tokens: int = 24000) -> str:
    """保守按「1 token ≈ 1.5 个中文字」估算，超长直接截断。

    Qwen text-embedding-v4 单条上限 8192 token，留 1000+ token 余量给安全边界，
    上限提到 24000 是为了覆盖最长的面试 transcript / 简历分析 chunk。
    实际更精准的做法是按 token 数 tokenizer 截断，但 minilm + 中文场景下
    字符数除以 1.5 是足够的估算（保守不会超）。
    """
    if not text:
        return text
    max_chars = int(max_tokens * 1.5)
    if len(text) <= max_chars:
        return text
    return text[:max_chars]
