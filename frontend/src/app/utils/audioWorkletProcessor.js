/**
 * AudioWorklet Processor：48kHz → 24kHz 下采样 → PCM16 量化 → 20ms 帧切片
 *
 * 设计文档：saas/ai面试教练/new/模拟面试.md §8.3
 *
 * 浏览器原始采样率通常 48kHz（AudioContext default），火山 Realtime 要求 24kHz PCM16。
 * 此 processor 跑在 AudioWorkletGlobalScope（独立线程），不阻塞主线程。
 *
 * 用法：
 *   const ctx = new AudioContext();
 *   await ctx.audioWorklet.addModule('/utils/audioWorkletProcessor.js');
 *   const worklet = new AudioWorkletNode(ctx, 'pcm16-downsampler', {
 *     numberOfInputs: 1, numberOfOutputs: 0,
 *   });
 *   source.connect(worklet);
 *   worklet.port.onmessage = (e) => {
 *     // e.data is ArrayBuffer of Int16 PCM at 24kHz, 20ms per frame
 *     ws.send(e.data);
 *   };
 */

class PCM16Downsampler extends AudioWorkletProcessor {
  constructor() {
    super();
    this._inputSampleRate = sampleRate;  // 浏览器采样率（48k）
    this._targetSampleRate = 24000;
    this._frameSize = 480;  // 20ms @ 24kHz = 480 samples
    this._buffer = new Float32Array(this._frameSize * 2);  // 累积缓冲
    this._bufferPos = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const channel = input[0];  // 单声道
    if (!channel || channel.length === 0) return true;

    // 1. 下采样 48k → 24k
    const ratio = this._inputSampleRate / this._targetSampleRate;  // 2.0
    const outputLen = Math.floor(channel.length / ratio);
    const downsampled = new Float32Array(outputLen);
    for (let i = 0; i < outputLen; i++) {
      const srcIdx = i * ratio;
      const intIdx = Math.floor(srcIdx);
      const frac = srcIdx - intIdx;
      // 线性插值
      const a = channel[intIdx] || 0;
      const b = channel[intIdx + 1] || 0;
      downsampled[i] = a + (b - a) * frac;
    }

    // 2. 累积到 buffer
    for (let i = 0; i < downsampled.length; i++) {
      this._buffer[this._bufferPos++] = downsampled[i];
      if (this._bufferPos >= this._frameSize) {
        // 3. 量化为 Int16 PCM
        const pcm16 = new Int16Array(this._frameSize);
        for (let j = 0; j < this._frameSize; j++) {
          const s = Math.max(-1, Math.min(1, this._buffer[j]));
          pcm16[j] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        // 4. 推送 20ms 帧
        this.port.postMessage(pcm16.buffer, [pcm16.buffer]);
        // 重置 buffer（剩余部分下次处理）
        this._bufferPos = 0;
      }
    }

    return true;  // 保持 alive
  }
}

registerProcessor("pcm16-downsampler", PCM16Downsampler);
