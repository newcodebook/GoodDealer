/** Square icon-only button (ghost by default). Pass an accessible label. */
export interface IconButtonProps {
  variant?: "ghost" | "outline";
  size?: "sm" | "md";
  /** Accessible name; rendered as title */
  label: string;
  disabled?: boolean;
  onClick?: (e: React.MouseEvent) => void;
  /** The icon node (14–16px svg) */
  children?: React.ReactNode;
}
export declare function IconButton(props: IconButtonProps): JSX.Element;
