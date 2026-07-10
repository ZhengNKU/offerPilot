"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

export default function HelperPage() {
  const router = useRouter();
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
          面试VAR <span className="text-gradient">使用指南</span>
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
                  onClick={() => {
                    if (window.opener) {
                      window.opener.focus();
                      window.opener.location.href = "/debugger?mode=audio";
                    } else {
                      router.push("/debugger?mode=audio");
                    }
                  }}
                  className="self-start sm:self-center px-4 py-1.5 bg-primary/10 border border-primary/20 hover:bg-primary/20 text-[#AFA7FF] hover:text-white rounded-xl text-xs font-bold transition-all cursor-pointer"
                >
                  前往体验
                </button>
              </div>

              <p className="text-sm sm:text-base text-on-surface-variant/80 font-semibold leading-relaxed">
                支持直接上传录音文件或在手机/电脑浏览器中实时录音。系统将通过领先的声学与语义大模型，将语音逐句翻译并拆解为您与面试官的现场对话。
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
                <div className="space-y-4 text-sm font-semibold text-on-surface-variant/70">
                  <h4 className="text-base font-bold text-white mb-2">💡 操作三步走：</h4>
                  <div className="flex gap-3">
                    <span className="w-5 h-5 rounded-full bg-white/5 border border-white/10 flex items-center justify-center shrink-0 text-white font-bold">1</span>
                    <p className="leading-relaxed">在【面试调试器】中点击【上传音频】，选择您的面试手机录音（支持 MP3, M4A, WAV 等常见格式）。</p>
                  </div>
                  <div className="flex gap-3">
                    <span className="w-5 h-5 rounded-full bg-white/5 border border-white/10 flex items-center justify-center shrink-0 text-white font-bold">2</span>
                    <p className="leading-relaxed">点击提交，AI 将在数秒内将其转写为中英双语文字对齐，并自动标注面试官的提问及您的回答。</p>
                  </div>
                  <div className="flex gap-3">
                    <span className="w-5 h-5 rounded-full bg-white/5 border border-white/10 flex items-center justify-center shrink-0 text-white font-bold">3</span>
                    <p className="leading-relaxed">在【分析报告】中即可查看面试评测、评分、以及针对您每个回答的修改建议（带 AI 精准改写范例）。</p>
                  </div>
                </div>

                {/* Mock Player */}
                <div className="relative rounded-2xl border border-white/10 bg-[#070b14] overflow-hidden aspect-video group shadow-xl">
                  {playingVideo["audio-analysis"] ? (
                    <div className="absolute inset-0 flex flex-col p-4 justify-between bg-[#060a12]">
                      <div className="flex items-center justify-between border-b border-white/5 pb-2">
                        <span className="text-[10px] text-primary font-bold">正在录音分析中...</span>
                        <span className="w-2 h-2 rounded-full bg-red-500 animate-ping" />
                      </div>
                      <div className="flex items-end justify-center gap-1.5 h-20 my-auto">
                        <div className="w-2 bg-primary/80 rounded anim-wave-1 h-12" />
                        <div className="w-2 bg-[#ffb2b7]/80 rounded anim-wave-2 h-16" />
                        <div className="w-2 bg-primary rounded anim-wave-3 h-8" />
                        <div className="w-2 bg-[#ffb2b7] rounded anim-wave-4 h-14" />
                        <div className="w-2 bg-primary/70 rounded anim-wave-5 h-10" />
                      </div>
                      <div className="text-[10px] text-white/60 bg-white/5 p-2 rounded-lg font-mono truncate">
                        面试官: "请介绍一下你主导过的 OfferPilot 项目的技术架构..."
                      </div>
                    </div>
                  ) : (
                    <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(192,193,255,0.08),transparent)] flex items-center justify-center">
                      <div className="absolute inset-0 bg-[#070b14]/70" />
                      <span className="material-symbols-outlined text-4xl text-primary/60 animate-pulse">mic_none</span>
                    </div>
                  )}

                  <div className="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/85 via-black/0 to-black/0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-10">
                    <div className="p-3 flex items-center gap-3">
                      <button onClick={() => togglePlay("audio-analysis")} className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center border border-white/20 text-white cursor-pointer transition-transform hover:scale-105">
                        <span className="material-symbols-outlined text-sm">{playingVideo["audio-analysis"] ? "pause" : "play_arrow"}</span>
                      </button>
                      <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden relative">
                        <div className="absolute top-0 bottom-0 left-0 bg-primary transition-all duration-1000" style={{ width: `${(timelineSecs["audio-analysis"] / 150) * 100}%` }} />
                      </div>
                      <span className="text-[10px] font-mono text-white/50">{formatTime(timelineSecs["audio-analysis"])} / 2:30</span>
                    </div>
                  </div>

                  {!playingVideo["audio-analysis"] && (
                    <div onClick={() => togglePlay("audio-analysis")} className="absolute inset-0 flex items-center justify-center z-10 cursor-pointer bg-black/25">
                      <div className="w-12 h-12 rounded-full bg-white/10 hover:bg-primary/20 border border-white/20 hover:border-primary/40 flex items-center justify-center backdrop-blur-md transition-all transform hover:scale-110 shadow-2xl">
                        <span className="material-symbols-outlined text-xl text-white hover:text-primary fill-current">play_arrow</span>
                      </div>
                    </div>
                  )}
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
                  onClick={() => {
                    if (window.opener) {
                      window.opener.focus();
                      window.opener.location.href = "/debugger?mode=audio";
                    } else {
                      router.push("/debugger?mode=audio");
                    }
                  }}
                  className="self-start sm:self-center px-4 py-1.5 bg-primary/10 border border-primary/20 hover:bg-primary/20 text-[#AFA7FF] hover:text-white rounded-xl text-xs font-bold transition-all cursor-pointer"
                >
                  前往体验
                </button>
              </div>

              <p className="text-sm sm:text-base text-on-surface-variant/80 font-semibold leading-relaxed">
                多维度面试表现看板，汇聚您历史所有面试评测细节。智能检测薄弱环节，为您深度解构核心技能点差距。
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
                <div className="space-y-4 text-sm font-semibold text-on-surface-variant/70">
                  <h4 className="text-base font-bold text-white mb-2">💡 操作三步走：</h4>
                  <div className="flex gap-3">
                    <span className="w-5 h-5 rounded-full bg-white/5 border border-white/10 flex items-center justify-center shrink-0 text-white font-bold">1</span>
                    <p className="leading-relaxed">当您完成录音分析或历史导入后，在【面试调试器】右侧即可切换【评测看板】。</p>
                  </div>
                  <div className="flex gap-3">
                    <span className="w-5 h-5 rounded-full bg-white/5 border border-white/10 flex items-center justify-center shrink-0 text-white font-bold">2</span>
                    <p className="leading-relaxed">直观展现项目经验、沟通表达、抗压能力、技术细节等维度评分，了解整体表现与岗位匹配度。</p>
                  </div>
                  <div className="flex gap-3">
                    <span className="w-5 h-5 rounded-full bg-white/5 border border-white/10 flex items-center justify-center shrink-0 text-white font-bold">3</span>
                    <p className="leading-relaxed">点击具体维度，即可折叠展开详细的扣分详情与针对该维度的日常提升建议。</p>
                  </div>
                </div>

                {/* Mock Player */}
                <div className="relative rounded-2xl border border-white/10 bg-[#070b14] overflow-hidden aspect-video group shadow-xl">
                  {playingVideo["record-analysis"] ? (
                    <div className="absolute inset-0 flex flex-col p-4 justify-between bg-[#060a12] text-white">
                      <div className="flex items-center justify-between border-b border-white/5 pb-2">
                        <span className="text-[10px] text-primary font-bold">面试综合指标评测大屏</span>
                        <span className="text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-1 py-0.5 rounded font-mono font-bold">优秀</span>
                      </div>
                      <div className="my-auto flex flex-col gap-2">
                        <div>
                          <div className="flex justify-between text-[10px] font-bold text-white/70 mb-1">
                            <span>沟通表达能力</span>
                            <span>{80 + (timelineSecs["record-analysis"] % 18)}%</span>
                          </div>
                          <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                            <div className="h-full bg-primary transition-all duration-300" style={{ width: `${80 + (timelineSecs["record-analysis"] % 18)}%` }} />
                          </div>
                        </div>
                        <div>
                          <div className="flex justify-between text-[10px] font-bold text-white/70 mb-1">
                            <span>核心技术实力</span>
                            <span>{75 + (timelineSecs["record-analysis"] % 15)}%</span>
                          </div>
                          <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                            <div className="h-full bg-[#ffb2b7] transition-all duration-300" style={{ width: `${75 + (timelineSecs["record-analysis"] % 15)}%` }} />
                          </div>
                        </div>
                      </div>
                      <div className="text-[10px] text-emerald-400 font-mono text-center">
                        🌟 本次亮点: 架构设计思路清晰，建议继续保持
                      </div>
                    </div>
                  ) : (
                    <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(192,193,255,0.08),transparent)] flex items-center justify-center">
                      <div className="absolute inset-0 bg-[#070b14]/70" />
                      <span className="material-symbols-outlined text-4xl text-[#ffb2b7]/60 animate-pulse">query_stats</span>
                    </div>
                  )}

                  <div className="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/85 via-black/0 to-black/0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-10">
                    <div className="p-3 flex items-center gap-3">
                      <button onClick={() => togglePlay("record-analysis")} className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center border border-white/20 text-white cursor-pointer transition-transform hover:scale-105">
                        <span className="material-symbols-outlined text-sm">{playingVideo["record-analysis"] ? "pause" : "play_arrow"}</span>
                      </button>
                      <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden relative">
                        <div className="absolute top-0 bottom-0 left-0 bg-primary transition-all duration-1000" style={{ width: `${(timelineSecs["record-analysis"] / 150) * 100}%` }} />
                      </div>
                      <span className="text-[10px] font-mono text-white/50">{formatTime(timelineSecs["record-analysis"])} / 2:30</span>
                    </div>
                  </div>

                  {!playingVideo["record-analysis"] && (
                    <div onClick={() => togglePlay("record-analysis")} className="absolute inset-0 flex items-center justify-center z-10 cursor-pointer bg-black/25">
                      <div className="w-12 h-12 rounded-full bg-white/10 hover:bg-primary/20 border border-white/20 hover:border-primary/40 flex items-center justify-center backdrop-blur-md transition-all transform hover:scale-110 shadow-2xl">
                        <span className="material-symbols-outlined text-xl text-white hover:text-primary fill-current">play_arrow</span>
                      </div>
                    </div>
                  )}
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
                  onClick={() => {
                    if (window.opener) {
                      window.opener.focus();
                      window.opener.location.href = "/debugger?mode=resume";
                    } else {
                      router.push("/debugger?mode=resume");
                    }
                  }}
                  className="self-start sm:self-center px-4 py-1.5 bg-primary/10 border border-primary/20 hover:bg-primary/20 text-[#AFA7FF] hover:text-white rounded-xl text-xs font-bold transition-all cursor-pointer"
                >
                  前往体验
                </button>
              </div>

              <p className="text-sm sm:text-base text-on-surface-variant/80 font-semibold leading-relaxed">
                一键扫描并深度诊断您的简历。通过大语言模型比对简历与目标岗位的契合度，挖掘可被写在简历中的闪光细节并给出精简改写建议。
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
                <div className="space-y-4 text-sm font-semibold text-on-surface-variant/70">
                  <h4 className="text-base font-bold text-white mb-2">💡 操作三步走：</h4>
                  <div className="flex gap-3">
                    <span className="w-5 h-5 rounded-full bg-white/5 border border-white/10 flex items-center justify-center shrink-0 text-white font-bold">1</span>
                    <p className="leading-relaxed">在【面试调试器】中切换至【简历分析】标签页，一键上传您的 PDF 或 Word 简历。</p>
                  </div>
                  <div className="flex gap-3">
                    <span className="w-5 h-5 rounded-full bg-white/5 border border-white/10 flex items-center justify-center shrink-0 text-white font-bold">2</span>
                    <p className="leading-relaxed">在输入栏内粘贴您的目标岗位描述 (JD)，使 AI 诊断更具针对性和匹配度。</p>
                  </div>
                  <div className="flex gap-3">
                    <span className="w-5 h-5 rounded-full bg-white/5 border border-white/10 flex items-center justify-center shrink-0 text-white font-bold">3</span>
                    <p className="leading-relaxed">查看生成的【深度分析】，获取一键式的简历评分、项目技术深层提炼建议以及一键式修改方案。</p>
                  </div>
                </div>

                {/* Mock Player */}
                <div className="relative rounded-2xl border border-white/10 bg-[#070b14] overflow-hidden aspect-video group shadow-xl">
                  {playingVideo["resume-analysis"] ? (
                    <div className="absolute inset-0 flex bg-[#060a12] p-3 text-white overflow-hidden">
                      <div className="w-1/2 bg-slate-900 border border-white/10 rounded-lg p-2.5 relative flex flex-col gap-1.5 overflow-hidden">
                        <div className="h-3 w-12 bg-white/20 rounded" />
                        <div className="h-1.5 w-full bg-white/10 rounded" />
                        <div className="h-1.5 w-11/12 bg-white/10 rounded" />
                        <div className="h-1.5 w-full bg-white/10 rounded" />
                        <div className="h-1.5 w-3/4 bg-white/10 rounded" />
                        <div className="h-1.5 w-full bg-white/10 rounded" />
                        <div className="absolute left-0 right-0 h-1 bg-primary blur-[2px] anim-scan" />
                      </div>
                      <div className="w-1/2 pl-3 flex flex-col justify-between">
                        <span className="text-[9px] text-[#AFA7FF] font-bold">诊断中: 78分 (良好)</span>
                        <div className="space-y-1 my-auto">
                          <div className="text-[8px] bg-red-500/10 text-red-300 border border-red-500/20 p-1 rounded font-semibold scale-95 origin-left">
                            ❌ 缺失量化成果
                          </div>
                          <div className="text-[8px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 p-1 rounded font-semibold scale-95 origin-left">
                            💡 建议增加高并发实绩
                          </div>
                        </div>
                        <span className="text-[8px] text-white/40 truncate">正在比对大前端 JD...</span>
                      </div>
                    </div>
                  ) : (
                    <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(192,193,255,0.08),transparent)] flex items-center justify-center">
                      <div className="absolute inset-0 bg-[#070b14]/70" />
                      <span className="material-symbols-outlined text-4xl text-amber-300/60 animate-pulse">description</span>
                    </div>
                  )}

                  <div className="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/85 via-black/0 to-black/0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-10">
                    <div className="p-3 flex items-center gap-3">
                      <button onClick={() => togglePlay("resume-analysis")} className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center border border-white/20 text-white cursor-pointer transition-transform hover:scale-105">
                        <span className="material-symbols-outlined text-sm">{playingVideo["resume-analysis"] ? "pause" : "play_arrow"}</span>
                      </button>
                      <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden relative">
                        <div className="absolute top-0 bottom-0 left-0 bg-primary transition-all duration-1000" style={{ width: `${(timelineSecs["resume-analysis"] / 150) * 100}%` }} />
                      </div>
                      <span className="text-[10px] font-mono text-white/50">{formatTime(timelineSecs["resume-analysis"])} / 2:30</span>
                    </div>
                  </div>

                  {!playingVideo["resume-analysis"] && (
                    <div onClick={() => togglePlay("resume-analysis")} className="absolute inset-0 flex items-center justify-center z-10 cursor-pointer bg-black/25">
                      <div className="w-12 h-12 rounded-full bg-white/10 hover:bg-primary/20 border border-white/20 hover:border-primary/40 flex items-center justify-center backdrop-blur-md transition-all transform hover:scale-110 shadow-2xl">
                        <span className="material-symbols-outlined text-xl text-white hover:text-primary fill-current">play_arrow</span>
                      </div>
                    </div>
                  )}
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
                  onClick={() => {
                    if (window.opener) {
                      window.opener.focus();
                      window.opener.location.href = "/training";
                    } else {
                      router.push("/training");
                    }
                  }}
                  className="self-start sm:self-center px-4 py-1.5 bg-primary/10 border border-primary/20 hover:bg-primary/20 text-[#AFA7FF] hover:text-white rounded-xl text-xs font-bold transition-all cursor-pointer"
                >
                  前往体验
                </button>
              </div>

              <p className="text-sm sm:text-base text-on-surface-variant/80 font-semibold leading-relaxed">
                置身真实求职战场。选择您的目标行业与岗位，面试官将针对您所投递的岗位生成结构化的精准提问，并根据您的现场回答进行启发式的连环追问。
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
                <div className="space-y-4 text-sm font-semibold text-on-surface-variant/70">
                  <h4 className="text-base font-bold text-white mb-2">💡 操作三步走：</h4>
                  <div className="flex gap-3">
                    <span className="w-5 h-5 rounded-full bg-white/5 border border-white/10 flex items-center justify-center shrink-0 text-white font-bold">1</span>
                    <p className="leading-relaxed">点击进入【面试训练场】页面，选择您想要挑战的岗位类别，比如“前端核心工程师”。</p>
                  </div>
                  <div className="flex gap-3">
                    <span className="w-5 h-5 rounded-full bg-white/5 border border-white/10 flex items-center justify-center shrink-0 text-white font-bold">2</span>
                    <p className="leading-relaxed">开启摄像头或麦克风权限后，点击【开始面试】。面试官将以视频/语音形式向您发起深度发问。</p>
                  </div>
                  <div className="flex gap-3">
                    <span className="w-5 h-5 rounded-full bg-white/5 border border-white/10 flex items-center justify-center shrink-0 text-white font-bold">3</span>
                    <p className="leading-relaxed">面试中支持“语音作答”或“文字回答”，答完自动生成专业的阶段性面试打分与多维度提升报告。</p>
                  </div>
                </div>

                {/* Mock Player */}
                <div className="relative rounded-2xl border border-white/10 bg-[#070b14] overflow-hidden aspect-video group shadow-xl">
                  {playingVideo["mock-interview"] ? (
                    <div className="absolute inset-0 flex bg-[#060a12] p-3 text-white">
                      <div className="w-1/2 bg-slate-900/60 rounded-xl border border-white/10 flex flex-col items-center justify-center p-3 relative overflow-hidden">
                        <div className="absolute w-24 h-24 rounded-full border border-primary/20 anim-ring-1 pointer-events-none" />
                        <div className="absolute w-24 h-24 rounded-full border border-primary/10 anim-ring-2 pointer-events-none" />
                        <div className="w-12 h-12 rounded-full bg-[#ffb2b7]/20 border border-[#ffb2b7]/40 flex items-center justify-center z-10">
                          <span className="material-symbols-outlined text-xl text-[#ffb2b7]">face</span>
                        </div>
                        <span className="text-[9px] font-bold text-white mt-2 z-10">AI 面试官 - 资深前端主管</span>
                        <span className="text-[8px] text-primary mt-1 font-mono font-bold tracking-widest z-10">SPEAKING...</span>
                      </div>
                      <div className="w-1/2 pl-3 flex flex-col justify-between">
                        <div className="bg-white/5 border border-white/10 rounded-lg p-2 text-[8px] text-white/70 font-mono leading-relaxed">
                          “请说一下你在处理大屏卡顿时是怎样进行性能调优的？”
                        </div>
                        <div className="bg-black/30 border border-white/5 rounded-lg p-2 text-center text-[8px] text-white/40">
                          📹 用户摄像头画面正常采集
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(192,193,255,0.08),transparent)] flex items-center justify-center">
                      <div className="absolute inset-0 bg-[#070b14]/70" />
                      <span className="material-symbols-outlined text-4xl text-primary/60 animate-pulse">interpreter_mode</span>
                    </div>
                  )}

                  <div className="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/85 via-black/0 to-black/0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-10">
                    <div className="p-3 flex items-center gap-3">
                      <button onClick={() => togglePlay("mock-interview")} className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center border border-white/20 text-white cursor-pointer transition-transform hover:scale-105">
                        <span className="material-symbols-outlined text-sm">{playingVideo["mock-interview"] ? "pause" : "play_arrow"}</span>
                      </button>
                      <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden relative">
                        <div className="absolute top-0 bottom-0 left-0 bg-primary transition-all duration-1000" style={{ width: `${(timelineSecs["mock-interview"] / 150) * 100}%` }} />
                      </div>
                      <span className="text-[10px] font-mono text-white/50">{formatTime(timelineSecs["mock-interview"])} / 2:30</span>
                    </div>
                  </div>

                  {!playingVideo["mock-interview"] && (
                    <div onClick={() => togglePlay("mock-interview")} className="absolute inset-0 flex items-center justify-center z-10 cursor-pointer bg-black/25">
                      <div className="w-12 h-12 rounded-full bg-white/10 hover:bg-primary/20 border border-white/20 hover:border-primary/40 flex items-center justify-center backdrop-blur-md transition-all transform hover:scale-110 shadow-2xl">
                        <span className="material-symbols-outlined text-xl text-white hover:text-primary fill-current">play_arrow</span>
                      </div>
                    </div>
                  )}
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
                  onClick={() => {
                    if (window.opener) {
                      window.opener.focus();
                      window.opener.location.href = "/memory?tab=advisor";
                    } else {
                      router.push("/memory?tab=advisor");
                    }
                  }}
                  className="self-start sm:self-center px-4 py-1.5 bg-primary/10 border border-primary/20 hover:bg-primary/20 text-[#AFA7FF] hover:text-white rounded-xl text-xs font-bold transition-all cursor-pointer"
                >
                  前往体验
                </button>
              </div>

              <p className="text-sm sm:text-base text-on-surface-variant/80 font-semibold leading-relaxed">
                您身边的全天候职业导师。解答面试技巧问题、技术难点答疑、薪酬谈判指导、以及各赛道细分岗位的技术成长规划。
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
                <div className="space-y-4 text-sm font-semibold text-on-surface-variant/70">
                  <h4 className="text-base font-bold text-white mb-2">💡 操作三步走：</h4>
                  <div className="flex gap-3">
                    <span className="w-5 h-5 rounded-full bg-white/5 border border-white/10 flex items-center justify-center shrink-0 text-white font-bold">1</span>
                    <p className="leading-relaxed">在【职业记忆看板】左侧工具栏中选择【AI 职业顾问】进入沉浸式双向对话终端。</p>
                  </div>
                  <div className="flex gap-3">
                    <span className="w-5 h-5 rounded-full bg-white/5 border border-white/10 flex items-center justify-center shrink-0 text-white font-bold">2</span>
                    <p className="leading-relaxed">直接用大白话输入您的问题，如“面试中遇到没准备过的算法题我该怎样和面试官沟通？”。</p>
                  </div>
                  <div className="flex gap-3">
                    <span className="w-5 h-5 rounded-full bg-white/5 border border-white/10 flex items-center justify-center shrink-0 text-white font-bold">3</span>
                    <p className="leading-relaxed">职业顾问将调用千亿级别垂直行业知识库，为您输出包含话术、技巧和技术拆解的高精回答。</p>
                  </div>
                </div>

                {/* Mock Player */}
                <div className="relative rounded-2xl border border-white/10 bg-[#070b14] overflow-hidden aspect-video group shadow-xl">
                  {playingVideo["career-advisor"] ? (
                    <div className="absolute inset-0 flex flex-col bg-[#060a12] p-3 text-white overflow-y-auto custom-scrollbar justify-between">
                      <div className="border-b border-white/5 pb-1 flex justify-between items-center shrink-0">
                        <span className="text-[10px] text-primary font-bold">AI 职业导师在线咨询...</span>
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                      </div>
                      <div className="flex-1 flex flex-col gap-2 py-2 overflow-hidden justify-end">
                        <div className="bg-white/5 border border-white/10 rounded-lg p-1.5 max-w-[85%] self-end text-[8px] font-mono">
                          👤 "大厂前端核心岗更看重什么能力？"
                        </div>
                        <div className="bg-primary/10 border border-primary/20 rounded-lg p-1.5 max-w-[85%] text-[8px] font-mono text-[#AFA7FF] slide-up">
                          🤖 "除了基础的前后端编码，最核心的加分点是：1. 性能调优实战；2. 工程脚手架落地；3. 业务高并发架构理解。"
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(192,193,255,0.08),transparent)] flex items-center justify-center">
                      <div className="absolute inset-0 bg-[#070b14]/70" />
                      <span className="material-symbols-outlined text-4xl text-primary/60 animate-pulse">psychology</span>
                    </div>
                  )}

                  <div className="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/85 via-black/0 to-black/0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-10">
                    <div className="p-3 flex items-center gap-3">
                      <button onClick={() => togglePlay("career-advisor")} className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center border border-white/20 text-white cursor-pointer transition-transform hover:scale-105">
                        <span className="material-symbols-outlined text-sm">{playingVideo["career-advisor"] ? "pause" : "play_arrow"}</span>
                      </button>
                      <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden relative">
                        <div className="absolute top-0 bottom-0 left-0 bg-primary transition-all duration-1000" style={{ width: `${(timelineSecs["career-advisor"] / 150) * 100}%` }} />
                      </div>
                      <span className="text-[10px] font-mono text-white/50">{formatTime(timelineSecs["career-advisor"])} / 2:30</span>
                    </div>
                  </div>

                  {!playingVideo["career-advisor"] && (
                    <div onClick={() => togglePlay("career-advisor")} className="absolute inset-0 flex items-center justify-center z-10 cursor-pointer bg-black/25">
                      <div className="w-12 h-12 rounded-full bg-white/10 hover:bg-primary/20 border border-white/20 hover:border-primary/40 flex items-center justify-center backdrop-blur-md transition-all transform hover:scale-110 shadow-2xl">
                        <span className="material-symbols-outlined text-xl text-white hover:text-primary fill-current">play_arrow</span>
                      </div>
                    </div>
                  )}
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
            © 2026 面试VAR AI · Built with AI · Made for Career Growth
          </span>
        </div>
      </footer>

    </div>
  );
}
