"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth, UserMenu } from "@/components/AuthProvider";

export default function NewAnalysisDebugger() {
  const router = useRouter();
  const auth = useAuth();

  // Active input mode
  const [activeMode, setActiveMode] = useState<"audio" | "text" | "resume">("audio");
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // Audio/Dialogue context fields - ALL TEXT INPUTS except onJob and date (Defaulted to empty)
  const [audioForm, setAudioForm] = useState({
    isOnJob: "yes",
    years: "",
    company: "",
    role: "",
    round: "",
    date: "2026-05-31",
    grade: "",
    salary: ""
  });

  // Resume context fields - ALL TEXT INPUTS except onJob (Defaulted to empty)
  const [resumeForm, setResumeForm] = useState({
    isOnJob: "yes",
    years: "",
    prevCompany: "",
    prevRole: "",
    prevYears: "",
    prevSalary: "",
    targetCompany: "",
    targetRole: "",
    targetGrade: "",
    targetSalary: ""
  });

  // Paste Text dialogues
  const [pasteText, setPasteText] = useState("");

  const handleInterceptAction = () => {
    auth.setShowLogin(true);
  };

  // Pre-load templates
  const loadFailTemplate = () => {
    setPasteText(
      `面试官：请介绍一下你上一个项目的技术架构。\n` +
      `我：项目是分布式的，使用了Redis和Kafka进行微服务解耦。\n` +
      `面试官：为什么在这里选择使用分布式锁？高并发下一致性怎么保证？\n` +
      `我：嗯...我们采用了分布式缓存，然后通过一种补偿机制来确保失败重试。`
    );
  };

  // Launch analysis and save context to localStorage
  const triggerAnalysis = () => {
    setIsAnalyzing(true);
    
    // Save to localStorage so report page is synced dynamically
    localStorage.setItem("offerPilot_report_mode", activeMode);
    if (activeMode === "resume") {
      localStorage.setItem("offerPilot_session_company", "腾讯/美团等 (目标)");
      localStorage.setItem("offerPilot_session_role", "高级后端专家");
      localStorage.setItem("offerPilot_session_years", "3-5年");
      localStorage.setItem("offerPilot_session_round", "简历智能筛选");
      localStorage.setItem("offerPilot_session_date", "2026-06-01");
      localStorage.setItem("offerPilot_session_grade", "L8 / P7");
      localStorage.setItem("offerPilot_session_salary", "35K-45K");
    } else {
      localStorage.setItem("offerPilot_session_company", audioForm.company || "字节跳动");
      localStorage.setItem("offerPilot_session_role", audioForm.role || "后端开发工程师");
      localStorage.setItem("offerPilot_session_years", "3-5年");
      localStorage.setItem("offerPilot_session_round", audioForm.round || "二面 - 技术面");
      localStorage.setItem("offerPilot_session_date", audioForm.date || "2026-05-31");
      localStorage.setItem("offerPilot_session_grade", audioForm.grade || "P6 / L5");
      localStorage.setItem("offerPilot_session_salary", audioForm.salary || "25K * 16薪");
      if (activeMode === "text") {
        localStorage.setItem("offerPilot_session_pasteText", pasteText);
      }
    }

    localStorage.setItem("offerPilot_viewing_session", "true");

    setTimeout(() => {
      setIsAnalyzing(false);
      if (activeMode === "audio") {
        router.push("/debugger/voice");
      } else if (activeMode === "text") {
        router.push("/debugger/record");
      } else {
        router.push("/debugger/resume");
      }
    }, 1500);
  };

  return (
    <main className="pt-20 bg-background text-on-surface select-none min-h-screen flex flex-col justify-between relative overflow-hidden pb-4">
      {/* Absolute Ambient Halo */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[800px] h-[800px] bg-primary/5 rounded-full blur-[140px] -z-10 pointer-events-none"></div>

      {/* Top Header Navbar */}
      <nav className="fixed top-0 w-full z-40 bg-surface/80 backdrop-blur-xl border-b border-white/10">
        <div className="flex justify-between items-center h-20 px-gutter max-w-container-max mx-auto w-full relative">
          <div
            onClick={() => router.push("/")}
            className="text-2xl font-display-xl font-bold tracking-tight text-on-surface flex items-center gap-2 cursor-pointer"
          >
            <svg className="w-7 h-7" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L20 7V17L12 22L4 17V7L12 2Z" fill="url(#nav-brand-logo)" />
              <path d="M12 6L16 11H13V18L12 18L11 18V13H8L12 6Z" fill="#0b1326" />
              <defs>
                <linearGradient id="nav-brand-logo" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#c0c1ff" />
                  <stop offset="100%" stopColor="#ffb2b7" />
                </linearGradient>
              </defs>
            </svg>
            OfferPilot
          </div>

          <div className="absolute left-1/2 -translate-x-1/2 hidden md:flex items-center gap-8">
            <a onClick={() => router.push("/debugger")} className="text-primary transition-colors text-[16px] md:text-[17px] font-extrabold cursor-pointer relative after:content-[''] after:absolute after:bottom-[-26px] after:left-0 after:right-0 after:h-[2px] after:bg-primary">
              面试调试器
            </a>
            <a onClick={() => router.push("/memory")} className="text-on-surface-variant hover:text-on-surface transition-colors text-[16px] md:text-[17px] font-extrabold cursor-pointer">
              职业记忆看板
            </a>
            <a onClick={() => router.push("/training")} className="text-on-surface-variant hover:text-on-surface transition-colors text-[16px] md:text-[17px] font-extrabold cursor-pointer">
              面试训练场
            </a>
            <a onClick={() => router.push("/home")} className="text-on-surface-variant hover:text-on-surface transition-colors text-[16px] md:text-[17px] font-extrabold cursor-pointer">
              职业驾驶舱
            </a>
            <a onClick={() => router.push("/")} className="text-on-surface-variant hover:text-on-surface transition-colors text-[16px] md:text-[17px] font-extrabold cursor-pointer">
              案例
            </a>
          </div>

          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push("/memory?tab=timeline")}
              className="px-4.5 py-2 bg-white/5 border border-white/10 rounded-full text-sm font-bold text-on-surface hover:bg-white/10 transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <span className="material-symbols-outlined text-base">history</span>历史记录
            </button>
            {auth.isLoggedIn ? (
              <UserMenu />
            ) : (
              <>
                <button
                  onClick={handleInterceptAction}
                  className="px-6 py-2 text-on-surface-variant hover:text-on-surface transition-colors font-medium cursor-pointer"
                >
                  登录
                </button>
                <button
                  onClick={() => router.push("/register")}
                  className="px-6 py-2 bg-primary text-on-primary font-bold rounded-full scale-95 hover:scale-100 active:scale-95 transition-all shadow-[0_0_20px_rgba(192,193,255,0.3)] cursor-pointer"
                >
                  免费开始
                </button>
              </>
            )}
          </div>
        </div>
      </nav>

      {/* Main Workspace Frame */}
      <div className="flex-1 max-w-container-max mx-auto w-full px-gutter py-8 grid md:grid-cols-12 gap-6 items-stretch relative z-10">
        
        {/* COLUMN 1: SIDE SWITCHER */}
        <div className="md:col-span-3 flex flex-col justify-between space-y-6">
          <div className="p-6 rounded-3xl bg-surface-container-low border border-white/5 flex flex-col justify-between h-full space-y-6">
            
            <div className="space-y-6">
              <div className="pb-4 border-b border-white/5 text-left">
                <h3 className="font-black text-white text-lg md:text-xl">新建分析</h3>
                <span className="text-xs font-label-mono text-on-surface-variant/50">Session #New</span>
              </div>

              {/* 分析方式 Switcher (Multi-color vibrant icons scheme) */}
              <div className="space-y-3 text-left">
                <h4 className="text-xs md:text-sm text-on-surface-variant/40 font-label-mono uppercase tracking-widest font-extrabold mb-3">
                  分析方式
                </h4>
                {[
                  { mode: "audio", icon: "graphic_eq", title: "面试录音分析", desc: "上传音频，AI转写并分析表达与逻辑", color: "primary" },
                  { mode: "text", icon: "edit_document", title: "面试记录分析", desc: "粘贴面试对话，AI分析问题与漏洞", color: "secondary" },
                  { mode: "resume", icon: "description", title: "简历深度分析", desc: "上传简历，AI诊断并优化简历内容", color: "tertiary" }
                ].map((item, idx) => {
                  const isActive = activeMode === item.mode;
                  const activeBorderClass = 
                    item.color === "primary" ? "border-primary bg-primary/10 shadow-[0_0_15px_rgba(192,193,255,0.08)]" : 
                    item.color === "secondary" ? "border-secondary bg-secondary/10 shadow-[0_0_15px_rgba(255,178,183,0.08)]" : 
                    "border-tertiary bg-tertiary/10 shadow-[0_0_15px_rgba(78,222,163,0.08)]";

                  const activeIconBgClass = 
                    item.color === "primary" ? "bg-primary text-on-primary" : 
                    item.color === "secondary" ? "bg-secondary text-on-secondary" : 
                    "bg-tertiary text-on-tertiary";

                  const activeIconColor = 
                    item.color === "primary" ? "text-primary" : 
                    item.color === "secondary" ? "text-secondary" : 
                    "text-tertiary";

                  return (
                    <div
                      key={idx}
                      onClick={() => setActiveMode(item.mode as any)}
                      className={`p-4 rounded-2xl border text-left cursor-pointer transition-all duration-300 flex items-center gap-3.5 relative overflow-hidden group ${
                        isActive ? activeBorderClass : "border-white/5 bg-white/[0.02] hover:bg-white/5"
                      }`}
                    >
                      <div
                        className={`w-11 h-11 rounded-xl flex items-center justify-center transition-colors flex-shrink-0 ${
                          isActive ? activeIconBgClass : `bg-white/5 ${activeIconColor}`
                        }`}
                      >
                        <span className="material-symbols-outlined text-xl">{item.icon}</span>
                      </div>
                      <div>
                        <h5 className="font-extrabold text-sm md:text-base text-white">{item.title}</h5>
                        <p className="text-xs text-on-surface-variant/60 mt-1 font-medium leading-relaxed">{item.desc}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* (Bottom-left PRO Upgrade banner removed as requested) */}

          </div>
        </div>

        {/* COLUMNS 4-12: PRE-ANALYSIS FORMS CANVAS */}
        <div className="md:col-span-9 flex flex-col justify-between">
          <div className="glass-panel p-8 rounded-3xl border-white/10 h-full flex flex-col justify-between text-left relative overflow-hidden">
            {/* Simulated Glow Loading Layer */}
            {isAnalyzing && (
              <div className="absolute inset-0 z-50 bg-background/90 backdrop-blur-xl flex flex-col justify-center items-center">
                <div className="w-16 h-16 rounded-full border-4 border-primary/20 border-t-primary animate-spin mb-4" />
                <h3 className="font-extrabold text-white text-lg animate-pulse">OfferPilot 正在进行 AI 深度分析...</h3>
                <p className="text-xs text-on-surface-variant/60 mt-1">转写音频频带、提取面试逻辑雷区、重塑专业架构语言</p>
              </div>
            )}

            <div className="space-y-6">
              {/* Header section */}
              <div className="flex justify-between items-center pb-4 border-b border-white/5">
                <div>
                  <span className="text-[10px] font-label-mono tracking-widest text-primary font-bold uppercase">
                    New Analysis Panel
                  </span>
                  <h2 className="text-2xl font-black text-white mt-1">
                    {activeMode === "audio"
                      ? "面试录音深度分析"
                      : activeMode === "text"
                      ? "面试记录深度分析"
                      : "简历风险雷区深度检测"}
                  </h2>
                </div>

                <div className="px-3.5 py-1.5 rounded bg-primary/10 border border-primary/20 text-primary font-label-mono text-sm font-bold uppercase animate-pulse">
                  免费体验剩余：1次
                </div>
              </div>

              {/* Upload drag drop areas */}
              {activeMode !== "text" ? (
                <div
                  onClick={handleInterceptAction}
                  className="border-2 border-dashed border-white/10 hover:border-primary/50 hover:bg-white/[0.01] py-20 md:py-28 rounded-2xl flex flex-col items-center justify-center text-center cursor-pointer transition-all duration-300 min-h-[380px] group"
                >
                  <div className="w-24 h-24 rounded-3xl bg-primary/10 group-hover:scale-110 transition-transform text-primary flex items-center justify-center mb-6">
                    <span className="material-symbols-outlined" style={{ fontSize: "56px" }}>
                      {activeMode === "audio" ? "cloud_upload" : "folder_zip"}
                    </span>
                  </div>
                  <h4 className="font-extrabold text-white text-base md:text-lg mb-2">
                    {activeMode === "audio" ? "拖拽录音文件到此处，或点击浏览上传" : "拖拽简历文档到此处，或点击浏览上传"}
                  </h4>
                  <p className="text-xs md:text-sm text-on-surface-variant/60">
                    {activeMode === "audio" ? "支持 mp3, wav, m4a 格式，最大 500MB (时长限10分钟)" : "支持 PDF, DOCX 格式，最大 20MB"}
                  </p>
                </div>
              ) : (
                /* paste transcript area */
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <label className="text-xs text-on-surface-variant/80 font-bold">
                      请在下方输入框粘贴或填写您的真实面试对话日志：
                    </label>
                    <button
                      onClick={loadFailTemplate}
                      className="text-xs text-primary font-bold cursor-pointer flex items-center gap-1"
                    >
                      <span className="material-symbols-outlined text-xs">bolt</span>载入经典失败分析模板
                    </button>
                  </div>
                  <textarea
                    value={pasteText}
                    onChange={(e) => setPasteText(e.target.value)}
                    placeholder="面试官：请问你们的系统是怎么做微服务架构解耦的？&#10;我：就是简单用了一个消息队列，人工对账补数据..."
                    className="w-full h-56 bg-surface-container-low border border-white/5 rounded-2xl p-4 font-mono text-sm text-on-surface focus:outline-none focus:border-primary/40 transition-all leading-relaxed min-h-[220px]"
                  />
                </div>
              )}

              {/* Pre-Analysis Form (ALL TEXT INPUTS except Date and IsOnJob) */}
              {activeMode !== "resume" && (
                <div className="p-6 rounded-2xl bg-surface-container/50 border border-white/5 space-y-4">
                  <h4 className="text-xs text-primary font-label-mono uppercase tracking-widest font-extrabold mb-3">
                    分析前填写面试信息 (*必填)
                  </h4>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs font-semibold text-on-surface-variant">
                    <div>
                      <label className="block mb-2">面试公司名称 *</label>
                      <input
                        type="text"
                        placeholder="如 字节跳动"
                        value={audioForm.company}
                        onChange={(e) => setAudioForm({ ...audioForm, company: e.target.value })}
                        className="w-full py-3 px-4 bg-white/5 border border-white/10 rounded-xl text-white placeholder-on-surface-variant/30 focus:outline-none focus:border-primary/40 h-12 text-xs md:text-sm"
                      />
                    </div>

                    <div>
                      <label className="block mb-2">岗位名称 *</label>
                      <input
                        type="text"
                        placeholder="如 后端开发工程师"
                        value={audioForm.role}
                        onChange={(e) => setAudioForm({ ...audioForm, role: e.target.value })}
                        className="w-full py-3 px-4 bg-white/5 border border-white/10 rounded-xl text-white placeholder-on-surface-variant/30 focus:outline-none focus:border-primary/40 h-12 text-xs md:text-sm"
                      />
                    </div>

                    <div>
                      <label className="block mb-2">面试时间 *</label>
                      <input
                        type="date"
                        value={audioForm.date}
                        onChange={(e) => setAudioForm({ ...audioForm, date: e.target.value })}
                        className="w-full py-3 px-4 bg-white/5 border border-white/10 rounded-xl text-white focus:outline-none focus:border-primary/40 cursor-pointer h-12 text-xs md:text-sm"
                      />
                    </div>

                    <div>
                      <label className="block mb-2">面试轮次 *</label>
                      <input
                        type="text"
                        placeholder="如 二面 - 技术面"
                        value={audioForm.round}
                        onChange={(e) => setAudioForm({ ...audioForm, round: e.target.value })}
                        className="w-full py-3 px-4 bg-white/5 border border-white/10 rounded-xl text-white placeholder-on-surface-variant/30 focus:outline-none focus:border-primary/40 h-12 text-xs md:text-sm"
                      />
                    </div>

                    <div>
                      <label className="block mb-2">岗位职级 [选填]</label>
                      <input
                        type="text"
                        placeholder="如 P6 / L5"
                        value={audioForm.grade}
                        onChange={(e) => setAudioForm({ ...audioForm, grade: e.target.value })}
                        className="w-full py-3 px-4 bg-white/5 border border-white/10 rounded-xl text-white placeholder-on-surface-variant/30 focus:outline-none focus:border-primary/40 h-12 text-xs md:text-sm"
                      />
                    </div>

                    <div>
                      <label className="block mb-2">期望薪资 [选填]</label>
                      <input
                        type="text"
                        placeholder="如 25K * 16薪"
                        value={audioForm.salary}
                        onChange={(e) => setAudioForm({ ...audioForm, salary: e.target.value })}
                        className="w-full py-3 px-4 bg-white/5 border border-white/10 rounded-xl text-white placeholder-on-surface-variant/30 focus:outline-none focus:border-primary/40 h-12 text-xs md:text-sm"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            <button
              onClick={triggerAnalysis}
              className="w-full mt-6 py-4 bg-primary text-on-primary font-black rounded-2xl hover:scale-[1.01] active:scale-[0.99] transition-all flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-primary/20"
            >
              <span className="material-symbols-outlined text-sm">analytics</span>
              开始 AI 智能调试分析
            </button>
          </div>
        </div>

        {/* BOTTOM PRO CARD - FIGURE 3 STYLE */}
        <div className="col-span-12 mt-6 relative overflow-hidden rounded-3xl border border-white/10 bg-surface-container-low/60 backdrop-blur-xl p-6 md:py-8 md:px-10 flex flex-col md:flex-row justify-between items-center gap-6 shadow-2xl group min-h-[110px]">
          {/* Background Image Layer */}
          <div
            className="absolute inset-0 bg-cover bg-center opacity-35 pointer-events-none transition-all duration-500 group-hover:scale-105 animate-fade-in"
            style={{
              backgroundImage: "url('/debugger-1.jpg')",
              backgroundPosition: "center 75%",
              mixBlendMode: "overlay"
            }}
          />
          {/* Dark Gradient Overlay */}
          <div className="absolute inset-0 bg-gradient-to-r from-background via-background/80 to-transparent pointer-events-none" />

          <div className="relative z-10 text-left space-y-1.5 max-w-2xl">
            <h4 className="text-lg md:text-xl font-black text-white flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-primary animate-pulse" />
              准备好开启下一次面试了吗？
            </h4>
            <p className="text-xs md:text-sm text-on-surface-variant/70 leading-relaxed font-semibold">
              升级为 Pro 专家版，即可解除所有限制，解锁完整无限次音频分析、高级表达重塑配套逻辑图以及完整的面试成长轨迹档案。
            </p>
          </div>

          <div className="relative z-10 flex gap-4 w-full md:w-auto">
            <button
              onClick={handleInterceptAction}
              className="flex-1 md:flex-none px-5 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white font-extrabold text-xs md:text-sm hover:bg-white/10 active:scale-95 transition-all whitespace-nowrap cursor-pointer"
            >
              免费注册保存分析
            </button>
            <button
              onClick={handleInterceptAction}
              className="flex-1 md:flex-none px-6 py-2.5 bg-gradient-to-r from-primary to-secondary text-on-primary font-black text-xs md:text-sm rounded-xl hover:scale-[1.02] active:scale-98 transition-all whitespace-nowrap shadow-[0_0_20px_rgba(192,193,255,0.35)] cursor-pointer"
            >
              升级 Pro 会员 (¥39/月)
            </button>
          </div>
        </div>

      </div>

      {/* Footer */}
      <footer className="bg-surface-container-lowest border-t border-white/5 w-full block mt-8">
        <div className="px-gutter py-8 max-w-container-max mx-auto flex flex-col md:flex-row justify-between items-center gap-4 text-left">
          <div className="flex items-center gap-4">
            <span className="text-xs text-on-surface-variant font-label-mono font-bold tracking-widest">
              © 2024 OfferPilot AI. All rights reserved.
            </span>
          </div>
          <div className="flex gap-8 text-xs text-on-surface-variant font-label-mono font-bold tracking-widest animate-pulse">
            <a onClick={() => router.push("/")} className="hover:text-primary transition-colors cursor-pointer">
              返回主页
            </a>
            <a className="hover:text-primary transition-colors cursor-default" href="#">
              隐私政策
            </a>
            <a className="hover:text-primary transition-colors cursor-default" href="#">
              服务条款
            </a>
          </div>
        </div>
      </footer>

    </main>
  );
}
