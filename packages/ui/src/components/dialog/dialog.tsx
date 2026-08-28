import { useEffect, useId, useRef, type CSSProperties, type ReactNode } from "react";

import "./dialog.css";

export interface DialogProps { open: boolean; onClose?: (() => void) | undefined; title?: ReactNode; footer?: ReactNode; width?: number; danger?: boolean; children?: ReactNode; closeLabel?: string; initialFocusRef?: { readonly current: HTMLElement | null }; style?: CSSProperties }

const focusableSelector = 'button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function trapDialogKey(event: KeyboardEvent, dialog: HTMLElement, onClose?: () => void) {
  if (event.key === "Escape") { event.preventDefault(); onClose?.(); return; }
  if (event.key !== "Tab") return;
  const focusables = [...dialog.querySelectorAll<HTMLElement>(focusableSelector)].filter((node) => !node.hidden);
  if (focusables.length === 0) { event.preventDefault(); dialog.focus(); return; }
  const first = focusables[0]; const last = focusables.at(-1);
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
}

export function Dialog({ open, onClose, title, children, footer, width = 440, danger, closeLabel = "Close", initialFocusRef, style }: DialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null); const restoreFocusRef = useRef<HTMLElement | null>(null); const titleId = useId();
  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current; const target = initialFocusRef?.current ?? dialog?.querySelector<HTMLElement>(focusableSelector) ?? dialog;
    target?.focus();
    const onKeyDown = (event: KeyboardEvent) => { if (dialog) trapDialogKey(event, dialog, onClose); };
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("keydown", onKeyDown); restoreFocusRef.current?.focus(); };
  }, [initialFocusRef, onClose, open]);
  if (!open) return null;
  return <div className="gd-dialog-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose?.(); }}><div ref={dialogRef} className={`gd-dialog${danger ? " gd-dialog--danger" : ""}`} style={{ width, ...style }} role="dialog" aria-modal="true" aria-labelledby={title ? titleId : undefined} tabIndex={-1}><div className="gd-dialog-head"><span className="gd-dialog-title" id={title ? titleId : undefined}>{title}</span>{onClose ? <button type="button" className="gd-dialog-x" onClick={onClose} aria-label={closeLabel}>✕</button> : null}</div><div className="gd-dialog-body">{children}</div>{footer ? <div className="gd-dialog-foot">{footer}</div> : null}</div></div>;
}
