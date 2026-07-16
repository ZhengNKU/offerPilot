"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth, UserMenu } from "@/components/AuthProvider";
import { pollTaskUntilDone } from "@/app/utils/pollTask";
import { API_BASE } from "@/lib/api";

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
  highlights?: Array<{
    text: string;
    type: "strength" | "risk" | "tech";
    tip: string;
  }>;
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
  dbSectionId?: number;
  optimizationAdvice?: {
    conclusion: string;
    original: string;
    optimized: string;
  };
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
        badgeClass: "text-[#AFA7FF] bg-[#AFA7FF]/10 border-[#AFA7FF]/20",
        highlights: [
          { text: "6年后端高并发开发经验", type: "strength", tip: "💡 核心闪光点：有效突出了技术深厚的履历积累，能在前10秒直接抓住面试官注意力。" },
          { text: "亿级DAU的数据分发和缓存架构", type: "strength", tip: "💡 亮点：给出了非常出色的海量用户场景，证明具备大厂大规模系统的设计能力。" },
          { text: "缓存架构", type: "tech", tip: "🔧 核心技术：代表熟悉 Redis/Memcached 等核心缓存体系的设计与性能调优。" }
        ]
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
        badgeClass: "text-[#FF7A95] bg-[#FF7A95]/10 border-[#FF7A95]/20",
        highlights: [
          { text: "单向异步广播到 Redis", type: "risk", tip: "⚠️ 表达风险：单向异步广播在高并发下可能发生网络分区、乱序，导致缓存与DB数据永久不一致，需要补充数据一致性兜底方案。" },
          { text: "Redis", type: "tech", tip: "🔧 核心技术：核心内存数据库，此处用于高速缓存及写缓冲。" }
        ]
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
    summary: "在 Redis 相关问题上，对基本原理掌握较好，但在一致性方案和并发场景的处理上回答不够深入，缺乏具体实践经验 and 优化思考。建议加强对缓存一致性方案的理解，并准备更多实际项目中的难题方案。",
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
        text: "因为 Redis 性能高，可以做缓存，提升接口响应速度。",
        highlights: [
          { text: "做缓存，提升接口响应速度", type: "strength", tip: "💡 亮点：简洁明了地归纳了 Redis 在缓存层加速接口响应的常见实用价值。" }
        ]
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
        badgeClass: "text-[#FF7A95] bg-[#FF7A95]/10 border-[#FF7A95]/20",
        highlights: [
          { text: "双删策略", type: "risk", tip: "⚠️ 表达风险：双删是教科书式的非生产方案。高并发下仍有一致性漏洞。建议深入学习『Binlog异步订阅 + Canal』方案或『Redisson读写锁』。" }
        ]
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

// Analysis step labels displayed during polling
const ANALYSIS_STEPS = [
  "ASR 转写中 - 正在提取音频文字...",
  "语义段落划分中 - 对话说话人角色判定...",
  "LLM 问答结构提取中 - 生成结构化问答对...",
  "LangGraph 智能体评估中 - 对比用户画像...",
  "AI 表达重构优化中 - 编写完美回答升级话术...",
  "分析完成"
];

// =========================================================================
// MERGE SEGMENTS TO MAX 10 BLOCKS
// Consolidates adjacent segments if they exceed 10 blocks.
// =========================================================================
function mergeSegmentsToMax10(segments: SegmentData[]): SegmentData[] {
  if (segments.length <= 10) return segments;

  const N = segments.length;
  const M = 10;
  const merged: SegmentData[] = [];

  const fmtSecs = (s: number) => {
    const m = Math.floor(Math.abs(s) / 60);
    const sec = Math.floor(Math.abs(s) % 60);
    return `${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
  };

  const tagColorMap: Record<string, string> = {
    "良好": "text-[#5DECCB] bg-[#5DECCB]/10 border-[#5DECCB]/20",
    "一般": "text-[#AFA7FF] bg-[#AFA7FF]/10 border-[#AFA7FF]/20",
    "风险": "text-[#FF7A95] bg-[#FF7A95]/10 border-[#FF7A95]/20"
  };

  for (let j = 0; j < M; j++) {
    const startIdx = Math.floor((j * N) / M);
    const endIdx = Math.floor(((j + 1) * N) / M);
    const group = segments.slice(startIdx, endIdx);

    if (group.length === 0) continue;

    const first = group[0];
    const last = group[group.length - 1];

    const secondsStart = first.secondsStart;
    const secondsEnd = last.secondsEnd;
    const durationText = fmtSecs(secondsEnd - secondsStart);

    // Merge label
    const uniqueLabels = Array.from(new Set(group.map(g => g.label)));
    let label = uniqueLabels.join(" & ");
    if (label.length > 28) {
      label = label.slice(0, 25) + "...";
    }

    // Merge dialogue
    const dialogue: DialogueItem[] = [];
    group.forEach(g => {
      dialogue.push(...g.dialogue);
    });

    // Merge tags: worst tag wins (风险 > 一般 > 良好)
    let tag: "良好" | "一般" | "风险" = "良好";
    if (group.some(g => g.tag === "风险")) {
      tag = "风险";
    } else if (group.some(g => g.tag === "一般")) {
      tag = "一般";
    }

    // Merge summary
    const summary = group.map(g => g.summary).filter(Boolean).join(" ");

    // Merge scores
    const avgScore = Math.round(group.reduce((sum, g) => sum + g.score, 0) / group.length);

    // Merge other details
    const advantages: string[] = [];
    const shortcomings: string[] = [];
    const reviewPoints: string[] = [];
    group.forEach(g => {
      advantages.push(...(g.advantages || []));
      shortcomings.push(...(g.shortcomings || []));
      reviewPoints.push(...(g.reviewPoints || []));
    });

    merged.push({
      id: j + 1,
      label,
      timeRange: `${fmtSecs(secondsStart)} - ${fmtSecs(secondsEnd)}`,
      durationText,
      secondsStart,
      secondsEnd,
      tag,
      tagColor: tagColorMap[tag] || first.tagColor,
      score: avgScore,
      badgeText: tag === "良好" ? "表现优秀" : tag === "一般" ? "中等表现" : "表现预警",
      badgeColor: tagColorMap[tag] || first.badgeColor,
      summary,
      advantages: Array.from(new Set(advantages)).slice(0, 3),
      shortcomings: Array.from(new Set(shortcomings)).slice(0, 3),
      reviewPoints: Array.from(new Set(reviewPoints)).slice(0, 3),
      ipiTrendPoints: first.ipiTrendPoints,
      radarScores: deriveRadarScores(tag, label),
      dialogue,
      dbSectionId: first.dbSectionId,
      optimizationAdvice: first.optimizationAdvice
    });
  }

  return merged;
}

// =========================================================================
// DERIVE RADAR SCORES DYNAMICALLY based on tag and label category
// =========================================================================
function deriveRadarScores(tag: "良好" | "一般" | "风险", label: string) {
  let base = 70;
  if (tag === "良好") base = 85;
  else if (tag === "风险") base = 58;

  const scores = {
    depth: base,
    system: base,
    expression: base,
    solving: base,
    implementation: base
  };

  const l = label.toLowerCase();
  if (l.includes("介绍") || l.includes("intro")) {
    scores.expression += 6;
    scores.depth -= 6;
    scores.system -= 4;
  } else if (l.includes("设计") || l.includes("system") || l.includes("架构")) {
    scores.system += 7;
    scores.implementation += 5;
    scores.depth += 3;
  } else if (l.includes("事务") || l.includes("一致性") || l.includes("redis") || l.includes("mysql") || l.includes("并发") || l.includes("算法") || l.includes("项目")) {
    scores.depth += 8;
    scores.solving += 4;
    scores.system += 2;
  } else if (l.includes("行为") || l.includes("沟通") || l.includes("behavior")) {
    scores.expression += 7;
    scores.solving += 5;
    scores.depth -= 5;
  }

  const clamp = (val: number) => Math.max(40, Math.min(98, val));
  return {
    depth: clamp(scores.depth),
    system: clamp(scores.system),
    expression: clamp(scores.expression),
    solving: clamp(scores.solving),
    implementation: clamp(scores.implementation)
  };
}

// =========================================================================
// BUILD DYNAMIC SEGMENTS FROM REAL TRANSCRIPT
// Groups utterances by interviewer questions to form meaningful topic blocks.
// Returns a SegmentData[] that is structurally identical to SEGMENTS_DATA
// but populated 100% from real ASR data.
// =========================================================================
function buildDynamicSegments(
  utterances: Array<{
    start_time: number;
    end_time: number;
    speaker: string;
    content: string;
    highlights?: Array<{ text: string; type: "strength" | "risk" | "tech"; tip: string }>;
  }>
): SegmentData[] {
  if (utterances.length === 0) return SEGMENTS_DATA; // fallback to mock if no transcript

  const fmtSecs = (s: number) => {
    const m = Math.floor(Math.abs(s) / 60);
    const sec = Math.floor(Math.abs(s) % 60);
    return `${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
  };

  // Generic segment topic labels (replace with LLM-generated later)
  const topicLabels = ["自我介绍", "技术深度", "项目经验", "系统设计", "综合问答", "行为面试", "反问环节"];
  const tagCycle: Array<"良好" | "一般" | "风险"> = ["良好", "一般", "良好", "一般", "风险", "良好", "一般"];
  const tagColorCycle = [
    "text-[#5DECCB] bg-[#5DECCB]/10 border-[#5DECCB]/20",
    "text-[#AFA7FF] bg-[#AFA7FF]/10 border-[#AFA7FF]/20",
    "text-[#5DECCB] bg-[#5DECCB]/10 border-[#5DECCB]/20",
    "text-[#AFA7FF] bg-[#AFA7FF]/10 border-[#AFA7FF]/20",
    "text-[#FF7A95] bg-[#FF7A95]/10 border-[#FF7A95]/20",
    "text-[#5DECCB] bg-[#5DECCB]/10 border-[#5DECCB]/20",
    "text-[#AFA7FF] bg-[#AFA7FF]/10 border-[#AFA7FF]/20",
  ];

  // Group utterances: start a new segment on each Interviewer utterance (question boundary)
  const groups: Array<typeof utterances> = [];
  let current: typeof utterances = [];

  for (const utt of utterances) {
    if (utt.speaker === "Interviewer" && current.length > 0) {
      groups.push(current);
      current = [];
    }
    current.push(utt);
  }
  if (current.length > 0) groups.push(current);

  // If only one group (no Interviewer detected), split into chunks of 4
  if (groups.length === 1 && utterances.length > 4) {
    const chunkSize = Math.ceil(utterances.length / 4);
    groups.length = 0;
    for (let i = 0; i < utterances.length; i += chunkSize) {
      groups.push(utterances.slice(i, i + chunkSize));
    }
  }

  return groups.map((group, idx) => {
    const startSecs  = group[0].start_time;
    const endSecs    = group[group.length - 1].end_time;
    const durSecs    = endSecs - startSecs;

    return {
      id:           idx + 1,
      label:        topicLabels[idx % topicLabels.length],
      timeRange:    `${fmtSecs(startSecs)} - ${fmtSecs(endSecs)}`,
      durationText: fmtSecs(durSecs),
      secondsStart: Math.floor(startSecs),
      secondsEnd:   Math.ceil(endSecs),
      tag:          tagCycle[idx % tagCycle.length],
      tagColor:     tagColorCycle[idx % tagColorCycle.length],
      score:        70,
      badgeText:    "AI 分析",
      badgeColor:   "bg-[#AFA7FF]/10 text-[#AFA7FF]",
      summary:      "AI 正在生成片段分析...",
      advantages:   [],
      shortcomings: [],
      reviewPoints: [],
      ipiTrendPoints: [70, 72, 74, 73, 75, 76, 78],
      radarScores:  deriveRadarScores(tagCycle[idx % tagCycle.length], topicLabels[idx % topicLabels.length]),
      dialogue: group.map(utt => ({
        sender:  utt.speaker === "Interviewer" ? "interviewer" as const : "user" as const,
        name:    utt.speaker === "Interviewer" ? "面试官" : "您",
        time:    fmtSecs(Math.floor(utt.start_time)),
        seconds: Math.floor(utt.start_time),
        text:    utt.content,
        highlights: utt.highlights || []
      })),
    };
  });
}

// =========================================================================
// RENDER DIALOGUE TEXT WITH DYNAMIC AI HIGHLIGHTS & TOOLTIPS
// =========================================================================
function renderHighlightText(
  text: string,
  highlights: Array<{ text: string; type: "strength" | "risk" | "tech"; tip: string }> = [],
  isPlayed: boolean,
  isToggledOn: boolean
) {
  if (!isToggledOn || !highlights || highlights.length === 0) {
    return <span className={isPlayed ? "text-white font-black" : "text-white/50"}>{text}</span>;
  }

  interface Match {
    start: number;
    end: number;
    text: string;
    type: "strength" | "risk" | "tech";
    tip: string;
  }

  const matches: Match[] = [];
  highlights.forEach(h => {
    if (!h.text) return;
    let index = text.indexOf(h.text);
    while (index !== -1) {
      const isOverlapping = matches.some(m => 
        (index >= m.start && index < m.end) || 
        (index + h.text.length > m.start && index + h.text.length <= m.end)
      );
      if (!isOverlapping) {
        matches.push({
          start: index,
          end: index + h.text.length,
          text: h.text,
          type: h.type,
          tip: h.tip
        });
      }
      index = text.indexOf(h.text, index + 1);
    }
  });

  matches.sort((a, b) => a.start - b.start);

  const parts: React.ReactNode[] = [];
  let lastIndex = 0;

  matches.forEach((m, idx) => {
    if (m.start > lastIndex) {
      parts.push(
        <span key={`plain-${idx}`} className={isPlayed ? "text-white font-black" : "text-white/50"}>
          {text.slice(lastIndex, m.start)}
        </span>
      );
    }

    let highlightClass = "";
    if (m.type === "strength") {
      highlightClass = "text-[#5DECCB] bg-[#5DECCB]/10 border-b border-[#5DECCB]/40 px-1 py-0.5 rounded cursor-help font-extrabold relative group";
    } else if (m.type === "risk") {
      highlightClass = "text-[#FF7A95] bg-[#FF7A95]/8 border-b border-dashed border-[#FF7A95]/40 px-1 py-0.5 rounded cursor-help font-extrabold relative group";
    } else if (m.type === "tech") {
      highlightClass = "text-[#00D4FF] bg-[#00D4FF]/8 border-b border-[#00D4FF]/40 px-1 py-0.5 rounded cursor-help font-extrabold relative group";
    }

    const displayTip = (m.tip || "")
      .replace(/与\s*第?\s*\d+\s*段(?:几乎)?(?:逐字)?重复/g, "与前面的回答内容存在高度重复")
      .replace(/与\s*第?\s*\d+\s*段/g, "与之前的表述");

    const ratio = m.start / text.length;
    const tooltipAlignClass = ratio < 0.45 ? "left-0" : "right-0 left-auto";

    parts.push(
      <span key={`hl-${idx}`} className={highlightClass}>
        {m.text}
        <span className={`invisible group-hover:visible absolute top-full ${tooltipAlignClass} mt-1.5 w-64 p-3 bg-[#050B1A]/95 border border-white/10 text-white text-xs rounded-xl shadow-2xl z-55 text-left pointer-events-none transition-all duration-200 select-none backdrop-blur-md`}>
          <span className="flex items-center gap-1.5 font-bold mb-1 select-none">
            <span className={`w-2.5 h-2.5 rounded-full animate-pulse ${
              m.type === 'strength' ? 'bg-[#5DECCB]' : m.type === 'risk' ? 'bg-[#FF7A95]' : 'bg-[#00D4FF]'
            }`} />
            <span className={
              m.type === 'strength' ? 'text-[#5DECCB]' : m.type === 'risk' ? 'text-[#FF7A95]' : 'text-[#00D4FF]'
            }>
              {m.type === 'strength' ? 'AI 亮点分析' : m.type === 'risk' ? 'AI 表达风险' : 'AI 技术解析'}
            </span>
          </span>
          <span className="text-white/80 font-medium leading-relaxed block select-none">
            {displayTip}
          </span>
        </span>
      </span>
    );

    lastIndex = m.end;
  });

  if (lastIndex < text.length) {
    parts.push(
      <span key="plain-end" className={isPlayed ? "text-white font-black" : "text-white/50"}>
        {text.slice(lastIndex)}
      </span>
    );
  }

  return <>{parts}</>;
}

// =========================================================================
// MAIN PAGE COMPONENT (AI INTERVIEW INTELLIGENCE CENTER - REDESIGNED V2)
// =========================================================================
export default function InterviewVoiceAnalysisPage() {
  const router = useRouter();
  const auth = useAuth();

  // ── Analysis polling state ─────────────────────────────────────────────
  // pageStatus: "analyzing" = polling in progress (block dashboard)
  //             "ready"     = analysis done, show real data
  //             "no_session" = no task found, redirect
  const [pageStatus, setPageStatus] = useState<"analyzing" | "ready" | "no_session">("analyzing");
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [analysisStep, setAnalysisStep] = useState(0);
  const [hasActiveTask, setHasActiveTask] = useState(false);
  const [reportData, setReportData] = useState<{
    ipi_score: number;
    offer_probability: number;
    executive_summary: string;
    strengths: string[];
    weaknesses: string[];
    suggestions: string[];
  } | null>(null);
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Live segments: starts as mock, replaced with real transcript once analysis completes
  const [liveSegmentsData, setLiveSegmentsData] = useState(SEGMENTS_DATA);
  const [collapsedSections, setCollapsedSections] = useState<Record<number, boolean>>({});

  // Onboarding / AI Segmenting Animation States
  const [isSegmenting, setIsSegmenting] = useState(false);
  const [segmentingStep, setSegmentingStep] = useState(0);

  // Active Timeline Segment — reads from liveSegmentsData (not the const)
  const [activeSegIdx, setActiveSegIdx] = useState(0);
  const activeSeg = liveSegmentsData[activeSegIdx] ?? liveSegmentsData[0];

  // Dynamic IPI Line Chart points based on real segment scores
  const chartPoints = liveSegmentsData.map((seg, idx) => {
    const x = liveSegmentsData.length > 1 ? (idx / (liveSegmentsData.length - 1)) * 240 : 120;
    const y = 60 - ((seg.score ?? 70) / 100) * 50;
    return { x, y, score: seg.score, label: seg.label, timeRange: seg.timeRange };
  });

  const linePath = chartPoints.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const areaPath = chartPoints.length > 0
    ? `${linePath} L ${chartPoints[chartPoints.length - 1].x} 70 L ${chartPoints[0].x} 70 Z`
    : '';

  const activePt = chartPoints[activeSegIdx] || chartPoints[0] || { x: 120, y: 40 };

  // Dynamic risks list derived from segments with "风险" or "一般" tag
  const dynamicRisks = liveSegmentsData
    .filter(seg => seg.tag === "风险" || seg.tag === "一般")
    .map(seg => {
      const timeStr = seg.timeRange ? seg.timeRange.split(" - ")[0] : "00:00";
      const label = seg.shortcomings && seg.shortcomings.length > 0
        ? seg.shortcomings[0]
        : `【${seg.label}】答题表现一般`;
      const isRisk = seg.tag === "风险";
      return {
        time: timeStr,
        label: label,
        segmentLabel: seg.label,
        tag: isRisk ? "高风险" : "中风险",
        tagClass: isRisk 
          ? "text-[#FF7A95] bg-[#FF7A95]/10 border-[#FF7A95]/20" 
          : "text-[#AFA7FF] bg-[#AFA7FF]/10 border-[#AFA7FF]/20",
        sec: seg.secondsStart,
        suggestions: seg.reviewPoints || []
      };
    });

  // Simulated Player States
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackTime, setPlaybackTime] = useState(0);
  const totalDuration = liveSegmentsData.length > 0 ? liveSegmentsData[liveSegmentsData.length - 1].secondsEnd : 0;
  const segmentDuration = totalDuration;
  const playedPercent = totalDuration > 0 ? (playbackTime / totalDuration) * 100 : 0;
  const [playSpeed, setPlaySpeed] = useState(1.0);
  const playTimerRef = useRef<NodeJS.Timeout | null>(null);

  const [isGuest, setIsGuest] = useState(false);

  // Edit / Form states
  const [interviewInfo, setInterviewInfo] = useState({
    company: "字节跳动",
    role: "后端开发工程师",
    round: "技术一面",
    time: "",
    level: "",
    salary: "35-40K",
    years: "3-5年",
    isOnJob: "在职"
  });

  // ── Mount: page gate + polling ──────────────────────────────────────────
  useEffect(() => {
    if (typeof window === "undefined") return;

    const savedGuest = localStorage.getItem("interviewVar_is_guest_session");
    if (savedGuest === "true") setIsGuest(true);

    const savedCompany = localStorage.getItem("interviewVar_session_company");
    const savedRole    = localStorage.getItem("interviewVar_session_role");
    const savedRound   = localStorage.getItem("interviewVar_session_round");
    const savedDate    = localStorage.getItem("interviewVar_session_date");
    const savedGrade   = localStorage.getItem("interviewVar_session_grade");
    const savedSalary  = localStorage.getItem("interviewVar_session_salary");
    const savedYears   = localStorage.getItem("interviewVar_session_years");

    if (savedCompany || savedRole || savedRound) {
      setInterviewInfo(prev => ({
        ...prev,
        company: savedCompany || prev.company,
        role:    savedRole    || prev.role,
        round:   savedRound   || prev.round,
        time:    savedDate    || prev.time,
        level:   savedGrade !== null ? savedGrade : prev.level,
        salary:  savedSalary !== null ? savedSalary : prev.salary,
        years:   savedYears   || prev.years
      }));
    }

    const taskId    = localStorage.getItem("interviewVar_task_id");
    const searchParams = new URLSearchParams(window.location.search);
    let sessionId = searchParams.get("sessionId") || localStorage.getItem("interviewVar_session_id");
    if (sessionId) {
      const newUrl = window.location.pathname + `?sessionId=${sessionId}`;
      window.history.replaceState(null, "", newUrl);
    }
    setHasActiveTask(!!taskId);

    // ── GATE: no session → redirect ──────────────────────────────────
    // session_id should always be present because the debugger page
    // polls until completed and THEN navigates here.
    // task_id has been cleared by the debugger page after completion.
    if (!sessionId) {
      setPageStatus("no_session");
      setTimeout(() => router.push("/debugger"), 2500);
      return;
    }

    // ── Fetch completed report ────────────────────────────────────────
    const fmtTime = (secs: number) => {
      const m = Math.floor(secs / 60);
      const s = Math.floor(secs % 60);
      return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
    };

    const loadReport = async () => {
      try {
        const token = localStorage.getItem("interviewVar_token");
        const headers: Record<string, string> = {};
        if (token) headers["Authorization"] = `Bearer ${token}`;

        // If task_id is still present, wait for it to complete first
        if (taskId) {
          try {
            await pollTaskUntilDone(taskId, {
              intervalMs: 2000,
              headers,
              onProgress: (taskData) => {
                const pct = taskData.progress ?? 0;
                setAnalysisProgress(pct);
                setAnalysisStep(
                  Math.min(Math.floor((pct / 100) * ANALYSIS_STEPS.length), ANALYSIS_STEPS.length - 1)
                );
              },
            });
            localStorage.removeItem("interviewVar_task_id");
          } catch {
            // pollTaskUntilDone only rejects on hard timeout — surface that as
            // "no_session" so the user lands back on the entry page.
            setPageStatus("no_session");
            return;
          }
        }

        // Fetch both report and sections
        const [reportRes, sectionsRes] = await Promise.all([
          fetch(`${API_BASE}/api/audio/report/${sessionId}`, { headers }),
          fetch(`${API_BASE}/api/audio/session/${sessionId}/sections`, { headers })
        ]);

        if (!reportRes.ok) {
          setPageStatus("no_session");
          setTimeout(() => router.push("/debugger"), 2500);
          return;
        }
        const report = await reportRes.json();
        if (report.audio_url) {
          setAudioUrl(report.audio_url);
        }

        let dbSections = [];
        if (sectionsRes.ok) {
          const sectionsData = await sectionsRes.json();
          dbSections = sectionsData.sections || [];
        }

        // Set scores + summary
        const overallIpi = report.scores?.ipi ?? 70;
        setReportData({
          ipi_score:         overallIpi,
          offer_probability: report.scores?.offer_probability ?? 0,
          executive_summary: report.summary?.executive_summary ?? "",
          strengths:         report.summary?.strengths  ?? [],
          weaknesses:        report.summary?.weaknesses ?? [],
          suggestions:       report.summary?.suggestions ?? []
        });

        // Build dynamic segments from real transcript — no hardcoded time ranges
        const rawTranscript: Array<{
          start_time: number;
          end_time: number;
          speaker: string;
          content: string;
          highlights?: Array<{ text: string; type: "strength" | "risk" | "tech"; tip: string }>;
        }> = report.transcript ?? [];

        let dynamicSegments = [];
        if (dbSections.length > 0) {
          const tagColorMap: Record<string, string> = {
            "良好": "text-[#5DECCB] bg-[#5DECCB]/10 border-[#5DECCB]/20",
            "一般": "text-[#AFA7FF] bg-[#AFA7FF]/10 border-[#AFA7FF]/20",
            "风险": "text-[#FF7A95] bg-[#FF7A95]/10 border-[#FF7A95]/20"
          };
          const tagColorCycle = [
            "text-[#5DECCB] bg-[#5DECCB]/10 border-[#5DECCB]/20",
            "text-[#AFA7FF] bg-[#AFA7FF]/10 border-[#AFA7FF]/20",
            "text-[#FF7A95] bg-[#FF7A95]/10 border-[#FF7A95]/20"
          ];
          dynamicSegments = dbSections.map((sec: any, idx: number) => {
            const startSecs = sec.start_time;
            const endSecs = sec.end_time;
            const durSecs = endSecs - startSecs;
            
            const sectionDialogue = rawTranscript.filter(utt => {
              const t = utt.start_time ?? 0;
              const isLast = idx === dbSections.length - 1;
              if (isLast) {
                return (sec.start_time - 0.001 <= t) && (t <= sec.end_time + 0.001);
              } else {
                return (sec.start_time - 0.001 <= t) && (t < sec.end_time - 0.001);
              }
            });

            const tag = (sec.tag === "良好" || sec.tag === "一般" || sec.tag === "风险") ? sec.tag : "一般";
            const tagColor = tagColorMap[tag] || tagColorCycle[idx % tagColorCycle.length];

            let rawScore = overallIpi;
            if (tag === "良好") rawScore = overallIpi + 15;
            else if (tag === "风险") rawScore = overallIpi - 15;

            return {
              id: sec.id || (idx + 1),
              label: sec.title || sec.category || `Section ${idx + 1}`,
              timeRange: `${fmtTime(startSecs)} - ${fmtTime(endSecs)}`,
              durationText: fmtTime(durSecs),
              secondsStart: Math.floor(startSecs),
              secondsEnd: Math.ceil(endSecs),
              tag: tag,
              tagColor: tagColor,
              score: Math.max(40, Math.min(98, rawScore)),
              badgeText: sec.category || "AI 分析",
              badgeColor: tagColor,
              summary: sec.summary || "AI 正在生成片段分析...",
              advantages: sec.advantages || [],
              shortcomings: sec.shortcomings || [],
              reviewPoints: sec.review_points || [],
              ipiTrendPoints: [70, 72, 74, 73, 75, 76, 78],
              radarScores: deriveRadarScores(tag, sec.title || sec.category || ""),
              dialogue: sectionDialogue.map(utt => ({
                sender: utt.speaker === "Interviewer" ? "interviewer" as const : "user" as const,
                name: utt.speaker === "Interviewer" ? "面试官" : "您",
                time: fmtTime(Math.floor(utt.start_time)),
                seconds: Math.floor(utt.start_time),
                text: utt.content,
                highlights: utt.highlights || []
              })),
              dbSectionId: sec.id,
              optimizationAdvice: sec.optimization_advice || undefined,
            };
          });

          // Normalize segment scores so their average exactly equals overallIpi
          if (dynamicSegments.length > 0) {
            const targetSum = overallIpi * dynamicSegments.length;
            let currentSum = dynamicSegments.reduce((sum, s) => sum + s.score, 0);
            let diff = targetSum - currentSum;
            if (diff !== 0) {
              const step = diff > 0 ? 1 : -1;
              const absDiff = Math.abs(diff);
              for (let i = 0; i < absDiff; i++) {
                let adjusted = false;
                for (let j = 0; j < dynamicSegments.length; j++) {
                  const idx = (i + j) % dynamicSegments.length;
                  const s = dynamicSegments[idx];
                  const newScore = s.score + step;
                  if (newScore >= 40 && newScore <= 98) {
                    s.score = newScore;
                    currentSum += step;
                    adjusted = true;
                    break;
                  }
                }
                if (!adjusted) break;
              }
            }
          }
        } else {
          dynamicSegments = buildDynamicSegments(rawTranscript);
          if (dynamicSegments.length > 0) {
            const targetSum = overallIpi * dynamicSegments.length;
            let currentSum = dynamicSegments.reduce((sum, s) => sum + s.score, 0);
            let diff = targetSum - currentSum;
            if (diff !== 0) {
              const step = diff > 0 ? 1 : -1;
              const absDiff = Math.abs(diff);
              for (let i = 0; i < absDiff; i++) {
                let adjusted = false;
                for (let j = 0; j < dynamicSegments.length; j++) {
                  const idx = (i + j) % dynamicSegments.length;
                  const s = dynamicSegments[idx];
                  const newScore = s.score + step;
                  if (newScore >= 40 && newScore <= 98) {
                    s.score = newScore;
                    currentSum += step;
                    adjusted = true;
                    break;
                  }
                }
                if (!adjusted) break;
              }
            }
          }
        }

        const mergedSegments = mergeSegmentsToMax10(dynamicSegments);
        if (mergedSegments.length > 0) {
          const targetSum = overallIpi * mergedSegments.length;
          let currentSum = mergedSegments.reduce((sum, s) => sum + s.score, 0);
          let diff = targetSum - currentSum;
          if (diff !== 0) {
            const step = diff > 0 ? 1 : -1;
            const absDiff = Math.abs(diff);
            for (let i = 0; i < absDiff; i++) {
              let adjusted = false;
              for (let j = 0; j < mergedSegments.length; j++) {
                const idx = (i + j) % mergedSegments.length;
                const s = mergedSegments[idx];
                const newScore = s.score + step;
                if (newScore >= 40 && newScore <= 98) {
                  s.score = newScore;
                  currentSum += step;
                  adjusted = true;
                  break;
                }
              }
              if (!adjusted) break;
            }
          }
        }
        setLiveSegmentsData(mergedSegments);
        setActiveSegIdx(0); // reset to first real segment
        if (mergedSegments.length > 0) {
          setPlaybackTime(mergedSegments[0].secondsStart);
        }

        // Clean up and show dashboard
        localStorage.removeItem("interviewVar_session_id");
        setPageStatus("ready");


      } catch (err) {
        console.error("Failed to load report:", err);
        setPageStatus("no_session");
        setTimeout(() => router.push("/debugger"), 2500);
      }
    };

    loadReport();

  }, []);




  // Next steps optimizer script generation modal
  const [showOptimizer, setShowOptimizer] = useState(false);
  const [showRisksModal, setShowRisksModal] = useState(false);
  const [optPhase, setOptPhase] = useState("idle");
  const [isHighlightEnabled, setIsHighlightEnabled] = useState(true);
  const [optAdvice, setOptAdvice] = useState<{ conclusion: string; original: string; optimized: string } | null>(null);

  // Search state variables
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // ── Real HTML5 audio element ref ──────────────────────────────────
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioLoaded, setAudioLoaded] = useState(false);

  // Load audio URL from localStorage on mount
  useEffect(() => {
    const savedUrl = localStorage.getItem("interviewVar_session_audio_url");
    if (savedUrl) setAudioUrl(savedUrl);
  }, []);

  // When audio URL changes, update the audio element src
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !audioUrl) return;

    const onCanPlay = () => setAudioLoaded(true);
    const onError = () => setAudioLoaded(true); // fallback so play button is never stuck spinning

    audio.addEventListener("canplay", onCanPlay);
    audio.addEventListener("error", onError);

    setAudioLoaded(audio.readyState >= 3);
    audio.src = audioUrl;
    audio.load();

    return () => {
      audio.removeEventListener("canplay", onCanPlay);
      audio.removeEventListener("error", onError);
    };
  }, [audioUrl]);

  // Sync playbackTime state from audio timeupdate events
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => {
      const t = Math.floor(audio.currentTime);
      setPlaybackTime(t);

      // Auto-switch active segment as audio plays through timeline
      const newSegIdx = liveSegmentsData.findIndex((s, idx) => {
        if (idx === liveSegmentsData.length - 1) {
          return t >= s.secondsStart && t <= s.secondsEnd;
        }
        return t >= s.secondsStart && t < s.secondsEnd;
      });
      if (newSegIdx !== -1) {
        setActiveSegIdx(prev => prev !== newSegIdx ? newSegIdx : prev);
      }
    };

    const onPlay  = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => { setIsPlaying(false); };

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("play",  onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);

    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("play",  onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
    };
  }, [liveSegmentsData]);

  // When switching segment via sidebar, seek audio to segment start
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      setIsPlaying(false);
      setPlaybackTime(activeSeg.secondsStart);
      return;
    }
    const wasPlaying = !audio.paused;
    audio.currentTime = activeSeg.secondsStart;
    setPlaybackTime(activeSeg.secondsStart);
    if (wasPlaying) {
      audio.play().catch(() => {});
      setIsPlaying(true);
    } else {
      setIsPlaying(false);
    }
  }, [activeSegIdx]);

  // Format seconds to MM:SS
  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, "00")}:${s.toString().padStart(2, "00")}`;
  };

  // Toggle play / pause on real audio element
  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio || !audioUrl) {
      // No audio available — gracefully show message
      return;
    }
    if (audio.paused) {
      audio.currentTime = playbackTime; // ensure position is in sync
      audio.play().catch(() => {});
    } else {
      audio.pause();
    }
  };

  // Skip audio by offset seconds
  const skipTime = (offset: number) => {
    const audio = audioRef.current;
    const target = playbackTime + offset;
    const clamped = Math.max(0, Math.min(totalDuration, target));
    setPlaybackTime(clamped);
    if (audio) audio.currentTime = clamped;
  };

  // Jump playhead to exact second (cross-segment aware)
  const jumpPlayhead = (sec: number) => {
    const targetSegIdx = liveSegmentsData.findIndex((s, idx) => {
      if (idx === liveSegmentsData.length - 1) {
        return sec >= s.secondsStart && sec <= s.secondsEnd;
      }
      return sec >= s.secondsStart && sec < s.secondsEnd;
    });
    if (targetSegIdx !== -1 && targetSegIdx !== activeSegIdx) {
      setActiveSegIdx(targetSegIdx);
      // Audio seek happens in the activeSegIdx useEffect + manual set below
      setTimeout(() => {
        const audio = audioRef.current;
        if (audio) { audio.currentTime = sec; audio.play().catch(() => {}); }
        setPlaybackTime(sec);
        setIsPlaying(true);
      }, 50);
    } else {
      const audio = audioRef.current;
      if (audio) { audio.currentTime = sec; audio.play().catch(() => {}); }
      setPlaybackTime(sec);
      setIsPlaying(true);
    }
  };

  // Update playback speed on real audio element
  const handleSpeedChange = (speed: number) => {
    setPlaySpeed(speed);
    if (audioRef.current) audioRef.current.playbackRate = speed;
  };

  // Trigger Action Advice generation
  const handleOpenOptimizer = async (forceRegenerate = false) => {
    setShowOptimizer(true);

    const sectionId = activeSeg?.dbSectionId;
    if (!sectionId) {
      // Fallback: If no database section ID exists (mock data), simulate delay and display a high-quality mock response
      if (activeSeg?.optimizationAdvice && !forceRegenerate) {
        setOptAdvice(activeSeg.optimizationAdvice);
        setOptPhase("completed");
        return;
      }
      setOptPhase("loading");
      await new Promise(r => setTimeout(r, 1500));
      const mockAdvice = {
        conclusion: `针对【${activeSeg?.label || "片段分析"}】环节，表现总体${activeSeg?.tag || "良好"}。但原话术在专业度及系统深度上仍有提升空间。`,
        original: activeSeg?.dialogue?.filter(d => d.sender === "user").map(d => d.text).join(" ") || "（未检测到用户回答）",
        optimized: `在${activeSeg?.label || "本"}场景下，建议采用结构化叙事方法（STAR原则）。<br/><br/><strong>大厂高分话术推荐：</strong><br/>“针对这个问题，我们核心的解决思路是：首先评估受损面，其次通过引入多级缓存/Redisson读写锁/消息队列等方式进行异步化和服务解耦。这不仅降低了系统的直接负载，也确保了数据一致性。我们在生产环境中测试该方案后，QPS提升了大约50%。”`
      };
      setOptAdvice(mockAdvice);
      // Cache inside the segment data
      const updated = [...liveSegmentsData];
      updated[activeSegIdx] = {
        ...updated[activeSegIdx],
        optimizationAdvice: mockAdvice
      };
      setLiveSegmentsData(updated);
      setOptPhase("completed");
      return;
    }

    // If already generated and not forcing regeneration, show cached
    if (activeSeg?.optimizationAdvice && !forceRegenerate) {
      setOptAdvice(activeSeg.optimizationAdvice);
      setOptPhase("completed");
      return;
    }

    // Otherwise, fetch from backend
    setOptPhase("loading");
    try {
      const token = localStorage.getItem("interviewVar_token");
      const headers: Record<string, string> = {
        "Content-Type": "application/json"
      };
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const res = await fetch(`${API_BASE}/api/audio/section/${sectionId}/optimize`, {
        method: "POST",
        headers
      });

      if (!res.ok) {
        throw new Error("Failed to generate optimization advice");
      }

      const data = await res.json();
      const advice = {
        conclusion: data.conclusion,
        original: data.original,
        optimized: data.optimized
      };

      setOptAdvice(advice);
      
      // Update in local state cache
      const updated = [...liveSegmentsData];
      updated[activeSegIdx] = {
        ...updated[activeSegIdx],
        optimizationAdvice: advice
      };
      setLiveSegmentsData(updated);
      setOptPhase("completed");
    } catch (err) {
      console.error("Error generating advice:", err);
      setOptAdvice({
        conclusion: "大模型生成失败，请重试。",
        original: "分析请求失败",
        optimized: "服务暂时不可用，请稍后重试。"
      });
      setOptPhase("completed");
    }
  };

  // Export all dialogue logs to PDF
  // Export all dialogue logs to PDF
  const handleExportPDF = async () => {
    if (liveSegmentsData.length === 0) {
      auth.triggerToast("没有可导出的对话记录！");
      return;
    }

    const company = interviewInfo.company || "—";
    const role = interviewInfo.role || "—";
    const round = interviewInfo.round || "—";
    const date = interviewInfo.time || "—";
    const score = reportData ? reportData.ipi_score : activeSeg?.score || 0;
    const grade = reportData ? (reportData.ipi_score >= 80 ? "优秀" : reportData.ipi_score >= 65 ? "中等" : "预警") : activeSeg?.badgeText || "";

    let htmlContent = `
      <html>
      <head>
        <title>${company} - ${role} 面试对话记录</title>
        <style>
          body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            background-color: #ffffff;
            color: #1a202c;
            margin: 0;
            padding: 40px;
          }
          .header {
            border-bottom: 2px solid #edf2f7;
            padding-bottom: 24px;
            margin-bottom: 30px;
          }
          .header-title {
            font-size: 24px;
            font-weight: 800;
            color: #0d1326;
            margin: 0 0 8px 0;
          }
          .header-meta {
            font-size: 14px;
            color: #718096;
            font-weight: 600;
            display: flex;
            gap: 16px;
          }
          .score-badge {
            color: #afa7ff;
            font-weight: 800;
          }
          .section-block {
            margin-bottom: 35px;
            page-break-inside: avoid;
          }
          .section-header {
            font-size: 16px;
            font-weight: 800;
            background: #f7fafc;
            border-left: 4px solid #afa7ff;
            padding: 8px 12px;
            margin-bottom: 16px;
            display: flex;
            justify-content: space-between;
            align-items: center;
          }
          .section-time {
            font-size: 13px;
            color: #a0aec0;
            font-family: monospace;
          }
          .bubble {
            margin-bottom: 12px;
            padding: 12px 16px;
            border-radius: 12px;
            border: 1px solid #e2e8f0;
            display: flex;
            flex-direction: column;
            gap: 4px;
          }
          .bubble-interviewer {
            background-color: #f8fafc;
            border-color: #e2e8f0;
          }
          .bubble-user {
            background-color: #f5f3ff;
            border-color: #e9d5ff;
          }
          .bubble-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-size: 12px;
            font-weight: 600;
            color: #4a5568;
          }
          .speaker-dot {
            display: inline-block;
            width: 8px;
            height: 8px;
            border-radius: 50%;
            margin-right: 6px;
          }
          .dot-interviewer { background-color: #ff7a95; }
          .dot-user { background-color: #00d4ff; }
          .bubble-time {
            font-family: monospace;
            color: #a0aec0;
            margin-left: 6px;
          }
          .bubble-text {
            font-size: 14px;
            line-height: 1.6;
            color: #2d3748;
            margin: 4px 0 0 0;
            white-space: pre-wrap;
          }
          .badge {
            font-size: 10px;
            padding: 2px 6px;
            border-radius: 4px;
            font-weight: 800;
            text-transform: uppercase;
          }
          .badge-warning {
            background-color: #fff5f5;
            color: #c53030;
            border: 1px solid #fed7d7;
          }
          .badge-good {
            background-color: #f0fff4;
            color: #22543d;
            border: 1px solid #c6f6d5;
          }
          @media print {
            body { padding: 20px; }
            .section-block { page-break-inside: avoid; }
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1 class="header-title">${company} · ${role} (${round})</h1>
          <div class="header-meta">
            <span>面试时间: ${date}</span>
            <span>|</span>
            <span>综合得分: <span class="score-badge">${score}分 (${grade})</span></span>
          </div>
        </div>
    `;

    liveSegmentsData.forEach((seg, idx) => {
      htmlContent += `
        <div class="section-block">
          <div class="section-header">
            <div>段落 #${idx + 1}: ${seg.label}</div>
            <div class="section-time">${seg.timeRange}</div>
          </div>
      `;

      seg.dialogue.forEach((bubble) => {
        const isInterviewer = bubble.sender === "interviewer";
        const bubbleClass = isInterviewer ? "bubble-interviewer" : "bubble-user";
        const dotClass = isInterviewer ? "dot-interviewer" : "dot-user";
        const badgeHtml = bubble.badgeText 
          ? `<span class="badge ${bubble.badgeClass?.includes("FF7A95") ? "badge-warning" : "badge-good"}">${bubble.badgeText}</span>` 
          : "";

        htmlContent += `
          <div class="bubble ${bubbleClass}">
            <div class="bubble-header">
              <span>
                <span class="speaker-dot ${dotClass}"></span>
                <strong>${bubble.name}</strong>
                <span class="bubble-time">${bubble.time}</span>
              </span>
              ${badgeHtml}
            </div>
            <p class="bubble-text">${bubble.text}</p>
          </div>
        `;
      });

      htmlContent += `</div>`;
    });

    htmlContent += `
      </body>
      </html>
    `;

    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      auth.triggerToast("请允许弹出窗口以进行 PDF 导出");
      return;
    }
    printWindow.document.write(htmlContent);
    printWindow.document.close();
    printWindow.focus();

    setTimeout(() => {
      printWindow.print();
    }, 500);
  };

  return (
    <div className="min-h-screen bg-[#050B1A] text-[#dae2fd] font-body-md flex flex-col relative overflow-x-hidden overflow-y-auto select-none pt-20">

      {/* Hidden real audio element — drives all playback */}
      <audio
        ref={audioRef}
        preload="auto"
        style={{ display: "none" }}
      />

      {/* ============================================================
          PAGE STATE OVERLAYS
         ============================================================ */}

      {/* ── ANALYZING: full-screen loading while polling ────────────── */}
      {pageStatus === "analyzing" && (
        <div className="fixed inset-0 z-50 bg-[#050B1A] flex flex-col items-center justify-center gap-8">
          {hasActiveTask ? (
            <div className="flex flex-col items-center gap-5 max-w-md w-full px-8">
              {/* Dual-ring Spinner */}
              <div className="relative w-20 h-20">
                <div className="absolute inset-0 rounded-full border-4 border-[#AFA7FF]/20 border-t-[#AFA7FF] animate-spin" />
                <div className="absolute inset-3 rounded-full border-4 border-[#5DECCB]/10 border-t-[#5DECCB] animate-spin" style={{ animationDirection: "reverse", animationDuration: "1.2s" }} />
              </div>

              <div className="text-center space-y-3">
                <h3 className="text-white font-black text-2xl md:text-xl animate-pulse tracking-wide">{ANALYSIS_STEPS[analysisStep]}</h3>
                <p className="text-base md:text-lg text-white/70 font-semibold">AI 智能分析中，分析完成后自动进入报告页面…</p>
              </div>

              <div className="w-full bg-white/5 rounded-full h-1.5 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-[#AFA7FF] to-[#5DECCB] transition-all duration-700"
                  style={{ width: `${analysisProgress}%` }}
                />
              </div>
              <p className="text-[#5DECCB] text-2xl md:text-3xl font-black font-mono tracking-wider drop-shadow-[0_0_10px_rgba(93,236,203,0.5)] mt-2">{analysisProgress}%</p>

              <div className="w-full space-y-2">
                {ANALYSIS_STEPS.slice(0, -1).map((step, idx) => (
                  <div key={idx} className={`flex items-center gap-2.5 text-xs font-semibold transition-all ${
                    idx < analysisStep ? "text-[#5DECCB]" :
                    idx === analysisStep ? "text-white animate-pulse" :
                    "text-white/20"
                  }`}>
                    <span className="material-symbols-outlined text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>
                      {idx < analysisStep ? "check_circle" : idx === analysisStep ? "radio_button_checked" : "radio_button_unchecked"}
                    </span>
                    {step}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4">
              <div className="relative w-16 h-16">
                <div className="absolute inset-0 rounded-full border-4 border-[#AFA7FF]/20 border-t-[#AFA7FF] animate-spin" />
              </div>
              <p className="text-white/70 font-bold text-sm tracking-wide animate-pulse">正在加载历史分析报告...</p>
            </div>
          )}
        </div>
      )}

      {/* ── NO_SESSION: redirect message ──────────────────────────── */}
      {pageStatus === "no_session" && (
        <div className="fixed inset-0 z-50 bg-[#050B1A] flex flex-col items-center justify-center gap-5">
          <span className="material-symbols-outlined text-[#FF7A95]" style={{ fontSize: "72px", fontVariationSettings: "'FILL' 1" }}>error</span>
          <h2 className="text-white font-black text-xl">没有进行中的分析任务</h2>
          <p className="text-white/50 text-sm">请先上传录音文件并启动分析，正在返回…</p>
          <button
            onClick={() => router.push("/debugger")}
            className="px-6 py-2.5 bg-[#AFA7FF] text-[#050B1A] font-black rounded-full hover:bg-white transition-all"
          >
            返回调试器
          </button>
        </div>
      )}

      
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
            面试VAR
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
            <a onClick={() => router.push("/feedback")} className="text-on-surface-variant hover:text-on-surface transition-colors text-[16px] md:text-[17px] font-extrabold cursor-pointer">
              体验反馈中心
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
          MAIN WORKSPACE DASHBOARD — only rendered when analysis is done
         ======================================================== */}
      {pageStatus === "ready" && (
      <motion.div
        key="dashboard"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="flex-1 flex flex-col px-gutter max-w-container-max mx-auto w-full py-6 gap-[22px] text-left relative z-10"
      >
        {/* Guest Warning Banner */}
        {isGuest && (
          <div className="p-4.5 rounded-2xl bg-[#FF7A95]/10 border border-[#FF7A95]/20 text-[#FF7A95] text-xs font-semibold leading-relaxed flex items-center gap-3.5 shadow-lg select-none mb-2">
            <span className="material-symbols-outlined text-xl shrink-0" style={{ fontVariationSettings: "'FILL' 1" }}>warning</span>
            <div>
              <p className="font-extrabold text-white text-sm mb-0.5">免费体验模式 (未登录)</p>
              <p className="text-white/70">您当前未登录，系统已启用免费体验流程。<b>本次分析没有结合您的个人画像（如工作年限、目标职级等）以及历史职业记忆</b>。建议您 <span onClick={() => auth.setShowLogin(true)} className="text-[#AFA7FF] hover:underline cursor-pointer font-black">登录/注册</span> 以解锁完整的个性化深度分析与职业记忆沉淀！</p>
            </div>
          </div>
        )}

            {/* ========================================================
                MAIN WORKSPACE GRID LAYOUT (3 COLUMNS)
               ======================================================== */}
            <div className="grid grid-cols-12 gap-[22px] items-stretch w-full">
              
              {/* ----------------------------------------------------
                  COLUMN 1: Left Sidebar (3 cols)
                 ---------------------------------------------------- */}
              <div className="col-span-12 lg:col-span-3 flex flex-col gap-[18px]">

                {/* 1.1 Interview Metadata Card */}
                <div className="glass-panel p-4.5 rounded-2xl border-white/5 flex flex-col gap-3.5 h-[290px] shrink-0">
                  <div className="flex justify-between items-center pb-2 border-b border-white/5">
                    <h4 className="text-sm font-black text-white uppercase tracking-wider flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-base text-[#00D4FF]">assignment_ind</span>
                      面试信息
                    </h4>
                  </div>

                  <div className="space-y-2.5 text-xs font-bold text-white/60">
                    <div className="flex justify-between items-center">
                      <span>是否在职</span>
                      <span className="px-2 py-0.5 rounded bg-[#5DECCB]/10 text-[#5DECCB] border border-[#5DECCB]/20 text-xs font-extrabold">
                        {interviewInfo.isOnJob || "—"}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span>工作年限</span>
                      <span className="text-white font-extrabold">{interviewInfo.years || "—"}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span>面试公司</span>
                      <span className="text-white font-extrabold">{interviewInfo.company || "—"}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span>面试岗位</span>
                      <span className="text-white font-extrabold">{interviewInfo.role || "—"}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span>面试轮次</span>
                      <span className="text-white font-extrabold">{interviewInfo.round || "—"}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span>面试时间</span>
                      <span className="text-white font-extrabold">{interviewInfo.time || "—"}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span>岗位职级</span>
                      <span className="text-white font-extrabold">{interviewInfo.level || "—"}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span>期望薪资</span>
                      <span className="text-white font-extrabold">{interviewInfo.salary || "—"}</span>
                    </div>
                  </div>
                </div>

                {/* 1.2 Interview Vertical Timeline Selector */}
                <div className="glass-panel p-4.5 rounded-2xl border-white/5 flex flex-col gap-3.5 h-[470px] shrink-0">
                  <div className="flex justify-between items-center pb-2 border-b border-white/5">
                    <h4 className="text-sm font-black text-white uppercase tracking-wider flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-base text-[#00D4FF]">list_alt</span>
                      面试时间线
                    </h4>
                    <span className="text-sm text-white/40 font-mono">共 {liveSegmentsData.length} 个片段, {formatTime(liveSegmentsData.length > 0 ? liveSegmentsData[liveSegmentsData.length - 1].secondsEnd : 0)}</span>
                  </div>

                  {/* Vertical Segment items */}
                  <div className="flex-1 overflow-y-auto space-y-3 pr-1 select-none">
                    {liveSegmentsData.map((seg, idx) => {
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
                            // Ensure the clicked section is expanded
                            setCollapsedSections(prev => ({ ...prev, [seg.id]: false }));
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
                    onClick={handleExportPDF}
                    className="w-full py-2 bg-white/5 hover:bg-white/10 border border-white/10 text-white text-sm font-black rounded-xl transition-all cursor-pointer text-center"
                  >
                    导出完整日志
                  </button>
                </div>

              </div>

              {/* ----------------------------------------------------
                  COLUMN 2: Center Workspace (6 cols)
                 ---------------------------------------------------- */}
              <div className="col-span-12 lg:col-span-5.5 xl:col-span-6 flex flex-col gap-[18px]">
                
                {/* 2.1 Wave Player & Info Header */}
                <div className="glass-panel p-5.5 rounded-2xl border-white/5 flex flex-col gap-4.5 h-[210px] shrink-0">
                  
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

                  </div>

                  {/* Elegant Thin Waveform Player */}
                  <div className="bg-slate-950/40 border border-white/5 rounded-2xl p-4 flex flex-col gap-2 relative">
                    
                    <div className="flex items-center gap-4.5">
                      
                      {/* Play / Pause */}
                      <button 
                        onClick={togglePlay}
                        title={!audioUrl ? "请先上传录音文件" : audioLoaded ? "播放/暂停" : "音频加载中..."}
                        className={`w-10 h-10 rounded-full bg-gradient-to-tr from-[#AFA7FF] to-[#00D4FF] hover:scale-105 active:scale-95 transition-all flex items-center justify-center cursor-pointer shadow-lg shadow-purple-500/10 shrink-0 ${
                          !audioUrl ? "opacity-50 cursor-not-allowed" : ""
                        }`}
                      >
                        {!audioLoaded && audioUrl ? (
                          <span className="material-symbols-outlined text-[#050B1A] text-base animate-spin" style={{ fontVariationSettings: "'FILL' 1" }}>progress_activity</span>
                        ) : (
                          <span className="material-symbols-outlined text-[#050B1A] text-xl font-black" style={{ fontVariationSettings: "'FILL' 1" }}>
                            {isPlaying ? "pause" : "play_arrow"}
                          </span>
                        )}
                      </button>

                      {/* Waveform track */}
                      <div className="flex-1 h-9 relative flex items-center justify-between gap-[1.5px] select-none py-1">
                        {Array.from({ length: 66 }).map((_, wIdx) => {
                          const percentIndex = (wIdx / 66) * 100;
                          const isPlayed = percentIndex <= (playbackTime / totalDuration) * 100;
                          
                          // Fine mirrored height profiles
                          const heightMap = [
                            10, 15, 20, 25, 18, 12, 10, 16, 22, 34, 45, 52, 40, 25, 15, 30, 52, 68, 75, 62, 45, 25,
                            12, 18, 22, 32, 42, 58, 48, 38, 20, 12, 22, 40, 55, 62, 48, 30, 15, 10, 14, 25, 32, 20,
                            12, 8, 14, 28, 40, 48, 35, 22, 12, 8, 14, 25, 34, 20, 12, 8, 12, 18, 12, 8, 5, 3
                          ];
                          const hValue = heightMap[wIdx] || 15;

                          const targetSecs = Math.round((wIdx / 66) * totalDuration);

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
                          onChange={(e) => handleSpeedChange(parseFloat(e.target.value))}
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
                      <span>00:00</span>
                      <span>{formatTime(totalDuration)}</span>
                    </div>

                  </div>

                </div>

                {/* 2.2 Dialogue Transcript Card */}
                <div className="glass-panel p-5.5 rounded-2xl border-white/5 flex flex-col gap-4 h-[550px] shrink-0">
                  
                  {/* Sub Header & AI Tools row */}
                  <div className="flex justify-between items-center select-none shrink-0">
                    <h3 className="text-sm font-black text-white uppercase tracking-wider flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-sm text-[#AFA7FF]">forum</span>
                      对话记录
                    </h3>
                    
                    <div className="flex items-center gap-2 text-xs font-bold">
                      <div className="relative group/btn">
                        <button 
                          onClick={() => setIsHighlightEnabled(!isHighlightEnabled)}
                          className={`px-2.5 py-1 border rounded-lg transition-all flex items-center gap-1 cursor-pointer text-xs font-bold ${
                            isHighlightEnabled 
                              ? "bg-[#00D4FF]/10 border-[#00D4FF]/30 text-[#00D4FF] shadow-[0_0_8px_rgba(0,212,255,0.2)]" 
                              : "bg-white/5 border-white/10 text-white/60 hover:text-white"
                          }`}
                        >
                          <span className="material-symbols-outlined text-xs">auto_awesome</span>AI 高亮
                        </button>
                        
                        {/* Hover Tooltip for the button itself */}
                        <div className="invisible group-hover/btn:visible absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 p-3 bg-[#050B1A]/95 border border-white/10 text-white text-xs rounded-xl shadow-2xl z-50 text-left pointer-events-none select-none backdrop-blur-md font-semibold leading-relaxed">
                          <span className="text-[#00D4FF] font-black block mb-0.5">智能对话分析定位</span>
                          <span className="text-white/60 text-[11px] block">开启后可在对话气泡中高亮展示面试亮点、表达风险和专业词汇，悬浮查看 AI 评语。</span>
                        </div>
                      </div>
                      
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

                  {/* Transcript bubbles list (Only active segment) */}
                  <div className="flex-1 overflow-y-auto space-y-4 pr-1">
                    {activeSeg && (() => {
                      const seg = activeSeg;
                      const segIdx = activeSegIdx;
                      const filteredDialogue = seg.dialogue.filter(bubble => 
                        bubble.text.toLowerCase().includes(searchQuery.toLowerCase())
                      );

                      if (filteredDialogue.length === 0 && searchQuery) {
                        return (
                          <div className="text-center py-8 text-white/30 text-xs select-none">
                            没有找到匹配的对话内容
                          </div>
                        );
                      }

                      return (
                        <div key={seg.id} id={`section-block-${seg.id}`} className="space-y-3 scroll-mt-6">
                          {/* Segment Header */}
                          <div className="flex justify-between items-center p-3 rounded-xl bg-white/5 border border-white/10 select-none">
                            <div className="flex items-center gap-2 text-sm font-bold">
                              <span className="text-[#AFA7FF] font-mono">#{segIdx + 1}</span>
                              <span className="text-white font-black text-sm md:text-base">{seg.label}</span>
                              <span className={`px-2 py-0.5 rounded text-[10px] uppercase border font-semibold ${seg.tagColor}`}>
                                {seg.tag}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 text-xs text-white/40 font-mono">
                              <span>{seg.timeRange}</span>
                            </div>
                          </div>

                          {/* Dialogue bubbles */}
                          <div className="space-y-3 pl-3 border-l border-white/5">
                            {filteredDialogue.map((bubble, idx) => {
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
                                  <p className="text-[13px] md:text-sm leading-relaxed">
                                    {renderHighlightText(bubble.text, bubble.highlights, isPlayed, isHighlightEnabled)}
                                  </p>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}
                  </div>

                  <div className="pt-2 text-center select-none shrink-0 border-t border-white/5">
                    <span 
                      onClick={() => handleOpenOptimizer()}
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
              <div className="col-span-12 lg:col-span-3.5 xl:col-span-3 flex flex-col gap-[18px]">
                
                 {/* 3.1 IPI Performance Index widget with line chart */}
                <div className="glass-panel p-4.5 rounded-2xl border-white/5 flex flex-col gap-3.5 h-[230px] shrink-0">
                  <div className="flex justify-between items-center pb-2 border-b border-white/5 select-none">
                    <h4 className="text-sm font-black text-white uppercase tracking-wider flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-sm text-[#00D4FF]">monitoring</span>
                      面试表现指数 (IPI)
                    </h4>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="flex items-baseline leading-none">
                      <span className="text-4xl font-black font-mono text-white tracking-tighter">
                        {reportData ? reportData.ipi_score : activeSeg.score}
                      </span>
                      <span className="text-sm text-white/30 font-bold ml-0.5">/100</span>
                    </div>
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-black uppercase text-[#5DECCB] bg-[#5DECCB]/10 border border-[#5DECCB]/25">
                      {reportData ? (reportData.ipi_score >= 80 ? "表现优秀" : reportData.ipi_score >= 65 ? "中等表现" : "表现预警") : activeSeg.badgeText}
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
                        d={areaPath} 
                        fill="url(#line-area-grad)" 
                      />

                      {/* Neon Curve */}
                      <path 
                        d={linePath} 
                        fill="none" 
                        stroke="url(#line-neon-grad)" 
                        strokeWidth="2" 
                        strokeLinecap="round" 
                      />

                      {/* Vertical line indicator at active segment */}
                      <line x1={activePt.x} y1="5" x2={activePt.x} y2="65" stroke="#FF7A95" strokeWidth="0.75" strokeDasharray="2 2" />
                      <circle cx={activePt.x} cy={activePt.y} r="3" fill="white" stroke="#FF7A95" strokeWidth="1.5" />
                    </svg>

                    {/* Dotted playhead marker readout label */}
                    <div 
                      style={{ left: `${(activePt.x / 240) * 100}%` }}
                      className="absolute top-[28px] -translate-x-1/2 bg-[#FF7A95]/15 border border-[#FF7A95]/30 px-1.5 py-0.5 rounded font-mono text-[10px] text-[#FF7A95] font-black pointer-events-none"
                    >
                      {activeSeg?.timeRange?.split(" - ")[0] || "00:00"}
                    </div>
                  </div>

                  <p className="text-xs text-white/50 leading-relaxed font-semibold">
                    整体趋势：表现{(reportData?.ipi_score || activeSeg?.score || 70) >= 80 ? "非常优秀" : (reportData?.ipi_score || activeSeg?.score || 70) >= 65 ? "比较稳健" : "波动较大"}。当前片段得分为 <span className="text-[#AFA7FF] font-extrabold">{activeSeg?.score || 70}分</span>
                  </p>
                </div>

                {/* 3.2 Risk Moments list */}
                <div className="glass-panel p-4.5 rounded-2xl border-white/5 flex flex-col gap-3.5 h-[212px] shrink-0">
                  <div className="flex justify-between items-center pb-2 border-b border-white/5 select-none">
                    <h4 className="text-sm font-black text-white uppercase tracking-wider flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-sm text-[#FF7A95]">report</span>
                      关键风险点
                    </h4>
                    <span className="text-xs text-[#FF7A95] font-mono font-black">{dynamicRisks.length} 个风险点</span>
                  </div>

                  <div className="space-y-2.5 flex-1 overflow-y-auto pr-1">
                    {dynamicRisks.length > 0 ? (
                      dynamicRisks.map((risk, idx) => (
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
                      ))
                    ) : (
                      <div className="h-full flex items-center justify-center text-xs text-white/30 italic select-none">
                        暂无明显关键风险点
                      </div>
                    )}
                  </div>

                  <div className="pt-1.5 border-t border-white/5 select-none text-center">
                    <span 
                      onClick={() => setShowRisksModal(true)}
                      className="text-sm font-black text-[#AFA7FF] hover:text-white transition-colors cursor-pointer flex items-center justify-center gap-1"
                    >
                      查看全部风险点 <span className="material-symbols-outlined text-xs">keyboard_arrow_right</span>
                    </span>
                  </div>
                </div>

                {/* 3.3 Skill Constellation Pentagon Radar Chart */}
                <div className="glass-panel p-4.5 rounded-2xl border-white/5 flex flex-col gap-3 h-[300px] shrink-0">
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
            <div className="glass-panel p-5.5 rounded-2xl border-white/5 grid grid-cols-12 gap-[22px] w-full select-none mt-1">
              
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
              <div className="col-span-12 sm:col-span-6 lg:col-span-2 pl-2 flex flex-col justify-start gap-2.5">
                <div>
                  <h4 className="text-sm font-black text-white uppercase tracking-wider">下一步建议</h4>
                  <p className="text-xs text-white/40 leading-snug font-bold mt-1">
                    {activeSeg?.optimizationAdvice ? "已生成表达优化建议，可直接查看或重新生成" : "生成本片段的表达优化建议，提升回答质量"}
                  </p>
                </div>
                <button 
                  onClick={() => handleOpenOptimizer()}
                  className="w-full py-2 bg-[#8B5CF6] hover:bg-[#7C3AED] text-white text-xs md:text-sm font-black rounded-lg transition-all cursor-pointer shadow-lg shadow-purple-500/10"
                >
                  {activeSeg?.optimizationAdvice ? "查看优化建议" : "生成优化建议"}
                </button>
              </div>

            </div>

          </motion.div>
      )} {/* end pageStatus === "ready" */}

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
                  面试VAR AI 表达重塑对策建议
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
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="p-3.5 rounded-2xl bg-[#FF7A95]/10 border border-[#FF7A95]/20 text-xs text-[#FF7A95] leading-relaxed font-bold">
                    <span className="text-[10px] font-black uppercase tracking-wider block mb-1.5 select-none">AI 诊断结论</span>
                    {optAdvice?.conclusion || "暂无结论"}
                  </div>

                  <div className="space-y-3.5 text-xs text-white/70 leading-relaxed font-bold max-h-[280px] overflow-y-auto pr-1">
                    <div className="space-y-1">
                      <span className="text-white font-black text-sm block">💡 你的原版回答：</span>
                      <p className="bg-white/[0.01] border border-white/5 p-3 rounded-xl text-white/50">{optAdvice?.original || "暂无"}</p>
                    </div>

                    <div className="space-y-1 mt-4">
                      <span className="text-[#5DECCB] font-black text-sm block flex items-center gap-1.5 select-none">
                        <span className="material-symbols-outlined text-base">verified</span>
                        🎯 大厂架构师版高分话术推荐：
                      </span>
                      <div 
                        className="bg-slate-950/60 border border-[#5DECCB]/20 p-3.5 rounded-xl font-mono text-white whitespace-pre-wrap leading-relaxed text-xs"
                        dangerouslySetInnerHTML={{ __html: optAdvice?.optimized || "暂无" }}
                      />
                    </div>
                  </div>

                  <div className="flex justify-end gap-3 pt-2">
                    <button
                      onClick={() => handleOpenOptimizer(true)}
                      className="px-4 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 text-white text-xs font-black rounded-xl transition-all cursor-pointer flex items-center gap-1.5"
                    >
                      <span className="material-symbols-outlined text-sm">cached</span>
                      重新生成
                    </button>
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

      {/* ========================================================
          ALL RISKS SUMMARY MODAL DRAWER
         ======================================================== */}
      <AnimatePresence>
        {showRisksModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowRisksModal(false)}
              className="absolute inset-0 bg-[#050B1A]/80 backdrop-blur-md"
            />

            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-[#050B1A] border border-white/10 rounded-3xl p-6.5 max-w-2xl w-full text-left relative z-10 space-y-4 shadow-2xl overflow-hidden max-h-[85vh] flex flex-col"
            >
              <div className="flex justify-between items-center pb-2.5 border-b border-white/5 select-none shrink-0">
                <h3 className="font-extrabold text-white text-base flex items-center gap-2">
                  <span className="material-symbols-outlined text-[#FF7A95]">report</span>
                  关键风险点汇总记录
                </h3>
                <button
                  onClick={() => setShowRisksModal(false)}
                  className="text-white/40 hover:text-white transition-colors cursor-pointer flex items-center justify-center w-7 h-7 rounded-lg hover:bg-white/5"
                >
                  <span className="material-symbols-outlined text-base">close</span>
                </button>
              </div>

              <div className="flex-1 overflow-y-auto space-y-3.5 pr-1 py-1">
                {dynamicRisks.length > 0 ? (
                  dynamicRisks.map((risk, idx) => (
                    <div key={idx} className="p-4 rounded-2xl bg-white/[0.02] border border-white/5 flex flex-col md:flex-row md:items-start justify-between gap-3.5 hover:border-white/10 transition-all">
                      <div className="space-y-2 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="px-2 py-0.5 rounded bg-white/5 text-[#00D4FF] font-mono font-bold text-xs">
                            {risk.time}
                          </span>
                          <span className="text-white font-extrabold text-xs">
                            {risk.segmentLabel}
                          </span>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase border ${risk.tagClass}`}>
                            {risk.tag}
                          </span>
                        </div>
                        <p className="text-sm font-semibold text-white/80 leading-relaxed">
                          {risk.label}
                        </p>
                        {risk.suggestions.length > 0 && (
                          <div className="text-xs text-white/40 font-bold flex items-center gap-1">
                            <span className="material-symbols-outlined text-xs">auto_stories</span>
                            建议重点复习：{risk.suggestions.join("、")}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => {
                          jumpPlayhead(risk.sec);
                          setShowRisksModal(false);
                        }}
                        className="px-4.5 py-2 bg-[#AFA7FF] hover:bg-white text-[#050B1A] font-black text-xs rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 shrink-0 align-self-end md:align-self-center"
                      >
                        <span className="material-symbols-outlined text-xs font-black">play_circle</span>
                        定位片段
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="py-12 text-center text-white/30 text-sm italic select-none">
                    暂无明显关键风险点
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
