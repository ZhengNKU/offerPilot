import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "AI 模拟面试",
  description:
    "面试驾到 AI 模拟面试：多套面试官人格与音色，真实还原面试场景，实时语音对练并生成分析报告。",
  alternates: { canonical: "/training" },
};

// 页面级结构化数据：与 /training 页面的模拟面试能力对应。
const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [
    {
      "@type": "Question",
      name: "AI 模拟面试支持哪些面试类型？",
      acceptedAnswer: {
        "@type": "Answer",
        text: "面试驾到 AI 模拟面试覆盖技术面（八股、项目、架构等）与非技术面（业务能力、HR 面等）多种类型，并支持自定义粘贴岗位 JD 精确匹配面试题。",
      },
    },
    {
      "@type": "Question",
      name: "AI 面试官能还原真实面试吗？",
      acceptedAnswer: {
        "@type": "Answer",
        text: "系统提供多种面试官人格与音色，以及友善、偏友好、有压力、严苛等不同难度等级，通过实时语音对话高度还原真实面试场景，帮助你提前适应面试节奏。",
      },
    },
    {
      "@type": "Question",
      name: "模拟面试结束后会生成报告吗？",
      acceptedAnswer: {
        "@type": "Answer",
        text: "会。面试结束后系统自动出具多维度深度评估报告，包含总评得分、维度明细与针对性改进建议，帮你查漏补缺、提升实战通过率。",
      },
    },
  ],
};

export default function TrainingLayout({ children }: { children: React.ReactNode }) {
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
