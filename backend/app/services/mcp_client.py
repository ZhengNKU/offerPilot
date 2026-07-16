import logging
import json
import httpx
from app.config import settings

logger = logging.getLogger(__name__)

async def search_web(query: str, count: int = 5) -> str:
    """调用阿里云百炼 MCP 网页搜索工具，返回格式化后的 Markdown 搜索结果文本"""
    # 优先从 settings 读取（pydantic-settings 自动从 .env 读），其次 OS 环境变量
    api_key = getattr(settings, "DASHSCOPE_API_KEY", "") or ""
    if not api_key:
        import os
        api_key = os.getenv("DASHSCOPE_API_KEY", "")

    if not api_key:
        logger.warning(
            "[mcp] DASHSCOPE_API_KEY 未配置，联网检索降级为不返回。"
            "LLM 看到此降级文本后会改成本地回答。"
        )
        return "（联网检索暂不可用：未配置 DASHSCOPE_API_KEY）"

    url = "https://dashscope.aliyuncs.com/api/v1/mcps/WebSearch/mcp"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }
    payload = {
        "jsonrpc": "2.0",
        "method": "tools/call",
        "params": {
            "name": "bailian_web_search",
            "arguments": {
                "query": query,
                "count": count
            }
        },
        "id": 1
    }
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(url, headers=headers, json=payload)
            if resp.status_code != 200:
                logger.error(f"[mcp] 阿里 WebSearch MCP 响应非 200: {resp.status_code} {resp.text}")
                return ""
            
            data = resp.json()
            # 兼容处理返回格式
            if "error" in data:
                logger.error(f"[mcp] MCP 调用返回错误: {data['error']}")
                return ""

            result = data.get("result", {})
            content_list = result.get("content", [])
            if not content_list:
                return "（未找到相关互联网搜索结果）"

            content_text = content_list[0].get("text", "")
            if not content_text:
                return "（未找到相关互联网搜索结果）"

            try:
                pages_data = json.loads(content_text)
                pages = pages_data.get("pages", [])
                if not pages:
                    return "（未找到相关互联网搜索结果）"
                
                formatted_lines = []
                for i, p in enumerate(pages, 1):
                    title = p.get("title", "无标题").strip()
                    page_url = p.get("url", "")
                    hostname = p.get("hostname", "")
                    snippet = p.get("snippet", "").strip()
                    # 替换掉可能导致 Markdown 解析异常的奇怪字符，特别是 \x00 等
                    title = title.replace("\x00", "").replace("\ufffd", "")
                    snippet = snippet.replace("\x00", "").replace("\ufffd", "")
                    
                    source_str = f" (来源: {hostname})" if hostname else ""
                    formatted_lines.append(f"{i}. [{title}]({page_url}){source_str}\n   摘要: {snippet}")
                return "\n\n".join(formatted_lines)
            except Exception as je:
                logger.warning(f"[mcp] 解析 WebSearch content text JSON 失败: {je!r}")
                # 兜底直接返回 content_text
                return content_text[:2000]
    except Exception as e:
        logger.error(f"[mcp] 调用 阿里 WebSearch MCP 失败: {e!r}")
        return ""
