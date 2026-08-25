import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "帮助中心",
  description:
    "面试驾到帮助中心：面试录音分析、面试记录分析、简历深度分析、AI 模拟面试的完整使用教程与常见问题解答。",
  alternates: { canonical: "/helper" },
};

export default function HelperLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
