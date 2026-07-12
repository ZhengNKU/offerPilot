/**
 * Shared task-status polling helper for /api/audio/task/{id}.
 *
 * Why this exists: there were three duplicated `pollUntilDone` implementations
 * across debugger/page.tsx, debugger/record/page.tsx, and debugger/voice/page.tsx.
 * All of them only cleared `setInterval` when the response said "completed" —
 * but they would still let one in-flight fetch land right before the clear, and
 * on a slow connection the response could be `status: "processing"` while the
 * server had already finished, leaving a handful of stale polls in the log.
 *
 * This helper:
 *   - aborts the in-flight fetch the moment we observe a terminal status
 *   - enforces a max iteration cap as a safety net
 *   - clears the interval BEFORE resolving/rejecting (no double-fire)
 *   - invokes an `onProgress` callback so callers can update UI each tick
 *   - skips ticks while the previous fetch is still pending (no overlap)
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

export interface PollResult {
  finalData: { status: string; progress: number; [k: string]: unknown };
  iterations: number;
}

export async function pollTaskUntilDone(
  taskId: string,
  opts: PollOptions = {},
): Promise<PollResult> {
  const intervalMs = opts.intervalMs ?? 2000;
  const maxIterations = opts.maxIterations ?? 300;
  const headers = opts.headers ?? {};

  const baseUrl =
    typeof window !== "undefined" && (window as unknown as { __API_BASE__?: string }).__API_BASE__
      ? (window as unknown as { __API_BASE__: string }).__API_BASE__
      : API_BASE;

  return new Promise((resolve, reject) => {
    let stopped = false;
    let inFlight = false;
    let iterations = 0;
    let lastData: { status: string; progress: number; [k: string]: unknown } | null = null;

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
        lastData = data;
        opts.onProgress?.(data);

        if (TERMINAL_STATUSES.has(String(data.status))) {
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