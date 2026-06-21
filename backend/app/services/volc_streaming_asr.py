"""
火山豆包 流式短语音识别 WSS 客户端。

官方 Python Demo：sauc_websocket_demo.py（解压自火山控制台下载的 sauc_python.zip）
关键点（与 volc_realtime_bridge.py 的协议**完全不同**——简化版）：

  Endpoint:   wss://openspeech.bytedance.com/api/v3/sauc/bigmodel[_async|_nostream]
  Resource:  volc.bigasr.sauc.duration / volc.bigasr.sauc.concurrent
             volc.seedasr.sauc.duration / volc.seedasr.sauc.concurrent

  Auth (4 headers only):
    X-Api-Resource-Id: volc.bigasr.sauc.duration
    X-Api-Request-Id:  <UUID>
    X-Api-Access-Key:  <VOLC_ASR_API_KEY>
    X-Api-App-Key:     <App Key>

  Binary protocol (per frame):
    Header (4B) | Sequence (4B BE int32) | Payload size (4B BE uint32) | Payload (gzip + JSON/raw)
    Header byte 0: (version << 4) | header_size
    Header byte 1: (message_type << 4) | flags
    Header byte 2: (serialization << 4) | compression
    Header byte 3: reserved

  Message types:
    0b0001 CLIENT_FULL_REQUEST        (StartRecognition)
    0b0010 CLIENT_AUDIO_ONLY_REQUEST  (SendAudio)
    0b1001 SERVER_FULL_RESPONSE
    0b1111 SERVER_ERROR_RESPONSE

  Flags:
    0b0000 NO_SEQUENCE (client only)
    0b0001 POS_SEQUENCE (with positive seq number)
    0b0010 NEG_SEQUENCE (no seq, last packet flag)
    0b0011 NEG_WITH_SEQUENCE (last packet + negative seq number)

  No StartConnection / FinishConnection! 直接 WS 连上就发 StartRecognition。

  Audio request:  NEG_WITH_SEQUENCE + seq 设为负值 → 触发服务端返回 final。

  Response payload:
    {"result": {"text": "完整文本",
                "utterances": [{"text": "...", "start_time": ms, "end_time": ms, "definite": true|false}]},
     "audio_info": {"duration": ms}}
"""
from __future__ import annotations

import asyncio
import gzip
import json
import logging
import struct
import uuid
from dataclasses import dataclass
from typing import AsyncIterator, Optional

try:
    import websockets
    from websockets.exceptions import ConnectionClosed
except ImportError:
    websockets = None
    ConnectionClosed = Exception

logger = logging.getLogger(__name__)


# ========== 协议常量 ==========

PROTOCOL_VERSION = 0b0001
HEADER_SIZE = 0b0001

CLIENT_FULL_REQUEST = 0b0001
CLIENT_AUDIO_ONLY_REQUEST = 0b0010
SERVER_FULL_RESPONSE = 0b1001
SERVER_ERROR_RESPONSE = 0b1111

NO_SEQUENCE = 0b0000
POS_SEQUENCE = 0b0001
NEG_SEQUENCE = 0b0010
NEG_WITH_SEQUENCE = 0b0011

NO_SERIALIZATION = 0b0000
JSON_SERIALIZATION = 0b0001

NO_COMPRESSION = 0b0000
GZIP_COMPRESSION = 0b0001


# ========== Response Header 抓取（官方推荐记录 X-Tt-Logid / X-Api-Connect-Id） ==========

def _extract_tt_logid(response) -> Optional[str]:
    """
    从 websockets 的握手响应里抠 X-Tt-Logid。
    兼容两种入口：
      - InvalidStatus.response.headers  (失败时)
      - Connection.response_headers     (成功时)
    """
    if response is None:
        return None
    try:
        # websockets.http11.Response 有 .headers (Headers 对象) 和 .status_code
        headers = getattr(response, "headers", None)
        if headers is None:
            return None
        # Headers 是大小写不敏感的 Mapping
        for key in ("X-Tt-Logid", "x-tt-logid", "X-TT-LOGID"):
            if key in headers:
                return headers[key]
        return None
    except Exception:
        return None


def _extract_response_ids(ws) -> tuple[Optional[str], Optional[str]]:
    """
    从已建立的 websockets 连接里取出 X-Tt-Logid / X-Api-Connect-Id。
    websockets>=10 的 Connection 上有 .response_headers（Headers 对象）。
    """
    log_id: Optional[str] = None
    connect_id: Optional[str] = None
    try:
        resp = getattr(ws, "response", None) or getattr(ws, "response_headers", None)
        if resp is None:
            return None, None
        headers = getattr(resp, "headers", resp)  # response_headers 直接就是 Headers
        if headers is None:
            return None, None
        for k, v in headers.items():
            lk = k.lower()
            if lk == "x-tt-logid":
                log_id = v
            elif lk == "x-api-connect-id":
                connect_id = v
    except Exception:
        pass
    return log_id, connect_id


# ========== 编解码工具（与 sauc_websocket_demo.py 完全对齐） ==========

def _make_header(message_type: int, flags: int = POS_SEQUENCE,
                 serialization: int = JSON_SERIALIZATION,
                 compression: int = GZIP_COMPRESSION) -> bytes:
    """4 字节协议头（与官方 demo AsrRequestHeader.to_bytes 对齐）。"""
    return bytes([
        (PROTOCOL_VERSION << 4) | HEADER_SIZE,
        (message_type << 4) | (flags & 0x0F),
        (serialization << 4) | (compression & 0x0F),
        0x00,  # reserved
    ])


def _make_full_request(seq: int, payload: dict) -> bytes:
    """
    构造 StartRecognition full client request（参考 RequestBuilder.new_full_client_request）。
    Header(4B) + Sequence(4B BE) + PayloadSize(4B BE) + gzip(JSON)
    """
    header = _make_header(CLIENT_FULL_REQUEST, flags=POS_SEQUENCE)
    payload_bytes = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    compressed = gzip.compress(payload_bytes)
    return (
        header
        + struct.pack(">i", seq)
        + struct.pack(">I", len(compressed))
        + compressed
    )


def _make_audio_request(seq: int, audio_bytes: bytes, is_last: bool = False) -> bytes:
    """
    构造 SendAudio audio-only request。
    - 正常包：flags=POS_SEQUENCE, seq 正数
    - 最后一包：flags=NEG_WITH_SEQUENCE, seq 负数（触发服务端 final）
    audio 走 NO_SERIALIZATION + GZIP
    """
    if is_last:
        flags = NEG_WITH_SEQUENCE
        seq_to_send = -abs(seq)
    else:
        flags = POS_SEQUENCE
        seq_to_send = abs(seq)
    header = _make_header(
        CLIENT_AUDIO_ONLY_REQUEST,
        flags=flags,
        serialization=NO_SERIALIZATION,
        compression=GZIP_COMPRESSION,
    )
    compressed = gzip.compress(audio_bytes)
    return (
        header
        + struct.pack(">i", seq_to_send)
        + struct.pack(">I", len(compressed))
        + compressed
    )


def _parse_response(raw: bytes) -> dict:
    """
    解服务端响应（参考 ResponseParser.parse_response）。
    注意 streaming ASR 的响应**没有 event 字段**——bit 0x04 不是用于 event 的。
    """
    if len(raw) < 4:
        return {}
    # header_size = header_byte & 0x0f（demo 用法）；version 没用上
    header_size = raw[0] & 0x0F
    message_type = raw[1] >> 4
    flags = raw[1] & 0x0F
    serialization = raw[2] >> 4
    compression = raw[2] & 0x0F

    # payload 从 header 结束之后开始（header_size * 4 字节）
    offset = header_size * 4
    if offset < 4:
        offset = 4

    # 解 flags 0b0001 → 带 sequence；0b0010 → last package；0b0100 → 带 event
    payload = raw[offset:]
    sequence = None
    is_last = False
    event = None
    if flags & POS_SEQUENCE:
        if len(payload) >= 4:
            sequence = struct.unpack(">i", payload[:4])[0]
            payload = payload[4:]
    if flags & NEG_SEQUENCE:
        is_last = True
    # 注：流式 ASR 不使用 event 字段（flags & 0x04 在 demo 里解析但实际从未被触发）

    # 解析 payload size
    payload_size = 0
    payload_data = b""
    if message_type == SERVER_FULL_RESPONSE:
        if len(payload) >= 4:
            payload_size = struct.unpack(">I", payload[:4])[0]
            payload_data = payload[4:4 + payload_size]
    elif message_type == SERVER_ERROR_RESPONSE:
        if len(payload) >= 8:
            err_code = struct.unpack(">i", payload[:4])[0]
            payload_size = struct.unpack(">I", payload[4:8])[0]
            payload_data = payload[8:8 + payload_size]
            return {
                "message_type": message_type,
                "flags": flags,
                "sequence": sequence,
                "is_last": is_last,
                "error_code": err_code,
                "payload_size": payload_size,
                "raw_payload": payload_data,
            }

    if not payload_data:
        return {
            "message_type": message_type,
            "flags": flags,
            "sequence": sequence,
            "is_last": is_last,
            "error_code": None,
            "payload": None,
        }

    # 解压
    if compression == GZIP_COMPRESSION:
        try:
            payload_data = gzip.decompress(payload_data)
        except Exception:
            pass

    # 解析 JSON
    parsed_payload = None
    if serialization == JSON_SERIALIZATION and payload_data:
        try:
            parsed_payload = json.loads(payload_data.decode("utf-8"))
        except Exception:
            parsed_payload = payload_data.decode("utf-8", errors="ignore")

    return {
        "message_type": message_type,
        "flags": flags,
        "sequence": sequence,
        "is_last": is_last,
        "error_code": None,
        "payload": parsed_payload,
    }


@dataclass
class AsrEvent:
    type: str  # "partial" | "final" | "ready" | "error" | "closed"
    text: str = ""
    is_final: bool = False
    detail: str = ""


class VolcStreamingAsrBridge:
    """
    单会话流式短语音识别桥接。
    用法：
        bridge = VolcStreamingAsrBridge(api_key=..., app_key=..., resource_id=..., wss_url=...)
        await bridge.connect()
        async for ev in bridge.recv_events(): ...
        await bridge.send_pcm(chunk)         # 正常包
        await bridge.send_pcm(chunk, last=True)  # 最后一包（触发服务端 final）
        await bridge.close()
    """

    PCM_SAMPLE_RATE = 16000
    PCM_BITS = 16
    PCM_CHANNELS = 1

    def __init__(
        self,
        api_key: str,
        app_key: str,
        resource_id: str,
        wss_url: str,
        language: str = "zh-CN",
        model_name: str = "bigmodel",
    ):
        if websockets is None:
            raise ImportError("需要安装 websockets>=12.0")
        if not all([api_key, app_key, resource_id, wss_url]):
            raise ValueError(
                "火山流式 ASR 鉴权字段未配置齐全。请检查 backend/.env。"
            )
        self.api_key = api_key
        self.app_key = app_key
        self.resource_id = resource_id
        self.wss_url = wss_url
        self.language = language
        self.model_name = model_name

        self._ws = None
        self._closed = False
        self._request_id = str(uuid.uuid4())
        self._seq = 1  # 包序号从 1 开始
        self._listener_task: Optional[asyncio.Task] = None
        self._out_q: asyncio.Queue[AsrEvent] = asyncio.Queue(maxsize=512)

    # ---------- 生命周期 ----------

    async def connect(self) -> None:
        """
        WS 握手（带 4 个鉴权头）→ 立即发 StartRecognition（full client request）→ 启 listener。
        关键差异：流式 ASR **没有 StartConnection**，WS 连上直接发识别请求。

        握手响应头（无论成功失败都要记录）官方推荐抓 X-Tt-Logid：
          - 成功：self._ws.response_headers
          - 失败：InvalidStatus 异常的 e.response.headers
        """
        logger.info(
            f"[volc-asr] connect wss={self.wss_url} resource_id={self.resource_id} "
            f"request_id={self._request_id}"
        )
        # 鉴权头：与官方 demo 完全对齐——只 4 个
        # 1. X-Api-Resource-Id
        # 2. X-Api-Request-Id  (每连接 UUID)
        # 3. X-Api-Access-Key  (旧版控制台 access token，等价于新版 X-Api-Key)
        # 4. X-Api-App-Key     (App Key)
        headers = [
            ("X-Api-Resource-Id", self.resource_id),
            ("X-Api-Request-Id", self._request_id),
            ("X-Api-Access-Key", self.api_key),
            ("X-Api-App-Key", self.app_key),
        ]
        try:
            self._ws = await websockets.connect(
                self.wss_url,
                additional_headers=headers,
                max_size=4 * 1024 * 1024,
                ping_interval=None,
            )
        except websockets.exceptions.InvalidStatus as e:
            # 握手被服务端拒绝（403/401 等）——把 X-Tt-Logid 抓出来，便于找火山支持定位
            log_id = _extract_tt_logid(getattr(e, "response", None))
            logger.error(
                f"[volc-asr] WS 握手被拒 status={getattr(e, 'status_code', '?')} "
                f"X-Tt-Logid={log_id} resource_id={self.resource_id} request_id={self._request_id}"
            )
            raise

        # 握手成功：抓响应头里的 X-Tt-Logid / X-Api-Connect-Id（官方推荐记录）
        log_id, connect_id = _extract_response_ids(self._ws)
        logger.info(
            f"[volc-asr] WS 已建立 X-Tt-Logid={log_id} X-Api-Connect-Id={connect_id}"
        )

        # 立即发 StartRecognition full client request（没有 StartConnection 步骤）
        start_payload = {
            "user": {"uid": "interviewvar-live"},
            "audio": {
                "format": "pcm",
                "codec": "raw",
                "rate": self.PCM_SAMPLE_RATE,
                "bits": self.PCM_BITS,
                "channel": self.PCM_CHANNELS,
                "language": self.language,
            },
            "request": {
                "model_name": self.model_name,
                "enable_itn": True,
                "enable_punc": True,
                "enable_ddc": False,
                "show_utterances": True,
                "result_type": "full",
                "enable_nonstream": False,
            },
        }
        await self._ws.send(_make_full_request(self._seq, start_payload))
        self._seq += 1
        logger.info(f"[volc-asr] StartRecognition 已发（seq={self._seq - 1}），listener 启动")
        self._listener_task = asyncio.create_task(self._listen_loop())

    async def _listen_loop(self) -> None:
        try:
            async for raw in self._ws:
                if self._closed:
                    break
                parsed = _parse_response(raw)
                msg_type = parsed.get("message_type")
                if msg_type == SERVER_ERROR_RESPONSE:
                    err_code = parsed.get("error_code")
                    err_payload = parsed.get("raw_payload") or parsed.get("payload")
                    err_text = (
                        err_payload.decode("utf-8", errors="ignore")
                        if isinstance(err_payload, (bytes, bytearray))
                        else (err_payload if isinstance(err_payload, str) else json.dumps(err_payload, ensure_ascii=False))
                    )
                    logger.error(f"[volc-asr] 服务端错误: code={err_code} msg={err_text}")
                    await self._safe_put(AsrEvent(type="error", detail=f"code={err_code} msg={err_text}"))
                    # 错误不一定要断流；让上层决定是否继续
                    continue
                if msg_type != SERVER_FULL_RESPONSE:
                    continue
                # 流式响应：payload 是 dict，结构 = {"result": {"text": "...", "utterances": [...]}}
                payload = parsed.get("payload")
                if not isinstance(payload, dict):
                    continue
                result = payload.get("result") or {}
                full_text = (result.get("text") or "").strip()
                utterances = result.get("utterances") or []
                if utterances:
                    for utt in utterances:
                        text = (utt.get("text") or "").strip()
                        if not text:
                            continue
                        is_definite = bool(utt.get("definite"))
                        await self._safe_put(AsrEvent(
                            type="final" if is_definite else "partial",
                            text=text,
                            is_final=is_definite,
                        ))
                elif full_text:
                    await self._safe_put(AsrEvent(
                        type="partial",
                        text=full_text,
                        is_final=False,
                    ))
        except ConnectionClosed:
            logger.info("[volc-asr] WSS closed by remote")
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.exception(f"[volc-asr] listener 异常: {e}")
        finally:
            await self._safe_put(AsrEvent(type="closed"))
            logger.info("[volc-asr] listener stopped")

    async def _safe_put(self, ev: AsrEvent) -> None:
        try:
            self._out_q.put_nowait(ev)
        except asyncio.QueueFull:
            try:
                self._out_q.get_nowait()
                self._out_q.put_nowait(ev)
            except Exception:
                pass

    # ---------- 业务 API ----------

    async def send_pcm(self, pcm_bytes: bytes, last: bool = False) -> None:
        """
        推一帧 PCM16 (16kHz/mono) 给火山做流式识别。
        last=True 时标记为最后一包，触发服务端返回 final。
        """
        if self._closed or self._ws is None:
            return
        try:
            await self._ws.send(_make_audio_request(self._seq, pcm_bytes, is_last=last))
            if not last:
                self._seq += 1
        except ConnectionClosed:
            logger.warning("[volc-asr] send_pcm 时连接已关闭")
            self._closed = True
        except Exception as e:
            logger.warning(f"[volc-asr] send_pcm 失败: {e}")

    async def recv_events(self) -> AsyncIterator[AsrEvent]:
        while not self._closed:
            ev = await self._out_q.get()
            yield ev
            if ev.type in ("closed", "error"):
                break

    async def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        # 没有 FinishRecognition/FinalConnection 协议事件，直接关 WS
        if self._listener_task and not self._listener_task.done():
            try:
                await asyncio.wait_for(self._listener_task, timeout=2.0)
            except (asyncio.TimeoutError, asyncio.CancelledError, Exception):
                self._listener_task.cancel()
        if self._ws is not None and not self._ws.closed:
            try:
                await self._ws.close()
            except Exception:
                pass
        logger.info("[volc-asr] closed")