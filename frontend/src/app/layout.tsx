import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/components/AuthProvider";
import LegalModals from "@/components/LegalModals";

export const metadata: Metadata = {
  title: "面试VAR - AI 面试分析专家",
  description: "面试VAR 分析真实面试录音，定位信任崩溃时刻，揭示面试官真实想法，帮你获得心仪 Offer。",
  icons: {
    icon: "/logo.svg",
  },
};

export default function RootLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params?: any;
}>) {
  return (
    <html lang="zh-CN" className="dark h-full antialiased">
      <head>
        <link
          href="/fonts/fonts.css"
          rel="stylesheet"
        />
        <link rel="icon" href="/logo.svg" type="image/svg+xml" />
      </head>
      <body className="bg-background text-on-surface selection:bg-primary/30 font-body-md overflow-x-hidden min-h-full flex flex-col">
        <AuthProvider>
          {children}
          {/* 全局法务弹窗：用户协议 / 隐私政策 / 联系我们。
              各页面 footer 调用 openLegalTerms() / openLegalPrivacy() / openLegalContact() 触发。 */}
          <LegalModals />
        </AuthProvider>
      </body>
    </html>
  );
}
