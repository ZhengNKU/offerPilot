/**
 * 上传客户端(presigned PUT 直传 COS,2026-08 引入)
 *
 * 3 步流程:
 *   1. presignUpload   → POST /api/file/presign-upload,拿 upload_url + cos_key + presign_token
 *   2. putToCos        → XHR 直接 PUT upload_url(不经后端)
 *   3. finalizeUpload  → POST /api/file/finalize,落 DB,拿 1h download URL
 *
 * 选型记录:
 *   - 原本想用 cos-js-sdk-v5,但 SDK 的 getAuthorization 回调只接受 STS Credentials
 *     或 Authorization 字符串,**不直接支持 presigned URL 直传**。
 *   - 退回 XHR PUT 上传:进度回调简单、错误处理可控、不依赖后端改 STS。
 *   - cos-js-sdk-v5 仍保留在 package.json,后续要支持 >100MB 文件 / 弱网断点续传,
 *     把后端 /api/file/presign-upload 改为返回 STS Credentials 即可平滑迁移。
 */

import { authHeader } from "@/utils/authHeaders";
import { API_BASE } from "@/lib/api";

// ── Response 类型 ──────────────────────────────────────────

export interface PresignResponse {
  upload_url: string;
  cos_key: string;
  presign_token: string;
  file_id: number;
  expires_in: number;
  max_size: number;
}

export interface FinalizeResponse {
  file_id: number;
  filename: string;
  file_url: string;
  cos_path: string;
  file_size: number;
  file_type: string;
  /** 重复 finalize(同 cos_key 已 finalized)时为 true; 前端可据此不上 toast */
  idempotent_replay?: boolean;
}

// ── 工具 ────────────────────────────────────────────────────

async function postJson<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { ...authHeader(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `${path} 失败 (HTTP ${res.status})`);
  }
  return res.json();
}

// ── 1. presign ─────────────────────────────────────────────

export async function presignUpload(args: {
  file_type: "audio" | "resume" | "screenshot";
  filename: string;
  content_length: number;
  content_type: string;
}): Promise<PresignResponse> {
  return postJson<PresignResponse>("/api/file/presign-upload", {
    file_type: args.file_type,
    filename: args.filename,
    content_length: args.content_length,
    content_type: args.content_type,
  });
}

// ── 2. PUT 直传 COS(XHR 拿进度) ────────────────────────────

/**
 * 用 XHR PUT 整个 file body 到 presigned URL。
 * 不发 Authorization 头(presigned URL 自己就是身份凭证)。
 * Content-Type / Content-Length 必须与后端 presign 时 sign 的 Header 一致,
 * 所以从 file.type 和 file.size 取,不让浏览器再覆盖。
 */
export function putToCos(args: {
  file: File;
  presign: PresignResponse;
  onProgress?: (percent: number) => void;
}): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    // presigned URL 已经是完整签名,直接 PUT,不再带额外 auth header
    xhr.open("PUT", args.presign.upload_url);

    // 后端 sign 时指定了 Content-Type/Content-Length,这里必须传匹配的值,
    // 否则 COS 返回 403 SignatureDoesNotMatch
    xhr.setRequestHeader("Content-Type", args.file.type || "application/octet-stream");

    if (args.onProgress) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          // 旧实现用 `Math.max(5, percent)` 保证进度条从 5% 起跳,
          // 这里保留同款行为(避免 feedback 页 spinner 闪一下归 0)
          args.onProgress!(Math.max(5, Math.round((event.loaded / event.total) * 100)));
        }
      };
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        // COS 200/204 都算成功; 部分 PutObject 返回 204 No Content
        resolve();
      } else {
        // COS 错误本体是 XML,但前端报错只取状态码 + 原始响应文本
        reject(new Error(`PUT COS 失败 HTTP ${xhr.status}: ${xhr.responseText?.slice(0, 200) || "(empty)"}`));
      }
    };

    xhr.onerror = () => {
      // onerror 通常是 CORS 失败 / 网络中断,无法拿到具体 response
      reject(new Error("PUT COS 网络错误(可能 CORS 未配置或网络中断)"));
    };

    xhr.onabort = () => reject(new Error("PUT COS 已中止"));

    xhr.send(args.file);
  });
}

// ── 3. finalize ────────────────────────────────────────────

export async function finalizeUpload(args: {
  cos_key: string;
  presign_token: string;
  filename: string;
  file_type: "audio" | "resume" | "screenshot";
  file_size: number;
}): Promise<FinalizeResponse> {
  return postJson<FinalizeResponse>("/api/file/finalize", {
    cos_key: args.cos_key,
    presign_token: args.presign_token,
    filename: args.filename,
    file_type: args.file_type,
    file_size: args.file_size,
  });
}

// ── 高层 one-shot ──────────────────────────────────────────

/**
 * 3 步合一。成功返回 {file_id, file_url, ...}。
 * 失败抛 Error(message 是后端 detail 字段或网络错误文案)。
 *
 * 调用方必须在 finalize 成功后才 track_pending_file —— 否则 auto-flush DELETE
 * 会把 finalized 行干掉,得不偿失。
 */
export async function uploadDirectToCos(args: {
  file: File;
  fileType: "audio" | "resume" | "screenshot";
  onProgress?: (percent: number) => void;
}): Promise<FinalizeResponse> {
  const presign = await presignUpload({
    file_type: args.fileType,
    filename: args.file.name,
    content_length: args.file.size,
    content_type: args.file.type || "application/octet-stream",
  });

  await putToCos({ file: args.file, presign, onProgress: args.onProgress });

  return finalizeUpload({
    cos_key: presign.cos_key,
    presign_token: presign.presign_token,
    filename: args.file.name,
    file_type: args.fileType,
    file_size: args.file.size,
  });
}
