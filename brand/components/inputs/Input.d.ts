/** Text input on inset ink surface; blue focus ring. Use mono for prices, records, domains. */
export interface InputProps {
  /** Uppercase 11px caps label above the field */
  label?: string;
  size?: "sm" | "md" | "lg";
  /** Monospace + tabular-nums (prices, TXT records) */
  mono?: boolean;
  prefix?: React.ReactNode;
  suffix?: React.ReactNode;
  /** Error message; also colors the border */
  error?: string;
  hint?: string;
  placeholder?: string;
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
}
export declare function Input(props: InputProps): JSX.Element;
