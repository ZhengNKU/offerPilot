/**
 * 后端 API 基地址。
 *
 * 本地开发时默认指向 localhost:8001；
 * 生产环境通过 Docker build arg NEXT_PUBLIC_API_BASE="" 注入空字符串，
 * 利用 nginx 同源反向代理（/api/* → backend:8001），无需跨域。
 */
export const API_BASE: string =
  process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8001";
