"use client";

import { createContext, useContext, useState, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";

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
  membership?: string;
  phone?: string;
  email?: string;
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
  updateUser: (data: Partial<UserProfile>) => void;
  triggerToast: (msg: string) => void;
}

const defaultUser: UserProfile = {
  name: "Dame Zheng",
  avatar: "/debugger-2.jpg",
  role: "后端开发工程师 · P6",
  company: "字节跳动",
  years: "5年",
  status: "在职",
  salary: "35K * 16",
  targetCompany: "腾讯/美团等 (目标)",
  targetRole: "高级后端专家",
  targetGrade: "L8 / P7",
  targetSalary: "35K-45K",
  gender: "male",
  age: "28",
  school: "清华大学",
  degree: "本科",
  gradYear: "2018",
  hasExp: true
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(true);
  const [user, setUser] = useState<UserProfile>(defaultUser);
  const [showLogin, setShowLogin] = useState(false);
  const [showLogout, setShowLogout] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // Load state on mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      const storedLoggedIn = localStorage.getItem("offerPilot_isLoggedIn");
      if (storedLoggedIn === "false") {
        setIsLoggedIn(false);
      } else {
        setIsLoggedIn(true);
      }

      const storedUser = localStorage.getItem("offerPilot_user");
      if (storedUser) {
        try {
          setUser(JSON.parse(storedUser));
        } catch (e) {
          setUser(defaultUser);
        }
      } else {
        localStorage.setItem("offerPilot_user", JSON.stringify(defaultUser));
      }

      // If we have a token, refresh user data from backend so fields
      // like phone / email (not stored in localStorage) are populated.
      const token = localStorage.getItem("offerPilot_token");
      if (token) {
        fetch("http://localhost:8001/api/auth/me", {
          headers: { "Authorization": `Bearer ${token}` }
        })
          .then(res => {
            if (res.status === 401) {
              // Token has expired or is invalid, clear credentials and log out
              localStorage.removeItem("offerPilot_token");
              setIsLoggedIn(false);
              localStorage.setItem("offerPilot_isLoggedIn", "false");
              setUser(defaultUser);
              localStorage.removeItem("offerPilot_user");
              window.dispatchEvent(new Event("storage"));
              return null;
            }
            return res.ok ? res.json() : null;
          })
          .then(data => {
            if (data) {
              const merged = { ...defaultUser, ...user, ...data };
              setUser(merged);
              localStorage.setItem("offerPilot_user", JSON.stringify(merged));
              window.dispatchEvent(new Event("storage"));
            }
          })
          .catch(() => {});
      }
    }
  }, []);

  const triggerToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => {
      setToastMsg(null);
    }, 2500);
  };

  const login = (data?: Partial<UserProfile>) => {
    setIsLoggedIn(true);
    localStorage.setItem("offerPilot_isLoggedIn", "true");
    if (data) {
      const newUser = { ...user, ...data };
      setUser(newUser);
      localStorage.setItem("offerPilot_user", JSON.stringify(newUser));
    }
    setShowLogin(false);
    triggerToast("登录成功，欢迎回来！");
    // Trigger storage event for page updates
    window.dispatchEvent(new Event("storage"));
  };

  const logout = async () => {
    const token = localStorage.getItem("offerPilot_token");
    if (token) {
      try {
        await fetch("http://localhost:8001/api/auth/logout", {
          method: "POST",
          headers: { "Authorization": `Bearer ${token}` }
        });
      } catch (e) {}
    }
    localStorage.removeItem("offerPilot_token");
    setIsLoggedIn(false);
    localStorage.setItem("offerPilot_isLoggedIn", "false");
    setShowLogout(false);
    triggerToast("已安全退出登录！");
    router.push("/");
    window.dispatchEvent(new Event("storage"));
  };

  const deleteAccount = async () => {
    const token = localStorage.getItem("offerPilot_token");
    if (token) {
      try {
        const res = await fetch("http://localhost:8001/api/auth/delete-account", {
          method: "DELETE",
          headers: { "Authorization": `Bearer ${token}` }
        });
        if (!res.ok) {
          const errData = await res.json();
          triggerToast(errData.detail || "注销账号失败！");
          return;
        }
      } catch (e) {
        triggerToast("无法连接到后端服务！");
        return;
      }
    }
    localStorage.removeItem("offerPilot_token");
    setIsLoggedIn(false);
    localStorage.setItem("offerPilot_isLoggedIn", "false");
    localStorage.removeItem("offerPilot_user");
    setUser(defaultUser);
    setShowDelete(false);
    triggerToast("账号已注销成功，感谢您的使用！");
    router.push("/");
    window.dispatchEvent(new Event("storage"));
  };

  const updateUser = async (data: Partial<UserProfile>) => {
    const newUser = { ...user, ...data };
    setUser(newUser);
    localStorage.setItem("offerPilot_user", JSON.stringify(newUser));
    window.dispatchEvent(new Event("storage"));

    const token = localStorage.getItem("offerPilot_token");
    if (token) {
      try {
        const body: any = {};
        if (data.name !== undefined) body.username = data.name;
        if (data.gender !== undefined) body.gender = data.gender;
        if (data.age !== undefined) body.age = parseInt(data.age) || 0;
        if (data.status !== undefined) {
          body.job_status = data.status === "在职" ? "active" : data.status === "离职" ? "resigned" : "student";
        }
        if (data.avatar !== undefined) body.avatar_url = data.avatar;
        
        if (data.years !== undefined) {
          const matched = data.years.match(/^(\d+年)?(\d+个月)?/);
          body.experience_years = matched?.[1] || "在校/应届";
          body.experience_months = matched?.[2] || "0个月";
        }
        if (data.company !== undefined) body.company_name = data.company;
        if (data.role !== undefined) body.role_name = data.role.split(" · ")[0];
        
        if (data.salary !== undefined) {
          const salMatch = data.salary.match(/(\d+)K\s*-\s*(\d+)K/i);
          if (salMatch) {
            body.salary_min = parseInt(salMatch[1]);
            body.salary_max = parseInt(salMatch[2]);
          }
        }
        if (data.school !== undefined) body.school = data.school;
        if (data.degree !== undefined) body.degree = data.degree;
        if (data.hasExp !== undefined) body.has_experience = data.hasExp;
        
        if (data.targetCompany !== undefined) body.target_company = data.targetCompany;
        if (data.targetRole !== undefined) body.target_role = data.targetRole;
        if (data.targetGrade !== undefined) body.target_grade = data.targetGrade;
        if (data.targetSalary !== undefined) {
          const salMatch = data.targetSalary.match(/(\d+)K\s*-\s*(\d+)K/i);
          if (salMatch) {
            body.target_salary_min = parseInt(salMatch[1]);
            body.target_salary_max = parseInt(salMatch[2]);
          }
        }

        await fetch("http://localhost:8001/api/auth/profile/update", {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
          },
          body: JSON.stringify(body)
        });
      } catch (e) {
        console.error("Failed to sync profile to backend", e);
      }
    }
  };

  // Sync state between tabs/windows
  useEffect(() => {
    const handleStorageChange = () => {
      const storedLoggedIn = localStorage.getItem("offerPilot_isLoggedIn");
      setIsLoggedIn(storedLoggedIn !== "false");
      const storedUser = localStorage.getItem("offerPilot_user");
      if (storedUser) {
        try {
          setUser(JSON.parse(storedUser));
        } catch (e) {}
      }
    };
    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, []);

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
            <span className="material-symbols-outlined text-[#5DECCB] text-base md:text-lg">check_circle</span>
            <span className="text-sm md:text-base font-extrabold text-white">{toastMsg}</span>
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
  const [loginTab, setLoginTab] = useState<"password" | "code">("password");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [countdown, setCountdown] = useState(0);

  // Forgot Password State
  const [showForgot, setShowForgot] = useState(false);
  const [forgotTab, setForgotTab] = useState<"phone" | "email">("phone");
  const [forgotPhone, setForgotPhone] = useState("");
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotCode, setForgotCode] = useState("");
  const [forgotCountdown, setForgotCountdown] = useState(0);
  const [forgotPassword, setForgotPassword] = useState("");
  const [forgotConfirmPassword, setForgotConfirmPassword] = useState("");
  const [showForgotPwd, setShowForgotPwd] = useState(false);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (countdown > 0) {
      timer = setTimeout(() => setCountdown(countdown - 1), 1000);
    }
    return () => clearTimeout(timer);
  }, [countdown]);

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
      setForgotPhone("");
      setForgotEmail("");
      setForgotCode("");
      setForgotPassword("");
      setForgotConfirmPassword("");
      setForgotCountdown(0);
    }
  }, [auth.showLogin, showForgot]);

  const handleGetCode = async () => {
    if (!phone) {
      auth.triggerToast("请输入手机号！");
      return;
    }
    const phoneRegex = /^1[3-9]\d{9}$/;
    if (!phoneRegex.test(phone)) {
      auth.triggerToast("请输入正确的手机号格式！");
      return;
    }

    try {
      const res = await fetch("http://localhost:8001/api/auth/send-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "phone", target: phone })
      });
      if (!res.ok) {
        const errData = await res.json();
        auth.triggerToast(errData.detail || "发送验证码失败！");
        return;
      }
      setCountdown(60);
      auth.triggerToast("验证码已发送，请查收！");
    } catch (err) {
      auth.triggerToast("无法连接到后端服务！");
    }
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      let body: any = {};
      if (loginTab === "password") {
        if (!username || !password) {
          auth.triggerToast("请输入用户名和密码！");
          return;
        }
        body = {
          login_type: "password",
          account: username,
          password: password
        };
      } else {
        if (!phone || !code) {
          auth.triggerToast("请输入手机号和验证码！");
          return;
        }
        const phoneRegex = /^1[3-9]\d{9}$/;
        if (!phoneRegex.test(phone)) {
          auth.triggerToast("请输入正确的手机号格式！");
          return;
        }
        body = {
          login_type: "code",
          account: phone,
          verify_code: code
        };
      }

      const res = await fetch("http://localhost:8001/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        const errData = await res.json();
        auth.triggerToast(errData.detail || "登录失败，请检查账号密码/验证码！");
        return;
      }

      const data = await res.json();
      localStorage.setItem("offerPilot_token", data.access_token);
      auth.login(data.user);
    } catch (err) {
      auth.triggerToast("无法连接到后端服务！");
    }
  };

  const handleForgotGetCode = async () => {
    const isPhone = forgotTab === "phone";
    const target = isPhone ? forgotPhone : forgotEmail;
    if (!target) {
      auth.triggerToast(isPhone ? "请输入手机号！" : "请输入邮箱地址！");
      return;
    }
    if (isPhone) {
      const phoneRegex = /^1[3-9]\d{9}$/;
      if (!phoneRegex.test(target)) {
        auth.triggerToast("请输入正确的手机号格式！");
        return;
      }
    } else {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(target)) {
        auth.triggerToast("请输入正确的邮箱地址格式！");
        return;
      }
    }

    try {
      const res = await fetch("http://localhost:8001/api/auth/send-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: isPhone ? "phone" : "email", target })
      });
      if (!res.ok) {
        const errData = await res.json();
        auth.triggerToast(errData.detail || "发送验证码失败！");
        return;
      }
      setForgotCountdown(60);
      auth.triggerToast("验证码已发送，请查收！");
    } catch (err) {
      auth.triggerToast("无法连接到后端服务！");
    }
  };

  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const isPhone = forgotTab === "phone";
    const target = isPhone ? forgotPhone : forgotEmail;

    if (isPhone) {
      const phoneRegex = /^1[3-9]\d{9}$/;
      if (!phoneRegex.test(target)) {
        auth.triggerToast("请输入正确的手机号格式！");
        return;
      }
    } else {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(target)) {
        auth.triggerToast("请输入正确的邮箱地址格式！");
        return;
      }
    }

    if (!forgotCode) {
      auth.triggerToast("请输入验证码！");
      return;
    }

    const hasUppercase = /[A-Z]/.test(forgotPassword);
    const hasLowercase = /[a-z]/.test(forgotPassword);
    const hasNumber = /\d/.test(forgotPassword);
    if (forgotPassword.length < 8 || !hasUppercase || !hasLowercase || !hasNumber) {
      auth.triggerToast("新密码长度不能少于8位，且必须包含大小写字母和数字！");
      return;
    }

    if (forgotPassword !== forgotConfirmPassword) {
      auth.triggerToast("两次输入的密码不一致！");
      return;
    }

    try {
      const res = await fetch("http://localhost:8001/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: forgotTab,
          target,
          verify_code: forgotCode,
          new_password: forgotPassword
        })
      });

      if (!res.ok) {
        const errData = await res.json();
        auth.triggerToast(errData.detail || "密码重置失败，请检查验证码！");
        return;
      }

      auth.triggerToast("密码重置成功，请使用新密码登录！");
      setShowForgot(false);
      setForgotPhone("");
      setForgotEmail("");
      setForgotCode("");
      setForgotPassword("");
      setForgotConfirmPassword("");
      setForgotCountdown(0);
    } catch (err) {
      auth.triggerToast("无法连接到后端服务！");
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
                    OfferPilot Login
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
                  <div className="w-14 h-14 rounded-2xl bg-white/[0.03] border border-white/10 flex items-center justify-center mb-1 shadow-inner">
                    <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none">
                      <path d="M12 2L20 7V17L12 22L4 17V7L12 2Z" fill="url(#nav-brand-logo-modal-login)" />
                      <path d="M12 6L16 11H13V18L12 18L11 18V13H8L12 6Z" fill="#0b1326" />
                      <defs>
                        <linearGradient id="nav-brand-logo-modal-login" x1="0" y1="0" x2="1" y2="1">
                          <stop offset="0%" stopColor="#c0c1ff" />
                          <stop offset="100%" stopColor="#ffb2b7" />
                        </linearGradient>
                      </defs>
                    </svg>
                  </div>
                  <h3 className="font-black text-white text-xl md:text-2xl">欢迎登录 OfferPilot</h3>
                  <p className="text-white/45 text-xs md:text-sm font-bold">AI 助力，高效求职</p>
                </div>

                {/* Tab switchers */}
                <div className="flex bg-[#050B1A] p-1.5 rounded-xl border border-white/5 font-bold text-sm select-none">
                  <button
                    type="button"
                    onClick={() => setLoginTab("password")}
                    className={`flex-1 py-2.5 rounded-lg text-center transition-all cursor-pointer ${
                      loginTab === "password" ? "bg-[#AFA7FF]/15 text-[#AFA7FF]" : "text-white/40 hover:text-white/70"
                    }`}
                  >
                    密码登录
                  </button>
                  <button
                    type="button"
                    onClick={() => setLoginTab("code")}
                    className={`flex-1 py-2.5 rounded-lg text-center transition-all cursor-pointer ${
                      loginTab === "code" ? "bg-[#AFA7FF]/15 text-[#AFA7FF]" : "text-white/40 hover:text-white/70"
                    }`}
                  >
                    验证码登录
                  </button>
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
                  {loginTab === "password" ? (
                    <>
                      <div>
                        <label className="block mb-1.5">用户名 / 手机号 / 邮箱</label>
                        <input
                          type="text"
                          required
                          placeholder="请输入您的账号"
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
                    </>
                  ) : (
                    <>
                      <div>
                        <label className="block mb-1.5">手机号码</label>
                        <div className="flex gap-2">
                          <select className="py-3 px-2 bg-white/5 border border-white/10 rounded-xl text-white focus:outline-none focus:border-[#AFA7FF]/40 text-sm font-semibold shrink-0">
                            <option className="bg-[#0e1626]">+86</option>
                            <option className="bg-[#0e1626]">+852</option>
                            <option className="bg-[#0e1626]">+1</option>
                          </select>
                          <input
                            type="tel"
                            required
                            placeholder="请输入手机号"
                            value={phone}
                            onChange={(e) => setPhone(e.target.value)}
                            className="flex-1 py-3 px-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/20 focus:outline-none focus:border-[#AFA7FF]/40 text-sm md:text-base font-semibold"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block mb-1.5">短信验证码</label>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            required
                            placeholder="输入 6 位验证码"
                            value={code}
                            onChange={(e) => setCode(e.target.value)}
                            className="flex-1 py-3 px-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/20 focus:outline-none focus:border-[#AFA7FF]/40 text-sm md:text-base font-semibold"
                          />
                          <button
                            type="button"
                            onClick={handleGetCode}
                            disabled={countdown > 0}
                            className={`px-4 py-3 rounded-xl border border-[#AFA7FF]/20 text-[#AFA7FF] font-black text-sm hover:bg-[#AFA7FF]/5 active:scale-95 transition-all select-none whitespace-nowrap cursor-pointer ${
                              countdown > 0 ? "opacity-50 cursor-not-allowed" : ""
                            }`}
                          >
                            {countdown > 0 ? `${countdown}s` : "获取验证码"}
                          </button>
                        </div>
                      </div>
                    </>
                  )}

                  <button
                    type="submit"
                    className="w-full py-4 mt-6.5 bg-[#AFA7FF] text-[#050B1A] text-base rounded-xl font-black text-sm md:text-base hover:scale-[1.01] active:scale-98 transition-all cursor-pointer flex items-center justify-center gap-1 text-center shadow-lg shadow-[#AFA7FF]/15"
                  >
                    立即登录 <span className="material-symbols-outlined text-lg md:text-xl">login</span>
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
                    OfferPilot Recovery
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
                  <div className="w-14 h-14 rounded-2xl bg-white/[0.03] border border-white/10 flex items-center justify-center mb-1 shadow-inner">
                    <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none">
                      <path d="M12 2L20 7V17L12 22L4 17V7L12 2Z" fill="url(#nav-brand-logo-modal-forgot)" />
                      <path d="M12 6L16 11H13V18L12 18L11 18V13H8L12 6Z" fill="#0b1326" />
                      <defs>
                        <linearGradient id="nav-brand-logo-modal-forgot" x1="0" y1="0" x2="1" y2="1">
                          <stop offset="0%" stopColor="#c0c1ff" />
                          <stop offset="100%" stopColor="#ffb2b7" />
                        </linearGradient>
                      </defs>
                    </svg>
                  </div>
                  <h3 className="font-black text-white text-xl md:text-2xl">重置账户密码</h3>
                  <p className="text-white/45 text-xs md:text-sm font-bold">验证身份以设定新密码</p>
                </div>

                {/* Tab switchers */}
                <div className="flex bg-[#050B1A] p-1.5 rounded-xl border border-white/5 font-bold text-sm select-none">
                  <button
                    type="button"
                    onClick={() => {
                      setForgotTab("phone");
                      setForgotPhone("");
                      setForgotEmail("");
                      setForgotCode("");
                      setForgotPassword("");
                      setForgotConfirmPassword("");
                      setForgotCountdown(0);
                    }}
                    className={`flex-1 py-2.5 rounded-lg text-center transition-all cursor-pointer ${
                      forgotTab === "phone" ? "bg-[#AFA7FF]/15 text-[#AFA7FF]" : "text-white/40 hover:text-white/70"
                    }`}
                  >
                    手机找回
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setForgotTab("email");
                      setForgotPhone("");
                      setForgotEmail("");
                      setForgotCode("");
                      setForgotPassword("");
                      setForgotConfirmPassword("");
                      setForgotCountdown(0);
                    }}
                    className={`flex-1 py-2.5 rounded-lg text-center transition-all cursor-pointer ${
                      forgotTab === "email" ? "bg-[#AFA7FF]/15 text-[#AFA7FF]" : "text-white/40 hover:text-white/70"
                    }`}
                  >
                    邮箱找回
                  </button>
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
                  {forgotTab === "phone" ? (
                    <div>
                      <label className="block mb-1.5">手机号码</label>
                      <input
                        type="tel"
                        required
                        placeholder="请输入绑定的手机号"
                        value={forgotPhone}
                        onChange={(e) => setForgotPhone(e.target.value)}
                        className="w-full py-3 px-3.5 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/20 focus:outline-none focus:border-[#AFA7FF]/40 text-sm md:text-base font-semibold"
                      />
                    </div>
                  ) : (
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
                  )}

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
              <span className="material-symbols-outlined text-4xl">logout</span>
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
          <img src={auth.user.avatar} alt={auth.user.name} className="w-full h-full object-cover" />
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
              <p className="text-xs text-white/40 font-semibold truncate">{auth.user.role || "求职者"}</p>
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
