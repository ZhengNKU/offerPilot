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
  /** AI 语音是否正在本地扬声器播放 */
  isPlaying: boolean;
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

  const [isPlaying, setIsPlaying] = useState(false);

  // 内部辅助：启动 Web Speech API 识别
  const startRecognition = useCallback(() => {
    if (!sttActiveRef.current || !onSttRef.current || recognitionRef.current) return;
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;
    try {
      const r = new Ctor();
      r.lang = "zh-CN";
      r.continuous = true;
      r.interimResults = true;
      r.onresult = (ev) => {
        // AI 正在说话（网络层判定）或扬声器正在播音（本地播放队列未完）时，直接丢弃结果，防止回音
        if (aiSpeakingRef.current || playingRef.current) return;
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const res = ev.results[i];
          if (!res || res.length === 0) continue;
          const text = (res[0] as { transcript: string }).transcript || "";
          if (!text) continue;
          onSttRef.current?.(text, !!res.isFinal);
        }
      };
      r.onend = () => {
        // 重启条件：服务未关闭 且 AI 没在发音 且 本地扬声器已播音结束
        if (sttActiveRef.current && !aiSpeakingRef.current && !playingRef.current) {
          try { r.start(); } catch { /* ignore */ }
        }
      };
      r.start();
      recognitionRef.current = r;
    } catch (e: any) {
      console.warn("[audio] startRecognition failed:", e?.message);
    }
  }, []);

  // 内部辅助：强行终止/释放 Web Speech API 识别
  const stopRecognition = useCallback(() => {
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch { /* ignore */ }
      recognitionRef.current = null;
    }
  }, []);

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
    if (onSttResult) {
      sttActiveRef.current = true;
      startRecognition();
    }

    setState({ active: true, hasPermission: true, error: null });
    return true;
  }, [startRecognition]);

  const stop = useCallback(() => {
    // 1. 先停 STT（onend 重启依赖 sttActiveRef，先置 false）
    sttActiveRef.current = false;
    stopRecognition();
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
    setIsPlaying(false);
    setState((s) => ({ ...s, active: false }));
  }, [stopRecognition]);

  const mute = useCallback((muted: boolean) => {
    mutedRef.current = muted;
  }, []);

  const setAiSpeaking = useCallback((speaking: boolean) => {
    const was = aiSpeakingRef.current;
    aiSpeakingRef.current = speaking;
    if (was === speaking) return;
    if (speaking) {
      // AI 开始说话：立即终止识别
      stopRecognition();
    } else {
      // AI 停止说话（网络状态）：如果本地音轨也已播放完毕，则允许重新开启识别
      if (!playingRef.current) {
        startRecognition();
      }
    }
  }, [startRecognition, stopRecognition]);

  // 内部：把 PCM16 ArrayBuffer 转 Float32Array，喂给 AudioContext
  const playNext = useCallback(() => {
    const ctx = audioCtxRef.current;
    if (!ctx) {
      playingRef.current = false;
      setIsPlaying(false);
      return;
    }
    if (playQueueRef.current.length === 0) {
      playingRef.current = false;
      setIsPlaying(false);
      // 本地音频播放队列清空：如果网络层也已进入非说话态，则立即重新恢复识别
      if (!aiSpeakingRef.current) {
        startRecognition();
      }
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
  }, [startRecognition]);

  const play = useCallback((pcm16: ArrayBuffer, sampleRate: number = PLAY_SAMPLE_RATE) => {
    if (!audioCtxRef.current) {
      console.warn("[audio] play ignored: AudioContext not ready");
      return;
    }

    playQueueRef.current.push(pcm16);
    if (!playingRef.current) {
      // 收到第一块要播放的音频且扬声器当前闲置时，终止一次识别。避免高频流包（50次/秒）触发重复 abort 重载浏览器。
      stopRecognition();
      playingRef.current = true;
      setIsPlaying(true);
      playNext();
    }
  }, [playNext, stopRecognition]);

  // 卸载清理
  useEffect(() => {
    return () => {
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { state, start, stop, mute, setAiSpeaking, play, isPlaying };
}
