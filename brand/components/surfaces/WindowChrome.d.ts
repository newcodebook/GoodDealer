/**
 * Native desktop window frame (Tauri custom chrome) — titlebar with brand mark, centered
 * context label, and window controls; children fill the body; footer holds a StatusBar.
 * This is the anti-SaaS shell: the app looks like native software, not a web page.
 */
export interface WindowChromeProps {
  appName?: string;
  /** Small brand mark node (e.g. <img src=mark-flat.svg width=18/>) shown before appName */
  mark?: React.ReactNode;
  /** Centered faint context label (workspace / current view) */
  context?: React.ReactNode;
  /** Rendered under the body — pass a <StatusBar/> */
  footer?: React.ReactNode;
  onClose?: () => void;
  /** The app layout (sidebar + main column) */
  children?: React.ReactNode;
}
export declare function WindowChrome(props: WindowChromeProps): JSX.Element;
