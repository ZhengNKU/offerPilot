"use client";

import { motion, AnimatePresence } from "framer-motion";

/**
 * 会员计划对比弹窗（正式上线前版本）
 *
 * - 标题: 面试驾到 · 免费使用中
 * - 仅展示 基础体验版（免费）额度
 * - PRO / MAX 会员敬请期待
 *
 * Props:
 * - open: 是否打开
 * - onClose: 关闭回调
 */
interface PricingModalProps {
  open: boolean;
  onClose: () => void;
}

export function PricingModal({ open, onClose }: PricingModalProps) {
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-surface/60 backdrop-blur-md"
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="bg-surface-container-high border border-white/10 rounded-3xl p-7 max-w-2xl w-full text-left relative z-10 space-y-6 shadow-2xl max-h-[85vh] overflow-y-auto"
          >
            <div className="flex justify-between items-center pb-4 border-b border-white/5">
              <h3 className="font-extrabold text-white text-lg flex items-center gap-2">
                <span
                  className="material-symbols-outlined text-secondary"
                  style={{ fontVariationSettings: "'FILL' 1" }}
                >
                  workspace_premium
                </span>
                面试驾到 · 免费使用中
              </h3>
              <button
                onClick={onClose}
                className="text-on-surface-variant hover:text-white transition-colors cursor-pointer flex items-center justify-center w-7 h-7 rounded-lg hover:bg-white/5"
              >
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>

            {/* Free plan card */}
            <div className="grid grid-cols-1 gap-6 leading-relaxed text-xs font-semibold">
              <div className="p-5.5 rounded-2xl bg-white/[0.01] border border-white/5 flex flex-col justify-between gap-5 text-left">
                <div className="space-y-4">
                  <div>
                    <h4 className="text-sm font-black text-white">基础体验版</h4>
                    <span className="text-[20px] font-black text-white font-label-mono mt-1 block">
                      ¥0 <span className="text-xs text-on-surface-variant/40 font-normal">/ 免费</span>
                    </span>
                  </div>
                  <p className="text-on-surface-variant/60">
                    适用于基本面试调试与简历排版快速自测。
                  </p>
                  <ul className="space-y-2 border-t border-white/5 pt-4 text-on-surface-variant/75">
                    <li className="flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-xs text-tertiary">check_circle</span>
                      1 次简历分析
                    </li>
                    <li className="flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-xs text-tertiary">check_circle</span>
                      1 次面试记录分析
                    </li>
                    <li className="flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-xs text-on-surface-variant/30">cancel</span>
                      面试录音分析（已关闭）
                    </li>
                    <li className="flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-xs text-on-surface-variant/30">cancel</span>
                      AI 模拟面试（已关闭）
                    </li>
                    <li className="flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-xs text-tertiary">check_circle</span>
                      AI 职业顾问：30 次/月
                    </li>
                  </ul>
                </div>
                <button
                  onClick={onClose}
                  className="w-full py-2.5 bg-white/5 hover:bg-white/10 text-white rounded-xl font-black border border-white/10 transition-all cursor-pointer"
                >
                  当前版本
                </button>
              </div>
            </div>

            {/* PRO/MAX coming soon notice */}
            <div className="border-t border-white/5 pt-6 text-center">
              <p className="text-xs text-on-surface-variant/50 font-semibold">
                PRO 专家会员 · MAX 领航会员<span className="text-tertiary font-black ml-1">即将上线</span>
              </p>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
