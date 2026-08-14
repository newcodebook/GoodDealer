import type { CSSProperties, SelectHTMLAttributes } from "react";

import "../shared/field.css";
import "./select.css";

export type SelectSize = "sm" | "md" | "lg";
export type SelectOption = string | { value: string; label: string };

/** Native select with GoodDealer chrome (ink inset, chevron, blue focus). */
export interface SelectProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "className" | "style" | "size"> {
  label?: string;
  /** @default "md" */
  size?: SelectSize;
  /** Strings or {value,label} pairs. */
  options: SelectOption[];
  /** Applied to the outer wrapper when there is no label, otherwise to the labeled field. */
  style?: CSSProperties;
}

export function Select({ label, size = "md", options = [], style, ...rest }: SelectProps) {
  const selectEl = (
    <span className="gd-select-wrap" style={label ? undefined : style}>
      <select className={`gd-select gd-select--${size}`} {...rest}>
        {options.map((option) =>
          typeof option === "string" ? (
            <option key={option} value={option}>
              {option}
            </option>
          ) : (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ),
        )}
      </select>
    </span>
  );

  if (!label) return selectEl;

  return (
    <label className="gd-field" style={style}>
      <span className="gd-field-label">{label}</span>
      {selectEl}
    </label>
  );
}
