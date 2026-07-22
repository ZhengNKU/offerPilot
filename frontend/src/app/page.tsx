"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth, UserMenu } from "@/components/AuthProvider";
import { openLegalTerms, openLegalPrivacy, openLegalContact } from "@/components/LegalModals";
import { Suspense } from "react";

// Elegant Count-Up Component - Animate every time it appears in the viewport
function StatCounter({ target, suffix = "" }: { target: number | string; suffix?: string }) {
  const [count, setCount] = useState(0);
  const elementRef = useRef<HTMLSpanElement>(null);
  const numericTarget = typeof target === "number" ? target : parseInt(target.replace(/[^0-9]/g, ""));
  
  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    
    let animationFrameId: number;
    let startTime: number | null = null;
    const duration = 1500; // slightly faster for punchy loading
    
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          startTime = null;
          const animation = (currentTime: number) => {
            if (!startTime) startTime = currentTime;
            const progress = Math.min((currentTime - startTime) / duration, 1);
            const easedProgress = 1 - Math.pow(1 - progress, 3);
            setCount(Math.floor(easedProgress * numericTarget));
            
            if (progress < 1) {
              animationFrameId = requestAnimationFrame(animation);
            }
          };
          animationFrameId = requestAnimationFrame(animation);
        } else {
          // Reset count when it goes off screen so it's ready to count up again next time it appears
          cancelAnimationFrame(animationFrameId);
          setCount(0);
        }
      },
      { threshold: 0.05 }
    );
    
    observer.observe(element);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(animationFrameId);
    };
  }, [numericTarget]);

  return (
    <span ref={elementRef}>
      {count.toLocaleString()}
      {suffix}
    </span>
  );
}

// Interactive 3D Tilt Card Component with Glare
function TiltCard({ children, className = "", id = "" }: { children: React.ReactNode; className?: string; id?: string }) {
  const cardRef = useRef<HTMLDivElement>(null);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const card = cardRef.current;
    if (!card) return;
    const rect = card.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    
    // Rotate of 8 degrees
    const rotateX = ((y - centerY) / centerY) * -8;
    const rotateY = ((x - centerX) / centerX) * 8;
    
    // Spotlight position
    const mx = (x / rect.width) * 100;
    const my = (y / rect.height) * 100;
    
    card.style.setProperty("--rx", `${rotateX}deg`);
    card.style.setProperty("--ry", `${rotateY}deg`);
    card.style.setProperty("--mx", `${mx}%`);
    card.style.setProperty("--my", `${my}%`);
  };

  const handleMouseLeave = () => {
    const card = cardRef.current;
    if (!card) return;
    card.style.setProperty("--rx", "0deg");
    card.style.setProperty("--ry", "0deg");
  };

  return (
    <div
      ref={cardRef}
      id={id}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className={`tilt-card ${className}`}
      style={{
        transform: "rotateX(var(--rx, 0deg)) rotateY(var(--ry, 0deg))",
        transformStyle: "preserve-3d",
      }}
    >
      <div className="glare" />
      {children}
    </div>
  );
}

// Oscillating Audio Bar for playing waveform
function WaveformBar({ isPlaying, index }: { isPlaying: boolean; index: number }) {
  const [height, setHeight] = useState(4);
  const baseHeights = [8, 12, 16, 14, 18, 22, 28, 26, 20, 16, 12, 10, 8, 12, 14, 18, 16, 12, 8];
  const initialHeight = baseHeights[index % baseHeights.length];

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isPlaying) {
      interval = setInterval(() => {
        setHeight(Math.max(4, Math.floor(Math.random() * 24)));
      }, 100 + (index % 4) * 50);
    } else {
      setHeight(initialHeight);
    }
    return () => clearInterval(interval);
  }, [isPlaying, initialHeight, index]);

  // Color mapping based on timeline zones
  let barColor = "bg-primary/80";
  if (index >= 5 && index <= 8) {
    barColor = isPlaying ? "bg-secondary animate-pulse" : "bg-secondary/90";
  } else if (index > 8 && index <= 12) {
    barColor = "bg-secondary/50";
  } else if (index > 12) {
    barColor = "bg-primary/50";
  }

  return (
    <div
      className={`w-1 rounded-full transition-all duration-150 ${barColor}`}
      style={{ height: `${height}px` }}
    />
  );
}


export default function Home() {
  const router = useRouter();
  const auth = useAuth();
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(378); // Start at 06:18 (crash point)
  const heroVideoRef = useRef<HTMLVideoElement>(null);

  // Play video from start whenever Hero section scrolls into viewport
  useEffect(() => {
    const video = heroVideoRef.current;
    if (!video) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            video.currentTime = 0;
            video.play().catch(() => {});
          } else {
            video.pause();
          }
        });
      },
      { threshold: 0.15 }
    );

    observer.observe(video);
    return () => observer.disconnect();
  }, []);

  // Audio timeline counts up when playing
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isPlaying) {
      interval = setInterval(() => {
        setCurrentTime((prev) => {
          if (prev >= 2722) return 18; // loops back to 00:18
          return prev + 1;
        });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isPlaying]);

  const formatTime = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const s = secs % 60;
    return `${mins < 10 ? "0" : ""}${mins}:${s < 10 ? "0" : ""}${s}`;
  };

  return (
    <div className="min-h-screen bg-background text-on-surface font-body select-none overflow-x-hidden w-full relative">
      <Suspense fallback={null}>
        <EvictedToastHandler />
      </Suspense>
      
      {/* Top Navigation Bar */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-xl border-b border-white/10 h-20">
        <div className="flex justify-between items-center h-20 px-gutter max-w-container-max mx-auto w-full relative">
          <div
            onClick={() => router.push("/")}
            className="text-2xl font-display-xl font-bold tracking-tight text-on-surface flex items-center gap-3 cursor-pointer"
          >
            <img src="/logo/logo_icon.svg" alt="面试驾到" className="w-11 h-11 object-contain" />
            面试驾到
          </div>

          <div className="absolute left-1/2 -translate-x-1/2 hidden lg:flex items-center gap-8">
            <a onClick={() => router.push("/debugger")} className="text-on-surface-variant hover:text-on-surface transition-colors text-[16px] md:text-[17px] font-extrabold cursor-pointer">
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
            <a onClick={() => router.push("/guide")} className="text-on-surface-variant hover:text-on-surface transition-colors text-[16px] md:text-[17px] font-extrabold cursor-pointer">
              面试指南
            </a>
            <a onClick={() => router.push("/feedback")} className="text-on-surface-variant hover:text-on-surface transition-colors text-[16px] md:text-[17px] font-extrabold cursor-pointer">
              体验反馈中心
            </a>
            <a onClick={() => window.open("/helper", "_blank")} className="text-on-surface-variant hover:text-on-surface transition-colors text-[16px] md:text-[17px] font-extrabold cursor-pointer">
              帮助中心
            </a>
          </div>

          <div className="flex items-center gap-4">
            {auth.isLoggedIn ? (
              <UserMenu />
            ) : (
              <>
                <button
                  onClick={() => auth.setShowLogin(true)}
                  className="text-on-surface-variant hover:text-on-surface font-bold text-sm px-3 py-2 cursor-pointer"
                >
                  登录
                </button>
                <button
                  onClick={() => router.push("/debugger")}
                  className="px-6 py-2 bg-primary text-on-primary font-bold rounded-full scale-95 hover:scale-100 active:scale-90 transition-all shadow-[0_0_20px_rgba(192,193,255,0.3)] hover:shadow-[0_0_30px_rgba(192,193,255,0.5)] cursor-pointer"
                >
                  免费开始
                </button>
              </>
            )}
          </div>
        </div>
      </nav>

      {/* Hero Headline Section - Full Width Video Background */}
      <section className="relative flex flex-col items-center justify-center px-gutter text-center pt-32 md:pt-36 pb-36 md:pb-44 overflow-hidden w-full bg-background z-10">
        {/* Full-Width Video Background - Covers 100% of this Section (Zero Gaps) */}
        <div className="absolute inset-0 w-full h-full overflow-hidden pointer-events-none z-0 opacity-65">
          <video
            ref={heroVideoRef}
            src="/logo/landing-page-video.mp4"
            autoPlay
            muted
            playsInline
            className="w-full h-full object-cover object-[75%_center] scale-110 translate-y-14 md:translate-y-20"
          />
          {/* Subtle Dark Gradient Overlay for Optimal Contrast */}
          <div className="absolute inset-0 bg-gradient-to-b from-[#0b1326]/80 via-[#0b1326]/30 to-[#0b1326]/95 pointer-events-none" />
        </div>

        {/* Ambient Background Glows */}
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-primary/10 rounded-full blur-[120px] -z-10 animate-pulse pointer-events-none"></div>
        <div className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] bg-tertiary/5 rounded-full blur-[100px] -z-10 animate-pulse pointer-events-none" style={{ animationDelay: "1s" }}></div>
        
        {/* Centered Top Headline Container */}
        <div className="max-w-[1440px] space-y-8 transition-all duration-1000 opacity-100 translate-y-0 flex flex-col items-center w-full relative z-10 mx-auto">
          <div className="inline-flex items-center gap-2.5 px-5 py-2 rounded-full glass-panel border-primary/20">
            <span className="w-2.5 h-2.5 rounded-full bg-primary ai-pulse"></span>
            <span className="font-label-mono tracking-widest text-primary uppercase" style={{ fontSize: "13px", fontWeight: 600 }}>AI Interview OS · 面试驾到，Offer来到</span>
          </div>
          
          <h1 className="text-on-surface leading-tight whitespace-nowrap tracking-tight inline-flex flex-col text-left mx-auto select-none" style={{ fontSize: "84px", fontWeight: 800, fontFamily: "'Hanken Grotesk', sans-serif", letterSpacing: "-0.04em" }}>
            <span>面试驾到</span>
            <span className="text-primary drop-shadow-[0_0_20px_rgba(192,193,255,0.45)] mt-2 block pl-[2.05em]">
              Offer来到
            </span>
          </h1>
          
          <div className="w-full max-w-[1200px] block mx-auto">
            <p className="text-on-surface-variant whitespace-normal break-words" style={{ fontSize: "20px", lineHeight: "1.7", fontWeight: 400, fontFamily: "Inter, sans-serif" }}>
              面试驾到 分析真实面试录音，定位信任崩溃时刻，揭示面试官真实想法，帮你获得心仪 Offer。
            </p>
          </div>
          
          <div className="flex flex-wrap justify-center gap-6 pt-4 w-full">
            <button onClick={() => router.push("/debugger")} className="px-10 py-4 bg-primary text-on-primary text-lg font-extrabold rounded-xl shadow-xl hover:translate-y-[-2px] active:scale-95 transition-all flex items-center gap-2 cursor-pointer">
              开始免费分析
              <span className="material-symbols-outlined">arrow_forward</span>
            </button>
            <button onClick={() => auth.triggerToast("模块开发中，敬请期待")} className="px-10 py-4 glass-panel text-on-surface text-lg font-extrabold rounded-xl border-white/10 hover:bg-white/5 active:scale-95 transition-all cursor-pointer">
              观看真实案例
            </button>
          </div>
          
          <div className="flex items-center justify-center gap-4 pt-10 w-full mx-auto">
            <div className="flex -space-x-3 select-none">
              {[
                "https://lh3.googleusercontent.com/aida-public/AB6AXuComJrLf5vmZvFcLGhLQl9dGu96Za7LTW1dHMyyqZzv-1FDkE-s-xlyW7rZSfD8SuQeuF95TNTLIENPvUnYFi14QbdNShVQeONDYuUznboVWl-BHGpcaG7L45UgkZTJBKy7RyBjMMqNrp3GpPB-2nCS4GLj5spdz7GKcYKAhTudDD07YhCamPFBAhBWiIg4dFnPFihvVRIUO4nnuI0Pp_ed4IfimZnxkSb2MWa4XwKfJR05B_1RqCU_5YXQBKGfh8LRv7Kza3lyzaSl",
                "https://lh3.googleusercontent.com/aida-public/AB6AXuCBf4fUlEHGEs01WLpSs6zHojQbab2fGdBL6GjczVtrjfEalw7TwFGJ3PJtU-sQndTfEXJYqGgEhbZ8qS76Czu_alFepKrPdkQIcHRcZ4h4etK3rm-_AkV9wUG5bQKewELTyYGsXoDhojiSmq5BP0c5IxDWicJDIuhQwmRmvIshAfpkEcLkGugac8RMk3auYxZLdnes3sO5gsYROVT3N60tn-F171ehDsIH5Utz42gNjEaeSzlwJpjMValRGe63sIGgYXEJKMyxutWE",
                "https://lh3.googleusercontent.com/aida-public/AB6AXuAQPPkorqpB-cF0ffVf0FaR88A9PaYQgJcJ7eyu7eIuRJG8Yp_i-fioeJJfYTAlh0AAdCfg6omR2Cuj3fh9ERuQLtE2VVGBkpXz1wkxhullCZPCyh9PvfDSSdJZgB5VZAQTHWHZdcy3t655qqI5e9vXJJvqagdZ7DDIMAc4obK1ayPKrzy-uX98gsmJ6XJZYeXUlkJtE4MMK6YOnuFAnLzq9QmWOCfoL1UoR7xFSjNc7gkyKeo9_ZM5dr_NtgdqzWmM6t-2QtMuTTj9"
              ].map((src, i) => (
                <img
                  key={i}
                  className="w-10 h-10 rounded-full border-2 border-surface-container select-none"
                  src={src}
                  alt={`Engineer ${i + 1}`}
                />
              ))}
            </div>
            <span className="text-on-surface-variant font-label-mono flex items-center gap-1.5 whitespace-nowrap font-bold" style={{ fontSize: "15px" }}>
              1000+ 同学正在使用 <span className="text-tertiary animate-pulse font-black">●</span>
            </span>
          </div>
        </div>
      </section>

      {/* Hero Dashboard Visualization Section */}
      <section className="-mt-16 md:-mt-24 pb-8 px-gutter w-full block relative z-20">
        <div className="w-full max-w-container-max mx-auto glass-panel rounded-3xl p-4 md:p-8 relative group overflow-hidden border-white/5 transition-all duration-1000 opacity-100 translate-y-0 block z-10 text-left">
          <div className="absolute inset-0 bg-gradient-to-tr from-primary/5 to-transparent pointer-events-none"></div>
          
          <div className="relative grid md:grid-cols-12 gap-6 h-full items-stretch">
            {/* Sidebar Left */}
            <div className="md:col-span-3">
              <div className="p-7 rounded-2xl bg-surface-container-low border border-white/5 h-fit">
                <div className="space-y-5">
                  <div className="flex gap-4 text-[15px] items-center opacity-75 py-1">
                    <span className="text-on-surface-variant opacity-50 font-mono">00:30</span>
                    <span className="text-on-surface font-semibold">自我介绍</span>
                  </div>
                  <div className="flex gap-4 text-[15px] items-center opacity-75 py-1">
                    <span className="text-on-surface-variant opacity-50 font-mono">01:35</span>
                    <span className="text-on-surface font-semibold">项目经历</span>
                  </div>
                  <div className="flex gap-4 text-[15px] text-secondary font-black bg-secondary/10 p-3.5 rounded-xl border border-secondary/20 -mx-2 items-center">
                    <span className="font-mono">06:18</span>
                    <span>核心追问: 信任崩溃时刻</span>
                  </div>
                  <div className="flex gap-4 text-[15px] items-center opacity-75 py-1">
                    <span className="text-on-surface-variant opacity-50 font-mono">10:20</span>
                    <span className="text-on-surface font-semibold">难题复盘</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Main Visualization Center */}
            <div className="md:col-span-6 space-y-6">
              <div className="p-6 rounded-2xl bg-surface-container-high border border-white/10 h-full relative overflow-hidden group/chart flex flex-col justify-between">
                
                {/* Score Indicators */}
                <div className="flex justify-between items-center mb-6">
                  <div>
                    <p className="text-sm text-on-surface-variant font-label-mono tracking-widest font-extrabold">信任指数</p>
                    <h3 className="text-primary mt-1 leading-none" style={{ fontSize: "48px", fontWeight: 800, fontFamily: "'Hanken Grotesk', sans-serif" }}>82%</h3>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-secondary font-label-mono tracking-widest font-extrabold">最大降幅</p>
                    <h3 className="text-secondary mt-1 leading-none" style={{ fontSize: "48px", fontWeight: 800, fontFamily: "'Hanken Grotesk', sans-serif" }}>41%</h3>
                  </div>
                </div>

                {/* SVG Line Chart */}
                <div className="h-56 relative mb-4 w-full">
                  <svg className="w-full h-full overflow-visible" viewBox="0 0 400 120" preserveAspectRatio="none">
                    <defs>
                      <linearGradient id="curveGradient" x1="0%" x2="100%" y1="0%" y2="0%">
                        <stop offset="0%" stopColor="#c0c1ff" />
                        <stop offset="45%" stopColor="#c0c1ff" />
                        <stop offset="50%" stopColor="#ffb2b7" />
                        <stop offset="100%" stopColor="#ffb2b7" />
                      </linearGradient>
                      <linearGradient id="areaGradient" x1="0%" x2="0%" y1="0%" y2="100%">
                        <stop offset="0%" stopColor="#c0c1ff" stopOpacity="0.1" />
                        <stop offset="100%" stopColor="#c0c1ff" stopOpacity="0" />
                      </linearGradient>
                    </defs>

                    {/* Grid lines */}
                    <g stroke="rgba(255,255,255,0.05)" strokeWidth="1">
                      <line x1="0" x2="400" y1="20" y2="20" />
                      <line x1="0" x2="400" y1="50" y2="50" />
                      <line x1="0" x2="400" y1="80" y2="80" />
                      <line x1="0" x2="400" y1="110" y2="110" />
                    </g>

                    {/* Fill Area */}
                    <path d="M0 30 Q 50 25, 100 35 T 150 20 T 195 50 L 195 120 L 0 120 Z" fill="url(#areaGradient)" />

                    {/* Smooth SVG Line curve */}
                    <path
                      className="data-trail"
                      d="M0 30 Q 50 25, 100 35 T 150 20 T 200 55 T 250 72 T 300 75 T 400 78"
                      fill="none"
                      stroke="url(#curveGradient)"
                      strokeLinecap="round"
                      strokeWidth="3"
                    />

                    {/* Data Nodes */}
                    <circle cx="50" cy="27" fill="#c0c1ff" r="3" />
                    <circle cx="100" cy="35" fill="#c0c1ff" r="3" />
                    <circle cx="150" cy="20" fill="#c0c1ff" r="3" />

                    {/* Dashed vertical lines */}
                    <line stroke="#ffb2b7" strokeDasharray="4" strokeWidth="1" x1="200" x2="200" y1="10" y2="120" />

                    {/* pulsing crash dots */}
                    <circle className="animate-ping" cx="200" cy="55" fill="#ffb2b7" r="6" />
                    <circle cx="200" cy="55" fill="#ffb2b7" r="4" stroke="white" strokeWidth="1" />
                  </svg>

                  {/* Absolute responsive annotation tooltip */}
                  <div className="absolute top-[2px] left-[50%] -translate-x-1/2">
                    <div className="bg-secondary text-on-secondary px-3.5 py-1.5 rounded-lg text-sm font-bold font-label-mono whitespace-nowrap shadow-lg animate-bounce flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-on-secondary animate-pulse" />
                      06:18 信任崩溃时刻
                    </div>
                  </div>
                </div>

                {/* X-Axis labels */}
                <div className="flex justify-between mt-3 select-none px-2">
                  <span className="text-sm font-label-mono text-on-surface-variant/70 font-bold">00:00</span>
                  <span className="text-sm font-label-mono text-on-surface-variant/70 font-bold">00:10</span>
                  <span className="text-sm font-label-mono text-on-surface-variant/70 font-bold">00:20</span>
                  <span className="text-sm font-label-mono text-on-surface-variant/70 font-bold">00:30</span>
                  <span className="text-sm font-label-mono text-on-surface-variant/70 font-bold">00:40</span>
                </div>

                {/* Waveform Player */}
                <div className="mt-6 space-y-2 border-t border-white/5 pt-5 w-full">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setIsPlaying(!isPlaying)}
                      className="w-8 h-8 rounded-full bg-primary/20 text-primary flex items-center justify-center hover:bg-primary/30 transition-colors focus:outline-none flex-shrink-0 cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-[16px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                        {isPlaying ? "pause" : "play_arrow"}
                      </span>
                    </button>
                    
                    {/* Visual Waveform Bars */}
                    <div className="flex-1 h-8 flex items-center gap-[3px] overflow-hidden">
                      {[...Array(19)].map((_, i) => (
                        <WaveformBar key={i} index={i} isPlaying={isPlaying} />
                      ))}
                    </div>

                    <div className="px-4 py-2 bg-surface-container-highest rounded-lg font-label-mono text-sm text-on-surface-variant font-bold shadow-inner">
                      {formatTime(currentTime)} / 25:22
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Side Analysis Right */}
            <div className="md:col-span-3 flex flex-col gap-6">
              <div className="p-7 rounded-2xl bg-surface-container-low border border-white/5 flex flex-col justify-center flex-1 min-h-[160px]">
                <h4 className="text-secondary text-[15px] mb-4 font-label-mono font-bold flex items-center gap-2 uppercase tracking-widest">
                  <span className="material-symbols-outlined text-[18px]">warning</span> 关键减分项
                </h4>
                <p className="text-[16px] text-on-surface leading-relaxed font-semibold">
                  面试官想法：回答停留在表面，缺乏逻辑闭环与量化成果。
                </p>
              </div>
              
              <div className="p-7 rounded-2xl glass-panel border border-tertiary/20 flex flex-col justify-center flex-1 min-h-[160px]">
                <h4 className="text-tertiary text-[15px] mb-4 font-label-mono font-bold uppercase tracking-widest">AI 重构建议</h4>
                <p className="text-[16px] text-on-surface-variant leading-relaxed font-semibold">
                  建议使用 STAR 法则，突出业务痛点、个人决策逻辑与最终成效。
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Stats Section - Spans 100% border/background width across the browser */}
      <section className="py-20 px-gutter border-y border-white/5 bg-surface-container-lowest/50 w-full block">
        <div className="max-w-container-max mx-auto grid grid-cols-2 md:grid-cols-5 gap-8 w-full">
          <div className="text-center space-y-2 flex flex-col items-center justify-center">
            <div className="text-primary-container font-black tracking-tight leading-none" style={{ fontSize: "64px", fontFamily: "'Hanken Grotesk', sans-serif" }}>
              <StatCounter target={1000} suffix="+" />
            </div>
            <div className="text-on-surface-variant font-label-mono font-bold uppercase tracking-widest" style={{ fontSize: "14px" }}>真实面试分析</div>
          </div>
          
          <div className="text-center space-y-2 flex flex-col items-center justify-center">
            <div className="text-primary-container font-black tracking-tight leading-none" style={{ fontSize: "64px", fontFamily: "'Hanken Grotesk', sans-serif" }}>
              <StatCounter target={2000} suffix="+" />
            </div>
            <div className="text-on-surface-variant font-label-mono font-bold uppercase tracking-widest" style={{ fontSize: "14px" }}>分钟录音处理</div>
          </div>
          
          <div className="text-center space-y-2 flex flex-col items-center justify-center">
            <div className="text-tertiary font-black tracking-tight leading-none" style={{ fontSize: "64px", fontFamily: "'Hanken Grotesk', sans-serif" }}>
              <StatCounter target={78} suffix="%" />
            </div>
            <div className="text-on-surface-variant font-label-mono font-bold uppercase tracking-widest" style={{ fontSize: "14px" }}>Offer 提升率</div>
          </div>
          
          <div className="text-center space-y-2 flex flex-col items-center justify-center">
            <div className="text-primary-container font-black tracking-tight leading-none" style={{ fontSize: "64px", fontFamily: "'Hanken Grotesk', sans-serif" }}>
              <StatCounter target={92} suffix="%" />
            </div>
            <div className="text-on-surface-variant font-label-mono font-bold uppercase tracking-widest" style={{ fontSize: "14px" }}>发现隐藏问题率</div>
          </div>
          
          <div className="text-center space-y-2 col-span-2 md:col-span-1 flex flex-col items-center justify-center">
            <div className="text-secondary font-black tracking-tight leading-none" style={{ fontSize: "64px", fontFamily: "'Hanken Grotesk', sans-serif" }}>
              TOP <StatCounter target={100} />
            </div>
            <div className="text-on-surface-variant font-label-mono font-bold uppercase tracking-widest" style={{ fontSize: "14px" }}>覆盖大厂层级</div>
          </div>
        </div>
      </section>

      {/* Bento Grid Features Section - Spans 100% width across the browser */}
      <section className="py-section-padding px-gutter relative w-full block">
        {/* Background Engine Concept Animation lines */}
        <div className="absolute inset-0 z-0 overflow-hidden opacity-30 pointer-events-none">
          <div className="scan-line top-1/4"></div>
          <div className="scan-line top-1/2" style={{ animationDelay: "2s" }}></div>
          <div className="scan-line top-3/4" style={{ animationDelay: "1s" }}></div>
        </div>
        
        <div className="max-w-container-max mx-auto space-y-20 relative z-10 w-full flex flex-col items-center">
          <div className="text-center space-y-4 w-full">
            <h2 className="text-on-surface font-black tracking-tight" style={{ fontSize: "52px", fontFamily: "'Hanken Grotesk', sans-serif" }}>全流程面试分析引擎</h2>
            <p className="text-on-surface-variant font-semibold" style={{ fontSize: "18px" }}>从简历到 Offer，全链路解决方案</p>
          </div>
          
          <div className="grid grid-cols-2 md:grid-cols-6 gap-4 md:gap-6 w-full">
            {[
              { icon: "description", color: "text-primary", bg: "bg-primary/10", title: "简历分析", desc: "发现简历风险点", stagger: "stagger-1" },
              { icon: "graphic_eq", color: "text-secondary", bg: "bg-secondary/10", title: "录音转写", desc: "精准语音转文字", stagger: "stagger-2" },
              { icon: "psychology", color: "text-tertiary", bg: "bg-tertiary/10", title: "智能分析", desc: "定位失信时刻", stagger: "stagger-3" },
              { icon: "record_voice_over", color: "text-secondary", bg: "bg-secondary/10", title: "表达重构", desc: "高阶话术升级", stagger: "stagger-4" },
              { icon: "interpreter_mode", color: "text-primary", bg: "bg-primary/10", title: "模拟面试", desc: "AI 拟真实战对练", stagger: "stagger-5" },
              { icon: "workspace_premium", color: "text-tertiary", bg: "bg-tertiary/10", title: "获得 Offer", desc: "AI 助你斩获 Offer", stagger: "stagger-6" }
            ].map((feature, i) => (
              <div
                key={i}
                className={`engine-card ${feature.stagger} glass-panel p-8 rounded-2xl border-white/5 flex flex-col items-center text-center group hover:bg-white/5 transition-all duration-300`}
              >
                <div className={`w-14 h-14 rounded-xl ${feature.bg} flex items-center justify-center mb-5 ${feature.color} animate-float group-hover:scale-110 transition-transform`} style={{ animationDelay: `${i * 0.25}s` }}>
                  <span className="material-symbols-outlined text-[28px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                    {feature.icon}
                  </span>
                </div>
                <h3 className="font-bold mb-2 text-white" style={{ fontSize: "20px" }}>{feature.title}</h3>
                <p className="text-on-surface-variant text-sm leading-relaxed font-medium">{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pain Point Section - Spans 100% width across the browser with dark border/background */}
      <section className="py-section-padding bg-surface-container-low/50 px-gutter overflow-hidden relative w-full block">
        {/* z-0 Background Image with transparent gradient overlay */}
        <div 
          className="absolute inset-0 opacity-50 pointer-events-none z-0"  // 改为 40%
          style={{
            backgroundImage: `linear-gradient(to bottom, rgba(11, 19, 38, 0.95) 0%, rgba(11, 19, 38, 0.4) 40%, rgba(11, 19, 38, 0.95) 100%), url('/home-hand.jpg')`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        />
        <div className="max-w-container-max mx-auto space-y-16 w-full flex flex-col items-stretch relative z-10">
          <div className="flex flex-col md:flex-row justify-between items-end gap-6 text-left">
            <div className="space-y-4 max-w-3xl">
              <h2 className="text-on-surface font-black tracking-tight leading-tight" style={{ fontSize: "52px", fontFamily: "'Hanken Grotesk', sans-serif" }}>
                破解那些让你丢掉 Offer 的<br />
                <span className="text-primary drop-shadow-[0_0_10px_rgba(192,193,255,0.4)]">「隐形杀手」</span>
              </h2>
              <p className="text-on-surface-variant leading-relaxed font-semibold" style={{ fontSize: "18px" }}>
                技术面试不仅考核你的技术能力，更看重你的思维、表达 and 解决问题的能力。你准备好了吗？
              </p>
            </div>
            <div className="hidden md:block relative">
              <div className="absolute -inset-10 bg-primary/5 rounded-full blur-[100px] -z-10 pointer-events-none"></div>
            </div>
          </div>

          {/* 4 Grid Pain Point Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 w-full">
            {[
              { icon: "help_center", border: "border-secondary/30", textCol: "text-secondary", title: "不知道挂在哪？", desc: "面试节奏快，问题多，根本分析不清楚是在哪一环节出了问题，错失宝贵机会。", tag: "Pain Point 01" },
              { icon: "folder_open", border: "border-primary/30", textCol: "text-primary", title: "项目经历无法信服？", desc: "明明做了 100 分的项目，却在面试场景下无法有效表达，AI 帮你拆解真实价值。", tag: "Pain Point 02" },
              { icon: "code", border: "border-tertiary/30", textCol: "text-tertiary", title: "回答像背八股？", desc: "千篇一律的回答缺乏个人特色，面试官听多了早已免疫，AI 帮你打造真实、有深度的表达。", tag: "Pain Point 03" },
              { icon: "view_in_ar", border: "border-primary/30", textCol: "text-primary", title: "缺少系统性思考？", desc: "面对复杂问题时无法展现架构思维，AI 帮你建立结构化思考框架，全面提升竞争力。", tag: "Pain Point 04" }
            ].map((card, i) => (
              <div
                key={i}
                className="glass-panel p-8 rounded-3xl hover-card-glow transition-all duration-300 group relative overflow-hidden text-left flex flex-col justify-between min-h-[280px]"
              >
                <div>
                  <div className="flex justify-between items-start mb-6">
                    <div className={`w-14 h-14 rounded-full border ${card.border} flex items-center justify-center ${card.textCol}`}>
                      <span className="material-symbols-outlined text-[24px]" style={{ fontVariationSettings: "'FILL' 1" }}>{card.icon}</span>
                    </div>
                    <span className="text-xs font-label-mono text-on-surface-variant opacity-50 uppercase tracking-widest font-extrabold">{card.tag}</span>
                  </div>
                  <h3 className="font-extrabold mb-3 text-on-surface" style={{ fontSize: "22px" }}>{card.title}</h3>
                  <p className="text-base text-on-surface-variant leading-relaxed font-medium">
                    {card.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials - Spans 100% width across the browser */}
      <section className="py-section-padding px-gutter w-full overflow-hidden block">
        <div className="max-w-container-max mx-auto w-full flex flex-col items-center">
          <div className="text-center mb-16 space-y-4 w-full">
            <h2 className="text-on-surface font-black tracking-tight" style={{ fontSize: "52px", fontFamily: "'Hanken Grotesk', sans-serif" }}>他们用 面试驾到 拿到了更好的 Offer</h2>
            <p className="text-on-surface-variant font-label-mono font-bold tracking-widest uppercase" style={{ fontSize: "14px" }}>500+ 校招求职者的真实反馈</p>
          </div>

          <div className="grid md:grid-cols-3 gap-8 w-full">
            {[
              {
                avatar: "https://lh3.googleusercontent.com/aida-public/AB6AXuAoBpggRj1UtigDFdEnOK0sAAmSdS-IVJ2H9W38TRex37DPfiHqEvwoY6eQcy4GeTPpfeEJDjyuoSFA55gzpIvv7R5Mfz9ZSXKlQbqUKTzPLxqLTXr-9tvsKlzmM1X0EAYIJVwDIewcFXEEh6EIHymYLEHtaG3QthqZnrrX0q-U87O-FrecJz9XcdHZoz2ZndesMcgGuwEkcaCDeujsrkHIVZ2b_s1ue1sD9aCOzimyGM0EZ6xbYMXOZYnG5fMTc5XCa01xnjuPbNeK",
                name: "张同学",
                title: "知名科技大厂 · 软件开发工程师",
                quote: "“校招技术面时总是卡在场景设计题，不知道为什么面完就挂。面试驾到帮我定位到了表达逻辑漏洞，AI 重构后的思路非常清晰，二面顺利拿下 Offer！”",
                tagColor: "text-primary",
                tag: "斩获科技大厂 Offer"
              },
              {
                avatar: "https://lh3.googleusercontent.com/aida-public/AB6AXuDFshg7TaIUBGgEoN9JlGImNqjxSHpt7AhRu-PbphzAn5SRZ5yIKPQVnt7MjqHWSjcaFOH3c-Z9RctvigPYZQQzWs5DFeQO_8lLFFNccVXVeYJLk_8B5MUbPOvtedzFCeFMkASReREHENKonnQ5Dgtd3m5h88GZffVVuSKxtNnySeH3A2sgHaysDkze-IycN2pg951zf8B27PdqLrDFqy3SZcvE-YgWmwWmsV5-Y6lPMtJHGu_Qk2cjZdchCxr9yPyUq0ZhXGtK18lj",
                name: "李同学",
                title: "互联网平台 · 产品运营管培生",
                quote: "“作为非技术背景的文科应届生，面对面试官深挖实习项目时总是心里发虚。AI 重构把我的表达结构梳理得极其严密，帮助我在群面和终面中脱颖而出！”",
                tagColor: "text-tertiary",
                tag: "斩获名企运营 Offer"
              },
              {
                avatar: "https://lh3.googleusercontent.com/aida-public/AB6AXuDq0oV8NegQm719QROkK-ggi194pRkwKl7fHB8GEkJwwxEDaGssftR2ZcL4XT3Iu35dejN5439XwRofApsNIVCKgZBrKYNaUhrbwoHxbvncKbDFu1dXrqkTGOxvL4VcAut8iUIAlSvE8TiAIkhn03XFAGoK0knqMY51qStDuYjR2L3bNHY4Sxn502nwfstmS1SsoSFUQxP86Imppj1BGJ2vIUH8tEeclAtdMMFYo856Zpim5zG7DD2nTHwiokYtUOCmtq6SU81uMO5u",
                name: "陈同学",
                title: "知名外企 · 市场营销助理",
                quote: "“从简历深挖到真实面试分析，面试驾到帮我把零碎的校园经历转化为有说服力的成果数据，面试时心理底气特别足，成功收到了梦寐以求的校招 Offer！”",
                tagColor: "text-secondary",
                tag: "斩获校招优选 Offer"
              }
            ].map((item, i) => (
              <div
                key={i}
                className="p-8 rounded-3xl glass-panel border-white/5 space-y-6 hover-card-glow transition-all duration-300 text-left flex flex-col justify-between"
              >
                <div className="space-y-6">
                  <div className="flex items-center gap-4">
                    <img className="w-14 h-14 rounded-full select-none" src={item.avatar} alt={item.name} />
                    <div>
                      <p className="font-extrabold text-white text-lg">{item.name}</p>
                      <p className="text-sm text-on-surface-variant font-medium mt-0.5">{item.title}</p>
                    </div>
                  </div>
                  <p className="text-base italic text-on-surface-variant leading-relaxed font-medium">
                    {item.quote}
                  </p>
                </div>
                
                <div className={`pt-4 border-t border-white/5 text-xs ${item.tagColor} uppercase font-label-mono font-extrabold tracking-widest`}>
                  {item.tag}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing Section - Spans 100% width across the browser */}
      <section className="py-section-padding px-gutter relative overflow-hidden w-full block" id="pricing">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-[500px] bg-primary/5 blur-[120px] rounded-full -z-10 pointer-events-none"></div>
        <div className="max-w-container-max mx-auto space-y-12 relative z-10 w-full flex flex-col items-center">
          <div className="text-center space-y-4 w-full">
            <div className="inline-flex items-center gap-2.5 px-5 py-2 rounded-full glass-panel border-tertiary/30 mb-4">
              <span className="font-label-mono tracking-[0.2em] text-tertiary uppercase font-bold" style={{ fontSize: "14px" }}>Internal Beta · 内测体验</span>
            </div>
            <h2 className="text-on-surface font-black tracking-tight" style={{ fontSize: "52px", fontFamily: "'Hanken Grotesk', sans-serif" }}>投资你的职业未来</h2>
            <p className="text-on-surface-variant font-semibold" style={{ fontSize: "18px" }}>内测期间所有功能免费体验</p>
          </div>

          {/* 内测统一 test 档：单卡片居中展示 */}
          <div className="w-full max-w-3xl flex justify-center">
            <div className="glass-panel p-10 md:p-12 rounded-[32px] flex flex-col border-tertiary/30 bg-surface-container-low/50 shadow-[0_20px_60px_rgba(78,222,163,0.12)] relative overflow-hidden w-full text-center">
              {/* 角标 */}
              <div className="absolute top-0 right-0 px-4 py-1.5 bg-tertiary text-on-tertiary text-xs font-black rounded-bl-xl uppercase tracking-widest font-label-mono">
                Beta · 内测
              </div>

              <div className="mb-6 mt-4">
                <h3 className="font-black text-white mb-3" style={{ fontSize: "32px", fontFamily: "'Hanken Grotesk', sans-serif" }}>
                  内测体验版
                </h3>
                <p className="text-on-surface-variant text-base font-medium">
                  所有注册用户自动获得内测体验版会员资格，无需付费 · 一次性额度，用完即止
                </p>
              </div>

              <div className="mb-8 inline-flex items-baseline gap-2 justify-center">
                <span className="font-black text-tertiary" style={{ fontSize: "56px", fontFamily: "'Hanken Grotesk', sans-serif" }}>¥0</span>
                <span className="text-on-surface-variant text-base font-bold">/ 内测期</span>
              </div>

              <ul className="space-y-5 mb-10 flex-1 font-semibold text-left max-w-xl mx-auto w-full">
                <li className="flex items-center gap-3 text-base text-on-surface">
                  <span className="material-symbols-outlined text-tertiary text-xl shrink-0">check_circle</span>
                  <span><span className="text-tertiary font-black">2 次</span> 面试录音分析（一次性）</span>
                </li>
                <li className="flex items-center gap-3 text-base text-on-surface">
                  <span className="material-symbols-outlined text-tertiary text-xl shrink-0">check_circle</span>
                  <span><span className="text-tertiary font-black">5 次</span> 面试记录分析（一次性）</span>
                </li>
                <li className="flex items-center gap-3 text-base text-on-surface">
                  <span className="material-symbols-outlined text-tertiary text-xl shrink-0">check_circle</span>
                  <span><span className="text-tertiary font-black">5 次</span> 简历分析（一次性）</span>
                </li>
                <li className="flex items-center gap-3 text-base text-on-surface">
                  <span className="material-symbols-outlined text-tertiary text-xl shrink-0">check_circle</span>
                  <span><span className="text-tertiary font-black">20 分钟</span> AI 模拟面试（一次性）</span>
                </li>
                <li className="flex items-center gap-3 text-base text-on-surface">
                  <span className="material-symbols-outlined text-tertiary text-xl shrink-0">check_circle</span>
                  <span>100 次/天 AI 职业顾问</span>
                </li>
              </ul>

              <button
                onClick={() => router.push("/register")}
                className="w-full py-4 rounded-xl bg-tertiary text-on-tertiary font-black hover:scale-[1.02] active:scale-[0.98] transition-all shadow-[0_0_20px_rgba(78,222,163,0.25)] cursor-pointer"
              >
                免费内测注册
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Final CTA - Spans 100% width across the browser */}
      <section className="py-section-padding px-gutter text-center tilt-container w-full overflow-hidden block">
        <TiltCard
          id="cta-card"
          className="max-w-6xl mx-auto glass-panel p-16 rounded-[48px] relative overflow-hidden group transition-all duration-300 block border border-white/10"
        >
          {/* -z-10 Background Image with transparent gradient overlay */}
          <div 
            className="absolute inset-0 opacity-15 group-hover:opacity-50 transition-opacity duration-500 pointer-events-none -z-10"
            style={{
              backgroundImage: `linear-gradient(to bottom, rgba(11, 19, 38, 0.2) 0%, rgba(11, 19, 38, 0.95) 100%), url('/home-start.jpg')`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            }}
          />
          
          <h2 className="text-on-surface font-black tracking-tight relative z-10" style={{ fontSize: "52px", fontFamily: "'Hanken Grotesk', sans-serif" }}>准备好开启智能职业生涯了吗？</h2>
          
          <div className="w-full max-w-3xl mx-auto block mb-10 relative z-10">
            <p className="text-on-surface-variant whitespace-normal break-words" style={{ fontSize: "18px", lineHeight: "1.6", fontWeight: 400, fontFamily: "Inter, sans-serif" }}>
              立即体验 面试驾到，发现你的面试优势，拿到心仪 Offer。
            </p>
          </div>
          
          <div className="flex flex-wrap justify-center gap-4 relative z-10 w-full">
            <button onClick={() => router.push("/debugger")} className="px-12 py-4 bg-primary text-on-primary font-black rounded-xl shadow-2xl hover:scale-105 active:scale-95 transition-all cursor-pointer">
              立即免费分析
            </button>
          </div>
        </TiltCard>
      </section>

      {/* Footer - Spans 100% width across the browser */}
      <footer className="bg-surface-container-lowest border-t border-white/5 w-full block">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-stack-gap px-gutter py-section-padding max-w-container-max mx-auto text-left">
          <div className="col-span-1 md:col-span-2 space-y-6">
            <div className="text-xl font-black text-on-surface flex items-center gap-3" style={{ fontSize: "32px", fontFamily: "'Hanken Grotesk', sans-serif" }}>
              <img src="/logo/logo_icon.svg" alt="面试驾到" className="w-12 h-12 object-contain inline-block" />
              面试驾到
            </div>
            <div className="w-full max-w-xs block">
              <p className="text-on-surface-variant text-sm font-medium leading-relaxed">
                AI Interview OS · 全流程面试分析引擎
              </p>
              <p className="text-on-surface-variant text-sm font-medium leading-relaxed">
                面试驾到，Offer来到
              </p>
            </div>
          </div>
          
          <div className="space-y-4">
            <h4 className="font-extrabold text-on-surface">产品</h4>
            <ul className="space-y-2 text-sm text-on-surface-variant font-semibold">
              <li><a onClick={() => router.push("/debugger?mode=audio")} className="hover:text-primary transition-colors cursor-pointer">面试分析</a></li>
              <li><a onClick={() => router.push("/debugger?mode=resume")} className="hover:text-primary transition-colors cursor-pointer">简历分析</a></li>
              <li><a onClick={() => router.push("/training")} className="hover:text-primary transition-colors cursor-pointer">AI模拟面试</a></li>
              <li><a onClick={() => router.push("/memory")} className="hover:text-primary transition-colors cursor-pointer">职业记忆库</a></li>
            </ul>
          </div>
          
          <div className="space-y-4">
            <h4 className="font-extrabold text-on-surface">支持</h4>
            <ul className="space-y-2 text-sm text-on-surface-variant font-semibold">
              <li><a href="/helper" target="_blank" rel="noopener noreferrer" className="hover:text-primary transition-colors cursor-pointer">帮助中心</a></li>
              <li><a onClick={() => router.push("/feedback")} className="hover:text-primary transition-colors cursor-pointer">常见问题</a></li>
              <li><a onClick={() => openLegalContact()} className="hover:text-primary transition-colors cursor-pointer">联系我们</a></li>
            </ul>
          </div>
          
          <div className="space-y-4">
            <h4 className="font-extrabold text-on-surface">关于</h4>
            <ul className="space-y-2 text-sm text-on-surface-variant font-semibold">
              <li><a onClick={() => openLegalTerms()} className="hover:text-primary transition-colors cursor-pointer">用户协议</a></li>
              <li><a onClick={() => openLegalPrivacy()} className="hover:text-primary transition-colors cursor-pointer">隐私政策</a></li>
            </ul>
          </div>
        </div>
        
        <div className="px-gutter py-8 border-t border-white/5 max-w-container-max mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="text-left space-y-1">
            <p className="text-xs text-on-surface-variant font-label-mono font-bold tracking-widest">© 2026 面试驾到</p>
            <p className="text-[10px] text-on-surface-variant/40 font-label-mono font-bold tracking-widest">Built with AI · 面试驾到，Offer来到</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

// 检测 URL 上的 ?evicted=1，若是被踢下线而来，弹 toast 并清理 URL。
// 单独抽出是因为 Next.js 16 静态预渲染要求 useSearchParams 必须在 <Suspense> 边界内。
function EvictedToastHandler() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const auth = useAuth();

  useEffect(() => {
    if (searchParams.get("evicted") === "1") {
      auth.triggerToast("您的账号已在其他设备登录，已自动退出");
      // 清理 URL 上的 evicted=1，避免刷新/分享时再次提示
      router.replace("/", { scroll: false });
    }
    // 仅在 searchParams 变化时检查一次即可
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  return null;
}
