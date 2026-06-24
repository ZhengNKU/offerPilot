/**
 * useRealtimeSession Hook
 *
 * 封装 WebSocket + 实时语音状态机，训练场 UI 直接消费。
 *
 * 关键能力：
 * 1. 自动鉴权（首条消息发 JWT）
 * 2. 二进制 audio 帧 + JSON control 帧统一处理
 * 3. WS 断线自动重连（指数退避 1s/3s/9s，最多 3 次）
 * 4. transcript 累积（合并 partial / 处理 final）
 * 5. AI 状态机：idle / listening / thinking / speaking
 * 6. 错误捕获：close code 4401/4002 等映射到 UI 状态
 *
 * 用法：
 *   const live = useRealtimeSession();
 *   useEffect(() => { live.start({ liveId, wsPath, token }); }, [liveId]);
 *   live.transcript.map(line => ...)
 */

import { useCallback, useEffect, useRef, useState } from "react";

export type AiState = "idle" | "listening" | "thinking" | "speaking";
export type SessionStatus = "idle" | "connecting" | "live" | "ending" | "ended" | "error";

export interface TranscriptLine {
  role: "interviewer" | "candidate";
  text: string;
  partial: boolean;
  t0: number;
  t1: number;
}

export interface RealtimeMetrics {
  durationSec: number;
  questionCount: number;
  interruptCount: number;
  latencyMs: number;
}

export interface RealtimeError {
  code: number;
  message: string;
}

export interface RealtimeState {
  status: SessionStatus;
  aiState: AiState;
  micMuted: boolean;
  speakerMuted: boolean;
  transcript: TranscriptLine[];
  metrics: RealtimeMetrics;
  error: RealtimeError | null;
  wsUrl: string | null;
}

export interface StartOpts {
  liveId: number;
  wsPath: string;
  token: string;
  apiBase?: string; // 默认 http://localhost:8001
  /** 收到服务端 tts_audio 二进制帧时回调（火山 24kHz/mono PCM16） */
  onAudioFrame?: (pcm16: ArrayBuffer) => void;
  /**
   * WS 异常断开兜底：会话进行中（非用户主动 end）发生不可恢复断线时触发，
   * Hook 会先内部 POST /api/live/sessions/{liveId}/end 触发后端分析，
   * 然后回调此函数，UI 层应切换到"正在分析"流程。
   */
  onAutoEnd?: (liveId: number) => void;
}

export interface UseRealtimeSessionApi extends RealtimeState {
  start: (opts: StartOpts) => Promise<void>;
  end: () => Promise<void>;
  toggleMic: () => void;
  toggleSpeaker: () => void;
  sendEvent: (name: string, payload?: unknown) => void;
  sendText: (content: string) => void;
  /**
   * 快捷操作：暂停 / 跳过 / 提示。
   * - pause：后端会推 live.pause 事件，客户端据 duration 倒计时并 mute mic。
   * - skip / hint：后端注入文本让 AI 自然回应，不影响客户端状态。
   */
  sendQuickAction: (
    action: "pause" | "skip" | "hint",
    payload?: { duration?: number }
  ) => void;
  /**
   * 浏览器 Web Speech API 识别的候选人语音上行（partial / final 合并接口）。
   * 后端收到后会广播 live.transcript(role=candidate) 给所有客户端，
   * 并在 final 时落库到 InterviewLiveMessage。
   */
  sendStt: (text: string, isFinal: boolean) => void;
  /** 发送二进制音频帧（麦克风采集后下行到服务端）。不暴露 wsRef 以保持封装。 */
  sendBinary: (data: ArrayBuffer | Blob) => boolean;
  interrupt: () => void;
  reset: () => void;
}

// WS 重连退避策略
const RECONNECT_DELAYS_MS = [1000, 3000, 9000];
const MAX_RECONNECT_ATTEMPTS = 3;

export function useRealtimeSession(): UseRealtimeSessionApi {
  const [status, setStatus] = useState<SessionStatus>("idle");
  const [aiState, setAiState] = useState<AiState>("idle");
  const [micMuted, setMicMuted] = useState(false);
  const [speakerMuted, setSpeakerMuted] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [metrics, setMetrics] = useState<RealtimeMetrics>({
    durationSec: 0,
    questionCount: 0,
    interruptCount: 0,
    latencyMs: 0,
  });
  const [error, setError] = useState<RealtimeError | null>(null);
  const [wsUrl, setWsUrl] = useState<string | null>(null);

  // 内部 ref（不触发 re-render）
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const durationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const optsRef = useRef<StartOpts | null>(null);
  const shouldReconnectRef = useRef(false);
  // 用户主动调用 end() 的标志位：用于在 onclose 阶段区分"用户主动结束"
  // 与"会话中途异常断开"，前者不应被 UI 当作"连接异常"。
  const endInitiatedRef = useRef(false);
  const statusRef = useRef<SessionStatus>("idle");

  useEffect(() => { statusRef.current = status; }, [status]);

  // ---------- 内部辅助 ----------

  const appendTranscript = useCallback((line: TranscriptLine) => {
    setTranscript((prev) => {
      // 合并策略：
      // - partial 进来 → 若最后一条同 role partial，覆盖（打字机效果）
      // - final 进来 → 若最后一条同 role partial，覆盖（覆盖"还在打的最后一个字"，
      //   避免 550 最后一段 partial（含完整句）和 351 final 两条记录都进 transcript 区造成重复）
      // - 否则 append
      const last = prev[prev.length - 1];
      if (last && last.partial && last.role === line.role) {
        return [...prev.slice(0, -1), line];
      }
      return [...prev, line];
    });
  }, []);

  const handleClose = useCallback((code: number, reason: string) => {
    if (durationTimerRef.current) {
      clearInterval(durationTimerRef.current);
      durationTimerRef.current = null;
    }
    // 用户主动 end() 触发的 ws.close(1000)：不视作连接异常，状态走 "ended"。
    // 此分支必须放在其它 1000/异常分支之前，否则会被覆盖成 "error"。
    if (endInitiatedRef.current && code === 1000) {
      endInitiatedRef.current = false; // 一次性 flag
      setStatus("ended");
      return;
    }
    if (code === 4001) {
      // 鉴权失败 / 鉴权超时：不可重连
      setStatus("error");
      setError({ code, message: reason || "鉴权失败" });
      return;
    }
    if (code === 4403 || code === 4404) {
      setStatus("error");
      setError({ code, message: reason || "无权访问或会话不存在" });
      return;
    }
    if (code === 4410) {
      setStatus("error");
      setError({ code, message: `会话状态不允许重连 (${reason})` });
      return;
    }
    if (code === 4503 || code === 4500) {
      // 服务端明确拒绝（实时语音服务不可用 / 内部错误）：不可重连
      setStatus("error");
      setError({ code, message: reason || "实时语音服务暂不可用" });
      return;
    }
    if (code === 4002 || code === 4003) {
      // ping 超时 / 超时长：服务端主动 close
      setStatus("ended");
      return;
    }
    if (code === 1000 && shouldReconnectRef.current) {
      // 正常 close 但用户期望重连（如 end 后的自动恢复）
      return;
    }
    // 其它异常 close：尝试重连
    if (shouldReconnectRef.current && reconnectAttemptRef.current < MAX_RECONNECT_ATTEMPTS) {
      const delay = RECONNECT_DELAYS_MS[reconnectAttemptRef.current];
      reconnectAttemptRef.current += 1;
      setStatus("connecting");
      reconnectTimerRef.current = setTimeout(() => {
        if (optsRef.current) {
          void connect(optsRef.current);
        }
      }, delay);
    } else {
      // 重连全部失败：若会话原本处于 live，则兜底触发后端分析（已采集的 transcript 不浪费）；
      // 否则按原逻辑进入 error UI。
      const wasLive = statusRef.current === "live";
      const liveId = optsRef.current?.liveId;
      const token = optsRef.current?.token;
      const apiBase = optsRef.current?.apiBase || "http://localhost:8001";
      if (wasLive && liveId && token) {
        // 标记一次性：避免 onAutoEnd 二次触发同一逻辑
        endInitiatedRef.current = true;
        // 关闭后续重连可能：本会话已结束
        shouldReconnectRef.current = false;
        setStatus("ended");
        // 兜底 POST /end：best-effort，失败也不阻塞 UI（pollUntilCompleted 会兜底超时）
        void fetch(`${apiBase}/api/live/sessions/${liveId}/end`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        }).catch((e) => {
          console.warn("[realtime] auto-end POST failed:", e);
        });
        optsRef.current?.onAutoEnd?.(liveId);
        return;
      }
      setStatus("error");
      setError({ code, message: reason || `连接已断开 (code ${code})` });
    }
  }, []);

  const handleMessage = useCallback((ev: MessageEvent) => {
    // 二进制：AI tts_audio
    if (ev.data instanceof ArrayBuffer) {
      setAiState("speaking");
      // 转发给外部 hook 播放（火山 24kHz/mono PCM16）
      optsRef.current?.onAudioFrame?.(ev.data);
      return;
    }
    if (typeof ev.data !== "string") return;
    let data: any;
    try {
      data = JSON.parse(ev.data);
    } catch {
      return;
    }
    switch (data.type) {
      case "live.ready":
        // 握手成功；重置重连计数
        reconnectAttemptRef.current = 0;
        setStatus("live");
        setError(null);
        // 启动计时
        if (durationTimerRef.current) clearInterval(durationTimerRef.current);
        durationTimerRef.current = setInterval(() => {
          setMetrics((m) => ({ ...m, durationSec: m.durationSec + 1 }));
        }, 1000);
        return;
      case "live.transcript":
        appendTranscript({
          role: data.role,
          text: data.text || "",
          partial: !!data.partial,
          t0: data.t0 || 0,
          t1: data.t1 || 0,
        });
        // 不在这里改 aiState：后端 _set_ai_state 会推 live.metrics 告知真实状态。
        // 之前这里硬置 thinking 会覆盖后端推的 listening/speaking 真实状态，
        // 配合后端 _ai_state 变更不再推 live.metrics 的 bug，导致 UI 一直卡在 speaking。
        return;
      case "live.metrics":
        if (data.ai_state) setAiState(data.ai_state);
        if (typeof data.latency_ms === "number") {
          setMetrics((m) => ({ ...m, latencyMs: data.latency_ms }));
        }
        if (typeof data.question_count === "number") {
          setMetrics((m) => ({ ...m, questionCount: data.question_count }));
        }
        return;
      case "live.warning":
        // 非致命警告（如 volc unavailable fallback echo）
        console.warn("[realtime] warning:", data.message);
        return;
      case "live.error":
        // 服务端上报的致命错误：禁掉 auto-reconnect，避免随后 4503 onclose 又触发新一轮重连
        shouldReconnectRef.current = false;
        setStatus("error");
        setError({ code: data.code || 500, message: data.message || "实时服务异常" });
        return;
      default:
        return;
    }
  }, [appendTranscript]);

  // ---------- 连接 ----------

  const connect = useCallback(async (opts: StartOpts) => {
    const { wsPath, token, apiBase = "http://localhost:8001" } = opts;
    setStatus("connecting");
    setError(null);
    setWsUrl(wsPath);

    const url = apiBase.replace(/^http/, "ws") + wsPath;
    const socket = new WebSocket(url);
    socket.binaryType = "arraybuffer";

    socket.onopen = () => {
      socket.send(JSON.stringify({ type: "auth", token }));
    };
    socket.onmessage = handleMessage;
    socket.onclose = (ev) => handleClose(ev.code, ev.reason);
    socket.onerror = () => {
      // onerror 通常紧跟 onclose，由 handleClose 统一处理
    };

    wsRef.current = socket;
  }, [handleMessage, handleClose]);

  // ---------- 公开 API ----------

  const start = useCallback(async (opts: StartOpts) => {
    optsRef.current = opts;
    shouldReconnectRef.current = true;
    reconnectAttemptRef.current = 0;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    await connect(opts);
  }, [connect]);

  const end = useCallback(async () => {
    // 先标记"用户主动结束"，再发 ws.close(1000) —— handleClose 看到此 flag 后
    // 不会再把它当作连接异常，避免 bootState 在 ending → error → analyzing 之间闪跳。
    endInitiatedRef.current = true;
    shouldReconnectRef.current = false;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (durationTimerRef.current) {
      clearInterval(durationTimerRef.current);
      durationTimerRef.current = null;
    }
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.close(1000, "ended by user");
    }
    setStatus("ending");
  }, []);

  const toggleMic = useCallback(() => {
    setMicMuted((m) => {
      const next = !m;
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "client.mic", muted: next }));
      }
      return next;
    });
  }, []);

  const toggleSpeaker = useCallback(() => {
    setSpeakerMuted((s) => !s);
  }, []);

  const sendEvent = useCallback((name: string, payload?: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "client.event", name, payload: payload ?? {} }));
    }
  }, []);

  const sendText = useCallback((content: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "client.text", content }));
    }
  }, []);

  const sendQuickAction = useCallback(
    (action: "pause" | "skip" | "hint", payload?: { duration?: number }) => {
      if (wsRef.current?.readyState !== WebSocket.OPEN) return;
      wsRef.current.send(
        JSON.stringify({ type: "client.quick_action", action, payload: payload ?? {} })
      );
    },
    []
  );

  /**
   * 浏览器 Web Speech API 识别出的候选人语音上行。
   * 火山 realtime 不回推 ASR 文本，所以前端 STT 走这条路上行，
   * 后端会转成 live.transcript (role=candidate) 广播给所有客户端。
   * - isFinal=false 走 partial（后端不入库，仅实时显示）
   * - isFinal=true  走 final（后端落 transcript + pending_messages）
   */
  const sendStt = useCallback((text: string, isFinal: boolean) => {
    if (!text || !text.trim()) return;
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({
      type: "client.stt",
      text,
      partial: !isFinal,
    }));
  }, []);

  const sendBinary = useCallback((data: ArrayBuffer | Blob): boolean => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    try {
      ws.send(data);
      return true;
    } catch (e) {
      console.warn("[realtime] sendBinary 失败:", e);
      return false;
    }
  }, []);

  const interrupt = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "client.interrupt" }));
    }
    setAiState("idle");
  }, []);

  const reset = useCallback(() => {
    shouldReconnectRef.current = false;
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    if (durationTimerRef.current) clearInterval(durationTimerRef.current);
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
    }
    setStatus("idle");
    setAiState("idle");
    setTranscript([]);
    setError(null);
    setMetrics({ durationSec: 0, questionCount: 0, interruptCount: 0, latencyMs: 0 });
    optsRef.current = null;
  }, []);

  // ---------- 卸载清理 ----------

  useEffect(() => {
    return () => {
      shouldReconnectRef.current = false;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (durationTimerRef.current) clearInterval(durationTimerRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        try { wsRef.current.close(); } catch { /* ignore */ }
      }
    };
  }, []);

  return {
    // state
    status, aiState, micMuted, speakerMuted, transcript, metrics, error, wsUrl,
    // actions
    start, end, toggleMic, toggleSpeaker, sendEvent, sendText, sendStt, sendBinary, interrupt, reset, sendQuickAction,
  };
}

// ---------- 设备权限检测 ----------

export interface DeviceCheckResult {
  ok: boolean;
  reason?: string;
  stream?: MediaStream;
}

/**
 * 申请麦克风权限（PR5 设备检测）。
 * - 不支持 getUserMedia → 返回 false（Safari 14 等）
 * - 用户拒绝 → 返回 false + reason
 * - 成功 → 返回 stream，调用方需在 useEffect cleanup 中 stop
 */
export async function checkMicrophonePermission(): Promise<DeviceCheckResult> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    return { ok: false, reason: "浏览器不支持 getUserMedia API" };
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
        sampleRate: 48000,
      },
    });
    return { ok: true, stream };
  } catch (e: any) {
    return { ok: false, reason: e?.message || "麦克风权限被拒绝" };
  }
}

// ---------- AudioWorklet 能力检测 ----------

export function hasAudioWorklet(): boolean {
  return typeof AudioContext !== "undefined" && "audioWorklet" in AudioContext.prototype;
}
