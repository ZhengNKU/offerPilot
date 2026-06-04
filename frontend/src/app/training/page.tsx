'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth, UserMenu } from "@/components/AuthProvider";

export default function InterviewTrainingPage() {
  const router = useRouter();
  const auth = useAuth();

  // --- INTERACTIVE SYSTEM STATES ---
  const [targetRole, setTargetRole] = useState('后端开发工程师');
  const [jobLevel, setJobLevel] = useState('高级 (P6-P7)');
  const [interviewType, setInterviewType] = useState('技术面试 - 系统设计');
  const [companyStyle, setCompanyStyle] = useState('字节跳动');
  const [difficulty, setDifficulty] = useState('Lv3 困难');

  const [isTrainingStarted, setIsTrainingStarted] = useState(false);
  const [isCountingDown, setIsCountingDown] = useState(false);
  const [countdownNum, setCountdownNum] = useState(3);

  // Device Toggles
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [isMicOn, setIsMicOn] = useState(true);
  
  // Real Webcam Streams
  const videoRef = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);

  // Interview state simulator
  const [currentTime, setCurrentTime] = useState(765); // 12:45 in seconds
  const [thinkingTimeLeft, setThinkingTimeLeft] = useState(0);
  const [activeQuestionIndex, setActiveQuestionIndex] = useState(1); // 0-indexed items, 1 represents "进行中"
  const [isInterviewerSpeaking, setIsInterviewerSpeaking] = useState(false);
  const [speechText, setSpeechText] = useState('语音识别中... ||||||||');

  // Floating notifications
  const [showHandBadge, setShowHandBadge] = useState(false);
  const [isThinkingPaused, setIsThinkingPaused] = useState(false);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');
  
  // Dynamic metrics simulator
  const [metrics, setMetrics] = useState({
    clarity: 82,
    logic: 75,
    speed: 68,
    eyeContact: 88,
    confidence: 76,
    keyword: 65,
  });

  // Active dialogue logs
  const [dialogue, setDialogue] = useState([
    { role: 'interviewer', name: 'AI 面试官', time: '12:45', text: '你好，我是你的 AI 面试官。请你介绍一下你最近负责的一个核心项目。' },
    { role: 'user', name: '你', time: '12:52', text: '我最近负责的项目是一个高并发的订单系统，主要用于支持电商平台的秒杀活动。这个项目的核心挑战是如何在短时间内处理大量的并发请求，保证系统的稳定性和一致性。' },
    { role: 'interviewer', name: 'AI 面试官', time: '12:58', text: '好的，能详细说说你是如何设计系统架构来应对高并发的吗？' }
  ]);

  // Handle camera toggles (Webcam API)
  useEffect(() => {
    if (isCameraOn) {
      navigator.mediaDevices.getUserMedia({ video: { width: 480, height: 360 } })
        .then((mediaStream) => {
          setStream(mediaStream);
          if (videoRef.current) {
            videoRef.current.srcObject = mediaStream;
          }
        })
        .catch((err) => {
          console.error("Camera access denied or unavailable: ", err);
          setIsCameraOn(false);
        });
    } else {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
        setStream(null);
      }
    }
    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [isCameraOn]);

  // Main Timer ticks
  useEffect(() => {
    let interval: any = null;
    if (isTrainingStarted && !isThinkingPaused) {
      interval = setInterval(() => {
        setCurrentTime((prev) => prev + 1);
        
        // Randomly jitter scoring metrics to simulate AI real-time analysis
        setMetrics((prev) => ({
          clarity: Math.min(100, Math.max(50, prev.clarity + (Math.random() > 0.5 ? 1 : -1))),
          logic: Math.min(100, Math.max(50, prev.logic + (Math.random() > 0.5 ? 1 : -1))),
          speed: Math.min(100, Math.max(50, prev.speed + (Math.random() > 0.5 ? 1 : -1))),
          eyeContact: Math.min(100, Math.max(50, prev.eyeContact + (Math.random() > 0.5 ? 1 : -1))),
          confidence: Math.min(100, Math.max(50, prev.confidence + (Math.random() > 0.5 ? 1 : -1))),
          keyword: Math.min(100, Math.max(50, prev.keyword + (Math.random() > 0.5 ? 1 : -1))),
        }));
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isTrainingStarted, isThinkingPaused]);

  // Countdown handler before interview starts
  const handleStartTraining = () => {
    setIsCountingDown(true);
    setCountdownNum(3);
    
    const countInterval = setInterval(() => {
      setCountdownNum((prev) => {
        if (prev <= 1) {
          clearInterval(countInterval);
          setIsCountingDown(false);
          setIsTrainingStarted(true);
          setIsCameraOn(true); // Automatically request camera for high immersion
          return 3;
        }
        return prev - 1;
      });
    }, 1000);
  };

  // Skip / Move to next question simulator
  const handleSkipQuestion = () => {
    if (activeQuestionIndex >= 5) {
      alert("模拟面试已完成所有环节！正在生成AI面试报告...");
      setIsTrainingStarted(false);
      localStorage.setItem("offerPilot_viewing_session", "true");
      localStorage.setItem("offerPilot_report_mode", "audio");
      localStorage.setItem("offerPilot_session_company", companyStyle);
      localStorage.setItem("offerPilot_session_role", targetRole);
      localStorage.setItem("offerPilot_session_round", interviewType);
      localStorage.setItem("offerPilot_session_grade", "P6 / L5");
      localStorage.setItem("offerPilot_session_salary", "25K * 16薪");
      localStorage.setItem("offerPilot_session_date", "2026-05-31");
      router.push("/debugger/report");
      return;
    }

    const nextIndex = activeQuestionIndex + 1;
    setActiveQuestionIndex(nextIndex);

    // Simulate AI interviewer speaking next question
    setIsInterviewerSpeaking(true);
    const nextQuestions = [
      { text: "在自我介绍中你提到了分布式锁，能分享一下 Redis 分布式锁的实现细节与防死锁设计吗？" },
      { text: "在高并发写场景下，你是如何应用消息队列（MQ）进行流量削峰的？如何保证消息不丢失和幂等消费？" },
      { text: "从系统架构设计的角度来看，当数据库主从延迟增大时，你会采取哪些具体的架构优化方案？" },
      { text: "感谢你今天精彩的回答。我们会基于你在系统设计、表达逻辑、抗压能力和高并发架构的全面表现生成 AI 面试报告，你有什么想问我的吗？" }
    ];

    const targetText = nextQuestions[nextIndex - 2]?.text || "请继续说明你的架构方案细节。";

    // Add user placeholder message
    const formattedTime = formatTime(currentTime);
    const userMsg = { role: 'user', name: '你', time: formattedTime, text: '我认为面对这个场景，架构设计应该优先考虑读写分离与缓存异步双删策略...' };
    
    setDialogue(prev => [...prev, userMsg]);

    setTimeout(() => {
      setIsInterviewerSpeaking(false);
      const aiTime = formatTime(currentTime + 5);
      const aiMsg = { role: 'interviewer', name: 'AI 面试官', time: aiTime, text: targetText };
      setDialogue(prev => [...prev, aiMsg]);
    }, 3000);
  };

  // Thinking Time simulator (+60 seconds)
  const handleThinkingTime = () => {
    setIsThinkingPaused(true);
    setThinkingTimeLeft(60);
    const thinkingInterval = setInterval(() => {
      setThinkingTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(thinkingInterval);
          setIsThinkingPaused(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  // Convert raw seconds to MM:SS format
  const formatTime = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const remainingSecs = secs % 60;
    return `${mins.toString().padStart(2, '0')}:${remainingSecs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="min-h-screen bg-background flex flex-col font-body-md text-on-surface antialiased overflow-x-hidden relative selection:bg-primary/30 selection:text-white pb-0 pt-20">
      
      {/* Background Gradients & Matrix Scifi Grid */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff03_1px,transparent_1px),linear-gradient(to_bottom,#ffffff03_1px,transparent_1px)] bg-[size:32px_32px] pointer-events-none z-0" />
      <div className="absolute top-[10%] left-[-15%] w-[50%] h-[50%] bg-primary/10 rounded-full blur-[160px] pointer-events-none z-0 animate-pulse" />
      <div className="absolute bottom-[15%] right-[-15%] w-[45%] h-[45%] bg-secondary/80 rounded-full blur-[200px] pointer-events-none z-0 opacity-10" />

      {/* ========================================================
          TOP NAVIGATION BAR (Pixel Perfect Alignment)
         ======================================================== */}
      <nav className="fixed top-0 w-full z-40 bg-surface/80 backdrop-blur-xl border-b border-white/10">
        <div className="px-gutter h-20 max-w-container-max mx-auto flex justify-between items-center relative">
          
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
            <a onClick={() => router.push("/memory")} className="text-on-surface-variant hover:text-on-surface transition-colors text-[16px] md:text-[17px] font-extrabold cursor-pointer">
              职业记忆看板
            </a>
            <a onClick={() => router.push("/training")} className="text-primary transition-colors text-[16px] md:text-[17px] font-extrabold cursor-pointer relative after:content-[''] after:absolute after:bottom-[-26px] after:left-0 after:right-0 after:h-[2px] after:bg-primary">
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
              <span className="material-symbols-outlined text-base">history</span>历史面试
            </button>
            <button onClick={() => router.push("/home")} className="px-3.5 py-2 hover:bg-white/5 text-on-surface-variant hover:text-white rounded-full transition-colors flex items-center gap-1 cursor-pointer">
              <span className="material-symbols-outlined text-lg">settings</span>设置
            </button>
            {auth.isLoggedIn ? (
              <UserMenu />
            ) : (
              <>
                <button
                  onClick={() => auth.setShowLogin(true)}
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

      {/* ========================================================
          MAIN WORKSPACE LAYOUT container (Full Width)
         ======================================================== */}
      <div className="flex-1 max-w-container-max mx-auto w-full px-gutter py-8 flex flex-col gap-6 relative z-10">
        
        <div className="grid grid-cols-12 gap-6 items-stretch w-full">
          
          {/* ========================================================
              LEFT COLUMN: Configuration Console (开始模拟面试)
             ======================================================== */}
          <div className="col-span-12 lg:col-span-3 flex flex-col justify-between gap-6 h-full">
            <div className="glass-panel p-5.5 rounded-3xl border-white/10 flex flex-col h-full gap-5.5 text-left">
              
              <div className="pb-3 border-b border-white/5 shrink-0">
                <h3 className="text-lg font-black text-white">开始模拟面试</h3>
                <p className="text-[11px] text-on-surface-variant/40 font-bold mt-1 uppercase tracking-wider">Configure your training</p>
              </div>

              {/* Configurations Fields */}
              <div className="space-y-4 flex-1 overflow-y-auto pr-1">
                
                {/* Field 1: Target Role */}
                <div className="space-y-1.5">
                  <label className="text-[13px] md:text-[14px] text-on-surface-variant/50 font-label-mono uppercase tracking-wider font-extrabold block">目标岗位</label>
                  <div className="relative">
                    <input 
                      type="text"
                      disabled={isTrainingStarted}
                      value={targetRole}
                      onChange={(e) => setTargetRole(e.target.value)}
                      placeholder="请输入目标岗位"
                      className="w-full bg-white/[0.02] hover:bg-white/[0.04] border border-white/5 focus:border-primary/50 text-white rounded-xl py-3 px-4 text-sm font-black focus:outline-none transition-all placeholder:text-white/20"
                    />
                  </div>
                </div>

                {/* Field 2: Job Level */}
                <div className="space-y-1.5">
                  <label className="text-[13px] md:text-[14px] text-on-surface-variant/50 font-label-mono uppercase tracking-wider font-extrabold block">职位级别</label>
                  <div className="relative">
                    <input 
                      type="text"
                      disabled={isTrainingStarted}
                      value={jobLevel}
                      onChange={(e) => setJobLevel(e.target.value)}
                      placeholder="请输入职位级别"
                      className="w-full bg-white/[0.02] hover:bg-white/[0.04] border border-white/5 focus:border-primary/50 text-white rounded-xl py-3 px-4 text-sm font-black focus:outline-none transition-all placeholder:text-white/20"
                    />
                  </div>
                </div>

                {/* Field 3: Interview Type */}
                <div className="space-y-1.5">
                  <label className="text-[13px] md:text-[14px] text-on-surface-variant/50 font-label-mono uppercase tracking-wider font-extrabold block">面试类型</label>
                  <div className="relative">
                    <select 
                      disabled={isTrainingStarted}
                      value={interviewType}
                      onChange={(e) => setInterviewType(e.target.value)}
                      className="w-full bg-white/[0.02] hover:bg-white/[0.04] border border-white/5 focus:border-primary/50 text-white rounded-xl py-3 px-4 text-sm font-black appearance-none cursor-pointer focus:outline-none transition-all"
                    >
                      <option value="技术面试 - 系统设计" className="bg-[#0b1326] text-white">技术面试 - 系统设计</option>
                      <option value="技术面试 - 算法架构" className="bg-[#0b1326] text-white">技术面试 - 算法架构</option>
                      <option value="行为面试 - 综合能力" className="bg-[#0b1326] text-white">行为面试 - 综合能力</option>
                      <option value="项目深挖面试" className="bg-[#0b1326] text-white">项目深挖面试</option>
                    </select>
                    <span className="material-symbols-outlined absolute right-3.5 top-3.5 text-on-surface-variant/40 text-base pointer-events-none select-none">expand_more</span>
                  </div>
                </div>

                {/* Field 4: Company Style */}
                <div className="space-y-1.5">
                  <label className="text-[13px] md:text-[14px] text-on-surface-variant/50 font-label-mono uppercase tracking-wider font-extrabold block">公司风格</label>
                  <div className="relative">
                    <select 
                      disabled={isTrainingStarted}
                      value={companyStyle}
                      onChange={(e) => setCompanyStyle(e.target.value)}
                      className="w-full bg-white/[0.02] hover:bg-white/[0.04] border border-white/5 focus:border-primary/50 text-white rounded-xl py-3 px-4 text-sm font-black appearance-none cursor-pointer focus:outline-none transition-all"
                    >
                      <option value="字节跳动" className="bg-[#0b1326] text-white">字节跳动</option>
                      <option value="腾讯" className="bg-[#0b1326] text-white">腾讯</option>
                      <option value="阿里巴巴" className="bg-[#0b1326] text-white">阿里巴巴</option>
                      <option value="美团" className="bg-[#0b1326] text-white">美团</option>
                    </select>
                    <span className="material-symbols-outlined absolute right-3.5 top-3.5 text-on-surface-variant/40 text-base pointer-events-none select-none">expand_more</span>
                  </div>
                </div>

                {/* Field 5: Difficulty Level */}
                <div className="space-y-1.5">
                  <label className="text-[13px] md:text-[14px] text-on-surface-variant/50 font-label-mono uppercase tracking-wider font-extrabold block">难度等级</label>
                  <div className="relative">
                    <select 
                      disabled={isTrainingStarted}
                      value={difficulty}
                      onChange={(e) => setDifficulty(e.target.value)}
                      className="w-full bg-white/[0.02] hover:bg-white/[0.04] border border-white/5 focus:border-primary/50 text-white rounded-xl py-3 px-4 text-sm font-black appearance-none cursor-pointer focus:outline-none transition-all"
                    >
                      <option value="Lv3 困难" className="bg-[#0b1326] text-white">Lv3 困难</option>
                      <option value="Lv1 简单" className="bg-[#0b1326] text-white">Lv1 简单</option>
                      <option value="Lv2 一般" className="bg-[#0b1326] text-white">Lv2 一般</option>
                      <option value="Lv4 地狱" className="bg-[#0b1326] text-white">Lv4 地狱</option>
                    </select>
                    <span className="material-symbols-outlined absolute right-3.5 top-3.5 text-on-surface-variant/40 text-base pointer-events-none select-none">expand_more</span>
                  </div>
                </div>

              </div>

              {/* Bottom Metadata Summary Panel */}
              <div className="p-4 rounded-2xl bg-white/[0.01] border border-white/5 space-y-2 shrink-0">
                <span className="text-[10px] text-on-surface-variant/40 font-label-mono tracking-widest uppercase block font-extrabold">本次训练信息</span>
                <div className="space-y-1.5 text-xs text-on-surface-variant/80 font-bold">
                  <p className="flex justify-between"><span>预计时长:</span> <span className="text-white font-black font-label-mono">30 分钟</span></p>
                  <p className="flex justify-between"><span>问题数量:</span> <span className="text-white font-black font-label-mono">12-15 道</span></p>
                  <p className="flex justify-between"><span>包含追问:</span> <span className="text-white font-black font-label-mono">3 轮追问</span></p>
                  <p className="flex justify-between"><span>AI 面试官:</span> <span className="text-tertiary font-black">技术专家 (系统设计)</span></p>
                </div>
              </div>

              {/* Start Training Gradient Trigger */}
              <div className="space-y-3 shrink-0">
                <button
                  disabled={isTrainingStarted || isCountingDown}
                  onClick={handleStartTraining}
                  className="w-full py-3.5 bg-gradient-to-r from-secondary to-primary text-on-primary text-sm font-black rounded-xl hover:scale-[1.01] active:scale-98 disabled:opacity-50 disabled:scale-100 transition-all shadow-lg shadow-secondary/20 cursor-pointer flex items-center justify-center gap-2 group"
                >
                  <span className="material-symbols-outlined text-base animate-pulse">play_arrow</span>
                  {isTrainingStarted ? "正在进行模拟面试" : "开始模拟面试"}
                </button>
                <span 
                  onClick={() => alert("模拟面试将调用摄像头与麦克风，录音本地加密处理，OfferPilot 深度保护您的隐私权益。")}
                  className="text-[10px] font-bold text-on-surface-variant/30 hover:text-white transition-colors cursor-pointer text-center block"
                >
                  开始即表示同意 <span className="text-primary hover:underline">训练规范与用户权益 →</span>
                </span>
              </div>

            </div>
          </div>

          {/* ========================================================
              CENTER COLUMN: The Live Interactive Simulator Panel
             ======================================================== */}
          <div className="col-span-12 lg:col-span-6 flex flex-col justify-between gap-6 h-full min-w-0">
            <div className="glass-panel p-5.5 rounded-3xl border-white/10 flex flex-col h-full gap-5 relative overflow-hidden">
              
              {/* COUNTDOWN SCREEN overlay before starting */}
              <AnimatePresence>
                {isCountingDown && (
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 bg-[#0b1326]/95 z-30 flex flex-col items-center justify-center gap-6"
                  >
                    <div className="w-32 h-32 rounded-full border-4 border-dashed border-primary flex items-center justify-center relative animate-[spin_10s_linear_infinite]">
                      <div className="absolute inset-4 rounded-full border border-double border-white/15" />
                    </div>
                    <div className="absolute flex flex-col items-center justify-center text-center">
                      <motion.span 
                        key={countdownNum}
                        initial={{ scale: 0.5, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 1.5, opacity: 0 }}
                        transition={{ duration: 0.5 }}
                        className="text-6xl font-black font-label-mono text-white"
                      >
                        {countdownNum}
                      </motion.span>
                      <span className="text-xs text-on-surface-variant/45 font-bold uppercase tracking-widest mt-2">
                        AI 面试官准备中...
                      </span>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* OFFLINE ONBOARDING PREVIEW (When Simulator has NOT started) */}
              {!isTrainingStarted && !isCountingDown && (
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-center gap-6 z-10 select-none">
                  <div className="w-24 h-24 rounded-3xl bg-primary/10 border border-primary/20 flex items-center justify-center shadow-lg relative group overflow-hidden transition-transform duration-300">
                    <div className="absolute inset-0 bg-gradient-to-tr from-primary/15 to-transparent" />
                    <span className="material-symbols-outlined text-primary animate-pulse relative z-10" style={{ fontSize: "56px" }}>support_agent</span>
                  </div>
                  
                  <div className="space-y-2 max-w-md">
                    <h3 className="text-xl font-black text-white flex items-center justify-center gap-1.5">
                      配置完成，准备就绪
                    </h3>
                    <p className="text-xs text-on-surface-variant/50 leading-relaxed font-semibold">
                      点击左下角 <span className="font-black text-white">“开始模拟面试”</span> 按钮即可唤醒您的 AI 资深面试官。系统将模拟 3D 真人面试情境，支持全真音画调试、实时答题逻辑剖析与分段评分。
                    </p>
                  </div>
                  
                  {/* Scifi indicator lines */}
                  <div className="flex items-center gap-4 w-full max-w-xs text-[10px] text-on-surface-variant/30 font-label-mono font-bold">
                    <div className="h-px bg-white/5 flex-1" />
                    <span>OFFLINE SIMULATION</span>
                    <div className="h-px bg-white/5 flex-1" />
                  </div>
                </div>
              )}

              {/* SIMULATOR CORE SCREEN (When Simulator IS Active) */}
              {isTrainingStarted && (
                <>
                  {/* Simulator Header */}
                  <div className="flex justify-between items-center pb-2.5 border-b border-white/5 shrink-0">
                    <div className="flex items-center gap-3">
                      <span className="w-2.5 h-2.5 rounded-full bg-tertiary animate-ping" />
                      <span className="text-sm font-black text-white flex items-center gap-2.5">
                        面试进行中
                        <span className="px-2.5 py-0.5 bg-white/5 rounded border border-white/5 text-xs text-on-surface-variant/60 font-bold font-label-mono">
                          {formatTime(currentTime)}
                        </span>
                      </span>
                    </div>

                    {/* Quick controls bar */}
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={() => setIsCameraOn(!isCameraOn)}
                        className={`px-3 py-1.5 rounded-xl border text-[11px] font-black flex items-center gap-1 cursor-pointer transition-all ${
                          isCameraOn ? "bg-primary/10 border-primary text-primary" : "bg-white/5 border-white/5 text-on-surface-variant/50"
                        }`}
                      >
                        <span className="material-symbols-outlined text-sm">{isCameraOn ? "videocam" : "videocam_off"}</span>
                        摄像头
                      </button>
                      <button 
                        onClick={() => setIsMicOn(!isMicOn)}
                        className={`px-3 py-1.5 rounded-xl border text-[11px] font-black flex items-center gap-1 cursor-pointer transition-all ${
                          isMicOn ? "bg-tertiary/10 border-tertiary text-tertiary" : "bg-white/5 border-white/5 text-on-surface-variant/50"
                        }`}
                      >
                        <span className="material-symbols-outlined text-sm">{isMicOn ? "mic" : "mic_off"}</span>
                        麦克风
                      </button>
                      <button 
                        onClick={() => {
                          if(confirm("确定要提前结束本次模拟面试并导出分析报告吗？")) {
                            setIsTrainingStarted(false);
                            localStorage.setItem("offerPilot_viewing_session", "true");
                            localStorage.setItem("offerPilot_report_mode", "audio");
                            localStorage.setItem("offerPilot_session_company", companyStyle);
                            localStorage.setItem("offerPilot_session_role", targetRole);
                            localStorage.setItem("offerPilot_session_round", interviewType);
                            localStorage.setItem("offerPilot_session_grade", "P6 / L5");
                            localStorage.setItem("offerPilot_session_salary", "25K * 16薪");
                            localStorage.setItem("offerPilot_session_date", "2026-05-31");
                            router.push("/debugger/report");
                          }
                        }}
                        className="px-3.5 py-1.5 bg-secondary/15 border border-secondary/25 hover:bg-secondary/25 hover:border-secondary/40 text-secondary rounded-xl text-[11px] font-black cursor-pointer transition-all flex items-center gap-1"
                      >
                        <span className="material-symbols-outlined text-sm">cancel</span>
                        结束面试
                      </button>
                    </div>
                  </div>

                  {/* VIDEO SPLIT CONTAINERS (AI and You) */}
                  <div className="grid grid-cols-2 gap-4 flex-1 items-stretch py-1 min-h-[220px]">
                    
                    {/* Left Frame: AI Interviewer */}
                    <div className="relative rounded-2xl bg-slate-900 border border-white/10 overflow-hidden flex items-center justify-center shadow-2xl flex-1 group">
                      <img 
                        src="/debugger-1.jpg" 
                        alt="AI Interviewer" 
                        className="w-full h-full object-cover select-none pointer-events-none group-hover:scale-102 transition-transform duration-700" 
                      />
                      
                      {/* Interviewer Active speaking state overlay */}
                      {isInterviewerSpeaking && (
                        <div className="absolute inset-0 bg-primary/5 pointer-events-none border border-primary/20 animate-pulse" />
                      )}

                      {/* Header Badge */}
                      <span className="absolute left-3.5 top-3 px-2 py-0.5 rounded-lg bg-black/60 backdrop-blur-md text-[10px] text-white/90 font-bold border border-white/5 select-none z-10 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 bg-primary rounded-full animate-ping" />
                        AI 面试官 · 技术专家
                      </span>

                      {/* Video Subtitle Subtext bubble overlay */}
                      <div className="absolute inset-x-3.5 bottom-3.5 p-3 rounded-xl bg-black/85 backdrop-blur-md border border-white/10 text-left space-y-1 z-10 max-h-[85px] overflow-y-auto">
                        <span className="text-[9px] text-primary font-black font-label-mono uppercase block tracking-wider">REALTIME DIALOGUE</span>
                        <p className="text-[11px] leading-relaxed text-white font-extrabold">
                          你好，我是你的 AI 面试官。请你介绍一下你最近负责的一个核心项目。
                        </p>
                      </div>

                      {/* Speech pulsing waveform overlay */}
                      <div className="absolute right-3.5 top-3 flex items-center gap-0.5 h-3 select-none">
                        {[1, 2, 3, 4, 5].map((bar) => (
                          <div 
                            key={bar} 
                            style={{ animationDelay: `${bar * 0.15}s` }}
                            className={`w-0.5 bg-primary rounded-full animate-[pulse_0.75s_infinite_alternate] ${isInterviewerSpeaking ? 'h-3.5' : 'h-1.5'}`} 
                          />
                        ))}
                      </div>
                    </div>

                    {/* Right Frame: You (Real Webcam Stream or Placeholder) */}
                    <div className="relative rounded-2xl bg-slate-900 border border-white/10 overflow-hidden flex items-center justify-center shadow-2xl flex-1 group">
                      
                      {/* Real Webcam rendering element */}
                      <video 
                        ref={videoRef} 
                        autoPlay 
                        playsInline 
                        muted 
                        className={`w-full h-full object-cover transform -scale-x-100 ${isCameraOn ? 'block' : 'hidden'}`}
                      />

                      {/* Camera Placeholder Avatar */}
                      {!isCameraOn && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center bg-gradient-to-b from-[#141b2e] to-slate-950 gap-3 select-none">
                          <div className="w-12 h-12 rounded-full border border-white/10 flex items-center justify-center bg-white/[0.01]">
                            <span className="material-symbols-outlined text-2xl text-on-surface-variant/40 animate-pulse">videocam_off</span>
                          </div>
                          <p className="text-[10px] text-on-surface-variant/30 font-bold leading-normal max-w-[150px]">
                            摄像头已禁用。请开启顶部“摄像头”按钮以体验全真视频面试调试。
                          </p>
                        </div>
                      )}

                      {/* Header Badge */}
                      <span className="absolute left-3.5 top-3 px-2 py-0.5 rounded-lg bg-black/60 backdrop-blur-md text-[10px] text-white/90 font-bold border border-white/5 select-none z-10 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 bg-tertiary rounded-full animate-ping" />
                        你
                      </span>

                      {/* Audio Level Waveform visualizer */}
                      <div className="absolute right-3.5 top-3 flex items-center gap-0.5 h-3 select-none">
                        {[1, 2, 3, 4, 5].map((bar) => (
                          <div 
                            key={bar} 
                            style={{ animationDelay: `${bar * 0.1}s` }}
                            className="w-0.5 bg-tertiary rounded-full h-2.5 animate-[pulse_0.6s_infinite_alternate]" 
                          />
                        ))}
                      </div>

                    </div>
                  </div>

                  {/* REALTIME SCORE METRICS EVALUATION SECTION */}
                  <div className="space-y-2.5 shrink-0 text-left">
                    
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-white font-black flex items-center gap-1.5 select-none">
                        <span className="material-symbols-outlined text-base text-secondary animate-pulse" style={{ fontVariationSettings: "'wght' 700" }}>insights</span>
                        实时表现反馈
                      </span>
                      <span className="text-xs font-label-mono font-bold text-on-surface-variant/40 select-none">
                        AI ENGINE VERSION 4.2
                      </span>
                    </div>

                    {/* Grid of 6 metrics cells */}
                    <div className="grid grid-cols-3 gap-3.5">
                      {[
                        { label: "表达清晰度", score: metrics.clarity, tag: "良好", color: "text-[#4edea3] bg-[#4edea3]/10 border-[#4edea3]/20" },
                        { label: "逻辑结构", score: metrics.logic, tag: "一般", color: "text-[#60a5fa] bg-[#60a5fa]/10 border-[#60a5fa]/20" },
                        { label: "语速语调", score: metrics.speed, tag: "偏慢", color: "text-amber-400 bg-amber-400/10 border-amber-400/20" },
                        { label: "眼神接触", score: metrics.eyeContact, tag: "良好", color: "text-[#4edea3] bg-[#4edea3]/10 border-[#4edea3]/20" },
                        { label: "自信程度", score: metrics.confidence, tag: "良好", color: "text-[#4edea3] bg-[#4edea3]/10 border-[#4edea3]/20" },
                        { label: "关键词覆盖", score: metrics.keyword, tag: "一般", color: "text-[#60a5fa] bg-[#60a5fa]/10 border-[#60a5fa]/20" }
                      ].map((cell, idx) => (
                        <div key={idx} className="p-3 rounded-2xl bg-white/[0.01] border border-white/5 flex flex-col gap-2 relative overflow-hidden group">
                          
                          {/* Inner glowing hover effect */}
                          <div className="absolute inset-0 bg-white/[0.01] opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />

                          <div className="flex justify-between items-center text-xs text-on-surface-variant/40 font-bold select-none">
                            <span>{cell.label}</span>
                            <span className="material-symbols-outlined text-xs scale-90">zoom_out_map</span>
                          </div>

                          <div className="flex items-baseline gap-2 shrink-0">
                            <span className="text-xl font-black font-label-mono text-white">{cell.score}</span>
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-black uppercase ${cell.color}`}>
                              {cell.tag}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Alerts / Tips footer block */}
                    <div className="p-3 rounded-2xl bg-white/[0.01] border border-white/5 flex items-center justify-between gap-4 text-xs font-semibold text-on-surface-variant/60 relative overflow-hidden select-none">
                      <span className="flex items-center gap-1.5 text-xs">
                        <span className="material-symbols-outlined text-base text-[#c0c1ff]">lightbulb</span>
                        小贴士: 尝试使用 PREP 框架 (Point-Reason-Example-Point) 来组织回答，会让你的表达更有条理。
                      </span>
                      <span className="text-xs text-[#ffb2b7] font-bold font-label-mono shrink-0 flex items-center gap-1">
                        AI 实时分析中...
                        <span className="w-1.5 h-1.5 rounded-full bg-primary animate-ping" />
                      </span>
                    </div>

                  </div>
                </>
              )}

              {/* TABS INTERACTIVE DIALOGUE SYSTEM */}
              <div className="border-t border-white/5 pt-5 space-y-4 shrink-0 text-left">
                
                {/* Custom Dialogue Tab Headers */}
                <div className="flex items-center gap-5 border-b border-white/5 pb-2 font-black text-xs md:text-[13px] select-none">
                  <span className="text-white border-b-2 border-primary pb-2 cursor-pointer relative z-10">实时对话</span>
                  <span className="text-on-surface-variant/45 hover:text-white transition-colors cursor-pointer" onClick={() => alert("AI 面试官已自动为您记录面试笔记。")}>面试笔记</span>
                  <span className="text-on-surface-variant/45 hover:text-white transition-colors cursor-pointer" onClick={() => alert("答题结束后，OfferPilot 会基于您的整体表现生成全维度 AI 诊断意见。")}>AI 建议</span>
                  <span className="text-on-surface-variant/45 hover:text-white transition-colors cursor-pointer" onClick={() => alert("本环节的参考答案：深入剖析秒杀高并发一致性读写流程，推荐使用分布式削峰缓冲。")}>参考答案</span>
                </div>

                {/* Dialog Content Stream Area */}
                <div className="space-y-4 max-h-[175px] overflow-y-auto pr-1">
                  
                  {/* Map dialogue array */}
                  {dialogue.map((item, idx) => (
                    <div key={idx} className="flex items-start gap-3">
                      {/* Avatar */}
                      <div className={`w-7.5 h-7.5 rounded-full shrink-0 flex items-center justify-center font-bold text-xs select-none ${
                        item.role === 'interviewer' ? 'bg-primary/20 text-primary border border-primary/30' : 'bg-tertiary/20 text-tertiary border border-tertiary/30'
                      }`}>
                        {item.role === 'interviewer' ? 'AI' : '你'}
                      </div>
                      
                      <div className="space-y-1 flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-xs font-black text-white">{item.name}</span>
                          <span className="text-[10px] text-on-surface-variant/40 font-label-mono">{item.time}</span>
                        </div>
                        <p className="text-[12px] text-on-surface-variant/80 font-bold leading-relaxed pr-6">
                          {item.text}
                        </p>
                      </div>
                    </div>
                  ))}

                </div>

                {/* Bottom speech recognition simulator */}
                {isTrainingStarted && (
                  <div className="flex justify-between items-center py-2.5 px-4.5 rounded-2xl bg-white/[0.01] border border-white/5 relative overflow-hidden select-none">
                    <span className="text-xs text-on-surface-variant/40 font-semibold flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 bg-tertiary rounded-full animate-ping" />
                      当前识别模式: 麦克风录音中
                    </span>
                    
                    <div className="flex items-center gap-2 text-xs font-black text-primary font-label-mono">
                      <span>{speechText}</span>
                    </div>
                  </div>
                )}

              </div>

            </div>
          </div>

          {/* ========================================================
              RIGHT COLUMN: Timeline & Current HUD Progress
             ======================================================== */}
          <div className="col-span-12 lg:col-span-3 flex flex-col justify-between gap-6 h-full text-left">
            
            {/* WIDGET 1: INTERVIEW TIMELINE PROGRESS */}
            <div className="glass-panel p-5.5 rounded-3xl border-white/10 flex flex-col justify-start gap-4">
              <div className="flex justify-between items-center pb-2.5 border-b border-white/5 shrink-0">
                <h4 className="text-base font-black text-white flex items-center gap-2">
                  <span className="material-symbols-outlined text-lg text-primary">schedule</span>
                  面试进度
                </h4>
                <span className="text-xs text-primary font-black font-label-mono flex items-center gap-0.5">
                  <span className="material-symbols-outlined text-xs">hourglass_empty</span>
                  12:45 / 30:00
                </span>
              </div>

              {/* Vertical checklist items */}
              <div className="space-y-4 py-1 mt-[-2px] relative pl-5.5">
                <div className="absolute left-1.5 top-2.5 bottom-2.5 w-0.5 bg-white/5" />

                {[
                  { id: 1, label: "自我介绍", duration: "02:30", status: "completed", color: "bg-tertiary" },
                  { id: 2, label: "项目介绍", duration: "进行中 10:15", status: "active", color: "bg-primary" },
                  { id: 3, label: "技术深挖", duration: "等候中", status: "pending", color: "bg-white/5" },
                  { id: 4, label: "系统设计", duration: "等候中", status: "pending", color: "bg-white/5" },
                  { id: 5, label: "追问环节", duration: "等候中", status: "pending", color: "bg-white/5" },
                  { id: 6, label: "总结评价", duration: "等候中", status: "pending", color: "bg-white/5" }
                ].map((stepItem) => {
                  const isCompleted = stepItem.id < activeQuestionIndex;
                  const isActive = stepItem.id === activeQuestionIndex;
                  return (
                    <div key={stepItem.id} className="relative flex justify-between items-center text-sm font-black">
                      <div className={`absolute -left-5.5 top-1.5 w-2.5 h-2.5 rounded-full ring-4 ring-background z-10 ${
                        isCompleted ? "bg-[#4edea3]" : isActive ? "bg-[#c0c1ff] animate-pulse" : "bg-white/5"
                      }`} />
                      <span className={isCompleted ? "text-on-surface-variant/40 font-bold" : isActive ? "text-white" : "text-on-surface-variant/30"}>
                        {stepItem.label}
                      </span>
                      <span className={`px-2 py-0.5 rounded font-label-mono text-[11px] font-bold ${
                        isCompleted ? "bg-tertiary/10 text-tertiary border border-tertiary/15" : isActive ? "bg-primary/25 text-primary border border-primary/30" : "bg-white/5 text-on-surface-variant/30"
                      }`}>
                        {stepItem.duration}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* WIDGET 2: CURRENT ROUND QUESTION METRIC */}
            <div className="glass-panel p-5.5 rounded-3xl border-white/10 flex flex-col justify-start gap-4 shrink-0">
              <div className="flex justify-between items-center pb-2.5 border-b border-white/5 shrink-0 select-none">
                <h4 className="text-base font-black text-white flex items-center gap-2">
                  <span className="material-symbols-outlined text-lg text-secondary">question_answer</span>
                  本轮问题
                </h4>
                <span className="text-[13px] md:text-[14px] font-label-mono font-bold text-on-surface-variant/50">{activeQuestionIndex} / 3</span>
              </div>

              {/* Speech pulsing waveform indicator in right panel */}
              <div className="py-2.5 rounded-2xl bg-white/[0.01] border border-white/5 flex items-center justify-center relative overflow-hidden min-h-[50px]">
                <div className="flex items-center gap-1.5 h-6">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map((waveBar) => (
                    <div 
                      key={waveBar}
                      style={{ animationDelay: `${waveBar * 0.05}s` }}
                      className={`w-0.5 bg-gradient-to-t from-primary to-secondary rounded-full animate-[pulse_0.6s_infinite_alternate] ${
                        isTrainingStarted ? 'h-6' : 'h-1.5'
                      }`} 
                    />
                  ))}
                </div>
              </div>

              {/* Text description of current problem */}
              <div className="p-3.5 rounded-2xl bg-white/[0.02] border border-white/5 text-xs font-black text-white leading-relaxed">
                能详细说说你是如何设计系统架构来应对高并发的吗？
              </div>

              <div className="flex justify-between items-center text-[13px] md:text-[14px] text-on-surface-variant/50 font-bold select-none">
                <span>追问次数: 1 / 2</span>
                <span className="text-secondary font-black cursor-pointer hover:text-white transition-colors" onClick={() => alert("追问环节将由 AI 根据您前面的回答深度逻辑深挖！")}>关于追问机制 →</span>
              </div>
            </div>

            {/* WIDGET 3: AI INTERVIEWER PROFILE DETAILS */}
            <div className="glass-panel p-5.5 rounded-3xl border-white/10 flex flex-col justify-start gap-4">
              <div className="flex justify-between items-center pb-2.5 border-b border-white/5 shrink-0">
                <h4 className="text-base font-black text-white flex items-center gap-2">
                  <span className="material-symbols-outlined text-lg text-tertiary">assignment_ind</span>
                  AI 面试官信息
                </h4>
              </div>

              {/* Interviewer detailed profile block */}
              <div className="flex items-center gap-3.5 mt-[-2px]">
                <div className="w-13 h-13 rounded-full border border-tertiary/20 overflow-hidden bg-slate-900 flex items-center justify-center shrink-0">
                  <img src="/debugger-1.jpg" alt="Technical Expert" className="w-full h-full object-cover" />
                </div>
                
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-black text-white">技术专家</span>
                    <span className="px-2.5 py-1 rounded bg-tertiary/10 text-tertiary border border-tertiary/20 text-[11px] md:text-[12px] font-black uppercase">
                      系统设计专家
                    </span>
                  </div>
                  <p className="text-[10px] text-on-surface-variant/40 font-bold truncate">
                    {auth.user.name} 的专属定制 AI
                  </p>
                </div>
              </div>

              <p className="text-xs text-on-surface-variant/60 font-semibold leading-relaxed">
                前字节跳动资深架构师，8年面试官经验，擅长系统设计与分布式高并发场景调试。
              </p>

              <span 
                onClick={() => alert("本位面试官偏好：结构清晰，逻辑紧密，重视容灾防御设计。")}
                className="text-[13px] md:text-[14px] text-tertiary font-bold hover:text-white transition-colors cursor-pointer"
              >
                查看面试官性格偏好 →
              </span>
            </div>

            {/* WIDGET 4: CORE QUICK ACTIONS BUTTON BAR */}
            <div className="glass-panel p-5.5 rounded-3xl border-white/10 flex flex-col justify-start gap-4 shrink-0 relative">
              <div className="flex justify-between items-center pb-2.5 border-b border-white/5 shrink-0 select-none">
                <h4 className="text-base font-black text-white flex items-center gap-2">
                  <span className="material-symbols-outlined text-lg text-primary">touch_app</span>
                  快捷操作
                </h4>
              </div>

              {/* Hand Raise active banner */}
              <AnimatePresence>
                {showHandBadge && (
                  <motion.div 
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.8, opacity: 0 }}
                    className="absolute inset-x-5.5 top-15 p-2 rounded-xl bg-primary/20 text-primary border border-primary/30 text-center text-xs font-black z-20 flex items-center justify-center gap-1.5 shadow-lg shadow-primary/20 select-none"
                  >
                    <span className="material-symbols-outlined text-sm animate-bounce">pan_tool</span>
                    已向 AI 面试官举手示意...
                  </motion.div>
                )}
              </AnimatePresence>

              {/* 4 Quick Actions buttons */}
              <div className="grid grid-cols-4 gap-2.5 mt-[-2px]">
                
                <button
                  disabled={!isTrainingStarted}
                  onClick={() => {
                    setShowHandBadge(true);
                    setTimeout(() => setShowHandBadge(false), 3000);
                  }}
                  className="p-3 rounded-2xl bg-white/[0.01] border border-white/5 hover:border-white/10 flex flex-col items-center justify-center gap-2 text-center transition-all cursor-pointer group disabled:opacity-30 disabled:pointer-events-none"
                >
                  <span className="material-symbols-outlined text-base text-on-surface-variant/40 group-hover:text-primary group-hover:scale-110 transition-all select-none">pan_tool</span>
                  <span className="text-[9px] font-black text-on-surface-variant/60 block select-none">举手</span>
                </button>

                <button
                  disabled={!isTrainingStarted || isThinkingPaused}
                  onClick={handleThinkingTime}
                  className="p-3 rounded-2xl bg-white/[0.01] border border-white/5 hover:border-white/10 flex flex-col items-center justify-center gap-2 text-center transition-all cursor-pointer group disabled:opacity-30 disabled:pointer-events-none"
                >
                  <span className="material-symbols-outlined text-base text-on-surface-variant/40 group-hover:text-primary group-hover:scale-110 transition-all select-none">hourglass_empty</span>
                  <span className="text-[9px] font-black text-on-surface-variant/60 block select-none">思考</span>
                </button>

                <button
                  disabled={!isTrainingStarted}
                  onClick={handleSkipQuestion}
                  className="p-3 rounded-2xl bg-white/[0.01] border border-white/5 hover:border-white/10 flex flex-col items-center justify-center gap-2 text-center transition-all cursor-pointer group disabled:opacity-30 disabled:pointer-events-none"
                >
                  <span className="material-symbols-outlined text-base text-on-surface-variant/40 group-hover:text-primary group-hover:scale-110 transition-all select-none">skip_next</span>
                  <span className="text-[9px] font-black text-on-surface-variant/60 block select-none">跳过</span>
                </button>

                <button
                  disabled={!isTrainingStarted}
                  onClick={() => setShowFeedbackModal(true)}
                  className="p-3 rounded-2xl bg-white/[0.01] border border-white/5 hover:border-white/10 flex flex-col items-center justify-center gap-2 text-center transition-all cursor-pointer group disabled:opacity-30 disabled:pointer-events-none"
                >
                  <span className="material-symbols-outlined text-base text-on-surface-variant/40 group-hover:text-primary group-hover:scale-110 transition-all select-none">flag</span>
                  <span className="text-[9px] font-black text-on-surface-variant/60 block select-none">反馈</span>
                </button>

              </div>
            </div>

          </div>

        </div>

      </div>

      {/* Footer */}
      <footer className="bg-surface-container-lowest border-t border-white/5 w-full block mt-8 relative z-10 shrink-0">
        <div className="px-gutter py-8 max-w-container-max mx-auto flex flex-col md:flex-row justify-between items-center gap-4 text-left">
          <span className="text-[10px] text-on-surface-variant/30 font-label-mono font-bold tracking-widest block text-left">
            © 2024 OfferPilot AI. All rights reserved.
          </span>
          <div className="flex gap-8 text-xs text-on-surface-variant font-label-mono font-bold tracking-widest">
            <span onClick={() => router.push("/")} className="hover:text-primary transition-colors cursor-pointer select-none">
              服务条款
            </span>
            <span onClick={() => router.push("/")} className="hover:text-primary transition-colors cursor-pointer select-none">
              隐私政策
            </span>
            <span onClick={() => router.push("/")} className="hover:text-primary transition-colors cursor-pointer select-none">
              联系方式
            </span>
          </div>
        </div>
      </footer>

      {/* ========================================================
          MODALS & FEEDBACK POPUPS DRAWER
         ======================================================== */}
      <AnimatePresence>
        {showFeedbackModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowFeedbackModal(false)}
              className="absolute inset-0 bg-surface/60 backdrop-blur-md"
            />

            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-surface-container-high border border-white/10 rounded-3xl p-6.5 max-w-md w-full text-left relative z-10 space-y-5 shadow-2xl"
            >
              <div className="flex justify-between items-center pb-3.5 border-b border-white/5">
                <h3 className="font-extrabold text-white text-base flex items-center gap-2">
                  <span className="material-symbols-outlined text-primary">flag</span>
                  提交面试反馈
                </h3>
                <button
                  onClick={() => setShowFeedbackModal(false)}
                  className="text-on-surface-variant hover:text-white transition-colors cursor-pointer flex items-center justify-center w-7 h-7 rounded-lg hover:bg-white/5"
                >
                  <span className="material-symbols-outlined text-base">close</span>
                </button>
              </div>

              <div className="space-y-4 text-xs font-semibold text-white">
                <div className="space-y-3.5 text-left">
                  <label className="text-on-surface-variant font-bold">请详细描述您遇到的问题或建议：</label>
                  <textarea
                    rows={4}
                    value={feedbackText}
                    onChange={(e) => setFeedbackText(e.target.value)}
                    placeholder="例如：AI 面试官问题声音异常，语速过快，或者建议增加某一类场景考查..."
                    className="w-full bg-white/[0.02] border border-white/10 focus:border-primary/50 text-white rounded-xl py-3 px-4 text-xs font-semibold focus:outline-none transition-all placeholder:text-on-surface-variant/30"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  onClick={() => setShowFeedbackModal(false)}
                  className="px-4 py-2 bg-white/5 hover:bg-white/10 text-white text-xs font-black rounded-lg border border-white/10 transition-all cursor-pointer"
                >
                  取消
                </button>
                <button
                  onClick={() => {
                    if (feedbackText.trim()) {
                      alert("感谢您的反馈！OfferPilot 的 AI 技术团队将尽快诊断并优化。");
                      setFeedbackText('');
                      setShowFeedbackModal(false);
                    } else {
                      alert("请输入反馈内容。");
                    }
                  }}
                  className="px-4.5 py-2 bg-primary text-on-primary text-xs font-black rounded-lg transition-all shadow-md shadow-primary/20 cursor-pointer"
                >
                  提交反馈
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
