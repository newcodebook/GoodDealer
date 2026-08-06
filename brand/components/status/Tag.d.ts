/** Small square-ish chip for domain labels / portfolios / filters. */
export interface TagProps {
  /** Optional 6px dot color (portfolio color) */
  color?: string;
  /** Shows a remove × */
  onRemove?: () => void;
  children?: React.ReactNode;
}
export declare function Tag(props: TagProps): JSX.Element;
