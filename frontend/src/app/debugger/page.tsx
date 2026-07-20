"use client";

import { useState, useRef, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth, UserMenu } from "@/components/AuthProvider";
import { openLegalTerms, openLegalPrivacy, openLegalContact } from "@/components/LegalModals";
import { pollTaskUntilDone } from "@/app/utils/pollTask";
import { API_BASE } from "@/lib/api";
import { getQuotaStatus, type Feature } from "@/lib/quotaClient";

const getTodayString = () => {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

function NewAnalysisDebuggerContent() {
  const router = useRouter();
  const auth = useAuth();
  const searchParams = useSearchParams();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  // 支持 ?mode=audio|text|resume 预设默认 tab（项目记忆库空状态会传 ?mode=resume）
  const initialMode = (() => {
    const m = searchParams.get("mode");
    return m === "text" || m === "resume" ? m : "audio";
  })();
  const [activeMode, setActiveMode] = useState<"audio" | "text" | "resume">(initialMode);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [taskProgress, setTaskProgress] = useState(0);
  const [taskStep, setTaskStep] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [uploadedFileId, setUploadedFileId] = useState<number | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const [remainingCount, setRemainingCount] = useState<number | "unlimited" | null>(null);

  // 内测版本：删除 PricingModal 相关 state（付费功能屏蔽后不再需要）
  // const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  // const [upgradeHighlight, setUpgradeHighlight] = useState<"pro" | "max">("pro");
  // const openUpgradeModal = (target: "pro" | "max") => {
  //   setUpgradeHighlight(target);
  //   setShowUpgradeModal(true);
  // };
  // const closeUpgradeModal = () => setShowUpgradeModal(false);

  const checkRemainingLimit = async () => {
    // 内测版本：fallback 统一用 test 档额度（2 / 5 / 5），与 home 资源额度卡片一致。
    // 实际限制在后端，前端只是友好提示。
    const TEST_QUOTA: Record<string, number> = { audio: 2, record: 5, resume: 5 };

    // ── 未登录用户：仅本地占位（实际限制在后端，前端只是友好提示） ──
    if (!auth.isLoggedIn) {
      const hasAnalyzedKey = `interviewVar_analyzed_${activeMode}`;
      const feature = activeMode === "text" ? "record" : activeMode;
      const featureMax = TEST_QUOTA[feature] ?? 1;
      if (localStorage.getItem(hasAnalyzedKey) === "true") {
        setRemainingCount(0);
      } else {
        setRemainingCount(featureMax);
      }
      return;
    }

    // ── 登录用户：走后端 /api/audio/quota/status 的真实配额 ──
    // 替代旧的 /api/audio/check_limit（那接口只回答"非会员是否还能免费 1 次"），
    // 新接口按 audio/record/resume 三个维度返回 {used, max, remaining}。
    // 注意 activeMode 取值与 quota feature 的映射：
    //   "audio" / "text" → audio / record   "resume" → resume
    const featureMap: Record<string, Feature> = {
      audio: "audio",
      text: "record",
      resume: "resume",
    };
    const feature: Feature = featureMap[activeMode] ?? "audio";
    const status = await getQuotaStatus();
    if (!status) {
      // 接口失败时按 test 档额度兜底，避免误显示为 FREE 1 次
      setRemainingCount(TEST_QUOTA[feature] ?? 1);
      return;
    }
    if (status.membership === "max") {
      setRemainingCount("unlimited");
      return;
    }
    setRemainingCount(status[feature]?.remaining ?? 0);
  };

  useEffect(() => {
    checkRemainingLimit();
  }, [activeMode, auth.isLoggedIn, auth.user?.membership]);

  // Audio/Dialogue context fields - ALL TEXT INPUTS except onJob and date (Defaulted to empty)
  const [audioForm, setAudioForm] = useState({
    isOnJob: "yes",
    years: "",
    company: "",
    role: "",
    round: "",
    date: "",
    grade: "",
    salary: "",
    jobDescription: ""
  });

  useEffect(() => {
    setAudioForm(prev => ({
      ...prev,
      date: getTodayString()
    }));
  }, []);

  // Resume context fields - ALL TEXT INPUTS except onJob (Defaulted to empty)
  const [resumeForm, setResumeForm] = useState({
    isOnJob: "yes",
    years: "",
    prevCompany: "",
    prevRole: "",
    prevYears: "",
    prevSalary: "",
    targetCompany: "",
    targetRole: "",
    targetGrade: "",
    targetSalary: ""
  });

  // Paste Text dialogues
  const [pasteText, setPasteText] = useState("");

  const handleUploadClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const validateAndSetFile = async (file: File) => {
    // Validate formats
    if (activeMode === "audio") {
      const ext = file.name.split('.').pop()?.toLowerCase();
      if (ext !== "wav" && ext !== "mp3") {
        auth.triggerToast("上传失败：录音仅支持 WAV 或 MP3 格式！");
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
        return false;
      }
    } else if (activeMode === "resume") {
      const ext = file.name.split('.').pop()?.toLowerCase();
      if (ext !== "pdf" && ext !== "docx") {
        auth.triggerToast("上传失败：简历仅支持 PDF 或 DOCX 格式！");
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
        return false;
      }
    }

    const maxLimit = activeMode === "resume" ? 5 * 1024 * 1024 : 50 * 1024 * 1024;
    if (file.size > maxLimit) {
      auth.triggerToast(
        activeMode === "audio"
          ? "上传失败：录音文件大小不能超过 50MB！"
          : "上传失败：简历文件大小不能超过 5MB！"
      );
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      return false;
    }

    setIsUploading(true);
    const formData = new FormData();
    formData.append("file", file);
    formData.append("file_type", activeMode);

    const token = localStorage.getItem("interviewVar_token");
    const headers: Record<string, string> = {};
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    try {
      const res = await fetch(`${API_BASE}/api/file/upload`, {
        method: "POST",
        headers,
        body: formData
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "上传失败");
      }

      const data = await res.json();
      setUploadedFileId(data.file_id);
      setSelectedFile(file);
      localStorage.setItem("interviewVar_session_audio_url", data.file_url);
      auth.triggerToast("文件已成功上传！");
    } catch (e: any) {
      auth.triggerToast(e.message || "文件上传失败，请重试！");
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      setSelectedFile(null);
      setUploadedFileId(null);
    } finally {
      setIsUploading(false);
    }
    return true;
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      validateAndSetFile(e.target.files[0]);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      validateAndSetFile(file);
    }
  };

  const handleRemoveFile = async (e: React.MouseEvent) => {
    e.stopPropagation();

    if (uploadedFileId) {
      setIsDeleting(true);
      const token = localStorage.getItem("interviewVar_token");
      const headers: Record<string, string> = {};
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      try {
        const res = await fetch(`${API_BASE}/api/file/delete?file_id=${uploadedFileId}`, {
          method: "DELETE",
          headers
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.detail || "删除失败");
        }
        auth.triggerToast("文件已删除！");
      } catch (e: any) {
        auth.triggerToast(e.message || "文件删除失败！");
      } finally {
        setIsDeleting(false);
      }
    }

    setSelectedFile(null);
    setUploadedFileId(null);
    localStorage.removeItem("interviewVar_session_audio_url");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleInterceptAction = () => {
    auth.setShowLogin(true);
  };

  // Pre-load templates
  const loadFailTemplate = () => {
    setPasteText(
      `面试官：请介绍一下你上一个项目的技术架构。\n` +
      `我：项目是分布式的，使用了Redis和Kafka进行微服务解耦。\n` +
      `面试官：为什么在这里选择使用分布式锁？高并发下一致性怎么保证？\n` +
      `我：嗯...我们采用了分布式缓存，然后通过一种补偿机制来确保失败重试。`
    );
  };

  // Launch analysis and save context to localStorage
  const triggerAnalysis = async () => {
    // ── CHECK: Limit free users/guests to 1 analysis per type ──
    const hasAnalyzedKey = `interviewVar_analyzed_${activeMode}`;
    if (!auth.isLoggedIn) {
      if (localStorage.getItem(hasAnalyzedKey) === "true") {
        auth.triggerToast("您的该项分析免费体验次数已达上限，请注册账号并升级至 PRO 会员解锁更多分析！");
        return;
      }
    } else {
      // ── 登录用户：走后端 /api/audio/quota/status 的真实配额 ──
      // 替代旧的 /api/audio/check_limit（只覆盖 audio 维度）。
      // 新逻辑按 activeMode 区分 audio / record / resume，匹配后端配额。
      const featureMap: Record<string, Feature> = {
        audio: "audio",
        text: "record",
        resume: "resume",
      };
      const feature: Feature = featureMap[activeMode] ?? "audio";
      try {
        const status = await getQuotaStatus();
        if (!status) {
          auth.triggerToast("无法连接服务器校验体验次数，请稍后再试！");
          return;
        }
        // 内测版本：test 与 free 都走"一次性永久累计"分支；只有 pro / max 走 30 天滚动窗口
        const isPaid = status.membership === "pro" || status.membership === "max";
        if (!isPaid && status[feature].remaining <= 0) {
          const featureLabel =
            feature === "audio" ? "面试录音分析" :
            feature === "record" ? "面试记录分析" : "简历分析";
          const isTestUser = status.membership === "test";
          const detail = isTestUser
            ? `您的内测${featureLabel}额度已用完（一次性），内测期间无重置，敬请期待正式版！`
            : `您已使用过${featureLabel}的免费体验（永久 1 次），请升级至 PRO 会员解锁更多！`;
          auth.triggerToast(detail);
          return;
        }
      } catch (err) {
        auth.triggerToast("无法连接服务器校验体验次数，请稍后再试！");
        return;
      }
    }

    if (activeMode !== "text") {
      if (isUploading) {
        auth.triggerToast("文件正在上传中，请稍后...");
        return;
      }
      if (!selectedFile || !uploadedFileId) {
        auth.triggerToast(
          activeMode === "audio"
            ? "请先上传面试录音文件！"
            : "请先上传个人简历文档！"
        );
        return;
      }
    } else {
      if (!pasteText.trim()) {
        auth.triggerToast("请先输入或粘贴面试对话内容！");
        return;
      }
    }

    // Form validation checks for required fields when form is shown (activeMode !== "resume")
    if (activeMode !== "resume") {
      if (!audioForm.company.trim()) {
        auth.triggerToast("请填写面试公司名称！");
        return;
      }
      if (!audioForm.role.trim()) {
        auth.triggerToast("请填写岗位名称！");
        return;
      }
      if (!audioForm.date.trim()) {
        auth.triggerToast("请选择面试时间！");
        return;
      }
      if (!audioForm.round.trim()) {
        auth.triggerToast("请填写面试轮次！");
        return;
      }
    }

    setIsAnalyzing(true);

    // Save form meta to localStorage so result pages can read them
    localStorage.setItem("interviewVar_report_mode", activeMode);
    localStorage.setItem("interviewVar_session_company", audioForm.company || "字节跳动");
    localStorage.setItem("interviewVar_session_role", audioForm.role || "后端开发工程师");
    localStorage.setItem("interviewVar_session_years", "3-5年");
    localStorage.setItem("interviewVar_session_round", audioForm.round || "二面 - 技术面");
    localStorage.setItem("interviewVar_session_date", audioForm.date || getTodayString());
    localStorage.setItem("interviewVar_session_grade", audioForm.grade || "");
    localStorage.setItem("interviewVar_session_salary", audioForm.salary || "");
    localStorage.setItem("interviewVar_session_jobDescription", audioForm.jobDescription || "");
    localStorage.setItem("interviewVar_viewing_session", "true");

    if (activeMode === "audio") {
      // ── AUDIO MODE: create session → start analysis → poll → navigate ──
      const token = localStorage.getItem("interviewVar_token");
      const authHeaders: Record<string, string> = { "Content-Type": "application/json" };
      if (token) authHeaders["Authorization"] = `Bearer ${token}`;

      const audioUrl = localStorage.getItem("interviewVar_session_audio_url") || "";
      // title 仅为后端展示，不参与结构化数据传递（结构化字段走独立列）

      try {
        // Step 1: Create InterviewSession from the already-uploaded COS file
        const sessionRes = await fetch(`${API_BASE}/api/audio/create_session`, {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            file_url: audioUrl,
            file_id: uploadedFileId,
            file_size: selectedFile?.size || 0,
            job_description: audioForm.jobDescription,
            // 结构化元数据走独立字段，title 字段不参与
            company: audioForm.company,
            role: audioForm.role,
            round: audioForm.round,
            date: audioForm.date,
            grade: audioForm.grade,
            salary: audioForm.salary,
          })
        });
        if (!sessionRes.ok) {
          const err = await sessionRes.json();
          throw new Error(err.detail || "创建分析会话失败");
        }
        const sessionData = await sessionRes.json();
        const sessionId: number = sessionData.session_id;
        localStorage.setItem("interviewVar_session_id", String(sessionId));

        // Mark as analyzed for free users/guests
        localStorage.setItem("interviewVar_analyzed_audio", "true");

        // Step 2: Trigger background analysis task
        const analyzeRes = await fetch(`${API_BASE}/api/audio/analyze`, {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ session_id: sessionId })
        });
        if (!analyzeRes.ok) {
          const err = await analyzeRes.json();
          throw new Error(err.detail || "启动分析任务失败");
        }
        const analyzeData = await analyzeRes.json();
        const taskId: string = analyzeData.task_id;
        localStorage.setItem("interviewVar_task_id", taskId);

        // Step 3: Poll on THIS page until analysis completes, THEN navigate
        const STEPS = [
          "ASR 转写中——提取音频文字...",
          "语义分段——判定说话人角色...",
          "LLM 评估——对比用户画像与答题...",
          "AI 话术重构——生成升级建议...",
          "分析完成 — 正在生成报告..."
        ];
        await pollTaskUntilDone(taskId, {
          intervalMs: 2000,
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          onProgress: (pollData) => {
            const pct = pollData.progress ?? 0;
            setTaskProgress(pct);
            const si = Math.min(Math.floor((pct / 100) * STEPS.length), STEPS.length - 1);
            setTaskStep(STEPS[si]);
          },
        });

        // Step 4: Navigate to voice analysis report page (data is ready)
        await checkRemainingLimit();
        router.push("/debugger/voice");

      } catch (e: any) {
        auth.triggerToast(e.message || "启动分析失败，请重试！");
        setIsAnalyzing(false);
      }

    } else if (activeMode === "text") {
      // Text mode: create session -> start analysis -> poll -> navigate
      const token = localStorage.getItem("interviewVar_token");
      const authHeaders: Record<string, string> = { "Content-Type": "application/json" };
      if (token) authHeaders["Authorization"] = `Bearer ${token}`;

      // title 仅为后端展示，不参与结构化数据传递

      try {
        setTaskStep("正在创建分析会话...");
        setTaskProgress(10);
        // Step 1: Create InterviewSession from the pasted text
        const sessionRes = await fetch(`${API_BASE}/api/audio/create_record_session`, {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            paste_text: pasteText,
            company: audioForm.company,
            role: audioForm.role,
            round: audioForm.round,
            date: audioForm.date,
            grade: audioForm.grade,
            salary: audioForm.salary,
            job_description: audioForm.jobDescription
          })
        });
        if (!sessionRes.ok) {
          const err = await sessionRes.json();
          throw new Error(err.detail || "创建分析会话失败");
        }
        const sessionData = await sessionRes.json();
        const sessionId: number = sessionData.session_id;
        localStorage.setItem("interviewVar_session_id", String(sessionId));

        // Mark as analyzed
        localStorage.setItem("interviewVar_analyzed_text", "true");

        // Step 2: Trigger background analysis task
        setTaskStep("正在发起智能评测分析...");
        setTaskProgress(30);
        const analyzeRes = await fetch(`${API_BASE}/api/audio/analyze`, {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ session_id: sessionId })
        });
        if (!analyzeRes.ok) {
          const err = await analyzeRes.json();
          throw new Error(err.detail || "启动分析任务失败");
        }
        const analyzeData = await analyzeRes.json();
        const taskId: string = analyzeData.task_id;
        localStorage.setItem("interviewVar_task_id", taskId);

        const TEXT_STEPS = [
          "文本解析中——载入对白记录...",
          "语义分段——分析段落话题...",
          "LLM 评估——匹配岗位 JD 与对白...",
          "AI 话术重构——生成升级建议...",
          "分析完成 — 正在生成报告..."
        ];

        // Step 3: Poll progress until done — shared helper aborts the in-flight
        // fetch on terminal status so no extra polls land after success.
        await pollTaskUntilDone(taskId, {
          intervalMs: 2000,
          onProgress: (pollData) => {
            // map 0-100% database progress to step labels
            const pct = pollData.progress || 0;
            setTaskProgress(pct);

            const si = Math.min(Math.floor((pct / 100) * TEXT_STEPS.length), TEXT_STEPS.length - 1);
            setTaskStep(TEXT_STEPS[si]);
          },
        });

        // Step 4: Navigate to record report page — pass sessionId in URL so the
        // target page reads from URL truth (avoids the localStorage handoff
        // race that exists when sessionId lives only in storage).
        await checkRemainingLimit();
        router.push(`/debugger/record?sessionId=${sessionId}`);

      } catch (e: any) {
        auth.triggerToast(e.message || "启动分析失败，请重试！");
        setIsAnalyzing(false);
      }
    } else {
      // Resume mode
      if (!uploadedFileId) {
        auth.triggerToast("请先选择并上传您的简历文件！");
        return;
      }
      setIsAnalyzing(true);
      setTaskStep("正在提取简历文字，校验排版格式...");
      setTaskProgress(15);

      const token = localStorage.getItem("interviewVar_token");
      const authHeaders: Record<string, string> = { "Content-Type": "application/json" };
      if (token) authHeaders["Authorization"] = `Bearer ${token}`;

      let progress = 15;
      const progressSteps = [
        { limit: 40, step: "正在深度解析简历结构与技术栈...", rate: 0.5 },
        { limit: 65, step: "正在对比目标岗位画像，评估匹配契合度...", rate: 0.3 },
        { limit: 85, step: "正在实施大厂 STAR 原则，深度优化工作经历...", rate: 0.15 },
        { limit: 95, step: "正在诊断简历雷区与 ATS 机器人可读性...", rate: 0.05 }
      ];
      
      let currentStepIdx = 0;
      const progressInterval = setInterval(() => {
        if (progress < 95) {
          const currentStep = progressSteps[currentStepIdx];
          progress += currentStep.rate;
          setTaskProgress(Math.floor(progress));
          setTaskStep(currentStep.step);
          
          if (progress >= currentStep.limit && currentStepIdx < progressSteps.length - 1) {
            currentStepIdx++;
          }
        }
      }, 1000);

      try {
        const analyzeRes = await fetch(`${API_BASE}/api/resume/analyze`, {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ file_id: uploadedFileId })
        });

        clearInterval(progressInterval);

        if (!analyzeRes.ok) {
          const err = await analyzeRes.json();
          throw new Error(err.detail || "简历深度诊断失败");
        }

        setTaskProgress(98);
        setTaskStep("完成分析 — 正在生成高维诊断报告...");
        const analysisData = await analyzeRes.json();

        // Cache the analysis data to localStorage
        localStorage.setItem("interviewVar_resume_analysis_result", JSON.stringify(analysisData));
        localStorage.setItem("interviewVar_analyzed_resume", "true");
        await checkRemainingLimit();
        setTaskProgress(100);

        // 跳转带上 id，方便后续从历史列表/分享链接重新进入同一份报告
        const target = analysisData?.id
          ? `/debugger/resume?id=${analysisData.id}`
          : "/debugger/resume";
        router.push(target);
      } catch (e: any) {
        clearInterval(progressInterval);
        auth.triggerToast(e.message || "分析简历失败，请重试！");
        setIsAnalyzing(false);
      }
    }
  };

  return (
    <main className="pt-20 bg-background text-on-surface min-h-screen flex flex-col justify-between relative overflow-hidden pb-4">
      {/* Absolute Ambient Halo */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[800px] h-[800px] bg-primary/5 rounded-full blur-[140px] -z-10 pointer-events-none"></div>

      {/* Top Header Navbar */}
      <nav className="fixed top-0 w-full z-40 bg-surface/80 backdrop-blur-xl border-b border-white/10">
        <div className="flex justify-between items-center h-20 px-gutter max-w-container-max mx-auto w-full relative">
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
            面试VAR
          </div>

          <div className="absolute left-1/2 -translate-x-1/2 hidden md:flex items-center gap-8">
            <a onClick={() => router.push("/debugger")} className="text-primary transition-colors text-[16px] md:text-[17px] font-extrabold cursor-pointer relative after:content-[''] after:absolute after:bottom-[-26px] after:left-0 after:right-0 after:h-[2px] after:bg-primary">
              面试调试器
            </a>
            <a onClick={() => router.push("/memory")} className="text-on-surface-variant hover:text-on-surface transition-colors text-[16px] md:text-[17px] font-extrabold cursor-pointer">
              职业记忆看板
            </a>
            <a onClick={() => router.push("/training")} className="text-on-surface-variant hover:text-on-surface transition-colors text-[16px] md:text-[17px] font-extrabold cursor-pointer">
              面试训练场
            </a>
            <a onClick={() => router.push("/home")} className="text-on-surface-variant hover:text-on-surface transition-colors text-[16px] md:text-[17px] font-extrabold cursor-pointer">
              职业驾驶舱
            </a>
            <a onClick={() => window.open("/guide", "_blank")} className="text-on-surface-variant hover:text-on-surface transition-colors text-[16px] md:text-[17px] font-extrabold cursor-pointer">
              面试指南
            </a>
            <a onClick={() => router.push("/feedback")} className="text-on-surface-variant hover:text-on-surface transition-colors text-[16px] md:text-[17px] font-extrabold cursor-pointer">
              体验反馈中心
            </a>
          </div>

          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push("/memory?tab=timeline")}
              className="px-4.5 py-2 bg-white/5 border border-white/10 rounded-full text-sm font-bold text-on-surface hover:bg-white/10 transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <span className="material-symbols-outlined text-base">history</span>历史记录
            </button>
            {auth.isLoggedIn ? (
              <UserMenu />
            ) : (
              <>
                <button
                  onClick={handleInterceptAction}
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

      {/* Main Workspace Frame */}
      <div className="flex-1 max-w-container-max mx-auto w-full px-gutter py-8 grid md:grid-cols-12 gap-6 items-stretch relative z-10">
        
        {/* COLUMN 1: SIDE SWITCHER */}
        <div className="md:col-span-3 flex flex-col justify-between space-y-6">
          <div className="p-6 rounded-3xl bg-surface-container-low border border-white/5 flex flex-col justify-between h-full space-y-6">
            
            <div className="space-y-6">
              <div className="pb-4 border-b border-white/5 text-left">
                <h3 className="font-black text-white text-lg md:text-xl">新建分析</h3>
              </div>

              {/* 分析类型 Switcher (Multi-color vibrant icons scheme) */}
              <div className="space-y-3 text-left">
                <h4 className="text-xs md:text-sm text-on-surface-variant/40 font-label-mono uppercase tracking-widest font-extrabold mb-3">
                  分析类型
                </h4>
                {[
                  { mode: "audio", icon: "graphic_eq", title: "面试录音分析", desc: "上传音频，AI转写并分析表达与逻辑", color: "primary" },
                  { mode: "text", icon: "edit_document", title: "面试记录分析", desc: "粘贴面试对话，AI分析问题与漏洞", color: "secondary" },
                  { mode: "resume", icon: "description", title: "简历深度分析", desc: "上传简历，AI诊断并优化简历内容", color: "tertiary" }
                ].map((item, idx) => {
                  const isActive = activeMode === item.mode;
                  const activeBorderClass = 
                    item.color === "primary" ? "border-primary bg-primary/10 shadow-[0_0_15px_rgba(192,193,255,0.08)]" : 
                    item.color === "secondary" ? "border-secondary bg-secondary/10 shadow-[0_0_15px_rgba(255,178,183,0.08)]" : 
                    "border-tertiary bg-tertiary/10 shadow-[0_0_15px_rgba(78,222,163,0.08)]";

                  const activeIconBgClass = 
                    item.color === "primary" ? "bg-primary text-on-primary" : 
                    item.color === "secondary" ? "bg-secondary text-on-secondary" : 
                    "bg-tertiary text-on-tertiary";

                  const activeIconColor = 
                    item.color === "primary" ? "text-primary" : 
                    item.color === "secondary" ? "text-secondary" : 
                    "text-tertiary";

                  return (
                    <div
                      key={idx}
                      onClick={async () => {
                        if (uploadedFileId) {
                          // Silently delete in background to avoid orphan file
                          const token = localStorage.getItem("interviewVar_token");
                          const headers: Record<string, string> = {};
                          if (token) headers["Authorization"] = `Bearer ${token}`;
                          fetch(`${API_BASE}/api/file/delete?file_id=${uploadedFileId}`, {
                            method: "DELETE",
                            headers
                          }).catch(() => {});
                        }
                        setActiveMode(item.mode as any);
                        setSelectedFile(null);
                        setUploadedFileId(null);
                        localStorage.removeItem("interviewVar_session_audio_url");
                        if (fileInputRef.current) {
                          fileInputRef.current.value = "";
                        }
                      }}
                      className={`p-4 rounded-2xl border text-left cursor-pointer transition-all duration-300 flex items-center gap-3.5 relative overflow-hidden group ${
                        isActive ? activeBorderClass : "border-white/5 bg-white/[0.02] hover:bg-white/5"
                      }`}
                    >
                      <div
                        className={`w-11 h-11 rounded-xl flex items-center justify-center transition-colors flex-shrink-0 ${
                          isActive ? activeIconBgClass : `bg-white/5 ${activeIconColor}`
                        }`}
                      >
                        <span className="material-symbols-outlined text-xl">{item.icon}</span>
                      </div>
                      <div>
                        <h5 className="font-extrabold text-sm md:text-base text-white">{item.title}</h5>
                        <p className="text-xs text-on-surface-variant/60 mt-1 font-medium leading-relaxed">{item.desc}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* (Bottom-left PRO Upgrade banner removed as requested) */}

          </div>
        </div>

        {/* COLUMNS 4-12: PRE-ANALYSIS FORMS CANVAS */}
        <div className="md:col-span-9 flex flex-col justify-between">
          <div className="glass-panel p-8 rounded-3xl border-white/10 h-full flex flex-col justify-between text-left relative overflow-hidden">
            {/* Full-screen analysis overlay — blocks UI while analysis runs */}
            {isAnalyzing && (
              <div className="absolute inset-0 z-50 bg-background/95 backdrop-blur-xl flex flex-col justify-center items-center gap-6 px-8">
                {/* Dual-ring spinner */}
                <div className="relative w-16 h-16">
                  <div className="absolute inset-0 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
                  <div className="absolute inset-2 rounded-full border-4 border-[#5DECCB]/10 border-t-[#5DECCB] animate-spin" style={{ animationDirection: "reverse", animationDuration: "1.1s" }} />
                </div>

                <div className="text-center space-y-3">
                  <h3 className="font-black text-white text-2xl md:text-3xl animate-pulse tracking-wide">
                    {taskStep || "面试VAR AI 正在分析中..."}
                  </h3>
                  <p className="text-base md:text-lg text-white/70 font-semibold">
                    {activeMode === "resume"
                      ? "PDF/DOCX 文本提取 + DeepSeek 智能评估，分析完成后自动进入报告"
                      : activeMode === "text"
                      ? "文本诊断 + DeepSeek 智能评估，分析完成后自动进入报告"
                      : "ASR 语音识别 + DeepSeek 智能评估，分析完成后自动进入报告"}
                  </p>
                </div>

                {/* Progress bar */}
                <div className="w-full max-w-sm bg-white/5 rounded-full h-1.5 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-primary to-[#5DECCB] transition-all duration-700"
                    style={{ width: `${taskProgress}%` }}
                  />
                </div>
                <p className="text-[#5DECCB] text-2xl md:text-3xl font-black font-mono tracking-wider drop-shadow-[0_0_10px_rgba(93,236,203,0.5)] mt-2">{taskProgress}%</p>
              </div>
            )}

            <div className="space-y-6">
              {/* Header section */}
              <div className="flex justify-between items-center pb-4 border-b border-white/5">
                <div>
                  <span className="text-[10px] font-label-mono tracking-widest text-primary font-bold uppercase">
                    New Analysis Panel
                  </span>
                  <h2 className="text-2xl font-black text-white mt-1">
                    {activeMode === "audio"
                      ? "面试录音深度分析"
                      : activeMode === "text"
                      ? "面试记录深度分析"
                      : "简历风险雷区深度检测"}
                  </h2>
                </div>

                {remainingCount !== null && (
                  <div className={`px-3.5 py-1.5 rounded font-label-mono text-sm font-bold uppercase transition-all duration-300 ${
                    remainingCount === "unlimited"
                      ? "bg-tertiary/10 border border-tertiary/20 text-tertiary"
                      : remainingCount === 0
                      ? "bg-secondary/10 border border-secondary/20 text-secondary"
                      : "bg-primary/10 border border-primary/20 text-primary animate-pulse"
                  }`}>
                    {remainingCount === "unlimited"
                      ? "MAX会员：无限体验"
                      : auth.user?.membership === "pro"
                      ? `PRO会员 · 剩余体验：${remainingCount}次`
                      : auth.user?.membership === "test"
                      ? `内测档 · 剩余体验：${remainingCount}次`
                      : `免费体验剩余：${remainingCount}次`}
                  </div>
                )}
              </div>

              {/* Upload drag drop areas */}
              {activeMode !== "text" ? (
                <div
                  onClick={selectedFile ? undefined : handleUploadClick}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  className={`border-2 border-dashed py-20 md:py-28 rounded-2xl flex flex-col items-center justify-center text-center transition-all duration-300 min-h-[380px] group relative ${
                    selectedFile ? "cursor-default" : "cursor-pointer"
                  } ${
                    isDragging
                      ? "border-primary bg-primary/10 scale-[1.01] shadow-[0_0_25px_rgba(192,193,255,0.1)]"
                      : "border-white/10 hover:border-primary/50 hover:bg-white/[0.01]"
                  }`}
                >
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileChange}
                    accept={activeMode === "audio" ? ".wav,.mp3" : ".pdf,.docx"}
                    className="hidden"
                  />
                  {isUploading ? (
                    <div className="flex flex-col items-center justify-center space-y-4">
                      <div className="w-16 h-16 rounded-full border-4 border-primary/20 border-t-primary animate-spin mb-4" />
                      <h4 className="font-extrabold text-white text-base animate-pulse">文件上传中...</h4>
                    </div>
                  ) : isDeleting ? (
                    <div className="flex flex-col items-center justify-center space-y-4">
                      <div className="w-16 h-16 rounded-full border-4 border-red-500/20 border-t-red-500 animate-spin mb-4" />
                      <h4 className="font-extrabold text-white text-base animate-pulse">正在删除文件...</h4>
                    </div>
                  ) : selectedFile ? (
                    <div className="flex flex-col items-center justify-center space-y-4">
                      <div className="w-24 h-24 rounded-3xl bg-primary/10 text-primary flex items-center justify-center relative group/icon mb-2 transition-all">
                        <span className="material-symbols-outlined" style={{ fontSize: "56px" }}>
                          {activeMode === "audio" ? "library_music" : "description"}
                        </span>
                        {/* Always visible close button */}
                        <button
                          onClick={handleRemoveFile}
                          className="absolute -top-2 -right-2 w-7 h-7 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center transition-all shadow-md cursor-pointer z-10"
                          title="删除文件"
                        >
                          <span className="material-symbols-outlined text-[16px] font-black">close</span>
                        </button>
                      </div>
                      <div>
                        <h4 className="font-extrabold text-white text-base md:text-lg mb-1 max-w-md truncate">
                          已选择: {selectedFile.name}
                        </h4>
                        <p className="text-xs text-on-surface-variant/60 font-mono font-semibold">
                          大小: {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB
                        </p>
                      </div>
                      <div className="flex items-center gap-3 mt-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleUploadClick();
                          }}
                          className="px-4.5 py-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-xs font-bold text-white transition-all flex items-center gap-1.5 cursor-pointer"
                        >
                          <span className="material-symbols-outlined text-sm">cloud_upload</span>
                          选择其他文件
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="w-24 h-24 rounded-3xl bg-primary/10 group-hover:scale-110 transition-transform text-primary flex items-center justify-center mb-6">
                        <span className="material-symbols-outlined" style={{ fontSize: "56px" }}>
                          {activeMode === "audio" ? "cloud_upload" : "folder_zip"}
                        </span>
                      </div>
                      <h4 className="font-extrabold text-white text-base md:text-lg mb-2">
                        {activeMode === "audio" ? "拖拽录音文件到此处，或点击浏览上传" : "拖拽简历文档到此处，或点击浏览上传"}
                      </h4>
                      <p className="text-xs md:text-sm text-on-surface-variant/60">
                        {activeMode === "audio" ? "支持 wav, mp3 格式，最大 50MB (时长限30分钟)" : "支持 PDF, DOCX 格式，最大 5MB"}
                      </p>
                    </>
                  )}
                </div>
              ) : (
                /* paste transcript area */
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <label className="text-xs text-on-surface-variant/80 font-bold">
                      请在下方输入框粘贴或填写您的真实面试对话日志：
                    </label>
                    <button
                      onClick={loadFailTemplate}
                      className="text-xs text-primary font-bold cursor-pointer flex items-center gap-1"
                    >
                      <span className="material-symbols-outlined text-xs">bolt</span>载入经典失败分析模板
                    </button>
                  </div>
                  <textarea
                    value={pasteText}
                    onChange={(e) => setPasteText(e.target.value)}
                    placeholder="面试官：请问你们的系统是怎么做微服务架构解耦的？&#10;我：就是简单用了一个消息队列，人工对账补数据..."
                    className="w-full h-56 bg-surface-container-low border border-white/5 rounded-2xl p-4 font-mono text-sm text-on-surface focus:outline-none focus:border-primary/40 transition-all leading-relaxed min-h-[220px]"
                  />
                </div>
              )}

              {/* Pre-Analysis Form (ALL TEXT INPUTS except Date and IsOnJob) */}
              {activeMode !== "resume" && (
                <div className="p-6 rounded-2xl bg-surface-container/50 border border-white/5 space-y-4">
                  <h4 className="text-xs text-primary font-label-mono uppercase tracking-widest font-extrabold mb-3">
                    分析前填写面试信息 (*必填)
                  </h4>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs font-semibold text-on-surface-variant">
                    <div>
                      <label className="block mb-2">面试公司名称 *</label>
                      <input
                        type="text"
                        placeholder="如 字节跳动"
                        value={audioForm.company}
                        onChange={(e) => setAudioForm({ ...audioForm, company: e.target.value })}
                        className="w-full py-3 px-4 bg-white/5 border border-white/10 rounded-xl text-white placeholder-on-surface-variant/30 focus:outline-none focus:border-primary/40 h-12 text-xs md:text-sm"
                      />
                    </div>

                    <div>
                      <label className="block mb-2">岗位名称 *</label>
                      <input
                        type="text"
                        placeholder="如 后端开发工程师"
                        value={audioForm.role}
                        onChange={(e) => setAudioForm({ ...audioForm, role: e.target.value })}
                        className="w-full py-3 px-4 bg-white/5 border border-white/10 rounded-xl text-white placeholder-on-surface-variant/30 focus:outline-none focus:border-primary/40 h-12 text-xs md:text-sm"
                      />
                    </div>

                    <div>
                      <label className="block mb-2">面试时间 *</label>
                      <input
                        type="date"
                        value={audioForm.date}
                        onChange={(e) => setAudioForm({ ...audioForm, date: e.target.value })}
                        className="w-full py-3 px-4 bg-white/5 border border-white/10 rounded-xl text-white focus:outline-none focus:border-primary/40 cursor-pointer h-12 text-xs md:text-sm"
                      />
                    </div>

                    <div>
                      <label className="block mb-2">面试轮次 *</label>
                      <input
                        type="text"
                        placeholder="如 二面 - 技术面"
                        value={audioForm.round}
                        onChange={(e) => setAudioForm({ ...audioForm, round: e.target.value })}
                        className="w-full py-3 px-4 bg-white/5 border border-white/10 rounded-xl text-white placeholder-on-surface-variant/30 focus:outline-none focus:border-primary/40 h-12 text-xs md:text-sm"
                      />
                    </div>

                    <div>
                      <label className="block mb-2">岗位职级 [选填]</label>
                      <input
                        type="text"
                        placeholder="如 P6 / L5"
                        value={audioForm.grade}
                        onChange={(e) => setAudioForm({ ...audioForm, grade: e.target.value })}
                        className="w-full py-3 px-4 bg-white/5 border border-white/10 rounded-xl text-white placeholder-on-surface-variant/30 focus:outline-none focus:border-primary/40 h-12 text-xs md:text-sm"
                      />
                    </div>

                    <div>
                      <label className="block mb-2">期望薪资 [选填]</label>
                      <input
                        type="text"
                        placeholder="如 25K * 16薪"
                        value={audioForm.salary}
                        onChange={(e) => setAudioForm({ ...audioForm, salary: e.target.value })}
                        className="w-full py-3 px-4 bg-white/5 border border-white/10 rounded-xl text-white placeholder-on-surface-variant/30 focus:outline-none focus:border-primary/40 h-12 text-xs md:text-sm"
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <label className="text-xs font-semibold text-on-surface-variant">岗位详情 [选填]</label>
                      <span className={`text-[10px] font-mono ${
                        audioForm.jobDescription.length > 540
                          ? audioForm.jobDescription.length >= 600 ? "text-secondary font-black" : "text-amber-400"
                          : "text-on-surface-variant/30"
                      }`}>
                        {audioForm.jobDescription.length}/600
                      </span>
                    </div>
                    <textarea
                      placeholder="粘贴岗位 JD（最多 600 字），AI 会基于真实岗位画像分析..."
                      value={audioForm.jobDescription}
                      maxLength={600}
                      onChange={(e) => setAudioForm({ ...audioForm, jobDescription: e.target.value.slice(0, 600) })}
                      className="w-full py-3 px-4 bg-white/5 border border-white/10 rounded-xl text-white placeholder-on-surface-variant/30 focus:outline-none focus:border-primary/40 h-28 text-xs md:text-sm resize-none"
                    />
                  </div>
                </div>
              )}
            </div>

            <button
              onClick={triggerAnalysis}
              className="w-full mt-6 py-4 bg-primary text-on-primary font-black rounded-2xl hover:scale-[1.01] active:scale-[0.99] transition-all flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-primary/20"
            >
              <span className="material-symbols-outlined text-sm">analytics</span>
              开始 AI 智能调试分析
            </button>
          </div>
        </div>

        {/* BOTTOM PRO CARD - FIGURE 3 STYLE */}
        <div className="col-span-12 mt-6 relative overflow-hidden rounded-3xl border border-white/10 bg-surface-container-low/60 backdrop-blur-xl p-6 md:py-8 md:px-10 flex flex-col md:flex-row justify-between items-center gap-6 shadow-2xl group min-h-[110px]">
          {/* Background Image Layer */}
          <div
            className="absolute inset-0 bg-cover bg-center opacity-50 pointer-events-none transition-all duration-500 group-hover:scale-105 animate-fade-in"
            style={{
              backgroundImage: "url('/debugger-1.jpg')",
              backgroundPosition: "center 75%",
            }}
          />
          {/* Dark Gradient Overlay */}
          <div className="absolute inset-0 bg-gradient-to-r from-background via-background/80 to-transparent pointer-events-none" />

          <div className="relative z-10 text-left space-y-1.5 max-w-2xl">
            <h4 className="text-lg md:text-xl font-black text-white flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-primary animate-pulse" />
              准备好开启下一次面试了吗？
            </h4>
            <p className="text-xs md:text-sm text-on-surface-variant/70 leading-relaxed font-semibold">
              {!auth.isLoggedIn
                ? "登录后即可把本次面试分析记录安全保存到云端，持续追踪每一次成长。"
                : auth.user?.membership === "test"
                ? "内测体验版已为你解锁 2 次录音分析 / 5 次记录分析 / 5 次简历分析 / 20 分钟 AI 模拟面试。一次性额度，用完即止。"
                : auth.user?.membership === "max"
                ? "MAX 档已解锁全部无限分析额度与特权功能。"
                : auth.user?.membership === "pro"
                ? "PRO 档已解锁 30 天内 10 次录音/记录/简历分析 + 5 次 AI 模拟面试 + 60 分钟/月实时面试。"
                : "免费版仅可使用 1 次录音分析 / 1 次记录分析 / 1 次简历分析。"}
            </p>
          </div>

          <div className="relative z-10 flex gap-4 w-full md:w-auto">
            <span className="px-6 py-2.5 bg-tertiary/15 border border-tertiary/30 text-tertiary font-black text-xs md:text-sm rounded-xl whitespace-nowrap">
              ✨ 内测体验中
            </span>
          </div>
        </div>

      </div>

      {/* Footer */}
      <footer className="bg-surface-container-lowest border-t border-white/5 w-full block mt-8 relative z-10 shrink-0">
        <div className="px-gutter py-8 max-w-container-max mx-auto flex flex-col md:flex-row justify-between items-center gap-4 text-left">
          <span className="text-[10px] text-on-surface-variant/30 font-label-mono font-bold tracking-widest block text-left">
            © 2026 面试VAR. All rights reserved.
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

      {/* UNAUTHENTICATED OVERLAY — 参照面试训练场样式：背景模糊 + 居中卡片 */}
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
                  Interview Debugger
                </span>
                <h3 className="text-2xl font-black text-white leading-tight">登录解锁你的面试调试器</h3>
                <p className="text-sm text-on-surface-variant/70 font-semibold leading-relaxed">
                  上传面试录音 / 简历 / 面试记录，AI 会结合你的个人画像与历史职业记忆，输出专属的深度诊断报告与可执行的改进建议。
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
    </main>
  );
}

export default function NewAnalysisDebugger() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[#050B1A] text-white flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-primary"></div>
      </div>
    }>
      <NewAnalysisDebuggerContent />
    </Suspense>
  );
}
