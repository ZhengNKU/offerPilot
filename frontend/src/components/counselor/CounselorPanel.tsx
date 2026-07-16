"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useAuth } from "@/components/AuthProvider";
import {
  streamCounselor,
  listSessions,
  getSession,
  deleteSession,
  stopSession,
  type MessageItem,
  type SessionListItem,
  type RecalledChunk,
  type ContextSummary,
  type Citation,
  type CounselorStats,
  type ToolCallEvent,
} from "@/lib/counselorClient";
import ChatBubble from "./ChatBubble";

interface PendingAssistant {
  role: "assistant";
  content: string;
  citations: Citation[];
  recalledChunks: RecalledChunk[];
  contextSummary: ContextSummary | null;
  streaming: boolean;
}

let lastAutoSentPrompt: string | null = null;
let activeAbortController: AbortController | null = null;
let abortTimeoutId: any = null;

const WELCOME_CARDS = [
  {
    title: "我如何拿到心仪的 offer？",
    prompt: "我如何拿到心仪的 offer？",
    subtitle: "基于完整能力的求职策略优化",
    icon: "grade",
    iconColor: "text-purple-400 bg-purple-500/10 border-purple-500/20",
  },
  {
    title: "我该如何展示项目亮点？",
    prompt: "我该如何展示项目亮点？",
    subtitle: "提炼项目深度与核心技术贡献",
    icon: "lightbulb",
    iconColor: "text-amber-400 bg-amber-500/10 border-amber-500/20",
  },
  {
    title: "我的技术栈是否匹配目标岗位？",
    prompt: "我的技术栈是否匹配目标岗位？",
    subtitle: "评估技术栈契合度与学习建议",
    icon: "account_circle",
    iconColor: "text-blue-400 bg-blue-500/10 border-blue-500/20",
  },
  {
    title: "我最近的面试有什么不足？",
    prompt: "我最近的面试有什么不足？",
    subtitle: "回顾过往表现，查漏补缺",
    icon: "adjust",
    iconColor: "text-red-400 bg-red-500/10 border-red-500/20",
  },
];

interface Props {
  /** 嵌入风格：full = 独立页样式，compact = 嵌在卡片内（隐藏外层 padding/背景） */
  variant?: "full" | "compact";
  // Lifted state props (optional for backwards compatibility)
  currentSessionId?: number | null;
  setCurrentSessionId?: React.Dispatch<React.SetStateAction<number | null>> | ((id: number | null) => void);
  sessions?: SessionListItem[];
  setSessions?: React.Dispatch<React.SetStateAction<SessionListItem[]>>;
  loadSessions?: () => Promise<void>;
  loadSession?: (sid: number) => Promise<void>;
  newSession?: () => void;
  handleDeleteSession?: (sid: number) => Promise<void> | void;
  messages?: MessageItem[];
  setMessages?: React.Dispatch<React.SetStateAction<MessageItem[]>>;
  input?: string;
  setInput?: React.Dispatch<React.SetStateAction<string>> | ((val: string) => void);
  streaming?: boolean;
  setStreaming?: React.Dispatch<React.SetStateAction<boolean>> | ((val: boolean) => void);
  pending?: PendingAssistant | null;
  setPending?: React.Dispatch<React.SetStateAction<PendingAssistant | null>>;
  remaining?: number | null;
  setRemaining?: React.Dispatch<React.SetStateAction<number | null>> | ((r: number | null) => void);
  stats?: CounselorStats | null;
  autoSendPrompt?: string | null;
  onClearAutoSendPrompt?: () => void;
}

export default function CounselorPanel(props: Props) {
  const variant = props.variant ?? "compact";
  const auth = useAuth();

  // State fallback
  const [internalSessions, setInternalSessions] = useState<SessionListItem[]>([]);
  const sessions = props.sessions !== undefined ? props.sessions : internalSessions;
  const setSessions = props.setSessions || setInternalSessions;

  const [internalCurrentSessionId, setInternalCurrentSessionId] = useState<number | null>(null);
  const currentSessionId = props.currentSessionId !== undefined ? props.currentSessionId : internalCurrentSessionId;
  const setCurrentSessionId = props.setCurrentSessionId || setInternalCurrentSessionId;

  const [internalMessages, setInternalMessages] = useState<MessageItem[]>([]);
  const messages = props.messages !== undefined ? props.messages : internalMessages;
  const setMessages = props.setMessages || setInternalMessages;

  const [internalInput, setInternalInput] = useState("");
  const input = props.input !== undefined ? props.input : internalInput;
  const setInput = props.setInput || setInternalInput;

  const [internalStreaming, setInternalStreaming] = useState(false);
  const streaming = props.streaming !== undefined ? props.streaming : internalStreaming;
  const setStreaming = props.setStreaming || setInternalStreaming;

  const [internalPending, setInternalPending] = useState<PendingAssistant | null>(null);
  const pending = props.pending !== undefined ? props.pending : internalPending;
  const setPending = props.setPending || setInternalPending;

  // 当前在飞的工具调用（phase=start 进入，end 移除）。仅 UI 用，不入库
  const [pendingTools, setPendingTools] = useState<ToolCallEvent[]>([]);
  // 记录本轮已执行的工具历史，用于 pending 泡泡渲染
  const [executedToolCalls, setExecutedToolCalls] = useState<any[]>([]);

  const [internalRemaining, setInternalRemaining] = useState<number | null>(null);
  const remaining = props.remaining !== undefined ? props.remaining : internalRemaining;
  const setRemaining = props.setRemaining || setInternalRemaining;

  const stats = props.stats ?? null;

  // 当前流式任务的 AbortController；切走/停止/卸载都会 abort
  const abortControllerRef = useRef<AbortController | null>(null);
  // 消息区滚动容器的 ref；只滚这个容器，不影响外层页面
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  // 记录已经自动发送的 prompt 防止 StrictMode 下重复触发
  const autoSentRef = useRef<string | null>(null);

  // Load functions fallback
  const loadSessions = props.loadSessions || useCallback(async () => {
    if (!auth.isLoggedIn) return;
    try {
      const r = await listSessions();
      setSessions(r.sessions);
    } catch (e) {
      console.error("load sessions failed:", e);
    }
  }, [auth.isLoggedIn, setSessions]);

  useEffect(() => {
    if (props.sessions === undefined) {
      loadSessions();
    }
  }, [loadSessions, props.sessions]);

  const loadSession = props.loadSession || useCallback(async (sid: number) => {
    try {
      const r = await getSession(sid);
      setMessages(r.session.messages as MessageItem[]);
      setCurrentSessionId(sid);
      setPending(null);
    } catch (e) {
      console.error("load session failed:", e);
    }
  }, [setMessages, setCurrentSessionId, setPending]);

  const newSession = props.newSession || (() => {
    setCurrentSessionId(null);
    setMessages([]);
    setPending(null);
  });

  const handleDeleteSession = props.handleDeleteSession || (async (sid: number) => {
    if (!confirm("确认删除此会话？")) return;
    try {
      await deleteSession(sid);
      if (currentSessionId === sid) newSession();
      await loadSessions();
    } catch (e: any) {
      auth.triggerToast("删除失败：" + e.message);
    }
  });

  // 主动停止当前会话：调后端 stop 接口 + 中断 SSE fetch
  const stopStreaming = useCallback(() => {
    const ctrl = abortControllerRef.current;
    if (!ctrl) return;
    // 调后端 stop（fire-and-forget，401/网络错误也不影响 abort）
    if (currentSessionId != null) {
      stopSession(currentSessionId).catch(() => { /* swallow */ });
    }
    ctrl.abort();
  }, [currentSessionId]);

  // 页面离开 / tab 切换 / 组件卸载：自动 abort 在飞流
  useEffect(() => {
    if (abortTimeoutId) {
      clearTimeout(abortTimeoutId);
      abortTimeoutId = null;
    }

    const onBeforeUnload = () => {
      if (abortControllerRef.current) {
        // 关闭 SSE → 触发后端 CancelledError → 后端落 partial
        abortControllerRef.current.abort();
      }
    };
    const onVisibilityChange = () => {
      if (
        typeof document !== "undefined" &&
        document.visibilityState === "hidden" &&
        abortControllerRef.current
      ) {
        if (currentSessionId != null) {
          stopSession(currentSessionId).catch(() => { /* swallow */ });
        }
        abortControllerRef.current.abort();
      }
    };
    if (typeof window !== "undefined") {
      window.addEventListener("beforeunload", onBeforeUnload);
      document.addEventListener("visibilitychange", onVisibilityChange);
    }
    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("beforeunload", onBeforeUnload);
        document.removeEventListener("visibilitychange", onVisibilityChange);
      }
      // 组件卸载（路由跳转）也 abort (延时 50ms 以防 StrictMode remount 误杀)
      abortTimeoutId = setTimeout(() => {
        if (activeAbortController) {
          activeAbortController.abort();
        }
      }, 50);
    };
    // 只在挂载时注册一次；stopStreaming 通过 ref.current 闭包访问
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 发送消息
  const sendMessage = async (text: string) => {
    const message = text.trim();
    if (!message || streaming) return;
    setInput("");

    const tempUserMsg: MessageItem = {
      id: -Date.now(),
      role: "user",
      content: message,
      citations: [],
      recalled_chunks: [],
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempUserMsg]);

    // 新消息发出后，只滚"消息区"这个滚动容器到最底，**不**影响外层页面
    // （scrollIntoView 会滚所有祖先容器，所以不能用）
    requestAnimationFrame(() => {
      const c = messagesContainerRef.current;
      if (c) c.scrollTop = c.scrollHeight;
    });

    setPending({
      role: "assistant",
      content: "",
      citations: [],
      recalledChunks: [],
      contextSummary: null,
      streaming: true,
    });
    setStreaming(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;
    activeAbortController = controller;

    let finalCitations: Citation[] = [];
    let finalChunks: RecalledChunk[] = [];
    let finalCtx: ContextSummary | null = null;
    let assistantContent = "";
    let assistantReasoning = "";
    const localToolCalls: any[] = [];
    let wasStopped = false;
    let errored = false;

    setExecutedToolCalls([]);

    try {
      const iter = streamCounselor(
        { session_id: currentSessionId, message },
        controller.signal,
      );
      for await (const ev of iter) {
        if (ev.event === "meta") {
          setCurrentSessionId(ev.data.session_id);
          setRemaining(ev.data.remaining_quota);
          // meta 事件到达时，后端已经把 session 行（title = user_message[:30]）和 user message 行都入库了；
          // 立刻刷新历史列表，让新会话马上出现在左边栏
          try { await loadSessions(); } catch { /* ignore */ }
        } else if (ev.event === "thought") {
          assistantReasoning += ev.data.text;
          setPending((p) => {
            if (p) {
              return { ...p, reasoningContent: assistantReasoning };
            } else {
              return {
                role: "assistant",
                content: "",
                reasoningContent: assistantReasoning,
                citations: [],
                recalledChunks: [],
                contextSummary: null,
                streaming: true,
              };
            }
          });
          requestAnimationFrame(() => {
            const c = messagesContainerRef.current;
            if (c) c.scrollTop = c.scrollHeight;
          });
        } else if (ev.event === "token") {
          assistantContent += ev.data.text;
          setPending((p) => {
            if (p) {
              return { ...p, content: assistantContent };
            } else {
              return {
                role: "assistant",
                content: assistantContent,
                reasoningContent: assistantReasoning,
                citations: [],
                recalledChunks: [],
                contextSummary: null,
                streaming: true,
              };
            }
          });
          requestAnimationFrame(() => {
            const c = messagesContainerRef.current;
            if (c) c.scrollTop = c.scrollHeight;
          });
        } else if (ev.event === "done") {
          finalCitations = ev.data.citations;
          finalChunks = ev.data.recalled_chunks;
          finalCtx = ev.data.context_summary;
        } else if (ev.event === "stopped") {
          finalCitations = ev.data.citations;
          finalChunks = ev.data.recalled_chunks;
          finalCtx = ev.data.context_summary;
          wasStopped = true;
        } else if (ev.event === "tool_call") {
          const d = ev.data;
          if (d.phase === "start") {
            setPendingTools((p) => [...p, d]);
            localToolCalls.push({
              name: d.name,
              arguments: d.arguments,
              call_id: d.call_id,
              success: null,
              elapsed_ms: null,
            });
            setExecutedToolCalls([...localToolCalls]);
          } else if (d.phase === "end") {
            setPendingTools((p) => p.filter((t) => t.call_id !== d.call_id));
            for (const tc of localToolCalls) {
              if (tc.call_id === d.call_id) {
                tc.success = d.success;
                tc.elapsed_ms = d.elapsed_ms;
                tc.result = d.result;
              }
            }
            setExecutedToolCalls([...localToolCalls]);
            // 工具失败（end + success=false）—— 不阻断对话，但 toast 提示一下
            if (d.success === false) {
              const label =
                d.name === "web_search" ? "联网检索" :
                d.name === "recall_user_history" ? "历史分析召回" :
                d.name === "query_match_rate" ? "匹配度评估" : `工具 ${d.name}`;
              auth.triggerToast(`⚠️ ${label}失败，继续基于已有信息回答`);
            }
          }
        } else if (ev.event === "error") {
          errored = true;
          auth.triggerToast("AI 出错了：" + ev.data.message);
        }
      }
    } catch (e: any) {
      // abort() 触发的 AbortError：用户主动 stop / 切走 tab / 路由跳转 / 关闭页面
      if (e?.name === "AbortError") {
        wasStopped = true;
      } else {
        errored = true;
        auth.triggerToast("发送失败：" + (e?.message || String(e)));
      }
    } finally {
      // 任何终止路径（done / stopped / error / abort）都把当前 partial 落进 messages
      if (assistantContent || assistantReasoning) {
        const finalMsg: MessageItem = {
          id: -Date.now() - 1,
          role: "assistant",
          content: assistantContent,
          citations: finalCitations,
          recalled_chunks: finalChunks,
          created_at: new Date().toISOString(),
          reasoning_content: assistantReasoning,
          tool_calls: [...localToolCalls],
        };
        setMessages((prev) => [...prev, finalMsg]);
      }
      // 释放本轮 of controller，只有是当前活跃请求才清空状态
      if (abortControllerRef.current === controller) {
        setPending(null);
        setPendingTools([]);   // 兜底清理（通常在 tool_call start 时已被 end 移除）
        setExecutedToolCalls([]);
        setStreaming(false);
        abortControllerRef.current = null;
        if (activeAbortController === controller) {
          activeAbortController = null;
        }
      }
      if (!errored) {
        // 成功后刷新历史列表（message_count、status、summary 都会更新）
        // 即使是 stopped 也要刷新，以便 UI 看到 status 变化
        try { await loadSessions(); } catch { /* ignore */ }
      }
      // stopped 状态给个轻量提示
      if (wasStopped && (assistantContent || assistantReasoning)) {
        auth.triggerToast("已停止生成");
      }
    }
  };

  useEffect(() => {
    // 父级通过 props.autoSendPrompt 注入开场白（每次非空都触发一次）
    if (props.autoSendPrompt) {
      if (props.autoSendPrompt !== lastAutoSentPrompt) {
        lastAutoSentPrompt = props.autoSendPrompt;
        sendMessage(props.autoSendPrompt);
        if (props.onClearAutoSendPrompt) {
          props.onClearAutoSendPrompt();
        }
      }
    } else {
      // 当父级清空时，把 lastAutoSentPrompt 也清空，以便下次可以再次触发相同的开场白
      lastAutoSentPrompt = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.autoSendPrompt]);

  const clearConversation = () => {
    newSession();
  };

  // ── compact 模式：内嵌在 glass-panel 内部 ──
  if (variant === "compact") {
    return (
      <div className="flex flex-col h-full max-h-full relative text-left min-h-0">
        {/* 顶部工具栏 */}
        <div className="flex items-center justify-between pb-4 border-b border-white/5 mb-2.5 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center border border-primary/30 relative">
              <span className="material-symbols-outlined text-lg text-primary">support_agent</span>
              <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-tertiary border-2 border-background"></span>
            </div>
            <div>
              <h4 className="text-base font-black text-white">AI 职业顾问</h4>
              <p className="text-xs text-on-surface-variant/60 font-semibold mt-0.5">
                基于你的所有分析记录和项目记忆，为你提供专业的职业建议
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {remaining !== null && (
              <span className="text-xs text-on-surface-variant font-label-mono font-bold">
                今日剩余 {remaining} 次
              </span>
            )}
            <button
              onClick={clearConversation}
              className="flex items-center gap-1.5 px-3.5 py-2 border border-white/10 hover:border-secondary/30 rounded-xl text-xs font-bold text-on-surface-variant hover:text-white bg-white/5 hover:bg-white/10 transition-all cursor-pointer"
              title="清空当前会话"
            >
              <span className="material-symbols-outlined text-sm">clear_all</span>
              清空对话
            </button>
          </div>
        </div>

        {/* 消息区 */}
        <div ref={messagesContainerRef} className="flex-1 overflow-y-auto py-4 pr-1 scrollbar-thin flex flex-col min-h-0">
          {messages.length === 0 && !pending ? (
            <div className="text-center py-6 my-auto flex flex-col justify-center">
              <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-primary/20 flex items-center justify-center border border-primary/30 relative shrink-0">
                <span className="material-symbols-outlined text-2xl text-primary animate-pulse">support_agent</span>
              </div>
              <h3 className="text-xl font-headline-lg font-black text-white mb-2">
                你好！我是你的 AI 职业顾问
              </h3>
              <p className="text-on-surface-variant/70 text-xs md:text-sm max-w-2xl mx-auto mb-8 font-semibold leading-relaxed whitespace-pre-line">
                基于你 {stats?.interview_count ?? 3} 次面试记录、{stats?.resume_count ?? 3} 次简历分析、{stats?.project_count ?? 4} 个项目记忆和完整的能力分析，
                我可以为你提供个性化的职业发展建议、面试指导、能力提升方案。
              </p>

              <div className="text-xs font-label-mono tracking-widest text-on-surface-variant/50 font-bold uppercase mb-4 shrink-0">
                猜你想问
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-3xl mx-auto w-full">
                {WELCOME_CARDS.map((card, i) => (
                  <button
                    key={i}
                    onClick={() => sendMessage(card.prompt)}
                    className="flex items-center justify-between p-4.5 bg-white/[0.02] hover:bg-white/5 border border-white/5 hover:border-primary/20 rounded-2xl text-left transition-all group scale-98 hover:scale-100 active:scale-98 cursor-pointer"
                  >
                    <div className="flex items-center gap-3.5 min-w-0 flex-1">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border ${card.iconColor}`}>
                        <span className="material-symbols-outlined text-xl">{card.icon}</span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <h4 className="text-xs md:text-sm font-black text-white leading-snug group-hover:text-primary transition-colors whitespace-pre-line">
                          {card.title}
                        </h4>
                        <p className="text-[11px] text-on-surface-variant/40 font-bold mt-1 leading-snug">
                          {card.subtitle}
                        </p>
                      </div>
                    </div>
                    <span className="material-symbols-outlined text-xs text-on-surface-variant/40 group-hover:text-primary group-hover:translate-x-1 transition-all shrink-0 ml-3">
                      arrow_forward_ios
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* 过滤掉空的 assistant/system 消息（AI 未回复 / 系统消息），
                  避免历史回放时渲染出空对话框 */}
              {messages
                .filter((m) => {
                  if (m.role === "user") return true;
                  // assistant / system：content 为空 且 reasoning_content 也为空就不渲染
                  return !!(m.content && m.content.trim()) || !!(m.reasoning_content && m.reasoning_content.trim());
                })
                .map((m) => (
                  <ChatBubble
                    key={m.id}
                    role={m.role}
                    content={m.content}
                    citations={m.citations}
                    recalledChunks={m.recalled_chunks}
                    reasoning_content={m.reasoning_content}
                    tool_calls={m.tool_calls}
                  />
                ))}


              {pending && (
                <ChatBubble
                  role="assistant"
                  content={pending.content}
                  citations={pending.citations}
                  recalledChunks={pending.recalledChunks}
                  contextSummary={pending.contextSummary}
                  streaming={pending.streaming}
                  reasoning_content={pending.reasoningContent}
                  tool_calls={executedToolCalls}
                />
              )}
            </div>
          )}
        </div>

        {/* 输入区 */}
        <div className="pt-4 border-t border-t-white/5 flex flex-col gap-2 shrink-0">
          <div className="flex gap-2 items-end">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage(input);
                }
              }}
              placeholder="输入你的问题..."
              rows={1}
              className="flex-1 px-4 py-3 bg-white/5 border border-white/10 rounded-2xl text-on-surface text-sm placeholder:text-on-surface-variant/40 focus:outline-none focus:border-primary/50 resize-none font-semibold leading-relaxed h-11"
              style={{ minHeight: "44px", maxHeight: "120px" }}
              disabled={streaming}
            />
            <button
              onClick={streaming ? stopStreaming : () => sendMessage(input)}
              disabled={!streaming && !input.trim()}
              title={streaming ? "停止生成" : "发送"}
              className={`h-11 w-11 rounded-full hover:scale-105 disabled:scale-100 disabled:cursor-not-allowed transition-all flex items-center justify-center shrink-0 ${
                streaming
                  ? "bg-red-500 hover:bg-red-600 text-white shadow-lg shadow-red-500/30 animate-pulse"
                  : "bg-primary disabled:bg-primary/40 text-on-primary shadow-lg shadow-primary/20"
              }`}
            >
              {streaming ? (
                <span className="material-symbols-outlined text-[28px] leading-none">stop_circle</span>
              ) : (
                <img
                  src="/send.svg"
                  alt="send"
                  className="w-5 h-5 object-contain brightness-0 invert"
                />
              )}
            </button>
          </div>
          <p className="text-[10px] text-on-surface-variant/30 font-bold text-center">
            AI 回答基于你的个人数据，内容仅供参考，请结合实际情况判断
          </p>
        </div>
      </div>
    );
  }

  // ── full 模式 ──
  return (
    <div className="text-on-surface p-4">请使用 compact 模式</div>
  );
}
