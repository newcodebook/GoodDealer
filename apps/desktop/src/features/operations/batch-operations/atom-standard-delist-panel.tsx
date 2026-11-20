import {
  atomStandardDelistPreviewRequestSchema, canonicalizeDomainName, type AtomMarketplacePort,
  type AtomStandardDelistPort, type AtomStandardDelistPreview, type AtomStandardDelistStatus,
} from "@gooddealer/client-core";
import { formatDate, getPresentationCopy, type Locale } from "@gooddealer/i18n";
import { Button, Panel } from "@gooddealer/ui";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import "./marketplace-batch.css";

type Review = Pick<AtomStandardDelistPreview, "planId" | "planHash" | "connectionId" | "domains">;
type Connections = Awaited<ReturnType<AtomMarketplacePort["status"]>>["connections"];
type Notice = "load" | "preview" | "approve" | null;

export function AtomStandardDelistPanel({ locale, port, connectionsPort, readOnly }: {
  readonly locale: Locale;
  readonly port: AtomStandardDelistPort;
  readonly connectionsPort: AtomMarketplacePort;
  readonly readOnly: boolean;
}) {
  const copy = getPresentationCopy(locale, "batchOperation");
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [status, setStatus] = useState<AtomStandardDelistStatus | null>(null);
  const [connections, setConnections] = useState<Connections>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [connectionId, setConnectionId] = useState("");
  const [text, setText] = useState("");
  const [review, setReview] = useState<Review | null>(null);
  const [busy, setBusy] = useState(false);
  const [edited, setEdited] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [refresh, setRefresh] = useState(0);
  const inFlight = useRef(false);
  const actionEpoch = useRef(0);
  const available = !readOnly && status?.executionAvailable === true;
  const plan = selected === null || selected === status?.plan?.planId ? status?.plan : null;

  useEffect(() => {
    setReview(null);
    setBusy(false);
    inFlight.current = false;
    return () => { actionEpoch.current += 1; };
  }, [port, connectionsPort, readOnly]);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const update = async () => {
      try {
        const [next, marketplace] = await Promise.all([
          port.status({ schemaVersion: 1, planId: selected }), connectionsPort.status(),
        ]);
        if (!active) return;
        setStatus(next);
        setConnections(marketplace.connections.filter(entry =>
          entry.state === "active" && (entry.lastScan?.standardReview?.observed ?? 0) > 0));
        setNotice(previous => previous === "load" ? null : previous);
      } catch {
        if (active) {
          setStatus(null);
          setNotice(previous => previous ?? "load");
        }
      } finally {
        if (active) timer = setTimeout(() => { void update(); }, 2500);
      }
    };
    void update();
    return () => { active = false; clearTimeout(timer); };
  }, [port, connectionsPort, selected, refresh]);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (review && !element.open) element.showModal();
    if (!review && element.open) element.close();
  }, [review]);

  async function run(action: (ticket: number) => Promise<void>, failure: Notice) {
    if (inFlight.current) return;
    inFlight.current = true;
    const ticket = ++actionEpoch.current;
    setBusy(true);
    setNotice(null);
    try {
      await action(ticket);
    } catch {
      if (ticket === actionEpoch.current) setNotice(failure);
    } finally {
      if (ticket === actionEpoch.current) {
        inFlight.current = false;
        setBusy(false);
        setRefresh(value => value + 1);
      }
    }
  }

  function preview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!available) return;
    void run(async ticket => {
      const domains = text.split(/\r?\n/u).map(line => line.trim()).filter(Boolean)
        .map(domain => canonicalizeDomainName(domain));
      const request = atomStandardDelistPreviewRequestSchema.parse({ schemaVersion: 1, connectionId, domains });
      const result = await port.preview(request);
      if (ticket === actionEpoch.current) {
        setSelected(result.planId);
        setEdited(false);
        setReview(result);
      }
    }, "preview");
  }

  const error = notice === "load" ? copy.atomDelistLoadFailed
    : notice === "preview" ? copy.atomDelistPreviewFailed
    : notice === "approve" ? copy.atomDelistApproveUnknown : null;
  const mayReview = available && !edited && !busy;
  const mayConfirm = mayReview && review != null
    && (plan?.planId !== review.planId || plan.state === "awaiting_approval");
  const itemText = {
    awaiting_approval: copy.sellerHubBinAwaiting, expired: copy.sellerHubBinExpired,
    queued: copy.sellerHubBinQueued, outcome_unknown: copy.atomDelistUnknown, failed_final: copy.atomDelistRefused,
  };

  return <Panel><div className="marketplace-batch">
    <h2 id={`${id}-title`}>{copy.atomDelistTitle}</h2>
    <p role="status">{error ?? (status && !available && !readOnly ? copy.atomDelistUnavailable : null)}</p>
    {available && connections.length === 0 && <p>{copy.atomDelistConnectFirst}</p>}
    {!readOnly && connections.length > 0 && <form className="marketplace-batch-form" aria-labelledby={`${id}-title`} onSubmit={preview}>
      <label htmlFor={`${id}-connection`}>{copy.atomDelistConnection}</label>
      <select required id={`${id}-connection`} value={connectionId} disabled={busy || !available}
        onChange={event => { setConnectionId(event.target.value); setEdited(true); }}>
        <option value="">{copy.atomDelistSelectConnection}</option>
        {connections.map(row => <option key={row.connectionId} value={row.connectionId}>
          Atom · {row.connectionId.slice(0, 8)} · {row.lastScan?.standardReview?.observed} Standard
        </option>)}
      </select>
      <label htmlFor={`${id}-domains`}>{copy.atomDelistDomains}</label>
      <p id={`${id}-hint`}>{copy.atomDelistDomainsHint}</p>
      <textarea id={`${id}-domains`} aria-describedby={`${id}-hint`} aria-invalid={notice === "preview"}
        value={text} required maxLength={127_000} disabled={busy || !available} spellCheck={false}
        onChange={event => { setText(event.target.value); setEdited(true); setNotice(null); }} />
      <Button type="submit" disabled={busy || !available}>{copy.atomDelistPreview}</Button>
    </form>}
    {status && status.recent.length > 0 && <div className="marketplace-batch-form">
      <label htmlFor={`${id}-recent`}>{copy.atomDelistRecent}</label>
      <select id={`${id}-recent`} value={selected ?? plan?.planId ?? ""} disabled={busy}
        onChange={event => { setSelected(event.target.value || null); setEdited(false); setNotice(null); }}>
        <option value="">{copy.atomDelistRecent}</option>
        {status.recent.map(row => <option key={row.planId} value={row.planId}>
          {row.connectionLabel} · {formatDate(locale, new Date(row.createdAt), { dateStyle: "short", timeStyle: "short" })} · {row.planId.slice(0, 8)}
        </option>)}
      </select>
    </div>}
    {plan && <div className="marketplace-batch-table"><table aria-labelledby={`${id}-title`}>
      <thead><tr><th scope="col">{copy.sellerHubBinDomain}</th><th scope="col">{copy.sellerHubBinResult}</th></tr></thead>
      <tbody>{plan.items.map(item => <tr key={item.domain}>
        <th scope="row">{item.domain}</th>
        <td>{itemText[item.state]}{item.reason === "postcondition_pending" && <p>{copy.atomDelistPresent}</p>}
          {item.reason === "read_failed" && <p>{item.state === "queued" ? copy.atomDelistQueuedRead : copy.atomDelistReadFailed}</p>}</td>
      </tr>)}</tbody>
    </table></div>}
    {plan?.state === "awaiting_approval" && mayReview && <Button type="button" onClick={() => setReview({
      ...plan, domains: plan.items.map(item => item.domain),
    })}>{copy.atomDelistReview}</Button>}
    <dialog ref={dialog} className="marketplace-batch-dialog" aria-labelledby={`${id}-confirm`} onClose={event => {
      const choice = event.currentTarget.returnValue;
      event.currentTarget.returnValue = "";
      setReview(null);
      if (choice === "approve" && review && mayConfirm) {
        void run(async () => {
          await port.approve({ schemaVersion: 1, planId: review.planId, planHash: review.planHash });
        }, "approve");
      }
    }}>
      <h3 id={`${id}-confirm`}>{copy.atomDelistReview}</h3>
      {review && <><p>{copy.atomDelistConnection} · {review.connectionId.slice(0, 8)}</p>
        <ul>{review.domains.map(domain => <li key={domain}>{domain}</li>)}</ul></>}
      <form method="dialog" className="marketplace-batch-actions">
        <Button type="submit" value="cancel" autoFocus>{copy.sellerHubBinCancel}</Button>
        <Button type="submit" value="approve" disabled={!mayConfirm}>{copy.atomDelistApprove}</Button>
      </form>
    </dialog>
  </div></Panel>;
}
