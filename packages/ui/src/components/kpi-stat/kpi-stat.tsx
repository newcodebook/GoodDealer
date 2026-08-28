import type { CSSProperties, ReactNode } from "react";
import { Money, type MoneyTone } from "../money/money";
import "./kpi-stat.css";
export type KpiStatTone = "body" | "gold" | "success" | "danger" | "warning";
export interface KpiStatProps { label: ReactNode; value: number | string; currency?: string; tone?: KpiStatTone; meta?: ReactNode; style?: CSSProperties }
export function KpiStat({ label, value, currency, tone = "body", meta, style }: KpiStatProps) { const moneyTone: MoneyTone = tone === "body" ? "gold" : tone === "warning" ? "gold" : tone; return <div className="gd-kpi" style={style}><span className="gd-t-label">{label}</span>{typeof value === "number" && currency ? <Money amount={value} currency={currency} showCurrency size={28} tone={moneyTone} /> : <span className={`gd-t-metric gd-kpi-value gd-kpi-value--${tone}`}>{typeof value === "number" ? value.toLocaleString("en-US") : value}</span>}{meta ? <span className="gd-t-meta">{meta}</span> : null}</div>; }
