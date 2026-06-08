import requests
import logging
import asyncio
import json
import re
from typing import Dict, Any, Optional, List
from app.config import settings

logger = logging.getLogger(__name__)

def call_minimax_sync(payload: dict) -> dict:
    url = f"{settings.MINIMAX_BASE_URL}/chat/completions"
    headers = {
        "Authorization": f"Bearer {settings.MINIMAX_API_KEY}",
        "Content-Type": "application/json"
    }
    # 120s: long transcripts (e.g. 89 segments) can take well over 30s for
    # reasoning models to finish; 30s caused "Read timed out" in sectionize.
    response = requests.post(url, headers=headers, json=payload, timeout=120.0)
    response.raise_for_status()
    return response.json()


def _strip_codeblock(text: str) -> str:
    """Strip fences so json.loads can parse the body. Two kinds of fences show
    up in LLM output:
      1) <think>...</think>  — MiniMax-M3 (and most reasoning models) prefix
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
        content_clean = _strip_codeblock(content)
        parsed_data = json.loads(content_clean)
        return parsed_data
    except Exception as e:
        logger.error(f"Failed calling MiniMax API: {str(e)}")

    return {}


async def sectionize_transcript(segments: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Use MiniMax-M3 to semantically split a transcript (list of ASR segments)
    into 3-8 topical sections like 「自我介绍」「项目深挖」「Redis 追问」.

    Input  segments: [{start_time, end_time, speaker, content}, ...]  (seconds)
    Output sections:  [{title, category, tag, start_time, end_time, summary}, ...]

    IMPORTANT contract: start_time / end_time in output MUST be picked from
    the input segment timestamps. The function enforces this by snapping any
    out-of-range value to the nearest known segment boundary, and discards
    sections that don't overlap any segment.
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
        "model": "MiniMax-M3",
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user",   "content": user_content},
        ],
        "response_format": {"type": "json_object"},
    }

    raw_sections: List[Dict[str, Any]] = []
    try:
        res_data = await asyncio.to_thread(call_minimax_sync, payload)
        content = res_data["choices"][0]["message"]["content"]
        content_clean = _strip_codeblock(content)
        # DEBUG: log raw content to diagnose empty-content returns
        logger.info(f"[sectionize] raw content (first 300): {content_clean[:300]!r}")
        parsed = json.loads(content_clean)
        if isinstance(parsed, dict):
            raw_sections = parsed.get("sections") or []
        elif isinstance(parsed, list):
            raw_sections = parsed
    except Exception as e:
        logger.error(f"[sectionize] MiniMax call failed: {e}")
        # Dump the whole response so we can see what LLM actually returned
        try:
            logger.error(f"[sectionize] raw response_data dump: {json.dumps(res_data, ensure_ascii=False)[:2000]}")
        except Exception:
            logger.error(f"[sectionize] raw response_data (no json): {res_data!r}")
        return []

    if not raw_sections:
        logger.warning("[sectionize] MiniMax returned no sections")
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


async def generate_section_optimization_advice(dialogue_text: str) -> Dict[str, Any]:
    """
    Generate diagnostic conclusion, candidate original answer, and high-score answer recommendation.
    """
    system_prompt = (
        "你是一个顶尖的大厂架构师和 AI 面试教练。你需要对下面这段面试对话中候选人的回答进行深度诊断，并生成优化建议。\n"
        "你需要提供三个部分：\n"
        "1. AI 诊断结论：指出候选人回答中的核心技术漏洞、不完美的设计选择、或者表达欠缺（比如对于提到的技术点指出其优缺点或潜在问题）。字数 80-150 字。\n"
        "2. 候选人原版回答：从对话中提取或提炼出候选人的主要回答内容，保持其口语化和原样。\n"
        "3. 大厂架构师版高分话术推荐：编写一个近乎完美、符合大厂架构师/高级开发期望的回答话术，突出技术深度、Trade-off 权衡、真实项目经验、以及正确的解决方案。字数 150-300 字，可以包含对核心概念的强调（不要使用 Markdown 标记；如需高亮关键词，请使用 <strong class='text-[#5DECCB] font-black'> 与 </strong>，注意 HTML 属性必须用单引号；可以合理使用 <br /><br /> 换行分段）。\n"
        "\n"
        "你必须返回严格符合以下结构的 JSON 对象（不要包含任何 Markdown 标记或其它前后导言，只返回纯 JSON 对象）：\n"
        "{\n"
        "  \"conclusion\": \"AI 诊断结论内容...\",\n"
        "  \"original\": \"候选人原版回答内容...\",\n"
        "  \"optimized\": \"大厂架构师版高分话术推荐内容...\"\n"
        "}"
    )

    payload = {
        "model": "MiniMax-M3",
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"面试对话片段：\n{dialogue_text}"}
        ],
        "response_format": {"type": "json_object"}
    }

    try:
        res_data = await asyncio.to_thread(call_minimax_sync, payload)
        content = res_data["choices"][0]["message"]["content"]
        content_clean = _strip_codeblock(content)
        parsed_data = json.loads(content_clean)
        return parsed_data
    except Exception as e:
        logger.error(f"Failed to generate optimization advice: {e}")
        return {
            "conclusion": "分析失败，请稍后重试",
            "original": "无法提取原版回答",
            "optimized": "暂无高分话术推荐"
        }


async def generate_transcript_highlights(segments: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Calls MiniMax-M3 LLM to analyze candidate's utterances, returning highlights
    with type ('strength', 'risk', 'tech') and 'tip' explanation.
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
        "model": "MiniMax-M3",
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"对话列表：\n{dialogue_text}"}
        ],
        "response_format": {"type": "json_object"}
    }

    try:
        res_data = await asyncio.to_thread(call_minimax_sync, payload)
        content = res_data["choices"][0]["message"]["content"]
        content_clean = _strip_codeblock(content)
        parsed = json.loads(content_clean)
        return parsed.get("highlights") or []
    except Exception as e:
        logger.error(f"Failed to generate highlights: {e}")
        return []


def call_minimax_stream(payload: dict, timeout: float = 300.0) -> dict:
    """
    流式调用 MiniMax API，把所有 chunk 拼接后返回与非流式格式一致的 dict。
    用于：简历分析等长输出场景，避免 MiniMax 网关 ~90s 的 idle timeout
    在推理 + 大 JSON 输出过程中主动断开连接（RemoteDisconnected）。
    """
    url = f"{settings.MINIMAX_BASE_URL}/chat/completions"
    headers = {
        "Authorization": f"Bearer {settings.MINIMAX_API_KEY}",
        "Content-Type": "application/json"
    }
    stream_payload = {**payload, "stream": True}
    content_parts: list[str] = []
    with requests.post(
        url, headers=headers, json=stream_payload, timeout=timeout,
        proxies={"http": None, "https": None}, stream=True,
    ) as resp:
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


async def analyze_resume_text(resume_text: str, profile_data: Optional[dict] = None) -> Dict[str, Any]:
    """
    Calls MiniMax LLM to analyze the extracted resume text and return structured analysis in JSON.
    使用流式调用绕开 MiniMax 网关 ~90s 的 idle timeout，禁用系统代理。
    """
    system_prompt = (
        "你是一个专业的 AI 简历分析教练。你的任务是对候选人的简历进行深度雷区检测与优化建议。\n"
        "你需要根据提取出的简历文本内容，结合候选人的求职期望画像（如果提供了），完成以下工作：\n"
        "1. 计算简历综合评分（0-100，当前表现）以及优化后预计提升的综合评分（0-100）。\n"
        "2. 计算大厂 ATS 机器可读性通过率百分比（0-100）。\n"
        "3. 提取候选人基础档案：姓名、求职状态、当前职级职位、工作年限、当前公司、当前岗位、当前薪资；并结合目标画像提取目标公司、目标岗位、目标职级、目标薪资。\n"
        "4. 重构并优化工作经历（work_experiences）：\n"
        "   - 对于工作经历中的每一条核心描述（bullets），同时保留原始描述（originalText）和优化后的描述（optimizedText）。\n"
        "   - 给出该描述在原始简历中的诊断风险（originalTag 为 '风险'，originalDesc 说明缺失或问题所在；或者 originalTag 为 '亮点'）并赋予对应样式类名。\n"
        "   - 给出优化后的标签（optimizedTag 为 '已优化'）与样式类名。\n"
        "5. 诊断并列出简历中的所有风险点（risks），包含风险标题、详细说明、严重程度（高风险/中风险/低风险）。\n"
        "6. 进行目标岗位画像匹配度分析（match_analysis），包括匹配得分、文字说明、具体各维度的覆盖情况（coverages）。\n"
        "7. 输出简历优化的核心AI建议（optimization_suggestions），每条建议包含标题和详细描述。\n"
        "8. 分析关键词覆盖率（keywords_analysis），找出已覆盖的高频词（current_keywords）和推荐补齐的核心行业热点词（recommended_keywords）。\n"
        "9. 提供 ATS 兼容性各项检测指标结果（ats_checks），每一项包括检测名、状态（通过/警告）及具体指标评分情况。\n"
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
        "          \"originalTagClass\": \"text-[#FF7A95] bg-[#FF7A95]/10 border-[#FF7A95]/20\", \n"
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
        "  ]\n"
        "}"
    )

    user_content = f"简历文本内容：\n{resume_text}\n"
    if profile_data:
        user_content += f"\n求职期望画像信息：\n{json.dumps(profile_data, ensure_ascii=False)}\n"

    payload = {
        "model": "MiniMax-M3",
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content}
        ],
        "response_format": {"type": "json_object"}
    }

    try:
        logger.info(f"[resume] analyzing resume_text len={len(resume_text)} chars")
        res_data = await asyncio.to_thread(call_minimax_stream, payload, 300.0)
        content = res_data["choices"][0]["message"]["content"]
        logger.info(f"[resume] received content len={len(content)} chars")
        content_clean = _strip_codeblock(content)
        parsed_data = json.loads(content_clean)
        return parsed_data
    except Exception as e:
        logger.error(f"Failed to analyze resume via MiniMax: {e}")
        return {}
