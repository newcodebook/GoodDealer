/** Summary-layer stat: caps label over a 24px mono figure. Currency values render gold. */
export interface KpiStatProps {
  label: React.ReactNode;
  /** Number (localized) or preformatted string */
  value: number | string;
  /** ISO 4217 — renders via Money in gold */
  currency?: string;
  tone?: "body" | "gold" | "danger" | "warning";
  /** Small faint line under the value */
  meta?: React.ReactNode;
}
export declare function KpiStat(props: KpiStatProps): JSX.Element;
