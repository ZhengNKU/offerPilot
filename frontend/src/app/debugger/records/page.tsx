"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";

interface SessionHistoryItem {
  id: string;
  date: string;
  type: "audio" | "text" | "resume";
  title: string;
  score: number;
  grade: string;
  company: string;
  role: string;
  round: string;
  details: string;
}

const INITIAL_HISTORY: SessionHistoryItem[] = [
  {
    id: "session-1",
    date: "06-01 14:32",
    type: "audio",
    title: "Redis 深挖 · 技术面",
    score: 86,
    grade: "优秀候选人",
    company: "字节跳动",
    role: "后端开发工程师",
    round: "技术一面",
    details: "主攻Redis分布式锁、灰度一致性权衡。技术分扎实，但Saga补偿机制在技术细节深挖阶段出现了逻辑断层。"
  },
  {
    id: "session-2",
    date: "06-30 10:15",
    type: "text",
    title: "项目介绍 · 一面",
    score: 72,
    grade: "中级候选人",
    company: "阿里巴巴",
    role: "Java开发专家",
    round: "技术一面",
    details: "对高并发和高可用架构描述存在一定模糊性。AI判定核心痛点在于系统架构底座思维模糊，表达缺少Trade-off论证。"
  },
  {
    id: "session-3",
    date: "05-28 16:45",
    type: "text",
    title: "系统设计 · 二面",
    score: 68,
    grade: "待提升候选人",
    company: "腾讯",
    role: "后台开发工程师",
    round: "技术二面",
    details: "在秒杀高并发大题中，没解释为什么选择RabbitMQ而不是Kafka，表现出八股感，缺少系统架构思考能力。"
  },
  {
    id: "session-4",
    date: "06-25 09:10",
    type: "resume",
    title: "简历优化 · 后端开发",
    score: 82,
    grade: "优秀简历",
    company: "美团",
    role: "高级后端专家",
    round: "简历智能筛选",
    details: "简历主攻推荐系统与云原生落地图案。AI检索核心雷区在于量化指标不足，同时未突出个人作为主程Owner的角色定位。"
  }
];

export default function CareerMemoryDashboard() {
  const router = useRouter();

  // Active tab management: overview, timeline, projects, knowledge, weaknesses, growth, advisor
  const [activeTab, setActiveTab] = useState("overview");

  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const tab = params.get("tab");
      if (tab) {
        setActiveTab(tab);
      }
    }
  }, []);

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", tab);
      window.history.pushState(null, "", url.toString());
    }
  };

  const [searchQuery, setSearchQuery] = useState("");
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [activeCurveMonth, setActiveCurveMonth] = useState<number | null>(null);
  const [activeOfferMonth, setActiveOfferMonth] = useState<number | null>(null);
  const [searchSidebarQuery, setSearchSidebarQuery] = useState("");
  const [activeTimelineFilter, setActiveTimelineFilter] = useState("all");

  const handleInterceptAction = () => {
    setShowLoginModal(true);
  };

  const handleViewDetails = (item: SessionHistoryItem) => {
    localStorage.setItem("offerPilot_report_mode", item.type);
    localStorage.setItem("offerPilot_session_company", item.company);
    localStorage.setItem("offerPilot_session_role", item.role);
    localStorage.setItem("offerPilot_session_years", "3-5年");
    localStorage.setItem("offerPilot_session_round", item.round);
    localStorage.setItem("offerPilot_session_date", item.date.includes("202") ? item.date.split(" ")[0] : "2026-06-01");
    localStorage.setItem("offerPilot_session_grade", item.type === "resume" ? "L8 / P7" : "P6");
    localStorage.setItem("offerPilot_session_salary", item.type === "resume" ? "35K-45K" : "35-40K");
    
    router.push("/debugger/report");
  };

  // Main list filters
  const filteredHistory = INITIAL_HISTORY.filter(
    (item) =>
      item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.company.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.role.toLowerCase().includes(searchQuery.toLowerCase())
  );

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
            <a onClick={() => router.push("/debugger")} className="text-on-surface-variant hover:text-on-surface transition-colors text-[16px] md:text-[17px] font-extrabold cursor-pointer">
              面试调试器
            </a>
            <a onClick={() => handleTabChange("overview")} className="text-primary transition-colors text-[16px] md:text-[17px] font-extrabold cursor-pointer relative after:content-[''] after:absolute after:bottom-[-26px] after:left-0 after:right-0 after:h-[2px] after:bg-primary">
              职业记忆看板
            </a>
            <a onClick={() => router.push("/debugger/training")} className="text-on-surface-variant hover:text-on-surface transition-colors text-[16px] md:text-[17px] font-extrabold cursor-pointer">
              面试训练场
            </a>
            <a onClick={() => router.push("/debugger/report")} className="text-on-surface-variant hover:text-on-surface transition-colors text-[16px] md:text-[17px] font-extrabold cursor-pointer">
              职业驾驶舱
            </a>
            <a onClick={() => router.push("/")} className="text-on-surface-variant hover:text-on-surface transition-colors text-[16px] md:text-[17px] font-extrabold cursor-pointer">
              案例
            </a>
          </div>

          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push("/debugger")}
              className="px-4.5 py-2 bg-white/5 border border-white/10 rounded-full text-sm font-bold text-on-surface hover:bg-white/10 transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <span className="material-symbols-outlined text-base">add</span>新建分析
            </button>
            <button onClick={handleInterceptAction} className="px-6 py-2 text-on-surface-variant hover:text-on-surface transition-colors font-medium">
              登录
            </button>
            <button
              onClick={handleInterceptAction}
              className="px-6 py-2 bg-primary text-on-primary font-bold rounded-full scale-95 hover:scale-100 active:scale-95 transition-all shadow-[0_0_20px_rgba(192,193,255,0.35)]"
            >
              免费开始
            </button>
          </div>
        </div>
      </nav>

      {/* Main Workspace Frame */}
      <div className="flex-1 max-w-container-max mx-auto w-full px-gutter py-8 grid grid-cols-1 md:grid-cols-12 gap-6 items-stretch relative z-10">
        
        {/* ========================================================
            LEFT SIDEBAR: 职业记忆库 navigation
           ======================================================== */}
        <div className="col-span-12 md:col-span-3 lg:col-span-2.5 flex flex-col justify-between gap-6">
          <div className="glass-panel p-5 rounded-3xl border-white/10 flex flex-col gap-6 text-left h-full">
            <div>
              <span className="text-[10px] font-label-mono tracking-widest text-primary font-bold uppercase">
                Career Memory
              </span>
              <h3 className="text-xl font-black text-white mt-1">职业记忆库</h3>
            </div>

            {/* Navigation Tabs Menu */}
            <div className="flex flex-col gap-1.5 w-full">
              {[
                { id: "overview", label: "总览看板", icon: "dashboard" },
                { id: "timeline", label: "面试时间轴", icon: "schedule" },
                { id: "projects", label: "项目记忆库", icon: "folder_shared" },
                { id: "knowledge", label: "知识库", icon: "auto_stories" },
                { id: "weaknesses", label: "弱点分析", icon: "analytics" },
                { id: "growth", label: "成长轨迹", icon: "trending_up" },
                { id: "advisor", label: "AI 职业顾问", icon: "support_agent" }
              ].map((tab) => {
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => handleTabChange(tab.id)}
                    className={`flex items-center gap-3.5 px-4.5 py-4 rounded-2xl text-sm font-black transition-all w-full text-left cursor-pointer group ${
                      isActive
                        ? "bg-primary text-on-primary shadow-lg shadow-primary/20 scale-[1.02]"
                        : "text-on-surface-variant/70 hover:text-white hover:bg-white/5 active:scale-98"
                    }`}
                  >
                    <span className={`material-symbols-outlined text-[20px] transition-transform group-hover:scale-110 ${
                      isActive ? "text-on-primary" : "text-primary"
                    }`}>
                      {tab.icon}
                    </span>
                    {tab.label}
                  </button>
                );
              })}
            </div>

            {/* Quick Search */}
            <div className="flex flex-col gap-2.5">
              <span className="text-xs font-label-mono tracking-widest text-on-surface-variant/40 font-bold uppercase">
                快速搜索
              </span>
              <div className="relative">
                <span className="material-symbols-outlined text-sm absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/40">
                  search
                </span>
                <input
                  type="text"
                  placeholder="搜索数据和职业记忆..."
                  value={searchSidebarQuery}
                  onChange={(e) => setSearchSidebarQuery(e.target.value)}
                  className="pl-9 pr-6 py-2.5 bg-white/5 border border-white/10 rounded-xl text-xs text-white placeholder-on-surface-variant/30 focus:outline-none focus:border-primary/40 h-10 w-full"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-mono px-1 py-0.5 rounded bg-white/10 text-on-surface-variant/40">
                  /
                </span>
              </div>
            </div>

            {/* Tag Management */}
            <div className="flex flex-col gap-3.5">
              <span className="text-xs font-label-mono tracking-widest text-on-surface-variant/40 font-bold uppercase">
                标签管理
              </span>
              <div className="flex flex-wrap gap-1.5">
                {[
                  { name: "技术面试", count: 28 },
                  { name: "系统设计", count: 14 },
                  { name: "场景题", count: 8 },
                  { name: "项目介绍", count: 11 },
                  { name: "算法", count: 9 },
                  { name: "行为面试", count: 7 }
                ].map((tag, idx) => (
                  <button
                    key={idx}
                    className="px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/5 text-xs font-bold text-on-surface-variant hover:text-white hover:border-white/15 transition-all cursor-pointer whitespace-nowrap"
                  >
                    {tag.name} ({tag.count})
                  </button>
                ))}
              </div>
            </div>

            {/* Bottom Memory Active Status */}
            <div className="mt-auto p-4.5 rounded-2xl bg-gradient-to-br from-primary/10 to-secondary/5 border border-primary/20 relative overflow-hidden text-left flex flex-col gap-3.5 shadow-[0_4px_20px_rgba(192,193,255,0.05)]">
              <div className="absolute top-[-20px] right-[-20px] w-16 h-16 bg-primary/10 rounded-full blur-xl animate-pulse"></div>
              
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-primary/20 flex items-center justify-center border border-primary/30">
                  <span className="material-symbols-outlined text-base text-primary animate-pulse">
                    memory
                  </span>
                </div>
                <span className="text-xs md:text-[13px] font-black text-white">AI 长期记忆已开启</span>
              </div>
              <p className="text-[11px] md:text-xs text-on-surface-variant/70 leading-relaxed font-semibold">
                Agent 持续学习你的面试表现，提炼项目亮点并追踪长周期技能波动，提供定制化晋升路线。
              </p>
              <button
                onClick={handleInterceptAction}
                className="w-full py-2.5 bg-white/5 hover:bg-white/10 text-xs font-black text-white rounded-xl border border-white/10 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <span className="material-symbols-outlined text-sm">settings</span>记忆设置
              </button>
            </div>
          </div>
        </div>

        {/* ========================================================
            RIGHT CONTAINER: Header + Grid Widgets + Footer
           ======================================================== */}
        <div className="col-span-12 md:col-span-9 lg:col-span-9.5 flex flex-col gap-6">

          {/* ========================================================
              TOP PROFILE SUMMARY BAR
             ======================================================== */}
          {/* ========================================================
              TOP PROFILE SUMMARY BAR
             ======================================================== */}
          <div className="glass-panel p-6 rounded-3xl border-white/10 flex flex-col xl:flex-row justify-between items-start xl:items-center gap-6 text-left relative overflow-hidden w-full">
            <div className="flex items-center gap-5 flex-wrap w-full xl:w-auto">
              {/* User Avatar */}
              <div className="relative shrink-0">
                <div className="w-16 h-16 rounded-full border-2 border-primary/40 overflow-hidden bg-slate-900 flex items-center justify-center shadow-lg">
                  <img
                    src="/debugger-2.jpg"
                    alt="Dame Zheng"
                    className="w-full h-full object-cover opacity-80"
                    onError={(e) => {
                      (e.target as HTMLElement).style.display = "none";
                    }}
                  />
                  <span className="material-symbols-outlined text-3xl text-primary opacity-60">person</span>
                </div>
                <div className="absolute -bottom-1 -right-1 bg-tertiary w-4 h-4 rounded-full border-2 border-background flex items-center justify-center">
                  <span className="w-1.5 h-1.5 bg-white rounded-full"></span>
                </div>
              </div>

              {/* Basic Infos */}
              <div className="space-y-2 min-w-0 flex-1 sm:flex-initial">
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex items-center gap-2 whitespace-nowrap shrink-0">
                    <h2 className="text-xl font-black text-white whitespace-nowrap">Dame Zheng</h2>
                    <span className="px-2 py-0.5 rounded-full bg-tertiary/10 text-tertiary text-[11px] font-black border border-tertiary/20 whitespace-nowrap">在职</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {["Backend Engineer", "AI Engineer", "System Design"].map((tag, i) => (
                      <span key={i} className="px-2.5 py-0.5 rounded bg-white/5 text-on-surface-variant/75 text-[11px] font-bold border border-white/5 whitespace-nowrap">{tag}</span>
                    ))}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-on-surface-variant/60 font-semibold font-label-mono">
                  <span className="flex items-center gap-1 whitespace-nowrap"><span className="material-symbols-outlined text-xs text-primary">apartment</span>腾讯科技</span>
                  <span className="flex items-center gap-1 whitespace-nowrap"><span className="material-symbols-outlined text-xs text-primary">work</span>后端开发工程师</span>
                  <span className="flex items-center gap-1 whitespace-nowrap"><span className="material-symbols-outlined text-xs text-primary">military_tech</span>P6 (2-2)</span>
                  <span className="flex items-center gap-1 whitespace-nowrap"><span className="material-symbols-outlined text-xs text-primary">pin_drop</span>上海</span>
                  <span className="flex items-center gap-1 whitespace-nowrap"><span className="material-symbols-outlined text-xs text-primary">schedule</span>6年经验</span>
                </div>
              </div>
            </div>

            {/* Targets and AI summary ring */}
            <div className="flex flex-col sm:flex-row sm:flex-wrap xl:flex-nowrap items-stretch sm:items-center gap-6 w-full xl:w-auto border-t xl:border-t-0 pt-4 xl:pt-0 border-white/5 shrink-0">
              
              {/* Target info card */}
              <div className="flex gap-5 px-4.5 py-3.5 rounded-2xl bg-white/[0.02] border border-white/5 shrink-0 justify-between sm:justify-start">
                <div className="text-left whitespace-nowrap min-w-0">
                  <span className="text-[11px] text-on-surface-variant/40 font-label-mono uppercase tracking-widest font-extrabold block whitespace-nowrap">目标岗位</span>
                  <span className="text-base font-black text-white block mt-0.5 whitespace-nowrap">Staff Engineer</span>
                </div>
                <div className="w-px bg-white/10 self-stretch my-1 shrink-0"></div>
                <div className="text-left whitespace-nowrap min-w-0">
                  <span className="text-[11px] text-on-surface-variant/40 font-label-mono uppercase tracking-widest font-extrabold block whitespace-nowrap">目标薪资</span>
                  <span className="text-base font-black text-tertiary block mt-0.5 whitespace-nowrap">70K - 90K</span>
                </div>
              </div>

              {/* AI Summary progress widget */}
              <div className="flex items-center gap-4.5 p-3.5 rounded-2xl bg-white/[0.02] border border-white/5 flex-1 xl:flex-none">
                <div className="text-left">
                  <span className="text-xs md:text-sm font-label-mono text-primary font-black uppercase tracking-wider block">AI 职业总结</span>
                  <ul className="text-xs text-on-surface-variant/60 space-y-0.5 mt-1 list-disc list-inside font-semibold leading-relaxed">
                    <li>具备 P6 技术能力水平</li>
                    <li>系统设计能力较强</li>
                    <li>表达能力有待提升</li>
                    <li>面试通过率预计 <span className="text-primary font-extrabold">67%</span></li>
                  </ul>
                </div>

                <div className="relative w-16 h-16 flex items-center justify-center shrink-0">
                  <svg className="w-full h-full -rotate-90">
                    <circle cx="32" cy="32" r="26" fill="transparent" stroke="rgba(255,255,255,0.05)" strokeWidth="4.5" />
                    <circle
                      cx="32"
                      cy="32"
                      r="26"
                      fill="transparent"
                      stroke="url(#summary-circle-gradient)"
                      strokeWidth="4.5"
                      strokeDasharray={2 * Math.PI * 26}
                      strokeDashoffset={2 * Math.PI * 26 * (1 - 0.67)}
                      strokeLinecap="round"
                    />
                    <defs>
                      <linearGradient id="summary-circle-gradient" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stopColor="#c0c1ff" />
                        <stop offset="100%" stopColor="#ffb2b7" />
                      </linearGradient>
                    </defs>
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-sm font-black text-white font-label-mono">67%</span>
                  </div>
                </div>

                <button
                  onClick={() => handleTabChange("advisor")}
                  className="px-3.5 py-2.5 bg-primary/10 hover:bg-primary/20 text-primary text-xs font-black rounded-xl border border-primary/25 transition-all whitespace-nowrap cursor-pointer flex items-center gap-1 shrink-0"
                >
                  查看详细报告<span className="material-symbols-outlined text-[11px]">expand_more</span>
                </button>
              </div>

            </div>
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className="w-full"
            >
              {/* ========================================================
                  TAB PANEL 1: OVERVIEW DASHBOARD (总览看板)
                 ======================================================== */}
              {activeTab === "overview" && (
                <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-stretch w-full">
                  
                  {/* CARD 1: 面试时间轴 (Interview Timeline) */}
                  <div className="col-span-12 md:col-span-4 flex flex-col">
                    <div className="glass-panel p-5.5 rounded-3xl border-white/10 text-left h-full flex flex-col justify-between gap-5">
                      <div className="space-y-4 flex-1">
                        <div>
                          <h4 className="text-base font-black text-white flex items-center gap-2">
                            <span className="material-symbols-outlined text-base text-primary">schedule</span>
                            面试时间轴
                          </h4>
                          <p className="text-xs text-on-surface-variant/40 font-semibold mt-0.5">完整记录你的每一次面试经历</p>
                        </div>

                        {/* Recent Nodes List */}
                        <div className="relative pl-5.5 space-y-4.5 py-1">
                          <div className="absolute left-2 top-1.5 bottom-1.5 w-0.5 bg-white/5"></div>
                          
                          {[
                            { date: "今日 10:30", company: "腾讯科技", round: "后端开发 · 技术二面", score: 78, level: "良好" },
                            { date: "2025-05-25", company: "字节跳动", round: "基础架构 · 技术一面", score: 82, level: "优秀" },
                            { date: "2025-05-18", company: "阿里云", round: "系统设计 · 技术二面", score: 75, level: "良好" },
                            { date: "2025-05-10", company: "Shopee", round: "架构师 · 技术三面", score: 89, level: "极佳" },
                            { date: "2025-02-28", company: "美团", round: "后端开发 · 技术一面", score: 72, level: "中等" }
                          ].map((item, index) => {
                            const isToday = item.date.includes("今日");
                            return (
                              <div key={index} className="relative flex justify-between items-center group">
                                <div className={`absolute -left-5.5 top-1.5 w-2.5 h-2.5 rounded-full border border-background z-10 ${
                                  isToday ? "bg-tertiary" : item.score >= 80 ? "bg-primary" : "bg-secondary"
                                }`} />
                                
                                <div className="space-y-0.5">
                                  <div className="flex items-center gap-2">
                                    <span className={`text-[11px] font-label-mono ${isToday ? "text-tertiary font-extrabold" : "text-on-surface-variant/40"}`}>{item.date}</span>
                                    <span className="text-xs md:text-sm font-black text-white">{item.company}</span>
                                  </div>
                                  <p className="text-xs text-on-surface-variant/50 font-semibold">{item.round}</p>
                                </div>

                                <div className="text-right">
                                  <span className={`text-sm font-black font-label-mono ${item.score >= 80 ? "text-tertiary" : "text-primary"}`}>{item.score}</span>
                                  <span className="text-[11px] text-on-surface-variant/30 font-label-mono">/100</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      <button
                        onClick={() => handleTabChange("timeline")}
                        className="w-full py-2.5 bg-white/5 hover:bg-white/10 text-xs font-black text-white rounded-xl border border-white/10 transition-all text-center cursor-pointer"
                      >
                        查看全部 28 次面试
                      </button>
                    </div>
                  </div>

                  {/* CARD 2: 能力成长曲线 (Capability Growth Curve) */}
                  <div className="col-span-12 md:col-span-5 flex flex-col">
                    <div className="glass-panel p-5.5 rounded-3xl border-white/10 text-left h-full flex flex-col justify-between gap-4">
                      <div className="space-y-4 flex-1">
                        <div className="flex justify-between items-center">
                          <div>
                            <h4 className="text-base font-black text-white flex items-center gap-2">
                              <span className="material-symbols-outlined text-base text-primary">trending_up</span>
                              能力成长曲线
                            </h4>
                            <p className="text-xs text-on-surface-variant/40 font-semibold mt-0.5">过去 6 个月各维度技能长效演变</p>
                          </div>
                          
                          {/* Period Selector Dropdown */}
                          <div className="relative">
                            <button
                              onClick={handleInterceptAction}
                              className="px-2.5 py-1 bg-white/5 border border-white/10 rounded-lg text-xs font-black text-on-surface-variant flex items-center gap-1.5 cursor-pointer"
                            >
                              6 个月<span className="material-symbols-outlined text-[11px]">expand_more</span>
                            </button>
                          </div>
                        </div>

                        {/* Chart Legend indicators */}
                        <div className="flex flex-wrap gap-x-3 gap-y-1.5 text-xs font-extrabold text-on-surface-variant/60">
                          {[
                            { name: "技术深度", color: "bg-tertiary" },
                            { name: "系统设计", color: "bg-blue-500" },
                            { name: "表达能力", color: "bg-purple-500" },
                            { name: "项目影响力", color: "bg-amber-500" },
                            { name: "业务理解", color: "bg-indigo-500" },
                            { name: "领导力", color: "bg-pink-500" }
                          ].map((legend, idx) => (
                            <span key={idx} className="flex items-center gap-1">
                              <span className={`w-1.5 h-1.5 rounded-full ${legend.color}`}></span>
                              {legend.name}
                            </span>
                          ))}
                        </div>

                        {/* Premium SVG Line Chart */}
                        <div className="relative w-full h-[150px] mt-2 select-none group/chart">
                          <svg className="w-full h-full" viewBox="0 0 100 60" preserveAspectRatio="none">
                            {/* Grid Lines */}
                            <line x1="0" y1="15" x2="100" y2="15" stroke="rgba(255,255,255,0.03)" strokeWidth="0.5" strokeDasharray="2,2" />
                            <line x1="0" y1="30" x2="100" y2="30" stroke="rgba(255,255,255,0.03)" strokeWidth="0.5" strokeDasharray="2,2" />
                            <line x1="0" y1="45" x2="100" y2="45" stroke="rgba(255,255,255,0.03)" strokeWidth="0.5" strokeDasharray="2,2" />

                            {/* Line 1: 技术深度 (Green) - values: 45, 52, 58, 65, 75, 82 */}
                            <path d="M 5,33 L 23,28 L 41,25 L 59,20 L 77,15 L 95,10" fill="none" stroke="#10b981" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
                            {/* Line 2: 系统设计 (Blue) - values: 38, 45, 50, 58, 64, 72 */}
                            <path d="M 5,37 L 23,32 L 41,29 L 59,25 L 77,21 L 95,15" fill="none" stroke="#3b82f6" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
                            {/* Line 3: 表达能力 (Purple) - values: 25, 28, 35, 41, 40, 48 */}
                            <path d="M 5,45 L 23,43 L 41,39 L 59,35 L 77,36 L 95,31" fill="none" stroke="#a855f7" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
                            {/* Line 4: 项目影响力 (Amber) - values: 30, 32, 40, 48, 55, 60 */}
                            <path d="M 5,42 L 23,41 L 41,36 L 59,31 L 77,27 L 95,24" fill="none" stroke="#f59e0b" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
                            {/* Line 5: 业务理解 (Indigo) - values: 48, 55, 62, 68, 78, 86 */}
                            <path d="M 5,31 L 23,27 L 41,23 L 59,19 L 77,13 L 95,8" fill="none" stroke="#6366f1" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
                            {/* Line 6: 领导力 (Pink) - values: 20, 22, 28, 30, 38, 42 */}
                            <path d="M 5,48 L 23,47 L 41,43 L 59,42 L 77,37 L 95,35" fill="none" stroke="#ec4899" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />

                            {/* Active month vertical selector overlay */}
                            {activeCurveMonth !== null && (
                              <line
                                x1={5 + activeCurveMonth * 18}
                                y1="0"
                                x2={5 + activeCurveMonth * 18}
                                y2="50"
                                stroke="rgba(192, 193, 255, 0.25)"
                                strokeWidth="1"
                                strokeDasharray="1,1"
                              />
                            )}

                            {/* Interactivity Overlay Hotspots */}
                            {[0, 1, 2, 3, 4, 5].map((monthIdx) => (
                              <rect
                                key={monthIdx}
                                x={monthIdx * 18}
                                y="0"
                                width="18"
                                height="50"
                                fill="transparent"
                                className="cursor-pointer"
                                onMouseEnter={() => setActiveCurveMonth(monthIdx)}
                                onMouseLeave={() => setActiveCurveMonth(null)}
                              />
                            ))}
                          </svg>

                          {/* Chart Tooltips */}
                          {activeCurveMonth !== null && (
                            <div
                              className="absolute bg-surface-container-high border border-white/10 rounded-lg p-2 text-[9px] text-white font-label-mono space-y-0.5 shadow-xl pointer-events-none z-30"
                              style={{
                                left: `${10 + activeCurveMonth * 15}%`,
                                top: "10%"
                              }}
                            >
                              <p className="font-extrabold text-primary border-b border-white/5 pb-0.5 mb-1">
                                {["12月", "1月", "2月", "3月", "4月", "5月", "6月"][activeCurveMonth + 1]} 评估数据
                              </p>
                              <p className="flex justify-between items-center gap-3">
                                <span>技术深度:</span>
                                <span className="text-tertiary font-bold">{[45, 52, 58, 65, 75, 82][activeCurveMonth]}分</span>
                              </p>
                              <p className="flex justify-between items-center gap-3">
                                <span>系统设计:</span>
                                <span className="text-blue-400 font-bold">{[38, 45, 50, 58, 64, 72][activeCurveMonth]}分</span>
                              </p>
                              <p className="flex justify-between items-center gap-3">
                                <span>表达能力:</span>
                                <span className="text-purple-400 font-bold">{[25, 28, 35, 41, 40, 48][activeCurveMonth]}分</span>
                              </p>
                            </div>
                          )}
                        </div>

                        {/* Chart X Axis Labels */}
                        <div className="flex justify-between text-[11px] font-label-mono text-on-surface-variant/40 px-2 font-bold select-none">
                          <span>12月</span>
                          <span>1月</span>
                          <span>2月</span>
                          <span>3月</span>
                          <span>4月</span>
                          <span>5月</span>
                          <span>6月</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* CARD 3: 长期弱点分析 (Long-term Weakness Analysis) */}
                  <div className="col-span-12 md:col-span-3 flex flex-col">
                    <div className="glass-panel p-5.5 rounded-3xl border-white/10 text-left h-full flex flex-col justify-between gap-4">
                      <div className="space-y-4 flex-1">
                        <div>
                          <h4 className="text-base font-black text-white flex items-center gap-2">
                            <span className="material-symbols-outlined text-base text-secondary">trending_down</span>
                            长期弱点分析
                          </h4>
                          <p className="text-xs text-on-surface-variant/40 font-semibold mt-0.5">基于最近 30 次分析统计频次</p>
                        </div>

                        {/* Weakness Bars */}
                        <div className="space-y-3">
                          {[
                            { name: "系统设计表达", count: 17, max: 20, color: "bg-primary" },
                            { name: "Trade-off 分析", count: 14, max: 20, color: "bg-secondary" },
                            { name: "项目量化指标", count: 12, max: 20, color: "bg-amber-500" },
                            { name: "架构选型理由", count: 10, max: 20, color: "bg-tertiary" },
                            { name: "领导力案例", count: 8, max: 20, color: "bg-indigo-500" }
                          ].map((item, idx) => (
                            <div key={idx} className="space-y-1">
                              <div className="flex justify-between text-xs font-bold text-on-surface-variant/80">
                                <span>{item.name}</span>
                                <span>{item.count} 次</span>
                              </div>
                              <div className="w-full h-1.5 rounded-full bg-white/5 overflow-hidden">
                                <div
                                  className={`h-full rounded-full ${item.color}`}
                                  style={{ width: `${(item.count / item.max) * 100}%` }}
                                ></div>
                              </div>
                            </div>
                          ))}
                        </div>

                        {/* AI Insight Box */}
                        <div className="p-3 rounded-2xl bg-white/[0.02] border border-white/5 space-y-1.5 mt-2">
                          <div className="flex items-center gap-1.5 text-[14.5px] font-black text-primary">
                            <span className="material-symbols-outlined text-[17px] animate-pulse">
                              psychology
                            </span>
                            AI 洞察
                          </div>
                          <p className="text-xs text-on-surface-variant/80 leading-relaxed font-bold">
                            你的核心问题在于“架构对比和方案折中分析能力”不足，而非单纯技术深度不够。
                          </p>
                          <a
                            onClick={() => handleTabChange("weaknesses")}
                            className="text-[13.5px] font-black text-primary flex items-center gap-0.5 cursor-pointer pt-0.5"
                          >
                            查看优化建议 <span className="material-symbols-outlined text-xs">arrow_forward</span>
                          </a>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* CARD 4: 项目记忆库 (Project Memory Bank) */}
                  <div className="col-span-12 md:col-span-4 flex flex-col">
                    <div className="glass-panel p-5.5 rounded-3xl border-white/10 text-left h-full flex flex-col justify-between gap-5">
                      <div className="space-y-4 flex-1">
                        <div>
                          <h4 className="text-base font-black text-white flex items-center gap-2">
                            <span className="material-symbols-outlined text-base text-primary">folder_shared</span>
                            项目记忆库
                          </h4>
                          <p className="text-xs text-on-surface-variant/40 font-semibold mt-0.5">AI 自动提取并结构化的项目信息</p>
                        </div>

                        {/* Project list widgets */}
                        <div className="space-y-3">
                          {[
                            {
                              title: "高并发订单系统",
                              date: "最近更新: 2025-05-20",
                              tags: ["核心项目", "高频提问"],
                              color: "text-primary bg-primary/10 border-primary/20",
                              char: "B"
                            },
                            {
                              title: "支付系统重构",
                              date: "最近更新: 2025-05-15",
                              tags: ["高频提问"],
                              color: "text-tertiary bg-tertiary/10 border-tertiary/20",
                              char: "B"
                            },
                            {
                              title: "推荐系统平台",
                              date: "最近更新: 2025-05-10",
                              tags: [],
                              color: "text-secondary bg-secondary/10 border-secondary/20",
                              char: "D"
                            }
                          ].map((item, idx) => (
                            <div
                              key={idx}
                              className="p-3.5 rounded-2xl bg-white/[0.01] hover:bg-white/[0.03] border border-white/5 flex items-center justify-between gap-3 group transition-all"
                            >
                              <div className="flex items-center gap-3">
                                <div className={`w-8 h-8 rounded-xl flex items-center justify-center font-bold text-xs ${item.color}`}>
                                  {item.char}
                                </div>
                                <div className="space-y-0.5">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <h5 className="text-sm font-black text-white group-hover:text-primary transition-colors">{item.title}</h5>
                                    {item.tags.map((t, i) => (
                                      <span key={i} className="px-1.5 py-0.5 rounded text-[10px] font-black border bg-white/5 text-on-surface-variant/50 border-white/5">
                                        {t}
                                      </span>
                                    ))}
                                  </div>
                                  <p className="text-xs text-on-surface-variant/40 font-semibold">{item.date}</p>
                                </div>
                              </div>
                              <span className="material-symbols-outlined text-sm text-on-surface-variant/30 group-hover:text-white transition-all group-hover:translate-x-0.5">
                                arrow_forward
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <button
                        onClick={() => handleTabChange("projects")}
                        className="w-full py-2.5 bg-white/5 hover:bg-white/10 text-xs font-black text-white rounded-xl border border-white/10 transition-all text-center cursor-pointer flex items-center justify-center gap-1.5"
                      >
                        查看全部项目 (12) <span className="material-symbols-outlined text-xs">arrow_forward</span>
                      </button>
                    </div>
                  </div>

                  {/* CARD 5: 知识库 (Knowledge Base) */}
                  <div className="col-span-12 md:col-span-4 flex flex-col">
                    <div className="glass-panel p-5.5 rounded-3xl border-white/10 text-left h-full flex flex-col justify-between gap-5">
                      <div className="space-y-4 flex-1">
                        <div>
                          <h4 className="text-base font-black text-white flex items-center gap-2">
                            <span className="material-symbols-outlined text-base text-primary">auto_stories</span>
                            知识库 <span className="text-xs text-on-surface-variant/40 font-semibold font-label-mono">(面试题库)</span>
                          </h4>
                          <p className="text-xs text-on-surface-variant/40 font-semibold mt-0.5">你专属的面试知识图谱</p>
                        </div>

                        {/* Concept indicators list */}
                        <div className="space-y-3.5">
                          {[
                            { name: "Redis", count: 8, pct: 78, color: "from-tertiary/20 to-tertiary/5 border-tertiary/30 text-tertiary" },
                            { name: "分布式事务", count: 6, pct: 65, color: "from-primary/20 to-primary/5 border-primary/30 text-primary" },
                            { name: "CAP 理论", count: 5, pct: 82, color: "from-secondary/20 to-secondary/5 border-secondary/30 text-secondary" }
                          ].map((item, idx) => (
                            <div key={idx} className="p-3 rounded-2xl bg-gradient-to-r from-white/[0.01] to-transparent border border-white/5 space-y-2">
                              <div className="flex justify-between items-center">
                                <span className="flex items-center gap-2 font-black text-sm text-white">
                                  <span className="w-1.5 h-1.5 rounded-full bg-primary"></span>
                                  {item.name}
                                </span>
                                <div className="flex items-center gap-2 text-xs font-bold text-on-surface-variant/50">
                                  <span>被问 {item.count} 次</span>
                                  <span className="w-1.5 h-1.5 rounded-full bg-white/10"></span>
                                  <span>掌握度 <span className="text-white font-black font-label-mono">{item.pct}%</span></span>
                                </div>
                              </div>
                              <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-gradient-to-r from-primary to-secondary rounded-full"
                                  style={{ width: `${item.pct}%` }}
                                ></div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      <button
                        onClick={() => handleTabChange("knowledge")}
                        className="w-full py-2.5 bg-white/5 hover:bg-white/10 text-xs font-black text-white rounded-xl border border-white/10 transition-all text-center cursor-pointer flex items-center justify-center gap-1.5"
                      >
                        查看全部知识点 (36) <span className="material-symbols-outlined text-xs">arrow_forward</span>
                      </button>
                    </div>
                  </div>

                  {/* CARD 6: Offer 概率预测 (Offer Probability Prediction) */}
                  <div className="col-span-12 md:col-span-4 flex flex-col">
                    <div className="glass-panel p-5.5 rounded-3xl border-white/10 text-left h-full flex flex-col justify-between gap-5">
                      <div className="space-y-4 flex-1">
                        <div>
                          <h4 className="text-base font-black text-white flex items-center gap-2">
                            <span className="material-symbols-outlined text-base text-primary">online_prediction</span>
                            Offer 概率预测
                          </h4>
                          <p className="text-xs text-on-surface-variant/40 font-semibold mt-0.5">基于你当前实力的概率演进</p>
                        </div>

                        {/* Current offer metric */}
                        <div className="flex justify-between items-center p-3.5 rounded-2xl bg-white/[0.01] border border-white/5">
                          <div>
                            <span className="text-xs text-on-surface-variant/40 font-extrabold uppercase">当前 Offer 概率</span>
                            <h3 className="text-4xl font-black text-white mt-1 font-label-mono">
                              67<span className="text-lg text-on-surface-variant/50 font-normal">%</span>
                            </h3>
                          </div>
                          
                          {/* Pulsing indicator core */}
                          <div className="relative w-12 h-12 flex items-center justify-center bg-primary/10 rounded-full border border-primary/20">
                            <span className="material-symbols-outlined text-xl text-primary animate-pulse">verified_user</span>
                          </div>
                        </div>

                        {/* Interactive Prediction SVG Graph */}
                        <div className="relative w-full h-[95px] select-none group/offer">
                          <svg className="w-full h-full" viewBox="0 0 100 50" preserveAspectRatio="none">
                            {/* SVG Gradients definitions */}
                            <defs>
                              <linearGradient id="offer-area-gradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#10b981" stopOpacity="0.2" />
                                <stop offset="100%" stopColor="#10b981" stopOpacity="0.0" />
                              </linearGradient>
                              <linearGradient id="offer-line-gradient" x1="0" y1="0" x2="1" y2="0">
                                <stop offset="0%" stopColor="#3b82f6" />
                                <stop offset="50%" stopColor="#10b981" />
                                <stop offset="100%" stopColor="#22d3ee" />
                              </linearGradient>
                            </defs>

                            {/* Filled Area below path */}
                            <path d="M 5,42 L 23,39 L 41,35 L 59,28 L 77,25 L 95,22 L 95,50 L 5,50 Z" fill="url(#offer-area-gradient)" />
                            
                            {/* Sparkline Path - values: 38, 42, 46, 59, 63, 67 */}
                            <path d="M 5,42 L 23,39 L 41,35 L 59,28 L 77,25 L 95,22" fill="none" stroke="url(#offer-line-gradient)" strokeWidth="1.2" strokeLinecap="round" />

                            {/* Interactive month circle overlay indicators */}
                            {[0, 1, 2, 3, 4, 5].map((valIdx) => {
                              const x = 5 + valIdx * 18;
                              const y = [42, 39, 35, 28, 25, 22][valIdx];
                              const isHovered = activeOfferMonth === valIdx;
                              return (
                                <g key={valIdx}>
                                  <circle
                                    cx={x}
                                    cy={y}
                                    r={isHovered ? 2.5 : 1.2}
                                    fill={isHovered ? "#fff" : "#10b981"}
                                    stroke="#0b0d19"
                                    strokeWidth="0.5"
                                    className="transition-all duration-150"
                                  />
                                  {isHovered && (
                                    <circle
                                      cx={x}
                                      cy={y}
                                      r="4.5"
                                      fill="transparent"
                                      stroke="#10b981"
                                      strokeWidth="0.5"
                                      className="animate-ping"
                                    />
                                  )}
                                </g>
                              );
                            })}

                            {/* Hotspot triggers overlay */}
                            {[0, 1, 2, 3, 4, 5].map((valIdx) => (
                              <rect
                                key={valIdx}
                                x={valIdx * 18}
                                y="0"
                                width="18"
                                height="50"
                                fill="transparent"
                                className="cursor-pointer"
                                onMouseEnter={() => setActiveOfferMonth(valIdx)}
                                onMouseLeave={() => setActiveOfferMonth(null)}
                              />
                            ))}
                          </svg>

                          {/* Prediction monthly labels */}
                          <div className="flex justify-between text-[10px] font-label-mono text-on-surface-variant/40 px-2 font-bold select-none mt-1">
                            <span>1月 (38%)</span>
                            <span>2月</span>
                            <span>3月</span>
                            <span>4月</span>
                            <span>5月</span>
                            <span>6月 (67%)</span>
                          </div>

                          {/* Tooltip Popup */}
                          {activeOfferMonth !== null && (
                            <div
                              className="absolute bg-surface-container-high border border-white/10 rounded-lg p-2 text-[9px] text-white font-label-mono shadow-xl pointer-events-none z-30"
                              style={{
                                left: `${5 + activeOfferMonth * 14}%`,
                                top: "5%"
                              }}
                            >
                              <span className="font-extrabold text-primary block">
                                {["1月", "2月", "3月", "4月", "5月", "6月"][activeOfferMonth]} 预测概率
                              </span>
                              <span className="text-tertiary font-black font-label-mono mt-0.5 block">
                                {[38, 42, 46, 59, 63, 67][activeOfferMonth]}% Offer 概率
                              </span>
                            </div>
                          )}
                        </div>

                        {/* Recommendations summary */}
                        <div className="p-3.5 rounded-2xl bg-white/[0.02] border border-white/5 space-y-1 mt-2">
                          <span className="text-xs text-on-surface-variant/40 font-extrabold block">提升建议</span>
                          <p className="text-xs text-on-surface-variant/70 leading-relaxed font-semibold">
                            如果重点提升“架构表达”和“项目指标量化能力”，预计整体概率可跃升至 <span className="text-tertiary font-black">85%</span>。
                          </p>
                        </div>
                      </div>

                      <button
                        onClick={() => handleTabChange("growth")}
                        className="w-full py-2.5 bg-white/5 hover:bg-white/10 text-xs font-black text-white rounded-xl border border-white/10 transition-all text-center cursor-pointer flex items-center justify-center gap-1.5"
                      >
                        查看提升路径 <span className="material-symbols-outlined text-xs">trending_up</span>
                      </button>
                    </div>
                  </div>

                </div>
              )}

              {/* ========================================================
                  TAB PANEL 2: TIMELINE / HISTORICAL ARCHIVES (面试时间轴)
                 ======================================================== */}
              {activeTab === "timeline" && (
                <div className="col-span-12">
                  <div className="glass-panel p-8 rounded-3xl border-white/10 h-full flex flex-col justify-between text-left relative overflow-hidden w-full">
                    
                    <div className="space-y-6 w-full">
                      {/* Header title */}
                      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-6 border-b border-white/5 w-full">
                        <div>
                          <span className="text-[10px] font-label-mono tracking-widest text-primary font-bold uppercase">
                            Comprehensive Timeline
                          </span>
                          <h2 className="text-2xl font-black text-white mt-1">历史分析记录档案</h2>
                        </div>

                        {/* Search and Filters */}
                        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
                          <div className="flex bg-white/5 rounded-2xl border border-white/10 p-1">
                            {[
                              { id: "all", label: "全部" },
                              { id: "audio", label: "录音" },
                              { id: "text", label: "文字" },
                              { id: "resume", label: "简历" }
                            ].map((btn) => (
                              <button
                                key={btn.id}
                                onClick={() => setActiveTimelineFilter(btn.id)}
                                className={`px-5 py-2 rounded-xl text-xs md:text-sm font-black transition-all cursor-pointer ${
                                  activeTimelineFilter === btn.id
                                    ? "bg-primary text-on-primary shadow-md shadow-primary/10"
                                    : "text-on-surface-variant/60 hover:text-white"
                                }`}
                              >
                                {btn.label}
                              </button>
                            ))}
                          </div>

                          <div className="relative flex-1 md:flex-none">
                            <span className="material-symbols-outlined text-xs absolute left-3.5 top-1/2 -translate-y-1/2 text-on-surface-variant/40">
                              search
                            </span>
                            <input
                              type="text"
                              placeholder="搜索面试标题、公司或岗位"
                              value={searchQuery}
                              onChange={(e) => setSearchQuery(e.target.value)}
                              className="pl-9 pr-4 py-2 bg-white/5 border border-white/10 rounded-xl text-xs text-white placeholder-on-surface-variant/30 focus:outline-none focus:border-primary/40 h-10 w-full md:w-64"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Vertical Timeline Nodes */}
                      <div className="relative pl-6 space-y-8 py-4 w-full">
                        {/* Vertical Connecting Line */}
                        <div className="absolute left-2.5 top-0 bottom-0 w-0.5 bg-white/5"></div>

                        {filteredHistory.filter(item => activeTimelineFilter === "all" || item.type === activeTimelineFilter).length > 0 ? (
                          filteredHistory
                            .filter(item => activeTimelineFilter === "all" || item.type === activeTimelineFilter)
                            .map((item, index) => {
                              return (
                                <div
                                  key={index}
                                  className="relative flex flex-col md:flex-row md:items-center justify-between gap-4 p-5 rounded-2xl bg-white/[0.01] hover:bg-white/[0.03] border border-white/5 transition-all group"
                                >
                                  {/* Left timeline dot */}
                                  <div
                                    className={`absolute -left-6 top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full border-2 border-background z-10 ${
                                      item.type === "resume"
                                        ? "bg-tertiary"
                                        : item.type === "audio"
                                        ? "bg-primary"
                                        : "bg-secondary"
                                    }`}
                                  />

                                  <div className="flex items-start gap-4">
                                    <div
                                      className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                                        item.type === "resume"
                                          ? "bg-tertiary/10 text-tertiary"
                                          : item.type === "audio"
                                          ? "bg-primary/10 text-primary"
                                          : "bg-secondary/10 text-secondary"
                                      }`}
                                    >
                                      <span className="material-symbols-outlined text-lg">
                                        {item.type === "resume" ? "description" : item.type === "audio" ? "graphic_eq" : "edit_document"}
                                      </span>
                                    </div>

                                    <div>
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <h4 className="font-extrabold text-sm text-white">{item.title}</h4>
                                        <span className="text-[10px] font-label-mono text-on-surface-variant/40">
                                          {item.date}
                                        </span>
                                      </div>
                                      <p className="text-xs text-on-surface-variant/60 mt-1 leading-relaxed max-w-xl font-medium">
                                        {item.details}
                                      </p>
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-4 self-end md:self-auto">
                                    <div className="text-right">
                                      <span className="text-[9px] text-on-surface-variant/40 font-label-mono uppercase tracking-widest font-extrabold block">
                                        综合得分
                                      </span>
                                      <span
                                        className={`text-sm font-black font-label-mono ${
                                          item.score >= 80 ? "text-tertiary" : "text-primary"
                                        }`}
                                      >
                                        {item.score}分 ({item.grade})
                                      </span>
                                    </div>

                                    <button
                                      onClick={() => handleViewDetails(item)}
                                      className="px-4 py-2 bg-white/5 border border-white/10 group-hover:bg-primary group-hover:border-primary group-hover:text-on-primary text-white text-xs font-bold rounded-lg transition-all cursor-pointer"
                                    >
                                      查看详情
                                    </button>
                                  </div>
                                </div>
                              );
                            })
                        ) : (
                          <div className="py-12 text-center w-full">
                            <span className="material-symbols-outlined text-4xl text-on-surface-variant/35 mb-2 block">
                              folder_open
                            </span>
                            <p className="text-xs text-on-surface-variant/50">未找到符合搜索条件的面试分析历史记录。</p>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Pagination */}
                    <div className="mt-8 pt-6 border-t border-white/5 flex items-center justify-between font-label-mono text-xs text-on-surface-variant/50 w-full select-none">
                      <span>共 {filteredHistory.filter(item => activeTimelineFilter === "all" || item.type === activeTimelineFilter).length} 条记录</span>
                      <div className="flex gap-2">
                        <button className="px-2.5 py-1 rounded bg-white/5 text-white/50 border border-white/5 hover:bg-white/10 cursor-not-allowed">
                          &lt;
                        </button>
                        <button className="px-2.5 py-1 rounded bg-primary text-on-primary font-bold">1</button>
                        <button className="px-2.5 py-1 rounded bg-white/5 hover:bg-white/10 border border-white/5 cursor-pointer">
                          2
                        </button>
                        <button className="px-2.5 py-1 rounded bg-white/5 hover:bg-white/10 border border-white/5 cursor-pointer">
                          3
                        </button>
                        <button className="px-2.5 py-1 rounded bg-white/5 hover:bg-white/10 border border-white/5 cursor-pointer">
                          &gt;
                        </button>
                      </div>
                    </div>

                  </div>
                </div>
              )}

              {/* ========================================================
                  TAB PANEL 3: PROJECTS MEMORY BANK (项目记忆库详情)
                 ======================================================== */}
              {activeTab === "projects" && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 w-full text-left">
                  {[
                    { title: "高并发订单系统", desc: "采用双写缓冲与延迟刷盘逻辑解决写放大，性能吞吐相比前代架构上浮45%，是高并发场景的核心支撑。", count: 28, mastery: 85, badge: "高频核心" },
                    { title: "支付系统重构", desc: "重构基于双向状态机幂等与Saga分布式事务的最终一致性架构，成功支撑历次电商大促流量，零坏账。", count: 22, mastery: 90, badge: "交易骨干" },
                    { title: "推荐系统平台", desc: "构建高维混合召回与流式模型重排底座，AI智能标签动态纠偏，支撑实时画像秒级量化演练。", count: 18, mastery: 72, badge: "AI工程" },
                    { title: "用户配置引擎", desc: "基于分布式哈希环的分片与渐进式同步引擎，数据多点容灾，热点负载转移耗时压降75%。", count: 12, mastery: 80, badge: "公共组件" },
                    { title: "开放API网关", desc: "基于Token桶算法限流与轻量级JWT认证的低延迟流量边检枢纽，防护拦截全天候自动化运维。", count: 9, mastery: 88, badge: "网络中枢" },
                    { title: "离线数仓建设", desc: "大数据分析底座，构建ODS-DWD-DWS三层分级度量指标，提供数据流向链路的拓扑追踪支持。", count: 5, mastery: 65, badge: "数据工程" }
                  ].map((proj, idx) => (
                    <div key={idx} className="glass-panel p-5.5 rounded-3xl border-white/10 flex flex-col justify-between gap-5 hover:border-primary/20 hover:scale-[1.01] transition-all group">
                      <div className="space-y-3.5">
                        <div className="flex justify-between items-start">
                          <h4 className="text-base font-black text-white group-hover:text-primary transition-colors">{proj.title}</h4>
                          <span className="px-2.5 py-1 rounded bg-primary/10 text-primary text-[11px] font-black border border-primary/20">{proj.badge}</span>
                        </div>
                        <p className="text-xs md:text-[13px] text-on-surface-variant/75 leading-relaxed font-semibold">{proj.desc}</p>
                      </div>

                      <div className="space-y-2.5 border-t border-white/5 pt-3.5">
                        <div className="flex justify-between items-center text-xs text-on-surface-variant/60 font-extrabold font-label-mono">
                          <span>面试提及: {proj.count}次</span>
                          <span>核心掌握: {proj.mastery}%</span>
                        </div>
                        <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
                          <div className="h-full bg-gradient-to-r from-primary to-secondary rounded-full" style={{ width: `${proj.mastery}%` }}></div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* ========================================================
                  TAB PANEL 4: KNOWLEDGE BASE (知识库题谱详情)
                 ======================================================== */}
              {activeTab === "knowledge" && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 w-full text-left">
                  {[
                    { cat: "缓存中间件", items: [{ n: "Redis 缓存穿透与击穿", c: 14, m: 85 }, { n: "Redis 分布式锁原理", c: 12, m: 80 }, { n: "AOF 与 RDB 混合持久化", c: 8, m: 92 }] },
                    { cat: "系统架构与微服务", items: [{ n: "分布式事务 (Saga, TCC)", c: 17, m: 65 }, { n: "CAP 定理与 Base 理论", c: 10, m: 88 }, { n: "服务熔断与哨兵机制", c: 7, m: 75 }] },
                    { cat: "高并发并发编程", items: [{ n: "线程池调优与阻塞队列", c: 11, m: 90 }, { n: "AQS 框架与重入锁原理", c: 8, m: 82 }, { n: "CAS 无锁自旋与 ABA 问题", c: 6, m: 78 }] },
                    { cat: "数据库与索引工程", items: [{ n: "MySQL MVCC 多版本并发", c: 15, m: 72 }, { n: "B+ 树索引分裂与回表", c: 9, m: 85 }, { n: "慢查询解析与执行计划优化", c: 6, m: 80 }] }
                  ].map((section, idx) => (
                    <div key={idx} className="glass-panel p-5.5 rounded-3xl border-white/10 space-y-4 text-left">
                      <span className="text-xs md:text-[13px] font-label-mono text-primary font-bold uppercase tracking-wider block">
                        {section.cat}
                      </span>
                      <div className="space-y-3.5">
                        {section.items.map((item, i) => (
                          <div key={i} className="p-3.5 rounded-2xl bg-white/[0.01] border border-white/5 hover:border-white/10 transition-all space-y-2.5">
                            <div className="flex justify-between items-start gap-3">
                              <h5 className="text-xs md:text-sm font-black text-white leading-relaxed">{item.n}</h5>
                              <span className="text-[11px] font-semibold font-label-mono text-on-surface-variant/50 shrink-0">问 {item.c}次</span>
                            </div>
                            <div className="flex items-center justify-between text-[11px] font-semibold text-on-surface-variant/70">
                              <span>掌握度</span>
                              <span className="font-black text-white font-label-mono">{item.m}%</span>
                            </div>
                            <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
                              <div className="h-full bg-primary rounded-full" style={{ width: `${item.m}%` }}></div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* ========================================================
                  TAB PANEL 5: WEAKNESS ANALYSIS (长期弱点突破)
                 ======================================================== */}
              {activeTab === "weaknesses" && (
                <div className="grid grid-cols-1 md:grid-cols-12 gap-6 w-full text-left">
                  {/* Left Column: Weakness Details List */}
                  <div className="col-span-12 md:col-span-8 flex flex-col gap-6">
                    {[
                      {
                        title: "系统设计表达",
                        freq: "高频雷区 (出现17次)",
                        metric: "架构阐述偏向代码堆砌，缺少链路层宏观抽象。",
                        solution: "梳理完整的技术自述模板，遵循“背景-核心痛点-技术选型-最终表现”四步陈述框架，多画网络拓扑示意图。",
                        color: "border-primary/30"
                      },
                      {
                        title: "Trade-off 深度折中能力",
                        freq: "严重警告 (出现14次)",
                        metric: "被深挖底层逻辑时直接给结论，缺乏对非最优解的优劣比对陈述。",
                        solution: "在描述系统方案前先给出至少两种分支，例如：‘引入Redis虽然提升吞吐，但在极端情况下会面临双写一致性漂移，需要Saga补偿...’",
                        color: "border-secondary/30"
                      },
                      {
                        title: "项目数据量化指标",
                        freq: "核心短板 (出现12次)",
                        metric: "表达仅停留于“性能大幅提高”，未给出具体的QPS或毫秒响应数据差值。",
                        solution: "牢记核心性能指标：重构前吞吐QPS为1200，延迟450ms；重构后QPS攀升至4500，99线延迟控制在50ms以内。",
                        color: "border-amber-500/30"
                      }
                    ].map((item, idx) => (
                      <div key={idx} className={`glass-panel p-6 rounded-3xl border ${item.color} space-y-4`}>
                        <div className="flex justify-between items-center gap-4">
                          <h4 className="text-[17px] font-black text-white">{item.title}</h4>
                          <span className="px-3 py-1.5 rounded-lg bg-white/5 text-[11px] font-black text-on-surface-variant/80 border border-white/10 whitespace-nowrap shrink-0">{item.freq}</span>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-3.5 border-t border-white/5 text-xs">
                          <div className="space-y-2">
                            <span className="text-[12px] text-on-surface-variant/60 font-black tracking-wider uppercase block">AI 检测现状</span>
                            <p className="text-xs md:text-[13px] text-on-surface-variant/85 leading-relaxed font-semibold">{item.metric}</p>
                          </div>
                          <div className="space-y-2">
                            <span className="text-[12px] text-tertiary font-black tracking-wider uppercase block">配套消灭方案</span>
                            <p className="text-xs md:text-[13px] text-on-surface-variant/85 leading-relaxed font-semibold">{item.solution}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Right Column: AI Coach Dashboard overview */}
                  <div className="col-span-12 md:col-span-4 flex flex-col gap-6">
                    <div className="glass-panel p-6 rounded-3xl border-white/10 space-y-5.5 h-full">
                      <div>
                        <h4 className="text-base font-black text-white flex items-center gap-2">
                          <span className="material-symbols-outlined text-base text-primary">psychology</span>
                          长期记忆学习路径
                        </h4>
                        <p className="text-xs text-on-surface-variant/40 font-semibold mt-0.5">Agent 建议重点攻克的三条防御路径</p>
                      </div>

                      <div className="space-y-4">
                        {[
                          { step: "第一阶段: 话术纠偏", desc: "在回答中强行注入‘在系统选型中我做过以下Trade-off对比...’的转折表达。", ok: true },
                          { step: "第二阶段: 指标背诵", desc: "整理个人项目2-3组核心的测试吞吐/并发指标线，做到提及即条件反射。", ok: false },
                          { step: "第三阶段: 架构推演", desc: "绘制核心方案的主从/双写链路拓扑，加深多级组件交互流向记忆。", ok: false }
                        ].map((s, i) => (
                          <div key={i} className="flex gap-3.5">
                            <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${
                              s.ok ? "bg-tertiary/20 text-tertiary border border-tertiary/30" : "bg-white/5 text-on-surface-variant/40 border border-white/10"
                            }`}>
                              <span className="material-symbols-outlined text-[10px]">{s.ok ? "done" : "circle"}</span>
                            </div>
                            <div className="space-y-1 text-left">
                              <h5 className="text-sm font-black text-white">{s.step}</h5>
                              <p className="text-xs text-on-surface-variant/70 leading-relaxed font-semibold">{s.desc}</p>
                            </div>
                          </div>
                        ))}
                      </div>

                      <button
                        onClick={handleInterceptAction}
                        className="w-full py-3.5 bg-gradient-to-r from-primary to-secondary text-on-primary text-sm font-black rounded-2xl hover:scale-[1.01] active:scale-98 transition-all shadow-lg shadow-primary/20 cursor-pointer"
                      >
                        加入弱点专项强化实训
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* ========================================================
                  TAB PANEL 6: GROWTH TRAJECTORY (成长轨迹演变)
                 ======================================================== */}
              {activeTab === "growth" && (
                <div className="glass-panel p-8 rounded-3xl border-white/10 w-full text-left space-y-6">
                  <div>
                    <h3 className="text-lg font-black text-white flex items-center gap-2">
                      <span className="material-symbols-outlined text-base text-primary">trending_up</span>
                      求职轨迹全景追踪
                    </h3>
                    <p className="text-xs text-on-surface-variant/40 font-semibold mt-0.5">记录自开始调试以来的全局指标演进历程</p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-4 gap-6 pb-6 border-b border-white/5">
                    {[
                      { label: "平均综合得分", value: "79.4", diff: "+12.5%", isUp: true },
                      { label: "累积问答次数", value: "142", diff: "+48", isUp: true },
                      { label: "项目亮点提炼", value: "12个", diff: "+3", isUp: true },
                      { label: "弱点覆盖突破", value: "65%", diff: "+18%", isUp: true }
                    ].map((card, i) => (
                      <div key={i} className="p-4.5 rounded-2xl bg-white/[0.01] border border-white/5 space-y-2">
                        <span className="text-[10px] text-on-surface-variant/40 font-extrabold uppercase">{card.label}</span>
                        <div className="flex justify-between items-baseline">
                          <h4 className="text-2xl font-black text-white font-label-mono">{card.value}</h4>
                          <span className={`text-[10px] font-black font-label-mono ${card.isUp ? "text-tertiary" : "text-primary"}`}>
                            {card.diff}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="space-y-4">
                    <h4 className="text-xs font-black text-white font-label-mono uppercase tracking-widest text-primary">月度重大里程碑</h4>
                    <div className="relative pl-6 space-y-6 py-2">
                      <div className="absolute left-2.5 top-2 bottom-2 w-0.5 bg-white/5"></div>
                      
                      {[
                        { month: "6月 · 中期飞跃", desc: "在腾讯科技与字节跳动的一二面中，技术深度指标评测上浮至85分，架构设计底座思维得到AI的高星级认可。", ok: true },
                        { month: "5月 · 方案攻克", desc: "结合Saga分布式事务和Redis缓存的对比练习，系统消除了此前在‘双写一致性’分析阶段经常出现的断层问题。", ok: true },
                        { month: "4月 · 指标建立", desc: "完成首批4个项目的重构指标量化分析，提炼并锁定了‘双写缓冲’等核心话术的QPS度量指标。", ok: true },
                        { month: "3月 · 初入看板", desc: "正式激活AI长期记忆看板，首次记录下职业记忆评估数据并开启弱点追踪演习。", ok: true }
                      ].map((mile, i) => (
                        <div key={i} className="relative flex justify-between items-start gap-4">
                          <div className={`absolute -left-6 top-1 w-3.5 h-3.5 rounded-full border border-background z-10 ${
                            mile.ok ? "bg-primary" : "bg-white/5"
                          }`} />
                          <div className="space-y-1">
                            <h5 className="text-xs font-black text-white">{mile.month}</h5>
                            <p className="text-[11px] text-on-surface-variant/65 leading-relaxed font-semibold max-w-2xl">{mile.desc}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* ========================================================
                  TAB PANEL 7: AI CAREER ADVISOR (交互顾问面板)
                 ======================================================== */}
              {activeTab === "advisor" && (
                <div className="grid grid-cols-1 md:grid-cols-12 gap-6 w-full text-left">
                  {/* Left chatbot preview panel */}
                  <div className="col-span-12 md:col-span-8 flex flex-col">
                    <div className="glass-panel p-6 rounded-3xl border-white/10 flex flex-col justify-between gap-5 h-full">
                      <div className="space-y-4 flex-1">
                        <div className="flex items-center gap-3 pb-4 border-b border-white/5">
                          <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center border border-primary/30 relative">
                            <span className="material-symbols-outlined text-lg text-primary animate-pulse">support_agent</span>
                            <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-tertiary border-2 border-background"></span>
                          </div>
                          <div>
                            <h4 className="text-base font-black text-white">OfferPilot 智能职业顾问</h4>
                            <p className="text-xs text-tertiary font-extrabold mt-0.5">在线 · 基于您142次测评学习中</p>
                          </div>
                        </div>

                        {/* Interactive chat logs previews */}
                        <div className="space-y-4 py-2">
                          <div className="flex items-start gap-3.5 max-w-xl">
                            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                              <span className="material-symbols-outlined text-sm text-primary">support_agent</span>
                            </div>
                            <div className="p-3.5 rounded-2xl bg-white/5 border border-white/5 text-xs text-on-surface-variant/80 font-semibold leading-relaxed">
                              Dame，你好！我是你的专属AI职业顾问。基于你在“腾讯科技”、“字节跳动”等28次实战测试的反馈，我判定你当前非常契合 <span className="text-white font-extrabold">Staff Engineer</span> 的进阶期。你需要重点打磨架构方案折中与大厂级微服务控制体系。
                            </div>
                          </div>

                          <div className="flex items-start gap-3.5 max-w-xl self-end flex-row-reverse ml-auto">
                            <div className="w-8 h-8 rounded-full bg-secondary/15 flex items-center justify-center shrink-0">
                              <span className="material-symbols-outlined text-sm text-secondary">person</span>
                            </div>
                            <div className="p-3.5 rounded-2xl bg-primary text-on-primary text-xs font-semibold leading-relaxed shadow-lg shadow-primary/15">
                              如何突破在面试中被面试官频繁追问“为什么不选Kafka”这种系统设计八股？
                            </div>
                          </div>

                          <div className="flex items-start gap-3.5 max-w-xl">
                            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                              <span className="material-symbols-outlined text-sm text-primary">support_agent</span>
                            </div>
                            <div className="p-3.5 rounded-2xl bg-white/5 border border-white/5 text-xs text-on-surface-variant/80 font-semibold leading-relaxed space-y-2">
                              <p>这是一个经典的“非优解比对”题。回答这类型问题时，严禁背诵八股，请遵循以下三步法陈述：</p>
                              <ol className="list-decimal list-inside space-y-1 font-bold text-white pl-1.5">
                                <li>吞吐与可靠性折中：‘在我们的写缓冲场景下，数据高可靠是首位，RabbitMQ基于AMQP协议提供更严密的确认应答...’</li>
                                <li>运维与团队成本：‘当时业务团队对RabbitMQ技术栈更为熟悉，引入Kafka会造成多组Zookeeper运维溢价...’</li>
                                <li>功能完备性：‘我们需要RabbitMQ死信队列来进行延迟处理...’</li>
                              </ol>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Chat text box input */}
                      <div className="relative">
                        <input
                          type="text"
                          placeholder="向AI顾问咨询你的求职困惑、弱点改进方法或简历包装建议..."
                          className="w-full pl-4 pr-12 py-3 bg-white/5 border border-white/10 rounded-2xl text-xs text-white placeholder-on-surface-variant/30 focus:outline-none focus:border-primary/40 h-12"
                        />
                        <button
                          onClick={handleInterceptAction}
                          className="absolute right-3 top-1/2 -translate-y-1/2 w-8 h-8 rounded-xl bg-primary text-on-primary flex items-center justify-center hover:scale-105 active:scale-95 transition-all cursor-pointer"
                        >
                          <span className="material-symbols-outlined text-sm">send</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Right side strategies column */}
                  <div className="col-span-12 md:col-span-4 flex flex-col gap-6">
                    <div className="glass-panel p-6 rounded-3xl border-white/10 space-y-5.5 h-full text-left">
                      <div>
                        <h4 className="text-base font-black text-white flex items-center gap-2">
                          <span className="material-symbols-outlined text-base text-primary">verified</span>
                          晋升保障权益
                        </h4>
                        <p className="text-xs text-on-surface-variant/40 font-semibold mt-0.5">解锁完整的职业驾驶舱分析矩阵</p>
                      </div>

                      <div className="space-y-4 border-b border-white/5 pb-5">
                        {[
                          { label: "定制化简历改进逻辑图", val: "无限次生成" },
                          { label: "大厂核心提问频次拓扑", val: "全盘解锁" },
                          { label: "长周期弱点专项防御计划", val: "终身保存" },
                          { label: "1对1模拟实战诊断接口", val: "全天候开启" }
                        ].map((serv, i) => (
                          <div key={i} className="flex justify-between items-center text-sm font-semibold">
                            <span className="text-on-surface-variant/80">{serv.label}</span>
                            <span className="text-tertiary font-black font-label-mono">{serv.val}</span>
                          </div>
                        ))}
                      </div>

                      <button
                        onClick={handleInterceptAction}
                        className="w-full py-3.5 bg-gradient-to-r from-primary to-secondary text-on-primary text-sm font-black rounded-2xl hover:scale-[1.01] active:scale-98 transition-all shadow-lg shadow-primary/20 cursor-pointer text-center"
                      >
                        升级为 Pro 专家会员
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>

          {/* ========================================================
              BOTTOM AI CAREER ADVISOR STRATEGY BAR
             ======================================================== */}
          <div className="glass-panel p-6 rounded-3xl border-white/10 relative overflow-hidden text-left flex flex-col gap-6 shadow-2xl w-full">
            {/* Background glowing particles */}
            <div className="absolute top-1/2 left-6 -translate-y-1/2 w-28 h-28 bg-primary/10 rounded-full blur-2xl pointer-events-none animate-pulse"></div>

            <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 pb-4 border-b border-white/5 relative z-10">
              <div className="flex items-center gap-3">
                {/* AI Agent Avatar core */}
                <div className="relative">
                  <div className="w-11 h-11 rounded-full bg-primary/20 flex items-center justify-center border border-primary/30 shadow-[0_0_15px_rgba(192,193,255,0.2)]">
                    <span className="material-symbols-outlined text-xl text-primary animate-pulse">support_agent</span>
                  </div>
                  <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-tertiary border-2 border-background"></span>
                </div>
                <div>
                  <h4 className="text-base font-black text-white">AI 职业顾问</h4>
                  <p className="text-xs text-on-surface-variant/60 font-semibold mt-0.5">基于你所有的面试记录和分析，AI 为你定制建议</p>
                </div>
              </div>

              <button
                onClick={() => handleTabChange("advisor")}
                className="px-5 py-2.5 bg-primary text-on-primary text-sm font-black rounded-xl hover:scale-[1.02] active:scale-98 transition-all shadow-[0_4px_15px_rgba(192,193,255,0.3)] cursor-pointer"
              >
                咨询 AI 顾问
              </button>
            </div>

            {/* AI Advisor Columns */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 relative z-10">
              
              {/* Card 1: 本周重点提升 */}
              <div className="glass-panel p-5.5 rounded-2xl border-white/10 flex flex-col gap-3 hover:border-primary/20 hover:scale-[1.01] transition-all duration-300">
                <div className="flex items-center gap-2.5 pb-2.5 border-b border-white/5">
                  <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center border border-primary/20 shrink-0">
                    <span className="material-symbols-outlined text-base text-primary animate-pulse">rocket_launch</span>
                  </div>
                  <span className="text-sm font-black text-white font-label-mono uppercase tracking-wider block">本周重点提升</span>
                </div>
                <div className="space-y-2 mt-1">
                  {[
                    "架构表达框架建立",
                    "项目指标定量细化",
                    "系统设计 trade-off 表达"
                  ].map((text, i) => (
                    <div key={i} className="flex items-center gap-3 py-2.5 px-3.5 rounded-xl bg-white/[0.01] border border-white/5 hover:border-white/10 hover:bg-white/[0.02] transition-all text-xs md:text-sm font-black text-on-surface-variant/90 text-left">
                      <span className="material-symbols-outlined text-xs text-primary shrink-0">arrow_right_alt</span>
                      <span className="leading-snug">{text}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Card 2: 近期面试趋势 */}
              <div className="glass-panel p-5.5 rounded-2xl border-white/10 flex flex-col gap-3 hover:border-secondary/20 hover:scale-[1.01] transition-all duration-300">
                <div className="flex items-center gap-2.5 pb-2.5 border-b border-white/5">
                  <div className="w-8 h-8 rounded-xl bg-secondary/10 flex items-center justify-center border border-secondary/20 shrink-0">
                    <span className="material-symbols-outlined text-base text-secondary animate-pulse">trending_up</span>
                  </div>
                  <span className="text-sm font-black text-white font-label-mono uppercase tracking-wider block">近期面试趋势</span>
                </div>
                <div className="space-y-2 mt-1">
                  {[
                    "系统设计出现频率上升 23%",
                    "分布式相关问题增加明显",
                    "面试官更关注工程落地细节"
                  ].map((text, i) => (
                    <div key={i} className="flex items-center gap-3 py-2.5 px-3.5 rounded-xl bg-white/[0.01] border border-white/5 hover:border-white/10 hover:bg-white/[0.02] transition-all text-xs md:text-sm font-black text-on-surface-variant/90 text-left">
                      <span className="material-symbols-outlined text-xs text-secondary shrink-0">insights</span>
                      <span className="leading-snug">{text}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Card 3: 推荐行动 */}
              <div className="glass-panel p-5.5 rounded-2xl border-white/10 flex flex-col gap-3 hover:border-amber-500/20 hover:scale-[1.01] transition-all duration-300">
                <div className="flex items-center gap-2.5 pb-2.5 border-b border-white/5">
                  <div className="w-8 h-8 rounded-xl bg-amber-500/10 flex items-center justify-center border border-amber-500/20 shrink-0">
                    <span className="material-symbols-outlined text-base text-amber-500 animate-pulse">task_alt</span>
                  </div>
                  <span className="text-sm font-black text-white font-label-mono uppercase tracking-wider block">推荐行动</span>
                </div>
                <div className="space-y-2 mt-1">
                  {[
                    "完成 3 次真题模拟面试",
                    "优化 2 个核心项目描述",
                    "补充架构师深度表达训练"
                  ].map((text, i) => (
                    <div key={i} className="flex items-center gap-3 py-2.5 px-3.5 rounded-xl bg-white/[0.01] border border-white/5 hover:border-white/10 hover:bg-white/[0.02] transition-all text-xs md:text-sm font-black text-on-surface-variant/90 text-left">
                      <span className="material-symbols-outlined text-xs text-amber-500 shrink-0">play_circle</span>
                      <span className="leading-snug">{text}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Card 4: 职业发展建议 */}
              <div className="glass-panel p-5.5 rounded-2xl border-white/10 flex flex-col gap-3 hover:border-tertiary/20 hover:scale-[1.01] transition-all duration-300">
                <div className="flex items-center gap-2.5 pb-2.5 border-b border-white/5">
                  <div className="w-8 h-8 rounded-xl bg-tertiary/10 flex items-center justify-center border border-tertiary/20 shrink-0">
                    <span className="material-symbols-outlined text-base text-tertiary animate-pulse">military_tech</span>
                  </div>
                  <span className="text-sm font-black text-white font-label-mono uppercase tracking-wider block">职业发展建议</span>
                </div>
                <div className="space-y-2 mt-1">
                  {[
                    "建议向 Staff Engineer 方向准备",
                    "提升技术影响力和领导力表达",
                    "密切关注一线大厂架构能力变化"
                  ].map((text, i) => (
                    <div key={i} className="flex items-center gap-3 py-2.5 px-3.5 rounded-xl bg-white/[0.01] border border-white/5 hover:border-white/10 hover:bg-white/[0.02] transition-all text-xs md:text-sm font-black text-on-surface-variant/90 text-left">
                      <span className="material-symbols-outlined text-xs text-tertiary shrink-0">explore</span>
                      <span className="leading-snug">{text}</span>
                    </div>
                  ))}
                </div>
              </div>

            </div>
          </div>

        </div>

      </div>

      {/* Footer */}
      <footer className="bg-surface-container-lowest border-t border-white/5 w-full block mt-8 relative z-10">
        <div className="px-gutter py-8 max-w-container-max mx-auto flex flex-col md:flex-row justify-between items-center gap-4 text-left">
          <div className="flex items-center gap-4">
            <span className="text-xs text-on-surface-variant font-label-mono font-bold tracking-widest">
              © 2024 OfferPilot AI. All rights reserved.
            </span>
          </div>
          <div className="flex gap-8 text-xs text-on-surface-variant font-label-mono font-bold tracking-widest">
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

      {/* WECHAT MODAL */}
      {showLoginModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div
            onClick={() => setShowLoginModal(false)}
            className="absolute inset-0 bg-surface/60 backdrop-blur-md transition-opacity duration-300"
          />

          <div className="bg-surface-container-high border border-white/10 rounded-3xl p-8 max-w-sm w-full text-center relative z-10 space-y-6 shadow-2xl transition-all scale-100 animate-fade-in">
            <div className="flex justify-between items-center">
              <span className="font-label-mono text-[10px] text-primary tracking-widest uppercase font-bold">
                OfferPilot Intelligence
              </span>
              <button
                onClick={() => setShowLoginModal(false)}
                className="text-on-surface-variant hover:text-white transition-colors"
              >
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>

            <div className="space-y-2">
              <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center mx-auto mb-2 animate-bounce">
                <span className="material-symbols-outlined text-2.5xl">lock</span>
              </div>
              <h3 className="font-extrabold text-white text-lg">保存分析结果与成长轨迹</h3>
              <p className="text-on-surface-variant text-xs leading-relaxed max-w-xs mx-auto font-semibold">
                注册并登录账号，即可保存本次分析历史、下载修改好的简历并追踪您的面试成长路径。
              </p>
            </div>

            <div className="space-y-3 pt-2">
              <button
                onClick={() => setShowLoginModal(false)}
                className="w-full py-3.5 rounded-xl bg-tertiary text-on-tertiary font-bold text-xs hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-tertiary/15"
              >
                <span className="material-symbols-outlined text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>
                  chat
                </span>
                使用微信一键登录
              </button>
              <button
                onClick={() => setShowLoginModal(false)}
                className="w-full py-3.5 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-white font-bold text-xs hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <span className="material-symbols-outlined text-sm">phone_iphone</span>
                手机号验证码登录
              </button>
            </div>

            <p className="text-[10px] text-on-surface-variant/40">登录即代表您已阅读并同意《服务条款》和《隐私政策》</p>
          </div>
        </div>
      )}
    </main>
  );
}
