import type { ButtonHTMLAttributes, ReactNode } from "react";

import "./button.css";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "gold";
export type ButtonSize = "sm" | "md" | "lg";

/**
 * Generic button with restrained visual variants. The gold variant is outline-only and is not
 * intended as the default call to action.
 */
export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> {
  /** @default "secondary" */
  variant?: ButtonVariant;
  /** sm 24px | md 28px | lg 34px. @default "md" */
  size?: ButtonSize;
  /** Optional leading icon node (14-16px). */
  icon?: ReactNode;
  /** Full-width. */
  block?: boolean;
}

export function Button({
  variant = "secondary",
  size = "md",
  icon,
  block,
  children,
  ...rest
}: ButtonProps) {
  const className = ["gd-btn", `gd-btn--${size}`, `gd-btn--${variant}`, block ? "gd-btn--block" : null]
    .filter(Boolean)
    .join(" ");
  return (
    <button type="button" className={className} {...rest}>
      {icon}
      {children}
    </button>
  );
}
