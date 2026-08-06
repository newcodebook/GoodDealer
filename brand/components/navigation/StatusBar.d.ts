/**
 * Terminal-style bottom status bar (Warp/Ghostty direction) — mono, tabular, hairline-divided
 * segments. The always-on ledger of app state: sync, unsynced count, last sync, revision,
 * Active device, Epoch, License. A strong native-software signal.
 */
export interface StatusBarProps {
  /** Left segments — each becomes a hairline-divided cell */
  left?: React.ReactNode[];
  /** Right segments */
  right?: React.ReactNode[];
}
export declare function StatusBar(props: StatusBarProps): JSX.Element;
