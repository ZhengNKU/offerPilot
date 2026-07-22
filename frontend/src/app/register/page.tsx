"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/components/AuthProvider";
import { API_BASE } from "@/lib/api";

const agreementMarkdown = `欢迎您使用 面试驾到 AI 面试教练系统（以下简称“本服务”）。本协议由您与 面试驾到 运营团队共同缔结。在注册或开始使用本服务前，请您务必仔细阅读并理解本《用户服务协议》。

## 一、 服务内容与规则
1. **服务定位**：面试驾到 是一款 AI 驱动的面试智能分析及职业成长辅助系统，主要为您提供简历深度分析、面试录音/记录分析、AI 模拟面试场景训练以及 Offer 概率预测等服务。
2. **免责声明**：您理解并同意，本服务生成的评估数据、分析结果、STAR 优化话术等内容均为 AI 模型根据您提供的信息推理得出，仅供您的求职参考，我们不保证其绝对的准确性、完整性或对最终面试结果的保证性。

## 二、 账户注册与安全
1. **信息真实性**：您在注册本服务时应当提供真实、合法、有效的个人账户资料（包括但不限于手机号、邮箱、用户名等）。
2. **账户保管**：您有责任妥善保管您的登录密码与账户安全，凡是以您账户名义进行的操作，均视为您本人之行为。您不得将账户以任何形式转让、借用或售卖给第三方使用。

## 三、 用户行为规范
在使用本服务时，您承诺遵守国家法律法规，不得利用本服务进行以下行为：
* 上传或粘贴包含虚假、欺诈、恶意诽谤、侵犯他人隐私或知识产权的内容；
* 录制并上传包含国家机密、商业机密、他人敏感隐私等违反保密义务的面试音频；
* 恶意攻击、破解、逆向工程本服务后台系统，或者干扰其他用户的正常使用。

## 四、 服务的修改与终止
面试驾到 有权根据系统维护、AI 模型迭代或业务调整需要，对本服务的部分或全部内容进行优化、升级、暂停或终止。您可以在职业驾驶舱中随时注销并删除您的账号，注销后我们将立即抹除您的所有关联数据。`;

const privacyMarkdown = `我们非常重视您的隐私。本《隐私政策》详细说明了 面试驾到 在您使用我们的服务时，如何收集、使用、存储 and 保护您的个人信息。

## 一、 我们如何收集和使用信息
1. **基本账号信息**：当您注册本服务时，我们将收集您的手机号码或邮箱，用于身份认证和账号创建。
2. **职业背景与求职期望**：我们将收集您的工作年限、当前岗位、目标薪资、教育背景等数据。这些数据将仅用于为您的简历分析、STAR 重写、JD 匹配以及 Offer 预测建立个性化画像模型。
3. **面试音频与对话记录**：当您上传面试录音、粘贴面试文本时，我们将收集这些音频或文字信息。我们通过底层脱敏算法自动识别并抹去姓名、企业等显著敏感词，仅对其核心的技术问答、表达逻辑等进行技术性评估推理。

## 二、 信息安全与存储保护
1. **数据脱敏**：我们在模型输入层引入本地脱敏逻辑，全力防止您的敏感身份数据传输到外部的大语言模型接口。
2. **安全存储**：您的所有个人数据都经过高强度 SSL 加密传输，并进行安全数据库存储。
3. **绝不泄露**：我们承诺绝不会将您的个人简历、音频、对话及评估分析报告出售、转让或授权给任何无关的第三方企业或机构。

## 三、 您的权利与数据清除
您对您的个人数据拥有绝对的控制权。您可以在“职业驾驶舱 - 账号与安全”中，随时查看、修改您的基本职业档案，或者直接点击“注销账户”。账号注销属于不可逆操作，注销后我们的数据库将立即彻底清空并永久抹去您的所有关联数据和历史分析报告。`;

function renderMarkdown(md: string) {
  let html = md;
  // Escape HTML tags to prevent XSS
  html = html
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
    
  // Headers: ###, ##, #
  html = html.replace(/^### (.*?)$/gm, '<h5 class="text-white font-extrabold text-sm mt-4 mb-2">$1</h5>');
  html = html.replace(/^## (.*?)$/gm, '<h4 class="text-white font-black text-base mt-5 mb-2.5">$1</h4>');
  html = html.replace(/^# (.*?)$/gm, '<h3 class="text-white font-black text-lg mt-6 mb-3">$1</h3>');
  
  // Bold: **text**
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong class="text-white font-extrabold">$1</strong>');
  
  // Lists: ● or * or -
  html = html.replace(/^● (.*?)$/gm, '<li class="ml-4 list-disc text-white/70 mt-1">$1</li>');
  html = html.replace(/^[-\*] (.*?)$/gm, '<li class="ml-4 list-disc text-white/70 mt-1">$1</li>');
  
  // Paragraphs
  const lines = html.split('\n');
  const processedLines = lines.map(line => {
    const trimmed = line.trim();
    if (!trimmed) return '';
    if (trimmed.startsWith('<h') || trimmed.startsWith('<li')) return line;
    return `<p class="mb-3 text-white/70 leading-relaxed">${line}</p>`;
  });
  
  return (
    <div 
      className="space-y-1 text-xs md:text-sm text-white/70 space-y-4 font-normal leading-relaxed"
      dangerouslySetInnerHTML={{ __html: processedLines.join('\n') }} 
    />
  );
}


export default function RegisterPage() {
  const router = useRouter();
  const auth = useAuth();

  // Step indicator state (1, 2, 3)
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // -------------------------------------------------------------
  // STEP 1: ACCOUNT REGISTRATION STATE
  // -------------------------------------------------------------
  // 内测版本：只保留邮箱注册（删除手机号相关 state）
  const [email, setEmail] = useState("");
  const [emailVerifyCode, setEmailVerifyCode] = useState("");
  const [isSendingCode, setIsSendingCode] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [agreePolicy, setAgreePolicy] = useState(false);
  const [showAgreementModal, setShowAgreementModal] = useState(false);
  const [showPrivacyModal, setShowPrivacyModal] = useState(false);
  const [emailTimer, setEmailTimer] = useState(0);
  const [errors, setErrors] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let t: NodeJS.Timeout;
    if (emailTimer > 0) {
      t = setTimeout(() => setEmailTimer(emailTimer - 1), 1000);
    }
    return () => clearTimeout(t);
  }, [emailTimer]);

  const handleSendCode = async () => {
    // 内测版本：只支持邮箱验证码
    const target = email;
    if (!target) {
      setErrors(prev => ({ ...prev, email: true }));
      auth.triggerToast("请输入邮箱地址！");
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(target)) {
      setErrors(prev => ({ ...prev, email: true }));
      auth.triggerToast("请输入正确的邮箱地址格式！");
      return;
    }

    setIsSendingCode(true);
    try {
      const res = await fetch(`${API_BASE}/api/auth/send-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "email", target })
      });
      if (!res.ok) {
        const errData = await res.json();
        auth.triggerToast(errData.detail || "发送验证码失败！");
        return;
      }
      setEmailTimer(60);
      auth.triggerToast("验证码已发送，请查收！");
    } catch (err) {
      auth.triggerToast("无法连接到后端服务！");
    } finally {
      setIsSendingCode(false);
    }
  };

  const handleNextToStep2 = async () => {
    // 内测版本：只走邮箱验证
    const newErrors: Record<string, boolean> = {};
    if (!email) {
      newErrors.email = true;
    } else {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        newErrors.email = true;
        setErrors(prev => ({ ...prev, email: true }));
        auth.triggerToast("请输入正确的邮箱地址格式！");
        return;
      }
    }
    if (!emailVerifyCode) {
      newErrors.emailVerifyCode = true;
    }
    if (!username) {
      newErrors.username = true;
    }
    if (!password) {
      newErrors.password = true;
    } else {
      const hasUppercase = /[A-Z]/.test(password);
      const hasLowercase = /[a-z]/.test(password);
      const hasNumber = /\d/.test(password);
      if (password.length < 8 || !hasUppercase || !hasLowercase || !hasNumber) {
        newErrors.password = true;
        setErrors(prev => ({ ...prev, password: true }));
        auth.triggerToast("密码长度不能少于8位，且必须包含大小写字母和数字！");
        return;
      }
    }
    if (!confirmPassword) {
      newErrors.confirmPassword = true;
    } else if (password !== confirmPassword) {
      newErrors.confirmPassword = true;
      setErrors(prev => ({ ...prev, confirmPassword: true }));
      auth.triggerToast("两次输入的密码不一致！");
      return;
    }
    if (!agreePolicy) {
      newErrors.agreePolicy = true;
    }

    setErrors(newErrors);

    if (Object.keys(newErrors).length > 0) {
      if (newErrors.agreePolicy && Object.keys(newErrors).length === 1) {
        auth.triggerToast("您需要同意《用户协议》和《隐私政策》才能继续！");
      } else {
        auth.triggerToast("请填齐所有必填项！");
      }
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/api/auth/register/step1`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reg_method: "email",
          email: email,
          verify_code: emailVerifyCode,
          username,
          password
        })
      });

      if (!res.ok) {
        const errData = await res.json();
        auth.triggerToast(errData.detail || "注册信息验证失败！");
        return;
      }

      setStep(2);
    } catch (err) {
      auth.triggerToast("无法连接到后端服务！");
    }
  };

  // -------------------------------------------------------------
  // STEP 2: PROFESSIONAL BACKGROUND STATE
  // -------------------------------------------------------------
  const [gender, setGender] = useState<"male" | "female" | "other">("male");
  const [age, setAge] = useState("26");
  const [jobStatus, setJobStatus] = useState<"active" | "resigned" | "student">("active");
  const [expYears, setExpYears] = useState("2年");
  const [expMonths, setExpMonths] = useState("6个月");
  const [companyName, setCompanyName] = useState("字节跳动");
  const [roleName, setRoleName] = useState("后端开发工程师");
  const [salaryMin, setSalaryMin] = useState(2);
  const [salaryMax, setSalaryMax] = useState(35);
  const [isSalaryUnspecified, setIsSalaryUnspecified] = useState(false);
  const [school, setSchool] = useState("清华大学");
  const [degree, setDegree] = useState("本科");
  const [gradYear, setGradYear] = useState("2018");
  const [hasExp, setHasExp] = useState(true);

  // Drag & Crop Avatar State
  const [avatarSrc, setAvatarSrc] = useState<string>("/register.jpg"); // default image
  const [scale, setScale] = useState(1);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const isDragging = useRef(false);
  const startDragX = useRef(0);
  const startDragY = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const handleMouseDown = (e: React.MouseEvent) => {
    isDragging.current = true;
    startDragX.current = e.clientX - offsetX;
    startDragY.current = e.clientY - offsetY;
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging.current) return;
    const newX = e.clientX - startDragX.current;
    const newY = e.clientY - startDragY.current;
    
    // Bounds checking based on scale to prevent dragging too far out
    const maxOffset = Math.max(0, (scale - 1) * 80);
    setOffsetX(Math.max(-maxOffset, Math.min(maxOffset, newX)));
    setOffsetY(Math.max(-maxOffset, Math.min(maxOffset, newY)));
  };

  const handleMouseUpOrLeave = () => {
    isDragging.current = false;
  };

  // Touch Support for mobile device drag-and-crop
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      isDragging.current = true;
      startDragX.current = e.touches[0].clientX - offsetX;
      startDragY.current = e.touches[0].clientY - offsetY;
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging.current || e.touches.length !== 1) return;
    const newX = e.touches[0].clientX - startDragX.current;
    const newY = e.touches[0].clientY - startDragY.current;
    const maxOffset = Math.max(0, (scale - 1) * 80);
    setOffsetX(Math.max(-maxOffset, Math.min(maxOffset, newX)));
    setOffsetY(Math.max(-maxOffset, Math.min(maxOffset, newY)));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1025 * 1025) {
      auth.triggerToast("上传头像文件大小不能超过 5MB！");
      return;
    }
    const reader = new FileReader();
    reader.onload = (event) => {
      if (event.target?.result) {
        setAvatarSrc(event.target.result as string);
        setScale(1);
        setOffsetX(0);
        setOffsetY(0);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleNextToStep3 = () => {
    setStep(3);
  };

  // -------------------------------------------------------------
  // STEP 3: CAREER EXPECTATIONS STATE
  // -------------------------------------------------------------
  const [targetCities, setTargetCities] = useState<string[]>(["上海", "深圳", "杭州"]);
  const [showCustomCityInput, setShowCustomCityInput] = useState(false);
  const [customCityValue, setCustomCityValue] = useState("");
  const [targetCompany, setTargetCompany] = useState("");
  const [targetRole, setTargetRole] = useState("");
  const [targetGrade, setTargetGrade] = useState("高级");
  const [targetSalaryMin, setTargetSalaryMin] = useState(2);
  const [targetSalaryMax, setTargetSalaryMax] = useState(35);
  const [isTargetSalaryUnspecified, setIsTargetSalaryUnspecified] = useState(false);
  
  // Other Preferences
  const [prefIndustry, setPrefIndustry] = useState("");
  const [prefSize, setPrefSize] = useState("");
  const [prefType, setPrefType] = useState("");
  const [prefTeam, setPrefTeam] = useState("");
  const [additionalDesc, setAdditionalDesc] = useState("");

  const handleAddCustomCity = () => {
    const trimmed = customCityValue.trim();
    if (!trimmed) return;
    if (!targetCities.includes(trimmed)) {
      if (targetCities.length >= 3) {
        auth.triggerToast("最多只能选择三个目标城市！");
        setCustomCityValue("");
        return;
      }
      setTargetCities([...targetCities, trimmed]);
    }
    setCustomCityValue("");
  };

  const toggleCity = (city: string) => {
    if (errors.targetCities) setErrors(prev => ({ ...prev, targetCities: false }));
    if (targetCities.includes(city)) {
      setTargetCities(targetCities.filter((c) => c !== city));
    } else {
      if (targetCities.length >= 3) {
        auth.triggerToast("最多只能选择三个目标城市！");
        return;
      }
      setTargetCities([...targetCities, city]);
    }
  };

  const handleFinishRegister = () => {
    if (targetCities.length === 0) {
      setErrors(prev => ({ ...prev, targetCities: true }));
      auth.triggerToast("请选择至少一个目标城市！");
      return;
    }
    // Generate cropped avatar from canvas
    let finalAvatar = avatarSrc;
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext("2d");
      const img = new Image();
      
      let didSubmit = false;
      let timeoutId: NodeJS.Timeout | null = null;
      
      const doSubmit = (avatar: string) => {
        if (didSubmit) return;
        didSubmit = true;
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        saveUserData(avatar);
      };

      img.onload = () => {
        if (ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          
          // Draw circular mask clip
          ctx.beginPath();
          ctx.arc(200, 200, 200, 0, Math.PI * 2);
          ctx.clip();

          // Calculate drawing dimensions based on scale & translation offsets
          const size = 400;
          const drawWidth = size * scale;
          const drawHeight = size * scale;
          
          const ratio = 3.125;
          const drawX = (200 - drawWidth / 2) + offsetX * ratio;
          const drawY = (200 - drawHeight / 2) + offsetY * ratio;

          ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight);
          
          try {
            finalAvatar = canvas.toDataURL("image/jpeg", 0.9);
            doSubmit(finalAvatar);
          } catch (e) {
            doSubmit(avatarSrc);
          }
        } else {
          doSubmit(finalAvatar);
        }
      };
      
      // Fallback in case onload is blocked / doesn't trigger
      timeoutId = setTimeout(() => {
        doSubmit(finalAvatar);
      }, 200);

      img.src = avatarSrc;
    } else {
      saveUserData(finalAvatar);
    }
  };

  const saveUserData = async (avatarDataUrl: string) => {
    const payload = {
      account: {
        reg_method: "email",
        email: email,
        verify_code: emailVerifyCode,
        username,
        password
      },
      profile: {
        gender,
        age: parseInt(age) || 0,
        job_status: jobStatus,
        avatar_url: avatarDataUrl,
        experience_years: expYears,
        experience_months: expMonths,
        company_name: companyName,
        role_name: roleName,
        salary_min: isSalaryUnspecified ? null : salaryMin,
        salary_max: isSalaryUnspecified ? null : salaryMax,
        school,
        degree,
        has_experience: hasExp
      },
      expectations: {
        target_cities: targetCities,
        target_company: targetCompany,
        target_role: targetRole,
        target_grade: targetGrade,
        target_salary_min: isTargetSalaryUnspecified ? null : targetSalaryMin,
        target_salary_max: isTargetSalaryUnspecified ? null : targetSalaryMax
      }
    };

    try {
      const response = await fetch(`${API_BASE}/api/auth/register/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errData = await response.json();
        auth.triggerToast(errData.detail || "注册提交失败，请重试！");
        return;
      }

      const data = await response.json();
      localStorage.setItem("interviewVar_token", data.access_token);
      auth.login(data.user);
      router.push("/debugger");
    } catch (err) {
      auth.triggerToast("无法连接到后端服务！");
    }
  };

  return (
    <div className="min-h-screen bg-[#050B1A] text-[#dae2fd] font-body-md flex flex-col relative overflow-hidden select-none">
      {/* Visual background grids */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff02_1px,transparent_1px),linear-gradient(to_bottom,#ffffff02_1px,transparent_1px)] bg-[size:40px_40px] pointer-events-none z-0" />
      <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-[#AFA7FF]/4 rounded-full blur-[160px] pointer-events-none z-0" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-[#5DECCB]/3 rounded-full blur-[160px] pointer-events-none z-0" />

      {/* Hidden Canvas for Avatar Crop */}
      <canvas ref={canvasRef} width={400} height={400} className="hidden" />

      {/* HEADER SECTION */}
      <nav className="w-full z-40 bg-transparent border-b border-white/5">
        <div className="flex justify-between items-center h-20 px-gutter max-w-container-max mx-auto w-full">
          <div
            onClick={() => router.push("/")}
            className="text-2xl font-display-xl font-bold tracking-tight text-on-surface flex items-center gap-3 cursor-pointer"
          >
            <img src="/logo/logo_icon.svg" alt="面试驾到" className="w-11 h-11 object-contain" />
            面试驾到
          </div>

          <div className="flex items-center gap-4 text-sm font-bold">
            <span className="text-white/40">已有账号？</span>
            <button
              onClick={() => { auth.setShowLogin(true); router.push("/"); }}
              className="px-6 py-2 bg-white/5 border border-white/10 rounded-full text-white hover:bg-white/10 transition-all cursor-pointer"
            >
              去登录
            </button>
          </div>
        </div>
      </nav>

      {/* WORKSPACE AREA */}
      <div className="flex-1 flex max-w-container-max mx-auto w-full px-gutter py-8 gap-8 items-stretch relative z-10 min-h-[750px]">
        <div className="grid grid-cols-12 gap-8 w-full items-stretch">
          
          {/* ========================================================
              LEFT COLUMN: Slogan & Intro Panel (4 cols)
             ======================================================== */}
          <div className="col-span-12 lg:col-span-4 flex flex-col justify-between p-8 rounded-3xl border border-white/5 bg-[#060e20]/60 backdrop-blur-xl relative overflow-hidden h-full">
            <div className="absolute inset-0 bg-gradient-to-br from-[#AFA7FF]/5 to-transparent pointer-events-none" />
            
            <div className="relative z-10 space-y-8 text-left">
              <div className="space-y-4">
                <h1 className="text-3xl md:text-4xl lg:text-5xl font-black text-white leading-tight font-display-xl tracking-tight">
                  让每一次面试都成为<br />
                  下一次 <span className="text-[#AFA7FF] drop-shadow-[0_0_15px_rgba(175,167,255,0.35)]">Offer</span> 的养料
                </h1>
                <p className="text-sm md:text-base text-white/50 leading-relaxed font-bold">
                  AI 驱动的职业成长系统，分析面试、沉淀经验、模拟实战，帮你更快拿到理想 Offer。
                </p>
              </div>

              {/* Bullet Features */}
              <div className="space-y-4">
                {[
                  { icon: "analytics", title: "AI 面试分析", desc: "深度分析面试表现，定位失分点", color: "text-[#00D4FF]" },
                  { icon: "psychology", title: "职业记忆沉淀", desc: "构建专属职业知识库，持续进化", color: "text-[#AFA7FF]" },
                  { icon: "record_voice_over", title: "真实模拟面试", desc: "高阶还原面试场景，提升通过率", color: "text-[#5DECCB]" },
                  { icon: "trending_up", title: "Offer 概率预测", desc: "AI 预测通过概率，明确提升方向", color: "text-[#FF7A95]" }
                ].map((f, i) => (
                  <div key={i} className="flex gap-4.5 items-start">
                    <div className="w-11 h-11 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
                      <span className={`material-symbols-outlined text-[22px] ${f.color}`}>{f.icon}</span>
                    </div>
                    <div>
                      <h4 className="text-sm md:text-base font-black text-white">{f.title}</h4>
                      <p className="text-xs md:text-sm text-white/40 font-bold mt-0.5">{f.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ========================================================
              RIGHT COLUMN: Multi-Step Wizards Form (8 cols)
             ======================================================== */}
          <div className="col-span-12 lg:col-span-8 flex flex-col gap-6 h-full justify-between min-w-0">
            
            {/* Step Wizard Header */}
            <div className="glass-panel p-4.5 rounded-2xl border-white/5 grid grid-cols-3 gap-4 select-none shrink-0 relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-r from-white/[0.01] to-transparent pointer-events-none" />
              {[
                { s: 1, label: "账号注册", desc: "创建账号" },
                { s: 2, label: "职业背景", desc: "填写职业信息" },
                { s: 3, label: "求职目标", desc: "完善求职期望" }
              ].map((stepItem, idx) => {
                const isActive = step === stepItem.s;
                const isCompleted = step > stepItem.s;
                return (
                  <div
                    key={idx}
                    className={`flex items-center gap-3 px-3 py-1.5 rounded-xl transition-all duration-300 ${
                      isActive ? "bg-[#AFA7FF]/10 border border-[#AFA7FF]/15" : "border border-transparent"
                    }`}
                  >
                    <div
                      className={`w-9 h-9 rounded-full flex items-center justify-center font-black text-base font-mono shrink-0 transition-colors ${
                        isCompleted
                          ? "bg-[#5DECCB] text-[#050B1A]"
                          : isActive
                          ? "bg-[#AFA7FF] text-[#050B1A]"
                          : "bg-white/5 border border-white/10 text-white/40"
                      }`}
                    >
                      {isCompleted ? <span className="material-symbols-outlined text-base font-black">check</span> : stepItem.s}
                    </div>
                    <div className="text-left min-w-0 hidden md:block">
                      <span className={`text-xs md:text-sm font-black block leading-none ${isActive ? "text-white" : "text-white/40"}`}>
                        {stepItem.label}
                      </span>
                      <span className={`text-[10px] md:text-xs font-bold block mt-1 leading-none ${isActive ? "text-[#AFA7FF]" : "text-white/20"}`}>
                        {stepItem.desc}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Step Content Form Block */}
            <div className="flex-1 glass-panel p-8 rounded-3xl border-white/5 flex flex-col justify-between text-left relative overflow-hidden min-h-[580px]">
              <div className="absolute inset-0 bg-gradient-to-b from-white/[0.01] to-transparent pointer-events-none" />

              <div className="flex-1 flex flex-col relative z-10 w-full">
                <AnimatePresence mode="wait">
                  {step === 1 && (
                    <motion.div
                      key="step1"
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 10 }}
                      className="grid grid-cols-12 gap-8 items-stretch w-full flex-1"
                    >
                      {/* Left: Input Fields */}
                      <div className="col-span-12 md:col-span-7 flex flex-col justify-between space-y-4">
                        <div className="space-y-4.5 w-full">
                          <div>
                            <h2 className="text-xl md:text-2xl font-black text-white">创建账号</h2>
                            <p className="text-xs md:text-sm text-white/40 font-bold mt-1">内测版本：仅支持邮箱注册</p>
                          </div>

                          {/* Fields */}
                          <div className="space-y-4">
                            <div>
                              <label className="block text-xs md:text-sm text-white/50 mb-1.5 font-bold">
                                邮箱地址 <span className="text-[#FF7A95] ml-0.5">*</span>
                              </label>
                              <input
                                type="email"
                                placeholder="请输入邮箱地址"
                                value={email}
                                onChange={(e) => {
                                  setEmail(e.target.value);
                                  if (errors.email) setErrors(prev => ({ ...prev, email: false }));
                                }}
                                className={`w-full py-3 px-4 bg-white/5 border rounded-xl text-white placeholder-white/20 focus:outline-none text-xs md:text-sm font-semibold ${
                                  errors.email
                                    ? "border-[#FF7A95]/60 bg-[#FF7A95]/5 focus:border-[#FF7A95]"
                                    : "border-white/10 focus:border-[#AFA7FF]/40"
                                }`}
                              />
                            </div>

                            {/* Verification Code for Email */}
                            <div>
                              <label className="block text-xs md:text-sm text-white/50 mb-1.5 font-bold">
                                验证码 <span className="text-[#FF7A95] ml-0.5">*</span>
                              </label>
                              <div className="flex gap-2">
                                <input
                                  type="text"
                                  placeholder="请输入验证码"
                                  value={emailVerifyCode}
                                  onChange={(e) => {
                                    setEmailVerifyCode(e.target.value);
                                    if (errors.emailVerifyCode) setErrors(prev => ({ ...prev, emailVerifyCode: false }));
                                  }}
                                  className={`flex-1 py-3 px-4 bg-white/5 border rounded-xl text-white placeholder-white/20 focus:outline-none text-xs md:text-sm font-semibold ${
                                    errors.emailVerifyCode
                                      ? "border-[#FF7A95]/60 bg-[#FF7A95]/5 focus:border-[#FF7A95]"
                                      : "border-white/10 focus:border-[#AFA7FF]/40"
                                  }`}
                                />
                                <button
                                  type="button"
                                  onClick={handleSendCode}
                                  disabled={isSendingCode || emailTimer > 0}
                                  className={`px-5 py-3 rounded-xl border border-[#AFA7FF]/20 text-[#AFA7FF] font-black text-xs md:text-sm hover:bg-[#AFA7FF]/5 active:scale-95 transition-all select-none whitespace-nowrap cursor-pointer flex items-center justify-center gap-1.5 ${
                                    (isSendingCode || emailTimer > 0) ? "opacity-50 cursor-not-allowed" : ""
                                  }`}
                                >
                                  {isSendingCode ? (
                                      <>
                                        <svg className="animate-spin h-4 w-4 text-[#AFA7FF]" viewBox="0 0 24 24" fill="none">
                                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                        </svg>
                                        发送中
                                      </>
                                    ) : (
                                      emailTimer > 0 ? `${emailTimer}s 后重发` : "获取验证码"
                                    )}
                                  </button>
                                </div>
                                <span className="text-[10px] md:text-xs text-white/30 font-bold block mt-1">验证码将发送至您的邮箱</span>
                              </div>
                            </div>

                          {/* Account username & password */}
                          <div className="grid grid-cols-2 gap-4">
                            <div className="col-span-2">
                              <label className="block text-xs md:text-sm text-white/50 mb-1.5 font-bold">
                                用户名 <span className="text-[#FF7A95] ml-0.5">*</span>
                              </label>
                              <input
                                type="text"
                                placeholder="请设置用户名"
                                value={username}
                                onChange={(e) => {
                                  setUsername(e.target.value);
                                  if (errors.username) setErrors(prev => ({ ...prev, username: false }));
                                }}
                                className={`w-full py-3 px-4 bg-white/5 border rounded-xl text-white placeholder-white/20 focus:outline-none text-xs md:text-sm font-semibold ${
                                  errors.username 
                                    ? "border-[#FF7A95]/60 bg-[#FF7A95]/5 focus:border-[#FF7A95]" 
                                    : "border-white/10 focus:border-[#AFA7FF]/40"
                                }`}
                              />
                            </div>
                             <div className="col-span-1">
                               <label className="block text-xs md:text-sm text-white/50 mb-1.5 font-bold">
                                 密码 <span className="text-[#FF7A95] ml-0.5">*</span>
                               </label>
                               <div className="relative">
                                 <input
                                   type={showPassword ? "text" : "password"}
                                   placeholder="请设置登录密码"
                                   value={password}
                                   onChange={(e) => {
                                     setPassword(e.target.value);
                                     if (errors.password) setErrors(prev => ({ ...prev, password: false }));
                                   }}
                                   className={`w-full py-3 px-4 bg-white/5 border rounded-xl text-white placeholder-white/20 focus:outline-none pr-10 text-xs md:text-sm font-semibold ${
                                     errors.password 
                                       ? "border-[#FF7A95]/60 bg-[#FF7A95]/5 focus:border-[#FF7A95]" 
                                       : "border-white/10 focus:border-[#AFA7FF]/40"
                                   }`}
                                 />
                                 <button
                                   type="button"
                                   onClick={() => setShowPassword(!showPassword)}
                                   className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white transition-colors cursor-pointer flex items-center justify-center"
                                 >
                                   <span className="material-symbols-outlined text-sm md:text-base">
                                     {showPassword ? "visibility_off" : "visibility"}
                                   </span>
                                 </button>
                               </div>
                             </div>
                             <div className="col-span-1">
                               <label className="block text-xs md:text-sm text-white/50 mb-1.5 font-bold">
                                 确认密码 <span className="text-[#FF7A95] ml-0.5">*</span>
                               </label>
                               <div className="relative">
                                 <input
                                   type={showConfirmPassword ? "text" : "password"}
                                   placeholder="请再次输入密码"
                                   value={confirmPassword}
                                   onChange={(e) => {
                                     setConfirmPassword(e.target.value);
                                     if (errors.confirmPassword) setErrors(prev => ({ ...prev, confirmPassword: false }));
                                   }}
                                   className={`w-full py-3 px-4 bg-white/5 border rounded-xl text-white placeholder-white/20 focus:outline-none pr-10 text-xs md:text-sm font-semibold ${
                                     errors.confirmPassword 
                                       ? "border-[#FF7A95]/60 bg-[#FF7A95]/5 focus:border-[#FF7A95]" 
                                       : "border-white/10 focus:border-[#AFA7FF]/40"
                                   }`}
                                 />
                                 <button
                                   type="button"
                                   onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                   className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white transition-colors cursor-pointer flex items-center justify-center"
                                 >
                                   <span className="material-symbols-outlined text-sm md:text-base">
                                     {showConfirmPassword ? "visibility_off" : "visibility"}
                                   </span>
                                 </button>
                               </div>
                             </div>
                          </div>

                          {/* Agreement */}
                          <div className="flex items-center gap-1 select-none pt-1">
                            <input
                              type="checkbox"
                              id="agree"
                              checked={agreePolicy}
                              onChange={(e) => {
                                setAgreePolicy(e.target.checked);
                                if (errors.agreePolicy) setErrors(prev => ({ ...prev, agreePolicy: false }));
                              }}
                              className="rounded border-white/10 bg-white/5 text-[#AFA7FF] focus:ring-0 cursor-pointer"
                            />
                            <label htmlFor="agree" className={`text-[10px] md:text-xs font-bold cursor-pointer mr-0.5 transition-colors duration-200 ${errors.agreePolicy ? "text-[#FF7A95]" : "text-white/40"}`}>
                              我已阅读并同意
                            </label>
                            <span
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setShowAgreementModal(true);
                              }}
                              className="text-[10px] md:text-xs text-[#AFA7FF] hover:text-white transition-colors font-bold cursor-pointer no-underline hover:no-underline active:no-underline"
                            >
                              《用户协议》
                            </span>
                            <span className="text-[10px] md:text-xs text-white/40 font-bold">和</span>
                            <span
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setShowPrivacyModal(true);
                              }}
                              className="text-[10px] md:text-xs text-[#AFA7FF] hover:text-white transition-colors font-bold cursor-pointer no-underline hover:no-underline active:no-underline"
                            >
                              《隐私政策》
                            </span>
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="pt-6 w-full">
                          <button
                            onClick={handleNextToStep2}
                            className="w-full py-4 bg-gradient-to-r from-[#AFA7FF] to-[#c0c1ff] text-[#050B1A] !text-base rounded-xl font-black text-base md:text-sm hover:scale-[1.01] active:scale-98 transition-all cursor-pointer flex items-center justify-center gap-1.5 text-center shadow-lg shadow-[#AFA7FF]/15 group"
                          >
                            下一步：完善职业信息
                            <span className="material-symbols-outlined text-lg leading-none transform transition-transform duration-200 group-hover:translate-x-0.5 select-none">
                              arrow_forward
                            </span>
                          </button>
                          <span className="text-[10px] md:text-xs text-white/20 font-bold block text-center mt-2.5 select-none">
                            注册即表示同意，我们将严格保护您的隐私安全
                          </span>
                        </div>
                      </div>

                      {/* Right: Security & Reason card info (5 cols) */}
                      <div className="col-span-12 md:col-span-5 flex flex-col gap-4 text-xs md:text-sm font-bold text-white/60">
                        {/* 1. Privacy Guarantee */}
                        <div className="p-6 rounded-2xl bg-[#060e20]/80 border border-white/5 flex flex-col gap-3.5">
                          <h4 className="text-[#5DECCB] text-xs md:text-sm font-black uppercase tracking-wider flex items-center gap-1.5 pb-2 border-b border-white/5">
                            <span className="material-symbols-outlined text-base md:text-lg">verified_user</span>
                            信息安全与隐私保护
                          </h4>
                          <p className="text-[11px] md:text-xs leading-relaxed text-white/40">
                            为了提供更精准的面试分析、职业评估与成长建议，我们需要收集您的职业信息。
                          </p>
                          <div className="space-y-3 mt-1">
                            <div className="flex gap-2.5 items-start">
                              <span className="material-symbols-outlined text-[#AFA7FF] text-base md:text-lg shrink-0">lock</span>
                              <div>
                                <p className="text-[11px] md:text-xs text-white font-black">AI 分析脱敏处理</p>
                                <p className="text-[10px] md:text-[11px] text-white/35 font-bold mt-0.5">分析过程中自动脱敏，保护身份信息</p>
                              </div>
                            </div>
                            <div className="flex gap-2.5 items-start">
                              <span className="material-symbols-outlined text-[#AFA7FF] text-base md:text-lg shrink-0">verified</span>
                              <div>
                                <p className="text-[11px] md:text-xs text-white font-black">数据仅用于个性化服务</p>
                                <p className="text-[10px] md:text-[11px] text-white/35 font-bold mt-0.5">仅用于 AI 分析、模拟面试与职业建议</p>
                              </div>
                            </div>
                            <div className="flex gap-2.5 items-start">
                              <span className="material-symbols-outlined text-[#AFA7FF] text-base md:text-lg shrink-0">security</span>
                              <div>
                                <p className="text-[11px] md:text-xs text-white font-black">安全存储与传输</p>
                                <p className="text-[10px] md:text-[11px] text-white/35 font-bold mt-0.5">采用银行级加密技术，保障数据安全</p>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* 2. Why fill info */}
                        <div className="p-6 rounded-2xl bg-[#060e20]/80 border border-white/5 flex flex-col gap-3.5">
                          <h4 className="text-white text-xs md:text-sm font-black uppercase tracking-wider flex items-center gap-1.5">
                            <span className="material-symbols-outlined text-base md:text-lg">help_outline</span>
                            为什么要填写这些信息？
                          </h4>
                          <p className="text-[11px] md:text-xs leading-relaxed text-white/40">
                            完整的职业信息将帮助 AI 更准确地理解您的背景，提供：
                          </p>
                          <div className="space-y-3 font-bold text-[11px] md:text-xs">
                            <div className="flex items-center gap-2 text-white/80">
                              <span className="material-symbols-outlined text-[#5DECCB] text-base md:text-lg" style={{ fontVariationSettings: "'wght' 700" }}>check</span>
                              <span>更精准的面试表现分析</span>
                            </div>
                            <div className="flex items-center gap-2 text-white/80">
                              <span className="material-symbols-outlined text-[#5DECCB] text-base md:text-lg" style={{ fontVariationSettings: "'wght' 700" }}>check</span>
                              <span>更匹配的面试题库和模拟场景</span>
                            </div>
                            <div className="flex items-center gap-2 text-white/80">
                              <span className="material-symbols-outlined text-[#5DECCB] text-base md:text-lg" style={{ fontVariationSettings: "'wght' 700" }}>check</span>
                              <span>更合理的 Offer 概率预测</span>
                            </div>
                            <div className="flex items-center gap-2 text-white/80">
                              <span className="material-symbols-outlined text-[#5DECCB] text-base md:text-lg" style={{ fontVariationSettings: "'wght' 700" }}>check</span>
                              <span>更个性化的职业成长建议</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  )}

                  {step === 2 && (
                    <motion.div
                      key="step2"
                      initial={{ opacity: 0, x: 10 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -10 }}
                      className="space-y-6 w-full flex-1 flex flex-col justify-between"
                    >
                      <div className="space-y-5.5 text-left w-full">
                        <div>
                          <h2 className="text-xl font-black text-white">完善职业信息</h2>
                          <p className="text-xs text-white/40 font-bold mt-1">让 AI 更懂你，提供更精准的分析与建议</p>
                        </div>

                        {/* Avatar Drag & Crop Section */}
                        <div className="p-4 rounded-2xl bg-white/[0.01] border border-white/5 flex flex-col md:flex-row items-center gap-6 justify-between select-none">
                          
                          {/* Image crop display frame */}
                          <div 
                            onMouseDown={handleMouseDown}
                            onMouseMove={handleMouseMove}
                            onMouseUp={handleMouseUpOrLeave}
                            onMouseLeave={handleMouseUpOrLeave}
                            onTouchStart={handleTouchStart}
                            onTouchMove={handleTouchMove}
                            onTouchEnd={handleMouseUpOrLeave}
                            className="w-28 h-28 rounded-full bg-slate-900 border-2 border-white/10 overflow-hidden relative cursor-move shrink-0 flex items-center justify-center select-none"
                          >
                            <img
                              src={avatarSrc}
                              alt="Avatar Source"
                              draggable={false}
                              style={{
                                transform: `scale(${scale}) translate(${offsetX}px, ${offsetY}px)`,
                                transformOrigin: "center center",
                                maxWidth: "none",
                                width: "100%",
                                height: "100%",
                                objectFit: "cover",
                                userSelect: "none"
                              }}
                            />
                            {/* Inner circle mask overlay */}
                            <div className="absolute inset-0 rounded-full border border-white/10 pointer-events-none shadow-[0_0_0_99px_rgba(5,11,26,0.3)]" />
                          </div>

                          {/* Image controls scale slider & upload action */}
                          <div className="flex-1 text-left space-y-3.5">
                            <div className="flex justify-between items-center text-sm text-white/50 font-bold">
                              <span>头像缩放比例 (拖动图片进行位置调整)</span>
                              <span className="font-mono text-[#AFA7FF]">{Math.round(scale * 100)}%</span>
                            </div>
                            
                            <div className="flex items-center gap-4">
                              <input
                                type="range"
                                min="1"
                                max="3"
                                step="0.05"
                                value={scale}
                                onChange={(e) => setScale(parseFloat(e.target.value))}
                                className="flex-1 accent-[#AFA7FF] h-1 bg-white/5 rounded-lg appearance-none cursor-pointer"
                              />
                              <input
                                type="file"
                                ref={fileInputRef}
                                accept="image/*"
                                onChange={handleFileChange}
                                className="hidden"
                              />
                              <button
                                onClick={() => fileInputRef.current?.click()}
                                className="px-4.5 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm font-bold text-white hover:bg-white/10 transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5"
                              >
                                <span className="material-symbols-outlined text-sm">photo_library</span>选择图片
                              </button>
                            </div>
                            <span className="text-xs text-white/30 font-bold block">支持 JPG、PNG 格式，大小不超过 5MB</span>
                          </div>

                          {/* Guidelines Info */}
                          <div className="p-4 rounded-xl bg-[#060e20]/60 border border-white/5 text-xs text-white/40 space-y-1.5 font-bold shrink-0 max-w-xs text-left">
                            <p className="text-sm text-white font-black mb-1 flex items-center gap-1.5">
                              <span className="material-symbols-outlined text-sm text-[#AFA7FF]">lightbulb</span>头像建议
                            </p>
                            <p>● 使用清晰的正面照，更容易让面试官记住</p>
                            <p>● 避免过暗、过亮或模糊的照片</p>
                            <p>● 建议尺寸为 400x400 及以上，以达到最佳清晰度</p>
                          </div>
                        </div>

                        {/* Basic Info input grid */}
                        <div className="grid grid-cols-12 gap-4 text-sm text-white/60 font-semibold">
                          <div className="col-span-12 md:col-span-4 select-none">
                            <label className="block mb-1.5">
                              性别 <span className="text-[#FF7A95] ml-0.5">*</span>
                            </label>
                            <div className="flex gap-4.5 py-2.5">
                              {["male", "female", "other"].map((gOption) => {
                                const label = gOption === "male" ? "男" : gOption === "female" ? "女" : "不方便透露";
                                return (
                                  <label key={gOption} className="flex items-center gap-1.5 cursor-pointer">
                                    <input
                                      type="radio"
                                      name="gender"
                                      checked={gender === gOption}
                                      onChange={() => setGender(gOption as any)}
                                      className="border-white/10 bg-white/5 text-[#AFA7FF] focus:ring-0"
                                    />
                                    <span>{label}</span>
                                  </label>
                                );
                              })}
                            </div>
                          </div>

                          <div className="col-span-6 md:col-span-4">
                            <label className="block mb-1.5">
                              年龄 <span className="text-[#FF7A95] ml-0.5">*</span>
                            </label>
                            <input
                              type="number"
                              required
                              min="1"
                              max="120"
                              placeholder="26"
                              value={age}
                              onChange={(e) => setAge(e.target.value)}
                              className="w-full py-3 px-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/20 focus:outline-none focus:border-[#AFA7FF]/40 text-sm font-semibold"
                            />
                          </div>

                          <div className="col-span-6 md:col-span-4 select-none">
                            <label className="block mb-1.5">
                              求职状态 <span className="text-[#FF7A95] ml-0.5">*</span>
                            </label>
                            <div className="flex bg-[#050B1A] p-1.5 rounded-xl border border-white/5 font-bold text-sm select-none">
                              {[
                                { id: "active", label: "在职" },
                                { id: "resigned", label: "离职" },
                                { id: "student", label: "在校生" },
                                { id: "fresh_grad", label: "应届生" }
                              ].map((item) => (
                                <button
                                  key={item.id}
                                  type="button"
                                  onClick={() => setJobStatus(item.id as any)}
                                  className={`flex-1 py-1.5 rounded-lg text-center transition-all cursor-pointer ${
                                    jobStatus === item.id ? "bg-[#AFA7FF]/15 text-[#AFA7FF] font-black" : "text-white/40"
                                  }`}
                                >
                                  {item.label}
                                </button>
                              ))}
                            </div>
                          </div>

                          <div className="col-span-6 md:col-span-4">
                            <label className="block mb-1.5">
                              工作年限 <span className="text-[#FF7A95] ml-0.5">*</span>
                            </label>
                            <div className="flex gap-2">
                              <select
                                value={expYears}
                                onChange={(e) => setExpYears(e.target.value)}
                                className="flex-1 py-3 px-3 bg-[#060e20] border border-white/10 rounded-xl text-white focus:outline-none focus:border-[#AFA7FF]/40 text-sm font-semibold"
                              >
                                {["在校", "应届", "1年", "2年", "3年", "4年", "5年", "6年", "7年", "8年", "9年", "10年以上"].map((y) => (
                                  <option key={y} className="bg-[#0e1626] text-white">{y}</option>
                                ))}
                              </select>
                              <select
                                value={expMonths}
                                onChange={(e) => setExpMonths(e.target.value)}
                                className="flex-1 py-3 px-3 bg-[#060e20] border border-white/10 rounded-xl text-white focus:outline-none focus:border-[#AFA7FF]/40 text-sm font-semibold"
                              >
                                {["0个月", "1个月", "2个月", "3个月", "4个月", "5个月", "6个月", "7个月", "8个月", "9个月", "10个月", "11个月"].map((m) => (
                                  <option key={m} className="bg-[#0e1626] text-white">{m}</option>
                                ))}
                              </select>
                            </div>
                          </div>

                          <div className="col-span-6 md:col-span-4">
                            <label className="block mb-1.5">当前公司名称 (选填)</label>
                            <input
                              type="text"
                              placeholder="例如：字节跳动"
                              value={companyName}
                              onChange={(e) => setCompanyName(e.target.value)}
                              className="w-full py-3 px-3.5 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/20 focus:outline-none focus:border-[#AFA7FF]/40 text-sm font-semibold"
                            />
                          </div>

                          <div className="col-span-12 md:col-span-4">
                            <label className="block mb-1.5">岗位名称 (选填)</label>
                            <input
                              type="text"
                              placeholder="例如：后端开发工程师"
                              value={roleName}
                              onChange={(e) => setRoleName(e.target.value)}
                              className="w-full py-3 px-3.5 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/20 focus:outline-none focus:border-[#AFA7FF]/40 text-sm font-semibold"
                            />
                          </div>

                          <div className="col-span-12 md:col-span-6">
                            <div className="flex justify-between items-center mb-1.5 text-sm">
                              <label className="block font-bold">当前月薪范围 (选填)</label>
                              <label className="flex items-center gap-1.5 text-sm text-white/50 cursor-pointer font-semibold select-none">
                                <input
                                  type="checkbox"
                                  checked={isSalaryUnspecified}
                                  onChange={(e) => setIsSalaryUnspecified(e.target.checked)}
                                  className="rounded border-white/10 bg-white/5 text-primary focus:ring-0 w-3.5 h-3.5"
                                />
                                <span>暂不透露</span>
                              </label>
                            </div>
                            {!isSalaryUnspecified ? (
                              <>
                                <div className="flex justify-end text-sm font-mono text-[#AFA7FF] font-black mb-1">
                                  {salaryMin >= 100 ? "100K+" : salaryMax >= 100 ? `${salaryMin}K - 100K+` : `${salaryMin}K - ${salaryMax}K`}
                                </div>
                                <div className="flex items-center gap-3.5 py-1">
                                  <input
                                    type="range"
                                    min="1"
                                    max="100"
                                    value={salaryMin}
                                    onChange={(e) => setSalaryMin(Math.min(salaryMax - 2, parseInt(e.target.value)))}
                                    className="flex-1 accent-[#AFA7FF] h-1 bg-white/5 rounded-lg appearance-none cursor-pointer"
                                  />
                                  <input
                                    type="range"
                                    min="1"
                                    max="100"
                                    value={salaryMax}
                                    onChange={(e) => setSalaryMax(Math.max(salaryMin + 2, parseInt(e.target.value)))}
                                    className="flex-1 accent-[#AFA7FF] h-1 bg-white/5 rounded-lg appearance-none cursor-pointer"
                                  />
                                </div>
                              </>
                            ) : (
                              <div className="py-3 px-4 bg-white/[0.02] border border-white/5 rounded-xl text-center text-sm text-white/30 font-bold">
                                已选择暂不透露当前月薪
                              </div>
                            )}
                          </div>

                          <div className="col-span-12 md:col-span-6">
                            <label className="block mb-1.5">教育背景 (选填)</label>
                            <div className="flex gap-2">
                              <input
                                type="text"
                                placeholder="学校名称"
                                value={school}
                                onChange={(e) => setSchool(e.target.value)}
                                className="flex-1 py-3 px-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/20 focus:outline-none focus:border-[#AFA7FF]/40 text-sm font-semibold"
                              />
                              <select
                                value={degree}
                                onChange={(e) => setDegree(e.target.value)}
                                className="py-3 px-2.5 bg-[#060e20] border border-white/10 rounded-xl text-white focus:outline-none focus:border-[#AFA7FF]/40 text-sm font-semibold shrink-0"
                              >
                                {["专科", "本科", "硕士", "博士", "其他"].map((d) => (
                                  <option key={d}>{d}</option>
                                ))}
                              </select>
                            </div>
                          </div>

                          {/* Supplementary Experience Info */}
                          <div className="col-span-12 select-none flex items-center gap-12 pt-2 border-t border-white/5">
                            <div className="flex items-center gap-2">
                              <span className="block font-bold">
                                是否具备实习/项目经验? <span className="text-[#FF7A95] ml-0.5">*</span>
                              </span>
                              <div className="flex gap-4 ml-2">
                                <label className="flex items-center gap-1.5 cursor-pointer">
                                  <input
                                    type="radio"
                                    name="hasExp"
                                    checked={hasExp === true}
                                    onChange={() => setHasExp(true)}
                                    className="border-white/10 bg-white/5 text-[#AFA7FF] focus:ring-0"
                                  />
                                  <span>是</span>
                                </label>
                                <label className="flex items-center gap-1.5 cursor-pointer">
                                  <input
                                    type="radio"
                                    name="hasExp"
                                    checked={hasExp === false}
                                    onChange={() => setHasExp(false)}
                                    className="border-white/10 bg-white/5 text-[#AFA7FF] focus:ring-0"
                                  />
                                  <span>否</span>
                                </label>
                              </div>
                            </div>
                          </div>

                        </div>
                      </div>

                      {/* Actions */}
                      <div className="pt-6 border-t border-white/5 flex gap-4 w-full text-base md:text-sm font-black select-none">
                        <button
                          onClick={() => setStep(1)}
                          className="px-6 py-4 bg-white/5 border border-white/10 rounded-xl text-white hover:bg-white/10 transition-all cursor-pointer flex items-center justify-center gap-1.5 whitespace-nowrap group"
                        >
                          <span className="material-symbols-outlined text-lg leading-none transform transition-transform duration-200 group-hover:-translate-x-0.5 select-none">
                            arrow_back
                          </span>
                          上一步
                        </button>
                        <button
                          onClick={handleNextToStep3}
                          className="flex-1 py-4 bg-gradient-to-r from-[#AFA7FF] to-[#c0c1ff] text-[#050B1A] rounded-xl hover:scale-[1.01] active:scale-98 transition-all cursor-pointer flex !text-base items-center justify-center gap-1.5 text-center shadow-lg shadow-[#AFA7FF]/15 group"
                        >
                          下一步：设定求职目标
                          <span className="material-symbols-outlined text-lg leading-none transform transition-transform duration-200 group-hover:translate-x-0.5 select-none">
                            arrow_forward
                          </span>
                        </button>
                      </div>
                    </motion.div>
                  )}

                  {step === 3 && (
                    <motion.div
                      key="step3"
                      initial={{ opacity: 0, x: 10 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -10 }}
                      className="space-y-6 w-full flex-1 flex flex-col justify-between"
                    >
                      <div className="space-y-5.5 text-left w-full">
                        <div>
                          <h2 className="text-xl md:text-2xl font-black text-white">求职目标</h2>
                          <p className="text-xs md:text-sm text-white/40 font-bold mt-1">设定你的求职目标，帮助 AI 为你提供更精准的分析与建议</p>
                        </div>

                        {/* City select tags */}
                        <div className={`p-5 rounded-2xl bg-white/[0.01] border space-y-3.5 relative select-none transition-colors duration-200 ${
                          errors.targetCities 
                            ? "border-[#FF7A95]/60 bg-[#FF7A95]/5" 
                            : "border-white/5"
                        }`}>
                          <span className="block text-sm md:text-base font-bold text-white/50">
                            目标城市 <span className="text-[#FF7A95] ml-0.5">*</span> (可多选)
                          </span>
                          <div className="flex flex-wrap gap-2.5 pt-1">
                            {(() => {
                              const defaultCities = ["北京", "上海", "深圳", "杭州", "广州", "成都", "武汉", "南京"];
                              const displayCities = [...defaultCities, ...targetCities.filter((c) => !defaultCities.includes(c))];
                              return displayCities.map((city) => {
                                const active = targetCities.includes(city);
                                return (
                                  <button
                                    key={city}
                                    type="button"
                                    onClick={() => toggleCity(city)}
                                    className={`px-5 py-2.5 rounded-xl text-sm md:text-base font-black transition-all cursor-pointer border ${
                                      active
                                        ? "bg-[#AFA7FF]/15 text-[#AFA7FF] border-[#AFA7FF]/25 shadow-lg shadow-[#AFA7FF]/5"
                                        : "bg-white/5 text-white/50 border-transparent hover:bg-white/10"
                                    }`}
                                  >
                                    {city}
                                  </button>
                                );
                              });
                            })()}
                            <button
                              type="button"
                              onClick={() => setShowCustomCityInput(!showCustomCityInput)}
                              className="px-5 py-2.5 bg-white/5 text-white/30 border border-transparent rounded-xl text-sm md:text-base font-bold hover:bg-white/10 transition-all cursor-pointer flex items-center gap-1"
                            >
                              更多 <span className="material-symbols-outlined text-sm md:text-base">{showCustomCityInput ? "keyboard_arrow_up" : "keyboard_arrow_down"}</span>
                            </button>
                          </div>
                          
                          {showCustomCityInput && (
                            <div className="flex items-center gap-2.5 mt-3 animate-fade-in">
                              <div className="relative flex-1 max-w-[240px]">
                                <input
                                  type="text"
                                  placeholder=""
                                  value={customCityValue}
                                  onChange={(e) => setCustomCityValue(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      e.preventDefault();
                                      handleAddCustomCity();
                                    }
                                  }}
                                  className="w-full px-4.5 py-3 bg-white/5 border border-white/10 rounded-xl text-white focus:outline-none focus:border-[#AFA7FF]/40 text-xs md:text-sm font-semibold"
                                />
                                {customCityValue === "" && (
                                  <div className="absolute left-4.5 right-4 top-1/2 -translate-y-1/2 pointer-events-none overflow-hidden h-[20px] text-white/20 text-xs md:text-sm font-semibold flex items-center">
                                    <motion.div
                                      animate={{ x: [0, 0, -100, -100, 0] }}
                                      transition={{
                                        duration: 8,
                                        ease: "easeInOut",
                                        repeat: Infinity,
                                        times: [0, 0.2, 0.6, 0.8, 1]
                                      }}
                                      className="whitespace-nowrap"
                                    >
                                      输入自定义城市，回车/点击添加
                                    </motion.div>
                                  </div>
                                )}
                              </div>
                              <button
                                type="button"
                                onClick={handleAddCustomCity}
                                className="px-5 py-3 bg-[#AFA7FF] hover:bg-[#c0c1ff] text-[#050B1A] font-bold rounded-xl text-xs md:text-sm transition-all cursor-pointer whitespace-nowrap"
                              >
                                添加
                              </button>
                            </div>
                          )}

                          <span className="text-xs md:text-sm text-white/30 font-bold block">选择你希望发展的城市</span>
                        </div>

                        <div className="grid grid-cols-12 gap-4 text-xs md:text-sm text-white/60 font-semibold">
                          
                          {/* Target company & Quick tags */}
                          <div className="col-span-12 md:col-span-6 space-y-2">
                            <label className="block mb-1.5 text-xs md:text-sm font-bold">目标公司 (选填)</label>
                            <input
                              type="text"
                              placeholder="输入或选择目标公司"
                              value={targetCompany}
                              onChange={(e) => setTargetCompany(e.target.value)}
                              className="w-full py-3 px-3.5 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/20 focus:outline-none focus:border-[#AFA7FF]/40 text-xs md:text-sm font-semibold"
                            />
                            <div className="flex flex-wrap gap-1.5 select-none pt-0.5">
                              {["字节跳动", "阿里巴巴", "腾讯", "美团", "华为", "小米"].map((tag) => (
                                <button
                                  key={tag}
                                  type="button"
                                  onClick={() => setTargetCompany(tag)}
                                  className="px-2.5 py-1.5 bg-white/5 border border-white/5 hover:bg-white/10 rounded-md text-[10px] md:text-sm font-bold text-white/40 hover:text-white transition-all cursor-pointer"
                                >
                                  {tag}
                                </button>
                              ))}
                            </div>
                          </div>

                          {/* Target role & Quick tags */}
                          <div className="col-span-12 md:col-span-6 space-y-2">
                            <label className="block mb-1.5 text-xs md:text-sm font-bold">目标岗位 (选填)</label>
                            <input
                              type="text"
                              placeholder="输入或选择目标岗位"
                              value={targetRole}
                              onChange={(e) => setTargetRole(e.target.value)}
                              className="w-full py-3 px-3.5 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/20 focus:outline-none focus:border-[#AFA7FF]/40 text-xs md:text-sm font-semibold"
                            />
                            <div className="flex flex-wrap gap-1.5 select-none pt-0.5">
                              {["后端开发工程师", "架构师", "产品经理", "售前工程师"].map((tag) => (
                                <button
                                  key={tag}
                                  type="button"
                                  onClick={() => setTargetRole(tag)}
                                  className="px-2.5 py-1.5 bg-white/5 border border-white/5 hover:bg-white/10 rounded-md text-[10px] md:text-sm font-bold text-white/40 hover:text-white transition-all cursor-pointer"
                                >
                                  {tag}
                                </button>
                              ))}
                            </div>
                          </div>

                          {/* Target grade level */}
                          <div className="col-span-12 md:col-span-6 space-y-2">
                            <label className="block text-xs md:text-sm font-bold">目标职级 (选填)</label>
                            <input
                              type="text"
                              placeholder="输入或选择目标职级"
                              value={targetGrade}
                              onChange={(e) => setTargetGrade(e.target.value)}
                              className="w-full py-3 px-3.5 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/20 focus:outline-none focus:border-[#AFA7FF]/40 text-xs md:text-sm font-semibold"
                            />
                            <div className="flex flex-wrap gap-1.5 select-none pt-0.5">
                              {["初级", "中级", "高级", "资深", "专家", "架构师", "技术负责人"].map((tag) => (
                                <button
                                  key={tag}
                                  type="button"
                                  onClick={() => setTargetGrade(tag)}
                                  className="px-2.5 py-1.5 bg-white/5 border border-white/5 hover:bg-white/10 rounded-md text-[10px] md:text-sm font-bold text-white/40 hover:text-white transition-all cursor-pointer"
                                >
                                  {tag}
                                </button>
                              ))}
                            </div>
                            <span className="text-[10px] md:text-xs text-white/30 font-bold block mt-1">输入自定义职级，或选择上方推荐标签</span>
                          </div>

                          {/* Target salary ranges */}
                          <div className="col-span-12 md:col-span-6">
                            <div className="flex justify-between items-center mb-1.5 text-xs md:text-sm">
                              <label className="block font-bold">目标月薪范围 (选填)</label>
                              <label className="flex items-center gap-1.5 text-sm text-white/50 cursor-pointer font-semibold select-none">
                                <input
                                  type="checkbox"
                                  checked={isTargetSalaryUnspecified}
                                  onChange={(e) => setIsTargetSalaryUnspecified(e.target.checked)}
                                  className="rounded border-white/10 bg-white/5 text-primary focus:ring-0 w-3.5 h-3.5"
                                />
                                <span>暂不透露</span>
                              </label>
                            </div>
                            {!isTargetSalaryUnspecified ? (
                              <>
                                <div className="flex justify-end text-sm font-mono text-[#AFA7FF] font-black mb-1">
                                  {targetSalaryMin >= 100 ? "100K+" : targetSalaryMax >= 100 ? `${targetSalaryMin}K - 100K+` : `${targetSalaryMin}K - ${targetSalaryMax}K`}
                                </div>
                                <div className="flex items-center gap-3.5 py-1.5">
                                  <input
                                    type="range"
                                    min="1"
                                    max="100"
                                    value={targetSalaryMin}
                                    onChange={(e) => setTargetSalaryMin(Math.min(targetSalaryMax - 2, parseInt(e.target.value)))}
                                    className="flex-1 accent-[#AFA7FF] h-1 bg-white/5 rounded-lg appearance-none cursor-pointer"
                                  />
                                  <input
                                    type="range"
                                    min="1"
                                    max="100"
                                    value={targetSalaryMax}
                                    onChange={(e) => setTargetSalaryMax(Math.max(targetSalaryMin + 2, parseInt(e.target.value)))}
                                    className="flex-1 accent-[#AFA7FF] h-1 bg-white/5 rounded-lg appearance-none cursor-pointer"
                                  />
                                </div>
                              </>
                            ) : (
                              <div className="py-3 px-4 bg-white/[0.02] border border-white/5 rounded-xl text-center text-sm text-white/30 font-bold">
                                已选择暂不透露目标薪资
                              </div>
                            )}
                          </div>

                          {/* Other preferences grid */}
                          <div className="col-span-12 grid grid-cols-4 gap-3.5 border-t border-white/5 pt-4">
                            <div className="col-span-2 md:col-span-1">
                              <label className="block mb-1.5 text-sm md:text-base font-bold">行业领域</label>
                              <select
                                value={prefIndustry}
                                onChange={(e) => setPrefIndustry(e.target.value)}
                                className="w-full py-3 px-3 bg-[#060e20] border border-white/10 rounded-xl text-white focus:outline-none focus:border-[#AFA7FF]/40 text-sm font-semibold"
                              >
                                <option value="">选择领域</option>
                                <option>互联网/软件</option>
                                <option>金融科技</option>
                                <option>人工智能</option>
                                <option>新能源汽车</option>
                                <option>传统硬件</option>
                                <option>半导体/芯片</option>
                                <option>跨境电商</option>
                                <option>游戏开发</option>
                                <option>企业服务/SaaS</option>
                                <option>医疗健康</option>
                                <option>物联网/智能硬件</option>
                                <option>其他</option>
                              </select>
                            </div>
                            <div className="col-span-2 md:col-span-1">
                              <label className="block mb-1.5 text-sm md:text-base font-bold">公司规模</label>
                              <select
                                value={prefSize}
                                onChange={(e) => setPrefSize(e.target.value)}
                                className="w-full py-3 px-3 bg-[#060e20] border border-white/10 rounded-xl text-white focus:outline-none focus:border-[#AFA7FF]/40 text-sm font-semibold"
                              >
                                <option value="">选择规模</option>
                                <option>20人以下</option>
                                <option>20-99人</option>
                                <option>100-499人</option>
                                <option>500-999人</option>
                                <option>1000人以上</option>
                              </select>
                            </div>
                            <div className="col-span-2 md:col-span-1">
                              <label className="block mb-1.5 text-sm md:text-base font-bold">工作性质</label>
                              <select
                                value={prefType}
                                onChange={(e) => setPrefType(e.target.value)}
                                className="w-full py-3 px-3 bg-[#060e20] border border-white/10 rounded-xl text-white focus:outline-none focus:border-[#AFA7FF]/40 text-sm font-semibold"
                              >
                                <option value="">选择性质</option>
                                <option>全职</option>
                                <option>兼职/自由职业</option>
                                <option>实习</option>
                              </select>
                            </div>
                            <div className="col-span-2 md:col-span-1">
                              <label className="block mb-1.5 text-sm md:text-base font-bold">团队规模</label>
                              <select
                                value={prefTeam}
                                onChange={(e) => setPrefTeam(e.target.value)}
                                className="w-full py-3 px-3 bg-[#060e20] border border-white/10 rounded-xl text-white focus:outline-none focus:border-[#AFA7FF]/40 text-sm font-semibold"
                              >
                                <option value="">选择规模</option>
                                <option>3-5人小团队</option>
                                <option>5-10人标准团队</option>
                                <option>10-20人成长型</option>
                                <option>20人以上大部门</option>
                              </select>
                            </div>
                          </div>

                          <div className="col-span-12">
                            <div className="flex justify-between items-center mb-1">
                              <label className="block text-xs md:text-sm font-bold">其他说明 (选填)</label>
                              <span className="font-mono text-white/30 text-[10px] md:text-xs">{additionalDesc.length}/200</span>
                            </div>
                            <textarea
                              rows={2.5}
                              maxLength={200}
                              placeholder="可以补充您的职业偏好、技能方向、期望的工作内容等..."
                              value={additionalDesc}
                              onChange={(e) => setAdditionalDesc(e.target.value)}
                              className="w-full py-3 px-4 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/20 focus:outline-none focus:border-[#AFA7FF]/40 text-xs md:text-sm font-semibold resize-none"
                            />
                          </div>

                        </div>
                      </div>

                      {/* Actions */}
                      <div className="pt-6 border-t border-white/5 flex gap-4 w-full text-sm md:text-sm font-black select-none">
                        <button
                          onClick={() => setStep(2)}
                          className="px-6 py-4 bg-white/5 border border-white/10 rounded-xl text-white hover:bg-white/10 transition-all cursor-pointer flex items-center justify-center gap-1.5 whitespace-nowrap group"
                        >
                          <span className="material-symbols-outlined text-lg leading-none transform transition-transform duration-200 group-hover:-translate-x-0.5 select-none">
                            arrow_back
                          </span>
                          上一步
                        </button>
                        <button
                          onClick={handleFinishRegister}
                          className="flex-1 py-4 bg-gradient-to-r from-[#AFA7FF] to-[#c0c1ff] text-[#050B1A] text-base rounded-xl hover:scale-[1.01] active:scale-98 transition-all cursor-pointer flex items-center justify-center gap-1.5 text-center shadow-lg shadow-[#AFA7FF]/15 group"
                        >
                          完成，进入 面试驾到
                          <span className="material-symbols-outlined text-lg leading-none transform transition-transform duration-200 group-hover:translate-x-0.5 select-none">
                            arrow_forward
                          </span>
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

            </div>

          </div>

        </div>
      </div>

      {/* FOOTER CERTIFICATES SECTION */}
      <footer className="bg-[#060e20] border-t border-white/5 w-full block mt-8">
        <div className="max-w-container-max mx-auto px-gutter py-8 space-y-6 select-none">
          
          {/* Slogan details and guarantees */}
          <div className="flex flex-col md:flex-row justify-between items-center gap-4.5 border-b border-white/5 pb-6 text-left">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-[#AFA7FF]">
                <span className="material-symbols-outlined text-xl">shield</span>
              </div>
              <div>
                <h4 className="text-xs md:text-base font-black text-white">我们承诺您的数据安全</h4>
                <p className="text-[10px] md:text-sm text-white/40 leading-relaxed font-bold mt-0.5">
                  面试驾到 采用职业画像引擎构建个性化分析模型。您的姓名、公司、学校等敏感信息在 AI 分析过程中自动脱敏处理，<br />
                  仅保留与岗位能力相关的逻辑数据用于推理与评估，您的个人信息不会被公开展示或用于未经授权的用途。
                </p>
              </div>
            </div>

            {/* Cert badges */}
            {/* <div className="flex gap-6 items-center shrink-0">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-lg text-white/30">safety_check</span>
                <div className="text-left font-mono leading-none">
                  <span className="text-[10px] md:text-xs font-black text-white block">ISO 27001</span>
                  <span className="text-[8px] md:text-[10px] text-white/30 block mt-0.5">信息安全认证</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-lg text-white/30">gavel</span>
                <div className="text-left font-mono leading-none">
                  <span className="text-[10px] md:text-xs font-black text-white block">GDPR</span>
                  <span className="text-[8px] md:text-[10px] text-white/30 block mt-0.5">合规认证</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-lg text-white/30">lock</span>
                <div className="text-left font-mono leading-none">
                  <span className="text-[10px] md:text-xs font-black text-white block">SSL 加密</span>
                  <span className="text-[8px] md:text-[10px] text-white/30 block mt-0.5">传输保护</span>
                </div>
              </div>
            </div> */}
          </div>

          <div className="flex flex-col md:flex-row justify-between items-center gap-4 text-left">
            <span className="text-xs md:text-sm text-white/30 font-label-mono font-bold tracking-widest">
              © 2026 面试驾到. All rights reserved.
            </span>
            <div className="flex gap-8 text-xs md:text-sm text-white/30 font-label-mono font-bold tracking-widest">
              <a onClick={() => router.push("/")} className="hover:text-[#AFA7FF] transition-colors cursor-pointer">
                返回主页
              </a>
              <a className="hover:text-[#AFA7FF] transition-colors cursor-default" href="#">
                隐私政策
              </a>
              <a className="hover:text-[#AFA7FF] transition-colors cursor-default" href="#">
                服务条款
              </a>
            </div>
          </div>
        </div>
      </footer>

      {/* USER AGREEMENT MODAL */}
      <AnimatePresence>
        {showAgreementModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
            <div
              onClick={() => setShowAgreementModal(false)}
              className="absolute inset-0 bg-[#050B1A]/80 backdrop-blur-md transition-opacity duration-300"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-[#0e1626]/95 border border-white/10 rounded-3xl p-8 max-w-2xl w-full text-left relative z-10 space-y-6 shadow-2xl max-h-[80vh] flex flex-col"
            >
              <div className="flex justify-between items-center pb-3 border-b border-white/5">
                <span className="font-label-mono text-[10px] text-[#AFA7FF] tracking-widest uppercase font-bold">
                  面试驾到 User Agreement
                </span>
                <button
                  onClick={() => setShowAgreementModal(false)}
                  className="text-white/40 hover:text-white transition-colors cursor-pointer"
                >
                  <span className="material-symbols-outlined text-lg">close</span>
                </button>
              </div>

              <div className="space-y-1">
                <h3 className="font-extrabold text-white text-lg">面试驾到 用户服务协议</h3>
                <p className="text-white/45 text-xs">更新日期：2026年6月4日</p>
              </div>

              {/* Scrollable text area */}
              <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
                {renderMarkdown(agreementMarkdown)}
              </div>

              <div className="pt-4 border-t border-white/5 flex justify-end">
                <button
                  onClick={() => {
                    setAgreePolicy(true);
                    setErrors(prev => ({ ...prev, agreePolicy: false }));
                    setShowAgreementModal(false);
                  }}
                  className="px-6 py-2.5 bg-[#AFA7FF] text-[#050B1A] font-bold rounded-xl text-xs md:text-sm hover:scale-[1.02] active:scale-98 transition-all cursor-pointer flex items-center justify-center"
                >
                  已阅读并同意
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* PRIVACY POLICY MODAL */}
      <AnimatePresence>
        {showPrivacyModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
            <div
              onClick={() => setShowPrivacyModal(false)}
              className="absolute inset-0 bg-[#050B1A]/80 backdrop-blur-md transition-opacity duration-300"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-[#0e1626]/95 border border-white/10 rounded-3xl p-8 max-w-2xl w-full text-left relative z-10 space-y-6 shadow-2xl max-h-[80vh] flex flex-col"
            >
              <div className="flex justify-between items-center pb-3 border-b border-white/5">
                <span className="font-label-mono text-[10px] text-[#AFA7FF] tracking-widest uppercase font-bold">
                  面试驾到 Privacy Policy
                </span>
                <button
                  onClick={() => setShowPrivacyModal(false)}
                  className="text-white/40 hover:text-white transition-colors cursor-pointer"
                >
                  <span className="material-symbols-outlined text-lg">close</span>
                </button>
              </div>

              <div className="space-y-1">
                <h3 className="font-extrabold text-white text-lg">面试驾到 用户隐私政策</h3>
                <p className="text-white/45 text-xs">更新日期：2026年6月4日</p>
              </div>

              {/* Scrollable text area */}
              <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
                {renderMarkdown(privacyMarkdown)}
              </div>

              <div className="pt-4 border-t border-white/5 flex justify-end">
                <button
                  onClick={() => {
                    setAgreePolicy(true);
                    setErrors(prev => ({ ...prev, agreePolicy: false }));
                    setShowPrivacyModal(false);
                  }}
                  className="px-6 py-2.5 bg-[#AFA7FF] text-[#050B1A] font-bold rounded-xl text-xs md:text-sm hover:scale-[1.02] active:scale-98 transition-all cursor-pointer flex items-center justify-center"
                >
                  已阅读并同意
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
