"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth, UserMenu } from "@/components/AuthProvider";

export default function HelperPage() {
  const router = useRouter();
  const auth = useAuth();
  const [activeTab, setActiveTab] = useState("audio-analysis");
  const [playingVideo, setPlayingVideo] = useState<Record<string, boolean>>({});

  // Timeline counter state for mock players
  const [timelineSecs, setTimelineSecs] = useState<Record<string, number>>({
    "audio-analysis": 0,
    "record-analysis": 0,
    "resume-analysis": 0,
    "mock-interview": 0,
    "career-advisor": 0,
  });

  // Update timer for playing videos
  useEffect(() => {
    const interval = setInterval(() => {
      setTimelineSecs(prev => {
        const next = { ...prev };
        Object.keys(playingVideo).forEach(key => {
          if (playingVideo[key]) {
            next[key] = (next[key] + 1) % 150; // loop back after 2min 30s
          }
        });
        return next;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [playingVideo]);

  const togglePlay = (id: string) => {
    setPlayingVideo(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
  };

  return (
    <div className="min-h-screen bg-[#0b1326] relative overflow-hidden select-none text-on-surface text-left">
      
      {/* Background Image (Semi-transparent) */}
      <div className="absolute inset-0 bg-[url('/helper.jpg')] bg-cover bg-center opacity-30 pointer-events-none z-0" />
      
      {/* Background Glows */}
      <div className="absolute top-[-10%] left-[-15%] w-[60vw] h-[60vw] rounded-full bg-primary/5 blur-[130px] pointer-events-none z-10" />
      <div className="absolute bottom-[-15%] right-[-15%] w-[60vw] h-[60vw] rounded-full bg-secondary/5 blur-[130px] pointer-events-none z-10" />
      
      {/* Waveform Keyframe styles for mock players */}
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes bounce-slow {
          0%, 100% { transform: scaleY(0.3); }
          50% { transform: scaleY(1); }
        }
        @keyframes scan-bar {
          0% { top: 0%; opacity: 0.8; }
          50% { top: 100%; opacity: 0.8; }
          100% { top: 0%; opacity: 0.8; }
        }
        @keyframes pulse-ring {
          0% { transform: scale(0.95); opacity: 0.5; }
          50% { transform: scale(1.1); opacity: 0.15; }
          100% { transform: scale(0.95); opacity: 0.5; }
        }
        .anim-wave-1 { animation: bounce-slow 0.8s ease-in-out infinite alternate; }
        .anim-wave-2 { animation: bounce-slow 1.1s ease-in-out infinite alternate 0.15s; }
        .anim-wave-3 { animation: bounce-slow 0.9s ease-in-out infinite alternate 0.3s; }
        .anim-wave-4 { animation: bounce-slow 1.3s ease-in-out infinite alternate 0.45s; }
        .anim-wave-5 { animation: bounce-slow 0.7s ease-in-out infinite alternate 0.6s; }
        
        .anim-scan { animation: scan-bar 4s linear infinite; }
        .anim-ring-1 { animation: pulse-ring 2s infinite ease-in-out; }
        .anim-ring-2 { animation: pulse-ring 2s infinite ease-in-out 0.6s; }
      `}} />

      {/* HERO HEADER */}
      <header className="relative py-16 text-center max-w-container-max mx-auto px-gutter overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] bg-primary/10 rounded-full blur-[80px] pointer-events-none" />

        <h1 className="text-3xl sm:text-5xl font-black tracking-tight text-white mb-4">
          面试驾到 <span className="text-gradient">帮助中心</span>
        </h1>
        <p className="text-base sm:text-lg text-on-surface-variant/70 font-semibold max-w-2xl mx-auto leading-relaxed">
          像复盘比赛录像一样，深度分析您的每一次面试表现。五分钟助您快速掌握产品所有核心功能，开启 Offer 丰收之旅。
        </p>
      </header>

      {/* TWO COLUMN CONTENT (TAB MODE) */}
      <main className="max-w-container-max mx-auto px-gutter py-12 flex flex-col lg:flex-row gap-8 relative items-start min-h-[500px]">
        
        {/* LEFT TAB BAR */}
        <aside className="w-full lg:w-[240px] shrink-0 bg-[#0b1326]/30 backdrop-blur-xl border border-white/5 p-4 rounded-2xl flex flex-row lg:flex-col gap-1.5 overflow-x-auto custom-scrollbar lg:overflow-visible">
          <button
            onClick={() => setActiveTab("audio-analysis")}
            className={`px-4 py-3 rounded-xl text-left text-base font-bold whitespace-nowrap cursor-pointer transition-all duration-300 w-full flex items-center gap-2 ${
              activeTab === "audio-analysis"
                ? "bg-primary text-on-primary shadow-lg shadow-primary/20"
                : "text-on-surface-variant/60 hover:text-white hover:bg-white/5"
            }`}
          >
            <span className="material-symbols-outlined text-base">mic</span>
            <span>面试录音分析</span>
          </button>
          
          <button
            onClick={() => setActiveTab("record-analysis")}
            className={`px-4 py-3 rounded-xl text-left text-base font-bold whitespace-nowrap cursor-pointer transition-all duration-300 w-full flex items-center gap-2 ${
              activeTab === "record-analysis"
                ? "bg-primary text-on-primary shadow-lg shadow-primary/20"
                : "text-on-surface-variant/60 hover:text-white hover:bg-white/5"
            }`}
          >
            <span className="material-symbols-outlined text-base">query_stats</span>
            <span>面试记录分析</span>
          </button>

          <button
            onClick={() => setActiveTab("resume-analysis")}
            className={`px-4 py-3 rounded-xl text-left text-base font-bold whitespace-nowrap cursor-pointer transition-all duration-300 w-full flex items-center gap-2 ${
              activeTab === "resume-analysis"
                ? "bg-primary text-on-primary shadow-lg shadow-primary/20"
                : "text-on-surface-variant/60 hover:text-white hover:bg-white/5"
            }`}
          >
            <span className="material-symbols-outlined text-base">description</span>
            <span>简历深度分析</span>
          </button>

          <button
            onClick={() => setActiveTab("mock-interview")}
            className={`px-4 py-3 rounded-xl text-left text-base font-bold whitespace-nowrap cursor-pointer transition-all duration-300 w-full flex items-center gap-2 ${
              activeTab === "mock-interview"
                ? "bg-primary text-on-primary shadow-lg shadow-primary/20"
                : "text-on-surface-variant/60 hover:text-white hover:bg-white/5"
            }`}
          >
            <span className="material-symbols-outlined text-base">interpreter_mode</span>
            <span>AI模拟面试</span>
          </button>

          <button
            onClick={() => setActiveTab("career-advisor")}
            className={`px-4 py-3 rounded-xl text-left text-base font-bold whitespace-nowrap cursor-pointer transition-all duration-300 w-full flex items-center gap-2 ${
              activeTab === "career-advisor"
                ? "bg-primary text-on-primary shadow-lg shadow-primary/20"
                : "text-on-surface-variant/60 hover:text-white hover:bg-white/5"
            }`}
          >
            <span className="material-symbols-outlined text-base">psychology</span>
            <span>AI职业顾问</span>
          </button>
        </aside>

        {/* RIGHT WORKSPACE AREA - Renders Active Tab Only */}
        <section className="flex-1 w-full min-h-[460px]">
          
          {/* 1. 面试录音分析 */}
          {activeTab === "audio-analysis" && (
            <article className="glass-panel p-6 sm:p-8 rounded-3xl border-white/10 space-y-6 slide-up">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1.5">
                  <div className="inline-flex items-center gap-1 bg-red-400/10 text-red-300 border border-red-400/20 px-2 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase">
                    <span className="material-symbols-outlined text-xs">mic</span>
                    <span>Audio analysis</span>
                  </div>
                  <h2 className="text-2xl font-black text-white">面试录音分析</h2>
                </div>
                <button
                  onClick={() => router.push("/debugger?mode=audio")}
                  className="self-start sm:self-center px-4 py-1.5 bg-primary/10 border border-primary/20 hover:bg-primary/20 text-[#AFA7FF] hover:text-white rounded-xl text-base font-bold transition-all cursor-pointer"
                >
                  前往体验
                </button>
              </div>

              <p className="text-sm sm:text-base text-on-surface-variant/80 font-semibold leading-relaxed">
                支持直接上传录音文件。系统将通过领先的声学与语义大模型，将语音逐句翻译并拆解为您与面试官的现场对话。
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
                <div className="space-y-4 text-sm font-semibold text-on-surface-variant/70">
                  <h4 className="text-base font-bold text-white mb-2">💡 操作三步走：</h4>
                  <div className="flex gap-3">
                    <span className="w-5 h-5 rounded-full bg-white/5 border border-white/10 flex items-center justify-center shrink-0 text-white font-bold">1</span>
                    <p className="leading-relaxed">在【面试调试器】中点击【面试录音分析】，选择您的面试手机录音（支持 MP3, WAV 等常见格式）。</p>
                  </div>
                  <div className="flex gap-3">
                    <span className="w-5 h-5 rounded-full bg-white/5 border border-white/10 flex items-center justify-center shrink-0 text-white font-bold">2</span>
                    <p className="leading-relaxed">点击提交，AI 将通过语音转文本，并结合你的用户画像进行面试复盘，并自动标注面试官的提问及您的回答。</p>
                  </div>
                  <div className="flex gap-3">
                    <span className="w-5 h-5 rounded-full bg-white/5 border border-white/10 flex items-center justify-center shrink-0 text-white font-bold">3</span>
                    <p className="leading-relaxed">在【分析报告】中即可查看面试时间线、面试表现指数、关键风险点、片段能力分析以及针对您每个回答的修改建议（带 AI 精准改写范例）。</p>
                  </div>
                </div>

                {/* Real Demo Video */}
                <div className="relative rounded-2xl border border-white/10 bg-[#070b14] overflow-hidden aspect-video group shadow-xl">
                  <video
                    className="w-full h-full object-contain"
                    src="/demo/audio-demo.mp4"
                    controls
                    preload="metadata"
                    playsInline
                    style={{ display: 'block' }}
                  />
                </div>
              </div>
            </article>
          )}

          {/* 2. 面试记录分析 */}
          {activeTab === "record-analysis" && (
            <article className="glass-panel p-6 sm:p-8 rounded-3xl border-white/10 space-y-6 slide-up">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1.5">
                  <div className="inline-flex items-center gap-1 bg-primary-container/10 text-primary border border-primary-container/20 px-2 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase">
                    <span className="material-symbols-outlined text-xs">query_stats</span>
                    <span>Record analysis</span>
                  </div>
                  <h2 className="text-2xl font-black text-white">面试记录分析</h2>
                </div>
                <button
                  onClick={() => router.push("/debugger?mode=text")}
                  className="self-start sm:self-center px-4 py-1.5 bg-primary/10 border border-primary/20 hover:bg-primary/20 text-[#AFA7FF] hover:text-white rounded-xl text-base font-bold transition-all cursor-pointer"
                >
                  前往体验
                </button>
              </div>

              <p className="text-sm sm:text-base text-on-surface-variant/80 font-semibold leading-relaxed">
                支持直接粘贴复盘对白或面试录音转写文本。系统将通过领先的语义理解与对话拆解大模型，自动整理并提炼您与面试官的现场问答逻辑。
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
                <div className="space-y-4 text-sm font-semibold text-on-surface-variant/70">
                  <h4 className="text-base font-bold text-white mb-2">💡 操作三步走：</h4>
                  <div className="flex gap-3">
                    <span className="w-5 h-5 rounded-full bg-white/5 border border-white/10 flex items-center justify-center shrink-0 text-white font-bold">1</span>
                    <p className="leading-relaxed">在【面试调试器】中选择【面试记录分析】，直接粘贴您整理好的现场对话文本（支持手动录入或外部转写结果）。</p>
                  </div>
                  <div className="flex gap-3">
                    <span className="w-5 h-5 rounded-full bg-white/5 border border-white/10 flex items-center justify-center shrink-0 text-white font-bold">2</span>
                    <p className="leading-relaxed">完善面试相关的公司名称、岗位、轮次等基础信息，点击开始分析。</p>
                  </div>
                  <div className="flex gap-3">
                    <span className="w-5 h-5 rounded-full bg-white/5 border border-white/10 flex items-center justify-center shrink-0 text-white font-bold">3</span>
                    <p className="leading-relaxed">在【分析报告】中即可获取全方位的回答诊断、技术深度检测，以及针对每个提问的 AI 优化回答范例。</p>
                  </div>
                </div>

                {/* Real Demo Video */}
                <div className="relative rounded-2xl border border-white/10 bg-[#070b14] overflow-hidden aspect-video group shadow-xl">
                  <video
                    className="w-full h-full object-contain"
                    src="/demo/record-demo.mp4"
                    controls
                    preload="metadata"
                    playsInline
                    style={{ display: 'block' }}
                  />
                </div>
              </div>
            </article>
          )}

          {/* 3. 简历深度分析 */}
          {activeTab === "resume-analysis" && (
            <article className="glass-panel p-6 sm:p-8 rounded-3xl border-white/10 space-y-6 slide-up">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1.5">
                  <div className="inline-flex items-center gap-1 bg-amber-400/10 text-amber-300 border border-amber-400/20 px-2 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase">
                    <span className="material-symbols-outlined text-xs">description</span>
                    <span>Resume analysis</span>
                  </div>
                  <h2 className="text-2xl font-black text-white">简历深度分析</h2>
                </div>
                <button
                  onClick={() => router.push("/debugger?mode=resume")}
                  className="self-start sm:self-center px-4 py-1.5 bg-primary/10 border border-primary/20 hover:bg-primary/20 text-[#AFA7FF] hover:text-white rounded-xl text-base font-bold transition-all cursor-pointer"
                >
                  前往体验
                </button>
              </div>

              <p className="text-sm sm:text-base text-on-surface-variant/80 font-semibold leading-relaxed">
                支持上传 PDF 或 Word 格式简历。系统将通过先进的简历诊断算法，智能比对简历与目标岗位的契合度，精准定位简历短板，提供针对性的优化与精简修改建议。
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
                <div className="space-y-4 text-sm font-semibold text-on-surface-variant/70">
                  <h4 className="text-base font-bold text-white mb-2">💡 操作三步走：</h4>
                  <div className="flex gap-3">
                    <span className="w-5 h-5 rounded-full bg-white/5 border border-white/10 flex items-center justify-center shrink-0 text-white font-bold">1</span>
                    <p className="leading-relaxed">在【面试调试器】中选择【简历深度分析】，点击上传您的求职简历（支持 PDF、DOCX 格式）。</p>
                  </div>
                  <div className="flex gap-3">
                    <span className="w-5 h-5 rounded-full bg-white/5 border border-white/10 flex items-center justify-center shrink-0 text-white font-bold">2</span>
                    <p className="leading-relaxed">粘贴您心仪的目标岗位描述 (JD)，帮助 AI 更加聚焦并针对性进行匹配度扫描。</p>
                  </div>
                  <div className="flex gap-3">
                    <span className="w-5 h-5 rounded-full bg-white/5 border border-white/10 flex items-center justify-center shrink-0 text-white font-bold">3</span>
                    <p className="leading-relaxed">提交后即可查看简历综合评分、核心项目深度诊断、关键词缺失分析以及一键改写建议。</p>
                  </div>
                </div>

                {/* Real Demo Video */}
                <div className="relative rounded-2xl border border-white/10 bg-[#070b14] overflow-hidden aspect-video group shadow-xl">
                  <video
                    className="w-full h-full object-contain"
                    src="/demo/resume-demo.mp4"
                    controls
                    preload="metadata"
                    playsInline
                    style={{ display: 'block' }}
                  />
                </div>
              </div>
            </article>
          )}

          {/* 4. AI模拟面试 */}
          {activeTab === "mock-interview" && (
            <article className="glass-panel p-6 sm:p-8 rounded-3xl border-white/10 space-y-6 slide-up">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1.5">
                  <div className="inline-flex items-center gap-1 bg-[#AFA7FF]/20 text-[#c0c1ff] border border-[#AFA7FF]/35 px-2 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase">
                    <span className="material-symbols-outlined text-xs">interpreter_mode</span>
                    <span>Mock interview</span>
                  </div>
                  <h2 className="text-2xl font-black text-white">AI模拟面试</h2>
                </div>
                <button
                  onClick={() => router.push("/training")}
                  className="self-start sm:self-center px-4 py-1.5 bg-primary/10 border border-primary/20 hover:bg-primary/20 text-[#AFA7FF] hover:text-white rounded-xl text-base font-bold transition-all cursor-pointer"
                >
                  前往体验
                </button>
              </div>

              <p className="text-sm sm:text-base text-on-surface-variant/80 font-semibold leading-relaxed">
                提供高度逼真的实时语音面试实战模拟。系统支持 5 种不同流派的面试官风格（书本八股型、项目深挖型、架构设计型、资深业务型、HR面综合型），提供 4 种不同考核难度（友善、偏友好、有压力、严苛），并在面试结束后自动出具包含总评得分、维度明细及针对性改进建议的深度分析报告。
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
                <div className="space-y-4 text-sm font-semibold text-on-surface-variant/70">
                  <h4 className="text-base font-bold text-white mb-2">💡 操作三步走：</h4>
                  <div className="flex gap-3">
                    <span className="w-5 h-5 rounded-full bg-white/5 border border-white/10 flex items-center justify-center shrink-0 text-white font-bold">1</span>
                    <p className="leading-relaxed">在【面试训练场】中输入您的目标岗位，可自定义粘贴详细岗位描述（JD）来精细匹配面试题。</p>
                  </div>
                  <div className="flex gap-3">
                    <span className="w-5 h-5 rounded-full bg-white/5 border border-white/10 flex items-center justify-center shrink-0 text-white font-bold">2</span>
                    <p className="leading-relaxed">灵活选择您的面试官类型（八股/项目/场景/业务/HR等5类风格）及难度等级（友善/偏友好/有压力/严苛等4档），随后开启麦克风点击“开始模拟面试”。</p>
                  </div>
                  <div className="flex gap-3">
                    <span className="w-5 h-5 rounded-full bg-white/5 border border-white/10 flex items-center justify-center shrink-0 text-white font-bold">3</span>
                    <p className="leading-relaxed">面试结束后，系统会进行一键汇总分析，自动出具多维度深度评估报告，帮您查漏补缺，提升实战通过率。</p>
                  </div>
                </div>

                {/* Real Demo Video */}
                <div className="relative rounded-2xl border border-white/10 bg-[#070b14] overflow-hidden aspect-video group shadow-xl">
                  <video
                    className="w-full h-full object-contain"
                    src="/demo/mock-interview-demo.mp4"
                    controls
                    preload="metadata"
                    playsInline
                    style={{ display: 'block' }}
                  />
                </div>
              </div>
            </article>
          )}

          {/* 5. AI职业顾问 */}
          {activeTab === "career-advisor" && (
            <article className="glass-panel p-6 sm:p-8 rounded-3xl border-white/10 space-y-6 slide-up">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1.5">
                  <div className="inline-flex items-center gap-1 bg-[#ffb2b7]/20 text-[#ffc6c9] border border-[#ffb2b7]/35 px-2 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase">
                    <span className="material-symbols-outlined text-xs">psychology</span>
                    <span>Career advisor</span>
                  </div>
                  <h2 className="text-2xl font-black text-white">AI职业顾问</h2>
                </div>
                <button
                  onClick={() => router.push("/memory?tab=advisor")}
                  className="self-start sm:self-center px-4 py-1.5 bg-primary/10 border border-primary/20 hover:bg-primary/20 text-[#AFA7FF] hover:text-white rounded-xl text-base font-bold transition-all cursor-pointer"
                >
                  前往体验
                </button>
              </div>

              <p className="text-sm sm:text-base text-on-surface-variant/80 font-semibold leading-relaxed">
                结合您的简历背景与求职意向，提供个性化的职业咨询与面试辅导。系统不仅根据您的求职目标自动生成定制化的核心技能、技术趋势及行动指南，更提供双向实时对话终端，解答您在面试技巧、技术细节及薪资谈判中的所有疑问。
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
                <div className="space-y-4 text-sm font-semibold text-on-surface-variant/70">
                  <h4 className="text-base font-bold text-white mb-2">💡 操作三步走：</h4>
                  <div className="flex gap-3">
                    <span className="w-5 h-5 rounded-full bg-white/5 border border-white/10 flex items-center justify-center shrink-0 text-white font-bold">1</span>
                    <p className="leading-relaxed">在【职业记忆看板】中切换至【AI 职业顾问】标签页，系统将根据您的求职目标自动生成第一手行业基准建议。</p>
                  </div>
                  <div className="flex gap-3">
                    <span className="w-5 h-5 rounded-full bg-white/5 border border-white/10 flex items-center justify-center shrink-0 text-white font-bold">2</span>
                    <p className="leading-relaxed">点击【开启专属定制咨询】或在下方会话列表发起新对话，即可与您的专属 AI 导师进行 1V1 沉浸式交谈。</p>
                  </div>
                  <div className="flex gap-3">
                    <span className="w-5 h-5 rounded-full bg-white/5 border border-white/10 flex items-center justify-center shrink-0 text-white font-bold">3</span>
                    <p className="leading-relaxed">自由输入任何职场或面试困惑，顾问将结合您的个人简历与目标岗位画像，输出高度定制化的话术指导、专业解构及谈判策略。</p>
                  </div>
                </div>

                {/* Real Demo Video */}
                <div className="relative rounded-2xl border border-white/10 bg-[#070b14] overflow-hidden aspect-video group shadow-xl">
                  <video
                    className="w-full h-full object-contain"
                    src="/demo/AI-helper-demo.mp4"
                    controls
                    preload="metadata"
                    playsInline
                    style={{ display: 'block' }}
                  />
                </div>
              </div>
            </article>
          )}

        </section>

      </main>

      {/* FOOTER */}
      <footer className="border-t border-white/5 py-8 relative z-10 text-center bg-[#070c17]/50 mt-12">
        <div className="max-w-container-max mx-auto px-gutter flex items-center justify-center">
          <span className="text-xs text-on-surface-variant/40 font-semibold">
            © 2026 面试驾到 · Built with AI · 面试驾到，Offer来到
          </span>
        </div>
      </footer>

    </div>
  );
}
