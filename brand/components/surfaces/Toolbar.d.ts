/** Dense horizontal command/action bar. region=true tints it as a secondary (in-content) toolbar. */
export interface ToolbarProps {
  /** Left cluster (title, crumb, filters) */
  left?: React.ReactNode;
  /** Right cluster (search, actions) */
  right?: React.ReactNode;
  /** Secondary toolbar tint (sits inside content, under the primary toolbar) */
  region?: boolean;
}
export declare function Toolbar(props: ToolbarProps): JSX.Element;
