"use client";

import { useState, useRef, useEffect, Suspense } from "react";
import { useModerationPreview } from "@/hooks/useModerationPreview";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth, UserMenu } from "@/components/AuthProvider";
import { ThemeToggle } from "@/components/ThemeToggle";
import { openLegalTerms, openLegalPrivacy, openLegalContact } from "@/components/LegalModals";
import Footer from "@/components/Footer";
import { subscribeTaskUntilDone } from "@/app/utils/pollTask";
import { startSmoothTaskProgress } from "@/app/utils/smoothTaskProgress";
import { API_BASE } from "@/lib/api";
import { getQuotaStatus, type Feature } from "@/lib/quotaClient";
import { trackPendingFile, untrackPendingFile } from "@/utils/pendingUploads";
import { uploadDirectToCos } from "@/lib/uploadClient";

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
  const [isPreparingAnalysis, setIsPreparingAnalysis] = useState(false);
  const [taskProgress, setTaskProgress] = useState(0);
  const [taskStep, setTaskStep] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [uploadedFileId, setUploadedFileId] = useState<number | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const [remainingCount, setRemainingCount] = useState<number | null>(null);

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

  const jdMod = useModerationPreview();

  useEffect(() => {
    if (jdMod.status === "block") auth.triggerToast("岗位详情内容涉嫌违规，请修改后提交", "error");
  }, [jdMod.status]);

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
      if (ext !== "wav" && ext !== "mp3" && ext !== "ogg") {
        auth.triggerToast("上传失败：仅支持 WAV/MP3/OGG", "error");
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
        return false;
      }
    } else if (activeMode === "resume") {
      const ext = file.name.split('.').pop()?.toLowerCase();
      if (ext !== "pdf" && ext !== "docx") {
        auth.triggerToast("上传失败：简历仅支持 PDF 或 DOCX 格式！", "error");
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
          : "上传失败：简历文件大小不能超过 5MB！",
        "error"
      );
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      return false;
    }

    setIsUploading(true);
    try {
      //   presign → PUT COS (经 cos-js-sdk-v5,不经过后端) → finalize
      // 详见 frontend/src/lib/uploadClient.ts
      const fin = await uploadDirectToCos({
        file,
        fileType: activeMode as "audio" | "resume" | "screenshot",
      });

      setUploadedFileId(fin.file_id);
      setSelectedFile(file);
      localStorage.setItem("interviewVar_session_audio_url", fin.file_url);
      // track_pending 必须在 finalize 成功后才调 —— 否则 auto-flush DELETE 会
      // 试图清掉已经 finalized 的行,得不偿失
      trackPendingFile(fin.file_id);
      auth.triggerToast("文件已成功上传！");
    } catch (e: any) {
      auth.triggerToast(e.message || "文件上传失败，请重试！", "error");
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
        // 2026-07-25+: 用户手动删除成功 → 从 pending 列表移除
        // (避免 AutoCleanupUploads 再发一次 DELETE)
        untrackPendingFile(uploadedFileId);
        auth.triggerToast("文件已删除！");
      } catch (e: any) {
        auth.triggerToast(e.message || "文件删除失败！", "error");
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
        auth.triggerToast("您的该项分析免费体验次数已达上限，请注册或登录后使用更多功能！", "error");
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
          auth.triggerToast("无法连接服务器校验体验次数，请稍后再试！", "error");
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
            : `您已使用过${featureLabel}的免费体验，剩余次数不足，敬请期待后续更多功能！`;
          auth.triggerToast(detail, "error");
          return;
        }
      } catch (err) {
        auth.triggerToast("无法连接服务器校验体验次数，请稍后再试！", "error");
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
            : "请先上传个人简历文档！",
          "error"
        );
        return;
      }
    } else {
      if (!pasteText.trim()) {
        auth.triggerToast("请先输入或粘贴面试对话内容！", "error");
        return;
      }
    }

    // Form validation checks for required fields when form is shown (activeMode !== "resume")
    // Form validation checks for required fields when form is shown (activeMode !== "resume")
    if (activeMode !== "resume") {
      if (!audioForm.company.trim()) {
        auth.triggerToast("请填写面试公司名称！", "error");
        return;
      }
      if (!audioForm.role.trim()) {
        auth.triggerToast("请填写岗位名称！", "error");
        return;
      }
      if (!audioForm.date.trim()) {
        auth.triggerToast("请选择面试时间！", "error");
        return;
      }
      if (!audioForm.round.trim()) {
        auth.triggerToast("请填写面试轮次！", "error");
        return;
      }
    }

    // 开启按钮加载状态，在校验通过前保持按钮转圈，不进全屏进度条
    setIsPreparingAnalysis(true);

    // 前置敏感词即时校验（消除 500ms 防抖竞态问题）
    if (activeMode !== "resume") {
      if (audioForm.jobDescription && audioForm.jobDescription.trim().length >= 2) {
        const jdRes = await jdMod.checkNow(audioForm.jobDescription, "jd_audio_hint");
        if (jdRes === "block") {
          auth.triggerToast("岗位详情内容涉嫌违规，请修改后提交", "error");
          setIsPreparingAnalysis(false);
          return;
        }
      }
    }

    // Save form meta to localStorage so result pages can read them
    localStorage.setItem("interviewVar_report_mode", activeMode);
    localStorage.setItem("interviewVar_session_company", audioForm.company || "");
    localStorage.setItem("interviewVar_session_role", audioForm.role || "");
    localStorage.setItem("interviewVar_session_years", auth.user?.years || "");
    localStorage.setItem("interviewVar_session_round", audioForm.round || "");
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

      let sessionId: number;
      let taskId: string;

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
            company: audioForm.company,
            role: audioForm.role,
            round: audioForm.round,
            date: audioForm.date,
            grade: audioForm.grade,
            salary: audioForm.salary,
          })
        });

        if (!sessionRes.ok) {
          const err = await sessionRes.json().catch(() => ({}));
          const detailStr = String(err.detail || "");
          if (sessionRes.status === 400 || sessionRes.status === 422 || detailStr.includes("违规") || detailStr.includes("敏感")) {
            if (detailStr.includes("岗位")) auth.triggerToast("岗位详情内容涉嫌违规，请修改后提交", "error");
            else if (detailStr.includes("对话")) auth.triggerToast("对话内容涉嫌违规，请修改后提交", "error");
            else if (detailStr.includes("公司")) auth.triggerToast("公司名称涉嫌违规，请修改后提交", "error");
            else if (detailStr.includes("岗位")) auth.triggerToast("岗位名称涉嫌违规，请修改后提交", "error");
            else auth.triggerToast(err.detail || "内容涉嫌违规，请修改后提交", "error");
          } else {
            auth.triggerToast(err.detail || "创建分析会话失败", "error");
          }
          setIsPreparingAnalysis(false);
          return;
        }

        const sessionData = await sessionRes.json();
        sessionId = sessionData.session_id;
        localStorage.setItem("interviewVar_session_id", String(sessionId));

        // 2026-07-25+: session 创建成功 → 文件已"提交",从 pending 列表移除
        // (切屏/刷新时不再自动 DELETE)
        if (uploadedFileId) untrackPendingFile(uploadedFileId);

        // Mark as analyzed for free users/guests
        localStorage.setItem("interviewVar_analyzed_audio", "true");

        // Step 2: Trigger background analysis task
        const analyzeRes = await fetch(`${API_BASE}/api/audio/analyze`, {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ session_id: sessionId })
        });
        if (!analyzeRes.ok) {
          const err = await analyzeRes.json().catch(() => ({}));
          auth.triggerToast(err.detail || "启动分析任务失败", "error");
          setIsPreparingAnalysis(false);
          return;
        }
        const analyzeData = await analyzeRes.json();
        taskId = analyzeData.task_id;
        localStorage.setItem("interviewVar_task_id", taskId);

        // 会话创建且启动分析任务成功 -> 校验通过，此时真正进入进度条全屏页面！
        setTaskStep("ASR 转写中——提取音频文字...");
        setTaskProgress(1);
        setIsPreparingAnalysis(false);
        setIsAnalyzing(true);
      } catch (e: any) {
        auth.triggerToast(e.message || "启动分析失败，请重试！", "error");
        setIsPreparingAnalysis(false);
        return;
      }

      // Step 3: Subscribe on THIS page until analysis completes, THEN navigate
      const STEPS = [
        "ASR 转写中——提取音频文字...",
        "语义分段——判定说话人角色...",
        "LLM 评估——对比用户画像与答题...",
        "AI 话术重构——生成升级建议...",
        "分析完成 — 正在生成报告..."
      ];

      const smoothProgress = startSmoothTaskProgress({
        steps: STEPS,
        setProgress: setTaskProgress,
        setStep: setTaskStep,
        initialProgress: 1,
      });

      try {
        const subscribeResult = await subscribeTaskUntilDone(taskId, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          onProgress: (taskData) => {
            smoothProgress.setTarget(taskData.progress ?? 0);
          },
        });
        smoothProgress.complete(STEPS[STEPS.length - 1]);

        // 2026-07-25+: 检查任务是否以 failed 结束,不导航到报告页
        if (subscribeResult.finalData.status === "failed") {
          const errMsg = (subscribeResult.finalData as any).error_message || "录音分析失败，请重试";
          auth.triggerToast(errMsg, "error");
          setIsAnalyzing(false);
          localStorage.removeItem("interviewVar_task_id");
          // 2026-08-02+: 后端失败时已自动删 COS 文件 + UploadedFile 记录,
          // 前端这里必须同步清掉文件状态,否则 UI 仍显示"已选择"文件,
          // 再次点击删除/分析会打到已不存在的文件上
          if (uploadedFileId) untrackPendingFile(uploadedFileId);
          setSelectedFile(null);
          setUploadedFileId(null);
          localStorage.removeItem("interviewVar_session_audio_url");
          if (fileInputRef.current) fileInputRef.current.value = "";
          return;
        }

        // Step 4: Navigate to voice analysis report page (data is ready)
        localStorage.removeItem("interviewVar_task_id");
        await checkRemainingLimit();
        router.push("/debugger/voice");
      } catch (e: any) {
        smoothProgress.stop();
        auth.triggerToast(e.message || "分析任务异常，请重试！", "error");
        setIsAnalyzing(false);
      }

    } else if (activeMode === "text") {
      // Text mode: create session -> start analysis -> poll -> navigate
      const token = localStorage.getItem("interviewVar_token");
      const authHeaders: Record<string, string> = { "Content-Type": "application/json" };
      if (token) authHeaders["Authorization"] = `Bearer ${token}`;

      let sessionId: number;
      let taskId: string;

      try {
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
          const err = await sessionRes.json().catch(() => ({}));
          const detailStr = String(err.detail || "");
          if (sessionRes.status === 400 || sessionRes.status === 422 || detailStr.includes("违规") || detailStr.includes("敏感")) {
            if (detailStr.includes("岗位")) auth.triggerToast("岗位详情内容涉嫌违规，请修改后提交", "error");
            else if (detailStr.includes("对话")) auth.triggerToast("对话内容涉嫌违规，请修改后提交", "error");
            else if (detailStr.includes("公司")) auth.triggerToast("公司名称涉嫌违规，请修改后提交", "error");
            else if (detailStr.includes("岗位")) auth.triggerToast("岗位名称涉嫌违规，请修改后提交", "error");
            else auth.triggerToast(err.detail || "内容涉嫌违规，请修改后提交", "error");
          } else {
            auth.triggerToast(err.detail || "创建分析会话失败", "error");
          }
          setIsPreparingAnalysis(false);
          return;
        }

        const sessionData = await sessionRes.json();
        sessionId = sessionData.session_id;
        localStorage.setItem("interviewVar_session_id", String(sessionId));

        // Mark as analyzed
        localStorage.setItem("interviewVar_analyzed_text", "true");

        // Step 2: Trigger background analysis task
        const analyzeRes = await fetch(`${API_BASE}/api/audio/analyze`, {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ session_id: sessionId })
        });
        if (!analyzeRes.ok) {
          const err = await analyzeRes.json().catch(() => ({}));
          auth.triggerToast(err.detail || "启动分析任务失败", "error");
          setIsPreparingAnalysis(false);
          return;
        }
        const analyzeData = await analyzeRes.json();
        taskId = analyzeData.task_id;
        localStorage.setItem("interviewVar_task_id", taskId);

        // 校验通过，会话与任务创建成功！关闭按钮加载，真正进入进度条全屏页面！
        setTaskStep("文本解析中——载入对白记录...");
        setTaskProgress(1);
        setIsPreparingAnalysis(false);
        setIsAnalyzing(true);
      } catch (e: any) {
        auth.triggerToast(e.message || "启动分析失败，请重试！", "error");
        setIsPreparingAnalysis(false);
        return;
      }

      const TEXT_STEPS = [
        "文本解析中——载入对白记录...",
        "语义分段——分析段落话题...",
        "LLM 评估——匹配岗位 JD 与对白...",
        "AI 话术重构——生成升级建议...",
        "分析完成 — 正在生成报告..."
      ];

      const smoothProgress = startSmoothTaskProgress({
        steps: TEXT_STEPS,
        setProgress: setTaskProgress,
        setStep: setTaskStep,
        initialProgress: 1,
      });

      try {
        // Step 3: Subscribe progress until done
        const subscribeResult = await subscribeTaskUntilDone(taskId, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          onProgress: (taskData) => {
            smoothProgress.setTarget(taskData.progress || 0);
          },
        });
        smoothProgress.complete(TEXT_STEPS[TEXT_STEPS.length - 1]);

        // 2026-07-25+: 检查任务是否以 failed 结束
        if (subscribeResult.finalData.status === "failed") {
          const errMsg = (subscribeResult.finalData as any).error_message || "面试记录分析失败，请重试";
          auth.triggerToast(errMsg, "error");
          setIsAnalyzing(false);
          localStorage.removeItem("interviewVar_task_id");
          return;
        }

        localStorage.removeItem("interviewVar_task_id");
        await checkRemainingLimit();
        router.push(`/debugger/record?sessionId=${sessionId}`);
      } catch (e: any) {
        smoothProgress.stop();
        auth.triggerToast(e.message || "分析任务异常，请重试！", "error");
        setIsAnalyzing(false);
      }
    } else {
      // Resume mode
      if (!uploadedFileId) {
        auth.triggerToast("请先选择并上传您的简历文件！", "error");
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
        { limit: 45, step: "正在深度解析简历结构与技术栈..." },
        { limit: 70, step: "正在对比目标岗位画像，评估匹配契合度..." },
        { limit: 88, step: "正在实施大厂 STAR 原则，深度优化工作经历..." },
        { limit: 97, step: "正在诊断简历雷区与 ATS 机器人可读性..." }
      ];
      
      let currentStepIdx = 0;
      const progressInterval = setInterval(() => {
        if (progress < 98) {
          const currentStep = progressSteps[currentStepIdx];
          const inc = progress < 45 ? 1.2 : (progress < 70 ? 0.8 : (progress < 88 ? 0.5 : 0.2));
          progress = Math.min(98, progress + inc);
          setTaskProgress(Math.floor(progress));
          setTaskStep(currentStep.step);
          
          if (progress >= currentStep.limit && currentStepIdx < progressSteps.length - 1) {
            currentStepIdx++;
          }
        }
      }, 400);

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

        // 2026-07-25+: 简历分析请求成功 → 文件已"提交",从 pending 列表移除
        if (uploadedFileId) untrackPendingFile(uploadedFileId);

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
        auth.triggerToast(e.message || "分析简历失败，请重试！", "error");
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
            className="text-2xl font-display-xl font-bold tracking-tight text-on-surface flex items-center gap-3 cursor-pointer"
          >
            <img src="/logo/logo_icon.svg" alt="面试驾到" className="w-11 h-11 object-contain" />
            面试驾到
          </div>

          <div className="absolute left-1/2 -translate-x-1/2 hidden md:flex items-center gap-3 lg:gap-5 xl:gap-8 whitespace-nowrap">
            <a onClick={() => router.push("/debugger")} className="text-primary transition-colors text-[15px] lg:text-[16px] xl:text-[17px] font-extrabold cursor-pointer relative whitespace-nowrap shrink-0 after:content-[''] after:absolute after:bottom-[-26px] after:left-0 after:right-0 after:h-[2px] after:bg-primary">
              面试调试器
            </a>
            <a onClick={() => router.push("/memory")} className="text-on-surface-variant hover:text-on-surface transition-colors text-[15px] lg:text-[16px] xl:text-[17px] font-extrabold cursor-pointer whitespace-nowrap shrink-0">
              职业记忆看板
            </a>
            <a onClick={() => router.push("/training")} className="text-on-surface-variant hover:text-on-surface transition-colors text-[15px] lg:text-[16px] xl:text-[17px] font-extrabold cursor-pointer whitespace-nowrap shrink-0">
              面试训练场
            </a>
            <a onClick={() => router.push("/home")} className="text-on-surface-variant hover:text-on-surface transition-colors text-[15px] lg:text-[16px] xl:text-[17px] font-extrabold cursor-pointer whitespace-nowrap shrink-0">
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

          <div className="flex items-center gap-3 md:gap-4">
            {auth.isLoggedIn && (
              <button
                onClick={() => router.push("/memory?tab=timeline")}
                className="px-4.5 py-2 bg-white/5 border border-white/10 rounded-full text-sm font-bold text-on-surface hover:bg-white/10 transition-all flex items-center gap-1.5 cursor-pointer"
              >
                <span className="material-symbols-outlined text-base">history</span>历史记录
              </button>
            )}
            <ThemeToggle />
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
                          // 2026-07-25+: 模式切换时显式删除 → 从 pending 移除
                          untrackPendingFile(uploadedFileId);
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
                        <p className="text-xs text-white/60 mt-1 font-medium leading-relaxed">{item.desc}</p>
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
                    {taskStep || "面试驾到 AI 正在分析中..."}
                  </h3>
                  <p className="text-base md:text-lg text-white/70 font-semibold">
                    {activeMode === "resume"
                      ? "PDF/DOCX 文本提取 + 大模型智能评估，分析完成后自动进入报告"
                      : activeMode === "text"
                      ? "文本诊断 + 大模型智能评估，分析完成后自动进入报告"
                      : "ASR 语音识别 +大模型智能评估，分析完成后自动进入报告"}
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
                  <span className="text-[10px] font-label-mono tracking-widest text-[#AFA7FF] font-bold uppercase">
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
                    remainingCount === 0
                      ? "bg-secondary/10 border border-secondary/20 text-secondary"
                      : "bg-primary/10 border border-primary/20 text-primary animate-pulse"
                  }`}>
                    {auth.user?.membership === "test"
                      ? `内测档 · 剩余体验：${remainingCount}次`
                      : `免费体验剩余：${remainingCount}次`}
                  </div>
                )}
              </div>

              {/* Upload drag drop areas */}
              {(() => {
                const isQuotaExhausted = remainingCount !== null && remainingCount <= 0;
                return (
                  <>
                    {activeMode !== "text" ? (
                      <div
                        onClick={selectedFile || isUploading || isQuotaExhausted ? undefined : handleUploadClick}
                        onDragOver={isUploading || isQuotaExhausted ? undefined : handleDragOver}
                        onDragLeave={isUploading || isQuotaExhausted ? undefined : handleDragLeave}
                        onDrop={isUploading || isQuotaExhausted ? undefined : handleDrop}
                        className={`border-2 border-dashed py-20 md:py-28 rounded-2xl flex flex-col items-center justify-center text-center transition-all duration-300 min-h-[380px] group relative ${
                          selectedFile || isUploading || isQuotaExhausted ? "cursor-not-allowed opacity-60 bg-white/[0.01]" : "cursor-pointer"
                        } ${
                          isDragging && !isUploading && !isQuotaExhausted
                            ? "border-primary bg-primary/10 scale-[1.01] shadow-[0_0_25px_rgba(192,193,255,0.1)]"
                            : "border-white/10 hover:border-primary/50 hover:bg-white/[0.01]"
                        }`}
                      >
                        <input
                          type="file"
                          ref={fileInputRef}
                          onChange={handleFileChange}
                          disabled={isQuotaExhausted}
                          accept={activeMode === "audio" ? ".wav,.mp3,.ogg" : ".pdf,.docx"}
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
                                disabled={isQuotaExhausted}
                                className="absolute -top-2 -right-2 w-7 h-7 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center transition-all shadow-md cursor-pointer z-10 disabled:opacity-50 disabled:cursor-not-allowed"
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
                                disabled={isQuotaExhausted}
                                className="px-4.5 py-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-xs font-bold text-white transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                <span className="material-symbols-outlined text-sm">cloud_upload</span>
                                选择其他文件
                              </button>
                            </div>
                          </div>
                        ) : isQuotaExhausted ? (
                          <div className="flex flex-col items-center justify-center space-y-3">
                            <div className="w-20 h-20 rounded-3xl bg-secondary/10 border border-secondary/20 text-secondary flex items-center justify-center mb-2">
                              <span className="material-symbols-outlined" style={{ fontSize: "48px" }}>block</span>
                            </div>
                            <h4 className="font-extrabold text-white text-base md:text-lg">
                              体验次数已用完，暂时无法上传文件
                            </h4>
                            <p className="text-xs md:text-sm text-secondary/80 font-bold">
                              当前剩余体验次数为 0 次，请升级会员或充值体验配额
                            </p>
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
                              {activeMode === "audio" ? (
                                <>
                                  支持 wav / mp3 / ogg 格式 · 最大 50MB · 时长建议 30 分钟内
                                </>
                              ) : (
                                "支持 PDF, DOCX 格式，最大 5MB"
                              )}
                            </p>
                            {activeMode === "audio" && (
                              <p className="text-sm md:text-xs text-on-surface-variant/40 mt-1.5">
                                iPhone / Mac 录音默认 m4a，请先转码为 wav 再上传
                              </p>
                            )}
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
                            disabled={isQuotaExhausted}
                            className="text-xs text-primary font-bold cursor-pointer flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <span className="material-symbols-outlined text-xs">bolt</span>载入经典失败分析模板
                          </button>
                        </div>
                        <textarea
                          value={pasteText}
                          onChange={(e) => setPasteText(e.target.value)}
                          disabled={isQuotaExhausted}
                          placeholder={isQuotaExhausted ? "体验次数已用完，暂无法录入分析文本..." : "面试官：请问你们的系统是怎么做微服务架构解耦的？我：就是简单用了一个消息队列，人工对账补数据..."}
                          className="w-full h-56 bg-surface-container-low border border-white/5 rounded-2xl p-4 font-mono text-sm text-on-surface focus:outline-none focus:border-primary/40 transition-all leading-relaxed min-h-[220px] disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-white/[0.02] disabled:border-white/5"
                        />
                      </div>
                    )}

                    {/* Pre-Analysis Form (ALL TEXT INPUTS except Date and IsOnJob) */}
                    {activeMode !== "resume" && (
                      <div className="p-6 rounded-2xl bg-surface-container/50 border border-white/5 space-y-4">
                        <h4 className="text-xs text-[#AFA7FF] font-label-mono uppercase tracking-widest font-extrabold mb-3">
                          分析前填写面试信息 (*必填)
                        </h4>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs font-semibold text-white/80">
                          <div>
                            <label className="block mb-2">面试公司名称 *</label>
                            <input
                              type="text"
                              placeholder="如 字节跳动"
                              value={audioForm.company}
                              disabled={isQuotaExhausted}
                              onChange={(e) => setAudioForm({ ...audioForm, company: e.target.value })}
                              className="w-full py-3 px-4 bg-white/5 border border-white/10 rounded-xl text-white placeholder-on-surface-variant/30 focus:outline-none focus:border-primary/40 h-12 text-xs md:text-sm disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-white/[0.02]"
                            />
                          </div>

                          <div>
                            <label className="block mb-2">岗位名称 *</label>
                            <input
                              type="text"
                              placeholder="如 后端开发工程师"
                              value={audioForm.role}
                              disabled={isQuotaExhausted}
                              onChange={(e) => setAudioForm({ ...audioForm, role: e.target.value })}
                              className="w-full py-3 px-4 bg-white/5 border border-white/10 rounded-xl text-white placeholder-on-surface-variant/30 focus:outline-none focus:border-primary/40 h-12 text-xs md:text-sm disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-white/[0.02]"
                            />
                          </div>

                          <div>
                            <label className="block mb-2">面试时间 *</label>
                            <input
                              type="date"
                              value={audioForm.date}
                              disabled={isQuotaExhausted}
                              onChange={(e) => setAudioForm({ ...audioForm, date: e.target.value })}
                              className="w-full py-3 px-4 bg-white/5 border border-white/10 rounded-xl text-white focus:outline-none focus:border-primary/40 cursor-pointer h-12 text-xs md:text-sm disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-white/[0.02]"
                            />
                          </div>

                          <div>
                            <label className="block mb-2">面试轮次 *</label>
                            <input
                              type="text"
                              placeholder="如 二面 - 技术面"
                              value={audioForm.round}
                              disabled={isQuotaExhausted}
                              onChange={(e) => setAudioForm({ ...audioForm, round: e.target.value })}
                              className="w-full py-3 px-4 bg-white/5 border border-white/10 rounded-xl text-white placeholder-on-surface-variant/30 focus:outline-none focus:border-primary/40 h-12 text-xs md:text-sm disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-white/[0.02]"
                            />
                          </div>

                          <div>
                            <label className="block mb-2">岗位职级 [选填]</label>
                            <input
                              type="text"
                              placeholder="如 P6 / L5"
                              value={audioForm.grade}
                              disabled={isQuotaExhausted}
                              onChange={(e) => setAudioForm({ ...audioForm, grade: e.target.value })}
                              className="w-full py-3 px-4 bg-white/5 border border-white/10 rounded-xl text-white placeholder-on-surface-variant/30 focus:outline-none focus:border-primary/40 h-12 text-xs md:text-sm disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-white/[0.02]"
                            />
                          </div>

                          <div>
                            <label className="block mb-2">期望薪资 [选填]</label>
                            <input
                              type="text"
                              placeholder="如 25K * 16薪"
                              value={audioForm.salary}
                              disabled={isQuotaExhausted}
                              onChange={(e) => setAudioForm({ ...audioForm, salary: e.target.value })}
                              className="w-full py-3 px-4 bg-white/5 border border-white/10 rounded-xl text-white placeholder-on-surface-variant/30 focus:outline-none focus:border-primary/40 h-12 text-xs md:text-sm disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-white/[0.02]"
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
                            disabled={isQuotaExhausted}
                            onChange={(e) => { setAudioForm({ ...audioForm, jobDescription: e.target.value.slice(0, 600) }); jdMod.reset(); }}
                            onBlur={(e) => jdMod.check(e.target.value, "jd_audio_hint")}
                            className="w-full py-3 px-4 bg-white/5 border border-white/10 rounded-xl text-white placeholder-on-surface-variant/30 focus:outline-none focus:border-primary/40 h-28 text-xs md:text-sm resize-none disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-white/[0.02]"
                          />
                        </div>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>

            {(() => {
              const isQuotaExhausted = remainingCount !== null && remainingCount <= 0;
              return (
                <button
                  onClick={triggerAnalysis}
                  disabled={isAnalyzing || isPreparingAnalysis || isQuotaExhausted}
                  className={`w-full mt-6 py-4 font-black rounded-2xl transition-all flex items-center justify-center gap-2 cursor-pointer shadow-lg ${
                    isQuotaExhausted
                      ? "bg-white/10 text-on-surface-variant/40 border border-white/10 shadow-none cursor-not-allowed"
                      : "bg-primary text-on-primary hover:scale-[1.01] active:scale-[0.99] shadow-primary/20 disabled:opacity-60 disabled:pointer-events-none"
                  }`}
                >
                  {isPreparingAnalysis ? (
                    <>
                      <div className="w-4 h-4 border-2 border-on-primary border-t-transparent rounded-full animate-spin shrink-0" />
                      <span>校验与准备分析会话中...</span>
                    </>
                  ) : isQuotaExhausted ? (
                    <>
                      <span className="material-symbols-outlined text-sm">block</span>
                      <span>体验额度已用尽，无法提交分析</span>
                    </>
                  ) : (
                    <>
                      <span className="material-symbols-outlined text-sm">analytics</span>
                      <span>开启 AI 智能调试分析</span>
                    </>
                  )}
                </button>
              );
            })()}
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
                ? "内测体验版已为你解锁 2 次录音分析 / 3 次记录分析 / 3 次简历分析 / 10 分钟 AI 模拟面试。一次性额度，用完即止。"
                : "免费版仅可使用 1 次简历分析 / 1 次面试记录分析。"}
            </p>
          </div>

          <div className="relative z-10 flex gap-4 w-full md:w-auto">
            <span className="px-6 py-2.5 bg-tertiary/15 border border-tertiary/30 text-tertiary font-black text-xs md:text-sm rounded-xl whitespace-nowrap">
              内测体验中
            </span>
          </div>
        </div>

      </div>

      {/* Footer */}
      <Footer />

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
