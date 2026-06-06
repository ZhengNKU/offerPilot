"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth, UserMenu } from "@/components/AuthProvider";

export default function CareerDashboard() {
  const router = useRouter();
  const auth = useAuth();

  // =========================================================================
  // STATE MANAGEMENT
  // =========================================================================
  const [profile, setProfile] = useState({
    name: "张三",
    status: "在职",
    title: "高级后端工程师",
    experience: "6年经验",
    city: "深圳",
    joinDays: 128,
    tags: ["后端开发", "分布式系统", "系统设计", "性能优化"],
    company: "腾讯科技",
    role: "高级后端工程师",
    level: "高级",
    salary: "25K - 35K",
    gender: "male",
    age: "26",
    school: "清华大学",
    degree: "本科",
    gradYear: "2018"
  });

  const [careerGoal, setCareerGoal] = useState({
    role: "架构师",
    level: "P7",
    salary: "50K - 70K",
    city: "深圳",
    company: "腾讯/美团等 (目标)",
    matchRate: 72
  });

  const [accountSecurity, setAccountSecurity] = useState({
    email: "zhangsan@email.com",
    phone: "138****8888",
    loginMethod: "微信登录",
    password: ""
  });

  // Modals visibility
  const [showEditProfileModal, setShowEditProfileModal] = useState(false);
  const [showEditGoalModal, setShowEditGoalModal] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [showEditSecurityModal, setShowEditSecurityModal] = useState(false);
  const [avatarError, setAvatarError] = useState(false);

  // Form states for modals
  const [profileForm, setProfileForm] = useState({ ...profile, tagsString: profile.tags.join(", ") });
  const [goalForm, setGoalForm] = useState({ ...careerGoal });
  const [securityForm, setSecurityForm] = useState({ ...accountSecurity });
  const [securityTab, setSecurityTab] = useState<"email" | "phone">("phone");

  // Verification states for security edits
  const [emailCountdown, setEmailCountdown] = useState(0);
  const [phoneCountdown, setPhoneCountdown] = useState(0);
  const [emailCode, setEmailCode] = useState("");
  const [phoneCode, setPhoneCode] = useState("");

  // Clear code details on tab change
  useEffect(() => {
    setEmailCode("");
    setPhoneCode("");
    setEmailCountdown(0);
    setPhoneCountdown(0);
  }, [securityTab]);

  useEffect(() => {
    let interval: any;
    if (emailCountdown > 0) {
      interval = setInterval(() => {
        setEmailCountdown(prev => prev - 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [emailCountdown]);

  useEffect(() => {
    let interval: any;
    if (phoneCountdown > 0) {
      interval = setInterval(() => {
        setPhoneCountdown(prev => prev - 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [phoneCountdown]);

  useEffect(() => {
    if (!showEditSecurityModal) {
      setEmailCode("");
      setPhoneCode("");
      setEmailCountdown(0);
      setPhoneCountdown(0);
      setSecurityForm({ ...accountSecurity });
      setSecurityTab("phone");
    }
  }, [showEditSecurityModal, accountSecurity]);

  // Synchronize search params and highlights (History navbar action)
  const handleHistoryRedirect = () => {
    router.push("/memory?tab=timeline");
  };

  // Safe client-side hooks
  useEffect(() => {
    setProfileForm({ ...profile, tagsString: profile.tags.join(", ") });
  }, [profile]);

  useEffect(() => {
    setGoalForm({ ...careerGoal });
  }, [careerGoal]);

  useEffect(() => {
    setSecurityForm({ ...accountSecurity });
  }, [accountSecurity]);

  useEffect(() => {
    if (auth.isLoggedIn && auth.user) {
      setProfile(prev => ({
        ...prev,
        name: auth.user.name,
        status: auth.user.status || prev.status,
        title: auth.user.role || prev.title,
        experience: auth.user.years || prev.experience,
        company: auth.user.company || prev.company,
        role: auth.user.role ? auth.user.role.split(" · ")[0] : prev.role,
        level: auth.user.role ? auth.user.role.split(" · ")[1] || prev.level : prev.level,
        salary: auth.user.salary || prev.salary,
        gender: auth.user.gender || prev.gender,
        age: auth.user.age || prev.age,
        school: auth.user.school || prev.school,
        degree: auth.user.degree || prev.degree,
        gradYear: auth.user.gradYear || prev.gradYear
      }));
      setCareerGoal(prev => ({
        ...prev,
        role: auth.user.targetRole || prev.role,
        level: auth.user.targetGrade || prev.level,
        salary: auth.user.targetSalary || prev.salary,
        company: auth.user.targetCompany || prev.company
      }));
    }
  }, [auth.isLoggedIn, auth.user]);

  useEffect(() => {
    setAvatarError(false);
  }, [auth.user.avatar]);

  // Handlers for Save actions
  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    const updatedProfile = {
      ...profileForm,
      tags: profileForm.tagsString.split(",").map(t => t.trim()).filter(Boolean)
    };
    setProfile(updatedProfile);
    
    auth.updateUser({
      name: profileForm.name,
      status: profileForm.status,
      years: profileForm.experience,
      company: profileForm.company,
      role: `${profileForm.role} · ${profileForm.level || "高级"}`,
      salary: profileForm.salary,
      gender: profileForm.gender,
      age: profileForm.age,
      school: profileForm.school,
      degree: profileForm.degree,
      gradYear: profileForm.gradYear
    });
    setShowEditProfileModal(false);
  };

  const handleSaveGoal = (e: React.FormEvent) => {
    e.preventDefault();
    const randomMatch = Math.floor(Math.random() * 20) + 65; // 65 - 85
    setCareerGoal({
      ...goalForm,
      matchRate: randomMatch
    });
    auth.updateUser({
      targetRole: goalForm.role,
      targetGrade: goalForm.level,
      targetSalary: goalForm.salary,
      targetCompany: goalForm.company
    });
    setShowEditGoalModal(false);
  };

  const handleGetSecurityEmailCode = async () => {
    if (!securityForm.email) {
      auth.triggerToast("请输入邮箱地址！");
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(securityForm.email)) {
      auth.triggerToast("请输入正确的邮箱地址格式！");
      return;
    }
    try {
      const res = await fetch("http://localhost:8000/api/auth/send-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "email", target: securityForm.email })
      });
      if (!res.ok) {
        const errData = await res.json();
        auth.triggerToast(errData.detail || "发送验证码失败！");
        return;
      }
      setEmailCountdown(60);
      auth.triggerToast("验证码已发送，请查收！");
    } catch (e) {
      auth.triggerToast("无法连接到后端服务！");
    }
  };

  const handleGetSecurityPhoneCode = async () => {
    if (!securityForm.phone) {
      auth.triggerToast("请输入手机号码！");
      return;
    }
    const phoneRegex = /^1[3-9]\d{9}$/;
    if (!phoneRegex.test(securityForm.phone)) {
      auth.triggerToast("请输入正确的手机号格式！");
      return;
    }
    try {
      const res = await fetch("http://localhost:8000/api/auth/send-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "phone", target: securityForm.phone })
      });
      if (!res.ok) {
        const errData = await res.json();
        auth.triggerToast(errData.detail || "发送验证码失败！");
        return;
      }
      setPhoneCountdown(60);
      auth.triggerToast("验证码已发送，请查收！");
    } catch (e) {
      auth.triggerToast("无法连接到后端服务！");
    }
  };

  const handleSaveSecurity = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = localStorage.getItem("offerPilot_token");
    if (!token) {
      auth.triggerToast("未登录或会话已过期，请重新登录！");
      return;
    }

    const isEmail = securityTab === "email";
    const value = isEmail ? securityForm.email : securityForm.phone;
    const verify_code = isEmail ? emailCode : phoneCode;

    if (!value) {
      auth.triggerToast(isEmail ? "请输入邮箱地址！" : "请输入手机号码！");
      return;
    }
    if (!verify_code) {
      auth.triggerToast("请输入验证码！");
      return;
    }

    try {
      const res = await fetch("http://localhost:8000/api/auth/security/update", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({
          update_type: securityTab,
          value: value,
          verify_code: verify_code,
          new_password: securityForm.password || null
        })
      });

      if (!res.ok) {
        const errData = await res.json();
        auth.triggerToast(errData.detail || "安全信息修改失败，请核对输入！");
        return;
      }

      setAccountSecurity(prev => ({
        ...prev,
        email: securityForm.email,
        phone: securityForm.phone,
        password: ""
      }));

      auth.triggerToast("修改成功！");
      setShowEditSecurityModal(false);
    } catch (err) {
      auth.triggerToast("无法连接到后端服务！");
    }
  };

  return (
    <div className="min-h-screen bg-background text-on-background font-body-md flex flex-col relative overflow-hidden select-none">
      
      {/* Background visual scifi canvas grid */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff03_1px,transparent_1px),linear-gradient(to_bottom,#ffffff03_1px,transparent_1px)] bg-[size:40px_40px] pointer-events-none z-0" />
      <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-primary/10 rounded-full blur-[160px] pointer-events-none z-0" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-secondary/5 rounded-full blur-[160px] pointer-events-none z-0" />

      {/* ========================================================
          GLOBAL TOP NAVIGATION NAVBAR
         ======================================================== */}
      <nav className="border-b border-white/5 bg-surface-container/60 backdrop-blur-xl h-20 w-full relative z-40 shrink-0">
        <div className="px-gutter h-full max-w-container-max mx-auto flex items-center justify-between relative">
          
          <div
            onClick={() => router.push("/")}
            className="text-2xl font-display-xl font-bold tracking-tight text-on-surface flex items-center gap-2 cursor-pointer"
          >
            <svg className="w-7 h-7" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L20 7V17L12 22L4 17V7L12 2Z" fill="url(#nav-brand-logo)" />
              <path d="M12 6L16 11H13V18L12 18L11 18V13H8L12 6Z" fill="#0b1326" />
              <defs>
                <linearGradient id="nav-brand-logo" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#c0c1ff" />
                  <stop offset="100%" stopColor="#ffb2b7" />
                </linearGradient>
              </defs>
            </svg>
            OfferPilot
          </div>

          <div className="absolute left-1/2 -translate-x-1/2 hidden md:flex items-center gap-8">
            <a onClick={() => router.push("/debugger")} className="text-on-surface-variant hover:text-on-surface transition-colors text-[16px] md:text-[17px] font-extrabold cursor-pointer">
              面试调试器
            </a>
            <a onClick={() => router.push("/memory")} className="text-on-surface-variant hover:text-on-surface transition-colors text-[16px] md:text-[17px] font-extrabold cursor-pointer">
              职业记忆看板
            </a>
            <a onClick={() => router.push("/training")} className="text-on-surface-variant hover:text-on-surface transition-colors text-[16px] md:text-[17px] font-extrabold cursor-pointer">
              面试训练场
            </a>
            <a onClick={() => router.push("/home")} className="text-primary transition-colors text-[16px] md:text-[17px] font-extrabold cursor-pointer relative after:content-[''] after:absolute after:bottom-[-26px] after:left-0 after:right-0 after:h-[2px] after:bg-primary">
              职业驾驶舱
            </a>
            <a onClick={() => router.push("/")} className="text-on-surface-variant hover:text-on-surface transition-colors text-[16px] md:text-[17px] font-extrabold cursor-pointer">
              案例
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
              <span className="text-on-surface-variant/55 hover:text-white transition-colors cursor-pointer flex items-center gap-1">
                <span className="material-symbols-outlined text-sm">help</span>帮助中心
              </span>
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
                      src={auth.user.avatar}
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
                    onClick={() => setShowEditProfileModal(true)} 
                    className="material-symbols-outlined text-xs text-on-surface-variant/40 hover:text-white cursor-pointer transition-colors"
                  >
                    edit
                  </span>
                  <span className="px-3.5 py-1 rounded-full bg-tertiary/10 text-tertiary text-xs md:text-sm font-black border border-tertiary/20 whitespace-nowrap">
                    {profile.status}
                  </span>
                </div>

                {/* Job Title Row */}
                <p className="text-sm font-bold text-on-surface-variant/75 text-left leading-none">{profile.title}</p>
                
                {/* Tags Row */}
                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  {profile.tags.map((tag, i) => (
                    <span key={i} className="px-2.5 py-0.5 rounded-lg bg-white/5 text-on-surface-variant/75 text-[11px] font-bold border border-white/5 whitespace-nowrap">
                      {tag}
                    </span>
                  ))}
                </div>

                {/* Metadata details row */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-on-surface-variant/60 font-semibold font-label-mono pt-1">
                  <span className="flex items-center gap-1.5 whitespace-nowrap">
                    <span className="material-symbols-outlined text-xs text-primary">business_center</span>
                    {profile.experience}
                  </span>
                  <span className="flex items-center gap-1.5 whitespace-nowrap">
                    <span className="material-symbols-outlined text-xs text-primary">location_on</span>
                    {profile.city}
                  </span>
                  <span className="flex items-center gap-1.5 whitespace-nowrap">
                    <span className="material-symbols-outlined text-xs text-primary">calendar_today</span>
                    加入 OfferPilot {profile.joinDays} 天
                  </span>
                </div>
              </div>
            </div>

            {/* Sub-metas of Current Status */}
            <div className="flex items-stretch w-full lg:w-auto border-t lg:border-t-0 pt-4 lg:pt-0 border-white/5 shrink-0 justify-between lg:justify-start">
              
              <div className="flex gap-6 px-5 py-4 rounded-2xl bg-white/[0.02] border border-white/5 shrink-0 w-full sm:w-auto justify-between sm:justify-start">
                <div className="text-left whitespace-nowrap min-w-0">
                  <span className="text-[10px] text-on-surface-variant/40 font-label-mono uppercase tracking-widest font-extrabold mt-[-2px] block">当前公司</span>
                  <span className="text-sm font-black text-white block whitespace-nowrap">{profile.company}</span>
                </div>
                <div className="w-px bg-white/10 self-stretch my-1 shrink-0" />
                <div className="text-left whitespace-nowrap min-w-0">
                  <span className="text-[10px] text-on-surface-variant/40 font-label-mono uppercase tracking-widest font-extrabold mt-[-2px] block">当前岗位</span>
                  <span className="text-sm font-black text-white block whitespace-nowrap">{profile.role}</span>
                </div>
                <div className="w-px bg-white/10 self-stretch my-1 shrink-0" />
                <div className="text-left whitespace-nowrap min-w-0">
                  <span className="text-[10px] text-on-surface-variant/40 font-label-mono uppercase tracking-widest font-extrabold mt-[-2px] block">当前职级</span>
                  <span className="text-sm font-black text-tertiary block whitespace-nowrap">{profile.level}</span>
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
                    onClick={() => setShowEditGoalModal(true)} 
                    className="text-sm text-primary font-black hover:text-white transition-colors cursor-pointer flex items-center gap-0.5"
                  >
                    <span className="material-symbols-outlined text-xs">edit</span>编辑
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-4 flex-1 items-center">
                  <div className="space-y-3.5 text-left">
                    <div>
                      <span className="text-[11px] text-on-surface-variant/40 font-label-mono uppercase tracking-widest font-extrabold block">目标岗位</span>
                      <span className="text-base font-black text-white block mt-0.5 whitespace-nowrap">{careerGoal.role}</span>
                    </div>
                    <div>
                      <span className="text-[11px] text-on-surface-variant/40 font-label-mono uppercase tracking-widest font-extrabold block">目标职级</span>
                      <span className="text-base font-black text-white block mt-0.5 whitespace-nowrap">{careerGoal.level}</span>
                    </div>
                    <div>
                      <span className="text-[11px] text-on-surface-variant/40 font-label-mono uppercase tracking-widest font-extrabold block">目标薪资</span>
                      <span className="text-base font-black text-tertiary block mt-0.5 whitespace-nowrap">{careerGoal.salary}</span>
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
                        />
                        <defs>
                          <linearGradient id="goal-circle-gradient" x1="0" y1="0" x2="1" y2="1">
                            <stop offset="0%" stopColor="#c0c1ff" />
                            <stop offset="100%" stopColor="#4edea3" />
                          </linearGradient>
                        </defs>
                      </svg>
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <span className="text-2xl font-black text-white font-label-mono">{careerGoal.matchRate}%</span>
                        <span className="text-xs text-on-surface-variant/50 font-bold block scale-90">目标匹配度</span>
                      </div>
                    </div>
                    <span className="text-xs text-on-surface-variant/40 font-bold block tracking-wider mt-2.5">基于 AI 架构师画像分析</span>
                  </div>
                </div>
              </div>
            </div>

            {/* WIDGET 2: MEMBERSHIP PLANS */}
            <div className="col-span-12 md:col-span-4 flex flex-col h-full">
              <div className="glass-panel p-5.5 rounded-3xl border-white/10 text-left h-full flex flex-col justify-between gap-4.5 relative overflow-hidden hover:border-secondary/20 transition-all duration-300">
                
                {/* 3D Crystalline vector elements in background */}
                <div className="absolute right-[-10px] top-[15%] w-32 h-32 opacity-15 pointer-events-none z-0">
                  <svg className="w-full h-full text-secondary animate-pulse" viewBox="0 0 100 100" fill="currentColor">
                    <polygon points="50,0 93,25 93,75 50,100 7,75 7,25" fill="none" stroke="currentColor" strokeWidth="2" />
                    <line x1="50" y1="0" x2="50" y2="100" stroke="currentColor" strokeWidth="1" />
                    <line x1="7" y1="25" x2="93" y2="75" stroke="currentColor" strokeWidth="1" />
                    <line x1="7" y1="75" x2="93" y2="25" stroke="currentColor" strokeWidth="1" />
                  </svg>
                </div>
                <div className="absolute right-[10px] top-[30%] w-16 h-16 bg-secondary/10 rounded-full blur-xl pointer-events-none" />

                <div className="flex justify-between items-center pb-2.5 border-b border-white/5 relative z-10">
                  <h4 className="text-base font-black text-white flex items-center gap-2">
                    <span className="material-symbols-outlined text-lg text-secondary" style={{ fontVariationSettings: "'FILL' 1" }}>workspace_premium</span>
                    当前会员
                  </h4>
                  <span className="px-2.5 py-0.5 rounded bg-secondary/15 text-secondary text-[11px] font-black border border-secondary/20">当前套餐</span>
                </div>

                <div className="space-y-3.5 flex-1 flex flex-col justify-center relative z-10">
                  <div className="flex items-baseline gap-2.5">
                    <h3 className="text-2xl font-black text-white font-label-mono">PRO 会员</h3>
                    <span className="text-sm text-on-surface-variant/45 font-bold">有效期至 2026-07-01</span>
                  </div>

                  <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm text-on-surface-variant/75 font-semibold leading-relaxed">
                    {[
                      { l: "面试录音分析", ok: true },
                      { l: "AI 模拟面试", ok: true },
                      { l: "面试记录分析", ok: true },
                      { l: "职业记忆系统", ok: true },
                      { l: "简历深度优化", ok: true },
                      { l: "专属职业顾问", ok: true }
                    ].map((item, idx) => (
                      <div key={idx} className="flex items-center gap-1.5 whitespace-nowrap">
                        <span className="material-symbols-outlined text-sm text-tertiary" style={{ fontVariationSettings: "'wght' 700" }}>check_circle</span>
                        <span>{item.l}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-2.5 relative z-10">
                  <button
                    onClick={() => setShowUpgradeModal(true)}
                    className="w-full py-2.5 bg-gradient-to-r from-secondary to-primary text-on-primary text-sm font-black rounded-xl hover:scale-[1.01] active:scale-98 transition-all shadow-md shadow-secondary/25 cursor-pointer text-center"
                  >
                    升级会员
                  </button>
                  <span 
                    onClick={() => setShowUpgradeModal(true)}
                    className="text-sm font-black text-primary hover:text-white transition-colors cursor-pointer flex items-center justify-center gap-1 mt-2.5"
                  >
                    查看所有会员权益 <span className="material-symbols-outlined text-xs">keyboard_arrow_right</span>
                  </span>
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
                    onClick={() => setShowUpgradeModal(true)}
                    className="text-sm text-tertiary font-black hover:text-white transition-colors cursor-pointer flex items-center gap-0.5"
                  >
                    使用记录 →
                  </span>
                </div>

                {/* Circular Quota meters in 2x2 grids */}
                <div className="grid grid-cols-2 gap-3.5 flex-1 items-center">
                  {[
                    { label: "录音分析", used: 8, total: 10, color: "stroke-[#4edea3]", textStyle: "text-[#4edea3]", icon: "graphic_eq" },
                    { label: "面试记录分析", used: 6, total: 10, color: "stroke-[#60a5fa]", textStyle: "text-[#60a5fa]", icon: "description" },
                    { label: "简历分析", used: 2, total: 5, color: "stroke-[#a78bfa]", textStyle: "text-[#a78bfa]", icon: "article" },
                    { label: "模拟面试", used: 3, total: 5, color: "stroke-amber-400", textStyle: "text-amber-400", icon: "videocam" }
                  ].map((quota, i) => {
                    const percent = quota.used / quota.total;
                    const strokeOffset = 2 * Math.PI * 18 * (1 - percent);
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
                          <span className="text-[12px] text-white font-black block truncate leading-none">{quota.label}</span>
                          <span className="text-[10px] text-on-surface-variant/30 font-bold block mt-1 scale-90 -ml-1">剩余次数</span>
                          <span className="text-[13.5px] font-black text-white block mt-0.5 font-label-mono whitespace-nowrap">
                            {quota.used} <span className="text-on-surface-variant/35 font-normal text-[10px]">/ {quota.total}次</span>
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="border-t border-white/5 pt-3.5 flex justify-between items-center text-xs text-on-surface-variant/40 font-extrabold font-label-mono">
                  <span className="flex items-center gap-1">
                    <span className="material-symbols-outlined text-xs">info</span>
                    额度重置日期: 2026-06-01
                  </span>
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
                    查看全部 <span className="material-symbols-outlined text-xs">keyboard_arrow_right</span>
                  </span>
                </div>

                {/* Timeline flow */}
                <div className="relative pl-5.5 space-y-3 py-1 flex-1 flex flex-col justify-start mt-[-2px]">
                  <div className="absolute left-1.5 top-2.5 bottom-2.5 w-0.5 bg-white/5" />
                  
                  {[
                    { time: "昨天 20:30", type: "录音分析", label: "字节跳动 后端开发", sub: "技术二面", score: 82, rating: "good", color: "bg-primary" },
                    { time: "3天前 15:21", type: "简历优化", label: "腾讯 后台开发工程师", sub: "优化版 v2", score: null, rating: "normal", color: "bg-secondary" },
                    { time: "5天前 11:05", type: "模拟面试", label: "系统设计专场", sub: "专项训练", score: 76, rating: "good", color: "bg-tertiary" },
                    { time: "7天前 09:40", type: "面试记录分析", label: "美团 技术一面", sub: "风险点 3 个", score: 71, rating: "risk", color: "bg-amber-500" }
                  ].map((node, i) => (
                    <div key={i} className="relative flex justify-between items-start text-sm font-semibold">
                      <div className={`absolute -left-5 top-1.5 w-2 h-2 rounded-full ${node.color} ring-4 ring-background z-10`} />
                      
                      <div className="text-left space-y-0.5 min-w-0 pr-4">
                        <div className="flex items-center gap-1.5 flex-wrap">
                           <span className="text-xs text-on-surface-variant/40 font-label-mono">{node.time}</span>
                           <span className="text-white/10 font-normal">|</span>
                           <span className="text-xs text-primary/70 font-extrabold uppercase">{node.type}</span>
                        </div>
                        <p className="text-sm font-black text-white truncate leading-snug mt-0.5">
                          {node.label} <span className="text-on-surface-variant/45 font-medium">[{node.sub}]</span>
                        </p>
                      </div>

                      <div className="shrink-0 flex items-center">
                        {node.score ? (
                           <span className={`font-black font-label-mono text-xs md:text-sm px-2 py-0.5 rounded-lg whitespace-nowrap ${
                            node.rating === "good" ? "bg-tertiary/10 text-tertiary border border-tertiary/20" : 
                            node.rating === "risk" ? "bg-secondary/15 text-secondary border border-secondary/20" :
                            "bg-white/5 text-on-surface-variant/60"
                          }`}>
                            评分 {node.score}
                          </span>
                        ) : (
                          <span className="text-on-surface-variant/30 font-semibold font-label-mono text-xs px-2 whitespace-nowrap">—</span>
                        )}
                      </div>
                    </div>
                  ))}
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
                    { label: "新建录音分析", sub: "上传音频智能分析", icon: "mic", color: "text-[#4edea3] bg-[#4edea3]/10 border-[#4edea3]/20", path: "/debugger" },
                    { label: "新建记录分析", sub: "粘贴记录 AI 剖析", icon: "edit_document", color: "text-[#60a5fa] bg-[#60a5fa]/10 border-[#60a5fa]/20", path: "/debugger" },
                    { label: "新建简历分析", sub: "深度优化简历内容", icon: "description", color: "text-[#a78bfa] bg-[#a78bfa]/10 border-[#a78bfa]/20", path: "/debugger" },
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
                        <span className="text-[10px] text-on-surface-variant/30 font-bold block truncate mt-1">{act.sub}</span>
                      </div>
                    </button>
                  ))}
                </div>

              </div>
            </div>

            {/* WIDGET 6: BILLS AND INVOICES */}
            <div className="col-span-12 md:col-span-4 flex flex-col h-full">
              <div className="glass-panel p-5.5 rounded-3xl border-white/10 text-left h-full flex flex-col justify-start gap-4 hover:border-tertiary/20 transition-all duration-300">
                
                <div className="flex justify-between items-center pb-2.5 border-b border-white/5 shrink-0">
                  <h4 className="text-base font-black text-white flex items-center gap-2">
                    <span className="material-symbols-outlined text-lg text-tertiary" style={{ fontVariationSettings: "'FILL' 1" }}>receipt_long</span>
                    账单与订单
                  </h4>
                  <span 
                    onClick={() => setShowUpgradeModal(true)}
                    className="text-sm text-tertiary font-black hover:text-white transition-colors cursor-pointer flex items-center gap-1"
                  >
                    查看全部 <span className="material-symbols-outlined text-xs">keyboard_arrow_right</span>
                  </span>
                </div>

                {/* Orders billing list */}
                <div className="space-y-3.5 py-1 mt-[-2px]">
                  {[
                    { date: "2026-05-01", type: "PRO 会员 (月付)", price: "¥39", status: "已支付" },
                    { date: "2026-04-01", type: "MAX 会员 (月付)", price: "¥99", status: "已支付" }
                  ].map((bill, i) => (
                    <div key={i} className="flex justify-between items-center py-4.5 px-4.5 rounded-2xl bg-white/[0.01] border border-white/5">
                      <div className="text-left space-y-0.5 min-w-0 pr-3">
                        <span className="text-xs text-on-surface-variant/40 font-label-mono font-bold block">{bill.date}</span>
                        <span className="text-sm font-black text-white block leading-snug truncate">{bill.type}</span>
                      </div>
                      
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="text-sm font-black text-white font-label-mono">{bill.price}</span>
                        <span className="px-2 py-0.5 rounded bg-tertiary/10 text-tertiary text-[11px] font-black border border-tertiary/20">
                          {bill.status}
                        </span>
                      </div>
                    </div>
                  ))}
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
                  onClick={() => setShowEditSecurityModal(true)}
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
            © 2026 OfferPilot AI. All rights reserved.
          </span>
          <div className="flex gap-8 text-xs text-on-surface-variant font-label-mono font-bold tracking-widest">
            <span onClick={() => router.push("/")} className="hover:text-primary transition-colors cursor-pointer select-none">
              服务条款
            </span>
            <span onClick={() => router.push("/")} className="hover:text-primary transition-colors cursor-pointer select-none">
              隐私政策
            </span>
            <span onClick={() => router.push("/")} className="hover:text-primary transition-colors cursor-pointer select-none">
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
                    <label className="text-on-surface-variant/60 font-bold block">姓名</label>
                    <input
                      type="text"
                      required
                      value={profileForm.name}
                      onChange={(e) => setProfileForm({ ...profileForm, name: e.target.value })}
                      className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl focus:outline-none focus:border-primary/40 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-on-surface-variant/60 font-bold block">求职状态</label>
                    <select
                      value={profileForm.status}
                      onChange={(e) => setProfileForm({ ...profileForm, status: e.target.value })}
                      className="w-full px-4 py-3 bg-[#060e20] border border-white/10 rounded-xl focus:outline-none focus:border-primary/40 text-sm text-white"
                    >
                      <option className="bg-[#0e1626]" value="在职">在职</option>
                      <option className="bg-[#0e1626]" value="离职">离职</option>
                      <option className="bg-[#0e1626]" value="在校生">在校生</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-on-surface-variant/60 font-bold block">性别</label>
                    <select
                      value={profileForm.gender || "male"}
                      onChange={(e) => setProfileForm({ ...profileForm, gender: e.target.value })}
                      className="w-full px-4 py-3 bg-[#060e20] border border-white/10 rounded-xl focus:outline-none focus:border-primary/40 text-sm text-white"
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
                    <label className="text-on-surface-variant/60 font-bold block">当前公司</label>
                    <input
                      type="text"
                      required
                      value={profileForm.company}
                      onChange={(e) => setProfileForm({ ...profileForm, company: e.target.value })}
                      className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl focus:outline-none focus:border-primary/40 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-on-surface-variant/60 font-bold block">当前岗位</label>
                    <input
                      type="text"
                      required
                      value={profileForm.role}
                      onChange={(e) => setProfileForm({ ...profileForm, role: e.target.value })}
                      className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl focus:outline-none focus:border-primary/40 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-on-surface-variant/60 font-bold block">当前职级</label>
                    <input
                      type="text"
                      required
                      value={profileForm.level}
                      onChange={(e) => setProfileForm({ ...profileForm, level: e.target.value })}
                      className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl focus:outline-none focus:border-primary/40 text-sm"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-on-surface-variant/60 font-bold block">当前月薪范围</label>
                    <input
                      type="text"
                      placeholder="例如：25K - 35K"
                      value={profileForm.salary || ""}
                      onChange={(e) => setProfileForm({ ...profileForm, salary: e.target.value })}
                      className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl focus:outline-none focus:border-primary/40 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-on-surface-variant/60 font-bold block">城市</label>
                    <input
                      type="text"
                      required
                      value={profileForm.city}
                      onChange={(e) => setProfileForm({ ...profileForm, city: e.target.value })}
                      className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl focus:outline-none focus:border-primary/40 text-sm"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-on-surface-variant/60 font-bold block">工作年限</label>
                    <input
                      type="text"
                      required
                      placeholder="例如：2年6个月"
                      value={profileForm.experience}
                      onChange={(e) => setProfileForm({ ...profileForm, experience: e.target.value })}
                      className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl focus:outline-none focus:border-primary/40 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-on-surface-variant/60 font-bold block">职业头衔</label>
                    <input
                      type="text"
                      required
                      value={profileForm.title}
                      onChange={(e) => setProfileForm({ ...profileForm, title: e.target.value })}
                      className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl focus:outline-none focus:border-primary/40 text-sm"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-on-surface-variant/60 font-bold block">专业技术标签 (用英文逗号隔开)</label>
                  <input
                    type="text"
                    required
                    value={profileForm.tagsString}
                    onChange={(e) => setProfileForm({ ...profileForm, tagsString: e.target.value })}
                    className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl focus:outline-none focus:border-primary/40 text-sm"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-on-surface-variant/60 font-bold block">学校名称</label>
                    <input
                      type="text"
                      placeholder="例如：清华大学"
                      value={profileForm.school || ""}
                      onChange={(e) => setProfileForm({ ...profileForm, school: e.target.value })}
                      className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl focus:outline-none focus:border-primary/40 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-on-surface-variant/60 font-bold block">学历</label>
                    <select
                      value={profileForm.degree || "本科"}
                      onChange={(e) => setProfileForm({ ...profileForm, degree: e.target.value })}
                      className="w-full px-4 py-3 bg-[#060e20] border border-white/10 rounded-xl focus:outline-none focus:border-primary/40 text-sm text-white"
                    >
                      {["大专", "本科", "硕士", "博士", "其他"].map((d) => (
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
                    className="px-6 py-3 rounded-xl bg-primary text-on-primary font-black shadow-lg shadow-primary/20 hover:scale-[1.01] active:scale-98 transition-all cursor-pointer"
                  >
                    保存资料
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
                    <label className="text-on-surface-variant/60 font-bold block">目标岗位</label>
                    <input
                      type="text"
                      required
                      value={goalForm.role}
                      onChange={(e) => setGoalForm({ ...goalForm, role: e.target.value })}
                      className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl focus:outline-none focus:border-primary/40 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-on-surface-variant/60 font-bold block">目标职级</label>
                    <input
                      type="text"
                      required
                      value={goalForm.level}
                      onChange={(e) => setGoalForm({ ...goalForm, level: e.target.value })}
                      className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl focus:outline-none focus:border-primary/40 text-sm"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-on-surface-variant/60 font-bold block">目标城市</label>
                    <input
                      type="text"
                      required
                      value={goalForm.city}
                      onChange={(e) => setGoalForm({ ...goalForm, city: e.target.value })}
                      className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl focus:outline-none focus:border-primary/40 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-on-surface-variant/60 font-bold block">目标公司 (选填)</label>
                    <input
                      type="text"
                      placeholder="例如：腾讯科技"
                      value={goalForm.company || ""}
                      onChange={(e) => setGoalForm({ ...goalForm, company: e.target.value })}
                      className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl focus:outline-none focus:border-primary/40 text-sm"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-on-surface-variant/60 font-bold block">期望薪资范围</label>
                  <input
                    type="text"
                    required
                    value={goalForm.salary}
                    onChange={(e) => setGoalForm({ ...goalForm, salary: e.target.value })}
                    className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl focus:outline-none focus:border-primary/40 text-sm"
                  />
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
                    className="px-6 py-3 rounded-xl bg-primary text-on-primary font-black shadow-lg shadow-primary/20 hover:scale-[1.01] active:scale-98 transition-all cursor-pointer"
                  >
                    保存更新
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
              onClick={() => setShowEditSecurityModal(false)}
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
                  onClick={() => setShowEditSecurityModal(false)}
                  className="text-on-surface-variant hover:text-white transition-colors cursor-pointer flex items-center justify-center w-7 h-7 rounded-lg hover:bg-white/5"
                >
                  <span className="material-symbols-outlined text-base">close</span>
                </button>
              </div>

              <form onSubmit={handleSaveSecurity} className="space-y-4 text-sm font-semibold text-white">
                
                {/* Tab switchers matching Forgot Password style (Phone first, Email second) */}
                <div className="flex bg-[#050B1A] p-1.5 rounded-xl border border-white/5 font-bold text-sm select-none">
                  <button
                    type="button"
                    onClick={() => setSecurityTab("phone")}
                    className={`flex-1 py-2.5 rounded-lg text-center transition-all cursor-pointer ${
                      securityTab === "phone" ? "bg-[#AFA7FF]/15 text-[#AFA7FF]" : "text-white/40 hover:text-white/70"
                    }`}
                  >
                    手机修改
                  </button>
                  <button
                    type="button"
                    onClick={() => setSecurityTab("email")}
                    className={`flex-1 py-2.5 rounded-lg text-center transition-all cursor-pointer ${
                      securityTab === "email" ? "bg-[#AFA7FF]/15 text-[#AFA7FF]" : "text-white/40 hover:text-white/70"
                    }`}
                  >
                    邮箱修改
                  </button>
                </div>

                {securityTab === "email" ? (
                  <>
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
                  </>
                ) : (
                  <>
                    <div className="space-y-1.5">
                      <label className="text-on-surface-variant/60 font-bold block">手机号码 <span className="text-[#FF7A95]">*</span></label>
                      <input
                        type="text"
                        required
                        value={securityForm.phone}
                        onChange={(e) => setSecurityForm({ ...securityForm, phone: e.target.value })}
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
                          value={phoneCode}
                          onChange={(e) => setPhoneCode(e.target.value)}
                          className="flex-1 py-3 px-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/20 focus:outline-none focus:border-[#AFA7FF]/40 text-sm font-semibold"
                        />
                        <button
                          type="button"
                          disabled={phoneCountdown > 0}
                          onClick={handleGetSecurityPhoneCode}
                          className="px-4 py-3 rounded-xl border border-[#AFA7FF]/20 text-[#AFA7FF] font-black text-sm hover:bg-[#AFA7FF]/5 active:scale-95 transition-all select-none whitespace-nowrap cursor-pointer"
                        >
                          {phoneCountdown > 0 ? `${phoneCountdown}s` : "获取验证码"}
                        </button>
                      </div>
                    </div>
                  </>
                )}

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
                    onClick={() => setShowEditSecurityModal(false)}
                    className="px-6 py-3 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 active:scale-95 transition-all text-white cursor-pointer"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    className="px-6 py-3 rounded-xl bg-primary text-on-primary font-black shadow-lg shadow-primary/20 hover:scale-[1.01] active:scale-98 transition-all cursor-pointer"
                  >
                    确认修改
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}



        {/* UPGRADE AND MEMBERSHIP DETAILS MODAL */}
        {showUpgradeModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowUpgradeModal(false)}
              className="absolute inset-0 bg-surface/60 backdrop-blur-md"
            />

            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-surface-container-high border border-white/10 rounded-3xl p-7 max-w-4xl w-full text-left relative z-10 space-y-6 shadow-2xl max-h-[85vh] overflow-y-auto"
            >
              <div className="flex justify-between items-center pb-4 border-b border-white/5">
                <h3 className="font-extrabold text-white text-lg flex items-center gap-2">
                  <span className="material-symbols-outlined text-secondary" style={{ fontVariationSettings: "'FILL' 1" }}>workspace_premium</span>
                  解锁 OfferPilot 顶配 AI 职业大招：会员计划对比
                </h3>
                <button
                  onClick={() => setShowUpgradeModal(false)}
                  className="text-on-surface-variant hover:text-white transition-colors cursor-pointer flex items-center justify-center w-7 h-7 rounded-lg hover:bg-white/5"
                >
                  <span className="material-symbols-outlined text-lg">close</span>
                </button>
              </div>

              {/* Plans comparison cards row */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 leading-relaxed text-xs font-semibold">
                
                {/* Plan 1: Free */}
                <div className="p-5.5 rounded-2xl bg-white/[0.01] border border-white/5 flex flex-col justify-between gap-5 text-left">
                  <div className="space-y-4">
                    <div>
                      <h4 className="text-sm font-black text-white">基础体验版</h4>
                      <span className="text-[20px] font-black text-white font-label-mono mt-1 block">¥0 <span className="text-xs text-on-surface-variant/40 font-normal">/ 免费永久</span></span>
                    </div>
                    <p className="text-on-surface-variant/60">适用于基本面试调试与简历排版快速自测，限制部分 AI 深度模型。</p>
                    <ul className="space-y-2 border-t border-white/5 pt-4 text-on-surface-variant/75">
                      <li className="flex items-center gap-1.5"><span className="material-symbols-outlined text-xs text-tertiary">check_circle</span>每月 2 次面试录音 analysis</li>
                      <li className="flex items-center gap-1.5"><span className="material-symbols-outlined text-xs text-tertiary">check_circle</span>每月 1 次简历基础诊断</li>
                      <li className="flex items-center gap-1.5"><span className="material-symbols-outlined text-xs text-on-surface-variant/30">cancel</span>AI 模拟对话演练</li>
                      <li className="flex items-center gap-1.5"><span className="material-symbols-outlined text-xs text-on-surface-variant/30">cancel</span>长期职业记忆云存储</li>
                    </ul>
                  </div>
                  <button onClick={() => setShowUpgradeModal(false)} className="w-full py-2.5 bg-white/5 hover:bg-white/10 text-white rounded-xl font-black border border-white/10 transition-all cursor-pointer">
                    当前版本
                  </button>
                </div>

                {/* Plan 2: PRO */}
                <div className="p-5.5 rounded-2xl bg-primary/5 border border-primary/20 flex flex-col justify-between gap-5 text-left relative overflow-hidden">
                  <div className="absolute top-0 right-0 px-2.5 py-0.5 bg-primary text-on-primary text-[9px] font-black rounded-bl-xl uppercase tracking-widest font-label-mono select-none">推荐</div>
                  
                  <div className="space-y-4">
                    <div>
                      <h4 className="text-sm font-black text-white">PRO 专家会员</h4>
                      <span className="text-[20px] font-black text-primary font-label-mono mt-1 block">¥39 <span className="text-xs text-on-surface-variant/40 font-normal">/ 月付套餐</span></span>
                    </div>
                    <p className="text-on-surface-variant/60">适合正在频繁参加面试、渴望快速突破弱点并获得中高大厂 Offer 的高级工程师。</p>
                    <ul className="space-y-2 border-t border-white/5 pt-4 text-on-surface-variant/75">
                      <li className="flex items-center gap-1.5"><span className="material-symbols-outlined text-xs text-tertiary">check_circle</span>每月 10 次面试录音分析</li>
                      <li className="flex items-center gap-1.5"><span className="material-symbols-outlined text-xs text-tertiary">check_circle</span>每月 5 次简历深度优化</li>
                      <li className="flex items-center gap-1.5"><span className="material-symbols-outlined text-xs text-tertiary">check_circle</span>每月 5 次 AI 模拟面试演练</li>
                      <li className="flex items-center gap-1.5"><span className="material-symbols-outlined text-xs text-tertiary">check_circle</span>全套职业记忆库系统支撑</li>
                    </ul>
                  </div>
                  <button onClick={() => setShowUpgradeModal(false)} className="w-full py-2.5 bg-primary text-on-primary rounded-xl font-black shadow-lg shadow-primary/20 hover:scale-[1.01] active:scale-98 transition-all cursor-pointer">
                    已是此会员 (去续费)
                  </button>
                </div>

                {/* Plan 3: MAX */}
                <div className="p-5.5 rounded-2xl bg-secondary/5 border border-secondary/20 flex flex-col justify-between gap-5 text-left relative overflow-hidden">
                  <div className="space-y-4">
                    <div>
                      <h4 className="text-sm font-black text-white">MAX 领航会员</h4>
                      <span className="text-[20px] font-black text-secondary font-label-mono mt-1 block">¥99 <span className="text-xs text-on-surface-variant/40 font-normal">/ 月付套餐</span></span>
                    </div>
                    <p className="text-on-surface-variant/60">尊享无限分析额度与特权，适合追求极致、备战顶级架构师/技术总监职位的技术精英。</p>
                    <ul className="space-y-2 border-t border-white/5 pt-4 text-on-surface-variant/75">
                      <li className="flex items-center gap-1.5"><span className="material-symbols-outlined text-xs text-tertiary">check_circle</span>无限次面试录音/记录分析</li>
                      <li className="flex items-center gap-1.5"><span className="material-symbols-outlined text-xs text-tertiary">check_circle</span>无限次简历深度精修</li>
                      <li className="flex items-center gap-1.5"><span className="material-symbols-outlined text-xs text-tertiary">check_circle</span>无限次 AI 模拟面试通关</li>
                      <li className="flex items-center gap-1.5"><span className="material-symbols-outlined text-xs text-tertiary">check_circle</span>一对一专属 AI 终身顾问咨询</li>
                    </ul>
                  </div>
                  <button onClick={() => setShowUpgradeModal(false)} className="w-full py-2.5 bg-gradient-to-r from-secondary to-primary text-on-primary rounded-xl font-black shadow-lg shadow-secondary/20 hover:scale-[1.01] active:scale-98 transition-all cursor-pointer">
                    立即升级
                  </button>
                </div>

              </div>

              {/* Checkout simulation QR section */}
              <div className="border-t border-white/5 pt-6 flex flex-col sm:flex-row justify-between items-center gap-5">
                <div className="text-left max-w-md">
                  <h5 className="text-xs md:text-sm font-black text-white">微信/支付宝 扫码快捷支付</h5>
                  <p className="text-[11px] text-on-surface-variant/50 leading-relaxed font-semibold mt-1">付款后会员权益实时重置，PRO/MAX 会员均可随时退订，7天内无理由全额退款保障。</p>
                </div>
                <div className="flex gap-4 items-center shrink-0">
                  <div className="p-2 rounded-xl bg-white border border-white/10 w-24 h-24 flex items-center justify-center relative overflow-hidden select-none">
                    {/* Simulated QR Code graph */}
                    <div className="absolute inset-2 bg-[linear-gradient(to_right,#000_1px,transparent_1px),linear-gradient(to_bottom,#000_1px,transparent_1px)] bg-[size:6px_6px]" />
                    <div className="absolute w-6 h-6 bg-black left-2 top-2 border-2 border-white" />
                    <div className="absolute w-6 h-6 bg-black right-2 top-2 border-2 border-white" />
                    <div className="absolute w-6 h-6 bg-black left-2 bottom-2 border-2 border-white" />
                  </div>
                  <div className="text-left font-label-mono text-xs font-semibold text-on-surface-variant/70 leading-normal">
                    <p>微信支付: 支持信用卡</p>
                    <p>支付宝: 支持蚂蚁花呗</p>
                    <p className="text-tertiary font-black block mt-1">7天无理由退款保证</p>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}

      </AnimatePresence>

    </div>
  );
}
