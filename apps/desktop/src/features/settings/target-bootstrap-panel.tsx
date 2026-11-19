import { formatDate, getPresentationCopy, type Locale } from "@gooddealer/i18n";
import { Button } from "@gooddealer/ui";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { TargetBootstrapPort, TargetBootstrapView, TargetInstallationPort, TargetInstallationView } from "../../adapters/tauri";

type Confirmation = { readonly requestId: string; readonly action: "start" | "cancel" };
/** One decision names the displayed workflow; background work and replay stay in Native. */
export function TargetBootstrapPanel({ locale, port, installationPort }: { readonly locale: Locale; readonly port: TargetBootstrapPort; readonly installationPort?: TargetInstallationPort }) {
  const copy = getPresentationCopy(locale, "settings");
  const [view, setView] = useState<TargetBootstrapView | null>(null);
  const [installation, setInstallation] = useState<TargetInstallationView | null>(null);
  const [unknown, setUnknown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Confirmation | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const generation = useRef(0);
  const inFlight = useRef(false);
  const inputId = useId();
  const accept = useCallback((next: TargetBootstrapView) => {
    setView(next); setUnknown(false);
    // A new workflow requires a new decision even when the devices have not changed.
    setPreview(current => next.kind === "available" && current?.requestId === next.requestId ? current : null);
  }, []);
  const read = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    const ticket = generation.current;
    try {
      const [bootstrap, installed] = await Promise.allSettled([port.status(), installationPort?.status()]);
      if (ticket !== generation.current) return;
      if (bootstrap.status === "fulfilled") accept(bootstrap.value);
      else { setUnknown(true); setPreview(null); }
      if (installed.status === "fulfilled") {
        const next = installed.value ?? null;
        // A rejected first install writes no journal. Keep that exact workflow's refusal
        // visible when the local status correctly remains idle.
        setInstallation(current => next?.kind === "idle" && current?.kind === "existing_replica"
          && bootstrap.status === "fulfilled" && bootstrap.value.kind === "available"
          && bootstrap.value.requestId === current.requestId ? current : next);
        if (next !== null && next.kind !== "idle") setPreview(current => current?.action === "start" ? null : current);
      } else { setUnknown(true); setPreview(null); }
    } finally { if (ticket === generation.current) inFlight.current = false; }
  }, [accept, port, installationPort]);
  useEffect(() => {
    generation.current += 1; inFlight.current = false;
    setView(null); setInstallation(null); setUnknown(false); setBusy(false); setPreview(null); setAcknowledged(false);
    void read();
    const timer = setInterval(() => { void read(); }, 5_000);
    return () => { generation.current += 1; clearInterval(timer); };
  }, [read]);
  const submitConfirmation = async () => {
    if (inFlight.current || busy || unknown || !acknowledged || view?.kind !== "available" || preview?.requestId !== view.requestId) return;
    const { requestId, action } = preview;
    if (action === "start" && (installationPort === undefined || installation?.kind !== "idle")) return;
    const ticket = generation.current;
    inFlight.current = true; setBusy(true);
    try {
      if (action === "cancel") { const next = await port.cancel(requestId); if (ticket === generation.current) accept(next); }
      else { const next = await installationPort!.start(requestId); if (ticket === generation.current) setInstallation(next); }
    } catch { if (ticket === generation.current) setUnknown(true); }
    finally { if (ticket === generation.current) { inFlight.current = false; setBusy(false); setPreview(null); setAcknowledged(false); } }
  };
  const phaseCopy = { claiming: copy.installationClaiming, downloading: copy.installationDownloading, installing: copy.installationInstalling,
    verifying: copy.installationVerifying, activating: copy.installationActivating, authorizing: copy.installationAuthorizing };
  const currentInstallation = installation !== null && installation.kind !== "idle"
    && (view === null || view.kind === "idle" || installation.requestId === view.requestId) ? installation : null;
  const message = unknown ? copy.bootstrapUnknown : view?.kind === "pending" ? copy.bootstrapPending
    : currentInstallation?.kind === "running" ? phaseCopy[currentInstallation.phase]
      : currentInstallation?.kind === "completed" ? copy.installationCompleted
        : currentInstallation?.kind === "existing_replica" ? copy.installationExistingReplica
          : currentInstallation?.kind === "stopped" ? (currentInstallation.status === "cancelled" ? copy.bootstrapCancelled : currentInstallation.status === "failed" ? copy.bootstrapFailed : copy.bootstrapCompleted)
            : view === null ? "" : view.kind === "idle" ? copy.bootstrapIdle
            : view.kind === "available" ? copy.bootstrapAvailable
              : view.status === "cancelled" ? copy.bootstrapCancelled : view.status === "failed" ? copy.bootstrapFailed : copy.bootstrapCompleted;
  return <div className="settings-target-bootstrap">
    <h3>{copy.bootstrapTitle}</h3>
    <p role="status" aria-atomic="true">{message}</p>
    <Button size="sm" disabled={busy} onClick={() => { void read(); }}>{copy.bootstrapRefresh}</Button>
    {!unknown && view?.kind === "available" ? <>
      <p>{copy.bootstrapDeadline.replace("{time}", formatDate(locale, Date.parse(view.bootstrapExpiresAt), { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" }) + " UTC")}</p>
      {preview?.requestId === view.requestId ? <form onSubmit={event => { event.preventDefault(); void submitConfirmation(); }}>
        <p id={`${inputId}-detail`}>{preview.action === "start" ? copy.installationDetail : copy.bootstrapCancelDetail}</p>
        <input id={inputId} type="checkbox" required checked={acknowledged} disabled={busy} aria-describedby={`${inputId}-detail`} onChange={event => setAcknowledged(event.currentTarget.checked)} />
        <label htmlFor={inputId}>{preview.action === "start" ? copy.installationAck : copy.bootstrapCancelAck}</label>
        <Button type="submit" disabled={busy || !acknowledged}>{preview.action === "start" ? copy.installationConfirm : copy.bootstrapCancelConfirm}</Button>
        <Button type="button" disabled={busy} onClick={() => { setPreview(null); setAcknowledged(false); }}>{copy.handoffBack}</Button>
      </form> : <>
        {installationPort !== undefined && installation?.kind === "idle" ? <Button size="sm" disabled={busy} onClick={() => { setPreview({ requestId: view.requestId, action: "start" }); setAcknowledged(false); }}>{copy.installationStart}</Button> : null}
        <Button size="sm" disabled={busy} onClick={() => { setPreview({ requestId: view.requestId, action: "cancel" }); setAcknowledged(false); }}>{copy.bootstrapCancel}</Button>
      </>}
    </> : null}
  </div>;
}
