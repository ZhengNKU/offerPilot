"use client";

import React, { useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth, UserMenu } from "@/components/AuthProvider";
import { ThemeToggle } from "@/components/ThemeToggle";
import { openLegalTerms, openLegalPrivacy, openLegalContact } from "@/components/LegalModals";
import Footer from "@/components/Footer";
import { API_BASE } from "@/lib/api";

const buildPageList = (cur: number, total: number): (number | "…")[] => {
  if (total <= 1) return [1];
  const pages: (number | "…")[] = [1];
  const start = Math.max(2, cur - 1);
  const end = Math.min(total - 1, cur + 1);
  if (start > 2) pages.push("…");
  for (let i = start; i <= end; i++) pages.push(i);
  if (end < total - 1) pages.push("…");
  pages.push(total);
  return pages;
};

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

interface DetailCardItem {
  id: string;
  topicTitle: string; // e.g. "自我介绍"
  title: string;
  tag: string;
  tagBg: string;
  icon: string;
  iconBg: string;
  summary: string;
  formula: string;
  detailTitle: string;
  detailContent: string;
  goodExample?: string;
  badExample?: string;
}

interface EtiquetteItem {
  id: string;
  title: string;
  icon: string;
  iconBg: string;
  bullets: string[];
  details: string[];
}

interface FeaturedContentItem {
  id: string;
  title: string;
  coverImg: string;
  platform: "小红书" | "抖音" | "B站" | "微信公众号" | string;
  platformBadgeBg: string;
  duration?: string;
  url: string;
  author: string;
  authorAvatar: string;
  authorVerified: boolean;
  category: string;
  reads: number;
  likes: number;
  favorites: number;
}

function formatCount(num: number): string {
  if (num >= 10000) {
    return (num / 10000).toFixed(1) + "万";
  }
  return num.toLocaleString();
}

const defaultRealGuideItem: FeaturedContentItem = {
  id: "1",
  title: "我们想打造一个陪你成长的 AI 职业伙伴 🚀",
  coverImg: "/guide/context/1.jpg",
  platform: "小红书",
  platformBadgeBg: "bg-[#FF2442]/20 text-[#FF2442] border-[#FF2442]/30",
  duration: "图文笔记",
  url: "https://www.xiaohongshu.com/explore/6a67251d000000001d02342c?xsec_token=ABjNQQTIIKOpQ3qBhwjet_W0eG_ItjLbApVi6GHprq5Xs=&xsec_source=pc_user",
  author: "面试驾到",
  authorAvatar: "",
  authorVerified: true,
  category: "推荐",
  reads: 0,
  likes: 0,
  favorites: 0,
};

export default function InterviewGuidePage() {
  const router = useRouter();
  const auth = useAuth();

  // Top-level Main Tab State: "featured" | "questions" | "etiquette"
  const [activeMainTab, setActiveMainTab] = useState<"featured" | "questions" | "etiquette">("featured");

  // Sub-filter & Search states
  const [selectedSubCategory, setSelectedSubCategory] = useState<string>("全部");
  const [questionSubFilter, setQuestionSubFilter] = useState<string>("全部");
  const [etiquetteSubFilter, setEtiquetteSubFilter] = useState<string>("全部");
  const [activeSidebarItem, setActiveSidebarItem] = useState<string>("精选推荐");
  const [sortBy, setSortBy] = useState<"latest" | "likes" | "favs" | "reads">("latest");
  const [searchQuery, setSearchQuery] = useState("");

  // Real Database Pagination States for Featured Content (1 页 8 条)
  const [featuredContentList, setFeaturedContentList] = useState<FeaturedContentItem[]>([defaultRealGuideItem]);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize] = useState<number>(8); // 8 items per page!
  const [totalItems, setTotalItems] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [isLoadingFeatured, setIsLoadingFeatured] = useState<boolean>(false);

  // Stateful Likes, Favorites in localStorage
  const [likedIds, setLikedIds] = useState<string[]>([]);
  const [favIds, setFavIds] = useState<string[]>([]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const storedLikes = localStorage.getItem("interviewVar_guide_likes");
      if (storedLikes) setLikedIds(JSON.parse(storedLikes));
      const storedFavs = localStorage.getItem("interviewVar_guide_favs");
      if (storedFavs) setFavIds(JSON.parse(storedFavs));
    } catch (e) {
      console.error("Failed to load guide preferences:", e);
    }
  }, []);

  // Fetch Featured Guides from Real Database API
  const fetchFeaturedGuides = async () => {
    try {
      setIsLoadingFeatured(true);
      let url = `${API_BASE}/api/guide/featured?page=${currentPage}&page_size=${pageSize}&sort_by=${sortBy}`;
      if (searchQuery.trim()) {
        url += `&search=${encodeURIComponent(searchQuery.trim())}`;
      }
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (data && data.items && data.items.length > 0) {
          const mappedItems: FeaturedContentItem[] = data.items.map((item: any) => ({
            id: String(item.id),
            title: item.title,
            coverImg: item.cover_img.startsWith("/guide/") ? item.cover_img : `/guide${item.cover_img}`,
            platform: item.platform,
            platformBadgeBg: item.platform_badge_bg,
            duration: item.duration,
            url: item.url,
            author: item.author || "",
            authorAvatar: item.author_avatar || "",
            authorVerified: Boolean(item.author_verified),
            category: item.category,
            reads: item.reads,
            likes: item.likes,
            favorites: item.favorites,
          }));
          setFeaturedContentList(mappedItems);
          setTotalItems(data.total || mappedItems.length);
          setTotalPages(data.total_pages || 1);
        } else {
          setFeaturedContentList([defaultRealGuideItem]);
          setTotalItems(1);
          setTotalPages(1);
        }
      }
    } catch (err) {
      console.error("Failed to fetch featured guides from database:", err);
      setFeaturedContentList([defaultRealGuideItem]);
      setTotalItems(1);
      setTotalPages(1);
    } finally {
      setIsLoadingFeatured(false);
    }
  };

  useEffect(() => {
    if (activeMainTab === "featured") {
      fetchFeaturedGuides();
    }
  }, [activeMainTab, currentPage, sortBy, searchQuery]);

  // Reset to page 1 on search / sort change
  useEffect(() => {
    setCurrentPage(1);
  }, [sortBy, searchQuery, selectedSubCategory]);

  // Modal State
  const [modalData, setModalData] = useState<{
    type: "question" | "etiquette" | "article" | "case";
    title: string;
    content: React.ReactNode;
  } | null>(null);

  // Universal / Product Manager Focused Overview Data
  const popularQuestions: QuestionItem[] = [
    {
      id: "q-intro",
      title: "自我介绍",
      category: "通用问题回答",
      frequency: 5,
      desc: "如何在1-3分钟内清晰展示你的背景、优势和价值（通用与产品视角）。",
      icon: "person",
      iconBg: "bg-purple-500/20 text-purple-300 border-purple-500/30",
      formula: "结构公式：个人标签定位 (15s) + 核心战绩/优势 (60s) + 岗位契合点 (60s) + 求职动机与结语 (15s)。",
      goodExample: "“您好！我是拥有3年经验的资深产品经理，主导过多个从0到1的AI产品与体验重构。在上家公司，我负责核心产品的体验升级与增长，通过数据驱动将留存率提升 35%...”",
      badExample: "“我叫张三，今年26岁，毕业于XX大学。平时的爱好是看书。我上一家公司做产品，做了三年...”",
      pitfalls: ["切忌照本宣科念简历", "时间控制在 2-3 分钟", "必须包含可量化的业务成果"]
    },
    {
      id: "q-leave",
      title: "离职原因",
      category: "通用问题回答",
      frequency: 5,
      desc: "如何在面试中平衡真实性与策略性，6大卡片拆解避坑与推拉力高分话术。",
      icon: "domain",
      iconBg: "bg-blue-500/20 text-blue-300 border-blue-500/30",
      formula: "核心逻辑：回避负面归因 + 锚定发展诉求 + STAR-L 模型 + 推拉力平衡叙事。",
      goodExample: "“在上家公司的三年里，我独立主导了产品体系从0到1的搭建，能力得到了极大锻炼。目前上一阶段业务已趋于稳定进入运营期，而我渴望在更大规模的用户流量与创新场景下深化决策能力...”",
      badExample: "“前领导任人唯亲，经常无意义加班，而且公司薪水给得太低，制度很不合理...”",
      pitfalls: ["绝对不要吐槽前公司与领导", "不要单纯归咎于薪资福利", "避免显得频繁跳槽"]
    },
    {
      id: "q-career",
      title: "职业规划",
      category: "通用问题回答",
      frequency: 5,
      desc: "展现稳定性与成长性，6大卡片拆解万能回答模板与4点措辞法则。",
      icon: "track_changes",
      iconBg: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
      formula: "万能公式：阶段演进 (1-2年打透基础 ➔ 3-4年方法论 ➔ 5年管理/专家) + 强目的导向。",
      goodExample: "“首先在1-2年内扎实做起，建立对行业与市场的全面了解并考取专业证书；第二阶段3-4年提升方法论与数据决策能力；最终5年内完成从执行提升至管理或专家，与公司共同成长...”",
      badExample: "“我打算先干个一年试试看吧，未来还没想好，走一步看一步；或者一年内当上公司总监。”",
      pitfalls: ["切忌目标浮夸脱离实际", "切忌透露创业或频繁跳槽企图", "措辞必须加上明确时间期限"]
    },
    {
      id: "q-why",
      title: "为什么选择我们",
      category: "通用问题回答",
      frequency: 5,
      desc: "站在考官视角6大卡片拆解避坑禁忌、底层意图与深层次共情表达。",
      icon: "handshake",
      iconBg: "bg-amber-500/20 text-amber-300 border-amber-500/30",
      formula: "高分逻辑：表达工作热情 ➔ 过往岗位能力匹配 ➔ 文化与产品发展共鸣。",
      goodExample: "“我一直在深入体验贵公司的 XX 产品，最近上线的 AI 辅助交互功能令人印象深刻。结合我过往在 AI 产品化落地与用户增长上的经验，我不仅能快速上手该业务，还能在产品体验闭环与数据驱动迭代方面带来价值...”",
      badExample: "“约我就来了；听闻福利好；为了钱；加入贵公司是我梦寐以求的事！”",
      pitfalls: ["切忌以'我'为主盲目说我可以学", "切忌干瘪夸大公司", "切忌表达直奔目的缺沟通温度"]
    },
    {
      id: "q-salary",
      title: "期望薪资",
      category: "通用问题回答",
      frequency: 5,
      desc: "站在考官视角6大卡片拆解报价误区、底层意图、区间锚定与 Package 谈判策略。",
      icon: "account_balance_wallet",
      iconBg: "bg-purple-400/20 text-purple-200 border-purple-400/30",
      formula: "谈判策略：给出合理区间 (基于行业水平涨幅 15-30%) + 强调综合价值 + 留有弹性余地。",
      goodExample: "“根据我对市场同等岗位的调研以及过往的增长成果，期望范围在 25K-30K 之间，更看重贵公司的平台与长期整体激励包...”",
      badExample: "“少于 35K 我绝对不去！” 或者 “随便给就行，按公司规定来。”",
      pitfalls: ["切忌在早期逼问 HR 定薪上限", "补充可结合综合福利与绩效沟通"]
    }
  ];

  // Universal / Product Manager Detailed Breakdown Cards (NO TECH ENGINEEERING SPECIFIC CODES!)
  const topicDetailCards: Record<string, DetailCardItem[]> = useMemo(
    () => ({
      "自我介绍": [
        {
          id: "si-1",
          topicTitle: "自我介绍",
          title: "3 分钟黄金时间分配与公式",
          tag: "必看框架",
          tagBg: "bg-purple-500/20 text-purple-300 border-purple-500/30",
          icon: "timer",
          iconBg: "bg-purple-500/20 text-purple-300",
          summary: "控制在 2-3 分钟，按：15s 破冰定位 ➔ 60s 核心战绩 ➔ 60s 岗位匹配 ➔ 45s 求职动机。",
          formula: "个人标签定位 (15s) + 核心战绩/优势 (60s) + 岗位契合点 (60s) + 诚意总结 (45s)",
          detailTitle: "时间颗粒度拆解指南",
          detailContent: "切忌少于1分钟（显得缺乏经历）或长篇大论超过5分钟。严格按照时间颗粒度拆分，能让面试官逻辑清晰地掌握你的能力优势与求职诚意。",
          goodExample: "0:00-0:15 定位破冰；0:15-1:15 战绩支撑；1:15-2:15 痛点匹配；2:15-3:00 诚意结语。"
        },
        {
          id: "si-2",
          topicTitle: "自我介绍",
          title: "核心战绩与数据量化法",
          tag: "数据化表达",
          tagBg: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
          icon: "trending_up",
          iconBg: "bg-emerald-500/20 text-emerald-400",
          summary: "拒绝流水账！用“动作 + 困难 + 数据收益”展现个人在主导项目中的独到价值。",
          formula: "主导核心产品体验重构 ➔ 用户留存率提升 35% ➔ 月活跃用户增长至 120 万",
          detailTitle: "数据化总结技巧",
          detailContent: "尽量使用具体百分比、转化率、用户留存、营收增长或效率提升数据。真实可量化的成果是最具说服力的名片。",
          goodExample: "“主导产品流程重构，将关键转化率提升 35%，用户满意度从 82 分提升至 95 分。”"
        },
        {
          id: "si-3",
          topicTitle: "自我介绍",
          title: "岗位契合点与痛点对齐",
          tag: "精准匹配",
          tagBg: "bg-blue-500/20 text-blue-300 border-blue-500/30",
          icon: "track_changes",
          iconBg: "bg-blue-500/20 text-blue-300",
          summary: "分析目标岗位 JD 的 Key Points，将个人能力与公司当前业务痛点无缝连接。",
          formula: "了解到贵公司正拓展 AI 产品业务 ➔ 我的产品设计与增长实战经验正好能快速落地",
          detailTitle: "JD 痛点精准匹配",
          detailContent: "自我介绍不是单向汇报，而是双向匹配。告诉面试官你能为团队解决什么实际难题，证明你的即战力与入职后价值。",
          goodExample: "“贵公司正在做智能化体验升级，我过往的产品化落地经验可以直接赋能团队。”"
        },
        {
          id: "si-4",
          topicTitle: "自我介绍",
          title: "满分通关示范（逐字稿）",
          tag: "高分范例",
          tagBg: "bg-amber-500/20 text-amber-300 border-amber-500/30",
          icon: "workspace_premium",
          iconBg: "bg-amber-500/20 text-amber-300",
          summary: "“您好！我是拥有3年经验的资深产品经理，主导过多个从0到1的产品与体验重构...”",
          formula: "破冰定基调 ➔ 核心战绩支撑 ➔ JD痛点结合 ➔ 诚意结语",
          detailTitle: "完整通用/产品经理示范文本",
          detailContent: "“您好！我是拥有3年经验的资深产品经理，主导过多个从0到1的商业化产品与核心体验重构。在上家公司，我负责核心产品的体验升级与用户增长，通过数据归因与流程重构，将关键转化率提升了 35%，月活跃用户增至 120 万。了解到贵公司目前正在拓展 AI 产品的核心业务，我的产品设计与增长实战经验能快速帮助团队落地核心体验。”",
          goodExample: "建议在面试前练习朗读 3 遍，保持语气自然、自信从容。"
        },
        {
          id: "si-5",
          topicTitle: "自我介绍",
          title: "减分避坑与反面教材",
          tag: "避坑提醒",
          tagBg: "bg-rose-500/20 text-rose-300 border-rose-500/30",
          icon: "error",
          iconBg: "bg-rose-500/20 text-rose-300",
          summary: "严禁照本宣科背简历！避免“我叫张三，今年26岁，爱好是看书”这类无亮点流水账。",
          formula: "❌ 念简历流水账  ❌ 缺乏量化数据  ❌ 像在机械背台词",
          detailTitle: "三大扣分雷区",
          detailContent: "1. 照本宣科念简历；2. 缺乏思考与数据支撑；3. 讲太多与申请岗位无关的琐事。面试官要看的是简历背后的突破与亮点。",
          badExample: "“我叫张三，毕业于XX大学，我上一家公司做了三年产品，希望能给我个机会。”（扣分：流水账无亮点）"
        },
        {
          id: "si-6",
          topicTitle: "自我介绍",
          title: "气场语气与肢体表达",
          tag: "表达气场",
          tagBg: "bg-indigo-500/20 text-indigo-300 border-indigo-500/30",
          icon: "record_voice_over",
          iconBg: "bg-indigo-500/20 text-indigo-300",
          summary: "语速控制在 220-250 字/分钟，眼神平视镜头，声音洪亮亲和，展现顶尖职场自信。",
          formula: "平视镜头 (60%) + 自信微笑 + 适度手势 + 洪亮音量",
          detailTitle: "气场拉满技巧",
          detailContent: "开场3分钟决定面试官对你的第一印象。微笑与稳定的语速能瞬间传递出抗压能力强、专业稳重的成熟职业形象。",
          goodExample: "即使线上视频面试，也要保持挺拔姿态，声音洪亮自然。"
        }
      ],
      "离职原因": [
        {
          id: "lr-1",
          topicTitle: "离职原因",
          title: "三大核心回避红线与风险归因",
          tag: "底层逻辑",
          tagBg: "bg-rose-500/20 text-rose-300 border-rose-500/30",
          icon: "warning",
          iconBg: "bg-rose-500/20 text-rose-300",
          summary: "回避薪资矛盾、人际关系与高压抱怨（人际关系吐槽使录用率降低 40%）。",
          formula: "❌ 忌谈薪资矛盾  ❌ 忌吐槽领导人际  ❌ 忌抱怨加班高压",
          detailTitle: "红线避坑详解",
          detailContent: "1. 忌谈薪资矛盾（如“工资低”）：易被质疑稳定性，超 60% HR 担忧候选人对物质过于敏感；2. 忌谈人际关系（如“领导能力差”）：录用率降低 40%，易被归咎为适应力不足；3. 忌抱怨高压加班：易被归咎抗压能力不足。",
          badExample: "“前领导任人唯亲，加班太多，工资给得太少。”（严重扣分雷区）"
        },
        {
          id: "lr-2",
          topicTitle: "离职原因",
          title: "锚定发展诉求与推拉力平衡",
          tag: "正向导向",
          tagBg: "bg-blue-500/20 text-blue-300 border-blue-500/30",
          icon: "trending_up",
          iconBg: "bg-blue-500/20 text-blue-300",
          summary: "构建“推力（离开原因）”与“拉力（加入动机）”的平衡叙事，聚焦职业成长而非被动逃离。",
          formula: "业务调整弱化被动性 ➔ 技能匹配转移焦点 ➔ 90% HR 期待积极动机",
          detailTitle: "发展诉求锚定策略",
          detailContent: "“原公司业务方向调整后，我的核心技能与岗位需求逐渐错位。观察到贵司在 XX 领域的深度布局，这与我未来三年的职业规划高度契合。”通过业务调整弱化被动性，用技能匹配度转移焦点。",
          goodExample: "强调对目标新岗位的业务契合与发展期待，避开被动逃离感。"
        },
        {
          id: "lr-3",
          topicTitle: "离职原因",
          title: "三大场景化高分应答模板",
          tag: "高分范例",
          tagBg: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
          icon: "workspace_premium",
          iconBg: "bg-emerald-500/20 text-emerald-400",
          summary: "掌握客观环境变动、职业天花板突破与工作生活平衡优化三大安全模板。",
          formula: "客观变动 (接受度89%) ➔ 天花板突破 (具象化成果) ➔ 生活平衡 (自我效率优化)",
          detailTitle: "场景模板解析",
          detailContent: "1. 客观变动：“因公司战略调整/部门重组，岗位职能变化，希望在专业领域深耕”；2. 天花板突破：“带领团队完成多个项目，但平台限制场景，寻求贵司更广阔挑战”；3. 工作生活平衡：“专注提升效率方法论，希望在新环境中验证产出”。"
        },
        {
          id: "lr-4",
          topicTitle: "离职原因",
          title: "STAR-L 模型与价值提案话术",
          tag: "表达模型",
          tagBg: "bg-indigo-500/20 text-indigo-300 border-indigo-500/30",
          icon: "schema",
          iconBg: "bg-indigo-500/20 text-indigo-300",
          summary: "Situation + Task + Action + Result + Learning/Future，将离职原因转化为向新公司呈现的“价值提案”。",
          formula: "成果展现 ➔ 自然引出动因 ➔ 转化为新平台增长价值提案",
          detailTitle: "STAR-L 模型话术",
          detailContent: "将离职原因转化为价值提案：“在上一平台积累的 AARRR / 增长模型方法论，若能应用于贵司正在搭建的核心业务池，预计可实现用户 LTV / 留存显著提升。这正是我寻求新机会的核心动力。”"
        },
        {
          id: "lr-5",
          topicTitle: "离职原因",
          title: "负面避坑与高情商话术重构",
          tag: "避坑重构",
          tagBg: "bg-amber-500/20 text-amber-300 border-amber-500/30",
          icon: "published_with_changes",
          iconBg: "bg-amber-500/20 text-amber-300",
          summary: "将“领导任人唯亲/晋升被占”重构为“寻求更系统的解决方案与战略视角培养”。",
          formula: "❌ 暴露负面情绪  ❌ 暗示缺乏向上管理  ➔ 转化为能力与战略视角诉求",
          detailTitle: "高情商重构示范",
          detailContent: "错误表述：“前领导任人唯亲，晋升机会都被关系户占据”（暴跌HR好感）；重构方案：“在参与过多个跨部门项目后，我发现自己更擅长系统化解决方案设计。现有岗位侧重执行层面，希望能获得更全面的战略视角培养机会。”"
        },
        {
          id: "lr-6",
          topicTitle: "离职原因",
          title: "特殊场景高情商应对 (裁员/跳槽)",
          tag: "场景应对",
          tagBg: "bg-purple-500/20 text-purple-300 border-purple-500/30",
          icon: "psychology_alt",
          iconBg: "bg-purple-500/20 text-purple-300",
          summary: "应对公司裁员收缩与频繁跳槽疑问，突出客观因素、个人贡献反思与垂直深耕决心。",
          formula: "裁员(客观收缩+突出贡献数据) ➔ 频跳(阐明探索期+强调垂直深耕)",
          detailTitle: "特殊场景应对话术",
          detailContent: "裁员回应：“公司优化成本结构收缩业务线，我负责的项目虽增长良好（数据提升15%），但尚未达盈利平衡点。这段经历让我更理解商业闭环”；频繁跳槽：“早期快速验证职业定位，聚焦某方向后连续服务超18个月，本次希望在垂直领域更深耕。”"
        }
      ],
      "职业规划": [
        {
          id: "cp-1",
          topicTitle: "职业规划",
          title: "职业规划底层逻辑与匹配定位",
          tag: "底层逻辑",
          tagBg: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
          icon: "military_tech",
          iconBg: "bg-emerald-500/20 text-emerald-400",
          summary: "重点在于展现个人优势与稳定性，证明自己是符合企业要求的稳定型、高潜候选人。",
          formula: "展现稳定性与成长性 ➔ 避免空洞狂妄 ➔ 证明与岗位高度匹配",
          detailTitle: "底层逻辑解析",
          detailContent: "回答重点不在于精确预测3-5年的一切细节，而是向 HR 证明你是符合企业要求的稳定型员工。通过展现优势与阶段成长性，证明自己是该岗位的不二人选。"
        },
        {
          id: "cp-2",
          topicTitle: "职业规划",
          title: "万能模板一 · 阶段递进与能力提升",
          tag: "万能模板",
          tagBg: "bg-purple-500/20 text-purple-300 border-purple-500/30",
          icon: "architecture",
          iconBg: "bg-purple-500/20 text-purple-300",
          summary: "1-2年扎实基础打透业务 ➔ 考取证书/能力升级 ➔ 3-5年从执行提升至管理/专家。",
          formula: "基础扎实 (1-2年) ➔ 能力/证书进阶 ➔ 5年管理/专家进阶与公司共赢",
          detailTitle: "模板一表达框架",
          detailContent: "“首先在1-2年内从基础工作做起，不断优化模式，建立对行业与市场的全面了解；第二在2年内考取XX证书/完成XX专业课程提升能力；最终在5年内完成从执行岗位上升到管理或领域专家，与公司共同成长。”"
        },
        {
          id: "cp-3",
          topicTitle: "职业规划",
          title: "万能模板二 · 业务熟练与三阶段演进",
          tag: "阶段演进",
          tagBg: "bg-blue-500/20 text-blue-300 border-blue-500/30",
          icon: "auto_graph",
          iconBg: "bg-blue-500/20 text-blue-300",
          summary: "阶段一培训学习考证 ➔ 阶段二业务熟练攻坚 ➔ 阶段三职位升迁与领域专家。",
          formula: "阶段一学习融入 (1-2年) ➔ 阶段二业务攻坚 (3-4年) ➔ 阶段三升迁专家 (5年)",
          detailTitle: "模板二表达框架",
          detailContent: "“第一阶段（1-2年）：以从事培训和学习业务为主，考取相关技能证书；第二阶段（3-4年）：业务熟练后主导核心模块攻坚与跨部门协作；第三阶段（5年）：职位升迁与领域专家，带领团队赋能业务。”"
        },
        {
          id: "cp-4",
          topicTitle: "职业规划",
          title: "表达措辞四大黄金原则",
          tag: "措辞技巧",
          tagBg: "bg-amber-500/20 text-amber-300 border-amber-500/30",
          icon: "spellcheck",
          iconBg: "bg-amber-500/20 text-amber-300",
          summary: "结合公司术语、明确时间期限、多用数字编号、强目的导向（通过A达到B）。",
          formula: "术语结合 ➔ 明确时间期限 (如2年内) ➔ 数字编号结构化 ➔ 目的导向表达",
          detailTitle: "四大措辞原则",
          detailContent: "1. 融入公司内部术语；2. 加上明确时间期限（如“在2年时间内建立起全面了解”而非空话）；3. 使用第一第二第三逻辑编号；4. 目的导向表达（如“通过XXX，以达到XXX的目的”）。"
        },
        {
          id: "cp-5",
          topicTitle: "职业规划",
          title: "通用 / 产品经理高分示范逐字稿",
          tag: "高分范例",
          tagBg: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
          icon: "workspace_premium",
          iconBg: "bg-emerald-500/20 text-emerald-400",
          summary: "“第一阶段1-2年内打透产品业务逻辑；第二阶段3-4年提升产品方法论与数据决策...”",
          formula: "体验打透 ➔ 数据增长方法论 ➔ 带领团队/创新业务线攻坚",
          detailTitle: "通用/产品经理完整逐字稿",
          detailContent: "“第一阶段（1-2年）：我计划扎实从产品基础工作做起，在2年内建立对目标赛道用户画像与业务逻辑的全面了解；第二阶段（3-4年）：通过考取 NPDP / 数据分析认证提升方法论，主导核心模块攻坚；第三阶段（5年）：争取晋升至高级产品经理或带团队，为公司输出持续的商业增长与用户价值。”"
        },
        {
          id: "cp-6",
          topicTitle: "职业规划",
          title: "减分雷区与跳槽疑虑规避",
          tag: "避坑指南",
          tagBg: "bg-rose-500/20 text-rose-300 border-rose-500/30",
          icon: "error",
          iconBg: "bg-rose-500/20 text-rose-300",
          summary: "切忌目标浮夸（如一年当总监）、切忌透露创业或频繁跳槽意图，保持踏实稳定形象。",
          formula: "❌ 切忌目标浮夸  ❌ 切忌透露创业  ❌ 切忌脱离岗位职责",
          detailTitle: "三大避坑提醒",
          detailContent: "1. 避免浮夸目标（如“一年做到总监”）；2. 绝对不要透露短期内有创业或跨行打算；3. 规划必须紧密贴合所申请岗位的职责演进，给 HR 留下稳重踏实的好印象。"
        }
      ],
      "为什么选择我们": [
        {
          id: "wu-1",
          topicTitle: "为什么选择我们",
          title: "四大扣分禁忌与情商红线",
          tag: "避坑红线",
          tagBg: "bg-rose-500/20 text-rose-300 border-rose-500/30",
          icon: "cancel",
          iconBg: "bg-rose-500/20 text-rose-300",
          summary: "忌“约我就来了”、忌“福利好/只为钱”、忌“梦寐以求表虚忠”、直奔目的缺沟通温度。",
          formula: "❌ 忌“约我就来了”  ❌ 忌“只看福利为钱”  ❌ 忌“假大空夸赞”",
          detailTitle: "四大红线禁忌",
          detailContent: "1. 忌“约我就来了”（显得毫无准备缺乏诚意）；2. 忌“听闻福利好/为了钱”（企业渴求创造价值者而非享利派）；3. 忌“梦寐以求表虚忠”（言语轻浮缺乏实质依据）；4. 忌直奔功利目的缺少沟通温度。"
        },
        {
          id: "wu-2",
          topicTitle: "为什么选择我们",
          title: "面试官三大底层意图剖析",
          tag: "底层逻辑",
          tagBg: "bg-blue-500/20 text-blue-300 border-blue-500/30",
          icon: "psychology",
          iconBg: "bg-blue-500/20 text-blue-300",
          summary: "获知真实求职动机、判断岗位胜任匹配度、考察职场稳定性（工作稳定+情绪压力测试）。",
          formula: "获知求职动机 ➔ 评估胜任匹配度 ➔ 考察职场与情绪稳定性",
          detailTitle: "考官底层意图",
          detailContent: "1. 获知求职动机（为你为何而工作）；2. 判断岗位匹配（了解产品优势、业务胜任度与准备细致度）；3. 考察职场与情绪稳定性（过滤跳板候选人，考察压力测试下的高情商修养）。"
        },
        {
          id: "wu-3",
          topicTitle: "为什么选择我们",
          title: "深入调研与功课展现技巧",
          tag: "调研技巧",
          tagBg: "bg-purple-500/20 text-purple-300 border-purple-500/30",
          icon: "travel_explore",
          iconBg: "bg-purple-500/20 text-purple-300",
          summary: "切忌机械背百度百科！通过官网、企业号、市场优劣势与行业趋势展现真实诚意。",
          formula: "切忌转述百度百科 ➔ 展现产品与市场理解 ➔ 诚恳对答如流",
          detailTitle: "做足功课技巧",
          detailContent: "切忌生硬转述百度百科资料（HR一眼识破）。通过官网、企业号了解最新动态，针对公司市场状况、竞品优劣势与行业未来趋势发表个人看法，诚恳自然地展现前期充分准备。"
        },
        {
          id: "wu-4",
          topicTitle: "为什么选择我们",
          title: "切忌以“我”为主与双向价值认同",
          tag: "表达策略",
          tagBg: "bg-amber-500/20 text-amber-300 border-amber-500/30",
          icon: "handshake",
          iconBg: "bg-amber-500/20 text-amber-300",
          summary: "职场不是补习班，“我可以学/我想大展拳脚”过于自我，强调公司需求与双向价值。",
          formula: "❌ 忌“虽然不会我可以学” ❌ 忌高频“我想”句式 ➔ 强调你能为公司创造什么",
          detailTitle: "双向价值表达",
          detailContent: "避免“虽然我不擅长但我可以学”（职场讲求高效率结果）以及高频“我想”句式。时刻提醒自己：对方在选择你，要强调你能为公司用人需求解决什么，实现双向认同。"
        },
        {
          id: "wu-5",
          topicTitle: "为什么选择我们",
          title: "有的放矢地表达对公司的“爱”",
          tag: "高情商表达",
          tagBg: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
          icon: "favorite",
          iconBg: "bg-emerald-500/20 text-emerald-400",
          summary: "避免干瘪夸“龙头大公司”，结合产品真实体验、价值观文化、关键领导理念深度共情。",
          formula: "从干瘪夸大公司 ➔ 转化为产品使用者体验 + 领导人理念共情",
          detailTitle: "深度共情方法",
          detailContent: "不要干瘪夸“贵公司是行业龙头知名度高”。高明回答：“我对贵公司很有认同感，作为使用者通读过领导人著作/理念...认同内部人才培养观，同时作为使用者对产品也有自己的深刻体会。”"
        },
        {
          id: "wu-6",
          topicTitle: "为什么选择我们",
          title: "通用 / 产品经理高分示范逐字稿",
          tag: "高分范例",
          tagBg: "bg-indigo-500/20 text-indigo-300 border-indigo-500/30",
          icon: "workspace_premium",
          iconBg: "bg-indigo-500/20 text-indigo-300",
          summary: "“表达工作热情 ➔ 结合岗位职责与增长战果 ➔ 阐述价值观与产品迭代共鸣”。",
          formula: "工作热情 ➔ 过往岗位能力匹配 ➔ 文化与产品发展共鸣",
          detailTitle: "完整通用/产品经理高分逐字稿",
          detailContent: "“首先我对贵公司在智能体验赛道的布局怀有极大热情；其次结合我过往3年在体验重构与用户增长上的经验，能快速赋能团队落地核心功能；最后我长期深度体验过贵公司的XX产品，高度认同团队以用户价值为核心的文化，我的加盟能带来即战力与长远价值。”"
        }
      ],
      "期望薪资": [
        {
          id: "sal-1",
          topicTitle: "期望薪资",
          title: "薪资谈判三大误区与报价红线",
          tag: "避坑红线",
          tagBg: "bg-rose-500/20 text-rose-300 border-rose-500/30",
          icon: "block",
          iconBg: "bg-rose-500/20 text-rose-300",
          summary: "忌早喊底线“少于多少不去”、忌死板“按公司规定来”、忌早期逼问HR薪资上限。",
          formula: "❌ 忌早期喊死底线  ❌ 忌过早暴露底牌  ❌ 忌过于被动“按公司规定”",
          detailTitle: "三大报价误区",
          detailContent: "1. 忌早喊死底线：“少于35K不去”（显得僵硬无沟通弹性）；2. 忌过于被动：“随便给就行，按公司规定来”（显得缺乏自信与自我身价认知）；3. 忌在初试阶段强行逼问 HR 薪资上限。"
        },
        {
          id: "sal-2",
          topicTitle: "期望薪资",
          title: "面试官问“期望薪资”的四大底层意图",
          tag: "底层逻辑",
          tagBg: "bg-blue-500/20 text-blue-300 border-blue-500/30",
          icon: "psychology",
          iconBg: "bg-blue-500/20 text-blue-300",
          summary: "评估薪资预算匹配、考察市场身价认知、测验商业谈判能力与求职意愿强弱。",
          formula: "预算范围匹配 ➔ 个人自我价值认知 ➔ 商业谈判情商 ➔ 意愿强弱评估",
          detailTitle: "考官四大意图",
          detailContent: "1. 评估团队 headcount 预算与你是否匹配；2. 考察你对个人技能在市场上的客观看待；3. 测验你处理敏感商务谈判时的情商与语气；4. 判断你对加入公司的意愿度。"
        },
        {
          id: "sal-3",
          topicTitle: "期望薪资",
          title: "合理区间设定与市场身价锚定",
          tag: "区间策略",
          tagBg: "bg-purple-400/20 text-purple-200 border-purple-400/30",
          icon: "account_balance_wallet",
          iconBg: "bg-purple-400/20 text-purple-200",
          summary: "基于行业水平与过往 Package 确定 15-30% 涨幅区间（如 25K-30K），留有谈判余地。",
          formula: "行业薪酬调研 ➔ 设定15-30%涨幅区间 ➔ 强调弹性沟通空间",
          detailTitle: "合理区间开口公式",
          detailContent: "给出合理区间而非单一死板数字（基于同等职位调研与个人业绩，设定 15-30% 增长区间），同时表达更看重公司平台与长期激励包，留有弹性商讨余地。"
        },
        {
          id: "sal-4",
          topicTitle: "期望薪资",
          title: "初试阶段延后报价与反问技巧",
          tag: "谈判技巧",
          tagBg: "bg-amber-500/20 text-amber-300 border-amber-500/30",
          icon: "hourglass_top",
          iconBg: "bg-amber-500/20 text-amber-300",
          summary: "在未了解岗位全貌时，巧妙将薪资话题延后至复试/Offer阶段，避免过早出局。",
          formula: "充分了解岗位职责 ➔ 展现能力匹配 ➔ 将具体定薪延至复试/Offer阶段",
          detailTitle: "延后报价高情商话术",
          detailContent: "初试被逼问时：“在充分了解具体业务痛点与职责前，很难给出一个精确数字。我相信只要我的能力与贵司需求高度匹配，公司一定会给出符合市场水准的合理薪酬。”"
        },
        {
          id: "sal-5",
          topicTitle: "期望薪资",
          title: "整体 Package 拆解与综合福利谈判",
          tag: "综合福利",
          tagBg: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
          icon: "pie_chart",
          iconBg: "bg-emerald-500/20 text-emerald-400",
          summary: "不仅关注基本月薪，更关注年终奖、期权股权、补贴与发展空间，化被动为主动。",
          formula: "基本月薪 + 年终绩效 + 期权补贴 ➔ 看重综合长期回报",
          detailTitle: "Package 综合考量",
          detailContent: "将基本月薪、年终奖系数、期权股票、餐补车补以及年假等福利综合计入包（Total Package）。即使月薪略有折中，也可争取绩效奖金比例或调薪周期条件。"
        },
        {
          id: "sal-6",
          topicTitle: "期望薪资",
          title: "通用 / 产品经理高分示范逐字稿",
          tag: "高分范例",
          tagBg: "bg-indigo-500/20 text-indigo-300 border-indigo-500/30",
          icon: "workspace_premium",
          iconBg: "bg-indigo-500/20 text-indigo-300",
          summary: "“市场调研与过往增长成果 ➔ 25K-30K 弹性区间 ➔ 看重平台愿结合Package灵活沟通”。",
          formula: "调研依据与业绩 ➔ 25K-30K区间 ➔ 表达看重平台与弹性",
          detailTitle: "完整通用/产品经理高分逐字稿",
          detailContent: "“根据我对目前市场上同类岗位的调研，结合我过往在商业化体验与用户增长上的量化成果，我的期望薪资范围在 25K-30K 之间。不过比起单一数字，我更看重贵公司的业务平台与长期发展前景，非常愿意在正式 Offer 阶段结合整体薪酬包（Package）进行灵活沟通。”"
        }
      ]
    }),
    []
  );

  // Etiquette Detail Cards Dictionary (EXACTLY 6 CARDS PER SUB-TAB ACROSS ALL 5 TOPICS!)
  const etiquetteDetailCards: Record<string, DetailCardItem[]> = useMemo(
    () => ({
      "面试前准备": [
        {
          id: "ep-1",
          topicTitle: "面试前准备",
          title: "JD 核心关键词提炼与项目对照",
          tag: "岗位对齐",
          tagBg: "bg-blue-500/20 text-blue-300 border-blue-500/30",
          icon: "fact_check",
          iconBg: "bg-blue-500/20 text-blue-300",
          summary: "提取 JD 中的 3 个核心能力词，梳理简历中最亮点的数据成果进行一对一匹配。",
          formula: "提取 JD 核心词 ➔ 梳理简历数据成果 ➔ 一对一精准匹配",
          detailTitle: "精准复习要点",
          detailContent: "梳理简历中最亮眼的数据与项目战果，对照 JD 提炼面试官最关心的核心业务关键词。"
        },
        {
          id: "ep-2",
          topicTitle: "面试前准备",
          title: "设备与网络调试 (视频/电话)",
          tag: "硬件准备",
          tagBg: "bg-purple-500/20 text-purple-300 border-purple-500/30",
          icon: "videocam",
          iconBg: "bg-purple-500/20 text-purple-300",
          summary: "提前 15 分钟测试摄像头平视视角、有线耳机麦克风与网速，清理背景杂物。",
          formula: "镜头眼睛平视 ➔ 有线耳机防回音 ➔ 背景开启虚化/整理",
          detailTitle: "避免临时故障",
          detailContent: "确保视听设备正常无回音，避免临场因网络抖动或环境杂音扣分。"
        },
        {
          id: "ep-3",
          topicTitle: "面试前准备",
          title: "高质量反问问题清单",
          tag: "结尾加分",
          tagBg: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
          icon: "quiz",
          iconBg: "bg-emerald-500/20 text-emerald-400",
          summary: "准备 2-3 个关于业务痛点、团队发展与战略布局的高质量反问，展现深度思考。",
          formula: "询问团队当前痛点 ➔ 了解未来业务方向 ➔ 展现深层次思考",
          detailTitle: "结尾反问加分项",
          detailContent: "高质量反问能给面试官留下深刻印象，展现你对加入团队的认真态度。"
        },
        {
          id: "ep-4",
          topicTitle: "面试前准备",
          title: "纸质简历与线上环境双重检查",
          tag: "细节规范",
          tagBg: "bg-amber-500/20 text-amber-300 border-amber-500/30",
          icon: "inventory_2",
          iconBg: "bg-amber-500/20 text-amber-300",
          summary: "线下面试打印 3 份纸质简历并提前 15 分钟到场；线上面试关闭所有社交软件弹窗。",
          formula: "打印 3 份纸质简历 ➔ 提前 15 分钟到场 ➔ 关闭社交消息弹窗",
          detailTitle: "环境弹窗清理",
          detailContent: "线上面试务必关闭微信、QQ、钉钉等消息提醒弹窗，防止面试中音效与弹窗干扰沟通。"
        },
        {
          id: "ep-5",
          topicTitle: "面试前准备",
          title: "公司背景与竞品动态调研",
          tag: "功课做足",
          tagBg: "bg-indigo-500/20 text-indigo-300 border-indigo-500/30",
          icon: "travel_explore",
          iconBg: "bg-indigo-500/20 text-indigo-300",
          summary: "通读官网、公众号与近期新闻，了解公司主力产品与主要竞品优劣势，避免假大空。",
          formula: "浏览官网与企业号 ➔ 分析产品与竞品优劣 ➔ 避免生硬背百科",
          detailTitle: "功课调研深度",
          detailContent: "切忌临场生硬背百度百科。了解公司近期重大战略、产品版本迭代与业内评价，谈吐更有底气。"
        },
        {
          id: "ep-6",
          topicTitle: "面试前准备",
          title: "自我心理建构与情绪脱敏",
          tag: "心理准备",
          tagBg: "bg-rose-500/20 text-rose-300 border-rose-500/30",
          icon: "psychology",
          iconBg: "bg-rose-500/20 text-rose-300",
          summary: "将面试视为平等交流与同频探讨，而非单向拷问，提前做深呼吸脱敏练习。",
          formula: "平视双向交流 ➔ 消除被拷问感 ➔ 深呼吸平复紧张情绪",
          detailTitle: "心理脱敏技巧",
          detailContent: "记住面试是双向选择，将考官视为未来探讨合作的同事而非考官。提前 10 分钟做腹式呼吸平复心态。"
        }
      ],
      "视频面试礼仪": [
        {
          id: "ev-1",
          topicTitle: "视频面试礼仪",
          title: "镜头高度与视觉黄金比例",
          tag: "视觉呈现",
          tagBg: "bg-purple-500/20 text-purple-300 border-purple-500/30",
          icon: "videocam",
          iconBg: "bg-purple-500/20 text-purple-300",
          summary: "摄像头高度保持与眼睛平视，画面留白占上半身 60%，避免俯视压迫或仰视镜头。",
          formula: "镜头眼睛平视 ➔ 上半身占比60% ➔ 避免俯视/仰视压迫感",
          detailTitle: "视觉舒适度提升",
          detailContent: "避免俯视或仰视产生压迫感，整洁环境能直观传递出稳重有条理的职业形象。"
        },
        {
          id: "ev-2",
          topicTitle: "视频面试礼仪",
          title: "面部灯光与环境布景标准",
          tag: "光线环境",
          tagBg: "bg-amber-500/20 text-amber-300 border-amber-500/30",
          icon: "light_mode",
          iconBg: "bg-amber-500/20 text-amber-300",
          summary: "选择光线充足的顺光环境，背靠白墙或简洁书架，背景开启适度虚化。",
          formula: "顺光打面部 ➔ 背景简洁干净 ➔ 适度开启虚化",
          detailTitle: "灯光布景技巧",
          detailContent: "避免逆光黑脸或杂乱无章的房间背景。充足的光线能提高画质，提升面试官的视觉舒适度。"
        },
        {
          id: "ev-3",
          topicTitle: "视频面试礼仪",
          title: "音频体验与防回音降噪",
          tag: "音频品质",
          tagBg: "bg-blue-500/20 text-blue-300 border-blue-500/30",
          icon: "headphones",
          iconBg: "bg-blue-500/20 text-blue-300",
          summary: "佩戴有线耳机消除回音杂音，测试麦克风音量，回答间隙保持呼吸平稳。",
          formula: "佩戴有线耳机 ➔ 音量平稳无杂音 ➔ 回答间隙防喘息声",
          detailTitle: "无杂音顺畅沟通",
          detailContent: "良好的音质能大幅提升沟通效率，让面试官专注听你的专业回答。"
        },
        {
          id: "ev-4",
          topicTitle: "视频面试礼仪",
          title: "商务休闲着装与整体仪表",
          tag: "职业形象",
          tagBg: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
          icon: "checkroom",
          iconBg: "bg-emerald-500/20 text-emerald-400",
          summary: "即使居家面试也要穿着正规商务休闲上衣，发型整洁，展现饱满精神面貌。",
          formula: "正规商务休闲上衣 ➔ 发型整洁得体 ➔ 心理进入职业状态",
          detailTitle: "第一印象打造",
          detailContent: "得体的着装不仅是对面试官的尊重，更能帮你在心理上快速进入职场状态。"
        },
        {
          id: "ev-5",
          topicTitle: "视频面试礼仪",
          title: "突发网络中断与临时应变",
          tag: "应急预案",
          tagBg: "bg-rose-500/20 text-rose-300 border-rose-500/30",
          icon: "signal_cellular_connected_no_internet_4_bar",
          iconBg: "bg-rose-500/20 text-rose-300",
          summary: "备好手机 5G 热点，遇卡顿冷静告知面试官：“不好意思镜头有点卡顿，我重连热点”。",
          formula: "准备手机热点 ➔ 遇卡顿沉着告知 ➔ 展现从容抗压素质",
          detailTitle: "突发状况冷静处理",
          detailContent: "遇到卡顿切忌慌张断开。冷静沉着应对突发故障，本身就是展示抗压能力的机会。"
        },
        {
          id: "ev-6",
          topicTitle: "视频面试礼仪",
          title: "视线聚焦镜头而非屏幕画中画",
          tag: "视线管理",
          tagBg: "bg-indigo-500/20 text-indigo-300 border-indigo-500/30",
          icon: "center_focus_strong",
          iconBg: "bg-indigo-500/20 text-indigo-300",
          summary: "回答时眼神看向摄像头物理圆点（而非屏幕下方的考官画面），建立真实眼神对视。",
          formula: "看摄像头物理圆点 ➔ 建立物理眼神对视 ➔ 避免总往低处看画中画",
          detailTitle: "视线聚焦技巧",
          detailContent: "看屏幕上的考官在对方看来实际上是在下视或看别处。看向摄像头圆点能建立真实的眼神交流。"
        }
      ],
      "沟通与表达": [
        {
          id: "ec-1",
          topicTitle: "沟通与表达",
          title: "PREP / STAR 结构化表达模型",
          tag: "逻辑框架",
          tagBg: "bg-indigo-500/20 text-indigo-300 border-indigo-500/30",
          icon: "chat_bubble",
          iconBg: "bg-indigo-500/20 text-indigo-300",
          summary: "开门见山先说结论 (Point)，再阐述背景 (Reason/Situation) 与动作成果。",
          formula: "先说结论 (P) ➔ 阐述背景动作 ➔ 总结数据成果",
          detailTitle: "逻辑清晰有条理",
          detailContent: "开门见山先说结论，避免思维跳跃或啰嗦绕圈，大幅降低沟通成本。"
        },
        {
          id: "ec-2",
          topicTitle: "沟通与表达",
          title: "黄金语速与思考停顿控制",
          tag: "节奏掌控",
          tagBg: "bg-purple-500/20 text-purple-300 border-purple-500/30",
          icon: "speed",
          iconBg: "bg-purple-500/20 text-purple-300",
          summary: "语速控制在 220-260 字/分钟，面试官提问后停顿 2 秒思考切勿抢话打断。",
          formula: "语速220-260字/分 ➔ 停顿2秒思考 ➔ 绝不抢话打断",
          detailTitle: "成熟从容的气场",
          detailContent: "停顿2秒思考展现沉稳抗压，避免仓促作答产生口误。"
        },
        {
          id: "ec-3",
          topicTitle: "沟通与表达",
          title: "结构化逻辑连接词运用",
          tag: "表达层次",
          tagBg: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
          icon: "format_list_numbered",
          iconBg: "bg-emerald-500/20 text-emerald-400",
          summary: "善用“第一核心点、第二攻坚动作、总结来说”做层级划分，方便考官记录。",
          formula: "第一核心点 ➔ 第二攻坚动作 ➔ 总结效果",
          detailTitle: "便于听众抓重点",
          detailContent: "连接词能帮面试官在笔记中记录 key point，极大提升表达吸引力。"
        },
        {
          id: "ec-4",
          topicTitle: "沟通与表达",
          title: "积极倾听与关键信息确认",
          tag: "倾听技巧",
          tagBg: "bg-blue-500/20 text-blue-300 border-blue-500/30",
          icon: "hearing",
          iconBg: "bg-blue-500/20 text-blue-300",
          summary: "听题时微微点头回应，若问题含糊可礼貌确认：“您指的是XX方向的策略吗？”",
          formula: "点头积极回应 ➔ 疑问礼貌确认 ➔ 精准答其所问",
          detailTitle: "双向沟通确认",
          detailContent: "如果不确定面试官具体问什么，礼貌确认能避免偏题，同时体现沟通细致度。"
        },
        {
          id: "ec-5",
          topicTitle: "沟通与表达",
          title: "去口头禅与成熟用词修饰",
          tag: "语言修养",
          tagBg: "bg-rose-500/20 text-rose-300 border-rose-500/30",
          icon: "record_voice_over",
          iconBg: "bg-rose-500/20 text-rose-300",
          summary: "消除“那个、然后、对吧”等无意义口头禅，用确定性词汇替代“大概、好像”。",
          formula: "消除无意义口头禅 ➔ 确定性用词 ➔ 展现稳重修养",
          detailTitle: "用词修饰习惯",
          detailContent: "频繁的口头禅会让表达显得稚嫩。练习用适度停顿替代口头禅，展现干练成熟。"
        },
        {
          id: "ec-6",
          topicTitle: "沟通与表达",
          title: "脱敏负面提问与正向价值重构",
          tag: "逆境沟通",
          tagBg: "bg-amber-500/20 text-amber-300 border-amber-500/30",
          icon: "published_with_changes",
          iconBg: "bg-amber-500/20 text-amber-300",
          summary: "面对质疑性提问（如“你好像缺乏A经验”），先肯定考官视角，再顺畅引出迁移优势。",
          formula: "先肯定考官视角 ➔ 引出相关可迁移能力 ➔ 避免正面防备式驳斥",
          detailTitle: "逆境高情商化解",
          detailContent: "“您提到的 A 经验确实非常关键。虽然我直接做 A 的时间有限，但我过往在 B 上的增长方法论可以无缝迁移到 A 场景...”"
        }
      ],
      "肢体语言": [
        {
          id: "eb-1",
          topicTitle: "肢体语言",
          title: "眼神停留与镜头对视比例",
          tag: "目光交流",
          tagBg: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
          icon: "visibility",
          iconBg: "bg-emerald-500/20 text-emerald-400",
          summary: "保持 50%-70% 的时间看向镜头/考官眼睛，思考时眼神微上扬避免飘忽。",
          formula: "50-70% 时间看镜头 ➔ 眼神坚定真诚 ➔ 避免飘忽向下",
          detailTitle: "眼神传递自信",
          detailContent: "良好的眼神交流能直观传递出真诚、自信与专注。"
        },
        {
          id: "eb-2",
          topicTitle: "肢体语言",
          title: "挺拔坐姿与身体微前倾",
          tag: "姿态掌控",
          tagBg: "bg-purple-500/20 text-purple-300 border-purple-500/30",
          icon: "accessibility_new",
          iconBg: "bg-purple-500/20 text-purple-300",
          summary: "上半身保持挺拔，双手自然平放，适度前倾 5° 展现专注与强烈求知欲望。",
          formula: "上半身挺拔 ➔ 双手自然平放 ➔ 适度前倾5°展专注",
          detailTitle: "姿态掌控要点",
          detailContent: "微前倾姿态传递出积极专注的态度，避免瘫靠椅子显得懒散懈怠。"
        },
        {
          id: "eb-3",
          topicTitle: "肢体语言",
          title: "手势配合与幅度控制",
          tag: "手势语言",
          tagBg: "bg-blue-500/20 text-blue-300 border-blue-500/30",
          icon: "front_hand",
          iconBg: "bg-blue-500/20 text-blue-300",
          summary: "配合自然的握拳或计数手势强调核心观点，手势控制在胸前腰部区域。",
          formula: "胸前小幅度手势 ➔ 强调核心观点 ➔ 切忌夸张比划",
          detailTitle: "手势掌控技巧",
          detailContent: "适当的手势能增强语言的说服力与感染力，注意控制幅度切勿过于夸张。"
        },
        {
          id: "eb-4",
          topicTitle: "肢体语言",
          title: "微笑亲和力与面部表情管理",
          tag: "面部亲和",
          tagBg: "bg-amber-500/20 text-amber-300 border-amber-500/30",
          icon: "sentiment_satisfied",
          iconBg: "bg-amber-500/20 text-amber-300",
          summary: "保持自然得体的微笑，即使遇到刁钻考题也保持镇定，传递良好抗压心态。",
          formula: "自然得体微笑 ➔ 镇定面对刁钻题 ➔ 传递良好抗压心态",
          detailTitle: "拉近沟通距离",
          detailContent: "面带微笑回答问题，能有效缓和严肃的面试氛围。"
        },
        {
          id: "eb-5",
          topicTitle: "肢体语言",
          title: "消除负面无意识小动作",
          tag: "避坑指南",
          tagBg: "bg-rose-500/20 text-rose-300 border-rose-500/30",
          icon: "do_not_disturb_on",
          iconBg: "bg-rose-500/20 text-rose-300",
          summary: "绝对禁止抖腿、转笔、频繁摸头发、抠手指或双手抱胸（双手抱胸防备感强）。",
          formula: "❌ 忌抖腿转笔  ❌ 忌频繁摸头发  ❌ 忌双手抱胸防备",
          detailTitle: "小动作警惕",
          detailContent: "小动作会暴露焦虑与不够自信。保持双手平放桌面或自然合拢，展现从容干练。"
        },
        {
          id: "eb-6",
          topicTitle: "肢体语言",
          title: "头部动作与微表情积极反馈",
          tag: "微表情反馈",
          tagBg: "bg-indigo-500/20 text-indigo-300 border-indigo-500/30",
          icon: "mood",
          iconBg: "bg-indigo-500/20 text-indigo-300",
          summary: "考官陈述或补充时适度微微颔首，展现理解与共鸣，避免面部全程无反应。",
          formula: "适度微微颔首 ➔ 展现共鸣与专注 ➔ 避免面部僵硬木讷",
          detailTitle: "颔首反馈技巧",
          detailContent: "当面试官补充信息时，微微颔首能给面试官正向情绪反馈，大幅增强双向互动感。"
        }
      ],
      "面试结束礼仪": [
        {
          id: "ee-1",
          topicTitle: "面试结束礼仪",
          title: "真诚致谢与印象定格",
          tag: "结束致谢",
          tagBg: "bg-rose-500/20 text-rose-300 border-rose-500/30",
          icon: "mark_email_read",
          iconBg: "bg-rose-500/20 text-rose-300",
          summary: "面试结束主动致谢：“非常感谢您今天的交流，让我对团队和业务有了更深认知”。",
          formula: "主动表达感谢 ➔ 总结沟通收获 ➔ 留下真诚印象",
          detailTitle: "有始有终的礼貌",
          detailContent: "“非常感谢您今天的交流，请问后续的面试结果大概会在什么时候通知呢？”"
        },
        {
          id: "ee-2",
          topicTitle: "面试结束礼仪",
          title: "礼貌确认后续流程与通知周期",
          tag: "流程确认",
          tagBg: "bg-purple-500/20 text-purple-300 border-purple-500/30",
          icon: "schedule",
          iconBg: "bg-purple-500/20 text-purple-300",
          summary: "礼貌询问：“请问后续结果大概会在什么时候通知呢？方便我合理安排日程”。",
          formula: "礼貌询问结果通知 ➔ 展现严谨安排 ➔ 切忌逼问HR",
          detailTitle: "流程确认技巧",
          detailContent: "展现出对加入公司的期待与自身日程管理的严谨性，同时显得有礼有节。"
        },
        {
          id: "ee-3",
          topicTitle: "面试结束礼仪",
          title: "线下面试退场礼貌细节",
          tag: "线下面试",
          tagBg: "bg-blue-500/20 text-blue-300 border-blue-500/30",
          icon: "door_front",
          iconBg: "bg-blue-500/20 text-blue-300",
          summary: "离开时将座椅轻轻推回原位，整理桌面垃圾，退出门外时轻手顺关房门。",
          formula: "座椅轻关归位 ➔ 整理桌面 ➔ 退出轻轻关门",
          detailTitle: "体贴细节加分",
          detailContent: "细微的行为举止体现个人素养与职场规范。"
        },
        {
          id: "ee-4",
          topicTitle: "面试结束礼仪",
          title: "24小时内 Thank-you Email 撰写",
          tag: "感谢邮件",
          tagBg: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
          icon: "mail",
          iconBg: "bg-emerald-500/20 text-emerald-400",
          summary: "24小时内给 HR / 面试官发简短邮件，总结面试中的业务共鸣并重申入职渴望。",
          formula: "24小时内发送 ➔ 简述业务共鸣 ➔ 重申入职渴望",
          detailTitle: "二次印象加固",
          detailContent: "真诚的 Thank-you Email 能再次加深面试官对你的好感。"
        },
        {
          id: "ee-5",
          topicTitle: "面试结束礼仪",
          title: "复盘总结与面试记录归档",
          tag: "复盘成长",
          tagBg: "bg-indigo-500/20 text-indigo-300 border-indigo-500/30",
          icon: "edit_note",
          iconBg: "bg-indigo-500/20 text-indigo-300",
          summary: "面试结束后 1 小时内记录考官提出的所有问题与个人未发挥好的地方，持续迭代。",
          formula: "1小时内记录问题 ➔ 分析回答不足 ➔ 持续迭代提升",
          detailTitle: "及时复盘习惯",
          detailContent: "及时记录本次面试的亮点与失误，将每次面试转化为复盘提升的阶梯。"
        },
        {
          id: "ee-6",
          topicTitle: "面试结束礼仪",
          title: "优雅处理拒信与积累长期人脉",
          tag: "长期人脉",
          tagBg: "bg-amber-500/20 text-amber-300 border-amber-500/30",
          icon: "person_add",
          iconBg: "bg-amber-500/20 text-amber-300",
          summary: "即使未获 Offer 也礼貌回复 HR 表示感谢并保持微信联系，将劣势转化为长期人脉。",
          formula: "礼貌优雅回复拒信 ➔ 保持 HR 微信联系 ➔ 积累行业长期人脉",
          detailTitle: "拒信优雅处理",
          detailContent: "“感谢HR老师告知！虽然本次遗憾未合作，但面试收获极大。若未来有合适岗位希望随时保持联系。”高情商处理往往能在补录时获得优先机会。"
        }
      ]
    }),
    []
  );

  // Etiquette Overview List
  const etiquetteList: EtiquetteItem[] = [
    {
      id: "e-prep",
      title: "面试前准备",
      icon: "fact_check",
      iconBg: "bg-blue-500/20 text-blue-300",
      bullets: ["了解公司与岗位", "准备常见问题", "检查设备与环境", "准备问题反问"],
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
      bullets: ["光线充足，背景简洁", "摄像头平视", "网络稳定，设备调试", "着装得体"],
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
      bullets: ["表达清晰，逻辑先行", "多用结构化表达", "控制语速与音量", "适当停顿与倾听"],
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
      bullets: ["保持微笑与眼神交流", "坐姿端正，不要晃动", "手势自如，不要过多", "展现自信与从容"],
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
      bullets: ["感谢面试官", "确认后续流程", "表达合作意愿", "发送感谢信（可选）"],
      details: [
        "面试结束时主动致谢：“非常感谢您今天的交流，让我受益匪浅。”",
        "礼貌询问：“请问后续的面试结果大概会在什么时候通知呢？”",
        "线下面试离开时将椅子推回原位，退出门外轻轻关门",
        "24 小时内可给 HR 发送一封简短真诚的 Thank-you Email"
      ]
    }
  ];

  // Interactive Action Handlers (Calling Backend API!)
  const handleToggleLike = async (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();

    // Optimistic UI Update
    const isCurrentlyLiked = likedIds.includes(id);
    setLikedIds((prev) => {
      const updated = isCurrentlyLiked ? prev.filter((item) => item !== id) : [...prev, id];
      localStorage.setItem("interviewVar_guide_likes", JSON.stringify(updated));
      return updated;
    });

    setFeaturedContentList((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, likes: item.likes + (isCurrentlyLiked ? -1 : 1) } : item
      )
    );

    // Call Backend API
    try {
      await fetch(`${API_BASE}/api/guide/featured/${id}/like`, { method: "POST" });
    } catch (err) {
      console.error("Failed to post like:", err);
    }
  };

  const handleToggleFav = async (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();

    // Optimistic UI Update
    const isCurrentlyFav = favIds.includes(id);
    setFavIds((prev) => {
      const updated = isCurrentlyFav ? prev.filter((item) => item !== id) : [...prev, id];
      localStorage.setItem("interviewVar_guide_favs", JSON.stringify(updated));
      return updated;
    });

    setFeaturedContentList((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, favorites: item.favorites + (isCurrentlyFav ? -1 : 1) } : item
      )
    );

    // Call Backend API
    try {
      await fetch(`${API_BASE}/api/guide/featured/${id}/favorite`, { method: "POST" });
    } catch (err) {
      console.error("Failed to post favorite:", err);
    }
  };

  const handleOpenContentUrl = async (item: FeaturedContentItem) => {
    // Call Backend API to increment read count
    try {
      await fetch(`${API_BASE}/api/guide/featured/${item.id}/read`, { method: "POST" });
    } catch (err) {
      console.error("Failed to post read count:", err);
    }

    setFeaturedContentList((prev) =>
      prev.map((it) => (it.id === item.id ? { ...it, reads: it.reads + 1 } : it))
    );

    window.open(item.url, "_blank");
  };

  // Count of items actually present in featuredContentList that are liked or favorited
  const myLikedCount = useMemo(() => {
    return featuredContentList.filter(
      (item) => likedIds.includes(item.id) || favIds.includes(item.id)
    ).length;
  }, [featuredContentList, likedIds, favIds]);

  // Filtered Display List for "我的喜欢" vs "全部"
  const displayFeaturedList = useMemo(() => {
    let list = featuredContentList.map((item) => ({
      ...item,
      isLiked: likedIds.includes(item.id),
      isFavorited: favIds.includes(item.id),
    }));

    if (selectedSubCategory === "我的喜欢") {
      list = list.filter((item) => item.isLiked || item.isFavorited);
    }

    return list;
  }, [featuredContentList, likedIds, favIds, selectedSubCategory]);

  // Active Questions View Items (Overview vs Detail Cards Breakdown!)
  const currentQuestionCards = useMemo(() => {
    if (questionSubFilter === "全部") {
      let list = popularQuestions;
      if (searchQuery.trim() && activeMainTab === "questions") {
        const q = searchQuery.toLowerCase().trim();
        list = list.filter(
          (item) => item.title.toLowerCase().includes(q) || item.desc.toLowerCase().includes(q)
        );
      }
      return { isOverview: true, items: list, detailItems: [] };
    } else {
      let details = topicDetailCards[questionSubFilter] || [];
      if (searchQuery.trim() && activeMainTab === "questions") {
        const q = searchQuery.toLowerCase().trim();
        details = details.filter(
          (item) =>
            item.title.toLowerCase().includes(q) ||
            item.summary.toLowerCase().includes(q) ||
            item.detailContent.toLowerCase().includes(q)
        );
      }
      return { isOverview: false, items: [], detailItems: details };
    }
  }, [questionSubFilter, searchQuery, popularQuestions, topicDetailCards, activeMainTab]);

  // Active Etiquette View Items (Overview vs Detail Cards Breakdown!)
  const currentEtiquetteCards = useMemo(() => {
    if (etiquetteSubFilter === "全部") {
      let list = etiquetteList;
      if (searchQuery.trim() && activeMainTab === "etiquette") {
        const q = searchQuery.toLowerCase().trim();
        list = list.filter(
          (item) =>
            item.title.toLowerCase().includes(q) ||
            item.bullets.some((b) => b.toLowerCase().includes(q))
        );
      }
      return { isOverview: true, items: list, detailItems: [] };
    } else {
      let details = etiquetteDetailCards[etiquetteSubFilter] || [];
      if (searchQuery.trim() && activeMainTab === "etiquette") {
        const q = searchQuery.toLowerCase().trim();
        details = details.filter(
          (item) =>
            item.title.toLowerCase().includes(q) ||
            item.summary.toLowerCase().includes(q) ||
            item.detailContent.toLowerCase().includes(q)
        );
      }
      return { isOverview: false, items: [], detailItems: details };
    }
  }, [etiquetteSubFilter, searchQuery, etiquetteList, etiquetteDetailCards, activeMainTab]);

  // Modal Handlers
  const handleOpenDetailModal = (item: DetailCardItem) => {
    setModalData({
      type: "question",
      title: `${item.topicTitle} · ${item.title}`,
      content: (
        <div className="space-y-5 text-left text-sm">
          <div className="p-3.5 rounded-xl bg-purple-50 dark:bg-purple-500/10 border border-purple-200 dark:border-purple-500/20 modal-box-purple">
            <h5 className="font-extrabold text-purple-900 dark:text-purple-300 mb-1 flex items-center gap-1.5 modal-purple-title">
              <span className="material-symbols-outlined text-base modal-purple-icon text-purple-600 dark:text-purple-300">lightbulb</span>
              {item.detailTitle}
            </h5>
            <p className="text-slate-900 dark:text-white/80 font-bold leading-relaxed">{item.detailContent}</p>
          </div>

          <div className="space-y-2">
            <h5 className="font-extrabold text-slate-900 dark:text-white/90 flex items-center gap-1.5">
              <span className="material-symbols-outlined text-base text-amber-500 dark:text-amber-400 modal-amber-icon">auto_awesome</span>
              核心公式与逻辑
            </h5>
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white/90 text-xs leading-relaxed font-extrabold modal-box-slate">
              {item.formula}
            </div>
          </div>

          {item.goodExample && (
            <div className="space-y-2">
              <h5 className="font-extrabold text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5 modal-emerald-title">
                <span className="material-symbols-outlined text-base modal-emerald-icon text-emerald-600 dark:text-emerald-400">check_circle</span>
                推荐实践范例
              </h5>
              <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-500/5 border border-emerald-200 dark:border-emerald-500/20 text-emerald-950 dark:text-white/80 text-xs leading-relaxed font-bold modal-box-emerald">
                {item.goodExample}
              </div>
            </div>
          )}

          {item.badExample && (
            <div className="space-y-2">
              <h5 className="font-extrabold text-rose-700 dark:text-[#FF7A95] flex items-center gap-1.5 modal-rose-title">
                <span className="material-symbols-outlined text-base modal-rose-icon text-rose-600 dark:text-[#FF7A95]">cancel</span>
                反面减分例子
              </h5>
              <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-[#FF7A95]/5 border border-rose-200 dark:border-[#FF7A95]/20 text-rose-950 dark:text-white/70 text-xs leading-relaxed font-bold modal-box-rose">
                {item.badExample}
              </div>
            </div>
          )}
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
            className="text-2xl font-display-xl font-bold tracking-tight text-on-surface flex items-center gap-3 cursor-pointer"
          >
            <img src="/logo/logo_icon.svg" alt="面试驾到" className="w-11 h-11 object-contain" />
            面试驾到
          </div>

          {/* Nav Items */}
          <div className="absolute left-1/2 -translate-x-1/2 hidden md:flex items-center gap-3 lg:gap-5 xl:gap-8 whitespace-nowrap">
            <a onClick={() => router.push("/debugger")} className="text-on-surface-variant hover:text-on-surface transition-colors text-[15px] lg:text-[16px] xl:text-[17px] font-extrabold cursor-pointer whitespace-nowrap shrink-0">
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
            <a onClick={() => router.push("/guide")} className="text-primary transition-colors text-[15px] lg:text-[16px] xl:text-[17px] font-extrabold cursor-pointer relative whitespace-nowrap shrink-0 after:content-[''] after:absolute after:bottom-[-26px] after:left-0 after:right-0 after:h-[2px] after:bg-primary">
              面试指南
            </a>
            <a onClick={() => router.push("/feedback")} className="text-on-surface-variant hover:text-on-surface transition-colors text-[15px] lg:text-[16px] xl:text-[17px] font-extrabold cursor-pointer whitespace-nowrap shrink-0">
              体验反馈中心
            </a>
            <a onClick={() => window.open("/helper", "_blank")} className="text-on-surface-variant hover:text-on-surface transition-colors text-[15px] lg:text-[16px] xl:text-[17px] font-extrabold cursor-pointer whitespace-nowrap shrink-0">
              帮助中心
            </a>
          </div>

          {/* Right Action buttons */}
          <div className="flex items-center gap-4">
            {auth.isLoggedIn && (
              <button
                onClick={() => router.push("/memory?tab=timeline")}
                className="px-4.5 py-2 bg-white/5 border border-white/10 rounded-full text-sm font-bold text-on-surface hover:bg-white/10 transition-all flex items-center gap-1.5 cursor-pointer"
              >
                <span className="material-symbols-outlined text-base">history</span>历史记录
              </button>
            )}
            <ThemeToggle />
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

      {/* MAIN CONTAINER (WORKSPACE & BOTTOM PRACTICE BANNER) */}
      <div className="flex-1 max-w-container-max mx-auto w-full px-gutter py-8 space-y-8 relative z-10 text-left">
        
        {/* TOP TWO-COLUMN SECTION (SIDEBAR & RIGHT CONTENT ALIGNED AT BOTTOM) */}
        <div className="flex flex-col lg:flex-row gap-8 items-stretch">
          
          {/* ========================================================
              LEFT SIDEBAR NAVIGATION (EXPANDS VERTICALLY TO ALIGN BOTTOM WITH RIGHT CARDS!)
             ======================================================== */}
          <aside className="w-full lg:w-[280px] shrink-0 flex flex-col justify-between space-y-6">
            <div className="space-y-6 flex-1 flex flex-col">
              
              {/* Header Card */}
              <div className="glass-panel p-5 rounded-2xl border-white/10 space-y-2 bg-white/[0.02]">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-purple-500/20 border border-purple-500/30 flex items-center justify-center text-purple-300">
                    <span className="material-symbols-outlined text-xl">menu_book</span>
                  </div>
                  <div>
                    <h3 className="text-lg font-black text-white">面试指南</h3>
                    <p className="text-xs text-on-surface-variant/50 font-bold">系统掌握面试每一个关键细节</p>
                  </div>
                </div>
              </div>

              {/* Sidebar Main Tabs Group (flex-1 to match height) */}
              <div className="glass-panel p-4 rounded-2xl border-white/10 space-y-5 bg-white/[0.01] flex-1 flex flex-col justify-start">
                
                {/* MAIN TAB 1: 精选推荐 */}
                <div>
                  <button
                    onClick={() => {
                      setActiveMainTab("featured");
                      setActiveSidebarItem("精选推荐");
                    }}
                    className={`w-full px-4 py-3.5 rounded-2xl text-base font-black transition-all flex items-center justify-between cursor-pointer min-h-[56px] ${
                      activeMainTab === "featured"
                        ? "bg-gradient-to-r from-purple-600/35 to-indigo-600/35 text-white border border-purple-500/50 shadow-xl shadow-purple-500/15 font-black"
                        : "text-white/80 hover:text-white hover:bg-white/5 border border-transparent"
                    }`}
                  >
                    <span className="flex items-center gap-3">
                      <img src="/guide/recommation.svg" alt="精选推荐" className="w-6 h-6 object-contain shrink-0" />
                      <span className="text-base font-black">精选推荐</span>
                    </span>
                    <span className="px-2.5 py-1 rounded-full bg-purple-500/25 text-purple-300 text-xs font-black tracking-wider uppercase">HOT</span>
                  </button>
                </div>

                {/* MAIN TAB 2: 通用问题回答 */}
                <div className="space-y-2 pt-3 border-t border-white/5">
                  <div
                    onClick={() => {
                      setActiveMainTab("questions");
                      setQuestionSubFilter("全部");
                    }}
                    className={`w-full px-3.5 py-2.5 rounded-xl text-base font-black tracking-wider transition-all flex items-center justify-between cursor-pointer ${
                      activeMainTab === "questions"
                        ? "bg-primary/20 text-primary border border-primary/30 font-black shadow-md shadow-primary/10"
                        : "text-white/80 hover:text-white hover:bg-white/5 border border-transparent"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-base text-primary">forum</span>
                      通用问题回答
                    </span>
                    <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-extrabold">5 大考题</span>
                  </div>

                  <div className="space-y-1 pl-2 pt-1">
                    {popularQuestions.map(q => (
                      <button
                        key={q.id}
                        onClick={() => {
                          setActiveMainTab("questions");
                          setQuestionSubFilter(q.title);
                          setActiveSidebarItem(q.title);
                        }}
                        className={`w-full px-3 py-2 rounded-xl text-sm font-bold transition-all flex items-center justify-between cursor-pointer ${
                          activeMainTab === "questions" && questionSubFilter === q.title
                            ? "bg-primary/15 text-primary border border-primary/20 font-black"
                            : "text-white/60 hover:text-white hover:bg-white/5"
                        }`}
                      >
                        <span className="flex items-center gap-2 truncate">
                          <span className="w-1.5 h-1.5 rounded-full bg-primary/60 shrink-0" />
                          {q.title}
                        </span>
                        <span className="material-symbols-outlined text-xs opacity-40 shrink-0">chevron_right</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* MAIN TAB 3: 面试礼仪与行为 */}
                <div className="space-y-2 pt-3 border-t border-white/5">
                  <div
                    onClick={() => {
                      setActiveMainTab("etiquette");
                      setEtiquetteSubFilter("全部");
                    }}
                    className={`w-full px-3.5 py-2.5 rounded-xl text-base font-black tracking-wider transition-all flex items-center justify-between cursor-pointer ${
                      activeMainTab === "etiquette"
                        ? "bg-blue-500/20 text-blue-300 border border-blue-400/30 font-black shadow-md shadow-blue-500/10"
                        : "text-white/80 hover:text-white hover:bg-white/5 border border-transparent"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-base text-blue-300">workspace_premium</span>
                      面试礼仪与行为
                    </span>
                    <span className="px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-300 text-xs font-extrabold">规范要点</span>
                  </div>

                  <div className="space-y-1 pl-2 pt-1">
                    {etiquetteList.map(e => (
                      <button
                        key={e.id}
                        onClick={() => {
                          setActiveMainTab("etiquette");
                          setEtiquetteSubFilter(e.title);
                          setActiveSidebarItem(e.title);
                        }}
                        className={`w-full px-3 py-2 rounded-xl text-sm font-bold transition-all flex items-center justify-between cursor-pointer ${
                          activeMainTab === "etiquette" && etiquetteSubFilter === e.title
                            ? "bg-blue-500/15 text-blue-300 border border-blue-400/20 font-black"
                            : "text-white/60 hover:text-white hover:bg-white/5"
                        }`}
                      >
                        <span className="flex items-center gap-2 truncate">
                          <span className="w-1.5 h-1.5 rounded-full bg-blue-400/60 shrink-0" />
                          {e.title}
                        </span>
                        <span className="material-symbols-outlined text-xs opacity-40 shrink-0">chevron_right</span>
                      </button>
                    ))}
                  </div>
                </div>

              </div>
            </div>
          </aside>

          {/* ========================================================
              RIGHT MAIN CONTENT AREA (DEDICATED PANEL PER TAB)
             ======================================================== */}
          <main className="flex-1 space-y-6 min-w-0 flex flex-col justify-between">
            
            {/* PANEL 1: 精选推荐 (FEATURED CONTENT VIEW) - BG: /guide/note.jpg WITH REAL DB PAGINATION */}
            {activeMainTab === "featured" && (
              <div className="space-y-6">
                
                {/* HERO HEADER & SEARCH BANNER (BG: /guide/note.jpg WITH HOVER SCALE!) */}
                <div className="glass-panel p-6 sm:p-8 rounded-3xl border-white/15 relative overflow-hidden flex flex-col justify-between gap-6 group cursor-default shadow-2xl">
                  {/* Background Image: /guide/note.jpg */}
                  <div
                    className="absolute inset-0 bg-cover bg-center opacity-80 group-hover:scale-105 transition-transform duration-700 pointer-events-none"
                    style={{ backgroundImage: "url('/guide/note.jpg')" }}
                  />
                  <div className="absolute inset-0 bg-gradient-to-r from-[#0b0f19]/85 via-[#0b0f19]/50 to-transparent pointer-events-none" />

                  <div className="space-y-3 max-w-2xl text-left z-10 relative">
                    <div>
                      <h1 className="text-2xl sm:text-3xl font-black !text-white banner-title tracking-tight flex items-center gap-2 drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]">
                        精选内容推荐
                      </h1>
                      <p className="text-xs sm:text-sm !text-white/95 banner-desc font-bold mt-1 leading-relaxed drop-shadow-[0_1px_4px_rgba(0,0,0,0.8)]">
                        来自小红书、抖音优质博主的面试经验分享，帮你提升面试表现
                      </p>
                    </div>

                    {/* Search Box */}
                    <div className="relative pt-1">
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="搜索问题、文章或博主..."
                        className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-slate-900/90 border border-slate-300 dark:border-white/15 rounded-xl text-xs sm:text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-white/40 focus:outline-none focus:border-indigo-600 dark:focus:border-primary/60 transition-all shadow-sm font-bold"
                      />
                      <span className="material-symbols-outlined absolute left-3 top-[14px] text-slate-500 dark:text-white/40 text-base guide-search-icon" aria-hidden="true" data-nosnippet>
                        search
                      </span>
                      {searchQuery && (
                        <button
                          onClick={() => setSearchQuery("")}
                          className="absolute right-3 top-[14px] text-slate-500 dark:text-white/40 hover:text-slate-900 dark:hover:text-white text-xs font-bold"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* SUB-CATEGORY FILTER BAR & SORTING (ONLY KEEP "全部" AND "我的喜欢") */}
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-white/5 pb-4">
                  
                  {/* Filter Pills: Only "全部" and "我的喜欢" */}
                  <div className="flex flex-wrap items-center gap-2 text-sm select-none">
                    {["全部", "我的喜欢"].map((subCat) => {
                      const isSelected = selectedSubCategory === subCat;
                      const isFavTab = subCat === "我的喜欢";
                      return (
                        <button
                          key={subCat}
                          onClick={() => setSelectedSubCategory(subCat)}
                          className={`px-3 py-1.5 rounded-xl font-bold transition-all cursor-pointer flex items-center gap-1 ${
                            isSelected
                              ? isFavTab
                                ? "bg-[#FF7A95] text-white font-black shadow-lg shadow-[#FF7A95]/20 scale-105"
                                : "bg-primary text-on-primary font-black shadow-lg shadow-primary/20 scale-105"
                              : isFavTab
                              ? "bg-[#FF7A95]/10 text-[#FF7A95] border border-[#FF7A95]/30 hover:bg-[#FF7A95]/20"
                              : "bg-white/5 text-white/70 hover:text-white hover:bg-white/10 border border-white/5"
                          }`}
                        >
                          {isFavTab && <span className="material-symbols-outlined text-xs fill-current" aria-hidden="true" data-nosnippet>favorite</span>}
                          {subCat}
                          {isFavTab && myLikedCount > 0 && (
                            <span className="px-2 py-0.5 text-xs font-mono font-bold rounded-full bg-white/20 ml-1">
                              {myLikedCount}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>

                  {/* Right Sort Selector & Layout Icon */}
                  <div className="flex items-center gap-3 shrink-0 self-end sm:self-auto text-xs">
                    <select
                      value={sortBy}
                      onChange={(e) => setSortBy(e.target.value as any)}
                      className="bg-[#0f172a] text-white border border-white/20 rounded-xl px-3 py-1.5 text-sm font-bold focus:outline-none cursor-pointer shadow-sm"
                    >
                      <option value="latest">最新发布</option>
                      <option value="likes">最多点赞</option>
                      <option value="favs">最多收藏</option>
                      <option value="reads">最多阅读</option>
                    </select>

                    <div className="flex items-center gap-1 bg-white/5 p-1 rounded-xl border border-white/10">
                      <button className="w-6 h-6 rounded-lg bg-white/10 text-white flex items-center justify-center">
                        <span className="material-symbols-outlined text-xs">grid_view</span>
                      </button>
                    </div>
                  </div>

                </div>

                {/* CONTENT CARDS GRID / EMPTY STATE (min-h-[580px] to align bottom edge with left sidebar!) */}
                {isLoadingFeatured ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 flex-1 min-h-[580px]">
                    {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                      <div key={n} className="glass-panel h-64 rounded-2xl border-white/5 animate-pulse bg-white/[0.02]" />
                    ))}
                  </div>
                ) : displayFeaturedList.length === 0 ? (
                  <div className="glass-panel p-12 rounded-3xl border-slate-200 dark:border-white/5 text-center space-y-4 flex-1 flex flex-col items-center justify-center min-h-[580px] bg-white dark:bg-white/[0.02]">
                    <span className="material-symbols-outlined !text-5xl text-rose-400 dark:text-rose-400/60 guide-empty-heart">favorite_border</span>
                    <p className="text-xl font-bold text-slate-700 dark:text-white/60">您尚未收藏任何精选内容</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 flex-1 items-start min-h-[580px]">
                    {displayFeaturedList.map((item) => (
                      <div
                        key={item.id}
                        onClick={() => handleOpenContentUrl(item)}
                        className="glass-panel rounded-2xl border-white/10 overflow-hidden hover:border-primary/40 transition-all duration-300 group cursor-pointer flex flex-col justify-between text-left bg-white/[0.02] hover:bg-white/[0.04] shadow-lg hover:shadow-2xl hover:-translate-y-1"
                      >
                        <div>
                          {/* Cover Image Container */}
                          <div className="aspect-[16/10] relative overflow-hidden bg-slate-900">
                            <img
                              src={item.coverImg}
                              alt={item.title}
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                            />
                            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/20" />

                            {/* Top Left Platform SVG Icon (Replacing text badge per user request) */}
                            <div className="absolute top-2.5 left-2.5 z-10">
                              {item.platform === "小红书" ? (
                                <img src="/guide/redbook.svg" alt="小红书" className="w-8 h-8 object-contain drop-shadow-md rounded-md" />
                              ) : item.platform === "抖音" ? (
                                <img src="/guide/douyin.svg" alt="抖音" className="w-8 h-8 object-contain drop-shadow-md rounded-md" />
                              ) : (
                                <span className={`px-2 py-0.5 rounded-md text-[10px] font-black border backdrop-blur-md ${item.platformBadgeBg}`}>
                                  {item.platform}
                                </span>
                              )}
                            </div>

                            {/* Bottom Right Duration Badge */}
                            {item.duration && (
                              <div className="absolute bottom-2.5 right-2.5">
                                <span className="px-2 py-0.5 rounded-md bg-black/60 text-white/90 text-[10px] font-mono font-bold backdrop-blur-md">
                                  {item.duration}
                                </span>
                              </div>
                            )}
                          </div>

                          {/* Title + Author Row (with optional big-V verified badge on the right) */}
                          <div className="p-4 space-y-2">
                            {/* Author Row: username on the left, big-V on the right (no avatar) */}
                            {item.author && (
                              <div className="flex items-center gap-1.5 text-base text-white/85 font-extrabold">
                                <span className="truncate">{item.author}</span>
                                {item.authorVerified && (
                                  <img
                                    src="/guide/big-V.svg"
                                    alt="大V认证"
                                    title="大V认证"
                                    className="w-5 h-5 object-contain shrink-0 drop-shadow-sm -translate-y-[1px]"
                                  />
                                )}
                              </div>
                            )}
                            <h4 className="text-sm font-black text-white group-hover:text-primary transition-colors line-clamp-2 leading-snug">
                              {item.title}
                            </h4>
                          </div>
                        </div>

                        {/* Footer Metrics Row (Reads, Likes, Favorites - Bigger Font Size & High-Contrast Colors) */}
                        <div className="px-4 py-3 bg-black/30 border-t border-white/5 flex items-center justify-between text-sm select-none">
                          {/* Reads Count */}
                          <span className="flex items-center gap-1.5 text-xs text-white/60 font-mono font-bold" title="阅读量">
                            <span className="material-symbols-outlined text-base">visibility</span>
                            <span className="text-sm text-white/90 font-mono font-bold">{formatCount(item.reads)}</span>
                          </span>

                          <div className="flex items-center gap-4">
                            {/* Like Button */}
                            <button
                              onClick={(e) => handleToggleLike(item.id, e)}
                              className={`flex items-center gap-1.5 font-mono font-bold transition-all hover:scale-110 active:scale-95 ${
                                item.isLiked ? "text-amber-400 font-black" : "text-white/60 hover:text-amber-300"
                              }`}
                              title={item.isLiked ? "已点赞" : "点赞"}
                            >
                              <span className={`material-symbols-outlined text-lg ${item.isLiked ? "fill-current" : ""}`}>
                                thumb_up
                              </span>
                              <span className="text-sm font-mono font-bold">{formatCount(item.likes)}</span>
                            </button>

                            {/* Favorite Button */}
                            <button
                              onClick={(e) => handleToggleFav(item.id, e)}
                              className={`flex items-center gap-1.5 font-mono font-bold transition-all hover:scale-110 active:scale-95 ${
                                item.isFavorited ? "text-[#FF7A95] font-black" : "text-white/60 hover:text-[#FF7A95]"
                              }`}
                              title={item.isFavorited ? "已收藏" : "收藏"}
                            >
                              <span className={`material-symbols-outlined text-lg ${item.isFavorited ? "fill-current" : ""}`}>
                                favorite
                              </span>
                              <span className="text-sm font-mono font-bold">{formatCount(item.favorites)}</span>
                            </button>
                          </div>
                        </div>

                      </div>
                    ))}
                  </div>
                )}

                {/* REAL DATABASE PAGINATION BAR (分析时间轴同款样式) */}
                {totalItems > 0 && (() => {
                  const pageList = buildPageList(currentPage, totalPages);
                  return (
                    <div className="mt-8 pt-6 border-t border-white/5 flex items-center justify-between font-label-mono text-xs text-on-surface-variant/50 w-full select-none">
                      <span>共 {totalItems} 条记录</span>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                          disabled={currentPage <= 1}
                          className={`px-2.5 py-1 rounded border border-white/5 ${
                            currentPage <= 1
                              ? "bg-white/5 text-white/50 hover:bg-white/10 cursor-not-allowed"
                              : "bg-white/5 hover:bg-white/10 cursor-pointer"
                          }`}
                        >
                          &lt;
                        </button>
                        {pageList.map((p, idx) =>
                          p === "…" ? (
                            <span key={`e-${idx}`} className="px-2.5 py-1 text-on-surface-variant/40">…</span>
                          ) : (
                            <button
                              key={p}
                              onClick={() => setCurrentPage(p)}
                              className={`px-2.5 py-1 rounded cursor-pointer ${
                                currentPage === p
                                  ? "bg-primary text-on-primary font-bold"
                                  : "bg-white/5 hover:bg-white/10 border border-white/5"
                              }`}
                            >
                              {p}
                            </button>
                          )
                        )}
                        <button
                          onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                          disabled={currentPage >= totalPages}
                          className={`px-2.5 py-1 rounded border border-white/5 ${
                            currentPage >= totalPages
                              ? "bg-white/5 text-white/50 hover:bg-white/10 cursor-not-allowed"
                              : "bg-white/5 hover:bg-white/10 cursor-pointer"
                          }`}
                        >
                          &gt;
                        </button>
                      </div>
                    </div>
                  );
                })()}

              </div>
            )}

            {/* PANEL 2: 通用问题回答 (BG: /guide/question.jpg WITH HOVER SCALE) */}
            {activeMainTab === "questions" && (
              <div className="space-y-6 text-left">
                
                {/* HERO HEADER BANNER (WITH BACKGROUND /guide/question.jpg) */}
                <div className="glass-panel p-6 sm:p-8 rounded-3xl border-white/15 relative overflow-hidden flex flex-col justify-between gap-6 group cursor-default shadow-2xl">
                  {/* Background Image: /guide/question.jpg */}
                  <div
                    className="absolute inset-0 bg-cover bg-center opacity-80 group-hover:scale-105 transition-transform duration-700 pointer-events-none"
                    style={{ backgroundImage: "url('/guide/question.jpg')" }}
                  />
                  <div className="absolute inset-0 bg-gradient-to-r from-[#0b0f19]/85 via-[#0b0f19]/50 to-transparent pointer-events-none" />

                  <div className="space-y-3 max-w-2xl text-left z-10 relative">
                    <div>
                      <h1 className="text-2xl sm:text-3xl font-black !text-white banner-title tracking-tight flex items-center gap-2 drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]">
                        {questionSubFilter === "全部" ? "通用问题回答指南" : `${questionSubFilter} 深度指南`}
                      </h1>
                      <p className="text-sm !text-white/95 banner-desc font-bold mt-1.5 leading-relaxed drop-shadow-[0_1px_4px_rgba(0,0,0,0.8)]">
                        {questionSubFilter === "全部"
                          ? "精选 5 大高频通用面试难题拆解，掌握结构化黄金公式、优秀回答示范与避坑指南"
                          : `将“${questionSubFilter}”拆解为 6 张核心解析卡片，包含时间分配、表达要点、满分范例与避坑陷阱`}
                      </p>
                    </div>

                    {/* Search Box */}
                    <div className="relative pt-1">
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder={`搜索${questionSubFilter === "全部" ? "通用问题" : questionSubFilter}要点...`}
                        className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-slate-900/90 border border-slate-300 dark:border-white/15 rounded-xl text-xs sm:text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-white/40 focus:outline-none focus:border-indigo-600 dark:focus:border-primary/60 transition-all shadow-sm font-bold"
                      />
                      <span className="material-symbols-outlined absolute left-3 top-[14px] text-slate-500 dark:text-white/40 text-base guide-search-icon">
                        search
                      </span>
                      {searchQuery && (
                        <button
                          onClick={() => setSearchQuery("")}
                          className="absolute right-3 top-[14px] text-slate-500 dark:text-white/40 hover:text-slate-900 dark:hover:text-white text-xs font-bold"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* SUB-CATEGORY FILTER PILLS */}
                <div className="flex flex-wrap items-center gap-2 text-sm select-none border-b border-white/5 pb-4">
                  {["全部", "自我介绍", "离职原因", "职业规划", "为什么选择我们", "期望薪资"].map((qName) => {
                    const isSelected = questionSubFilter === qName;
                    return (
                      <button
                        key={qName}
                        onClick={() => setQuestionSubFilter(qName)}
                        className={`px-3.5 py-1.5 rounded-xl font-bold transition-all cursor-pointer ${
                          isSelected
                            ? "bg-primary text-on-primary font-black shadow-lg shadow-primary/20 scale-105"
                            : "bg-white/5 text-white/70 hover:text-white hover:bg-white/10 border border-white/5"
                        }`}
                      >
                        {qName === "全部" ? "全部问题概览" : qName}
                      </button>
                    );
                  })}
                </div>

                {/* OVERVIEW CARDS GRID (WHEN "全部" IS SELECTED) */}
                {currentQuestionCards.isOverview && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                    {currentQuestionCards.items.map((item) => (
                      <div
                        key={item.id}
                        className="glass-panel p-5 rounded-2xl border-white/10 flex flex-col justify-between text-left hover:border-primary/40 transition-all duration-300 group space-y-4 bg-white/[0.02] hover:bg-white/[0.04] shadow-lg"
                      >
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <div className={`w-10 h-10 rounded-xl border flex items-center justify-center ${item.iconBg}`}>
                              <span className="material-symbols-outlined text-xl">{item.icon}</span>
                            </div>
                            <div className="flex items-center gap-1 text-amber-400">
                              <span className="text-[10px] text-white/40 font-bold mr-1">出现频率</span>
                              {"★".repeat(item.frequency)}
                            </div>
                          </div>

                          <div>
                            <h4 className="text-base font-black text-slate-900 dark:text-white group-hover:text-primary transition-colors">{item.title}</h4>
                            <p className="text-xs text-slate-600 dark:text-white/60 font-medium leading-relaxed mt-1 line-clamp-2">
                              {item.desc}
                            </p>
                          </div>

                          {/* Formula Preview Box */}
                          <div className="p-3 rounded-xl bg-indigo-50/80 dark:bg-purple-500/10 border border-indigo-200/80 dark:border-purple-500/20 text-[11px] text-slate-800 dark:text-purple-200/90 leading-relaxed font-medium">
                            <span className="font-black text-indigo-700 dark:text-purple-300 block mb-0.5">💡 黄金公式：</span>
                            {item.formula}
                          </div>
                        </div>

                        <button
                          onClick={() => {
                            setQuestionSubFilter(item.title);
                          }}
                          className="w-full py-2.5 bg-primary/10 hover:bg-primary text-primary hover:text-on-primary font-black text-xs rounded-xl border border-primary/20 hover:border-primary transition-all cursor-pointer flex items-center justify-center gap-1.5"
                        >
                          <span>查看该主题 6 张卡片细节</span>
                          <span className="material-symbols-outlined text-xs">arrow_forward</span>
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* DETAILED BREAKDOWN CARDS GRID */}
                {!currentQuestionCards.isOverview && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-base font-black text-white flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-primary" />
                        {questionSubFilter} - 专项 6 张卡片解析
                      </h3>
                      <button
                        onClick={() => setQuestionSubFilter("全部")}
                        className="text-xs text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-white font-bold transition-colors cursor-pointer flex items-center gap-1 guide-back-btn"
                      >
                        ← 返回全部问题概览
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                      {currentQuestionCards.detailItems.map((detailCard) => (
                        <div
                          key={detailCard.id}
                          className="glass-panel p-5 rounded-2xl border-slate-200 dark:border-white/10 flex flex-col justify-between text-left hover:border-indigo-600 dark:hover:border-primary/40 transition-all duration-300 group space-y-4 bg-white dark:bg-white/[0.02] hover:bg-slate-50 dark:hover:bg-white/[0.04] shadow-lg"
                        >
                          <div className="space-y-3">
                            <div className="flex items-center justify-between">
                              <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black border ${detailCard.tagBg}`}>
                                {detailCard.tag}
                              </span>
                            </div>

                            <div className="flex items-start gap-3 pt-1">
                              <div className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 ${detailCard.iconBg}`}>
                                <span className="material-symbols-outlined text-lg">{detailCard.icon}</span>
                              </div>
                              <div>
                                <h4 className="text-sm font-black text-slate-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-primary transition-colors leading-snug">
                                  {detailCard.title}
                                </h4>
                                <p className="text-xs text-slate-700 dark:text-white/60 font-bold leading-relaxed mt-1">
                                  {detailCard.summary}
                                </p>
                              </div>
                            </div>

                            {/* Highlight Formula Box */}
                            <div className="p-3 rounded-xl bg-slate-50 dark:bg-white/[0.05] border border-slate-200 dark:border-white/15 text-[11px] leading-relaxed shadow-sm guide-detail-formula-box">
                              <span className="font-black text-slate-900 dark:text-white block mb-1 guide-formula-title">💡 核心点：</span>
                              <span className="font-extrabold text-slate-900 dark:text-white block mt-0.5">{detailCard.formula}</span>
                            </div>
                          </div>

                          <button
                            onClick={() => handleOpenDetailModal(detailCard)}
                            className="w-full py-2.5 bg-indigo-100 hover:bg-indigo-600 dark:bg-white/5 dark:hover:bg-primary/20 text-indigo-800 hover:text-white dark:text-white/80 dark:hover:text-primary font-black text-sm rounded-xl border border-indigo-200 dark:border-white/10 hover:border-indigo-600 dark:hover:border-primary/30 transition-all cursor-pointer flex items-center justify-center gap-1 shadow-sm guide-detail-btn"
                          >
                            <span>查看完整指导细节</span>
                            <span className="material-symbols-outlined text-xs">open_in_new</span>
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

              </div>
            )}

            {/* PANEL 3: 面试礼仪与行为 (BG: /guide/polite.jpg WITH HOVER SCALE!) */}
            {activeMainTab === "etiquette" && (
              <div className="space-y-6 text-left">
                
                {/* HERO HEADER BANNER (WITH BACKGROUND /guide/polite.jpg!) */}
                <div className="glass-panel p-6 sm:p-8 rounded-3xl border-white/15 relative overflow-hidden flex flex-col justify-between gap-6 group cursor-default shadow-2xl">
                  {/* Background Image: /guide/polite.jpg */}
                  <div
                    className="absolute inset-0 bg-cover bg-center opacity-80 group-hover:scale-105 transition-transform duration-700 pointer-events-none"
                    style={{ backgroundImage: "url('/guide/polite.jpg')" }}
                  />
                  <div className="absolute inset-0 bg-gradient-to-r from-[#0b0f19]/85 via-[#0b0f19]/50 to-transparent pointer-events-none" />

                  <div className="space-y-3 max-w-2xl text-left z-10 relative">
                    <div>
                      <h1 className="text-2xl sm:text-3xl font-black !text-white banner-title tracking-tight flex items-center gap-2 drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]" style={{ color: "#ffffff" }}>
                        {etiquetteSubFilter === "全部" ? "面试礼仪与行为指南" : `${etiquetteSubFilter} 专项行为规范`}
                      </h1>
                      <p className="text-sm !text-white/95 banner-desc font-bold mt-1.5 leading-relaxed drop-shadow-[0_1px_4px_rgba(0,0,0,0.8)]" style={{ color: "rgba(255, 255, 255, 0.95)" }}>
                        {etiquetteSubFilter === "全部"
                          ? "从面试前准备、视频设备调试到沟通过程与结束礼仪的全流程考官加分指南"
                          : `将“${etiquetteSubFilter}”拆解为 6 张具体可操作的行为规范卡片，消除细节扣分风险`}
                      </p>
                    </div>

                    {/* Search Box */}
                    <div className="relative pt-1">
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder={`搜索${etiquetteSubFilter === "全部" ? "礼仪规范" : etiquetteSubFilter}...`}
                        className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-slate-900/90 border border-slate-300 dark:border-white/15 rounded-xl text-xs sm:text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-white/40 focus:outline-none focus:border-indigo-600 dark:focus:border-blue-400/60 transition-all shadow-sm font-bold"
                      />
                      <span className="material-symbols-outlined absolute left-3 top-[14px] text-slate-500 dark:text-white/40 text-base guide-search-icon">
                        search
                      </span>
                      {searchQuery && (
                        <button
                          onClick={() => setSearchQuery("")}
                          className="absolute right-3 top-[14px] text-slate-500 dark:text-white/40 hover:text-slate-900 dark:hover:text-white text-xs font-bold"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* SUB-CATEGORY FILTER PILLS */}
                <div className="flex flex-wrap items-center gap-2 text-sm select-none border-b border-white/5 pb-4">
                  {["全部", "面试前准备", "视频面试礼仪", "沟通与表达", "肢体语言", "面试结束礼仪"].map((eName) => {
                    const isSelected = etiquetteSubFilter === eName;
                    return (
                      <button
                        key={eName}
                        onClick={() => setEtiquetteSubFilter(eName)}
                        className={`px-3.5 py-1.5 rounded-xl font-bold transition-all cursor-pointer ${
                          isSelected
                            ? "bg-blue-500 text-white font-black shadow-lg shadow-blue-500/20 scale-105"
                            : "bg-white/5 text-white/70 hover:text-white hover:bg-white/10 border border-white/5"
                        }`}
                      >
                        {eName === "全部" ? "全部礼仪概览" : eName}
                      </button>
                    );
                  })}
                </div>

                {/* ETIQUETTE OVERVIEW CARDS (WHEN "全部" IS SELECTED) */}
                {currentEtiquetteCards.isOverview && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                    {currentEtiquetteCards.items.map((item) => (
                      <div
                        key={item.id}
                        className="glass-panel p-5 rounded-2xl border-white/10 flex flex-col justify-between text-left hover:border-blue-400/40 transition-all duration-300 group space-y-4 bg-white/[0.02] hover:bg-white/[0.04] shadow-lg"
                      >
                        <div className="space-y-3">
                          <div className={`w-10 h-10 rounded-xl ${item.iconBg} border border-white/10 flex items-center justify-center`}>
                            <span className="material-symbols-outlined text-xl">{item.icon}</span>
                          </div>
                          
                          <h4 className="text-base font-black text-slate-900 dark:text-white group-hover:text-indigo-600 transition-colors">{item.title}</h4>
                          
                          <div className="space-y-2 pt-1 border-t border-slate-100 dark:border-white/5">
                            {item.bullets.map((bullet, idx) => (
                              <div key={idx} className="flex items-center gap-2 text-xs text-slate-900 dark:text-white/80 font-bold guide-bullet-text">
                                <span className="w-4 h-4 rounded-full bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-[10px] font-black flex items-center justify-center shrink-0">✓</span>
                                <span className="text-slate-900 dark:text-white font-extrabold">{bullet}</span>
                              </div>
                            ))}
                          </div>
                        </div>

                        <button
                          onClick={() => setEtiquetteSubFilter(item.title)}
                          className="w-full py-2.5 bg-indigo-50 hover:bg-indigo-600 dark:bg-blue-500/10 dark:hover:bg-blue-500 text-indigo-700 hover:text-white dark:text-blue-300 font-black text-xs rounded-xl border border-indigo-200 dark:border-blue-400/20 hover:border-indigo-600 transition-all cursor-pointer flex items-center justify-center gap-1.5 shadow-sm"
                        >
                          <span>查看该主题 6 张卡片细节</span>
                          <span className="material-symbols-outlined text-xs">arrow_forward</span>
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* DETAILED ETIQUETTE BREAKDOWN CARDS */}
                {!currentEtiquetteCards.isOverview && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-base font-black text-slate-900 dark:text-white flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-indigo-600 dark:bg-blue-400" />
                        {etiquetteSubFilter} - 行为规范 6 张卡片拆解
                      </h3>
                      <button
                        onClick={() => setEtiquetteSubFilter("全部")}
                        className="text-xs text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-white font-bold transition-colors cursor-pointer flex items-center gap-1 guide-back-btn"
                      >
                        ← 返回全部礼仪概览
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                      {currentEtiquetteCards.detailItems.map((detailCard) => (
                        <div
                          key={detailCard.id}
                          className="glass-panel p-5 rounded-2xl border-slate-200 dark:border-white/10 flex flex-col justify-between text-left hover:border-indigo-600 dark:hover:border-blue-400/40 transition-all duration-300 group space-y-4 bg-white dark:bg-white/[0.02] hover:bg-slate-50 dark:hover:bg-white/[0.04] shadow-lg"
                        >
                          <div className="space-y-3">
                            <div className="flex items-center justify-between">
                              <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black border ${detailCard.tagBg}`}>
                                {detailCard.tag}
                              </span>
                            </div>

                            <div className="flex items-start gap-3 pt-1">
                              <div className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 ${detailCard.iconBg}`}>
                                <span className="material-symbols-outlined text-lg">{detailCard.icon}</span>
                              </div>
                              <div>
                                <h4 className="text-sm font-black text-slate-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-blue-300 transition-colors leading-snug">
                                  {detailCard.title}
                                </h4>
                                <p className="text-xs text-slate-700 dark:text-white/60 font-bold leading-relaxed mt-1">
                                  {detailCard.summary}
                                </p>
                              </div>
                            </div>

                            {/* Highlight Formula Box */}
                            <div className="p-3 rounded-xl bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/10 text-[11px] leading-relaxed shadow-sm guide-detail-formula-box">
                              <span className="font-black text-slate-900 dark:text-white block mb-1 guide-formula-title">💡 执行要点：</span>
                              <span className="font-extrabold text-slate-900 dark:text-white block mt-0.5">{detailCard.formula}</span>
                            </div>
                          </div>

                          <button
                            onClick={() => handleOpenDetailModal(detailCard)}
                            className="w-full py-2.5 bg-indigo-100 hover:bg-indigo-600 dark:bg-white/5 dark:hover:bg-blue-500/20 text-indigo-800 hover:text-white dark:text-white/80 dark:hover:text-blue-300 font-black text-sm rounded-xl border border-indigo-200 dark:border-white/10 hover:border-indigo-600 dark:hover:border-blue-400/30 transition-all cursor-pointer flex items-center justify-center gap-1 shadow-sm guide-detail-btn"
                          >
                            <span>查看规范操作细节</span>
                            <span className="material-symbols-outlined text-xs">open_in_new</span>
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

              </div>
            )}

          </main>
        </div>

        {/* ========================================================
            BOTTOM BANNER: "练习才能提升，AI 助你进步" (SPANS FULL WIDTH EXTENDING ALL THE WAY TO THE LEFT!)
           ======================================================== */}
        <div className="glass-panel p-6 sm:p-8 rounded-3xl border-white/15 relative overflow-hidden flex flex-col sm:flex-row items-center justify-between gap-6 text-left shadow-2xl group cursor-default">
          {/* Background Image: /guide/practice.jpg */}
          <div
            className="absolute inset-0 bg-cover bg-center opacity-90 group-hover:scale-105 transition-transform duration-700 pointer-events-none"
            style={{ backgroundImage: "url('/guide/practice.jpg')" }}
          />
          <div className="absolute inset-0 bg-gradient-to-r from-[#0b0f19]/85 via-[#0b0f19]/50 to-transparent pointer-events-none" />

          <div className="space-y-1.5 relative z-10">
            <h3 className="text-xl sm:text-2xl font-black !text-white banner-title flex items-center gap-2 drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]" style={{ color: "#ffffff" }}>
              <span className="material-symbols-outlined text-2xl text-purple-300">workspace_premium</span>
              练习才能提升，AI 助你进步
            </h3>
            <p className="text-xs sm:text-sm !text-white/95 banner-desc font-bold drop-shadow-[0_1px_4px_rgba(0,0,0,0.8)]" style={{ color: "rgba(255, 255, 255, 0.95)" }}>
              通过 AI 模拟面试，针对性提升你的回答能力和面试表现
            </p>
          </div>

          <button
            onClick={() => router.push("/training")}
            className="px-8 py-3.5 bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-600 hover:to-indigo-700 !text-white font-black text-sm rounded-2xl transition-all shadow-[0_0_25px_rgba(168,85,247,0.4)] hover:scale-105 active:scale-95 cursor-pointer shrink-0 relative z-10 guide-start-btn"
            style={{ color: "#ffffff" }}
          >
            开始模拟面试 →
          </button>
        </div>

      </div>

      {/* Footer */}
      <Footer />

      {/* MODAL DIALOG FOR DETAILS */}
      {modalData && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in select-none">
          <div className="bg-white dark:bg-[#0e1626] border border-slate-200 dark:border-white/15 rounded-3xl p-6 max-w-xl w-full space-y-5 shadow-2xl text-left relative max-h-[85vh] overflow-y-auto custom-scrollbar">
            
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-white/10 pb-3">
              <h4 className="text-lg font-black text-slate-900 dark:text-white">{modalData.title}</h4>
              <button
                onClick={() => setModalData(null)}
                className="w-8 h-8 rounded-full bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 text-slate-500 dark:text-white/60 hover:text-slate-900 dark:hover:text-white flex items-center justify-center transition-colors cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              {modalData.content}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
