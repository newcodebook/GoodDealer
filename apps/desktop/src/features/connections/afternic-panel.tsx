import { afternicConnectIntentSchema, type AfternicConnectionPort, type AfternicConnectionsStatus } from "@gooddealer/client-core";
import { formatDate, formatNumber, getPresentationCopy, type Locale } from "@gooddealer/i18n";
import { Badge, Banner, Button, Input, Panel } from "@gooddealer/ui";
import { useEffect, useId, useRef, useState } from "react";

/** The panel submits intent once; every subsequent read reports Native's durable result. */
export function AfternicPanel({ locale, port, readOnly, onChanged }: {
  readonly locale: Locale;
  readonly port: AfternicConnectionPort;
  readonly readOnly: boolean;
  readonly onChanged: () => void;
}) {
  const copy = getPresentationCopy(locale, "settings");
  const [view, setView] = useState<AfternicConnectionsStatus | null>(null);
  const [label, setLabel] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<"queued" | "unknown" | "failed" | null>(null);
  const [attempt, setAttempt] = useState(0);
  const ticket = useRef(0);
  const change = useRef(onChanged);
  change.current = onChanged;
  const previous = useRef<string | null>(null);
  const id = useId();
  useEffect(() => {
    const current = ++ticket.current;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      try {
        const next = await port.status();
        if (current !== ticket.current) return;
        setView(next);
        const snapshot = JSON.stringify(next.connections);
        if (previous.current !== null && previous.current !== snapshot) change.current();
        previous.current = snapshot;
        if (next.laneState === "busy" || next.laneState === "recovering") timer = setTimeout(() => { void refresh(); }, 1000);
      } catch { if (current === ticket.current) { setView(null); setNotice("failed"); } }
    };
    void refresh();
    return () => { ticket.current += 1; clearTimeout(timer); };
  }, [port, attempt]);
  const run = (operation: () => Promise<void>) => {
    if (pending || readOnly) return;
    setPending(true);
    const current = ticket.current;
    void operation().then(() => {
      if (current === ticket.current) setNotice("queued");
    }, () => {
      // A lost response never triggers a second action. The next read reconciles local state.
      if (current === ticket.current) setNotice("unknown");
    }).finally(() => {
      if (current === ticket.current) { setPending(false); setAttempt((value) => value + 1); }
    });
  };
  const canObserve = !readOnly && view?.observeEntitled && view.observeQualified;
  const busy = pending || view?.laneState === "busy" || view?.laneState === "recovering";
  const stateCopy = { prepared: copy.afternicPrepared, active: copy.afternicActive, remediation_required: copy.afternicRemediation, revoked: copy.afternicRevoked };
  return <Panel title={copy.afternicTitle} actions={<Button type="button" size="sm" disabled={pending} onClick={() => setAttempt((value) => value + 1)}>{copy.afternicRefreshStatus}</Button>}>
    <p>{copy.afternicInventoryHelp}</p>
    <p role="status">{notice === "queued" ? copy.afternicQueued : notice === "unknown" ? copy.afternicUnknown : ""}</p>
    {notice === "failed" && view === null ? <Banner tone="warning" title={copy.afternicReadFailed} /> : null}
    {view !== null && !readOnly && !view.observeEntitled ? <p>{copy.afternicEntitlementRequired}</p> : null}
    {view !== null && !readOnly && !view.observeQualified ? <p>{copy.afternicQualificationPending}</p> : null}
    {view !== null && !readOnly && !view.capturable ? <p>{copy.afternicCaptureUnavailable}</p> : null}
    {view !== null && view.lastOperation !== null && view.lastOperation.outcome !== "confirmed" ? <Banner tone="warning" title={copy.afternicActionUnconfirmed} /> : null}
    {view !== null ? <ul className="settings-device-directory" role="list">
      {view.connections.map((connection) => <li key={connection.connectionId} className="settings-device-row">
        <div><strong>{connection.displayLabel}</strong> <Badge>{stateCopy[connection.state]}</Badge>
          {connection.lastScan === null ? <p>{copy.afternicNeverScanned}</p> : <>
            <p>{copy.afternicInventoryCount.replace("{count}", formatNumber(locale, connection.lastScan.observed))} · {copy.afternicImportedCount.replace("{count}", formatNumber(locale, connection.lastScan.imported))}</p>
            <p>{formatDate(locale, Date.parse(connection.lastScan.completedAt), { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" })} UTC</p>
            {connection.lastScan.skippedDeleted > 0 ? <p>{copy.afternicSkippedDeleted.replace("{count}", formatNumber(locale, connection.lastScan.skippedDeleted))}</p> : null}
          </>}
          {connection.state === "remediation_required" ? <p>{copy.afternicReconnectHelp}</p> : null}
        </div>
        {!readOnly ? <div>
          {canObserve && (connection.state === "active" || connection.state === "prepared") ? <Button type="button" disabled={busy || view.laneState !== "ready"} aria-label={`${copy.afternicScan} ${connection.displayLabel}`} onClick={() => run(() => port.refresh(connection.connectionId))}>{copy.afternicScan}</Button> : null}
          <Button type="button" disabled={pending || view.laneState === "busy"} aria-label={`${copy.afternicDisconnect} ${connection.displayLabel}`} onClick={() => run(() => port.revoke(connection.connectionId))}>{connection.purgePending ? copy.afternicRetryCleanup : copy.afternicDisconnect}</Button>
        </div> : null}
      </li>)}
    </ul> : null}
    {canObserve && view.capturable ? <form aria-labelledby={`${id}-title`} onSubmit={(event) => {
      event.preventDefault();
      const parsed = afternicConnectIntentSchema.safeParse({ schemaVersion: 1, displayLabel: label });
      if (!parsed.success) { setInvalid(true); document.getElementById(id)?.focus(); return; }
      run(() => port.connect(parsed.data.displayLabel));
    }}>
      <h3 id={`${id}-title`}>{copy.afternicConnect}</h3>
      <label htmlFor={id}>{copy.afternicLabel}</label>
      <p id={`${id}-help`}>{copy.afternicCaptureHelp}</p>
      <Input id={id} name="displayLabel" value={label} required maxLength={80} disabled={busy}
        aria-invalid={invalid} aria-describedby={`${id}-help${invalid ? ` ${id}-error` : ""}`}
        onInvalid={() => setInvalid(true)} onChange={(event) => { setLabel(event.currentTarget.value); setInvalid(false); }} />
      {invalid ? <p id={`${id}-error`}>{copy.afternicLabelInvalid}</p> : null}
      <Button type="submit" disabled={busy || view.laneState !== "ready"}>{copy.afternicConnect}</Button>
    </form> : null}
  </Panel>;
}
