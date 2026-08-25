import type { Metadata } from "next";

// 面试调试器及其子页面（record/report/resume/voice）均为内部工具，不参与索引。
export const metadata: Metadata = {
  title: "面试调试器",
  robots: {
    index: false,
    follow: false,
    googleBot: { index: false, follow: false },
  },
};

export default function DebuggerLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
