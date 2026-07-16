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
  reasoning_content?: string;
  tool_calls?: any[];
}

export function cleanCitations(text: string): string {
  let cleaned = text;
  
  // 1. 移除被括号包裹的引用，如 ([cite:xxx]) 或 （[cite:xxx]）
  cleaned = cleaned.replace(/\(\[cite:[^\]]+\]\)/g, "");
  cleaned = cleaned.replace(/（\[cite:[^\]]+\]）/g, "");
  
  // 2. 移除单独一行或以列表形式出现的引用，如 - [cite:xxx] 或 ● [cite:xxx] 或 * [cite:xxx]
  cleaned = cleaned.replace(/(?:^|\n)\s*[-*•●]\s*\[cite:[^\]]+\]\s*(?=\n|$)/g, "");
  
  // 3. 移除普通位置的引用
  cleaned = cleaned.replace(/\[cite:[^\]]+\]/g, "");
  
  // 4. 清理连续的换行，避免移除行后留下多余的空行
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n");
  
  // 5. 移除换行后面的逗号等标点，将其拉至前一行末尾
  cleaned = cleaned.replace(/\n\s*([，,。；;、？?！!])/g, "$1");
  
  return cleaned;
}

interface SearchPage {
  title: string;
  url: string;
  hostname: string;
  hostlogo: string;
}

const parseSearchPages = (resultText: any): SearchPage[] => {
  if (!resultText) return [];
  
  let text = "";
  if (typeof resultText === "string") {
    text = resultText;
  } else {
    try {
      text = JSON.stringify(resultText);
    } catch (e) {
      return [];
    }
  }
  
  text = text.trim();
  
  // 1) 尝试作为 JSON 解析（兼容原始数据或特殊格式）
  try {
    if (text.startsWith("{") || text.startsWith("[")) {
      const parsed = JSON.parse(text);
      const pages = parsed.pages || (Array.isArray(parsed) ? parsed : []);
      if (Array.isArray(pages)) {
        return pages.map((p: any) => ({
          title: p.title || "无标题",
          url: p.url || "",
          hostname: p.hostname || "网页",
          hostlogo: p.hostlogo || "",
        })).filter(p => p.url && typeof p.url === "string");
      }
    }
  } catch (e) {
    // ignore
  }

  // 2) 经典正则解析 Markdown: 1. [title](url) (来源: hostname)
  const pages: SearchPage[] = [];
  const regex = /\d+\.\s+\[([^\]]+)\]\(([^)]+)\)(?:\s+\(来源:\s*([^)]+)\))?/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const url = match[2];
    if (!url || typeof url !== "string") continue;
    
    let hostname = match[3] || "";
    if (!hostname) {
      try {
        hostname = new URL(url).hostname;
      } catch (err) {
        hostname = "网页";
      }
    }
    pages.push({
      title: match[1] || "无标题",
      url: url,
      hostname: hostname,
      hostlogo: "",
    });
  }
  return pages;
};

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
    if (trimmed.startsWith("###### ")) {
      flushList();
      elements.push(
        <h6 key={keyIdx++} className="text-xs font-bold text-on-surface mt-3 mb-1">
          {renderInline(trimmed.slice(7))}
        </h6>
      );
    } else if (trimmed.startsWith("##### ")) {
      flushList();
      elements.push(
        <h5 key={keyIdx++} className="text-xs font-bold text-on-surface mt-3 mb-1">
          {renderInline(trimmed.slice(6))}
        </h5>
      );
    } else if (trimmed.startsWith("#### ")) {
      flushList();
      elements.push(
        <h4 key={keyIdx++} className="text-sm font-bold text-on-surface mt-3.5 mb-1.5">
          {renderInline(trimmed.slice(5))}
        </h4>
      );
    } else if (trimmed.startsWith("### ")) {
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
  reasoning_content = "",
  tool_calls = [],
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

  let thinking = reasoning_content || "";
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
          {/* 工具调用历史 - 垂直时间线 */}
          {tool_calls && tool_calls.length > 0 && (
            <div className="flex flex-col mb-4 pl-0.5 relative">
              {/* 垂直连接线（仅在有多个工具调用时显示） */}
              {tool_calls.length > 1 && (
                <div className="absolute left-[7px] top-2.5 bottom-2.5 w-[1.5px] bg-white/10 z-0" />
              )}
              
              <div className="flex flex-col gap-3">
                {tool_calls.map((t: any, idx: number) => {
                  const isPending = t.success === null;
                  const isSuccess = t.success !== false;
                  
                  const icon = isPending ? "progress_activity" : isSuccess ? "check_circle" : "error";
                  const iconColor = isPending ? "text-amber-400" : isSuccess ? "text-[#5DECCB]" : "text-[#FF7A95]";
                  const iconClass = isPending ? "animate-spin" : "";
                  
                  const label =
                    t.name === "web_search"
                      ? isPending ? "正在联网检索..." : "联网检索"
                      : t.name === "recall_user_history"
                      ? isPending ? "正在查询历史分析..." : "历史分析召回"
                      : t.name === "query_match_rate"
                      ? isPending ? "正在计算匹配度..." : "匹配度评估"
                      : isPending ? `正在调用工具: ${t.name}...` : `调用工具: ${t.name}`;

                  return (
                    <div key={idx} className="flex items-center gap-3 relative z-10">
                      {/* 节点微标 */}
                      <div className="flex items-center justify-center w-4 h-4 rounded-full bg-[#1b1c21] shrink-0 border border-white/5 shadow-[0_1px_3px_rgba(0,0,0,0.4)]">
                        <span className={`material-symbols-outlined text-[11px] ${iconColor} ${iconClass} block`}>
                          {icon}
                        </span>
                      </div>
                      {/* 工具名称 */}
                      <span className={`text-[12px] font-bold tracking-wide select-none ${isPending ? "text-amber-400/80" : "text-white/50"}`}>
                        {label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 推理块：默认折叠 */}
          {thinking && (
            <details className="mb-3 group" open={streaming}>
              <summary className="text-sm md:text-sm text-primary cursor-pointer hover:text-primary-light flex items-center gap-2 select-none outline-none list-none [&::-webkit-details-marker]:hidden">
                <img src="/reasoning.svg" className="w-6 h-6 object-contain animate-pulse" alt="thinking" />
                <span className="font-bold">查看推理过程</span>
              </summary>
              <div className="mt-2 px-3 py-2 bg-surface-container-low/50 border border-white/5 rounded-xl text-xs text-on-surface-variant whitespace-pre-wrap font-mono leading-relaxed select-all">
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
                {renderMarkdown(cleanCitations(actual), citations)}
                {streaming && (
                  <span className="inline-block w-1.5 h-3.5 bg-primary ml-0.5 align-middle animate-pulse" />
                )}

                {/* 联网搜索参考链接卡片 */}
                {(() => {
                  const searchTool = tool_calls?.find(t => t.name === "web_search" && t.success === true);
                  if (!searchTool || !searchTool.result) return null;
                  const pages = parseSearchPages(searchTool.result);
                  if (pages.length === 0) return null;

                  return (
                    <details className="mt-4 group outline-none select-none">
                      <summary className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition-all cursor-pointer outline-none list-none [&::-webkit-details-marker]:hidden">
                        {/* overlapping hostlogos */}
                        <div className="flex -space-x-1.5 overflow-hidden">
                          {pages.slice(0, 3).map((p, pIdx) => {
                            let domain = "";
                            try {
                              domain = new URL(p.url).hostname;
                            } catch (e) {}
                            const initialSrc = p.hostlogo || (domain ? `https://${domain}/favicon.ico` : "/search-logo.svg");
                            return (
                              <img
                                key={pIdx}
                                className={`inline-block h-4 w-4 rounded-full overflow-hidden ring-1 ring-surface-container object-cover ${
                                  initialSrc === "/search-logo.svg" ? "" : "bg-white"
                                }`}
                                src={initialSrc}
                                onError={(e) => {
                                  const img = e.currentTarget;
                                  img.onerror = null;
                                  if (p.hostlogo && domain) {
                                    img.src = `https://${domain}/favicon.ico`;
                                    img.onerror = () => {
                                      img.onerror = null;
                                      img.src = "/search-logo.svg";
                                      img.classList.remove("bg-white");
                                    };
                                  } else {
                                    img.src = "/search-logo.svg";
                                    img.classList.remove("bg-white");
                                  }
                                }}
                                alt=""
                              />
                            );
                          })}
                        </div>
                        <span className="text-[12px] font-bold text-white/70">
                          {pages.length} 个网页
                        </span>
                        <span className="material-symbols-outlined text-[14px] text-white/40 group-open:rotate-180 transition-transform">
                          expand_more
                        </span>
                      </summary>

                      <div className="mt-2.5 max-w-xl p-3 rounded-xl bg-white/[0.02] border border-white/5 flex flex-col gap-2.5 text-xs animate-fadeIn">
                        {pages.map((p, pIdx) => {
                          let domain = "";
                          try {
                            domain = new URL(p.url).hostname;
                          } catch (e) {}
                          const initialSrc = p.hostlogo || (domain ? `https://${domain}/favicon.ico` : "/search-logo.svg");
                          return (
                            <a
                              key={pIdx}
                              href={p.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center justify-between gap-3 text-white/50 hover:text-[#5DECCB] transition-colors py-1.5 border-b border-white/5 last:border-0"
                            >
                              <div className="flex items-center gap-2 truncate">
                                <span className="text-white/20 font-mono text-[10px] w-4 shrink-0">{pIdx + 1}</span>
                                <img
                                  className={`h-3.5 w-3.5 object-cover rounded-full overflow-hidden ${
                                    initialSrc === "/search-logo.svg" ? "" : "bg-white p-0.5"
                                  }`}
                                  src={initialSrc}
                                  onError={(e) => {
                                    const img = e.currentTarget;
                                    img.onerror = null;
                                    if (p.hostlogo && domain) {
                                      img.src = `https://${domain}/favicon.ico`;
                                      img.onerror = () => {
                                        img.onerror = null;
                                        img.src = "/search-logo.svg";
                                        img.classList.remove("bg-white");
                                        img.classList.remove("p-0.5");
                                      };
                                    } else {
                                      img.src = "/search-logo.svg";
                                      img.classList.remove("bg-white");
                                      img.classList.remove("p-0.5");
                                    }
                                  }}
                                  alt=""
                               />
                                <span className="truncate font-medium text-[12px]">{p.title}</span>
                              </div>
                              <span className="text-[10px] text-white/30 font-normal shrink-0">{p.hostname}</span>
                            </a>
                          );
                        })}
                      </div>
                    </details>
                  );
                })()}
              </>
            )}
          </div>
        </div>


      </div>
    </div>
  );
}
