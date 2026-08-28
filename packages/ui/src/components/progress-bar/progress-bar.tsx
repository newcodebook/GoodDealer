import type { CSSProperties } from "react";

import "./progress-bar.css";

export type ProgressTone = "sync" | "gold" | "success" | "warning" | "danger" | "neutral";
export interface ProgressSegment { value: number; tone?: ProgressTone }
export interface ProgressBarProps { segments?: readonly ProgressSegment[]; value?: number; max?: number; height?: number; showTrack?: boolean; style?: CSSProperties; label?: string }

export function ProgressBar({ segments, value = 0, max = 100, height = 6, showTrack = true, style, label }: ProgressBarProps) {
  const safeMax = max > 0 ? max : 100;
  const parts = segments ?? [{ value: Math.min(100, Math.max(0, value / safeMax * 100)), tone: "sync" as const }];
  return <div className={`gd-progress${showTrack ? " gd-progress--track" : ""}`} style={{ height, borderRadius: height / 2, ...style }} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={segments ? 100 : safeMax} aria-valuenow={segments ? Math.min(100, parts.reduce((sum, part) => sum + Math.max(0, part.value), 0)) : Math.min(safeMax, Math.max(0, value))}>{parts.map((part, index) => <span key={index} className={`gd-progress-segment gd-progress-segment--${part.tone ?? "sync"}`} style={{ width: `${Math.min(100, Math.max(0, part.value))}%` }} />)}</div>;
}
