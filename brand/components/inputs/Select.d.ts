/** Native select with GoodDealer chrome (ink inset, chevron, blue focus). */
export interface SelectProps {
  label?: string;
  size?: "sm" | "md" | "lg";
  /** Strings or {value,label} pairs */
  options: Array<string | { value: string; label: string }>;
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLSelectElement>) => void;
}
export declare function Select(props: SelectProps): JSX.Element;
