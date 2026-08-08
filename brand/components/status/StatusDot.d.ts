/** Device/state dot. active = solid gold (executing device), standby = hollow blue — 呼应双星图标. */
export interface StatusDotProps {
  kind?: "active" | "standby" | "sync" | "success" | "warning" | "danger" | "neutral";
  label?: React.ReactNode;
  /** Dot diameter px. Default 8 */
  size?: number;
  /** Slow opacity pulse for in-progress states */
  pulse?: boolean;
}
export declare function StatusDot(props: StatusDotProps): JSX.Element;
