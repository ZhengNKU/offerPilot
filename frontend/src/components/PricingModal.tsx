"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { PRICING_PLANS, PricingPlan, getPlanById } from "@/lib/pricingPlans";
import { API_BASE } from "@/lib/api";
import { useAuth } from "@/components/AuthProvider";

interface PricingModalProps {
  open: boolean;
  onClose: () => void;
  defaultPlanId?: string;
  defaultCategory?: "subscription" | "pack";
  currentMembership?: string;
  onSuccess?: () => void;
}

export function PricingModal({
  open,
  onClose,
  defaultPlanId = "MONTH_PRO",
  defaultCategory = "subscription",
  currentMembership = "free",
  onSuccess,
}: PricingModalProps) {
  const auth = useAuth();
  const [activeCategory, setActiveCategory] = useState<"subscription" | "pack">(defaultCategory);
  const [selectedPlanId, setSelectedPlanId] = useState<string>(defaultPlanId);
  // 当前只保留支付宝一个渠道，固定为 "alipay"；后端 billing 也支持 "wechat"，需要时再做渠道切换
  const paymentMethod = "alipay";
  const [showQrCode, setShowQrCode] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isCreatingOrder, setIsCreatingOrder] = useState(false);
  const [paySuccess, setPaySuccess] = useState(false);
  const [orderNo, setOrderNo] = useState<string>("");
  const [qrCodeUrl, setQrCodeUrl] = useState<string>("");
  const [isQrLoaded, setIsQrLoaded] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>("");

  // Sync category when plan changes or opened
  useEffect(() => {
    if (open) {
      const plan = getPlanById(defaultPlanId);
      if (plan) {
        setActiveCategory(plan.category);
        setSelectedPlanId(plan.id);
      } else {
        setActiveCategory(defaultCategory);
        setSelectedPlanId(defaultCategory === "subscription" ? "MONTH_PRO" : "PACK_A");
      }
      setShowQrCode(false);
      setIsProcessing(false);
      setIsCreatingOrder(false);
      setPaySuccess(false);
      setOrderNo("");
      setQrCodeUrl("");
      setIsQrLoaded(false);
      setErrorMessage("");
    }
  }, [open, defaultPlanId, defaultCategory]);

  // 刷新用户资料并在前端应用最新权益
  const refreshUserAndComplete = useCallback(async () => {
    try {
      const token = typeof window !== "undefined" ? localStorage.getItem("interviewVar_token") : null;
      if (token) {
        const meRes = await fetch(`${API_BASE}/api/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (meRes.ok) {
          const meData = await meRes.json();
          await auth.updateUser(meData);
        }
      }
    } catch (e) {
      console.error("Failed to refresh user profile:", e);
    }
    setPaySuccess(true);
    if (onSuccess) onSuccess();
    setTimeout(() => {
      onClose();
    }, 1500);
  }, [auth, onSuccess, onClose]);

  // Polling order status when QR code is visible
  useEffect(() => {
    if (!showQrCode || !orderNo || paySuccess) return;

    const token = typeof window !== "undefined" ? localStorage.getItem("interviewVar_token") : null;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/billing/order/${orderNo}/status`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (res.ok) {
          const data = await res.json();
          if (data.status === "paid") {
            clearInterval(interval);
            await refreshUserAndComplete();
          }
        }
      } catch (err) {
        // silent polling catch
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [showQrCode, orderNo, paySuccess, refreshUserAndComplete]);

  const plans = PRICING_PLANS.filter((p) => p.category === activeCategory);
  const currentPlan = getPlanById(selectedPlanId) || plans[0] || PRICING_PLANS[2];

  const handleSelectPlan = (plan: PricingPlan) => {
    setSelectedPlanId(plan.id);
    setShowQrCode(false);
    setOrderNo("");
    setQrCodeUrl("");
    setIsQrLoaded(false);
    setErrorMessage("");
  };

  const handleCategorySwitch = (cat: "subscription" | "pack") => {
    setActiveCategory(cat);
    setShowQrCode(false);
    setOrderNo("");
    setQrCodeUrl("");
    setIsQrLoaded(false);
    setErrorMessage("");
    if (cat === "subscription") {
      setSelectedPlanId("MONTH_PRO");
    } else {
      setSelectedPlanId("PACK_A");
    }
  };

  // 关闭二维码弹窗。它的报错属于那一层，关掉就一并清掉，
  // 否则 errorMessage 还留着，会立刻以「独立错误弹窗」的形式再弹一次。
  const closeQrCode = () => {
    setShowQrCode(false);
    setErrorMessage("");
  };

  // 发起真实下单获取支付二维码
  const handleStartPay = async () => {
    setIsCreatingOrder(true);
    setErrorMessage("");
    try {
      const token = typeof window !== "undefined" ? localStorage.getItem("interviewVar_token") : null;
      const res = await fetch(`${API_BASE}/api/billing/create_order`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          plan_id: selectedPlanId,
          channel: paymentMethod,
        }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ detail: "下单失败" }));
        throw new Error(errorData.detail || "发起支付失败，请重试");
      }

      const data = await res.json();
      if (!data.order_no) {
        throw new Error("服务端未返回有效订单编号");
      }
      setOrderNo(data.order_no);
      setQrCodeUrl(data.qr_code_url || "");
      setShowQrCode(true);
    } catch (err: any) {
      setErrorMessage(err?.message || "网络异常，发起支付失败");
      setShowQrCode(false);
    } finally {
      setIsCreatingOrder(false);
    }
  };

  // 点击「我已完成支付」：向后端执行真实支付状态校验，只有 paid 才修改额度与会员
  const handleVerifyPayment = async () => {
    if (!orderNo || isProcessing || paySuccess) return;
    setIsProcessing(true);
    setErrorMessage("");
    try {
      const token = typeof window !== "undefined" ? localStorage.getItem("interviewVar_token") : null;
      const res = await fetch(`${API_BASE}/api/billing/order/${orderNo}/status`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        throw new Error("查询订单状态失败，请稍后重试");
      }
      const data = await res.json();
      if (data.status === "paid") {
        await refreshUserAndComplete();
      } else if (data.status === "expired") {
        // 过期和「还没付款」是两回事：过了支付窗口再怎么等也不会到账，必须重新下单。
        // 后端 query_order_status 轮询时会顺手把超时订单翻成 expired，所以这里拿得到。
        setErrorMessage("该订单已过期（支付窗口 15 分钟）。请关闭本窗口，重新点击「立即开通支付」生成新订单。");
      } else {
        setErrorMessage("支付宝尚未检测到该订单支付成功。若您已扣款，支付宝结算可能存在几秒延迟，请稍候再试；若尚未扫码，请使用支付宝扫码付款。");
      }
    } catch (err: any) {
      setErrorMessage(err?.message || "校验支付结果失败，请重试");
    } finally {
      setIsProcessing(false);
    }
  };

  // 开发测试联调辅助：未配置真实商户私钥时，模拟扫码完成履约
  const handleDevSimulatePay = async () => {
    if (!orderNo) return;
    setIsProcessing(true);
    setErrorMessage("");
    try {
      const token = typeof window !== "undefined" ? localStorage.getItem("interviewVar_token") : null;
      const res = await fetch(`${API_BASE}/api/billing/order/${orderNo}/dev_simulate_pay`, {
        method: "POST",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({ detail: "模拟支付请求失败" }));
        throw new Error(d.detail || "模拟支付请求失败");
      }
      // 模拟成功后立即进入真实查单与履约状态刷新
      await handleVerifyPayment();
    } catch (err: any) {
      setErrorMessage(err?.message || "模拟支付失败");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 dark:bg-black/80 backdrop-blur-md"
          />

          {/* Dialog Container */}
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 16 }}
            transition={{ duration: 0.2 }}
            className="relative z-10 w-full max-w-4xl bg-white dark:bg-[#11192b] border border-slate-200 dark:border-white/10 rounded-3xl shadow-2xl overflow-hidden my-auto max-h-[92vh] flex flex-col text-slate-800 dark:text-on-surface"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-white/5 bg-slate-50/70 dark:bg-white/[0.02]">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-primary/10 dark:bg-primary/20 text-primary flex items-center justify-center font-black">
                  <span className="material-symbols-outlined text-2xl text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>
                    diamond
                  </span>
                </div>
                <div>
                  <h3 className="text-lg font-black text-slate-900 dark:text-white flex items-center gap-2">
                    会员开通与续费升级
                    {currentMembership && currentMembership !== "free" && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 font-bold">
                        当前: {getPlanById(currentMembership.toUpperCase())?.name || currentMembership.toUpperCase()}
                      </span>
                    )}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-on-surface-variant/60">
                    全流程 AI 面试加速，配额即时生效，续费顺延有效期
                  </p>
                </div>
              </div>

              <button
                onClick={onClose}
                className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 dark:text-on-surface-variant/60 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/5 transition-colors cursor-pointer"
              >
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>

            {/* Body */}
            <div className="p-5 sm:p-6 overflow-y-auto space-y-6 flex-1">
              {/* Category Selector Tabs */}
              <div className="flex justify-center">
                <div className="inline-flex p-1 rounded-2xl bg-slate-100 dark:bg-white/5 border border-slate-200/80 dark:border-white/10">
                  <button
                    type="button"
                    onClick={() => handleCategorySwitch("subscription")}
                    className={`px-6 py-2 rounded-xl text-sm font-black transition-all cursor-pointer flex items-center gap-1.5 ${
                      activeCategory === "subscription"
                        ? "bg-white dark:bg-white/15 text-indigo-600 dark:text-white shadow-sm border border-slate-200/80 dark:border-white/20"
                        : "text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                    }`}
                  >
                    <span className="material-symbols-outlined text-base">calendar_month</span>
                    周期订阅会员 (周卡 / 月卡)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleCategorySwitch("pack")}
                    className={`px-6 py-2 rounded-xl text-sm font-black transition-all cursor-pointer flex items-center gap-1.5 ${
                      activeCategory === "pack"
                        ? "bg-white dark:bg-white/15 text-indigo-600 dark:text-white shadow-sm border border-slate-200/80 dark:border-white/20"
                        : "text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                    }`}
                  >
                    <span className="material-symbols-outlined text-base">battery_charging_full</span>
                    按需加油包 (单次体验)
                  </button>
                </div>
              </div>

              {/* Plan Cards Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
                {plans.map((plan) => {
                  const isSelected = selectedPlanId === plan.id;
                  return (
                    <div
                      key={plan.id}
                      onClick={() => handleSelectPlan(plan)}
                      className={`relative p-4 rounded-2xl cursor-pointer transition-all duration-200 border flex flex-col justify-between text-left ${
                        isSelected
                          ? "bg-indigo-50/70 dark:bg-primary/10 border-indigo-500 dark:border-primary shadow-md shadow-indigo-500/10 scale-[1.02]"
                          : "bg-white dark:bg-white/[0.02] border-slate-200 dark:border-white/10 hover:border-slate-300 dark:hover:border-white/20"
                      }`}
                    >
                      {/* Top Badge */}
                      {plan.badge && (
                        <div
                          className="badge-solid-primary pricing-card-badge absolute -top-2.5 right-3 px-2 py-0.5 rounded-full bg-gradient-to-r from-indigo-600 to-violet-600 !text-white text-[10px] font-black tracking-wider shadow-sm"
                          style={{ color: "#ffffff" }}
                        >
                          <span className="!text-white" style={{ color: "#ffffff" }}>{plan.badge}</span>
                        </div>
                      )}

                      <div className="space-y-1 mb-3">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-black text-slate-900 dark:text-white">{plan.name}</span>
                          {isSelected && (
                            <span className="material-symbols-outlined text-indigo-600 dark:text-primary text-base">
                              check_circle
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-on-surface-variant/60 line-clamp-1">
                          {plan.subtitle}
                        </p>
                      </div>

                      <div className="my-2 flex items-baseline gap-1.5">
                        <span className="text-xs text-indigo-600 dark:text-primary font-bold">¥</span>
                        <span className="text-2xl font-black text-slate-900 dark:text-white font-label-mono">
                          {plan.price}
                        </span>
                        <span className="text-xs text-slate-400 dark:text-on-surface-variant/40">
                          / {plan.cycleLabel}
                        </span>
                        {plan.originalPrice && (
                          <span className="text-[11px] text-slate-400 line-through ml-1">
                            ¥{plan.originalPrice}
                          </span>
                        )}
                      </div>

                      {/* Mini Feature List */}
                      <div className="pt-2 border-t border-slate-100 dark:border-white/5 space-y-1 text-[11px] text-slate-600 dark:text-on-surface-variant/80">
                        {plan.features.slice(0, 3).map((f) => (
                          <div key={f.key} className="flex items-center justify-between">
                            <span className="flex items-center gap-1">
                              <span className="material-symbols-outlined text-[13px] text-slate-400 dark:text-on-surface-variant/50">
                                {f.icon}
                              </span>
                              {f.name}
                            </span>
                            <span className="font-bold text-slate-900 dark:text-white">
                              {f.value} {f.unit}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Selected Plan Details & Full 5 Quotas */}
              {currentPlan && (
                <div className="p-4 sm:p-5 rounded-2xl bg-slate-50 dark:bg-white/[0.02] border border-slate-200/80 dark:border-white/5 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="text-xs font-bold text-indigo-600 dark:text-primary uppercase tracking-wider">
                        选定档位特权清单
                      </span>
                      <h4 className="text-base font-black text-slate-900 dark:text-white mt-0.5">
                        {currentPlan.name} · 配额详情
                      </h4>
                    </div>
                    <span className="text-xs px-2.5 py-1 rounded-full bg-slate-200/70 dark:bg-white/10 text-slate-700 dark:text-on-surface-variant font-bold">
                      {currentPlan.category === "subscription" ? "有效期满后按新周期生效 · 续费自动顺延" : "永久有效 · 额度随用随抵"}
                    </span>
                  </div>

                  {/* 5项配额条目 */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
                    {currentPlan.features.map((item) => (
                      <div
                        key={item.key}
                        className={`p-2.5 rounded-xl border text-left transition-all ${
                          item.highlight
                            ? "bg-indigo-50/50 dark:bg-primary/5 border-indigo-200 dark:border-primary/20"
                            : "bg-white dark:bg-white/[0.02] border-slate-200/60 dark:border-white/5"
                        }`}
                      >
                        <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-on-surface-variant/60">
                          <span className="material-symbols-outlined text-[15px] text-indigo-500 dark:text-primary">
                            {item.icon}
                          </span>
                          <span className="truncate">{item.name}</span>
                        </div>
                        <div className="mt-1 text-base font-black text-slate-900 dark:text-white font-label-mono">
                          {item.value} <span className="text-xs font-normal text-slate-500 dark:text-on-surface-variant/60">{item.unit}</span>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Perks list */}
                  <div className="pt-2 border-t border-slate-200/60 dark:border-white/5 flex flex-wrap gap-x-6 gap-y-1.5 text-xs text-slate-600 dark:text-on-surface-variant/80 font-medium">
                    {currentPlan.perks.map((p, idx) => (
                      <div key={idx} className="flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-xs text-emerald-500">check_circle</span>
                        <span>{p}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Payment Section */}
              <div className="p-4 sm:p-5 rounded-2xl bg-slate-100/60 dark:bg-white/[0.03] border border-slate-200/80 dark:border-white/5 flex flex-col md:flex-row items-center justify-between gap-4">
                {/* Payment channel selector (支付宝) */}
                <div className="flex items-center gap-3 w-full md:w-auto">
                  <span className="text-base font-bold text-slate-600 dark:text-on-surface-variant/60 shrink-0">支付渠道:</span>
                  <div
                    className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl border text-sm font-bold bg-sky-50 dark:bg-sky-500/10 border-sky-500 text-sky-700 dark:text-sky-400 shadow-sm"
                  >
                    <img src="/zhifubao.svg" alt="支付宝" className="w-4 h-4 object-contain shrink-0" />
                    <span>支付宝支付</span>
                  </div>
                </div>

                {/* Price & Checkout CTA */}
                <div className="flex items-center justify-between md:justify-end gap-4 w-full md:w-auto">
                  <div className="text-right">
                    <span className="text-[11px] text-slate-500 dark:text-on-surface-variant/50 block">实付应付金额</span>
                    <div className="flex items-baseline gap-1">
                      <span className="text-sm font-black text-indigo-600 dark:text-primary">¥</span>
                      <span className="text-2xl font-black text-slate-900 dark:text-white font-label-mono">
                        {currentPlan.price}
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={isCreatingOrder}
                    onClick={handleStartPay}
                    className="btn-solid-primary pay-checkout-btn px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-black text-sm transition-all shadow-md shadow-indigo-600/25 active:scale-95 cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
                  >
                    <span className={`material-symbols-outlined text-sm text-white ${isCreatingOrder ? "animate-spin" : ""}`}>
                      {isCreatingOrder ? "sync" : "lock"}
                    </span>
                    <span className="text-white font-black">
                      {isCreatingOrder ? "正在生成订单..." : "立即开通支付"}
                    </span>
                  </button>
                </div>
              </div>

            </div>

            {/* QR Code Popup Modal */}
            <AnimatePresence>
              {showQrCode && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
                  {/* Popup Backdrop */}
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onClick={closeQrCode}
                    className="absolute inset-0 bg-slate-900/40 dark:bg-black/60 backdrop-blur-sm"
                  />

                  {/* Popup Dialog */}
                  <motion.div
                    initial={{ opacity: 0, scale: 0.9, y: 10 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.9, y: 10 }}
                    className="relative z-10 w-full max-w-sm max-h-[90vh] overflow-y-auto bg-white dark:bg-[#11192b] border border-slate-200 dark:border-white/10 rounded-3xl shadow-2xl p-6 flex flex-col items-center"
                  >
                    {/* Close Button */}
                    <button
                      onClick={closeQrCode}
                      className="absolute top-4 right-4 w-8 h-8 rounded-full bg-slate-100 dark:bg-white/5 flex items-center justify-center text-slate-500 dark:text-on-surface-variant/70 hover:bg-slate-200 dark:hover:bg-white/10 hover:text-slate-800 dark:hover:text-white transition-colors cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-sm">close</span>
                    </button>

                    {/* Header */}
                    <div className="flex items-center gap-2 mb-2">
                      <img src="/zhifubao.svg" alt="支付宝" className="w-5 h-5 object-contain" />
                      <h3 className="text-lg font-black text-slate-900 dark:text-white">支付宝扫码支付</h3>
                    </div>
                    
                    <div className="flex items-baseline gap-1 mb-5">
                      <span className="text-sm font-black text-indigo-600 dark:text-primary">¥</span>
                      <span className="text-3xl font-black text-slate-900 dark:text-white font-label-mono">
                        {currentPlan.price}
                      </span>
                    </div>

                    {/* QR Code Container */}
                    <div className="p-3 bg-white rounded-2xl shadow-inner border border-slate-200 mb-5 relative">
                      <div className="w-48 h-48 bg-white flex flex-col items-center justify-center rounded-xl overflow-hidden">
                        {qrCodeUrl ? (
                          <>
                            {!isQrLoaded && (
                              <div className="absolute inset-0 flex flex-col items-center justify-center p-2 text-slate-400 bg-white z-10 rounded-xl">
                                <span className="material-symbols-outlined text-3xl animate-spin">sync</span>
                                <span className="text-xs mt-2 font-medium">加载二维码中...</span>
                              </div>
                            )}
                            <img
                              src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&margin=4&data=${encodeURIComponent(qrCodeUrl)}`}
                              alt="支付宝支付二维码"
                              className={`w-44 h-44 object-contain transition-opacity duration-300 ${isQrLoaded ? "opacity-100" : "opacity-0"}`}
                              onLoad={() => setIsQrLoaded(true)}
                            />
                          </>
                        ) : (
                          <div className="flex flex-col items-center justify-center p-2 text-slate-400">
                            <span className="material-symbols-outlined text-3xl animate-spin">sync</span>
                            <span className="text-xs mt-2 font-medium">生成订单中...</span>
                          </div>
                        )}
                      </div>
                    </div>

                    <p className="text-xs text-slate-600 dark:text-on-surface-variant/80 font-bold mb-5">
                      请使用手机支付宝扫一扫完成支付
                    </p>

                    {/* 校验失败的提示必须落在这一层浮层里。主弹窗里那处 errorMessage
                        被这个 z-[60] 的二维码浮层整块盖住，用户在扫码弹窗里点「我已完成
                        支付」时看不到任何反馈。 */}
                    {errorMessage && (
                      <motion.div
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="w-full mb-4 p-3 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400 text-xs font-semibold flex items-start gap-2 text-left"
                      >
                        <span className="material-symbols-outlined text-base shrink-0">error</span>
                        <span>{errorMessage}</span>
                      </motion.div>
                    )}

                    <button
                      type="button"
                      disabled={isProcessing || paySuccess}
                      onClick={handleVerifyPayment}
                      className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-sm transition-all shadow-md shadow-emerald-600/25 active:scale-95 cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {paySuccess ? (
                        <>
                          <span className="material-symbols-outlined text-base">check_circle</span>
                          <span>支付成功！</span>
                        </>
                      ) : isProcessing ? (
                        <>
                          <span className="material-symbols-outlined text-base animate-spin">sync</span>
                          <span>正在校验支付结果...</span>
                        </>
                      ) : (
                        <span>我已完成支付</span>
                      )}
                    </button>

                    {orderNo && (
                      <p className="text-[10px] text-slate-400 dark:text-on-surface-variant/40 font-mono mt-4">
                        订单编号: {orderNo}
                      </p>
                    )}
                    
                    {qrCodeUrl && qrCodeUrl.includes("mock_") && (
                      <div className="mt-2">
                        <button
                          type="button"
                          onClick={handleDevSimulatePay}
                          className="text-[11px] text-indigo-500 hover:text-indigo-600 underline font-medium cursor-pointer"
                        >
                          [开发联调: 模拟扫码已支付]
                        </button>
                      </div>
                    )}
                  </motion.div>
                </div>
              )}
            </AnimatePresence>

            {/* 独立错误弹窗：用于「二维码弹窗没开着」时的报错（下单失败等）。
                errorMessage 只有一份，显示在哪一层由 showQrCode 决定——
                二维码弹窗开着时错误属于那一层，走弹窗内的横幅。 */}
            <AnimatePresence>
              {errorMessage && !showQrCode && (
                <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onClick={() => setErrorMessage("")}
                    className="absolute inset-0 bg-slate-900/40 dark:bg-black/60 backdrop-blur-sm"
                  />
                  <motion.div
                    initial={{ opacity: 0, scale: 0.92, y: 8 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.92, y: 8 }}
                    className="relative z-10 w-full max-w-xs bg-white dark:bg-[#11192b] border border-slate-200 dark:border-white/10 rounded-3xl shadow-2xl p-5 flex flex-col items-center text-center"
                  >
                    <span className="material-symbols-outlined text-3xl text-rose-500 mb-2">error</span>
                    <div className="text-sm font-black text-slate-900 dark:text-white mb-1.5">操作未完成</div>
                    <p className="text-xs text-slate-600 dark:text-on-surface-variant/80 font-semibold leading-relaxed mb-4 break-words">
                      {errorMessage}
                    </p>
                    <button
                      type="button"
                      onClick={() => setErrorMessage("")}
                      className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-black text-sm transition-all active:scale-95 cursor-pointer"
                    >
                      知道了
                    </button>
                  </motion.div>
                </div>
              )}
            </AnimatePresence>

            {/* Footer Notice */}
            <div className="px-6 py-3 border-t border-slate-100 dark:border-white/5 bg-slate-50/50 dark:bg-white/[0.01] text-center text-xs text-slate-400 dark:text-on-surface-variant/40">
              购买即代表同意《用户服务协议》与《会员服务条款》· 遇到支付问题请联系官方客服
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
