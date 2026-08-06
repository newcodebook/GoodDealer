/** Toggle switch; on = matte blue. */
export interface SwitchProps {
  checked?: boolean;
  label?: React.ReactNode;
  disabled?: boolean;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
}
export declare function Switch(props: SwitchProps): JSX.Element;
