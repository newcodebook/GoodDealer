import type { ChangeEvent, ReactNode } from "react";

import "./switch.css";

/** Toggle switch; the "on" state is matte blue. */
export interface SwitchProps {
  checked?: boolean;
  label?: ReactNode;
  disabled?: boolean;
  onChange?: (e: ChangeEvent<HTMLInputElement>) => void;
}

function noop() {
  // See checkbox.tsx: keeps an uncontrolled switch silent instead of a React console warning.
}

export function Switch({ checked, onChange, label, disabled }: SwitchProps) {
  return (
    <label className={disabled ? "gd-switch gd-switch--disabled" : "gd-switch"}>
      <input type="checkbox" checked={!!checked} disabled={disabled} onChange={onChange || noop} />
      <span className="gd-switch-track"></span>
      {label && <span>{label}</span>}
    </label>
  );
}
