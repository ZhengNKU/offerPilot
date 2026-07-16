// AI 职业顾问 SSE 客户端
// 消费 /api/counselor/chat 的 EventSource 风格流
//
// 用法：
//   for await (const event of streamCounselor({ session_id, message })) {
//     if (event.event === "token") render(event.data.text);
//     if (event.event === "done") onComplete(event.data);
//   }

import { API_BASE } from "@/lib/api";

export type CounselorEvent =
  | { event: "meta"; data: { session_id: number; user_message_id: number; message_count: number; remaining_quota: number } }
  | { event: "token"; data: { text: string } }
  | { event: "thought"; data: { text: string } }
  | { event: "done"; data: { msg_id: number; citations: Citation[]; recalled_chunks: RecalledChunk[]; context_summary: ContextSummary } }
  | { event: "stopped"; data: { msg_id: number; citations: Citation[]; recalled_chunks: RecalledChunk[]; context_summary: ContextSummary } }
  | { event: "error"; data: { message: string } }
  | { event: "tool_call"; data: ToolCallEvent };

/** LLM Tool Calling 工具调用事件。
 *  - phase="start": 工具即将执行（含 arguments）
 *  - phase="end":   工具已完成（含 success / elapsed_ms / result_chars）
 *  对应后端 counselor_agent._on_tool_event 的 buffer→drain 模型。
 */
export interface ToolCallEvent {
  phase: "start" | "end";
  name: string;
  call_id?: string;
  iter?: number;
  // start only
  arguments?: Record<string, unknown>;
  // end only
  success?: boolean;
  elapsed_ms?: number;
  result_chars?: number;
}

export interface Citation {
  source_type: string;
  source_id: number;
  chunk_index: number;
  chunk_title?: string;
}

export interface RecalledChunk {
  chunk_id: number;
  source_type: string;
  source_id: number;
  chunk_index: number;
  chunk_title: string;
  similarity: number;
}

export interface ContextSummary {
  project_memories_count: number;
  project_memories_shown: number;
  history_messages_count: number;
  has_summary: boolean;
}

export interface SessionListItem {
  id: number;
  title: string;
  summary: string | null;
  message_count: number;
  created_at: string | null;
  updated_at: string | null;
}

export interface MessageItem {
  id: number;
  role: "user" | "assistant" | "system";
  content: string;
  citations: Citation[];
  recalled_chunks: RecalledChunk[];
  created_at: string | null;
  reasoning_content?: string;
  tool_calls?: any[];
}

export interface SessionDetail {
  id: number;
  title: string;
  summary: string | null;
  has_summary: boolean;
  message_count: number;
  created_at: string | null;
  updated_at: string | null;
  messages: MessageItem[];
}

function getToken(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("interviewVar_token") || "";
}

export async function* streamCounselor(
  body: { session_id: number | null; message: string },
  signal?: AbortSignal,
): AsyncGenerator<CounselorEvent> {
  const token = getToken();
  const resp = await fetch(`${API_BASE}/api/counselor/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: token ? `Bearer ${token}` : "",
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!resp.ok) {
    let detail = `HTTP ${resp.status}`;
    try {
      const j = await resp.json();
      detail = j.detail || detail;
    } catch { /* ignore */ }
    throw new Error(detail);
  }
  if (!resp.body) {
    throw new Error("No response body");
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      // SSE 用 \n\n 分隔事件
      const parts = buf.split("\n\n");
      buf = parts.pop() ?? "";
      for (const part of parts) {
        if (!part.trim()) continue;
        let eventName = "message";
        let dataStr = "";
        for (const line of part.split("\n")) {
          if (line.startsWith("event:")) {
            eventName = line.slice(6).trim();
          } else if (line.startsWith("data:")) {
            dataStr += line.slice(5).trim();
          }
        }
        if (!dataStr) continue;
        try {
          const data = JSON.parse(dataStr);
          yield { event: eventName, data } as CounselorEvent;
        } catch (e) {
          console.error("[counselor] failed to parse SSE data:", dataStr, e);
        }
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch { /* ignore */ }
  }
}

export async function stopSession(sessionId: number): Promise<{ message: string; status: string }> {
  const token = getToken();
  const resp = await fetch(`${API_BASE}/api/counselor/sessions/${sessionId}/stop`, {
    method: "POST",
    headers: {
      Authorization: token ? `Bearer ${token}` : "",
    },
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

// ── Session CRUD ──

export async function listSessions(limit = 10, offset = 0): Promise<{ sessions: SessionListItem[]; total: number }> {
  const token = getToken();
  const resp = await fetch(`${API_BASE}/api/counselor/sessions?limit=${limit}&offset=${offset}`, {
    headers: { Authorization: token ? `Bearer ${token}` : "" },
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

export async function getSession(sessionId: number): Promise<{ session: SessionDetail }> {
  const token = getToken();
  const resp = await fetch(`${API_BASE}/api/counselor/sessions/${sessionId}`, {
    headers: { Authorization: token ? `Bearer ${token}` : "" },
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

export async function deleteSession(sessionId: number): Promise<{ message: string }> {
  const token = getToken();
  const resp = await fetch(`${API_BASE}/api/counselor/sessions/${sessionId}`, {
    method: "DELETE",
    headers: { Authorization: token ? `Bearer ${token}` : "" },
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

export interface CounselorStats {
  interview_count: number;
  resume_count: number;
  project_count: number;
  dimension_count: number;
  experience_years: string;
}

export async function getCounselorStats(): Promise<CounselorStats> {
  const token = getToken();
  const resp = await fetch(`${API_BASE}/api/counselor/stats`, {
    headers: { Authorization: token ? `Bearer ${token}` : "" },
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

