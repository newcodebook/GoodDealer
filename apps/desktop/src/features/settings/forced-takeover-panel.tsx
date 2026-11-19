import { formatDate, formatNumber, getPresentationCopy, type Locale } from "@gooddealer/i18n";
import { Button } from "@gooddealer/ui";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { ForcedTakeoverPort, ForcedTakeoverPreview, ForcedTakeoverView } from "../../adapters/tauri";

type Decision = { readonly kind: "takeover"; readonly preview: Extract<ForcedTakeoverPreview, { kind: "available" }> }
  | { readonly kind: "cancel"; readonly intentId: string };
function canStart(view: ForcedTakeoverView | null): boolean {
  return view?.kind === "idle" || view?.kind === "finished" || view?.kind === "cancelled_before_request" || (view?.kind === "stopped" && !view.canCancel);
}
function canCancel(view: ForcedTakeoverView | null): boolean {
  return view?.kind === "requesting" || view?.kind === "waiting" || view?.kind === "installing"
    || (view?.kind === "stopped" && view.canCancel);
}
/** A preview reference is the only approval input. Native owns waiting, retries and installation. */
export function ForcedTakeoverPanel({ locale, port, eligible }: {
  readonly locale: Locale; readonly port: ForcedTakeoverPort; readonly eligible: boolean;
}) {
  const copy = getPresentationCopy(locale, "settings");
  const [view, setView] = useState<ForcedTakeoverView | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [reason, setReason] = useState<Extract<ForcedTakeoverPreview, { kind: "unavailable" }>["reason"] | null>(null);
  const [browserOpened, setBrowserOpened] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const generation = useRef(0), previewGeneration = useRef(0), inFlight = useRef(false);
  const checkbox = useId();
  const accept = useCallback((next: ForcedTakeoverView) => {
    setView(next); setUnknown(false);
    setDecision(current => {
      if (current?.kind === "takeover") return canStart(next) ? current : null;
      if (current?.kind === "cancel") return canCancel(next) && next.kind !== "idle" && next.intentId === current.intentId ? current : null;
      return null;
    });
  }, []);
  const read = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    const ticket = generation.current;
    try { const next = await port.status(); if (ticket === generation.current) accept(next); }
    catch { if (ticket === generation.current) { setUnknown(true); setDecision(null); } }
    finally { if (ticket === generation.current) inFlight.current = false; }
  }, [port, accept]);
  useEffect(() => {
    generation.current += 1; inFlight.current = false;
    setView(null); setDecision(null); setReason(null); setBusy(false); setUnknown(false); setBrowserOpened(false); setAcknowledged(false);
    void read();
    const timer = setInterval(() => { void read(); }, 5_000);
    return () => { generation.current += 1; clearInterval(timer); };
  }, [read]);
  useEffect(() => {
    // A scope change also withdraws previews whose Native reply is still in flight.
    previewGeneration.current += 1;
    if (!eligible) {
      setDecision(current => current?.kind === "takeover" ? null : current);
      setAcknowledged(false); setBrowserOpened(false); setReason(null);
    }
  }, [eligible]);
  const act = async (action: "reauthenticate" | "preview" | "confirm") => {
    if (inFlight.current || busy || unknown) return;
    if (action !== "confirm" && (!eligible || !canStart(view))) return;
    if (action === "confirm" && (!acknowledged || decision === null
      || (decision.kind === "takeover" ? !eligible || !canStart(view) : !canCancel(view)))) return;
    const ticket = generation.current;
    const previewTicket = previewGeneration.current;
    inFlight.current = true; setBusy(true);
    try {
      if (action === "reauthenticate") {
        setDecision(null); setReason(null);
        await port.reauthenticate();
        if (ticket === generation.current && previewTicket === previewGeneration.current) setBrowserOpened(true);
      } else if (action === "preview") {
        const next = await port.preview();
        if (ticket === generation.current && previewTicket === previewGeneration.current) {
          setDecision(next.kind === "available" ? { kind: "takeover", preview: next } : null);
          setReason(next.kind === "unavailable" ? next.reason : null); setAcknowledged(false); setBrowserOpened(false);
        }
      } else if (decision !== null) {
        const next = decision.kind === "takeover" ? await port.confirm(decision.preview.previewId) : await port.cancel(decision.intentId);
        if (ticket === generation.current) { setDecision(null); setReason(null); setAcknowledged(false); accept(next); }
      }
    } catch {
      if (ticket === generation.current) {
        setDecision(null); setAcknowledged(false);
        // A confirmation timeout may follow a durable intent. Poll it; never resubmit a preview.
        if (action === "confirm") setUnknown(true);
        else if (previewTicket === previewGeneration.current) setReason("reauthentication_required");
      }
    } finally { if (ticket === generation.current) { inFlight.current = false; setBusy(false); } }
  };
  const unavailable = {
    source_unavailable: copy.forcedSourceUnavailable, switch_in_progress: copy.forcedSwitchInProgress,
    target_not_standby: copy.forcedNotStandby, reauthentication_required: copy.forcedLoginRequired,
    local_recovery_required: copy.installationRecoveryRequired, history_full: copy.installationHistoryFull,
  };
  const stopped = { reauthentication_required: copy.forcedLoginRequired, source_changed: copy.forcedSourceChanged,
    authorization_changed: copy.installationAuthorizationChanged, local_recovery_required: copy.installationRecoveryRequired,
    history_full: copy.installationHistoryFull, request_rejected: copy.forcedRequestRejected };
  const date = (value: string) => formatDate(locale, Date.parse(value), { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" }) + " UTC";
  const status = unknown ? copy.handoffUnknown : reason !== null ? unavailable[reason] : browserOpened ? copy.forcedBrowserOpened
    : view?.kind === "cancelled_before_request" ? copy.bootstrapCancelled : view?.kind === "requesting" ? copy.handoffPending : view?.kind === "waiting" ? copy.forcedEarliest.replace("{time}", date(view.earliestTakeoverAt))
      : view?.kind === "cancelling" ? copy.bootstrapPending : view?.kind === "installing" ? copy.installationClaiming
        : view?.kind === "stopped" ? stopped[view.reason] : view?.kind === "finished"
          ? (view.status === "completed" ? copy.installationCompleted : view.status === "cancelled" ? copy.bootstrapCancelled : copy.bootstrapFailed) : "";
  return <div className="settings-handoff">
    <h3>{copy.forcedTakeover}</h3>
    <p>{copy.forcedDescription}</p>
    <p role="status" aria-atomic="true">{status}</p>
    {view?.kind === "waiting" ? <p>{copy.forcedWaitDetail}</p> : null}
    <Button size="sm" disabled={busy} onClick={() => { void read(); }}>{copy.forcedRefresh}</Button>
    {!unknown && decision === null ? <>
      {eligible && canStart(view) ? <>
        <Button size="sm" disabled={busy} onClick={() => { void act("reauthenticate"); }}>{copy.forcedReauthenticate}</Button>
        <Button size="sm" disabled={busy} onClick={() => { void act("preview"); }}>{copy.forcedPreview}</Button>
      </> : null}
      {canCancel(view) && view !== null && view.kind !== "idle" ? <Button size="sm" disabled={busy} onClick={() => {
        setDecision({ kind: "cancel", intentId: view.intentId }); setAcknowledged(false);
      }}>{copy.forcedCancel}</Button> : null}
    </> : null}
    {!unknown && decision !== null ? <form onSubmit={event => { event.preventDefault(); void act("confirm"); }}>
      {decision.kind === "takeover" ? <>
        <p>{copy.forcedPreviewSource.replace("{device}", decision.preview.sourceDeviceId.slice(-8)).replace("{epoch}", formatNumber(locale, decision.preview.sourceLeaseEpoch))}</p>
        <p>{copy.forcedEarliest.replace("{time}", date(decision.preview.earliestTakeoverAt))}</p>
        <p>{copy.forcedWaitDetail}</p>
        <p>{copy.installationDetail}</p>
      </> : <p>{copy.forcedCancelDetail}</p>}
      <input id={checkbox} type="checkbox" required checked={acknowledged} disabled={busy} onChange={event => setAcknowledged(event.currentTarget.checked)} />
      <label htmlFor={checkbox}>{decision.kind === "takeover" ? copy.forcedAck : copy.bootstrapCancelAck}</label>
      <Button type="submit" disabled={busy || !acknowledged}>{decision.kind === "takeover" ? copy.forcedConfirm : copy.forcedCancelConfirm}</Button>
      <Button type="button" disabled={busy} onClick={() => { setDecision(null); setAcknowledged(false); }}>{copy.handoffBack}</Button>
    </form> : null}
  </div>;
}
