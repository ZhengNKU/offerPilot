"use client";

import React, { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useAuth, UserMenu } from "@/components/AuthProvider";
import { openLegalTerms, openLegalPrivacy, openLegalContact } from "@/components/LegalModals";


// Interface Definitions
interface QuestionItem {
  id: string;
  title: string;
  category: string;
  frequency: number; // 1-5 stars
  desc: string;
  icon: string;
  iconBg: string;
  formula: string;
  goodExample: string;
  badExample: string;
  pitfalls: string[];
}

interface EtiquetteItem {
  id: string;
  title: string;
  icon: string;
  iconBg: string;
  bullets: string[];
  details: string[];
}

interface ArticleItem {
  id: string;
  title: string;
  tag: string;
  reads: string;
  saves: string;
  desc: string;
  badgeBg: string;
  content: string;
}

export default function InterviewGuidePage() {
  const router = useRouter();
  const auth = useAuth();

  // Search & Filter States
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [activeSidebarItem, setActiveSidebarItem] = useState<string>("自我介绍");

  // Modal State
  const [modalData, setModalData] = useState<{
    type: "question" | "etiquette" | "article" | "case";
    title: string;
    content: React.ReactNode;
  } | null>(null);

  // Popular Questions Data
  const popularQuestions: QuestionItem[] = [
    {
      id: "q-intro",
      title: "自我介绍",
      category: "通用问题回答",
      frequency: 5,
      desc: "如何在1-3分钟内清晰展示你的背景、优势和价值。",
      icon: "person",
      iconBg: "bg-purple-500/20 text-purple-300 border-purple-500/30",
      formula: "结构公式：个人标签定位 (15s) + 核心战绩/优势 (60s) + 岗位契合点 (60s) + 求职动机与结语 (15s)。",
      goodExample: "“您好！我是拥有3年经验的高级后端工程师，专注高并发架构与微服务重构。在上一家公司，我主导了核心支付系统的重构，将 API 延迟降低了 45%，成功支撑了双十一峰值。了解到贵公司目前正在拓展高频交易业务，我的架构沉淀与高并发实战经验能快速帮助团队落地核心功能。”",
      badExample: "“我叫张三，今年26岁，毕业于XX大学。我平时的爱好是看书和编程。我上一家公司是在XX科技做开发，写 Java 代码，写了三年。今天来应聘贵公司的开发岗位，希望能给我一个机会。”（流水账无亮点、无量化数据）",
      pitfalls: [
        "切忌照本宣科念简历，面试官要看的是简历背后的思考与突破",
        "时间控制在 2-3 分钟，切勿少于 1 分钟或长篇大论超过 5 分钟",
        "必须包含可量化的具体成果（如数据、提升百分比、团队贡献）"
      ]
    },
    {
      id: "q-leave",
      title: "离职原因",
      category: "通用问题回答",
      frequency: 5,
      desc: "如何专业、积极地回答离职原因，避免踩坑。",
      icon: "domain",
      iconBg: "bg-blue-500/20 text-blue-300 border-blue-500/30",
      formula: "核心逻辑：正向发展导向（追求更大业务舞台 / 技术深造）+ 肯定过往平台积累 + 展望目标岗位契合。",
      goodExample: "“在上家公司的三年里，我独立负责了从0到1的业务架构，能力得到了极大提升。目前上一阶段的业务已非常稳定进入维护期，而我希望在更大规模的高并发大流量场景下深化架构能力。贵公司的业务发展非常迅猛，这与我的长期职业方向高度契合。”",
      badExample: "“前领导太坑了，经常无意义加班，而且公司薪水给得太低，制度很不合理，所以我就辞职了。”（严重扣分：负面抱怨、情绪化）",
      pitfalls: [
        "绝对不要吐槽前公司、领导或同事",
        "不要单纯归咎于薪资福利（可以说追求能力价值与相匹配的平台）",
        "避免显得频繁跳槽或缺乏耐性"
      ]
    },
    {
      id: "q-career",
      title: "职业规划",
      category: "通用问题回答",
      frequency: 5,
      desc: "如何展示你的目标清晰度和成长性，打动面试官。",
      icon: "track_changes",
      iconBg: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
      formula: "时间轴逻辑：短期 (1-2年：快速融入与业务打透) + 中期 (3-5年：领域专家或带团队) + 长期承诺。",
      goodExample: "“短期1-2年内，我计划深入融入团队，把目前申请的岗位业务与技术链路彻底打透，成为团队的核心骨干；中期3-5年内，我希望能够沉淀出可复用的方法论，带领小团队攻坚核心难点，为公司业务拓展贡献持续价值。”",
      badExample: "“我打算先干个一年试试看吧，未来还没想好，走一步看一步。”（无规划、无上进心）",
      pitfalls: [
        "目标切忌浮夸（如“一年内当上总监”）",
        "职业路径要与申请岗位强相关，不要说与岗位无关的创业或转行计划"
      ]
    },
    {
      id: "q-why",
      title: "为什么选择我们",
      category: "通用问题回答",
      frequency: 5,
      desc: "如何体现你对公司的了解和岗位的匹配度。",
      icon: "handshake",
      iconBg: "bg-amber-500/20 text-amber-300 border-amber-500/30",
      formula: "匹配逻辑：公司产品/技术优势认可 + 个人核心能力精准对接 + 共同成长价值。",
      goodExample: "“我一直在关注贵公司的 XX 产品，最近上线的 AI 辅助分析功能令人印象深刻。结合我过往在大模型落地与工程化架构上的沉淀，我不仅能快速上手该业务，还能在系统稳定性方面带来经验。”",
      badExample: "“因为你们公司大名气响，而且我看离我家近、待遇应该不错。”（功利、缺乏对业务的思考）",
      pitfalls: [
        "面试前必须调研公司的产品、最新新闻与技术路线",
        "强调你能给公司带来什么，而不仅仅是公司能给你什么"
      ]
    },
    {
      id: "q-salary",
      title: "期望薪资",
      category: "通用问题回答",
      frequency: 5,
      desc: "如何合理表达薪资期望，争取最大化机会。",
      icon: "account_balance_wallet",
      iconBg: "bg-purple-400/20 text-purple-200 border-purple-400/30",
      formula: "谈判策略：给出合理区间 (基于行业水平与涨幅 15-30%) + 强调综合价值 + 留有弹性余地。",
      goodExample: "“根据我对市场同等岗位的调研以及我过往的攻坚经验，我的期望薪资范围在 25K-30K 之间。不过比起单一数字，我更看重贵公司的平台发展与整体薪酬激励包，非常愿意在正式 Offer 阶段结合具体职责来确认。”",
      badExample: "“少于 35K 我绝对不去！” 或者 “随便给就行，按公司规定来。”（要么太死板要么缺乏自信）",
      pitfalls: [
        "切忌在面试早期逼问 HR 定薪上限",
        "给出数字后要补充“可结合综合福利与期权灵活沟通”"
      ]
    }
  ];

  // Interview Etiquette Data
  const etiquetteList: EtiquetteItem[] = [
    {
      id: "e-prep",
      title: "面试前准备",
      icon: "fact_check",
      iconBg: "bg-blue-500/20 text-blue-300",
      bullets: [
        "了解公司与岗位",
        "准备常见问题",
        "检查设备与环境",
        "准备问题反问"
      ],
      details: [
        "仔细阅读 JD 提取 3 个核心关键词，准备相对应的项目战例",
        "打印 2-3 份纸质简历，提前 10-15 分钟到达线下面试地点",
        "线上视频面试提前 15 分钟测试摄像头、麦克风与网速",
        "准备 2-3 个关于业务痛点与团队发展的高质量反问问题"
      ]
    },
    {
      id: "e-video",
      title: "视频面试礼仪",
      icon: "videocam",
      iconBg: "bg-purple-500/20 text-purple-300",
      bullets: [
        "光线充足，背景简洁",
        "摄像头平视",
        "网络稳定，设备调试",
        "着装得体"
      ],
      details: [
        "镜头高度保持与眼睛平视，避免俯视或仰视产生压迫感",
        "选择光线充足的室内，背景开启适当虚化，保持桌面整洁",
        "佩戴有线耳机以消除回音，避免因麦克风杂音影响沟通体验",
        "即使居家面试也要穿着正规商务休闲上衣，展现专业态度"
      ]
    },
    {
      id: "e-comm",
      title: "沟通与表达",
      icon: "chat_bubble",
      iconBg: "bg-indigo-500/20 text-indigo-300",
      bullets: [
        "表达清晰，逻辑先行",
        "多用结构化表达",
        "控制语速与音量",
        "适当停顿与倾听"
      ],
      details: [
        "采用 PREP 或 STAR 框架，先说结论再展开细节",
        "控制语速在 220-260 字/分钟，声音洪亮自信",
        "面试官提问时切勿打断，听完后再作答（可停顿2秒思考）",
        "使用“第一、第二、总结来说”等逻辑连接词"
      ]
    },
    {
      id: "e-body",
      title: "肢体语言",
      icon: "accessibility_new",
      iconBg: "bg-emerald-500/20 text-emerald-300",
      bullets: [
        "保持微笑与眼神交流",
        "坐姿端正，不要晃动",
        "手势自如，不要过多",
        "展现自信与从容"
      ],
      details: [
        "保持 50%-70% 的时间目光与面试官/摄像头对视",
        "坐姿保持上半身挺拔，双手自然平放桌面，切忌抖腿或转笔",
        "微笑能快速拉近人际距离，展现亲和力与抗压心态",
        "配合自然的握拳或手势强调核心观点，切忌夸张比划"
      ]
    },
    {
      id: "e-end",
      title: "面试结束礼仪",
      icon: "mark_email_read",
      iconBg: "bg-rose-500/20 text-rose-300",
      bullets: [
        "感谢面试官",
        "确认后续流程",
        "表达合作意愿",
        "发送感谢信（可选）"
      ],
      details: [
        "面试结束时主动致谢：“非常感谢您今天的交流，让我受益匪浅。”",
        "礼貌询问：“请问后续的面试结果大概会在什么时候通知呢？”",
        "线下面试离开时将椅子推回原位，退出门外轻轻关门",
        "24 小时内可给 HR 发送一封简短真诚的 Thank-you Email"
      ]
    }
  ];

  // Articles Data
  const articlesList: ArticleItem[] = [
    {
      id: "art-star",
      title: "如何用 STAR 法则讲好项目经历",
      tag: "STAR 法则",
      reads: "23.4k",
      saves: "456",
      desc: "掌握 STAR 结构，让你的项目经验更有说服力与逻辑干货。",
      badgeBg: "bg-purple-500/10 text-purple-300 border-purple-500/20",
      content: `STAR 法则是行为面试（Behavioral Interview）的核心利器：
- **S (Situation)**: 描述项目的背景与痛点
- **T (Task)**: 明确你的具体职责与挑战目标
- **A (Action)**: 详细说明你采取的独到技术/业务动作 (占比 60%)
- **R (Result)**: 用硬核量化数据展示最终收益与成果`
    },
    {
      id: "art-3min",
      title: "3 分钟自我介绍的黄金结构",
      tag: "自我介绍",
      reads: "18.7k",
      saves: "382",
      desc: "面试官记住你的关键，只需要 3 分钟的结构化黄金展示。",
      badgeBg: "bg-blue-500/10 text-blue-300 border-blue-500/20",
      content: `3分钟自我介绍黄金分配：
1. 0:00 - 0:15 【破冰与定基调】：姓名、核心定位、工作年限。
2. 0:15 - 1:15 【核心战绩】：用1-2个最硬核的项目数据支撑能力。
3. 1:15 - 2:15 【能力匹配】：结合 JD 痛点说明你能为公司解决什么问题。
4. 2:15 - 3:00 【诚意结语】：说明为什么渴望加入该公司。`
    },
    {
      id: "art-soft-skills",
      title: "面试官最看重的 5 种软技能",
      tag: "软技能",
      reads: "15.6k",
      saves: "291",
      desc: "技术能力之外，这些软技能决定了你能走多远与 Offer 职级。",
      badgeBg: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20",
      content: `除了专业硬核能力，高阶面试官最关注的 5 大软技能：
1. **主动性 (Ownership)**：不推卸责任，主动发现问题并解决。
2. **沟通与同理心**：能用通俗语言向非技术人员解释复杂概念。
3. **抗压与复盘力**：面对故障或失败能快速定位并总结防范机制。
4. **业务敏锐度**：不仅关心技术，更关心理解技术如何赋能业务商业结果。
5. **学习与迭代力**：面对新技术能快速自学并落地落地。`
    }
  ];

  // Filtering Logic based on Search Query
  const filteredQuestions = useMemo(() => {
    if (!searchQuery.trim()) return popularQuestions;
    const q = searchQuery.toLowerCase().trim();
    return popularQuestions.filter(item => 
      item.title.toLowerCase().includes(q) || item.desc.toLowerCase().includes(q)
    );
  }, [searchQuery]);

  const handleTagClick = (tag: string) => {
    setSearchQuery(tag);
  };

  const handleOpenQuestionModal = (item: QuestionItem) => {
    setModalData({
      type: "question",
      title: `${item.title} - 高分回答指南`,
      content: (
        <div className="space-y-5 text-left text-sm">
          <div className="p-3.5 rounded-xl bg-purple-500/10 border border-purple-500/20">
            <h5 className="font-extrabold text-purple-300 mb-1 flex items-center gap-1.5">
              <span className="material-symbols-outlined text-base">auto_awesome</span>
              回答黄金公式
            </h5>
            <p className="text-white/80 font-medium leading-relaxed">{item.formula}</p>
          </div>

          <div className="space-y-3">
            <h5 className="font-extrabold text-emerald-400 flex items-center gap-1.5">
              <span className="material-symbols-outlined text-base">check_circle</span>
              优秀回答示范
            </h5>
            <div className="p-3.5 rounded-xl bg-emerald-500/5 border border-emerald-500/20 text-white/80 leading-relaxed font-medium">
              {item.goodExample}
            </div>
          </div>

          <div className="space-y-3">
            <h5 className="font-extrabold text-[#FF7A95] flex items-center gap-1.5">
              <span className="material-symbols-outlined text-base">cancel</span>
              减分错误回答
            </h5>
            <div className="p-3.5 rounded-xl bg-[#FF7A95]/5 border border-[#FF7A95]/20 text-white/70 leading-relaxed font-medium">
              {item.badExample}
            </div>
          </div>

          <div className="space-y-2 pt-2 border-t border-white/5">
            <h5 className="font-extrabold text-white/90 flex items-center gap-1.5">
              <span className="material-symbols-outlined text-base text-amber-400">warning</span>
              核心避坑指南
            </h5>
            <ul className="list-disc list-inside space-y-1 text-white/60 text-xs font-semibold">
              {item.pitfalls.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          </div>
        </div>
      )
    });
  };

  const handleOpenEtiquetteModal = (item: EtiquetteItem) => {
    setModalData({
      type: "etiquette",
      title: `${item.title} - 行为规范`,
      content: (
        <div className="space-y-4 text-left text-sm">
          <div className="p-3.5 rounded-xl bg-blue-500/10 border border-blue-500/20">
            <h5 className="font-extrabold text-blue-300 mb-2 flex items-center gap-1.5">
              <span className="material-symbols-outlined text-base">task_alt</span>
              关键检查要点
            </h5>
            <div className="grid grid-cols-2 gap-2">
              {item.bullets.map((b, i) => (
                <div key={i} className="flex items-center gap-1.5 text-xs text-white/80 font-bold">
                  <span className="text-emerald-400">✓</span> {b}
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-2.5 pt-2">
            <h5 className="font-extrabold text-white/90">详细执行建议</h5>
            <div className="space-y-2">
              {item.details.map((d, i) => (
                <div key={i} className="p-3 rounded-xl bg-white/[0.03] border border-white/5 text-xs text-white/80 font-medium leading-relaxed flex items-start gap-2">
                  <span className="w-4 h-4 rounded-full bg-primary/20 text-primary text-[10px] flex items-center justify-center shrink-0 mt-0.5 font-black">{i + 1}</span>
                  {d}
                </div>
              ))}
            </div>
          </div>
        </div>
      )
    });
  };

  const handleOpenCaseModal = () => {
    setModalData({
      type: "case",
      title: "字节跳动三面复盘全纪录分析",
      content: (
        <div className="space-y-5 text-left text-sm">
          <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/10 space-y-3">
            <div className="flex items-center justify-between">
              <span className="px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-black border border-primary/20">
                后端开发工程师 · P6+
              </span>
              <span className="text-xs text-white/40 font-mono">面试时长：85 分钟</span>
            </div>

            <p className="text-xs text-white/70 font-semibold leading-relaxed">
              面试流程：技术一面（基建与算法）➔ 技术二面（系统设计与高并发）➔ HR 面（职业规划与综合素质）。
            </p>

            <div className="grid grid-cols-3 gap-2 text-center pt-2">
              <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                <span className="text-xs text-emerald-400 font-bold block">综合表现</span>
                <span className="text-lg font-black text-white font-mono">78<span className="text-xs text-white/40">/100</span></span>
              </div>
              <div className="p-2.5 rounded-xl bg-purple-500/10 border border-purple-500/20">
                <span className="text-xs text-purple-300 font-bold block">技术深度</span>
                <span className="text-lg font-black text-white font-mono">82<span className="text-xs text-white/40">/100</span></span>
              </div>
              <div className="p-2.5 rounded-xl bg-blue-500/10 border border-blue-500/20">
                <span className="text-xs text-blue-300 font-bold block">表达沟通</span>
                <span className="text-lg font-black text-white font-mono">74<span className="text-xs text-white/40">/100</span></span>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <h5 className="font-extrabold text-emerald-400">主要亮战经验</h5>
            <p className="text-xs text-white/80 leading-relaxed p-3 rounded-xl bg-white/[0.03] border border-white/5 font-medium">
              架构设计思路清晰，对 MySQL 索引优化与 Redis 缓存击穿防护机制掌握扎实。面对场景延伸提问能够快速根据 STAR 框架组织回答。
            </p>
          </div>

          <div className="space-y-2">
            <h5 className="font-extrabold text-amber-400">核心提升建议</h5>
            <p className="text-xs text-white/80 leading-relaxed p-3 rounded-xl bg-white/[0.03] border border-white/5 font-medium">
              在二面探讨高并发削峰填谷方案时稍显拘谨，建议强化业务场景价值与数据量化的总结，突出个人在攻坚阶段的控制力。
            </p>
          </div>
        </div>
      )
    });
  };

  return (
    <div className="min-h-screen bg-[#0b1326] text-on-background font-body-md flex flex-col relative overflow-hidden select-none pt-20">
      
      {/* Background Visual Grids & Glows */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff03_1px,transparent_1px),linear-gradient(to_bottom,#ffffff03_1px,transparent_1px)] bg-[size:40px_40px] pointer-events-none z-0" />
      <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-primary/10 rounded-full blur-[160px] pointer-events-none z-0" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-secondary/5 rounded-full blur-[160px] pointer-events-none z-0" />

      {/* GLOBAL TOP NAVIGATION NAVBAR */}
      <nav className="fixed top-0 w-full z-40 bg-surface/80 backdrop-blur-xl border-b border-white/10 h-20">
        <div className="px-gutter h-full max-w-container-max mx-auto flex items-center justify-between relative">
          
          {/* Logo */}
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
            面试VAR
          </div>

          {/* Nav Items */}
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
            <a onClick={() => router.push("/guide")} className="text-primary transition-colors text-[16px] md:text-[17px] font-extrabold cursor-pointer relative after:content-[''] after:absolute after:bottom-[-26px] after:left-0 after:right-0 after:h-[2px] after:bg-primary">
              面试指南
            </a>
            <a onClick={() => router.push("/feedback")} className="text-on-surface-variant hover:text-on-surface transition-colors text-[16px] md:text-[17px] font-extrabold cursor-pointer">
              体验反馈中心
            </a>
          </div>

          {/* Right Action buttons */}
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push("/home")}
              className="px-4.5 py-2 bg-white/5 border border-white/10 rounded-full text-sm font-bold text-on-surface hover:bg-white/10 transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <span className="material-symbols-outlined text-base">history</span>历史记录
            </button>
            {auth.isLoggedIn ? (
              <UserMenu />
            ) : (
              <button
                onClick={() => auth.setShowLogin(true)}
                className="px-6 py-2 bg-primary text-on-primary font-bold rounded-full scale-95 hover:scale-100 transition-all cursor-pointer"
              >
                登录 / 注册
              </button>
            )}
          </div>
        </div>
      </nav>

      {/* MAIN TWO-COLUMN WORKSPACE */}
      <div className="flex-1 max-w-container-max mx-auto w-full px-gutter py-8 flex flex-col lg:flex-row gap-8 relative z-10 text-left">
        
        {/* ========================================================
            LEFT SIDEBAR NAVIGATION
           ======================================================== */}
        <aside className="w-full lg:w-[280px] shrink-0 space-y-6">
          
          {/* Header Card */}
          <div className="glass-panel p-5 rounded-2xl border-white/10 space-y-2 bg-white/[0.02]">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-purple-500/20 border border-purple-500/30 flex items-center justify-center text-purple-300">
                <span className="material-symbols-outlined text-xl">menu_book</span>
              </div>
              <div>
                <h3 className="text-lg font-black text-white">面试指南</h3>
                <p className="text-xs text-on-surface-variant/50 font-bold">系统提升你的面试表现</p>
              </div>
            </div>
          </div>

          {/* Sidebar Menu Accordion */}
          <div className="glass-panel p-4 rounded-2xl border-white/10 space-y-5 bg-white/[0.01]">
            
            {/* Category 1: 通用问题回答 */}
            <div className="space-y-2">
              <h4 className="text-xs font-black text-on-surface-variant/40 uppercase tracking-widest px-2">通用问题回答</h4>
              <div className="space-y-1">
                {popularQuestions.map(q => (
                  <button
                    key={q.id}
                    onClick={() => {
                      setActiveSidebarItem(q.title);
                      handleOpenQuestionModal(q);
                    }}
                    className={`w-full px-3 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-between cursor-pointer ${
                      activeSidebarItem === q.title
                        ? "bg-primary/15 text-primary border border-primary/20 font-black"
                        : "text-white/70 hover:text-white hover:bg-white/5"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary/60" />
                      {q.title}
                    </span>
                    <span className="material-symbols-outlined text-xs opacity-40">chevron_right</span>
                  </button>
                ))}
                <button
                  onClick={() => setSearchQuery("")}
                  className="w-full px-3 py-2 text-xs font-black text-primary hover:text-white transition-colors cursor-pointer text-left flex items-center gap-1 pt-1"
                >
                  查看全部问题 <span className="material-symbols-outlined text-xs">arrow_forward</span>
                </button>
              </div>
            </div>

            {/* Category 2: 回答技巧提升 */}
            <div className="space-y-2 pt-2 border-t border-white/5">
              <h4 className="text-xs font-black text-on-surface-variant/40 uppercase tracking-widest px-2">回答技巧提升</h4>
              <div className="space-y-1">
                {["STAR法则", "项目经验表达", "技术问题回答", "逻辑表达结构", "数据化表达"].map((item, idx) => (
                  <button
                    key={idx}
                    onClick={() => {
                      setActiveSidebarItem(item);
                      if (item === "STAR法则") handleOpenQuestionModal(popularQuestions[0]);
                    }}
                    className={`w-full px-3 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-between cursor-pointer ${
                      activeSidebarItem === item
                        ? "bg-primary/15 text-primary border border-primary/20 font-black"
                        : "text-white/70 hover:text-white hover:bg-white/5"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-tertiary/60" />
                      {item}
                    </span>
                    <span className="material-symbols-outlined text-xs opacity-40">chevron_right</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Category 3: 面试礼仪举止 */}
            <div className="space-y-2 pt-2 border-t border-white/5">
              <h4 className="text-xs font-black text-on-surface-variant/40 uppercase tracking-widest px-2">面试礼仪举止</h4>
              <div className="space-y-1">
                {etiquetteList.map(e => (
                  <button
                    key={e.id}
                    onClick={() => {
                      setActiveSidebarItem(e.title);
                      handleOpenEtiquetteModal(e);
                    }}
                    className={`w-full px-3 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-between cursor-pointer ${
                      activeSidebarItem === e.title
                        ? "bg-primary/15 text-primary border border-primary/20 font-black"
                        : "text-white/70 hover:text-white hover:bg-white/5"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-secondary/60" />
                      {e.title}
                    </span>
                    <span className="material-symbols-outlined text-xs opacity-40">chevron_right</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Left CTA Card */}
          <div className="glass-panel p-5 rounded-2xl border-white/10 text-left space-y-3 bg-gradient-to-b from-purple-500/10 to-transparent">
            <div className="w-9 h-9 rounded-xl bg-purple-500/20 border border-purple-500/30 flex items-center justify-center text-purple-300">
              <span className="material-symbols-outlined text-lg">psychology</span>
            </div>
            <div>
              <h4 className="text-sm font-extrabold text-white">不会回答这些问题？</h4>
              <p className="text-xs text-white/50 font-medium mt-0.5">试试 AI 模拟面试，沉浸实操提升</p>
            </div>
            <button
              onClick={() => router.push("/training")}
              className="w-full py-2.5 bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-600 hover:to-indigo-700 text-white font-extrabold text-xs rounded-xl transition-all shadow-lg cursor-pointer"
            >
              立即体验
            </button>
          </div>
        </aside>

        {/* ========================================================
            RIGHT MAIN CONTENT AREA
           ======================================================== */}
        <main className="flex-1 space-y-8 min-w-0">
          
          {/* HERO HEADER & SEARCH BANNER */}
          <div className="glass-panel p-6 sm:p-8 rounded-3xl border-white/10 relative overflow-hidden bg-gradient-to-r from-[#131b2e] to-[#1c2438] flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="space-y-4 max-w-xl text-left z-10">
              <div>
                <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight flex items-center gap-2">
                  面试指南
                </h1>
                <p className="text-sm text-on-surface-variant/70 font-semibold mt-1.5 leading-relaxed">
                  从回答技巧到面试礼仪，掌握面试中的每一个关键细节
                </p>
              </div>

              {/* Search Box */}
              <div className="relative">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="搜索面试问题，例如：如何介绍自己的项目？"
                  className="w-full pl-11 pr-4 py-3 bg-slate-900/90 border border-white/15 rounded-2xl text-xs sm:text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-primary/60 transition-colors shadow-inner"
                />
                <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-white/40 text-lg">
                  search
                </span>
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-white/40 hover:text-white text-xs"
                  >
                    ✕
                  </button>
                )}
              </div>

              {/* Popular Tags */}
              <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
                <span className="text-white/40 font-bold">热门搜索：</span>
                {["自我介绍", "离职原因", "职业规划", "期望薪资", "项目经验", "优缺点"].map((tag, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleTagClick(tag)}
                    className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-white/70 hover:text-white border border-white/5 transition-colors cursor-pointer font-medium"
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </div>

            {/* Right Graphic Preview Card */}
            <div className="relative shrink-0 w-full sm:w-64 h-40 rounded-2xl bg-gradient-to-br from-purple-600/20 to-indigo-900/40 border border-white/15 p-4 flex flex-col justify-between overflow-hidden shadow-2xl group cursor-pointer"
                 onClick={() => router.push("/training")}>
              <div className="absolute inset-0 bg-cover bg-center opacity-30" style={{ backgroundImage: "url('/helper.jpg')" }} />
              <div className="relative z-10 flex items-center justify-between">
                <span className="px-2.5 py-0.5 rounded-full bg-primary/20 text-primary text-[10px] font-black border border-primary/30">
                  AI 试练预览
                </span>
                <span className="material-symbols-outlined text-xs text-white/40">open_in_new</span>
              </div>
              <div className="relative z-10 text-center space-y-1 my-auto">
                <div className="w-10 h-10 rounded-full bg-primary text-on-primary mx-auto flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
                  <span className="material-symbols-outlined text-xl ml-0.5">play_arrow</span>
                </div>
                <p className="text-xs font-black text-white">点击开启 AI 模拟训练</p>
              </div>
            </div>
          </div>

          {/* SECTION 1: 热门问题回答 (POPULAR QUESTIONS GRID) */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-black text-white flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-purple-400" />
                热门问题回答
              </h3>
              <button onClick={() => setSearchQuery("")} className="text-xs text-white/40 hover:text-white transition-colors cursor-pointer flex items-center gap-0.5">
                查看全部 <span className="material-symbols-outlined text-xs">chevron_right</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
              {filteredQuestions.map((item) => (
                <div
                  key={item.id}
                  className="glass-panel p-4.5 rounded-2xl border-white/10 flex flex-col justify-between text-left hover:border-primary/30 transition-all duration-300 group space-y-4 bg-white/[0.02]"
                >
                  <div className="space-y-3">
                    <div className={`w-10 h-10 rounded-xl border flex items-center justify-center ${item.iconBg}`}>
                      <span className="material-symbols-outlined text-xl">{item.icon}</span>
                    </div>
                    <div>
                      <h4 className="text-base font-black text-white group-hover:text-primary transition-colors">{item.title}</h4>
                      <div className="flex items-center gap-1 mt-1 text-amber-400">
                        <span className="text-[10px] text-white/40 font-bold mr-1">出现频率</span>
                        {"★".repeat(item.frequency)}
                      </div>
                    </div>
                    <p className="text-xs text-white/60 font-medium leading-relaxed line-clamp-3">
                      {item.desc}
                    </p>
                  </div>

                  <button
                    onClick={() => handleOpenQuestionModal(item)}
                    className="w-full py-2 bg-white/5 hover:bg-primary/20 text-white/80 hover:text-primary font-bold text-xs rounded-xl border border-white/10 hover:border-primary/30 transition-all cursor-pointer"
                  >
                    查看技巧
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* SECTION 2: 面试礼仪与行为指南 (ETIQUETTE GRID) */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-black text-white flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-blue-400" />
                面试礼仪与行为指南
              </h3>
              <button onClick={() => setSearchQuery("")} className="text-xs text-white/40 hover:text-white transition-colors cursor-pointer flex items-center gap-0.5">
                查看全部 <span className="material-symbols-outlined text-xs">chevron_right</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
              {etiquetteList.map((item) => (
                <div
                  key={item.id}
                  className="glass-panel p-4.5 rounded-2xl border-white/10 flex flex-col justify-between text-left hover:border-blue-400/30 transition-all duration-300 group space-y-4 bg-white/[0.02]"
                >
                  <div className="space-y-3">
                    <div className={`w-10 h-10 rounded-xl ${item.iconBg} border border-white/10 flex items-center justify-center`}>
                      <span className="material-symbols-outlined text-xl">{item.icon}</span>
                    </div>
                    <h4 className="text-base font-black text-white group-hover:text-blue-300 transition-colors">{item.title}</h4>
                    
                    <div className="space-y-1.5 pt-1">
                      {item.bullets.map((bullet, idx) => (
                        <div key={idx} className="flex items-center gap-1.5 text-xs text-white/70 font-medium">
                          <span className="text-emerald-400 font-bold">✓</span>
                          <span className="truncate">{bullet}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <button
                    onClick={() => handleOpenEtiquetteModal(item)}
                    className="w-full py-2 bg-white/5 hover:bg-blue-500/20 text-white/80 hover:text-blue-300 font-bold text-xs rounded-xl border border-white/10 hover:border-blue-400/30 transition-all cursor-pointer"
                  >
                    查看详情
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* SECTION 3: 精选文章 & 实战案例解析 (DOUBLE COLUMN) */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
            
            {/* Left Column: 精选文章 */}
            <div className="lg:col-span-6 glass-panel p-5.5 rounded-3xl border-white/10 space-y-4 text-left flex flex-col justify-between">
              <div className="flex items-center justify-between pb-3 border-b border-white/5">
                <h3 className="text-base font-black text-white flex items-center gap-2">
                  <span className="material-symbols-outlined text-lg text-primary">auto_stories</span>
                  精选文章
                </h3>
                <span className="text-xs text-white/40 cursor-pointer hover:text-white">查看全部 ›</span>
              </div>

              <div className="space-y-3 flex-1">
                {articlesList.map((art) => (
                  <div
                    key={art.id}
                    onClick={() => setModalData({
                      type: "article",
                      title: art.title,
                      content: (
                        <div className="space-y-3 text-left text-xs text-white/80 whitespace-pre-line leading-relaxed font-medium">
                          {art.content}
                        </div>
                      )
                    })}
                    className="p-3.5 rounded-2xl bg-white/[0.02] border border-white/5 hover:border-primary/30 transition-all cursor-pointer flex items-center justify-between gap-4 group"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-black border ${art.badgeBg}`}>
                          {art.tag}
                        </span>
                        <h4 className="text-sm font-black text-white group-hover:text-primary transition-colors truncate">
                          {art.title}
                        </h4>
                      </div>
                      <p className="text-xs text-white/50 truncate font-medium">{art.desc}</p>
                      <div className="text-[11px] text-white/30 font-mono pt-1">
                        {art.reads} 阅读 · {art.saves} 收藏
                      </div>
                    </div>
                    <span className="material-symbols-outlined text-base text-white/20 group-hover:text-primary transition-colors shrink-0">
                      arrow_forward_ios
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Right Column: 实战案例解析 (WITH RADAR CHART) */}
            <div className="lg:col-span-6 glass-panel p-5.5 rounded-3xl border-white/10 space-y-4 text-left flex flex-col justify-between">
              <div className="flex items-center justify-between pb-3 border-b border-white/5">
                <h3 className="text-base font-black text-white flex items-center gap-2">
                  <span className="material-symbols-outlined text-lg text-tertiary">analytics</span>
                  实战案例解析
                </h3>
                <span className="text-xs text-white/40 cursor-pointer hover:text-white">查看全部 ›</span>
              </div>

              <div className="space-y-4 flex-1">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="px-2.5 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-black border border-primary/20">
                      后端开发工程师
                    </span>
                    <h4 className="text-base font-black text-white mt-1.5">字节跳动三面复盘分析</h4>
                  </div>
                  <div className="text-right text-xs text-white/40 font-mono">
                    时长：85 分钟
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
                  {/* Score Badges */}
                  <div className="space-y-2">
                    <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/5 flex items-center justify-between">
                      <span className="text-xs text-white/60 font-bold">综合表现</span>
                      <span className="text-sm font-black text-emerald-400 font-mono">78<span className="text-xs text-white/30">/100</span> (良好)</span>
                    </div>
                    <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/5 flex items-center justify-between">
                      <span className="text-xs text-white/60 font-bold">技术深度</span>
                      <span className="text-sm font-black text-purple-300 font-mono">82<span className="text-xs text-white/30">/100</span> (优秀)</span>
                    </div>
                    <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/5 flex items-center justify-between">
                      <span className="text-xs text-white/60 font-bold">表达沟通</span>
                      <span className="text-sm font-black text-blue-300 font-mono">74<span className="text-xs text-white/30">/100</span> (自如)</span>
                    </div>
                  </div>

                  {/* 五维雷达图 SVG */}
                  <div className="relative w-44 h-44 mx-auto flex items-center justify-center">
                    <svg className="w-full h-full" viewBox="0 0 200 200">
                      {/* Grid pentagons */}
                      <polygon points="100,20 176,75 147,165 53,165 24,75" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
                      <polygon points="100,45 151,82 131,143 69,143 49,82" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
                      
                      {/* Axis Lines */}
                      <line x1="100" y1="100" x2="100" y2="20" stroke="rgba(255,255,255,0.1)" />
                      <line x1="100" y1="100" x2="176" y2="75" stroke="rgba(255,255,255,0.1)" />
                      <line x1="100" y1="100" x2="147" y2="165" stroke="rgba(255,255,255,0.1)" />
                      <line x1="100" y1="100" x2="53" y2="165" stroke="rgba(255,255,255,0.1)" />
                      <line x1="100" y1="100" x2="24" y2="75" stroke="rgba(255,255,255,0.1)" />

                      {/* Filled Polygon (Scores: 82, 80, 74, 76, 85) */}
                      <polygon
                        points="100,34 161,80 135,148 64,149 35,79"
                        fill="rgba(192, 193, 255, 0.25)"
                        stroke="#c0c1ff"
                        strokeWidth="2"
                      />

                      {/* Labels */}
                      <text x="100" y="14" fill="#dae2fd" fontSize="9" textAnchor="middle" fontWeight="bold">技术深度</text>
                      <text x="182" y="78" fill="#dae2fd" fontSize="9" textAnchor="start" fontWeight="bold">逻辑思维</text>
                      <text x="152" y="178" fill="#dae2fd" fontSize="9" textAnchor="middle" fontWeight="bold">表达沟通</text>
                      <text x="48" y="178" fill="#dae2fd" fontSize="9" textAnchor="middle" fontWeight="bold">问题解决</text>
                      <text x="18" y="78" fill="#dae2fd" fontSize="9" textAnchor="end" fontWeight="bold">学习潜力</text>
                    </svg>
                  </div>
                </div>

                <div className="text-xs space-y-1 text-white/70 pt-1">
                  <p><span className="font-extrabold text-white">主要亮点：</span>架构设计思路清晰，代码基础扎实</p>
                  <p><span className="font-extrabold text-white">提升建议：</span>加强业务理解，优化项目表达结构</p>
                </div>
              </div>

              <button
                onClick={handleOpenCaseModal}
                className="w-full py-2.5 bg-white/5 hover:bg-white/10 text-white font-extrabold text-xs rounded-xl border border-white/10 transition-all cursor-pointer"
              >
                查看完整复盘
              </button>
            </div>

          </div>

          {/* SECTION 4: 底部悬浮引流 BANNER */}
          <div className="glass-panel p-6 sm:p-8 rounded-3xl border-white/15 bg-gradient-to-r from-purple-900/30 via-indigo-900/40 to-slate-900 flex flex-col sm:flex-row items-center justify-between gap-6 text-left shadow-2xl">
            <div className="space-y-1.5">
              <h3 className="text-xl sm:text-2xl font-black text-white flex items-center gap-2">
                <span className="material-symbols-outlined text-2xl text-purple-300">workspace_premium</span>
                练习才能提升，AI 助你进步
              </h3>
              <p className="text-xs sm:text-sm text-white/60 font-semibold">
                通过 AI 模拟面试，针对性提升你的回答能力和面试表现
              </p>
            </div>

            <button
              onClick={() => router.push("/training")}
              className="px-8 py-3.5 bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-600 hover:to-indigo-700 text-white font-black text-sm rounded-2xl transition-all shadow-[0_0_25px_rgba(168,85,247,0.4)] hover:scale-105 active:scale-95 cursor-pointer shrink-0"
            >
              开始模拟面试 →
            </button>
          </div>

        </main>
      </div>

      {/* Footer */}
      <footer className="bg-surface-container-lowest border-t border-white/5 w-full block mt-8 relative z-10 shrink-0">
        <div className="px-gutter py-8 max-w-container-max mx-auto flex flex-col md:flex-row justify-between items-center gap-4 text-left">
          <span className="text-[10px] text-on-surface-variant/30 font-label-mono font-bold tracking-widest block text-left">
            © 2026 面试VAR. All rights reserved.
          </span>
          <div className="flex gap-8 text-xs text-on-surface-variant font-label-mono font-bold tracking-widest">
            <span onClick={() => openLegalTerms()} className="hover:text-primary transition-colors cursor-pointer select-none">
              服务条款
            </span>
            <span onClick={() => openLegalPrivacy()} className="hover:text-primary transition-colors cursor-pointer select-none">
              隐私政策
            </span>
            <span onClick={() => openLegalContact()} className="hover:text-primary transition-colors cursor-pointer select-none">
              联系方式
            </span>
          </div>
        </div>
      </footer>

      {/* MODAL DIALOG FOR DETAILS */}
      {modalData && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-[#0e1626] border border-white/15 rounded-3xl p-6 max-w-xl w-full space-y-5 shadow-2xl text-left relative max-h-[85vh] overflow-y-auto custom-scrollbar">
            
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <h4 className="text-lg font-black text-white">{modalData.title}</h4>
              <button
                onClick={() => setModalData(null)}
                className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 text-white/60 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              {modalData.content}
            </div>

            <div className="pt-3 border-t border-white/10 flex items-center justify-between">
              <span className="text-xs text-white/40 font-medium">想实操练习此考点？</span>
              <button
                onClick={() => {
                  setModalData(null);
                  router.push("/training");
                }}
                className="px-5 py-2 bg-primary text-on-primary font-black text-xs rounded-xl hover:scale-105 transition-all shadow-md cursor-pointer"
              >
                在 AI 模拟面试中练习
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
