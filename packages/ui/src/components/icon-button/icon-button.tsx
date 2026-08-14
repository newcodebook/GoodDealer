import type { ButtonHTMLAttributes, ReactNode } from "react";

import "./icon-button.css";

export type IconButtonVariant = "ghost" | "outline";
export type IconButtonSize = "sm" | "md";

/** Square icon-only button (ghost by default). Always pass an accessible `label`. */
export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "title" | "aria-label"> {
  /** @default "ghost" */
  variant?: IconButtonVariant;
  /** @default "md" */
  size?: IconButtonSize;
  /** Accessible name; rendered as both `title` and `aria-label`. */
  label: string;
  /** The icon node (14-16px svg). */
  children?: ReactNode;
}

export function IconButton({ variant = "ghost", size = "md", label, children, ...rest }: IconButtonProps) {
  const className = ["gd-iconbtn", `gd-iconbtn--${size}`, variant === "outline" ? "gd-iconbtn--outline" : null]
    .filter(Boolean)
    .join(" ");
  return (
    <button className={className} title={label} aria-label={label} {...rest}>
      {children}
    </button>
  );
}
