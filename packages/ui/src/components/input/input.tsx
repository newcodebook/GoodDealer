import type { CSSProperties, InputHTMLAttributes, ReactNode } from "react";

import "../shared/field.css";
import "./input.css";

export type InputSize = "sm" | "md" | "lg";

/** Text input on an inset ink surface with a blue focus ring. Use `mono` for prices, records, domains. */
export interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "className" | "style" | "prefix" | "size"> {
  /** Uppercase 11px caps label above the field. */
  label?: string;
  /** @default "md" */
  size?: InputSize;
  /** Monospace + tabular-nums (prices, TXT records). */
  mono?: boolean;
  prefix?: ReactNode;
  suffix?: ReactNode;
  /** Error message; also colors the border and replaces `hint` when present. */
  error?: string;
  hint?: string;
  /** Applied to the outer field wrapper, not the native input. */
  style?: CSSProperties;
}

export function Input({ label, size = "md", mono, prefix, suffix, error, hint, style, ...rest }: InputProps) {
  const wrapClassName = ["gd-input-wrap", `gd-input-wrap--${size}`, error ? "gd-input-wrap--error" : null]
    .filter(Boolean)
    .join(" ");
  const inputClassName = ["gd-input", mono ? "gd-input--mono" : null].filter(Boolean).join(" ");
  const hintClassName = ["gd-field-hint", error ? "gd-field-hint--error" : null].filter(Boolean).join(" ");

  return (
    <label className="gd-field" style={style}>
      {label && <span className="gd-field-label">{label}</span>}
      <span className={wrapClassName}>
        {prefix && <span className="gd-input-affix">{prefix}</span>}
        <input className={inputClassName} {...rest} />
        {suffix && <span className="gd-input-affix">{suffix}</span>}
      </span>
      {(error || hint) && <span className={hintClassName}>{error || hint}</span>}
    </label>
  );
}
