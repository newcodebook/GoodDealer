import {
  afternicDelistPreviewRequestSchema, canonicalizeDomainName,
  type AfternicConnectionPort, type AfternicConnectionsStatus,
  type AfternicDelistPlan, type AfternicDelistPort, type AfternicDelistStatus,
} from "@gooddealer/client-core";
import { formatDate, formatMoney, formatNumber, getPresentationCopy, type Locale } from "@gooddealer/i18n";
import { Badge, Banner, Button, Panel, Select, Table, type TableColumn } from "@gooddealer/ui";
import { useEffect, useId, useRef, useState } from "react";
import { shellTableLabels } from "../../../app-shell";
import "./afternic-delist-panel.css";

type Item = AfternicDelistPlan["items"][number];

/** Local preview and one approval; the Native runner alone dispatches or reconciles an item. */
export function AfternicDelistPanel({ locale, port, connectionsPort, readOnly, onChanged }: {
  readonly locale: Locale;
  readonly port: AfternicDelistPort;
  readonly connectionsPort: AfternicConnectionPort;
  readonly readOnly: boolean;
  readonly onChanged: () => void;
}) {
  const copy = getPresentationCopy(locale, "batchOperation");
  const [status, setStatus] = useState<AfternicDelistStatus | null>(null);
  const [connections, setConnections] = useState<AfternicConnectionsStatus["connections"]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [connectionId, setConnectionId] = useState("");
  const [domains, setDomains] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [pending, setPending] = useState(false);
  const [reading, setReading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [notice, setNotice] = useState<"unknown" | "approved" | "read_failed" | null>(null);
  const [now, setNow] = useState(Date.now());
  const ticket = useRef(0);
  const operationTicket = useRef(0);
  const operationBusy = useRef(false);
  const previous = useRef<string | null>(null);
  const changed = useRef(onChanged);
  changed.current = onChanged;
  const heading = useRef<HTMLHeadingElement>(null);
  const focusPreview = useRef(false);
  const id = useId();
  useEffect(() => {
    operationBusy.current = false;
    setPending(false);
    setSelected(null);
    setConnectionId("");
    setDomains("");
    setInvalid(false);
    setStatus(null);
    setNotice(null);
    previous.current = null;
    return () => { operationTicket.current += 1; };
  }, [port]);

  useEffect(() => {
    const current = ++ticket.current;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = async () => {
      setReading(true);
      try {
        const [next, connectionView] = await Promise.all([
          port.status({ schemaVersion: 1, planRef: selected }), connectionsPort.status(),
        ]);
        if (ticket.current !== current) return;
        setStatus(next);
        const activeConnections = connectionView.connections.filter((connection) => connection.state === "active" && (next.controlledAcceptance === null || next.controlledAcceptance.connectionId === connection.connectionId));
        setConnections(activeConnections);
        setConnectionId((value) => activeConnections.some((connection) => connection.connectionId === value) ? value : "");
        setNow(Date.now());
        const snapshot = JSON.stringify(next.plans);
        if (previous.current !== null && previous.current !== snapshot) changed.current();
        previous.current = snapshot;
        if (focusPreview.current && next.detail !== null) {
          focusPreview.current = false;
          requestAnimationFrame(() => { if (ticket.current === current) heading.current?.focus(); });
        }
        if (next.controlledAcceptance !== null || next.detail?.state === "awaiting_approval" || next.plans.some((plan) => plan.state === "executing")) {
          timer = setTimeout(() => { void read(); }, 2000);
        }
      } catch {
        if (ticket.current === current) { setStatus(null); setNotice("read_failed"); }
      } finally { if (ticket.current === current) setReading(false); }
    };
    void read();
    return () => { ticket.current += 1; clearTimeout(timer); };
  }, [port, connectionsPort, selected, attempt]);

  const run = (operation: () => Promise<AfternicDelistPlan>, approving: boolean) => {
    if (operationBusy.current || pending || readOnly || reading || !canWrite || (approving && !status?.executionAvailable)) return;
    operationBusy.current = true;
    setPending(true);
    const current = ++operationTicket.current;
    void operation().then((plan) => {
      if (operationTicket.current !== current) return;
      setSelected(plan.planRef);
      setStatus((value) => value === null ? null : { ...value, detail: plan });
      setNotice(approving ? "approved" : null);
      focusPreview.current = !approving;
    }, () => {
      // A reply may be lost after a durable write. Never rebuild a preview or approve it again.
      if (operationTicket.current === current) setNotice("unknown");
    }).finally(() => {
      if (operationTicket.current === current) { operationBusy.current = false; setPending(false); setAttempt((value) => value + 1); }
    });
  };
  const eligibility = `${readOnly}:${status?.writeQualified}:${status?.writeEntitled}:${status?.executionAvailable}:${JSON.stringify(status?.controlledAcceptance)}:${connections.map(connection => connection.connectionId).sort().join(",")}`;
  const context = useRef({ port, connectionsPort, eligibility });
  if (context.current.port !== port || context.current.connectionsPort !== connectionsPort || context.current.eligibility !== eligibility) {
    operationTicket.current += 1;
    context.current = { port, connectionsPort, eligibility };
  }
  useEffect(() => { operationBusy.current = false; setPending(false); }, [eligibility, port, connectionsPort]);
  // A slow read for a newly selected history entry must never authorize the previous detail.
  const plan = selected !== null && status?.detail?.planRef === selected ? status.detail : null;
  const controlled = status?.controlledAcceptance ?? null;
  const canWrite = !readOnly && status !== null && (status.writeQualified || controlled !== null) && status.writeEntitled;
  const canApprove = canWrite && status.executionAvailable && !pending && !reading
    && plan?.state === "awaiting_approval" && Date.parse(plan.expiresAt) > now
    && (controlled === null || plan.items.every(item => item.domain === controlled.domain));
  const date = (value: string) => `${formatDate(locale, Date.parse(value), { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} UTC`;
  const money = (value: number | null) => value === null ? "—" : formatMoney(locale, String(value / 1_000_000), "USD");
  const stateLabel = {
    awaiting_approval: copy.afternicDelistAwaiting, expired: copy.afternicDelistExpired,
    executing: copy.afternicDelistExecuting, completed: copy.afternicDelistCompleted,
    partially_failed: copy.afternicDelistConflict,
  };
  const itemState = {
    preview: copy.afternicDelistPreviewItem, queued: copy.afternicDelistQueued,
    reconciling: copy.afternicDelistReconciling, succeeded: copy.afternicDelistSucceeded,
    conflict: copy.afternicDelistConflict,
  };
  const reasons = {
    precondition_changed: copy.afternicDelistChanged, connection_changed: copy.afternicDelistConnectionChanged,
    read_failed: copy.afternicDelistReadPending, still_present: copy.afternicDelistStillPresent,
  };
  const providerStatus = {
    PENDING: copy.afternicDelistProviderPending, FAILED_COMPLIANCE: copy.afternicDelistProviderFailedCompliance,
    ACTIVE: copy.afternicDelistProviderActive, HIDDEN: copy.afternicDelistProviderHidden,
    ON_HOLD: copy.afternicDelistProviderOnHold, SOLD: copy.afternicDelistProviderSold,
    INACTIVE: copy.afternicDelistProviderInactive, OWNERSHIP_REVIEW: copy.afternicDelistProviderOwnershipReview,
    OWNERSHIP_UNVERIFIED: copy.afternicDelistProviderOwnershipUnverified,
    VERIFIED_OWNER_CONFLICT: copy.afternicDelistProviderOwnerConflict,
    INVENTORY_COMPLIANCE_ISSUE: copy.afternicDelistProviderInventoryIssue,
    TLD_UNSUPPORTED: copy.afternicDelistProviderTldUnsupported,
    UNREGISTERED_DOMAIN: copy.afternicDelistProviderUnregistered, UNKNOWN: copy.afternicDelistProviderUnknown,
  };
  const columns: TableColumn<Item>[] = [
    { key: "domain", label: copy.afternicDelistDomain },
    { key: "providerStatus", label: copy.afternicDelistObservedState, render: (item) => <>
      {providerStatus[item.providerStatus]}
      {item.hidden === true ? <span> · {copy.afternicDelistHidden}</span> : null}
    </> },
    { key: "buynowPrice", label: copy.afternicDelistBuynow, numeric: true, render: (item) => money(item.buynowPrice) },
    { key: "floorPrice", label: copy.afternicDelistFloor, numeric: true, render: (item) => money(item.floorPrice) },
    { key: "minbidPrice", label: copy.afternicDelistMinbid, numeric: true, render: (item) => money(item.minbidPrice) },
    { key: "observedAt", label: copy.afternicDelistObservedAt, render: (item) => date(item.observedAt) },
    { key: "state", label: copy.afternicDelistResult, render: (item) => <>
      <Badge>{itemState[item.state]}</Badge>
      {item.reason !== null ? <p>{reasons[item.reason]}</p> : null}
      {item.retryAt !== null ? <p>{copy.afternicDelistNextRead} {date(item.retryAt)}</p> : null}
    </> },
  ];
  return <section className="afternic-delist" aria-label={copy.afternicDelistTitle}>
    <Panel title={copy.afternicDelistTitle} actions={<Button type="button" size="sm" disabled={pending || reading} onClick={() => setAttempt((value) => value + 1)}>{copy.afternicDelistRefresh}</Button>}>
      <p>{copy.afternicDelistScope}</p>
      {controlled !== null ? <Banner tone="warning" title={copy.afternicControlledAcceptanceTitle}>{copy.afternicControlledAcceptanceScope.replace("{domain}", controlled.domain).replace("{expiresAt}", date(controlled.expiresAt))}</Banner> : null}
      <p role="status">{notice === "unknown" ? copy.afternicDelistUnknown : notice === "approved" ? copy.afternicDelistApproved : ""}</p>
      {notice === "read_failed" && status === null ? <Banner tone="warning" title={copy.afternicDelistReadFailed} /> : null}
      {status !== null && !readOnly && !status.writeEntitled ? <p>{copy.afternicDelistEntitlement}</p> : null}
      {status !== null && !readOnly && !status.writeQualified && controlled === null ? <p>{copy.afternicDelistQualification}</p> : null}
      {status !== null && !readOnly && !status.executionAvailable ? <p>{copy.afternicDelistExecutionUnavailable}</p> : null}
      {selected === null && canWrite ? <form aria-labelledby={`${id}-form`} onSubmit={(event) => {
        event.preventDefault();
        let targets: string[];
        try { targets = domains.split(/\r?\n/u).map((value) => value.trim()).filter(Boolean).map(canonicalizeDomainName); }
        catch { setInvalid(true); document.getElementById(`${id}-domains`)?.focus(); return; }
        const request = afternicDelistPreviewRequestSchema.safeParse({ schemaVersion: 1, connectionId, domains: targets });
        if (!request.success || (controlled !== null && targets.some(domain => domain !== controlled.domain))) { setInvalid(true); document.getElementById(`${id}-domains`)?.focus(); return; }
        run(() => port.preview(request.data), false);
      }}>
        <h3 id={`${id}-form`}>{copy.afternicDelistNewPreview}</h3>
        <Select label={copy.afternicDelistConnection} name="connectionId" required value={connectionId}
          disabled={pending || reading} onChange={(event) => setConnectionId(event.currentTarget.value)}
          options={[{ value: "", label: copy.afternicDelistChooseConnection }, ...connections.map((connection) => ({ value: connection.connectionId, label: connection.displayLabel }))]} />
        <label htmlFor={`${id}-domains`}>{copy.afternicDelistDomains}</label>
        <p id={`${id}-hint`}>{copy.afternicDelistDomainsHint}</p>
        <textarea id={`${id}-domains`} name="domains" required maxLength={128_000} rows={6}
          autoCapitalize="none" autoCorrect="off" spellCheck={false} value={domains} disabled={pending || reading}
          aria-invalid={invalid} aria-describedby={`${id}-hint${invalid ? ` ${id}-error` : ""}`}
          onInvalid={() => setInvalid(true)} onChange={(event) => { setDomains(event.currentTarget.value); setInvalid(false); }} />
        {invalid ? <p id={`${id}-error`}>{controlled === null ? copy.afternicDelistInvalid : copy.afternicControlledDomainRequired.replace("{domain}", controlled.domain)}</p> : null}
        <Button type="submit" disabled={pending || reading}>{copy.afternicDelistPreview}</Button>
      </form> : null}
      {selected !== null ? <Button type="button" disabled={pending} onClick={() => { setSelected(null); setNotice(null); }}>{readOnly ? copy.afternicDelistHistory : copy.afternicDelistNewPreview}</Button> : null}
    </Panel>
    {plan !== null ? <Panel title={<h3 ref={heading} tabIndex={-1}>{plan.connectionLabel} · {stateLabel[plan.state]}</h3>}>
      <p>{copy.afternicDelistObservedOnly}</p>
      <p>{copy.afternicDelistExpires} {date(plan.expiresAt)}</p>
      <Table<Item> {...shellTableLabels(locale)} label={copy.afternicDelistPreview} rows={plan.items} rowKey="domain" columns={columns} responsive={false} maxHeight="28rem" />
      {plan.state === "awaiting_approval" && !readOnly ? <>
        <p>{copy.afternicDelistApprovalScope.replace("{count}", formatNumber(locale, plan.items.length))}</p>
        <Button type="button" variant="danger" disabled={!canApprove} onClick={() => {
          if (canApprove) run(() => port.approve({ schemaVersion: 1, planRef: plan.planRef, planHash: plan.planHash }), true);
        }}>{copy.afternicDelistApprove.replace("{count}", formatNumber(locale, plan.items.length))}</Button>
      </> : null}
    </Panel> : null}
    {status !== null ? <Panel title={copy.afternicDelistHistory}>
      <p>{copy.afternicDelistHistoryLimit}</p>
      <ul className="afternic-delist-history">{status.plans.map((entry) => <li key={entry.planRef}>
        <Button type="button" disabled={pending} onClick={() => { focusPreview.current = true; setSelected(entry.planRef); setAttempt((value) => value + 1); }}>{entry.connectionLabel} · {date(entry.createdAt)}</Button>
        <span>{stateLabel[entry.state]} · {copy.afternicDelistCounts.replace("{success}", formatNumber(locale, entry.succeeded)).replace("{conflict}", formatNumber(locale, entry.conflicts)).replace("{pending}", formatNumber(locale, entry.pending))}</span>
      </li>)}</ul>
    </Panel> : null}
  </section>;
}
