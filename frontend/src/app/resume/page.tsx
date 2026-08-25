import type { Metadata } from "next";
import Link from "next/link";
import Footer from "@/components/Footer";

// 纯服务端组件（无 "use client"）：正文 100% 进入初始 HTML，百度/Google 可直接抓取收录。
const SITE_URL = "https://www.interviewvar.com";

export const metadata: Metadata = {
  title: "AI 简历优化",
  description:
    "面试驾到 AI 简历优化：上传 PDF/Word 简历，AI 智能诊断简历短板、定位关键词缺失、优化核心项目描述，一键生成高分简历。",
  alternates: { canonical: "/resume" },
  openGraph: {
    title: "AI 简历优化 | 面试驾到",
    description:
      "AI 智能诊断简历短板、定位关键词缺失、优化核心项目描述，一键生成高分简历。",
    url: `${SITE_URL}/resume`,
    type: "website",
    locale: "zh_CN",
  },
};

// 页面级结构化数据（FAQPage）：与下方「常见问题」正文一一对应，帮助抢百度/Google 富摘要。
const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [
    {
      "@type": "Question",
      name: "AI 简历优化能帮我改哪些内容？",
      acceptedAnswer: {
        "@type": "Answer",
        text: "面试驾到的 AI 简历优化会从四个维度诊断你的简历：综合评分、核心项目深度诊断、关键词缺失分析，以及一键改写建议。系统会逐条指出表达模糊、缺少量化成果、与目标岗位不匹配的地方，并给出可直接套用的高分改写范例。",
      },
    },
    {
      "@type": "Question",
      name: "简历优化支持哪些文件格式？",
      acceptedAnswer: {
        "@type": "Answer",
        text: "支持上传 PDF、DOCX（Word）格式的简历文件。上传后 AI 会自动提取简历内容，结合你填写的目标岗位描述（JD）进行针对性诊断与优化。",
      },
    },
    {
      "@type": "Question",
      name: "AI 简历诊断能提高简历通过率吗？",
      acceptedAnswer: {
        "@type": "Answer",
        text: "AI 简历诊断可以帮助你定位 HR 与 ATS 机器筛选最容易忽略的问题，例如关键词缺失、成果未量化、项目描述缺乏 STAR 结构等。修正这些问题能显著提升简历进入面试环节的概率，但最终结果仍取决于个人经历与岗位匹配度。",
      },
    },
    {
      "@type": "Question",
      name: "我的简历会被泄露吗？",
      acceptedAnswer: {
        "@type": "Answer",
        text: "面试驾到在模型输入层引入脱敏逻辑，自动识别并抹去姓名、联系方式、企业名称等敏感信息；所有数据经高强度加密传输并安全存储，绝不会将你的简历出售或授权给任何第三方。",
      },
    },
    {
      "@type": "Question",
      name: "AI 简历优化是免费的吗？",
      acceptedAnswer: {
        "@type": "Answer",
        text: "面试驾到目前处于内部测试阶段，会员体系暂未开放，简历深度分析等核心功能面向内测用户免费体验。",
      },
    },
  ],
};

const features = [
  {
    icon: "monitoring",
    color: "text-amber-300",
    badge: "bg-amber-400/10 border-amber-400/20",
    title: "简历综合评分",
    desc: "从结构、表达、量化成果、岗位契合度多维度打分，一眼看清你的简历处于什么水平。",
  },
  {
    icon: "manage_search",
    color: "text-primary",
    badge: "bg-primary/10 border-primary/20",
    title: "关键词缺失分析",
    desc: "智能比对目标岗位 JD，定位简历中缺失的关键词，提升 ATS 机器筛选与 HR 初筛通过率。",
  },
  {
    icon: "account_tree",
    color: "text-secondary",
    badge: "bg-secondary/10 border-secondary/20",
    title: "核心项目深度诊断",
    desc: "逐条诊断项目描述是否讲清背景、动作与结果，是否用数据量化了你的实际贡献。",
  },
  {
    icon: "edit_note",
    color: "text-[#AFA7FF]",
    badge: "bg-[#AFA7FF]/10 border-[#AFA7FF]/20",
    title: "一键改写建议",
    desc: "针对每个薄弱点给出 STAR 结构的高分改写范例，直接替换即可，无需从零构思。",
  },
];

const steps = [
  {
    num: "1",
    title: "上传简历",
    desc: "在【面试调试器】选择【简历深度分析】，上传你的求职简历（支持 PDF、DOCX 格式）。",
  },
  {
    num: "2",
    title: "粘贴目标岗位 JD",
    desc: "填入你心仪的目标岗位描述，让 AI 聚焦岗位需求，进行针对性的匹配度扫描。",
  },
  {
    num: "3",
    title: "获取诊断与改写",
    desc: "一键查看简历综合评分、核心项目诊断、关键词缺失分析，以及逐条改写建议。",
  },
];

const faqs = [
  {
    q: "AI 简历优化能帮我改哪些内容？",
    a: "面试驾到的 AI 简历优化会从四个维度诊断你的简历：综合评分、核心项目深度诊断、关键词缺失分析，以及一键改写建议。系统会逐条指出表达模糊、缺少量化成果、与目标岗位不匹配的地方，并给出可直接套用的高分改写范例。",
  },
  {
    q: "简历优化支持哪些文件格式？",
    a: "支持上传 PDF、DOCX（Word）格式的简历文件。上传后 AI 会自动提取简历内容，结合你填写的目标岗位描述（JD）进行针对性诊断与优化。",
  },
  {
    q: "AI 简历诊断能提高简历通过率吗？",
    a: "AI 简历诊断可以帮助你定位 HR 与 ATS 机器筛选最容易忽略的问题，例如关键词缺失、成果未量化、项目描述缺乏 STAR 结构等。修正这些问题能显著提升简历进入面试环节的概率，但最终结果仍取决于个人经历与岗位匹配度。",
  },
  {
    q: "我的简历会被泄露吗？",
    a: "面试驾到在模型输入层引入脱敏逻辑，自动识别并抹去姓名、联系方式、企业名称等敏感信息；所有数据经高强度加密传输并安全存储，绝不会将你的简历出售或授权给任何第三方。",
  },
  {
    q: "AI 简历优化是免费的吗？",
    a: "面试驾到目前处于内部测试阶段，会员体系暂未开放，简历深度分析等核心功能面向内测用户免费体验。",
  },
];

export default function ResumePage() {
  return (
    <div className="min-h-screen bg-[#0b1326] relative overflow-hidden text-on-surface">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />

      {/* 背景光晕 */}
      <div className="absolute top-[-10%] left-[-15%] w-[60vw] h-[60vw] rounded-full bg-amber-400/5 blur-[130px] pointer-events-none z-0" />
      <div className="absolute bottom-[-15%] right-[-15%] w-[60vw] h-[60vw] rounded-full bg-primary/5 blur-[130px] pointer-events-none z-0" />

      {/* HERO */}
      <header className="relative z-10 py-20 text-center max-w-container-max mx-auto px-gutter">
        <div className="inline-flex items-center gap-1.5 bg-amber-400/10 text-amber-300 border border-amber-400/20 px-3 py-1 rounded-full text-xs font-bold tracking-wider uppercase mb-6">
          <span className="material-symbols-outlined text-sm">description</span>
          AI 简历优化 · Resume Optimization
        </div>
        <h1 className="text-3xl sm:text-5xl font-black tracking-tight text-white leading-tight">
          AI 简历优化，让 HR <span className="text-gradient">30 秒就记住你</span>
        </h1>
        <p className="text-base sm:text-lg text-on-surface-variant/70 font-semibold max-w-2xl mx-auto leading-relaxed mt-5">
          上传简历，AI 智能诊断简历短板、定位关键词缺失、优化核心项目描述，一键生成让 HR 眼前一亮的高分简历。
        </p>
        <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link
            href="/debugger?mode=resume"
            className="px-7 py-3 bg-primary text-on-primary rounded-xl text-base font-bold shadow-lg shadow-primary/20 hover:shadow-primary/30 transition-all"
          >
            免费优化我的简历
          </Link>
          <span className="text-sm text-on-surface-variant/50 font-semibold">
            支持 PDF / DOCX · 无需下载软件
          </span>
        </div>
      </header>

      {/* 四大能力 */}
      <main className="relative z-10 max-w-container-max mx-auto px-gutter pb-16">
        <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {features.map((f) => (
            <article key={f.title} className="glass-panel p-6 sm:p-7 rounded-3xl border-white/10">
              <div className={`inline-flex items-center gap-1.5 ${f.badge} px-2.5 py-1 rounded-lg text-[11px] font-bold tracking-wider uppercase mb-4`}>
                <span className={`material-symbols-outlined text-sm ${f.color}`}>{f.icon}</span>
              </div>
              <h2 className="text-xl font-black text-white mb-2">{f.title}</h2>
              <p className="text-sm text-on-surface-variant/70 font-semibold leading-relaxed">{f.desc}</p>
            </article>
          ))}
        </section>

        {/* 操作三步 */}
        <section className="mt-16">
          <h2 className="text-2xl sm:text-3xl font-black text-white text-center mb-10">
            三步完成<span className="text-gradient">简历优化</span>
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {steps.map((s) => (
              <div key={s.num} className="glass-panel p-6 rounded-3xl border-white/10">
                <span className="w-8 h-8 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-white font-bold mb-4">
                  {s.num}
                </span>
                <h3 className="text-lg font-black text-white mb-2">{s.title}</h3>
                <p className="text-sm text-on-surface-variant/70 font-semibold leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* 常见问题 */}
        <section className="mt-16">
          <h2 className="text-2xl sm:text-3xl font-black text-white text-center mb-10">
            关于<span className="text-gradient">AI 简历优化</span>的常见问题
          </h2>
          <div className="max-w-3xl mx-auto space-y-4">
            {faqs.map((item) => (
              <div key={item.q} className="glass-panel p-6 rounded-2xl border-white/10">
                <h3 className="text-base font-black text-white mb-2">{item.q}</h3>
                <p className="text-sm text-on-surface-variant/70 font-semibold leading-relaxed">{item.a}</p>
              </div>
            ))}
          </div>
        </section>

        {/* CTA 横幅 */}
        <section className="mt-16 glass-panel p-8 sm:p-12 rounded-3xl border-white/10 text-center">
          <h2 className="text-2xl sm:text-3xl font-black text-white mb-3">
            别让一份平庸的简历，埋没你的实力
          </h2>
          <p className="text-on-surface-variant/70 font-semibold mb-7 max-w-xl mx-auto">
            现在上传简历，AI 帮你把每一段经历都写进 HR 眼里。
          </p>
          <Link
            href="/debugger?mode=resume"
            className="inline-block px-7 py-3 bg-primary text-on-primary rounded-xl text-base font-bold shadow-lg shadow-primary/20 hover:shadow-primary/30 transition-all"
          >
            立即免费体验
          </Link>
        </section>
      </main>

      <Footer />
    </div>
  );
}
