"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth, UserMenu } from "@/components/AuthProvider";
import { API_BASE } from "@/lib/api";

function ResumeAnalysisPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const auth = useAuth();

  // =========================================================================
  // STATE MANAGEMENT
  // =========================================================================
  const [profile, setProfile] = useState({
    name: "张三",
    status: "在职",
    title: "后端开发工程师 · P6",
    years: "5 年",
    company: "字节跳动",
    role: "后端开发工程师",
    salary: "35K * 16",
    targetCompany: "阿里巴巴",
    targetRole: "高级后端开发工程师",
    targetGrade: "P7",
    targetSalary: "45K * 16",
    school: "清华大学",
    version: "v3",
    uploadTime: "2026-06-01 14:30"
  });

  const [activeTab, setActiveTab] = useState<
    "preview" | "risk" | "match" | "optimization" | "keywords" | "ats"
  >("preview");

  const [viewMode, setViewMode] = useState<"original" | "optimized">("original");

  // Modals Visibility
  const [showEditProfileModal, setShowEditProfileModal] = useState(false);
  const [showNotification, setShowNotification] = useState<string | null>(null);
  const [showScoreMetricsModal, setShowScoreMetricsModal] = useState(false);
  const [showStructureModal, setShowStructureModal] = useState(false);
  const [selectedStructureSection, setSelectedStructureSection] = useState<number>(0);

  const [analysisResult, setAnalysisResult] = useState<any>(null);

  // Hydration gate: keep full-screen spinner overlay up until the report
  // data is actually available. Without this, the page first renders with
  // hardcoded fallback values (score=84, ats=92, ...) — the "initial page"
  // flash — until useEffect catches up.
  const [isHydrating, setIsHydrating] = useState(true);

  // Download button state machine
  const [downloadState, setDownloadState] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [expandedAts, setExpandedAts] = useState<Record<number, boolean>>({});

  // Prefill metadata from localStorage if available
  useEffect(() => {
    if (typeof window === "undefined") return;
    const storedResult = localStorage.getItem("interviewVar_resume_analysis_result");
    if (storedResult) {
      try {
        const parsed = JSON.parse(storedResult);
        setAnalysisResult(parsed);
        if (parsed.profile) {
          setProfile((prev) => ({ ...prev, ...parsed.profile }));
        }
        // Got data synchronously — clear the overlay now.
        setIsHydrating(false);
        return;
      } catch (e) {
        console.error("Failed to parse resume analysis result:", e);
      }
    } else {
      const storedCompany = localStorage.getItem("interviewVar_session_company");
      const storedRole = localStorage.getItem("interviewVar_session_role");
      const storedGrade = localStorage.getItem("interviewVar_session_grade");
      const storedSalary = localStorage.getItem("interviewVar_session_salary");
      const storedYears = localStorage.getItem("interviewVar_session_years");
      const storedDate = localStorage.getItem("interviewVar_session_date");

      if (storedCompany || storedRole || storedGrade || storedSalary) {
        setProfile((prev) => ({
          ...prev,
          targetCompany: storedCompany || prev.targetCompany,
          targetRole: storedRole || prev.targetRole,
          targetGrade: storedGrade || prev.targetGrade,
          targetSalary: storedSalary || prev.targetSalary,
          years: storedYears ? `${storedYears}` : prev.years,
          uploadTime: storedDate ? `${storedDate} 14:30` : prev.uploadTime
        }));
      }
    }

    // No cached result. If we're navigating to a shared ?id= link, keep
    // isHydrating=true so the second useEffect can fetch from API; only
    // the second effect should unblock in that case. Otherwise (cold load
    // with no id) unblock now so we don't strand the page on a spinner.
    const hasIdInUrl = new URLSearchParams(window.location.search).get("id");
    if (!hasIdInUrl) setIsHydrating(false);
  }, []);

  // Sync logged in user profile (username, current company, current role) to profile state
  useEffect(() => {
    if (auth.isLoggedIn && auth.user) {
      const validCompany = auth.user.company && !["暂无", "暂无公司", "无", "None", "null", "未填写", "-"].includes(auth.user.company) ? auth.user.company : "-";
      const validRole = auth.user.role && !["暂无", "无", "None", "null", "未填写", "-"].includes(auth.user.role) ? auth.user.role : "-";
      const displayName = auth.user.name && auth.user.name.trim() !== "" && auth.user.name !== "XXX" ? auth.user.name : "候选人";
      setProfile((prev) => ({
        ...prev,
        name: displayName,
        company: validCompany,
        role: validRole,
        title: validRole !== "-" ? validRole : "-",
      }));
    }
  }, [auth.isLoggedIn, auth.user]);

  // If URL has ?id=<analysis_id>, fetch that historical analysis from backend
  // and overwrite localStorage so the page renders the right report.
  useEffect(() => {
    const id = searchParams?.get("id");
    if (!id) return;

    const token = typeof window !== "undefined"
      ? localStorage.getItem("interviewVar_token")
      : null;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/resume/analyses/${id}`, { headers });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.detail || `加载历史报告失败 (${res.status})`);
        }
        const data = await res.json();
        if (cancelled) return;
        localStorage.setItem("interviewVar_resume_analysis_result", JSON.stringify(data));
        localStorage.setItem("interviewVar_analyzed_resume", "true");
        setAnalysisResult(data);
        if (data.profile) {
          setProfile((prev) => ({ ...prev, ...data.profile }));
        }
        setIsHydrating(false);
      } catch (e: any) {
        if (cancelled) return;
        console.error("Failed to load historical resume analysis:", e);
        auth.triggerToast(e?.message || "加载历史报告失败", "error");
        // Failure path: also unblock so the user isn't stuck on the spinner.
        setIsHydrating(false);
      }
    })();

    return () => { cancelled = true; };
  }, [searchParams, auth]);

  const triggerToast = (msg: string) => {
    setShowNotification(msg);
    setTimeout(() => {
      setShowNotification(null);
    }, 2500);
  };

  const handleDownloadPDF = async () => {
    const analysisId = analysisResult?.id;
    if (!analysisId) {
      triggerToast("未找到分析记录，请刷新后重试", "error");
      setDownloadState("error");
      setTimeout(() => setDownloadState("idle"), 2500);
      return;
    }
    if (downloadState === "loading") return;

    setDownloadState("loading");
    try {
      const token = typeof window !== "undefined"
        ? localStorage.getItem("interviewVar_token")
        : null;
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const res = await fetch(
        `${API_BASE}/api/resume/analyses/${analysisId}/download?view=optimized`,
        { headers }
      );

      if (!res.ok) {
        // 鉴权失败：弹登录引导（用 .detail 文案但不抛 error，避免通用 catch 噪音）
        if (res.status === 401 || res.status === 403) {
          setDownloadState("error");
          triggerToast("登录已失效，请重新登录后再下载", "error");
          // 同时唤起登录弹窗（如果有 AuthProvider 暴露的方法）
          try {
            auth.setShowLogin?.(true);
          } catch {
            /* AuthProvider 不可用时不阻塞 */
          }
          setTimeout(() => setDownloadState("idle"), 2500);
          return;
        }
        let errMsg = `下载失败 (${res.status})`;
        try {
          const errBody = await res.json();
          if (errBody?.detail) errMsg = errBody.detail;
        } catch {
          /* non-JSON error */
        }
        throw new Error(errMsg);
      }

      // 解析响应头里的 UTF-8 文件名 (RFC 5987)
      const dispo = res.headers.get("Content-Disposition") || "";
      let filename = "";
      const utf8Match = dispo.match(/filename\*=UTF-8''([^;]+)/i);
      if (utf8Match) {
        try {
          filename = decodeURIComponent(utf8Match[1]);
        } catch {
          /* ignore */
        }
      }
      if (!filename) {
        const asciiMatch = dispo.match(/filename="([^"]+)"/i);
        if (asciiMatch) filename = asciiMatch[1];
      }
      if (!filename) {
        const safeName = (profile.name || "候选人").replace(/[\\/:*?"<>|\r\n\t]+/g, "_");
        const today = new Date().toISOString().slice(0, 10);
        filename = `面试驾到_简历_${safeName}_${today}.docx`;
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // 延迟 revoke，避免某些浏览器下载未完成就 revoke
      setTimeout(() => URL.revokeObjectURL(url), 1000);

      setDownloadState("success");
      triggerToast(`已下载 ${filename}`);
      setTimeout(() => setDownloadState("idle"), 2500);
    } catch (e: any) {
      console.error("Download DOCX failed:", e);
      setDownloadState("error");
      triggerToast(e?.message || "下载失败，请稍后重试", "error");
      setTimeout(() => setDownloadState("idle"), 2500);
    }
  };

  const handleEditProfile = (e: React.FormEvent) => {
    e.preventDefault();
    triggerToast("简历基本信息修改已保存！");
    setShowEditProfileModal(false);
  };

  // Mock Work Experience list with original vs optimized data
  const DEFAULT_WORK_EXPERIENCES = [
    {
      company: "字节跳动",
      role: "后端开发工程师",
      period: "2022.07 - 至今",
      bullets: [
        {
          originalText: "负责推荐系统服务开发",
          optimizedText: "主导推荐系统高并发架构重塑，重构模型召回链路，支撑核心吞吐率提升 25%",
          originalTag: "风险",
          originalTagClass: "text-[#FF7A95] bg-[#FF7A95]/10 border-[#FF7A95]/20",
          originalDesc: "职责描述，缺少量化成果和业务影响",
          optimizedTag: "已优化",
          optimizedTagClass: "text-[#5DECCB] bg-[#5DECCB]/10 border-[#5DECCB]/20"
        },
        {
          originalText: "负责 Redis 缓存架构设计",
          optimizedText: "重构分布式多级缓存方案，引入热点探测与本地缓存双锁机制，抗住大促期间 10W+ QPS 峰值流量",
          originalTag: "风险",
          originalTagClass: "text-[#FF7A95] bg-[#FF7A95]/10 border-[#FF7A95]/20",
          originalDesc: "缺少数据规模，技术深度不足",
          optimizedTag: "已优化",
          optimizedTagClass: "text-[#5DECCB] bg-[#5DECCB]/10 border-[#5DECCB]/20"
        },
        {
          originalText: "支撑日活 3000 万用户的高并发访问",
          optimizedText: "主导设计弹性扩缩容和多集群流控方案，应对 3000 万日活高并发波动，服务可用性达 99.99%",
          originalTag: "亮点",
          originalTagClass: "text-[#5DECCB] bg-[#5DECCB]/10 border-[#5DECCB]/20",
          originalDesc: "量化成果，体现业务影响",
          optimizedTag: "已优化",
          optimizedTagClass: "text-[#5DECCB] bg-[#5DECCB]/10 border-[#5DECCB]/20"
        },
        {
          originalText: "负责 Kafka 消息链路建设",
          optimizedText: "搭建高可靠异步消息总线，处理每日十亿级日志，解决瞬间流量洪峰积压与吞吐瓶颈",
          originalTag: "风险",
          originalTagClass: "text-[#FF7A95] bg-[#FF7A95]/10 border-[#FF7A95]/20",
          originalDesc: "缺少具体优化点和效果",
          optimizedTag: "已优化",
          optimizedTagClass: "text-[#5DECCB] bg-[#5DECCB]/10 border-[#5DECCB]/20"
        },
        {
          originalText: "优化接口性能，整体延迟降低 40%",
          optimizedText: "优化全链路核心 API 耗时，通过异步编排与多段并发预取，接口延迟平均从 120ms 降至 35ms",
          originalTag: "亮点",
          originalTagClass: "text-[#5DECCB] bg-[#5DECCB]/10 border-[#5DECCB]/20",
          originalDesc: "量化成果，体现技术价值",
          optimizedTag: "已优化",
          optimizedTagClass: "text-[#5DECCB] bg-[#5DECCB]/10 border-[#5DECCB]/20"
        }
      ]
    },
    {
      company: "美团",
      role: "后端开发工程师",
      period: "2020.03 - 2022.06",
      bullets: [
        {
          originalText: "参与外卖订单系统的开发与维护",
          optimizedText: "核心参与美团外卖订单核心交易模块建设，参与重写分布式状态机，保证订单处理一致性",
          originalTag: "风险",
          originalTagClass: "text-[#FF7A95] bg-[#FF7A95]/10 border-[#FF7A95]/20",
          originalDesc: "职责描述过于宽泛",
          optimizedTag: "已优化",
          optimizedTagClass: "text-[#5DECCB] bg-[#5DECCB]/10 border-[#5DECCB]/20"
        },
        {
          originalText: "设计并实现分布式事务方案",
          optimizedText: "基于 Seata TCC 模式与 Saga 事务补偿机制重构复杂嵌套支付链路，规避分布式环境账实不符风险",
          originalTag: "亮点",
          originalTagClass: "text-[#5DECCB] bg-[#5DECCB]/10 border-[#5DECCB]/20",
          originalDesc: "体现技术能力",
          optimizedTag: "已优化",
          optimizedTagClass: "text-[#5DECCB] bg-[#5DECCB]/10 border-[#5DECCB]/20"
        },
        {
          originalText: "提升系统稳定性，故障率降低 60%",
          optimizedText: "主导线上链路监控与全链路压测，提前拦截服务隐患 15 起，系统可用性抖动率整体降低 60%",
          originalTag: "亮点",
          originalTagClass: "text-[#5DECCB] bg-[#5DECCB]/10 border-[#5DECCB]/20",
          originalDesc: "量化成果，价值突出",
          optimizedTag: "已优化",
          optimizedTagClass: "text-[#5DECCB] bg-[#5DECCB]/10 border-[#5DECCB]/20"
        }
      ]
    }
  ];

  const workExperiences = analysisResult?.work_experiences || DEFAULT_WORK_EXPERIENCES;

  const DEFAULT_RISKS = [
    { title: "核心业绩缺少量化指标", desc: "在字节跳动开发推荐服务时，未明确写出提升了多少吞吐量或降低了多少毫秒耗时。高水平架构师极度看重数据支撑。", severity: "高风险" },
    { title: "技术名词拼写混乱", desc: "把 Redis 写为 redis，或者 Kafka 拼写为 kafka，甚至拼写不一致。暴露了文档编写不够严谨与规范。", severity: "中风险" },
    { title: "职责描述流于日常化", desc: "使用过多“负责...”、“参与...”等日常事务词汇，缺少能够凸显个人独立设计决策力、技术攻关突破点的措辞（如：主导、设计、重塑）。", severity: "高风险" },
    { title: "架构Trade-off思考为零", desc: "介绍消息总线或缓存链路时，未能对为什么使用此项技术，以及其背后的架构边界、容灾方案进行深层次的技术解剖。", severity: "中风险" }
  ];

  const risksList = analysisResult?.risks || DEFAULT_RISKS;

  const highRisksCount = risksList.filter((r: any) => (r.severity || r.priority) === "高风险").length;
  const medRisksCount = risksList.filter((r: any) => (r.severity || r.priority) === "中风险").length;
  const lowRisksCount = risksList.filter((r: any) => (r.severity || r.priority) === "低风险").length;
  const totalRisksCount = highRisksCount + medRisksCount + lowRisksCount;

  const circ = 2 * Math.PI * 16; // 100.53
  const lowLen = totalRisksCount > 0 ? (lowRisksCount / totalRisksCount) * circ : circ;
  const medLen = totalRisksCount > 0 ? (medRisksCount / totalRisksCount) * circ : 0;
  const highLen = totalRisksCount > 0 ? (highRisksCount / totalRisksCount) * circ : 0;

  // 简历结构地图：统一 7 段 schema（技术岗/非技术岗分析侧重点由 LLM prompt 区分）
  const STRUCTURE_KEYS = [
    "education", "work_experience", "projects", "professional_capability",
    "works_portfolio", "business_outcomes", "management",
  ] as const;

  const STRUCTURE_NAMES = [
    "教育背景", "工作/实习经历", "项目经历", "专业能力",
    "作品/案例", "业务成果", "管理经验",
  ];

  // 后端 status 文本 → 前端颜色/默认分数映射
  const STRUCTURE_STATUS_MAP: Record<string, { color: string; barColor: string; defaultScore: number }> = {
    "优秀": { color: "text-[#5DECCB]", barColor: "bg-[#5DECCB]", defaultScore: 88 },
    "亮点": { color: "text-[#00D4FF]", barColor: "bg-[#00D4FF]", defaultScore: 85 },
    "风险": { color: "text-amber-400", barColor: "bg-amber-400", defaultScore: 65 },
    "缺失": { color: "text-[#FF7A95]", barColor: "bg-[#FF7A95]", defaultScore: 45 },
  };

  // 从 LLM 返回的 structure_analysis 读取 status + score + 颜色配置
  const getAISectionStatus = (sectionIdx: number) => {
    const aiSec = analysisResult?.structure_analysis?.[STRUCTURE_KEYS[sectionIdx]];
    if (!aiSec || !aiSec.status) return null;
    const m = STRUCTURE_STATUS_MAP[aiSec.status];
    if (!m) return null;
    return {
      status: aiSec.status,
      score: typeof aiSec.score === "number" ? aiSec.score : m.defaultScore,
      color: m.color,
      barColor: m.barColor,
    };
  };

  // Dynamically extract a Before/After example from workExperiences
  const getDynamicBulletExample = (sectionIdx: number) => {
    let matchedBullet: any = null;
    
    // 统一关键词（技术岗/非技术岗关键词合并，LLM 按岗位类型侧重分析）
    const SEARCH_KEYWORDS: string[][] = [
      ["南开", "大学", "硕士", "本科", "论文", "奖学金", "毕业"],
      ["工作", "开发", "实现", "负责", "优化", "推动", "完成"],
      ["项目", "重构", "分布式", "架构", "设计", "策划", "落地", "统筹"],
      ["Redis", "Kafka", "JVM", "MySQL", "技术栈", "CRM", "Excel", "PPT", "方法论", "认证", "工具"],
      ["Github", "开源", "作品", "案例", "演讲", "分享", "课程", "专利", "获奖", "客户"],
      ["%", "QPS", "吞吐", "万", "亿", "指标", "转化", "留存", "GMV", "日活", "客户数"],
      ["Mentor", "带人", "规范", "指导", "统筹", "主导", "团队"]
    ];
    const searchKeywords = SEARCH_KEYWORDS[sectionIdx];

    for (const exp of workExperiences) {
      for (const bullet of exp.bullets || []) {
        if (bullet.originalText && bullet.optimizedText) {
          const text = (bullet.originalText + bullet.optimizedText).toLowerCase();
          const hasKeyword = searchKeywords.some(kw => text.includes(kw.toLowerCase()));
          if (hasKeyword) {
            matchedBullet = bullet;
            break;
          }
        }
      }
      if (matchedBullet) break;
    }

    if (!matchedBullet) {
      for (const exp of workExperiences) {
        for (const bullet of exp.bullets || []) {
          if (bullet.originalText && bullet.optimizedText) {
            matchedBullet = bullet;
            break;
          }
        }
        if (matchedBullet) break;
      }
    }

    if (matchedBullet) {
      return {
        before: matchedBullet.originalText,
        after: matchedBullet.optimizedText
      };
    }

    // 统一 before/after 范例（技术岗/非技术岗合并，LLM 按岗位类型侧重分析）
    const FALLBACKS = [
      // 0 教育背景
      {
        before: "硕士/本科 (仅列出专业与学校学历，无重点亮点突出)",
        after: "硕士/本科 | 主导研发课题并获一等奖学金，论文被评为校级优秀论文。"
      },
      // 1 工作/实习经历
      {
        before: `负责在${profile.company || "公司"}完成日常业务对接与系统开发工作。`,
        after: `主导${profile.company || "公司"}核心业务项目落地，推动关键指标（性能 / 转化率 / 客户满意度）环比提升 25%。`
      },
      // 2 项目经历
      {
        before: "参与项目开发与交付，负责部分模块的策划或实现。",
        after: "独立操盘覆盖多部门的端到端项目，提前交付并沉淀 SOP，成为后续团队复用标准。"
      },
      // 3 专业能力
      {
        before: "熟练使用常用工具/框架完成日常工作。",
        after: "深入掌握核心技能（技术栈/方法论/工具链），主导关键治理与体系建设，沉淀可复制的方法论。"
      },
      // 4 作品/案例
      {
        before: "未体现可展示的作品或行业沉淀。",
        after: "有公开作品/案例（开源项目/GitHub/白皮书/客户案例/演讲），产出多篇深度内容，累计获得行业认可。"
      },
      // 5 业务成果
      {
        before: "推进了日常工作指标的提升。",
        after: "主导核心指标优化（性能/转化率/GMV/留存），提升幅度显著，沉淀为团队 SOP 在多条业务线复用。"
      },
      // 6 管理经验
      {
        before: "参与团队日常工作安排，配合主管完成事务性支持。",
        after: "作为团队骨干/小组负责人，统筹团队 OKR 拆解与跨部门协作，关键项目交付准时率显著提升。"
      }
    ];

    return FALLBACKS[sectionIdx];
  };

  const getDynamicSectionStatus = (sectionIdx: number) => {
    // AI 优先：直接读 LLM 返回的 structure_analysis；老分析记录（无该字段）→ 走 legacy
    const ai = getAISectionStatus(sectionIdx);
    if (ai) return ai;
    return legacyGetDynamicSectionStatus(sectionIdx);
  };

  const legacyGetDynamicSectionStatus = (sectionIdx: number) => {
    const risksText = risksList.map((r: any) => (r.title + r.desc).toLowerCase()).join(" ");
    const hasRisk = (keywords: string[]) => keywords.some(kw => risksText.includes(kw));

    switch (sectionIdx) {
      // 7-section schema：education, work_experience, projects, professional_capability, works_portfolio, business_outcomes, management
      case 0:
        // 教育背景
        return { status: "优秀", score: 92, color: "text-[#5DECCB]", barColor: "bg-[#5DECCB]" };
      case 1:
        // 工作经历
        return { status: "优秀", score: 90, color: "text-[#5DECCB]", barColor: "bg-[#5DECCB]" };
      case 2:
        // 项目经历
        const projRisk = hasRisk(["项目", "设计", "日常"]);
        return {
          status: projRisk ? "风险" : "优秀",
          score: projRisk ? 70 : 88,
          color: projRisk ? "text-amber-400" : "text-[#5DECCB]",
          barColor: projRisk ? "bg-amber-400" : "bg-[#5DECCB]"
        };
      case 3:
        // 技术栈 / 专业能力
        const techRisk = hasRisk(["技术", "拼写", "redis", "kafka", "jvm", "名词"]);
        return {
          status: techRisk ? "风险" : "优秀",
          score: techRisk ? 68 : 86,
          color: techRisk ? "text-amber-400" : "text-[#5DECCB]",
          barColor: techRisk ? "bg-amber-400" : "bg-[#5DECCB]"
        };
      case 4:
        // 开源经历 / 作品案例：双轨识别
        const expText5 = workExperiences.map((exp: any) =>
          exp.company + exp.role + (exp.bullets || []).map((b: any) => b.originalText + b.optimizedText).join(" ")
        ).join(" ").toLowerCase();
        const hasHighlight = /github|开源|作品|案例|演讲|分享|课程|专利|比赛|获奖|客户|白皮书|标杆/.test(expText5);
        return {
          status: hasHighlight ? "亮点" : "缺失",
          score: hasHighlight ? 85 : 45,
          color: hasHighlight ? "text-[#00D4FF]" : "text-[#FF7A95]",
          barColor: hasHighlight ? "bg-[#00D4FF]" : "bg-[#FF7A95]"
        };
      case 5:
        // 业务成果
        const bizRisk = hasRisk(["量化", "指标", "成果", "业绩", "数据"]);
        return {
          status: bizRisk ? "缺失" : "优秀",
          score: bizRisk ? 40 : 90,
          color: bizRisk ? "text-[#FF7A95]" : "text-[#5DECCB]",
          barColor: bizRisk ? "bg-[#FF7A95]" : "bg-[#5DECCB]"
        };
      case 6:
        // 管理经验
        const mgtRisk = hasRisk(["管理", "带人", "导师", "mentor", "统统", "团队", "规模"]);
        return {
          status: mgtRisk ? "缺失" : "优秀",
          score: mgtRisk ? 30 : 85,
          color: mgtRisk ? "text-[#FF7A95]" : "text-[#5DECCB]",
          barColor: mgtRisk ? "bg-[#FF7A95]" : "bg-[#5DECCB]"
        };
      default:
        return { status: "优秀", score: 90, color: "text-[#5DECCB]", barColor: "bg-[#5DECCB]" };
    }
  };

  const getDynamicSectionDetails = (idx: number) => {
    // AI 优先：用 LLM 给的 desc/advice/before/after；缺失时回退到 legacy 硬编码模板
    const ds = getDynamicSectionStatus(idx);
    const aiSec = analysisResult?.structure_analysis?.[STRUCTURE_KEYS[idx]];
    if (aiSec && (aiSec.desc || (Array.isArray(aiSec.advice) && aiSec.advice.length) || aiSec.before || aiSec.after)) {
      const advice = Array.isArray(aiSec.advice) && aiSec.advice.length
        ? aiSec.advice.map((a: any) => String(a))
        : ["继续优化此部分以提升简历竞争力"];
      return {
        ...ds,
        name: STRUCTURE_NAMES[idx],
        desc: aiSec.desc || "暂无分析",
        advice,
        before: aiSec.before || "",
        after: aiSec.after || "",
      };
    }
    return legacyGetDynamicSectionDetails(idx);
  };

  const legacyGetDynamicSectionDetails = (idx: number) => {
    const ds = getDynamicSectionStatus(idx);
    const bulletEx = getDynamicBulletExample(idx);

    const targetRole = profile.targetRole || "架构师";
    const targetGrade = profile.targetGrade || "高级";
    const company = (profile.company && profile.company !== "暂无公司") ? profile.company : "当前公司";
    const school = (profile.school && profile.school !== "暂无学校") ? profile.school : "教育背景";

    // 统一 7 段 section 介绍文案（技术岗/非技术岗合并，LLM 按岗位类型侧重分析）
    const SECTIONS_INFO = [
      // 0 教育背景（前置）
      {
        name: "教育背景",
        desc: `学历背景（${school}）交代清晰。在目标岗位为高级开发/架构师级别时，建议突出理论积累与工程底蕴。`,
        advice: [
          "在学历信息下方可以添加在校期间 of 算法竞赛、奖学金、或者是软件研发课题实践，进一步建立技术可信度。",
          "强调硕士/本科期间 of 计算机编程实践，淡化非相关专业课程的影响。"
        ]
      },
      {
        name: "工作经历",
        desc: `工作年限（约${profile.years || '1.5年'}）以及公司（${company}）背景交代清晰。核心职责描述包含了日常研发，但建议突出主导架构设计的成分。`,
        advice: [
          "部分重要动作缺少核心技术的说明（如多线程调优、数据传输保障机制、核心系统重构等）。",
          "建议将优化动作和量化结果直接串联成一句话，突出独立解决复杂架构难点的业务价值。"
        ]
      },
      {
        name: "项目经历",
        desc: `项目细节描述重在日常业务模块的‘编写与实现’，未能体现技术攻关、架构设计决策以及作为${targetGrade}岗位候选人对高并发一致性、灾备设计等深度的Trade-off思考。`,
        advice: [
          "避免使用‘参与开发’、‘负责维护’等被动词，应该改用‘设计’、‘主导’、‘重写’等具有架构把控性的动词。",
          "补充分布式环境下数据一致性及高可用方案的具体落地手段，让大厂面试评估更具技术说服力。"
        ]
      },
      {
        name: "技术栈",
        desc: "技术栈偏向常规工具罗列，容易给面试官留下‘泛而不精’的印象。高并发、消息队列、分布式存储等底层原理与调优描述不足。",
        advice: [
          "不要简单罗列框架，需补充能够体现底层原理和源码级别认知的关键词（如：GC调优、大Key治理、零拷贝）。",
          "技术描述应该体现深度，把被动掌握转换成主动源码与架构细节掌控。"
        ]
      },
      {
        name: "开源经历",
        desc: ds.status === "亮点"
          ? "简历中体现了开源或社区贡献经历，这是一个非常好的差异化亮点，能够体现个人的技术追求与极客精神。"
          : "目前简历中缺少开源经历或社区贡献。对于高级技术岗位，参与开源社区或拥有个人技术积累能大幅提升简历竞争力。",
        advice: [
          "如果有个人GitHub仓库或分析文章链接，必须标注在简历中，保证该亮点的真实性和可考核性。",
          "量化开源产出（如Star数、贡献的PR数量、沉淀的解析文章字数等），让亮点更有说服力。"
        ]
      },
      {
        name: "业务成果",
        desc: ds.status === "缺失"
          ? "简历的重大软肋。简历对项目产出只有纯技术指标描述，缺失了系统在业务维度（如日活用户、业务吞吐量、省下的机器成本等）的商业闭环结果展示。"
          : "简历具备量化的核心业务成果，能够清晰说明项目上线带来的商业价值或吞吐指标增益。",
        advice: [
          "大厂非常关注技术带来的实际业务增值。必须将技术吞吐指标与核心业务转化（如转化率CTR、节省开支）融合描述。",
          "补充大容量业务场景下的真实落地规模数据，体现系统的高并发含金量。"
        ]
      },
      {
        name: "管理经验",
        desc: ds.status === "缺失"
          ? `对于目标定位是‘${targetRole}’的求职者，简历缺乏带人（Mentor）、技术规范主导、项目统筹以及跨团队影响力描述。`
          : "简历中体现了技术指导、Mentor、工程规范落地或项目统筹的骨干职责，具备团队技术影响力支撑。",
        advice: [
          "即使没有正式的团队主管头衔，也应该以非行政管理者的身份写出：带新人（Mentor）、项目统筹管理、规范落地、或是在架构委员会推动基础设施建设等经历。",
          "突出跨团队的技术协同和影响力半径。"
        ]
      }
    ];
    const sectionsInfo = SECTIONS_INFO[idx];

    return {
      ...ds,
      ...sectionsInfo,
      before: bulletEx.before,
      after: bulletEx.after
    };
  };

  return (
    <div className="min-h-screen bg-[#050B1A] text-[#dae2fd] font-body-md flex flex-col relative overflow-hidden pt-20">
      {/* ========================================================
          HYDRATING OVERLAY — blocks the report UI until
          analysisResult is populated (matches the loading overlay
          used in /debugger/voice and /debugger/record). Without
          this, the page first renders with hardcoded fallback
          values (score=84, ats=92, ...) for ~2s before real data
          lands, producing the "initial page" flash.
         ======================================================== */}
      <AnimatePresence>
        {isHydrating && (
          <motion.div
            key="resume-hydrating"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[60] bg-[#050B1A]/95 backdrop-blur-xl flex flex-col justify-center items-center gap-6 px-8"
          >
            {/* Dual-ring spinner — same vibe as voice/record overlays */}
            <div className="relative w-16 h-16">
              <div className="absolute inset-0 rounded-full border-4 border-[#00D4FF]/20 border-t-[#00D4FF] animate-spin" />
              <div className="absolute inset-2 rounded-full border-4 border-[#5DECCB]/10 border-t-[#5DECCB] animate-spin" style={{ animationDirection: "reverse", animationDuration: "1.1s" }} />
            </div>

            <div className="text-center space-y-3">
              <h3 className="font-black text-white text-2xl md:text-3xl animate-pulse tracking-wide">
                正在加载简历诊断报告...
              </h3>
              <p className="text-base md:text-lg text-white/70 font-semibold">
                即将呈现 8 维度结构化诊断与岗位匹配分析
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Background visual grid elements */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff02_1px,transparent_1px),linear-gradient(to_bottom,#ffffff02_1px,transparent_1px)] bg-[size:40px_40px] pointer-events-none z-0" />
      <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-[#AFA7FF]/5 rounded-full blur-[160px] pointer-events-none z-0" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-[#5DECCB]/3 rounded-full blur-[160px] pointer-events-none z-0" />

      {/* ========================================================
          GLOBAL NAVBAR
         ======================================================== */}
      <nav className="fixed top-0 w-full z-40 bg-surface/80 backdrop-blur-xl border-b border-white/10">
        <div className="flex justify-between items-center h-20 px-gutter max-w-container-max mx-auto w-full relative">
          <div
            onClick={() => router.push("/")}
            className="text-2xl font-display-xl font-bold tracking-tight text-on-surface flex items-center gap-3 cursor-pointer"
          >
            <img src="/logo/logo_icon.svg" alt="面试驾到" className="w-11 h-11 object-contain" />
            面试驾到
          </div>

          <div className="absolute left-1/2 -translate-x-1/2 hidden md:flex items-center gap-3 lg:gap-5 xl:gap-8 whitespace-nowrap">
            <a onClick={() => router.push("/debugger")} className="text-primary transition-colors text-[15px] lg:text-[16px] xl:text-[17px] font-extrabold cursor-pointer relative whitespace-nowrap shrink-0 after:content-[''] after:absolute after:bottom-[-26px] after:left-0 after:right-0 after:h-[2px] after:bg-primary">
              面试调试器
            </a>
            <a onClick={() => router.push("/memory")} className="text-on-surface-variant hover:text-on-surface transition-colors text-[15px] lg:text-[16px] xl:text-[17px] font-extrabold cursor-pointer whitespace-nowrap shrink-0">
              职业记忆看板
            </a>
            <a onClick={() => router.push("/training")} className="text-on-surface-variant hover:text-on-surface transition-colors text-[15px] lg:text-[16px] xl:text-[17px] font-extrabold cursor-pointer whitespace-nowrap shrink-0">
              面试训练场
            </a>
            <a onClick={() => router.push("/home")} className="text-on-surface-variant hover:text-on-surface transition-colors text-[15px] lg:text-[16px] xl:text-[17px] font-extrabold cursor-pointer whitespace-nowrap shrink-0">
              职业驾驶舱
            </a>
            <a onClick={() => router.push("/guide")} className="text-on-surface-variant hover:text-on-surface transition-colors text-[15px] lg:text-[16px] xl:text-[17px] font-extrabold cursor-pointer whitespace-nowrap shrink-0">
              面试指南
            </a>
            <a onClick={() => router.push("/feedback")} className="text-on-surface-variant hover:text-on-surface transition-colors text-[15px] lg:text-[16px] xl:text-[17px] font-extrabold cursor-pointer whitespace-nowrap shrink-0">
              体验反馈中心
            </a>
            <a onClick={() => window.open("/helper", "_blank")} className="text-on-surface-variant hover:text-on-surface transition-colors text-[15px] lg:text-[16px] xl:text-[17px] font-extrabold cursor-pointer whitespace-nowrap shrink-0">
              帮助中心
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
          GLOBAL WORKSPACE LAYOUT (Icon Rail + 3 Sidebars Dashboard)
         ======================================================== */}
      <div className="flex-1 flex max-w-container-max mx-auto w-full px-gutter py-6 gap-6 relative z-10 items-stretch">
        


        {/* ========================================================
            2. MAIN DASHBOARD CONTENT AREA (Left Sidebar, Center content, Right Stats)
           ======================================================== */}
        <div className="flex-1 grid grid-cols-12 gap-5.5 items-start min-w-0">
          
          {/* ----------------------------------------------------
              COLUMN 1: Left Sidebar (3 cols)
             ---------------------------------------------------- */}
          <div className="col-span-12 lg:col-span-3 flex flex-col gap-4.5 lg:h-[960px] lg:max-h-[960px] lg:min-h-0">
            
            {/* Sidebar Profile Card */}
            <div className="glass-panel p-5 rounded-2xl border-white/5 flex flex-col gap-4 text-left lg:min-h-[402px] shrink-0">
              <div className="flex justify-between items-center pb-2.5 border-b border-white/5">
                <h4 className="text-sm font-black text-white uppercase tracking-wider flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-base text-[#00D4FF]">assignment_ind</span>
                  简历信息
                </h4>
              </div>

              {/* Avatar and basic info */}
              {(() => {
                const displayName = (auth.user?.name && auth.user.name.trim() !== "" && auth.user.name !== "XXX")
                  ? auth.user.name
                  : (profile.name && !["基本信息", "个人信息", "简历信息", "个人简历", "基本资料", "XXX"].includes(profile.name) ? profile.name : "候选人");

                const isValidCompany = (c?: string) => Boolean(c && c.trim() !== "" && !["暂无", "暂无公司", "无", "None", "null", "未填写", "-"].includes(c));
                const isValidRole = (r?: string) => Boolean(r && r.trim() !== "" && !["暂无", "无", "None", "null", "未填写", "-"].includes(r));

                const displayCompany = isValidCompany(auth.user?.company)
                  ? auth.user!.company
                  : (isValidCompany(profile.company) ? profile.company : "-");

                const displayRole = isValidRole(auth.user?.role)
                  ? auth.user!.role
                  : (isValidRole(profile.role) ? profile.role : "-");

                return (
                  <>
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-full bg-[#AFA7FF] text-[#050B1A] flex items-center justify-center font-black text-lg select-none">
                        {displayName.substring(0, 1)}
                      </div>
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-1.5">
                          <span className="text-base font-black text-white">{displayName}</span>
                          <span className="px-1.5 py-0.2 rounded bg-[#5DECCB]/10 text-[#5DECCB] border border-[#5DECCB]/25 text-xs font-black uppercase">
                            {profile.status}
                          </span>
                        </div>
                        {displayRole && displayRole !== "-" && (
                          <p className="text-xs text-white/50 font-bold">{displayRole}</p>
                        )}
                      </div>
                    </div>

                    {/* Attributes list */}
                    <div className="space-y-2.5 text-xs font-bold text-white/60">
                      <div className="flex justify-between items-start gap-3">
                        <span className="shrink-0">工作年限</span>
                        <span className="text-white font-extrabold text-right break-words max-w-[70%]">{profile.years}</span>
                      </div>
                      <div className="flex justify-between items-start gap-3">
                        <span className="shrink-0">当前公司</span>
                        <span className="text-white font-extrabold text-right break-words max-w-[70%]">{displayCompany}</span>
                      </div>
                      <div className="flex justify-between items-start gap-3">
                        <span className="shrink-0">当前岗位</span>
                        <span className="text-white font-extrabold text-right break-words max-w-[70%]">{displayRole}</span>
                      </div>
                      <div className="flex justify-between items-start gap-3">
                        <span className="shrink-0">当前薪资</span>
                        <span className="text-white font-extrabold text-right break-words max-w-[70%]">{profile.salary}</span>
                      </div>
                      <div className="h-px bg-white/5 my-1" />
                      <div className="flex justify-between items-start gap-3">
                        <span className="shrink-0">目标公司</span>
                        <span className="text-white font-extrabold text-right break-words max-w-[70%]">{profile.targetCompany}</span>
                      </div>
                      <div className="flex justify-between items-start gap-3">
                        <span className="shrink-0">目标岗位</span>
                        <span className="text-white font-extrabold text-right break-words max-w-[70%]">{profile.targetRole}</span>
                      </div>
                      <div className="flex justify-between items-start gap-3">
                        <span className="shrink-0">目标职级</span>
                        <span className="text-white font-extrabold text-right break-words max-w-[70%]">{profile.targetGrade}</span>
                      </div>
                      <div className="flex justify-between items-start gap-3">
                        <span className="shrink-0">目标薪资</span>
                        <span className="text-white font-extrabold text-right break-words max-w-[70%]">{profile.targetSalary}</span>
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>

            {/* Sidebar Structure Status Card */}
            <div className="glass-panel p-5 rounded-2xl border-white/5 flex flex-col gap-4 text-left flex-1 lg:h-0 lg:min-h-0 overflow-hidden">
              <div className="flex justify-between items-center pb-2.5 border-b border-white/5">
                <h4 className="text-sm font-black text-white uppercase tracking-wider flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-base text-[#00D4FF]">map</span>
                  简历结构地图
                </h4>
              </div>

              <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 select-none">
                {[
                  { name: STRUCTURE_NAMES[0], status: "优秀", color: "text-[#5DECCB] bg-[#5DECCB]/10 border-[#5DECCB]/25" },
                  { name: STRUCTURE_NAMES[1], status: "优秀", color: "text-[#5DECCB] bg-[#5DECCB]/10 border-[#5DECCB]/25" },
                  { name: STRUCTURE_NAMES[2], status: "风险", color: "text-amber-400 bg-amber-400/10 border-amber-400/25" },
                  { name: STRUCTURE_NAMES[3], status: "风险", color: "text-amber-400 bg-amber-400/10 border-amber-400/25" },
                  { name: STRUCTURE_NAMES[4], status: "亮点", color: "text-[#00D4FF] bg-[#00D4FF]/10 border-[#00D4FF]/25" },
                  { name: STRUCTURE_NAMES[5], status: "缺失", color: "text-[#FF7A95] bg-[#FF7A95]/10 border-[#FF7A95]/25" },
                  { name: STRUCTURE_NAMES[6], status: "缺失", color: "text-[#FF7A95] bg-[#FF7A95]/10 border-[#FF7A95]/25" }
                ].map((item, idx) => (
                  <div
                    key={idx}
                    className="p-3 rounded-xl border border-white/5 bg-[#050B1A]/40 flex justify-between items-center text-xs font-bold"
                  >
                    <span className="text-[13px] text-white/90">{item.name}</span>
                    <span className={`px-2 py-0.2 rounded text-sm font-black uppercase border shrink-0 ${item.color}`}>
                      {item.status}
                    </span>
                  </div>
                ))}
              </div>

              <button
                onClick={() => setShowStructureModal(true)}
                className="w-full pt-3.5 border-t border-white/5 text-sm text-[#AFA7FF] font-black hover:text-white transition-colors cursor-pointer flex items-center justify-center gap-1"
              >
                查看完整结构分析 <span className="material-symbols-outlined text-xs">arrow_forward</span>
              </button>
            </div>

          </div>

          {/* ----------------------------------------------------
              COLUMN 2: Center Workspace (6 cols)
             ---------------------------------------------------- */}
          <div className="col-span-12 lg:col-span-6 flex flex-col gap-4.5 min-w-0 lg:h-[960px] lg:max-h-[960px] lg:min-h-0">
            
            {/* Center Header Details */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2 select-none text-left">
              <div>
                <h2 className="text-lg font-black text-white flex items-center gap-2">
                  简历深度分析
                </h2>
                <p className="text-[11px] text-white/30 font-bold mt-1">
                  根据目标求职画像精确定位简历漏洞与风险点，输出AI专家建议
                </p>
              </div>
            </div>

            {/* Quick Metrics Row */}
            {(() => {
              // 1. 总字数
              let wordCount = analysisResult?.word_count;
              if (!wordCount || typeof wordCount !== "number") {
                let calcLen = 0;
                (analysisResult?.work_experiences || []).forEach((exp: any) => {
                  (exp.bullets || []).forEach((b: any) => {
                    calcLen += (b.originalText || b.optimizedText || "").length;
                  });
                });
                (analysisResult?.projects || []).forEach((proj: any) => {
                  (proj.bullets || []).forEach((b: any) => {
                    calcLen += (b.originalText || b.optimizedText || "").length;
                  });
                });
                wordCount = calcLen > 0 ? calcLen : 3821;
              }

              // 2. 风险点
              let risksCount = analysisResult?.risks_count;
              if (typeof risksCount !== "number") {
                const risksList = analysisResult?.risks || analysisResult?.risk_analysis?.risks;
                if (Array.isArray(risksList)) {
                  risksCount = risksList.length;
                } else {
                  let rCount = 0;
                  (analysisResult?.work_experiences || []).forEach((exp: any) => {
                    (exp.bullets || []).forEach((b: any) => {
                      if (b.originalTag === "风险") rCount++;
                    });
                  });
                  risksCount = rCount > 0 ? rCount : 7;
                }
              }

              // 3. 优化建议（严格对应 “AI 优化建议” Tab 中的建议条数）
              let suggestionsCount = analysisResult?.suggestions_count;
              if (typeof suggestionsCount !== "number") {
                const optList = analysisResult?.optimization_suggestions || analysisResult?.ai_suggestions;
                if (Array.isArray(optList) && optList.length > 0) {
                  suggestionsCount = optList.length;
                } else {
                  suggestionsCount = 5;
                }
              }

              // 4. 岗位匹配度
              let matchRate = analysisResult?.match_score;
              if (typeof matchRate !== "number") {
                matchRate = analysisResult?.match_analysis?.match_score ?? 
                            analysisResult?.score_breakdown?.keyword_match?.score ?? 
                            analysisResult?.score ?? 83;
              }

              const dynamicMetrics = [
                { title: "总字数", val: Number(wordCount).toLocaleString(), icon: "article", color: "text-[#00D4FF]" },
                { title: "风险点", val: `${risksCount} 个`, icon: "warning", color: "text-[#FF7A95]" },
                { title: "优化建议", val: `${suggestionsCount} 条`, icon: "lightbulb", color: "text-[#AFA7FF]" },
                { title: "岗位匹配度", val: `${matchRate}%`, icon: "donut_large", color: "text-[#5DECCB]" }
              ];

              return (
                <div className="grid grid-cols-4 gap-3.5 select-none shrink-0">
                  {dynamicMetrics.map((m, i) => (
                    <div key={i} className="glass-panel p-4 rounded-xl border-white/5 flex items-center gap-3 w-full">
                      <div className="w-9 h-9 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
                        <span className={`material-symbols-outlined text-base ${m.color}`}>
                          {m.icon}
                        </span>
                      </div>
                      <div className="text-left min-w-0 flex-1">
                        <span className="text-xs text-white/40 font-bold block">{m.title}</span>
                        <span className="text-sm md:text-base font-black text-white block mt-0.5 leading-none font-mono">
                          {m.val}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}

            {/* Interactive Tab Switcher Panel */}
            <div className="glass-panel rounded-2xl border-white/5 p-4 flex flex-col gap-4 flex-1 lg:h-0 lg:min-h-0 min-h-[600px] overflow-hidden">
              
              {/* Tab Header Row */}
              <div className="flex border-b border-white/5 pb-2.5 overflow-x-auto gap-2 shrink-0 select-none no-scrollbar">
                {[
                  { id: "preview", label: "简历预览" },
                  { id: "risk", label: "风险分析" },
                  { id: "match", label: "岗位匹配分析" },
                  { id: "optimization", label: "AI 优化建议" },
                  { id: "keywords", label: "关键词分析" },
                  { id: "ats", label: "ATS 检测" }
                ].map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id as any)}
                    className={`px-3 py-1.5 rounded-lg text-[13px] md:text-sm font-black whitespace-nowrap cursor-pointer transition-all ${
                      activeTab === tab.id
                        ? "bg-[#AFA7FF]/15 text-[#AFA7FF] border border-[#AFA7FF]/20"
                        : "text-white/40 hover:text-white/70 hover:bg-white/5 border border-transparent"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Tab Workspace Scroll Window */}
              <div className="flex-1 overflow-y-auto pr-1 min-h-0 custom-scrollbar">
                {activeTab === "preview" && (
                  /* ========================================================
                      TAB 1: RESUME PREVIEW (HIGH-FIDELITY EXPERIENCE BLOCKS)
                     ======================================================== */
                  <div className="space-y-6 pt-1">
                    <div className="flex justify-between items-center pb-2 border-b border-white/5">
                      <h4 className="text-sm font-black text-white flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-base text-[#00D4FF]">business_center</span>
                        工作/实习经历
                      </h4>

                      {/* Original vs Optimized Switcher */}
                      <div className="flex rounded-lg bg-slate-950 p-1 border border-white/5 select-none font-bold text-[10px] md:text-xs">
                        <button
                          onClick={() => setViewMode("original")}
                          className={`px-3 py-1 rounded-md transition-all cursor-pointer ${
                            viewMode === "original"
                              ? "bg-[#AFA7FF]/15 text-[#AFA7FF] border border-[#AFA7FF]/15"
                              : "text-white/40 hover:text-white/70"
                          }`}
                        >
                          原始简历
                        </button>
                        <button
                          onClick={() => setViewMode("optimized")}
                          className={`px-3 py-1 rounded-md transition-all cursor-pointer ${
                            viewMode === "optimized"
                              ? "bg-[#5DECCB]/15 text-[#5DECCB] border border-[#5DECCB]/15"
                              : "text-white/40 hover:text-white/70"
                          }`}
                        >
                          AI 优化预览
                        </button>
                      </div>
                    </div>

                    <div className="space-y-6">
                      {workExperiences.map((exp, expIdx) => (
                        <div key={expIdx} className="space-y-3.5 text-left">
                          <div className="flex justify-between items-center text-xs font-bold font-mono">
                            <div className="flex items-center gap-3">
                              <span className="text-sm font-black text-white">{exp.company}</span>
                              <span className="text-white/45">{exp.role}</span>
                            </div>
                            <span className="text-white/30">{exp.period}</span>
                          </div>

                          <div className="space-y-2.5">
                            {exp.bullets.map((bullet, bullIdx) => {
                              const isOriginal = viewMode === "original";
                              const textContent = isOriginal ? bullet.originalText : bullet.optimizedText;
                              const badgeLabel = isOriginal ? bullet.originalTag : bullet.optimizedTag;
                              const badgeStyle = (isOriginal ? bullet.originalTagClass : bullet.optimizedTagClass) || 
                                (badgeLabel === "风险" 
                                  ? "text-[#FF7A95] bg-[#FF7A95]/10 border-[#FF7A95]/20" 
                                  : "text-[#5DECCB] bg-[#5DECCB]/10 border-[#5DECCB]/20");
                              const isRisk = isOriginal && bullet.originalTag === "风险";

                              return (
                                <div
                                  key={bullIdx}
                                  className={`p-3.5 rounded-xl border text-xs md:text-sm flex flex-col gap-2 relative transition-all duration-300 ${
                                    isOriginal
                                      ? isRisk
                                        ? "bg-red-950/[0.04] border-red-500/10 hover:border-red-500/20"
                                        : "bg-emerald-950/[0.04] border-emerald-500/10 hover:border-emerald-500/20"
                                      : "bg-emerald-950/[0.08] border-emerald-500/15 hover:border-emerald-500/30"
                                  }`}
                                >
                                  <div className="flex justify-between items-start gap-4">
                                    <p className="text-[13px] md:text-sm leading-relaxed text-white font-semibold flex-1">
                                      {textContent}
                                    </p>
                                    <span className={`px-2.5 py-0.5 rounded text-xs font-black uppercase border shrink-0 ${badgeStyle}`}>
                                      {badgeLabel}
                                    </span>
                                  </div>

                                  {/* Explanation notes (only in original mode) */}
                                  {isOriginal && (
                                    <div className="flex items-center gap-1.5 text-[11px] text-white/40 font-bold border-t border-white/5 pt-2 mt-1">
                                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isRisk ? "bg-amber-400" : "bg-[#5DECCB]"}`} />
                                      <span>{bullet.originalDesc}</span>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {activeTab === "risk" && (
                  /* ========================================================
                      TAB 2: RISK ANALYSIS
                     ======================================================== */
                  <div className="space-y-4 pt-1 text-left">
                    <h4 className="text-sm font-black text-white flex items-center gap-1.5 pb-2 border-b border-white/5">
                      <span className="material-symbols-outlined text-base text-[#FF7A95]">warning</span>
                      简历风险漏洞诊断报告
                    </h4>
                    <div className="space-y-3">
                      {risksList.map((item: any, idx: number) => {
                        const priority = item.severity || item.priority || "中风险";
                        const color = priority === "高风险"
                          ? "text-[#FF7A95] bg-[#FF7A95]/10 border-[#FF7A95]/20"
                          : priority === "中风险"
                            ? "text-amber-400 bg-amber-400/10 border-amber-400/20"
                            : "text-[#5DECCB] bg-[#5DECCB]/10 border-[#5DECCB]/20";
                        return (
                          <div key={idx} className="p-3.5 rounded-xl border border-white/5 bg-[#050B1A]/80 space-y-1.5 text-sm md:text-sm">
                            <div className="flex justify-between items-center">
                              <span className="font-extrabold text-white flex items-center gap-2">
                                <span className="w-5 h-5 rounded-full bg-white/5 flex items-center justify-center font-mono text-[10px] font-black text-white/55">{idx + 1}</span>
                                {item.title}
                              </span>
                              <span className={`px-2.5 py-0.5 rounded border text-xs font-black shrink-0 ${color}`}>
                                {priority}
                              </span>
                            </div>
                            <p className="text-xs text-white/45 leading-relaxed font-bold pl-7">
                              {item.desc}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {activeTab === "match" && (
                  /* ========================================================
                      TAB 3: JOB MATCH ANALYSIS
                     ======================================================== */
                  <div className="space-y-4 pt-1 text-left">
                    <h4 className="text-sm font-black text-white flex items-center gap-1.5 pb-2 border-b border-white/5">
                      <span className="material-symbols-outlined text-base text-[#5DECCB]">donut_large</span>
                      岗位画像深度匹配分析 (目标岗位: {profile.targetCompany} {profile.targetRole})
                    </h4>
                    <div className="space-y-4">
                      <div className="p-4 rounded-xl bg-white/[0.01] border border-white/5 flex items-center gap-5 justify-between">
                        <div className="space-y-1">
                          <span className="text-xs text-white/45 font-bold">画像符合度估值</span>
                          <h3 className="text-2xl font-black text-[#5DECCB] font-mono">{analysisResult?.match_analysis?.match_score ?? 83}% Match</h3>
                        </div>
                        <p className="text-xs text-white/60 leading-relaxed font-bold flex-1 max-w-sm">
                          {analysisResult?.match_analysis?.match_desc ?? "您的技术背景与阿里/腾讯等主流大厂的【高并发微服务后端专家】JD极其吻合。重点缺失项主要集中在“业务闭环指标”和“管理/带人经验”描述。"}
                        </p>
                      </div>

                      <div className="space-y-2.5">
                        {(analysisResult?.match_analysis?.coverages || [
                          { item: "分布式多级缓存 (Redis/Guava)", status: "完美覆盖", percent: "95%" },
                          { item: "高吞吐消息中间件 (Kafka/RocketMQ)", status: "完美覆盖", percent: "90%" },
                          { item: "分布式一致性方案 (TCC/Saga/2PC)", status: "基础具备", percent: "75%" },
                          { item: "全链路线上大促压测与高可用设计", status: "描述较弱", percent: "45%" }
                        ]).map((m: any, idx: number) => {
                          let tagStyle = "text-amber-400 bg-amber-400/10 border-amber-400/25";
                          if (m.status === "完美覆盖" || m.status === "覆盖") {
                            tagStyle = "text-[#5DECCB] bg-[#5DECCB]/10 border-[#5DECCB]/25";
                          } else if (m.status === "描述较弱" || m.status === "缺失") {
                            tagStyle = "text-[#FF7A95] bg-[#FF7A95]/10 border-[#FF7A95]/25";
                          }
                          return (
                            <div key={idx} className="p-3 rounded-xl border border-white/5 bg-[#050B1A]/40 flex justify-between items-center text-xs md:text-sm font-bold">
                              <span className="text-white/80">{m.item}</span>
                              <div className="flex items-center gap-3">
                                <span className="font-mono text-white/55 font-black">{m.percent}</span>
                                <span className={`px-2.5 py-0.5 rounded border text-xs font-black uppercase ${tagStyle}`}>
                                  {m.status}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === "optimization" && (
                  /* ========================================================
                      TAB 4: AI SUGGESTIONS
                     ======================================================== */
                  <div className="space-y-4 pt-1 text-left">
                    <h4 className="text-sm font-black text-white flex items-center gap-1.5 pb-2 border-b border-white/5">
                      <span className="material-symbols-outlined text-base text-[#AFA7FF]">lightbulb</span>
                      AI 简历深度优化建议书
                    </h4>
                    <div className="space-y-3.5 text-xs md:text-sm text-white/70 font-semibold leading-relaxed">
                      {(analysisResult?.optimization_suggestions || [
                        { title: "建议 1：重塑“动作词”，剔除事务型字眼", desc: "在简历中，避免将自己的工作描绘为“被动执行”。将所有的“负责开发”、“配合维护”替换为“主导设计”、“构建”、“重塑”、“突破”等主动掌控性动词。" },
                        { title: "建议 2：STAR 法则全盘套用，补齐 Result (成果)", desc: "每一个项目经历必须遵循：背景与挑战(Situation) → 目标(Task) → 采取的架构行动(Action) → 业务/技术产出成果(Result)。特别是必须把性能提高比例、节省机器成本、解决事故次数等量化。" },
                        { title: "建议 3：精修技术栈，提升高级段位感", desc: "不要笼统写“精通 Java/Go”，应当写“深入研究 Spring/JVM 垃圾回收调优逻辑，阅读 Kafka 源码；掌握 Redis 缓存穿透与大 Key 多级缓冲治理架构”。" }
                      ]).map((item: any, idx: number) => (
                        <div key={idx} className="p-4 rounded-xl bg-white/[0.01] border border-white/5 space-y-2">
                          <h5 className="font-black text-[#AFA7FF] text-sm">{item.title}</h5>
                          <p className="text-white/50 font-bold leading-normal">{item.desc}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {activeTab === "keywords" && (
                  /* ========================================================
                      TAB 5: KEYWORDS ANALYSIS
                     ======================================================== */
                  <div className="space-y-4 pt-1 text-left">
                    <h4 className="text-sm font-black text-white flex items-center gap-1.5 pb-2 border-b border-white/5">
                      <span className="material-symbols-outlined text-base text-[#00D4FF]">tag</span>
                      简历关键词覆盖率分析
                    </h4>
                    <div className="space-y-3.5">
                      <div className="p-4 rounded-xl bg-white/[0.01] border border-white/5 text-xs text-white/50 font-bold leading-relaxed space-y-2">
                        <p>大厂AI筛简历系统（ATS）会根据JD权重匹配核心词频。当前简历关键词权重最高的为：</p>
                        <div className="flex flex-wrap gap-2 pt-1.5">
                          {(analysisResult?.keywords_analysis?.current_keywords || ["Redis", "Kafka", "分布式系统", "高并发", "后端开发", "架构设计", "接口优化"]).map((word: string, idx: number) => (
                            <span key={idx} className="px-2.5 py-1 rounded-md bg-[#AFA7FF]/10 text-[#AFA7FF] border border-[#AFA7FF]/20 text-xs font-black">
                              {word} (高频)
                            </span>
                          ))}
                        </div>
                      </div>

                      <div className="space-y-2.5">
                        <h5 className="text-xs font-black text-white">推荐补齐的行业热点词：</h5>
                        <div className="flex flex-wrap gap-2">
                          {(analysisResult?.keywords_analysis?.recommended_keywords || ["Service Mesh", "高可用容灾", "限流熔断", "多机房多活", "性能调优", "微服务编排"]).map((word: string, idx: number) => (
                            <span key={idx} className="px-2.5 py-1 rounded-md bg-white/5 text-white/50 border border-white/10 text-xs font-bold">
                              {word}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === "ats" && (
                  /* ========================================================
                      TAB 6: ATS COMPATIBILITY
                     ======================================================== */
                  <div className="space-y-4 pt-1 text-left">
                    <h4 className="text-sm font-black text-white flex items-center gap-1.5 pb-2 border-b border-white/5">
                      <span className="material-symbols-outlined text-base text-[#00D4FF]">checklist</span>
                      大厂 ATS 机器人可读性诊断
                    </h4>
                    <div className="space-y-3">
                      {(analysisResult?.ats_checks || [
                        { name: "双栏/复杂排版可读性", status: "通过", score: "结构规范" },
                        { name: "PDF 字体及文本提取无乱码", status: "通过", score: "高保真" },
                        { name: "简历总字数阈值控制", status: "通过", score: "适中 (3.8k字)" },
                        { name: "非标准分隔符识别", status: "警告", score: "图表/虚线可能截断" }
                      ]).map((item: any, idx: number) => {
                        const isExpanded = !!expandedAts[idx];
                        let color = "text-amber-400 border-amber-400/20 bg-amber-400/10";
                        if (item.status === "通过") {
                          color = "text-[#5DECCB] border-[#5DECCB]/20 bg-[#5DECCB]/10";
                        } else if (item.status === "警告" || item.status === "不通过") {
                          color = "text-[#FF7A95] border-[#FF7A95]/20 bg-[#FF7A95]/10";
                        }
                        return (
                          <div
                            key={idx}
                            onClick={() => setExpandedAts(prev => ({ ...prev, [idx]: !prev[idx] }))}
                            className="p-4 rounded-xl border border-white/5 bg-[#050B1A]/40 flex flex-col transition-all hover:bg-[#050B1A]/60 cursor-pointer select-none group"
                          >
                            <div className="flex justify-between items-center text-xs md:text-sm font-bold gap-4 w-full">
                              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                <span className="text-white/80 shrink-0">{item.name}</span>
                                {!isExpanded && item.score && (
                                  <span className="text-xs text-white/35 font-normal truncate hidden sm:block">
                                    — {item.score}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-3 shrink-0">
                                <span className={`px-2.5 py-0.5 rounded border text-xs font-black uppercase ${color}`}>
                                  {item.status}
                                </span>
                                <span className={`material-symbols-outlined text-white/30 group-hover:text-white transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`}>
                                  expand_more
                                </span>
                              </div>
                            </div>
                            <AnimatePresence initial={false}>
                              {isExpanded && item.score && (
                                <motion.div
                                  initial={{ height: 0, opacity: 0, marginTop: 0 }}
                                  animate={{ height: "auto", opacity: 1, marginTop: 14 }}
                                  exit={{ height: 0, opacity: 0, marginTop: 0 }}
                                  transition={{ duration: 0.2 }}
                                  className="overflow-hidden"
                                >
                                  <div className="pt-3 border-t border-white/5 text-xs md:text-sm text-on-surface-variant/80 font-normal leading-relaxed text-left">
                                    {item.score}
                                  </div>
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

            </div>

          </div>

          {/* ----------------------------------------------------
              COLUMN 3: Right Panel Stats Grid (3 cols)
             ---------------------------------------------------- */}
          <div className="col-span-12 lg:col-span-3 flex flex-col gap-4.5 lg:h-[960px] lg:max-h-[960px] lg:min-h-0">
            
            {/* 3.1 Resume Hiring Score */}
            <div className="glass-panel p-5 rounded-2xl border-white/5 flex flex-col gap-2.5 select-none lg:flex-1 lg:min-h-0 shrink-0">
              <div className="flex justify-between items-center pb-2 border-b border-white/5">
                <h4 className="text-base font-black text-white uppercase tracking-wider flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-sm text-[#00D4FF]">verified</span>
                  简历综合评分
                </h4>
                <button
                  type="button"
                  onClick={() => setShowScoreMetricsModal(true)}
                  className="material-symbols-outlined text-sm text-white/30 hover:text-[#00D4FF] transition-colors cursor-pointer bg-transparent border-none p-0 outline-none flex items-center justify-center z-20"
                  title="点击查看计算指标"
                >
                  info
                </button>
              </div>

              <div className="flex flex-col items-center justify-center relative">
                <div className="relative w-32 h-32 flex items-center justify-center">
                  <svg className="w-full h-full -rotate-90">
                    <circle cx="64" cy="64" r="50" fill="transparent" stroke="rgba(255,255,255,0.03)" strokeWidth="7" />
                    <circle
                      cx="64" cy="64" r="50"
                      fill="transparent"
                      stroke="url(#resume-ring-grad)"
                      strokeWidth="7"
                      strokeDasharray={2 * Math.PI * 50}
                      strokeDashoffset={2 * Math.PI * 50 * (1 - (analysisResult?.score ?? 84) / 100)}
                      strokeLinecap="round"
                    />
                    <defs>
                      <linearGradient id="resume-ring-grad" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stopColor="#c0c1ff" />
                        <stop offset="100%" stopColor="#00D4FF" />
                      </linearGradient>
                    </defs>
                  </svg>
                  <div className="absolute inset-0 z-10 flex flex-col items-center justify-center leading-none">
                    <span className="text-3xl font-black text-white font-mono">{analysisResult?.score ?? 84}</span>
                    <span className="text-xs text-white/30 font-bold block mt-0.5">/100 { (analysisResult?.score ?? 84) >= 85 ? "优秀" : (analysisResult?.score ?? 84) >= 70 ? "良好" : "一般" }</span>
                  </div>
                </div>
                <div className="space-y-0.5 mt-0.5 text-center">
                  <p className="text-sm text-white/45 font-bold">超过 <span className="text-[#00D4FF] font-black text-base">{Math.min(99, Math.round((analysisResult?.score ?? 84) * 0.9))}%</span> 同岗位候选人</p>
                </div>
              </div>
            </div>

            {/* 3.2 Offer Probability */}
            <div className="glass-panel p-5 rounded-2xl border-white/5 flex flex-col gap-2.5 select-none lg:flex-1 lg:min-h-0 shrink-0">
              <div className="flex justify-between items-center pb-2 border-b border-white/5">
                <h4 className="text-base font-black text-white uppercase tracking-wider flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-sm text-[#AFA7FF]">trending_up</span>
                  Offer 概率预测
                </h4>
              </div>

              <div className="flex items-center justify-between gap-3 py-2 px-1">
                {/* Current */}
                <div className="flex flex-col items-center justify-center flex-1 py-3.5 rounded-xl bg-white/[0.01] border border-white/5 relative">
                  <div className="relative w-24 h-24 flex items-center justify-center shrink-0">
                    <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 96 96">
                      <circle cx="48" cy="48" r="40" fill="transparent" stroke="rgba(255,255,255,0.03)" strokeWidth="4.5" />
                      <circle cx="48" cy="48" r="40" fill="transparent" stroke="#AFA7FF" strokeWidth="4.5" strokeDasharray={2 * Math.PI * 40} strokeDashoffset={2 * Math.PI * 40 * (1 - (analysisResult ? Math.min(99, Math.round(analysisResult.score * 0.85)) : 72) / 100)} strokeLinecap="round" />
                    </svg>
                    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center text-center leading-none">
                      <span className="text-xl font-black text-white font-mono block">{analysisResult ? Math.min(99, Math.round(analysisResult.score * 0.85)) : 72}%</span>
                      <span className="text-[10px] text-white/35 font-bold mt-0.5">当前简历</span>
                    </div>
                  </div>
                  <span className="text-[11px] text-white/50 font-bold mt-2.5">获得面试概率</span>
                </div>

                {/* Arrow */}
                <span className="material-symbols-outlined text-white/20 select-none">arrow_forward</span>

                {/* Optimized */}
                <div className="flex flex-col items-center justify-center flex-1 py-3.5 rounded-xl bg-white/[0.01] border border-white/5 relative">
                  <div className="relative w-24 h-24 flex items-center justify-center shrink-0">
                    <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 96 96">
                      <circle cx="48" cy="48" r="40" fill="transparent" stroke="rgba(255,255,255,0.03)" strokeWidth="4.5" />
                      <circle cx="48" cy="48" r="40" fill="transparent" stroke="#5DECCB" strokeWidth="4.5" strokeDasharray={2 * Math.PI * 40} strokeDashoffset={2 * Math.PI * 40 * (1 - (analysisResult ? Math.min(99, Math.round(analysisResult.optimized_score * 0.95)) : 89) / 100)} strokeLinecap="round" />
                    </svg>
                    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center text-center leading-none">
                      <span className="text-xl font-black text-[#5DECCB] font-mono block">{analysisResult ? Math.min(99, Math.round(analysisResult.optimized_score * 0.95)) : 89}%</span>
                      <span className="text-[10px] text-[#5DECCB]/55 font-bold mt-0.5">优化后</span>
                    </div>
                  </div>
                  <span className="text-[11px] text-[#5DECCB]/85 font-bold mt-2.5">预计提升概率</span>
                </div>
              </div>
            </div>

            {/* 3.3 ATS Checks checklist */}
            <div className="glass-panel p-5 rounded-2xl border-white/5 flex flex-col gap-2.5 select-none lg:flex-1 lg:min-h-0 shrink-0">
              <div className="flex justify-between items-center pb-2 border-b border-white/5">
                <h4 className="text-base font-black text-white uppercase tracking-wider flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-sm text-[#00D4FF]">analytics</span>
                  ATS 兼容性检测
                </h4>
                <div className="relative group/tooltip flex items-center">
                  <span className="material-symbols-outlined text-sm text-white/30 cursor-pointer hover:text-white/60 transition-colors">info</span>
                  <div className="absolute right-0 bottom-full mb-2 w-52 hidden group-hover/tooltip:block bg-[#0e1626] border border-white/10 p-3 rounded-xl text-sm leading-relaxed text-white/70 shadow-2xl z-50 pointer-events-none">
                    <span className="font-extrabold text-[#00D4FF] block mb-1">ATS（申请人追踪系统）</span>
                    大厂用于自动筛选简历的系统。检测您的简历关键词覆盖率、排版规范度以及是否易被机器解析。
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-6 py-2.5 px-1">
                {/* ATS Circle Gauge */}
                <div className="relative w-24 h-24 flex items-center justify-center shrink-0">
                  <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 96 96">
                    <circle cx="48" cy="48" r="40" fill="transparent" stroke="rgba(255,255,255,0.03)" strokeWidth="5" />
                    <circle
                      cx="48"
                      cy="48"
                      r="40"
                      fill="transparent"
                      stroke="#00D4FF"
                      strokeWidth="5"
                      strokeDasharray={2 * Math.PI * 40}
                      strokeDashoffset={2 * Math.PI * 40 * (1 - (analysisResult?.ats_pass_rate ?? 92) / 100)}
                      strokeLinecap="round"
                    />
                  </svg>
                  <div className="absolute inset-0 z-10 flex flex-col items-center justify-center text-center leading-none">
                    <span className="text-xl font-black text-white font-mono">{analysisResult?.ats_pass_rate ?? 92}%</span>
                    <span className="text-sm text-white/40 font-bold mt-0.5">通过率</span>
                  </div>
                </div>

                <div className="space-y-2.5 text-left text-sm font-bold text-white/85 flex-1 pl-3">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-base text-[#5DECCB]" style={{ fontVariationSettings: "'wght' 700" }}>check</span>
                    <span>关键词覆盖</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-base text-[#5DECCB]" style={{ fontVariationSettings: "'wght' 700" }}>check</span>
                    <span>结构规范</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-base text-[#5DECCB]" style={{ fontVariationSettings: "'wght' 700" }}>check</span>
                    <span>PDF 兼容</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-base text-[#5DECCB]" style={{ fontVariationSettings: "'wght' 700" }}>check</span>
                    <span>机器可读</span>
                  </div>
                </div>
              </div>
            </div>

            {/* 3.4 Risk Distribution donut */}
            <div className="glass-panel p-5 rounded-2xl border-white/5 flex flex-col gap-2.5 select-none lg:flex-1 lg:min-h-0 shrink-0">
              <div className="flex justify-between items-center pb-2 border-b border-white/5">
                <h4 className="text-base font-black text-white uppercase tracking-wider flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-sm text-[#FF7A95]">pie_chart</span>
                  风险分布
                </h4>
              </div>

              <div className="flex items-center gap-5 justify-center flex-1 px-1">
                {/* SVG Ring Donut */}
                <div className="relative w-32 h-32 flex items-center justify-center shrink-0">
                  <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 44 44">
                    {/* Ring for Low Risk */}
                    <circle cx="22" cy="22" r="16" fill="transparent" stroke="#5DECCB" strokeWidth="3.5" strokeDasharray={`${lowLen} ${circ - lowLen}`} strokeDashoffset={0} />
                    {/* Ring for Medium Risk */}
                    <circle cx="22" cy="22" r="16" fill="transparent" stroke="url(#medium-grad)" strokeWidth="3.5" strokeDasharray={`${medLen} ${circ - medLen}`} strokeDashoffset={-lowLen} />
                    {/* Ring for High Risk */}
                    <circle cx="22" cy="22" r="16" fill="transparent" stroke="#FF7A95" strokeWidth="3.5" strokeDasharray={`${highLen} ${circ - highLen}`} strokeDashoffset={-(lowLen + medLen)} />
                    <defs>
                      <linearGradient id="medium-grad" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stopColor="#fbbf24" />
                        <stop offset="100%" stopColor="#f59e0b" />
                      </linearGradient>
                    </defs>
                  </svg>
                  <div className="absolute inset-0 z-10 flex flex-col items-center justify-center text-center leading-none">
                    <span className="text-3xl font-black text-white font-mono">{totalRisksCount}</span>
                    <span className="text-xs text-white/45 font-bold block mt-1">总项数</span>
                  </div>
                </div>

                <div className="space-y-3 text-left text-sm md:text-base font-black text-white/85 flex-1 pl-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-[#FF7A95] shrink-0" />
                      <span>高风险</span>
                    </div>
                    <span className="font-mono text-white/90 font-black text-base md:text-lg">{highRisksCount}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-amber-400 shrink-0" />
                      <span>中风险</span>
                    </div>
                    <span className="font-mono text-white/90 font-black text-base md:text-lg">{medRisksCount}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-[#5DECCB] shrink-0" />
                      <span>低风险</span>
                    </div>
                    <span className="font-mono text-white/90 font-black text-base md:text-lg">{lowRisksCount}</span>
                  </div>
                </div>
              </div>
            </div>

          </div>

          {/* ========================================================
              3. BOTTOM ROW: AI RESUME REBUILD ENGINE (Full-width 12 cols)
             ======================================================== */}
          <div className="col-span-12 relative overflow-hidden rounded-3xl border border-white/10 bg-[#060e20]/60 backdrop-blur-xl p-6 md:py-8 md:px-10 flex flex-col md:flex-row justify-between items-center gap-6 shadow-2xl group min-h-[120px] select-none mt-10">
            
            {/* Background Glow Layer */}
            <div className="absolute inset-0 bg-gradient-to-r from-[#AFA7FF]/5 via-[#5DECCB]/3 to-transparent pointer-events-none" />

            <div className="relative z-10 text-left flex items-center gap-6">
              {/* Spinning Logo Graphic */}
              <div className="w-12 h-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center relative shrink-0">
                <span className="material-symbols-outlined text-3xl text-[#AFA7FF] animate-pulse">settings_suggest</span>
              </div>

              <div className="space-y-1.5 max-w-xl text-left">
                <h4 className="text-base font-black text-white flex items-center gap-2">
                  AI 简历重构引擎
                </h4>
                <p className="text-sm text-white/50 leading-relaxed font-bold">
                  AI 已完成简历重构，全面优化表达与结构，提升面试与 ATS 通过率。
                </p>

                {/* Enhancement statistics tags */}
                <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[10px] md:text-sm font-black font-mono text-[#5DECCB] pt-1">
                  <span className="flex items-center gap-1.5">
                    面试通过率 <span className="bg-[#5DECCB]/15 border border-[#5DECCB]/25 px-1 rounded">+17%</span> 预计提升
                  </span>
                  <span className="text-white/10 font-normal">|</span>
                  <span className="flex items-center gap-1.5">
                    ATS 通过率 <span className="bg-[#5DECCB]/15 border border-[#5DECCB]/25 px-1 rounded">+12%</span> 预计提升
                  </span>
                  <span className="text-white/10 font-normal">|</span>
                  <span className="flex items-center gap-1.5">
                    关键词覆盖 <span className="bg-[#5DECCB]/15 border border-[#5DECCB]/25 px-1 rounded">+34%</span> 预计提升
                  </span>
                  <span className="text-white/10 font-normal">|</span>
                  <span className="flex items-center gap-1.5">
                    表达专业度 <span className="bg-[#5DECCB]/15 border border-[#5DECCB]/25 px-1 rounded">+28%</span> 预计提升
                  </span>
                </div>
              </div>
            </div>

            {/* Actions panel */}
            <div className="relative z-10 flex gap-4.5 w-full md:w-auto text-sm font-black">
              <button
                onClick={handleDownloadPDF}
                disabled={downloadState === "loading"}
                className={`flex-1 md:flex-none px-6 py-3 rounded-xl transition-all shadow-md whitespace-nowrap flex items-center justify-center gap-1.5 cursor-pointer ${
                  downloadState === "loading"
                    ? "bg-white/10 text-white/60 cursor-not-allowed shadow-none"
                    : downloadState === "success"
                      ? "bg-[#5DECCB] text-[#050B1A] shadow-[#5DECCB]/30"
                      : downloadState === "error"
                        ? "bg-[#FF7A95] text-[#050B1A] shadow-[#FF7A95]/30"
                        : "bg-gradient-to-r from-[#AFA7FF] to-[#00D4FF] text-[#050B1A] hover:scale-[1.01] active:scale-98 shadow-[#AFA7FF]/25"
                }`}
              >
                {downloadState === "loading" && (
                  <>
                    <span className="inline-block w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                    正在生成 DOCX…
                  </>
                )}
                {downloadState === "success" && (
                  <>
                    <span className="material-symbols-outlined text-sm">check_circle</span>
                    下载成功
                  </>
                )}
                {downloadState === "error" && (
                  <>
                    <span className="material-symbols-outlined text-sm">error</span>
                    重试下载
                  </>
                )}
                {downloadState === "idle" && (
                  <>
                    下载 AI 优化版 DOCX
                    <span className="material-symbols-outlined text-sm">download</span>
                  </>
                )}
              </button>
            </div>
          </div>

        </div>

      </div>

      {/* ========================================================
          GLOBAL FOOTER
         ======================================================== */}
      <footer className="bg-[#060e20] border-t border-white/5 w-full block mt-8">
        <div className="px-gutter py-8 max-w-container-max mx-auto flex flex-col md:flex-row justify-between items-center gap-4 text-left select-none">
          <div className="flex items-center gap-4">
            <span className="text-xs text-white/30 font-label-mono font-bold tracking-widest">
              © 2026 面试驾到. All rights reserved.
            </span>
          </div>
          <div className="flex gap-8 text-xs text-white/30 font-label-mono font-bold tracking-widest animate-pulse">
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

      {/* ========================================================
          MODAL: EDIT PROFILE FORM
         ======================================================== */}
      {showEditProfileModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          {/* Overlay blur shadow */}
          <div
            onClick={() => setShowEditProfileModal(false)}
            className="absolute inset-0 bg-[#050B1A]/80 backdrop-blur-md transition-opacity duration-300"
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-[#171f33] border border-white/10 rounded-3xl p-8 max-w-lg w-full text-left relative z-10 space-y-6 shadow-2xl"
          >
            <div className="flex justify-between items-center pb-3 border-b border-white/5">
              <h3 className="font-extrabold text-white text-lg">编辑简历分析信息</h3>
              <button
                onClick={() => setShowEditProfileModal(false)}
                className="text-white/30 hover:text-white transition-colors cursor-pointer"
              >
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>

            <form onSubmit={handleEditProfile} className="space-y-4 text-xs font-semibold text-white/60">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block mb-1.5">用户名 *</label>
                  <input
                    type="text"
                    required
                    value={profile.name}
                    onChange={(e) => setProfile({ ...profile, name: e.target.value })}
                    className="w-full py-2.5 px-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/20 focus:outline-none focus:border-[#AFA7FF]/40"
                  />
                </div>
                <div>
                  <label className="block mb-1.5">求职状态 *</label>
                  <input
                    type="text"
                    required
                    value={profile.status}
                    onChange={(e) => setProfile({ ...profile, status: e.target.value })}
                    className="w-full py-2.5 px-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/20 focus:outline-none focus:border-[#AFA7FF]/40"
                  />
                </div>
              </div>

              <div>
                <label className="block mb-1.5">当前公司</label>
                <input
                  type="text"
                  value={profile.company}
                  onChange={(e) => setProfile({ ...profile, company: e.target.value })}
                  className="w-full py-2.5 px-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/20 focus:outline-none focus:border-[#AFA7FF]/40"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block mb-1.5">当前岗位</label>
                  <input
                    type="text"
                    value={profile.role}
                    onChange={(e) => setProfile({ ...profile, role: e.target.value })}
                    className="w-full py-2.5 px-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/20 focus:outline-none focus:border-[#AFA7FF]/40"
                  />
                </div>
                <div>
                  <label className="block mb-1.5">当前薪资</label>
                  <input
                    type="text"
                    value={profile.salary}
                    onChange={(e) => setProfile({ ...profile, salary: e.target.value })}
                    className="w-full py-2.5 px-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/20 focus:outline-none focus:border-[#AFA7FF]/40"
                  />
                </div>
              </div>

              <div className="h-px bg-white/5 my-1" />

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block mb-1.5">目标公司 *</label>
                  <input
                    type="text"
                    required
                    value={profile.targetCompany}
                    onChange={(e) => setProfile({ ...profile, targetCompany: e.target.value })}
                    className="w-full py-2.5 px-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/20 focus:outline-none focus:border-[#AFA7FF]/40"
                  />
                </div>
                <div>
                  <label className="block mb-1.5">目标岗位 *</label>
                  <input
                    type="text"
                    required
                    value={profile.targetRole}
                    onChange={(e) => setProfile({ ...profile, targetRole: e.target.value })}
                    className="w-full py-2.5 px-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/20 focus:outline-none focus:border-[#AFA7FF]/40"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block mb-1.5">目标职级</label>
                  <input
                    type="text"
                    value={profile.targetGrade}
                    onChange={(e) => setProfile({ ...profile, targetGrade: e.target.value })}
                    className="w-full py-2.5 px-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/20 focus:outline-none focus:border-[#AFA7FF]/40"
                  />
                </div>
                <div>
                  <label className="block mb-1.5">目标薪资</label>
                  <input
                    type="text"
                    value={profile.targetSalary}
                    onChange={(e) => setProfile({ ...profile, targetSalary: e.target.value })}
                    className="w-full py-2.5 px-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/20 focus:outline-none focus:border-[#AFA7FF]/40"
                  />
                </div>
              </div>

              <div className="pt-4 flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowEditProfileModal(false)}
                  className="flex-1 py-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white font-bold cursor-pointer text-center"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="flex-1 py-3 bg-[#AFA7FF] text-[#050B1A] rounded-xl font-black cursor-pointer text-center"
                >
                  保存修改
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {/* ========================================================
          MODAL: SCORE METRICS BREAKDOWN
         ======================================================== */}
      {showScoreMetricsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          {/* Overlay blur shadow */}
          <div
            onClick={() => setShowScoreMetricsModal(false)}
            className="absolute inset-0 bg-[#050B1A]/85 backdrop-blur-md transition-opacity duration-300 cursor-pointer"
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-[#171f33]/95 backdrop-blur-xl border border-white/10 rounded-3xl p-6 max-w-md w-full text-left relative z-10 space-y-5 shadow-2xl"
          >
            <div className="flex justify-between items-center pb-3 border-b border-white/5">
              <h3 className="font-extrabold text-white text-[16px] flex items-center gap-2">
                <span className="material-symbols-outlined text-[#00D4FF] text-base">verified</span>
                综合评分计算指标
              </h3>
              <button
                type="button"
                onClick={() => setShowScoreMetricsModal(false)}
                className="text-white/30 hover:text-white transition-colors cursor-pointer"
              >
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>

            <div className="space-y-4">
              <p className="text-sm text-white/50 leading-relaxed font-bold">
                简历综合评分由 面试驾到 AI 根据您的目标求职画像（<span className="text-white">{profile.targetCompany} · {profile.targetRole}</span>）进行多维度智能分析评估得出：
              </p>

              <div className="space-y-3">
                {(() => {
                  // 真实数据优先：后端 score_breakdown.dimensions；若历史数据没有，降级到合理占位
                  const realDimensions = (analysisResult as any)?.score_breakdown?.dimensions as
                    | Array<{ key: string; label: string; score: number; weight: number; source: string }>
                    | undefined;
                  const colorMap: Record<string, string> = {
                    keyword_match: "bg-[#00D4FF]",
                    experience_value: "bg-[#AFA7FF]",
                    quantification: "bg-amber-400",
                    resume_completeness: "bg-[#5DECCB]",
                    expression_quality: "bg-[#FF7A95]",
                  };
                  const descMap: Record<string, string> = {
                    keyword_match: "检测简历中行业核心词及目标 JD 高频词的覆盖情况",
                    experience_value: "评估履历背景、项目规模、独立决策力与影响力",
                    quantification: "考察工作成果的数字量化（QPS / GMV / 转化率 / 留存 / 用户量等跨岗位通用）",
                    resume_completeness: "检测结构完整度、ATS 可读性及个人信息规范",
                    expression_quality: "检测用词规范、动作词精准度及核心指标空洞情况",
                  };
                  const items = realDimensions && realDimensions.length === 5
                    ? realDimensions.map((d) => ({
                        key: d.key,
                        name: `${d.label} (权重 ${Math.round(d.weight * 100)}%)`,
                        desc: descMap[d.key] || "",
                        score: d.score,
                        color: colorMap[d.key] || "bg-[#00D4FF]",
                      }))
                    : [
                        // 历史数据兼容：无 score_breakdown 时不再用假数据，显示"--"
                        { key: "keyword_match", name: "关键词匹配度 (权重 30%)", desc: "暂无维度数据（旧版本报告）", score: 0, color: "bg-white/10" },
                        { key: "experience_value", name: "工作经历含金量 (权重 30%)", desc: "暂无维度数据（旧版本报告）", score: 0, color: "bg-white/10" },
                        { key: "quantification", name: "成果量化程度 (权重 20%)", desc: "暂无维度数据（旧版本报告）", score: 0, color: "bg-white/10" },
                        { key: "resume_completeness", name: "简历完整度 (权重 10%)", desc: "暂无维度数据（旧版本报告）", score: 0, color: "bg-white/10" },
                        { key: "expression_quality", name: "表达专业度 (权重 10%)", desc: "暂无维度数据（旧版本报告）", score: 0, color: "bg-white/10" },
                      ];
                  return items.map((item, idx) => (
                    <div key={idx} className="space-y-1.5 p-3 rounded-xl bg-white/[0.02] border border-white/5">
                      <div className="flex justify-between items-center text-sm font-black">
                        <span className="text-white/95">{item.name}</span>
                        <span className="text-white/80 font-mono">{item.score}分</span>
                      </div>
                      <p className="text-xs text-white/40 font-bold leading-normal">{item.desc}</p>
                      <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden mt-1">
                        <div className={`h-full ${item.color} rounded-full`} style={{ width: `${item.score}%` }} />
                      </div>
                    </div>
                  ));
                })()}
              </div>

              <div className="pt-3 border-t border-white/5 flex justify-between items-center text-xs font-bold text-white/40">
                <span>综合评分计算公式</span>
                <span className="font-mono text-white/60">
                  加权评分
                </span>
              </div>

              <button
                type="button"
                onClick={() => setShowScoreMetricsModal(false)}
                className="w-full py-3 bg-gradient-to-r from-[#AFA7FF] to-[#00D4FF] text-[#050B1A] rounded-xl font-black text-center cursor-pointer mt-2"
              >
                我知道了
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* ========================================================
          MODAL: FULL RESUME STRUCTURE ANALYSIS MAP
         ======================================================== */}
      {showStructureModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          {/* Overlay blur shadow */}
          <div
            onClick={() => setShowStructureModal(false)}
            className="absolute inset-0 bg-[#050B1A]/85 backdrop-blur-md transition-opacity duration-300 cursor-pointer"
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-[#171f33]/95 backdrop-blur-xl border border-white/10 rounded-3xl p-6 md:p-8 max-w-5xl w-full h-[85vh] text-left relative z-10 flex flex-col shadow-2xl overflow-hidden"
          >
            {/* Modal Header */}
            <div className="flex justify-between items-center pb-4 border-b border-white/5 shrink-0">
              <div>
                <h3 className="font-extrabold text-white text-lg md:text-xl flex items-center gap-2">
                  <span className="material-symbols-outlined text-[#AFA7FF] text-base md:text-lg">map</span>
                  简历完整结构分析地图
                </h3>
                <p className="text-xs text-white/40 font-bold mt-1">
                  全面分析简历，精确定位硬伤，对比黄金范例，助力拿到心仪 Offer
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowStructureModal(false)}
                className="text-white/30 hover:text-white transition-colors cursor-pointer bg-white/5 hover:bg-white/10 p-2 rounded-full flex items-center justify-center"
              >
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>

            {/* Modal Body: Split-pane Layout */}
            <div className="flex-1 flex flex-col md:flex-row gap-6 mt-6 overflow-hidden min-h-0">
              
              {/* Left Pane: Vertical Node Roadmap */}
              <div className="w-full md:w-[38%] flex flex-col bg-[#050B1A]/40 border border-white/5 rounded-2xl p-4 overflow-y-auto min-h-0 custom-scrollbar relative">
                <h4 className="text-sm font-black text-white/60 tracking-wider uppercase mb-4 shrink-0 flex items-center gap-1.5 select-none">
                  <span className="material-symbols-outlined text-base text-[#00D4FF]">account_tree</span>
                  简历结构健康度地图
                </h4>

                {/* Vertical glowing timeline line */}
                <div className="absolute left-[35px] top-[74px] bottom-[30px] w-0.5 bg-gradient-to-b from-[#5DECCB] via-amber-400 to-[#FF7A95]/30 pointer-events-none hidden md:block" />

                <div className="space-y-3 relative z-10">
                  {STRUCTURE_NAMES.map((name, idx) => {
                    const isActive = selectedStructureSection === idx;
                    const ds = getDynamicSectionStatus(idx);
                    let badgeStyle = "text-[#FF7A95] bg-[#FF7A95]/10 border-[#FF7A95]/25";
                    if (ds.status === "优秀") {
                      badgeStyle = "text-[#5DECCB] bg-[#5DECCB]/10 border-[#5DECCB]/25";
                    } else if (ds.status === "亮点") {
                      badgeStyle = "text-[#00D4FF] bg-[#00D4FF]/10 border-[#00D4FF]/25";
                    } else if (ds.status === "风险") {
                      badgeStyle = "text-amber-400 bg-amber-400/10 border-amber-400/25";
                    }
                    return (
                      <div
                        key={idx}
                        onClick={() => setSelectedStructureSection(idx)}
                        className={`p-3 rounded-xl border transition-all duration-200 flex justify-between items-center text-sm font-bold cursor-pointer ${
                          isActive
                            ? "bg-[#AFA7FF]/15 border-[#AFA7FF]/40 shadow-[0_0_15px_rgba(175,167,255,0.1)]"
                            : "bg-[#050B1A]/40 border-white/5 hover:border-white/20 hover:bg-[#050B1A]/60"
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <span className={`w-7 h-7 rounded-full flex items-center justify-center font-mono text-base font-black shrink-0 ${
                            isActive ? "bg-[#AFA7FF] text-[#050B1A]" : "bg-white/5 text-white/50"
                          }`}>
                            {idx + 1}
                          </span>
                          <span className={`text-[14.5px] transition-colors ${isActive ? "text-white font-extrabold" : "text-white/80"}`}>
                            {name}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className={`px-2 py-0.5 rounded text-[11px] font-black uppercase border shrink-0 ${badgeStyle}`}>
                            {ds.status}
                          </span>
                          {isActive && (
                            <span className="material-symbols-outlined text-xs text-[#AFA7FF] animate-pulse hidden md:inline">chevron_right</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Right Pane: Detailed Section Diagnoses and Before/After Rewrite Diffs */}
              <div className="flex-1 bg-[#050B1A]/40 border border-white/5 rounded-2xl p-5 md:p-6 overflow-y-auto min-h-0 custom-scrollbar flex flex-col gap-4 text-left">
                {(() => {
                  const section = getDynamicSectionDetails(selectedStructureSection);

                  return (
                    <>
                      {/* Section Info Header */}
                      <div className="flex justify-between items-start pb-3.5 border-b border-white/5 shrink-0">
                        <div>
                          <h4 className="text-base font-black text-white flex items-center gap-2">
                            {section.name} (模块分析)
                          </h4>
                          <div className="flex items-center gap-3 mt-1.5">
                            <span className="text-xs text-white/45 font-bold">健康度评分:</span>
                            <span className={`text-sm font-mono font-black ${section.color}`}>{section.score}分</span>
                            <div className="w-24 h-1.5 bg-white/5 rounded-full overflow-hidden">
                              <div className={`h-full ${section.barColor} rounded-full`} style={{ width: `${section.score}%` }} />
                            </div>
                          </div>
                        </div>
                        <span className={`px-2.5 py-0.5 rounded text-xs font-black uppercase border shrink-0 bg-white/5 ${section.color} border-white/10`}>
                          {section.status}
                        </span>
                      </div>

                      {/* Diagnosis Block */}
                      <div className="bg-[#050B1A]/30 border border-white/5 p-4 rounded-xl flex flex-col gap-2 shrink-0">
                        <h5 className="text-xs font-black text-white flex items-center gap-1.5 select-none">
                          <span className="material-symbols-outlined text-sm text-[#FF7A95]">analytics</span>
                          深度诊断分析
                        </h5>
                        <p className="text-xs text-white/60 leading-relaxed font-bold">
                          {section.desc}
                        </p>
                      </div>

                      {/* Suggestions Block */}
                      <div className="flex flex-col gap-2 shrink-0">
                        <h5 className="text-xs font-black text-white flex items-center gap-1.5 select-none">
                          <span className="material-symbols-outlined text-sm text-[#00D4FF]">lightbulb</span>
                          针对性优化建议
                        </h5>
                        <ul className="space-y-2 text-xs text-white/50 font-bold pl-5 list-disc leading-relaxed">
                          {section.advice.map((item, i) => (
                            <li key={i}>{item}</li>
                          ))}
                        </ul>
                      </div>

                      {/* Before / After Diff Block */}
                      <div className="flex-1 flex flex-col gap-3 min-h-0">
                        <h5 className="text-xs font-black text-white flex items-center gap-1.5 select-none shrink-0">
                          <span className="material-symbols-outlined text-sm text-[#5DECCB]">code</span>
                          黄金润色范例 (Before vs After)
                        </h5>
                        
                        <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-3 min-h-0 overflow-y-auto custom-scrollbar">
                          {/* Before Card */}
                          <div className="bg-red-950/[0.03] border border-red-500/10 rounded-xl p-4 flex flex-col gap-2 min-h-[100px]">
                            <div className="flex justify-between items-center shrink-0">
                              <span className="text-[10px] font-black text-[#FF7A95] bg-[#FF7A95]/10 border border-[#FF7A95]/25 px-1.5 py-0.2 rounded uppercase">
                                原始描述 (Before)
                              </span>
                              <span className="material-symbols-outlined text-xs text-[#FF7A95]/40 select-none">remove_circle_outline</span>
                            </div>
                            <p className="text-xs text-white/45 leading-relaxed font-semibold italic flex-1 flex items-center">
                              “ {section.before} ”
                            </p>
                          </div>

                          {/* After Card */}
                          <div className="bg-emerald-950/[0.05] border border-emerald-500/15 rounded-xl p-4 flex flex-col gap-2 min-h-[100px]">
                            <div className="flex justify-between items-center shrink-0">
                              <span className="text-[10px] font-black text-[#5DECCB] bg-[#5DECCB]/10 border border-[#5DECCB]/25 px-1.5 py-0.2 rounded uppercase">
                                黄金重构 (After)
                              </span>
                              <span className="material-symbols-outlined text-xs text-[#5DECCB]/80 select-none">add_circle_outline</span>
                            </div>
                            <p className="text-xs text-white leading-relaxed font-bold flex-1 flex items-center">
                              “ {section.after} ”
                            </p>
                          </div>
                        </div>
                      </div>
                    </>
                  );
                })()}
              </div>

            </div>

          </motion.div>
        </div>
      )}

      {/* ========================================================
          FLOATING GLOBAL TOAST NOTIFICATION
         ======================================================== */}
      <AnimatePresence>
        {showNotification && (
          <motion.div
            initial={{ opacity: 0, y: -30, x: "-50%" }}
            animate={{ opacity: 1, y: 0, x: "-50%" }}
            exit={{ opacity: 0, y: -20, x: "-50%" }}
            className="fixed top-10 left-1/2 z-[9999] px-6 py-3.5 bg-[#131b2e]/95 backdrop-blur-md border border-[#AFA7FF]/20 shadow-2xl rounded-2xl flex items-center gap-2.5 select-none"
          >
            <span className="material-symbols-outlined text-[#5DECCB] text-base md:text-lg">check_circle</span>
            <span className="text-sm md:text-base font-extrabold text-white">{showNotification}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function ResumeAnalysisPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[#050B1A] text-[#dae2fd] flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="w-12 h-12 border-4 border-[#AFA7FF] border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm font-bold text-white/50">正在加载报告...</p>
        </div>
      </div>
    }>
      <ResumeAnalysisPageContent />
    </Suspense>
  );
}