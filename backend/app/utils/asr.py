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
from typing import List, Dict, Any
from app.config import settings

logger = logging.getLogger(__name__)

VOLC_SUBMIT_URL = "https://openspeech.bytedance.com/api/v3/auc/bigmodel/submit"
VOLC_QUERY_URL  = "https://openspeech.bytedance.com/api/v3/auc/bigmodel/query"


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
    audio_fmt   = _detect_format(audio_url)

    submit_body = {
        "user": {"uid": "offerpilot-asr"},
        "audio": {
            "url":     audio_url,
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
    logger.info(f"[Volc ASR] Submitting: request_id={request_id}, url={audio_url}, fmt={audio_fmt}")
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

    segments: List[Dict[str, Any]] = []
    for utt in utterances:
        text = (utt.get("text") or utt.get("definite_text") or "").strip()
        if not text:
            continue

        # Timestamps in milliseconds
        start_ms = float(utt.get("start_time", utt.get("begin_time", utt.get("start", 0))))
        end_ms   = float(utt.get("end_time",   utt.get("end",   start_ms + 2000)))

        # Speaker (0-based int)
        spk = utt.get("speaker_id", utt.get("speaker", 0))
        try:
            spk = int(spk)
        except (TypeError, ValueError):
            spk = 0

        segments.append({
            "start_time": start_ms / 1000.0,   # ms → seconds
            "end_time":   end_ms   / 1000.0,
            "speaker":    "Interviewer" if spk == 0 else "Candidate",
            "content":    text,
        })

    return segments


# Backward-compat alias
def call_minimax_asr(audio_url: str) -> List[Dict[str, Any]]:
    return call_volc_asr(audio_url)
