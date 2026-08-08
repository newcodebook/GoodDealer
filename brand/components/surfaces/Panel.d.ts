/** Card surface: panel bg + 1px line + 7px radius + quiet shadow. flush removes body padding (tables). */
export interface PanelProps {
  title?: React.ReactNode;
  /** Right side of the header (buttons, badges) */
  actions?: React.ReactNode;
  /** No body padding — for tables/lists that go edge to edge */
  flush?: boolean;
  /** Square + no side borders — for regions seamed edge-to-edge in a native window (no floating shadow) */
  seamed?: boolean;
  children?: React.ReactNode;
}
export declare function Panel(props: PanelProps): JSX.Element;
