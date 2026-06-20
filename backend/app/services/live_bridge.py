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
import time
from datetime import datetime
from typing import Optional

from fastapi import WebSocket, WebSocketDisconnect
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app import models
from app.config import settings

logger = logging.getLogger(__name__)


class LiveSessionBridge:
    """
    单个 live session 的桥接器。生命周期与一个浏览器 WS 连接一一对应。

    模式：
    - volc=None: echo 模式（PR2 验证用）
    - volc=VolcRealtimeBridge: 接入火山（PR3）
    """

    # WS ping 超时（秒）
    PING_TIMEOUT_S = 60
    # 整段最长时长（秒）= 用户配置 + 60s 缓冲
    DURATION_BUFFER_S = 60

    def __init__(
        self,
        ws: WebSocket,
        row: models.InterviewLiveSession,
        db: AsyncSession,
        volc: Optional["object"] = None,  # PR3 类型 VolcRealtimeBridge, PR2 为 None
    ):
        self.ws = ws
        self.row = row
        self.db = db
        self.volc = volc
        self._closed = False
        # 候选人累积 transcript（PR2 echo 模式也写，给 PR4 归档备用）
        self._transcript: list[dict] = []
        self._seq = 0
        self._last_activity_ts: float = 0
        self._duration_sec: int = 0
        self._started_ts: float = 0
        # PR3: AI 状态机（idle / listening / thinking / speaking）
        self._ai_state: str = "idle"
        self._ai_is_speaking: bool = False  # 用于打断判断
        # PR3: volc 事件监听协程
        self._volc_listener_task: Optional[asyncio.Task] = None
        # 流式 tts_text 缓冲：reply_id → {chunks, amount, ...}
        import time as _time
        self._tts_text_buf: dict = {}
        # PR5: 消息缓冲——面试过程中不写库，结束时批量 INSERT
        # 每条 dict: {seq, speaker, content_json}
        self._pending_messages: list[dict] = []
        # PR6 调试：浏览器 → 后端 上行 audio 帧计数（每 50 帧打一次日志）
        self._audio_frame_count: int = 0

    # ---------- 主循环 ----------

    async def run(self) -> None:
        """主循环：监听浏览器 WS 直到 close。"""
        import time
        self._started_ts = time.time()
        self._last_activity_ts = self._started_ts

        # 1. 推 server_ready 消息给浏览器
        await self._send_text_event({
            "type": "live.ready",
            "live_session_id": self.row.id,
            "sample_rate": 24000,
            "encoding": "pcm16",
            "interview_type": self.row.interview_type,
            "difficulty": self.row.difficulty,
            "duration_min": self.row.duration_min,
            "followup_rounds": self.row.followup_rounds,
            "ts": datetime.utcnow().isoformat() + "Z",
        })
        logger.info(f"[bridge] live_id={self.row.id} ready, mode={'volc' if self.volc else 'echo'}")

        # 2. 启动 ping watchdog
        watchdog_task = asyncio.create_task(self._ping_watchdog())

        # 3. 启动 volc 事件监听（PR3，volc 不为 None 时）
        if self.volc is not None:
            self._volc_listener_task = asyncio.create_task(self._volc_event_loop())

        try:
            while not self._closed:
                # 接收浏览器消息（text 或 binary）
                msg = await self.ws.receive()
                self._last_activity_ts = time.time()

                if msg.get("type") == "websocket.disconnect":
                    logger.info(f"[bridge] live_id={self.row.id} 浏览器 disconnect")
                    break

                if "text" in msg:
                    await self._on_text(msg["text"])
                elif "bytes" in msg:
                    await self._on_binary(msg["bytes"])
                else:
                    logger.warning(f"[bridge] 未知消息 type={msg.get('type')}")
        except WebSocketDisconnect:
            logger.info(f"[bridge] live_id={self.row.id} WebSocketDisconnect")
        except Exception as e:
            logger.exception(f"[bridge] live_id={self.row.id} 主循环异常: {e}")
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
            # PR4: 监听 status='ending' 信号（end 端点设置）→ 主动关闭
            try:
                await self.db.refresh(self.row)
                if self.row.status == "ending":
                    logger.info(
                        f"[bridge] live_id={self.row.id} 收到 end 信号 (status=ending), 主动关闭"
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
                    f"[bridge] live_id={self.row.id} ping 超时 ({idle:.1f}s), 主动关闭"
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
                    f"[bridge] live_id={self.row.id} 超 duration_min 限制 ({elapsed:.1f}s), 主动关闭"
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
            # 透传：举手/思考/跳过 等快捷操作
            logger.info(f"[bridge] client.event name={data.get('name')} payload={data.get('payload')}")
            return
        if mtype == "client.text":
            # 候选人发送文本（备用通道，PR2 echo 用）
            text = data.get("content", "")
            logger.info(f"[bridge] candidate text: {text[:50]}...")
            self._seq += 1
            self._transcript.append({
                "seq": self._seq, "speaker": "candidate",
                "start_time": 0, "end_time": 0, "content": text,
            })
            if self.volc is not None and text.strip():
                # PR3: 文本注入（用于「举手」按钮把候选内容发送）
                try:
                    await self.volc.trigger_response()
                except Exception as e:
                    logger.warning(f"[bridge] volc.trigger_response 失败: {e}")
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
        logger.debug(f"[bridge] 未处理 text type={mtype}")

    # ---------- volc 事件循环（PR3） ----------

    async def _volc_event_loop(self) -> None:
        """从 volc 消费归一化事件，转发给浏览器；维护 AI 状态机。"""
        if self.volc is None:
            return
        logger.info(f"[bridge] live_id={self.row.id} volc listener started")
        try:
            async for ev in self.volc.recv_events():
                if self._closed:
                    break
                await self._handle_volc_event(ev)
                if ev.type == "dialog_finished":
                    # volc WSS 关闭，结束
                    logger.info(f"[bridge] live_id={self.row.id} volc dialog_finished")
                    break
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.exception(f"[bridge] volc event loop 异常: {e}")
        finally:
            logger.info(f"[bridge] live_id={self.row.id} volc listener stopped")

    async def _handle_volc_event(self, ev) -> None:
        """归一化事件 → 浏览器 WS 消息 + AI 状态机更新。"""
        if ev.type == "tts_segment_start":
            # 火山 event 350：段起始占位（text=''），仅切换 AI 状态，不推 transcript
            self._ai_state = "speaking"
            return
        if ev.type == "tts_text":
            # AI 流式文本（event 350/351 sentence streaming）
            # 一句话被切碎成 N 个 chunk 推过来，要按 reply_id 攒齐再写库
            await self._handle_tts_text_stream(ev)
            return
        if ev.type == "tts_audio":
            # AI 语音片段，推浏览器（二进制）
            if ev.audio:
                self._ai_state = "speaking"
                self._ai_is_speaking = True
                try:
                    await self.ws.send_bytes(ev.audio)
                except Exception as e:
                    logger.warning(f"[bridge] send_bytes tts_audio 失败: {e}")
                    self._closed = True
            return
        if ev.type == "tts_end":
            # 一段 AI 音频结束
            self._ai_is_speaking = False
            return
        if ev.type == "asr_partial":
            # 候选人 partial 文本
            self._ai_state = "thinking"
            await self._send_text_event({
                "type": "live.transcript",
                "role": "candidate",
                "text": ev.text or "",
                "partial": True,
                "t0": 0, "t1": 0,
            })
            return
        if ev.type == "asr_final":
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
            self._ai_state = "listening"
            return
        if ev.type == "speech_started":
            # 候选人开始说话 → 如果 AI 在讲，发 cancel
            self._ai_state = "listening"
            if self._ai_is_speaking and self.volc is not None:
                logger.info(f"[bridge] 候选人打断 AI 说话")
                try:
                    await self.volc.cancel_response()
                except Exception:
                    pass
                self._ai_is_speaking = False
            return
        if ev.type == "speech_stopped":
            self._ai_state = "thinking"
            return
        if ev.type == "error":
            logger.error(f"[bridge] volc error: {ev.text}")
            await self._send_text_event({
                "type": "live.error",
                "code": 500,
                "message": ev.text or "volc error",
            })
            return
        if ev.type == "dialog_finished":
            # 让 _volc_event_loop 退出
            return
        # 其他事件忽略
        logger.debug(f"[bridge] 未映射 volc event: {ev.type}")

    async def _on_binary(self, data: bytes) -> None:
        """处理浏览器二进制音频帧（PCM16/24kHz/单声道/20ms）。"""
        if self.volc is not None:
            # PR3: 转发给火山
            try:
                await self.volc.send_audio(data)
            except Exception as e:
                logger.warning(f"[bridge] volc.send_audio 失败: {e}")
        else:
            # PR2 echo: 原样回送（让前端看到链路通）
            try:
                await self.ws.send_bytes(data)
            except Exception as e:
                logger.warning(f"[bridge] echo 音频失败: {e}")
        # PR6 调试：每 50 帧打一次（避免日志刷屏），确认浏览器 → 后端上行链路
        self._audio_frame_count += 1
        if self._audio_frame_count % 50 == 1:
            logger.info(
                f"[bridge] live_id={self.row.id} 已收到浏览器 audio 帧数={self._audio_frame_count} "
                f"最近一帧 len={len(data)} bytes"
            )

    # ---------- 推消息给浏览器 ----------

    async def _persist_message(self, speaker: str, content: str) -> None:
        """PR4: 写一条 InterviewLiveMessage（content 走 JSONB dict）。"""
        import time as _time
        content_dict = {
            "speaker": speaker,
            "text": content,
            "started_at": _time.time(),
            "ended_at": _time.time(),
        }
        await self._persist_message_raw(speaker, content_dict)

    async def _send_text_event(self, payload: dict) -> None:
        if self._closed:
            return
        try:
            await self.ws.send_text(json.dumps(payload, ensure_ascii=False))
        except Exception as e:
            logger.warning(f"[bridge] send_text 失败: {e}")
            self._closed = True

    # ---------- 关闭 / 归档 ----------

    async def _on_close(self) -> None:
        """WS 关闭时清理：批量写消息到 DB、更新 session 状态、关闭火山连接。"""
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

        # 批量 INSERT 累积的消息（顺序由 _pending_messages push 顺序保证）
        if self._pending_messages:
            try:
                objs = [
                    models.InterviewLiveMessage(
                        live_session_id=self.row.id,
                        seq=m["seq"],
                        content=m["content"],
                    )
                    for m in self._pending_messages
                ]
                self.db.add_all(objs)
                await self.db.commit()
                logger.info(
                    f"[bridge] 批量落库 {len(objs)} 条消息到 interview_live_messages"
                )
            except Exception as e:
                logger.exception(f"[bridge] 批量写消息失败: {e}")
                await self.db.rollback()

        try:
            # 更新 session 状态
            await self.db.execute(
                update(models.InterviewLiveSession)
                .where(models.InterviewLiveSession.id == self.row.id)
                .values(
                    status="ended",
                    duration_sec=self._duration_sec,
                    ended_at=datetime.utcnow(),
                )
            )
            await self.db.commit()
            logger.info(
                f"[bridge] live_id={self.row.id} closed, "
                f"duration={self._duration_sec}s, transcript_msgs={len(self._transcript)}"
            )
        except Exception as e:
            logger.exception(f"[bridge] close 时更新 DB 失败: {e}")

        # 关闭火山连接（PR3）
        if self.volc is not None:
            try:
                await self.volc.close()
            except Exception:
                pass

    # ---------- 流式文本攒齐逻辑 ----------

    async def _handle_tts_text_stream(self, ev) -> None:
        """
        火山流式文本归一化处理。

        实战 payload（取自 backend/logs/backend.log）：
        - event 550 = 增量 chunk，字段 {content, question_id, reply_id}（无 amount）
        - event 351 = 整句结束，字段 {text, amount, reply_id, sentence_duration}
        - event 350 = 段起始占位（text=''），由 _convert_event 归一化为 tts_segment_start

        按 reply_id 缓冲，550 partial=true 推浏览器做打字机效果，351 final=true 合并落 pending。
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
            "amount": amount,
            "speaker": "interviewer",
            "started_at": time.time(),
        })
        buf["chunks"].append(text)
        # 实时推浏览器 partial（拼接当前已收的 chunk 让用户看到"打字机"效果）
        combined = "".join(buf["chunks"])
        await self._send_text_event({
            "type": "live.transcript",
            "role": "interviewer",
            "text": combined,
            "partial": not is_final,
            "t0": 0, "t1": 0,
        })

        if not is_final:
            return

        # final：合并成一段落库
        final_text = combined
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
        # 不写库，面试结束 _on_close 时批量 INSERT
        self._pending_messages.append({
            "seq": self._seq,
            "content": content_dict,
        })
        del self._tts_text_buf[reply_id]
        logger.info(
            f"[bridge] pending[{self._seq}] interviewer reply_id={reply_id} "
            f"chunks={len(buf['chunks'])} text={final_text[:50]!r}"
        )

    async def _persist_message_raw(self, speaker: str, content_dict: dict) -> None:
        """PR4: 写一条 InterviewLiveMessage，content 是 dict（DB 列是 JSONB）。"""
        try:
            msg = models.InterviewLiveMessage(
                live_session_id=self.row.id,
                seq=self._seq,
                speaker=speaker,
                content=content_dict,
            )
            self.db.add(msg)
            await self.db.commit()
        except Exception as e:
            logger.warning(f"[bridge] 写 InterviewLiveMessage 失败: {e}")
            await self.db.rollback()

    # ---------- 暴露给 WS handler 调用 ----------

    def get_transcript_snapshot(self) -> list[dict]:
        """供 PR4 归档时读取的 transcript 快照。"""
        return list(self._transcript)
