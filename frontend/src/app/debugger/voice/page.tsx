"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth, UserMenu } from "@/components/AuthProvider";

// =========================================================================
// INTERFACES & MOCK DATABASE (ALIGNING 100% TO NEW GPT DESIGN SCREENSHOT)
// =========================================================================
interface DialogueItem {
  sender: "interviewer" | "user";
  name: string;
  time: string;
  seconds: number;
  text: string;
  badgeText?: string;
  badgeClass?: string;
}

interface SegmentData {
  id: number;
  label: string;
  timeRange: string;
  durationText: string;
  secondsStart: number;
  secondsEnd: number;
  tag: "良好" | "一般" | "风险";
  tagColor: string;
  score: number;
  badgeText: string;
  badgeColor: string;
  summary: string;
  advantages: string[];
  shortcomings: string[];
  reviewPoints: string[];
  ipiTrendPoints: number[];
  radarScores: {
    depth: number;
    system: number;
    expression: number;
    solving: number;
    implementation: number;
  };
  dialogue: DialogueItem[];
}

const SEGMENTS_DATA: SegmentData[] = [
  {
    id: 1,
    label: "自我介绍",
    timeRange: "00:00 - 02:15",
    durationText: "02:15",
    secondsStart: 0,
    secondsEnd: 135,
    tag: "良好",
    tagColor: "text-[#5DECCB] bg-[#5DECCB]/10 border-[#5DECCB]/20",
    score: 85,
    badgeText: "表现优秀",
    badgeColor: "bg-[#5DECCB]/10 text-[#5DECCB]",
    summary: "自我介绍框架清晰，表达流利。重点突出了6年高并发开发履历，有效树立起专业研发的第一印象。但时间控制稍紧，未能充分扣合本次应聘岗位的差异化痛点。",
    advantages: ["核心高并发履历总结到位", "逻辑连贯，语气自信"],
    shortcomings: ["缺少对目标岗位定制化痛点的对齐", "表达中稍微缺乏量化数据背书"],
    reviewPoints: ["结构化叙事方法", "STAR核心数据提炼", "目标岗位JD匹配度设计"],
    ipiTrendPoints: [78, 82, 85, 83, 85, 84, 88],
    radarScores: { depth: 75, system: 70, expression: 85, solving: 78, implementation: 80 },
    dialogue: [
      {
        sender: "interviewer",
        name: "面试官",
        time: "00:05",
        seconds: 5,
        text: "你好，欢迎参加技术面试，请先做一个简短的自我介绍吧。"
      },
      {
        sender: "user",
        name: "您",
        time: "00:15",
        seconds: 15,
        text: "面试官您好，我叫张三，拥有6年后端高并发开发经验。曾在前公司作为核心成员设计了亿级DAU的数据分发和缓存架构，主导了秒杀一致性系统的落地...",
        badgeText: "回答较好",
        badgeClass: "text-[#AFA7FF] bg-[#AFA7FF]/10 border-[#AFA7FF]/20"
      }
    ]
  },
  {
    id: 2,
    label: "项目经验追问",
    timeRange: "02:16 - 05:40",
    durationText: "03:24",
    secondsStart: 136,
    secondsEnd: 340,
    tag: "一般",
    tagColor: "text-[#AFA7FF] bg-[#AFA7FF]/10 border-[#AFA7FF]/20",
    score: 72,
    badgeText: "中等表现",
    badgeColor: "bg-[#AFA7FF]/10 text-[#AFA7FF]",
    summary: "在陈述秒杀系统写缓冲和本地限流方案时逻辑成立，但在被追问并发堆积时如何保障多级缓存写屏障一致性及内存降级时，缺乏细分数值把控与方案权衡。",
    advantages: ["限流与削峰方案描述基本无误", "主动阐明了系统重构的初衷"],
    shortcomings: ["对多级缓存写屏障边界描述模糊", "堆积极限场景的兜底深度欠缺"],
    reviewPoints: ["多级缓存写同步原理", "堆积状态容灾拦截", "内存兜底设计"],
    ipiTrendPoints: [75, 78, 70, 72, 74, 80, 82],
    radarScores: { depth: 78, system: 75, expression: 80, solving: 72, implementation: 76 },
    dialogue: [
      {
        sender: "interviewer",
        name: "面试官",
        time: "02:20",
        seconds: 140,
        text: "你说到了重构秒杀系统，那在高并发流量突增的瞬间，你们是如何保障多级缓存和数据库的写屏障一致性的？"
      },
      {
        sender: "user",
        name: "您",
        time: "02:45",
        seconds: 165,
        text: "我们当时主要是通过在写入时加入本地轻量队列，并将写事件单向异步广播到 Redis 来完成削峰，同时对数据库做批量写入限制。",
        badgeText: "回答不够全面",
        badgeClass: "text-[#FF7A95] bg-[#FF7A95]/10 border-[#FF7A95]/20"
      }
    ]
  },
  {
    id: 3,
    label: "技术深挖: Redis",
    timeRange: "05:41 - 09:18",
    durationText: "03:37",
    secondsStart: 341,
    secondsEnd: 558,
    tag: "风险",
    tagColor: "text-[#FF7A95] bg-[#FF7A95]/10 border-[#FF7A95]/20",
    score: 68,
    badgeText: "中等表现",
    badgeColor: "bg-[#5DECCB]/10 text-[#5DECCB]",
    summary: "在 Redis 相关问题上，对基本原理掌握较好，但在一致性方案和并发场景的处理上回答不够深入，缺乏具体实践经验和优化思考。建议加强对缓存一致性方案的理解，并准备更多实际项目中的难题方案。",
    advantages: ["理解 Redis 基本原理", "能主动思考并发问题"],
    shortcomings: ["一致性方案不够完整", "缺乏具体项目案例支撑"],
    reviewPoints: ["缓存一致性方案", "并发场景处理", "热点问题优化"],
    ipiTrendPoints: [78, 80, 76, 70, 62, 58, 68], // Drops to 58 around 06:22 and recovers slightly
    radarScores: { depth: 72, system: 65, expression: 60, solving: 68, implementation: 58 },
    dialogue: [
      {
        sender: "interviewer",
        name: "面试官",
        time: "05:41",
        seconds: 341,
        text: "为什么使用 Redis？"
      },
      {
        sender: "user",
        name: "您",
        time: "05:52",
        seconds: 352,
        text: "因为 Redis 性能高，可以做缓存，提升接口响应速度。"
      },
      {
        sender: "interviewer",
        name: "面试官",
        time: "06:15",
        seconds: 375,
        text: "如果数据和数据库不一致怎么办？"
      },
      {
        sender: "user",
        name: "您",
        time: "06:22",
        seconds: 382,
        text: "可以用双删策略，先删缓存，再更新数据库，最后再删一次缓存。",
        badgeText: "回答不够全面",
        badgeClass: "text-[#FF7A95] bg-[#FF7A95]/10 border-[#FF7A95]/20"
      },
      {
        sender: "interviewer",
        name: "面试官",
        time: "06:40",
        seconds: 400,
        text: "双删策略有什么问题？"
      },
      {
        sender: "user",
        name: "您",
        time: "06:45",
        seconds: 405,
        text: "可能会有并发问题，导致脏数据...",
        badgeText: "回答较好",
        badgeClass: "text-[#AFA7FF] bg-[#AFA7FF]/10 border-[#AFA7FF]/20"
      },
      {
        sender: "interviewer",
        name: "面试官",
        time: "07:02",
        seconds: 422,
        text: "那你用过什么更好的方案吗？"
      }
    ]
  },
  {
    id: 4,
    label: "系统设计",
    timeRange: "09:19 - 14:35",
    durationText: "05:16",
    secondsStart: 559,
    secondsEnd: 875,
    tag: "一般",
    tagColor: "text-[#AFA7FF] bg-[#AFA7FF]/10 border-[#AFA7FF]/20",
    score: 75,
    badgeText: "中等表现",
    badgeColor: "bg-[#AFA7FF]/10 text-[#AFA7FF]",
    summary: "不停机数据平滑热迁移的方案描述大体得体，双写和增量追平方案清晰。但在多级一致性校验（Binlog位点对齐）及灰度切流步骤上陈述较窄，缺乏大厂复杂网络环境下的避坑反思。",
    advantages: ["数据双写流程脉络完整", "架构分流层次分明"],
    shortcomings: ["缺失Binlog数据校验细节", "灰度发布异常回滚机制单薄"],
    reviewPoints: ["千万级平滑迁移", "Binlog位点对齐", "灰度流量切流机制"],
    ipiTrendPoints: [68, 70, 72, 75, 76, 78, 80],
    radarScores: { depth: 80, system: 82, expression: 78, solving: 80, implementation: 75 },
    dialogue: [
      {
        sender: "interviewer",
        name: "面试官",
        time: "09:25",
        seconds: 565,
        text: "如果老库有一个千万级单表，不停机热迁移到新分库分表，你会如何安排以保证数据零丢失且平滑迁移？"
      },
      {
        sender: "user",
        name: "您",
        time: "10:15",
        seconds: 615,
        text: "我们会用双写方案。首先启动新老库双写，然后全量校验，最后灰度读流量切新库。",
        badgeText: "回答较好",
        badgeClass: "text-[#AFA7FF] bg-[#AFA7FF]/10 border-[#AFA7FF]/20"
      }
    ]
  },
  {
    id: 5,
    label: "分布式事务",
    timeRange: "14:36 - 20:02",
    durationText: "05:26",
    secondsStart: 876,
    secondsEnd: 1202,
    tag: "风险",
    tagColor: "text-[#FF7A95] bg-[#FF7A95]/10 border-[#FF7A95]/20",
    score: 58,
    badgeText: "表现预警",
    badgeColor: "bg-[#FF7A95]/10 text-[#FF7A95]",
    summary: "对 TCC 分布式事务三大异常（空回滚、幂等、悬挂）防范策略叙述混乱，无法清晰陈述分支事务控制表的拦截原理与状态机图谱，此环节暴露出分布式一致性工程理论短板较重。",
    advantages: ["理解 TCC 二阶段状态拆解"],
    shortcomings: ["完全模糊了空回滚与悬挂底层防线", "状态机异常流拦截叙事不严密"],
    reviewPoints: ["TCC异常处理机制", "分支事务控制表", "状态机设计规约"],
    ipiTrendPoints: [78, 75, 68, 60, 55, 58, 62],
    radarScores: { depth: 68, system: 62, expression: 65, solving: 58, implementation: 60 },
    dialogue: [
      {
        sender: "interviewer",
        name: "面试官",
        time: "14:40",
        seconds: 880,
        text: "在 TCC 分布式事务中，如果网络出现异常，Cancel 优先于 Try 到达或者 Try 失败了但触发了 Cancel，你怎么防范‘悬挂’和‘空回滚’？"
      },
      {
        sender: "user",
        name: "您",
        time: "15:20",
        seconds: 920,
        text: "空回滚的话，就是检查 Try 是否执行过...悬挂的话可能要让 Cancel 等一下再执行。但具体怎么从底层拦截，我记不太清了。",
        badgeText: "回答不够全面",
        badgeClass: "text-[#FF7A95] bg-[#FF7A95]/10 border-[#FF7A95]/20"
      }
    ]
  },
  {
    id: 6,
    label: "行为面试",
    timeRange: "20:03 - 32:18",
    durationText: "12:15",
    secondsStart: 1203,
    secondsEnd: 1938,
    tag: "良好",
    tagColor: "text-[#5DECCB] bg-[#5DECCB]/10 border-[#5DECCB]/20",
    score: 88,
    badgeText: "表现优秀",
    badgeColor: "bg-[#5DECCB]/10 text-[#5DECCB]",
    summary: "行为测试展现出优秀的线上应急素养。精准基于 STAR 框架描述了大促死锁瞬间降级止血和团队敏捷协作，展示了中高级开发人员必不可少的抗压性与业务 Owner 精神。",
    advantages: ["排障步骤清晰，有条不紊", "抗压性及团队协作能力极强"],
    shortcomings: ["死锁底层索引竞争成因若能深化阐述会更有技术厚度"],
    reviewPoints: ["STAR叙事范式", "大并发故障降级", "MySQL死锁深度分析"],
    ipiTrendPoints: [65, 70, 78, 82, 85, 88, 90],
    radarScores: { depth: 82, system: 80, expression: 88, solving: 85, implementation: 86 },
    dialogue: [
      {
        sender: "interviewer",
        name: "面试官",
        time: "20:10",
        seconds: 1210,
        text: "作为业务骨干，你遇到过严重的线上高并发崩溃事故吗？你是怎么主导紧急抢修定位的？"
      },
      {
        sender: "user",
        name: "您",
        time: "20:30",
        seconds: 1230,
        text: "遇到过。去年大促期间，由于上游数据库发生死锁。我作为总协调，第一步拉取 Dump 分析，第二步加本地限流降级止血，最后上线热修。在30分钟内挽回了数十万损失...",
        badgeText: "回答较好",
        badgeClass: "text-[#AFA7FF] bg-[#AFA7FF]/10 border-[#AFA7FF]/20"
      }
    ]
  }
];

// 3 Critical general risk markers in Column 3 / Card 2
const GENERAL_RISKS = [
  { time: "08:15", label: "缓存一致性方案不完整", tag: "高风险", tagClass: "text-[#FF7A95] bg-[#FF7A95]/10 border-[#FF7A95]/20", sec: 495 },
  { time: "14:02", label: "分布式事务方案考虑不全面", tag: "高风险", tagClass: "text-[#FF7A95] bg-[#FF7A95]/10 border-[#FF7A95]/20", sec: 842 },
  { time: "18:33", label: "CAP 理论理解不够深入", tag: "中风险", tagClass: "text-[#AFA7FF] bg-[#AFA7FF]/10 border-[#AFA7FF]/20", sec: 1113 }
];

// =========================================================================
// MAIN PAGE COMPONENT (AI INTERVIEW INTELLIGENCE CENTER - REDESIGNED V2)
// =========================================================================
export default function InterviewVoiceAnalysisPage() {
  const router = useRouter();
  const auth = useAuth();

  // Onboarding / AI Segmenting Animation States
  const [isSegmenting, setIsSegmenting] = useState(false);
  const [segmentingStep, setSegmentingStep] = useState(0);

  // Active Timeline Segment
  const [activeSegIdx, setActiveSegIdx] = useState(2); // Default to selected "技术深挖: Redis" (index 2)
  const activeSeg = SEGMENTS_DATA[activeSegIdx];

  // Simulated Player States
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackTime, setPlaybackTime] = useState(SEGMENTS_DATA[2].secondsStart);
  const segmentDuration = activeSeg.secondsEnd - activeSeg.secondsStart;
  const playedPercent = segmentDuration > 0 ? ((playbackTime - activeSeg.secondsStart) / segmentDuration) * 100 : 0;
  const [playSpeed, setPlaySpeed] = useState(1.0);
  const playTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Edit / Form states
  const [interviewInfo] = useState({
    company: "字节跳动",
    role: "后端开发工程师",
    round: "技术一面",
    time: "2026-06-01",
    level: "P6",
    salary: "35-40K",
    years: "3-5年",
    isOnJob: "在职"
  });

  // Next steps optimizer script generation modal
  const [showOptimizer, setShowOptimizer] = useState(false);
  const [optPhase, setOptPhase] = useState("idle");

  // Search state variables
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Timer logic for loading screen removed since loading is skipped on mount

  // Reset player when active segment changes
  useEffect(() => {
    setIsPlaying(false);
    setPlaybackTime(activeSeg.secondsStart);
    if (playTimerRef.current) {
      clearInterval(playTimerRef.current);
    }
  }, [activeSegIdx]);

  // Handle Player interval loops
  useEffect(() => {
    if (isPlaying) {
      playTimerRef.current = setInterval(() => {
        setPlaybackTime((prev) => {
          if (prev >= activeSeg.secondsEnd) {
            setIsPlaying(false);
            return activeSeg.secondsEnd;
          }
          return prev + 1;
        });
      }, 1000 / playSpeed);
    } else {
      if (playTimerRef.current) {
        clearInterval(playTimerRef.current);
      }
    }

    return () => {
      if (playTimerRef.current) {
        clearInterval(playTimerRef.current);
      }
    };
  }, [isPlaying, playSpeed, activeSeg]);

  // Format seconds to MM:SS
  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  // Skip playback cursor by delta offset
  const skipTime = (offset: number) => {
    setPlaybackTime((prev) => {
      const target = prev + offset;
      if (target < activeSeg.secondsStart) return activeSeg.secondsStart;
      if (target > activeSeg.secondsEnd) return activeSeg.secondsEnd;
      return target;
    });
  };

  // Jump playhead directly to specific seconds
  const jumpPlayhead = (sec: number) => {
    const targetSegIdx = SEGMENTS_DATA.findIndex(s => sec >= s.secondsStart && sec <= s.secondsEnd);
    if (targetSegIdx !== -1) {
      setActiveSegIdx(targetSegIdx);
      setTimeout(() => {
        setPlaybackTime(sec);
        setIsPlaying(true);
      }, 50);
    } else {
      setPlaybackTime(sec);
      setIsPlaying(true);
    }
  };

  // Trigger Action Advice generation
  const startOptimizationGen = () => {
    setOptPhase("loading");
    setTimeout(() => {
      setOptPhase("completed");
    }, 1800);
  };

  return (
    <div className="min-h-screen bg-[#050B1A] text-[#dae2fd] font-body-md flex flex-col relative overflow-hidden select-none pt-20">
      
      {/* Background grids */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff02_1px,transparent_1px),linear-gradient(to_bottom,#ffffff02_1px,transparent_1px)] bg-[size:40px_40px] pointer-events-none z-0" />
      <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-[#AFA7FF]/5 rounded-full blur-[160px] pointer-events-none z-0" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-[#5DECCB]/3 rounded-full blur-[160px] pointer-events-none z-0" />

      {/* ========================================================
          GLOBAL WORKBENCH NAVBAR (Fixed top-0)
         ======================================================== */}
      <nav className="fixed top-0 w-full z-40 bg-surface/80 backdrop-blur-xl border-b border-white/10">
        <div className="flex justify-between items-center h-20 px-gutter max-w-container-max mx-auto w-full relative">
          
          <div
            onClick={() => router.push("/")}
            className="text-2xl font-display-xl font-bold tracking-tight text-on-surface flex items-center gap-2 cursor-pointer"
          >
            <svg className="w-7 h-7" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L20 7V17L12 22L4 17V7L12 2Z" fill="url(#nav-brand-logo)" />
              <path d="M12 6L16 11H13V18L12 18L11 18V13H8L12 6Z" fill="#050B1A" />
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
              onClick={() => router.push("/debugger")}
              className="px-4.5 py-2 bg-white/5 border border-white/10 rounded-full text-sm font-bold text-on-surface hover:bg-white/10 transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <span className="material-symbols-outlined text-base">add</span>新建分析
            </button>
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
          MAIN WORKSPACE DASHBOARD
         ======================================================== */}
      <motion.div
        key="dashboard"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex-1 flex flex-col px-gutter max-w-container-max mx-auto w-full py-6 gap-5.5 text-left relative z-10"
      >
            {/* ========================================================
                MAIN WORKSPACE GRID LAYOUT (3 COLUMNS)
               ======================================================== */}
            <div className="grid grid-cols-12 gap-5.5 items-stretch w-full">
              
              {/* ----------------------------------------------------
                  COLUMN 1: Left Sidebar (3 cols)
                 ---------------------------------------------------- */}
              <div className="col-span-12 lg:col-span-3 flex flex-col gap-4.5">
                
                {/* Sidebar Header */}
                <div className="pb-1 select-none text-left">
                  <h3 className="font-black text-white text-base">面试调试器</h3>
                  <p className="text-[10px] text-white/30 font-mono font-bold mt-0.5">Session #8824</p>
                </div>

                {/* 1.1 Interview Metadata Card */}
                <div className="glass-panel p-4.5 rounded-2xl border-white/5 flex flex-col gap-3.5">
                  <div className="flex justify-between items-center pb-2 border-b border-white/5">
                    <h4 className="text-sm font-black text-white uppercase tracking-wider flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-base text-[#00D4FF]">assignment_ind</span>
                      面试信息
                    </h4>
                    <span 
                      onClick={() => alert("录音分析模式下面试信息修改请重新启动调试Session")}
                      className="text-base font-black text-[#AFA7FF] hover:text-white transition-colors cursor-pointer flex items-center justify-center gap-1"
                    >
                      编辑
                    </span>
                  </div>

                  <div className="space-y-2.5 text-xs font-bold text-white/60">
                    <div className="flex justify-between items-center">
                      <span>是否在职</span>
                      <span className="px-2 py-0.5 rounded bg-[#5DECCB]/10 text-[#5DECCB] border border-[#5DECCB]/20 text-xs font-extrabold">
                        {interviewInfo.isOnJob}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span>工作年限</span>
                      <span className="text-white font-extrabold">{interviewInfo.years}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span>面试公司</span>
                      <span className="text-white font-extrabold">{interviewInfo.company}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span>面试岗位</span>
                      <span className="text-white font-extrabold">{interviewInfo.role}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span>面试轮次</span>
                      <span className="text-white font-extrabold">{interviewInfo.round}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span>面试时间</span>
                      <span className="text-white font-extrabold">{interviewInfo.time}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span>岗位职级</span>
                      <span className="text-white font-extrabold">{interviewInfo.level}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span>期望薪资</span>
                      <span className="text-white font-extrabold">{interviewInfo.salary}</span>
                    </div>
                  </div>
                </div>

                {/* 1.2 Interview Vertical Timeline Selector */}
                <div className="glass-panel p-4.5 rounded-2xl border-white/5 flex flex-col gap-3.5 flex-1">
                  <div className="flex justify-between items-center pb-2 border-b border-white/5">
                    <h4 className="text-sm font-black text-white uppercase tracking-wider flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-base text-[#00D4FF]">list_alt</span>
                      面试时间线
                    </h4>
                    <span className="text-sm text-white/40 font-mono">共 6 个片段, 32:18</span>
                  </div>

                  {/* Vertical Segment items */}
                  <div className="flex-1 overflow-y-auto space-y-3 pr-1 select-none">
                    {SEGMENTS_DATA.map((seg, idx) => {
                      const isSelected = activeSegIdx === idx;
                      const isRisk = seg.tag === "风险";
                      const isGood = seg.tag === "良好";

                      // Circle dot color
                      const dotColor = isRisk ? "bg-[#FF7A95] shadow-[0_0_8px_rgba(255,122,149,0.4)]" : isGood ? "bg-[#5DECCB]" : "bg-[#AFA7FF]";
                      
                      // Right tag color
                      const badgeClass = isRisk 
                        ? "text-[#FF7A95] bg-[#FF7A95]/10 border-[#FF7A95]/20" 
                        : isGood 
                          ? "text-[#5DECCB] bg-[#5DECCB]/10 border-[#5DECCB]/20" 
                          : "text-[#AFA7FF] bg-[#AFA7FF]/10 border-[#AFA7FF]/20";

                      return (
                        <div
                          key={seg.id}
                          onClick={() => {
                            setActiveSegIdx(idx);
                            setPlaybackTime(seg.secondsStart);
                          }}
                          className={`p-3.5 rounded-xl border text-left cursor-pointer transition-all duration-300 relative flex items-center justify-between gap-3 ${
                            isSelected
                              ? "bg-[#AFA7FF]/5 border-[#AFA7FF]/20 shadow-lg shadow-[#AFA7FF]/5"
                              : "bg-[#050B1A]/40 border-white/5 hover:border-white/10 hover:bg-[#050B1A]/80"
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            {/* Connector line dot */}
                            <span className={`w-2 h-2 rounded-full shrink-0 ${dotColor}`} />
                            <div className="space-y-0.5">
                              <span className="text-xs text-white/40 font-mono block leading-none">{seg.timeRange}</span>
                              <h5 className={`text-sm font-black truncate leading-tight ${isSelected ? "text-[#AFA7FF]" : "text-white"}`}>
                                {seg.label}
                              </h5>
                            </div>
                          </div>

                          <span className={`px-2 py-0.5 rounded text-[11px] font-black uppercase border shrink-0 ${badgeClass}`}>
                            {seg.tag}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  <button 
                    onClick={() => alert("完整全场 32 分钟日志已下载！")}
                    className="w-full py-2 bg-white/5 hover:bg-white/10 border border-white/10 text-white text-sm font-black rounded-xl transition-all cursor-pointer text-center"
                  >
                    导出完整日志
                  </button>
                </div>

              </div>

              {/* ----------------------------------------------------
                  COLUMN 2: Center Workspace (6 cols)
                 ---------------------------------------------------- */}
              <div className="col-span-12 lg:col-span-5.5 xl:col-span-6 flex flex-col gap-4.5">
                
                {/* 2.1 Wave Player & Info Header */}
                <div className="glass-panel p-5.5 rounded-2xl border-white/5 flex flex-col gap-4.5">
                  
                  {/* Title & Metadata */}
                  <div className="flex justify-between items-center pb-2 border-b border-white/5">
                    <div className="space-y-1 select-none">
                      <div className="flex items-center gap-2">
                        <h2 className="text-lg font-black text-white">{activeSeg.label}</h2>
                        <span className="px-1.5 py-0.2 rounded text-[10px] font-black text-[#FF7A95] bg-[#FF7A95]/10 border border-[#FF7A95]/20 uppercase">
                          {activeSeg.tag}片段
                        </span>
                      </div>
                      <p className="text-xs text-white/30 font-bold font-mono">
                        {activeSeg.timeRange} &bull; 历时 {activeSeg.durationText}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 select-none">
                      <button 
                        onClick={() => alert("本段 32kbps 音频文件下载中...")}
                        className="px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 text-white text-xs font-bold rounded-lg transition-all flex items-center gap-1 cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-sm">download</span>下载片段
                      </button>
                      <button 
                        onClick={() => {
                          navigator.clipboard.writeText(window.location.href);
                          alert("本段诊断页面链接已复制！");
                        }}
                        className="px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 text-white text-xs font-bold rounded-lg transition-all flex items-center gap-1 cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-sm">link</span>复制链接
                      </button>
                    </div>
                  </div>

                  {/* Elegant Thin Waveform Player */}
                  <div className="bg-slate-950/40 border border-white/5 rounded-2xl p-4 flex flex-col gap-2 relative">
                    
                    <div className="flex items-center gap-4.5">
                      
                      {/* Play / Pause */}
                      <button 
                        onClick={() => setIsPlaying(!isPlaying)}
                        className="w-10 h-10 rounded-full bg-gradient-to-tr from-[#AFA7FF] to-[#00D4FF] hover:scale-105 active:scale-95 transition-all flex items-center justify-center cursor-pointer shadow-lg shadow-purple-500/10 shrink-0"
                      >
                        <span className="material-symbols-outlined text-[#050B1A] text-xl font-black" style={{ fontVariationSettings: "'FILL' 1" }}>
                          {isPlaying ? "pause" : "play_arrow"}
                        </span>
                      </button>

                      {/* Waveform track */}
                      <div className="flex-1 h-9 relative flex items-center justify-between gap-[1.5px] select-none py-1">
                        {Array.from({ length: 66 }).map((_, wIdx) => {
                          const percentIndex = (wIdx / 66) * 100;
                          const isPlayed = percentIndex <= playedPercent;
                          
                          // Fine mirrored height profiles
                          const heightMap = [
                            10, 15, 20, 25, 18, 12, 10, 16, 22, 34, 45, 52, 40, 25, 15, 30, 52, 68, 75, 62, 45, 25,
                            12, 18, 22, 32, 42, 58, 48, 38, 20, 12, 22, 40, 55, 62, 48, 30, 15, 10, 14, 25, 32, 20,
                            12, 8, 14, 28, 40, 48, 35, 22, 12, 8, 14, 25, 34, 20, 12, 8, 12, 18, 12, 8, 5, 3
                          ];
                          const hValue = heightMap[wIdx] || 15;

                          const segSeconds = activeSeg.secondsEnd - activeSeg.secondsStart;
                          const targetSecs = activeSeg.secondsStart + Math.round((wIdx / 66) * segSeconds);

                          return (
                            <div
                              key={wIdx}
                              onClick={() => jumpPlayhead(targetSecs)}
                              style={{ height: `${hValue}%` }}
                              className={`w-full rounded-sm cursor-pointer transition-all duration-300 ${
                                isPlayed 
                                  ? "bg-gradient-to-t from-[#AFA7FF] to-[#00D4FF]" 
                                  : "bg-white/10 hover:bg-white/20"
                              }`}
                            />
                          );
                        })}

                        {/* Red Playhead line */}
                        <div 
                          style={{ left: `${playedPercent}%` }}
                          className="absolute top-0 bottom-0 w-[1.5px] bg-[#FF7A95] z-20 pointer-events-none transition-all duration-100"
                        >
                          {/* Dotted playhead readout badge */}
                          <div className="absolute bottom-[-16px] left-1/2 -translate-x-1/2 bg-[#FF7A95] text-[#050B1A] text-[11px] font-bold font-mono px-1.5 py-0.5 rounded select-none">
                            {formatTime(playbackTime)}
                          </div>
                        </div>
                      </div>

                      {/* Right controls */}
                      <div className="flex items-center gap-2 font-mono shrink-0 select-none">
                        
                        {/* Speed multiplier */}
                        <select
                          value={playSpeed}
                          onChange={(e) => setPlaySpeed(parseFloat(e.target.value))}
                          className="bg-white/5 border-0 rounded-md py-1.5 pl-2 pr-7 text-xs md:text-sm text-white focus:outline-none cursor-pointer font-bold w-20"
                        >
                          <option value="1.0" className="bg-[#050B1A]">1.0x</option>
                          <option value="1.25" className="bg-[#050B1A]">1.25x</option>
                          <option value="1.5" className="bg-[#050B1A]">1.5x</option>
                          
                        </select>

                        {/* Skip 15s back */}
                        <button 
                          onClick={() => skipTime(-15)}
                          className="w-7 h-7 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-white/60 hover:text-white cursor-pointer hover:bg-white/10 transition-all"
                          title="后退 15 秒"
                        >
                          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <path d="M12.5 16.5C8.91015 16.5 6 13.5899 6 10C6 6.41015 8.91015 3.5 12.5 3.5C16.0899 3.5 19 6.41015 19 10C19 12.5185 17.5683 14.7042 15.5 15.75" strokeLinecap="round" />
                            <path d="M6 10L3 7.5M6 10L9 7.5" strokeLinecap="round" />
                          </svg>
                        </button>

                        {/* Skip 15s forward */}
                        <button 
                          onClick={() => skipTime(15)}
                          className="w-7 h-7 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-white/60 hover:text-white cursor-pointer hover:bg-white/10 transition-all"
                          title="前进 15 秒"
                        >
                          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <path d="M11.5 16.5C15.0899 16.5 18 13.5899 18 10C18 6.41015 15.0899 3.5 11.5 3.5C7.91015 3.5 5 6.41015 5 10C5 12.5185 6.4317 14.7042 8.5 15.75" strokeLinecap="round" />
                            <path d="M18 10L21 7.5M18 10L15 7.5" strokeLinecap="round" />
                          </svg>
                        </button>

                      </div>

                    </div>

                    {/* Timeline boundaries */}
                    <div className="flex justify-between items-center text-xs text-white/30 font-mono font-bold mt-1 px-1 select-none">
                      <span>{formatTime(activeSeg.secondsStart)}</span>
                      <span>{formatTime(activeSeg.secondsEnd)}</span>
                    </div>

                  </div>

                </div>

                {/* 2.2 Dialogue Transcript Card */}
                <div className="glass-panel p-5.5 rounded-2xl border-white/5 flex flex-col gap-4 flex-1 h-[360px]">
                  
                  {/* Sub Header & AI Tools row */}
                  <div className="flex justify-between items-center select-none shrink-0">
                    <h3 className="text-sm font-black text-white uppercase tracking-wider flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-sm text-[#AFA7FF]">forum</span>
                      对话记录
                    </h3>
                    
                    <div className="flex items-center gap-2 text-xs font-bold">
                      <button className="px-2.5 py-1 bg-white/5 hover:bg-white/10 border border-white/10 text-[#00D4FF] rounded-lg transition-all flex items-center gap-1 cursor-pointer text-xs">
                        <span className="material-symbols-outlined text-xs">auto_awesome</span>AI 高亮
                      </button>
                      <button className="px-2.5 py-1 bg-white/5 hover:bg-white/10 border border-white/10 text-white/80 rounded-lg transition-all flex items-center gap-1 cursor-pointer text-xs">
                        <span className="material-symbols-outlined text-xs">article</span>显示建议
                      </button>
                      
                      <div className="flex items-center bg-white/5 border border-white/10 rounded-lg px-2.5 py-1 w-36 md:w-48">
                        <input
                          type="text"
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          placeholder="搜索对话内容..."
                          className="bg-transparent text-xs text-white placeholder-white/30 focus:outline-none w-full"
                        />
                        {searchQuery && (
                          <span
                            onClick={() => setSearchQuery("")}
                            className="material-symbols-outlined text-xs text-white/40 hover:text-white cursor-pointer ml-1"
                          >
                            close
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Transcript bubbles list (Clean single layout) */}
                  <div className="flex-1 overflow-y-auto space-y-4 pr-1">
                    {activeSeg.dialogue
                      .filter(bubble => bubble.text.toLowerCase().includes(searchQuery.toLowerCase()))
                      .map((bubble, idx) => {
                        const isInterviewer = bubble.sender === "interviewer";
                        const isPlayed = playbackTime >= bubble.seconds;

                        return (
                          <div 
                            key={idx}
                            onClick={() => jumpPlayhead(bubble.seconds)}
                            className={`p-3.5 rounded-xl border transition-all duration-300 text-left cursor-pointer flex flex-col gap-1.5 ${
                              isInterviewer 
                                ? "bg-[#050B1A]/40 border-white/5 hover:border-white/10" 
                                : "bg-gradient-to-r from-[#050B1A]/80 to-[#AFA7FF]/3 border-[#AFA7FF]/10 hover:border-[#AFA7FF]/20"
                            } ${isPlayed && !isInterviewer ? "border-[#00D4FF]/25 shadow-[0_0_12px_rgba(0,212,255,0.04)]" : ""}`}
                          >
                            <div className="flex justify-between items-center text-xs font-bold select-none">
                              <span className="text-white/60 flex items-center gap-1.5 text-xs">
                                <span className={`w-2.5 h-2.5 rounded-full ${isInterviewer ? "bg-[#FF7A95]" : "bg-[#00D4FF]"}`} />
                                {bubble.name} <span className="font-mono text-[10px] text-white/30">{bubble.time}</span>
                              </span>
                              {bubble.badgeText && (
                                <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase border ${bubble.badgeClass}`}>
                                  {bubble.badgeText}
                                </span>
                              )}
                            </div>
                            <p className={`text-[13px] md:text-sm leading-relaxed ${isPlayed ? "text-white font-black" : "text-white/50"}`}>
                              {bubble.text}
                            </p>
                          </div>
                        );
                      })}
                  </div>

                  <div className="pt-2 text-center select-none shrink-0 border-t border-white/5">
                    <span 
                      onClick={() => {
                        setShowOptimizer(true);
                        startOptimizationGen();
                      }}
                      className="text-sm font-black text-[#AFA7FF] hover:text-white transition-colors cursor-pointer flex items-center justify-center gap-1"
                    >
                      查看片段分析与建议 
                      <span className="material-symbols-outlined text-xs">keyboard_arrow_right</span>
                    </span>
                  </div>

                </div>

              </div>

              {/* ----------------------------------------------------
                  COLUMN 3: Right Sidebar (3.5 cols)
                 ---------------------------------------------------- */}
              <div className="col-span-12 lg:col-span-3.5 xl:col-span-3 flex flex-col gap-4.5">
                
                {/* 3.1 IPI Performance Index widget with line chart */}
                <div className="glass-panel p-4.5 rounded-2xl border-white/5 flex flex-col gap-3.5">
                  <div className="flex justify-between items-center pb-2 border-b border-white/5 select-none">
                    <h4 className="text-sm font-black text-white uppercase tracking-wider flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-sm text-[#00D4FF]">monitoring</span>
                      面试表现指数 (IPI)
                    </h4>
                    <span className="material-symbols-outlined text-sm text-white/40 hover:text-white cursor-pointer">share</span>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="flex items-baseline leading-none">
                      <span className="text-4xl font-black font-mono text-white tracking-tighter">{activeSeg.score}</span>
                      <span className="text-sm text-white/30 font-bold ml-0.5">/100</span>
                    </div>
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-black uppercase text-[#5DECCB] bg-[#5DECCB]/10 border border-[#5DECCB]/25">
                      {activeSeg.badgeText}
                    </span>
                  </div>

                  {/* Custom elegant line chart (Energy Curve Graph) */}
                  <div className="relative py-1 select-none">
                    <svg className="w-full h-[80px] overflow-visible" viewBox="0 0 240 70">
                      <defs>
                        <linearGradient id="line-neon-grad" x1="0" y1="0" x2="1" y2="0">
                          <stop offset="0%" stopColor="#AFA7FF" />
                          <stop offset="50%" stopColor="#00D4FF" />
                          <stop offset="100%" stopColor="#5DECCB" />
                        </linearGradient>
                        <linearGradient id="line-area-grad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#00D4FF" stopOpacity="0.08" />
                          <stop offset="100%" stopColor="transparent" stopOpacity="0" />
                        </linearGradient>
                      </defs>

                      {/* Y horizontal guides */}
                      <line x1="0" y1="15" x2="240" y2="15" stroke="white" strokeWidth="0.5" strokeOpacity="0.02" strokeDasharray="1 2" />
                      <line x1="0" y1="35" x2="240" y2="35" stroke="white" strokeWidth="0.5" strokeOpacity="0.02" strokeDasharray="1 2" />
                      <line x1="0" y1="55" x2="240" y2="55" stroke="white" strokeWidth="0.5" strokeOpacity="0.02" strokeDasharray="1 2" />

                      <text x="238" y="18" fill="white" fillOpacity="0.2" fontSize="6.5" textAnchor="end" fontFamily="monospace">100</text>
                      <text x="238" y="38" fill="white" fillOpacity="0.2" fontSize="6.5" textAnchor="end" fontFamily="monospace">50</text>
                      <text x="238" y="58" fill="white" fillOpacity="0.2" fontSize="6.5" textAnchor="end" fontFamily="monospace">0</text>

                      {/* Area mapping */}
                      <path 
                        d="M 0 35 L 34 25 L 68 20 L 102 32 L 136 45 L 170 55 L 204 42 L 240 48 V 70 H 0 Z" 
                        fill="url(#line-area-grad)" 
                      />

                      {/* Neon Curve */}
                      <path 
                        d="M 0 35 L 34 25 L 68 20 L 102 32 L 136 45 L 170 55 L 204 42 L 240 48" 
                        fill="none" 
                        stroke="url(#line-neon-grad)" 
                        strokeWidth="2" 
                        strokeLinecap="round" 
                      />

                      {/* Vertical line indicator at 08:15 */}
                      <line x1="120" y1="5" x2="120" y2="65" stroke="#FF7A95" strokeWidth="0.75" strokeDasharray="2 2" />
                      <circle cx="120" cy="40" r="3" fill="white" stroke="#FF7A95" strokeWidth="1.5" />
                    </svg>

                    {/* Dotted playhead marker readout label */}
                    <div className="absolute top-[28px] left-[40%] bg-[#FF7A95]/15 border border-[#FF7A95]/30 px-1 py-0.2 rounded font-mono text-xs text-[#FF7A95] font-black">
                      08:15
                    </div>
                  </div>

                  <p className="text-xs text-white/50 leading-relaxed font-semibold">
                    整体趋势：表现波动较大。在 6 分钟后出现明显下滑
                  </p>

                  <div className="pt-1.5 border-t border-white/5 select-none text-center">
                    <span 
                      onClick={() => {
                        setShowOptimizer(true);
                        startOptimizationGen();
                      }}
                      className="text-sm font-black text-[#AFA7FF] hover:text-white transition-colors cursor-pointer flex items-center justify-center gap-1"
                    >
                      查看全场表现趋势 <span className="material-symbols-outlined text-xs">keyboard_arrow_right</span>
                    </span>
                  </div>
                </div>

                {/* 3.2 Risk Moments list */}
                <div className="glass-panel p-4.5 rounded-2xl border-white/5 flex flex-col gap-3.5">
                  <div className="flex justify-between items-center pb-2 border-b border-white/5 select-none">
                    <h4 className="text-sm font-black text-white uppercase tracking-wider flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-sm text-[#FF7A95]">report</span>
                      关键风险点
                    </h4>
                    <span className="text-xs text-[#FF7A95] font-mono font-black">3 个风险点</span>
                  </div>

                  <div className="space-y-2.5">
                    {GENERAL_RISKS.map((risk, idx) => (
                      <div 
                        key={idx}
                        onClick={() => jumpPlayhead(risk.sec)}
                        className="p-2.5 rounded-xl bg-[#050B1A]/80 border border-white/5 hover:border-white/10 transition-all text-left flex justify-between items-center gap-2 cursor-pointer"
                      >
                        <div className="flex items-center gap-2 truncate">
                          <span className="px-2 py-0.5 rounded bg-white/5 text-[#00D4FF] font-mono font-bold text-xs select-none shrink-0">
                            {risk.time}
                          </span>
                          <span className="text-xs md:text-sm text-white font-semibold truncate">{risk.label}</span>
                        </div>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase shrink-0 ${risk.tagClass}`}>
                          {risk.tag}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="pt-1.5 border-t border-white/5 select-none text-center">
                    <span 
                      onClick={() => {
                        setShowOptimizer(true);
                        startOptimizationGen();
                      }}
                      className="text-sm font-black text-[#AFA7FF] hover:text-white transition-colors cursor-pointer flex items-center justify-center gap-1"
                    >
                      查看全部风险点 <span className="material-symbols-outlined text-xs">keyboard_arrow_right</span>
                    </span>
                  </div>
                </div>

                {/* 3.3 Skill Constellation Pentagon Radar Chart */}
                <div className="glass-panel p-4.5 rounded-2xl border-white/5 flex flex-col gap-3">
                  <div className="pb-2 border-b border-white/5 select-none">
                    <h4 className="text-sm font-black text-white uppercase tracking-wider flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-sm text-[#00D4FF]">radar</span>
                      片段能力分析
                    </h4>
                  </div>

                  {/* Pentagon Radar visualization */}
                  <div className="flex justify-center items-center py-1 select-none">
                    <svg className="w-[220px] h-[220px] overflow-visible" viewBox="0 0 220 220">
                      <defs>
                        <filter id="mesh-glow" x="-20%" y="-20%" width="140%" height="140%">
                          <feGaussianBlur stdDeviation="3" result="blur" />
                          <feMerge>
                            <feMergeNode in="blur" />
                            <feMergeNode in="SourceGraphic" />
                          </feMerge>
                        </filter>
                      </defs>

                      {/* Inner grid lines & Concentric pentagons */}
                      {[18, 36, 54, 72].map((radius, rIdx) => {
                        const pts = [
                          { x: 110, y: 110 - radius }, // Top
                          { x: 110 + radius * Math.cos((-18 * Math.PI) / 180), y: 110 + radius * Math.sin((-18 * Math.PI) / 180) }, // Right Top
                          { x: 110 + radius * Math.cos((54 * Math.PI) / 180), y: 110 + radius * Math.sin((54 * Math.PI) / 180) }, // Right Bottom
                          { x: 110 + radius * Math.cos((126 * Math.PI) / 180), y: 110 + radius * Math.sin((126 * Math.PI) / 180) }, // Left Bottom
                          { x: 110 + radius * Math.cos((198 * Math.PI) / 180), y: 110 + radius * Math.sin((198 * Math.PI) / 180) }  // Left Top
                        ];
                        const pathD = `M ${pts[0].x} ${pts[0].y} L ${pts[1].x} ${pts[1].y} L ${pts[2].x} ${pts[2].y} L ${pts[3].x} ${pts[3].y} L ${pts[4].x} ${pts[4].y} Z`;

                        return (
                          <path 
                            key={rIdx} 
                            d={pathD} 
                            fill="none" 
                            stroke="white" 
                            strokeWidth="0.5" 
                            strokeOpacity={rIdx === 3 ? "0.08" : "0.03"} 
                          />
                        );
                      })}

                      {/* Connecting vertical Axes */}
                      {[0, 72, 144, 216, 288].map((angle, aIdx) => {
                        const targetX = 110 + 72 * Math.cos(((angle - 90) * Math.PI) / 180);
                        const targetY = 110 + 72 * Math.sin(((angle - 90) * Math.PI) / 180);
                        return (
                          <line 
                            key={aIdx} 
                            x1="110" y1="110" x2={targetX} y2={targetY} 
                            stroke="white" strokeWidth="0.5" strokeOpacity="0.04" 
                          />
                        );
                      })}

                      {/* Shaded neon data polygon */}
                      {(() => {
                        const scores = activeSeg.radarScores;
                        const rDepth = (scores.depth / 100) * 72;
                        const rSystem = (scores.system / 100) * 72;
                        const rExpression = (scores.expression / 100) * 72;
                        const rSolving = (scores.solving / 100) * 72;
                        const rImplementation = (scores.implementation / 100) * 72;

                        const pt0 = { x: 110, y: 110 - rDepth };
                        const pt1 = { x: 110 + rSystem * Math.cos((-18 * Math.PI) / 180), y: 110 + rSystem * Math.sin((-18 * Math.PI) / 180) };
                        const pt2 = { x: 110 + rExpression * Math.cos((54 * Math.PI) / 180), y: 110 + rExpression * Math.sin((54 * Math.PI) / 180) };
                        const pt3 = { x: 110 + rSolving * Math.cos((126 * Math.PI) / 180), y: 110 + rSolving * Math.sin((126 * Math.PI) / 180) };
                        const pt4 = { x: 110 + rImplementation * Math.cos((198 * Math.PI) / 180), y: 110 + rImplementation * Math.sin((198 * Math.PI) / 180) };

                        const dString = `M ${pt0.x} ${pt0.y} L ${pt1.x} ${pt1.y} L ${pt2.x} ${pt2.y} L ${pt3.x} ${pt3.y} L ${pt4.x} ${pt4.y} Z`;

                        return (
                          <g>
                            <path 
                              d={dString} 
                              fill="#8B5CF6" fillOpacity="0.12" 
                              stroke="#AFA7FF" strokeWidth="1.75" 
                              filter="url(#mesh-glow)" 
                            />
                            {/* Vertices dot hooks */}
                            {[pt0, pt1, pt2, pt3, pt4].map((pt, pIdx) => (
                              <g key={pIdx}>
                                <circle cx={pt.x} cy={pt.y} r="2.5" fill="white" />
                                <circle cx={pt.x} cy={pt.y} r="5.5" fill="none" stroke="#AFA7FF" strokeWidth="0.5" strokeOpacity="0.5" className="animate-pulse" />
                              </g>
                            ))}
                          </g>
                        );
                      })()}

                      {/* External Labels with scores */}
                      <text x="110" y="20" fill="white" fillOpacity="0.5" fontSize="15" fontWeight="bold" textAnchor="middle">
                        技术深度 <tspan fill="#AFA7FF">{activeSeg.radarScores.depth}</tspan>
                      </text>
                      <text x="195" y="92" fill="white" fillOpacity="0.5" fontSize="15" fontWeight="bold" textAnchor="start">
                        系统思维 <tspan fill="#AFA7FF">{activeSeg.radarScores.system}</tspan>
                      </text>
                      <text x="172" y="185" fill="white" fillOpacity="0.5" fontSize="15" fontWeight="bold" textAnchor="start">
                        表达清晰度 <tspan fill="#AFA7FF">{activeSeg.radarScores.expression}</tspan>
                      </text>
                      <text x="48" y="185" fill="white" fillOpacity="0.5" fontSize="15" fontWeight="bold" textAnchor="end">
                        问题解决 <tspan fill="#AFA7FF">{activeSeg.radarScores.solving}</tspan>
                      </text>
                      <text x="25" y="92" fill="white" fillOpacity="0.5" fontSize="15" fontWeight="bold" textAnchor="end">
                        方案落地 <tspan fill="#AFA7FF">{activeSeg.radarScores.implementation}</tspan>
                      </text>

                    </svg>
                  </div>

                </div>

              </div>

            </div>

            {/* ========================================================
                BOTTOM ROW: AI Diagnostic summary card (Full Width)
               ======================================================== */}
            <div className="glass-panel p-5.5 rounded-2xl border-white/5 grid grid-cols-12 gap-5.5 w-full select-none mt-1">
              
              {/* Section 1: AI分析总结 (4 cols) */}
              <div className="col-span-12 lg:col-span-4 flex gap-3.5 border-r border-white/5 pr-4">
                <div className="w-9 h-9 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center shrink-0 text-[#AFA7FF] mt-0.5">
                  <span className="material-symbols-outlined text-lg">auto_awesome</span>
                </div>
                <div className="space-y-1">
                  <h4 className="text-sm font-black text-white uppercase tracking-wider">AI 分析总结</h4>
                  <p className="text-xs md:text-sm text-white/50 leading-relaxed font-semibold">
                    {activeSeg.summary}
                  </p>
                </div>
              </div>

              {/* Section 2: 优点 (2 cols) */}
              <div className="col-span-12 sm:col-span-6 lg:col-span-2 border-r border-white/5 px-2">
                <h4 className="text-sm font-black text-[#5DECCB] uppercase tracking-wider mb-2 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#5DECCB]" />
                  优点
                </h4>
                <div className="space-y-2 text-xs md:text-sm font-extrabold text-white/80 leading-relaxed">
                  {activeSeg.advantages.map((adv, idx) => (
                    <div key={idx} className="flex items-start gap-1">
                      <span className="text-[#5DECCB] font-black">✓</span>
                      <span>{adv}</span>
                    </div>
                  ))}
                  {activeSeg.advantages.length === 0 && (
                    <span className="text-white/30 italic">无</span>
                  )}
                </div>
              </div>

              {/* Section 3: 待提升 (2 cols) */}
              <div className="col-span-12 sm:col-span-6 lg:col-span-2 border-r border-white/5 px-2">
                <h4 className="text-sm font-black text-[#FF7A95] uppercase tracking-wider mb-2 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#FF7A95]" />
                  待提升
                </h4>
                <div className="space-y-2 text-xs md:text-sm font-extrabold text-white/80 leading-relaxed">
                  {activeSeg.shortcomings.map((short, idx) => (
                    <div key={idx} className="flex items-start gap-1">
                      <span className="text-[#FF7A95] font-black">!</span>
                      <span>{short}</span>
                    </div>
                  ))}
                  {activeSeg.shortcomings.length === 0 && (
                    <span className="text-white/30 italic">无</span>
                  )}
                </div>
              </div>

              {/* Section 4: 建议重点复习 (2 cols) */}
              <div className="col-span-12 sm:col-span-6 lg:col-span-2 border-r border-white/5 px-2">
                <h4 className="text-sm font-black text-white uppercase tracking-wider mb-2 flex items-center gap-1">
                  <span className="material-symbols-outlined text-sm text-[#AFA7FF]">auto_stories</span>
                  建议重点复习
                </h4>
                <div className="space-y-2 text-xs md:text-sm font-extrabold text-white/70 leading-relaxed">
                  {activeSeg.reviewPoints.map((pt, idx) => (
                    <div key={idx} className="flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-sm text-white/40">description</span>
                      <span>{pt}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Section 5: 下一步建议 (2 cols) */}
              <div className="col-span-12 sm:col-span-6 lg:col-span-2 pl-2 flex flex-col justify-between gap-2.5">
                <div>
                  <h4 className="text-sm font-black text-white uppercase tracking-wider">下一步建议</h4>
                  <p className="text-xs text-white/40 leading-snug font-bold mt-1">
                    生成本片段的表达优化建议，提升回答质量
                  </p>
                </div>
                <button 
                  onClick={() => {
                    setShowOptimizer(true);
                    startOptimizationGen();
                  }}
                  className="w-full py-2 bg-[#8B5CF6] hover:bg-[#7C3AED] text-white text-xs md:text-sm font-black rounded-lg transition-all cursor-pointer shadow-lg shadow-purple-500/10"
                >
                  生成优化建议
                </button>
              </div>

            </div>

          </motion.div>

      {/* ========================================================
          GENERATIVE OPTIMIZER POPUP MODAL DRAWER
         ======================================================== */}
      <AnimatePresence>
        {showOptimizer && (
          <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowOptimizer(false)}
              className="absolute inset-0 bg-[#050B1A]/80 backdrop-blur-md"
            />

            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-[#050B1A] border border-white/10 rounded-3xl p-6.5 max-w-xl w-full text-left relative z-10 space-y-4 shadow-2xl overflow-hidden"
            >
              <div className="flex justify-between items-center pb-2.5 border-b border-white/5 select-none">
                <h3 className="font-extrabold text-white text-base flex items-center gap-2">
                  <span className="material-symbols-outlined text-[#00D4FF] animate-pulse">auto_awesome</span>
                  OfferPilot AI 表达重塑对策建议
                </h3>
                <button
                  onClick={() => setShowOptimizer(false)}
                  className="text-white/40 hover:text-white transition-colors cursor-pointer flex items-center justify-center w-7 h-7 rounded-lg hover:bg-white/5"
                >
                  <span className="material-symbols-outlined text-base">close</span>
                </button>
              </div>

              {optPhase === "loading" ? (
                <div className="py-12 flex flex-col items-center justify-center gap-4 text-center select-none">
                  <div className="w-16 h-16 rounded-full border-4 border-dashed border-[#00D4FF] flex items-center justify-center relative animate-[spin_6s_linear_infinite]" />
                  <div className="space-y-1 mt-2">
                    <p className="text-sm font-black text-white animate-pulse">正在利用大模型重塑最优答题话术...</p>
                    <p className="text-xs text-white/40 font-bold font-mono">ALIGNING_WITH_SENIOR_ARCHITECT_EXPECTATIONS</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="p-3.5 rounded-2xl bg-[#FF7A95]/10 border border-[#FF7A95]/20 text-xs text-[#FF7A95] leading-relaxed font-bold">
                    <span className="text-[10px] font-black uppercase tracking-wider block mb-1.5 select-none">AI 诊断结论</span>
                    你在答题中提到了经典的“延时双删”，但这极易被资深面试官攻击“网络分区导致的延时数值选取难题”与“秒杀并发脏写异常”。
                  </div>

                  <div className="space-y-3.5 text-xs text-white/70 leading-relaxed font-bold max-h-[280px] overflow-y-auto pr-1">
                    <div className="space-y-1">
                      <span className="text-white font-black text-sm block">💡 你的原版回答：</span>
                      <p className="bg-white/[0.01] border border-white/5 p-3 rounded-xl text-white/50">“可以用双删策略，先删缓存，再更新数据库，最后再删一次缓存。”</p>
                    </div>

                    <div className="space-y-1 mt-4">
                      <span className="text-[#5DECCB] font-black text-sm block flex items-center gap-1.5 select-none">
                        <span className="material-symbols-outlined text-base">verified</span>
                        🎯 大厂架构师版高分话术推荐：
                      </span>
                      <div className="bg-slate-950/60 border border-[#5DECCB]/20 p-3.5 rounded-xl font-mono text-white whitespace-pre-wrap leading-relaxed text-xs">
                        “在处理缓存双写一致性时，由于网络延迟的不可控性，经典的延时双删并非万无一失。
                        <br /><br />
                        我更倾向于采用 <strong className="text-[#5DECCB] font-black">订阅 MySQL binlog + 消息队列（MQ）做异步淘汰的方案</strong>。具体流程是：应用端只负责写数据库，数据变更生成 binlog 后，利用 <strong className="text-[#5DECCB] font-black">Canal 订阅工具</strong> 异步推送到 Kafka。下游淘汰模块监听 Kafka 并异步清理 Redis 缓存。如果淘汰失败，则利用 MQ 自身的重试机制重试，确保达到最终一致性。
                        <br /><br />
                        对于极少数需要保证强一致的账务节点，我会在底层引入 <strong className="text-[#5DECCB] font-black">Redisson 读写锁机制</strong>，将写请求排他化，确保缓存与数据库的强一致。”
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-end gap-3 pt-2">
                    <button
                      onClick={() => setShowOptimizer(false)}
                      className="px-5 py-2.5 bg-[#5DECCB] text-[#050B1A] text-xs font-black rounded-xl transition-all cursor-pointer shadow-lg shadow-cyan-500/20"
                    >
                      确定并应用优化建议
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
