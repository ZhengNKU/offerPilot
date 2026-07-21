"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "./AuthProvider";

/**
 * 全局法务弹窗（用户协议 / 隐私政策 / 联系我们）。
 *
 * 触发方式：在任意位置调用下面导出的 helper：
 *   - openLegalTerms()   弹出"用户服务协议"
 *   - openLegalPrivacy() 弹出"隐私政策"
 *   - openLegalContact() 弹出"联系我们"
 *
 * 实现原理：在 window 上 dispatch 自定义事件，LegalModals 内部 useEffect 监听并 setState。
 * 之所以不走 React Context：跨路由切换 / 同页面多个调用方都直接调 helper 即可，
 * 不需要在每个文件里再 import 一个 useLegalModals()。
 *
 * 在 layout.tsx 里挂载一次即可（全局共享同一组 modal 实例）。
 */

// ─── 静态文案（与原 page.tsx 完全一致，2026-06-04 版本）────────────────────

const agreementMarkdown = `欢迎您使用 面试VAR AI 面试教练系统（以下简称"本服务"）。本协议由您与 面试VAR 运营团队共同缔结。在注册或开始使用本服务前，请您务必仔细阅读并理解本《用户服务协议》。

## 一、 服务内容与规则
1. **服务定位**：面试VAR 是一款 AI 驱动的面试智能分析及职业成长辅助系统，主要为您提供简历深度分析、面试录音/记录分析、AI 模拟面试场景训练以及 Offer 概率预测等服务。
2. **免责声明**：您理解并同意，本服务生成的评估数据、分析结果、STAR 优化话术等内容均为 AI 模型根据您提供的信息推理得出，仅供您的求职参考，我们不保证其绝对的准确性、完整性或对最终面试结果的保证性。

## 二、 账户注册与安全
1. **信息真实性**：您在注册本服务时应当提供真实、合法、有效的个人账户资料（包括但不限于手机号、邮箱、用户名等）。
2. **账户保管**：您有责任妥善保管您的登录密码与账号安全，凡是以您账户名义进行的操作，均视为您本人之行为。您不得将账户以任何形式转让、借用或售卖给第三方使用。

## 三、 用户行为规范
在使用本服务时，您承诺遵守国家法律法规，不得利用本服务进行以下行为：
* 上传或粘贴包含虚假、欺诈、恶意诽谤、侵犯他人隐私或知识产权的内容；
* 录制并上传包含国家机密、商业机密、他人敏感隐私等违反保密义务的面试音频；
* 恶意攻击、破解、逆向工程本服务后台系统，或者干扰其他用户的正常使用。

## 四、 服务的修改与终止
面试VAR 有权根据系统维护、AI 模型迭代或业务调整需要，对本服务的部分或全部内容进行优化、升级、暂停或终止。您可以在职业驾驶舱中随时注销并删除您的账号，注销后我们将立即抹除您的所有关联数据。`;

const privacyMarkdown = `我们非常重视您的隐私。本《隐私政策》详细说明了 面试VAR 在您使用我们的服务时，如何收集、使用、存储 和 保护您的个人信息。

## 一、 我们如何收集和使用信息
1. **基本账号信息**：当您注册本服务时，我们将收集您的手机号码或邮箱，用于身份认证和账号创建。
2. **职业背景与求职期望**：我们将收集您的工作年限、当前岗位、目标薪资、教育背景等数据。这些数据将仅用于为您的简历分析、STAR 重写、JD 匹配以及 Offer 预测建立个性化画像模型。
3. **面试音频与对话记录**：当您上传面试录音、粘贴面试文本时，我们将收集这些音频或文字信息。我们通过底层脱敏算法自动识别并抹去姓名、企业等显著敏感词，仅对其核心的技术问答、表达逻辑等进行技术性评估推理。

## 二、 信息安全与存储保护
1. **数据脱敏**：我们在模型输入层引入本地脱敏逻辑，全力防止您的敏感身份数据传输到外部的大语言模型接口。
2. **安全存储**：您的所有个人数据都经过高强度 SSL 加密传输，并进行安全数据库存储。
3. **绝不泄露**：我们承诺绝不会将您的个人简历、音频、对话及评估分析报告出售、转让或授权给任何无关的第三方企业或机构。

## 三、 您的权利与数据清除
您对您的个人数据拥有绝对的控制权。您可以在"职业驾驶舱 - 账号与安全"中，随时查看、修改您的基本职业档案，或者直接点击"注销账号"。账号注销属于不可逆操作，注销后我们的数据库将立即彻底清空并永久抹去您的所有关联数据和历史分析报告。`;

const CONTACT_EMAIL = "interviewvar@163.com";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderMarkdown(md: string): string {
  let html = escapeHtml(md);

  // Headers
  html = html.replace(/^### (.*?)$/gm, '<h5 class="text-white font-extrabold text-sm mt-4 mb-2">$1</h5>');
  html = html.replace(/^## (.*?)$/gm, '<h4 class="text-white font-black text-base mt-5 mb-2.5">$1</h4>');
  html = html.replace(/^# (.*?)$/gm, '<h3 class="text-white font-black text-lg mt-6 mb-3">$1</h3>');

  // Bold
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong class="text-white font-extrabold">$1</strong>');

  // Lists (●/* / -)
  html = html.replace(/^● (.*?)$/gm, '<li class="ml-4 list-disc text-white/70 mt-1">$1</li>');
  html = html.replace(/^[-\*] (.*?)$/gm, '<li class="ml-4 list-disc text-white/70 mt-1">$1</li>');

  // Paragraphs (only wrap lines that aren't already structural)
  const lines = html.split("\n");
  const processed = lines.map((line) => {
    const t = line.trim();
    if (!t) return "";
    if (t.startsWith("<h") || t.startsWith("<li")) return line;
    return `<p class="mb-3 text-white/70 leading-relaxed">${line}</p>`;
  });
  return processed.join("\n");
}

// ─── 事件常量与 helper ──────────────────────────────────────────────────────

const EVT_TERMS = "legal:open-terms";
const EVT_PRIVACY = "legal:open-privacy";
const EVT_CONTACT = "legal:open-contact";

export const openLegalTerms = () => window.dispatchEvent(new Event(EVT_TERMS));
export const openLegalPrivacy = () => window.dispatchEvent(new Event(EVT_PRIVACY));
export const openLegalContact = () => window.dispatchEvent(new Event(EVT_CONTACT));

// ─── 组件本体 ──────────────────────────────────────────────────────────────

export default function LegalModals() {
  const auth = useAuth();
  const [showTerms, setShowTerms] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [showContact, setShowContact] = useState(false);

  useEffect(() => {
    const onTerms = () => setShowTerms(true);
    const onPrivacy = () => setShowPrivacy(true);
    const onContact = () => setShowContact(true);
    window.addEventListener(EVT_TERMS, onTerms);
    window.addEventListener(EVT_PRIVACY, onPrivacy);
    window.addEventListener(EVT_CONTACT, onContact);
    return () => {
      window.removeEventListener(EVT_TERMS, onTerms);
      window.removeEventListener(EVT_PRIVACY, onPrivacy);
      window.removeEventListener(EVT_CONTACT, onContact);
    };
  }, []);

  const closeTerms = () => setShowTerms(false);
  const closePrivacy = () => setShowPrivacy(false);
  const closeContact = () => setShowContact(false);

  return (
    <>
      {/* USER AGREEMENT MODAL */}
      <AnimatePresence>
        {showTerms && (
          <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
            <div
              onClick={closeTerms}
              className="absolute inset-0 bg-[#050B1A]/85 backdrop-blur-md transition-opacity duration-300"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-[#0e1626]/95 border border-white/10 rounded-3xl p-8 max-w-2xl w-full text-left relative z-10 space-y-6 shadow-2xl max-h-[80vh] flex flex-col"
            >
              <div className="flex justify-between items-center pb-3 border-b border-white/5">
                <span className="font-label-mono text-[10px] text-[#AFA7FF] tracking-widest uppercase font-bold">
                  面试VAR User Agreement
                </span>
                <button
                  onClick={closeTerms}
                  className="text-white/40 hover:text-white transition-colors cursor-pointer"
                >
                  <span className="material-symbols-outlined text-lg">close</span>
                </button>
              </div>

              <div className="space-y-1">
                <h3 className="font-extrabold text-white text-lg">面试VAR 用户服务协议</h3>
                <p className="text-white/45 text-xs">更新日期：2026年6月4日</p>
              </div>

              <div
                className="flex-1 overflow-y-auto pr-2 custom-scrollbar"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(agreementMarkdown) }}
              />

              <div className="pt-4 border-t border-white/5 flex justify-end">
                <button
                  onClick={closeTerms}
                  className="px-6 py-2 bg-white/5 border border-white/10 text-white font-bold rounded-xl text-xs md:text-sm hover:bg-white/10 active:scale-98 transition-all cursor-pointer flex items-center justify-center"
                >
                  关闭
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* PRIVACY POLICY MODAL */}
      <AnimatePresence>
        {showPrivacy && (
          <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
            <div
              onClick={closePrivacy}
              className="absolute inset-0 bg-[#050B1A]/85 backdrop-blur-md transition-opacity duration-300"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-[#0e1626]/95 border border-white/10 rounded-3xl p-8 max-w-2xl w-full text-left relative z-10 space-y-6 shadow-2xl max-h-[80vh] flex flex-col"
            >
              <div className="flex justify-between items-center pb-3 border-b border-white/5">
                <span className="font-label-mono text-[10px] text-[#AFA7FF] tracking-widest uppercase font-bold">
                  面试VAR Privacy Policy
                </span>
                <button
                  onClick={closePrivacy}
                  className="text-white/40 hover:text-white transition-colors cursor-pointer"
                >
                  <span className="material-symbols-outlined text-lg">close</span>
                </button>
              </div>

              <div className="space-y-1">
                <h3 className="font-extrabold text-white text-lg">面试VAR 用户隐私政策</h3>
                <p className="text-white/45 text-xs">更新日期：2026年6月4日</p>
              </div>

              <div
                className="flex-1 overflow-y-auto pr-2 custom-scrollbar"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(privacyMarkdown) }}
              />

              <div className="pt-4 border-t border-white/5 flex justify-end">
                <button
                  onClick={closePrivacy}
                  className="px-6 py-2 bg-white/5 border border-white/10 text-white font-bold rounded-xl text-xs md:text-sm hover:bg-white/10 active:scale-98 transition-all cursor-pointer flex items-center justify-center"
                >
                  关闭
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* CONTACT US MODAL */}
      <AnimatePresence>
        {showContact && (
          <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
            <div
              onClick={closeContact}
              className="absolute inset-0 bg-[#050B1A]/80 backdrop-blur-md transition-opacity duration-300"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-[#0e1626]/95 border border-white/10 rounded-3xl p-8 max-w-md w-full text-center relative z-10 space-y-6 shadow-2xl flex flex-col"
            >
              <div className="flex justify-between items-center pb-3 border-b border-white/5">
                <span className="font-label-mono text-[10px] text-[#AFA7FF] tracking-widest uppercase font-bold">
                  Contact Us
                </span>
                <button
                  onClick={closeContact}
                  className="text-white/40 hover:text-white transition-colors cursor-pointer"
                >
                  <span className="material-symbols-outlined text-lg">close</span>
                </button>
              </div>

              <div className="space-y-4">
                <div className="w-16 h-16 mx-auto rounded-2xl bg-primary/15 border border-primary/30 flex items-center justify-center shadow-[0_0_35px_rgba(192,193,255,0.25)]">
                  <span className="material-symbols-outlined !text-4xl text-primary">mail</span>
                </div>

                <div className="space-y-2">
                  <h3 className="font-extrabold text-white text-xl">联系我们</h3>
                  <p className="text-sm text-on-surface-variant/70 font-semibold leading-relaxed">
                    如果您在使用过程中遇到任何问题，或有商业合作意向，欢迎通过邮件与我们取得联系。
                  </p>
                </div>

                <div className="flex items-center justify-center gap-2 py-2">
                  <span className="text-lg font-bold text-white select-all">
                    {CONTACT_EMAIL}
                  </span>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(CONTACT_EMAIL);
                      auth.triggerToast("产品联系邮箱已复制到剪贴板！");
                    }}
                    className="text-[#AFA7FF] hover:text-white transition-colors cursor-pointer flex items-center justify-center p-1.5 rounded-lg hover:bg-white/5 active:scale-95"
                    title="复制邮箱"
                  >
                    <span className="material-symbols-outlined text-lg">content_copy</span>
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}