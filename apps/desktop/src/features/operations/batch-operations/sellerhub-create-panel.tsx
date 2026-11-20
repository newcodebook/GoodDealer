import { sellerHubCreateRequestSchema, type SellerHubCreatePort, type SellerHubCreateStatus, type SellerHubPort } from "@gooddealer/client-core";
import { getPresentationCopy, type Locale } from "@gooddealer/i18n";
import { Button, Panel } from "@gooddealer/ui";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { formatCents, parseRows } from "./sellerhub-price-input";
import "./marketplace-batch.css";

export function SellerHubCreatePanel({ locale, port, connectionsPort, readOnly, onChanged }: {
  readonly locale: Locale;
  readonly port: SellerHubCreatePort;
  readonly connectionsPort: SellerHubPort;
  readonly readOnly: boolean;
  readonly onChanged: () => void;
}) {
  const copy = getPresentationCopy(locale, "batchOperation");
  const id = useId();
  const rows = useRef<HTMLTextAreaElement>(null);
  const review = useRef<HTMLHeadingElement>(null);
  const changed = useRef(onChanged);
  changed.current = onChanged;
  const submitting = useRef(false);
  const scope = useRef(0);
  const boundary = useRef({ port, connectionsPort, readOnly });
  if (boundary.current.port !== port || boundary.current.connectionsPort !== connectionsPort || boundary.current.readOnly !== readOnly) {
    scope.current += 1;
    boundary.current = { port, connectionsPort, readOnly };
  }
  const [status, setStatus] = useState<SellerHubCreateStatus | null>(null);
  const [connections, setConnections] = useState<readonly string[]>([]);
  const [connection, setConnection] = useState("");
  const [text, setText] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [autoSelect, setAutoSelect] = useState(true);
  const [edited, setEdited] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [notice, setNotice] = useState<"read" | "preview" | "approve" | null>(null);

  useEffect(() => {
    setBusy(false);
    setStatus(null);
    setConnections([]);
    setSelected(null);
    setAutoSelect(true);
    setEdited(false);
    submitting.current = false;
    return () => { scope.current += 1; };
  }, [port, connectionsPort, readOnly]);

  const projection = useRef<string | null>(null);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      try {
        const [view, inventory] = await Promise.all([
          port.status({ schemaVersion: 1, planId: selected }), connectionsPort.status(),
        ]);
        if (!active) return;
        setStatus(view);
        setConnections(inventory.connections.filter(row => row.state === "active").map(row => row.connectionId));
        setNotice(previous => previous === "read" ? null : previous);
        if (autoSelect && view.recent[0]) {
          setAutoSelect(false);
          setSelected(view.recent[0].planId);
        }
        const current = JSON.stringify(view.plan?.items ?? []);
        if (projection.current !== null && projection.current !== current) changed.current();
        projection.current = current;
      } catch {
        if (!active) return;
        setStatus(null);
        setConnections([]);
        setNotice("read");
      }
      if (active) timer = setTimeout(() => { void read(); }, 2500);
    };
    void read();
    return () => { active = false; clearTimeout(timer); };
  }, [port, connectionsPort, selected, autoSelect, refresh]);

  const plan = status?.plan?.preview.planId === selected ? status?.plan ?? null : null;
  const mayPreview = !readOnly && status?.writeQualified === true && status.writeEntitled;
  const mayApprove = mayPreview && status?.executionAvailable === true && !edited && plan?.phase === "awaiting_approval";
  const focusPreview = useRef(false);
  useEffect(() => {
    if (plan && focusPreview.current) {
      focusPreview.current = false;
      review.current?.focus();
    }
  }, [plan]);

  const run = async (action: (ticket: number) => Promise<void>, failure: "preview" | "approve") => {
    if (submitting.current) return;
    const ticket = ++scope.current;
    submitting.current = true;
    setBusy(true);
    setNotice(null);
    try { await action(ticket); }
    catch { if (ticket === scope.current) setNotice(failure); }
    finally {
      if (ticket === scope.current) {
        submitting.current = false;
        setBusy(false);
        setRefresh(version => version + 1);
      }
    }
  };

  const preview = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!mayPreview || submitting.current) return;
    try {
      const input = sellerHubCreateRequestSchema.parse({
        schemaVersion: 1, connectionId: connection, items: parseRows(text),
      });
      setInvalid(false);
      void run(async ticket => {
        const saved = await port.preview(input);
        if (ticket !== scope.current) return;
        setAutoSelect(false);
        setEdited(false);
        focusPreview.current = true;
        setSelected(saved.planId);
      }, "preview");
    } catch {
      setInvalid(true);
      rows.current?.focus();
    }
  };

  const phaseText = {
    awaiting_approval: copy.sellerHubBinAwaiting,
    expired: copy.sellerHubBinExpired,
    executing: copy.sellerHubCreateExecuting,
    completed: copy.sellerHubCreateCompleted,
  };
  const itemText = {
    planned: copy.sellerHubBinAwaiting,
    queued: copy.sellerHubBinQueued,
    reconciling: copy.sellerHubCreateReconciling,
    ownership_pending: copy.sellerHubCreateOwnershipPending,
    unconfirmed: copy.sellerHubCreateUnconfirmed,
    published: copy.sellerHubCreatePublished,
    not_sent: copy.sellerHubBinRefused,
  };
  const message = notice === "read" ? copy.sellerHubCreateLoadFailed
    : notice === "preview" ? copy.sellerHubCreatePreviewFailed
      : notice === "approve" ? copy.sellerHubBinApproveUnknown
        : plan ? phaseText[plan.phase] : null;
  return <Panel><div className="marketplace-batch">
    <h2 id={`${id}-title`}>{copy.sellerHubCreateTitle}</h2>
    <p role="status">{message}</p>
    {status && !mayPreview && !readOnly && <p>{copy.sellerHubCreateUnavailable}</p>}
    {mayPreview && connections.length === 0 && <p>{copy.sellerHubCreateConnectFirst}</p>}
    {mayPreview && connections.length > 0 && <form method="post" className="marketplace-batch-form" aria-labelledby={`${id}-title`} onSubmit={preview}>
      <label htmlFor={`${id}-connection`}>{copy.sellerHubBinConnection}</label>
      <select id={`${id}-connection`} name="connection" value={connection} required disabled={busy}
        onChange={event => { setConnection(event.target.value); setEdited(true); }}>
        <option value="">{copy.sellerHubBinSelectConnection}</option>
        {connections.map(key => <option key={key} value={key}>{copy.sellerHubBinConnection} · {key.slice(-8)}</option>)}
      </select>
      <label htmlFor={`${id}-rows`}>{copy.sellerHubCreateRows}</label>
      <p id={`${id}-hint`}>{copy.sellerHubBinRowsHint}</p>
      <textarea ref={rows} id={`${id}-rows`} name="targets" required disabled={busy} value={text} maxLength={140_000}
        autoCorrect="off" autoCapitalize="none" spellCheck={false} aria-invalid={invalid}
        aria-describedby={`${id}-hint${invalid ? ` ${id}-input-error` : ""}`}
        onChange={event => { setText(event.target.value); setEdited(true); setInvalid(false); }} />
      {invalid && <p id={`${id}-input-error`}>{copy.sellerHubBinInvalid}</p>}
      <Button type="submit" disabled={busy}>{copy.sellerHubCreatePreview}</Button>
    </form>}
    {status && status.recent.length > 0 && <div className="marketplace-batch-form">
      <label htmlFor={`${id}-history`}>{copy.sellerHubCreateRecent}</label>
      <select id={`${id}-history`} value={selected ?? ""} disabled={busy} onChange={event => {
        setAutoSelect(false); setSelected(event.target.value || null); setEdited(false); setNotice(null);
      }}>
        <option value="">{copy.sellerHubCreateRecent}</option>
        {status.recent.map(row => <option key={row.planId} value={row.planId}>
          {phaseText[row.phase]} · {row.count} · {row.planId.slice(-8)}
        </option>)}
      </select>
    </div>}
    {plan && <>
      <h3 ref={review} tabIndex={-1}>{copy.sellerHubCreateReview}</h3>
      <p>{copy.sellerHubCreateTerms}</p>
      <div className="marketplace-batch-table"><table>
        <caption>{copy.sellerHubBinConnection} · {plan.preview.connectionId.slice(-8)}</caption>
        <thead><tr><th scope="col">{copy.sellerHubBinDomain}</th><th scope="col">{copy.sellerHubCreateRows}</th>
          <th scope="col">{copy.sellerHubBinResult}</th></tr></thead>
        <tbody>{plan.preview.items.map((item, index) => <tr key={item.domain}>
          <th scope="row">{item.domain}</th><td>{formatCents(locale,item.priceCents)}</td><td>{itemText[plan.items[index]!.state]}</td>
        </tr>)}</tbody>
      </table></div>
      {mayApprove && <Button type="button" disabled={busy} onClick={() => {
        void run(async ticket => {
          await port.approve({ schemaVersion: 1, planId: plan.preview.planId, planHash: plan.preview.planHash });
          if (ticket === scope.current) changed.current();
        }, "approve");
      }}>{copy.sellerHubCreateApprove}</Button>}
    </>}
  </div></Panel>;
}
