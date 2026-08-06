/**
 * GoodDealer button. Primary = tech blue (system actions); gold variant is outline-only,
 * reserved for identity/value moments (授权、所有权验证成功) — never a default CTA.
 */
export interface ButtonProps {
  /** 'primary' | 'secondary' | 'ghost' | 'danger' | 'gold' */
  variant?: "primary" | "secondary" | "ghost" | "danger" | "gold";
  /** 'sm' 24px | 'md' 28px | 'lg' 34px */
  size?: "sm" | "md" | "lg";
  /** Optional leading icon node (14–16px) */
  icon?: React.ReactNode;
  /** Full-width */
  block?: boolean;
  disabled?: boolean;
  onClick?: (e: React.MouseEvent) => void;
  children?: React.ReactNode;
}
export declare function Button(props: ButtonProps): JSX.Element;
