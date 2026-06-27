"use client";

import { useState } from "react";
import type { Citation } from "@/lib/counselorClient";

interface Props {
  citation: Citation;
}

// 根据 source_type 返回对应的导航目标
function getCitationLink(c: Citation): { href: string; label: string } {
  switch (c.source_type) {
    case "interview_summary":
    case "interview_section":
    case "live_interview":
      // 跳到面试报告页（假设路由是 /debugger/report?session=...）
      return {
        href: `/debugger/report?session=${c.source_id}`,
        label: "面试报告",
      };
    case "resume_analysis":
      return {
        href: `/debugger/resume?analysis=${c.source_id}`,
        label: "简历分析",
      };
    case "project_memory":
      // 跳到项目记忆库
      return {
        href: `/memory?project=${c.source_id}`,
        label: "项目记忆",
      };
    default:
      return { href: "#", label: "查看来源" };
  }
}

export default function CitationCard({ citation }: Props) {
  const [open, setOpen] = useState(false);
  const { href, label } = getCitationLink(citation);

  return (
    <span className="inline-block align-middle mx-0.5">
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-label-mono uppercase tracking-widest text-primary bg-primary/10 border border-primary/20 rounded-md hover:bg-primary/20 transition-colors"
        title="查看引用来源"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-primary" />
        [{citation.source_type}#{citation.source_id}]
      </button>
      {open && (
        <a
          href={href}
          target="_blank"
          rel="noopener"
          onClick={() => setOpen(false)}
          className="ml-1 inline-block px-1.5 py-0.5 text-[10px] font-label-mono uppercase tracking-widest text-tertiary bg-tertiary/10 border border-tertiary/20 rounded-md hover:bg-tertiary/20 transition-colors"
        >
          {label} →
        </a>
      )}
    </span>
  );
}
