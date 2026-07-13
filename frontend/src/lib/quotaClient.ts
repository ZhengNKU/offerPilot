/**
 * 配额客户端 —— 后端 GET /api/audio/quota/status 的前端封装。
 *
 * 替代旧的 /api/audio/check_limit：旧接口只回答"非会员是否还有 1 次免费"，
 * 新接口返回结构化的 {used, max, remaining}，覆盖 audio/record/resume 三个功能。
 *
 * UI 适配提示：
 *   - PRO/MAX 仍然可以传 "unlimited" 给显示层（虽然有 10/30 次上限，但相对
 *     用户认知来说等同于无限）
 *   - remaining <= 0 时调用方应触发升级弹窗 + 阻止操作继续
 */
import { API_BASE } from "@/lib/api";

export type Feature = "audio" | "record" | "resume";

export type FeatureQuota = {
  used: number;
  max: number;
  remaining: number;
};

export type QuotaStatus = {
  membership: "free" | "pro" | "max";
  audio: FeatureQuota;
  record: FeatureQuota;
  resume: FeatureQuota;
};

export async function getQuotaStatus(): Promise<QuotaStatus | null> {
  const token = typeof window !== "undefined"
    ? localStorage.getItem("interviewVar_token")
    : null;
  try {
    const res = await fetch(`${API_BASE}/api/audio/quota/status`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as QuotaStatus;
  } catch {
    return null;
  }
}

/** 把 remaining 转为 UI 层习惯的 number | "unlimited" 表示。 */
export function toDisplayRemaining(
  status: QuotaStatus | null,
  feature: Feature,
): number | "unlimited" {
  if (!status) return 1; // 网络失败默认乐观显示 1 次
  if (status.membership === "pro" || status.membership === "max") {
    return "unlimited";
  }
  return status[feature]?.remaining ?? 0;
}