"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth, UserMenu } from "@/components/AuthProvider";
import { useModerationPreview } from "@/hooks/useModerationPreview";
import { openLegalTerms, openLegalPrivacy, openLegalContact } from "@/components/LegalModals";
import { API_BASE } from "@/lib/api";
import { getQuotaStatus } from "@/lib/quotaClient";

interface TimelineItem {
  id: string;
  type: "audio" | "text" | "resume" | "live";
  title: string;
  score: number;
  grade: string;
  company: string;
  role: string;
  round: string;
  details: string;
  created_at: string | null;
}

function formatRelativeTime(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffMin < 1) return "刚刚";
    if (diffMin < 60) return `${diffMin}分钟前`;
    if (diffHours < 24) return `${diffHours}小时前`;
    if (diffDays < 30) return `${diffDays}天前`;
    return d.toLocaleDateString();
  } catch {
    return dateStr;
  }
}

async function fetchTimeline(token: string): Promise<TimelineItem[]> {
  const res = await fetch(`${API_BASE}/api/memory/timeline`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.items || [];
}

export default function CareerDashboard() {
  const router = useRouter();
  const auth = useAuth();

  // =========================================================================
  // STATE MANAGEMENT
  // =========================================================================
  const [recentActivity, setRecentActivity] = useState<TimelineItem[]>([]);
  const [quotaStatus, setQuotaStatus] = useState<any>(null);
  const [liveQuota, setLiveQuota] = useState<any>(null);

  // 最近活动 & 资源配额获取
  useEffect(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("interviewVar_token") : null;
    if (!auth.isLoggedIn || !token) return;
    fetchTimeline(token).then(items => setRecentActivity(items));

    // 获取分析配额
    getQuotaStatus().then(status => setQuotaStatus(status));

    // 获取模拟面试配额
    const headers = { Authorization: `Bearer ${token}` };
    fetch(`${API_BASE}/api/live/quota`, { headers })
      .then(r => r.ok ? r.json() : null)
      .then(q => { if (q) setLiveQuota(q); })
      .catch(() => {});
  }, [auth.isLoggedIn]);
  const [profile, setProfile] = useState({
    name: "张三",
    status: "在职",
    title: "高级后端工程师",
    experienceYears: "6年",
    experienceMonths: "0个月",
    city: "深圳",
    joinDays: 128,
    tags: [] as string[],
    company: "腾讯科技",
    role: "高级后端工程师",
    level: "高级",
    salaryMin: 25,
    salaryMax: 35,
    gender: "male",
    age: "26",
    school: "清华大学",
    degree: "本科",
    gradYear: "2018"
  });

  const [careerGoal, setCareerGoal] = useState({
    role: "架构师",
    level: "P7",
    salaryMin: 50,
    salaryMax: 70,
    city: "深圳",
    company: "腾讯/美团等 (目标)",
    matchRate: 72
  });

  // 目标匹配度正在由后端 LLM 综合生成（通常 3-10s），期间圆环中央显示 spinner
  const [isMatchRateLoading, setIsMatchRateLoading] = useState(false);

  const [accountSecurity, setAccountSecurity] = useState({
    email: "未绑定",
    phone: "未绑定",
    loginMethod: "密码登录",
    password: ""
  });

  // Modals visibility
  const [showEditProfileModal, setShowEditProfileModal] = useState(false);
  const [showEditGoalModal, setShowEditGoalModal] = useState(false);
  const [showEditSecurityModal, setShowEditSecurityModal] = useState(false);
  const [avatarError, setAvatarError] = useState(false);

  // Form states for modals
  const [profileForm, setProfileForm] = useState({ ...profile, tagsString: profile.tags.join(", ") });
  const [goalForm, setGoalForm] = useState({ ...careerGoal });
  const [securityForm, setSecurityForm] = useState({ ...accountSecurity });
  const [securityTab, setSecurityTab] = useState<"email">("email");

  // Verification states for security edits
  const [emailCountdown, setEmailCountdown] = useState(0);
  const [emailCode, setEmailCode] = useState("");
  const [isSendingCode, setIsSendingCode] = useState(false);

  // Saving loading states for buttons
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isSavingGoal, setIsSavingGoal] = useState(false);
  const [isSavingSecurity, setIsSavingSecurity] = useState(false);

  // Phase 3: 内容审核 preview hint（仅自由文本字段，结构化字段不审）
  const profileNameMod = useModerationPreview();

  useEffect(() => {
    if (profileNameMod.status === "block") auth.triggerToast("用户名涉嫌违规，请修改后提交", "error");
  }, [profileNameMod.status]);

  // ── Modal open handlers (reset form state from current data) ──
  const handleOpenProfileModal = () => {
    setProfileForm({
      ...profile,
      company: profile.company === "暂无公司" ? "" : profile.company,
      school: profile.school === "暂无学校" ? "" : profile.school,
      tagsString: profile.tags.join(", ")
    });
    setAvatarError(false);
    setShowEditProfileModal(true);
  };

  const handleOpenGoalModal = () => {
    setGoalForm({ ...careerGoal });
    setShowEditGoalModal(true);
  };

  const handleOpenSecurityModal = () => {
    setSecurityForm({ ...accountSecurity });
    setEmailCode("");
    setEmailCountdown(0);
    setSecurityTab("email");
    setShowEditSecurityModal(true);
  };

  const handleCloseSecurityModal = () => {
    setEmailCode("");
    setEmailCountdown(0);
    setShowEditSecurityModal(false);
  };

  // ── Countdown timers ──
  useEffect(() => {
    let interval: any;
    if (emailCountdown > 0) {
      interval = setInterval(() => {
        setEmailCountdown(prev => prev - 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [emailCountdown]);

  const handleSaveSecurity = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = localStorage.getItem("interviewVar_token");
    if (!token) {
      auth.triggerToast("未登录或会话已过期，请重新登录！", "error");
      return;
    }

    const isEmail = securityTab === "email";
    const value = isEmail ? securityForm.email : securityForm.phone;
    const verify_code = isEmail ? emailCode : phoneCode;

    if (!value) {
      auth.triggerToast(isEmail ? "请输入邮箱地址！" : "请输入手机号码！", "error");
      return;
    }
    if (!verify_code) {
      auth.triggerToast("请输入验证码！", "error");
      return;
    }
    setIsSavingSecurity(true);
    try {
      const token = localStorage.getItem("interviewVar_token");
      if (!token) {
        auth.triggerToast("未登录或会话已过期，请重新登录！", "error");
        return;
      }
      const body = {
        type: isEmail ? "email" : "phone",
        value,
        verify_code,
        new_password: securityForm.password || null,
      };
      const res = await fetch(`${API_BASE}/api/auth/security/update`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errData = await res.json();
        auth.triggerToast(errData.detail || "安全信息修改失败，请核对输入！", "error");
        return;
      }
      setAccountSecurity(prev => ({
        ...prev,
        email: securityForm.email,
        phone: securityForm.phone,
        password: "",
      }));
      auth.triggerToast("修改成功！");
      handleCloseSecurityModal();
    } catch (err) {
      auth.triggerToast("无法连接到后端服务！", "error");
    } finally {
      setIsSavingSecurity(false);
    }
  };

  const handleHistoryRedirect = () => {
    router.push("/memory?tab=timeline");
  };

  // Subscribe to external auth context — sync into local state whenever auth.user changes
  useEffect(() => {
    if (!auth.isLoggedIn || !auth.user) return;
    setAvatarError(false);
    setProfile(prev => {
      let expYearsVal = prev.experienceYears;
      let expMonthsVal = prev.experienceMonths;
      if (auth.user.years) {
        if (auth.user.years.includes("在校")) {
          expYearsVal = "在校";
        } else if (auth.user.years.includes("应届")) {
          expYearsVal = "应届";
        } else {
          const yrsMatch = auth.user.years.match(/(\d+)年/);
          if (yrsMatch) {
            expYearsVal = yrsMatch[1] + "年";
          }
        }
        const mthsMatch = auth.user.years.match(/(\d+)个月/);
        if (mthsMatch) {
          expMonthsVal = mthsMatch[1] + "个月";
        }
      }

      const curSalStr = auth.user.salary || "";
      const curSalMatch = curSalStr ? curSalStr.match(/(\d+)\s*K/i) : null;
      const curSalMatchMax = curSalStr ? curSalStr.match(/[-~—–]\s*(\d+)\s*K/i) : null;

      let cleanRole = "";
      let cleanLevel = "";
      let displayTitle = "—";
      if (auth.user.role) {
        const parts = auth.user.role.split(" · ");
        cleanRole = parts[0]?.trim() || "";
        cleanLevel = parts[1]?.trim() || "";
        if (cleanRole && cleanLevel) {
          displayTitle = `${cleanRole} · ${cleanLevel}`;
        } else if (cleanRole) {
          displayTitle = cleanRole;
        } else if (cleanLevel) {
          displayTitle = cleanLevel;
        }
      }

      let cleanCompany = auth.user.company || "";
      if (cleanCompany === "暂无公司") cleanCompany = "";

      let cleanSchool = auth.user.school || "";
      if (cleanSchool === "暂无学校") cleanSchool = "";

      return {
        ...prev,
        name: auth.user.name,
        status: auth.user.status || prev.status,
        title: displayTitle,
        experienceYears: expYearsVal,
        experienceMonths: expMonthsVal,
        company: cleanCompany,
        role: cleanRole,
        level: cleanLevel,
        salaryMin: curSalMatch ? parseInt(curSalMatch[1]) : 0,
        salaryMax: curSalMatchMax ? parseInt(curSalMatchMax[1]) : 0,
        gender: auth.user.gender || prev.gender,
        age: auth.user.age || prev.age,
        school: cleanSchool,
        degree: auth.user.degree || prev.degree,
        gradYear: auth.user.gradYear || prev.gradYear,
        joinDays: auth.user.createdAt
          ? Math.floor((Date.now() - new Date(auth.user.createdAt).getTime()) / 86400000)
          : prev.joinDays
      };
    });
    setCareerGoal(prev => {
      const next: any = {
        role: auth.user.targetRole !== undefined ? (auth.user.targetRole || "") : prev.role,
        level: auth.user.targetGrade !== undefined ? (auth.user.targetGrade || "") : prev.level,
        company: auth.user.targetCompany !== undefined ? (auth.user.targetCompany || "") : prev.company,
        city: auth.user.targetCity !== undefined ? (auth.user.targetCity || "") : prev.city,
        matchRate: auth.user.matchRate ?? prev.matchRate
      };
      const salStr = auth.user.targetSalary || "";
      const salMatch = salStr ? salStr.match(/(\d+)\s*K/i) : null;
      const salMatchMax = salStr ? salStr.match(/[-~—–]\s*(\d+)\s*K/i) : null;
      if (salMatch && salMatchMax) {
        next.salaryMin = parseInt(salMatch[1]);
        next.salaryMax = parseInt(salMatchMax[1]);
      } else {
        next.salaryMin = 0;
        next.salaryMax = 0;
      }
      return next;
    });
    setAccountSecurity(prev => ({
      ...prev,
      email: auth.user.email || "未绑定",
      phone: auth.user.phone || "未绑定"
    }));
  }, [auth.isLoggedIn, auth.user]);

  // ── 通用：拉一次 /match-rate，把最新值写回 localStorage + storage 事件，
  //     同时返回新值（用于轮询判定）。
  // ⚠️ 关键：必须从 localStorage 读最新 user 再 spread，**不能用闭包里的 auth.user**！
  //    setInterval 启动时闭包的 auth.user 是保存瞬间的旧值，如果直接 spread 会
  //    把 degree / target_company 等用户刚刚修改的字段一并回滚到旧值。
  const fetchAndSyncMatchRate = async (): Promise<{ rate: number | null; pending: boolean }> => {
    try {
      const token = typeof window !== "undefined" ? localStorage.getItem("interviewVar_token") : null;
      if (!token) return { rate: null, pending: false };
      const res = await fetch(`${API_BASE}/api/auth/match-rate`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) return { rate: null, pending: false };
      const data = await res.json();
      const realRate = typeof data?.matchRate === "number" ? data.matchRate : null;
      if (realRate !== null && typeof window !== "undefined") {
        // 从 localStorage 读最新 user → 只覆盖 matchRate，其他字段（如刚改的 degree/学历）不被回滚
        const stored = localStorage.getItem("interviewVar_user");
        if (stored) {
          try {
            const currentUser = JSON.parse(stored);
            const updatedUser = { ...currentUser, matchRate: realRate };
            localStorage.setItem("interviewVar_user", JSON.stringify(updatedUser));
            window.dispatchEvent(new Event("storage"));
          } catch {
            // JSON parse 失败则跳过
          }
        }
      }
      return { rate: realRate, pending: Boolean(data?.pending) };
    } catch {
      return { rate: null, pending: false };
    }
  };

  // 轮询：每 1.5s 拉一次，直到 pending=false 且 rate 与 oldRate 不同，或超时 30s
  // 30s 超时后主动调 /match-rate?force_rules=true 兜底（用规则算法），确保用户不会长时间看到 loading
  const startMatchRatePolling = (oldRate: number | null | undefined) => {
    setIsMatchRateLoading(true);
    const startedAt = Date.now();
    const TIMEOUT_MS = 30000;
    let stopped = false;
    const intervalId = window.setInterval(async () => {
      if (stopped) return;
      if (Date.now() - startedAt > TIMEOUT_MS) {
        // 超时兜底：主动调一次强制规则算法的接口
        window.clearInterval(intervalId);
        stopped = true;
        try {
          const token = typeof window !== "undefined" ? localStorage.getItem("interviewVar_token") : null;
          if (token) {
            await fetch(`${API_BASE}/api/auth/match-rate?force_rules=true`, {
              method: "GET",
              headers: { Authorization: `Bearer ${token}` }
            });
            // 触发一次同步，把新值（规则算法兜底值）写回本地
            await fetchAndSyncMatchRate();
          }
        } catch {
          // 兜底也失败，静默
        } finally {
          setIsMatchRateLoading(false);
        }
        return;
      }
      const { rate, pending } = await fetchAndSyncMatchRate();
      // 拿到新值（与保存前不同）就停
      if (!pending && rate !== null && rate !== oldRate) {
        window.clearInterval(intervalId);
        stopped = true;
        setIsMatchRateLoading(false);
      }
    }, 3000);
  };

  // 首次进入职业驾驶舱时，如果匹配度还未生成（老用户或后端规则改版后空值），
  // 自动触发一次 LLM 生成；返回后 AuthProvider 更新 user，整个页面通过上面的 useEffect 自动刷新展示。
  useEffect(() => {
    if (!auth.isLoggedIn || !auth.user) return;
    if (auth.user.matchRate !== null && auth.user.matchRate !== undefined) return;
    let cancelled = false;
    (async () => {
      setIsMatchRateLoading(true);
      await fetchAndSyncMatchRate();
      if (!cancelled) setIsMatchRateLoading(false);
    })();
    return () => { cancelled = true; };
    // 仅在用户登录态变化时触发一次，避免循环
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.isLoggedIn]);

  // Handlers for Save actions
  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingProfile(true);

    try {
      const normCompany = (v: string) => (v === "暂无公司" ? "" : v);
      const normSchool = (v: string) => (v === "暂无学校" ? "" : v);
      const profileUnchanged =
        profileForm.name === profile.name &&
        profileForm.status === profile.status &&
        profileForm.experienceYears === profile.experienceYears &&
        profileForm.experienceMonths === profile.experienceMonths &&
        profileForm.role === profile.role &&
        profileForm.level === profile.level &&
        profileForm.company === normCompany(profile.company) &&
        profileForm.salaryMin === profile.salaryMin &&
        profileForm.salaryMax === profile.salaryMax &&
        profileForm.gender === profile.gender &&
        profileForm.age === profile.age &&
        profileForm.school === normSchool(profile.school) &&
        profileForm.degree === profile.degree &&
        profileForm.gradYear === profile.gradYear &&
        profileForm.tagsString === profile.tags.join(", ");
      if (profileUnchanged) {
        setShowEditProfileModal(false);
        return;
      }

      // 提交时发起即时敏感词校验，消除 500ms 防抖竞态问题
      const nameRes = await profileNameMod.checkNow(profileForm.name, "profile_name_hint");

      if (nameRes === "block") {
        auth.triggerToast("用户名涉嫌违规，请修改后提交", "error");
        return;
      }

      const cleanRoleVal = (profileForm.role && profileForm.level)
        ? `${profileForm.role} · ${profileForm.level}`
        : (profileForm.role || profileForm.level || "");

      // 后端更新成功后才写入本地组件 state
      await auth.updateUser({
        name: profileForm.name,
        status: profileForm.status,
        years: `${profileForm.experienceYears}${profileForm.experienceMonths}`,
        company: profileForm.company,
        role: cleanRoleVal,
        salary: (profileForm.salaryMin > 0 && profileForm.salaryMax > 0) ? `${profileForm.salaryMin}K - ${profileForm.salaryMax}K` : "",
        gender: profileForm.gender,
        age: profileForm.age,
        school: profileForm.school,
        degree: profileForm.degree,
        gradYear: profileForm.gradYear
      });

      const updatedProfile = {
        ...profileForm,
        title: cleanRoleVal || "—",
        tags: profileForm.tagsString.split(",").map(t => t.trim()).filter(Boolean)
      };
      setProfile(updatedProfile);
      setShowEditProfileModal(false);
      startMatchRatePolling(careerGoal.matchRate);
    } catch (err) {
      // 保持在弹窗界面，不做任何修改
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleSaveGoal = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingGoal(true);

    try {
      // 校验期望薪资：最低不能高于最高
      if (goalForm.salaryMin > 0 && goalForm.salaryMax > 0 && goalForm.salaryMin > goalForm.salaryMax) {
        auth.triggerToast("最低薪资不能高于最高薪资，请重新输入！", "error");
        setGoalForm({ ...goalForm, salaryMin: careerGoal.salaryMin, salaryMax: careerGoal.salaryMax });
        return;
      }
      // 校验目标城市：最多三个
      const cities = goalForm.city.split(/[、,，]/).map(c => c.trim()).filter(Boolean);
      if (cities.length > 3) {
        auth.triggerToast("最多只能选择三个目标城市！", "error");
        setGoalForm({ ...goalForm, city: careerGoal.city });
        return;
      }
      const targetSalaryVal = (goalForm.salaryMin > 0 && goalForm.salaryMax > 0)
        ? `${goalForm.salaryMin}K - ${goalForm.salaryMax}K`
        : "";

      const goalUnchanged =
        goalForm.role === careerGoal.role &&
        goalForm.level === careerGoal.level &&
        goalForm.salaryMin === careerGoal.salaryMin &&
        goalForm.salaryMax === careerGoal.salaryMax &&
        goalForm.city === careerGoal.city &&
        goalForm.company === careerGoal.company;
      if (goalUnchanged) {
        setShowEditGoalModal(false);
        return;
      }

      await auth.updateUser({
        targetRole: goalForm.role,
        targetGrade: goalForm.level,
        targetSalary: targetSalaryVal,
        targetCompany: goalForm.company,
        targetCity: goalForm.city
      });

      setCareerGoal({ ...goalForm });
      setShowEditGoalModal(false);
      startMatchRatePolling(careerGoal.matchRate);
    } catch (err) {
      // 保持在弹窗界面，不做任何修改
    } finally {
      setIsSavingGoal(false);
    }
  };

  const handleGetSecurityEmailCode = async () => {
    if (!securityForm.email) {
      auth.triggerToast("请输入邮箱地址！", "error");
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(securityForm.email)) {
      auth.triggerToast("请输入正确的邮箱地址格式！", "error");
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/api/auth/send-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "email", target: securityForm.email })
      });
      if (!res.ok) {
        const errData = await res.json();
        auth.triggerToast(errData.detail || "发送验证码失败！", "error");
        return;
      }
      setEmailCountdown(60);
      auth.triggerToast("验证码已发送，请查收！");
    } catch (e) {
      auth.triggerToast("无法连接到后端服务！", "error");
    }
  };

  return (
    <div className="min-h-screen bg-background text-on-background font-body-md flex flex-col relative overflow-hidden select-none pt-20">
      
      {/* Background visual scifi canvas grid */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff03_1px,transparent_1px),linear-gradient(to_bottom,#ffffff03_1px,transparent_1px)] bg-[size:40px_40px] pointer-events-none z-0" />
      <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-primary/10 rounded-full blur-[160px] pointer-events-none z-0" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-secondary/5 rounded-full blur-[160px] pointer-events-none z-0" />

      {/* ========================================================
          GLOBAL TOP NAVIGATION NAVBAR
         ======================================================== */}
      <nav className="fixed top-0 w-full z-40 bg-surface/80 backdrop-blur-xl border-b border-white/10 h-20">
        <div className="px-gutter h-full max-w-container-max mx-auto flex items-center justify-between relative">
          
          <div
            onClick={() => router.push("/")}
            className="text-2xl font-display-xl font-bold tracking-tight text-on-surface flex items-center gap-3 cursor-pointer"
          >
            <img src="/logo/logo_icon.svg" alt="面试驾到" className="w-11 h-11 object-contain" />
            面试驾到
          </div>

          <div className="absolute left-1/2 -translate-x-1/2 hidden md:flex items-center gap-3 lg:gap-5 xl:gap-8 whitespace-nowrap">
            <a onClick={() => router.push("/debugger")} className="text-on-surface-variant hover:text-on-surface transition-colors text-[15px] lg:text-[16px] xl:text-[17px] font-extrabold cursor-pointer whitespace-nowrap shrink-0">
              面试调试器
            </a>
            <a onClick={() => router.push("/memory")} className="text-on-surface-variant hover:text-on-surface transition-colors text-[15px] lg:text-[16px] xl:text-[17px] font-extrabold cursor-pointer whitespace-nowrap shrink-0">
              职业记忆看板
            </a>
            <a onClick={() => router.push("/training")} className="text-on-surface-variant hover:text-on-surface transition-colors text-[15px] lg:text-[16px] xl:text-[17px] font-extrabold cursor-pointer whitespace-nowrap shrink-0">
              面试训练场
            </a>
            <a onClick={() => router.push("/home")} className="text-primary transition-colors text-[15px] lg:text-[16px] xl:text-[17px] font-extrabold cursor-pointer relative whitespace-nowrap shrink-0 after:content-[''] after:absolute after:bottom-[-26px] after:left-0 after:right-0 after:h-[2px] after:bg-primary">
              职业驾驶舱
            </a>
            <a onClick={() => router.push("/guide")} className="text-on-surface-variant hover:text-on-surface transition-colors text-[15px] lg:text-[16px] xl:text-[17px] font-extrabold cursor-pointer whitespace-nowrap shrink-0">
              面试指南
            </a>
            <a onClick={() => router.push("/feedback")} className="text-on-surface-variant hover:text-on-surface transition-colors text-[15px] lg:text-[16px] xl:text-[17px] font-extrabold cursor-pointer whitespace-nowrap shrink-0">
              体验反馈中心
            </a>
            <a onClick={() => window.open("/helper", "_blank")} className="text-on-surface-variant hover:text-on-surface transition-colors text-[15px] lg:text-[16px] xl:text-[17px] font-extrabold cursor-pointer whitespace-nowrap shrink-0">
              帮助中心
            </a>
          </div>

          <div className="flex items-center gap-4">
            <button
              onClick={handleHistoryRedirect}
              className="px-4.5 py-2 bg-white/5 border border-white/10 rounded-full text-sm font-bold text-on-surface hover:bg-white/10 transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <span className="material-symbols-outlined text-base">history</span>历史记录
            </button>
            {auth.isLoggedIn ? (
              <UserMenu />
) : (
              <>
                <button
                  onClick={() => auth.setShowLogin(true)}
                  className="px-6 py-2 text-on-surface-variant hover:text-on-surface transition-colors font-medium cursor-pointer"
                >
                  登录
                </button>
                <button
                  onClick={() => router.push("/register")}
                  className="px-6 py-2 bg-primary text-on-primary font-bold rounded-full scale-95 hover:scale-100 active:scale-95 transition-all shadow-[0_0_20px_rgba(192,193,255,0.3)] cursor-pointer"
                >
                  免费开始
                </button>
              </>
            )}
          </div>
        </div>
      </nav>

      {/* ========================================================
          MAIN WORKSPACE LAYOUT container (Full Width)
         ======================================================== */}
      <div className="flex-1 max-w-container-max mx-auto w-full px-gutter py-8 flex flex-col gap-6 relative z-10">
        
        {/* ========================================================
            RIGHT CONTAINER: Dash HUD Grids & Configurations
           ======================================================== */}
        <div className="flex flex-col gap-6 w-full">
          
          {/* HEADER DESCRIPTION BAR */}
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 text-left">
            <div>
              <h2 className="text-2xl md:text-3xl font-black text-white flex items-center gap-2">
                职业驾驶舱
                <span className="text-xs font-label-mono text-on-surface-variant/40 font-semibold px-2 py-0.5 rounded border border-white/5 bg-white/[0.02] uppercase tracking-wider block">
                  Career Dashboard
                </span>
              </h2>
              <p className="text-xs md:text-sm text-on-surface-variant/50 font-bold mt-1">管理你的职业档案、会员权益与 AI 成长资源</p>
            </div>
            
            <div className="flex items-center gap-4 font-semibold text-xs md:text-sm">
              <button
                type="button"
                onClick={() => window.open("/helper", "_blank", "noopener,noreferrer")}
                className="text-on-surface-variant/55 hover:text-white transition-colors cursor-pointer flex items-center gap-1 bg-transparent border-0 p-0"
                aria-label="在新窗口打开帮助中心"
              >
                <span className="material-symbols-outlined text-sm">help</span>帮助中心
              </button>
            </div>
          </div>

          {/* GRID CARD 1: MAIN USER PROFILE CARD */}
          <div className="glass-panel p-6 rounded-3xl border-white/10 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6 text-left relative overflow-hidden w-full">
            <div className="flex items-center gap-5.5 flex-wrap w-full lg:w-auto">
              
              {/* User Avatar image */}
              <div className="relative shrink-0 select-none">
                <div className="w-20 h-20 rounded-full border border-primary/30 overflow-hidden bg-slate-900 flex items-center justify-center shadow-2xl relative z-10">
                  {!avatarError ? (
                    <img
                      src={auth.user.avatar || "/register.jpg"}
                      alt={profile.name}
                      className="w-full h-full object-cover"
                      onError={() => setAvatarError(true)}
                    />
                  ) : (
                    <span className="material-symbols-outlined text-4xl text-primary opacity-60">person</span>
                  )}
                </div>
                <div className="absolute -bottom-1 -right-1 bg-tertiary w-4.5 h-4.5 rounded-full border-2 border-background flex items-center justify-center z-20">
                  <span className="w-1.5 h-1.5 bg-white rounded-full" />
                </div>
              </div>

              {/* Basic editable details */}
              <div className="space-y-2.5 min-w-0 flex-1 sm:flex-initial text-left">
                {/* Name Row */}
                <div className="flex items-center gap-3">
                  <h2 className="text-2xl font-black text-white whitespace-nowrap">{profile.name}</h2>
                  <span
                    onClick={handleOpenProfileModal}
                    className="material-symbols-outlined text-xs text-on-surface-variant/40 hover:text-white cursor-pointer transition-colors"
                  >
                    edit
                  </span>
                  <span className="px-3.5 py-1 rounded-full bg-tertiary/10 text-tertiary text-xs md:text-sm font-black border border-tertiary/20 whitespace-nowrap">
                    {profile.status}
                  </span>
                  <span className="px-3 py-1 rounded-full bg-purple-500/10 text-purple-300 text-xs md:text-sm font-black border border-purple-500/20 whitespace-nowrap">
                    内测用户
                  </span>
                </div>

                {/* Job Title Row */}
                <p className="text-sm font-bold text-on-surface-variant/75 text-left leading-none">{profile.title}</p>
                
                {/* Tags Row */}
                {profile.tags && profile.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {profile.tags.map((tag, i) => (
                      <span key={i} className="px-2.5 py-0.5 rounded-lg bg-white/5 text-on-surface-variant/75 text-[11px] font-bold border border-white/5 whitespace-nowrap">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}

                {/* Metadata details row */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-on-surface-variant/60 font-semibold font-label-mono">
                  <span className="flex items-center gap-1.5 whitespace-nowrap">
                    <span className="material-symbols-outlined text-xs text-primary">business_center</span>
                    {profile.experienceYears}{profile.experienceMonths !== "0个月" ? profile.experienceMonths : ""}
                  </span>
                  <span className="flex items-center gap-1.5 whitespace-nowrap">
                    <span className="material-symbols-outlined text-xs text-primary">location_on</span>
                    {careerGoal.city}
                  </span>
                  <span className="flex items-center gap-1.5 whitespace-nowrap">
                    <span className="material-symbols-outlined text-xs text-primary">calendar_today</span>
                    加入 面试驾到 {profile.joinDays} 天
                  </span>
                </div>
              </div>
            </div>

            {/* Sub-metas of Current Status */}
            <div className="flex items-stretch w-full lg:w-auto border-t lg:border-t-0 pt-4 lg:pt-0 border-white/5 shrink-0 justify-between lg:justify-start">
              
              <div className="flex gap-6 px-5 py-4 rounded-2xl bg-white/[0.02] border border-white/5 shrink-0 w-full sm:w-auto justify-between sm:justify-start">
                <div className="text-left whitespace-nowrap min-w-0">
                  <span className="text-[10px] text-on-surface-variant/40 font-label-mono uppercase tracking-widest font-extrabold mt-[-2px] block">当前公司</span>
                  <span className="text-sm font-black text-white block whitespace-nowrap">
                    {(profile.company && profile.company !== "暂无公司") ? profile.company : "—"}
                  </span>
                </div>
                <div className="w-px bg-white/10 self-stretch my-1 shrink-0" />
                <div className="text-left whitespace-nowrap min-w-0">
                  <span className="text-[10px] text-on-surface-variant/40 font-label-mono uppercase tracking-widest font-extrabold mt-[-2px] block">当前岗位</span>
                  <span className="text-sm font-black text-white block whitespace-nowrap">{profile.role || "—"}</span>
                </div>
                <div className="w-px bg-white/10 self-stretch my-1 shrink-0" />
                <div className="text-left whitespace-nowrap min-w-0">
                  <span className="text-[10px] text-on-surface-variant/40 font-label-mono uppercase tracking-widest font-extrabold mt-[-2px] block">当前职级</span>
                  <span className="text-sm font-black text-tertiary block whitespace-nowrap">{profile.level || "—"}</span>
                </div>
              </div>

            </div>
          </div>

          {/* GRID ROW 2: HUD DETAILED WIDGETS */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-6 w-full items-stretch">
            
            {/* WIDGET 1: CAREER GOAL */}
            <div className="col-span-12 md:col-span-4 flex flex-col h-full">
              <div className="glass-panel p-5.5 rounded-3xl border-white/10 text-left h-full flex flex-col justify-between gap-5 relative hover:border-primary/20 transition-all duration-300">
                <div className="flex justify-between items-center pb-2.5 border-b border-white/5">
                  <h4 className="text-base font-black text-white flex items-center gap-2">
                    <span className="material-symbols-outlined text-lg text-primary">target</span>
                    求职目标
                    <span className="text-[12px] font-label-mono text-on-surface-variant/40 font-bold">Career Goal</span>
                  </h4>
                  <button
                    onClick={handleOpenGoalModal}
                    className="text-sm text-primary font-black hover:text-white transition-colors cursor-pointer flex items-center gap-0.5"
                  >
                    <span className="material-symbols-outlined text-xs">edit</span>编辑
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-4 flex-1 items-center">
                  <div className="space-y-3.5 text-left">
                    <div>
                      <span className="text-[11px] text-on-surface-variant/40 font-label-mono uppercase tracking-widest font-extrabold block">目标岗位</span>
                      <span className="text-base font-black text-white block mt-0.5 whitespace-nowrap">{careerGoal.role || "—"}</span>
                    </div>
                    <div>
                      <span className="text-[11px] text-on-surface-variant/40 font-label-mono uppercase tracking-widest font-extrabold block">目标职级</span>
                      <span className="text-base font-black text-white block mt-0.5 whitespace-nowrap">{careerGoal.level || "—"}</span>
                    </div>
                    <div>
                      <span className="text-[11px] text-on-surface-variant/40 font-label-mono uppercase tracking-widest font-extrabold block">目标薪资</span>
                      <span className="text-base font-black text-tertiary block mt-0.5 whitespace-nowrap">
                        {(careerGoal.salaryMin > 0 && careerGoal.salaryMax > 0) ? `${careerGoal.salaryMin}K - ${careerGoal.salaryMax}K` : "—"}
                      </span>
                    </div>
                    <div>
                      <span className="text-[11px] text-on-surface-variant/40 font-label-mono uppercase tracking-widest font-extrabold block">目标城市</span>
                      <span className="text-base font-black text-white block mt-0.5 whitespace-nowrap">{careerGoal.city}</span>
                    </div>
                  </div>

                  <div className="flex flex-col items-center justify-center relative">
                    <div className="relative w-30 h-30 flex items-center justify-center">
                      <svg className="w-full h-full -rotate-90">
                        <circle cx="60" cy="60" r="48" fill="transparent" stroke="rgba(255,255,255,0.03)" strokeWidth="7" />
                        <circle
                          cx="60"
                          cy="60"
                          r="48"
                          fill="transparent"
                          stroke="url(#goal-circle-gradient)"
                          strokeWidth="7"
                          strokeDasharray={2 * Math.PI * 48}
                          strokeDashoffset={2 * Math.PI * 48 * (1 - careerGoal.matchRate / 100)}
                          strokeLinecap="round"
                          className={isMatchRateLoading ? "animate-pulse opacity-40 transition-opacity duration-300" : "transition-opacity duration-300"}
                        />
                        <defs>
                          <linearGradient id="goal-circle-gradient" x1="0" y1="0" x2="1" y2="1">
                            <stop offset="0%" stopColor="#c0c1ff" />
                            <stop offset="100%" stopColor="#4edea3" />
                          </linearGradient>
                        </defs>
                      </svg>
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        {isMatchRateLoading ? (
                          <>
                            <span className="material-symbols-outlined text-3xl text-primary animate-spin">progress_activity</span>
                            <span className="text-[10px] text-on-surface-variant/60 font-bold mt-1 tracking-wider">AI 评估中...</span>
                          </>
                        ) : (
                          <>
                            <span className="text-2xl font-black text-white font-label-mono">{careerGoal.matchRate}%</span>
                            <span className="text-xs text-on-surface-variant/50 font-bold block scale-90">目标匹配度</span>
                          </>
                        )}
                      </div>
                    </div>
                    <span className="text-xs text-on-surface-variant/40 font-bold block tracking-wider mt-2.5">基于个人画像分析</span>
                  </div>
                </div>
              </div>
            </div>

            {/* WIDGET 2: BETA STATUS */}
            <div className="col-span-12 md:col-span-4 flex flex-col h-full">
              <div className="glass-panel p-5.5 rounded-3xl border-white/10 text-left h-full flex flex-col justify-between gap-4.5 relative overflow-hidden hover:border-secondary/20 transition-all duration-300">

                <div className="flex justify-between items-center pb-2.5 border-b border-white/5 relative z-10">
                  <h4 className="text-base font-black text-white flex items-center gap-2">
                    <span className="material-symbols-outlined text-lg text-secondary">science</span>
                    当前账号状态
                  </h4>
                </div>

                <div className="space-y-3.5 flex-1 flex flex-col justify-center relative z-10">
                  <p className="text-sm text-on-surface-variant/70 leading-relaxed font-semibold">
                    当前正处于内部测试阶段，会员体系暂未开放。系统将根据你的内测反馈持续优化体验，正式上线后将第一时间通知。
                  </p>
                </div>
              </div>
            </div>

            {/* WIDGET 3: QUOTA LIMITS */}
            <div className="col-span-12 md:col-span-4 flex flex-col h-full">
              <div className="glass-panel p-5.5 rounded-3xl border-white/10 text-left h-full flex flex-col justify-between gap-4.5 relative hover:border-tertiary/20 transition-all duration-300">
                
                <div className="flex justify-between items-center pb-2.5 border-b border-white/5">
                  <h4 className="text-base font-black text-white flex items-center gap-2">
                    <span className="material-symbols-outlined text-lg text-tertiary">pie_chart</span>
                    资源额度
                  </h4>
                  <span 
                    onClick={() => router.push("/memory?tab=timeline")}
                    className="text-sm text-tertiary font-black hover:text-white transition-colors cursor-pointer flex items-center gap-0.5"
                  >
                    使用记录 →
                  </span>
                </div>

                {/* Circular Quota meters in 2x2 grids */}
                <div className="grid grid-cols-2 gap-3.5 flex-1 items-center">
                  {(() => {
                    // fallback 统一用 test 档额度，避免接口异常时显示 0
                    const TEST_QUOTA = { audio: 2, record: 3, resume: 3, live: 10 };
                    const audioRemaining = quotaStatus?.audio?.remaining ?? TEST_QUOTA.audio;
                    const audioTotal = quotaStatus?.audio?.max ?? TEST_QUOTA.audio;

                    const recordRemaining = quotaStatus?.record?.remaining ?? TEST_QUOTA.record;
                    const recordTotal = quotaStatus?.record?.max ?? TEST_QUOTA.record;

                    const resumeRemaining = quotaStatus?.resume?.remaining ?? TEST_QUOTA.resume;
                    const resumeTotal = quotaStatus?.resume?.max ?? TEST_QUOTA.resume;

                    const liveRemaining = liveQuota?.remaining_min ?? TEST_QUOTA.live;
                    const liveTotal = liveQuota?.limit_min ?? TEST_QUOTA.live;

                    const quotas = [
                      { label: "录音分析", remaining: audioRemaining, total: audioTotal, unit: "次", color: "stroke-[#4edea3]", textStyle: "text-[#4edea3]", icon: "graphic_eq" },
                      { label: "面试记录分析", remaining: recordRemaining, total: recordTotal, unit: "次", color: "stroke-[#60a5fa]", textStyle: "text-[#60a5fa]", icon: "description" },
                      { label: "简历分析", remaining: resumeRemaining, total: resumeTotal, unit: "次", color: "stroke-[#a78bfa]", textStyle: "text-[#a78bfa]", icon: "article" },
                      { label: "模拟面试", remaining: liveRemaining, total: liveTotal, unit: "分钟", color: "stroke-amber-400", textStyle: "text-amber-400", icon: "videocam" }
                    ];

                    return quotas.map((quota, i) => {
                      const percent = quota.total > 0 ? (quota.remaining / quota.total) : 0;
                      return (
                        <div key={i} className="p-3 rounded-2xl bg-white/[0.01] border border-white/5 flex items-center gap-3 w-full">
                          <div className="relative w-12 h-12 flex items-center justify-center shrink-0">
                            <svg className="w-full h-full -rotate-90">
                              <circle cx="24" cy="24" r="21" fill="transparent" stroke="rgba(255,255,255,0.03)" strokeWidth="3.5" />
                              <circle
                                cx="24"
                                cy="24"
                                r="21"
                                fill="transparent"
                                className={quota.color}
                                strokeWidth="3.5"
                                strokeDasharray={2 * Math.PI * 21}
                                strokeDashoffset={2 * Math.PI * 21 * (1 - percent)}
                                strokeLinecap="round"
                              />
                            </svg>
                            <div className="absolute inset-0 flex items-center justify-center">
                              <span className={`material-symbols-outlined text-[17px] ${quota.textStyle}`}>
                                {quota.icon}
                              </span>
                            </div>
                          </div>
                          <div className="text-left min-w-0 flex-1">
                            <span className="text-sm text-white font-black block truncate leading-none">{quota.label}</span>
                            <span className="text-xs text-on-surface-variant/30 font-bold block mt-1 scale-90 -ml-1">剩余额度</span>
                            <span className="text-xs font-black text-white block mt-0.5 font-label-mono whitespace-nowrap">
                              {quota.remaining} <span className="text-on-surface-variant/35 font-normal text-xs">/ {quota.total}{quota.unit}</span>
                            </span>
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>

              </div>
            </div>

          </div>

          {/* GRID ROW 3: MORE HUD DETAILS */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-6 w-full items-stretch">
            
            {/* WIDGET 4: RECENT ACTIVITY */}
            <div className="col-span-12 md:col-span-4 flex flex-col h-full">
              <div className="glass-panel p-5.5 rounded-3xl border-white/10 text-left h-full flex flex-col justify-start gap-4 hover:border-primary/20 transition-all duration-300">
                
                <div className="flex justify-between items-center pb-2.5 border-b border-white/5 shrink-0">
                  <h4 className="text-base font-black text-white flex items-center gap-2">
                    <span className="material-symbols-outlined text-lg text-primary">schedule</span>
                    最近活动
                  </h4>
                  <span 
                    onClick={handleHistoryRedirect}
                    className="text-sm text-primary font-black hover:text-white transition-colors cursor-pointer flex items-center gap-1"
                  >
                    查看全部 <span className="material-symbols-outlined text-sm">keyboard_arrow_right</span>
                  </span>
                </div>

                {/* Timeline flow */}
                <div className="relative pl-5.5 space-y-3 py-1 flex-1 flex flex-col justify-start mt-[-2px]">
                  <div className="absolute left-1.5 top-2.5 bottom-2.5 w-0.5 bg-white/5" />
                  
                  {recentActivity.length === 0 ? (
                    <span className="text-xs text-on-surface-variant/50 text-center py-4 block">
                      {auth.isLoggedIn ? "暂无活动记录" : "请先登录"}
                    </span>
                  ) : (
                    recentActivity.slice(0, 5).map((item, i) => {
                      const typeLabel: Record<string, string> = {
                        audio: "录音分析", text: "记录分析", resume: "简历优化", live: "模拟面试",
                      };
                      const dotColor: Record<string, string> = {
                        audio: "bg-primary", text: "bg-purple-400", resume: "bg-secondary", live: "bg-tertiary",
                      };
                      const hasScore = item.score > 0;
                      const scoreRating =
                        item.score >= 80 ? "good" : item.score >= 60 ? "normal" : "risk";

                      return (
                        <div key={item.id} className="relative flex justify-between items-start text-sm font-semibold">
                          <div className={`absolute -left-5 top-1.5 w-2 h-2 rounded-full ${dotColor[item.type] || "bg-white/30"} ring-4 ring-background z-10`} />

                          <div className="text-left space-y-0.5 min-w-0 pr-4">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-xs text-on-surface-variant/40 font-label-mono">
                                {formatRelativeTime(item.created_at || "")}
                              </span>
                              <span className="text-white/10 font-normal">|</span>
                              <span className={`text-xs font-extrabold uppercase ${
                                item.type === "resume" ? "text-secondary/70" :
                                item.type === "live" ? "text-tertiary/70" :
                                item.type === "text" ? "text-purple-400/70" :
                                "text-primary/70"
                              }`}>
                                {typeLabel[item.type] || item.type}
                              </span>
                            </div>
                            <p className="text-sm font-black text-white truncate leading-snug mt-0.5">
                              {item.company} · {item.role}
                            </p>
                          </div>

                          <div className="shrink-0 flex items-center">
                            {hasScore ? (
                              <span className={`font-black font-label-mono text-xs md:text-sm px-2 py-0.5 rounded-lg whitespace-nowrap ${
                                scoreRating === "good" ? "bg-tertiary/10 text-tertiary border border-tertiary/20" :
                                scoreRating === "risk" ? "bg-secondary/15 text-secondary border border-secondary/20" :
                                "bg-white/5 text-on-surface-variant/60"
                              }`}>
                                评分 {item.score}
                              </span>
                            ) : (
                              <span className="text-on-surface-variant/30 font-semibold font-label-mono text-xs px-2 whitespace-nowrap">—</span>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

              </div>
            </div>

            {/* WIDGET 5: QUICK ACTIONS */}
            <div className="col-span-12 md:col-span-4 flex flex-col h-full">
              <div className="glass-panel p-5.5 rounded-3xl border-white/10 text-left h-full flex flex-col justify-start gap-4 hover:border-secondary/20 transition-all duration-300">
                
                <div className="flex justify-between items-center pb-2.5 border-b border-white/5 shrink-0">
                  <h4 className="text-base font-black text-white flex items-center gap-2">
                    <span className="material-symbols-outlined text-lg text-secondary">flash_on</span>
                    快捷操作
                  </h4>
                </div>

                {/* 2x2 grid of Action buttons */}
                <div className="grid grid-cols-2 gap-3.5 py-1 mt-[-2px]">
                  {[
                    { label: "新建录音分析", sub: "上传音频智能分析", icon: "mic", color: "text-[#4edea3] bg-[#4edea3]/10 border-[#4edea3]/20", path: "/debugger?mode=audio" },
                    { label: "新建记录分析", sub: "粘贴记录 AI 剖析", icon: "edit_document", color: "text-[#60a5fa] bg-[#60a5fa]/10 border-[#60a5fa]/20", path: "/debugger?mode=text" },
                    { label: "新建简历分析", sub: "深度优化简历内容", icon: "description", color: "text-[#a78bfa] bg-[#a78bfa]/10 border-[#a78bfa]/20", path: "/debugger?mode=resume" },
                    { label: "开始模拟面试", sub: "AI 面试官实战演练", icon: "support_agent", color: "text-amber-500 bg-amber-500/10 border-amber-500/20", path: "/training" }
                  ].map((act, i) => (
                    <button
                      key={i}
                      onClick={() => router.push(act.path)}
                      className="py-5 px-4 rounded-2xl bg-white/[0.01] hover:bg-white/[0.02] border border-white/5 hover:border-white/10 transition-all flex flex-col justify-between items-start gap-4 text-left cursor-pointer group"
                    >
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center border shrink-0 group-hover:scale-105 transition-transform ${act.color}`}>
                        <span className="material-symbols-outlined text-base">{act.icon}</span>
                      </div>
                      <div className="min-w-0">
                        <span className="text-sm font-black text-white block group-hover:text-primary transition-colors leading-snug">{act.label}</span>
                        <span className="text-xs text-on-surface-variant/30 font-bold block truncate mt-1">{act.sub}</span>
                      </div>
                    </button>
                  ))}
                </div>

              </div>
            </div>

            {/* WIDGET 6: TESTING NOTES */}
            <div className="col-span-12 md:col-span-4 flex flex-col h-full">
              <div className="glass-panel p-5.5 rounded-3xl border-white/10 text-left h-full flex flex-col justify-start gap-4 hover:border-tertiary/20 transition-all duration-300">

                <div className="flex justify-between items-center pb-2.5 border-b border-white/5 shrink-0">
                  <h4 className="text-base font-black text-white flex items-center gap-2">
                    <span className="material-symbols-outlined text-lg text-tertiary">info</span>
                    内测说明
                  </h4>
                </div>

                <div className="flex-1 flex items-center py-2">
                  <p className="text-sm text-on-surface-variant/70 leading-relaxed font-semibold my-auto">
                    内测期间所有功能免费使用，不产生任何订单或费用。正式计费策略上线前，会通过站内信与邮件提前通知。
                  </p>
                </div>
              </div>
            </div>

          </div>

          {/* GRID ROW 4: ACCOUNT SECURITY CONSOLE */}
          <div className="glass-panel p-6 rounded-3xl border-white/10 flex flex-col gap-6 text-left relative overflow-hidden w-full">
            <div className="flex items-center gap-2 pb-3 border-b border-white/5">
              <div className="w-8 h-8 rounded-lg bg-primary/20 border border-primary/30 flex items-center justify-center text-primary">
                <span className="material-symbols-outlined text-lg" style={{ fontVariationSettings: "'FILL' 1" }}>security</span>
              </div>
              <h3 className="text-base font-black text-white">账号与安全</h3>
            </div>

            <div className="flex flex-col lg:flex-row justify-between items-stretch lg:items-center gap-6">
              {/* Security info items block */}
              <div className="flex flex-col sm:flex-row gap-3.5 flex-1 w-full max-w-2xl">
                
                <div className="flex items-center gap-3.5 px-4.5 py-3.5 rounded-2xl bg-white/[0.02] border border-white/5 flex-1 min-w-0">
                  <span className="material-symbols-outlined text-primary text-xl opacity-60 shrink-0">mail</span>
                  <div className="text-left min-w-0 flex-1">
                    <span className="text-xs md:text-sm text-on-surface-variant/40 font-label-mono uppercase tracking-widest font-extrabold block">邮箱</span>
                    <span className="text-sm font-black text-white block mt-0.5 truncate">{accountSecurity.email}</span>
                  </div>
                </div>

                <div className="flex items-center gap-3.5 px-4.5 py-3.5 rounded-2xl bg-white/[0.02] border border-white/5 flex-1 min-w-0">
                  <span className="material-symbols-outlined text-primary text-xl opacity-60 shrink-0">phone_iphone</span>
                  <div className="text-left min-w-0 flex-1">
                    <span className="text-xs md:text-sm text-on-surface-variant/40 font-label-mono uppercase tracking-widest font-extrabold block">手机号</span>
                    <span className="text-sm font-black text-white block mt-0.5 truncate">{accountSecurity.phone}</span>
                  </div>
                </div>

              </div>

              {/* Core Actions buttons */}
              <div className="flex flex-wrap items-center gap-3.5 shrink-0 justify-between lg:justify-end text-sm font-black">
                <button
                  onClick={handleOpenSecurityModal}
                  className="px-5 py-3 bg-white/5 hover:bg-white/10 text-white rounded-xl border border-white/10 transition-all flex items-center gap-1.5 hover:scale-[1.01] active:scale-98 cursor-pointer"
                >
                  <span className="material-symbols-outlined text-base">edit</span>
                  修改
                </button>
                
                <button
                  onClick={() => auth.setShowLogout(true)}
                  className="px-5 py-3 bg-secondary/10 hover:bg-secondary/20 text-secondary rounded-xl border border-secondary/25 transition-all flex items-center gap-1.5 hover:scale-[1.01] active:scale-98 cursor-pointer"
                >
                  <span className="material-symbols-outlined text-base">logout</span>
                  退出登录
                </button>
              </div>

            </div>
          </div>

        </div>

      </div>

      {/* Footer */}
      <footer className="bg-surface-container-lowest border-t border-white/5 w-full block mt-8 relative z-10 shrink-0">
        <div className="px-gutter py-8 max-w-container-max mx-auto flex flex-col md:flex-row justify-between items-center gap-4 text-left">
          <span className="text-[10px] text-on-surface-variant/30 font-label-mono font-bold tracking-widest block text-left">
            © 2026 面试驾到. All rights reserved.
          </span>
          <div className="flex gap-8 text-xs text-on-surface-variant font-label-mono font-bold tracking-widest">
            <span onClick={() => openLegalTerms()} className="hover:text-primary transition-colors cursor-pointer select-none">
              服务条款
            </span>
            <span onClick={() => openLegalPrivacy()} className="hover:text-primary transition-colors cursor-pointer select-none">
              隐私政策
            </span>
            <span onClick={() => openLegalContact()} className="hover:text-primary transition-colors cursor-pointer select-none">
              联系方式
            </span>
          </div>
        </div>
      </footer>

      {/* ========================================================
          MODALS & FLOATING INTERACTIVE DRAWER CANVASES
         ======================================================== */}
      <AnimatePresence>
        
        {/* EDIT PROFILE DETAILS MODAL */}
        {showEditProfileModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowEditProfileModal(false)}
              className="absolute inset-0 bg-surface/60 backdrop-blur-md"
            />

            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-surface-container-high border border-white/10 rounded-3xl p-8 max-w-xl w-full text-left relative z-10 space-y-6 shadow-2xl overflow-y-auto max-h-[90vh]"
            >
              <div className="flex justify-between items-center pb-3.5 border-b border-white/5">
                <h3 className="font-extrabold text-white text-base flex items-center gap-2">
                  <span className="material-symbols-outlined text-primary">person</span>
                  编辑个人职业资料
                </h3>
                <button
                  onClick={() => setShowEditProfileModal(false)}
                  className="text-on-surface-variant hover:text-white transition-colors cursor-pointer flex items-center justify-center w-7 h-7 rounded-lg hover:bg-white/5"
                >
                  <span className="material-symbols-outlined text-base">close</span>
                </button>
              </div>

              <form onSubmit={handleSaveProfile} className="space-y-4 text-sm font-semibold text-white">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-on-surface-variant/60 font-bold block">用户名</label>
                    <input
                      type="text"
                      required
                      value={profileForm.name}
                      onChange={(e) => { setProfileForm({ ...profileForm, name: e.target.value }); profileNameMod.reset(); }}
                      onBlur={(e) => profileNameMod.check(e.target.value, "profile_name_hint")}
                      className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl focus:outline-none focus:border-primary/40 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-on-surface-variant/60 font-bold block">求职状态</label>
                    <select
                      value={profileForm.status}
                      onChange={(e) => setProfileForm({ ...profileForm, status: e.target.value })}
                      className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl focus:outline-none focus:border-primary/40 text-sm text-white appearance-none hero-select"
                    >
                      <option className="bg-[#0e1626]" value="在职">在职</option>
                      <option className="bg-[#0e1626]" value="离职">离职</option>
                      <option className="bg-[#0e1626]" value="在校生">在校生</option>
                      <option className="bg-[#0e1626]" value="应届生">应届生</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-on-surface-variant/60 font-bold block">性别</label>
                    <select
                      value={profileForm.gender || "male"}
                      onChange={(e) => setProfileForm({ ...profileForm, gender: e.target.value })}
                      className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl focus:outline-none focus:border-primary/40 text-sm text-white appearance-none hero-select"
                    >
                      <option className="bg-[#0e1626]" value="male">男</option>
                      <option className="bg-[#0e1626]" value="female">女</option>
                      <option className="bg-[#0e1626]" value="other">不方便透露</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-on-surface-variant/60 font-bold block">年龄</label>
                    <input
                      type="number"
                      required
                      min="1"
                      max="120"
                      placeholder="26"
                      value={profileForm.age || ""}
                      onChange={(e) => setProfileForm({ ...profileForm, age: e.target.value })}
                      className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl focus:outline-none focus:border-primary/40 text-sm text-white placeholder-white/20"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-on-surface-variant/60 font-bold block">当前公司 (选填)</label>
                    <input
                      type="text"
                      value={profileForm.company}
                      onChange={(e) => setProfileForm({ ...profileForm, company: e.target.value })}
                      className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl focus:outline-none focus:border-primary/40 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-on-surface-variant/60 font-bold block">当前岗位 (选填)</label>
                    <input
                      type="text"
                      value={profileForm.role}
                      onChange={(e) => setProfileForm({ ...profileForm, role: e.target.value })}
                      className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl focus:outline-none focus:border-primary/40 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-on-surface-variant/60 font-bold block">当前职级 (选填)</label>
                    <input
                      type="text"
                      value={profileForm.level}
                      onChange={(e) => setProfileForm({ ...profileForm, level: e.target.value })}
                      className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl focus:outline-none focus:border-primary/40 text-sm"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-on-surface-variant/60 font-bold block">当前月薪范围</label>
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <input
                          type="text"
                          inputMode="numeric"
                          value={profileForm.salaryMin || ""}
                          onChange={(e) => setProfileForm({ ...profileForm, salaryMin: parseInt(e.target.value) || 0 })}
                          className="w-full px-3 py-2.5 pr-9 bg-white/5 border border-white/10 rounded-xl focus:outline-none focus:border-primary/40 text-sm text-white"
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 text-xs font-bold pointer-events-none">K</span>
                      </div>
                      <span className="text-white/30 font-bold text-sm shrink-0">-</span>
                      <div className="relative flex-1">
                        <input
                          type="text"
                          inputMode="numeric"
                          value={profileForm.salaryMax || ""}
                          onChange={(e) => setProfileForm({ ...profileForm, salaryMax: parseInt(e.target.value) || 0 })}
                          className="w-full px-3 py-2.5 pr-9 bg-white/5 border border-white/10 rounded-xl focus:outline-none focus:border-primary/40 text-sm text-white"
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 text-xs font-bold pointer-events-none">K</span>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-on-surface-variant/60 font-bold block">工作年限</label>
                    <div className="flex gap-2">
                      <select
                        value={profileForm.experienceYears}
                        onChange={(e) => setProfileForm({ ...profileForm, experienceYears: e.target.value })}
                        className="flex-1 px-3 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white focus:outline-none focus:border-primary/40 text-sm appearance-none hero-select"
                      >
                        {["在校", "应届", "1年", "2年", "3年", "4年", "5年", "6年", "7年", "8年", "9年", "10年以上"].map((y) => (
                          <option key={y} className="bg-[#0e1626] text-white">{y}</option>
                        ))}
                      </select>
                      <select
                        value={profileForm.experienceMonths}
                        onChange={(e) => setProfileForm({ ...profileForm, experienceMonths: e.target.value })}
                        className="flex-1 px-3 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white focus:outline-none focus:border-primary/40 text-sm appearance-none hero-select"
                      >
                        {["0个月", "1个月", "2个月", "3个月", "4个月", "5个月", "6个月", "7个月", "8个月", "9个月", "10个月", "11个月"].map((m) => (
                          <option key={m} className="bg-[#0e1626] text-white">{m}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-on-surface-variant/60 font-bold block">学校名称 (选填)</label>
                    <input
                      type="text"
                      value={profileForm.school || ""}
                      onChange={(e) => setProfileForm({ ...profileForm, school: e.target.value })}
                      className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl focus:outline-none focus:border-primary/40 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-on-surface-variant/60 font-bold block">学历 (选填)</label>
                    <select
                      value={profileForm.degree || "本科"}
                      onChange={(e) => setProfileForm({ ...profileForm, degree: e.target.value })}
                      className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl focus:outline-none focus:border-primary/40 text-sm text-white appearance-none hero-select"
                    >
                      {["专科", "本科", "硕士", "博士", "其他"].map((d) => (
                        <option key={d} className="bg-[#0e1626]" value={d}>{d}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="pt-6 border-t border-white/5 flex gap-4 justify-end text-sm font-black">
                  <button
                    type="button"
                    onClick={() => setShowEditProfileModal(false)}
                    className="px-6 py-3 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 active:scale-95 transition-all text-white cursor-pointer"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    disabled={isSavingProfile}
                    className="px-6 py-3 rounded-xl bg-primary text-on-primary font-black shadow-lg shadow-primary/20 hover:scale-[1.01] active:scale-98 transition-all cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2 min-w-[100px]"
                  >
                    {isSavingProfile ? (
                      <>
                        <div className="w-4 h-4 border-2 border-on-primary border-t-transparent rounded-full animate-spin shrink-0" />
                        <span>保存中...</span>
                      </>
                    ) : (
                      <span>保存资料</span>
                    )}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}

        {/* EDIT CAREER GOAL MODAL */}
        {showEditGoalModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowEditGoalModal(false)}
              className="absolute inset-0 bg-surface/60 backdrop-blur-md"
            />

            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-surface-container-high border border-white/10 rounded-3xl p-8 max-w-md w-full text-left relative z-10 space-y-6 shadow-2xl"
            >
              <div className="flex justify-between items-center pb-3.5 border-b border-white/5">
                <h3 className="font-extrabold text-white text-base flex items-center gap-2">
                  <span className="material-symbols-outlined text-primary">target</span>
                  修改求职目标与定位
                </h3>
                <button
                  onClick={() => setShowEditGoalModal(false)}
                  className="text-on-surface-variant hover:text-white transition-colors cursor-pointer flex items-center justify-center w-7 h-7 rounded-lg hover:bg-white/5"
                >
                  <span className="material-symbols-outlined text-base">close</span>
                </button>
              </div>

              <form onSubmit={handleSaveGoal} className="space-y-4 text-sm font-semibold text-white">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-on-surface-variant/60 font-bold block h-5">目标岗位 (选填)</label>
                    <input
                      type="text"
                      value={goalForm.role}
                      onChange={(e) => setGoalForm({ ...goalForm, role: e.target.value })}
                      className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl focus:outline-none focus:border-primary/40 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-on-surface-variant/60 font-bold block h-5">目标职级 (选填)</label>
                    <input
                      type="text"
                      value={goalForm.level}
                      onChange={(e) => setGoalForm({ ...goalForm, level: e.target.value })}
                      className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl focus:outline-none focus:border-primary/40 text-sm"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-on-surface-variant/60 font-bold flex items-center gap-0.5 h-5">
                      目标城市
                      <span className="relative group cursor-help leading-none">
                        <span className="block rounded-full bg-white/30 w-[11px] h-[11px] flex items-center justify-center text-[7px] font-bold text-surface select-none">i</span>
                        <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2.5 py-1.5 bg-[#1a2236] border border-white/10 rounded-lg text-[11px] text-white/70 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none font-normal">
                          最多3个，用顿号隔开
                        </span>
                      </span>
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="例如：上海、深圳、杭州"
                      value={goalForm.city}
                      onChange={(e) => setGoalForm({ ...goalForm, city: e.target.value })}
                      className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl focus:outline-none focus:border-primary/40 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-on-surface-variant/60 font-bold flex items-center h-5">目标公司 (选填)</label>
                    <input
                      type="text"
                      placeholder="例如：腾讯科技"
                      value={goalForm.company || ""}
                      onChange={(e) => setGoalForm({ ...goalForm, company: e.target.value })}
                      className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl focus:outline-none focus:border-primary/40 text-sm"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-on-surface-variant/60 font-bold block">期望薪资范围</label>
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <input
                          type="text"
                          inputMode="numeric"
                          value={goalForm.salaryMin || ""}
                          onChange={(e) => setGoalForm({ ...goalForm, salaryMin: parseInt(e.target.value) || 0 })}
                          className="w-full px-3 py-2.5 pr-9 bg-white/5 border border-white/10 rounded-xl focus:outline-none focus:border-primary/40 text-sm text-white"
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 text-xs font-bold pointer-events-none">K</span>
                      </div>
                      <span className="text-white/30 font-bold text-sm shrink-0">-</span>
                      <div className="relative flex-1">
                        <input
                          type="text"
                          inputMode="numeric"
                          value={goalForm.salaryMax || ""}
                          onChange={(e) => setGoalForm({ ...goalForm, salaryMax: parseInt(e.target.value) || 0 })}
                          className="w-full px-3 py-2.5 pr-9 bg-white/5 border border-white/10 rounded-xl focus:outline-none focus:border-primary/40 text-sm text-white"
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 text-xs font-bold pointer-events-none">K</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="pt-6 border-t border-white/5 flex gap-4 justify-end text-sm font-black">
                  <button
                    type="button"
                    onClick={() => setShowEditGoalModal(false)}
                    className="px-6 py-3 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 active:scale-95 transition-all text-white cursor-pointer"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    disabled={isSavingGoal}
                    className="px-6 py-3 rounded-xl bg-primary text-on-primary font-black shadow-lg shadow-primary/20 hover:scale-[1.01] active:scale-98 transition-all cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2 min-w-[100px]"
                  >
                    {isSavingGoal ? (
                      <>
                        <div className="w-4 h-4 border-2 border-on-primary border-t-transparent rounded-full animate-spin shrink-0" />
                        <span>保存中...</span>
                      </>
                    ) : (
                      <span>保存更新</span>
                    )}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}

        {/* EDIT ACCOUNT SECURITY MODAL */}
        {showEditSecurityModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={handleCloseSecurityModal}
              className="absolute inset-0 bg-surface/60 backdrop-blur-md"
            />

            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-surface-container-high border border-white/10 rounded-3xl p-8 max-w-md w-full text-left relative z-10 space-y-6 shadow-2xl"
            >
              <div className="flex justify-between items-center pb-3.5 border-b border-white/5">
                <h3 className="font-extrabold text-white text-base flex items-center gap-2">
                  <span className="material-symbols-outlined text-primary">security</span>
                  修改账号与安全设置
                </h3>
                <button
                  onClick={handleCloseSecurityModal}
                  className="text-on-surface-variant hover:text-white transition-colors cursor-pointer flex items-center justify-center w-7 h-7 rounded-lg hover:bg-white/5"
                >
                  <span className="material-symbols-outlined text-base">close</span>
                </button>
              </div>

              <form onSubmit={handleSaveSecurity} className="space-y-4 text-sm font-semibold text-white">

                <div className="space-y-1.5">
                  <label className="text-on-surface-variant/60 font-bold block">邮箱地址 <span className="text-[#FF7A95]">*</span></label>
                  <input
                    type="email"
                    required
                    value={securityForm.email}
                    onChange={(e) => setSecurityForm({ ...securityForm, email: e.target.value })}
                    className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl focus:outline-none focus:border-[#AFA7FF]/40 text-sm text-white placeholder-white/20"
                  />
                </div>

                <div className="space-y-1.5 animate-fade-in">
                  <label className="text-on-surface-variant/60 font-bold block">验证码 <span className="text-[#FF7A95]">*</span></label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      required
                      maxLength={6}
                      placeholder="输入 6 位验证码"
                      value={emailCode}
                      onChange={(e) => setEmailCode(e.target.value)}
                      className="flex-1 py-3 px-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/20 focus:outline-none focus:border-[#AFA7FF]/40 text-sm font-semibold"
                    />
                    <button
                      type="button"
                      disabled={emailCountdown > 0}
                      onClick={handleGetSecurityEmailCode}
                      className="px-4 py-3 rounded-xl border border-[#AFA7FF]/20 text-[#AFA7FF] font-black text-sm hover:bg-[#AFA7FF]/5 active:scale-95 transition-all select-none whitespace-nowrap cursor-pointer"
                    >
                      {emailCountdown > 0 ? `${emailCountdown}s` : "获取验证码"}
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-on-surface-variant/60 font-bold block">修改密码 (选填)</label>
                  <input
                    type="password"
                    placeholder="请输入新密码，不修改请留空"
                    value={securityForm.password || ""}
                    onChange={(e) => setSecurityForm({ ...securityForm, password: e.target.value })}
                    className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl focus:outline-none focus:border-[#AFA7FF]/40 text-sm text-white placeholder-white/20"
                  />
                </div>

                <div className="pt-6 border-t border-white/5 flex gap-4 justify-end text-sm font-black">
                  <button
                    type="button"
                    onClick={handleCloseSecurityModal}
                    className="px-6 py-3 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 active:scale-95 transition-all text-white cursor-pointer"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    disabled={isSavingSecurity}
                    className="px-6 py-3 rounded-xl bg-primary text-on-primary font-black shadow-lg shadow-primary/20 hover:scale-[1.01] active:scale-98 transition-all cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2 min-w-[100px]"
                  >
                    {isSavingSecurity ? (
                      <>
                        <div className="w-4 h-4 border-2 border-on-primary border-t-transparent rounded-full animate-spin shrink-0" />
                        <span>保存中...</span>
                      </>
                    ) : (
                      <span>确认修改</span>
                    )}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}




      </AnimatePresence>

      {/* UNAUTHENTICATED OVERLAY */}
      {!auth.isLoggedIn && (
        <div className="fixed inset-0 z-30 bg-background/55 backdrop-blur-md flex items-center justify-center px-4">
          <div className="glass-panel relative rounded-3xl border border-white/10 p-8 sm:p-10 max-w-md w-full text-center space-y-6 shadow-[0_20px_60px_rgba(0,0,0,0.4)] overflow-hidden">
            <div className="absolute -top-16 -right-16 w-40 h-40 bg-primary/15 rounded-full blur-3xl pointer-events-none" />
            <div className="absolute -bottom-16 -left-16 w-40 h-40 bg-secondary/15 rounded-full blur-3xl pointer-events-none" />

            <div className="relative space-y-5">
              <div className="w-16 h-16 mx-auto rounded-2xl bg-primary/15 border border-primary/30 flex items-center justify-center shadow-[0_0_30px_rgba(192,193,255,0.2)]">
                <span className="material-symbols-outlined !text-3xl text-primary">lock</span>
              </div>

              <div className="space-y-2">
                <span className="text-[10px] font-label-mono tracking-widest text-primary font-bold uppercase block">
                  Career Cockpit
                </span>
                <h3 className="text-2xl font-black text-white leading-tight">登录解锁你的职业驾驶舱</h3>
                <p className="text-sm text-on-surface-variant/70 font-semibold leading-relaxed">
                  AI 实时监控你的求职进度、面试转化漏斗与 Offer 概率，并基于长期数据提供专属的成长策略与晋升路线。
                </p>
              </div>

              <div className="flex flex-col sm:flex-row gap-3 pt-1">
                <button
                  onClick={() => auth.setShowLogin(true)}
                  className="flex-1 py-3 bg-primary text-on-primary font-black rounded-xl hover:scale-[1.02] active:scale-95 transition-all shadow-[0_0_24px_rgba(192,193,255,0.35)] cursor-pointer"
                >
                  立即登录
                </button>
                <button
                  onClick={() => router.push("/register")}
                  className="flex-1 py-3 bg-white/5 border border-white/10 text-white font-black rounded-xl hover:bg-white/10 transition-all cursor-pointer"
                >
                  免费注册
                </button>
              </div>

              <button
                onClick={() => router.push("/")}
                className="text-base font-bold text-on-surface-variant/50 hover:text-on-surface-variant transition-colors cursor-pointer"
              >
                返回首页
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
