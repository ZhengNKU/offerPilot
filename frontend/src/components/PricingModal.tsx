"use client";

import { motion, AnimatePresence } from "framer-motion";

/**
 * 会员计划对比弹窗
 *
 * - 标题: 解锁 面试驾到 顶配 AI 职业大招：会员计划对比
 * - 列出 基础体验版 / PRO 专家会员 / MAX 领航会员 三档
 * - 底部加微信/支付宝扫码支付视觉块
 *
 * Props:
 * - open: 是否打开
 * - onClose: 关闭回调
 * - highlight: 进入弹窗时优先高亮 PRO 还是 MAX，便于在 Pro 用户继续点升级时聚焦目标档
 */
interface PricingModalProps {
  open: boolean;
  onClose: () => void;
  highlight?: "pro" | "max";
}

export function PricingModal({ open, onClose, highlight }: PricingModalProps) {
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
            className="bg-surface-container-high border border-white/10 rounded-3xl p-7 max-w-4xl w-full text-left relative z-10 space-y-6 shadow-2xl max-h-[85vh] overflow-y-auto"
          >
            <div className="flex justify-between items-center pb-4 border-b border-white/5">
              <h3 className="font-extrabold text-white text-lg flex items-center gap-2">
                <span
                  className="material-symbols-outlined text-secondary"
                  style={{ fontVariationSettings: "'FILL' 1" }}
                >
                  workspace_premium
                </span>
                解锁 面试驾到 顶配 AI 职业大招：会员计划对比
              </h3>
              <button
                onClick={onClose}
                className="text-on-surface-variant hover:text-white transition-colors cursor-pointer flex items-center justify-center w-7 h-7 rounded-lg hover:bg-white/5"
              >
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>

            {/* Plans comparison cards row */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 leading-relaxed text-xs font-semibold">
              {/* Plan 1: Free */}
              <div className="p-5.5 rounded-2xl bg-white/[0.01] border border-white/5 flex flex-col justify-between gap-5 text-left">
                <div className="space-y-4">
                  <div>
                    <h4 className="text-sm font-black text-white">基础体验版</h4>
                    <span className="text-[20px] font-black text-white font-label-mono mt-1 block">
                      ¥0 <span className="text-xs text-on-surface-variant/40 font-normal">/ 免费永久</span>
                    </span>
                  </div>
                  <p className="text-on-surface-variant/60">
                    适用于基本面试调试与简历排版快速自测，限制部分 AI 深度模型。
                  </p>
                  <ul className="space-y-2 border-t border-white/5 pt-4 text-on-surface-variant/75">
                    <li className="flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-xs text-tertiary">check_circle</span>
                      1 次面试录音分析（永久）
                    </li>
                    <li className="flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-xs text-tertiary">check_circle</span>
                      1 次面试记录分析（永久）
                    </li>
                    <li className="flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-xs text-tertiary">check_circle</span>
                      1 次简历基础诊断（永久）
                    </li>
                    <li className="flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-xs text-on-surface-variant/30">cancel</span>
                      AI 模拟对话演练
                    </li>
                    <li className="flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-xs text-on-surface-variant/30">cancel</span>
                      长期职业记忆云存储
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

              {/* Plan 2: PRO */}
              <div
                className={`p-5.5 rounded-2xl bg-primary/5 border flex flex-col justify-between gap-5 text-left relative overflow-hidden ${
                  highlight === "pro"
                    ? "border-primary shadow-[0_0_30px_rgba(192,193,255,0.25)] scale-[1.02]"
                    : "border-primary/20"
                }`}
              >
                <div className="absolute top-0 right-0 px-2.5 py-0.5 bg-primary text-on-primary text-[9px] font-black rounded-bl-xl uppercase tracking-widest font-label-mono select-none">
                  推荐
                </div>

                <div className="space-y-4">
                  <div>
                    <h4 className="text-sm font-black text-white">PRO 专家会员</h4>
                    <span className="text-[20px] font-black text-primary font-label-mono mt-1 block">
                      ¥39 <span className="text-xs text-on-surface-variant/40 font-normal">/ 月付套餐</span>
                    </span>
                  </div>
                  <p className="text-on-surface-variant/60">
                    适合正在频繁参加面试、渴望快速突破弱点并获得中高大厂 Offer 的高级工程师。
                  </p>
                  <ul className="space-y-2 border-t border-white/5 pt-4 text-on-surface-variant/75">
                    <li className="flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-xs text-tertiary">check_circle</span>
                      30 天内 10 次面试录音分析
                    </li>
                    <li className="flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-xs text-tertiary">check_circle</span>
                      30 天内 10 次面试记录分析
                    </li>
                    <li className="flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-xs text-tertiary">check_circle</span>
                      30 天内 10 次简历深度优化
                    </li>
                    <li className="flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-xs text-tertiary">check_circle</span>
                      5 次 AI 模拟面试演练
                    </li>
                    <li className="flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-xs text-tertiary">check_circle</span>
                      全套职业记忆库系统支撑
                    </li>
                  </ul>
                </div>
                <button
                  onClick={onClose}
                  className="w-full py-2.5 bg-primary text-on-primary rounded-xl font-black shadow-lg shadow-primary/20 hover:scale-[1.01] active:scale-98 transition-all cursor-pointer"
                >
                  已是此会员 (去续费)
                </button>
              </div>

              {/* Plan 3: MAX */}
              <div
                className={`p-5.5 rounded-2xl bg-secondary/5 border flex flex-col justify-between gap-5 text-left relative overflow-hidden ${
                  highlight === "max"
                    ? "border-secondary shadow-[0_0_30px_rgba(255,178,183,0.25)] scale-[1.02]"
                    : "border-secondary/20"
                }`}
              >
                <div className="space-y-4">
                  <div>
                    <h4 className="text-sm font-black text-white">MAX 领航会员</h4>
                    <span className="text-[20px] font-black text-secondary font-label-mono mt-1 block">
                      ¥99 <span className="text-xs text-on-surface-variant/40 font-normal">/ 月付套餐</span>
                    </span>
                  </div>
                  <p className="text-on-surface-variant/60">
                    尊享无限分析额度与特权，适合追求极致、备战顶级架构师/技术总监职位的技术精英。
                  </p>
                  <ul className="space-y-2 border-t border-white/5 pt-4 text-on-surface-variant/75">
                    <li className="flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-xs text-tertiary">check_circle</span>
                      无限次面试录音/记录分析
                    </li>
                    <li className="flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-xs text-tertiary">check_circle</span>
                      无限次简历深度精修
                    </li>
                    <li className="flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-xs text-tertiary">check_circle</span>
                      无限次 AI 模拟面试通关
                    </li>
                    <li className="flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-xs text-tertiary">check_circle</span>
                      一对一专属 AI 终身顾问咨询
                    </li>
                  </ul>
                </div>
                <button
                  onClick={onClose}
                  className="w-full py-2.5 bg-gradient-to-r from-secondary to-primary text-on-primary rounded-xl font-black shadow-lg shadow-secondary/20 hover:scale-[1.01] active:scale-98 transition-all cursor-pointer"
                >
                  立即升级
                </button>
              </div>
            </div>

            {/* Checkout simulation QR section */}
            <div className="border-t border-white/5 pt-6 flex flex-col sm:flex-row justify-between items-center gap-5">
              <div className="text-left max-w-md">
                <h5 className="text-xs md:text-sm font-black text-white">微信/支付宝 扫码快捷支付</h5>
                <p className="text-[11px] text-on-surface-variant/50 leading-relaxed font-semibold mt-1">
                  付款后会员权益实时重置，PRO/MAX 会员均可随时退订，7天内无理由全额退款保障。
                </p>
              </div>
              <div className="flex gap-4 items-center shrink-0">
                <div className="p-2 rounded-xl bg-white border border-white/10 w-24 h-24 flex items-center justify-center relative overflow-hidden select-none">
                  {/* Simulated QR Code graph */}
                  <div className="absolute inset-2 bg-[linear-gradient(to_right,#000_1px,transparent_1px),linear-gradient(to_bottom,#000_1px,transparent_1px)] bg-[size:6px_6px]" />
                  <div className="absolute w-6 h-6 bg-black left-2 top-2 border-2 border-white" />
                  <div className="absolute w-6 h-6 bg-black right-2 top-2 border-2 border-white" />
                  <div className="absolute w-6 h-6 bg-black left-2 bottom-2 border-2 border-white" />
                </div>
                <div className="text-left font-label-mono text-xs font-semibold text-on-surface-variant/70 leading-normal">
                  <p>微信支付: 支持信用卡</p>
                  <p>支付宝: 支持蚂蚁花呗</p>
                  <p className="text-tertiary font-black block mt-1">7天无理由退款保证</p>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
