"use client";

import { useState, useRef, useCallback, useMemo } from "react";

// ── 类型定义 ───────────────────────────────────────────

export interface GrowthPoint {
  analysis_index: number;
  session_id: number;
  session_title: string;
  type: "audio" | "text";
  analysis_time: string | null;
  scores: {
    expression: number;
    logic: number;
    project_depth: number;
    ownership: number;
    system_design: number;
  };
}

export interface GrowthCurveChartProps {
  points: GrowthPoint[];
  axisLabels: (number | null)[];
  compact?: boolean;
  onPointClick?: (sessionId: number) => void;
}

// ── 维度配置 ────────────────────────────────────────────

const DIMENSIONS = [
  { key: "expression",    label: "细节深度", color: "#AFA7FF" },
  { key: "logic",         label: "逻辑自洽", color: "#ffb2b7" },
  { key: "project_depth", label: "业务理解", color: "#4edea3" },
  { key: "ownership",     label: "数据指标", color: "#f59e0b" },
  { key: "system_design", label: "技术广度", color: "#38bdf8" },
] as const;

// ── 坐标映射 ────────────────────────────────────────────

function indexToX(
  index: number,
  xMin: number,
  xMax: number,
  viewWidth: number,
  padLeft: number,
  padRight: number
): number {
  if (xMax <= xMin) return padLeft + (viewWidth - padLeft - padRight) / 2;
  const ratio = (index - xMin) / (xMax - xMin);
  return padLeft + ratio * (viewWidth - padLeft - padRight);
}

function scoreToY(
  score: number,
  yMin: number,
  yMax: number,
  viewHeight: number,
  padTop: number,
  padBottom: number
): number {
  const clamped = Math.max(yMin, Math.min(yMax, score));
  const ratio = (clamped - yMin) / (yMax - yMin);
  return padTop + (1 - ratio) * (viewHeight - padTop - padBottom);
}

function formatDate(isoStr: string | null): string {
  if (!isoStr) return "—";
  const d = new Date(isoStr);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

// ── 组件 ────────────────────────────────────────────────

export default function GrowthCurveChart({
  points,
  axisLabels,
  compact = false,
  onPointClick,
}: GrowthCurveChartProps) {
  const total = points.length;
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  // 画布参数 —— compact 与 full 模式统一增加 padB 容纳 X 轴标签
  const viewW = compact ? 100 : 200;
  const viewH = compact ? 60 : 100;
  // padB 只需容纳刻度短线，标签在 HTML 层
  const padL = compact ? 5 : 8;
  const padR = compact ? 3 : 4;
  const padT = compact ? 2 : 4;
  const padB = compact ? 5 : 6;
  const lineW = compact ? 1 : 1.5;

  // Y 轴动态范围
  const { yMin, yMax } = useMemo(() => {
    if (total === 0) return { yMin: 0, yMax: 100 };
    let allMin = Infinity;
    let allMax = -Infinity;
    for (const pt of points) {
      for (const dim of DIMENSIONS) {
        const v = pt.scores[dim.key as keyof typeof pt.scores];
        if (v == null) continue;
        if (v < allMin) allMin = v;
        if (v > allMax) allMax = v;
      }
    }
    if (allMin === Infinity) return { yMin: 0, yMax: 100 };
    let yMin = 0;
    let yMax = 100;
    if (allMin > 50) yMin = 50;
    else if (allMax < 50) yMax = 50;
    return { yMin, yMax };
  }, [points, total]);

  // X 轴范围与有效刻度
  const validTicks = useMemo(
    () => axisLabels.filter((l) => l != null) as number[],
    [axisLabels]
  );
  const xMin = validTicks.length > 0 ? validTicks[0] : 1;
  const xMax = validTicks.length > 0 ? validTicks[validTicks.length - 1] : Math.max(1, total);

  // ── 鼠标 → 吸附到最近的 X 轴刻度 ──────────────────
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (validTicks.length === 0) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const svgWidth = rect.width;
      const mx = e.clientX - rect.left;

      let nearestIdx = validTicks[0];
      let minDist = Infinity;
      for (const tickIdx of validTicks) {
        const svgX = indexToX(tickIdx, xMin, xMax, viewW, padL, padR);
        const px = (svgX / viewW) * svgWidth;
        const dist = Math.abs(mx - px);
        if (dist < minDist) {
          minDist = dist;
          nearestIdx = tickIdx;
        }
      }

      // 超出刻度间距 60% 不吸附
      if (validTicks.length >= 2) {
        const tickSpacing = svgWidth / (validTicks.length - 1);
        if (minDist > tickSpacing * 0.6) {
          setHoveredIdx(null);
          return;
        }
      }
      setHoveredIdx(nearestIdx);

      let tx = e.clientX - rect.left + 12;
      let ty = e.clientY - rect.top - 60;
      if (tx + 180 > rect.width) tx = e.clientX - rect.left - 192;
      if (ty < 0) ty = 8;
      setTooltipPos({ x: tx, y: ty });
    },
    [validTicks, xMin, xMax, viewW, padL, padR]
  );

  const handleMouseLeave = useCallback(() => setHoveredIdx(null), []);

  const handleClick = useCallback(() => {
    if (hoveredIdx === null || !onPointClick) return;
    const pt = points.find((p) => p.analysis_index === hoveredIdx);
    if (pt) onPointClick(pt.session_id);
  }, [hoveredIdx, onPointClick, points]);

  const hoveredPoint =
    hoveredIdx !== null
      ? points.find((p) => p.analysis_index === hoveredIdx) ?? null
      : null;

  // ── 空状态 ─────────────────────────────────────────
  if (total === 0) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-on-surface-variant/50 font-semibold select-none">
        暂无面试分析数据
      </div>
    );
  }

  const chartH = viewH - padT - padB; // 折线区域的净高

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full select-none"
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
      style={{ cursor: hoveredPoint && onPointClick ? "pointer" : "default" }}
    >
      <svg
        className="w-full h-full"
        viewBox={`0 0 ${viewW} ${viewH}`}
        preserveAspectRatio="none"
      >
        {/* ── 水平网格线 ──────────────────────────── */}
        {[0.25, 0.5, 0.75].map((frac, i) => (
          <line
            key={i}
            x1={padL} y1={padT + chartH * frac}
            x2={viewW - padR} y2={padT + chartH * frac}
            stroke="rgba(255,255,255,0.04)" strokeWidth="0.5" strokeDasharray="2,3"
          />
        ))}

        {/* ── 五条维度折线 ────────────────────────── */}
        {DIMENSIONS.map((dim) => {
          const coords = points.map((p) => ({
            x: indexToX(p.analysis_index, xMin, xMax, viewW, padL, padR),
            y: scoreToY(
              p.scores[dim.key as keyof typeof p.scores] ?? 0,
              yMin, yMax, chartH, padT, padB
            ),
          }));
          if (coords.length === 0) return null;
          if (coords.length === 1) {
            return (
              <line
                key={dim.key}
                x1={coords[0].x - 1.5} y1={coords[0].y}
                x2={coords[0].x + 1.5} y2={coords[0].y}
                stroke={dim.color} strokeWidth={lineW + 1}
                strokeLinecap="round" opacity={0.9}
              />
            );
          }
          const d = coords.map((c, i) => `${i === 0 ? "M" : "L"} ${c.x},${c.y}`).join(" ");
          return (
            <path
              key={dim.key}
              d={d} fill="none" stroke={dim.color}
              strokeWidth={lineW} strokeLinecap="round" strokeLinejoin="round"
              opacity={0.85}
            />
          );
        })}

        {/* ── X 轴刻度短线（SVG 内） ──────────────── */}
        {validTicks.map((tickIdx) => {
          const tx = indexToX(tickIdx, xMin, xMax, viewW, padL, padR);
          return (
            <line
              key={tickIdx}
              x1={tx} y1={padT + chartH}
              x2={tx} y2={padT + chartH + 3}
              stroke="rgba(255,255,255,0.15)" strokeWidth="0.5"
            />
          );
        })}

        {/* ── 悬停垂直虚线 ────────────────────────── */}
        {hoveredIdx !== null && (
          <line
            x1={indexToX(hoveredIdx, xMin, xMax, viewW, padL, padR)}
            y1={padT}
            x2={indexToX(hoveredIdx, xMin, xMax, viewW, padL, padR)}
            y2={padT + chartH}
            stroke="rgba(192,193,255,0.35)"
            strokeWidth="0.5"
            strokeDasharray="2,2"
          />
        )}
      </svg>

      {/* ── X 轴标签（HTML，百分比定位 → 与 SVG 刻度精确对齐）── */}
      <div className="relative w-full h-[18px] mt-0.5">
        {validTicks.map((tickIdx) => {
          const svgX = indexToX(tickIdx, xMin, xMax, viewW, padL, padR);
          const pct = (svgX / viewW) * 100;
          return (
            <span
              key={tickIdx}
              className="absolute text-[10px] font-label-mono text-on-surface-variant/35 font-bold whitespace-nowrap"
              style={{ left: `${pct}%`, transform: "translateX(-50%)" }}
            >
              第{tickIdx}次
            </span>
          );
        })}
      </div>

      {/* ── Tooltip ────────────────────────────────── */}
      {hoveredPoint && (
        <div
          className="absolute bg-surface-container-high border border-white/10 rounded-xl p-3 text-xs text-white font-label-mono space-y-1.5 shadow-2xl pointer-events-none z-30 min-w-[170px]"
          style={{ left: tooltipPos.x, top: tooltipPos.y }}
        >
          <p className="font-extrabold text-primary border-b border-white/10 pb-1 mb-0.5">
            {formatDate(hoveredPoint.analysis_time)} 评估数据
          </p>
          {DIMENSIONS.map((dim) => {
            const val = hoveredPoint.scores[dim.key as keyof typeof hoveredPoint.scores];
            return (
              <p key={dim.key} className="flex justify-between items-center gap-3 font-bold">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: dim.color }} />
                  {dim.label}
                </span>
                <span className="font-black" style={{ color: dim.color }}>
                  {val ?? "—"} 分
                </span>
              </p>
            );
          })}
        </div>
      )}
    </div>
  );
}
