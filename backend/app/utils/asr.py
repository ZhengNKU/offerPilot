"""
ASR utility — calls Volcano Engine (ByteDance Doubao) Large-Model ASR.

KEY INSIGHT from docs:
  - X-Api-Request-Id  == task_id  (YOU generate it as UUID, pass in header)
  - Submit returns HTTP 200 + X-Api-Status-Code: 20000000 on success, body may be empty {}
  - Query: POST /api/v3/auc/bigmodel/query  with same X-Api-Request-Id header (or body {"id": request_id})

Flow:
  1. Generate UUID → use as X-Api-Request-Id (= task_id)
  2. POST /api/v3/auc/bigmodel/submit  → check X-Api-Status-Code == 20000000
  3. POST /api/v3/auc/bigmodel/query  with same UUID → poll until status == 1000 / Success
  4. Parse utterances from result

Timestamps: Volc returns MILLISECONDS → we convert to seconds.
Speaker: speaker_id int, 0 → Interviewer, 1+ → Candidate.
"""
import requests
import logging
import time
import uuid
import urllib.parse
from typing import List, Dict, Any
from app.config import settings

logger = logging.getLogger(__name__)

VOLC_SUBMIT_URL = "https://openspeech.bytedance.com/api/v3/auc/bigmodel/submit"
VOLC_QUERY_URL  = "https://openspeech.bytedance.com/api/v3/auc/bigmodel/query"


def _encode_audio_url(url: str) -> str:
    """Percent-encode the path of an audio URL so non-ASCII chars
    (e.g. Chinese filenames in COS keys) don't break Volc's downloader.

    IMPORTANT: COS presigned URLs already have their path percent-encoded
    (e.g. %E4%B8%AD%E6%96%87). Calling urllib.parse.quote on top of that
    produces a DOUBLE-encoded URL (%25E4%25B8%25AD...) which Volc rejects
    with "Invalid audio URI". So we only encode when the path actually
    contains raw non-ASCII characters."""
    try:
        parts = urllib.parse.urlparse(url)
        # If no raw non-ASCII char in path, assume already encoded (or
        # ASCII-only) and return as-is to avoid double encoding.
        if not any(ord(c) > 127 for c in parts.path):
            return url
        encoded_path = urllib.parse.quote(parts.path, safe="/")
        return urllib.parse.urlunparse(parts._replace(path=encoded_path))
    except Exception:
        return url


def _headers(request_id: str) -> dict:
    """Build Volc Engine ASR request headers."""
    return {
        "Content-Type":      "application/json",
        "x-api-key":         settings.VOLC_ASR_API_KEY,
        "X-Api-Resource-Id": settings.VOLC_ASR_RESOURCE_ID,
        "X-Api-Request-Id":  request_id,
        "X-Api-Sequence":    "-1",
    }


def _detect_format(url: str) -> str:
    clean = url.split("?")[0].lower()
    if clean.endswith(".mp3"):  return "mp3"
    if clean.endswith(".wav"):  return "wav"
    if clean.endswith(".m4a"):  return "m4a"
    if clean.endswith(".ogg"):  return "ogg"
    if clean.endswith(".flac"): return "flac"
    return "mp3"


def call_volc_asr(audio_url: str) -> List[Dict[str, Any]]:
    """
    Submit a Doubao ASR job and poll until done.
    Returns [{start_time(s), end_time(s), speaker, content}, ...].
    """
    # Generate UUID — this IS the task_id for Volc ASR
    request_id = str(uuid.uuid4())
    # URL-encode path so non-ASCII chars (e.g. Chinese filenames) don't
    # make Volc's internal downloader choke with "Invalid audio URI".
    audio_url_enc = _encode_audio_url(audio_url)
    audio_fmt   = _detect_format(audio_url_enc)

    logger.info(f"[Volc ASR] Encoded url: {audio_url} -> {audio_url_enc}")

    submit_body = {
        "user": {"uid": "interviewvar-asr"},
        "audio": {
            "url":     audio_url_enc,
            "format":  audio_fmt,
            "codec":   "raw",
            "rate":    16000,
            "bits":    16,
            "channel": 1,
        },
        "request": {
            "model_name":           "bigmodel",
            "enable_itn":           True,   # 数字文字标准化
            "enable_punc":          True,   # 标点
            "enable_ddc":           False,
            "enable_speaker_info":  True,   # 说话人区分 ← key!
            "enable_channel_split": False,
            "show_utterances":      True,   # 逐句时间戳 ← key!
            "vad_segment":          False,
            "sensitive_words_filter": "",
        },
    }

    # ── Step 1: Submit ────────────────────────────────────────────────────
    logger.info(f"[Volc ASR] Submitting: request_id={request_id}, url={audio_url_enc}, fmt={audio_fmt}")
    try:
        resp = requests.post(
            VOLC_SUBMIT_URL,
            headers=_headers(request_id),
            json=submit_body,
            timeout=30,
        )
        status_code = resp.headers.get("X-Api-Status-Code", "")
        message     = resp.headers.get("X-Api-Message", "")
        logger.info(f"[Volc ASR] Submit → HTTP {resp.status_code}, "
                    f"X-Api-Status-Code={status_code}, X-Api-Message={message}")

        # Success: X-Api-Status-Code == 20000000 (body may be empty {})
        if status_code != "20000000":
            logger.error(f"[Volc ASR] Submit failed: status={status_code} msg={message} body={resp.text[:200]}")
            return []

    except Exception as e:
        logger.error(f"[Volc ASR] Submit exception: {e}")
        return []

    logger.info(f"[Volc ASR] Task submitted OK, request_id (task_id)={request_id}")

    # ── Step 2: Poll for completion ──────────────────────────────────────
    # The query body uses the same request_id as task identifier
    query_body = {"id": request_id}

    for attempt in range(120):      # max 10 min (120 × 5s)
        time.sleep(5)
        try:
            # Use the original request_id in the query header to match the submitted task
            qresp = requests.post(
                VOLC_QUERY_URL,
                headers=_headers(request_id),
                json=query_body,
                timeout=15,
            )
            q_status_code = qresp.headers.get("X-Api-Status-Code", "")
            q_message      = qresp.headers.get("X-Api-Message", "")

            try:
                qdata = qresp.json()
            except Exception:
                qdata = {}

            logger.info(f"[Volc ASR] Poll #{attempt+1}: HTTP {qresp.status_code}, "
                        f"code={q_status_code}, msg={q_message}, body_keys={list(qdata.keys())}")

            # Status codes from Volc docs:
            # 20000000 = succeeded  |  20000001 = processing  |  20000002+ = failed
            if q_status_code == "20000000":
                segments = _parse_volc_result(qdata)
                logger.info(f"[Volc ASR] Complete: {len(segments)} segments")
                return segments

            if q_status_code and q_status_code not in ("20000001", ""):
                logger.error(f"[Volc ASR] Task failed: code={q_status_code} msg={q_message}")
                return []

            # Also check JSON body status field
            body_status = qdata.get("status") or qdata.get("code")
            if body_status in (1000, "1000", "Success", "success", "SUCCEEDED"):
                segments = _parse_volc_result(qdata)
                logger.info(f"[Volc ASR] Complete (body status): {len(segments)} segments")
                return segments
            if body_status in ("Failed", "failed", "FAILED", 2000, "2000"):
                logger.error(f"[Volc ASR] Task body-status failed: {body_status}")
                return []

        except Exception as e:
            logger.warning(f"[Volc ASR] Poll error #{attempt+1}: {e}")

    logger.error(f"[Volc ASR] Task {request_id} timed out after 10 min")
    return []


def _determine_speaker_mapping(utterances: List[Dict[str, Any]]) -> Dict[str, str]:
    """
    Given raw utterances, determine which speaker ID maps to 'Interviewer' and 'Candidate'.
    Returns a dict mapping spk_str -> "Interviewer" or "Candidate".
    """
    stats = {} # spk_str -> {"questions": 0, "chars": 0, "first_appear": int}
    for idx, utt in enumerate(utterances):
        spk = utt.get("additions", {}).get("speaker") or utt.get("speaker_id") or utt.get("speaker")
        if spk is None:
            continue
        spk_str = str(spk).strip()
        if not spk_str:
            continue
        if spk_str not in stats:
            stats[spk_str] = {"questions": 0, "chars": 0, "first_appear": idx}
        
        text = (utt.get("text") or utt.get("definite_text") or utt.get("content") or "").strip()
        stats[spk_str]["chars"] += len(text)
        
        # Check if sentence looks like a question or interviewer prompt
        is_q = False
        if any(q in text for q in ["?", "？", "为什么", "怎么", "请介绍", "自我介绍", "说说", "谈谈", "聊聊", "你好", "欢迎"]):
            is_q = True
        if is_q:
            stats[spk_str]["questions"] += 1

    if not stats:
        return {}

    # If only 1 speaker, map to Interviewer
    if len(stats) == 1:
        return {list(stats.keys())[0]: "Interviewer"}

    # Score each speaker for how likely they are to be the Interviewer
    scores = {spk: 0 for spk in stats}
    
    # Heuristic 1: First appearance (usually Interviewer speaks first)
    sorted_by_appear = sorted(stats.keys(), key=lambda k: stats[k]["first_appear"])
    scores[sorted_by_appear[0]] += 2.0
    
    # Heuristic 2: Questions count (Interviewer asks more questions)
    sorted_by_questions = sorted(stats.keys(), key=lambda k: stats[k]["questions"], reverse=True)
    if stats[sorted_by_questions[0]]["questions"] > 0:
        scores[sorted_by_questions[0]] += 2.0
        for spk in sorted_by_questions[1:]:
            if stats[spk]["questions"] == stats[sorted_by_questions[0]]["questions"]:
                scores[spk] += 2.0
                
    # Heuristic 3: Total characters spoken (Candidate speaks much more)
    sorted_by_chars = sorted(stats.keys(), key=lambda k: stats[k]["chars"])
    scores[sorted_by_chars[0]] += 1.0 # speaker with fewest characters gets points
    for spk in sorted_by_chars[1:]:
        if stats[spk]["chars"] == stats[sorted_by_chars[0]]["chars"]:
            scores[spk] += 1.0

    # Find the best speaker for Interviewer
    best_interviewer = max(scores.keys(), key=lambda k: scores[k])
    
    mapping = {}
    for spk in stats:
        if spk == best_interviewer:
            mapping[spk] = "Interviewer"
        else:
            mapping[spk] = "Candidate"
            
    return mapping


def _parse_volc_result(qdata: dict) -> List[Dict[str, Any]]:
    """
    Parse Volcano Engine ASR JSON result.

    Common structures:
    A) qdata["result"]["utterances"][i] = {text, start_time(ms), end_time(ms), speaker_id}
    B) qdata["utterances"][i] = same
    C) qdata["additions"]["utterances"] = same
    """
    # Find utterances in whichever nesting level they appear
    candidates = [
        qdata.get("result", {}).get("utterances"),
        qdata.get("result", {}).get("sentences"),
        qdata.get("utterances"),
        qdata.get("sentences"),
        qdata.get("additions", {}).get("utterances"),
    ]
    utterances = next((c for c in candidates if c), [])

    if not utterances:
        logger.warning(f"[Volc ASR] No utterances found in response. Keys: {list(qdata.keys())}")
        # Log partial body for debug
        import json
        logger.warning(f"[Volc ASR] Response (first 500): {json.dumps(qdata)[:500]}")
        return []

    logger.info(f"[Volc ASR] Parsing {len(utterances)} utterances, "
                f"sample keys: {list(utterances[0].keys()) if utterances else 'N/A'}")

    # Build speaker mapping
    spk_mapping = _determine_speaker_mapping(utterances)
    logger.info(f"[Volc ASR] Determined speaker mapping: {spk_mapping}")

    segments: List[Dict[str, Any]] = []
    for utt in utterances:
        text = (utt.get("text") or utt.get("definite_text") or "").strip()
        if not text:
            continue

        # Timestamps in milliseconds
        start_ms = float(utt.get("start_time", utt.get("begin_time", utt.get("start", 0))))
        end_ms   = float(utt.get("end_time",   utt.get("end",   start_ms + 2000)))

        # Speaker (0-based int or string from additions)
        spk = utt.get("additions", {}).get("speaker") or utt.get("speaker_id") or utt.get("speaker")
        spk_str = str(spk).strip() if spk is not None else ""
        role = spk_mapping.get(spk_str, "Interviewer")

        segments.append({
            "start_time": start_ms / 1000.0,   # ms → seconds
            "end_time":   end_ms   / 1000.0,
            "speaker":    role,
            "content":    text,
        })

    return segments


# Backward-compat alias
def call_minimax_asr(audio_url: str) -> List[Dict[str, Any]]:
    return call_volc_asr(audio_url)
