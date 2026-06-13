import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/components/AuthProvider";

export const metadata: Metadata = {
  title: "面试VAR - AI 面试分析专家",
  description: "面试VAR 分析真实面试录音，定位信任崩溃时刻，揭示面试官真实想法，帮你获得心仪 Offer。",
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
      </head>
      <body className="bg-background text-on-surface selection:bg-primary/30 font-body-md overflow-x-hidden min-h-full flex flex-col">
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
