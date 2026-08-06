/** Underline tabs; the 2px gold active line is one of the few chrome uses of gold. */
export interface TabItem {
  key: string;
  label: React.ReactNode;
  /** Mono count pill */
  count?: number;
}
export interface TabsProps {
  items: TabItem[];
  active: string;
  onChange?: (key: string) => void;
}
export declare function Tabs(props: TabsProps): JSX.Element;
