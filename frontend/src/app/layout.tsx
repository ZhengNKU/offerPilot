import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/components/AuthProvider";
import LegalModals from "@/components/LegalModals";
import AutoCleanupUploads from "@/components/AutoCleanupUploads";

// 站点规范主域名：与 robots.ts / sitemap.ts 保持一致。
const SITE_URL = "https://www.interviewvar.com";

// 结构化数据（JSON-LD）：百度 / Google / Bing 从服务端渲染的初始 HTML 直接解析，
// 不依赖前端 JS 渲染，是纯 CSR 页面为数不多能被爬虫读懂的内容来源。
const jsonLd = [
  {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "南京澜之其境科技有限公司",
    brand: { "@type": "Brand", name: "面试驾到" },
    url: SITE_URL,
    logo: `${SITE_URL}/logo/logo_icon.png`,
  },
  {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "面试驾到",
    url: SITE_URL,
    inLanguage: "zh-CN",
  },
  {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "面试驾到 - AI 面试分析专家",
    applicationCategory: "JobInterviewApplication",
    operatingSystem: "Web",
    url: SITE_URL,
    description:
      "面试驾到是一款 AI 驱动的面试智能分析与职业成长辅助系统，提供简历深度分析、面试录音/记录分析、AI 模拟面试训练、专属 AI 职业顾问与 Offer 概率预测。",
    offers: { "@type": "Offer", price: "0", priceCurrency: "CNY" },
  },
  {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: "面试驾到能分析哪些内容？",
        acceptedAnswer: {
          "@type": "Answer",
          text: "面试驾到支持面试录音分析、面试记录（文字对白）分析、简历深度分析、专属 AI 职业顾问问答，以及 AI 模拟面试训练，帮助定位面试失分点并优化表达。",
        },
      },
      {
        "@type": "Question",
        name: "面试驾到适合哪些求职者？",
        acceptedAnswer: {
          "@type": "Answer",
          text: "面试驾到面向正在准备求职、跳槽、校招的求职者，尤其适合需要复盘面试表现、优化简历、进行模拟面试演练及通过专属 AI 职业顾问答疑的技术与非技术岗位候选人。",
        },
      },
      {
        "@type": "Question",
        name: "面试驾到是免费的吗？",
        acceptedAnswer: {
          "@type": "Answer",
          text: "面试驾到目前处于内部测试阶段，会员体系暂未开放，核心功能面向内测用户免费体验。",
        },
      },
    ],
  },
];

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "面试驾到 - AI面试分析专家，面试复盘与AI模拟面试求职平台",
    template: "%s | 面试驾到",
  },
  description:
    "面试驾到是专业的 AI 面试分析与求职提升平台，支持真实面试录音与记录复盘、简历深度解析、AI 沉浸式模拟面试训练、专属 AI 职业顾问及 Offer 概率预测。基于大语言模型精准定位面试扣分项，提供 STAR 法则改写示范与大厂面试预判题，助你高效斩获心仪 Offer。",
  keywords: [
    "面试驾到",
    "AI面试分析",
    "专属AI职业顾问",
    "AI模拟面试平台",
    "面试录音复盘",
    "大厂面试练习",
    "简历深度分析",
    "Offer概率预测",
    "STAR法则修改",
  ],
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "面试驾到 - AI面试分析专家，面试复盘与AI模拟面试平台",
    description:
      "面试驾到是专业的 AI 面试分析与职业成长平台，支持真实面试录音与记录复盘、简历深度解析、AI 沉浸式模拟面试训练及 Offer 概率预测。",
    url: SITE_URL,
    siteName: "面试驾到",
    type: "website",
    locale: "zh_CN",
    images: [{ url: `${SITE_URL}/logo/logo_icon.png` }],
  },
  twitter: {
    card: "summary_large_image",
    title: "面试驾到 - AI面试分析专家，面试复盘与AI模拟面试平台",
    description:
      "面试驾到是专业的 AI 面试分析与职业成长平台，支持真实面试录音与记录复盘、简历深度解析、AI 沉浸式模拟面试训练及 Offer 概率预测。",
    images: [`${SITE_URL}/logo/logo_icon.png`],
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/logo/logo_icon.png", type: "image/png", sizes: "192x192" },
      { url: "/logo/logo_icon.svg", type: "image/svg+xml" },
    ],
    shortcut: "/favicon.ico",
    apple: "/apple-touch-icon.png",
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
        <meta name="baidu-site-verification" content="codeva-XHq0eRePzi" />
        <meta name="sogou_site_verification" content="BsdjKbtFO7" />
        <link
          href="/fonts/fonts.css"
          rel="stylesheet"
        />
        <link rel="shortcut icon" href="/favicon.ico" />
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="icon" href="/logo/logo_icon.png" type="image/png" sizes="192x192" />
        <link rel="icon" href="/logo/logo_icon.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        {jsonLd.map((obj, i) => (
          <script
            key={`jsonld-${i}`}
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: JSON.stringify(obj) }}
          />
        ))}
      </head>
      <body className="bg-background text-on-surface selection:bg-primary/30 font-body-md overflow-x-hidden min-h-full flex flex-col">
        <AuthProvider>
          {children}
          {/* 全局法务弹窗：用户协议 / 隐私政策 / 联系我们。
              各页面 footer 调用 openLegalTerms() / openLegalPrivacy() / openLegalContact() 触发。 */}
          <LegalModals />
          {/* 切屏/刷新/关闭时自动清理已上传但未关联到 session 的孤儿文件 */}
          <AutoCleanupUploads />
        </AuthProvider>
      </body>
    </html>
  );
}
