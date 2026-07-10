'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth, UserMenu } from "@/components/AuthProvider";
import { useRealtimeSession } from "@/app/utils/useRealtimeSession";
import { useRealtimeAudio } from "./hooks/useRealtimeAudio";

// ============================================================
// 实时语音面试（PR5）
// 后端：POST /api/live/sessions 创建；WS /api/live/ws/{id} 双向语音
// 结束：POST /api/live/sessions/{id}/end → 跳 /debugger/voice?sessionId=N
// PR5：用 useRealtimeSession Hook 管理 WS 状态机 + 重连
//      用 useRealtimeAudio Hook 采集麦克风 + AudioWorklet 下采样
// ============================================================

type InterviewType = "tech_8gu" | "tech_project" | "tech_scenario" | "hr_comprehensive" | "non_tech";
type Difficulty = "Lv1" | "Lv2" | "Lv3" | "Lv4";
type DurationMin = 10 | 15 | 20;
type FollowupRounds = 1 | 2 | 3;

interface LiveSession {
  live_session_id: number;
  status: string;
  voice_id: string | null;
  persona_cn: string | null;
  session_id: number | null;
  ws_url: string | null;
}

interface TranscriptLine {
  role: "interviewer" | "candidate";
  text: string;
  partial: boolean;
  t0: number;
  t1: number;
}

const INTERVIEW_TYPES: Array<{ value: InterviewType; label: string; persona: string }> = [
  { value: "tech_8gu", label: "技术面·八股为主", persona: "书本型面试官" },
  { value: "tech_project", label: "技术面·深挖项目", persona: "刨根问底型" },
  { value: "tech_scenario", label: "技术面·场景题", persona: "架构师型" },
  { value: "non_tech", label: "非技术面·业务能力", persona: "资深业务面试官" },
  { value: "hr_comprehensive", label: "HR面·综合能力", persona: "资深 HR 型" },
];

const DIFFICULTIES: Array<{ value: Difficulty; label: string; speed: string }> = [
  { value: "Lv1", label: "友善", speed: "语速慢" },
  { value: "Lv2", label: "偏友好", speed: "语速中" },
  { value: "Lv3", label: "有压力", speed: "语速偏快" },
  { value: "Lv4", label: "严苟", speed: "语速快" },
];

const DURATIONS: Array<{ value: DurationMin; label: string; qRange: string }> = [
  { value: 10, label: "10 分钟", qRange: "3~5" },
  { value: 15, label: "15 分钟", qRange: "5~7" },
  { value: 20, label: "20 分钟", qRange: "7~9" },
];

const FOLLOWUP_RANGES: Record<FollowupRounds, string> = {
  1: "1 轮",
  2: "2 轮",
  3: "3 轮",
};

function InterviewTrainingPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const auth = useAuth();

  // ---------- 配置状态 ----------
  // targetRole 默认从 auth.user.targetRole 拿（如"高级后端专家"），缺省"后端开发工程师"
  const [targetRole, setTargetRole] = useState<string>(auth.user?.targetRole || "后端开发工程师");
  const [jobDescription, setJobDescription] = useState<string>("");
  const [interviewType, setInterviewType] = useState<InterviewType>(INTERVIEW_TYPES[0].value);
  const [difficulty, setDifficulty] = useState<Difficulty>(DIFFICULTIES[0].value);
  const [durationMin, setDurationMin] = useState<DurationMin>(DURATIONS[0].value);
  const [followupRounds, setFollowupRounds] = useState<FollowupRounds>(2);
  // JD 字符上限：与面试调试器统一为 600 字（避免过长 JD 引发表单性能问题）
  const JD_MAX_LENGTH = 600;

  // 同步用户资料中的目标岗位默认值
  useEffect(() => {
    if (auth.user?.targetRole) {
      setTargetRole(auth.user.targetRole);
    }
  }, [auth.user?.targetRole]);

  // ---------- Live 状态 ----------
  const [liveSession, setLiveSession] = useState<LiveSession | null>(null);
  const [bootState, setBootState] = useState<"idle" | "loading" | "live" | "ending" | "analyzing" | "error" | "report">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // PR5: WS 状态、transcript、AI 状态机、计时都由 useRealtimeSession Hook 管理
  const live = useRealtimeSession();
  const audio = useRealtimeAudio();
  const transcript = live.transcript;
  const aiState = live.aiState;
  const durationSec = live.metrics.durationSec;
  const micMuted = live.micMuted;
  const speakerMuted = live.speakerMuted;

  // ---------- UI 状态 ----------
  const [isCountingDown, setIsCountingDown] = useState(false);
  const [countdownNum, setCountdownNum] = useState(3);
  const [showEndConfirm, setShowEndConfirm] = useState(false);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [showNormsModal, setShowNormsModal] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackKind, setFeedbackKind] = useState<"tech_question" | "voice" | "ux" | "other">("tech_question");
  // PR6 配额：会员等级 + 当月已用 + 限额
  const [quota, setQuota] = useState<{ membership: string | null; limit_min: number; used_min: number; remaining_min: number } | null>(null);
  const [showHandBadge, setShowHandBadge] = useState(false);

  const [cameraOn, setCameraOn] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const [reportData, setReportData] = useState<any>(null);
  const [reportTranscript, setReportTranscript] = useState<any[]>([]);
  // 快捷操作：暂停倒计时
  const [isPaused, setIsPaused] = useState(false);
  const [pauseCountdown, setPauseCountdown] = useState(0);
  // 按钮 active 闪烁反馈（按下后 0.6s 高亮）
  const [activeAction, setActiveAction] = useState<"" | "pause" | "skip" | "hint" | "feedback">("");

  // ---------- 模拟分析进度条 ----------
  const [analysisProgress, setAnalysisProgress] = useState(0);
  useEffect(() => {
    const isAnalyzingNow = bootState === "analyzing" || bootState === "ending";
    if (!isAnalyzingNow) {
      setAnalysisProgress(0);
      return;
    }
    setAnalysisProgress(5);
    const interval = setInterval(() => {
      setAnalysisProgress((prev) => {
        if (prev >= 98) return 98;
        const diff = 100 - prev;
        const step = Math.max(0.5, Math.min(3, diff * 0.05));
        return Math.min(98, Math.floor(prev + step));
      });
    }, 400);

    return () => clearInterval(interval);
  }, [bootState]);

  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const transcriptContainerRef = useRef<HTMLDivElement>(null);
  const bootStateRef = useRef(bootState);
  useEffect(() => { bootStateRef.current = bootState; }, [bootState]);
  // 镜像 micMuted 状态，供 setInterval 等 stale-closure 场景读最新值（暂停恢复时使用）
  const micMutedRef = useRef(micMuted);
  useEffect(() => { micMutedRef.current = micMuted; }, [micMuted]);

  const apiBase = "http://localhost:8001";
  const authHeaders = useCallback((): HeadersInit => {
    const token = typeof window !== "undefined" ? localStorage.getItem("interviewVar_token") : null;
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, []);

  // ---------- HR 面互斥：自动限制 durationMin <= 15 ----------
  useEffect(() => {
    if (interviewType === "hr_comprehensive" && durationMin === 20) {
      setDurationMin(15);
    }
  }, [interviewType, durationMin]);

  // ---------- 启动时：URL?liveId= 或 localStorage 恢复 ----------
  // URL 规则：
  //   - 新建页（/training）→ URL 干净，不带 liveId
  //   - 报告页（已完成） → URL 带 ?liveId=N（可分享/可刷新回到报告）
  //   - 进行中刷新/返回  → 靠 localStorage 静默恢复，URL 保持干净
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlLiveId = params.get("liveId");
    const lsLiveId = typeof window !== "undefined" ? localStorage.getItem("interviewVar_live_id") : null;
    const liveId = urlLiveId || lsLiveId;

    // PR6: 拉配额信息
    fetch(`${apiBase}/api/live/quota`, { headers: authHeaders() })
      .then((r) => r.ok ? r.json() : null)
      .then((q) => { if (q) setQuota(q); })
      .catch(() => { /* 匿名/网络错误时静默 */ });

    if (!liveId) {
      setBootState("idle");
      const urlTargetRole = params.get("targetRole");
      if (urlTargetRole) {
        setTargetRole(urlTargetRole);
      }
      const savedConfig = typeof window !== "undefined" ? localStorage.getItem("interviewVar_live_config") : null;
      if (savedConfig) {
        try {
          const cfg = JSON.parse(savedConfig);
          if (cfg.jobDescription) setJobDescription(cfg.jobDescription);
          if (cfg.interviewType) setInterviewType(cfg.interviewType);
          if (cfg.difficulty) setDifficulty(cfg.difficulty);
          if (cfg.durationMin) setDurationMin(cfg.durationMin);
          if (cfg.followupRounds) setFollowupRounds(cfg.followupRounds);
        } catch (e) {
          console.error("Failed to restore live config:", e);
        }
      }
      return;
    }
    // 注意：不要把 localStorage 的 liveId 回写到 URL —— 新建页应保持 URL 干净
    // 只有 showReport 进入报告态时才把 liveId 写进 URL
    setBootState("loading");
    void restoreSession(Number(liveId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- Transcript 智能滚动 ----------
  // 只在用户已经靠近底部（< 60px）时才把容器内 scrollTop 拉到最底；
  // 用户若往上翻看历史消息，则不滚动（避免整个页面 jump 抢焦点）。
  useEffect(() => {
    const container = transcriptContainerRef.current;
    if (!container) return;
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    if (distanceFromBottom < 60) {
      container.scrollTop = container.scrollHeight;
    }
  }, [transcript]);

  // ---------- 同步 hook 错误到 bootState ----------
  useEffect(() => {
    if (live.status === "error" && live.error) {
      setErrorMsg(live.error.message);
      setBootState("error");
    }
  }, [live.status, live.error]);

  // ---------- AI 说话时暂停浏览器 STT，避免 TTS 回声被当候选人字幕 ----------
  useEffect(() => {
    audio.setAiSpeaking(aiState === "speaking");
  }, [aiState, audio]);

  // ---------- 同步 hook status 到 bootState ----------
  useEffect(() => {
    if (live.status === "live") setBootState("live");
    else if (live.status === "connecting") setBootState("loading");
    else if (live.status === "ended" || live.status === "ending") setBootState("ending");
  }, [live.status]);

  // ---------- 页面销毁时清理摄像头 ----------
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  // ============================================================
  // 核心流程
  // ============================================================

  const connectWs = (wsUrl: string, liveId: number) => {
    const token = localStorage.getItem("interviewVar_token") || "";
    void live.start({
      liveId,
      wsPath: wsUrl,
      token,
      onAudioFrame: (pcm16) => audio.play(pcm16),
    });
    // 候选人字幕优先走火山流式 ASR（后端 asr_bridge），
    // 但火山 resource_id 在某些账号下会 fallback 全部失败导致候选人字幕完全不显示，
    // 因此同时启用浏览器 Web Speech API 作兜底：
    //   - 后端 client.stt 处理路径会把识别结果广播为 live.transcript(role=candidate)
    //   - getUserMedia 已开启 echoCancellation/noiseSuppression，AI 扬声器回声被压制
    //   - 后端 _asr_event_loop 与 client.stt 都会 append 到 transcript，
    //     前端 appendTranscript 合并策略（partial 同 role 覆盖）能去掉大部分重复
    void audio.start(
      (pcm16) => { live.sendBinary(pcm16); },
      (text, isFinal) => { live.sendStt(text, isFinal); },
    );
  };

  const showReport = async (liveId: number) => {
    try {
      const res = await fetch(`${apiBase}/api/live/sessions/${liveId}/report`, { headers: authHeaders() });
      if (res.ok) {
        const report = await res.json();
        setReportData(report);
        setReportTranscript(report.transcript || []);
        setBootState("report");
        // 进入报告态：把 liveId 写进 URL（可分享、可刷新回到报告页）
        window.history.replaceState(null, "", `/training?liveId=${liveId}`);
      } else {
        setErrorMsg("获取面试报告失败");
        setBootState("error");
      }
    } catch (e) {
      console.error("Failed to load report:", e);
      setErrorMsg("加载面试报告出错");
      setBootState("error");
    }
  };

  const restoreSession = async (liveId: number) => {
    try {
      const res = await fetch(`${apiBase}/api/live/sessions/${liveId}`, { headers: authHeaders() });
      if (!res.ok) {
        setBootState("idle");
        localStorage.removeItem("interviewVar_live_id");
        return;
      }
      const sess: LiveSession = await res.json();
      setLiveSession(sess);
      // 修复：仅当 URL 明确带 ?liveId=（用户主动进入报告页 / 刷新报告）时才展示报告。
      // 若 URL 干净但 session 已 completed，说明是从其他页面点击"面试训练场"导航而来，
      // localStorage 中残留的 liveId 已属 stale，应当清理并展示新表单，
      // 而非自动弹回已完成的报告（避免 /training?liveId=N 误触）。
      const fromExplicitUrl = searchParams.get("liveId") !== null;
      switch (sess.status) {
        case "completed":
          if (fromExplicitUrl) {
            void showReport(liveId);
          } else {
            localStorage.removeItem("interviewVar_live_id");
            window.history.replaceState(null, "", "/training");
            setBootState("idle");
          }
          return;
        case "analyzing":
        case "ending":
        case "ended":
        case "failed":
          setBootState("idle");
          localStorage.removeItem("interviewVar_live_id");
          window.history.replaceState(null, "", "/training");
          return;
        case "live":
        case "ws_connecting":
        case "created":
          // 重新连 WS
          setBootState("live");
          if (sess.ws_url) connectWs(sess.ws_url, liveId);
          return;
        default:
          setBootState("idle");
      }
    } catch (e) {
      setBootState("idle");
      setErrorMsg("无法恢复会话状态");
    }
  };

  const pollUntilCompleted = async (liveId: number) => {
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const res = await fetch(`${apiBase}/api/live/sessions/${liveId}`, { headers: authHeaders() });
        if (!res.ok) continue;
        const sess: LiveSession = await res.json();
        if (sess.status === "completed") {
          void showReport(liveId);
          return;
        }
        if (sess.status === "failed") {
          setErrorMsg("报告生成失败，请重新开始");
          setBootState("error");
          return;
        }
      } catch { /* 网络抖动继续 */ }
    }
    setErrorMsg("报告生成超时");
    setBootState("error");
  };

  const handleStartTraining = async () => {
    if (!targetRole.trim()) {
      auth.triggerToast("请填写目标岗位！");
      return;
    }

    setIsCountingDown(true);
    setCountdownNum(3);
    for (let i = 3; i >= 1; i--) {
      setCountdownNum(i);
      await new Promise((r) => setTimeout(r, 1000));
    }
    setIsCountingDown(false);

    // POST /api/live/sessions
    try {
      const config = { targetRole, jobDescription, interviewType, difficulty, durationMin, followupRounds };
      localStorage.setItem("interviewVar_live_config", JSON.stringify(config));
      const res = await fetch(`${apiBase}/api/live/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          interview_type: interviewType,
          difficulty,
          duration_min: durationMin,
          followup_rounds: followupRounds,
          target_role: targetRole,
          // job_level 从 auth.user.targetGrade 拿（如 "P7"），缺省 "P6"
          job_level: auth.user?.targetGrade || "P6",
          // company_style 从 auth.user.targetCompany 拿（如 "腾讯/美团"），缺省 "通用"
          company_style: auth.user?.targetCompany || "通用",
          job_description: jobDescription || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        if (res.status === 409) {
          auth.triggerToast("已有进行中的实时面试，请先结束或等待");
        } else {
          auth.triggerToast(err.detail || "创建面试失败");
        }
        return;
      }
      const sess: LiveSession = await res.json();
      setLiveSession(sess);
      localStorage.setItem("interviewVar_live_id", String(sess.live_session_id));
      // URL 保持干净（不写 ?liveId=）：新建面试态不应污染 URL
      // 中途刷新靠 localStorage 静默恢复；URL 仅在报告态（showReport）才写
      setBootState("live");
      // PR5: 用 hook 启动 WS（已含自动重连）
      if (sess.ws_url) {
        const token = localStorage.getItem("interviewVar_token") || "";
        const targetLiveId = sess.live_session_id;
        // 收到服务端 tts_audio 帧 → 喂给 audio 队列播放
        void live.start({
          liveId: targetLiveId,
          wsPath: sess.ws_url,
          token,
          onAudioFrame: (pcm16) => audio.play(pcm16),
          // WS 中途异常断开兜底：触发后端分析（不浪费已采集的 transcript）
          onAutoEnd: (autoLiveId) => {
            console.warn("[training] WS 异常断开，兜底触发分析 live_id=", autoLiveId);
            audio.stop();
            stopCamera();
            setBootState("ending");
            void runAnalysisFlow(autoLiveId);
          },
        });
        // PR5: 启动麦克风采集（捕获失败不阻塞 WS）
        // 用 hook 暴露的 sendBinary（不直接访问内部 wsRef）
        // 候选人字幕双路：火山 asr_bridge（后端）+ 浏览器 Web Speech（前端兜底）
        // 后端 _asr_event_loop / client.stt 都广播 role=candidate，
        // 前端 appendTranscript 合并 partial 去重，避免双路重复展示
        void audio.start(
          (pcm16) => { live.sendBinary(pcm16); },
          (text, isFinal) => { live.sendStt(text, isFinal); },
        );
      }
    } catch (e) {
      auth.triggerToast("无法连接到后端服务");
    }
  };

  // 通用"触发分析 + 轮询"流程：被 handleEnd（用户主动）和 onAutoEnd（WS 异常）共用。
  // POST /end 若已 analyzing/completed 则直接返回当前状态；前端据此判断是否要 showReport。
  const runAnalysisFlow = async (liveId: number) => {
    try {
      const res = await fetch(`${apiBase}/api/live/sessions/${liveId}/end`, {
        method: "POST",
        headers: authHeaders(),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        auth.triggerToast(err.detail || "结束失败");
        setBootState("error");
        return;
      }
      const sess: LiveSession = await res.json();
      setLiveSession(sess);
      if (sess.status === "completed") {
        void showReport(sess.live_session_id);
        return;
      }
      setBootState("analyzing");
      // PR6: 刷新 quota（已用时长）
      fetch(`${apiBase}/api/live/quota`, { headers: authHeaders() })
        .then((r) => r.ok ? r.json() : null)
        .then((q) => { if (q) setQuota(q); })
        .catch(() => {});
      void pollUntilCompleted(sess.live_session_id);
    } catch (e) {
      auth.triggerToast("无法结束面试");
      setBootState("error");
    }
  };

  const handleEnd = async () => {
    if (!liveSession) return;
    setShowEndConfirm(false);
    setBootState("ending");
    void live.end();
    audio.stop();
    stopCamera();
    void runAnalysisFlow(liveSession.live_session_id);
  };

  const handleReset = () => {
    localStorage.removeItem("interviewVar_live_id");
    localStorage.removeItem("interviewVar_live_config");
    window.history.replaceState(null, "", "/training");
    setLiveSession(null);
    setBootState("idle");
    setReportData(null);
    setReportTranscript([]);
    live.reset();
    audio.stop();
    stopCamera();
    setErrorMsg(null);
  };

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setCameraOn(false);
  }, []);

  const toggleCamera = async () => {
    if (cameraOn) {
      stopCamera();
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 360 },
          audio: false,
        });
        streamRef.current = stream;
        setCameraOn(true);
      } catch (err) {
        console.error("Failed to access camera:", err);
        auth.triggerToast("无法访问摄像头，请检查权限/连接设备");
      }
    }
  };

  const videoRefCallback = useCallback((node: HTMLVideoElement | null) => {
    if (node) {
      if (streamRef.current) {
        node.srcObject = streamRef.current;
      }
    }
  }, []);

  // ============================================================
  // 快捷操作（PR-N：暂停 / 跳过 / 提示 / 反馈）
  // ============================================================

  const flashActive = (kind: "pause" | "skip" | "hint" | "feedback") => {
    setActiveAction(kind);
    setTimeout(() => setActiveAction((cur) => (cur === kind ? "" : cur)), 600);
  };

  const handlePause = () => {
    if (live.status !== "live" || isPaused) return;
    const DURATION = 30;
    // 1) 通知后端 → 后端会注入文本让 AI 等待 + 30s 后推恢复
    live.sendQuickAction("pause", { duration: DURATION });
    // 2) 客户端屏蔽 mic 上行（不进 ASR/VAD）。
    //    用 micMutedRef 读最新值（避免 setInterval 闭包拿到旧值），按需 toggle：
    //    原本开着才关，原本关着就不再切（保证暂停期间 mic 一定是关闭的）
    audio.mute(true);
    if (!micMutedRef.current) live.toggleMic();
    setIsPaused(true);
    setPauseCountdown(DURATION);
    const t = setInterval(() => {
      setPauseCountdown((s) => {
        if (s <= 1) {
          clearInterval(t);
          // 等后端推 live.pause.active=false；客户端这边先 unmuted 兜底
          audio.mute(false);
          // 30s 倒计时结束：自动打开麦克风。
          // 仅在 mic 仍处于关闭态时才 toggle（用户在暂停期间手动开过就不再切回去）。
          if (micMutedRef.current) live.toggleMic();
          setIsPaused(false);
          auth.triggerToast("已恢复面试");
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    flashActive("pause");
    auth.triggerToast(`已暂停 ${DURATION} 秒，AI 正在等你`);
  };

  const handleSkip = () => {
    if (live.status !== "live") return;
    live.sendQuickAction("skip");
    flashActive("skip");
    auth.triggerToast("已发送：本题跳过");
  };

  const handleHint = () => {
    if (live.status !== "live") return;
    live.sendQuickAction("hint");
    flashActive("hint");
    auth.triggerToast("已向 AI 申请关键词提示");
  };

  const handleFeedback = () => {
    setShowFeedbackModal(true);
    flashActive("feedback");
  };

  const submitFeedback = async () => {
    const content = feedbackText.trim();
    if (!content) {
      auth.triggerToast("请输入反馈内容。");
      return;
    }
    if (!liveSession) {
      // 没 session 时只本地 toast（不该发生，但兜底）
      auth.triggerToast("感谢你的反馈！");
      setFeedbackText("");
      setShowFeedbackModal(false);
      return;
    }
    try {
      const res = await fetch(
        `${apiBase}/api/live/sessions/${liveSession.live_session_id}/feedback`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ kind: feedbackKind, content }),
        }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json().catch(() => ({}));
      auth.triggerToast(`反馈已提交`);
      setFeedbackText("");
      setShowFeedbackModal(false);
    } catch (e) {
      console.error("submit feedback failed", e);
      auth.triggerToast("提交失败，请稍后重试");
    }
  };

  // ============================================================
  // 渲染
  // ============================================================

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  const questionRange = durationMin === 10 ? "3~5" : durationMin === 20 ? "7~9" : "5~7";
  const isLive = bootState === "live";
  const isAnalyzing = bootState === "analyzing" || bootState === "ending";

  return (
    <div className="min-h-screen bg-background flex flex-col font-body-md text-on-surface antialiased overflow-x-hidden relative selection:bg-primary/30 selection:text-white pb-0 pt-20">
      {/* Background Gradients */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff03_1px,transparent_1px),linear-gradient(to_bottom,#ffffff03_1px,transparent_1px)] bg-[size:32px_32px] pointer-events-none z-0" />
      <div className="absolute top-[10%] left-[-15%] w-[50%] h-[50%] bg-primary/10 rounded-full blur-[160px] pointer-events-none z-0 animate-pulse" />
      <div className="absolute bottom-[15%] right-[-15%] w-[45%] h-[45%] bg-secondary/80 rounded-full blur-[200px] pointer-events-none z-0 opacity-10" />

      {/* TOP NAV */}
      <nav className="fixed top-0 w-full z-40 bg-surface/80 backdrop-blur-xl border-b border-white/10">
        <div className="px-gutter h-20 max-w-container-max mx-auto flex justify-between items-center relative">
          <div onClick={() => router.push("/")} className="text-2xl font-display-xl font-bold tracking-tight text-on-surface flex items-center gap-2 cursor-pointer">
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
            <a onClick={() => router.push("/debugger")} className="text-on-surface-variant hover:text-on-surface transition-colors text-[16px] md:text-[17px] font-extrabold cursor-pointer">面试调试器</a>
            <a onClick={() => router.push("/memory")} className="text-on-surface-variant hover:text-on-surface transition-colors text-[16px] md:text-[17px] font-extrabold cursor-pointer">职业记忆看板</a>
            <a onClick={() => router.push("/training")} className="text-primary transition-colors text-[16px] md:text-[17px] font-extrabold cursor-pointer relative after:content-[''] after:absolute after:bottom-[-26px] after:left-0 after:right-0 after:h-[2px] after:bg-primary">面试训练场</a>
            <a onClick={() => router.push("/home")} className="text-on-surface-variant hover:text-on-surface transition-colors text-[16px] md:text-[17px] font-extrabold cursor-pointer">职业驾驶舱</a>
            <a onClick={() => router.push("/feedback")} className="text-on-surface-variant hover:text-on-surface transition-colors text-[16px] md:text-[17px] font-extrabold cursor-pointer">体验反馈中心</a>
          </div>
          <div className="flex items-center gap-4">
            <button onClick={() => router.push("/memory?tab=timeline")} className="px-4.5 py-2 bg-white/5 border border-white/10 rounded-full text-sm font-bold text-on-surface hover:bg-white/10 transition-all flex items-center gap-1.5 cursor-pointer">
              <span className="material-symbols-outlined text-base">history</span>历史面试
            </button>
            {auth.isLoggedIn ? <UserMenu /> : (
              <>
                <button onClick={() => auth.setShowLogin(true)} className="px-6 py-2 text-on-surface-variant hover:text-on-surface transition-colors font-medium cursor-pointer">登录</button>
                <button onClick={() => router.push("/register")} className="px-6 py-2 bg-primary text-on-primary font-bold rounded-full scale-95 hover:scale-100 active:scale-95 transition-all shadow-[0_0_20px_rgba(192,193,255,0.3)] cursor-pointer">免费开始</button>
              </>
            )}
          </div>
        </div>
      </nav>

      {/* MAIN */}
      <div className="flex-1 max-w-container-max mx-auto w-full px-gutter py-8 flex flex-col gap-6 relative z-10">
        {bootState === "report" && reportData ? (
          <div className="flex flex-col gap-8 w-full">
            {/* Header Card */}
            <div className="glass-panel p-6 rounded-3xl border-white/10 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div className="space-y-1 text-left">
                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-0.5 rounded-full bg-primary/10 border border-primary/20 text-xs text-primary font-black">AI 模拟面试</span>
                  <span className="text-on-surface-variant/40 text-xs font-mono font-bold">
                    {reportData.created_at ? new Date(reportData.created_at).toLocaleString() : new Date().toLocaleString()}
                  </span>
                </div>
                <h2 className="text-2xl font-black text-white tracking-tight flex items-center gap-2">
                  <span className="material-symbols-outlined text-primary">assessment</span>
                  AI 模拟面试分析报告
                </h2>
                <p className="text-xs text-on-surface-variant/60 font-semibold">
                  目标岗位：<strong className="text-white">{targetRole}</strong> · 难度：<strong className="text-white">{DIFFICULTIES.find(d => d.value === difficulty)?.label}</strong> · 时长：<strong className="text-white">{durationMin} 分钟</strong>
                </p>
              </div>
              <button
                onClick={handleReset}
                className="px-5 py-2.5 bg-gradient-to-r from-secondary to-primary hover:scale-[1.02] active:scale-98 text-on-primary text-xs font-black rounded-xl transition-all shadow-md flex items-center gap-1.5 cursor-pointer shrink-0"
              >
                <span className="material-symbols-outlined text-sm">replay</span>
                重新开始面试
              </button>
            </div>

            {/* Grid: Scores & Summary */}
            <div className="grid grid-cols-12 gap-6 items-stretch w-full text-left">
              {/* Score Panel */}
              <div className="col-span-12 lg:col-span-4 glass-panel p-6 rounded-3xl border-white/10 flex flex-col justify-between items-center text-center gap-6">
                <div className="w-full pb-3 border-b border-white/5 text-left">
                  <h3 className="text-sm font-black text-white uppercase tracking-wider">评测得分</h3>
                </div>
                
                {/* Radial Progress Score */}
                <div className="relative w-40 h-40 flex items-center justify-center">
                  <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
                    <circle cx="50" cy="50" r="40" stroke="rgba(255,255,255,0.03)" strokeWidth="8" fill="transparent" />
                    <circle
                      cx="50"
                      cy="50"
                      r="40"
                      stroke="url(#score-gradient)"
                      strokeWidth="8"
                      fill="transparent"
                      strokeDasharray={251.2}
                      strokeDashoffset={251.2 - (251.2 * (reportData.scores?.ipi ?? 70)) / 100}
                      strokeLinecap="round"
                      className="transition-all duration-1000 ease-out"
                    />
                    <defs>
                      <linearGradient id="score-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor="#c0c1ff" />
                        <stop offset="100%" stopColor="#ffb2b7" />
                      </linearGradient>
                    </defs>
                  </svg>
                  <div className="absolute flex flex-col items-center justify-center">
                    <span className="text-4xl font-black text-white font-label-mono tracking-tighter">
                      {reportData.scores?.ipi ?? 70}
                    </span>
                    <span className="text-[10px] text-on-surface-variant/40 font-bold uppercase tracking-wider mt-1">IPI 综合得分</span>
                  </div>
                </div>

                {/* Offer Probability Badge */}
                <div className="w-full p-4 rounded-2xl bg-white/[0.01] border border-white/5 space-y-1.5 text-left">
                  <div className="flex justify-between items-center text-xs font-bold text-on-surface-variant/70">
                    <span>Offer 获得概率</span>
                    <span className="text-tertiary font-label-mono font-black">{reportData.scores?.offer_probability ?? 0}%</span>
                  </div>
                  <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-secondary to-primary transition-all duration-1000"
                      style={{ width: `${reportData.scores?.offer_probability ?? 0}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* Executive Summary */}
              <div className="col-span-12 lg:col-span-8 glass-panel p-6 rounded-3xl border-white/10 flex flex-col justify-start gap-4">
                <div className="pb-3 border-b border-white/5">
                  <h3 className="text-sm font-black text-white uppercase tracking-wider">总评摘要</h3>
                </div>
                <p className="text-sm leading-relaxed text-on-surface-variant/80 font-medium">
                  {reportData.summary?.executive_summary || "暂无总评摘要"}
                </p>
                
                {/* Strengths & Weaknesses Quick View */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
                  <div className="space-y-2">
                    <span className="text-xs text-primary font-black flex items-center gap-1">
                      <span className="material-symbols-outlined text-sm">check_circle</span>
                      核心优势
                    </span>
                    <ul className="space-y-1.5 text-xs text-on-surface-variant/60 font-semibold pl-1.5 list-disc list-inside">
                      {(reportData.summary?.strengths || []).map((s: string, i: number) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="space-y-2">
                    <span className="text-xs text-secondary font-black flex items-center gap-1">
                      <span className="material-symbols-outlined text-sm">warning</span>
                      薄弱环节
                    </span>
                    <ul className="space-y-1.5 text-xs text-on-surface-variant/60 font-semibold pl-1.5 list-disc list-inside">
                      {(reportData.summary?.weaknesses || []).map((w: string, i: number) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            </div>

            {/* Grid: Capability Dimensions & Suggestions */}
            <div className="grid grid-cols-12 gap-6 items-stretch w-full text-left">
              {/* Dimension Scores */}
              <div className="col-span-12 lg:col-span-6 glass-panel p-6 rounded-3xl border-white/10 flex flex-col gap-5">
                <div className="pb-3 border-b border-white/5">
                  <h3 className="text-sm font-black text-white uppercase tracking-wider flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-base text-primary">analytics</span>
                    维度细分表现
                  </h3>
                </div>
                
                <div className="space-y-4">
                  {[
                    { label: "技术深度", key: "project_depth", icon: "terminal", color: "from-[#c0c1ff] to-[#a8aaff]" },
                    { label: "逻辑表达", key: "logic", icon: "forum", color: "from-[#ffb2b7] to-[#ff99a0]" },
                    { label: "场景架构", key: "system_design", icon: "schema", color: "from-[#5DECCB] to-[#3cd9b7]" },
                    { label: "项目真实度", key: "expression", icon: "verified", color: "from-[#AFA7FF] to-[#8d82ff]" },
                    { label: "沟通主动性", key: "ownership", icon: "psychology", color: "from-[#FF7A95] to-[#ff5274]" }
                  ].map((dim) => {
                    const scoreVal = reportData.scores?.[dim.key] ?? 70;
                    return (
                      <div key={dim.key} className="space-y-1.5">
                        <div className="flex justify-between items-center text-xs">
                          <span className="text-white/80 font-bold flex items-center gap-1.5">
                            <span className="material-symbols-outlined text-sm text-on-surface-variant/50">{dim.icon}</span>
                            {dim.label}
                          </span>
                          <span className="font-label-mono font-black text-white">{scoreVal} 分</span>
                        </div>
                        <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                          <div
                            className={`h-full bg-gradient-to-r ${dim.color} transition-all duration-1000`}
                            style={{ width: `${scoreVal}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Suggestions & Action Plan */}
              <div className="col-span-12 lg:col-span-6 glass-panel p-6 rounded-3xl border-white/10 flex flex-col gap-4">
                <div className="pb-3 border-b border-white/5">
                  <h3 className="text-sm font-black text-white uppercase tracking-wider flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-base text-tertiary">lightbulb</span>
                    针对性改进建议
                  </h3>
                </div>
                
                <div className="flex-1 overflow-y-auto space-y-3.5 pr-1 max-h-[300px] scrollbar-thin">
                  {(reportData.summary?.suggestions || []).map((s: string, idx: number) => (
                    <div key={idx} className="flex gap-3 p-3 rounded-2xl bg-white/[0.01] border border-white/5 hover:bg-white/[0.02] transition-colors">
                      <div className="w-6 h-6 rounded-full bg-tertiary/10 border border-tertiary/20 shrink-0 flex items-center justify-center font-bold text-xs text-tertiary">
                        {idx + 1}
                      </div>
                      <p className="text-xs md:text-sm text-on-surface-variant/80 font-semibold leading-relaxed">
                        {s}
                      </p>
                    </div>
                  ))}
                  {(reportData.summary?.suggestions || []).length === 0 && (
                    <p className="text-xs text-on-surface-variant/40 text-center py-6">暂无推荐改进方案</p>
                  )}
                </div>
              </div>
            </div>

            {/* Dialogue Review Section */}
            <div className="glass-panel p-6 rounded-3xl border-white/10 flex flex-col gap-5 w-full text-left">
              <div className="pb-3 border-b border-white/5">
                <h3 className="text-sm font-black text-white uppercase tracking-wider flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-base text-primary">chat</span>
                  面试对话复盘回顾
                </h3>
              </div>
              
              <div className="space-y-4 max-h-[500px] overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-white/10">
                {(() => {
                  // 后端 content 兼容：可能是 {text, speaker, seq, ...} 或纯字符串
                  const extractText = (line: any): string => {
                    const c = line.content;
                    if (c && typeof c === "object") return (c.text as string) ?? "";
                    if (typeof c === "string") return c;
                    return (line.text as string) ?? "";
                  };
                  // 过滤掉 trim 后的空行：候选人在没说话/ASR 漏识别时会落空字符串，
                  // 不渲染避免出现"空回复气泡"破坏对话流。
                  const nonEmpty = reportTranscript
                    .map((line, idx) => ({ line, idx, text: extractText(line).trim() }))
                    .filter((x) => x.text.length > 0);
                  if (nonEmpty.length === 0) {
                    return <p className="text-xs text-on-surface-variant/40 text-center py-6">未记录到对话转文字内容。</p>;
                  }
                  return nonEmpty.map(({ line, idx, text }) => {
                    const textStr = text; // 已 trim
                    return (
                      <div key={idx} className={`flex items-start gap-4 p-4 rounded-2xl border transition-all ${
                        line.speaker === "Interviewer" || line.role === "interviewer"
                          ? "bg-primary/5 border-primary/10 text-left"
                          : "bg-[#060e20] border-white/5 text-left"
                      }`}>
                        <div className={`w-8 h-8 rounded-full shrink-0 flex items-center justify-center font-bold text-xs select-none ${
                          line.speaker === "Interviewer" || line.role === "interviewer"
                            ? "bg-primary/20 text-primary border border-primary/30"
                            : "bg-tertiary/20 text-tertiary border border-tertiary/30"
                        }`}>
                          {line.speaker === "Interviewer" || line.role === "interviewer" ? "面" : "你"}
                        </div>
                        <div className="space-y-1.5 flex-1 min-w-0">
                          <div className="flex justify-between items-center">
                            <span className="text-[10px] text-on-surface-variant/30 font-bold font-label-mono">
                              {line.speaker === "Interviewer" || line.role === "interviewer" ? "面试官" : "候选人"}
                            </span>
                          </div>
                          <p className="text-xs md:text-sm font-semibold leading-relaxed text-white/90">
                            {textStr}
                          </p>
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-12 gap-6 items-stretch w-full">

            {/* ============ 左：ConfigPanel ============ */}
            <div className="col-span-12 lg:col-span-3 flex flex-col justify-between gap-6 h-full">
              <div className="glass-panel p-5.5 rounded-3xl border-white/10 flex flex-col h-full gap-5.5 text-left">
                <div className="pb-3 border-b border-white/5 shrink-0">
                  <div className="flex justify-between items-start gap-2">
                    <div>
                      <h3 className="text-lg font-black text-white">开始模拟面试</h3>
                      <p className="text-[11px] text-on-surface-variant/40 font-bold mt-1 uppercase tracking-wider">Configure your training</p>
                    </div>
                    {/* PR6: 配额 chip */}
                    {quota && auth.isLoggedIn && (
                      <div className={`shrink-0 px-2.5 py-1 rounded-full border text-[10px] font-black flex items-center gap-1 ${
                        (quota.membership === "pro" || quota.membership === "max")
                          ? "bg-tertiary/10 border-tertiary/30 text-tertiary"
                          : "bg-secondary/10 border-secondary/30 text-secondary"
                      }`}>
                        <span className="material-symbols-outlined text-xs">
                          {quota.membership === "max" ? "diamond" : quota.membership === "pro" ? "workspace_premium" : "schedule"}
                        </span>
                        {quota.used_min}/{quota.limit_min} 分钟
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-4 flex-1 overflow-y-auto pr-1">
                  {/* 1. 目标岗位（必填） */}
                  <div className="space-y-1.5">
                    <label className="text-[13px] md:text-[14px] text-on-surface-variant/50 font-label-mono uppercase tracking-wider font-extrabold block">
                      目标岗位 <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="text"
                      disabled={isLive}
                      value={targetRole}
                      onChange={(e) => setTargetRole(e.target.value)}
                      placeholder="如 后端开发工程师"
                      className="w-full bg-white/[0.02] hover:bg-white/[0.04] border border-white/5 focus:border-primary/50 text-white rounded-xl py-3 px-4 text-sm font-black focus:outline-none transition-all placeholder:text-white/20"
                    />
                  </div>

                  {/* 1.5 岗位详情（选填） */}
                  <div className="space-y-1.5">
                    <div className="flex justify-between items-center">
                      <label className="text-[13px] md:text-[14px] text-on-surface-variant/50 font-label-mono uppercase tracking-wider font-extrabold">
                        岗位详情 [选填]
                      </label>
                      <span className={`text-[10px] font-mono ${
                        jobDescription.length > JD_MAX_LENGTH * 0.9
                          ? jobDescription.length >= JD_MAX_LENGTH ? "text-secondary font-black" : "text-amber-400"
                          : "text-on-surface-variant/30"
                      }`}>
                        {jobDescription.length}/{JD_MAX_LENGTH}
                      </span>
                    </div>
                    <textarea
                      disabled={isLive}
                      value={jobDescription}
                      maxLength={JD_MAX_LENGTH}
                      onChange={(e) => setJobDescription(e.target.value.slice(0, JD_MAX_LENGTH))}
                      placeholder="粘贴岗位 JD（最多 600 字），AI 面试官会基于真实岗位画像出题..."
                      className="w-full py-3 px-4 bg-white/[0.02] hover:bg-white/[0.04] border border-white/5 focus:border-primary/50 text-white rounded-xl text-xs md:text-sm font-semibold focus:outline-none transition-all placeholder:text-white/20 h-28 resize-none scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent overflow-y-auto"
                    />
                  </div>

                  {/* 2. 面试类型（下拉框） */}
                  <div className="space-y-1.5">
                    <label className="text-[13px] md:text-[14px] text-on-surface-variant/50 font-label-mono uppercase tracking-wider font-extrabold block">
                      面试类型
                    </label>
                    <select
                      disabled={isLive}
                      value={interviewType}
                      onChange={(e) => setInterviewType(e.target.value as InterviewType)}
                      className="w-full px-4 py-3 bg-[#060e20] border border-white/10 rounded-xl focus:outline-none focus:border-primary/40 text-xs md:text-sm text-white font-black"
                    >
                      {INTERVIEW_TYPES.map((t) => (
                        <option key={t.value} className="bg-[#0e1626]" value={t.value}>
                          {t.label} · {t.persona}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* 3. 难度等级（PR4 §8.4.1 4 选 1） */}
                  <div className="space-y-1.5">
                    <label className="text-[13px] md:text-[14px] text-on-surface-variant/50 font-label-mono uppercase tracking-wider font-extrabold block">难度等级</label>
                    <div className="grid grid-cols-2 gap-1.5">
                      {DIFFICULTIES.map((d) => (
                        <button
                          key={d.value}
                          disabled={isLive}
                          onClick={() => setDifficulty(d.value)}
                          className={`p-2.5 rounded-xl border text-center transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                            difficulty === d.value
                              ? "bg-secondary/15 border-secondary/50 text-white"
                              : "bg-white/[0.02] border-white/5 text-on-surface-variant hover:bg-white/[0.05]"
                          }`}
                        >
                          <div className="text-sm font-black">{d.label}</div>
                          <div className="text-sm text-on-surface-variant/50 font-bold mt-0.5">{d.speed}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 4. 面试时长（PR4 §8.4.1 3 选 1） */}
                  <div className="space-y-1.5">
                    <label className="text-[13px] md:text-[14px] text-on-surface-variant/50 font-label-mono uppercase tracking-wider font-extrabold block">面试时长</label>
                    <div className="grid grid-cols-3 gap-1.5">
                      {DURATIONS.map((d) => (
                        <button
                          key={d.value}
                          disabled={isLive || (interviewType === "hr_comprehensive" && d.value === 20)}
                          onClick={() => setDurationMin(d.value)}
                          className={`p-2 rounded-xl border text-center transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${
                            durationMin === d.value
                              ? "bg-tertiary/15 border-tertiary/50 text-white"
                              : "bg-white/[0.02] border-white/5 text-on-surface-variant hover:bg-white/[0.05]"
                          }`}
                        >
                          <div className="text-sm font-black">{d.value} 分</div>
                          <div className="text-sm text-on-surface-variant/50 font-bold mt-0.5">{d.qRange}题</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 5. 追问轮数（PR4 §8.4.1 slider 1-3） */}
                  <div className="space-y-1.5">
                    <label className="text-[13px] md:text-[14px] text-on-surface-variant/50 font-label-mono uppercase tracking-wider font-extrabold block">追问轮数</label>
                    <div className="flex items-center gap-3">
                      <input
                        type="range" min={1} max={3} step={1}
                        disabled={isLive}
                        value={followupRounds}
                        onChange={(e) => setFollowupRounds(Number(e.target.value) as FollowupRounds)}
                        className="flex-1 accent-primary cursor-pointer disabled:opacity-50"
                      />
                      <span className="text-sm font-black text-white w-8 text-right font-label-mono">{FOLLOWUP_RANGES[followupRounds]}</span>
                    </div>
                  </div>
                </div>

                {/* 本次训练信息预览 */}
                <div className="p-4 rounded-2xl bg-white/[0.01] border border-white/5 space-y-2 shrink-0">
                  <span className="text-sm text-on-surface-variant/40 font-label-mono tracking-widest uppercase block font-extrabold">本次训练信息</span>
                  <div className="space-y-1.5 text-xs text-on-surface-variant/80 font-bold">
                    <p className="flex justify-between"><span>预计时长:</span><span className="text-white font-black font-label-mono">{durationMin} 分钟</span></p>
                    <p className="flex justify-between"><span>问题数量:</span><span className="text-white font-black font-label-mono">{questionRange} 道</span></p>
                    <p className="flex justify-between"><span>包含追问:</span><span className="text-white font-black font-label-mono">{FOLLOWUP_RANGES[followupRounds]}追问</span></p>
                    <p className="flex justify-between"><span>AI 面试官:</span><span className="text-tertiary font-black">{INTERVIEW_TYPES.find(t => t.value === interviewType)?.persona}</span></p>
                  </div>
                </div>

                <div className="space-y-3 shrink-0">
                  <button
                    disabled={bootState !== "idle" || isCountingDown}
                    onClick={handleStartTraining}
                    className="w-full py-3.5 bg-gradient-to-r from-secondary to-primary text-on-primary text-sm font-black rounded-xl hover:scale-[1.01] active:scale-98 disabled:opacity-50 disabled:scale-100 transition-all shadow-lg shadow-secondary/20 cursor-pointer flex items-center justify-center gap-2 group"
                  >
                    <span className="material-symbols-outlined text-base animate-pulse">play_arrow</span>
                    {isLive ? "正在进行模拟面试" : "开始模拟面试"}
                  </button>
                  {bootState === "error" && (
                    <button onClick={handleReset} className="w-full py-2 bg-white/5 border border-white/10 text-on-surface text-xs font-bold rounded-xl hover:bg-white/10 transition-all cursor-pointer">
                      重新开始
                    </button>
                  )}
                  <span onClick={() => setShowNormsModal(true)} className="text-xs font-bold text-on-surface-variant/30 hover:text-white transition-colors cursor-pointer text-center block">
                    开始即表示同意 <span className="text-primary hover:underline">训练规范与用户权益 →</span>
                  </span>
                </div>
              </div>
            </div>

            {/* ============ 中：LiveStage ============ */}
            <div className="col-span-12 lg:col-span-6 flex flex-col justify-between gap-6 h-full min-w-0">
              <div className="glass-panel p-5.5 rounded-3xl border-white/10 flex flex-col h-full gap-5 relative overflow-hidden">

                {/* Countdown */}
                <AnimatePresence>
                  {isCountingDown && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-[#0b1326]/95 z-30 flex flex-col items-center justify-center gap-6">
                      <div className="w-32 h-32 rounded-full border-4 border-dashed border-primary flex items-center justify-center relative animate-[spin_10s_linear_infinite]">
                        <div className="absolute inset-4 rounded-full border border-double border-white/15" />
                      </div>
                      <div className="absolute flex flex-col items-center justify-center text-center">
                        <motion.span key={countdownNum} initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 1.5, opacity: 0 }} transition={{ duration: 0.5 }} className="text-6xl font-black font-label-mono text-white">
                          {countdownNum}
                        </motion.span>
                        <span className="text-xs text-on-surface-variant/45 font-bold uppercase tracking-widest mt-2">AI 面试官准备中...</span>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* 错误态 */}
                {bootState === "error" && (
                  <div className="flex-1 flex flex-col items-center justify-center p-8 text-center gap-4">
                    <span className="material-symbols-outlined text-6xl text-secondary">error</span>
                    <h3 className="text-xl font-black text-white">连接异常</h3>
                    <p className="text-sm text-on-surface-variant/60">{errorMsg || "未知错误"}</p>
                    <button onClick={handleReset} className="px-6 py-2.5 bg-primary text-on-primary text-sm font-black rounded-xl">重新开始</button>
                  </div>
                )}

                {/* 分析中 */}
                {isAnalyzing && (
                  <div className="flex-1 flex flex-col items-center justify-center p-8 text-center gap-6">
                    {/* Dual-ring spinner */}
                    <div className="relative w-16 h-16">
                      <div className="absolute inset-0 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
                      <div className="absolute inset-2 rounded-full border-4 border-[#5DECCB]/10 border-t-[#5DECCB] animate-spin" style={{ animationDirection: "reverse", animationDuration: "1.1s" }} />
                    </div>

                    <div className="text-center space-y-3">
                      <h3 className="font-black text-white text-2xl md:text-3xl animate-pulse tracking-wide">
                        正在生成 AI 面试报告
                      </h3>
                      <p className="text-base md:text-lg text-white/70 font-semibold">
                        基于你的回答由 DeepSeek 生成深度分析...
                      </p>
                    </div>

                    {/* Progress bar */}
                    <div className="w-full max-w-sm bg-white/5 rounded-full h-1.5 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-primary to-[#5DECCB] transition-all duration-700"
                        style={{ width: `${analysisProgress}%` }}
                      />
                    </div>
                    <p className="text-[#5DECCB] text-2xl md:text-3xl font-black font-mono tracking-wider drop-shadow-[0_0_10px_rgba(93,236,203,0.5)] mt-2">
                      {analysisProgress}%
                    </p>
                  </div>
                )}

                {/* OFFLINE 预览 */}
                {bootState === "idle" && !isCountingDown && (
                  <div className="flex-1 flex flex-col items-center justify-center p-8 text-center gap-6 z-10 select-none">
                    <div className="w-24 h-24 rounded-3xl bg-primary/10 border border-primary/20 flex items-center justify-center shadow-lg relative group overflow-hidden transition-transform duration-300">
                      <div className="absolute inset-0 bg-gradient-to-tr from-primary/15 to-transparent" />
                      <span className="material-symbols-outlined text-primary animate-pulse relative z-10" style={{ fontSize: "56px" }}>support_agent</span>
                    </div>
                    <div className="space-y-2 max-w-md">
                      <h3 className="text-xl font-black text-white">配置完成，准备就绪</h3>
                      <p className="text-xs text-on-surface-variant/50 leading-relaxed font-semibold">
                        点击左下角 <span className="font-black text-white">"开始模拟面试"</span> 按钮即可唤醒你的 AI 资深面试官。系统将基于你选择的「{INTERVIEW_TYPES.find(t => t.value === interviewType)?.label}」+「{DIFFICULTIES.find(d => d.value === difficulty)?.label}」配置进行实时对话。
                      </p>
                    </div>
                  </div>
                )}

                {/* LIVE 状态 */}
                {isLive && (
                  <>
                    <div className="flex justify-between items-center pb-2.5 border-b border-white/5 shrink-0">
                      <div className="flex items-center gap-3">
                        <span className="w-2.5 h-2.5 rounded-full bg-tertiary animate-ping" />
                        <span className="text-sm font-black text-white flex items-center gap-2.5">
                          面试进行中
                          <span className="px-2.5 py-0.5 bg-white/5 rounded border border-white/5 text-xs text-on-surface-variant/60 font-bold font-label-mono">
                            {formatTime(durationSec)}
                          </span>
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button onClick={toggleCamera} className={`px-3 py-1.5 rounded-xl border text-[11px] font-black flex items-center gap-1 cursor-pointer transition-all ${
                          cameraOn ? "bg-primary/10 border-primary text-primary" : "bg-white/5 border-white/5 text-on-surface-variant/50"
                        }`}>
                          <span className="material-symbols-outlined text-sm">{cameraOn ? "videocam" : "videocam_off"}</span>摄像头
                        </button>
                        <button onClick={() => { live.toggleMic(); audio.mute(!micMuted); }} className={`px-3 py-1.5 rounded-xl border text-[11px] font-black flex items-center gap-1 cursor-pointer transition-all ${
                          micMuted ? "bg-white/5 border-white/5 text-on-surface-variant/50" : "bg-tertiary/10 border-tertiary text-tertiary"
                        }`}>
                          <span className="material-symbols-outlined text-sm">{micMuted ? "mic_off" : "mic"}</span>麦克风
                        </button>
                        <button onClick={() => setShowEndConfirm(true)} className="px-3.5 py-1.5 bg-secondary/15 border border-secondary/25 hover:bg-secondary/25 text-secondary rounded-xl text-[11px] font-black cursor-pointer transition-all flex items-center gap-1">
                          <span className="material-symbols-outlined text-sm">cancel</span>结束面试
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 shrink-0 py-1">
                      {/* AI 面试官画面 */}
                      <div className="relative aspect-video w-full rounded-2xl bg-slate-900 border border-white/10 overflow-hidden flex items-center justify-center shadow-2xl group">
                        <img src="/debugger-1.jpg" alt="AI Interviewer" className="w-full h-full object-cover select-none pointer-events-none" />
                        {aiState === "speaking" && <div className="absolute inset-0 bg-primary/5 pointer-events-none border border-primary/20 animate-pulse" />}
                        <span className="absolute left-3.5 top-3 px-2 py-0.5 rounded-lg bg-black/60 backdrop-blur-md text-[10px] text-white/90 font-bold border border-white/5 z-10 flex items-center gap-1">
                          <span className="w-1.5 h-1.5 bg-primary rounded-full animate-ping" />
                          AI 面试官 · {INTERVIEW_TYPES.find(t => t.value === interviewType)?.persona}
                        </span>
                        <div className="absolute right-3.5 top-3 flex items-center gap-0.5 h-3 select-none">
                          {[1, 2, 3, 4, 5].map((b) => (
                            <div key={b} style={{ animationDelay: `${b * 0.15}s` }} className={`w-0.5 bg-primary rounded-full animate-[pulse_0.75s_infinite_alternate] ${aiState === "speaking" ? "h-3.5" : "h-1.5"}`} />
                          ))}
                        </div>
                        <div className="absolute inset-x-3.5 bottom-3.5 p-3 rounded-xl bg-black/85 backdrop-blur-md border border-white/10 text-left z-10">
                          <span className="text-[9px] text-primary font-black font-label-mono uppercase block tracking-wider mb-1">AI 状态</span>
                          <p className="text-[11px] leading-relaxed text-white font-extrabold">
                            {aiState === "idle" && "等候中..."}
                            {aiState === "listening" && "正在聆听你说话"}
                            {aiState === "thinking" && "正在思考下一步"}
                            {aiState === "speaking" && "正在回答..."}
                          </p>
                        </div>
                      </div>

                      {/* 候选人画面 */}
                      {cameraOn ? (
                        <div className="relative aspect-video w-full rounded-2xl bg-slate-900 border border-white/10 overflow-hidden flex items-center justify-center shadow-2xl group">
                          <video
                            ref={videoRefCallback}
                            autoPlay
                            playsInline
                            muted
                            className="w-full h-full object-cover scale-x-[-1]"
                          />
                          <span className="absolute left-3.5 top-3 px-2 py-0.5 rounded-lg bg-black/60 backdrop-blur-md text-[10px] text-white/90 font-bold border border-white/5 z-10 flex items-center gap-1">
                            <span className="w-1.5 h-1.5 bg-tertiary rounded-full animate-ping" />
                            你
                          </span>
                        </div>
                      ) : (
                        <div
                          onClick={toggleCamera}
                          className="relative aspect-video w-full rounded-2xl bg-slate-900 border border-white/10 overflow-hidden flex items-center justify-center shadow-2xl group cursor-pointer hover:border-primary/40 transition-colors"
                        >
                          <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center bg-gradient-to-b from-[#141b2e] to-slate-950 gap-3 select-none">
                            <div className="w-12 h-12 rounded-full border border-white/10 flex items-center justify-center bg-white/[0.01] group-hover:scale-105 transition-transform">
                              <span className="material-symbols-outlined text-2xl text-on-surface-variant/40 animate-pulse">videocam_off</span>
                            </div>
                            <p className="text-[10px] text-on-surface-variant/45 font-bold leading-normal max-w-[180px]">
                              候选人画面已关闭，点击开启摄像头。
                            </p>
                          </div>
                          <span className="absolute left-3.5 top-3 px-2 py-0.5 rounded-lg bg-black/60 backdrop-blur-md text-[10px] text-white/90 font-bold border border-white/5 z-10 flex items-center gap-1">
                            <span className="w-1.5 h-1.5 bg-white/30 rounded-full" />
                            你 (未开启)
                          </span>
                        </div>
                      )}
                    </div>

                    {/* AI 状态小提示 */}
                    <div className="p-3 rounded-2xl bg-white/[0.01] border border-white/5 flex items-center justify-between gap-4 text-xs font-semibold text-on-surface-variant/60">
                      <span className="flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-base text-[#c0c1ff]">lightbulb</span>
                        提示：回答时尽量使用 PREP 框架（Point-Reason-Example-Point），表达更有条理。
                      </span>
                      <span className="text-xs text-[#ffb2b7] font-bold font-label-mono shrink-0 flex items-center gap-1">
                        {aiState === "listening" ? "聆听中" : aiState === "thinking" ? "思考中" : aiState === "speaking" ? "回答中" : "等待中"}
                        <span className="w-1.5 h-1.5 rounded-full bg-primary animate-ping" />
                      </span>
                    </div>
                  </>
                )}

                {/* TABS + 对话流 */}
                {isLive && (
                  <div className="border-t border-white/5 pt-5 space-y-4 flex-1 flex flex-col min-h-0 text-left">
                    <div className="flex items-center gap-5 border-b border-white/5 pb-2 font-black text-xs md:text-[13px] select-none shrink-0">
                      <span className="text-white border-b-2 border-primary pb-2 cursor-pointer relative z-10">实时对话</span>
                      <span className="text-on-surface-variant/45 cursor-not-allowed" title="PR5 接入">面试笔记</span>
                      <span className="text-on-surface-variant/45 cursor-not-allowed" title="PR5 接入">AI 建议</span>
                    </div>
                    <div ref={transcriptContainerRef} className="space-y-3 flex-1 overflow-y-auto pr-1 min-h-0 max-h-[560px] scrollbar-thin scrollbar-thumb-white/10">
                      {transcript.length === 0 && (
                        <p className="text-xs text-on-surface-variant/40 text-center py-6">等待面试官的开场白...</p>
                      )}
                      {transcript.map((line, idx) => (
                        <div key={idx} className="flex items-start gap-3">
                          <div className={`w-7.5 h-7.5 rounded-full shrink-0 flex items-center justify-center font-bold text-xs select-none ${
                            line.role === "interviewer" ? "bg-primary/20 text-primary border border-primary/30" : "bg-tertiary/20 text-tertiary border border-tertiary/30"
                          }`}>
                            {line.role === "interviewer" ? "面" : "你"}
                          </div>
                          <div className="space-y-1 flex-1 min-w-0">
                            <p className={`text-[12px] font-bold leading-relaxed pr-6 ${line.partial ? "text-on-surface-variant/50 italic" : "text-on-surface-variant/80"}`}>
                              {line.text || "..."}
                            </p>
                          </div>
                        </div>
                      ))}
                      <div ref={transcriptEndRef} />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* ============ 右：TimelinePanel ============ */}
            <div className="col-span-12 lg:col-span-3 flex flex-col justify-between gap-6 h-full text-left">
              {/* 进度 */}
              <div className="glass-panel p-5.5 rounded-3xl border-white/10 flex flex-col justify-start gap-4">
                <div className="flex justify-between items-center pb-2.5 border-b border-white/5 shrink-0">
                  <h4 className="text-base font-black text-white flex items-center gap-2">
                    <span className="material-symbols-outlined text-lg text-primary">schedule</span>
                    面试进度
                  </h4>
                  <span className="text-xs text-primary font-black font-label-mono flex items-center gap-0.5">
                    <span className="material-symbols-outlined text-xs">hourglass_empty</span>
                    {formatTime(durationSec)} / {durationMin.toString().padStart(2, "0")}:00
                  </span>
                </div>
                <div className="space-y-3 py-1 mt-[-2px]">
                  <div className="flex justify-between text-sm font-bold text-on-surface-variant/70">
                    <span>已进行</span>
                    <span className="text-white font-label-mono">{Math.round((durationSec / (durationMin * 60)) * 100)}%</span>
                  </div>
                  <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-primary to-secondary transition-all duration-300" style={{ width: `${Math.min(100, (durationSec / (durationMin * 60)) * 100)}%` }} />
                  </div>
                  <div className="text-sm text-on-surface-variant/50 font-bold pt-1">
                    预计问题数 {questionRange} 道
                  </div>
                </div>
              </div>

              {/* 当前 AI 状态 */}
              <div className="glass-panel p-5.5 rounded-3xl border-white/10 flex flex-col justify-start gap-4">
                <div className="flex justify-between items-center pb-2.5 border-b border-white/5 shrink-0 select-none">
                  <h4 className="text-base font-black text-white flex items-center gap-2">
                    <span className="material-symbols-outlined text-lg text-secondary">graphic_eq</span>
                    AI 状态
                  </h4>
                  <span className="text-[13px] md:text-base font-bold text-on-surface-variant/50">
                    {aiState === "idle" ? "等候" : aiState === "listening" ? "聆听" : aiState === "thinking" ? "思考" : aiState === "speaking" ? "回答" : aiState}
                  </span>
                </div>
                <div className="space-y-2">
                  {[
                    { label: "等候", state: "idle", color: "bg-white/5" },
                    { label: "聆听", state: "listening", color: "bg-tertiary" },
                    { label: "思考", state: "thinking", color: "bg-amber-400" },
                    { label: "回答", state: "speaking", color: "bg-primary" },
                  ].map((s) => (
                    <div key={s.state} className="flex items-center gap-2 text-base">
                      <span className={`w-2 h-2 rounded-full ${s.color} ${aiState === s.state ? "animate-pulse" : "opacity-40"}`} />
                      <span className={aiState === s.state ? "text-white font-black" : "text-on-surface-variant/40 font-bold"}>{s.label}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* AI 面试官信息 */}
              <div className="glass-panel p-5.5 rounded-3xl border-white/10 flex flex-col justify-start gap-4">
                <div className="flex justify-between items-center pb-2.5 border-b border-white/5 shrink-0">
                  <h4 className="text-base font-black text-white flex items-center gap-2">
                    <span className="material-symbols-outlined text-lg text-tertiary">assignment_ind</span>
                    AI 面试官
                  </h4>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full border border-tertiary/20 overflow-hidden bg-slate-900 shrink-0">
                    <img src="/debugger-1.jpg" className="w-full h-full object-cover" />
                  </div>
                  <div className="space-y-0.5 min-w-0">
                    <div className="text-base font-black text-white">{INTERVIEW_TYPES.find(t => t.value === interviewType)?.persona}</div>
                    <div className="text-sm text-on-surface-variant/50 font-bold">{DIFFICULTIES.find(d => d.value === difficulty)?.label} · 语速 {DIFFICULTIES.find(d => d.value === difficulty)?.speed}</div>
                  </div>
                </div>
              </div>

              {/* 快捷操作 */}
              <div className="glass-panel p-5.5 rounded-3xl border-white/10 flex flex-col justify-start gap-4 shrink-0 relative">
                <div className="flex justify-between items-center pb-2.5 border-b border-white/5 shrink-0 select-none">
                  <h4 className="text-base font-black text-white flex items-center gap-2">
                    <span className="material-symbols-outlined text-lg text-primary">touch_app</span>
                    快捷操作
                  </h4>
                  {isPaused && (
                    <span className="text-[10px] font-black text-secondary font-label-mono flex items-center gap-1 animate-pulse">
                      <span className="material-symbols-outlined text-xs">pause_circle</span>
                      暂停中 {pauseCountdown}s
                    </span>
                  )}
                </div>

                <AnimatePresence>
                  {showHandBadge && (
                    <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.8, opacity: 0 }} className="absolute inset-x-5.5 top-15 p-2 rounded-xl bg-primary/20 text-primary border border-primary/30 text-center text-xs font-black z-20 flex items-center justify-center gap-1.5">
                      <span className="material-symbols-outlined text-sm animate-bounce">pan_tool</span>
                      已发送举手信号...
                    </motion.div>
                  )}
                </AnimatePresence>

                <div className="grid grid-cols-2 gap-2 mt-[-2px]">
                  <button
                    disabled={!isLive || isPaused}
                    onClick={handlePause}
                    className={`p-3 rounded-2xl border flex flex-col items-center justify-center gap-2 text-center transition-all cursor-pointer group disabled:opacity-30 disabled:cursor-not-allowed ${
                      activeAction === "pause" || isPaused
                        ? "bg-secondary/20 border-secondary text-secondary"
                        : "bg-white/[0.01] border-white/5 hover:border-white/10"
                    }`}
                  >
                    <span className={`material-symbols-outlined text-base ${activeAction === "pause" || isPaused ? "text-secondary" : "text-on-surface-variant/40 group-hover:text-primary"}`}>
                      {isPaused ? "pause_circle" : "pause"}
                    </span>
                    <span className={`text-sm font-black ${isPaused ? "text-secondary" : "text-on-surface-variant/60"}`}>
                      {isPaused ? `${pauseCountdown}s` : "暂停 30s"}
                    </span>
                  </button>
                  <button
                    disabled={!isLive}
                    onClick={handleSkip}
                    className={`p-3 rounded-2xl border flex flex-col items-center justify-center gap-2 text-center transition-all cursor-pointer group disabled:opacity-30 disabled:pointer-events-none ${
                      activeAction === "skip"
                        ? "bg-primary/20 border-primary text-primary"
                        : "bg-white/[0.01] border-white/5 hover:border-white/10"
                    }`}
                  >
                    <span className={`material-symbols-outlined text-base ${activeAction === "skip" ? "text-primary" : "text-on-surface-variant/40 group-hover:text-primary"}`}>
                      skip_next
                    </span>
                    <span className={`text-sm font-black ${activeAction === "skip" ? "text-primary" : "text-on-surface-variant/60"}`}>
                      跳过本题
                    </span>
                  </button>
                  <button
                    disabled={!isLive}
                    onClick={handleHint}
                    className={`p-3 rounded-2xl border flex flex-col items-center justify-center gap-2 text-center transition-all cursor-pointer group disabled:opacity-30 disabled:pointer-events-none ${
                      activeAction === "hint"
                        ? "bg-tertiary/20 border-tertiary text-tertiary"
                        : "bg-white/[0.01] border-white/5 hover:border-white/10"
                    }`}
                  >
                    <span className={`material-symbols-outlined text-base ${activeAction === "hint" ? "text-tertiary" : "text-on-surface-variant/40 group-hover:text-primary"}`}>
                      lightbulb
                    </span>
                    <span className={`text-sm font-black ${activeAction === "hint" ? "text-tertiary" : "text-on-surface-variant/60"}`}>
                      关键词提示
                    </span>
                  </button>
                  <button
                    disabled={!isLive}
                    onClick={handleFeedback}
                    className={`p-3 rounded-2xl border flex flex-col items-center justify-center gap-2 text-center transition-all cursor-pointer group disabled:opacity-30 disabled:pointer-events-none ${
                      activeAction === "feedback"
                        ? "bg-amber-500/20 border-amber-500 text-amber-500"
                        : "bg-white/[0.01] border-white/5 hover:border-white/10"
                    }`}
                  >
                    <span className={`material-symbols-outlined text-base ${activeAction === "feedback" ? "text-amber-500" : "text-on-surface-variant/40 group-hover:text-primary"}`}>
                      flag
                    </span>
                    <span className={`text-sm font-black ${activeAction === "feedback" ? "text-amber-500" : "text-on-surface-variant/60"}`}>
                      反馈
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* FOOTER */}
      <footer className="bg-surface-container-lowest border-t border-white/5 w-full block mt-8 relative z-10 shrink-0">
        <div className="px-gutter py-8 max-w-container-max mx-auto flex flex-col md:flex-row justify-between items-center gap-4 text-left">
          <span className="text-[10px] text-on-surface-variant/30 font-label-mono font-bold tracking-widest block text-left">
            © 2026 面试VAR AI. All rights reserved.
          </span>
          <div className="flex gap-8 text-xs text-on-surface-variant font-label-mono font-bold tracking-widest">
            <span onClick={() => router.push("/")} className="hover:text-primary transition-colors cursor-pointer select-none">服务条款</span>
            <span onClick={() => router.push("/")} className="hover:text-primary transition-colors cursor-pointer select-none">隐私政策</span>
            <span onClick={() => router.push("/")} className="hover:text-primary transition-colors cursor-pointer select-none">联系方式</span>
          </div>
        </div>
      </footer>

      {/* 结束确认 Modal */}
      <AnimatePresence>
        {showEndConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowEndConfirm(false)} className="absolute inset-0 bg-surface/60 backdrop-blur-md" />
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className="bg-surface-container-high border border-white/10 rounded-3xl p-6.5 max-w-md w-full text-left relative z-10 space-y-5 shadow-2xl">
              <div className="flex justify-between items-center pb-3.5 border-b border-white/5">
                <h3 className="font-extrabold text-white text-base flex items-center gap-2">
                  <span className="material-symbols-outlined text-secondary">cancel</span>
                  提前结束面试？
                </h3>
                <button onClick={() => setShowEndConfirm(false)} className="text-on-surface-variant hover:text-white transition-colors cursor-pointer flex items-center justify-center w-7 h-7 rounded-lg hover:bg-white/5">
                  <span className="material-symbols-outlined text-base">close</span>
                </button>
              </div>
              <p className="text-xs text-on-surface-variant font-semibold leading-relaxed">
                结束后系统会自动生成 AI 面试报告（约 30-90 秒）。确定要结束吗？
              </p>
              <div className="flex justify-end gap-3 pt-2">
                <button onClick={() => setShowEndConfirm(false)} className="px-4 py-2 bg-white/5 hover:bg-white/10 text-white text-xs font-black rounded-lg border border-white/10 transition-all cursor-pointer">
                  继续面试
                </button>
                <button onClick={handleEnd} className="px-4.5 py-2 bg-secondary text-on-primary text-xs font-black rounded-lg transition-all shadow-md cursor-pointer">
                  确定结束
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* 训练规范与用户权益 Modal */}
      <AnimatePresence>
        {showNormsModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowNormsModal(false)} className="absolute inset-0 bg-[#050B1A]/80 backdrop-blur-md" />
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className="bg-[#0e1626]/95 border border-white/10 rounded-3xl max-w-2xl w-full text-left relative z-10 shadow-2xl max-h-[85vh] flex flex-col overflow-hidden">
              {/* 固定 header（不参与滚动） */}
              <div className="shrink-0 flex justify-between items-center px-6 pt-5 pb-3 border-b border-white/5 bg-[#0e1626]">
                <h3 className="font-extrabold text-white text-lg flex items-center gap-2">
                  <span className="material-symbols-outlined text-primary">policy</span>
                  训练规范与用户权益
                </h3>
                <button onClick={() => setShowNormsModal(false)} className="text-white/40 hover:text-white transition-colors cursor-pointer flex items-center justify-center w-8 h-8 rounded-lg hover:bg-white/5">
                  <span className="material-symbols-outlined text-lg">close</span>
                </button>
              </div>

              {/* 滚动内容区（flex-1 + overflow-y-auto） */}
              <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5 text-sm text-on-surface-variant leading-relaxed font-medium scrollbar-thin scrollbar-thumb-white/10">
                {/* 1. 服务说明 */}
                <section>
                  <h4 className="text-white font-black text-base mb-2 flex items-center gap-2">
                    <span className="material-symbols-outlined text-primary text-base">info</span>
                    1. 服务说明
                  </h4>
                  <p>
                    「面试训练场」是基于豆包实时语音大模型（火山引擎）提供的 AI 模拟面试服务。
                    候选人可在浏览器中与 AI 面试官进行实时语音对话，AI 基于岗位画像提问、追问并给出反馈。
                  </p>
                </section>

                {/* 2. 数据采集与隐私 */}
                <section>
                  <h4 className="text-white font-black text-base mb-2 flex items-center gap-2">
                    <span className="material-symbols-outlined text-tertiary text-base">verified_user</span>
                    2. 数据采集与隐私保护
                  </h4>
                  <ul className="list-disc pl-5 space-y-1.5">
                    <li>面试中浏览器采集的<strong className="text-white">麦克风音频仅在本地加密传输到火山引擎</strong>用于实时识别，<strong className="text-white">不会上传到 OfferPilot 服务器</strong>。</li>
                    <li>面试结束<strong className="text-white">仅在分析完成后</strong>，识别出的<strong className="text-white">文字</strong>会被持久化到数据库，用于生成报告。</li>
                    <li>原始音频 PCM 流<strong className="text-white">不会被录制</strong>、不会被保存。</li>
                    <li>所有数据按会员等级对应的<strong className="text-white">保留期</strong>自动清理（免费 7 天 / PRO 30 天 / MAX 120 天）。</li>
                  </ul>
                </section>

                {/* 3. AI 回复免责 */}
                <section>
                  <h4 className="text-white font-black text-base mb-2 flex items-center gap-2">
                    <span className="material-symbols-outlined text-secondary text-base">warning</span>
                    3. AI 回复免责声明
                  </h4>
                  <p>
                    AI 面试官的回答由大模型实时生成，<strong className="text-white">可能存在事实性错误、逻辑偏差或不恰当表达</strong>。
                    面试VAR 不保证 AI 反馈的绝对准确性，所有报告<strong className="text-white">仅供求职者练习参考</strong>，
                    不构成任何职业建议或录用承诺。
                  </p>
                </section>

                {/* 4. 时长统计与计费 */}
                <section>
                  <h4 className="text-white font-black text-base mb-2 flex items-center gap-2">
                    <span className="material-symbols-outlined text-amber-400 text-base">schedule</span>
                    4. 时长统计与计费规则
                  </h4>
                  <ul className="list-disc pl-5 space-y-1.5">
                    <li>系统按<strong className="text-white">自然周和自然月</strong>统计实时面试总时长，单位为分钟。</li>
                    <li><strong className="text-white">用户提前结束面试也会正常计入时长和归档分析</strong>，不退款。</li>
                    <li>免费会员：<strong className="text-white">0 分钟</strong>（不可使用实时模拟面试）。</li>
                    <li>PRO 会员：每月 <strong className="text-white">60 分钟</strong> 上限。</li>
                    <li>MAX 会员：每月 <strong className="text-white">120 分钟</strong> 上限。</li>
                    <li>超出上限的实时面试请求将被拒绝，但已开始的会话不受影响。</li>
                  </ul>
                </section>

                {/* 5. 用户行为规范 */}
                <section>
                  <h4 className="text-white font-black text-base mb-2 flex items-center gap-2">
                    <span className="material-symbols-outlined text-secondary text-base">gavel</span>
                    5. 用户行为规范
                  </h4>
                  <p>禁止以下行为，违者将被永久封禁且不予退款：</p>
                  <ul className="list-disc pl-5 space-y-1.5">
                    <li>用脚本、机器人、伪造身份等手段滥用服务。</li>
                    <li>对 AI 面试官进行恶意诱导、Prompt 注入或试图越权获取系统信息。</li>
                    <li>录制、转售、公开分享本服务的输出内容用于商业用途。</li>
                    <li>利用本服务生成违法违规、歧视性或骚扰性内容。</li>
                  </ul>
                </section>

                {/* 6. 退款与售后 */}
                <section>
                  <h4 className="text-white font-black text-base mb-2 flex items-center gap-2">
                    <span className="material-symbols-outlined text-primary text-base">support_agent</span>
                    6. 退款与售后
                  </h4>
                  <p>
                    付费会员开通后<strong className="text-white">7 天内未使用实时模拟面试</strong>（用量为 0 分钟）可申请全额退款；
                    已使用部分按 PRO 0.5 元/分钟、MAX 0.3 元/分钟扣除。技术问题请联系
                    <a className="text-primary hover:underline ml-1" href="mailto:support@interviewvar.com">interviewVar@163.com</a>。
                  </p>
                </section>

                {/* 7. 协议变更 */}
                <section>
                  <h4 className="text-white font-black text-base mb-2 flex items-center gap-2">
                    <span className="material-symbols-outlined text-on-surface-variant text-base">edit_note</span>
                    7. 协议变更
                  </h4>
                  <p>
                    面试VAR 保留根据法律法规变化或业务调整需要修订本规范的权利。
                    重大变更将通过站内信、邮件或登录页弹窗提前 7 天通知。
                    继续使用即视为接受修订后的规范。
                  </p>
                </section>
              </div>

              {/* 固定 footer（不参与滚动） */}
              <div className="shrink-0 flex justify-between items-center px-6 py-3 border-t border-white/5 bg-[#0e1626]">
                <span className="text-[10px] text-on-surface-variant/40 font-mono">
                  最后更新：2026-06-19 · v1.0
                </span>
                <button onClick={() => setShowNormsModal(false)} className="px-5 py-2 bg-primary text-on-primary text-sm font-black rounded-xl hover:scale-[1.02] active:scale-98 transition-all cursor-pointer">
                  我已阅读并同意
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* 反馈 Modal */}
      <AnimatePresence>
        {showFeedbackModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowFeedbackModal(false)} className="absolute inset-0 bg-surface/60 backdrop-blur-md" />
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className="bg-surface-container-high border border-white/10 rounded-3xl p-6.5 max-w-md w-full text-left relative z-10 space-y-5 shadow-2xl">
              <div className="flex justify-between items-center pb-3.5 border-b border-white/5">
                <h3 className="font-extrabold text-white text-base flex items-center gap-2">
                  <span className="material-symbols-outlined text-primary">flag</span>
                  提交面试反馈
                </h3>
                <button onClick={() => setShowFeedbackModal(false)} className="text-on-surface-variant hover:text-white transition-colors cursor-pointer flex items-center justify-center w-7 h-7 rounded-lg hover:bg-white/5">
                  <span className="material-symbols-outlined text-base">close</span>
                </button>
              </div>
              <div className="space-y-4 text-xs font-semibold text-white">
                <div className="space-y-1.5 text-left">
                  <label className="text-on-surface-variant font-bold">反馈类型</label>
                  <select
                    value={feedbackKind}
                    onChange={(e) => setFeedbackKind(e.target.value as any)}
                    className="w-full px-4 py-2.5 bg-[#060e20] border border-white/10 rounded-xl focus:outline-none focus:border-primary/40 text-xs text-white font-black"
                  >
                    <option value="tech_question">题目 / 提问</option>
                    <option value="voice">声音 / 语速</option>
                    <option value="ux">交互 / 体验</option>
                    <option value="other">其他</option>
                  </select>
                </div>
                <div className="space-y-1.5 text-left">
                  <label className="text-on-surface-variant font-bold">详细描述</label>
                  <textarea
                    rows={4}
                    value={feedbackText}
                    onChange={(e) => setFeedbackText(e.target.value)}
                    placeholder="例如：AI 面试官声音异常，语速过快，或者建议增加某一类场景考查..."
                    className="w-full bg-white/[0.02] border border-white/10 focus:border-primary/50 text-white rounded-xl py-3 px-4 text-xs font-semibold focus:outline-none transition-all placeholder:text-on-surface-variant/30"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button onClick={() => setShowFeedbackModal(false)} className="px-4 py-2 bg-white/5 hover:bg-white/10 text-white text-xs font-black rounded-lg border border-white/10 transition-all cursor-pointer">取消</button>
                <button onClick={submitFeedback} className="px-4.5 py-2 bg-primary text-on-primary text-xs font-black rounded-lg shadow-md cursor-pointer">提交反馈</button>
              </div>
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
                  Mock Interview
                </span>
                <h3 className="text-2xl font-black text-white leading-tight">登录解锁你的面试训练场</h3>
                <p className="text-sm text-on-surface-variant/70 font-semibold leading-relaxed">
                  提供真实的企业级实时语音模拟面试，还原面试真实场景，根据表现评估出具针对性的多维分析报告与改善计划。
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

export default function InterviewTrainingPage() {
  return (
    <React.Suspense fallback={
      <div className="min-h-screen bg-[#050B1A] text-white flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-primary"></div>
      </div>
    }>
      <InterviewTrainingPageContent />
    </React.Suspense>
  );
}
