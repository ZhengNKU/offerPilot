"use client";

import { createContext, useContext, useState, useEffect, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { API_BASE } from "@/lib/api";

export interface UserProfile {
  name: string;
  avatar: string;
  role: string;
  company: string;
  years: string;
  status: string;
  salary: string;
  targetCompany: string;
  targetRole: string;
  targetGrade: string;
  targetSalary: string;
  gender?: string;
  age?: string;
  school?: string;
  degree?: string;
  gradYear?: string;
  hasExp?: boolean;
  membership?: string;  // 内测版本：值为 "free" | "test" | "pro" | "max"
  phone?: string;
  email?: string;
  targetCity?: string;
  createdAt?: string;
  matchRate?: number;
}

interface AuthContextType {
  isLoggedIn: boolean;
  user: UserProfile;
  showLogin: boolean;
  setShowLogin: (val: boolean) => void;
  showLogout: boolean;
  setShowLogout: (val: boolean) => void;
  showDelete: boolean;
  setShowDelete: (val: boolean) => void;
  login: (data?: Partial<UserProfile>) => void;
  logout: () => void;
  deleteAccount: () => void;
  updateUser: (data: Partial<UserProfile>) => Promise<number | null>;
  triggerToast: (msg: string, kind?: "info" | "error") => void;
}

const defaultUser: UserProfile = {
  name: "",
  avatar: "",
  role: "",
  company: "",
  years: "",
  status: "",
  salary: "",
  targetCompany: "",
  targetRole: "",
  targetGrade: "",
  targetSalary: "",
  gender: "male",
  age: "",
  school: "",
  degree: "",
  gradYear: "",
  hasExp: false
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(false);
  const [user, setUser] = useState<UserProfile>(defaultUser);
  const [showLogin, setShowLogin] = useState(false);
  const [showLogout, setShowLogout] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [toastMsg, setToastMsg] = useState<{ msg: string; kind: "info" | "error" } | null>(null);
  const userRef = useRef(user);
  userRef.current = user;

  // Load state on mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      const storedLoggedIn = localStorage.getItem("interviewVar_isLoggedIn");
      const token = localStorage.getItem("interviewVar_token");
      if (storedLoggedIn === "true" && token) {
        setIsLoggedIn(true);
      } else {
        setIsLoggedIn(false);
      }
 
      const storedUser = localStorage.getItem("interviewVar_user");
      if (storedUser) {
        try {
          setUser(JSON.parse(storedUser));
        } catch (e) {
          setUser(defaultUser);
        }
      }

      // If we have a token, refresh user data from backend so fields
      // like phone / email (not stored in localStorage) are populated.
      if (token) {
        fetch(`${API_BASE}/api/auth/me`, {
          headers: { "Authorization": `Bearer ${token}` }
        })
          .then(res => {
            if (res.status === 401) {
              // Token has expired or is invalid, clear credentials and log out
              localStorage.removeItem("interviewVar_token");
              setIsLoggedIn(false);
              localStorage.setItem("interviewVar_isLoggedIn", "false");
              setUser(defaultUser);
              localStorage.removeItem("interviewVar_user");
              window.dispatchEvent(new Event("storage"));
              return null;
            }
            return res.ok ? res.json() : null;
          })
          .then(data => {
            if (data) {
              // 使用 userRef.current 获取最新用户状态（避免闭包过期）
              // 过滤 API 返回的 null 值，防止覆盖 localStorage 中已有的有效数据
              const apiData: any = {};
              for (const key in data) {
                if (data[key] !== null && data[key] !== undefined) {
                  apiData[key] = data[key];
                }
              }
              const merged = { ...defaultUser, ...userRef.current, ...apiData };
              // API 返回的 role 可能不含当前职级（仅岗位名），
              // 此时保留 localStorage 中的完整版本（"岗位 · 职级"），防止职级信息丢失
              if (apiData.role && !apiData.role.includes(" · ") && userRef.current.role && userRef.current.role.includes(" · ")) {
                merged.role = userRef.current.role;
              }
              setUser(merged);
              localStorage.setItem("interviewVar_user", JSON.stringify(merged));
              window.dispatchEvent(new Event("storage"));
            }
          })
          .catch(() => {});
      }
    }
  }, []);

  const triggerToast = (msg: string, kind: "info" | "error" = "info") => {
    setToastMsg({ msg, kind });
    setTimeout(() => {
      setToastMsg(null);
    }, 2500);
  };

  const login = (data?: Partial<UserProfile>) => {
    setIsLoggedIn(true);
    localStorage.setItem("interviewVar_isLoggedIn", "true");
    if (data) {
      const newUser = { ...user, ...data };
      setUser(newUser);
      localStorage.setItem("interviewVar_user", JSON.stringify(newUser));
    }
    setShowLogin(false);
    triggerToast("登录成功，欢迎回来！");
    // Trigger storage event for page updates
    window.dispatchEvent(new Event("storage"));
  };

  const logout = async () => {
    const token = localStorage.getItem("interviewVar_token");
    if (token) {
      try {
        await fetch(`${API_BASE}/api/auth/logout`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${token}` }
        });
      } catch (e) {}
    }
    localStorage.removeItem("interviewVar_token");
    setIsLoggedIn(false);
    localStorage.setItem("interviewVar_isLoggedIn", "false");
    localStorage.removeItem("interviewVar_user");
    setUser(defaultUser);
    setShowLogout(false);
    triggerToast("已安全退出登录！");
    router.push("/");
    window.dispatchEvent(new Event("storage"));
  };

  const deleteAccount = async () => {
    const token = localStorage.getItem("interviewVar_token");
    if (token) {
      try {
        const res = await fetch(`${API_BASE}/api/auth/delete-account`, {
          method: "DELETE",
          headers: { "Authorization": `Bearer ${token}` }
        });
        if (!res.ok) {
          const errData = await res.json();
          triggerToast(errData.detail || "注销账号失败！", "error");
          return;
        }
      } catch (e) {
        triggerToast("无法连接到后端服务！", "error");
        return;
      }
    }
    localStorage.removeItem("interviewVar_token");
    setIsLoggedIn(false);
    localStorage.setItem("interviewVar_isLoggedIn", "false");
    localStorage.removeItem("interviewVar_user");
    setUser(defaultUser);
    setShowDelete(false);
    triggerToast("账号已注销成功，感谢您的使用！");
    router.push("/");
    window.dispatchEvent(new Event("storage"));
  };

  const updateUser = async (data: Partial<UserProfile>): Promise<number | null> => {
    const prevUser = { ...user };
    const token = localStorage.getItem("interviewVar_token");
    if (token) {
      const body: any = {};
      if (data.name !== undefined) body.username = data.name;
      if (data.gender !== undefined) body.gender = data.gender;
      if (data.age !== undefined) body.age = parseInt(data.age) || 0;
      if (data.status !== undefined) {
        body.job_status = 
          data.status === "在职" ? "active" : 
          data.status === "离职" ? "resigned" : 
          (data.status === "应届" || data.status === "应届生") ? "fresh_grad" : 
          "student";
      }
      if (data.avatar !== undefined) body.avatar_url = data.avatar;

      if (data.years !== undefined) {
        if (data.years.startsWith("在校")) {
          body.experience_years = "在校";
          body.experience_months = "0个月";
        } else if (data.years.startsWith("应届")) {
          body.experience_years = "应届";
          body.experience_months = "0个月";
        } else {
          const matchedY = data.years.match(/(\d+年)/);
          const matchedM = data.years.match(/(\d+个月)/);
          body.experience_years = matchedY ? matchedY[1] : "在校";
          body.experience_months = matchedM ? matchedM[1] : "0个月";
        }
      }
      if (data.company !== undefined) body.company_name = data.company;
      if (data.role !== undefined) body.role_name = data.role;

      if (data.salary !== undefined) {
        const salMatch = data.salary ? data.salary.match(/(\d+)K\s*-\s*(\d+)K/i) : null;
        if (salMatch) {
          body.salary_min = parseInt(salMatch[1]);
          body.salary_max = parseInt(salMatch[2]);
        } else {
          body.salary_min = null;
          body.salary_max = null;
        }
      }
      if (data.school !== undefined) body.school = data.school;
      if (data.degree !== undefined) body.degree = data.degree;
      if (data.hasExp !== undefined) body.has_experience = data.hasExp;

      if (data.targetCompany !== undefined) body.target_company = data.targetCompany;
      if (data.targetRole !== undefined) body.target_role = data.targetRole;
      if (data.targetGrade !== undefined) body.target_grade = data.targetGrade;
      if (data.targetCity !== undefined) {
        body.target_cities = data.targetCity ? data.targetCity.split(/[、,，]/).map(c => c.trim()).filter(Boolean) : [];
      }
      if (data.targetSalary !== undefined) {
        const salMatch = data.targetSalary ? data.targetSalary.match(/(\d+)K\s*-\s*(\d+)K/i) : null;
        if (salMatch) {
          body.target_salary_min = parseInt(salMatch[1]);
          body.target_salary_max = parseInt(salMatch[2]);
        } else {
          body.target_salary_min = null;
          body.target_salary_max = null;
        }
      }

      const res = await fetch(`${API_BASE}/api/auth/profile/update`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        const errMsg = errData.detail || "修改保存失败，请检查输入内容！";
        triggerToast(errMsg, "error");
        throw new Error(errMsg);
      }
      const backendData = await res.json();
      const realMatchRate: number | null = backendData.matchRate ?? null;
      const updatedUser = { ...user, ...data, ...(realMatchRate !== null ? { matchRate: realMatchRate } : {}) };
      setUser(updatedUser);
      localStorage.setItem("interviewVar_user", JSON.stringify(updatedUser));
      window.dispatchEvent(new Event("storage"));
      return realMatchRate;
    }
    const newUser = { ...user, ...data };
    setUser(newUser);
    localStorage.setItem("interviewVar_user", JSON.stringify(newUser));
    window.dispatchEvent(new Event("storage"));
    return null;
  };

  // Sync state between tabs/windows
  useEffect(() => {
    const handleStorageChange = () => {
      const storedLoggedIn = localStorage.getItem("interviewVar_isLoggedIn");
      setIsLoggedIn(storedLoggedIn !== "false");
      const storedUser = localStorage.getItem("interviewVar_user");
      if (storedUser) {
        try {
          setUser(JSON.parse(storedUser));
        } catch (e) {}
      }
    };
    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, []);

  // ─── 单点登录：前端全局拦截 401 + 兜底轮询 ─────────────────────────
  // 后端已经把被挤下线的 token 加入 blacklist (auth:blacklist:{token})，
  // 此 tab 任何请求一旦返 401 就立即清登录态，避免用户卡在"看起来登录中"
  useEffect(() => {
    if (typeof window === "undefined") return;

    // 单点登录中被踢之后清本 tab 状态 + 广播给其他 tab。
    // 用一个闭包内的局部函数，避免依赖于 useEffect 依赖项变化重置 window.fetch。
    const forceLogoutDueToEviction = () => {
      const hadToken = !!localStorage.getItem("interviewVar_token");
      localStorage.removeItem("interviewVar_token");
      localStorage.setItem("interviewVar_isLoggedIn", "false");
      localStorage.removeItem("interviewVar_user");
      // 触发跨 tab 同步：本 tab setUser 同步给内存，
      // 其它 tab 通过 storage 事件监听器更新
      setUser(defaultUser);
      setIsLoggedIn(false);
      window.dispatchEvent(new Event("storage"));

      // 只有当真在被踢时才跳落地页（首次 /me 返回 401 也走这里）
      if (hadToken && typeof window !== "undefined" && window.location.pathname !== "/") {
        // 用 replace 而不是 push，避免用户在浏览器后退键里看到被踢的页面
        router.replace("/?evicted=1");
      } else if (hadToken) {
        // 已经在 /，只更新 URL search 参数（不引发路由刷新）
        const u = new URL(window.location.href);
        u.searchParams.set("evicted", "1");
        window.history.replaceState({}, "", u.toString());
      }
    };

    // 1) 全局 fetch 拦截器：所有 /api/ 调用的 401 都会走到这里
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const res = await originalFetch(input, init);
      try {
        const url =
          typeof input === "string"
            ? input
            : input instanceof Request
              ? input.url
              : (input as URL)?.toString?.() ?? "";
        // 只拦截 API；登录失败（/api/auth/login）本来就 401，不能误踢
        const isApi =
          url.includes("/api/") ||
          url.startsWith("http") && url.includes("/api/");
        const isLoginAttempt = url.includes("/api/auth/login") ||
          url.includes("/api/auth/send-code");
        if (isApi && !isLoginAttempt && res.status === 401) {
          forceLogoutDueToEviction();
        }
      } catch {
        // 解析 URL 失败不影响正常响应返回
      }
      return res;
    };

    // 2) 跨 tab 秒级感知（同一浏览器的多 tab）：用 BroadcastChannel 0 网络请求
    // B tab 完成登录后 postMessage，A tab 收到后立刻验证本地 token。
    // 仅覆盖同一浏览器的情况，跨设备由下面的 setInterval 兜底。
    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel("auth:sessions");
    } catch {
      // 部分老浏览器不支持 BroadcastChannel，try/catch 兜底（fallback 到 setInterval）
    }
    if (bc) {
      bc.onmessage = async () => {
        const t = localStorage.getItem("interviewVar_token");
        if (!t) return;
        try {
          const res = await originalFetch(`${API_BASE}/api/auth/me`, {
            headers: { Authorization: `Bearer ${t}` }
          });
          if (res.status === 401) forceLogoutDueToEviction();
        } catch {
          // 网络错误不算被踢，跳过
        }
      };
    }

    // 3) 跨设备兜底轮询：每 60s 主动探一次 /me
    // 用 setInterval 跳过手动操作，捕获"我在 A 页面不动 / 也没有 XHR"这种静默被踢场景
    const pollInterval = setInterval(async () => {
      const token = localStorage.getItem("interviewVar_token");
      if (!token) return;
      try {
        const res = await originalFetch(`${API_BASE}/api/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.status === 401) {
          forceLogoutDueToEviction();
        }
      } catch {
        // 网络错误不算被踢，跳过
      }
    }, 60000);

    return () => {
      // HMR / 卸载时还原 fetch（避免污染全局）
      window.fetch = originalFetch;
      bc?.close();
      clearInterval(pollInterval);
    };
  }, [router]);

  return (
    <AuthContext.Provider
      value={{
        isLoggedIn,
        user,
        showLogin,
        setShowLogin,
        showLogout,
        setShowLogout,
        showDelete,
        setShowDelete,
        login,
        logout,
        deleteAccount,
        updateUser,
        triggerToast
      }}
    >
      {children}

      {/* Global Toast */}
      <AnimatePresence>
        {toastMsg && (
          <motion.div
            initial={{ opacity: 0, y: -30, x: "-50%" }}
            animate={{ opacity: 1, y: 0, x: "-50%" }}
            exit={{ opacity: 0, y: -20, x: "-50%" }}
            className="fixed top-10 left-1/2 z-[9999] px-6 py-3.5 bg-[#131b2e]/95 backdrop-blur-md border border-[#AFA7FF]/20 shadow-2xl rounded-2xl flex items-center gap-2.5 select-none"
          >
            {toastMsg.kind === "error" ? (
              <span className="material-symbols-outlined text-[#FF6B7A] text-base md:text-lg">error</span>
            ) : (
              <span className="material-symbols-outlined text-[#5DECCB] text-base md:text-lg">check_circle</span>
            )}
            <span className="text-sm md:text-base font-extrabold text-white">{toastMsg.msg}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modals Container */}
      <AuthModals />
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}

// Global Login/Logout/Delete Modals Component
function AuthModals() {
  const auth = useAuth();
  const router = useRouter();

  // Login Form State
  // 内测版本：删除"验证码登录"tab 和"手机找回"分支，只保留密码登录 + 邮箱找回
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Forgot Password State
  const [showForgot, setShowForgot] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotCode, setForgotCode] = useState("");
  const [forgotCountdown, setForgotCountdown] = useState(0);
  const [forgotPassword, setForgotPassword] = useState("");
  const [forgotConfirmPassword, setForgotConfirmPassword] = useState("");
  const [showForgotPwd, setShowForgotPwd] = useState(false);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (forgotCountdown > 0) {
      timer = setTimeout(() => setForgotCountdown(forgotCountdown - 1), 1000);
    }
    return () => clearTimeout(timer);
  }, [forgotCountdown]);

  // Reset forgot password state when recovery panel is closed or switched away
  useEffect(() => {
    if (!auth.showLogin || !showForgot) {
      setForgotEmail("");
      setForgotCode("");
      setForgotPassword("");
      setForgotConfirmPassword("");
      setForgotCountdown(0);
    }
  }, [auth.showLogin, showForgot]);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoggingIn) return;
    // 内测版本：只支持密码登录（验证码登录已禁用）
    if (!username || !password) {
      auth.triggerToast("请输入邮箱和密码！", "error");
      return;
    }
    try {
      const body = {
        login_type: "password",
        account: username,
        password: password,
      };
      setIsLoggingIn(true);
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        const errData = await res.json();
        auth.triggerToast(errData.detail || "登录失败，请检查账号密码！", "error");
        setIsLoggingIn(false);
        return;
      }

      const data = await res.json();
      localStorage.setItem("interviewVar_token", data.access_token);
      auth.login(data.user);
      // 通知同浏览器其他 tab：本账号刚在另一个 tab 签发了新 token，让它们立即验证自己的 token。
      // 不广播的话，跨 tab 只能等 60s 长轮询才发现被踢，体验差。
      try {
        new BroadcastChannel("auth:sessions").postMessage({
          type: "token-issued"
        });
      } catch {
        // 老浏览器不支持
      }
      // 登录成功 → 跳转到落地页
      router.push("/");
    } catch (err) {
      auth.triggerToast("无法连接到后端服务！", "error");
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleForgotGetCode = async () => {
    // 内测版本：只支持邮箱找回密码
    const target = forgotEmail;
    if (!target) {
      auth.triggerToast("请输入邮箱地址！", "error");
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(target)) {
      auth.triggerToast("请输入正确的邮箱地址格式！", "error");
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/api/auth/send-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "email", target })
      });
      if (!res.ok) {
        const errData = await res.json();
        auth.triggerToast(errData.detail || "发送验证码失败！", "error");
        return;
      }
      setForgotCountdown(60);
      auth.triggerToast("验证码已发送，请查收！");
    } catch (err) {
      auth.triggerToast("无法连接到后端服务！", "error");
    }
  };

  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // 内测版本：只支持邮箱找回密码
    const target = forgotEmail;

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(target)) {
      auth.triggerToast("请输入正确的邮箱地址格式！", "error");
      return;
    }

    if (!forgotCode) {
      auth.triggerToast("请输入验证码！", "error");
      return;
    }

    const hasUppercase = /[A-Z]/.test(forgotPassword);
    const hasLowercase = /[a-z]/.test(forgotPassword);
    const hasNumber = /\d/.test(forgotPassword);
    if (forgotPassword.length < 8 || !hasUppercase || !hasLowercase || !hasNumber) {
      auth.triggerToast("新密码长度不能少于8位，且必须包含大小写字母和数字！", "error");
      return;
    }

    if (forgotPassword !== forgotConfirmPassword) {
      auth.triggerToast("两次输入的密码不一致！", "error");
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/api/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "email",
          target,
          verify_code: forgotCode,
          new_password: forgotPassword
        })
      });

      if (!res.ok) {
        const errData = await res.json();
        auth.triggerToast(errData.detail || "密码重置失败，请检查验证码！", "error");
        return;
      }

      auth.triggerToast("密码重置成功，请使用新密码登录！");
      setShowForgot(false);
      setForgotEmail("");
      setForgotCode("");
      setForgotPassword("");
      setForgotConfirmPassword("");
      setForgotCountdown(0);
    } catch (err) {
      auth.triggerToast("无法连接到后端服务！", "error");
    }
  };

  return (
    <AnimatePresence>
      {/* 1. LOGIN MODAL */}
      {auth.showLogin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div
            onClick={() => auth.setShowLogin(false)}
            className="absolute inset-0 bg-[#050B1A]/80 backdrop-blur-md transition-opacity duration-300"
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="bg-[#0e1626]/95 border border-white/10 rounded-3xl p-8 max-w-md w-full text-center relative z-10 space-y-6 shadow-2xl transition-all duration-300"
          >
            {!showForgot ? (
              <>
                <div className="flex justify-between items-center pb-2 border-b border-white/5">
                  <span className="font-label-mono text-xs text-[#AFA7FF] tracking-widest uppercase font-extrabold">
                    面试驾到 Login
                  </span>
                  <button
                    onClick={() => auth.setShowLogin(false)}
                    className="text-white/40 hover:text-white transition-colors"
                  >
                    <span className="material-symbols-outlined text-lg">close</span>
                  </button>
                </div>

                {/* Logo Graphic */}
                <div className="space-y-1.5 flex flex-col items-center">
                  <img src="/logo/logo_icon.svg" alt="面试驾到" className="w-16 h-16 object-contain mb-1 drop-shadow-md" />
                  <h3 className="font-black text-white text-xl md:text-2xl">欢迎登录 面试驾到</h3>
                  <p className="text-white/45 text-xs md:text-sm font-bold">内测版本 · 邮箱密码登录</p>
                </div>

                {/* Form */}
                <form
                  onSubmit={handleLoginSubmit}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      handleLoginSubmit(e);
                    }
                  }}
                  className="space-y-4 text-sm font-semibold text-white/60 text-left"
                >
                  {/* 内测版本：登录支持用户名 / 邮箱地址 + 密码（删除验证码登录 tab） */}
                  <div>
                    <label className="block mb-1.5">用户名 / 邮箱地址</label>
                    <input
                      type="text"
                      required
                      placeholder="请输入用户名或邮箱地址"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      className="w-full py-3 px-3.5 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/20 focus:outline-none focus:border-[#AFA7FF]/40 text-sm md:text-base font-semibold"
                    />
                  </div>
                  <div>
                    <label className="block mb-1.5">登录密码</label>
                    <div className="relative">
                      <input
                        type={showPassword ? "text" : "password"}
                        required
                        placeholder="请输入密码"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="w-full py-3 px-3.5 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/20 focus:outline-none focus:border-[#AFA7FF]/40 pr-10 text-sm md:text-base font-semibold"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white transition-colors cursor-pointer flex items-center justify-center"
                      >
                        <span className="material-symbols-outlined text-base">
                          {showPassword ? "visibility_off" : "visibility"}
                        </span>
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={isLoggingIn}
                    className="w-full py-4 mt-6.5 bg-[#AFA7FF] text-[#050B1A] text-base rounded-xl font-black text-sm md:text-base hover:scale-[1.01] active:scale-98 transition-all cursor-pointer flex items-center justify-center gap-1.5 text-center shadow-lg shadow-[#AFA7FF]/15 disabled:opacity-50 disabled:scale-100 disabled:cursor-not-allowed"
                  >
                    {isLoggingIn ? (
                      <>
                        正在登录...
                        <div className="w-4 h-4 border-2 border-[#050B1A] border-t-transparent rounded-full animate-spin ml-1" />
                      </>
                    ) : (
                      <>
                        立即登录 <span className="material-symbols-outlined text-lg md:text-xl">login</span>
                      </>
                    )}
                  </button>

                  <div className="flex justify-between items-center text-xs md:text-sm text-white/30 font-bold font-mono pt-1 select-none">
                    <a className="hover:text-[#AFA7FF] transition-colors cursor-pointer" onClick={() => { auth.setShowLogin(false); router.push("/register"); }}>
                      没有账号？立即注册
                    </a>
                    <a className="hover:text-white transition-colors cursor-pointer" onClick={() => setShowForgot(true)}>忘记密码？</a>
                  </div>
                </form>
              </>
            ) : (
              <>
                <div className="flex justify-between items-center pb-2 border-b border-white/5">
                  <span className="font-label-mono text-xs text-[#AFA7FF] tracking-widest uppercase font-extrabold">
                    面试驾到 Recovery
                  </span>
                  <button
                    onClick={() => { setShowForgot(false); auth.setShowLogin(false); }}
                    className="text-white/40 hover:text-white transition-colors"
                  >
                    <span className="material-symbols-outlined text-lg">close</span>
                  </button>
                </div>

                {/* Logo Graphic */}
                <div className="space-y-1.5 flex flex-col items-center">
                  <img src="/logo/logo_icon.svg" alt="面试驾到" className="w-16 h-16 object-contain mb-1 drop-shadow-md" />
                  <h3 className="font-black text-white text-xl md:text-2xl">重置账户密码</h3>
                  <p className="text-white/45 text-xs md:text-sm font-bold">通过邮箱验证身份后设定新密码</p>
                </div>

                {/* Form */}
                <form
                  onSubmit={handleForgotSubmit}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      handleForgotSubmit(e);
                    }
                  }}
                  className="space-y-4 text-sm font-semibold text-white/60 text-left"
                >
                  {/* 内测版本：只支持邮箱找回（删除手机找回 tab） */}
                  <div>
                    <label className="block mb-1.5">邮箱地址</label>
                    <input
                      type="email"
                      required
                      placeholder="请输入绑定的邮箱"
                      value={forgotEmail}
                      onChange={(e) => setForgotEmail(e.target.value)}
                      className="w-full py-3 px-3.5 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/20 focus:outline-none focus:border-[#AFA7FF]/40 text-sm md:text-base font-semibold"
                    />
                  </div>

                  <div>
                    <label className="block mb-1.5">验证码</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        required
                        placeholder="输入 6 位验证码"
                        value={forgotCode}
                        onChange={(e) => setForgotCode(e.target.value)}
                        className="flex-1 py-3 px-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/20 focus:outline-none focus:border-[#AFA7FF]/40 text-sm md:text-base font-semibold"
                      />
                      <button
                        type="button"
                        onClick={handleForgotGetCode}
                        disabled={forgotCountdown > 0}
                        className={`px-4 py-3 rounded-xl border border-[#AFA7FF]/20 text-[#AFA7FF] font-black text-sm hover:bg-[#AFA7FF]/5 active:scale-95 transition-all select-none whitespace-nowrap cursor-pointer ${
                          forgotCountdown > 0 ? "opacity-50 cursor-not-allowed" : ""
                        }`}
                      >
                        {forgotCountdown > 0 ? `${forgotCountdown}s` : "获取验证码"}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block mb-1.5">设置新密码</label>
                    <div className="relative">
                      <input
                        type={showForgotPwd ? "text" : "password"}
                        required
                        placeholder="包含大小写与数字，不少于8位"
                        value={forgotPassword}
                        onChange={(e) => setForgotPassword(e.target.value)}
                        className="w-full py-3 px-3.5 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/20 focus:outline-none focus:border-[#AFA7FF]/40 pr-10 text-sm md:text-base font-semibold"
                      />
                      <button
                        type="button"
                        onClick={() => setShowForgotPwd(!showForgotPwd)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white transition-colors cursor-pointer flex items-center justify-center"
                      >
                        <span className="material-symbols-outlined text-base">
                          {showForgotPwd ? "visibility_off" : "visibility"}
                        </span>
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block mb-1.5">确认新密码</label>
                    <input
                      type={showForgotPwd ? "text" : "password"}
                      required
                      placeholder="请再次确认密码"
                      value={forgotConfirmPassword}
                      onChange={(e) => setForgotConfirmPassword(e.target.value)}
                      className="w-full py-3 px-3.5 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/20 focus:outline-none focus:border-[#AFA7FF]/40 text-sm md:text-base font-semibold"
                    />
                  </div>

                  <button
                    type="submit"
                    className="w-full py-4 mt-6.5 bg-[#AFA7FF] text-[#050B1A] rounded-xl font-black text-sm md:text-base hover:scale-[1.01] active:scale-98 transition-all cursor-pointer flex items-center justify-center gap-1 text-center shadow-lg shadow-[#AFA7FF]/15"
                  >
                    确认重置密码 <span className="material-symbols-outlined text-lg md:text-xl">lock_reset</span>
                  </button>

                  <div className="flex justify-center items-center text-xs md:text-sm text-white/35 font-bold pt-1 select-none">
                    <a
                      className="hover:text-white transition-colors cursor-pointer flex items-center gap-1"
                      onClick={() => setShowForgot(false)}
                    >
                      <span className="material-symbols-outlined text-sm">arrow_back</span> 返回账号登录
                    </a>
                  </div>
                </form>
              </>
            )}
          </motion.div>
        </div>
      )}

      {/* 2. LOGOUT MODAL */}
      {auth.showLogout && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div
            onClick={() => auth.setShowLogout(false)}
            className="absolute inset-0 bg-[#050B1A]/80 backdrop-blur-md transition-opacity duration-300"
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="bg-[#0e1626]/95 border border-white/10 rounded-3xl p-8 max-w-md w-full text-center relative z-10 space-y-6 shadow-2xl"
          >
            <div className="w-16 h-16 rounded-full bg-[#FF7A95]/10 text-[#FF7A95] flex items-center justify-center mx-auto">
              <span className="material-symbols-outlined !text-4xl">logout</span>
            </div>
            
            <div className="space-y-2 text-center">
              <h3 className="font-extrabold text-white text-xl md:text-2xl">退出登录</h3>
              <p className="text-white/45 text-sm font-semibold leading-relaxed">
                您确定要退出当前账号登录吗？退出后可随时重新登录。
              </p>
            </div>

            <div className="flex gap-4 text-sm font-black md:text-base">
              <button
                onClick={() => auth.setShowLogout(false)}
                className="flex-1 py-3.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white transition-all cursor-pointer text-center"
              >
                取消
              </button>
              <button
                onClick={() => auth.logout()}
                className="flex-1 py-3.5 bg-[#FF7A95] text-[#050B1A] rounded-xl transition-all cursor-pointer text-center shadow-lg shadow-[#FF7A95]/10"
              >
                退出登录
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* 3. DELETE ACCOUNT MODAL */}
      {auth.showDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div
            onClick={() => auth.setShowDelete(false)}
            className="absolute inset-0 bg-[#050B1A]/80 backdrop-blur-md transition-opacity duration-300"
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="bg-[#0e1626]/95 border border-white/10 rounded-3xl p-8 max-w-md w-full text-center relative z-10 space-y-6 shadow-2xl"
          >
            <div className="w-16 h-16 rounded-full bg-[#FF7A95]/10 text-[#FF7A95] flex items-center justify-center mx-auto">
              <span className="material-symbols-outlined text-4xl">warning</span>
            </div>
            
            <div className="space-y-2 text-center">
              <h3 className="font-extrabold text-white text-xl md:text-2xl">注销账号确认</h3>
              <p className="text-white/45 text-sm font-semibold leading-relaxed">
                警告：注销后，您的所有分析记录、求职数据及会员权益将被<span className="text-[#FF7A95]">永久删除且无法恢复</span>。确定要注销此账号吗？
              </p>
            </div>

            <div className="flex gap-4 text-sm font-black md:text-base">
              <button
                onClick={() => auth.setShowDelete(false)}
                className="flex-1 py-3.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white transition-all cursor-pointer text-center"
              >
                我再想想
              </button>
              <button
                onClick={() => auth.deleteAccount()}
                className="flex-1 py-3.5 bg-[#FF7A95] text-[#050B1A] rounded-xl transition-all cursor-pointer text-center shadow-lg shadow-[#FF7A95]/10"
              >
                确定注销
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

// Global user profile button with dropdown for Logout and Account Deletion
export function UserMenu() {
  const auth = useAuth();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="relative">
      <div
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 border-l border-white/10 pl-3.5 cursor-pointer select-none group"
      >
        <div className="w-8 h-8 rounded-full bg-slate-900 border border-white/10 overflow-hidden shrink-0 group-hover:border-[#AFA7FF]/40 transition-colors">
          <img src={auth.user.avatar || "/register.jpg"} alt={auth.user.name} className="w-full h-full object-cover" />
        </div>
        <span className="text-on-surface font-extrabold text-sm whitespace-nowrap hidden sm:block group-hover:text-white transition-colors">
          {auth.user.name}
        </span>
        <span className="material-symbols-outlined text-xs text-white/30 group-hover:text-white transition-all transform group-hover:rotate-180">
          keyboard_arrow_down
        </span>
      </div>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <div className="absolute right-0 mt-2.5 w-56 bg-[#0e1626] border border-white/10 rounded-2xl p-3 shadow-2xl z-50 text-left space-y-1 animate-fade-in">
            <div className="px-2.5 py-2 border-b border-white/5 mb-1.5 flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-black text-white truncate">{auth.user.name}</p>
                {auth.user.status && (
                  <span className="px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 text-xs font-extrabold border border-emerald-500/20 shrink-0">
                    {auth.user.status}
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-white/40 font-semibold truncate">{auth.user.role || "求职者"}</p>
                <span className="px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-300 text-[11px] font-extrabold border border-purple-500/20 shrink-0">
                  内测用户
                </span>
              </div>
            </div>
            <button
              onClick={() => {
                setIsOpen(false);
                auth.setShowLogout(true);
              }}
              className="w-full px-2.5 py-2.5 text-sm font-bold text-white/70 hover:text-white hover:bg-white/5 rounded-xl transition-all flex items-center gap-2 cursor-pointer text-left"
            >
              <span className="material-symbols-outlined text-lg text-[#FF7A95]">logout</span>
              退出登录
            </button>
            <button
              onClick={() => {
                setIsOpen(false);
                auth.setShowDelete(true);
              }}
              className="w-full px-2.5 py-2.5 text-sm font-bold text-[#FF7A95]/80 hover:text-[#FF7A95] hover:bg-[#FF7A95]/5 rounded-xl transition-all flex items-center gap-2 cursor-pointer text-left"
            >
              <span className="material-symbols-outlined text-lg text-[#FF7A95]">delete_forever</span>
              注销账号
            </button>
          </div>
        </>
      )}
    </div>
  );
}
