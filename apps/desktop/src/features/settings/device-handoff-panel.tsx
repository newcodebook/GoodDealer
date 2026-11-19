import type { DeviceDirectoryView } from "@gooddealer/client-core";
import { formatNumber, getPresentationCopy, type Locale } from "@gooddealer/i18n";
import { Button } from "@gooddealer/ui";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { DeviceSwitchPort, DeviceSwitchStep } from "../../adapters/tauri";

/** Native owns progression and recovery; this panel only confirms a target and reads closed status. */
export function DeviceHandoffPanel({ locale, port, directory, readOnly }: {
  readonly locale: Locale;
  readonly port: DeviceSwitchPort;
  readonly directory: DeviceDirectoryView;
  readonly readOnly: boolean;
}) {
  const copy = getPresentationCopy(locale, "settings");
  const [step, setStep] = useState<DeviceSwitchStep | null>(null);
  const [unknown, setUnknown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const generation = useRef(0);
  const inFlight = useRef(false);
  const acknowledgmentId = useId();
  const read = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    const current = generation.current;
    try {
      const next = await port.status();
      if (current === generation.current) { setStep(next); setUnknown(false); }
    } catch { if (current === generation.current) setUnknown(true); }
    finally { if (current === generation.current) inFlight.current = false; }
  }, [port]);
  useEffect(() => {
    generation.current += 1;
    inFlight.current = false;
    setStep(null); setUnknown(false); setBusy(false); setTarget(null); setAcknowledged(false);
    void read();
    const timer = setInterval(() => { void read(); }, 5_000);
    return () => { generation.current += 1; clearInterval(timer); };
  }, [read]);
  const self = directory.devices.find(device => device.currentDevice);
  const targets = directory.devices.filter(device => !device.currentDevice && device.status === "bound" && device.role === "standby");
  const selected = targets.find(device => device.deviceId === target);
  const deviceLabel = (device: DeviceDirectoryView["devices"][number]) => `${device.displayName ?? copy.unnamedDevice} · ${device.deviceId.slice(-8)}`;
  const terminal = step?.kind === "idle" || step?.kind === "writes_reopened" || step?.kind === "rejected"
    || (step?.kind === "switch" && ["completed", "cancelled", "failed"].includes(step.status));
  const canCancel = step !== null && step.kind !== "request_pending" && !terminal
    && !(step.kind === "switch" && step.status === "bootstrapping");
  const canRequest = !readOnly && self?.role === "active" && terminal && !unknown && !busy;
  const act = async (action: "request" | "cancel") => {
    if (inFlight.current || busy || readOnly) return;
    if (action === "cancel" && !canCancel) return;
    if (action === "request" && (!canRequest || selected === undefined || !acknowledged)) return;
    inFlight.current = true; setBusy(true);
    const current = generation.current;
    try {
      const next = action === "request" ? await port.request(selected!.deviceId) : await port.cancel();
      if (current === generation.current) { setStep(next); setUnknown(false); setTarget(null); setAcknowledged(false); }
    } catch {
      // A lost response can follow a committed request. Only Native's durable request is resumed.
      if (current === generation.current) { setUnknown(true); setTarget(null); setAcknowledged(false); }
    } finally {
      if (current === generation.current) { inFlight.current = false; setBusy(false); }
    }
  };
  const statusText = () => {
    if (unknown) return copy.handoffUnknown;
    if (step === null) return "";
    switch (step.kind) {
      case "idle": return copy.handoffReady;
      case "request_pending": return copy.handoffPending;
      case "waiting_for_sync": return copy.handoffSyncWaiting.replace("{count}", formatNumber(locale, step.unconfirmed));
      case "blocked": return copy.handoffBlocked;
      case "receipts_missing": return copy.handoffReceiptsMissing;
      case "rejected": return copy.handoffRejected;
      case "writes_reopened": return copy.handoffReopened;
      case "switch": return {
        requested: copy.handoffRequested, draining: copy.handoffDraining, waiting_expiry: copy.handoffWaitingExpiry,
        bootstrapping: copy.handoffBootstrapping, completed: copy.handoffCompleted,
        cancelled: copy.handoffCancelled, failed: copy.handoffFailed,
      }[step.status];
    }
  };
  return <div className="settings-handoff">
    <h3>{copy.handoff}</h3>
    {/* Announce meaningful outcomes, without moving focus or repeatedly announcing polling. */}
    <p role="status" aria-atomic="true">{statusText()}</p>
    {step !== null && step.kind !== "request_pending" && !terminal ? <p>{step.frozenUnresolved === null ? copy.handoffFrozenUnavailable
      : copy.handoffFrozenUnknown.replace("{count}", formatNumber(locale, step.frozenUnresolved))}</p> : null}
    <Button size="sm" disabled={busy} onClick={() => { void read(); }}>{copy.handoffCheck}</Button>
    {!readOnly && canCancel ? <Button size="sm" disabled={busy} onClick={() => { void act("cancel"); }}>{copy.handoffCancel}</Button> : null}
    {canRequest && target === null ? targets.map(device => <Button key={device.deviceId} size="sm" onClick={() => { setTarget(device.deviceId); setAcknowledged(false); }}>
      {copy.handoffTo.replace("{name}", deviceLabel(device))}
    </Button>) : null}
    {canRequest && selected !== undefined ? <form onSubmit={event => { event.preventDefault(); void act("request"); }}>
      <p>{copy.handoffDescription.replace("{from}", self === undefined ? copy.unnamedDevice : deviceLabel(self)).replace("{to}", deviceLabel(selected))}</p>
      <p>{copy.handoffDrainDetail}</p>
      <input id={acknowledgmentId} type="checkbox" required checked={acknowledged} onChange={event => setAcknowledged(event.currentTarget.checked)} />
      <label htmlFor={acknowledgmentId}>{copy.transferAck}</label>
      <Button type="submit" disabled={!acknowledged || busy}>{copy.handoffConfirm}</Button>
      <Button type="button" onClick={() => { setTarget(null); setAcknowledged(false); }}>{copy.handoffBack}</Button>
    </form> : null}
  </div>;
}
