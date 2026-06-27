"""MiniMax Embedding API 客户端（AI 职业顾问 RAG 用）。

核心约束（必须严格遵守，否则召回质量雪崩）：
  - `type=db`：被检索文本（写入向量库时用此类型）
  - `type=query`：检索文本（用户提问时用此类型）
  - 两者属于不同向量空间，**不能混用**

模型：embo-01，维度 1536
端点：https://api.minimax.chat/v1/embeddings?GroupId={MINIMAX_GROUP_ID}
鉴权：Authorization: Bearer {MINIMAX_API_KEY}

错误码：
  - 1001：超时
  - 1002：限流
  - 1004：鉴权失败
  - 1013：非法字符超过 10%
  - 2013：输入格式信息不正常

距离算子：使用 pgvector 的 cosine 距离 `<=>`（因 MiniMax 向量未做 L2 归一化）
"""
import asyncio
import logging
import time
from typing import Literal, Optional
import httpx
from app.config import settings

logger = logging.getLogger(__name__)

# ── 进程级令牌桶（embo-01 默认 QPS 较低） ──
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
            # 释放锁 + 短暂 sleep，再重试
            _BUCKET_LOCK.release()
            try:
                await asyncio.sleep(0.05)
            finally:
                await _BUCKET_LOCK.acquire()


async def _call_minimax_embeddings(
    texts: list[str],
    emb_type: Literal["db", "query"],
) -> list[list[float]]:
    """调用 MiniMax /v1/embeddings。

    Args:
        texts: 文本列表（每条 ≤4096 token）
        emb_type: 必须是 'db'（写入向量库）或 'query'（检索）

    Returns:
        向量列表，每条 1536 维

    Raises:
        RuntimeError: API 返回错误
        httpx.TimeoutException / httpx.ConnectError: 网络异常（由调用方重试）
    """
    if not settings.MINIMAX_GROUP_ID:
        raise RuntimeError("MINIMAX_GROUP_ID 未配置，请在 .env 中填入控制台分配的 GroupId")
    if emb_type not in ("db", "query"):
        raise ValueError(f"emb_type 必须是 'db' 或 'query'，收到: {emb_type!r}")

    url = f"{settings.MINIMAX_EMBEDDING_URL}?GroupId={settings.MINIMAX_GROUP_ID}"
    headers = {
        "Authorization": f"Bearer {settings.MINIMAX_API_KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": settings.EMBEDDING_MODEL,
        "texts": texts,
        "type": emb_type,
    }

    async with httpx.AsyncClient(timeout=settings.EMBEDDING_TIMEOUT_S) as client:
        resp = await client.post(url, headers=headers, json=payload)
    data = resp.json()
    if resp.status_code != 200 or "vectors" not in data:
        code = (data.get("base_resp") or {}).get("status_code")
        msg = (data.get("base_resp") or {}).get("status_msg", "")
        raise RuntimeError(
            f"MiniMax embedding error: status={resp.status_code} "
            f"code={code} msg={msg} body={str(data)[:300]}"
        )

    vectors = data["vectors"]
    if len(vectors) != len(texts):
        raise RuntimeError(
            f"MiniMax embedding 返回向量数 ({len(vectors)}) "
            f"与请求文本数 ({len(texts)}) 不一致"
        )
    return vectors


async def _call_with_retry(
    texts: list[str],
    emb_type: Literal["db", "query"],
    max_attempts: int = 4,
) -> list[list[float]]:
    """带指数退避的重试：1001 超时 / 1002 限流 / 网络异常。"""
    last_exc: Optional[Exception] = None
    for attempt in range(max_attempts):
        await _take_token()
        try:
            return await _call_minimax_embeddings(texts, emb_type)
        except RuntimeError as e:
            err_str = str(e)
            last_exc = e
            # 鉴权失败 (1004) / 非法字符 (1013) / 输入格式错 (2013) → 不重试
            if any(code in err_str for code in ("code=1004", "code=1013", "code=2013")):
                raise
            # 限流 / 超时 / 其他 → 指数退避
            if attempt < max_attempts - 1:
                wait = 1.5 * (2 ** attempt)
                logger.warning(
                    f"[embedding] {emb_type} 失败 retry {attempt+1}/{max_attempts-1} "
                    f"after {wait:.1f}s: {err_str[:200]}"
                )
                await asyncio.sleep(wait)
        except (httpx.TimeoutException, httpx.ConnectError) as e:
            last_exc = e
            if attempt < max_attempts - 1:
                wait = 1.5 * (2 ** attempt)
                logger.warning(
                    f"[embedding] {emb_type} 网络异常 retry {attempt+1}/{max_attempts-1} "
                    f"after {wait:.1f}s: {e!r}"
                )
                await asyncio.sleep(wait)
    raise last_exc if last_exc else RuntimeError("embedding call exhausted retries")


# ── 业务函数：调用方必须按用途选对 type ──

async def embed_for_storage(texts: list[str]) -> list[list[float]]:
    """写入向量库时用：type=db。

    自动按 EMBEDDING_BATCH_SIZE 切批。返回顺序与输入顺序一一对应。
    """
    if not texts:
        return []
    out: list[list[float]] = []
    for i in range(0, len(texts), settings.EMBEDDING_BATCH_SIZE):
        batch = texts[i:i + settings.EMBEDDING_BATCH_SIZE]
        # 单批重试（如果整批失败，单独重试每条便于定位问题）
        try:
            vecs = await _call_with_retry(batch, emb_type="db")
        except Exception as e:
            logger.error(
                f"[embedding] embed_for_storage 整批失败 (len={len(batch)})，"
                f"逐条降级重试: {e!r}"
            )
            for t in batch:
                v = await _call_with_retry([t], emb_type="db")
                out.append(v[0])
            continue
        out.extend(vecs)
    return out


async def embed_for_query(text: str) -> list[float]:
    """用户提问时用：type=query。返回单条 1536 维向量。"""
    vecs = await _call_with_retry([text], emb_type="query")
    return vecs[0]


def truncate_to_token_limit(text: str, max_tokens: int = 3800) -> str:
    """保守按「1 token ≈ 1.5 个中文字」估算，超长直接截断。

    embo-01 单条上限 4096 token，留 288 token 余量给安全边界。
    """
    if not text:
        return text
    max_chars = int(max_tokens * 1.5)
    if len(text) <= max_chars:
        return text
    return text[:max_chars]
