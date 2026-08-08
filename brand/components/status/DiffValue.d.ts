/** 旧值 → 新值 pair for diff previews and conflict views. */
export interface DiffValueProps {
  oldValue?: React.ReactNode;
  newValue?: React.ReactNode;
  /** Default true (values are usually prices/records) */
  mono?: boolean;
  size?: number;
}
export declare function DiffValue(props: DiffValueProps): JSX.Element;
