import type { MetadataRoute } from "next";

// 站点规范主域名：与 sitemap.ts / layout.tsx 保持一致。
const SITE_URL = "https://www.interviewvar.com";

export default function robots(): MetadataRoute.Robots {

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // 内部 / 需登录页面 + 后端与上传资源：不参与索引
        disallow: [
          "/api/",
          "/uploads/",
          "/home",
          "/register",
          "/feedback",
          "/license",
          "/memory",
          "/debugger",
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    // 百度专用 Host 指令（规范主站）
    host: "www.interviewvar.com",
  };
}
