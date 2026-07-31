/**
 * 配额客户端 —— 后端 GET /api/audio/quota/status 的前端封装。
 *
 * PRO/MAX 暂未上线（2026-07-24），toDisplayRemaining 不再返回 "unlimited"。
 * UI 适配提示：
 *   - remaining <= 0 时调用方应阻止操作继续
 */
import { API_BASE } from "@/lib/api";

export type Feature = "audio" | "record" | "resume";

export type FeatureQuota = {
  used: number;
  max: number;
  remaining: number;
};

export type QuotaStatus = {
  membership: "free" | "test" | "pro" | "max";
  audio: FeatureQuota;
  record: FeatureQuota;
  resume: FeatureQuota;
};

const QUOTA_STATUS_CACHE_TTL_MS = 3000;
let quotaStatusCache: { token: string | null; data: QuotaStatus; expiresAt: number } | null = null;
let quotaStatusInFlight: { token: string | null; promise: Promise<QuotaStatus | null> } | null = null;

export async function getQuotaStatus(options: { force?: boolean } = {}): Promise<QuotaStatus | null> {
  const token = typeof window !== "undefined"
    ? localStorage.getItem("interviewVar_token")
    : null;
  const now = Date.now();

  if (!options.force && quotaStatusCache?.token === token && quotaStatusCache.expiresAt > now) {
    return quotaStatusCache.data;
  }

  if (!options.force && quotaStatusInFlight?.token === token) {
    return quotaStatusInFlight.promise;
  }

  const promise = (async () => {
    try {
      const res = await fetch(`${API_BASE}/api/audio/quota/status`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        cache: "no-store",
      });
      if (!res.ok) return null;
      const data = (await res.json()) as QuotaStatus;
      quotaStatusCache = {
        token,
        data,
        expiresAt: Date.now() + QUOTA_STATUS_CACHE_TTL_MS,
      };
      return data;
    } catch {
      return null;
    } finally {
      if (quotaStatusInFlight?.promise === promise) {
        quotaStatusInFlight = null;
      }
    }
  })();

  quotaStatusInFlight = { token, promise };
  return promise;
}

/** 把 remaining 转为 UI 层习惯的 number 表示。PRO/MAX 暂未上线，不再返回 "unlimited"。 */
export function toDisplayRemaining(
  status: QuotaStatus | null,
  feature: Feature,
): number {
  if (!status) return 1; // 网络失败默认乐观显示 1 次
  return status[feature]?.remaining ?? 0;
}
