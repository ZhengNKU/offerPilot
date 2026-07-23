"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE } from "@/lib/api";

/**
 * 内容审核预览 hook(Phase 3)
 *
 * 用法:
 *   const { status, message, check } = useModerationPreview();
 *   <input onBlur={(e) => check(e.target.value)} />
 *   {status === "block" && <p>{message}</p>}
 *
 * 行为:
 * - debounce 500ms(防抖),onBlur 后等半秒才发请求
 * - 仅对 length >= 2 的文本触发
 * - 用 AbortController 取消上一个未完成的请求(用户连续输入时)
 * - 服务不可用 / 失败时静默降级为 "unknown"(不阻塞 UI)
 * - 通过 NEXT_PUBLIC_MODERATION_PREVIEW_ENABLED 灰度(默认开启)
 */

export type ModerationStatus = "idle" | "checking" | "pass" | "review" | "block" | "unknown";

export interface UseModerationPreviewResult {
  status: ModerationStatus;
  message: string;
  /** 触发一次审核;通常挂在 input onBlur */
  check: (text: string, scene?: string) => void;
  /** 立即发起一次无需等待防抖的同步审核，并返回 Promise 状态 */
  checkNow: (text: string, scene?: string) => Promise<ModerationStatus>;
  /** 主动重置(例如输入被清空) */
  reset: () => void;
}

const ENABLED = (() => {
  // 默认开启;可通过 NEXT_PUBLIC_MODERATION_PREVIEW_ENABLED=false 关闭
  const flag = process.env.NEXT_PUBLIC_MODERATION_PREVIEW_ENABLED;
  return flag !== "false";
})();

export function useModerationPreview(debounceMs: number = 500): UseModerationPreviewResult {
  const [status, setStatus] = useState<ModerationStatus>("idle");
  const [message, setMessage] = useState<string>("");
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const reset = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (abortRef.current) abortRef.current.abort();
    setStatus("idle");
    setMessage("");
  }, []);

  const checkNow = useCallback(async (text: string, scene: string = "preview"): Promise<ModerationStatus> => {
    if (!ENABLED) return "pass";
    if (!text || text.trim().length < 2) {
      reset();
      return "pass";
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    if (abortRef.current) abortRef.current.abort();

    setStatus("checking");
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const token = typeof window !== "undefined" ? localStorage.getItem("interviewVar_token") : null;
      const res = await fetch(`${API_BASE}/api/moderation/preview`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { "Authorization": `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ text, scene }),
        signal: controller.signal,
      });
      if (!res.ok) {
        setStatus("unknown");
        setMessage("");
        return "unknown";
      }
      const data = await res.json();
      const resStatus = (data.suggestion?.toLowerCase() || "unknown") as ModerationStatus;
      setStatus(resStatus);
      setMessage(data.message || "");
      return resStatus;
    } catch (err) {
      if ((err as any)?.name !== "AbortError") {
        setStatus("unknown");
        setMessage("");
      }
      return "unknown";
    }
  }, [reset]);

  const check = useCallback((text: string, scene: string = "preview") => {
    if (!ENABLED) return;
    // 短文本不审(省一次 API 调用)
    if (!text || text.trim().length < 2) {
      reset();
      return;
    }

    // 取消上一个等待 / 在飞的请求
    if (timerRef.current) clearTimeout(timerRef.current);
    if (abortRef.current) abortRef.current.abort();

    setStatus("checking");

    timerRef.current = setTimeout(async () => {
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const token = typeof window !== "undefined" ? localStorage.getItem("interviewVar_token") : null;
        const res = await fetch(`${API_BASE}/api/moderation/preview`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { "Authorization": `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ text, scene }),
          signal: controller.signal,
        });
        if (!res.ok) {
          setStatus("unknown");
          setMessage("");
          return;
        }
        const data = await res.json();
        setStatus(data.suggestion?.toLowerCase() || "unknown");
        setMessage(data.message || "");
      } catch (err) {
        // AbortError 不算错;其他错误静默降级
        if ((err as any)?.name !== "AbortError") {
          setStatus("unknown");
          setMessage("");
        }
      }
    }, debounceMs);
  }, [debounceMs, reset]);

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  return { status, message, check, checkNow, reset };
}
