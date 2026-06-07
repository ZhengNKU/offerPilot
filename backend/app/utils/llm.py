import requests
import logging
import asyncio
import json
from typing import Dict, Any, Optional
from app.config import settings

logger = logging.getLogger(__name__)

def call_minimax_sync(payload: dict) -> dict:
    url = f"{settings.MINIMAX_BASE_URL}/chat/completions"
    headers = {
        "Authorization": f"Bearer {settings.MINIMAX_API_KEY}",
        "Content-Type": "application/json"
    }
    response = requests.post(url, headers=headers, json=payload, timeout=30.0)
    response.raise_for_status()
    return response.json()

async def analyze_interview_dialogue(dialogue_text: str, profile_data: Optional[dict] = None) -> Dict[str, Any]:
    """
    Calls MiniMax-M3 API to analyze the interview dialogue and return evaluation results in JSON.
    """
    system_prompt = (
        "你是一个专业的 AI 面试教练。你需要根据候选人的面试对话内容进行深度评估。\n"
        "如果提供了候选人的职业画像（工作经验、岗位名称、目标公司、目标职级等），请结合该画像的期望要求进行评估。\n"
        "你必须以 JSON 格式返回评估结果，无需任何 Markdown 标记或其它多余的前后导言，只返回纯 JSON 对象字符串。\n"
        "JSON 结构必须严格符合以下属性格式：\n"
        "{\n"
        "  \"ipi_score\": 75, // 综合素质评分（0-100之间的整数）\n"
        "  \"offer_probability\": 60, // 拿到Offer的概率百分比（0-100之间的整数）\n"
        "  \"summary_strengths\": [\"优势1\", \"优势2\"], // 优势列表（2个）\n"
        "  \"summary_weaknesses\": [\"不足1\", \"不足2\"], // 不足列表（2个）\n"
        "  \"summary_suggestions\": [\"改进建议1\", \"改进建议2\"], // 建议列表（2个）\n"
        "  \"executive_summary\": \"一段简短的综合性总结评价...\"\n"
        "}"
    )
    
    user_content = f"面试对话内容：\n{dialogue_text}\n"
    if profile_data:
        user_content += f"\n候选人画像：\n{json.dumps(profile_data, ensure_ascii=False)}\n"
        
    payload = {
        "model": "MiniMax-M3",
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content}
        ],
        "response_format": {"type": "json_object"}
    }
    
    try:
        res_data = await asyncio.to_thread(call_minimax_sync, payload)
        content = res_data["choices"][0]["message"]["content"]
        
        # Strip code block symbols if model returned them despite system instructions
        content_clean = content.strip()
        if content_clean.startswith("```"):
            lines = content_clean.split("\n")
            if lines[0].startswith("```json") or lines[0].startswith("```"):
                content_clean = "\n".join(lines[1:-1]).strip()
        
        parsed_data = json.loads(content_clean)
        return parsed_data
    except Exception as e:
        logger.error(f"Failed calling MiniMax API: {str(e)}")
        
    return {}
