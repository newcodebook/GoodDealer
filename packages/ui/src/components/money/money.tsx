import type { CSSProperties } from "react";

import "./money.css";

export type MoneyTone = "gold" | "body" | "muted" | "success" | "danger";
export interface MoneyProps { amount: number | string | null | undefined; currency?: string; size?: number; tone?: MoneyTone; showCurrency?: boolean; sign?: boolean; style?: CSSProperties }

export function Money({ amount, currency = "USD", size = 13, tone = "gold", showCurrency = false, sign = false, style }: MoneyProps) {
  if (amount == null || amount === "") return <span className="gd-money gd-money--empty" style={{ fontSize: size, ...style }}>—</span>;
  let text: string | number = amount;
  if (typeof amount === "number") {
    text = Math.abs(amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (amount < 0) text = `−${text}`; else if (sign && amount > 0) text = `+${text}`;
  }
  return <span className={`gd-money gd-money--${tone}`} style={{ fontSize: size, ...style }}>{showCurrency ? <span className="gd-money-currency" style={{ fontSize: Math.max(10, size - 3) }}>{currency}</span> : null}{text}</span>;
}
