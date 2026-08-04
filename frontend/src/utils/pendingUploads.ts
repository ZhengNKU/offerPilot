/**
 * 跟踪"已上传但尚未关联到 session"的文件 ID,
 * 用于切屏/刷新时自动清理,避免 COS + DB 累积孤儿文件。
 *
 * 用法:
 *   trackPendingFile(fileId)         - 上传成功后调用
 *   untrackPendingFile(fileId)       - session 创建成功 OR 用户手动删除时调用
 *   flushPendingUploads()            - 立即把所有 pending 文件 DELETE 掉(切屏/刷新/卸载触发)
 *
 * 设计要点:
 *   - 模块级 Set + sessionStorage 双重保存,保证刷新/新标签页之间不丢
 *   - fetch 使用 keepalive:true,即使页面正在卸载也能保证 DELETE 请求送达
 *   - DELETE 失败不抛错(页面要走了,也没人处理报错)
 */
import { API_BASE } from "@/lib/api";

const STORAGE_KEY = "interviewVar_pendingUploads";

// 模块级 Set(同标签页内共享)
const pendingIds = new Set<number>();

// 从 sessionStorage 恢复(用于页面刚加载 + 上一轮没 flush 干净的情况)
function restoreFromStorage() {
  if (typeof window === "undefined") return;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const ids = JSON.parse(raw);
    if (Array.isArray(ids)) {
      ids.forEach((id) => {
        if (typeof id === "number") pendingIds.add(id);
      });
    }
  } catch {
    // sessionStorage 解析失败 → 静默忽略
  }
}

// 持久化到 sessionStorage(刷新前最后一道兜底)
function persistToStorage() {
  if (typeof window === "undefined") return;
  try {
    if (pendingIds.size === 0) {
      sessionStorage.removeItem(STORAGE_KEY);
    } else {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...pendingIds]));
    }
  } catch {
    // 配额超限等 → 静默忽略
  }
}

// 模块加载时立即恢复
if (typeof window !== "undefined") {
  restoreFromStorage();
}

export function trackPendingFile(fileId: number) {
  if (!Number.isFinite(fileId) || fileId <= 0) return;
  pendingIds.add(fileId);
  persistToStorage();
}

export function untrackPendingFile(fileId: number) {
  pendingIds.delete(fileId);
  persistToStorage();
}

export function getPendingFileIds(): number[] {
  return [...pendingIds];
}

/**
 * 立刻把所有 pending 文件 DELETE 掉。
 * - 用 keepalive: fetch 不会被页面卸载中断
 * - 同步发起(不等响应),页面走了也不影响
 * - 失败也只 log 不抛(切屏/刷新场景下没人接报错)
 */
export function flushPendingUploads(reason: string = "auto-cleanup") {
  if (pendingIds.size === 0) return;
  const token =
    typeof window !== "undefined"
      ? localStorage.getItem("interviewVar_token")
      : null;
  if (!token) {
    // 没登录的话这些文件是访客文件,后端会自动 deny,
    // 但本地还是要清干净 Set,避免下次又尝试
    pendingIds.clear();
    persistToStorage();
    return;
  }

  const ids = [...pendingIds];
  try {
    sessionStorage.removeItem("interviewVar_modeFiles");
    sessionStorage.removeItem("interviewVar_feedbackScreenshotFileId");
    sessionStorage.removeItem("interviewVar_feedbackScreenshotUrl");
    sessionStorage.removeItem("interviewVar_feedbackScreenshotName");
  } catch {
    // ignore
  }
  for (const id of ids) {
    try {
      // keepalive: true 是关键 —— 页面正在 unload 也能送达
      fetch(`${API_BASE}/api/file/delete?file_id=${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
        keepalive: true,
      }).catch(() => {
        // 静默,切屏/刷新场景没人接报错
      });
    } catch {
      // ignore
    }
    pendingIds.delete(id);
  }
  persistToStorage();
  if (typeof console !== "undefined" && process.env.NODE_ENV !== "production") {
    console.log(
      `[pendingUploads] flushed ${ids.length} files (reason=${reason})`
    );
  }
}
