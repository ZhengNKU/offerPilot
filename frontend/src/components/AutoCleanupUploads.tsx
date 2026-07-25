"use client";

/**
 * 全局监听器：关闭/刷新页面 时自动清理已上传但未关联到 session 的孤儿文件。
 *
 * 注意：不监听 visibilitychange，因为用户切到其他标签页再切回来时，
 * 上传的文件不应被误删（文件可能在上传→create_session 的间隙中）。
 *
 * 配合 utils/pendingUploads.ts 使用:
 *   - 上传成功后 → trackPendingFile(fileId)
 *   - session 创建成功 / 用户手动删除 → untrackPendingFile(fileId)
 *   - 本组件负责在页面关闭/刷新时 → flushPendingUploads(reason)
 */
import { useEffect } from "react";
import { flushPendingUploads } from "@/utils/pendingUploads";

export default function AutoCleanupUploads() {
  useEffect(() => {
    // 页面隐藏(pagehide 在 BFCache / 移动端切后台更可靠)
    const onPageHide = () => {
      flushPendingUploads("pagehide");
    };
    // 关闭/刷新兜底
    const onBeforeUnload = () => {
      flushPendingUploads("beforeunload");
    };

    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("beforeunload", onBeforeUnload);

    return () => {
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, []);

  return null;
}
