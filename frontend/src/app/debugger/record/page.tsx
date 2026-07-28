"use client";

import { useState, useEffect, useRef } from "react";
import { useModerationPreview } from "@/hooks/useModerationPreview";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth, UserMenu } from "@/components/AuthProvider";
import { ThemeToggle } from "@/components/ThemeToggle";
import { pollTaskUntilDone } from "@/app/utils/pollTask";
import { API_BASE } from "@/lib/api";
import { getQuotaStatus } from "@/lib/quotaClient";

interface DialogueItem {
  sender: "interviewer" | "user";
  name: string;
  time: string;
  text: string;
  badgeText?: string;
  badgeClass?: string;
  hasWarning?: boolean;
}

interface QuestionItem {
  id: string;
  label: string;
  time: string;
  isActive?: boolean;
}

export default function InterviewRecordAnalysisPage() {
  const router = useRouter();
  const auth = useAuth();

  // Mode: Input Form OR Analysis Dashboard
  const [showInputForm, setShowInputForm] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isTemplateLoading, setIsTemplateLoading] = useState(false);
  const [isGuest, setIsGuest] = useState(false);

  // Tabs: "对话分析" | "问题拆解" | "追问路径" | "能力评估"
  const [activeTab, setActiveTab] = useState<"dialogue" | "deconstruct" | "followup" | "assessment">("dialogue");

  // Popover State
  const [activePopoverIdx, setActivePopoverIdx] = useState<string | null>(null);

  // Search filter query
  const [searchQuery, setSearchQuery] = useState("");
  const fetchedSessionIdRef = useRef<string | null>(null);

  // Form State
  const [pasteText, setPasteText] = useState("");
  const [metadataForm, setMetadataForm] = useState({
    company: "",
    role: "",
    round: "",
    date: "",
    grade: "",
    salary: "",
    years: "",
    isOnJob: "",
    jobDescription: ""
  });

  // Phase 3: JD 输入审核 preview hint
  const jdMod = useModerationPreview();
  const pasteTextMod = useModerationPreview();

  useEffect(() => {
    if (jdMod.status === "block") auth.triggerToast("岗位详情内容涉嫌违规，请修改后提交", "error");
  }, [jdMod.status]);

  useEffect(() => {
    if (pasteTextMod.status === "block") auth.triggerToast("对话内容涉嫌违规，请修改后提交", "error");
  }, [pasteTextMod.status]);

  // Parsed dialogues list
  const [dialogues, setDialogues] = useState<DialogueItem[]>([]);

  // Section & Collapsible States
  const [activeSectionId, setActiveSectionId] = useState<number | null>(null);
  const [sections, setSections] = useState<any[]>([]);
  const [collapsedSections, setCollapsedSections] = useState<Record<number, boolean>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [optimizingSections, setOptimizingSections] = useState<Record<number, boolean>>({});
  const [reportData, setReportData] = useState<any>(null);
  const [isInitialPolling, setIsInitialPolling] = useState(false);
  const [taskProgress, setTaskProgress] = useState(0);
  const [taskStep, setTaskStep] = useState("面试驾到 AI 正在分析中...");
  const [showAllWeaknesses, setShowAllWeaknesses] = useState(false);
  const [showAllPerspectives, setShowAllPerspectives] = useState(false);
  const [hoveredPerspective, setHoveredPerspective] = useState<any>(null);

  const scoreLogic = reportData?.analysis_result?.scores?.logic ?? 85;
  const scoreSystem = reportData?.analysis_result?.scores?.system_design ?? 60;
  const scoreExpression = reportData?.analysis_result?.scores?.expression ?? 70;
  const scoreOwnership = reportData?.analysis_result?.scores?.ownership ?? 55;
  const scoreProject = reportData?.analysis_result?.scores?.project_depth ?? 80;

  const fmtTime = (secs: number) => {
    const m = Math.floor(Math.abs(secs) / 60);
    const s = Math.floor(Math.abs(secs) % 60);
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  const parseTimeStrToSecs = (timeStr: string): number => {
    if (!timeStr) return 0;
    const clean = timeStr.replace(/[()\[\]\uff08\uff3b\uff09\uff3d]/g, "").trim();
    const parts = clean.split(":");
    if (parts.length === 2) {
      return parseInt(parts[0]) * 60 + parseInt(parts[1]);
    }
    return 0;
  };

  const mergeRecordSectionsToMax10 = (secList: any[]): any[] => {
    if (secList.length <= 10) return secList;

    const N = secList.length;
    const M = 10;
    const merged: any[] = [];

    const tagColorMap: Record<string, string> = {
      "良好": "text-[#5DECCB] bg-[#5DECCB]/10 border-[#5DECCB]/20",
      "一般": "text-[#AFA7FF] bg-[#AFA7FF]/10 border-[#AFA7FF]/20",
      "风险": "text-[#FF7A95] bg-[#FF7A95]/10 border-[#FF7A95]/20"
    };

    for (let j = 0; j < M; j++) {
      const startIdx = Math.floor((j * N) / M);
      const endIdx = Math.floor(((j + 1) * N) / M);
      const group = secList.slice(startIdx, endIdx);

      if (group.length === 0) continue;

      const first = group[0];
      const last = group[group.length - 1];

      const start_time = first.start_time ?? 0;
      const end_time = last.end_time ?? 0;

      const uniqueTitles = Array.from(new Set(group.map(g => g.title)));
      let title = uniqueTitles.join(" & ");
      if (title.length > 28) {
        title = title.slice(0, 25) + "...";
      }

      const dialogue: any[] = [];
      group.forEach(g => {
        dialogue.push(...g.dialogue);
      });

      let tag = "一般";
      if (group.some(g => g.tag === "风险")) {
        tag = "风险";
      } else if (group.every(g => g.tag === "良好")) {
        tag = "良好";
      }

      merged.push({
        id: j + 1,
        title,
        start_time,
        end_time,
        timeRange: `${fmtTime(start_time)} - ${fmtTime(end_time)}`,
        tag,
        tagColor: tagColorMap[tag] || first.tagColor,
        dialogue,
        dbSectionId: first.dbSectionId,
        optimizationAdvice: first.optimizationAdvice
      });
    }

    return merged;
  };

  const scrollToSection = (secId: number) => {
    setActiveSectionId(secId);
    setCollapsedSections(prev => ({ ...prev, [secId]: false })); // Ensure it is expanded
    setTimeout(() => {
      const el = document.getElementById(`section-block-${secId}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 100);
  };

  // Group local dialogues by interviewer question for fallback mock mode
  const groupLocalDialoguesIntoSections = (dialogueItems: DialogueItem[]) => {
    const grouped: any[] = [];
    let currentSection: any = null;
    let secIndex = 1;

    dialogueItems.forEach((bubble) => {
      const isInterviewer = bubble.sender === "interviewer";
      const bubbleSecs = parseTimeStrToSecs(bubble.time);

      if (isInterviewer || currentSection === null) {
        if (currentSection) grouped.push(currentSection);
        currentSection = {
          id: secIndex,
          title: isInterviewer ? bubble.text.slice(0, 15) + (bubble.text.length > 15 ? "..." : "") : `对话段落 ${secIndex}`,
          timeRange: bubble.time,
          start_time: bubbleSecs,
          end_time: bubbleSecs,
          tag: bubble.hasWarning ? "风险" : "良好",
          tagColor: bubble.hasWarning ? "text-[#FF7A95] bg-[#FF7A95]/10 border-[#FF7A95]/20" : "text-[#5DECCB] bg-[#5DECCB]/10 border-[#5DECCB]/20",
          dialogue: []
        };
        secIndex++;
      }
      currentSection.dialogue.push(bubble);
      currentSection.end_time = bubbleSecs;
    });
    if (currentSection) grouped.push(currentSection);
    return mergeRecordSectionsToMax10(grouped);
  };

  const stripHtml = (htmlStr: string) => {
    if (!htmlStr) return "";
    return htmlStr.replace(/<[^>]*>/g, "").trim();
  };

  const handleOptimizeSection = async (sectionId: number) => {
    const section = sections.find(s => s.id === sectionId);
    if (!section) return;

    const dbSectionId = section.dbSectionId;
    setOptimizingSections(prev => ({ ...prev, [sectionId]: true }));

    if (!dbSectionId) {
      // Fallback: Simulate AI generation with custom mock data matching the section title
      await new Promise(resolve => setTimeout(resolve, 1200));
      
      const title = section.title || "";
      let mockAdvice = {
        conclusion: `针对【${title}】环节，表现总体${section.tag || "良好"}。但原话术在专业度、架构选型依据及系统深度上仍有提升空间。`,
        original: section.dialogue?.filter((d: any) => d.sender === "user").map((d: any) => d.text).join(" ") || "（未检测到用户回答）",
        optimized: ""
      };

      if (title.includes("自我介绍")) {
        mockAdvice.optimized = `“您好，我是候选人。我有 3 年后端开发及高并发中间件设计经验。在过往的项目中，我主要负责核心推荐系统的演进与优化。我重点参与了多级缓存架构的落地，引入了 Redis 哨兵集群与本地 Guava 缓存做配合，并设计了消息队列异步解耦机制，使核心服务的接口 QPS 提升了约 50%，TP99 耗时降低了 40ms，在高负载下表现优异。”`;
      } else if (title.includes("Redis") || title.includes("redis") || title.includes("使用 Redis")) {
        mockAdvice.optimized = `“我们的业务存在大量热点数据，直接查数据库 QPS 接近上限。引入 <strong class='text-[#5DECCB] font-black'>Redis 作为缓存层</strong> 后，接口响应时间从 <strong class='text-[#5DECCB] font-black'>120ms 降低到 35ms</strong>，峰值 QPS 提升了 <strong class='text-[#5DECCB] font-black'>3 倍</strong>。”`;
      } else if (title.includes("本地") || title.includes("缓存")) {
        mockAdvice.optimized = `“在缓存方案选型上，我们需要进行权衡。本地缓存如 Guava 读写都在进程内存中，性能极高，但受限于单机堆内存大小且存在多节点数据不一致问题；而分布式缓存 Redis 虽有网络开销，但支持集群化扩展、高可用且能共享全局状态，是支撑大规模分布式服务的标准选择。”`;
      } else if (title.includes("双删") || title.includes("一致性")) {
        mockAdvice.optimized = `“我们采用 Cache Aside 模式，并采用延迟双删策略来最大程度保证缓存与数据库的一致性。为了解决极高并发下双删仍可能发生的间歇性不一致，我们设计了旁路 Canal 监听 MySQL binlog 的方案，将变更异步推送到 Kafka 消息队列进行自动重试补偿，从而实现了最终一致性。”`;
      } else {
        mockAdvice.optimized = `“针对这个问题，我当时的核心设计思路是：首先对流量进行分流与降级控制，其次通过引入多级缓存降低底层 DB 压力，并对关键写入路径进行异步化解耦。该方案上线后，整体系统可用性达到了 99.99%，在多次大促中稳定运行。”`;
      }

      setSections(prev => prev.map(s => {
        if (s.id === sectionId) {
          return { ...s, optimizationAdvice: mockAdvice };
        }
        return s;
      }));
      setOptimizingSections(prev => ({ ...prev, [sectionId]: false }));
      return;
    }

    try {
      const token = localStorage.getItem("interviewVar_token");
      const headers: Record<string, string> = {
        "Content-Type": "application/json"
      };
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const res = await fetch(`${API_BASE}/api/audio/section/${dbSectionId}/optimize`, {
        method: "POST",
        headers
      });

      if (!res.ok) {
        throw new Error("Failed to generate optimization advice");
      }

      const data = await res.json();
      const advice = {
        conclusion: data.conclusion,
        original: data.original,
        optimized: data.optimized
      };

      setSections(prev => prev.map(s => {
        if (s.id === sectionId) {
          return { ...s, optimizationAdvice: advice };
        }
        return s;
      }));
    } catch (err) {
      console.error("Error generating advice:", err);
      auth.triggerToast("生成优化话术失败，请稍后重试！", "error");
    } finally {
      setOptimizingSections(prev => ({ ...prev, [sectionId]: false }));
    }
  };

  // Default transcript matching preview image
  const DEFAULT_TRANSCRIPT = 
    `面试官：请先做个自我介绍吧。\n` +
    `我：好的，我叫张三，3年后端开发经验，主要做分布式系统 and 中间件相关的开发...\n` +
    `面试官：介绍一下你负责的项目吧，重点讲讲你的角色和技术难点。\n` +
    `我：我主要负责推荐系统的后端开发，使用了 Redis、MySQL、Kafka 等技术栈...\n` +
    `面试官：为什么使用 Redis ？\n` +
    `我：因为 Redis 性能高，可以做缓存，提升接口响应速度。\n` +
    `面试官：那为什么不用本地缓存呢？\n` +
    `我：本地缓存会有数据不一致的问题，而且不好维护...\n` +
    `面试官：那如果缓存和数据库的数据不一致怎么办？\n` +
    `我：我们用的是定时双删策略，保证最终一致性。`;

  // Pre-load default or local storage text
  useEffect(() => {
    const savedGuest = localStorage.getItem("interviewVar_is_guest_session");
    if (savedGuest === "true") {
      setIsGuest(true);
    }

    const savedText = localStorage.getItem("interviewVar_session_pasteText");
    const savedCompany = localStorage.getItem("interviewVar_session_company");
    const savedRole = localStorage.getItem("interviewVar_session_role");
    const savedRound = localStorage.getItem("interviewVar_session_round");
    const savedDate = localStorage.getItem("interviewVar_session_date");
    const savedGrade = localStorage.getItem("interviewVar_session_grade");
    const savedSalary = localStorage.getItem("interviewVar_session_salary");
    const savedJobDescription = localStorage.getItem("interviewVar_session_jobDescription");
    const searchParams = new URLSearchParams(window.location.search);
    let sessionId = searchParams.get("sessionId") || localStorage.getItem("interviewVar_session_id");
    if (sessionId) {
      const newUrl = window.location.pathname + `?sessionId=${sessionId}`;
      window.history.replaceState(null, "", newUrl);
    }
    const token = localStorage.getItem("interviewVar_token");

    if (savedCompany !== null || savedRole !== null || savedRound !== null || savedDate !== null || savedJobDescription !== null || savedGrade !== null || savedSalary !== null || savedYears !== null) {
      setMetadataForm(prev => ({
        ...prev,
        company: savedCompany ? savedCompany : "",
        role: savedRole ? savedRole : "",
        round: savedRound ? savedRound : "",
        date: savedDate ? savedDate : "",
        grade: savedGrade ? savedGrade : "",
        salary: savedSalary ? savedSalary : "",
        jobDescription: savedJobDescription ? savedJobDescription : ""
      }));
    }

    if (sessionId) {
      if (fetchedSessionIdRef.current === String(sessionId)) return;
      fetchedSessionIdRef.current = String(sessionId);

      setIsLoading(true);
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;

      Promise.all([
        fetch(`${API_BASE}/api/audio/report/${sessionId}`, { headers }),
        fetch(`${API_BASE}/api/audio/session/${sessionId}/sections`, { headers })
      ]).then(async ([reportRes, sectionsRes]) => {
        if (reportRes.ok && sectionsRes.ok) {
          const report = await reportRes.json();
          const sectionsData = await sectionsRes.json();
          setReportData(report);
          
          // 2026-07-25+: 后端分析失败时直接报错,不渲染假数据
          if (report.status === "failed") {
            auth.triggerToast(report.error_message || "面试记录分析失败，请重试", "error");
            setIsLoading(false);
            localStorage.removeItem("interviewVar_session_id");
            return;
          }
          
          if (report.job_description) {
            setMetadataForm(prev => ({
              ...prev,
              jobDescription: report.job_description
            }));
          }
          // 直接用后端结构化字段，不再解析 title
          if (report.company || report.role || report.round || report.date) {
            setMetadataForm(prev => ({
              ...prev,
              company: report.company || prev.company,
              role:    report.role    || prev.role,
              round:   report.round   || prev.round,
              date:    report.date    || prev.date,
            }));
          }

          const rawTranscript = report.transcript ?? [];
          const dbSections = sectionsData.sections ?? [];

          const tagColorMap: Record<string, string> = {
            "良好": "text-[#5DECCB] bg-[#5DECCB]/10 border-[#5DECCB]/20",
            "一般": "text-[#AFA7FF] bg-[#AFA7FF]/10 border-[#AFA7FF]/20",
            "风险": "text-[#FF7A95] bg-[#FF7A95]/10 border-[#FF7A95]/20"
          };

          const mappedSections = dbSections.map((sec: any, idx: number) => {
            const sectionDialogue = rawTranscript.filter((utt: any) => {
              const t = utt.start_time ?? 0;
              const isLast = idx === dbSections.length - 1;
              if (isLast) {
                return (sec.start_time - 0.001 <= t) && (t <= sec.end_time + 0.001);
              } else {
                return (sec.start_time - 0.001 <= t) && (t < sec.end_time - 0.001);
              }
            });
            return {
              id: sec.id || (idx + 1),
              dbSectionId: sec.id,
              title: sec.title || `段落 ${idx + 1}`,
              start_time: sec.start_time,
              end_time: sec.end_time,
              timeRange: `${fmtTime(sec.start_time)} - ${fmtTime(sec.end_time)}`,
              tag: sec.tag || "一般",
              tagColor: tagColorMap[sec.tag] || "text-[#AFA7FF] bg-[#AFA7FF]/10 border-[#AFA7FF]/20",
              optimizationAdvice: sec.optimization_advice || undefined,
              dialogue: sectionDialogue.map((utt: any) => ({
                sender: utt.speaker === "Interviewer" ? "interviewer" as const : "user" as const,
                name: utt.speaker === "Interviewer" ? "面试官" : "您",
                time: fmtTime(utt.start_time || 0),
                text: utt.content,
                hasWarning: utt.speaker !== "Interviewer" && (utt.content.includes("因为 Redis 性能高") || false),
              }))
            };
          });

          setSections(mergeRecordSectionsToMax10(mappedSections));
          // Set first dialogue text to pasteText so copy/export still work without timestamps
          const fullText = rawTranscript.map((utt: any) => `${utt.speaker === "Interviewer" ? "面试官" : "我"}: ${utt.content}`).join("\n");
          setPasteText(fullText);
        } else {
          // fallback if response failed
          if (savedText && savedText.trim().length > 0) {
            setPasteText(savedText);
            parseDialogueText(savedText);
          } else {
            setPasteText(DEFAULT_TRANSCRIPT);
            parseDialogueText(DEFAULT_TRANSCRIPT);
          }
        }
      }).catch(err => {
        console.error("Failed to load backend session/sections:", err);
        // fallback on catch
        if (savedText && savedText.trim().length > 0) {
          setPasteText(savedText);
          parseDialogueText(savedText);
        } else {
          setPasteText(DEFAULT_TRANSCRIPT);
          parseDialogueText(DEFAULT_TRANSCRIPT);
        }
      }).finally(() => {
        setIsLoading(false);
        localStorage.removeItem("interviewVar_session_id");
      });
    } else {
      if (savedText && savedText.trim().length > 0) {
        setPasteText(savedText);
        parseDialogueText(savedText);
      } else {
        setPasteText(DEFAULT_TRANSCRIPT);
        parseDialogueText(DEFAULT_TRANSCRIPT);
      }
    }
  }, []);

  useEffect(() => {
    if (sections.length > 0 && !sections.some(s => s.optimizationAdvice)) {
      setIsInitialPolling(false);
    }
  }, [sections.length]);

  // Tech term highlighter for beautiful styling matching mockups
  const renderHighlightedText = (text: string) => {
    if (!text) return null;
    const regex = /(Redis|MySQL|Kafka|Guava|Ehcache)/gi;
    const parts = text.split(regex);
    return parts.map((part, index) => {
      const lower = part.toLowerCase();
      if (lower === "redis") {
        return (
          <span key={index} className="px-1.5 py-0.5 mx-0.5 rounded bg-amber-400/20 text-amber-300 font-mono text-[11px] border border-amber-400/20 font-bold select-all">
            Redis
          </span>
        );
      } else if (lower === "mysql") {
        return (
          <span key={index} className="px-1.5 py-0.5 mx-0.5 rounded bg-blue-400/20 text-blue-300 font-mono text-[11px] border border-blue-400/20 font-bold select-all">
            MySQL
          </span>
        );
      } else if (lower === "kafka") {
        return (
          <span key={index} className="px-1.5 py-0.5 mx-0.5 rounded bg-purple-400/20 text-purple-300 font-mono text-[11px] border border-purple-400/20 font-bold select-all">
            Kafka
          </span>
        );
      } else if (lower === "guava") {
        return (
          <span key={index} className="px-1.5 py-0.5 mx-0.5 rounded bg-teal-400/20 text-teal-300 font-mono text-[11px] border border-teal-400/20 font-bold select-all">
            Guava
          </span>
        );
      } else if (lower === "ehcache") {
        return (
          <span key={index} className="px-1.5 py-0.5 mx-0.5 rounded bg-emerald-400/20 text-emerald-300 font-mono text-[11px] border border-emerald-400/20 font-bold select-all">
            Ehcache
          </span>
        );
      }
      return part;
    });
  };

  // Safe inline markdown renderer for formatting tags
  const formatMarkdownInline = (text: string) => {
    if (!text) return "";
    const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
    return parts.map((part, idx) => {
      if (part.startsWith("**") && part.endsWith("**")) {
        return (
          <strong key={idx} className="font-extrabold text-[#5DECCB]">
            {part.slice(2, -2)}
          </strong>
        );
      }
      if (part.startsWith("`") && part.endsWith("`")) {
        return (
          <code key={idx} className="px-1.5 py-0.2 mx-0.5 rounded bg-white/10 text-white font-mono text-[11px] border border-white/5 select-all">
            {part.slice(1, -1)}
          </code>
        );
      }
      return part;
    });
  };

  // Parse custom lines to bubbles helper
  const parseDialogueText = (rawText: string) => {
    const lines = rawText.split("\n");
    const parsedList: DialogueItem[] = [];
    let count = 0;
    let prevSpeaker: "interviewer" | "user" = "user";

    lines.forEach((line) => {
      const cleanLine = line.trim();
      if (!cleanLine) return;

      // Extract timestamp in brackets/parentheses like (00:00) or [00:00]
      let timeStr = "";
      let remainingText = cleanLine;

      const timeMatch = cleanLine.match(/[\(\[\uff08\uff3b]([0-9]{2}:[0-9]{2})[\)\]\uff09\uff3d]/);
      if (timeMatch) {
        timeStr = timeMatch[1];
        remainingText = cleanLine.replace(timeMatch[0], "").replace(/\s+/g, " ");
      } else {
        const totalSecs = count * 95; // auto-generated timestamp
        const mins = Math.floor(totalSecs / 60);
        const secs = totalSecs % 60;
        timeStr = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
      }

      let sender: "interviewer" | "user" = "user";
      let name = "您";
      let textVal = remainingText;

      const isInterviewer = /^(面试官|Q|q|问)\d*\s*[：:\s]/.test(remainingText);
      const isUser = /^(我|您|A|a|答)\d*\s*[：:\s]/.test(remainingText);

      if (isInterviewer) {
        sender = "interviewer";
        name = "面试官";
        textVal = remainingText.replace(/^(面试官|Q|q|问)\d*\s*[：:\s]/, "").trim();
      } else if (isUser) {
        sender = "user";
        name = "您";
        textVal = remainingText.replace(/^(我|您|A|a|答)\d*\s*[：:\s]/, "").trim();
      } else {
        // Heuristics
        if (remainingText.startsWith("答")) {
          sender = "user";
          name = "您";
          textVal = remainingText.replace(/^答\s*[：:\s]?/, "").trim();
        } else if (remainingText.endsWith("？") || remainingText.endsWith("?")) {
          sender = "interviewer";
          name = "面试官";
        } else {
          // alternate speaker
          if (prevSpeaker === "interviewer") {
            sender = "user";
            name = "您";
          } else {
            sender = "interviewer";
            name = "面试官";
          }
        }
      }

      prevSpeaker = sender;
      count++;

      const hasWarn = sender === "user" && textVal.includes("因为 Redis 性能高");
      parsedList.push({
        sender,
        name,
        time: timeStr,
        text: textVal,
        hasWarning: hasWarn,
        badgeText: hasWarn ? "回答较简" : undefined,
        badgeClass: hasWarn ? "text-[#FF7A95] bg-[#FF7A95]/10 border-[#FF7A95]/20 text-[10px]" : undefined
      });
    });

    setDialogues(parsedList);
    const grouped = groupLocalDialoguesIntoSections(parsedList);
    setSections(grouped);
  };

  // Handle Manual Form Submission
  const handleAnalyzeSubmit = async () => {
    const searchParams = new URLSearchParams(window.location.search);
    const existingSessionId = searchParams.get("sessionId") || localStorage.getItem("interviewVar_session_id");
    // ── CHECK: Limit free users/guests to 1 analysis per type ──
    if (!auth.isLoggedIn) {
      if (localStorage.getItem("interviewVar_analyzed_text") === "true") {
        auth.triggerToast("您的该项分析免费体验次数已达上限，请注册或登录后使用更多功能！", "error");
        return;
      }
    } else {
      // ── 登录用户：走后端 /api/audio/quota/status 的真实配额 ──
      // 替代旧的 /api/audio/check_limit（那接口只回答"非会员是否还有 1 次免费"，
      // 不能区分 audio/record/resume 三个功能）。record 页面是"面试记录分析"，
      // 对应 feature="record"。
      try {
        const status = await getQuotaStatus();
        if (!status) {
          auth.triggerToast("无法连接服务器校验体验次数，请稍后再试！", "error");
          return;
        }
        // PRO/MAX 暂未上线，仅校验 test 与 free 配额
        if (status.record.remaining <= 0) {
          const detail = status.membership === "test"
            ? "您的内测面试记录分析额度已用完（一次性），内测期间无重置，敬请期待正式版！"
            : "您已使用过面试记录分析的免费体验，剩余次数不足，敬请期待后续更多功能！";
          auth.triggerToast(detail, "error");
          return;
        }
      } catch (err) {
        auth.triggerToast("无法连接服务器校验体验次数，请稍后再试！", "error");
        return;
      }
    }

    if (!pasteText.trim()) {
      auth.triggerToast("请填写或粘贴面试对话内容！", "error");
      return;
    }
    if (!metadataForm.company.trim()) {
      auth.triggerToast("请填写面试公司名称！", "error");
      return;
    }
    if (!metadataForm.role.trim()) {
      auth.triggerToast("请填写岗位名称！", "error");
      return;
    }
    if (!metadataForm.round.trim()) {
      auth.triggerToast("请填写面试轮次！", "error");
      return;
    }

    setIsAnalyzing(true);
    localStorage.setItem("interviewVar_session_pasteText", pasteText);
    localStorage.setItem("interviewVar_session_company", metadataForm.company);
    localStorage.setItem("interviewVar_session_role", metadataForm.role);
    localStorage.setItem("interviewVar_session_round", metadataForm.round);
    localStorage.setItem("interviewVar_session_date", metadataForm.date);
    localStorage.setItem("interviewVar_session_grade", metadataForm.grade);
    localStorage.setItem("interviewVar_session_salary", metadataForm.salary);
    localStorage.setItem("interviewVar_session_jobDescription", metadataForm.jobDescription || "");
    localStorage.setItem("interviewVar_analyzed_text", "true");

    const token = localStorage.getItem("interviewVar_token");
    const authHeaders: Record<string, string> = { "Content-Type": "application/json" };
    if (token) authHeaders["Authorization"] = `Bearer ${token}`;

    // title 仅为后端展示用，不参与结构化数据传递（结构化字段走独立列）

    try {
      // Step 1: Create InterviewSession from the pasted text
      const sessionRes = await fetch(`${API_BASE}/api/audio/create_record_session`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          paste_text: pasteText,
          company: metadataForm.company,
          role: metadataForm.role,
          round: metadataForm.round,
          date: metadataForm.date,
          grade: metadataForm.grade,
          salary: metadataForm.salary,
          job_description: metadataForm.jobDescription,
          session_id: existingSessionId ? Number(existingSessionId) : null
        })
      });
      if (!sessionRes.ok) {
        const err = await sessionRes.json();
        throw new Error(err.detail || "创建分析会话失败");
      }
      const sessionData = await sessionRes.json();
      const sessionId: number = sessionData.session_id;

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

      // Step 3: Poll progress until done — uses shared helper that aborts
      // the in-flight fetch the moment the server reports a terminal status
      // (no more trailing polls after success).
      const token2 = localStorage.getItem("interviewVar_token");
      const STEPS = [
        "文本提取——解析输入面试文字...",
        "语义分段——判定说话人角色...",
        "LLM 评估——对比用户画像与答题...",
        "AI 话术重构——生成升级建议...",
        "分析完成 — 正在生成报告..."
      ];
      try {
        await pollTaskUntilDone(taskId, {
          intervalMs: 2000,
          headers: token2 ? { Authorization: `Bearer ${token2}` } : {},
          onProgress: (pollData) => {
            const pct = pollData.progress ?? 0;
            setTaskProgress(pct);
            const si = Math.min(Math.floor((pct / 100) * STEPS.length), STEPS.length - 1);
            setTaskStep(STEPS[si]);
          },
        });
      } catch (pollErr: any) {
        throw new Error(pollErr?.message || "分析任务失败，请重试");
      }

      // Step 4: Reload page with sessionId to load report from backend
      localStorage.setItem("interviewVar_session_id", String(sessionId));
      window.location.reload();

    } catch (e: any) {
      auth.triggerToast(e.message || "启动分析失败，请重试！", "error");
      setIsAnalyzing(false);
    }
  };

  // Helper to load standard preview demo template
  const loadDemoTemplate = () => {
    setIsTemplateLoading(true);
    setTimeout(() => {
      setPasteText(DEFAULT_TRANSCRIPT);
      setMetadataForm({
        company: "字节跳动",
        role: "后端开发工程师",
        round: "二面 - 技术面",
        date: "2026-05-31",
        grade: "P6 / L5",
        salary: "25K * 16薪",
        years: "3-5年",
        isOnJob: "在职",
        jobDescription: ""
      });
      setIsTemplateLoading(false);
    }, 1200);
  };

  // Helper to copy text to clipboard
  const handleCopyToClipboard = (text: string, msg: string) => {
    navigator.clipboard.writeText(text);
    auth.triggerToast(msg);
  };

  const activeSection = sections.find(s => s.id === activeSectionId) || sections[0];
  const userDialogueTexts = activeSection?.dialogue?.filter((d: any) => d.sender === "user").map((d: any) => d.text).join(" ") || "";
  const hasUserAnswer = userDialogueTexts.trim().length > 0;
  const isOptimizing = activeSection ? !!optimizingSections[activeSection.id] : false;

  return (
    <div className="min-h-screen bg-[#050B1A] text-[#dae2fd] font-body-md flex flex-col relative overflow-x-hidden overflow-y-auto pt-20">
      
      {/* Sci-Fi Background Grids and Halos */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff02_1px,transparent_1px),linear-gradient(to_bottom,#ffffff02_1px,transparent_1px)] bg-[size:40px_40px] pointer-events-none z-0" />
      <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-[#AFA7FF]/5 rounded-full blur-[160px] pointer-events-none z-0" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-[#5DECCB]/3 rounded-full blur-[160px] pointer-events-none z-0" />

      {/* ========================================================
          GLOBAL WORKBENCH NAVBAR (Fixed top-0)
         ======================================================== */}
      <nav className="fixed top-0 w-full z-40 bg-surface/80 backdrop-blur-xl border-b border-white/10">
        <div className="flex justify-between items-center h-20 px-gutter max-w-container-max mx-auto w-full relative">
          
          <div
            onClick={() => router.push("/")}
            className="text-2xl font-display-xl font-bold tracking-tight text-on-surface flex items-center gap-3 cursor-pointer"
          >
            <img src="/logo/logo_icon.svg" alt="面试驾到" className="w-11 h-11 object-contain" />
            <span className="flex items-baseline">面试驾到</span>
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

          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push("/memory?tab=timeline")}
              className="px-4.5 py-2 bg-white/5 border border-white/10 rounded-full text-sm font-bold text-on-surface hover:bg-white/10 transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <span className="material-symbols-outlined text-base">history</span>历史记录
            </button>
            <ThemeToggle />
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

      {/* Simulated Glow Loading Screen */}
      <AnimatePresence>
        {isAnalyzing && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-[#050B1A]/95 backdrop-blur-xl flex flex-col justify-center items-center gap-6 px-8"
          >
            {/* Dual-ring spinner */}
            <div className="relative w-16 h-16 mb-2">
              <div className="absolute inset-0 rounded-full border-4 border-[#00D4FF]/20 border-t-[#00D4FF] animate-spin" />
              <div className="absolute inset-2 rounded-full border-4 border-[#5DECCB]/10 border-t-[#5DECCB] animate-spin" style={{ animationDirection: "reverse", animationDuration: "1.1s" }} />
            </div>

            <div className="text-center space-y-3">
              <h3 className="font-black text-white text-2xl md:text-3xl animate-pulse tracking-wide">
                {taskStep || "面试驾到 AI 正在分析中..."}
              </h3>
              <p className="text-base md:text-lg text-white/70 font-semibold">
                文本诊断 + 大模型智能评估，分析完成后自动进入报告
              </p>
            </div>

            {/* Progress bar */}
            <div className="w-full max-w-sm bg-white/5 rounded-full h-1.5 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#00D4FF] to-[#5DECCB] transition-all duration-700"
                style={{ width: `${taskProgress}%` }}
              />
            </div>
            <p className="text-[#5DECCB] text-2xl md:text-3xl font-black font-mono tracking-wider drop-shadow-[0_0_10px_rgba(93,236,203,0.5)] mt-2">{taskProgress}%</p>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex-none flex flex-col px-gutter max-w-container-max mx-auto w-full pt-6 pb-2 gap-5.5 text-left relative z-10">

        {showInputForm ? (
          /* ========================================================
              MANUAL DIALOGUE ENTRY & CONFIG FORM
             ======================================================== */
          <motion.div 
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            className="max-w-3xl w-full mx-auto glass-panel p-8 rounded-3xl border-white/10 space-y-6 text-left"
          >
            <div className="pb-4 border-b border-white/5 flex justify-between items-center">
              <div>
                <span className="text-[10px] font-label-mono tracking-widest text-[#AFA7FF] font-bold uppercase">Manual Transcript Analysis</span>
                <h2 className="text-xl font-black text-white mt-0.5">输入面试记录分析</h2>
              </div>
              <button 
                onClick={loadDemoTemplate}
                className="text-xs md:text-sm font-black text-[#AFA7FF] hover:text-white transition-colors cursor-pointer flex items-center gap-1"
              >
                <span className="material-symbols-outlined text-xs">bolt</span>载入字节跳动真实面试模板
              </button>
            </div>

            {isTemplateLoading ? (
              <div className="py-24 flex flex-col items-center justify-center gap-4 text-center select-none w-full">
                <div className="w-16 h-16 rounded-full border-4 border-dashed border-[#00D4FF] flex items-center justify-center relative animate-[spin:6s_linear_infinite]" style={{ animation: "spin 6s linear infinite" }} />
                <div className="space-y-1 mt-2">
                  <p className="text-base font-black text-white animate-pulse">正在载入字节跳动真实面试模板数据...</p>
                  <p className="text-xs text-white/40 font-bold font-mono">LOADING_REAL_BYTEDANCE_INTERVIEW_TEMPLATE</p>
                </div>
              </div>
            ) : (
              <>
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-xs text-white/60 font-bold">请粘贴或填写您的面试对话片段：</label>
                    <textarea
                      value={pasteText}
                      onChange={(e) => { setPasteText(e.target.value); pasteTextMod.reset(); }}
                      onBlur={(e) => pasteTextMod.check(e.target.value, "record_paste_hint")}
                      placeholder={`格式如：\n面试官：请先做个自我介绍。\n我：好的，我叫...`}
                      className="w-full h-64 bg-[#050B1A]/80 border border-white/5 rounded-2xl p-4 font-mono text-xs md:text-sm text-white focus:outline-none focus:border-[#AFA7FF]/40 transition-all leading-relaxed"
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs font-semibold text-white/60">
                    <div>
                      <label className="block mb-1.5">面试公司 *</label>
                      <input
                        type="text"
                        value={metadataForm.company}
                        onChange={(e) => setMetadataForm({ ...metadataForm, company: e.target.value })}
                        className="w-full py-2.5 px-3.5 bg-white/5 border border-white/10 rounded-xl text-white focus:outline-none focus:border-[#AFA7FF]/40 text-xs md:text-sm"
                      />
                    </div>
                    <div>
                      <label className="block mb-1.5">面试岗位 *</label>
                      <input
                        type="text"
                        value={metadataForm.role}
                        onChange={(e) => setMetadataForm({ ...metadataForm, role: e.target.value })}
                        className="w-full py-2.5 px-3.5 bg-white/5 border border-white/10 rounded-xl text-white focus:outline-none focus:border-[#AFA7FF]/40 text-xs md:text-sm"
                      />
                    </div>
                    <div>
                      <label className="block mb-1.5">面试轮次 *</label>
                      <input
                        type="text"
                        value={metadataForm.round}
                        onChange={(e) => setMetadataForm({ ...metadataForm, round: e.target.value })}
                        className="w-full py-2.5 px-3.5 bg-white/5 border border-white/10 rounded-xl text-white focus:outline-none focus:border-[#AFA7FF]/40 text-xs md:text-sm"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs font-semibold text-white/60">
                    <div>
                      <label className="block mb-1.5">面试时间</label>
                      <input
                        type="date"
                        value={metadataForm.date}
                        onChange={(e) => setMetadataForm({ ...metadataForm, date: e.target.value })}
                        className="w-full py-2.5 px-3.5 bg-white/5 border border-white/10 rounded-xl text-white focus:outline-none focus:border-[#AFA7FF]/40 text-xs md:text-sm"
                      />
                    </div>
                    <div>
                      <label className="block mb-1.5">岗位职级</label>
                      <input
                        type="text"
                        value={metadataForm.grade}
                        onChange={(e) => setMetadataForm({ ...metadataForm, grade: e.target.value })}
                        className="w-full py-2.5 px-3.5 bg-white/5 border border-white/10 rounded-xl text-white focus:outline-none focus:border-[#AFA7FF]/40 text-xs md:text-sm"
                      />
                    </div>
                    <div>
                      <label className="block mb-1.5">期望薪资</label>
                      <input
                        type="text"
                        value={metadataForm.salary}
                        onChange={(e) => setMetadataForm({ ...metadataForm, salary: e.target.value })}
                        className="w-full py-2.5 px-3.5 bg-white/5 border border-white/10 rounded-xl text-white focus:outline-none focus:border-[#AFA7FF]/40 text-xs md:text-sm"
                      />
                    </div>
                  </div>

                  <div className="mt-4">
                    <div className="flex justify-between items-center mb-1.5">
                      <label className="text-xs font-semibold text-white/60">岗位详情 [选填]</label>
                      <span className={`text-[10px] font-mono ${
                        metadataForm.jobDescription.length > 540
                          ? metadataForm.jobDescription.length >= 600 ? "text-[#FF7A95] font-black" : "text-amber-400"
                          : "text-white/30"
                      }`}>
                        {metadataForm.jobDescription.length}/600
                      </span>
                    </div>
                    <textarea
                      placeholder="粘贴岗位 JD（最多 600 字），AI 会基于真实岗位画像分析..."
                      value={metadataForm.jobDescription}
                      maxLength={600}
                      onChange={(e) => { setMetadataForm({ ...metadataForm, jobDescription: e.target.value.slice(0, 600) }); jdMod.reset(); }}
                      onBlur={(e) => jdMod.check(e.target.value, "jd_record_hint")}
                      className="w-full py-2.5 px-3.5 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/20 focus:outline-none focus:border-[#AFA7FF]/40 h-28 text-xs md:text-sm resize-none"
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-3 pt-4">
                  <button
                    onClick={() => setShowInputForm(false)}
                    className="px-5 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-sm font-black cursor-pointer text-white"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleAnalyzeSubmit}
                    className="px-6 py-2.5 bg-[#AFA7FF] text-[#050B1A] rounded-xl text-sm font-black cursor-pointer transition-all shadow-lg shadow-purple-500/10"
                  >
                    开始 AI 智能分析
                  </button>
                </div>
              </>
            )}
          </motion.div>
        ) : (
          <>
            {/* Guest Warning Banner */}
            {isGuest && (
              <div className="p-4.5 rounded-2xl bg-[#FF7A95]/10 border border-[#FF7A95]/20 text-[#FF7A95] text-xs font-semibold leading-relaxed flex items-center gap-3.5 shadow-lg select-none mb-4.5 w-full">
                <span className="material-symbols-outlined text-xl shrink-0" style={{ fontVariationSettings: "'FILL' 1" }}>warning</span>
                <div>
                  <p className="font-extrabold text-white text-sm mb-0.5">免费体验模式 (未登录)</p>
                  <p className="text-white/70">您当前未登录，系统已启用免费体验流程。<b>本次分析没有结合您的个人画像（如工作年限、目标职级等）以及历史职业记忆</b>。建议您 <span onClick={() => auth.setShowLogin(true)} className="text-[#AFA7FF] hover:underline cursor-pointer font-black">登录/注册</span> 以解锁完整的个性化深度分析与职业记忆沉淀！</p>
                </div>
              </div>
            )}

            {/* ========================================================
               WORKSPACE MAIN CONTAINER (3 COLUMNS DASHBOARD)
               ======================================================== */}
            <div className="grid grid-cols-12 gap-[22px] items-stretch w-full">

            {/* ----------------------------------------------------
                COLUMN 1: Left Sidebar switcher (3 cols)
               ---------------------------------------------------- */}
            <div className="col-span-12 lg:col-span-3 flex flex-col gap-[18px]">

              {/* 1.2 Interview Info card */}
              <div className="glass-panel p-4.5 rounded-2xl border-white/5 flex flex-col gap-3.5 h-[290px] shrink-0">
                <div className="flex justify-between items-center pb-2 border-b border-white/5">
                  <h4 className="text-base font-black text-white uppercase tracking-wider flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-base text-[#00D4FF]">assignment_ind</span>
                    面试信息
                  </h4>
                  <span 
                    onClick={() => setShowInputForm(true)}
                    className="text-base font-black text-[#AFA7FF] hover:text-white transition-colors cursor-pointer flex items-center justify-center gap-1"
                  >
                    编辑
                  </span>
                </div>

                <div className="space-y-2.5 text-xs font-bold text-white/60">
                  <div className="flex justify-between items-center">
                    <span>是否在职</span>
                    <span className="px-2 py-0.5 rounded bg-[#5DECCB]/10 text-[#5DECCB] border border-[#5DECCB]/20 text-xs font-extrabold">
                      {metadataForm.isOnJob && metadataForm.isOnJob.trim() ? metadataForm.isOnJob : (auth.user.status || "-")}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span>工作年限</span>
                    <span className="text-white font-extrabold">{metadataForm.years && metadataForm.years.trim() ? metadataForm.years : (auth.user.years || "-")}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span>面试公司</span>
                    <span className="text-white font-extrabold">{metadataForm.company && metadataForm.company.trim() ? metadataForm.company : "-"}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span>面试岗位</span>
                    <span className="text-white font-extrabold">{metadataForm.role && metadataForm.role.trim() ? metadataForm.role : "-"}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span>面试轮次</span>
                    <span className="text-white font-extrabold">{metadataForm.round && metadataForm.round.trim() ? metadataForm.round : "-"}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span>面试时间</span>
                    <span className="text-white font-extrabold">{metadataForm.date && metadataForm.date.trim() ? metadataForm.date : "-"}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span>岗位职级</span>
                    <span className="text-white font-extrabold">{metadataForm.grade && metadataForm.grade.trim() ? metadataForm.grade : "-"}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span>期望薪资</span>
                    <span className="text-white font-extrabold">{metadataForm.salary && metadataForm.salary.trim() ? metadataForm.salary : "-"}</span>
                  </div>
                </div>
              </div>

              {/* 1.3 Question Catalog */}
              <div className="glass-panel p-4.5 rounded-2xl border-white/5 flex flex-col gap-3.5 h-[470px] shrink-0">
                <div className="flex justify-between items-center pb-2 border-b border-white/5">
                  <h4 className="text-base font-black text-white uppercase tracking-wider flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-base text-[#00D4FF]">list_alt</span>
                    问题目录
                  </h4>
                  <span className="text-sm text-white/30 font-mono">共 {sections.length} 个片段</span>
                </div>

                <div className="flex-1 overflow-y-auto space-y-3 pr-1 select-none">
                  {sections.map((q, idx) => {
                    const isSelected = activeSectionId === q.id || (activeSectionId === null && idx === 0);
                    const isRisk = q.tag === "风险";
                    const isGood = q.tag === "良好";

                    // Circle dot color
                    const dotColor = isRisk ? "bg-[#FF7A95] shadow-[0_0_8px_rgba(255,122,149,0.4)]" : isGood ? "bg-[#5DECCB]" : "bg-[#AFA7FF]";
                    
                    // Right tag color
                    const badgeClass = isRisk 
                      ? "text-[#FF7A95] bg-[#FF7A95]/10 border-[#FF7A95]/20" 
                      : isGood 
                        ? "text-[#5DECCB] bg-[#5DECCB]/10 border-[#5DECCB]/20" 
                        : "text-[#AFA7FF] bg-[#AFA7FF]/10 border-[#AFA7FF]/20";

                    return (
                      <div 
                        key={q.id}
                        onClick={() => scrollToSection(q.id)}
                        className={`record-question-card p-3.5 rounded-xl border text-left cursor-pointer transition-all duration-300 relative flex items-center justify-between gap-3 ${
                          isSelected
                            ? "record-question-selected bg-[#AFA7FF]/5 border-[#AFA7FF]/20 shadow-lg shadow-[#AFA7FF]/5"
                            : "record-question-unselected bg-[#050B1A]/40 border-white/5 hover:border-white/10 hover:bg-[#050B1A]/80"
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          {/* Connector line dot */}
                          <span className={`w-2 h-2 rounded-full shrink-0 ${dotColor}`} />
                          <div className="min-w-0">
                            <h5 className={`record-question-title text-sm font-black truncate leading-tight ${isSelected ? "text-[#AFA7FF]" : "text-white"}`}>
                              Q{idx + 1} {q.title}
                            </h5>
                          </div>
                        </div>

                        <span className={`px-2 py-0.5 rounded text-[11px] font-black uppercase border shrink-0 ${badgeClass}`}>
                          {q.tag}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

            </div>

            {/* ----------------------------------------------------
                COLUMN 2: Center workspace Dialogue Analysis (6 cols)
               ---------------------------------------------------- */}
            <div className="col-span-12 lg:col-span-6 flex flex-col gap-[18px] min-w-0">
              
              {/* Main Content Board */}
              <div className="glass-panel p-5.5 rounded-2xl border-white/5 flex flex-col gap-4 h-[778px] shrink-0">
                {/* Main tabs bar with search */}
                <div className="flex justify-between items-center border-b border-white/5 select-none shrink-0">
                  <div className="flex items-center gap-6 font-black text-base">
                    {[
                      { id: "dialogue", label: "对话分析" },
                      { id: "deconstruct", label: "问题拆解" },
                      { id: "followup", label: "追问路径" },
                      { id: "assessment", label: "能力评估" }
                    ].map((tab) => (
                      <span 
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id as any)}
                        className={`pb-2.5 cursor-pointer transition-colors relative ${
                          activeTab === tab.id 
                            ? "text-[#AFA7FF] border-b-2 border-[#AFA7FF] -bottom-[1px]" 
                            : "text-white/40 hover:text-white"
                        }`}
                      >
                        {tab.label}
                      </span>
                    ))}
                  </div>

                  {activeTab === "dialogue" && (
                    <div className="record-search-box flex items-center bg-slate-100/90 dark:bg-white/5 border border-slate-200/80 dark:border-white/10 rounded-xl px-2.5 py-1 w-36 md:w-48 shadow-xs">
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="搜索对话内容..."
                        className="bg-transparent border-0 text-xs text-slate-800 dark:text-white placeholder:text-slate-400 dark:placeholder:text-white/30 focus:outline-none focus:ring-0 w-full"
                      />
                      {searchQuery && (
                        <span
                           onClick={() => setSearchQuery("")}
                           className="material-symbols-outlined text-xs text-slate-400 dark:text-white/40 hover:text-slate-700 dark:hover:text-white cursor-pointer ml-1 select-none"
                        >
                          close
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* Scrollable analysis area */}
                <div className="flex-1 overflow-y-auto pr-1">
                  {activeTab === "dialogue" ? (
                    /* Tab 1: 对话分析 Bubble list grouped by section */
                    <div className="space-y-5 pt-2 relative">
                      {sections.map((sec, secIdx) => {
                        const isCollapsed = collapsedSections[sec.id];
                        const filteredDialogue = sec.dialogue.filter((bubble: any) => 
                          bubble.text.toLowerCase().includes(searchQuery.toLowerCase())
                        );

                        if (filteredDialogue.length === 0 && searchQuery) return null;

                        return (
                          <div key={sec.id} id={`section-block-${sec.id}`} className="space-y-3">
                            {/* Collapsible Section Header */}
                            <div 
                              onClick={() => {
                                setCollapsedSections(prev => ({
                                  ...prev,
                                  [sec.id]: !prev[sec.id]
                                }));
                              }}
                              className="record-section-header flex justify-between items-center p-3 rounded-xl bg-[#f3f0ff] dark:bg-white/5 border border-[#e9d5ff] dark:border-white/10 shadow-xs hover:bg-white/10 transition-all cursor-pointer select-none"
                            >
                              <div className="flex items-center gap-2.5 text-sm font-bold text-left">
                                <span className="text-indigo-600 dark:text-[#AFA7FF] font-mono">#{secIdx + 1}</span>
                                <span className="record-section-title text-slate-900 dark:text-white font-black">{sec.title}</span>
                                <span className={`px-2 py-0.5 rounded text-[10px] uppercase border font-semibold ${sec.tagColor || "text-[#AFA7FF] bg-[#AFA7FF]/10 border-[#AFA7FF]/20"}`}>
                                  {sec.tag}
                                </span>
                              </div>
                            </div>

                            {/* Section content (dialogue bubbles) */}
                            {!isCollapsed && (
                              <div className="space-y-3.5 pl-3.5 border-l border-slate-200 dark:border-white/5">
                                {filteredDialogue.map((bubble: any, idx: number) => {
                                  const isInterviewer = bubble.sender === "interviewer";
                                  const popoverKey = `${sec.id}-${idx}`;

                                  return (
                                    <div 
                                      key={idx}
                                      className={`p-3.5 rounded-xl border transition-all duration-300 text-left flex flex-col gap-1.5 relative ${
                                        isInterviewer 
                                          ? "record-dialogue-interviewer voice-bubble-interviewer bg-indigo-600 border-indigo-700 text-white shadow-md" 
                                          : `record-dialogue-interviewee voice-bubble-interviewee bg-[#f3f0ff] border-[#e9d5ff] hover:border-purple-200 text-slate-900 shadow-xs dark:bg-[#050B1A]/40 dark:border-white/5 ${
                                              bubble.hasWarning ? "border-[#FF7A95]/30 bg-[#1e132e]/30 shadow-[0_0_12px_rgba(255,122,149,0.04)]" : ""
                                            }`
                                      }`}
                                    >
                                      <div className="flex justify-between items-center text-xs font-bold select-none">
                                        <span className={`${isInterviewer ? "text-white/90" : "text-slate-700"} dark:text-white/60 flex items-center gap-1.5 text-xs`}>
                                          <span className={`w-2.5 h-2.5 rounded-full ${isInterviewer ? "bg-rose-500" : "bg-indigo-600 dark:bg-[#00D4FF]"}`} />
                                          {bubble.name}
                                        </span>
                                        
                                        <div className="flex items-center gap-2">
                                          {bubble.hasWarning && (
                                            <span className="relative inline-block">
                                              <span 
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  setActivePopoverIdx(activePopoverIdx === popoverKey ? null : popoverKey);
                                                }}
                                                className="inline-flex items-center align-middle material-symbols-outlined text-[#FF7A95] text-base cursor-pointer select-none"
                                                style={{ fontVariationSettings: "'FILL' 1" }}
                                              >
                                                warning
                                              </span>
                                              
                                              {/* Warning Alert Popover aligned near warning element */}
                                              {activePopoverIdx === popoverKey && (
                                                <div className="absolute right-0 bottom-full mb-3 w-64 p-4 rounded-xl bg-slate-950 border border-white/10 shadow-2xl z-50 space-y-2 text-left select-none animate-[slideIn_0.2s_ease-out]">
                                                  <div className="flex justify-between items-center pb-1.5 border-b border-white/5">
                                                    <span className="text-xs font-black text-[#FF7A95] flex items-center gap-1">
                                                      <span className="material-symbols-outlined text-xs">warning</span>
                                                      表达风险
                                                    </span>
                                                    <button 
                                                      onClick={(e) => {
                                                        e.stopPropagation();
                                                        setActivePopoverIdx(null);
                                                      }}
                                                      className="text-white/30 hover:text-white text-xs font-bold leading-none cursor-pointer"
                                                    >
                                                      ✕
                                                    </button>
                                                  </div>
                                                  <div className="space-y-1.5 text-xs text-white/70 font-semibold leading-relaxed">
                                                    <p>• 缺少选型依据，未说明问题背景</p>
                                                    <p>• 没有量化指标，缺乏说服力</p>
                                                  </div>
                                                  <div className="pt-2 border-t border-white/5">
                                                    <a 
                                                      href="#upgrade-expression" 
                                                      onClick={() => {
                                                        setActivePopoverIdx(null);
                                                        const el = document.getElementById("upgrade-expression");
                                                        if(el) el.scrollIntoView({ behavior: 'smooth' });
                                                      }}
                                                      className="text-xs text-[#AFA7FF] font-black hover:text-white transition-colors cursor-pointer block text-right"
                                                    >
                                                      如何优化表达 &gt;
                                                    </a>
                                                  </div>
                                                  {/* Arrow pointing down */}
                                                  <div className="absolute top-full right-2 border-solid border-t-slate-950 border-t-8 border-x-transparent border-x-8 border-b-0 drop-shadow-md"></div>
                                                </div>
                                              )}
                                            </span>
                                          )}
                                          
                                          {bubble.badgeText && (
                                            <span className={`px-2 py-0.5 rounded border shrink-0 font-black text-[10px] uppercase ${bubble.badgeClass}`}>
                                              {bubble.badgeText}
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                      
                                      <p className={`text-[13px] md:text-sm leading-relaxed ${isInterviewer ? "text-white" : "text-slate-900"} dark:text-[#dae2fd]`}>
                                        {renderHighlightedText(bubble.text)}
                                      </p>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}

                      {/* Bottom action panel */}
                      <div className="flex justify-end items-center pt-3 select-none shrink-0 font-black text-base text-white/40">
                        <span className="px-3 py-1 bg-white/5 border border-white/10 hover:bg-white/10 hover:text-white rounded-lg cursor-pointer flex items-center gap-1 transition-all text-xs" onClick={() => {
                          let firstWarnSecId = null;
                          let firstWarnIdx = null;
                          for (const sec of sections) {
                            const wIdx = sec.dialogue.findIndex((d: any) => d.hasWarning);
                            if (wIdx !== -1) {
                              firstWarnSecId = sec.id;
                              firstWarnIdx = wIdx;
                              break;
                            }
                          }
                          if(firstWarnSecId !== null && firstWarnIdx !== null) {
                            auth.triggerToast("已定位到当前存在表达风险的问答段落！");
                            scrollToSection(firstWarnSecId);
                            setActivePopoverIdx(`${firstWarnSecId}-${firstWarnIdx}`);
                          }
                        }}>
                        </span>
                      </div>
                    </div>
                  ) : activeTab === "deconstruct" ? (
                    /* Tab 2: 问题拆解 */
                    <div className="space-y-3.5 py-2">
                      <div className="p-3.5 rounded-xl bg-white/[0.01] border border-white/5 space-y-2.5 text-left text-base font-semibold leading-relaxed">
                        <h4 className="text-base font-black text-white uppercase tracking-wider flex items-center gap-1.5">
                          <span className="material-symbols-outlined text-sm text-[#00D4FF]">account_tree</span>
                          大厂考察要点对齐
                        </h4>
                        <p className="text-white/60 text-xs md:text-sm">
                          {reportData?.analysis_result?.question_deconstruction && reportData.analysis_result.question_deconstruction.length > 0
                            ? `通过对对话的深度分析，面试官进行了以下话题和阶段的问题设计：`
                            : sections && sections.length > 0 
                              ? `通过对日志的拆解，面试官共设计了 ${sections.length} 个主要话题段落进行考察：${sections.map(s => s.title).join(" ➔ ")}。`
                              : "通过对日志的拆解，面试官在 Redis 环节共设计了 3 步渐进式提问：考察缓存作用 ➔ 考察缓存与本地内存的区别 ➔ 考察主从双写一致性一致性重试机制。"
                          }
                        </p>
                      </div>
                      <div className="flex flex-col gap-4">
                        {reportData?.analysis_result?.question_deconstruction && reportData.analysis_result.question_deconstruction.length > 0 ? (
                          reportData.analysis_result.question_deconstruction.map((item: any, idx: number) => (
                            <div key={idx} className="p-4 bg-white/[0.02] border border-white/5 rounded-xl text-sm flex flex-col gap-2 text-left">
                              <div>
                                <span className="inline-block px-2 py-0.5 rounded bg-white/5 text-white/70 font-mono text-xs font-black">
                                  {item.stage || `第 ${idx + 1} 关`}
                                </span>
                              </div>
                              <p className="text-white font-extrabold text-sm md:text-base">{item.title}</p>
                              <p className="text-xs md:text-sm text-white/40 leading-relaxed font-normal">
                                {item.desc}
                              </p>
                            </div>
                          ))
                        ) : sections && sections.length > 0 ? (
                          sections.map((sec, idx) => (
                            <div key={sec.id || idx} className="p-4 bg-white/[0.02] border border-white/5 rounded-xl text-sm flex flex-col gap-2 text-left">
                              <div>
                                <span className="inline-block px-2 py-0.5 rounded bg-white/5 text-white/70 font-mono text-xs font-black">
                                  第 {idx + 1} 关 · {sec.title}
                                </span>
                              </div>
                              <p className="text-white font-extrabold text-sm md:text-base">主考考点：{sec.title}</p>
                              <p className="text-xs md:text-sm text-white/40 leading-relaxed font-normal">
                                {sec.summary || "考查候选人在此技术领域的实际运用、理论深度以及在复杂场景下的架构考量与经验细节。"}
                              </p>
                              {sec.review_points && sec.review_points.length > 0 && (
                                <p className="text-[11px] text-[#AFA7FF] font-semibold mt-1">
                                  重点复习：{sec.review_points.join("、")}
                                </p>
                              )}
                            </div>
                          ))
                        ) : (
                          <>
                            <div className="p-4 bg-white/[0.02] border border-white/5 rounded-xl text-sm flex flex-col gap-2 text-left">
                              <div>
                                <span className="inline-block px-2 py-0.5 rounded bg-white/5 text-white/70 font-mono text-xs font-black">
                                  第 1 关 · 基础引入
                                </span>
                              </div>
                              <p className="text-white font-extrabold text-sm md:text-base">为什么使用 Redis？</p>
                              <p className="text-xs md:text-sm text-white/40 leading-relaxed font-normal">
                                考查求职者是否知道 Redis 在项目中的具体角色，是否有明确的技术背景支持还是仅仅套用热门词汇。
                              </p>
                            </div>
                            <div className="p-4 bg-white/[0.02] border border-white/5 rounded-xl text-sm flex flex-col gap-2 text-left">
                              <div>
                                <span className="inline-block px-2 py-0.5 rounded bg-[#AFA7FF]/10 text-[#AFA7FF] border border-[#AFA7FF]/20 font-mono text-xs font-black">
                                  第 2 关 · 方案对比
                                </span>
                              </div>
                              <p className="text-white font-extrabold text-sm md:text-base">为什么不用本地缓存？</p>
                              <p className="text-xs md:text-sm text-white/40 leading-relaxed font-normal">
                                深度考查对进程内缓存 (Guava/Ehcache) 与分布式缓存 (Redis) 的 Trade-off 架构对比和边界思考。
                              </p>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  ) : activeTab === "followup" ? (
                    /* Tab 3: 追问路径 */
                    <div className="space-y-4 py-2">
                      <div className="relative pl-10 space-y-5">
                        <div className="absolute left-4 top-2.5 bottom-2.5 w-0.5 bg-indigo-200 dark:bg-[#AFA7FF]/20" />
                        
                        {reportData?.analysis_result?.followup_paths && reportData.analysis_result.followup_paths.length > 0 ? (
                          reportData.analysis_result.followup_paths.map((item: any, idx: number) => {
                            const isRisk = item.tag === "风险";
                            const isGood = item.tag === "良好";
                            const dotBg = isRisk ? "bg-[#FF7A95]" : isGood ? "bg-[#5DECCB]" : "bg-[#AFA7FF]";
                            const titleColor = isRisk ? "text-rose-600 dark:text-[#FF7A95] type-rose" : isGood ? "text-emerald-600 dark:text-[#5DECCB] type-emerald" : "text-slate-800 dark:text-white/80";
                            return (
                              <div key={idx} className="relative">
                                <span className={`absolute -left-[1.75rem] top-1.5 w-3.5 h-3.5 rounded-full border-0 ${dotBg} z-20 ${isRisk ? "animate-pulse" : ""}`} />
                                <div className="text-left text-sm md:text-base space-y-1 font-semibold">
                                  <p className={`text-xs md:text-sm font-bold ${titleColor}`}>
                                    {item.title} · {item.tag || "一般"}
                                  </p>
                                  <p className="text-xs md:text-sm text-slate-600 dark:text-white/80 leading-relaxed font-normal">
                                    {item.desc}
                                  </p>
                                </div>
                              </div>
                            );
                          })
                        ) : sections && sections.length > 0 ? (
                          sections.map((sec, idx) => {
                            const isRisk = sec.tag === "风险";
                            const isGood = sec.tag === "良好";
                            const dotBg = isRisk ? "bg-[#FF7A95]" : isGood ? "bg-[#5DECCB]" : "bg-[#AFA7FF]";
                            const titleColor = isRisk ? "text-rose-600 dark:text-[#FF7A95] type-rose" : isGood ? "text-emerald-600 dark:text-[#5DECCB] type-emerald" : "text-slate-800 dark:text-white/80";

                            return (
                              <div key={sec.id || idx} className="relative">
                                <span className={`absolute -left-[1.75rem] top-1.5 w-3.5 h-3.5 rounded-full border-0 ${dotBg} z-20 ${isRisk ? "animate-pulse" : ""}`} />
                                <div className="text-left text-sm md:text-base space-y-1 font-semibold">
                                  <p className={`text-xs md:text-sm font-bold ${titleColor}`}>
                                    Q{idx + 1} {sec.title} · {sec.tag || "一般"}
                                  </p>
                                  <p className="text-xs md:text-sm text-slate-600 dark:text-white/80 leading-relaxed font-normal">
                                    {isRisk 
                                      ? `识别出回答薄弱环节：${sec.shortcomings?.[0] || sec.summary || "回答暴露了一定盲区或表达细节不完善。"}`
                                      : isGood 
                                        ? `回答亮点：${sec.advantages?.[0] || sec.summary || "回答准确清晰，体现了较好的专业底子。"}`
                                        : `${sec.summary || "技术点跟进与正常作答。"}`
                                    }
                                  </p>
                                </div>
                              </div>
                            );
                          })
                        ) : (
                          <>
                            <div className="relative">
                              <span className="absolute -left-[1.75rem] top-1.5 w-3.5 h-3.5 rounded-full border-0 bg-[#5DECCB] z-20" />
                              <div className="text-left text-base space-y-1 font-semibold">
                                <p className="text-xs md:text-sm text-slate-500 dark:text-white/40 font-bold">Q1 自我介绍 · 引导切入</p>
                                <p className="text-xs md:text-sm text-slate-700 dark:text-white font-normal">抛出“做过分布式系统与中间件开发”，成功引导面试官进入中间件板块。</p>
                              </div>
                            </div>

                            <div className="relative">
                              <span className="absolute -left-[1.75rem] top-1.5 w-3.5 h-3.5 rounded-full border-0 bg-[#AFA7FF] z-20 animate-pulse" />
                              <div className="text-left text-base space-y-1 font-semibold">
                                <p className="text-xs md:text-sm text-indigo-600 dark:text-[#AFA7FF] font-bold">Q3 Redis 选型 · 主动深挖</p>
                                <p className="text-xs md:text-sm text-slate-700 dark:text-white/80 font-normal">核心漏洞点：“因为 Redis 性能高，可以做缓存” ➔ 引出高负载高并发背景的细节追问。</p>
                              </div>
                            </div>

                            <div className="relative">
                              <span className="absolute -left-[1.75rem] top-1.5 w-3.5 h-3.5 rounded-full border-0 bg-white/5 z-20" />
                              <div className="text-left text-base space-y-1 font-semibold">
                                <p className="text-xs md:text-sm text-slate-500 dark:text-white/30 font-bold">Q5 双写一致性 · 重试质感</p>
                                <p className="text-xs md:text-sm text-slate-600 dark:text-white/40 font-normal">最终瓶颈：“定时双删”的答法暴露了高并发和真实复杂场景落地架构经验欠缺的破绽。</p>
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  ) : (
                    /* Tab 4: 能力评估 */
                    <div className="space-y-4 py-2">
                      <div className="grid grid-cols-2 gap-3.5 text-base text-left">
                        <div className="p-3.5 rounded-xl bg-white/[0.01] border border-white/5 space-y-1">
                          <span className="text-white/40 text-xs md:text-sm font-semibold">逻辑自洽度</span>
                          <p className="text-lg font-black text-white">{scoreLogic}%</p>
                          <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden mt-1">
                            <div className="h-full bg-[#5DECCB]" style={{ width: `${scoreLogic}%` }} />
                          </div>
                        </div>
                        <div className="p-3.5 rounded-xl bg-white/[0.01] border border-white/5 space-y-1">
                          <span className="text-white/40 text-xs md:text-sm font-semibold">技术细节深度</span>
                          <p className={`text-lg font-black ${scoreExpression >= 70 ? "text-[#5DECCB]" : scoreExpression >= 60 ? "text-[#AFA7FF]" : "text-[#FF7A95]"}`}>{scoreExpression}%</p>
                          <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden mt-1">
                            <div className="h-full bg-[#FF7A95]" style={{ width: `${scoreExpression}%` }} />
                          </div>
                        </div>
                        <div className="p-3.5 rounded-xl bg-white/[0.01] border border-white/5 space-y-1">
                          <span className="text-white/40 text-xs md:text-sm font-semibold">选型对比宽度</span>
                          <p className={`text-lg font-black ${scoreSystem >= 70 ? "text-[#5DECCB]" : "text-[#AFA7FF]"}`}>{scoreSystem}%</p>
                          <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden mt-1">
                            <div className="h-full bg-[#AFA7FF]" style={{ width: `${scoreSystem}%` }} />
                          </div>
                        </div>
                        <div className="p-3.5 rounded-xl bg-white/[0.01] border border-white/5 space-y-1">
                          <span className="text-white/40 text-xs md:text-sm font-semibold">业务与数据指标</span>
                          <p className={`text-lg font-black ${scoreOwnership >= 70 ? "text-[#5DECCB]" : "text-[#FF7A95]"}`}>{scoreOwnership}%</p>
                          <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden mt-1">
                            <div className="h-full bg-[#FF7A95]" style={{ width: `${scoreOwnership}%` }} />
                          </div>
                        </div>
                      </div>
                      <div className="record-strategy-card p-3.5 rounded-xl bg-[#f3f0ff] dark:bg-[#0b1326] border border-[#e9d5ff] dark:border-white/5 font-semibold text-xs md:text-sm leading-relaxed text-left space-y-1 text-slate-800 dark:text-inherit">
                        <span className="record-strategy-title text-xs md:text-sm font-black text-indigo-600 dark:text-[#AFA7FF] uppercase tracking-wider block mb-1">AI 提分战略建议</span>
                        <p className="text-xs md:text-sm text-slate-700 dark:text-white/80 leading-relaxed">
                          {reportData?.summary?.suggestions && reportData.summary.suggestions.length > 0
                            ? reportData.summary.suggestions.join(" ")
                            : reportData?.summary?.executive_summary || "求职者表达有一定条理（逻辑自洽），但对于大型系统设计的方案Trade-off对比和量化数据支持稍显薄弱。建议参考AI优化话术进行重点模块的重构和背书改进。"
                          }
                        </p>
                      </div>
                    </div>
                  )}
                </div>

              </div>

            </div>

            {/* ----------------------------------------------------
                COLUMN 3: Right Sidebar (3 cols)
               ---------------------------------------------------- */}
            <div className="col-span-12 lg:col-span-3 flex flex-col gap-[18px] text-left">
              
              {/* 3.1 Scores widgets */}
              <div className="grid grid-cols-2 gap-4 select-none h-[120px] shrink-0">
                <div className="glass-panel p-4.5 rounded-2xl border-white/5 flex flex-col gap-1.5">
                  <span className="text-base font-bold text-white/40">综合评分</span>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-3xl font-black font-label-mono text-[#5DECCB]">78</span>
                    <span className="text-[10px] text-white/30">/100</span>
                  </div>
                  <span className="px-1.5 py-0.2 rounded bg-[#5DECCB]/10 text-[#5DECCB] border border-[#5DECCB]/20 text-[9px] font-black uppercase text-center block w-fit">
                    中级候选人
                  </span>
                </div>

                <div className="glass-panel p-4.5 rounded-2xl border-white/5 flex flex-col gap-1.5">
                  <span className="text-base font-bold text-white/40">Offer 风险</span>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-3xl font-black font-label-mono text-[#FFB2B7]">42%</span>
                  </div>
                  <span className="px-1.5 py-0.2 rounded bg-amber-400/10 text-amber-400 border border-amber-400/20 text-[9px] font-black uppercase text-center block w-fit">
                    中等风险
                  </span>
                </div>
              </div>

              {/* 3.2 Largest Lose Point TOP 3 */}
              <div className="glass-panel p-4.5 rounded-2xl border-white/5 flex flex-col gap-3.5 select-none h-[150px] shrink-0">
                <div className="flex justify-between items-center pb-2 border-b border-white/5 shrink-0">
                  <h4 className="text-sm font-black text-white uppercase tracking-wider flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-sm text-[#FF7A95]">report</span>
                    最大失分点 TOP 3
                  </h4>
                  <span 
                    onClick={() => setShowAllWeaknesses(true)}
                    className="text-xs font-black text-[#FF7A95] hover:text-white transition-colors cursor-pointer flex items-center gap-0.5"
                  >
                    查看全部 <span className="material-symbols-outlined text-xs">keyboard_arrow_right</span>
                  </span>
                </div>

                <div className="space-y-3 flex-1 overflow-y-auto pr-1">
                  {(() => {
                    const maxLosePoints = reportData?.analysis_result?.max_lose_points;
                    if (maxLosePoints && maxLosePoints.length > 0) {
                      return maxLosePoints.slice(0, 3).map((lose: any, idx: number) => {
                        const rank = lose.rank || (idx + 1);
                        const label = lose.label;
                        const desc = lose.desc;
                        const tag = lose.tag || (idx === 0 ? "高风险" : "中风险");
                        const tagClass = tag === "高风险"
                          ? "text-[#FF7A95] bg-[#FF7A95]/10 border-[#FF7A95]/20 text-[9px] font-black"
                          : "text-amber-400 bg-amber-400/10 border-amber-400/20 text-[9px] font-black";
                        return (
                          <div key={idx} className="record-risk-card p-2 rounded-xl bg-[#050B1A]/80 border border-white/5 space-y-1.5 text-left text-xs md:text-sm">
                            <div className="flex justify-between items-center">
                              <span className="record-risk-title font-extrabold text-white flex items-center gap-1.5 text-xs md:text-sm truncate mr-2">
                                <span className="record-risk-rank w-4 h-4 rounded-full bg-white/5 flex items-center justify-center shrink-0 font-mono text-xs font-black text-white/55">{rank}</span>
                                <span className="truncate">{label}</span>
                              </span>
                              <span className={`px-1.5 py-0.2 rounded border shrink-0 ${tagClass}`}>
                                {tag}
                              </span>
                            </div>
                            <p className="record-risk-desc text-xs text-white/45 leading-snug font-bold">
                              {desc}
                            </p>
                          </div>
                        );
                      });
                    }
                    const weaknesses = reportData?.summary?.weaknesses || [];
                    if (weaknesses.length > 0) {
                      return weaknesses.slice(0, 3).map((w: string, idx: number) => {
                        const parts = w.split(/[：:]/);
                        const label = parts[0] || w;
                        const desc = parts[1] || "候选人在答题时展现出的薄弱环节，建议结合AI优化话术做针对性复习提高。";
                        const tag = idx === 0 ? "高风险" : "中风险";
                        const tagClass = idx === 0 
                          ? "text-[#FF7A95] bg-[#FF7A95]/10 border-[#FF7A95]/20 text-[9px] font-black" 
                          : "text-amber-400 bg-amber-400/10 border-amber-400/20 text-[9px] font-black";
                        return (
                          <div key={idx} className="p-2 rounded-xl bg-[#050B1A]/80 border border-white/5 space-y-1.5 text-left text-xs md:text-sm">
                            <div className="flex justify-between items-center">
                              <span className="font-extrabold text-white flex items-center gap-1.5 text-xs md:text-sm truncate mr-2">
                                <span className="w-4 h-4 rounded-full bg-white/5 flex items-center justify-center shrink-0 font-mono text-xs font-black text-white/55">{idx + 1}</span>
                                <span className="truncate">{label}</span>
                              </span>
                              <span className={`px-1.5 py-0.2 rounded border shrink-0 ${tagClass}`}>
                                {tag}
                              </span>
                            </div>
                            <p className="text-xs text-white/45 leading-snug font-bold">
                              {desc}
                            </p>
                          </div>
                        );
                      });
                    }
                    return [
                      { rank: 1, label: "Redis 选型依据不足", tag: "高风险", tagClass: "text-[#FF7A95] bg-[#FF7A95]/10 border-[#FF7A95]/20 text-[9px] font-black", desc: "缺少问题背景和选型对比，无法体现技术决策能力" },
                      { rank: 2, label: "没有 Trade-off 分析", tag: "中风险", tagClass: "text-amber-400 bg-amber-400/10 border-amber-400/20 text-[9px] font-black", desc: "回答较表面，缺乏权衡思考和方案对比" },
                      { rank: 3, label: "项目贡献模糊", tag: "中风险", tagClass: "text-amber-400 bg-amber-400/10 border-amber-400/20 text-[9px] font-black", desc: "未突出个人贡献和负责的核心模块" }
                    ].map((lose) => (
                      <div key={lose.rank} className="p-2 rounded-xl bg-[#050B1A]/80 border border-white/5 space-y-1.5 text-left text-xs md:text-sm">
                        <div className="flex justify-between items-center">
                          <span className="font-extrabold text-white flex items-center gap-1.5 text-xs md:text-sm">
                            <span className="w-4 h-4 rounded-full bg-white/5 flex items-center justify-center font-mono text-xs font-black text-white/55">{lose.rank}</span>
                            {lose.label}
                          </span>
                          <span className={`px-1.5 py-0.2 rounded border shrink-0 ${lose.tagClass}`}>
                            {lose.tag}
                          </span>
                        </div>
                        <p className="text-xs text-white/45 leading-snug font-bold">
                          {lose.desc}
                        </p>
                      </div>
                    ));
                  })()}
                </div>
              </div>

              {/* 3.3 Interviewer Perspective */}
              <div className="glass-panel p-4.5 rounded-2xl border-white/5 flex flex-col gap-3.5 select-none h-[154px] shrink-0 overflow-visible relative z-10">
                <div className="flex justify-between items-center pb-2 border-b border-white/5 shrink-0">
                  <h4 className="text-sm font-black text-white uppercase tracking-wider flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-sm text-[#00D4FF]">psychology</span>
                    面试官视角：真正验证什么
                  </h4>
                  <span 
                    onClick={() => setShowAllPerspectives(true)}
                    className="text-xs font-black text-[#00D4FF] hover:text-white transition-colors cursor-pointer flex items-center gap-0.5"
                  >
                    展开全部 <span className="material-symbols-outlined text-xs">keyboard_arrow_right</span>
                  </span>
                </div>

                <div className="space-y-2 font-bold text-xs md:text-sm text-white/60 flex-1 overflow-y-auto custom-scrollbar pr-1">
                  {(() => {
                    const perspective = reportData?.analysis_result?.interviewer_perspective;
                    if (perspective && perspective.length > 0) {
                      return perspective.map((p: any, i: number) => (
                        <div 
                          key={i} 
                          onMouseEnter={(e) => {
                            const rect = e.currentTarget.getBoundingClientRect();
                            const cardRect = e.currentTarget.closest('.glass-panel')?.getBoundingClientRect();
                            if (rect && cardRect) {
                              setHoveredPerspective({
                                label: p.label,
                                val: p.val,
                                top: rect.top - cardRect.top,
                                left: rect.left - cardRect.left,
                                width: rect.width
                              });
                            }
                          }}
                          onMouseLeave={() => setHoveredPerspective(null)}
                          className="record-perspective-item flex justify-between items-center py-1.5 px-2 rounded bg-white/[0.01] border border-white/5 hover:border-white/10 hover:text-white cursor-pointer transition-all relative group"
                        >
                          <span className="flex items-center gap-1 text-xs md:text-sm shrink-0 mr-4">
                            <span className="record-perspective-icon material-symbols-outlined text-xs text-white/30 shrink-0">folder_open</span>
                            <span className="record-perspective-label font-extrabold text-white">{p.label}</span>
                          </span>
                          <span className="record-perspective-val text-white/40 font-semibold flex items-center gap-0.5 text-xs md:text-sm truncate flex-1 justify-end min-w-0">
                            <span className="truncate">{p.val}</span>
                            <span className="record-perspective-arrow material-symbols-outlined text-xs shrink-0">chevron_right</span>
                          </span>
                        </div>
                      ));
                    }
                    return [
                      { label: "Redis 相关问题", val: "验证缓存设计能力" },
                      { label: "一致性问题", val: "验证分布式系统架构能力" },
                      { label: "TCC 与 Saga", val: "验证分布式事务经验" },
                      { label: "项目深度挖", val: "验证真实项目经验" }
                    ].map((p, i) => (
                      <div 
                        key={i} 
                        onMouseEnter={(e) => {
                          const rect = e.currentTarget.getBoundingClientRect();
                          const cardRect = e.currentTarget.closest('.glass-panel')?.getBoundingClientRect();
                          if (rect && cardRect) {
                            setHoveredPerspective({
                              label: p.label,
                              val: p.val,
                              top: rect.top - cardRect.top,
                              left: rect.left - cardRect.left,
                              width: rect.width
                            });
                          }
                        }}
                        onMouseLeave={() => setHoveredPerspective(null)}
                        className="flex justify-between items-center py-1.5 px-2 rounded bg-white/[0.01] border border-white/5 hover:border-white/10 hover:text-white cursor-pointer transition-all relative group"
                      >
                        <span className="flex items-center gap-1 text-xs md:text-sm shrink-0 mr-4">
                          <span className="material-symbols-outlined text-xs text-white/30 shrink-0">folder_open</span>
                          <span className="font-extrabold text-white">{p.label}</span>
                        </span>
                        <span className="text-white/40 font-semibold flex items-center gap-0.5 text-xs md:text-sm truncate flex-1 justify-end min-w-0">
                          <span className="truncate">{p.val}</span>
                          <span className="material-symbols-outlined text-xs shrink-0">chevron_right</span>
                        </span>
                      </div>
                    ));
                  })()}
                </div>

                {/* Floating Custom Tooltip rendered at card level, escaping the list scroll container! */}
                <AnimatePresence>
                  {hoveredPerspective && (
                    <motion.div 
                      initial={{ opacity: 0, x: "-50%", y: "-95%", scale: 0.95 }}
                      animate={{ opacity: 1, x: "-50%", y: "-100%", scale: 1 }}
                      exit={{ opacity: 0, x: "-50%", y: "-95%", scale: 0.95 }}
                      className="absolute w-72 p-3 rounded-xl bg-[#0b1326] border border-white/15 text-xs text-white leading-relaxed shadow-2xl z-30 pointer-events-none"
                      style={{
                        left: `${hoveredPerspective.left + hoveredPerspective.width / 2}px`,
                        top: `${hoveredPerspective.top - 8}px`
                      }}
                      transition={{ duration: 0.15, ease: "easeOut" }}
                    >
                      <div className="font-extrabold text-[#00D4FF] mb-1.5 flex items-center gap-1">
                        <span className="material-symbols-outlined text-xs shrink-0">psychology</span>
                        {hoveredPerspective.label}
                      </div>
                      <div className="text-white/70 font-semibold bg-white/[0.02] border border-white/5 p-2 rounded-lg">
                        <span className="text-white/40 block text-[10px] mb-0.5">验证核心能力：</span>
                        {hoveredPerspective.val}
                      </div>
                      <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 border-4 border-transparent border-t-[#0b1326]" />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* 3.4 Project Authenticity Risk Radar */}
              <div className="glass-panel p-4.5 rounded-2xl border-white/5 flex flex-col gap-3 h-[300px] shrink-0">
                <div className="flex justify-between items-center pb-2 border-b border-white/5 select-none shrink-0">
                  <h4 className="text-sm font-black text-white uppercase tracking-wider flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-sm text-[#FFB2B7]">radar</span>
                    项目真实性风险 ❓
                  </h4>
                </div>

                <div className="flex flex-col gap-2 flex-1 min-h-0 justify-center">
                  {/* Pentagon Radar Chart Resized to 220x220 centered */}
                  <div className="flex justify-center items-center py-1 select-none shrink-0">
                    <svg className="w-[220px] h-[220px] overflow-visible" viewBox="0 0 220 220">
                      <defs>
                        <filter id="mesh-glow-record" x="-20%" y="-20%" width="140%" height="140%">
                          <feGaussianBlur stdDeviation="3" result="blur" />
                          <feMerge>
                            <feMergeNode in="blur" />
                            <feMergeNode in="SourceGraphic" />
                          </feMerge>
                        </filter>
                      </defs>

                      {/* Inner grid lines & Concentric pentagons */}
                      {[18, 36, 54, 72].map((radius, rIdx) => {
                        const pts = [
                          { x: 110, y: 110 - radius }, // Top
                          { x: 110 + radius * Math.cos((-18 * Math.PI) / 180), y: 110 + radius * Math.sin((-18 * Math.PI) / 180) }, // Right Top
                          { x: 110 + radius * Math.cos((54 * Math.PI) / 180), y: 110 + radius * Math.sin((54 * Math.PI) / 180) }, // Right Bottom
                          { x: 110 + radius * Math.cos((126 * Math.PI) / 180), y: 110 + radius * Math.sin((126 * Math.PI) / 180) }, // Left Bottom
                          { x: 110 + radius * Math.cos((198 * Math.PI) / 180), y: 110 + radius * Math.sin((198 * Math.PI) / 180) }  // Left Top
                        ];
                        const pathD = `M ${pts[0].x} ${pts[0].y} L ${pts[1].x} ${pts[1].y} L ${pts[2].x} ${pts[2].y} L ${pts[3].x} ${pts[3].y} L ${pts[4].x} ${pts[4].y} Z`;

                        return (
                          <path 
                            key={rIdx} 
                            d={pathD} 
                            fill="none" 
                            stroke="white" 
                            strokeWidth="0.5" 
                            strokeOpacity={rIdx === 3 ? "0.08" : "0.03"} 
                            className="voice-radar-line"
                          />
                        );
                      })}

                      {/* Connecting vertical Axes */}
                      {[0, 72, 144, 216, 288].map((angle, aIdx) => {
                        const targetX = 110 + 72 * Math.cos(((angle - 90) * Math.PI) / 180);
                        const targetY = 110 + 72 * Math.sin(((angle - 90) * Math.PI) / 180);
                        return (
                          <line 
                            key={aIdx} 
                            x1="110" y1="110" x2={targetX} y2={targetY} 
                            stroke="white" strokeWidth="0.5" strokeOpacity="0.04" 
                            className="voice-radar-line"
                          />
                        );
                      })}

                      {/* Shaded neon data polygon */}
                      {(() => {
                        const rDepth = (scoreLogic / 100) * 72;
                        const rSystem = (scoreSystem / 100) * 72;
                        const rExpression = (scoreExpression / 100) * 72;
                        const rSolving = (scoreOwnership / 100) * 72;
                        const rImplementation = (scoreProject / 100) * 72;

                        const pt0 = { x: 110, y: 110 - rDepth };
                        const pt1 = { x: 110 + rSystem * Math.cos((-18 * Math.PI) / 180), y: 110 + rSystem * Math.sin((-18 * Math.PI) / 180) };
                        const pt2 = { x: 110 + rExpression * Math.cos((54 * Math.PI) / 180), y: 110 + rExpression * Math.sin((54 * Math.PI) / 180) };
                        const pt3 = { x: 110 + rSolving * Math.cos((126 * Math.PI) / 180), y: 110 + rSolving * Math.sin((126 * Math.PI) / 180) };
                        const pt4 = { x: 110 + rImplementation * Math.cos((198 * Math.PI) / 180), y: 110 + rImplementation * Math.sin((198 * Math.PI) / 180) };

                        const dString = `M ${pt0.x} ${pt0.y} L ${pt1.x} ${pt1.y} L ${pt2.x} ${pt2.y} L ${pt3.x} ${pt3.y} L ${pt4.x} ${pt4.y} Z`;

                        return (
                          <g>
                            <path 
                              d={dString} 
                              fill="#8B5CF6" fillOpacity="0.12" 
                              stroke="#AFA7FF" strokeWidth="1.75" 
                              filter="url(#mesh-glow-record)" 
                            />
                            {/* Vertices dot hooks */}
                            {[pt0, pt1, pt2, pt3, pt4].map((pt, pIdx) => (
                              <g key={pIdx}>
                                <circle cx={pt.x} cy={pt.y} r="2.5" fill="white" />
                                <circle cx={pt.x} cy={pt.y} r="5.5" fill="none" stroke="#AFA7FF" strokeWidth="0.5" strokeOpacity="0.5" />
                              </g>
                            ))}
                          </g>
                        );
                      })()}

                      {/* Dimension Labels */}
                      <text x="110" y="20" className="voice-radar-text font-bold" fontSize="13" textAnchor="middle">
                        逻辑自洽 <tspan fill="#4f46e5" className="dark:fill-[#AFA7FF]" fontWeight="900">{scoreLogic}</tspan>
                      </text>
                      <text x="195" y="92" className="voice-radar-text font-bold" fontSize="13" textAnchor="start">
                        技术广度 <tspan fill="#4f46e5" className="dark:fill-[#AFA7FF]" fontWeight="900">{scoreSystem}</tspan>
                      </text>
                      <text x="172" y="185" className="voice-radar-text font-bold" fontSize="13" textAnchor="start">
                        数据指标 <tspan fill="#4f46e5" className="dark:fill-[#AFA7FF]" fontWeight="900">{scoreExpression}</tspan>
                      </text>
                      <text x="48" y="185" className="voice-radar-text font-bold" fontSize="13" textAnchor="end">
                        业务理解 <tspan fill="#4f46e5" className="dark:fill-[#AFA7FF]" fontWeight="900">{scoreOwnership}</tspan>
                      </text>
                      <text x="25" y="92" className="voice-radar-text font-bold" fontSize="13" textAnchor="end">
                        细节深度 <tspan fill="#4f46e5" className="dark:fill-[#AFA7FF]" fontWeight="900">{scoreProject}</tspan>
                      </text>
                    </svg>
                  </div>
                </div>
              </div>

            </div>

          </div>

          {/* ========================================================
              BOTTOM ROW: Expression Upgrade & Diagnostic (Full Width)
             ======================================================== */}
          <div id="upgrade-expression" className="glass-panel p-5.5 rounded-2xl border-white/5 grid grid-cols-12 gap-5.5 w-full select-none mt-3.5 scroll-mt-24 items-stretch">
            
            {/* Section 1: 表达升级 title & your answer (4 cols) */}
            <div className="col-span-12 lg:col-span-4 flex gap-3.5 border-r border-white/5 pr-4 h-full items-start">
              <div className="w-9 h-9 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center shrink-0 text-[#AFA7FF] mt-0.5">
                <span className="material-symbols-outlined text-lg">auto_awesome</span>
              </div>
              <div className="flex flex-col flex-1 text-left h-full justify-between">
                <div>
                  <h4 className="text-sm font-black text-white uppercase tracking-wider">表达升级 · 你的回答</h4>
                  <p className="text-xs text-white/40 leading-normal block mt-1 mb-2 truncate">当前片段：{activeSection?.title || "（暂无）"}</p>
                </div>
                <div className="bg-white/[0.01] border border-white/5 p-3 rounded-xl text-white/50 font-mono text-xs md:text-sm leading-relaxed flex-1 mt-3 overflow-y-auto max-h-[160px] select-all">
                  {activeSection?.optimizationAdvice?.original || userDialogueTexts || "（当前片段暂无您的回答记录）"}
                </div>
              </div>
            </div>

            {/* Section 2: 优化后话术 (5 cols) */}
            <div className="col-span-12 lg:col-span-5 flex gap-3.5 border-r border-white/5 px-2 h-full items-start">
              <div className="w-9 h-9 rounded-xl bg-[#5DECCB]/10 border border-[#5DECCB]/20 flex items-center justify-center shrink-0 text-[#5DECCB] mt-0.5">
                <span className="material-symbols-outlined text-lg">verified</span>
              </div>
              <div className="flex flex-col flex-1 text-left h-full justify-between">
                <div>
                  <h4 className="text-sm font-black text-[#5DECCB] uppercase tracking-wider flex items-center gap-1">
                    优化后话术
                  </h4>
                  <p className="text-xs text-white/40 leading-normal block mt-1 mb-2">推荐：AI 专家版</p>
                </div>
                
                {isOptimizing ? (
                  <div className="bg-slate-950/60 border border-white/5 p-3.5 rounded-xl text-white/40 font-mono text-xs md:text-sm flex-1 mt-3 flex flex-col items-center justify-center gap-3 select-none min-h-[120px]">
                    <div className="w-7 h-7 rounded-full border-2 border-[#5DECCB]/20 border-t-[#5DECCB] animate-spin" />
                    <span className="text-base text-white/50 font-bold animate-pulse">正在重构优化高分话术...</span>
                  </div>
                ) : activeSection?.optimizationAdvice ? (
                  <div className="bg-slate-950/60 border border-[#5DECCB]/25 p-3.5 rounded-xl font-mono leading-relaxed text-xs md:text-sm flex-1 mt-3 overflow-y-auto max-h-[160px] flex flex-col gap-2.5">
                    {activeSection?.optimizationAdvice?.conclusion && (
                      <div className="text-[11px] text-[#FF7A95] bg-[#FF7A95]/5 border border-[#FF7A95]/15 p-2 rounded-lg font-sans font-semibold leading-relaxed">
                        <span className="font-extrabold block text-xs mb-0.5 text-[#FF7A95]">AI 诊断结论：</span>
                        {activeSection.optimizationAdvice.conclusion}
                      </div>
                    )}
                    <div 
                      className="text-white text-xs md:text-sm whitespace-pre-wrap leading-relaxed select-all"
                      dangerouslySetInnerHTML={{ __html: activeSection.optimizationAdvice.optimized || "" }}
                    />
                  </div>
                ) : isInitialPolling ? (
                  <div className="bg-slate-950/60 border border-white/5 p-3.5 rounded-xl text-white/40 font-mono text-xs md:text-sm flex-1 mt-3 flex flex-col items-center justify-center gap-3 select-none min-h-[120px]">
                    <div className="w-7 h-7 rounded-full border-2 border-[#5DECCB]/20 border-t-[#5DECCB] animate-spin" />
                    <span className="text-base text-white/50 font-bold animate-pulse">AI 正在重构该片段的高分话术...</span>
                  </div>
                ) : (
                  <div className="bg-slate-950/60 border border-white/5 p-3.5 rounded-xl text-white/40 font-mono text-xs md:text-sm flex-1 mt-3 flex flex-col items-center justify-center gap-3 select-none min-h-[120px]">
                    <span className="text-xs text-white/30 font-semibold">该片段暂未生成 AI 优化建议</span>
                    <button
                      disabled={!hasUserAnswer}
                      onClick={() => handleOptimizeSection(activeSection.id)}
                      className={`px-5 py-2 font-extrabold text-xs rounded-lg flex items-center gap-1.5 transition-all ${
                        !hasUserAnswer 
                          ? "bg-white/5 border border-white/10 text-white/20 cursor-not-allowed" 
                          : "bg-[#5DECCB] hover:bg-white text-[#050B1A] cursor-pointer shadow-lg shadow-cyan-500/10"
                      }`}
                    >
                      <span className="material-symbols-outlined text-sm">bolt</span>
                      生成优化建议
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Section 3: Action Buttons (3 cols) */}
            <div className="col-span-12 lg:col-span-3 pl-2 flex gap-3.5 h-full items-start">
              <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0 text-[#FFB020] mt-0.5">
                <span className="material-symbols-outlined text-lg">touch_app</span>
              </div>
              <div className="flex flex-col flex-1 text-left justify-start">
                <div>
                  <h4 className="text-sm font-black text-white uppercase tracking-wider text-left">下一步操作</h4>
                  <p className="text-xs text-white/40 leading-normal block mt-1 mb-2">行动建议：复制或保存优化话术</p>
                </div>
                <div className="flex flex-col gap-2 mt-3">
                  {isOptimizing ? (
                    <>
                      <button disabled className="w-full py-2 bg-white/5 border border-white/10 text-white/30 rounded-lg font-black text-xs md:text-sm cursor-not-allowed flex items-center justify-center gap-1">
                        <span className="material-symbols-outlined text-xs">hourglass_empty</span>正在处理...
                      </button>
                    </>
                  ) : activeSection?.optimizationAdvice ? (
                    <>
                      <button 
                        onClick={() => {
                          const cleanText = stripHtml(activeSection.optimizationAdvice.optimized);
                          handleCopyToClipboard(cleanText, "已复制优化后高分话术！");
                        }}
                        className="w-full py-2 bg-gradient-to-r from-secondary to-primary text-on-primary rounded-lg font-black text-xs md:text-sm cursor-pointer flex items-center justify-center gap-1 shadow-md shadow-secondary/15"
                      >
                        <span className="material-symbols-outlined text-xs">content_copy</span>复制优化版本
                      </button>
                    </>
                  ) : isInitialPolling ? (
                    <>
                      <button disabled className="w-full py-2 bg-white/5 border border-white/10 text-white/30 rounded-lg font-black text-xs md:text-sm cursor-not-allowed flex items-center justify-center gap-1">
                        <span className="material-symbols-outlined text-xs">hourglass_empty</span>正在重构...
                      </button>
                    </>
                  ) : (
                    <>
                      <button 
                        disabled={!hasUserAnswer}
                        onClick={() => handleOptimizeSection(activeSection.id)}
                        className={`w-full py-2 rounded-lg font-black text-xs md:text-sm flex items-center justify-center gap-1 transition-all ${
                          !hasUserAnswer 
                            ? "bg-white/5 border border-white/10 text-white/20 cursor-not-allowed" 
                            : "bg-[#AFA7FF] hover:bg-white text-[#050B1A] cursor-pointer shadow-lg shadow-purple-500/10"
                        }`}
                      >
                        <span className="material-symbols-outlined text-xs">bolt</span>生成优化建议
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>

          </div>
          </>
        )}

      {/* Modal: 最大失分点全部内容 */}
      <AnimatePresence>
        {showAllWeaknesses && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#050B1A]/80 backdrop-blur-md p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-lg glass-panel p-6 rounded-3xl border border-white/10 flex flex-col max-h-[80vh] overflow-hidden"
            >
              <div className="flex justify-between items-center pb-3 border-b border-white/5 shrink-0">
                <h3 className="text-base font-black text-white flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-sm text-[#FF7A95]">report</span>
                  全部失分点分析
                </h3>
                <button
                  onClick={() => setShowAllWeaknesses(false)}
                  className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 text-white/50 hover:text-white transition-all cursor-pointer flex items-center justify-center"
                >
                  <span className="material-symbols-outlined text-sm">close</span>
                </button>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto py-4 space-y-3.5 pr-1.5 custom-scrollbar max-h-[320px]">
                {(() => {
                  const maxLosePoints = reportData?.analysis_result?.max_lose_points;
                  if (maxLosePoints && maxLosePoints.length > 0) {
                    return maxLosePoints.map((lose: any, idx: number) => {
                      const rank = lose.rank || (idx + 1);
                      const label = lose.label;
                      const desc = lose.desc;
                      const tag = lose.tag || (idx === 0 ? "高风险" : "中风险");
                      const tagClass = tag === "高风险"
                        ? "text-[#FF7A95] bg-[#FF7A95]/10 border-[#FF7A95]/20 text-sm font-black"
                        : "text-amber-500 bg-amber-400/10 border-amber-400/20 text-sm font-black";
                      return (
                        <div key={idx} className="record-risk-card p-3 rounded-xl bg-[#f3f0ff] dark:bg-[#050B1A]/80 border border-[#e9d5ff] dark:border-white/5 space-y-2 text-left">
                          <div className="flex justify-between items-center">
                            <span className="record-risk-title font-extrabold text-slate-900 dark:text-white flex items-center gap-1.5 text-xs md:text-sm truncate mr-2">
                              <span className="record-risk-rank w-5 h-5 rounded-full bg-slate-200 dark:bg-white/5 flex items-center justify-center shrink-0 font-mono text-xs font-black text-slate-700 dark:text-white/55">{rank}</span>
                              <span className="truncate">{label}</span>
                            </span>
                            <span className={`px-1.5 py-0.2 rounded border shrink-0 ${tagClass}`}>
                              {tag}
                            </span>
                          </div>
                          <p className="record-risk-desc text-xs text-slate-600 dark:text-white/50 leading-relaxed font-semibold">
                            {desc}
                          </p>
                        </div>
                      );
                    });
                  }
                  const weaknesses = reportData?.summary?.weaknesses || [];
                  if (weaknesses.length > 0) {
                    return weaknesses.map((w: string, idx: number) => {
                      const parts = w.split(/[：:]/);
                      const label = parts[0] || w;
                      const desc = parts[1] || "候选人在答题时展现出的薄弱环节，建议结合AI优化话术做针对性复习提高。";
                      const tag = idx === 0 ? "高风险" : "中风险";
                      const tagClass = idx === 0 
                        ? "text-[#FF7A95] bg-[#FF7A95]/10 border-[#FF7A95]/20 text-[9px] font-black" 
                        : "text-amber-500 bg-amber-400/10 border-amber-400/20 text-[9px] font-black";
                      return (
                        <div key={idx} className="record-risk-card p-3 rounded-xl bg-[#f3f0ff] dark:bg-[#050B1A]/80 border border-[#e9d5ff] dark:border-white/5 space-y-2 text-left">
                          <div className="flex justify-between items-center">
                            <span className="record-risk-title font-extrabold text-slate-900 dark:text-white flex items-center gap-1.5 text-xs md:text-sm truncate mr-2">
                              <span className="record-risk-rank w-5 h-5 rounded-full bg-slate-200 dark:bg-white/5 flex items-center justify-center shrink-0 font-mono text-xs font-black text-slate-700 dark:text-white/55">{idx + 1}</span>
                              <span className="truncate">{label}</span>
                            </span>
                            <span className={`px-1.5 py-0.2 rounded border shrink-0 ${tagClass}`}>
                              {tag}
                            </span>
                          </div>
                          <p className="record-risk-desc text-xs text-slate-600 dark:text-white/50 leading-relaxed font-semibold">
                            {desc}
                          </p>
                        </div>
                      );
                    });
                  }
                  return [
                    { rank: 1, label: "Redis 选型依据不足", tag: "高风险", desc: "缺少问题背景和选型对比，无法体现技术决策能力" },
                    { rank: 2, label: "没有 Trade-off 分析", tag: "中风险", desc: "回答较表面，缺乏权衡思考 and 方案对比" },
                    { rank: 3, label: "项目贡献模糊", tag: "中风险", desc: "未突出个人贡献 and 负责的核心模块" }
                  ].map((lose, idx) => {
                    const tagClass = lose.tag === "高风险"
                      ? "text-[#FF7A95] bg-[#FF7A95]/10 border-[#FF7A95]/20 text-[9px] font-black"
                      : "text-amber-500 bg-amber-400/10 border-amber-400/20 text-[9px] font-black";
                    return (
                      <div key={idx} className="record-risk-card p-3 rounded-xl bg-[#f3f0ff] dark:bg-[#050B1A]/80 border border-[#e9d5ff] dark:border-white/5 space-y-2 text-left">
                        <div className="flex justify-between items-center">
                          <span className="record-risk-title font-extrabold text-slate-900 dark:text-white flex items-center gap-1.5 text-xs md:text-sm">
                            <span className="record-risk-rank w-5 h-5 rounded-full bg-slate-200 dark:bg-white/5 flex items-center justify-center font-mono text-xs font-black text-slate-700 dark:text-white/55">{lose.rank}</span>
                            {lose.label}
                          </span>
                          <span className={`px-1.5 py-0.2 rounded border shrink-0 ${tagClass}`}>
                            {lose.tag}
                          </span>
                        </div>
                        <p className="record-risk-desc text-xs text-slate-600 dark:text-white/50 leading-relaxed font-semibold">
                          {lose.desc}
                        </p>
                      </div>
                    );
                  });
                })()}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal: 面试官视角全部内容 */}
      <AnimatePresence>
        {showAllPerspectives && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#050B1A]/80 backdrop-blur-md p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-lg glass-panel p-6 rounded-3xl border border-white/10 flex flex-col max-h-[80vh] overflow-hidden"
            >
              <div className="flex justify-between items-center pb-3 border-b border-white/5 shrink-0">
                <h3 className="text-base font-black text-white flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-sm text-[#00D4FF]">psychology</span>
                  全部面试官视角分析
                </h3>
                <button
                  onClick={() => setShowAllPerspectives(false)}
                  className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 text-white/50 hover:text-white transition-all cursor-pointer flex items-center justify-center"
                >
                  <span className="material-symbols-outlined text-sm">close</span>
                </button>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto py-4 space-y-2.5 pr-1.5 custom-scrollbar max-h-[320px]">
                {(() => {
                  const perspective = reportData?.analysis_result?.interviewer_perspective;
                  if (perspective && perspective.length > 0) {
                    return perspective.map((p: any, i: number) => (
                      <div key={i} className="p-3 rounded-xl bg-white/[0.02] border border-white/5 flex flex-col gap-1.5 text-left">
                        <span className="flex items-center gap-1.5 text-xs md:text-sm font-extrabold text-white">
                          <span className="material-symbols-outlined text-xs text-[#00D4FF] shrink-0">folder_open</span>
                          {p.label}
                        </span>
                        <div className="text-xs text-white/50 leading-relaxed font-semibold bg-white/[0.01] border border-white/5 p-2 rounded-lg">
                          <span className="text-white/40 block text-[10px] mb-0.5">验证核心能力：</span>
                          {p.val}
                        </div>
                      </div>
                    ));
                  }
                  return [
                    { label: "Redis 相关问题", val: "验证缓存设计能力" },
                    { label: "一致性问题", val: "验证分布式系统架构能力" },
                    { label: "TCC 与 Saga", val: "验证分布式事务经验" },
                    { label: "项目深度挖", val: "验证真实项目经验" }
                  ].map((p, i) => (
                    <div key={i} className="p-3 rounded-xl bg-white/[0.02] border border-white/5 flex flex-col gap-1.5 text-left">
                      <span className="flex items-center gap-1.5 text-xs md:text-sm font-extrabold text-white">
                        <span className="material-symbols-outlined text-xs text-[#00D4FF] shrink-0">folder_open</span>
                        {p.label}
                      </span>
                      <div className="text-xs text-white/50 leading-relaxed font-semibold bg-white/[0.01] border border-white/5 p-2 rounded-lg">
                        <span className="text-white/40 block text-[10px] mb-0.5">验证核心能力：</span>
                        {p.val}
                      </div>
                    </div>
                  ));
                })()}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      </div>

    </div>
  );
}
