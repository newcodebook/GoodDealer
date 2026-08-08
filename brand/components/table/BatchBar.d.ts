/** Floating action bar shown when table rows are selected. Renders null at count 0. */
export interface BatchBarProps {
  count: number;
  /** Noun after the count. Default "个域名" */
  unit?: string;
  /** Action buttons */
  children?: React.ReactNode;
  onClear?: () => void;
}
export declare function BatchBar(props: BatchBarProps): JSX.Element | null;
