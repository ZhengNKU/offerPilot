import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "面试指南 - 真实面试经验与高频面试题技巧 | 面试驾到",
  description:
    "面试驾到精选面试指南：收录来自小红书、抖音博主的真实求职复盘与精选面试经验，提供自我介绍、离职原因、职业规划及期望薪资等高频面试问题的高分答题模板与避坑技巧。",
  alternates: { canonical: "/guide" },
};

// 页面级结构化数据：与 /guide 页面的面试问题内容对应，抢百度/Google 富摘要。
const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [
    {
      "@type": "Question",
      name: "面试自我介绍怎么说才能出彩？",
      acceptedAnswer: {
        "@type": "Answer",
        text: "自我介绍控制在 2-3 分钟，不要照本宣科念简历。建议按「我是谁 + 核心战绩（量化数据）+ 岗位契合点」三段式展开，突出与目标岗位直接相关的业务成果，避免超过 5 分钟的长篇大论。",
      },
    },
    {
      "@type": "Question",
      name: "面试被问离职原因该怎么回答？",
      acceptedAnswer: {
        "@type": "Answer",
        text: "离职原因要在真实性与策略性之间平衡。切忌吐槽前公司或前领导，建议聚焦「寻求更大的成长空间、职业方向调整」等正向诉求，并结合岗位契合点说明为什么选择现在这家公司。",
      },
    },
    {
      "@type": "Question",
      name: "面试被问职业规划怎么回答？",
      acceptedAnswer: {
        "@type": "Answer",
        text: "职业规划要体现稳定性与成长性。避免回答「想当管理者」这类空泛目标，建议结合目标岗位的技术路线或业务方向，说明短期（1-2 年）能力提升目标与长期（3-5 年）价值贡献方向。",
      },
    },
    {
      "@type": "Question",
      name: "期望薪资怎么说才不吃亏？",
      acceptedAnswer: {
        "@type": "Answer",
        text: "提前了解岗位市场薪资区间，先询问对方薪资结构，再给出一个基于市场行情与自身价值的合理区间，避免过早报出具体数字或报得过低。",
      },
    },
  ],
};

export default function GuideLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      {children}
    </>
  );
}
