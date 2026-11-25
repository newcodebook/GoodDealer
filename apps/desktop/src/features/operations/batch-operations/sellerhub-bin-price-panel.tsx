import {
  sellerHubBinPricePreviewSchema,
  type SellerHubBinPricePlan, type SellerHubBinPricePort, type SellerHubBinPriceStatus,
  type SellerHubPort,
} from "@gooddealer/client-core";
import { formatDate, getPresentationCopy, type Locale } from "@gooddealer/i18n";
import { Button, Panel } from "@gooddealer/ui";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { formatCents, parseRows } from "./sellerhub-price-input";
import "./marketplace-batch.css";

type Copy = ReturnType<typeof getPresentationCopy<"batchOperation">>;
type Connections = Awaited<ReturnType<SellerHubPort["status"]>>["connections"];

const planText = (copy: Copy, plan: SellerHubBinPricePlan["state"]) => ({
  awaiting_approval: copy.sellerHubBinAwaiting, expired: copy.sellerHubBinExpired,
  executing: copy.sellerHubBinExecuting, completed: copy.sellerHubBinCompleted,
  partially_failed: copy.sellerHubBinPartiallyFailed,
})[plan];

function PriceChanges({ locale, plan }: { readonly locale: Locale; readonly plan: SellerHubBinPricePlan }) {
  const copy = getPresentationCopy(locale, "batchOperation");
  const itemText = {
    preview: copy.sellerHubBinAwaiting, queued: copy.sellerHubBinQueued,
    reconciling: copy.sellerHubBinReconciling, changed: copy.sellerHubBinChanged, refused: copy.sellerHubBinRefused,
  };
  return <div className="marketplace-batch-table">
    <table>
      <caption>{plan.connectionLabel}</caption>
      <thead><tr>
        <th scope="col">{copy.sellerHubBinDomain}</th>
        <th scope="col">{copy.sellerHubBinPrevious}</th>
        <th scope="col">{copy.sellerHubBinNext}</th>
        <th scope="col">{copy.sellerHubBinResult}</th>
      </tr></thead>
      <tbody>{plan.items.map(item => <tr key={item.domain}>
        <th scope="row">{item.domain}</th>
        <td>{formatCents(locale, item.previousPriceCents)}</td>
        <td>{formatCents(locale, item.priceCents)}</td>
        <td>{itemText[item.state]}</td>
      </tr>)}</tbody>
    </table>
  </div>;
}

export function SellerHubBinPricePanel({ locale, port, connectionsPort, readOnly, onChanged }: {
  readonly locale: Locale;
  readonly port: SellerHubBinPricePort;
  readonly connectionsPort: SellerHubPort;
  readonly readOnly: boolean;
  readonly onChanged: () => void;
}) {
  const copy = getPresentationCopy(locale, "batchOperation");
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const changed = useRef(onChanged);
  changed.current = onChanged;
  const [status, setStatus] = useState<SellerHubBinPriceStatus | null>(null);
  const [connections, setConnections] = useState<Connections>([]);
  const [connection, setConnection] = useState("");
  const [text, setText] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [review, setReview] = useState<SellerHubBinPricePlan | null>(null);
  const [edited, setEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<"read_failed" | "preview_failed" | "approve_unknown" | null>(null);
  const [refresh, setRefresh] = useState(0);
  const action = useRef(0);
  const submitting = useRef(false);
  const plan = selected !== null && status?.plan?.planId !== selected ? null : status?.plan ?? null;
  const reviewCanApprove = review !== null && (plan === null || plan.planId !== review.planId || plan.state === "awaiting_approval");
  const mayEdit = !readOnly && status?.writeQualified === true && status.writeEntitled;
  const mayApprove = mayEdit && status?.executionAvailable === true;
  const boundary = useRef({ port, connectionsPort, readOnly });
  if (boundary.current.port !== port || boundary.current.connectionsPort !== connectionsPort || boundary.current.readOnly !== readOnly) {
    action.current += 1;
    boundary.current = { port, connectionsPort, readOnly };
  }
  useEffect(() => {
    setReview(null); setBusy(false);
    submitting.current = false;
    return () => { action.current += 1; };
  }, [port, connectionsPort, readOnly]);

  const lastProjection = useRef<string | null>(null);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      try {
        const [next, connectionView] = await Promise.all([
          port.status({ schemaVersion: 1, planId: selected }), connectionsPort.status(),
        ]);
        if (!active) return;
        setStatus(next);
        setConnections(connectionView.connections.filter(row => row.state === "active"));
        setNotice(previous => previous === "read_failed" ? null : previous);
        const projection = JSON.stringify(next.recent);
        if (lastProjection.current !== null && lastProjection.current !== projection) changed.current();
        lastProjection.current = projection;
      } catch {
        if (!active) return;
        setStatus(null); setConnections([]); setNotice("read_failed");
      }
      if (active) timer = setTimeout(() => { void read(); }, 2500);
    };
    void read();
    return () => { active = false; clearTimeout(timer); };
  }, [port, connectionsPort, selected, refresh]);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (review && !element.open) element.showModal();
    if (!review && element.open) element.close();
  }, [review]);

  const edit = () => { setEdited(true); setInvalid(false); setNotice(null); };
  const run = async (job: (ticket: number) => Promise<void>, failure: typeof notice) => {
    if (submitting.current) return;
    const ticket = ++action.current;
    submitting.current = true;
    setBusy(true); setNotice(null);
    try { await job(ticket); }
    catch { if (ticket === action.current) setNotice(failure); }
    finally {
      if (ticket === action.current) {
        submitting.current = false; setBusy(false); setRefresh(value => value + 1);
      }
    }
  };

  const preview = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!mayEdit || submitting.current) return;
    try {
      const request = sellerHubBinPricePreviewSchema.parse({ schemaVersion: 1, connectionId: connection, items: parseRows(text) });
      void run(async ticket => {
        const draft = await port.preview(request);
        if (ticket !== action.current) return;
        setSelected(draft.planId); setEdited(false); setReview(draft);
      }, "preview_failed");
    } catch {
      setInvalid(true);
      document.getElementById(`${id}-rows`)?.focus();
    }
  };

  const approve = (approved: SellerHubBinPricePlan) => {
    if (!mayApprove || edited) return;
    void run(async ticket => {
      await port.approve({ schemaVersion: 1, planId: approved.planId, planHash: approved.planHash });
      if (ticket === action.current) changed.current();
    }, "approve_unknown");
  };

  const noticeText = notice === "read_failed" ? copy.sellerHubBinLoadFailed
    : notice === "preview_failed" ? copy.sellerHubBinPreviewFailed
      : notice === "approve_unknown" ? copy.sellerHubBinApproveUnknown : null;

  return <Panel><div className="marketplace-batch">
    <h2 id={`${id}-title`}>{copy.sellerHubBinTitle}</h2>
    <p role="status">{noticeText ?? (plan ? planText(copy, plan.state) : null)}</p>
    {status && !mayEdit && !readOnly && <p>{copy.sellerHubBinUnavailable}</p>}
    {mayEdit && connections.length === 0 && <p>{copy.sellerHubBinConnectFirst}</p>}
    {mayEdit && connections.length > 0 && <form className="marketplace-batch-form" aria-labelledby={`${id}-title`} onSubmit={preview}>
      <label htmlFor={`${id}-connection`}>{copy.sellerHubBinConnection}</label>
      <select id={`${id}-connection`} name="connection" value={connection} required disabled={busy}
        onChange={event => { setConnection(event.target.value); edit(); }}>
        <option value="">{copy.sellerHubBinSelectConnection}</option>
        {connections.map(row => <option value={row.connectionId} key={row.connectionId}>{copy.sellerHubBinConnection} · {row.connectionId.slice(-8)}</option>)}
      </select>
      <label htmlFor={`${id}-rows`}>{copy.sellerHubBinRows}</label>
      <p id={`${id}-hint`}>{copy.sellerHubBinRowsHint}</p>
      <textarea id={`${id}-rows`} name="targets" value={text} required disabled={busy} autoCorrect="off"
        autoCapitalize="none" spellCheck={false} maxLength={140_000} aria-invalid={invalid || undefined}
        aria-describedby={`${id}-hint${invalid ? ` ${id}-invalid` : ""}`}
        onChange={event => { setText(event.target.value); edit(); }} />
      {invalid && <p id={`${id}-invalid`} role="alert">{copy.sellerHubBinInvalid}</p>}
      <Button type="submit" disabled={busy}>{copy.sellerHubBinPreview}</Button>
    </form>}
    {status && status.recent.length > 0 && <div className="marketplace-batch-form">
      <label htmlFor={`${id}-recent`}>{copy.sellerHubBinRecent}</label>
      <select id={`${id}-recent`} value={plan && status.recent.some(row => row.planId === plan.planId) ? plan.planId : ""}
        onChange={event => { setSelected(event.target.value || null); setEdited(false); setReview(null); }} disabled={busy}>
        <option value="">{copy.sellerHubBinRecent}</option>
        {status.recent.map(row => <option key={row.planId} value={row.planId}>
          {row.connectionLabel} · {formatDate(locale, new Date(row.createdAt), { dateStyle: "short", timeStyle: "short" })} · {planText(copy, row.state)}
        </option>)}
      </select>
    </div>}
    {plan && <PriceChanges locale={locale} plan={plan} />}
    {plan?.state === "awaiting_approval" && mayApprove && !edited
      && <Button type="button" disabled={busy} onClick={() => setReview(plan)}>{copy.sellerHubBinReview}</Button>}
    <dialog ref={dialog} className="marketplace-batch-dialog" aria-labelledby={`${id}-confirm`}
      onClose={event => {
        const choice = event.currentTarget.returnValue;
        event.currentTarget.returnValue = "";
        setReview(null);
        if (choice === "approve" && review && reviewCanApprove) approve(review);
      }}>
      <h3 id={`${id}-confirm`}>{copy.sellerHubBinReview}</h3>
      {review && <PriceChanges locale={locale} plan={review} />}
      <form method="dialog" className="marketplace-batch-actions">
        <Button type="submit" value="cancel" autoFocus>{copy.sellerHubBinCancel}</Button>
        <Button type="submit" value="approve" disabled={!mayApprove || busy || edited || !reviewCanApprove}>{copy.sellerHubBinApprove}</Button>
      </form>
    </dialog>
  </div></Panel>;
}
