export type PlanCategory = "subscription" | "pack";
export type PlanCycle = "week" | "month" | "pack";

export interface PlanFeatureItem {
  key: "resume" | "record" | "audio" | "live" | "advisor";
  name: string;
  value: string;
  unit: string;
  icon: string;
  highlight?: boolean;
}

export interface PricingPlan {
  id: "WEEK_PRO" | "WEEK_MAX" | "MONTH_PRO" | "MONTH_MAX" | "PACK_A" | "PACK_B";
  code: string;
  name: string;
  subtitle: string;
  category: PlanCategory;
  cycle: PlanCycle;
  cycleLabel: string;
  price: number;
  originalPrice?: number;
  badge?: string;
  isPopular?: boolean;
  features: PlanFeatureItem[];
  perks: string[];
}

export const PRICING_PLANS: PricingPlan[] = [
  // 1. 周度进阶版
  {
    id: "WEEK_PRO",
    code: "week_pro",
    name: "周度进阶版",
    subtitle: "临近面试高频冲刺 · 基础模拟复盘",
    category: "subscription",
    cycle: "week",
    cycleLabel: "周",
    price: 18.9,
    originalPrice: 29.9,
    features: [
      { key: "resume", name: "简历分析", value: "5", unit: "次", icon: "article" },
      { key: "record", name: "面试记录分析", value: "5", unit: "次", icon: "description" },
      { key: "audio", name: "面试录音分析", value: "3", unit: "次", icon: "graphic_eq" },
      { key: "live", name: "AI 模拟面试", value: "30", unit: "分钟", icon: "videocam", highlight: true },
      { key: "advisor", name: "AI 职业顾问", value: "60", unit: "次/天", icon: "smart_toy" },
    ],
    perks: [
      "真实面试对话逐题智能诊断",
      "支持错题一键沉淀至知识库",
    ],
  },
  // 2. 周度旗舰版
  {
    id: "WEEK_MAX",
    code: "week_max",
    name: "周度旗舰版",
    subtitle: "高频实战集中训练 · 双倍录音与模拟时长",
    category: "subscription",
    cycle: "week",
    cycleLabel: "周",
    price: 33.9,
    originalPrice: 49.9,
    features: [
      { key: "resume", name: "简历分析", value: "10", unit: "次", icon: "article" },
      { key: "record", name: "面试记录分析", value: "10", unit: "次", icon: "description" },
      { key: "audio", name: "面试录音分析", value: "5", unit: "次", icon: "graphic_eq" },
      { key: "live", name: "AI 模拟面试", value: "60", unit: "分钟", icon: "videocam", highlight: true },
      { key: "advisor", name: "AI 职业顾问", value: "80", unit: "次/天", icon: "smart_toy" },
    ],
    perks: [
      "包含周度进阶版全部权益",
      "60 分钟高真模拟面试多轮实战",
      "多岗位定制化针对性题库推送",
    ],
  },
  // 3. 月度专业版 (⭐ 主推)
  {
    id: "MONTH_PRO",
    code: "month_pro",
    name: "月度专业版",
    subtitle: "全周期完整求职 · 高性价比口碑之选",
    category: "subscription",
    cycle: "month",
    cycleLabel: "月",
    price: 74.9,
    originalPrice: 129.9,
    badge: "⭐ 官方主推 · 爆款首选",
    isPopular: true,
    features: [
      { key: "resume", name: "简历分析", value: "30", unit: "次", icon: "article" },
      { key: "record", name: "面试记录分析", value: "30", unit: "次", icon: "description" },
      { key: "audio", name: "面试录音分析", value: "10", unit: "次", icon: "graphic_eq", highlight: true },
      { key: "live", name: "AI 模拟面试", value: "120", unit: "分钟", icon: "videocam", highlight: true },
      { key: "advisor", name: "AI 职业顾问", value: "60", unit: "次/天", icon: "smart_toy" },
    ],
    perks: [
      "覆盖春招/秋招/跳槽全月实战",
      "120 分钟多场景面试深度对练",
      "10 次超长录音精准复盘与复习计划",
      "支持专属求职知识库动态更新",
    ],
  },
  // 4. 月度至尊版
  {
    id: "MONTH_MAX",
    code: "month_max",
    name: "月度至尊版",
    subtitle: "多线冲刺大厂核心岗 · 顶配 180min 实战",
    category: "subscription",
    cycle: "month",
    cycleLabel: "月",
    price: 109.9,
    originalPrice: 189.9,
    badge: "豪华高配",
    features: [
      { key: "resume", name: "简历分析", value: "30", unit: "次", icon: "article" },
      { key: "record", name: "面试记录分析", value: "30", unit: "次", icon: "description" },
      { key: "audio", name: "面试录音分析", value: "20", unit: "次", icon: "graphic_eq", highlight: true },
      { key: "live", name: "AI 模拟面试", value: "180", unit: "分钟", icon: "videocam", highlight: true },
      { key: "advisor", name: "AI 职业顾问", value: "80", unit: "次/天", icon: "smart_toy" },
    ],
    perks: [
      "180 分钟（约 9 次高真全真模拟面试）",
      "20 次面试录音全局深度拆解与打分",
      "80 次/天高阶职业顾问随时答疑",
      "大模型专属算力加速通道",
    ],
  },
  // 5. 打包 A (轻量试错包)
  {
    id: "PACK_A",
    code: "pack_a",
    name: "打包 A · 轻量试错包",
    subtitle: "单次加油体验 · 极低决策门槛",
    category: "pack",
    cycle: "pack",
    cycleLabel: "次",
    price: 9.9,
    originalPrice: 19.9,
    badge: "按需加油",
    features: [
      { key: "resume", name: "简历分析", value: "2", unit: "次", icon: "article" },
      { key: "record", name: "面试记录分析", value: "2", unit: "次", icon: "description" },
      { key: "audio", name: "面试录音分析", value: "1", unit: "次", icon: "graphic_eq" },
      { key: "live", name: "AI 模拟面试", value: "20", unit: "分钟", icon: "videocam" },
      { key: "advisor", name: "AI 职业顾问", value: "60", unit: "次", icon: "smart_toy" },
    ],
    perks: [
      "即充即用，额度永不过期",
      "与现有会员周期额度自动累加",
      "适合单场面试前突击自查",
    ],
  },
  // 6. 打包 B (灵活加油包)
  {
    id: "PACK_B",
    code: "pack_b",
    name: "打包 B · 灵活加油包",
    subtitle: "临场高质补充 · 30分钟单场完整实操",
    category: "pack",
    cycle: "pack",
    cycleLabel: "次",
    price: 14.9,
    originalPrice: 29.9,
    badge: "超值加练",
    features: [
      { key: "resume", name: "简历分析", value: "3", unit: "次", icon: "article" },
      { key: "record", name: "面试记录分析", value: "3", unit: "次", icon: "description" },
      { key: "audio", name: "面试录音分析", value: "2", unit: "次", icon: "graphic_eq" },
      { key: "live", name: "AI 模拟面试", value: "30", unit: "分钟", icon: "videocam", highlight: true },
      { key: "advisor", name: "AI 职业顾问", value: "80", unit: "次", icon: "smart_toy" },
    ],
    perks: [
      "即充即用，额度永不过期",
      "30 分钟完整多轮模拟面试演练",
      "2 次完整实战面试录音深度诊断",
    ],
  },
];

export function getPlanById(id: string): PricingPlan | undefined {
  return PRICING_PLANS.find((p) => p.id === id);
}
