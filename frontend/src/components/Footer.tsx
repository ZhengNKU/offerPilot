"use client";

import React from "react";
import { openLegalTerms, openLegalPrivacy, openLegalContact } from "./LegalModals";

interface FooterProps {
  className?: string;
  showHomeLink?: boolean;
}

/**
 * 通用网页底部注脚组件 (Footer)
 * 集成《服务条款》、《隐私政策》、《联系我们》全局 Modal 触发逻辑
 */
export default function Footer({ className = "", showHomeLink = false }: FooterProps) {
  return (
    <footer className={`bg-surface-container-lowest border-t border-slate-200 dark:border-white/5 w-full block mt-8 relative z-10 shrink-0 ${className}`}>
      <div className="px-gutter py-6 md:py-8 max-w-container-max mx-auto flex flex-col md:flex-row justify-between items-center gap-4 text-left">
        <span className="text-[10px] md:text-xs text-slate-400 dark:text-on-surface-variant/40 font-label-mono font-bold tracking-widest block text-left">
          © 2026 面试驾到. All rights reserved.
        </span>
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
