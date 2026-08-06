/** Monetary value: JetBrains Mono, tabular-nums, sand gold, fixed 2 decimals. Null → "—". */
export interface MoneyProps {
  /** Number (formatted to 2 decimals) or preformatted string; null/undefined renders an em-dash */
  amount: number | string | null;
  /** ISO 4217, shown when showCurrency. Default "USD" */
  currency?: string;
  size?: number;
  /** Default gold (估值). body/muted for non-value contexts; success/danger for deltas */
  tone?: "gold" | "body" | "muted" | "success" | "danger";
  showCurrency?: boolean;
  /** Prefix + on positive numbers */
  sign?: boolean;
}
export declare function Money(props: MoneyProps): JSX.Element;
