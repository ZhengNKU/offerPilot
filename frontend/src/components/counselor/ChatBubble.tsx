"use client";

import { useState } from "react";
import type { Citation, RecalledChunk } from "@/lib/counselorClient";
import CitationCard from "./CitationCard";

interface Props {
  role: "user" | "assistant" | "system";
  content: string;
  citations?: Citation[];
  recalledChunks?: RecalledChunk[];
  streaming?: boolean;
  contextSummary?: {
    project_memories_count: number;
    project_memories_shown: number;
    history_messages_count: number;
    has_summary: boolean;
  } | null;
}

// 简易 markdown：把 ###、**、换行等渲染出来
function renderMarkdown(text: string, citations: Citation[]): React.ReactNode {
  // 先按 [cite:TYPE#ID#CHUNK] 拆段
  const citeRe = /\[cite:(\w+)#(\d+)#(\d+)\]/g;
  const out: React.ReactNode[] = [];
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = citeRe.exec(text)) !== null) {
    if (m.index > lastIdx) {
      out.push(renderBasicMd(text.slice(lastIdx, m.index), key++));
    }
    const cited: Citation = {
      source_type: m[1],
      source_id: parseInt(m[2]),
      chunk_index: parseInt(m[3]),
    };
    out.push(<CitationCard key={key++} citation={cited} />);
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < text.length) {
    out.push(renderBasicMd(text.slice(lastIdx), key++));
  }
  return out;
}

function renderBasicMd(text: string, key: number): React.ReactNode {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let currentListItems: React.ReactNode[] = [];
  let inList = false;
  let inTable = false;
  let tableLines: string[] = [];
  let keyIdx = 0;

  const flushList = () => {
    if (inList && currentListItems.length > 0) {
      elements.push(
        <ul key={`list-${keyIdx++}`} className="list-disc list-inside space-y-1.5 my-2 pl-2">
          {currentListItems}
        </ul>
      );
      currentListItems = [];
      inList = false;
    }
  };

  const flushTable = () => {
    if (inTable && tableLines.length > 0) {
      elements.push(renderTable(tableLines.join("\n"), keyIdx++));
      tableLines = [];
      inTable = false;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Check for tables
    if (trimmed.startsWith("|")) {
      flushList();
      inTable = true;
      tableLines.push(line);
      continue;
    } else if (inTable) {
      flushTable();
    }

    // Check for headers
    if (trimmed.startsWith("### ")) {
      flushList();
      elements.push(
        <h3 key={keyIdx++} className="text-base font-bold text-on-surface mt-4 mb-2">
          {renderInline(trimmed.slice(4))}
        </h3>
      );
    } else if (trimmed.startsWith("## ")) {
      flushList();
      elements.push(
        <h2 key={keyIdx++} className="text-lg font-bold text-on-surface mt-4 mb-2">
          {renderInline(trimmed.slice(3))}
        </h2>
      );
    } else if (trimmed.startsWith("# ")) {
      flushList();
      elements.push(
        <h1 key={keyIdx++} className="text-xl font-bold text-on-surface mt-4 mb-2.5">
          {renderInline(trimmed.slice(2))}
        </h1>
      );
    } 
    // Check for list items starting with - or * or •
    else if (/^[-*•]\s+/.test(trimmed)) {
      inList = true;
      const content = trimmed.replace(/^[-*•]\s+/, "");
      currentListItems.push(
        <li key={`li-${keyIdx++}`} className="leading-relaxed">
          {renderInline(content)}
        </li>
      );
    } 
    // Check for list items starting with numbers (e.g. 1. 2.)
    else if (/^\d+\.\s+/.test(trimmed)) {
      inList = true;
      const content = trimmed.replace(/^\d+\.\s+/, "");
      const numMatch = trimmed.match(/^(\d+)\.\s+/);
      const num = numMatch ? numMatch[1] : "1";
      currentListItems.push(
        <li key={`li-${keyIdx++}`} className="leading-relaxed list-none pl-1 flex gap-1">
          <span className="text-primary font-bold shrink-0">{num}.</span>
          <span>{renderInline(content)}</span>
        </li>
      );
    }
    // Empty line
    else if (!trimmed) {
      flushList();
      elements.push(<div key={keyIdx++} className="h-2" />);
    } 
    // Regular text line
    else {
      flushList();
      elements.push(
        <p key={keyIdx++} className="my-1.5 leading-relaxed">
          {renderInline(line)}
        </p>
      );
    }
  }

  flushList();
  flushTable();

  return <span key={key}>{elements}</span>;
}

function renderInline(text: string): React.ReactNode {
  // 先按 markdown 链接 [text](url) 拆段，再对非链接段走加粗/行内代码
  const linkRe = /\[([^\]]+)\]\(([^)\s]+)\)/g;
  const result: React.ReactNode[] = [];
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  let keyIdx = 0;

  while ((m = linkRe.exec(text)) !== null) {
    if (m.index > lastIdx) {
      result.push(...renderInlineText(text.slice(lastIdx, m.index), keyIdx));
      keyIdx += 1000;
    }
    const linkText = m[1];
    const linkUrl = m[2];
    result.push(
      <a
        key={`link-${keyIdx++}`}
        href={linkUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary hover:text-primary-light underline underline-offset-2 decoration-primary/40 hover:decoration-primary break-all"
      >
        {linkText}
      </a>
    );
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < text.length) {
    result.push(...renderInlineText(text.slice(lastIdx), keyIdx));
  }
  return result;
}

// 内部使用：处理加粗 / 行内代码（不含链接）
function renderInlineText(text: string, baseKey: number): React.ReactNode[] {
  const boldParts = text.split(/(\*\*[^*]+\*\*)/g);
  const result: React.ReactNode[] = [];
  let i = 0;
  for (const part of boldParts) {
    if (part.startsWith("**") && part.endsWith("**")) {
      result.push(
        <strong key={`b-${baseKey}-${i}`} className="text-primary font-bold">
          {part.slice(2, -2)}
        </strong>
      );
    } else {
      const codeParts = part.split(/(`[^`]+`)/g);
      let j = 0;
      for (const cp of codeParts) {
        if (cp.startsWith("`") && cp.endsWith("`")) {
          result.push(
            <code
              key={`c-${baseKey}-${i}-${j}`}
              className="bg-white/5 border border-white/10 px-1.5 py-0.5 rounded text-[13px] font-mono text-secondary"
            >
              {cp.slice(1, -1)}
            </code>
          );
        } else {
          result.push(<span key={`t-${baseKey}-${i}-${j}`}>{cp}</span>);
        }
        j++;
      }
    }
    i++;
  }
  return result;
}

function renderTable(text: string, key: number): React.ReactNode {
  const lines = text.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return <p key={key}>{text}</p>;
  const headerCells = lines[0].split("|").map((c) => c.trim()).filter(Boolean);
  const dataLines = lines.slice(1).filter((l) => !l.match(/^[\s|:-]+$/));
  return (
    <div key={key} className="my-2 overflow-x-auto">
      <table className="text-sm w-full border-collapse">
        <thead>
          <tr>
            {headerCells.map((h, i) => (
              <th
                key={i}
                className="text-left px-2 py-1 border-b border-white/10 text-on-surface-variant font-semibold"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {dataLines.map((line, i) => {
            const cells = line.split("|").map((c) => c.trim()).filter(Boolean);
            return (
              <tr key={i} className="border-b border-white/5">
                {cells.map((c, j) => (
                  <td key={j} className="px-2 py-1.5 text-on-surface">
                    {renderInline(c)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function ChatBubble({
  role,
  content,
  citations = [],
  recalledChunks = [],
  streaming = false,
  contextSummary = null,
}: Props) {
  const [showContext, setShowContext] = useState(false);

  if (role === "user") {
    return (
      <div className="flex justify-end mb-4">
        <div className="max-w-[80%] bg-primary/15 border border-primary/30 rounded-2xl rounded-tr-sm px-4 py-2.5 text-on-surface">
          <div className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">
            {content}
          </div>
        </div>
      </div>
    );
  }

  let thinking = "";
  let actual = content;

  if (content.includes("<think>")) {
    const parts = content.split("</think>");
    if (parts.length > 1) {
      thinking = parts[0].replace("<think>", "").trim();
      actual = parts.slice(1).join("</think>").trim();
    } else {
      thinking = content.replace("<think>", "").trim();
      actual = "";
    }
  }

  const isLoading = !content.trim() && streaming;

  return (
    <div className="flex justify-start items-start gap-3.5 mb-5 text-left">
      {/* 职业顾问的图标放在回答的左侧 */}
      <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center shrink-0 shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)] mt-1">
        <img src="/helper.svg" className="w-7 h-7 object-contain" alt="helper" />
      </div>

      {/* 右侧内容 */}
      <div className="max-w-[85%] flex-1 flex flex-col gap-1.5 min-w-0">
        <div className="text-[13px] text-on-surface-variant/80 font-bold tracking-wider pl-1 select-none">
          职业顾问
        </div>
        
        <div className="bg-surface-container/60 backdrop-blur-md border border-white/10 rounded-2xl rounded-tl-sm px-4.5 py-3.5 text-on-surface shadow-lg">
          {/* 推理块：默认折叠 */}
          {thinking && (
            <details className="mb-3 group">
              <summary className="text-sm md:text-sm text-primary cursor-pointer hover:text-primary-light flex items-center gap-2 select-none outline-none list-none [&::-webkit-details-marker]:hidden">
                <img src="/reasoning.svg" className="w-6 h-6 object-contain" alt="thinking" />
                <span className="font-bold">查看推理过程</span>
              </summary>
              <div className="mt-2 px-3 py-2 bg-surface-container-low/50 border border-white/5 rounded-xl text-xs text-on-surface-variant whitespace-pre-wrap font-mono leading-relaxed">
                {thinking}
              </div>
            </details>
          )}
          
          <div className="text-[15px] leading-relaxed">
            {isLoading ? (
              <div className="flex items-center gap-2 py-1 select-none">
                <img src="/loading.gif" className="w-6 h-6 object-contain" alt="loading" />
                <span className="text-[13px] md:text-sm text-on-surface-variant/60 font-bold">正在思考...</span>
              </div>
            ) : (
              <>
                {renderMarkdown(actual, citations)}
                {streaming && (
                  <span className="inline-block w-1.5 h-3.5 bg-primary ml-0.5 align-middle animate-pulse" />
                )}
              </>
            )}
          </div>
        </div>

        {/* 上下文调试面板 */}
        {(contextSummary || recalledChunks.length > 0) && (
          <div className="mt-2 pl-1 select-none">
            <button
              onClick={() => setShowContext((s) => !s)}
              className="text-xs text-on-surface-variant/50 hover:text-on-surface-variant font-label-mono uppercase tracking-widest cursor-pointer transition-colors"
            >
              {showContext ? "▴" : "▾"} 上下文 ({recalledChunks.length} 条引用)
            </button>
            {showContext && contextSummary && (
              <div className="mt-1.5 px-3 py-2 bg-surface-container-low/40 border border-white/5 rounded-xl text-xs text-on-surface-variant space-y-1">
                <div>· 项目记忆：{contextSummary.project_memories_shown}/{contextSummary.project_memories_count}</div>
                <div>· 历史消息：{contextSummary.history_messages_count} 条{contextSummary.has_summary ? "（已压缩）" : ""}</div>
              </div>
            )}
            {showContext && recalledChunks.length > 0 && (
              <div className="mt-1.5 space-y-1.5">
                {recalledChunks.map((c, i) => (
                  <div
                    key={i}
                    className="px-3 py-2 bg-surface-container-low/40 border border-white/5 rounded-xl text-xs"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-on-surface font-semibold">
                        [{c.source_type}#{c.source_id}#{c.chunk_index}] {c.chunk_title}
                      </span>
                      <span className="text-tertiary font-label-mono">
                        sim={c.similarity.toFixed(2)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
