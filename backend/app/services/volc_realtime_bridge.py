"""
火山豆包 Realtime WSS 客户端（基于官方 Python SDK 协议）。

参考：官方 python3.7 示例 realtime_dialog_client.py + protocol.py
协议风格：私有二进制协议，4 字节头 + GZIP 压缩的 JSON body。

⚠️ 落地核对清单（实施前必读）：
1. WSS URL：以 https://www.volcengine.com/docs/6561/1594356 最新文档为准
2. 鉴权头（5 件套，来自控制台）：
     X-Api-App-ID:     <用户 App ID>
     X-Api-Access-Key: <用户 Access Key>
     X-Api-App-Key:     PlgvMymc7f3tQnJ6   ← 官方固定常量
     X-Api-Resource-Id: volc.speech.dialog
     X-Api-Connect-Id: <UUID 每次连接随机>
3. 协议头（4 字节）：
     Byte 0: (version << 4) | header_size    // version=1, header_size=1
     Byte 1: (message_type << 4) | flags
     Byte 2: (serialization << 4) | compression  // JSON=1, GZIP=1
     Byte 3: reserved
4. 客户端事件（event 4B BE）：
     1   = StartConnection（首次，必须，先拿 session_id）
     100 = StartSession（带 session_id + 配置）
     300 = SayHello（让 AI 开场白）
     200 = TaskRequest（送音频帧，AUDIO_ONLY 类型）
     102 = FinishSession
     2   = FinishConnection
5. 服务端事件（在 payload.event）：
     152/153 = session finished
     350 = chat tts text response
     359 = say hello ended
     450 = user started speaking（清音频缓存）
     451 = user partial/final ASR（extra.origin_text + extra.endpoint 判定是否 final）
     459 = turn complete（用户说完了，AI 该回应了）
6. 音频格式：
     输入：pcm_s16le, 16kHz, mono（浏览器 24kHz 需重采样）
     输出：pcm_s16le, 24kHz, mono
"""
from __future__ import annotations

import asyncio
import gzip
import json
import logging
import uuid
from dataclasses import dataclass
from typing import Any, AsyncIterator, Dict, Optional

try:
    import websockets
    from websockets.exceptions import ConnectionClosed
except ImportError:
    websockets = None
    ConnectionClosed = Exception

from app.config import settings

logger = logging.getLogger(__name__)


# ========== 协议常量 ==========

PROTOCOL_VERSION = 0b0001  # 1
HEADER_SIZE = 0b0001      # 1

# Message types
CLIENT_FULL_REQUEST = 0b0001
CLIENT_AUDIO_ONLY_REQUEST = 0b0010
SERVER_FULL_RESPONSE = 0b1001
SERVER_ACK = 0b1011
SERVER_ERROR_RESPONSE = 0b1111

# Message type specific flags
NO_SEQUENCE = 0b0000
POS_SEQUENCE = 0b0001
NEG_SEQUENCE = 0b0010
NEG_SEQUENCE_1 = 0b0011
MSG_WITH_EVENT = 0b0100

# Serialization
NO_SERIALIZATION = 0b0000
JSON = 0b0001
THRIFT = 0b0011
CUSTOM_TYPE = 0b1111

# Compression
NO_COMPRESSION = 0b0000
GZIP = 0b0001
CUSTOM_COMPRESSION = 0b1111

# Client → Server events
EVT_START_CONNECTION = 1
EVT_FINISH_CONNECTION = 2
EVT_START_SESSION = 100
EVT_FINISH_SESSION = 102
EVT_TASK_REQUEST = 200
EVT_SAY_HELLO = 300
EVT_CHAT_TTS_TEXT = 500
EVT_CHAT_TEXT_QUERY = 501
EVT_CHAT_RAG_TEXT = 502

# Server → Client events
EVT_SRV_SAY_HELLO_ENDED = 359   # 开场白播完
EVT_SRV_USER_STARTED = 450      # 用户开始说话
EVT_SRV_USER_TRANSCRIPTION = 451  # 用户 ASR partial/final（extra.origin_text 文本，extra.endpoint 判定 final）
EVT_SRV_TURN_COMPLETE = 459     # 用户说完了
EVT_SRV_TTS_TEXT = 350          # chat tts 文本
EVT_SRV_SESSION_END_1 = 152
EVT_SRV_SESSION_END_2 = 153


# ========== 编解码工具 ==========

def make_header(
    message_type: int,
    flags: int = MSG_WITH_EVENT,
    serialization: int = JSON,
    compression: int = GZIP,
    reserved: int = 0x00,
) -> bytes:
    """4 字节协议头。"""
    return bytes([
        (PROTOCOL_VERSION << 4) | HEADER_SIZE,
        (message_type << 4) | (flags & 0x0F),
        (serialization << 4) | (compression & 0x0F),
        reserved & 0xFF,
    ])


def _gzip_or_passthrough(data: bytes, compression: int) -> bytes:
    return gzip.compress(data) if compression == GZIP else data


def make_full_request(
    event: int,
    session_id: str,
    payload: Any,
    serialization: int = JSON,
    compression: int = GZIP,
) -> bytes:
    """
    Full client request:
      header(4B) + event(4B BE) + session_id_size(4B BE) + session_id + payload_size(4B BE) + payload
    """
    if isinstance(payload, (dict, list)):
        payload_bytes = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    else:
        payload_bytes = str(payload).encode("utf-8")
    if compression == GZIP:
        payload_bytes = gzip.compress(payload_bytes)
    sid_bytes = session_id.encode("utf-8") if session_id else b""
    header = make_header(CLIENT_FULL_REQUEST, flags=MSG_WITH_EVENT,
                         serialization=serialization, compression=compression)
    return (
        header
        + event.to_bytes(4, "big")
        + len(sid_bytes).to_bytes(4, "big", signed=True)
        + sid_bytes
        + len(payload_bytes).to_bytes(4, "big")
        + payload_bytes
    )


def make_start_connection_request() -> bytes:
    """
    StartConnection 不带 session_id：
      header(4B) + event(4B BE) + payload_size(4B BE) + payload
    """
    payload_bytes = gzip.compress(b"{}")
    header = make_header(CLIENT_FULL_REQUEST, flags=MSG_WITH_EVENT,
                         serialization=JSON, compression=GZIP)
    return (
        header
        + EVT_START_CONNECTION.to_bytes(4, "big")
        + len(payload_bytes).to_bytes(4, "big")
        + payload_bytes
    )


def make_audio_only_request(
    event: int,
    session_id: str,
    audio_bytes: bytes,
    compression: int = GZIP,
) -> bytes:
    """
    Audio-only request:
      header(4B) + event(4B BE) + session_id_size(4B BE) + session_id + payload_size(4B BE) + payload (gzip + raw audio)
    """
    if compression == GZIP:
        audio_bytes = gzip.compress(audio_bytes)
    sid_bytes = session_id.encode("utf-8") if session_id else b""
    header = make_header(CLIENT_AUDIO_ONLY_REQUEST, flags=MSG_WITH_EVENT,
                         serialization=NO_SERIALIZATION, compression=compression)
    return (
        header
        + event.to_bytes(4, "big")
        + len(sid_bytes).to_bytes(4, "big", signed=True)
        + sid_bytes
        + len(audio_bytes).to_bytes(4, "big")
        + audio_bytes
    )


def parse_response(data: bytes) -> Dict[str, Any]:
    """
    解析服务器响应帧。返回 dict 至少含 message_type / event / payload_msg。
    """
    if isinstance(data, str):
        return {"error": "text frame not expected", "raw": data}
    if len(data) < 4:
        return {"error": "frame too short", "raw_len": len(data)}
    protocol_version = data[0] >> 4
    header_size = data[0] & 0x0F
    message_type = data[1] >> 4
    flags = data[1] & 0x0F
    serialization = data[2] >> 4
    compression = data[2] & 0x0F
    reserved = data[3]
    payload = bytes(data[header_size * 4:])
    result = {
        "protocol_version": protocol_version,
        "message_type": message_type,
        "flags": flags,
        "serialization": serialization,
        "compression": compression,
        "reserved": reserved,
    }
    payload_msg: Any = None
    start = 0
    if message_type in (SERVER_FULL_RESPONSE, SERVER_ACK):
        if flags & NEG_SEQUENCE:
            if len(payload) < 4:
                return {**result, "error": "missing seq"}
            result["seq"] = int.from_bytes(payload[:4], "big")
            start += 4
        if flags & MSG_WITH_EVENT:
            if len(payload) < start + 4:
                return {**result, "error": "missing event"}
            result["event"] = int.from_bytes(payload[start:start + 4], "big")
            start += 4
        payload = payload[start:]
        if len(payload) < 4:
            return {**result, "error": "missing session_id_size"}
        session_id_size = int.from_bytes(payload[:4], "big", signed=True)
        if session_id_size > 0 and len(payload) >= 4 + session_id_size:
            result["session_id"] = payload[4:4 + session_id_size].decode("utf-8", errors="replace")
        else:
            result["session_id"] = ""
        payload = payload[4 + max(0, session_id_size):]
        if len(payload) >= 4:
            payload_size = int.from_bytes(payload[:4], "big")
            result["payload_size"] = payload_size
            payload_msg = payload[4:4 + payload_size]
    elif message_type == SERVER_ERROR_RESPONSE:
        if len(payload) >= 8:
            result["code"] = int.from_bytes(payload[:4], "big")
            payload_size = int.from_bytes(payload[4:8], "big")
            payload_msg = payload[8:8 + payload_size]
        elif len(payload) >= 4:
            result["code"] = int.from_bytes(payload[:4], "big")
    if payload_msg is not None and len(payload_msg) > 0:
        if compression == GZIP:
            try:
                payload_msg = gzip.decompress(payload_msg)
            except Exception as e:
                logger.warning(f"[volc] gzip decompress failed: {e}")
        if serialization == JSON and isinstance(payload_msg, (bytes, bytearray)):
            try:
                payload_msg = json.loads(payload_msg.decode("utf-8"))
            except Exception as e:
                logger.warning(f"[volc] JSON parse failed: {e}")
                payload_msg = payload_msg.decode("utf-8", errors="replace")
        elif serialization == NO_SERIALIZATION and isinstance(payload_msg, (bytes, bytearray)):
            # 音频帧保持 bytes，不解码
            pass
        result["payload_msg"] = payload_msg
    return result


# ========== 归一化事件 ==========

@dataclass
class RealtimeEvent:
    """火山 Realtime 事件归一化结果，供上层 LiveSessionBridge 消费。"""
    type: str  # tts_audio | tts_text | tts_segment_start | user_started | turn_complete | session_finished | dialog_finished | error | invalid_speaker | server_event
    audio: Optional[bytes] = None
    text: Optional[str] = None
    is_final: bool = False
    raw: Optional[dict] = None
    event_id: Optional[int] = None  # 透传火山 event 编号，便于下游精细处理 350/550/351 等


# ========== 客户端 ==========

class VolcRealtimeBridge:
    """
    单次实时会话的火山 WSS 客户端（基于官方 Python SDK 协议）。

    用法：
        bridge = VolcRealtimeBridge(
            api_key=settings.VOLC_REALTIME_API_KEY,
            app_id=settings.VOLC_REALTIME_APP_ID,
            app_key=settings.VOLC_REALTIME_APP_KEY,
            resource_id=settings.VOLC_REALTIME_RESOURCE_ID,
            wss_url=settings.VOLC_REALTIME_WSS_URL,
            voice="zh_male_yunzhou_jupiter_bigtts",
            system_role="你是面试官 ...",
            bot_name="豆包",
        )
        await bridge.connect()
        async for ev in bridge.recv_events():
            ...
        await bridge.close()
    """

    def __init__(
        self,
        api_key: str,
        app_key: str,
        resource_id: str,
        wss_url: str,
        voice: str,
        system_role: str,
        bot_name: str = "面试官",
        speaking_style: str = "你的说话风格简洁明了，语速适中，语调自然。",
        speech_rate: float = 1.0,
        recv_timeout: int = 60,
    ):
        if websockets is None:
            raise ImportError("需要安装 websockets>=12.0")
        if not all([api_key, app_key, resource_id, wss_url]):
            raise ValueError(
                "火山 Realtime 鉴权字段未配置齐全（api_key/app_key/resource_id/wss_url）。"
                "请检查 backend/.env。"
            )
        # 火山 TTS speech_rate 推荐范围 0.5~2.0，超出会被服务端夹断；这里做一次夹断保护
        if speech_rate < 0.5:
            speech_rate = 0.5
        elif speech_rate > 2.0:
            speech_rate = 2.0
        self.api_key = api_key       # e536139a-... (Access Key, → X-Api-Key)
        self.app_key = app_key       # PlgvMymc7f3tQnJ6 (固定常量, → X-Api-App-Key)
        self.resource_id = resource_id
        self.wss_url = wss_url
        self.voice = voice
        self.system_role = system_role
        self.bot_name = bot_name
        self.speaking_style = speaking_style
        self.speech_rate = float(speech_rate)
        self.recv_timeout = recv_timeout

        self._ws = None
        self._closed = False
        self._session_id: str = ""
        self._connect_id = str(uuid.uuid4())
        self._listener_task: Optional[asyncio.Task] = None
        self._out_q: asyncio.Queue[RealtimeEvent] = asyncio.Queue(maxsize=1024)

    # ---------- 生命周期 ----------

    async def connect(self) -> None:
        """
        完整握手：WSS 连接 → StartConnection（拿 session_id）→ StartSession（带配置）→ SayHello（AI 开场白）

        鉴权头（火山 StartSession 错误消息实测确认）：
          X-Api-Key:         <用户 Access Key>       ← e536139a-... (UUID 格式)
          X-Api-App-Key:     PlgvMymc7f3tQnJ6          ← /dialogue 端点的固定常量（错误消息原文：expected:[PlgvMymc7f3tQnJ6]）
          X-Api-Resource-Id: volc.speech.dialog       ← 官方固定
          X-Api-Connect-Id:  <UUID 每次连接随机>     ← 防重放
        """
        logger.info(
            f"[volc] connect wss={self.wss_url} voice={self.voice} "
            f"connect_id={self._connect_id}"
        )
        headers = [
            ("X-Api-Key", self.api_key),                # e536139a-...
            ("X-Api-App-Key", self.app_key),            # PlgvMymc7f3tQnJ6（来自 .env）
            ("X-Api-Resource-Id", self.resource_id),
            ("X-Api-Connect-Id", self._connect_id),
        ]
        self._ws = await websockets.connect(
            self.wss_url,
            additional_headers=headers,
            max_size=10 * 1024 * 1024,
            ping_interval=None,  # SDK 也用 None
        )
        logger.info("[volc] WSS 已建立，发送 StartConnection ...")
        await self._ws.send(make_start_connection_request())
        resp = await self._ws.recv()
        parsed = parse_response(resp)
        logger.info(f"[volc] StartConnection resp: msg_type={parsed.get('message_type')} "
                    f"event={parsed.get('event')} payload={parsed.get('payload_msg')}")
        if parsed.get("message_type") == SERVER_ERROR_RESPONSE:
            raise RuntimeError(f"StartConnection 服务端错误: code={parsed.get('code')} payload={parsed.get('payload_msg')}")
        # 提取 session_id
        if isinstance(parsed.get("payload_msg"), dict) and parsed["payload_msg"].get("session_id"):
            self._session_id = parsed["payload_msg"]["session_id"]
        else:
            # 兜底用 UUID（部分版本会返回空 session_id）
            self._session_id = str(uuid.uuid4())
        logger.info(f"[volc] session_id={self._session_id}")

        # 2. StartSession
        logger.info("[volc] 发送 StartSession ...")
        await self._ws.send(self._make_start_session())
        resp = await self._ws.recv()
        parsed = parse_response(resp)
        logger.info(f"[volc] StartSession resp: msg_type={parsed.get('message_type')} "
                    f"event={parsed.get('event')} payload={parsed.get('payload_msg')}")
        if parsed.get("message_type") == SERVER_ERROR_RESPONSE:
            raise RuntimeError(f"StartSession 服务端错误: code={parsed.get('code')} payload={parsed.get('payload_msg')}")

        # 3. 启动 listener
        self._listener_task = asyncio.create_task(self._listen_loop())
        logger.info("[volc] 握手完成，listener 已启动")

        # 4. AI 开场白由 ws_live 在 router 层通过 say_hello() 触发（EVT_SAY_HELLO=300），
        #    此处不再做 3s 兜底的 chat_text_query，避免双触发导致 AI 连开两次口。
        logger.info("[volc] AI 开场白由 router 层 say_hello() 触发，跳过兜底 chat_text_query")

    def _make_start_session(self) -> bytes:
        """构造 StartSession 事件（配置 ASR / TTS / Dialog）。"""
        config = {
            "asr": {
                "extra": {
                    # 候选人停顿思考的窗口：原 1500ms 太短，思考/回忆细节常 >2s，
                    # 会被服务端 VAD 提前切成多个 utterance，导致用户感觉"回答到一半断了"。
                    # 调到 2000ms 留出思考缓冲；>3000ms 会出现"讲一会儿才上屏"的明显延迟。
                    "end_smooth_window_ms": 2000,
                },
            },
            "tts": {
                "speaker": self.voice,
                "audio_config": {
                    "channel": 1,
                    "format": "pcm_s16le",
                    "sample_rate": 24000,
                },
                "extra": {
                    "speech_rate": self.speech_rate,
                },
            },
            "dialog": {
                "bot_name": self.bot_name,
                "system_role": self.system_role,
                "speaking_style": self.speaking_style,
                "extra": {
                    "strict_audit": False,
                    "recv_timeout": self.recv_timeout,
                    "input_mod": "audio",
                    "model": "1.2.1.1",
                },
            },
        }
        return make_full_request(EVT_START_SESSION, self._session_id, config, JSON, GZIP)

    async def say_hello(self, content: str = "") -> None:
        """让 AI 开场白。空 content 时使用 SDK 默认问候。"""
        payload = {"content": content} if content else {"content": "你好，请开始我们的面试。"}
        if self._ws is None or self._closed:
            return
        try:
            await self._ws.send(make_full_request(EVT_SAY_HELLO, self._session_id, payload, JSON, GZIP))
            logger.info("[volc] SayHello 已发")
        except Exception as e:
            logger.warning(f"[volc] say_hello 失败: {e}")

    async def send_audio(self, pcm_bytes: bytes) -> None:
        """
        发送浏览器 PCM16 音频帧（volc 期望 16kHz；浏览器 24kHz 需在调用方重采样）。
        """
        if self._closed or self._ws is None:
            return
        try:
            await self._ws.send(
                make_audio_only_request(EVT_TASK_REQUEST, self._session_id, pcm_bytes, GZIP)
            )
        except Exception as e:
            logger.warning(f"[volc] send_audio 失败: {e}")

    async def trigger_response(self) -> None:
        """
        主动触发 AI 回应（live_bridge.py 的 client.text 分支会调）。
        火山协议里 VAD 模式自动响应；这里发 chat_text_query 事件（event=501）作为兜底。
        """
        if self._closed or self._ws is None:
            return
        try:
            await self._ws.send(make_full_request(
                EVT_CHAT_TEXT_QUERY, self._session_id, {"content": ""}, JSON, GZIP
            ))
        except Exception as e:
            logger.warning(f"[volc] trigger_response 失败: {e}")

    async def send_chat_text(self, content: str) -> None:
        """
        把一段文本作为"用户输入"注入，让 LLM 看到后自然回应。
        用于快捷操作（跳过 / 提示 / 暂停注入文本让 AI 等待）—— 走 chat_text_query (event 501)。
        """
        if self._closed or self._ws is None:
            return
        if not content or not content.strip():
            return
        try:
            await self._ws.send(make_full_request(
                EVT_CHAT_TEXT_QUERY, self._session_id, {"content": content}, JSON, GZIP
            ))
            logger.info(f"[volc] chat_text_query 已发: {content[:50]!r}")
        except Exception as e:
            logger.warning(f"[volc] send_chat_text 失败: {e}")

    async def cancel_response(self) -> None:
        """
        主动打断 AI 回应（火山 event 450 自动处理打断；这里发一个 finish-session 信号作为兜底）。
        实际效果：让火山停止当前 TTS 流。
        """
        if self._closed or self._ws is None:
            return
        try:
            # 火山没有显式 interrupt 事件；FINISH_SESSION 太重不适合中途打断
            # 这里只打日志，靠 server 端 event 450 触发自动打断
            logger.debug("[volc] cancel_response（占位，靠 server event 450 触发打断）")
        except Exception as e:
            logger.warning(f"[volc] cancel_response 失败: {e}")

    async def close(self) -> None:
        """关闭 WSS，停止监听。"""
        if self._closed:
            return
        self._closed = True
        # 通知火山结束会话
        # websockets>=12 已移除 .closed 属性；FINISH_SESSION 在连接已关时也不必发，
        # close() 本身幂等。下面直接尝试发，send 在 closed 状态会 raise ConnectionClosed。
        if self._ws is not None:
            try:
                await self._ws.send(make_full_request(EVT_FINISH_SESSION, self._session_id, {}, JSON, GZIP))
            except Exception:
                pass
        if self._listener_task and not self._listener_task.done():
            self._listener_task.cancel()
            try:
                await self._listener_task
            except (asyncio.CancelledError, Exception):
                pass
        if self._ws is not None:
            try:
                await self._ws.close()
            except Exception:
                pass
        logger.info("[volc] closed")

    # ---------- 事件归一化 ----------

    def _convert_event(self, parsed: Dict[str, Any]) -> Optional[RealtimeEvent]:
        """
        服务端事件 → 归一化事件。
        旧 live_bridge.py 消费的事件类型：
          tts_audio / tts_end / asr_partial / asr_final / speech_started / speech_stopped / error / dialog_finished
        我们把火山原生事件映射到这套，保证 live_bridge.py 不改：
          音频帧 (SERVER_ACK + bytes payload)   → tts_audio
          359 say_hello_ended                  → tts_end（AI 说完一段）
          450 user_started_speaking            → speech_started（候选人开口）
          459 turn_complete                    → speech_stopped（候选人停嘴，给 AI 让路）
          350 chat_tts_text                    → tts_end（chat TTS 段结束）
          152/153 session_finished             → dialog_finished（WS 关）
          0xf SERVER_ERROR                    → error
        ASR 文本（用户说的话）火山不会显式推，需要在 PR4+ 从 TTS 上下文回溯 / 或引入 TTS 文本段
        """
        msg_type = parsed.get("message_type")
        event_id = parsed.get("event", 0)
        payload = parsed.get("payload_msg")

        # SERVER_ACK (0xb): 可能是音频帧（payload 是 bytes）
        if msg_type == SERVER_ACK:
            if isinstance(payload, (bytes, bytearray)) and len(payload) > 0:
                return RealtimeEvent(type="tts_audio", audio=bytes(payload), raw=parsed)
            return None

        # SERVER_FULL_RESPONSE (0x9)
        if msg_type == SERVER_FULL_RESPONSE:
            if event_id == EVT_SRV_SAY_HELLO_ENDED:
                return RealtimeEvent(type="tts_end", raw=parsed, event_id=event_id)
            if event_id == EVT_SRV_USER_STARTED:
                return RealtimeEvent(type="speech_started", raw=parsed, event_id=event_id)
            if event_id == EVT_SRV_USER_TRANSCRIPTION:
                # 用户 ASR 文本：partial 是连续打字机效果，final（endpoint=True）是整句定稿
                # payload 结构: {extra: {origin_text, endpoint?, soft_finish_paralinguistic?...}, results: [...]}
                if isinstance(payload, dict):
                    extra = payload.get("extra") or {}
                    origin_text = (extra.get("origin_text") or "").strip()
                    is_final = bool(extra.get("endpoint"))
                    if origin_text:
                        return RealtimeEvent(
                            type="asr_final" if is_final else "asr_partial",
                            text=origin_text, is_final=is_final,
                            raw=parsed, event_id=event_id,
                        )
                return None
            if event_id == EVT_SRV_TURN_COMPLETE:
                return RealtimeEvent(type="speech_stopped", raw=parsed, event_id=event_id)
            if event_id in (EVT_SRV_SESSION_END_1, EVT_SRV_SESSION_END_2):
                return RealtimeEvent(type="dialog_finished", raw=parsed, event_id=event_id)
            # Chat TTS 文本流（按火山实战 payload 分别归一化）：
            # - event 350 = 段起始占位（text=''），仅作 AI 状态信号，不当成 tts_end
            # - event 550 = 增量 chunk，字段 {content, question_id, reply_id}（无 amount）
            # - event 351 = 整句结束，字段 {text, amount, reply_id, sentence_duration}
            if event_id == 350:
                # 段起始占位：通常 text 为空，让上层知道有 reply 即将开始
                if isinstance(payload, dict) and payload.get("text", "") == "":
                    return RealtimeEvent(type="tts_segment_start", raw=parsed, event_id=event_id)
                # 兜底：极少数版本 350 也带 text，走通用 tts_text 路径
            if event_id == 550:
                if isinstance(payload, dict):
                    content = payload.get("content") or ""
                    if content:
                        return RealtimeEvent(
                            type="tts_text", text=content, is_final=False,
                            raw=parsed, event_id=event_id,
                        )
                return None
            if event_id == 351:
                if isinstance(payload, dict):
                    text = payload.get("text") or ""
                    if text:
                        return RealtimeEvent(
                            type="tts_text", text=text, is_final=True,
                            raw=parsed, event_id=event_id,
                        )
                return None
            # 通用兜底（兼容其他 chat tts 变体事件）
            if isinstance(payload, dict):
                text = payload.get("content") or payload.get("text") or payload.get("reply_text") or ""
                if text and isinstance(text, str):
                    return RealtimeEvent(
                        type="tts_text", text=text, is_final=False,
                        raw=parsed, event_id=event_id,
                    )
                # ASR 结果（候选字段）
                if any(k in payload for k in ("asr_text", "user_text", "transcript", "recognized_text")):
                    user_text = payload.get("asr_text") or payload.get("user_text") or payload.get("transcript") or payload.get("recognized_text") or ""
                    if user_text:
                        is_final = payload.get("is_final", True)
                        return RealtimeEvent(
                            type="asr_final" if is_final else "asr_partial",
                            text=user_text, is_final=is_final, raw=parsed, event_id=event_id,
                        )
            # 其他事件：调试日志
            logger.debug(f"[volc] 未映射 server event: {event_id} payload={payload}")
            return None

        # SERVER_ERROR_RESPONSE (0xf)
        if msg_type == SERVER_ERROR_RESPONSE:
            logger.error(f"[volc] 服务端错误: code={parsed.get('code')} payload={payload}")
            text = json.dumps(payload, ensure_ascii=False) if payload is not None else str(parsed.get("code"))
            # 火山音色 ID 校验失败（sami error / codes=40000000 / InvalidSpeaker）：
            # 单独发一类事件，让 live_bridge 触发"音色 fallback + 关闭会话"链路，
            # 避免对牛弹琴 30 秒。
            if isinstance(payload, dict) and "InvalidSpeaker" in str(payload.get("error", "")):
                return RealtimeEvent(type="invalid_speaker", raw=parsed, text=text)
            return RealtimeEvent(type="error", raw=parsed, text=text)

        return None

    async def _listen_loop(self) -> None:
        """WSS 事件监听：解析二进制帧 → 归一化推到 _out_q。"""
        try:
            async for raw_msg in self._ws:
                if self._closed:
                    break
                # 火山协议所有帧都是 binary（不是 text）；但保险起见做 isinstance
                if isinstance(raw_msg, str):
                    logger.warning(f"[volc] 收到 text 帧（异常）: {raw_msg[:200]}")
                    continue
                if not isinstance(raw_msg, (bytes, bytearray)) or len(raw_msg) < 4:
                    logger.warning(f"[volc] 收到异常帧 type={type(raw_msg).__name__} len={len(raw_msg) if hasattr(raw_msg,'__len__') else '?'}")
                    continue
                parsed = parse_response(raw_msg)
                ev = self._convert_event(parsed)
                if ev is not None:
                    try:
                        self._out_q.put_nowait(ev)
                    except asyncio.QueueFull:
                        logger.warning("[volc] 事件队列满，丢弃")
        except ConnectionClosed as cc:
            try:
                logger.error(f"[volc] WSS 关闭 code={cc.code} reason={cc.reason!r}")
            except Exception:
                logger.error("[volc] WSS 关闭")
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.exception(f"[volc] listen_loop 异常: {e}")
        finally:
            self._closed = True
            # 推一个 dialog_finished 让上层退出
            try:
                self._out_q.put_nowait(RealtimeEvent(type="dialog_finished", raw={}))
            except Exception:
                pass

    async def recv_events(self) -> AsyncIterator[RealtimeEvent]:
        while True:
            ev = await self._out_q.get()
            yield ev
            if ev.type == "dialog_finished":
                return
