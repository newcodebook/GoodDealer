import {
  afternicListingPlanPreviewRequestSchema, afternicListingWritePreviewRequestSchema, canonicalizeDomainName,
  type AfternicConnectionPort, type AfternicConnectionsStatus,
  type AfternicListingPlan, type AfternicListingPlanItem, type AfternicListingPlanPort,
  type AfternicListingPlanPreviewRequest, type AfternicListingPlanStatus, type AfternicListingWriteObserved,
  type AfternicListingWritePatch, type AfternicListingWritePlan, type AfternicListingWritePort,
  type AfternicListingWritePreviewRequest, type AfternicListingWriteStatus,
} from "@gooddealer/client-core";
import { formatDate, formatMoney, formatNumber, getPresentationCopy, type Locale } from "@gooddealer/i18n";
import { Badge, Banner, Button, Panel, Select, Table, type TableColumn } from "@gooddealer/ui";
import { useEffect, useId, useRef, useState } from "react";
import { shellTableLabels } from "../../../app-shell";
import "./afternic-listing-write-panel.css";

type PriceField = "buynowPriceMicroUsd" | "floorPriceMicroUsd" | "minbidPriceMicroUsd";
const priceFields: readonly PriceField[] = ["buynowPriceMicroUsd", "floorPriceMicroUsd", "minbidPriceMicroUsd"];
const reviewAction = "reactivate_ownership_review";
type Draft = { domain: string; prices: Record<PriceField, string>; hidden: boolean; selected: Record<PriceField | "hidden", boolean>; ownershipReview: boolean };
const draft = (domain: string): Draft => ({ domain, prices: { buynowPriceMicroUsd: "0", floorPriceMicroUsd: "0", minbidPriceMicroUsd: "20" },
  hidden: false, selected: { buynowPriceMicroUsd: false, floorPriceMicroUsd: false, minbidPriceMicroUsd: false, hidden: false }, ownershipReview: false });
type Plan = AfternicListingWritePlan | AfternicListingPlan;
type PreviewRequest = AfternicListingWritePreviewRequest | AfternicListingPlanPreviewRequest;

/** Decimal text is converted with integers, so no floating point rounding changes an approved price. */
function priceFromDollars(value: string, field: PriceField): number | null {
  if (!/^[0-9]{1,8}$/u.test(value)) return null;
  const dollars = BigInt(value);
  if (dollars > 49_999_999n || dollars < (field === "minbidPriceMicroUsd" ? 20n : 0n)) return null;
  return Number(dollars * 1_000_000n);
}

function ListingWriteEditor({ locale, connections, controlledDomain, reviewEnabled, disabled, preview }: {
  readonly locale: Locale; readonly connections: AfternicConnectionsStatus["connections"];
  readonly controlledDomain: string | null; readonly reviewEnabled: boolean;
  readonly disabled: boolean; readonly preview: (request: PreviewRequest) => void;
}) {
  const copy = getPresentationCopy(locale, "batchOperation");
  const id = useId();
  const [connectionId, setConnectionId] = useState("");
  const [action, setAction] = useState<Plan["action"]>("create");
  const [domains, setDomains] = useState(controlledDomain ?? "");
  const [rows, setRows] = useState<Draft[]>([]);
  const [errors, setErrors] = useState<ReadonlySet<string>>(new Set());
  const labels = { buynowPriceMicroUsd: copy.afternicWriteBuynow, floorPriceMicroUsd: copy.afternicWriteFloor, minbidPriceMicroUsd: copy.afternicWriteMinbid };
  const clear = (key: string) => setErrors(value => new Set([...value].filter(entry => entry !== key && entry !== "patch")));
  const updateRow = (index: number, edit: (row: Draft) => Draft) => setRows(value => value.map((row, offset) => offset === index ? edit(row) : row));
  const parseTargets = (text = domains): string[] | null => {
    try {
      const targets = text.split(/\r?\n/u).map(value => value.trim()).filter(Boolean).map(canonicalizeDomainName);
      if (targets.length < 1 || targets.length > 500 || new Set(targets).size !== targets.length
        || (controlledDomain !== null && targets.some(domain => domain !== controlledDomain))) return null;
      return targets;
    } catch { return null; }
  };
  const focus = (key: string) => document.getElementById(`${id}-${key}`)?.focus();
  const submitPreview = (result: { success: true; data: PreviewRequest } | { success: false }) => {
    if (!result.success) { setErrors(new Set(["domains"])); focus("domains"); return; }
    setErrors(new Set()); preview(result.data);
  };
  return <form className="afternic-listing-write-form" aria-labelledby={`${id}-title`} onSubmit={event => {
    event.preventDefault();
    if (disabled) return;
    const targets = parseTargets();
    if (!targets) { setErrors(new Set(["domains"])); focus("domains"); return; }
    if (!connections.some(connection => connection.connectionId === connectionId)) { setErrors(new Set(["connection"])); focus("connection"); return; }
    if (action === reviewAction) {
      if (reviewEnabled) submitPreview(afternicListingPlanPreviewRequestSchema.safeParse({
        schemaVersion: 2, connectionId, action, items: targets.map(domain => ({ domain })),
      }));
      return;
    }
    // Editing the target set discards per-item fields; generating rows never sends a Provider request.
    if (rows.length === 0 || rows.some((row, index) => row.domain !== targets[index])) { setRows(targets.map(draft)); setErrors(new Set()); return; }
    const issues = new Set<string>();
    const items = rows.map((row, index) => {
      const patch: AfternicListingWritePatch = {};
      for (const field of priceFields) {
        if (action === "update" && !row.selected[field]) continue;
        const value = priceFromDollars(row.prices[field], field);
        if (value === null) issues.add(`${index}-${field}`); else patch[field] = value;
      }
      if (action === "create" || row.selected.hidden) patch.hidden = row.hidden;
      if (Object.keys(patch).length === 0) issues.add(`${index}-patch`);
      return { domain: row.domain, patch };
    });
    if (issues.size > 0) { setErrors(issues); focus([...issues][0]!); return; }
    const selectedItems = action === "create" ? items.map(item => ({ domain: item.domain, values: item.patch })) : items;
    if (rows.some(row => row.ownershipReview)) {
      if (reviewEnabled) submitPreview(afternicListingPlanPreviewRequestSchema.safeParse({ schemaVersion: 2, connectionId, action,
        items: selectedItems.map((item, index) => ({ ...item, ownershipReview: rows[index]!.ownershipReview ? { mode: "reactivate_once_if_review" } : null })),
      }));
      return;
    }
    submitPreview(afternicListingWritePreviewRequestSchema.safeParse({ schemaVersion: 1, connectionId, action, items: selectedItems }));
  }}>
    <h3 id={`${id}-title`}>{copy.afternicWriteNewPreview}</h3>
    <Select id={`${id}-connection`} label={copy.afternicDelistConnection} name="connectionId" required value={connectionId} disabled={disabled}
      aria-invalid={errors.has("connection")} aria-describedby={errors.has("connection") ? `${id}-connection-error` : undefined} onChange={event => { setConnectionId(event.currentTarget.value); clear("connection"); }}
      options={[{ value: "", label: copy.afternicDelistChooseConnection }, ...connections.map(connection => ({ value: connection.connectionId, label: connection.displayLabel }))]} />
    {errors.has("connection") ? <p id={`${id}-connection-error`}>{copy.afternicDelistChooseConnection}</p> : null}
    <Select label={copy.afternicWriteAction} name="action" value={action} disabled={disabled}
      onChange={event => { const next = event.currentTarget.value; setAction(next === "update" || (reviewEnabled && next === reviewAction) ? next : "create"); setRows([]); setErrors(new Set()); }}
      options={[{ value: "create", label: copy.afternicWriteCreate }, { value: "update", label: copy.afternicWriteUpdate },
        ...(reviewEnabled ? [{ value: reviewAction, label: copy.afternicReviewOnly }] : [])]} />
    {reviewEnabled ? <p id={`${id}-review-scope`}>{copy.afternicReviewScope}</p> : null}
    <label htmlFor={`${id}-domains`}>{copy.afternicWriteDomains}</label>
    <p id={`${id}-domains-hint`}>{copy.afternicWriteDomainsHint}</p>
    <textarea id={`${id}-domains`} name="domains" rows={4} required maxLength={128_000} value={domains} disabled={disabled}
      autoCapitalize="none" autoCorrect="off" spellCheck={false} aria-invalid={errors.has("domains")}
      aria-describedby={`${id}-domains-hint${errors.has("domains") ? ` ${id}-domains-error` : ""}`}
      onInvalid={() => setErrors(value => new Set([...value, "domains"]))}
      onChange={event => { const text = event.currentTarget.value; setDomains(text); setRows([]); if (parseTargets(text) !== null) clear("domains"); }} />
    {errors.has("domains") ? <p id={`${id}-domains-error`}>{controlledDomain === null ? copy.afternicWriteInvalidDomains : copy.afternicControlledDomainRequired.replace("{domain}", controlledDomain)}</p> : null}
    {rows.length > 0 ? <>
      <p id={`${id}-prices-hint`}>{action === "create" ? copy.afternicWriteCreateHint : copy.afternicWriteUpdateHint} {copy.afternicWritePriceHint}</p>
      {[...errors].some(key => key.endsWith("-patch")) ? <p role="alert">{copy.afternicWriteEmptyPatch}</p> : null}
      <div className="afternic-listing-write-fields" tabIndex={0} role="region" aria-label={copy.afternicWritePrepare}>{rows.map((row, index) => <fieldset key={row.domain} disabled={disabled} aria-describedby={`${id}-prices-hint`}>
        <legend>{row.domain}</legend>
        {priceFields.map(field => {
          const key = `${index}-${field}`;
          const active = action === "create" || row.selected[field];
          return <div key={field} className="afternic-listing-write-field">
            {action === "update" ? <label><input type="checkbox" name={`${index}-${field}-selected`} checked={row.selected[field]}
              onChange={event => { const checked = event.currentTarget.checked; updateRow(index, value => ({ ...value, selected: { ...value.selected, [field]: checked } })); clear(`${index}-patch`); clear(key); }} />{copy.afternicWriteChangeField.replace("{field}", labels[field])}</label> : null}
            <label htmlFor={`${id}-${key}`}>{labels[field]} · {row.domain}</label>
            <input id={`${id}-${key}`} name={key} type="text" inputMode="numeric" pattern="[0-9]{1,8}" maxLength={8} required={active} disabled={!active}
              value={row.prices[field]} aria-invalid={errors.has(key)} aria-describedby={errors.has(key) ? `${id}-${key}-error` : undefined}
              onInvalid={() => setErrors(value => new Set([...value, key]))}
              onBlur={event => { if (active && priceFromDollars(event.currentTarget.value, field) === null) setErrors(value => new Set([...value, key])); }}
              onChange={event => { const value = event.currentTarget.value; updateRow(index, current => ({ ...current, prices: { ...current.prices, [field]: value } })); if (priceFromDollars(value, field) !== null) clear(key); }} />
            {errors.has(key) ? <p id={`${id}-${key}-error`}>{copy.afternicWriteInvalidPrice}</p> : null}
          </div>;
        })}
        <div className="afternic-listing-write-field">
          {action === "update" ? <label><input id={`${id}-${index}-patch`} type="checkbox" name={`${index}-hidden-selected`} checked={row.selected.hidden} aria-describedby={errors.has(`${index}-patch`) ? `${id}-${index}-patch-error` : undefined}
            onChange={event => { const checked = event.currentTarget.checked; updateRow(index, value => ({ ...value, selected: { ...value.selected, hidden: checked } })); clear(`${index}-patch`); }} />{copy.afternicWriteChangeHidden}</label> : null}
          <label><input type="checkbox" name={`${index}-hidden`} checked={row.hidden} disabled={action === "update" && !row.selected.hidden}
            onChange={event => { const checked = event.currentTarget.checked; updateRow(index, value => ({ ...value, hidden: checked })); }} />{copy.afternicWriteHidden} · {row.domain}</label>
          {errors.has(`${index}-patch`) ? <p id={`${id}-${index}-patch-error`}>{copy.afternicWriteEmptyPatch}</p> : null}
        </div>
        {reviewEnabled ? <label className="afternic-ownership-review-choice"><input type="checkbox" name={`${index}-ownership-review`}
          aria-describedby={`${id}-review-scope`} checked={row.ownershipReview}
          onChange={event => { const ownershipReview = event.currentTarget.checked; updateRow(index, value => ({ ...value, ownershipReview })); }} />
          {copy.afternicReviewOptIn.replace("{domain}", row.domain)}
        </label> : null}
      </fieldset>)}</div>
    </> : null}
    <Button type="submit" disabled={disabled}>{action === reviewAction ? copy.afternicReviewPreview
      : rows.length === 0 ? copy.afternicWritePrepare : copy.afternicWritePreview}</Button>
  </form>;
}

/** Durable local plans are read after uncertain replies; reads never approve or dispatch work. */
export function AfternicListingWritePanel({ locale, port, planPort, connectionsPort, readOnly, onChanged }: {
  readonly locale: Locale; readonly port: AfternicListingWritePort; readonly connectionsPort: AfternicConnectionPort;
  readonly planPort?: AfternicListingPlanPort | undefined;
  readonly readOnly: boolean; readonly onChanged: () => void;
}) {
  const copy = getPresentationCopy(locale, "batchOperation");
  const [status, setStatus] = useState<AfternicListingWriteStatus | AfternicListingPlanStatus | null>(null);
  const [connections, setConnections] = useState<AfternicConnectionsStatus["connections"]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [reading, setReading] = useState(true);
  const [pending, setPending] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [notice, setNotice] = useState<"unknown" | "approved" | "read_failed" | null>(null);
  const [now, setNow] = useState(Date.now());
  const readTicket = useRef(0);
  const operationTicket = useRef(0);
  const operationBusy = useRef(false);
  const previous = useRef<string | null>(null);
  const changed = useRef(onChanged); changed.current = onChanged;
  const heading = useRef<HTMLHeadingElement>(null);
  const focusPreview = useRef(false);
  const reviewQualified = status?.schemaVersion === 2 && status.ownershipReviewQualified;
  const reviewAvailable = status?.schemaVersion === 2 && status.ownershipReviewExecutionAvailable;
  const eligibility = `${readOnly}:${status?.writeQualified}:${status?.writeEntitled}:${status?.executionAvailable}:${reviewQualified}:${reviewAvailable}:${JSON.stringify(status?.controlledAcceptance)}:${connections.map(connection => connection.connectionId).sort().join(",")}`;
  const context = useRef({ port, planPort, connectionsPort, eligibility });
  // A lost role followed by regaining it must still invalidate an earlier in-flight preview.
  if (context.current.port !== port || context.current.planPort !== planPort || context.current.connectionsPort !== connectionsPort || context.current.eligibility !== eligibility) {
    operationTicket.current += 1;
    context.current = { port, planPort, connectionsPort, eligibility };
  }
  useEffect(() => { operationBusy.current = false; setPending(false); }, [eligibility, port, planPort, connectionsPort]);
  useEffect(() => {
    setSelected(null); setStatus(null); setNotice(null); previous.current = null;
    return () => { operationTicket.current += 1; };
  }, [port, planPort, connectionsPort]);
  useEffect(() => {
    const current = ++readTicket.current;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = async () => {
      setReading(true);
      try {
        const [next, connectionView] = await Promise.all([
          planPort ? planPort.status({ schemaVersion: 2, planRef: selected }) : port.status({ schemaVersion: 1, planRef: selected }),
          connectionsPort.status(),
        ]);
        if (readTicket.current !== current) return;
        setStatus(next); setConnections(connectionView.connections.filter(connection => connection.state === "active" && (next.controlledAcceptance === null || connection.connectionId === next.controlledAcceptance.connectionId))); setNow(Date.now());
        const snapshot = JSON.stringify(next.plans);
        if (previous.current !== null && previous.current !== snapshot) changed.current();
        previous.current = snapshot;
        if (focusPreview.current && next.detail !== null) {
          focusPreview.current = false;
          requestAnimationFrame(() => { if (readTicket.current === current) heading.current?.focus(); });
        }
        if (next.controlledAcceptance !== null || next.detail?.state === "awaiting_approval" || next.plans.some(plan => plan.state === "executing")) timer = setTimeout(() => { void read(); }, 2000);
      } catch { if (readTicket.current === current) { setStatus(null); setNotice("read_failed"); } }
      finally { if (readTicket.current === current) setReading(false); }
    };
    void read();
    return () => { readTicket.current += 1; clearTimeout(timer); };
  }, [port, planPort, connectionsPort, selected, attempt, readOnly]);
  const controlled = status?.controlledAcceptance ?? null;
  const canWrite = !readOnly && status !== null && (status.writeQualified || controlled !== null) && status.writeEntitled;
  const canReview = canWrite && controlled === null && reviewQualified && planPort !== undefined;
  const run = (operation: () => Promise<Plan>, approving: boolean) => {
    if (operationBusy.current || pending || reading || !canWrite || (approving && !status?.executionAvailable)) return;
    const current = ++operationTicket.current;
    operationBusy.current = true; setPending(true);
    void operation().then(plan => {
      if (operationTicket.current !== current) return;
      setSelected(plan.planRef);
      setStatus(value => value?.schemaVersion === 2 ? { ...value, detail: plan }
        : value?.schemaVersion === 1 && plan.schemaVersion === 1 ? { ...value, detail: plan } : value);
      setNotice(approving ? "approved" : null); focusPreview.current = true;
    }, () => { if (operationTicket.current === current) setNotice("unknown"); }).finally(() => {
      if (operationTicket.current === current) { operationBusy.current = false; setPending(false); setAttempt(value => value + 1); }
    });
  };
  const plan = selected !== null && status?.detail?.planRef === selected ? status.detail : null;
  const canApprove = canWrite && status.executionAvailable && !pending && !reading && plan?.state === "awaiting_approval" && Date.parse(plan.expiresAt) > now
    && (controlled === null || plan.items.every(item => item.domain === controlled.domain))
    && (plan.schemaVersion === 1 || (canReview && reviewAvailable));
  const date = (value: string) => `${formatDate(locale, Date.parse(value), { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} UTC`;
  const money = (value: number) => formatMoney(locale, (BigInt(value) / 1_000_000n).toString(), "USD");
  const fields = (value: AfternicListingWritePatch) => <dl className="afternic-listing-write-values">
    {priceFields.filter(field => value[field] !== undefined).map(field => <div key={field}><dt>{({ buynowPriceMicroUsd: copy.afternicWriteBuynow, floorPriceMicroUsd: copy.afternicWriteFloor, minbidPriceMicroUsd: copy.afternicWriteMinbid })[field]}</dt><dd>{money(value[field]!)}</dd></div>)}
    {value.hidden !== undefined ? <div><dt>{copy.afternicWriteHidden}</dt><dd>{value.hidden ? copy.afternicWriteYes : copy.afternicWriteNo}</dd></div> : null}
  </dl>;
  const providerLabels = {
    PENDING: copy.afternicDelistProviderPending, FAILED_COMPLIANCE: copy.afternicDelistProviderFailedCompliance,
    ACTIVE: copy.afternicDelistProviderActive, HIDDEN: copy.afternicDelistProviderHidden,
    ON_HOLD: copy.afternicDelistProviderOnHold, SOLD: copy.afternicDelistProviderSold,
    INACTIVE: copy.afternicDelistProviderInactive, OWNERSHIP_REVIEW: copy.afternicDelistProviderOwnershipReview,
    OWNERSHIP_UNVERIFIED: copy.afternicDelistProviderOwnershipUnverified, VERIFIED_OWNER_CONFLICT: copy.afternicDelistProviderOwnerConflict,
    INVENTORY_COMPLIANCE_ISSUE: copy.afternicDelistProviderInventoryIssue, TLD_UNSUPPORTED: copy.afternicDelistProviderTldUnsupported,
    UNREGISTERED_DOMAIN: copy.afternicDelistProviderUnregistered, UNKNOWN: copy.afternicDelistProviderUnknown,
  };
  const observed = (value: AfternicListingWriteObserved | null, before: boolean) => value === null ? <span>{before ? copy.afternicWriteNoBefore : copy.afternicWriteNoLatest}</span> : <>
    <p>{providerLabels[value.providerStatus]} ({value.providerStatus})</p>
    {fields(Object.fromEntries(Object.entries(value).filter(([key, field]) => (priceFields.includes(key as PriceField) || key === "hidden") && field !== null)))}
    <p>{date(value.observedAt)}</p>
  </>;
  const states = { awaiting_approval: copy.afternicDelistAwaiting, expired: copy.afternicDelistExpired, executing: copy.afternicDelistExecuting, completed: copy.afternicWriteCompleted, partially_failed: copy.afternicDelistConflict };
  const itemStates = { preview: copy.afternicDelistPreviewItem, queued: copy.afternicDelistQueued, reconciling: copy.afternicDelistReconciling,
    pending_provider: copy.afternicWritePendingProvider, pending_verification: copy.afternicWritePendingVerification, applied: copy.afternicWriteApplied, conflict: copy.afternicDelistConflict };
  const reasons = { precondition_changed: copy.afternicDelistChanged, connection_changed: copy.afternicDelistConnectionChanged,
    read_failed: copy.afternicDelistReadPending, postcondition_pending: copy.afternicWritePostconditionPending, already_present: copy.afternicWriteAlreadyPresent,
    listing_absent: copy.afternicWriteAbsent, provider_state_blocked: copy.afternicWriteBlocked };
  const reviewStates = { preview: copy.afternicReviewPlanned, waiting_parent: copy.afternicReviewWaitingParent,
    queued: copy.afternicReviewQueued, reconciling: copy.afternicReviewReconciling, pending_provider: copy.afternicReviewPending,
    confirmed: copy.afternicReviewConfirmed, not_required: copy.afternicReviewNotRequired, conflict: copy.afternicReviewConflict };
  const reviewReasons = { ...reasons, cooldown: copy.afternicReviewCooldown, prior_outcome_unknown: copy.afternicReviewPreviousUnknown,
    postcondition_pending: copy.afternicReviewPending };
  const actions = { create: copy.afternicWriteCreate, update: copy.afternicWriteUpdate, [reviewAction]: copy.afternicReviewOnly };
  const review = (item: AfternicListingPlanItem["ownershipReview"]) => item === null ? null : <>
    <Badge>{reviewStates[item.state]}</Badge>
    {item.latest !== null ? <p>{providerLabels[item.latest.providerStatus]} ({item.latest.providerStatus}) · {date(item.latest.observedAt)}</p> : null}
    {item.reason !== null && item.reason !== "postcondition_pending" ? <p>{reviewReasons[item.reason]}</p> : null}
    {item.retryAt !== null ? <p>{copy.afternicDelistNextRead} {date(item.retryAt)}</p> : null}
    {item.retryNotBefore !== null && item.state === "conflict" && item.reason === "cooldown" ? <p>{copy.afternicReviewNextAllowed} {date(item.retryNotBefore)}</p> : null}
  </>;
  const columns: TableColumn<AfternicListingPlanItem>[] = [
    { key: "domain", label: copy.afternicDelistDomain },
    ...(plan?.action === reviewAction ? [] : [
      { key: "before", label: copy.afternicWriteBefore, render: ({ listingWrite }) => observed(listingWrite?.before ?? null, true) },
      { key: "changes", label: copy.afternicWriteChanges, render: ({ listingWrite }) => listingWrite && fields(listingWrite.changes) },
      { key: "latest", label: copy.afternicWriteLatest, render: ({ listingWrite }) => observed(listingWrite?.latest ?? null, false) },
      { key: "writeResult", label: copy.afternicWriteResult, render: ({ listingWrite: item }) => item && <>
        <Badge>{item.state === "applied" && plan?.action === "create" ? (item.changes.hidden ? copy.afternicWriteCreatedHidden : copy.afternicWriteListed) : itemStates[item.state]}</Badge>
        {item.fieldsMatched ? <p>{copy.afternicWriteFieldsMatched}</p> : null}
        {item.reason !== null ? <p>{reasons[item.reason]}</p> : null}
        {item.retryAt !== null ? <p>{copy.afternicDelistNextRead} {date(item.retryAt)}</p> : null}
      </> },
    ] satisfies TableColumn<AfternicListingPlanItem>[]),
    ...(plan?.schemaVersion === 2 ? [{ key: "ownershipReview", label: copy.afternicReviewTitle,
      render: item => review(item.ownershipReview) } satisfies TableColumn<AfternicListingPlanItem>] : []),
  ];
  const rows: AfternicListingPlanItem[] = plan?.schemaVersion === 2 ? plan.items
    : plan?.items.map(({ domain, ...listingWrite }) => ({ domain, listingWrite, ownershipReview: null })) ?? [];
  const reviewCount = rows.filter(item => item.ownershipReview !== null).length;
  const preview = (request: PreviewRequest) => {
    if (request.schemaVersion === 1) run(() => port.preview(request), false);
    else if (canReview) run(() => planPort.preview(request), false);
  };
  const approve = () => {
    if (!canApprove) return;
    if (plan.schemaVersion === 1) run(() => port.approve({ schemaVersion: 1, planRef: plan.planRef, planHash: plan.planHash }), true);
    else if (canReview && reviewAvailable) run(() => planPort.approve({ schemaVersion: 2, planRef: plan.planRef, planHash: plan.planHash }), true);
  };
  return <section className="afternic-listing-write" aria-label={copy.afternicWriteTitle}>
    <Panel title={copy.afternicWriteTitle} actions={<Button type="button" size="sm" disabled={pending || reading} onClick={() => setAttempt(value => value + 1)}>{copy.afternicDelistRefresh}</Button>}>
      <p>{copy.afternicWriteScope}</p>
      {controlled !== null ? <Banner tone="warning" title={copy.afternicControlledAcceptanceTitle}>{copy.afternicControlledAcceptanceScope.replace("{domain}", controlled.domain).replace("{expiresAt}", date(controlled.expiresAt))}</Banner> : null}
      <p role="status">{notice === "unknown" ? copy.afternicDelistUnknown : notice === "approved" ? copy.afternicDelistApproved : ""}</p>
      {notice === "read_failed" && status === null ? <Banner tone="warning" title={copy.afternicDelistReadFailed} /> : null}
      {status !== null && !readOnly && !status.writeEntitled ? <p>{copy.afternicDelistEntitlement}</p> : null}
      {status !== null && !readOnly && !status.writeQualified && controlled === null ? <p>{copy.afternicDelistQualification}</p> : null}
      {status !== null && !readOnly && !status.executionAvailable ? <p>{copy.afternicDelistExecutionUnavailable}</p> : null}
      {selected === null && canWrite ? <ListingWriteEditor key={`${JSON.stringify(controlled)}:${canReview}`} locale={locale}
        connections={connections} controlledDomain={controlled?.domain ?? null} reviewEnabled={canReview} disabled={pending || reading} preview={preview} /> : null}
      {selected !== null ? <Button type="button" disabled={pending} onClick={() => { setSelected(null); setNotice(null); }}>{readOnly ? copy.afternicWriteHistory : copy.afternicWriteNewPreview}</Button> : null}
    </Panel>
    {plan !== null ? <Panel title={<h3 ref={heading} tabIndex={-1}>{plan.connectionLabel} · {actions[plan.action]} · {states[plan.state]}</h3>}>
      {plan.action !== reviewAction ? <p>{copy.afternicWriteObservedOnly}</p> : null}
      {plan.schemaVersion === 2 ? <p>{copy.afternicReviewScope}</p> : null}
      <p>{copy.afternicDelistExpires} {date(plan.expiresAt)}</p>
      <Table<AfternicListingPlanItem> {...shellTableLabels(locale)} label={plan.action === reviewAction ? copy.afternicReviewPreview : copy.afternicWritePreview} rows={rows} rowKey="domain" columns={columns} responsive={false} maxHeight="32rem" />
      {plan.state === "awaiting_approval" && !readOnly ? <>
        {plan.action !== reviewAction ? <p>{copy.afternicWriteApprovalScope.replace("{count}", formatNumber(locale, plan.items.length))}</p> : null}
        {reviewCount > 0 ? <p>{copy.afternicReviewApprovalScope.replace("{count}", formatNumber(locale, reviewCount))}</p> : null}
        {plan.schemaVersion === 2 && !reviewAvailable ? <p>{copy.afternicDelistExecutionUnavailable}</p> : null}
        <Button type="button" disabled={!canApprove} onClick={approve}>{(plan.schemaVersion === 2 ? copy.afternicReviewApprove : copy.afternicWriteApprove).replace("{count}", formatNumber(locale, plan.items.length))}</Button>
      </> : null}
    </Panel> : null}
    {status !== null ? <Panel title={copy.afternicWriteHistory}>
      <p>{copy.afternicDelistHistoryLimit}</p>
      <ul className="afternic-listing-write-history">{status.plans.map(entry => <li key={entry.planRef}>
        <Button type="button" disabled={pending} onClick={() => { focusPreview.current = true; setSelected(entry.planRef); setAttempt(value => value + 1); }}>{entry.connectionLabel} · {actions[entry.action]} · {date(entry.createdAt)}</Button>
        <span>{states[entry.state]}{entry.action !== reviewAction ? ` · ${copy.afternicDelistCounts.replace("{success}", formatNumber(locale, entry.applied)).replace("{conflict}", formatNumber(locale, entry.conflicts)).replace("{pending}", formatNumber(locale, entry.pending))}` : ""}</span>
        {entry.pendingVerification > 0 ? <span>{copy.afternicWriteVerificationCount.replace("{count}", formatNumber(locale, entry.pendingVerification))}</span> : null}
        {"ownershipReviewTotal" in entry ? <span>{copy.afternicReviewCounts
          .replace("{confirmed}", formatNumber(locale, entry.ownershipReviewConfirmed))
          .replace("{unneeded}", formatNumber(locale, entry.ownershipReviewNotRequired))
          .replace("{pending}", formatNumber(locale, entry.ownershipReviewPending))
          .replace("{conflict}", formatNumber(locale, entry.ownershipReviewConflicts))}</span> : null}
      </li>)}</ul>
    </Panel> : null}
  </section>;
}
