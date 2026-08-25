import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "帮助中心 - 面试驾到功能使用教程与常见问题解答 | 面试驾到",
  description:
    "面试驾到帮助中心：为您提供面试录音分析、面试记录分析、简历深度分析、AI 模拟面试、专属 AI 职业顾问及职业驾驶舱的完整使用教程、视频操作指南与常见问题解答。",
  keywords: [
    "面试驾到帮助中心",
    "https://interviewvar.com/helper",
    "专属AI职业顾问",
    "AI面试分析专家教程",
    "面试录音分析怎么用",
    "简历深度分析指南",
    "AI模拟面试使用教程",
    "面试复盘常见问题"
  ],
  alternates: {
    canonical: "https://www.interviewvar.com/helper",
  },
  openGraph: {
    title: "帮助中心 - 面试驾到功能使用教程与常见问题解答 | 面试驾到",
    description: "面试驾到帮助中心：面试录音分析、简历深度分析、AI 模拟面试、专属AI职业顾问的完整使用教程与常见问题解答。",
    url: "https://www.interviewvar.com/helper",
    siteName: "面试驾到",
    locale: "zh_CN",
    type: "website",
    images: [
      {
        url: "https://www.interviewvar.com/logo/logo_icon.png",
        width: 512,
        height: 512,
        alt: "面试驾到 Logo",
      },
    ],
  },
  twitter: {
    card: "summary",
    title: "帮助中心 - 面试驾到功能使用教程与常见问题解答 | 面试驾到",
    description: "面试驾到帮助中心：面试录音分析、简历深度分析、AI 模拟面试、专属AI职业顾问的完整使用教程与常见问题解答。",
  },
};

export default function HelperLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
