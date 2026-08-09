"""
实时语音面试 Bridge：管理浏览器 ↔ 后端 ↔ 火山三方的事件转发。

PR2 范围：echo 模式（volc=None），不接火山。浏览器发的 audio / text 帧原样回送。
PR3 范围：接入 VolcRealtimeBridge 后，audio 帧转发给火山，volc 的 tts_audio / asr_final / dialog_finished 事件
        推回浏览器。
PR4 范围：bridge 结束时把累积的 transcript 写入 InterviewTranscript.data，再触发 run_real_analysis。

设计文档：saas/ai面试教练/new/模拟面试.md (v1.2 §6.6)
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import struct
import time
from datetime import datetime
from typing import TYPE_CHECKING, Optional

from fastapi import WebSocket, WebSocketDisconnect
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app import models
from app.config import settings

if TYPE_CHECKING:
    from app.services.volc_realtime_bridge import VolcRealtimeBridge
    from app.services.volc_streaming_asr import VolcStreamingAsrBridge

logger = logging.getLogger(__name__)


def _downsample_pcm16_24k_to_16k(pcm24k: bytes) -> bytes:
    """
    浏览器上行的 PCM16/24kHz/mono → 火山流式 ASR 要求的 PCM16/16kHz/mono。

    用线性插值做 3:2 降采样（24k → 16k）。整帧丢失 1 个采样点（首部），对 STT 识别无感。
    实现简单，避免引 numpy/scipy/scipy.signal 等额外依赖。
    """
    n_in = len(pcm24k) // 2  # 采样点数
    if n_in == 0:
        return b""
    samples = list(struct.unpack(f"<{n_in}h", pcm24k[:n_in * 2]))
    n_out = (n_in * 2) // 3  # 24k→16k = 2:3 ratio，输出点数 ≈ 输入 * 2/3
    if n_out <= 0:
        return b""
    out = []
    # 每个输出 i 对应输入位置 i * 1.5
    for i in range(n_out):
        pos = i * 3 / 2  # 24k 采样位置
        idx = int(pos)
        frac = pos - idx
        if idx >= n_in - 1:
            out.append(samples[-1])
        else:
            # 线性插值
            v = int(samples[idx] * (1 - frac) + samples[idx + 1] * frac)
            # 限幅（防止溢出）
            if v > 32767: v = 32767
            elif v < -32768: v = -32768
            out.append(v)
    return struct.pack(f"<{len(out)}h", *out)


class LiveSessionBridge:
    """
    单个 live session 的桥接器。生命周期与一个浏览器 WS 连接一一对应。

    模式：
    - volc=None: echo 模式（PR2 验证用）
    - volc=VolcRealtimeBridge: 接入火山（PR3）
    """

    PING_TIMEOUT_S = 180
    # 整段最长时长（秒）= 用户配置 + 60s 缓冲
    DURATION_BUFFER_S = 60
    # AI TTS 静音兜底归零窗口：1.5s 没新 tts_audio 帧视为 AI 整段说完，
    # 归零 _ai_is_speaking + _manual_submit_pending，让后续用户 ASR 能正常入库。
    # 1.5s 取值依据：TTS 句内帧间隔 ≤ 200ms，句间停顿 200~500ms，段间停顿通常 ≥ 1s。
    AI_SILENCE_RESET_S = 1.5

    def __init__(
        self,
        ws: WebSocket,
        row: models.InterviewLiveSession,
        db: AsyncSession,
        volc: Optional["VolcRealtimeBridge"] = None,  # PR3 类型 VolcRealtimeBridge, PR2 为 None
        asr_bridge: Optional["VolcStreamingAsrBridge"] = None,  # PR-N 流式短语音识别 VolcStreamingAsrBridge
        slots: Optional["object"] = None,  # 并发槽位管理器 SlotManager（心跳续期 + 结束释放）
    ):
        self.ws = ws
        self.row = row
        self.db = db
        self.volc = volc
        self.asr_bridge = asr_bridge
        self.slots = slots
        self._closed = False
        self._live_id: int = int(row.id)
        # 候选人累积 transcript（PR2 echo 模式也写，给 PR4 归档备用）
        self._transcript: list[dict] = []
        self._seq = 0
        self._last_activity_ts: float = 0
        self._duration_sec: int = 0
        self._started_ts: float = 0
        # PR3: AI 状态机（idle / listening / thinking / speaking）
        self._ai_state: str = "idle"
        self._ai_is_speaking: bool = False  # 用于打断判断
        self._last_tts_audio_ts: float = 0.0
        self._ai_silence_reset_task: Optional[asyncio.Task] = None
        # PR3: volc 事件监听协程
        self._volc_listener_task: Optional[asyncio.Task] = None
        # PR-N: 流式 ASR 事件监听协程 + 候选人 text 缓冲（按 session 内 utterance 累加）
        self._asr_listener_task: Optional[asyncio.Task] = None
        self._candidate_text_buf: str = ""  # 累积最新一段 partial，final 到来后清空
        self._candidate_last_final_ts: float = 0.0
        # 流式 tts_text 缓冲：reply_id → {chunks, amount, ...}
        import time as _time
        self._tts_text_buf: dict = {}
        # PR5: 消息缓冲——面试过程中不写库，结束时批量 INSERT
        # 每条 dict: {seq, speaker, content_json}
        self._pending_messages: list[dict] = []
        # 发言交接模式（auto=自动感应 / manual=手动提交）与手动提交触发标志
        self.speech_mode: str = "auto"
        # 初始设为 True，保证首题/AI 开场白顺利发送与发音
        self._manual_submit_pending: bool = True

    # ---------- AI 状态机辅助 ----------
    async def _set_ai_state(self, new_state: str) -> None:
        """
        改 AI 状态机。状态有变化时才推 live.metrics 给前端，避免 ws 帧风暴。
        这是修复「AI 状态一直停在 speaking」bug 的关键：之前所有 _ai_state 赋值都没推事件，
        前端只能靠 binary 帧（一来就 set speaking）来推断；现在每次状态变更都明确告知前端。
        """
        if new_state == self._ai_state:
            return
        self._ai_state = new_state
        try:
            await self._send_text_event({
                "type": "live.metrics",
                "ai_state": new_state,
            })
        except Exception as e:
            logger.debug(f"[bridge] push live.metrics 失败: {e}")

    # ---------- 主循环 ----------

    async def run(self) -> None:
        """主循环：监听浏览器 WS 直到 close。"""
        import time
        self._started_ts = time.time()
        self._last_activity_ts = self._started_ts

        # 1. 推 server_ready 消息给浏览器
        await self._send_text_event({
            "type": "live.ready",
            "live_session_id": self._live_id,
            "sample_rate": 24000,
            "encoding": "pcm16",
            "interview_type": self.row.interview_type,
            "difficulty": self.row.difficulty,
            "duration_min": self.row.duration_min,
            "followup_rounds": self.row.followup_rounds,
            "ts": datetime.utcnow().isoformat() + "Z",
        })
        # 同步推一次 AI 状态（默认 listening：等候选人开口或 SayHello 触发 speaking）
        self._ai_state = "listening"
        await self._send_text_event({
            "type": "live.metrics",
            "ai_state": self._ai_state,
        })
        logger.info(f"[bridge] live_id={self._live_id} ready, mode={'volc' if self.volc else 'echo'}")

        # 2. 启动 ping watchdog
        watchdog_task = asyncio.create_task(self._ping_watchdog())

        # 3. 启动 volc 事件监听（PR3，volc 不为 None 时）
        if self.volc is not None:
            self._volc_listener_task = asyncio.create_task(self._volc_event_loop())

        # 3b. 启动流式 ASR 监听（PR-N，火山 seedasr.sauc，独立于 realtime dialog）
        #     浏览器 mic PCM 通过 _on_binary → asr_bridge.send_pcm（24k→16k 降采样），
        #     ASR 吐 partial/final → broadcast 为 live.transcript(role=candidate)
        if self.asr_bridge is not None:
            try:
                self._asr_listener_task = asyncio.create_task(self._asr_event_loop())
                logger.info(f"[bridge] live_id={self._live_id} 流式 ASR listener 启动")
            except Exception as e:
                logger.warning(f"[bridge] live_id={self._live_id} ASR listener 启动失败: {e}")

        try:
            while not self._closed:
                # 接收浏览器消息（text 或 binary）
                msg = await self.ws.receive()
                self._last_activity_ts = time.time()

                if msg.get("type") == "websocket.disconnect":
                    logger.info(f"[bridge] live_id={self._live_id} 浏览器 disconnect")
                    break

                if "text" in msg:
                    await self._on_text(msg["text"])
                elif "bytes" in msg:
                    await self._on_binary(msg["bytes"])
                else:
                    logger.warning(f"[bridge] 未知消息 type={msg.get('type')}")
        except WebSocketDisconnect:
            logger.info(f"[bridge] live_id={self._live_id} WebSocketDisconnect")
        except Exception as e:
            logger.exception(f"[bridge] live_id={self._live_id} 主循环异常: {e}")
        finally:
            watchdog_task.cancel()
            try:
                await watchdog_task
            except (asyncio.CancelledError, Exception):
                pass
            await self._on_close()

    # ---------- ping watchdog ----------

    async def _ping_watchdog(self) -> None:
        """60s 无活动则主动 close 4002；PR4：监听到 status='ending' 主动 close。"""
        while not self._closed:
            await asyncio.sleep(5)
            import time
            # 续期并发槽位 TTL（防止会话被 SlotManager 当作僵尸回收）
            if self.slots is not None:
                try:
                    await self.slots.heartbeat(self._live_id)
                except Exception as e:
                    logger.debug(f"[bridge] 槽位心跳失败(忽略): {e}")
            # PR4: 监听 status='ending' 信号（end 端点设置）→ 主动关闭
            try:
                await self.db.refresh(self.row)
                if self.row.status == "ending":
                    logger.info(
                        f"[bridge] live_id={self._live_id} 收到 end 信号 (status=ending), 主动关闭"
                    )
                    self._closed = True
                    try:
                        await self.ws.close(code=1000, reason="ended by user")
                    except Exception:
                        pass
                    return
            except Exception as e:
                logger.debug(f"[bridge] 读 status 失败: {e}")

            idle = time.time() - self._last_activity_ts
            if idle > self.PING_TIMEOUT_S:
                logger.warning(
                    f"[bridge] live_id={self._live_id} ping 超时 ({idle:.1f}s), 主动关闭"
                )
                self._closed = True
                try:
                    await self.ws.close(code=4002, reason="ping timeout")
                except Exception:
                    pass
                return

            # 整段时长上限
            elapsed = time.time() - self._started_ts
            max_sec = self.row.duration_min * 60 + self.DURATION_BUFFER_S
            if elapsed > max_sec:
                logger.warning(
                    f"[bridge] live_id={self._live_id} 超 duration_min 限制 ({elapsed:.1f}s), 主动关闭"
                )
                self._closed = True
                try:
                    await self.ws.close(code=4003, reason="max duration reached")
                except Exception:
                    pass
                return

    # ---------- 浏览器消息分发 ----------

    async def _on_text(self, raw: str) -> None:
        """处理浏览器 JSON 文本帧。"""
        try:
            data = json.loads(raw)
        except json.JSONDecodeError as e:
            logger.warning(f"[bridge] JSON 解析失败: {e}")
            return
        mtype = data.get("type")
        if mtype == "ping":
            await self._send_text_event({"type": "pong", "ts": datetime.utcnow().isoformat() + "Z"})
            return
        if mtype == "client.mic":
            muted = bool(data.get("muted"))
            logger.info(f"[bridge] mic muted={muted}")
            return
        if mtype == "client.event":
            # 透传：保留给不需要 AI 响应的辅助信号（如 UI 调试）
            logger.info(f"[bridge] client.event name={data.get('name')} payload={data.get('payload')}")
            return
        if mtype == "client.quick_action":
            # 快捷操作（暂停 / 跳过 / 提示）：持久化 + 必要时注入文本让 AI 知道
            await self._handle_quick_action(data)
            return
        if mtype == "client.speech_mode":
            mode = data.get("mode", "auto")
            self.speech_mode = mode
            logger.info(f"[bridge] speech_mode changed to {self.speech_mode}")
            return
        if mtype == "client.text":
            # 候选人发送文本（如手动提交【回答完毕】）
            text = data.get("content", "")
            logger.info(f"[bridge] candidate text: {text[:50]}...")
            self._seq += 1
            self._transcript.append({
                "seq": self._seq, "speaker": "candidate",
                "start_time": 0, "end_time": 0, "content": text,
            })
            if self.volc is not None and text.strip():
                try:
                    self._manual_submit_pending = True
                    await self.volc.send_chat_text(text)
                except Exception as e:
                    logger.warning(f"[bridge] volc.send_chat_text 失败: {e}")
            else:
                # PR2 echo: 模拟 AI 回应
                await asyncio.sleep(0.3)
                await self._send_text_event({
                    "type": "live.transcript",
                    "role": "interviewer",
                    "text": f"echo: {text}",
                    "partial": False,
                    "t0": 0, "t1": 0,
                })
            return
        if mtype == "client.interrupt":
            # 用户主动打断 AI
            if self.volc is not None:
                try:
                    await self.volc.cancel_response()
                except Exception as e:
                    logger.warning(f"[bridge] volc.cancel_response 失败: {e}")
            else:
                self._ai_state = "idle"
                self._ai_is_speaking = False
                await self._send_text_event({
                    "type": "live.metrics",
                    "ai_state": self._ai_state,
                })
            return
        if mtype == "client.stt":
            # 浏览器 Web Speech API 旁路识别
            # 当接入 volc 时，由 volc 的 asr_partial / asr_final 统一进行单源 ASR 广播与落库，
            # 避免浏览器旁路 STT 与火山服务端 ASR 双路并行导致记录重复和顺序倒置。
            if self.volc is not None:
                return
            text = (data.get("text") or "").strip()
            is_final = bool(data.get("partial") is False)
            if not text:
                return
            # 仅在无 volc (echo 模式) 时广播和记录
            await self._send_text_event({
                "type": "live.transcript",
                "role": "candidate",
                "text": text,
                "partial": not is_final,
                "t0": 0, "t1": 0,
            })
            if not is_final:
                return
            import time as _time
            self._seq += 1
            end_ts = _time.time()
            self._transcript.append({
                "seq": self._seq, "speaker": "candidate",
                "start_time": 0, "end_time": 0, "content": text,
            })
            self._pending_messages.append({
                "seq": self._seq,
                "content": {
                    "speaker": "candidate",
                    "seq": self._seq,
                    "text": text,
                    "started_at": end_ts,
                    "ended_at": end_ts,
                    "reply_id": "browser-stt",
                    "chunk_count": 1,
                },
            })
            logger.info(
                f"[bridge] candidate stt final (echo mode) seq={self._seq} text={text[:50]!r}"
            )
            return
        logger.debug(f"[bridge] 未处理 text type={mtype}")

    # ---------- volc 事件循环（PR3） ----------

    async def _volc_event_loop(self) -> None:
        """从 volc 消费归一化事件，转发给浏览器；维护 AI 状态机。"""
        if self.volc is None:
            return
        logger.info(f"[bridge] live_id={self._live_id} volc listener started")
        try:
            async for ev in self.volc.recv_events():
                if self._closed:
                    break
                await self._handle_volc_event(ev)
                if ev.type == "dialog_finished":
                    # volc WSS 关闭，结束
                    logger.info(f"[bridge] live_id={self._live_id} volc dialog_finished")
                    break
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.exception(f"[bridge] volc event loop 异常: {e}")
        finally:
            logger.info(f"[bridge] live_id={self._live_id} volc listener stopped")

    async def _handle_volc_event(self, ev) -> None:
        """归一化事件 → 浏览器 WS 消息 + AI 状态机更新。"""
        if ev.type == "tts_segment_start":
            if self.speech_mode == "manual" and not self._manual_submit_pending:
                logger.info("[bridge] 手动交接模式下：打断并静音 VAD 自动触发的 AI 追问")
                if self.volc:
                    try:
                        await self.volc.cancel_response()
                    except Exception:
                        pass
                await self._set_ai_state("idle")
                return
            await self._set_ai_state("speaking")
            return
        if ev.type == "tts_text":
            if self.speech_mode == "manual" and not self._manual_submit_pending:
                return
            # AI 流式文本（event 350/351 sentence streaming）
            # 一句话被切碎成 N 个 chunk 推过来，要按 reply_id 攒齐再写库
            await self._handle_tts_text_stream(ev)
            return
        if ev.type == "tts_audio":
            self._last_tts_audio_ts = time.time()
            self._schedule_ai_silence_reset()
            if self.speech_mode == "manual" and not self._manual_submit_pending:
                if self.volc:
                    try:
                        await self.volc.cancel_response()
                    except Exception:
                        pass
                await self._set_ai_state("idle")
                return
            # AI 语音片段，推浏览器（二进制）
            if ev.audio:
                await self._set_ai_state("speaking")
                self._ai_is_speaking = True
                try:
                    await self.ws.send_bytes(ev.audio)
                except Exception as e:
                    logger.warning(f"[bridge] send_bytes tts_audio 失败: {e}")
                    self._closed = True
            return
        if ev.type == "tts_end":
            # 一段 AI 音频结束 → 切回 idle，重置手动提交标志
            self._ai_is_speaking = False
            self._manual_submit_pending = False
            await self._set_ai_state("idle")
            return
        if ev.type == "asr_partial":
            if self._ai_is_speaking:
                logger.debug("[bridge] AI 说话中，丢弃 asr_partial (TTS 回音)")
                return
            # 候选人 partial 文本
            await self._set_ai_state("thinking")
            await self._send_text_event({
                "type": "live.transcript",
                "role": "candidate",
                "text": ev.text or "",
                "partial": True,
                "t0": 0, "t1": 0,
            })
            return
        if ev.type == "asr_final":
            if self._ai_is_speaking:
                logger.debug("[bridge] AI 说话中，丢弃 asr_final (TTS 回音)")
                return
            # 候选人 final 文本 → 写入 transcript（内存）+ pending 缓冲（结束批量落库）
            self._seq += 1
            content = ev.text or ""
            self._transcript.append({
                "seq": self._seq, "speaker": "candidate",
                "start_time": 0, "end_time": 0, "content": content,
            })
            # 不写库，推浏览器 + 入 pending 缓冲
            await self._send_text_event({
                "type": "live.transcript",
                "role": "candidate",
                "text": content,
                "partial": False,
                "t0": 0, "t1": 0,
            })
            import time as _time
            self._pending_messages.append({
                "seq": self._seq,
                "content": {
                    "speaker": "candidate",
                    "seq": self._seq,
                    "text": content,
                    "started_at": _time.time(),
                    "ended_at": _time.time(),
                },
            })
            # 候选人说完 final 后 AI 通常在思考/正在组织回答，保持 listening 即可
            await self._set_ai_state("listening")
            return
        if ev.type == "speech_started":
            # 候选人开始说话 → 如果 AI 在讲，发 cancel
            await self._set_ai_state("listening")
            if self._ai_is_speaking and self.volc is not None:
                logger.info(f"[bridge] 候选人打断 AI 说话")
                try:
                    await self.volc.cancel_response()
                except Exception:
                    pass
                self._ai_is_speaking = False
            return
        if ev.type == "speech_stopped":
            # 候选人停嘴 → 切 thinking（AI 在组织下一段回答）
            await self._set_ai_state("thinking")
            return
        if ev.type == "error":
            logger.error(f"[bridge] volc error: {ev.text}")
            await self._send_text_event({
                "type": "live.error",
                "code": 500,
                "message": ev.text or "volc error",
            })
            return
        if ev.type == "invalid_speaker":
            # 火山音色 ID 不可用：立刻关闭会话让前端走分析流程，
            # 避免"对牛弹琴 30 秒"。
            logger.error(
                f"[bridge] live_id={self._live_id} 火山音色无效，主动终止会话 "
                f"(voice={getattr(self.volc, 'voice', '?')}): {ev.text}"
            )
            await self._send_text_event({
                "type": "live.error",
                "code": 5501,
                "message": (
                    f"AI 面试官音色配置不可用（{getattr(self.volc, 'voice', '?')}）。"
                    "已自动结束本场面试，请稍后重试或联系管理员。"
                ),
            })
            # 触发主循环 finally → _on_close → 关 volc + 写 transcript → DB status=ended
            # 浏览器侧会收到 ws close，触发 useRealtimeSession 的 onAutoEnd → POST /end → 分析流程
            self._closed = True
            try:
                await self.ws.close(code=1011, reason="invalid_speaker")
            except Exception:
                pass
            return
        if ev.type == "dialog_finished":
            # 让 _volc_event_loop 退出
            return
        # 其他事件忽略
        logger.debug(f"[bridge] 未映射 volc event: {ev.type}")

    # ---------- AI TTS 静音兜底归零 ----------

    def _schedule_ai_silence_reset(self) -> None:
        """
        启动/重置一个 1.5s 的兜底 timer：到点后如果 _last_tts_audio_ts 仍未刷新，
        就归零 _ai_is_speaking + _manual_submit_pending + ai_state=idle，
        让后续用户 ASR partial/final 能正常入库（不被"TTS 回音"分支丢弃）。

        每次 tts_audio 来都会重新 schedule，自动覆盖旧 timer；旧的 timer 在被覆盖时
        被 cancel，永远只有一个挂起的 timer。
        """
        prev = self._ai_silence_reset_task
        if prev and not prev.done():
            prev.cancel()

        async def _reset():
            try:
                await asyncio.sleep(self.AI_SILENCE_RESET_S)
            except asyncio.CancelledError:
                return
            if self._closed:
                return
            # 距离最后一次音频已 ≥ 阈值 → AI 整段说完
            if time.time() - self._last_tts_audio_ts >= self.AI_SILENCE_RESET_S - 0.05:
                if self._ai_is_speaking or self._manual_submit_pending:
                    logger.info(
                        f"[bridge] live_id={self._live_id} AI TTS 静音 {self.AI_SILENCE_RESET_S}s，"
                        f"兜底归零 _ai_is_speaking / _manual_submit_pending"
                    )
                    self._ai_is_speaking = False
                    self._manual_submit_pending = False
                    try:
                        await self._set_ai_state("idle")
                    except Exception:
                        pass

        self._ai_silence_reset_task = asyncio.create_task(_reset())

    # ---------- 流式 ASR 事件监听（PR-N） ----------

    async def _asr_event_loop(self) -> None:
        """
        消费 VolcStreamingAsrBridge 的 partial/final 事件，
        broadcast 为 live.transcript(role=candidate) 给前端，并落到 _pending_messages 归档。
        """
        try:
            async for ev in self.asr_bridge.recv_events():
                if self._closed:
                    break
                if ev.type == "closed":
                    logger.info(f"[bridge] live_id={self._live_id} ASR listener 收到 closed")
                    break
                if ev.type == "error":
                    logger.error(f"[bridge] live_id={self._live_id} ASR error: {ev.detail}")
                    continue
                if ev.type not in ("partial", "final"):
                    continue

                text = (ev.text or "").strip()
                if not text:
                    continue

                # 实时推浏览器：partial/final 都发，partial 让前端做打字机，final 让前端定稿
                await self._send_text_event({
                    "type": "live.transcript",
                    "role": "candidate",
                    "text": text,
                    "partial": ev.type != "final",
                    "t0": 0, "t1": 0,
                })

                if ev.type == "final":
                    # 落库（PR5 pending 缓冲，结束统一写 JSONB）
                    import time as _time
                    self._seq += 1
                    end_ts = _time.time()
                    self._candidate_last_final_ts = end_ts
                    self._transcript.append({
                        "seq": self._seq, "speaker": "candidate",
                        "start_time": 0, "end_time": 0, "content": text,
                    })
                    self._pending_messages.append({
                        "seq": self._seq,
                        "content": {
                            "speaker": "candidate",
                            "seq": self._seq,
                            "text": text,
                            "started_at": end_ts,
                            "ended_at": end_ts,
                            "reply_id": "streaming-asr",
                            "chunk_count": 1,
                        },
                    })
                    # final 到位：让 AI 切回 thinking（后端通常会被 volc event 459 / 我们的 aai_state 接管，
                    # 但为了保险在这里也刷一次）
                    self._ai_state = "listening"
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.exception(f"[bridge] live_id={self._live_id} ASR event loop 异常: {e}")
        finally:
            logger.info(f"[bridge] live_id={self._live_id} ASR event loop stopped")

    async def _on_binary(self, data: bytes) -> None:
        """处理浏览器二进制音频帧（PCM16/24kHz/单声道/20ms）。"""
        if self.volc is not None:
            try:
                pcm16k = _downsample_pcm16_24k_to_16k(data)
                await self.volc.send_audio(pcm16k)
            except Exception as e:
                logger.warning(f"[bridge] volc.send_audio 失败: {e}")
        else:
            # PR2 echo: 原样回送（让前端看到链路通）
            try:
                await self.ws.send_bytes(data)
            except Exception as e:
                logger.warning(f"[bridge] echo 音频失败: {e}")

        if self.asr_bridge is not None and self.volc is None:
            try:
                pcm16k = _downsample_pcm16_24k_to_16k(data)
                await self.asr_bridge.send_pcm(pcm16k)
            except Exception as e:
                logger.warning(f"[bridge] asr.send_pcm 失败: {e}")

    # ---------- 推消息给浏览器 ----------

    async def _send_text_event(self, payload: dict) -> None:
        if self._closed:
            return
        try:
            await self.ws.send_text(json.dumps(payload, ensure_ascii=False))
        except Exception as e:
            logger.warning(f"[bridge] send_text 失败: {e}")
            self._closed = True

    # ---------- 快捷操作（PR-N：暂停 / 跳过 / 提示） ----------

    async def _handle_quick_action(self, data: dict) -> None:
        """
        浏览器发送 {type: client.quick_action, action: 'pause'|'skip'|'hint', payload?: {...}}
        - 持久化：所有 quick_action 入 _pending_messages（speaker=system, content.kind=action），
          报告页可复盘"候选人在 Q3 跳过了本题"。
        - 暂停特殊：mute mic + 注入文本让 AI 等待 + 30s 定时器自动恢复。
        - 跳过/提示：注入文本让 AI 知道，不需要本地状态。
        """
        import time as _time
        action = data.get("action")
        payload = data.get("payload") or {}
        if action not in ("pause", "skip", "hint", "complete_turn"):
            logger.warning(f"[bridge] 未识别的 quick_action: {action}")
            return

        # 1. 持久化到 pending_messages
        self._seq += 1
        now = _time.time()
        self._pending_messages.append({
            "seq": self._seq,
            "content": {
                "speaker": "system",
                "seq": self._seq,
                "kind": f"quick_action.{action}",
                "payload": payload,
                "started_at": now,
                "ended_at": now,
            },
        })

        # 2. 通知浏览器（让前端按钮态切换、倒计时等）
        await self._send_text_event({
            "type": "live.quick_action",
            "action": action,
            "seq": self._seq,
            "ts": now,
        })

        # 3. 行为分发
        if action == "pause":
            duration = int(payload.get("duration", 30))
            await self._apply_pause(duration)
        elif action == "complete_turn":
            self._manual_submit_pending = True
            logger.info(f"[bridge] live_id={self._live_id} 手动交接：收到 complete_turn，触发 AI 提问/追问")
            try:
                if self.volc:
                    await self.volc.send_chat_text("候选人说：【我已回答完毕】。请面试官进行针对性点评或继续提出下一个面试问题。")
            except Exception as e:
                logger.warning(f"[bridge] complete_turn 触发 AI 回应失败: {e}")
        elif action == "skip":
            # 注入文本让 AI 知道要切下一题
            self._manual_submit_pending = True
            try:
                await self.volc.send_chat_text(
                    f"候选人说：本题我不太清楚，请直接出下一题。"
                )
            except Exception as e:
                logger.warning(f"[bridge] skip→inject text 失败: {e}")
        elif action == "hint":
            self._manual_submit_pending = True
            try:
                await self.volc.send_chat_text(
                    "系统提示：候选人在请求提示。请用一句话给一个关键词线索，但不要直接给答案。"
                )
            except Exception as e:
                logger.warning(f"[bridge] hint→inject text 失败: {e}")

    async def _apply_pause(self, duration: int) -> None:
        """
        候选人按「暂停」：30s 内屏蔽 mic + 让 AI 等待。
        注意：火山 realtime 没法彻底关 VAD，我们靠两条路径协同：
        1) 通知前端 mic 静音（前端 audio hook stop 推 audio frame）
        2) 推注入文本「我需要 30 秒思考」让 AI 知道进入静默期
        3) duration 秒后自动恢复 + 推「我准备好了」让 AI 继续
        """
        import time as _time
        # 通知前端进入 paused 态（前端用此启倒计时 UI + 屏蔽 mic 帧）
        await self._send_text_event({
            "type": "live.pause",
            "active": True,
            "duration": duration,
            "ts": _time.time(),
        })
        # 注入文本让 AI 进入静默等待
        try:
            await self.volc.send_chat_text(
                f"候选人说：我需要 {duration} 秒时间思考一下，请稍等，不要打断我。"
            )
        except Exception as e:
            logger.warning(f"[bridge] pause→inject 失败: {e}")

        # 启动定时器：duration 秒后恢复
        async def _resume():
            try:
                await asyncio.sleep(duration)
            except asyncio.CancelledError:
                return
            if self._closed:
                return
            await self._send_text_event({
                "type": "live.pause",
                "active": False,
                "ts": _time.time(),
            })
            try:
                await self.volc.send_chat_text("我准备好了，请继续。")
            except Exception as e:
                logger.warning(f"[bridge] pause resume→inject 失败: {e}")

        # 取消旧定时器（如有），避免连点累积
        prev = getattr(self, "_pause_task", None)
        if prev and not prev.done():
            prev.cancel()
        self._pause_task = asyncio.create_task(_resume())

    # ---------- 关闭 / 归档 ----------

    async def _on_close(self) -> None:
        """
        WS 关闭时清理：把整场面试的全部对话打成一个大 JSON 一次 UPDATE 到
        interview_live_sessions.transcript（JSONB 字段），同时更新 session 状态、
        关闭火山连接。

        设计原则：避免一行一记录导致 interview_live_messages 表爆炸，
        整场面试一条记录，所有对话存在 transcript JSONB 字段里。
        """
        if self._closed and self._transcript:  # 避免重复触发
            pass
        self._closed = True
        import time
        self._duration_sec = int(time.time() - self._started_ts)

        # 取消 volc 监听协程
        if self._volc_listener_task and not self._volc_listener_task.done():
            self._volc_listener_task.cancel()
            try:
                await self._volc_listener_task
            except (asyncio.CancelledError, Exception):
                pass

        # PR-N: 取消 ASR listener + 关 ASR 连接
        if self._asr_listener_task and not self._asr_listener_task.done():
            self._asr_listener_task.cancel()
            try:
                await self._asr_listener_task
            except (asyncio.CancelledError, Exception):
                pass
        # 取消 AI TTS 静音兜底 timer（避免会话结束后 timer 触发 _set_ai_state 等副作用）
        if self._ai_silence_reset_task and not self._ai_silence_reset_task.done():
            self._ai_silence_reset_task.cancel()
            try:
                await self._ai_silence_reset_task
            except (asyncio.CancelledError, Exception):
                pass
        if self.asr_bridge is not None:
            try:
                await self.asr_bridge.close()
            except Exception as e:
                logger.warning(f"[bridge] asr_bridge.close 异常: {e}")

        # 把内存累积的 _pending_messages 构造成报告页要的 shape：
        #   [{ start_time, end_time, speaker: "Interviewer|Candidate", content: {...} }, ...]
        # seq 升序排列；duration 按文本长度估算（与 _run_analysis_for_live 旧实现保持一致）
        transcript_data = self._build_session_transcript()

        try:
            # 一次 UPDATE：把整场对话写进 interview_live_sessions.transcript
            # 同时更新 status / duration / ended_at
            await self.db.execute(
                update(models.InterviewLiveSession)
                .where(models.InterviewLiveSession.id == self._live_id)
                .values(
                    status="ended",
                    duration_sec=self._duration_sec,
                    ended_at=datetime.utcnow(),
                    transcript=transcript_data,
                )
            )
            await self.db.commit()
            logger.info(
                f"[bridge] live_id={self._live_id} closed, "
                f"duration={self._duration_sec}s, "
                f"transcript_msgs={len(transcript_data)} (单条 JSON 写入 transcript JSONB)"
            )
        except Exception as e:
            logger.exception(f"[bridge] close 时更新 DB 失败: {e}")
            await self.db.rollback()

        # 关闭火山连接（PR3）
        if self.volc is not None:
            try:
                await self.volc.close()
            except Exception:
                pass

        # 释放并发槽位（幂等；ws_live 最外层 finally 还会再兜底释放一次）
        if self.slots is not None:
            try:
                await self.slots.release(self._live_id)
            except Exception as e:
                logger.warning(f"[bridge] 释放槽位失败: {e}")

    # ---------- 流式文本攒齐逻辑 ----------

    async def _handle_tts_text_stream(self, ev) -> None:
        """
        火山流式文本归一化处理。

        实战 payload（取自 backend/logs/backend.log）：
        - event 550 = 增量 chunk，字段 {content, question_id, reply_id}（无 amount）
        - event 351 = 整句结束，字段 {text, amount, reply_id, sentence_duration}
        - event 350 = 段起始占位（text=''），由 _convert_event 归一化为 tts_segment_start

        按 reply_id 缓冲，550 partial=true 推浏览器做打字机效果，351 final=true 合并落 pending。

        注意：火山 SDK 不同版本 550 的 content 字段语义不同：
        - 增量型：每 chunk 是新增字符（delta），join 才是全句
        - 累计型：每 chunk 是"从段起到现在"的全句 prefix-extended（更常见）
        如果直接 join 累计型 chunks，会把同一句话重复 N 次。
        → partial 阶段仍用 join（打字机效果两种模式都对），
          final 阶段用 _merge_stream_chunks 智能合并。
        """
        text = ev.text or ""
        if not text:
            return
        raw_payload = (ev.raw or {}).get("payload_msg") or {}
        # 兼容多种字段名（火山不同版本可能不同）
        reply_id = (
            raw_payload.get("reply_id")
            or raw_payload.get("replyId")
            or raw_payload.get("question_id")
            or raw_payload.get("id")
            or "default"
        )
        # 终结判断：351 自带 amount（完整句长），550 不带 amount → 走 partial
        amount = raw_payload.get("amount") or raw_payload.get("total_len")
        is_final = bool(ev.is_final) or (
            # 351 路径：本帧 text 累计长度达到 amount 即视为整句结束
            amount is not None and len(text) >= amount
        )

        # 缓冲按 reply_id 区分
        buf = self._tts_text_buf.setdefault(reply_id, {
            "chunks": [],
            "final_text": None,  # 修复：351 事件携带完整句，记到这里，final 时优先采用
            "amount": amount,
            "speaker": "interviewer",
            "started_at": time.time(),
        })
        buf["chunks"].append(text)
        # 修复：351 事件携带的就是整句完整 text（delta SDK 不会重复发同一句），
        # 单独记到 final_text，final 时优先用它，避免 _merge_stream_chunks
        # 在 delta 模式下把 550 delta 串 + 351 完整句拼出重复输出。
        if ev.is_final:
            buf["final_text"] = text
        # 实时推浏览器 partial：智能合并，避免累计型 SDK 下 join 出 "好的，好的，了解。" 这种重复
        # 累计型：取当前 chunks[-1]（已经是最长全句前缀），前端 transcript 区就只显示一次
        # 增量型：join 出全句
        # final：优先 351 完整句（buf["final_text"]），否则回退到 merge 兜底
        display_text = (
            buf["final_text"]
            if (is_final and buf["final_text"])
            else self._merge_stream_chunks(buf["chunks"])
        )
        await self._send_text_event({
            "type": "live.transcript",
            "role": "interviewer",
            "text": display_text,
            "partial": not is_final,
            "t0": 0, "t1": 0,
        })

        if not is_final:
            return

        # final：合并成一段落库
        # 优先采用 final_text（351 完整句），避免 delta SDK 下 merge 把重复内容写进 pending
        final_text = buf["final_text"] or self._merge_stream_chunks(buf["chunks"])
        if not final_text:
            del self._tts_text_buf[reply_id]
            return
        # 浏览器 final 推送已合并在上面（display_text），这里只需落库
        # 不再重复 send_text_event，避免前端 transcript 区出现两条相同 final
        # 防抖：跳过触发器自问自答（SayHello 后的"你好..."短句）
        if (amount is not None and amount < 10
                and "你好" in final_text and "面试" in final_text
                and len(buf["chunks"]) <= 2):
            logger.debug(f"[bridge] 跳过触发器自问自答: reply_id={reply_id} text={final_text!r}")
            del self._tts_text_buf[reply_id]
            return
        self._seq += 1
        end_ts = time.time()
        self._transcript.append({
            "seq": self._seq, "speaker": "interviewer",
            "start_time": buf["started_at"], "end_time": end_ts,
            "content": final_text,
        })
        # content 自带 speaker/seq/text/ts（DB 列是 JSONB）
        content_dict = {
            "speaker": "interviewer",
            "seq": self._seq,
            "text": final_text,
            "started_at": buf["started_at"],
            "ended_at": end_ts,
            "reply_id": reply_id,
            "chunk_count": len(buf["chunks"]),
        }
        # 不立即写库；面试结束 _on_close 时一次性把全部 _pending_messages
        # 打成大 JSON UPDATE 到 interview_live_sessions.transcript JSONB
        self._pending_messages.append({
            "seq": self._seq,
            "content": content_dict,
        })
        del self._tts_text_buf[reply_id]
        logger.info(
            f"[bridge] pending[{self._seq}] interviewer reply_id={reply_id} "
            f"chunks={len(buf['chunks'])} text={final_text[:50]!r}"
        )

    @staticmethod
    def _merge_stream_chunks(chunks: list) -> str:
        """
        合并火山流式 TTS 文本 chunk，自动适配两种 SDK 行为：

        1. 增量型（delta）：每 chunk 是新增字符 → 直接 join
           例: ['好的，', '了解。', '那你'] → '好的，了解。那你'

        2. 累计型（accumulated）：每 chunk 是"从段起到现在"的全句
                                  prefix-extended 关系（更常见）
           例: ['好的，', '好的，了解。', '好的，了解。那你最近...', '好的，了解。...全句'] → 取最长

        判定：所有相邻 chunk 满足"长度非递减 + 后者以前者为前缀" → 累计型，
              取 chunks[-1]（最长）作为全句；
              否则视为增量型，join 全部。

        实际工程上火山 SDK 主要走累计型（550 content 字段是 prefix-extended），
        偶尔会重发整段作为收尾。直接 join 会把同一句话重复 N 次。
        """
        if not chunks:
            return ""
        if len(chunks) == 1:
            return chunks[0]
        # 累计型判定：每个 chunk 都以"前面所有 chunk 的最长串"为前缀（长度非递减）
        is_accumulated = all(
            isinstance(c, str) and isinstance(prev, str)
            and len(c) >= len(prev) and c.startswith(prev)
            for prev, c in zip(chunks, chunks[1:])
        )
        if is_accumulated:
            return chunks[-1]
        return "".join(chunks)

    def _build_session_transcript(self) -> list[dict]:
        """
        把内存累积的 _pending_messages 构造成报告页消费的 shape：
          [
            {
              "start_time": float,        # 累计偏移（按文本长度估算）
              "end_time":   float,
              "speaker":    "Interviewer" | "Candidate",  # 大写首字母，报告页条件渲染用
              "content":    {...}         # 原始 content_dict（含 seq/text/ts/reply_id/chunk_count）
            },
            ...
          ]

        按 seq 升序；duration 用 len(text)*0.05 估算（与原 _run_analysis_for_live 同款公式，
        保持报告时间轴一致）。
        """
        if not self._pending_messages:
            return []
        # 按 seq 排序（虽然 push 顺序基本就是 seq 升序，但显式排一次更稳）
        ordered = sorted(self._pending_messages, key=lambda m: m.get("seq", 0))
        out: list[dict] = []
        cur_time = 0.0
        for m in ordered:
            content = m.get("content") or {}
            text = content.get("text") or ""
            duration = max(1.0, len(text) * 0.05)
            speaker_raw = content.get("speaker", "interviewer")
            speaker_label = "Interviewer" if speaker_raw == "interviewer" else "Candidate"
            out.append({
                "start_time": cur_time,
                "end_time": cur_time + duration,
                "speaker": speaker_label,
                "content": content,
            })
            cur_time += duration
        return out

    # ---------- 暴露给 WS handler 调用 ----------

    def get_transcript_snapshot(self) -> list[dict]:
        """供 PR4 归档时读取的 transcript 快照。"""
        return list(self._transcript)
