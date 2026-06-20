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
  start: (onAudioFrame: (pcm16: ArrayBuffer) => void) => Promise<boolean>;
  stop: () => void;
  mute: (muted: boolean) => void;
  /** 播放从服务端收到的 PCM16 音频（火山 TTS 24kHz/mono）。无操作即可丢帧。*/
  play: (pcm16: ArrayBuffer, sampleRate?: number) => void;
}

const WORKLET_URL = "/utils/audioWorkletProcessor.js";
const PLAY_SAMPLE_RATE = 24000;  // 火山 TTS 输出采样率

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

  // 播放队列
  const playQueueRef = useRef<ArrayBuffer[]>([]);
  const playingRef = useRef(false);

  const start = useCallback(async (onAudioFrame: (pcm16: ArrayBuffer) => void) => {
    if (!hasAudioWorklet()) {
      setState({ active: false, hasPermission: false, error: "浏览器不支持 AudioWorklet" });
      return false;
    }

    // 1. 申请麦克风权限
    const perm = await checkMicrophonePermission();
    if (!perm.ok || !perm.stream) {
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
    worklet.port.onmessage = (ev) => {
      if (mutedRef.current) return;
      onFrameRef.current?.(ev.data as ArrayBuffer);
    };

    // 3. 连接 source
    const source = ctx.createMediaStreamSource(perm.stream);
    sourceRef.current = source;
    source.connect(worklet);

    setState({ active: true, hasPermission: true, error: null });
    return true;
  }, []);

  const stop = useCallback(() => {
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

  return { state, start, stop, mute, play };
}
