/** Modal dialog. Scrim is the one place blur is allowed (shell layer); the dialog surface is opaque. */
export interface DialogProps {
  open: boolean;
  onClose?: () => void;
  title?: React.ReactNode;
  /** Footer action row (right-aligned). Confirm buttons must carry the real count. */
  footer?: React.ReactNode;
  width?: number;
  /** Danger-tinted title for destructive confirmations */
  danger?: boolean;
  children?: React.ReactNode;
}
export declare function Dialog(props: DialogProps): JSX.Element | null;
