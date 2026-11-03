import type { ReactNode } from "react";
import "./metric-strip.css";
export type MetricTone = "body" | "gold" | "danger" | "warning" | "blue" | "success" | "muted";
export interface MetricStripItem { key?: string; label: ReactNode; value: ReactNode; tone?: MetricTone; meta?: ReactNode; mono?: boolean; onClick?: () => void; ariaLabel?: string }
export interface MetricStripProps {
  metrics: readonly MetricStripItem[];
  label?: string;
  /**
   * Opt-in for surfaces that also render at phone width (Account Web). Cells keep one row while
   * they fit and wrap into a grid below that instead of ellipsizing values; off by default so
   * fixed-width Desktop strips keep their single 72px band.
   */
  wrap?: boolean;
}
export function MetricStrip({ metrics, label, wrap = false }: MetricStripProps) { return <div className={`gd-metricstrip${wrap ? " gd-metricstrip--wrap" : ""}`} aria-label={label}>{metrics.map((metric, index) => { const content = <><span className="gd-t-label">{metric.label}</span><span className={`gd-t-metric-sm gd-metricstrip-value gd-metricstrip-value--${metric.tone ?? "body"}${metric.mono === false ? " gd-metricstrip-value--sans" : ""}`}>{metric.value}</span><span className="gd-t-meta gd-metricstrip-meta">{metric.meta ?? "\u00a0"}</span></>; return metric.onClick ? <button type="button" key={metric.key ?? index} className="gd-metricstrip-cell gd-metricstrip-cell--button" onClick={metric.onClick} aria-label={metric.ariaLabel}>{content}</button> : <div key={metric.key ?? index} className="gd-metricstrip-cell">{content}</div>; })}</div>; }
