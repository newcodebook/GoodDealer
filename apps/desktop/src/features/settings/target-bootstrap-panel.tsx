import { formatDate, getPresentationCopy, type Locale } from "@gooddealer/i18n";
import { Button } from "@gooddealer/ui";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { TargetBootstrapPort, TargetBootstrapView } from "../../adapters/tauri";

/** A target without a replica can stop setup. Native retains the exact confirmed workflow. */
export function TargetBootstrapPanel({ locale, port }: { readonly locale: Locale; readonly port: TargetBootstrapPort }) {
  const copy = getPresentationCopy(locale, "settings");
  const [view, setView] = useState<TargetBootstrapView | null>(null);
  const [unknown, setUnknown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const generation = useRef(0);
  const inFlight = useRef(false);
  const inputId = useId();
  const accept = useCallback((next: TargetBootstrapView) => {
    setView(next); setUnknown(false);
    // A newly discovered workflow is a new decision, even when the two devices are unchanged.
    setPreview(current => next.kind === "available" && current === next.requestId ? current : null);
  }, []);
  const read = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    const ticket = generation.current;
    try { const next = await port.status(); if (ticket === generation.current) accept(next); }
    catch { if (ticket === generation.current) { setUnknown(true); setPreview(null); } }
    finally { if (ticket === generation.current) inFlight.current = false; }
  }, [accept, port]);
  useEffect(() => {
    generation.current += 1; inFlight.current = false;
    setView(null); setUnknown(false); setBusy(false); setPreview(null); setAcknowledged(false);
    void read();
    const timer = setInterval(() => { void read(); }, 5_000);
    return () => { generation.current += 1; clearInterval(timer); };
  }, [read]);
  const cancel = async () => {
    if (inFlight.current || busy || unknown || !acknowledged || view?.kind !== "available" || preview !== view.requestId) return;
    const requestId = preview;
    const ticket = generation.current;
    inFlight.current = true; setBusy(true);
    try { const next = await port.cancel(requestId); if (ticket === generation.current) accept(next); }
    catch { if (ticket === generation.current) setUnknown(true); }
    finally { if (ticket === generation.current) { inFlight.current = false; setBusy(false); setPreview(null); setAcknowledged(false); } }
  };
  const message = unknown ? copy.bootstrapUnknown : view === null ? "" : view.kind === "idle" ? copy.bootstrapIdle
    : view.kind === "available" ? copy.bootstrapAvailable : view.kind === "pending" ? copy.bootstrapPending
      : view.status === "cancelled" ? copy.bootstrapCancelled : view.status === "failed" ? copy.bootstrapFailed : copy.bootstrapCompleted;
  return <div className="settings-target-bootstrap">
    <h3>{copy.bootstrapTitle}</h3>
    <p role="status" aria-atomic="true">{message}</p>
    <Button size="sm" disabled={busy} onClick={() => { void read(); }}>{copy.bootstrapRefresh}</Button>
    {!unknown && view?.kind === "available" ? <>
      <p>{copy.bootstrapDeadline.replace("{time}", formatDate(locale, Date.parse(view.bootstrapExpiresAt), { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" }) + " UTC")}</p>
      {preview === view.requestId ? <form onSubmit={event => { event.preventDefault(); void cancel(); }}>
        <p>{copy.bootstrapCancelDetail}</p>
        <input id={inputId} type="checkbox" required checked={acknowledged} disabled={busy} onChange={event => setAcknowledged(event.currentTarget.checked)} />
        <label htmlFor={inputId}>{copy.bootstrapCancelAck}</label>
        <Button type="submit" disabled={busy || !acknowledged}>{copy.bootstrapCancelConfirm}</Button>
        <Button type="button" disabled={busy} onClick={() => { setPreview(null); setAcknowledged(false); }}>{copy.handoffBack}</Button>
      </form> : <Button size="sm" disabled={busy} onClick={() => { setPreview(view.requestId); setAcknowledged(false); }}>{copy.bootstrapCancel}</Button>}
    </> : null}
  </div>;
}
