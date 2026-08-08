/** Checkbox with indeterminate state — used by Table row selection. */
export interface CheckboxProps {
  checked?: boolean;
  /** Header tri-state */
  indeterminate?: boolean;
  label?: React.ReactNode;
  disabled?: boolean;
  /** stopPropagation on click (inside clickable rows) */
  stop?: boolean;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
}
export declare function Checkbox(props: CheckboxProps): JSX.Element;
