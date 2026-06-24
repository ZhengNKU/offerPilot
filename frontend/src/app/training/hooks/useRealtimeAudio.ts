/**
 * useRealtimeAudio Hook
 *
 * 麦克风采集 + AudioWorklet 下采样 + 推到 WebSocket。
 * 音频播放：把从服务端收到的 PCM16 字节（24kHz/mono）排队播放。
 * 与 useRealtimeSession 配合使用：start() 时建立音频流，stop() 时释放。
 *
 * 降级策略：
 * - AudioWorklet 不可用（Safari 14）→ 暂不支持（PR5 范围仅 Chromium）
 * - getUserMedia 拒绝 → 返回 error 状态
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { hasAudioWorklet, checkMicrophonePermission } from "@/app/utils/useRealtimeSession";

export interface AudioCaptureState {
  active: boolean;
  hasPermission: boolean;
  error: string | null;
}

export interface UseRealtimeAudioApi {
  state: AudioCaptureState;
  /**
   * @param onAudioFrame 麦克风 PCM16 帧回调（24kHz/mono/20ms）
   * @param onSttResult  浏览器 Web Speech API 识别结果回调（text, isFinal）
   *                    不传则不启动 STT（部分浏览器/环境下未实现时也不会报错）
   */
  start: (
    onAudioFrame: (pcm16: ArrayBuffer) => void,
    onSttResult?: (text: string, isFinal: boolean) => void,
  ) => Promise<boolean>;
  stop: () => void;
  mute: (muted: boolean) => void;
  /**
   * AI 说话期间暂停浏览器 Web Speech 识别，防止 TTS 回声被当候选人字幕。
   * true=AI 正在说（TTS 在播放）→ abort() 当前 recognition 并阻止 onend 自动重启
   * false=AI 停下 → 重新启动 recognition
   */
  setAiSpeaking: (speaking: boolean) => void;
  /** 播放从服务端收到的 PCM16 音频（火山 TTS 24kHz/mono）。无操作即可丢帧。*/
  play: (pcm16: ArrayBuffer, sampleRate?: number) => void;
}

const WORKLET_URL = "/utils/audioWorkletProcessor.js";
const PLAY_SAMPLE_RATE = 24000;  // 火山 TTS 输出采样率

// Web Speech API 类型扩展（标准未纳入 TS lib）
interface SpeechRecognitionResultLite {
  isFinal: boolean;
  0: { transcript: string };
  length: number;
}
interface SpeechRecognitionEventLite extends Event {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLite>;
}
interface SpeechRecognitionErrorEventLite extends Event {
  error: string;
  message?: string;
}
interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((ev: SpeechRecognitionEventLite) => void) | null;
  onerror: ((ev: SpeechRecognitionErrorEventLite) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function useRealtimeAudio(): UseRealtimeAudioApi {
  const [state, setState] = useState<AudioCaptureState>({
    active: false,
    hasPermission: false,
    error: null,
  });

  const audioCtxRef = useRef<AudioContext | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mutedRef = useRef(false);
  const onFrameRef = useRef<((pcm16: ArrayBuffer) => void) | null>(null);
  const onSttRef = useRef<((text: string, isFinal: boolean) => void) | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const sttActiveRef = useRef(false);
  // AI 是否正在说话：true 时 abort Web Speech 并阻止 onend 自动重启，
  // 避免 TTS 回声被浏览器 STT 误识别为候选人字幕。
  const aiSpeakingRef = useRef(false);

  // 播放队列
  const playQueueRef = useRef<ArrayBuffer[]>([]);
  const playingRef = useRef(false);

  const start = useCallback(async (
    onAudioFrame: (pcm16: ArrayBuffer) => void,
    onSttResult?: (text: string, isFinal: boolean) => void,
  ) => {
    // 防御性清理：上一次 start() 可能因为 HMR / 新会话接续，留下还在跑的 Web Speech Recognition
    // 若不清掉，它会持续往**新 WS** 发 client.stt（双重 ASR + AI 回声被当候选人）
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch { /* ignore */ }
      recognitionRef.current = null;
    }
    sttActiveRef.current = false;
    onSttRef.current = null;

    if (!hasAudioWorklet()) {
      console.error("[audio] 浏览器不支持 AudioWorklet");
      setState({ active: false, hasPermission: false, error: "浏览器不支持 AudioWorklet" });
      return false;
    }

    // 1. 申请麦克风权限
    const perm = await checkMicrophonePermission();
    if (!perm.ok || !perm.stream) {
      console.error("[audio] mic permission denied / no stream:", perm.reason);
      setState({ active: false, hasPermission: false, error: perm.reason || "无法访问麦克风" });
      return false;
    }
    streamRef.current = perm.stream;

    // 2. 创建 AudioContext + 加载 worklet
    const ctx = new AudioContext({ sampleRate: 48000 });
    audioCtxRef.current = ctx;
    try {
      await ctx.audioWorklet.addModule(WORKLET_URL);
    } catch (e: any) {
      console.error("[audio] worklet load failed:", e?.message);
      setState({ active: false, hasPermission: true, error: `加载 worklet 失败: ${e?.message}` });
      return false;
    }
    const worklet = new AudioWorkletNode(ctx, "pcm16-downsampler", {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCount: 1,
    });
    workletRef.current = worklet;

    onFrameRef.current = onAudioFrame;
    onSttRef.current = onSttResult ?? null;
    worklet.port.onmessage = (ev) => {
      if (mutedRef.current) return;
      onFrameRef.current?.(ev.data as ArrayBuffer);
    };

    // 3. 连接 source
    const source = ctx.createMediaStreamSource(perm.stream);
    sourceRef.current = source;
    source.connect(worklet);

    // 4. 启动浏览器 Web Speech API（候选人 STT 旁路）
    //    火山 realtime 不回推 ASR，所以靠浏览器内置 STT 补齐候选人文本
    if (onSttResult) {
      const Ctor = getSpeechRecognitionCtor();
      if (Ctor) {
        try {
          const r = new Ctor();
          r.lang = "zh-CN";
          r.continuous = true;
          r.interimResults = true;
          r.onresult = (ev) => {
            // AI 说话期间（TTS 在播）直接丢弃结果，避免回声被当候选人字幕
            if (aiSpeakingRef.current) return;
            // 只看最新一条结果；interim 时会被同一 final 覆盖
            for (let i = ev.resultIndex; i < ev.results.length; i++) {
              const res = ev.results[i];
              if (!res || res.length === 0) continue;
              const text = (res[0] as { transcript: string }).transcript || "";
              if (!text) continue;
              onSttRef.current?.(text, !!res.isFinal);
            }
          };
          r.onend = () => {
            // 浏览器在静音一段时间后会自动 onend；会话还活着且 AI 没在说话就重启，
            // 保证连续识别。AI 说话期间的 onend（来自 abort）不重启，由 setAiSpeaking(false) 手动起。
            if (sttActiveRef.current && !aiSpeakingRef.current) {
              try { r.start(); } catch { /* ignore */ }
            }
          };
          r.start();
          recognitionRef.current = r;
          sttActiveRef.current = true;
        } catch (e: any) {
          console.warn("[audio] Web Speech API 启动失败:", e?.message);
        }
      } else {
        console.warn("[audio] 当前浏览器不支持 Web Speech API（仅 Chrome 系可用）");
      }
    }

    setState({ active: true, hasPermission: true, error: null });
    return true;
  }, []);

  const stop = useCallback(() => {
    // 1. 先停 STT（onend 重启依赖 sttActiveRef，先置 false）
    sttActiveRef.current = false;
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch { /* ignore */ }
      recognitionRef.current = null;
    }
    onSttRef.current = null;
    try {
      if (workletRef.current) workletRef.current.disconnect();
    } catch { /* ignore */ }
    try {
      if (sourceRef.current) sourceRef.current.disconnect();
    } catch { /* ignore */ }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
      void audioCtxRef.current.close();
    }
    audioCtxRef.current = null;
    workletRef.current = null;
    sourceRef.current = null;
    onFrameRef.current = null;
    playQueueRef.current = [];
    playingRef.current = false;
    setState((s) => ({ ...s, active: false }));
  }, []);

  const mute = useCallback((muted: boolean) => {
    mutedRef.current = muted;
  }, []);

  const setAiSpeaking = useCallback((speaking: boolean) => {
    const was = aiSpeakingRef.current;
    aiSpeakingRef.current = speaking;
    if (was === speaking) return;
    if (speaking) {
      // AI 开始说话：abort 当前 recognition，让 onend 不重启（onend 已检查 aiSpeakingRef）
      if (recognitionRef.current) {
        try { recognitionRef.current.abort(); } catch { /* ignore */ }
        recognitionRef.current = null;
      }
    } else {
      // AI 说完：重启 recognition（如果 onSttRef 还在，说明要继续识别候选人）
      if (sttActiveRef.current && onSttRef.current && !recognitionRef.current) {
        const Ctor = getSpeechRecognitionCtor();
        if (Ctor) {
          try {
            const r = new Ctor();
            r.lang = "zh-CN";
            r.continuous = true;
            r.interimResults = true;
            r.onresult = (ev) => {
              if (aiSpeakingRef.current) return;
              for (let i = ev.resultIndex; i < ev.results.length; i++) {
                const res = ev.results[i];
                if (!res || res.length === 0) continue;
                const text = (res[0] as { transcript: string }).transcript || "";
                if (!text) continue;
                onSttRef.current?.(text, !!res.isFinal);
              }
            };
            r.onend = () => {
              if (sttActiveRef.current && !aiSpeakingRef.current) {
                try { r.start(); } catch { /* ignore */ }
              }
            };
            r.start();
            recognitionRef.current = r;
          } catch { /* ignore */ }
        }
      }
    }
  }, []);

  // 内部：把 PCM16 ArrayBuffer 转 Float32Array，喂给 AudioContext
  const playNext = useCallback(() => {
    const ctx = audioCtxRef.current;
    if (!ctx) {
      playingRef.current = false;
      return;
    }
    if (playQueueRef.current.length === 0) {
      playingRef.current = false;
      return;
    }
    const ab = playQueueRef.current.shift()!;
    // 确保 AudioContext 在运行（Chrome autoplay policy 要求）
    if (ctx.state === "suspended") {
      void ctx.resume();
    }
    try {
      const int16 = new Int16Array(ab);
      const float32 = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) {
        float32[i] = int16[i] / 32768;
      }
      const audioBuffer = ctx.createBuffer(1, float32.length, PLAY_SAMPLE_RATE);
      audioBuffer.copyToChannel(float32, 0);
      const node = ctx.createBufferSource();
      node.buffer = audioBuffer;
      node.connect(ctx.destination);
      node.onended = () => playNext();
      node.start();
    } catch (e) {
      console.error("[audio] play chunk failed:", e);
      playNext();
    }
  }, []);

  const play = useCallback((pcm16: ArrayBuffer, sampleRate: number = PLAY_SAMPLE_RATE) => {
    if (!audioCtxRef.current) {
      console.warn("[audio] play ignored: AudioContext not ready");
      return;
    }
    // 注：sampleRate 参数目前固定 24kHz（与 AudioContext 内部重采样兼容）
    playQueueRef.current.push(pcm16);
    if (!playingRef.current) {
      playingRef.current = true;
      playNext();
    }
  }, [playNext]);

  // 卸载清理
  useEffect(() => {
    return () => {
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { state, start, stop, mute, setAiSpeaking, play };
}
