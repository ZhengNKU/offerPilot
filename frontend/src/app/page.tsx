"use client";

import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { useRouter } from "next/navigation";
import { useAuth, UserMenu } from "@/components/AuthProvider";

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
  const [currentTime, setCurrentTime] = useState(18); // Start at 00:18 (crash point)

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
    const remainder = secs % 60;
    return `${mins.toString().padStart(2, "0")}:${remainder.toString().padStart(2, "0")}`;
  };

  return (
    <main className="pt-20 bg-background text-on-surface select-none">
      {/* TopNavBar - Covers full screen width */}
      <nav className="fixed top-0 w-full z-50 bg-surface/80 backdrop-blur-xl border-b border-white/10">
        <div className="flex justify-between items-center h-20 px-gutter max-w-container-max mx-auto w-full relative">
          <div className="text-2xl font-display-xl font-bold tracking-tight text-on-surface flex items-center gap-2">
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
            <a onClick={() => router.push("/training")} className="text-on-surface-variant hover:text-on-surface transition-colors text-[16px] md:text-[17px] font-extrabold cursor-pointer">
              面试训练场
            </a>
            <a onClick={() => router.push("/home")} className="text-on-surface-variant hover:text-on-surface transition-colors text-[16px] md:text-[17px] font-extrabold cursor-pointer">
              职业驾驶舱
            </a>
            <a onClick={() => router.push("/")} className="text-primary transition-colors text-[16px] md:text-[17px] font-extrabold cursor-pointer relative after:content-[''] after:absolute after:bottom-[-26px] after:left-0 after:right-0 after:h-[2px] after:bg-primary">
              案例
            </a>
          </div>
           <div className="flex items-center gap-4">
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

      {/* Hero Section - Spans full screen width */}
      <section className="relative min-h-[90vh] flex flex-col items-center justify-center px-gutter text-center py-section-padding overflow-hidden w-full bg-background z-10">
        {/* Ambient Background Glows */}
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-primary/10 rounded-full blur-[120px] -z-10 animate-pulse pointer-events-none"></div>
        <div className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] bg-tertiary/5 rounded-full blur-[100px] -z-10 animate-pulse pointer-events-none" style={{ animationDelay: "1s" }}></div>
        
        {/* Centered Top Headline Container - Expanded width for gorgeous widescreen harmony */}
        <div className="max-w-[1440px] space-y-8 transition-all duration-1000 opacity-100 translate-y-0 flex flex-col items-center w-full relative z-10 mx-auto">
          <div className="inline-flex items-center gap-2.5 px-5 py-2 rounded-full glass-panel border-primary/20">
            <span className="w-2.5 h-2.5 rounded-full bg-primary ai-pulse"></span>
            <span className="font-label-mono tracking-widest text-primary uppercase" style={{ fontSize: "13px", fontWeight: 600 }}>AI Interview OS · 全流程面试分析引擎</span>
          </div>
          
          <h1 className="text-on-surface leading-tight whitespace-normal tracking-tight text-left inline-flex flex-col mx-auto" style={{ fontSize: "80px", fontWeight: 800, fontFamily: "'Hanken Grotesk', sans-serif", letterSpacing: "-0.04em" }}>
            <span>像调试代码一样，</span>
            <span className="text-primary drop-shadow-[0_0_15px_rgba(192,193,255,0.4)] pl-0 md:pl-[3em] mt-2 block md:inline-block">
              调试你的面试
            </span>
          </h1>
          
          <div className="w-full max-w-[1200px] block mx-auto">
            <p className="text-on-surface-variant whitespace-normal break-words" style={{ fontSize: "20px", lineHeight: "1.7", fontWeight: 400, fontFamily: "Inter, sans-serif" }}>
              OfferPilot 分析真实面试录音，定位信任崩溃时刻，揭示面试官真实想法，帮你获得心仪 Offer。
            </p>
          </div>
          
          <div className="flex flex-wrap justify-center gap-6 pt-4 w-full">
            <button onClick={() => router.push("/debugger")} className="px-10 py-4 bg-primary text-on-primary text-lg font-extrabold rounded-xl shadow-xl hover:translate-y-[-2px] active:scale-95 transition-all flex items-center gap-2 cursor-pointer">
              开始免费分析
              <span className="material-symbols-outlined">arrow_forward</span>
            </button>
            <button className="px-10 py-4 glass-panel text-on-surface text-lg font-extrabold rounded-xl border-white/10 hover:bg-white/5 active:scale-95 transition-all cursor-pointer">
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
              10,000+ 工程师正在使用 <span className="text-tertiary animate-pulse font-black">●</span>
            </span>
          </div>
        </div>

        {/* Hero Dashboard Visualization - Wide container spanning 1280px screen block */}
        <div className="mt-20 w-full max-w-container-max mx-auto glass-panel rounded-3xl p-4 md:p-8 relative group overflow-hidden border-white/5 transition-all duration-1000 opacity-100 translate-y-0 block z-10 text-left">
          <div className="absolute inset-0 bg-gradient-to-tr from-primary/5 to-transparent pointer-events-none"></div>
          
          <div className="relative grid md:grid-cols-12 gap-6 h-full items-stretch">
            {/* Sidebar Left */}
            <div className="md:col-span-3">
              <div className="p-7 rounded-2xl bg-surface-container-low border border-white/5 h-fit">
                <h4 className="text-on-surface-variant text-[16px] mb-6 font-label-mono uppercase tracking-widest font-bold">面试时间轴</h4>
                <div className="space-y-5">
                  <div className="flex gap-4 text-[15px] items-center opacity-75 py-1">
                    <span className="text-on-surface-variant opacity-50 font-mono">00:01</span>
                    <span className="text-on-surface font-semibold">自我介绍</span>
                  </div>
                  <div className="flex gap-4 text-[15px] items-center opacity-75 py-1">
                    <span className="text-on-surface-variant opacity-50 font-mono">00:05</span>
                    <span className="text-on-surface font-semibold">项目介绍</span>
                  </div>
                  <div className="flex gap-4 text-[15px] text-secondary font-black bg-secondary/10 p-3.5 rounded-xl border border-secondary/20 -mx-2 items-center">
                    <span className="font-mono">00:18</span>
                    <span>Redis 深度: 信任崩溃时刻</span>
                  </div>
                  <div className="flex gap-4 text-[15px] items-center opacity-75 py-1">
                    <span className="text-on-surface-variant opacity-50 font-mono">00:24</span>
                    <span className="text-on-surface font-semibold">系统设计</span>
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
                    <p className="text-sm text-on-surface-variant font-label-mono tracking-widest font-extrabold">TRUST SCORE</p>
                    <h3 className="text-primary mt-1 leading-none" style={{ fontSize: "48px", fontWeight: 800, fontFamily: "'Hanken Grotesk', sans-serif" }}>82%</h3>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-secondary font-label-mono tracking-widest font-extrabold">CRITICAL DROP</p>
                    <h3 className="text-secondary mt-1 leading-none" style={{ fontSize: "48px", fontWeight: 800, fontFamily: "'Hanken Grotesk', sans-serif" }}>41%</h3>
                  </div>
                </div>

                {/* SVG Line Chart - Fixed camelCase SVG properties for zero console errors */}
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

                    {/* Smooth SVG Line curve - Lifted red portion upwards for elegant alignment */}
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
                      00:18 信任崩溃时刻
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
                      {formatTime(currentTime)} / 45:22
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Side Analysis Right */}
            <div className="md:col-span-3 flex flex-col gap-6">
              <div className="p-7 rounded-2xl bg-surface-container-low border border-white/5 flex flex-col justify-center flex-1 min-h-[160px]">
                <h4 className="text-secondary text-[15px] mb-4 font-label-mono font-bold flex items-center gap-2 uppercase tracking-widest">
                  <span className="material-symbols-outlined text-[18px]">warning</span> CRITICAL
                </h4>
                <p className="text-[16px] text-on-surface leading-relaxed font-semibold">
                  面试官想法：缺乏架构底座思维，判断项目经验不足。
                </p>
              </div>
              
              <div className="p-7 rounded-2xl glass-panel border border-tertiary/20 flex flex-col justify-center flex-1 min-h-[160px]">
                <h4 className="text-tertiary text-[15px] mb-4 font-label-mono font-bold uppercase tracking-widest">AI 重构建议</h4>
                <p className="text-[16px] text-on-surface-variant leading-relaxed font-semibold">
                  建议从 QPS 高并发场景切入，解释选择 RabbitMQ 的权衡。
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
              <StatCounter target={10000} suffix="+" />
            </div>
            <div className="text-on-surface-variant font-label-mono font-bold uppercase tracking-widest" style={{ fontSize: "14px" }}>真实面试分析</div>
          </div>
          
          <div className="text-center space-y-2 flex flex-col items-center justify-center">
            <div className="text-primary-container font-black tracking-tight leading-none" style={{ fontSize: "64px", fontFamily: "'Hanken Grotesk', sans-serif" }}>
              <StatCounter target={200000} suffix="+" />
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
              { icon: "visibility", color: "text-primary", bg: "bg-primary/10", title: "AI 深度洞察", desc: "面试官真实想法", stagger: "stagger-4" },
              { icon: "record_voice_over", color: "text-secondary", bg: "bg-secondary/10", title: "表达重构", desc: "高阶话术升级", stagger: "stagger-5" },
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
          className="absolute inset-0 opacity-15 pointer-events-none z-0"
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
            <h2 className="text-on-surface font-black tracking-tight" style={{ fontSize: "52px", fontFamily: "'Hanken Grotesk', sans-serif" }}>他们用 OfferPilot 拿到了更好的 Offer</h2>
            <p className="text-on-surface-variant font-label-mono font-bold tracking-widest uppercase" style={{ fontSize: "14px" }}>5,200+ 职业人士的真实反馈</p>
          </div>

          <div className="grid md:grid-cols-3 gap-8 w-full">
            {[
              {
                avatar: "https://lh3.googleusercontent.com/aida-public/AB6AXuAoBpggRj1UtigDFdEnOK0sAAmSdS-IVJ2H9W38TRex37DPfiHqEvwoY6eQcy4GeTPpfeEJDjyuoSFA55gzpIvv7R5Mfz9ZSXKlQbqUKTzPLxqLTXr-9tvsKlzmM1X0EAYIJVwDIewcFXEEh6EIHymYLEHtaG3QthqZnrrX0q-U87O-FrecJz9XcdHZoz2ZndesMcgGuwEkcaCDeujsrkHIVZ2b_s1ue1sD9aCOzimyGM0EZ6xbYMXOZYnG5fMTc5XCa01xnjuPbNeK",
                name: "张同学",
                title: "字节跳动 · 后端开发工程师",
                quote: "“之前总是不知道为什么面试挂了，OfferPilot 帮我找到了问题所在。最佩服的是 00:18 的那个信任崩溃点，让我恍然大悟！”",
                tagColor: "text-primary",
                tag: "拿到字节跳动 Offer"
              },
              {
                avatar: "https://lh3.googleusercontent.com/aida-public/AB6AXuDFshg7TaIUBGgEoN9JlGImNqjxSHpt7AhRu-PbphzAn5SRZ5yIKPQVnt7MjqHWSjcaFOH3c-Z9RctvigPYZQQzWs5DFeQO_8lLFFNccVXVeYJLk_8B5MUbPOvtedzFCeFMkASReREHENKonnQ5Dgtd3m5h88GZffVVuSKxtNnySeH3A2sgHaysDkze-IycN2pg951zf8B27PdqLrDFqy3SZcvE-YgWmwWmsV5-Y6lPMtJHGu_Qk2cjZdchCxr9yPyUq0ZhXGtK18lj",
                name: "李同学",
                title: "阿里巴巴 · 高级工程师",
                quote: "“AI 的建议非常精准，不是那种大而空的建议。而是针对我的问题 and 场景，重构后的表达让我面试中脱颖而出！”",
                tagColor: "text-tertiary",
                tag: "拿到阿里巴巴 Offer"
              },
              {
                avatar: "https://lh3.googleusercontent.com/aida-public/AB6AXuDq0oV8NegQm719QROkK-ggi194pRkwKl7fHB8GEkJwwxEDaGssftR2ZcL4XT3Iu35dejN5439XwRofApsNIVCKgZBrKYNaUhrbwoHxbvncKbDFu1dXrqkTGOxvL4VcAut8iUIAlSvE8TiAIkhn03XFAGoK0knqMY51qStDuYjR2L3bNHY4Sxn502nwfstmS1SsoSFUQxP86Imppj1BGJ2vIUH8tEeclAtdMMFYo856Zpim5zG7DD2nTHwiokYtUOCmtq6SU81uMO5u",
                name: "王同学",
                title: "腾讯 · 高级产品经理",
                quote: "“从简历优化到面试复盘，再到表达升级，OfferPilot 是我求职路上最亲密的战友，成功拿到了腾讯的 Offer！”",
                tagColor: "text-secondary",
                tag: "拿到腾讯 Offer"
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
        <div className="max-w-container-max mx-auto space-y-16 relative z-10 w-full flex flex-col items-center">
          <div className="text-center space-y-4 w-full">
            <div className="inline-flex items-center gap-2.5 px-5 py-2 rounded-full glass-panel border-primary/20 mb-4">
              <span className="font-label-mono tracking-[0.2em] text-primary uppercase font-bold" style={{ fontSize: "14px" }}>Flexible Pricing · 灵活订阅</span>
            </div>
            <h2 className="text-on-surface font-black tracking-tight" style={{ fontSize: "52px", fontFamily: "'Hanken Grotesk', sans-serif" }}>投资你的职业未来</h2>
            <p className="text-on-surface-variant font-semibold" style={{ fontSize: "18px" }}>选择最适合你的方案，开启高效求职之旅</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 w-full text-left">
            {/* Free Plan */}
            <div className="glass-panel p-8 rounded-[32px] flex flex-col border-white/5 hover:border-primary/30 hover:-translate-y-4 hover:shadow-[0_20px_40px_rgba(192,193,255,0.1)] transition-all duration-500 group">
              <div className="mb-8">
                <h3 className="font-bold mb-2 text-white" style={{ fontSize: "22px" }}>基础版</h3>
                <p className="text-on-surface-variant text-base font-medium">适合初探 AI 面试分析的用户</p>
              </div>
              <div className="mb-8">
                <div className="flex items-baseline gap-1">
                  <span className="font-black text-white" style={{ fontSize: "48px", fontFamily: "'Hanken Grotesk', sans-serif" }}>¥0</span>
                  <span className="text-on-surface-variant text-base font-bold">/月</span>
                </div>
              </div>
              <ul className="space-y-4 mb-10 flex-1 font-semibold">
                <li className="flex items-center gap-3 text-base text-on-surface-variant">
                  <span className="material-symbols-outlined text-primary text-lg">check_circle</span>
                  每月 1 次面试录音分析
                </li>
                <li className="flex items-center gap-3 text-base text-on-surface-variant">
                  <span className="material-symbols-outlined text-primary text-lg">check_circle</span>
                  基础信任度评分
                </li>
                <li className="flex items-center gap-3 text-base text-on-surface-variant">
                  <span className="material-symbols-outlined text-primary text-lg">check_circle</span>
                  标准转写服务
                </li>
              </ul>
              <button
                onClick={() => router.push("/debugger")}
                className="w-full py-4 rounded-xl border border-white/10 text-on-surface font-bold hover:bg-white/5 active:scale-95 transition-all cursor-pointer"
              >
                免费开始
              </button>
            </div>

            {/* PRO Plan (Current) */}
            <div className="glass-panel p-8 rounded-[32px] flex flex-col border-primary/30 relative bg-surface-container-low/50 hover:-translate-y-4 hover:shadow-[0_20px_50px_rgba(192,193,255,0.15)] transition-all duration-500">
              <div className="absolute -top-4 left-1/2 -translate-x-1/2 px-4 py-1.5 bg-primary text-on-primary text-xs font-extrabold rounded-full uppercase tracking-widest shadow-lg whitespace-nowrap">Current Plan · 当前方案</div>
              <div className="mb-8">
                <h3 className="font-bold mb-2 text-primary" style={{ fontSize: "22px" }}>专业版 PRO</h3>
                <p className="text-on-surface-variant text-base font-medium">最受欢迎的高级求职者之选</p>
              </div>
              <div className="mb-8">
                <div className="flex items-baseline gap-1">
                  <span className="font-black text-primary" style={{ fontSize: "48px", fontFamily: "'Hanken Grotesk', sans-serif" }}>¥69</span>
                  <span className="text-on-surface-variant text-base font-bold">/月</span>
                </div>
              </div>
              <ul className="space-y-4 mb-10 flex-1 font-semibold">
                <li className="flex items-center gap-3 text-base">
                  <span className="material-symbols-outlined text-primary text-lg">check_circle</span>
                  每月 10 次深度分析
                </li>
                <li className="flex items-center gap-3 text-base">
                  <span className="material-symbols-outlined text-primary text-lg">check_circle</span>
                  信任崩溃时刻精准定位
                </li>
                <li className="flex items-center gap-3 text-base">
                  <span className="material-symbols-outlined text-primary text-lg">check_circle</span>
                  AI 表达重构建议 (标准)
                </li>
                <li className="flex items-center gap-3 text-base">
                  <span className="material-symbols-outlined text-primary text-lg">check_circle</span>
                  简历风险实时扫描
                </li>
              </ul>
              <button className="w-full py-4 rounded-xl bg-primary text-on-primary font-black hover:scale-[1.02] active:scale-[0.98] transition-all shadow-[0_0_20px_rgba(192,193,255,0.2)] cursor-pointer">
                订阅
              </button>
            </div>

            {/* MAX Plan (Most Powerful) */}
            <div className="glass-panel p-8 rounded-[32px] flex flex-col border-white/5 hover:border-tertiary/50 hover:-translate-y-4 hover:shadow-[0_20px_40px_rgba(78,222,163,0.1)] transition-all duration-500 group relative overflow-hidden">
              <div className="absolute top-0 right-0 p-4 opacity-20 group-hover:opacity-100 transition-opacity">
                <span className="material-symbols-outlined text-4xl text-tertiary">bolt</span>
              </div>
              <div className="mb-8">
                <h3 className="font-bold mb-2 text-tertiary" style={{ fontSize: "22px" }}>极致版 MAX</h3>
                <p className="text-on-surface-variant text-base font-medium">全流程面试陪跑，斩获顶尖 Offer</p>
              </div>
              <div className="mb-8">
                <div className="flex items-baseline gap-1">
                  <span className="font-black text-white" style={{ fontSize: "48px", fontFamily: "'Hanken Grotesk', sans-serif" }}>¥99</span>
                  <span className="text-on-surface-variant text-base font-bold">/月</span>
                </div>
                <div className="mt-2 text-xs text-tertiary font-label-mono uppercase tracking-widest font-extrabold">Powerful Option · 专家之选</div>
              </div>
              <ul className="space-y-4 mb-10 flex-1 font-semibold">
                <li className="flex items-center gap-3 text-base">
                  <span className="material-symbols-outlined text-tertiary text-lg">verified</span>
                  无限次面试深度复盘
                </li>
                <li className="flex items-center gap-3 text-base">
                  <span className="material-symbols-outlined text-tertiary text-lg">verified</span>
                  面试官心理实时洞察
                </li>
                <li className="flex items-center gap-3 text-base">
                  <span className="material-symbols-outlined text-tertiary text-lg">verified</span>
                  高阶定制化话术重构
                </li>
                <li className="flex items-center gap-3 text-base">
                  <span className="material-symbols-outlined text-tertiary text-lg">verified</span>
                  1对1 AI 模拟面试导师
                </li>
                <li className="flex items-center gap-3 text-base">
                  <span className="material-symbols-outlined text-tertiary text-lg">verified</span>
                  大厂层级对应分析
                </li>
              </ul>
              <button className="w-full py-4 rounded-xl bg-tertiary text-on-tertiary font-black hover:scale-[1.02] active:scale-[0.98] transition-all shadow-[0_0_20px_rgba(78,222,163,0.2)] cursor-pointer">
                订阅
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
            className="absolute inset-0 opacity-15 group-hover:opacity-30 transition-opacity duration-500 pointer-events-none -z-10"
            style={{
              backgroundImage: `linear-gradient(to bottom, rgba(11, 19, 38, 0.2) 0%, rgba(11, 19, 38, 0.95) 100%), url('/home-start.jpg')`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            }}
          />
          
          <h2 className="text-on-surface font-black tracking-tight relative z-10" style={{ fontSize: "52px", fontFamily: "'Hanken Grotesk', sans-serif" }}>准备好开启智能职业生涯了吗？</h2>
          
          <div className="w-full max-w-3xl mx-auto block mb-10 relative z-10">
            <p className="text-on-surface-variant whitespace-normal break-words" style={{ fontSize: "18px", lineHeight: "1.6", fontWeight: 400, fontFamily: "Inter, sans-serif" }}>
              立即体验 OfferPilot，发现你的面试优势，拿到心仪 Offer。
            </p>
          </div>
          
          <div className="flex flex-wrap justify-center gap-4 relative z-10 w-full">
            <button onClick={() => router.push("/debugger")} className="px-12 py-4 bg-primary text-on-primary font-black rounded-xl shadow-2xl hover:scale-105 active:scale-95 transition-all cursor-pointer">
              立即免费分析
            </button>
            <button className="px-12 py-4 border border-white/10 hover:bg-white/5 active:scale-95 text-on-surface font-bold rounded-xl transition-all cursor-pointer">
              预约产品演示
            </button>
          </div>
        </TiltCard>
      </section>

      {/* Footer - Spans 100% width across the browser */}
      <footer className="bg-surface-container-lowest border-t border-white/5 w-full block">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-stack-gap px-gutter py-section-padding max-w-container-max mx-auto text-left">
          <div className="col-span-1 md:col-span-2 space-y-6">
            <div className="text-xl font-black text-on-surface" style={{ fontSize: "32px", fontFamily: "'Hanken Grotesk', sans-serif" }}>OfferPilot</div>
            <div className="w-full max-w-xs block">
              <p className="text-on-surface-variant text-sm font-medium leading-relaxed">
                AI Interview OS · 全流程面试分析引擎 让每一次面试都成为通往 Offer 的阶梯。
              </p>
            </div>
            <div className="flex gap-4">
              <a className="text-on-surface-variant hover:text-primary transition-colors flex items-center justify-center w-8 h-8 rounded-full bg-white/5" href="#">
                <span className="material-symbols-outlined text-[16px]">share</span>
              </a>
              <a className="text-on-surface-variant hover:text-primary transition-colors flex items-center justify-center w-8 h-8 rounded-full bg-white/5" href="#">
                <span className="material-symbols-outlined text-[16px]">hub</span>
              </a>
            </div>
          </div>
          
          <div className="space-y-4">
            <h4 className="font-extrabold text-on-surface">产品</h4>
            <ul className="space-y-2 text-sm text-on-surface-variant font-semibold">
              <li><a className="hover:text-primary transition-colors" href="#">面试分析</a></li>
              <li><a className="hover:text-primary transition-colors" href="#">简历优化</a></li>
              <li><a className="hover:text-primary transition-colors" href="#">模拟面试</a></li>
              <li><a className="hover:text-primary transition-colors" href="#">Offer 冲刺</a></li>
            </ul>
          </div>
          
          <div className="space-y-4">
            <h4 className="font-extrabold text-on-surface">解决方案</h4>
            <ul className="space-y-2 text-sm text-on-surface-variant font-semibold">
              <li><a className="hover:text-primary transition-colors" href="#">技术面试</a></li>
              <li><a className="hover:text-primary transition-colors" href="#">产品面试</a></li>
              <li><a className="hover:text-primary transition-colors" href="#">筹备面试</a></li>
              <li><a className="hover:text-primary transition-colors" href="#">管理面试</a></li>
            </ul>
          </div>
          
          <div className="space-y-4">
            <h4 className="font-extrabold text-on-surface">资源</h4>
            <ul className="space-y-2 text-sm text-on-surface-variant font-semibold">
              <li><a className="hover:text-primary transition-colors" href="#">面试指南</a></li>
              <li><a className="hover:text-primary transition-colors" href="#">案例分析</a></li>
              <li><a className="hover:text-primary transition-colors" href="#">行业报告</a></li>
              <li><a className="hover:text-primary transition-colors" href="#">帮助文档</a></li>
            </ul>
          </div>
        </div>
        
        <div className="px-gutter py-8 border-t border-white/5 max-w-container-max mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-xs text-on-surface-variant font-label-mono font-bold tracking-widest">© 2026 OfferPilot AI. All rights reserved.</p>
          <div className="flex gap-8 text-xs text-on-surface-variant font-label-mono font-bold tracking-widest">
            <a className="hover:text-primary transition-colors" href="#">隐私政策</a>
            <a className="hover:text-primary transition-colors" href="#">服务条款</a>
            <a className="hover:text-primary transition-colors" href="#">Cookie 设置</a>
          </div>
        </div>
      </footer>
    </main>
  );
}
