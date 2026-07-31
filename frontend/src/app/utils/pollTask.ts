/**
 * Shared task-status helpers for /api/audio/task/{id}.
 *
 * `subscribeTaskUntilDone` is the preferred path: it opens one SSE stream to
 * /api/audio/task/{id}/stream and updates progress as the backend publishes
 * events. `pollTaskUntilDone` is kept as a compatibility fallback for older
 * call sites or environments where SSE is not available.
 */

import { API_BASE } from "@/lib/api";

const TERMINAL_STATUSES = new Set(["completed", "failed"]);

export interface PollOptions {
  /** Polling interval in ms (default 2000). */
  intervalMs?: number;
  /** Hard cap on poll iterations (default 300 = 10 minutes at 2s). */
  maxIterations?: number;
  /** Optional auth headers (e.g. Authorization). */
  headers?: Record<string, string>;
  /** Called with the latest parsed task payload. */
  onProgress?: (data: { status: string; progress: number; [k: string]: unknown }) => void;
}

export interface SubscribeOptions {
  /** Optional auth headers (e.g. Authorization). */
  headers?: Record<string, string>;
  /** Called with snapshot/progress task payloads. Heartbeats are ignored. */
  onProgress?: (data: { status: string; progress: number; [k: string]: unknown }) => void;
  /** Total subscription timeout in ms (default 10 minutes). */
  timeoutMs?: number;
}

export interface PollResult {
  finalData: { status: string; progress: number; [k: string]: unknown };
  iterations: number;
}

function getTaskApiBaseUrl() {
  return typeof window !== "undefined" && (window as unknown as { __API_BASE__?: string }).__API_BASE__
    ? (window as unknown as { __API_BASE__: string }).__API_BASE__
    : API_BASE;
}

function readTerminalError(data: { [k: string]: unknown }) {
  return typeof data.error_message === "string" && data.error_message.trim()
    ? data.error_message
    : "分析任务失败，请重试";
}

export async function subscribeTaskUntilDone(
  taskId: string,
  opts: SubscribeOptions = {},
): Promise<PollResult> {
  const baseUrl = getTaskApiBaseUrl();
  const timeoutMs = opts.timeoutMs ?? 10 * 60 * 1000;
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let iterations = 0;
  let finalData: { status: string; progress: number; [k: string]: unknown } | null = null;

  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        controller.abort();
        reject(new Error("分析任务超时，请稍后重试"));
      }, timeoutMs);
    });

    const streamPromise = (async () => {
      const res = await fetch(`${baseUrl}/api/audio/task/${taskId}/stream`, {
        headers: opts.headers ?? {},
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(res.status === 404 ? "分析任务不存在" : "订阅分析进度失败，请重试");
      }
      if (!res.body) {
        throw new Error("浏览器不支持读取分析进度流");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const handleFrame = (frame: string) => {
        const trimmed = frame.trim();
        if (!trimmed) return null;

        let eventName = "message";
        let dataText = "";
        for (const line of trimmed.split(/\r?\n/)) {
          if (line.startsWith("event:")) {
            eventName = line.slice(6).trim();
          } else if (line.startsWith("data:")) {
            dataText += line.slice(5).trim();
          }
        }
        if (!dataText || eventName === "heartbeat") return null;

        const data = JSON.parse(dataText) as { status: string; progress: number; [k: string]: unknown };
        iterations += 1;
        finalData = data;
        opts.onProgress?.(data);

        const status = String(data.status);
        if (status === "failed") {
          throw new Error(readTerminalError(data));
        }
        if (status === "completed") {
          controller.abort();
          return { finalData: data, iterations };
        }
        return null;
      };

      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split(/\r?\n\r?\n/);
          buffer = frames.pop() ?? "";

          for (const frame of frames) {
            const result = handleFrame(frame);
            if (result) return result;
          }
        }

        if (buffer.trim()) {
          const result = handleFrame(buffer);
          if (result) return result;
        }
      } finally {
        try {
          reader.releaseLock();
        } catch { /* ignore */ }
      }

      if (finalData && TERMINAL_STATUSES.has(String(finalData.status))) {
        if (String(finalData.status) === "failed") throw new Error(readTerminalError(finalData));
        return { finalData, iterations };
      }
      throw new Error("分析进度连接已中断，请重试");
    })();

    return await Promise.race([streamPromise, timeoutPromise]);
  } catch (err) {
    if ((err as { name?: string })?.name === "AbortError" && finalData?.status === "completed") {
      return { finalData, iterations };
    }
    throw err;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    controller.abort();
  }
}

export async function pollTaskUntilDone(
  taskId: string,
  opts: PollOptions = {},
): Promise<PollResult> {
  const intervalMs = opts.intervalMs ?? 2000;
  const maxIterations = opts.maxIterations ?? 300;
  const headers = opts.headers ?? {};
  const baseUrl = getTaskApiBaseUrl();

  return new Promise((resolve, reject) => {
    let stopped = false;
    let inFlight = false;
    let iterations = 0;

    const stop = () => {
      stopped = true;
      clearInterval(timer);
      if (controller) controller.abort();
    };

    const tick = async () => {
      if (stopped || inFlight) return;
      inFlight = true;
      iterations += 1;
      controller = new AbortController();
      try {
        const res = await fetch(`${baseUrl}/api/audio/task/${taskId}`, {
          headers,
          signal: controller.signal,
        });
        if (!res.ok) {
          inFlight = false;
          return;
        }
        const data = await res.json();
        opts.onProgress?.(data);

        if (String(data.status) === "failed") {
          stop();
          reject(new Error(readTerminalError(data)));
          return;
        }

        if (String(data.status) === "completed") {
          stop();
          resolve({ finalData: data, iterations });
          return;
        }

        if (iterations >= maxIterations) {
          stop();
          reject(new Error("分析任务超时，请稍后重试"));
          return;
        }
      } catch (err) {
        // AbortError fires when we call controller.abort() during teardown —
        // that's expected on success, so just exit quietly.
        if ((err as { name?: string })?.name === "AbortError") return;
        // Transient network errors keep the poll alive.
      } finally {
        inFlight = false;
      }
    };

    let controller: AbortController | null = null;
    const timer = setInterval(tick, intervalMs);
    // Fire the first tick immediately so we don't wait `intervalMs` for the
    // very first response.
    void tick();
  });
}
