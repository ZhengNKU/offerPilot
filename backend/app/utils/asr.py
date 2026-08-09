"""
ASR utility — 阿里百炼 Paraformer-v2 文件转写 (2026-08-02+)

替换原因:原 Volc 大模型 ASR 在 1 万段 / 30 分钟音频上要 166s,改成
Paraformer-v2 实测 ~55s,降一个数量级。该模型支持说话人分离
(diarization_enabled + speaker_count) 和句子级时间戳,与原 Volc 输出字段
完全兼容。

调用姿势 (官方示例):
    from dashscope.audio.asr import Transcription
    resp = Transcription.async_call(
        model='paraformer-v2',
        file_urls=[audio_url],
        language_hints=['zh', 'en'],
        diarization_enabled=True,   # 开启说话人分离 (CAM++)
        speaker_count=2,             # 面试场景固定 2 人
    )
    final = Transcription.wait(task=resp.output.task_id)
    # 拉每个 subtask 的 transcription_url(JSON 全文)
    for r in final.output['results']:
        if r['subtask_status'] == 'SUCCEEDED':
            full = json.loads(request.urlopen(r['transcription_url']).read())

返回 JSON 结构 (DashScope filetrans 约定):
    {
      "transcripts": [
        {
          "channel_id": 0,
          "text": "完整文本...",
          "sentences": [
            {
              "text": "你好,请介绍一下你自己。",
              "begin_time": 0,    # 毫秒
              "end_time": 3260,
              "speaker_id": 0,    # 0/1/2... 0 = 第一个说话人
              "channel_id": 0
            },
            ...
          ]
        }
      ],
      ...
    }

说话人约定:Paraformer-v2 习惯,speaker_id 0 = 第一个出现的说话人。
我们的 _determine_speaker_mapping 把第一个说话人映射为 Interviewer,
其余映射为 Candidate —— 与 Volc 的 speaker_id 0=Interviewer 约定兼容,
不需要再调整下游。

实现要点:
  - dashscope SDK 不是 OpenAI-compatible,必须装 dashscope pip 包
  - WorkspaceId 通过 .env 配置,不同地域 base_url 不同(默认 cn-beijing)
  - 提交 + 同步等 (Transcription.wait) 最长 ~5 min,适合长音频
  - 输出从 transcription_url 拉取(JSON 存 OSS,有时效,任务完成后立即拉)
"""
import json
import logging
import os
import time
from typing import List, Dict, Any
from http import HTTPStatus
from urllib import request as urlrequest

import dashscope
from dashscope.audio.asr import Transcription

from app.config import settings

logger = logging.getLogger(__name__)

# 把 dashscope SDK 自身的 logger 提到 WARNING,屏蔽掉 "The task ... is RUNNING" 这种
# 每次轮询都刷一行的高频 INFO 日志。我们下面用自定义轮询 + 间隔汇报进度,
# 既省日志又能看到真实等待时间。
logging.getLogger("dashscope").setLevel(logging.WARNING)

# 默认 base_url:北京地域 + WorkspaceId。模型是 paraformer-v2,
# 走 MaaS 接口,需要 WorkspaceId 才能路由到对应业务空间。
_DEFAULT_ASR_BASE_URL_TEMPLATE = "https://{workspace_id}.cn-beijing.maas.aliyuncs.com/api/v1"

# 手动轮询配置(替代 Transcription.wait 默认每 5s 一次的固定节奏)
_ASR_POLL_INTERVAL_S = 3.0           # 单次轮询间隔
_ASR_POLL_INTERVAL_LONG_S = 5.0      # 长音频(>10 分钟)用更慢的间隔,减 SDK 压力
_ASR_PROGRESS_REPORT_S = 20.0        # 每 20s 汇报一次进度,而不是按次数汇报
_ASR_WAIT_TIMEOUT_S = 300            # 硬上限 5 分钟,超时即放弃防卡死


def _setup_dashscope_for_asr() -> None:
    """配置 dashscope SDK 的 api_key 和 base_url。

    必须带 WorkspaceId 的地域化 base_url,否则会路由到默认全局域,
    鉴权失败。
    """
    dashscope.api_key = settings.DASHSCOPE_API_KEY or os.getenv("DASHSCOPE_API_KEY", "")
    workspace_id = settings.DASHSCOPE_WORKSPACE_ID or os.getenv(
        "DASHSCOPE_WORKSPACE_ID", ""
    )
    if workspace_id:
        dashscope.base_http_api_url = _DEFAULT_ASR_BASE_URL_TEMPLATE.format(
            workspace_id=workspace_id
        )
        logger.info(
            f"[DashScope ASR] base_url={dashscope.base_http_api_url}, workspace={workspace_id}"
        )
    else:
        logger.warning(
            "[DashScope ASR] DASHSCOPE_WORKSPACE_ID 未配置,使用默认全局域,"
            "若鉴权失败请检查 .env 配置"
        )


def call_asr(audio_url: str) -> List[Dict[str, Any]]:
    """
    Returns: [{start_time(s), end_time(s), speaker, content}, ...]
        与旧 Volc 实现字段一致,下游 _determine_speaker_mapping / 数据库 schema 不变。

    实现流程:
      1. Transcription.async_call 提交任务(返回 task_id)
      2. Transcription.wait 阻塞等完成
      3. 遍历 results[],对每个 SUCCEEDED 的 subtask 从 transcription_url 拉 JSON
      4. _parse_qwen_asr_result 把 DashScope 输出归一化成与 Volc 兼容的段列表

    实现是 DashScope / Paraformer-v2(2026-07+ 从早期火山接入迁移过来)。
    """
    _setup_dashscope_for_asr()

    if not dashscope.api_key:
        logger.error("[DashScope ASR] DASHSCOPE_API_KEY 未配置,无法调用 ASR")
        return []

    logger.info(f"[DashScope ASR] Submitting task")

    # ── Step 1: 提交转写任务 ──────────────────────────────────────────
    #     实际没做说话人分离,所有段被 fallback 到 Interviewer
    #   - paraformer-v2 支持 diarization_enabled=True (CAM++ 说话人聚类)
    #     和 speaker_count=2 (面试场景固定 2 人),走 DashScope 离线文件转写
    #     同一 SDK 接口 (Transcription.async_call),改动最小
    try:
        task_response = Transcription.async_call(
            model="paraformer-v2",
            file_urls=[audio_url],
            language_hints=["zh", "en"],
            diarization_enabled=True,
            speaker_count=2,
        )
        if task_response is None or task_response.output is None:
            logger.error(f"[DashScope ASR] Submit returned no output: {task_response}")
            return []
        task_id = task_response.output.task_id
        logger.info(f"[DashScope ASR] Task submitted OK, task_id={task_id}")
    except Exception as e:
        logger.error(f"[DashScope ASR] Submit exception: {e!r}")
        return []

    # ── Step 2: 阻塞等待转写完成(自定义轮询,避免 SDK 默认 5s INFO 刷屏) ──
    t0 = time.monotonic()
    transcription_response = None
    last_report_at = t0
    try:
        attempt = 0
        while time.monotonic() - t0 < _ASR_WAIT_TIMEOUT_S:
            time.sleep(_ASR_POLL_INTERVAL_S)
            attempt += 1
            try:
                resp = Transcription.fetch(task=task_id)
            except Exception as e:
                logger.warning(f"[DashScope ASR] fetch() error attempt={attempt}: {e!r}")
                continue

            if resp is None or resp.output is None:
                continue

            # DashScope task 顶层状态:PENDING / RUNNING / SUCCEEDED / FAILED / UNKNOWN
            task_status = getattr(resp.output, "task_status", None) or resp.output.get("task_status")
            elapsed = time.monotonic() - t0
            now = time.monotonic()

            # 每 20s 汇报一次进度(按时间,不按次数),终态立即汇报
            if (now - last_report_at) >= _ASR_PROGRESS_REPORT_S or task_status in ("SUCCEEDED", "FAILED"):
                logger.info(
                    f"[DashScope ASR] polling #{attempt} status={task_status} "
                    f"elapsed={elapsed:.1f}s/{_ASR_WAIT_TIMEOUT_S}s"
                )
                last_report_at = now

            if task_status == "SUCCEEDED":
                transcription_response = resp
                break
            if task_status in ("FAILED", "CANCELED", "UNKNOWN"):
                logger.error(
                    f"[DashScope ASR] task {task_id} {task_status} after {elapsed:.1f}s, "
                    f"msg={resp.output.message if hasattr(resp.output, 'message') else 'N/A'}"
                )
                return []
            # PENDING / RUNNING:继续轮询
        else:
            # while-else:超时退出
            logger.error(
                f"[DashScope ASR] task {task_id} timeout after {_ASR_WAIT_TIMEOUT_S}s"
            )
            return []
    except Exception as e:
        logger.error(f"[DashScope ASR] poll loop exception: {e!r}")
        return []

    if transcription_response is None or transcription_response.status_code != HTTPStatus.OK:
        logger.error(
            f"[DashScope ASR] fetch() failed: status={transcription_response.status_code if transcription_response else 'None'}"
        )
        return []

    elapsed = time.monotonic() - t0
    logger.info(
        f"[DashScope ASR] task SUCCEEDED in {elapsed:.2f}s, "
        f"subtasks={len(transcription_response.output.results)}"
    )

    # ── Step 3: 收集所有 SUCCEEDED subtask 的 transcription_url 并下载 ──
    segments: List[Dict[str, Any]] = []
    for i, transcription in enumerate(transcription_response.output["results"]):
        if transcription.get("subtask_status") != "SUCCEEDED":
            logger.error(
                f"[DashScope ASR] subtask {i} not SUCCEEDED: "
                f"status={transcription.get('subtask_status')}, "
                f"details={transcription}"
            )
            continue

        url = transcription.get("transcription_url")
        if not url:
            logger.error(f"[DashScope ASR] subtask {i} has no transcription_url")
            continue

        try:
            with urlrequest.urlopen(url, timeout=15) as resp:
                raw = resp.read().decode("utf-8")
            qdata = json.loads(raw)
        except Exception as e:
            logger.error(f"[DashScope ASR] subtask {i} download failed: {e!r}")
            continue

        # 诊断日志精简版:unique speaker_ids + 句子数一行说清
        transcripts = qdata.get("transcripts") or []
        if transcripts:
            sents = transcripts[0].get("sentences") or []
            if sents:
                all_speaker_ids = sorted({
                    s.get("speaker_id") for s in sents if s.get("speaker_id") is not None
                })
                logger.info(
                    f"[DashScope ASR] subtask {i}: {len(sents)} sentences, "
                    f"speaker_ids={all_speaker_ids}"
                )

        parsed = _parse_qwen_asr_result(qdata)
        logger.info(f"[DashScope ASR] subtask {i} → {len(parsed)} segments")
        segments.extend(parsed)

    logger.info(f"[DashScope ASR] Complete: {len(segments)} segments total")
    return segments


def _determine_speaker_mapping(utterances: List[Dict[str, Any]]) -> Dict[str, str]:
    """
    给一组 utterances 打标:哪个 speaker_id 是 Interviewer、哪些是 Candidate。

    设计原则(2026-08-02+):按可信度从高到低三档降级,
    避免旧启发式(先说话 + 问句最多 + 字数最少)反问场景下把候选人判成面试官。

    Tier 1 — 信任 Volc/Paraformer 约定:speaker_id 0 = Interviewer。
        如果说话人中明确出现了 0,直接采用,其余都是 Candidate。
        这是最权威的来源,避免任何启发式误判。
    Tier 2 — 「首句是问句」的说话人是 Interviewer:面试官开场必先发问,
        候选人自我介绍一般不会以问句开头。
    Tier 3 — 兜底用「最先开口」;只有 1 个说话人时默认 Candidate
        (候选人自拍录像 / 自我介绍回放这类常见 case)。

    Returns: dict mapping spk_str -> "Interviewer" | "Candidate"。
        多说话人时只有 1 个 Interviewer(分数最高的那位),其余都标 Candidate。
    """
    stats: Dict[str, Dict[str, Any]] = {}
    for idx, utt in enumerate(utterances):
        # 注意:必须用 is not None 判断,不能用 or —— speaker_id == 0 是合法值,
        # 但 `0 or X` 在 Python 里返回 X(0 是 falsy),会导致所有 speaker_id=0
        # 的段被短路成 None 然后被 skip,丢失说话人信息。
        spk = (
            utt.get("additions", {}).get("speaker")
            if utt.get("additions") else None
        )
        if spk is None:
            spk = utt.get("speaker_id")
        if spk is None:
            spk = utt.get("speaker")
        if spk is None:
            continue
        spk_str = str(spk).strip()
        if not spk_str:
            continue
        if spk_str not in stats:
            stats[spk_str] = {
                "questions": 0,
                "chars": 0,
                "first_appear": idx,
                "first_question_at": None,  # 该说话人第一个问句的位置
                "raw_speaker_id": spk,      # 保留原始 id 给 Tier 1 判断用
            }
        text = (utt.get("text") or utt.get("definite_text") or utt.get("content") or "").strip()
        stats[spk_str]["chars"] += len(text)

        is_q = any(q in text for q in ["?", "？", "为什么", "怎么", "请介绍", "自我介绍", "说说", "谈谈", "聊聊", "你好", "欢迎"])
        if is_q:
            stats[spk_str]["questions"] += 1
            if stats[spk_str]["first_question_at"] is None:
                stats[spk_str]["first_question_at"] = idx

    if not stats:
        return {}

    # ── Tier 1: speaker_id == 0 → Interviewer ────────────────────────────────
    zero_speakers = [spk for spk, s in stats.items() if s["raw_speaker_id"] == 0]
    if zero_speakers:
        interviewer_spk = zero_speakers[0]
        logger.info(
            f"[ASR speaker] Tier 1: speaker_id=0 → Interviewer ({interviewer_spk})"
        )
    else:
        # ── Tier 2: 谁先问"?"谁是面试官 ──────────────────────────────────
        speakers_with_q = [
            (spk, s["first_question_at"]) for spk, s in stats.items()
            if s["first_question_at"] is not None
        ]
        if speakers_with_q:
            interviewer_spk = min(speakers_with_q, key=lambda kv: kv[1])[0]
            logger.info(
                f"[ASR speaker] Tier 2: first-question speaker → Interviewer ({interviewer_spk})"
            )
        else:
            # ── Tier 3: 最先开口的兜底;只有 1 个说话人时默认 Candidate ───
            if len(stats) == 1:
                only_spk = next(iter(stats))
                logger.warning(
                    f"[ASR speaker] Tier 3 fallback: only 1 speaker detected "
                    f"({only_spk}), defaulting to Candidate "
                    f"(likely candidate self-recording / one-sided playback)"
                )
                return {only_spk: "Candidate"}
            interviewer_spk = min(stats.keys(), key=lambda k: stats[k]["first_appear"])
            logger.warning(
                f"[ASR speaker] Tier 3 fallback: first-appear speaker → Interviewer "
                f"({interviewer_spk}). Consider enabling speaker diarization "
                f"or check audio quality if this is wrong."
            )

    mapping: Dict[str, str] = {}
    for spk in stats:
        mapping[spk] = "Interviewer" if spk == interviewer_spk else "Candidate"
    return mapping


def _parse_qwen_asr_result(qdata: dict) -> List[Dict[str, Any]]:
    """把 DashScope filetrans 输出归一化成 Volc 兼容的 segments 列表。

    DashScope 输出结构:
      {"transcripts": [{"channel_id": 0,
                        "text": "...",
                        "sentences": [{"text", "begin_time", "end_time",
                                       "speaker_id", "channel_id"}, ...]}]}

    Volc 兼容输出:
      [{start_time(s), end_time(s), speaker, content}, ...]
        - start_time/end_time: 秒(从毫秒转换)
        - speaker:             "Interviewer" | "Candidate"(_determine_speaker_mapping 标记)
        - content:             文本
    """
    transcripts = qdata.get("transcripts") or []
    if not transcripts:
        logger.warning(
            f"[DashScope ASR] No transcripts in response. Top-level keys: {list(qdata.keys())}, "
            f"raw first 500: {json.dumps(qdata, ensure_ascii=False)[:500]}"
        )
        return []

    # 多 channel 场景下把所有 sentences 拼一起(单声道面试录音只会有 1 个 channel)
    volc_style_utterances: List[Dict[str, Any]] = []
    for tr in transcripts:
        for sent in (tr.get("sentences") or []):
            volc_style_utterances.append({
                "text":       sent.get("text", ""),
                "start_time": int(sent.get("begin_time", 0)),   # ms
                "end_time":   int(sent.get("end_time", 0)),     # ms
                # 关键:用 additions.speaker 包一层,匹配 _determine_speaker_mapping 的读取姿势
                "additions":  {"speaker": sent.get("speaker_id", 0)},
                # 同时保留 top-level speaker_id 兜底
                "speaker_id": sent.get("speaker_id", 0),
            })

    if not volc_style_utterances:
        return []

    logger.info(
        f"[DashScope ASR] Parsing {len(volc_style_utterances)} utterances, "
        f"sample keys: {list(volc_style_utterances[0].keys())}"
    )

    spk_mapping = _determine_speaker_mapping(volc_style_utterances)

    segments: List[Dict[str, Any]] = []
    for utt in volc_style_utterances:
        text = (utt.get("text") or "").strip()
        if not text:
            continue

        # DashScope filetrans begin_time/end_time 单位为毫秒,需 → 秒
        start_ms = float(utt.get("start_time", 0))
        end_ms   = float(utt.get("end_time",   start_ms + 2000))

        # 注意:不能用 `or`,speaker_id=0 是合法值,会被短路成 None
        spk = (
            utt.get("additions", {}).get("speaker")
            if utt.get("additions") else None
        )
        if spk is None:
            spk = utt.get("speaker_id")
        spk_str = str(spk).strip() if spk is not None else ""
        role = spk_mapping.get(spk_str, "Interviewer")

        segments.append({
            "start_time": start_ms / 1000.0,
            "end_time":   end_ms   / 1000.0,
            "speaker":    role,
            "content":    text,
        })

    return segments
