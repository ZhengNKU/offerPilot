/**
 * 统一生成 Authorization header。
 *
 * 用法:
 *   const headers = { ...authHeader(), "Content-Type": "application/json" };
 *   fetch(url, { headers, ... });
 *
 * 设计要点:
 *   - 仅在浏览器环境访问 localStorage(SSR 安全)
 *   - 没 token 时返回空对象(支持访客调接口)
 *   - 不要再 inline 写 `localStorage.getItem("interviewVar_token")` 五次
 */
export function authHeader(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const token = localStorage.getItem("interviewVar_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}
