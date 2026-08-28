import type { ChangeEvent, MouseEvent, ReactNode } from "react";

import "./checkbox.css";

/** Checkbox with an indeterminate state — used by Table row selection headers. */
export interface CheckboxProps {
  checked?: boolean;
  /** Header tri-state; shows a dash instead of a tick while `checked` is false. */
  indeterminate?: boolean;
  label?: ReactNode;
  disabled?: boolean;
  ariaLabel?: string;
  /** Stop click propagation — for use inside clickable rows. */
  stop?: boolean;
  onChange?: (e: ChangeEvent<HTMLInputElement>) => void;
}

function noop() {
  // Reference behavior: an uncontrolled checkbox with no onChange stays a no-op, not a
  // React "controlled input without onChange" console warning.
}

export function Checkbox({ checked, indeterminate, onChange, label, disabled, stop, ariaLabel }: CheckboxProps) {
  const boxClassName = ["gd-check-box", indeterminate && !checked ? "gd-check-box--ind" : null]
    .filter(Boolean)
    .join(" ");
  const handleClick = stop ? (e: MouseEvent<HTMLLabelElement>) => e.stopPropagation() : undefined;

  return (
    <label className={disabled ? "gd-check gd-check--disabled" : "gd-check"} onClick={handleClick}>
      <input type="checkbox" checked={!!checked} disabled={disabled} aria-label={ariaLabel} onChange={onChange || noop} />
      <span className={boxClassName}>
        <svg className="gd-check-tick" width="9" height="9" viewBox="0 0 10 10" fill="none">
          <path
            d="M1.5 5.5L4 8L8.5 2"
            style={{ stroke: "var(--gd-on-accent)" }}
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <svg className="gd-check-dash" width="9" height="9" viewBox="0 0 10 10" fill="none">
          <path d="M2 5H8" style={{ stroke: "var(--gd-on-accent)" }} strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </span>
      {label && <span>{label}</span>}
    </label>
  );
}
