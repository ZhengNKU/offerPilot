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
  onPointClick?: (point: GrowthPoint) => void;
  /** 展示模式：recent=最近N次, all=全部（默认all保持向后兼容） */
  mode?: "recent" | "all";
  /** 最近N次的最大展示数量，默认6 */
  maxRecentCount?: number;
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
  mode = "all",
  maxRecentCount = 6,
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

  // ── mode 相关：展示数据点 ──────────────────────────
  const displayPoints = useMemo(() => {
    if (mode === "recent") {
      return points.slice(-maxRecentCount);
    }
    return points;
  }, [mode, points, maxRecentCount]);

  // ── mode 相关：X 轴展示刻度 ───────────────────────
  const displayTicks = useMemo(() => {
    if (mode === "recent") {
      if (total < maxRecentCount) {
        // 总数不足 N → 强制展示 1..N（空位占位）
        return Array.from({ length: maxRecentCount }, (_, i) => i + 1);
      }
      // 总数 ≥ N → 展示最后 N 个点的实际 analysis_index
      return points.slice(-maxRecentCount).map((p) => p.analysis_index);
    }
    // "all" 模式：使用所有数据点的 analysis_index
    // （不用后端 axis_labels 采样值，否则 >6 条时 hover 只能吸附到采样点）
    return points.map((p) => p.analysis_index);
  }, [mode, total, maxRecentCount, points]);

  // ── mode 相关：X 轴可见标签（all 模式 > 6 条时仅首尾）─
  const labelTicks = useMemo(() => {
    if (mode === "all" && displayTicks.length > 6) {
      return [displayTicks[0], displayTicks[displayTicks.length - 1]];
    }
    return displayTicks;
  }, [mode, displayTicks]);

  // X 轴范围
  const xMin = displayTicks.length > 0 ? displayTicks[0] : 1;
  const xMax = displayTicks.length > 0 ? displayTicks[displayTicks.length - 1] : Math.max(1, total);

  // ── 鼠标 → 吸附到最近的 X 轴刻度 ──────────────────
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (displayTicks.length === 0) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const svgWidth = rect.width;
      const mx = e.clientX - rect.left;

      let nearestIdx = displayTicks[0];
      let minDist = Infinity;
      for (const tickIdx of displayTicks) {
        const svgX = indexToX(tickIdx, xMin, xMax, viewW, padL, padR);
        const px = (svgX / viewW) * svgWidth;
        const dist = Math.abs(mx - px);
        if (dist < minDist) {
          minDist = dist;
          nearestIdx = tickIdx;
        }
      }

      // 超出刻度间距 60% 不吸附
      if (displayTicks.length >= 2) {
        const tickSpacing = svgWidth / (displayTicks.length - 1);
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
    [displayTicks, xMin, xMax, viewW, padL, padR]
  );

  const handleMouseLeave = useCallback(() => setHoveredIdx(null), []);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!onPointClick || displayTicks.length === 0) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const svgWidth = rect.width;
      const mx = e.clientX - rect.left;

      // 从点击坐标直接计算最近刻度（不依赖 hover 状态）
      let nearestIdx: number | null = null;
      let minDist = Infinity;
      for (const tickIdx of displayTicks) {
        const svgX = indexToX(tickIdx, xMin, xMax, viewW, padL, padR);
        const px = (svgX / viewW) * svgWidth;
        const dist = Math.abs(mx - px);
        if (dist < minDist) {
          minDist = dist;
          nearestIdx = tickIdx;
        }
      }

      if (displayTicks.length >= 2 && nearestIdx !== null) {
        const tickSpacing = svgWidth / (displayTicks.length - 1);
        if (minDist > tickSpacing * 0.6) return; // 离任何点都太远，忽略
      }

      const pt = points.find((p) => p.analysis_index === nearestIdx);
      if (pt) onPointClick(pt);
    },
    [onPointClick, displayTicks, xMin, xMax, viewW, padL, padR, points]
  );

  const hoveredPoint =
    hoveredIdx !== null
      ? points.find((p) => p.analysis_index === hoveredIdx) ?? null
      : null;

  // ── 空状态 ─────────────────────────────────────────
  if (total === 0) {
    return (
      <div className="flex items-center justify-center w-full h-full min-h-[220px] text-base text-on-surface-variant/50 font-semibold select-none text-center">
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

        {/* ── 五条维度折线（使用 displayPoints 控制可见范围）── */}
        {DIMENSIONS.map((dim) => {
          const coords = displayPoints.map((p) => ({
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

        {/* ── X 轴刻度短线（SVG 内，使用 displayTicks）── */}
        {displayTicks.map((tickIdx) => {
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

      {/* ── X 轴标签（HTML 百分比定位 → 使用 labelTicks 控制可见标签）── */}
      <div className="relative w-full h-[18px] mt-0.5">
        {labelTicks.map((tickIdx) => {
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
