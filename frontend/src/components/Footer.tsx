"use client";

import React from "react";
import { openLegalTerms, openLegalPrivacy, openLegalContact } from "./LegalModals";

interface FooterProps {
  className?: string;
  showHomeLink?: boolean;
}

/**
 * 通用网页底部注脚组件 (Footer)
 * 单行精简风格（用于二级与子页面）：保持原始布局，加入版权主体、ICP备案号与公安联网备案号
 */
export default function Footer({ className = "", showHomeLink = false }: FooterProps) {
  return (
    <footer className={`bg-surface-container-lowest border-t border-slate-200 dark:border-white/5 w-full block mt-8 relative z-10 shrink-0 ${className}`}>
      <div className="px-gutter py-6 md:py-8 max-w-container-max mx-auto flex flex-col md:flex-row justify-between items-center gap-4 text-left">
        {/* 左侧：版权公司主体 (点击新窗口打开营业执照) + ICP 备案号 + 联网备案号 */}
        <div className="flex flex-wrap items-center gap-x-4 md:gap-x-6 gap-y-2 text-xs text-slate-500 dark:text-on-surface-variant/50 font-label-mono font-bold tracking-wider">
          <a
            href="/license"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-slate-800 dark:hover:text-white/80 transition-colors select-none"
            title="点击在新窗口查看营业执照"
          >
            © 2026 南京澜之其境科技有限公司
          </a>
          <a
            href="https://beian.miit.gov.cn/"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-slate-800 dark:hover:text-white/80 transition-colors"
          >
            苏ICP备2026058226号
          </a>
          <a
            href="https://beian.mps.gov.cn/#/query/webSearch"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-slate-800 dark:hover:text-white/80 transition-colors"
          >
            苏公网安备32011302323321号
          </a>
        </div>

        {/* 右侧：服务条款、隐私政策、联系我们 */}
        <div className="flex flex-wrap items-center gap-6 md:gap-8 text-xs text-slate-600 dark:text-on-surface-variant font-label-mono font-bold tracking-widest">
          <span
            onClick={() => openLegalTerms()}
            className="hover:text-indigo-600 dark:hover:text-primary transition-colors cursor-pointer select-none"
          >
            服务条款
          </span>
          <span
            onClick={() => openLegalPrivacy()}
            className="hover:text-indigo-600 dark:hover:text-primary transition-colors cursor-pointer select-none"
          >
            隐私政策
          </span>
          <span
            onClick={() => openLegalContact()}
            className="hover:text-indigo-600 dark:hover:text-primary transition-colors cursor-pointer select-none"
          >
            联系我们
          </span>
        </div>
      </div>
    </footer>
  );
}
