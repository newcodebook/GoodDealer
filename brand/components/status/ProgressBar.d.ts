/** Flat matte progress; segmented form shows batch outcomes (成功/失败/等待) in one bar. */
export interface ProgressSegment {
  /** Percent width 0–100 */
  value: number;
  tone?: "sync" | "gold" | "success" | "warning" | "danger" | "neutral";
}
export interface ProgressBarProps {
  /** Multi-tone segments; overrides value/max */
  segments?: ProgressSegment[];
  value?: number;
  max?: number;
  height?: number;
  showTrack?: boolean;
}
export declare function ProgressBar(props: ProgressBarProps): JSX.Element;
