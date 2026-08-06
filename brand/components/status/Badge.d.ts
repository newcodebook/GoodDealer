/** Status pill. Mono-uppercase by default (SYNCED, PENDING); mono=false for CJK text. */
export interface BadgeProps {
  /** sync = blue system states; gold = value/identity moments only */
  tone?: "sync" | "gold" | "success" | "warning" | "danger" | "neutral";
  /** Leading 5px dot in currentColor */
  dot?: boolean;
  /** Default true: JetBrains Mono uppercase. false → 11px sans for中文 */
  mono?: boolean;
  children?: React.ReactNode;
}
export declare function Badge(props: BadgeProps): JSX.Element;
