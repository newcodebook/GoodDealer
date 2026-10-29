import type { DnsVerificationRowViewModel, DnsVerificationViewModel } from "@gooddealer/client-core";
import { formatDate, formatNumber, getPresentationCopy, type Locale } from "@gooddealer/i18n";
import {
  AlertTriangleIcon,
  Badge,
  Button,
  Checkbox,
  Dialog,
  Input,
  MetricStrip,
  RefreshCwIcon,
  SearchIcon,
  Select,
  ShieldIcon,
  StatusDot,
  Table,
  Toolbar,
  type TableColumn,
} from "@gooddealer/ui";
import { useState } from "react";

import "./dns-verification.css";

type OwnershipFilter = "all" | "verified" | "pending" | "failed";
type DnsDialog = { readonly kind: "txt" | "nameserver" | "challenge"; readonly row: DnsVerificationRowViewModel } | null;

export interface DnsVerificationProps {
  readonly locale: Locale;
  readonly view: DnsVerificationViewModel;
  /** Rows whose ownership re-check is in flight. */
  readonly verifyingIds?: ReadonlySet<string>;
  readonly onReverify?: (rows: readonly DnsVerificationRowViewModel[]) => void;
  /** Requests an append-only TXT plan; the Host re-reads the RRset before anything is written. */
  readonly onRequestTxtPlan?: (row: DnsVerificationRowViewModel) => void;
  /** Requests a high-risk Nameserver plan after the acknowledgement gate. */
  readonly onRequestNameserverPlan?: (row: DnsVerificationRowViewModel, nameservers: readonly string[]) => void;
}

function isNameserverHost(value: string): boolean {
  const host = value.trim().toLowerCase().replace(/\.$/u, "");
  return host.split(".").length >= 2 && host.split(".").every((label) => /^(?!-)[a-z0-9-]{1,63}(?<!-)$/u.test(label));
}

/** DNS & verification: delegation, record health, and TXT ownership per domain, each fixed at its own platform. */
export function DnsVerification({ locale, view, verifyingIds = new Set(), onReverify, onRequestTxtPlan, onRequestNameserverPlan }: DnsVerificationProps) {
  const copy = getPresentationCopy(locale, "dnsVerification");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<OwnershipFilter>("all");
  const [dialog, setDialog] = useState<DnsDialog>(null);
  const [nameservers, setNameservers] = useState(["", ""]);
  const [acknowledged, setAcknowledged] = useState(false);
  const readOnly = view.readSource === "standby_cloud";
  const needle = query.trim().toLowerCase();
  const rows = view.rows.filter((row) =>
    (filter === "all" || row.ownershipStatus === filter)
    && (needle === "" || row.domain.includes(needle) || row.providerDisplayName.toLowerCase().includes(needle)));
  const pendingRows = view.rows.filter((row) => row.ownershipStatus === "pending" && row.availableActions.includes("reverify_ownership"));
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  // Today's checks show the time only; older ones keep the date so a stale check never looks fresh.
  const checkedAt = (value: string | null) => {
    if (value === null) return "—";
    const at = Date.parse(value);
    const sameDay = formatDate(locale, at, { dateStyle: "short", timeZone }) === formatDate(locale, Date.now(), { dateStyle: "short", timeZone });
    return formatDate(locale, at, sameDay
      ? { timeStyle: "short", hour12: false, timeZone }
      : { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, timeZone });
  };
  const openNameserver = (row: DnsVerificationRowViewModel) => { setNameservers(["", ""]); setAcknowledged(false); setDialog({ kind: "nameserver", row }); };

  const ownershipBadge = (row: DnsVerificationRowViewModel) => row.ownershipStatus === "verified"
    ? <Badge tone="gold" mono={false}>{copy.verified}</Badge>
    : row.ownershipStatus === "pending"
      ? <Badge tone="warning" mono={false}>{copy.pending}</Badge>
      : <Badge tone="danger" mono={false}>{copy.invalid}</Badge>;
  const recordBadge = (row: DnsVerificationRowViewModel) => row.recordHealth === "healthy"
    ? <Badge tone="success" mono={false}>{copy.normal}</Badge>
    : row.recordHealth === "warning"
      ? <Badge tone="warning" mono={false}>{copy.warning}</Badge>
      : <Badge tone="danger" mono={false}>{copy.missing}</Badge>;
  const statusCell = (row: DnsVerificationRowViewModel) => {
    const [kind, label] = row.propagationStatus === "current" ? ["success", copy.normal] as const
      : row.propagationStatus === "propagating" ? ["sync", copy.propagating] as const : ["warning", copy.warning] as const;
    return <StatusDot kind={kind} pulse={row.propagationStatus === "propagating"} label={label} />;
  };

  // One repair per row, in order of what blocks ownership: verification, delegation, then records.
  const actionCell = (row: DnsVerificationRowViewModel) => {
    if (verifyingIds.has(row.domainAssetId)) {
      return <span className="dns-verifying"><RefreshCwIcon size={12} className="dns-spin" />{copy.verifying}</span>;
    }
    const can = (action: DnsVerificationRowViewModel["availableActions"][number]) => !readOnly && row.availableActions.includes(action);
    if (row.ownershipStatus !== "verified" && can("reverify_ownership") && onReverify !== undefined) {
      return <Button size="sm" onClick={() => onReverify([row])}>{copy.reverify}</Button>;
    }
    if (row.delegationStatus !== "healthy" && can("plan_nameserver_change") && onRequestNameserverPlan !== undefined) {
      return <Button size="sm" onClick={() => openNameserver(row)}>{copy.changeNameserver}</Button>;
    }
    if (row.recordHealth !== "healthy" && can("plan_txt_append") && onRequestTxtPlan !== undefined) {
      return <Button size="sm" onClick={() => setDialog({ kind: "txt", row })}>{copy.addTxt}</Button>;
    }
    if (row.challenge !== null) {
      return <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: "challenge", row })}>{copy.viewTxt}</Button>;
    }
    return null;
  };

  const columns: TableColumn<DnsVerificationRowViewModel>[] = [
    { key: "domain", label: copy.domain, render: (row) => <span className="dns-mono dns-strong">{row.domain}</span> },
    { key: "ownershipStatus", label: copy.ownership, width: 96, render: ownershipBadge },
    {
      key: "delegatedNameservers",
      label: copy.nameserver,
      priority: "secondary",
      render: (row) => (
        <span className={`dns-mono${row.delegationStatus === "healthy" ? " dns-muted" : " dns-danger"}`}>
          {row.delegationStatus === "healthy" ? null : <AlertTriangleIcon size={12} />}
          {row.delegatedNameservers[0] ?? copy.unknownNameserver}
        </span>
      ),
    },
    { key: "recordHealth", label: copy.records, width: 84, render: recordBadge },
    { key: "providerDisplayName", label: copy.dnsProvider, muted: true, width: 112, priority: "supplementary" },
    { key: "propagationStatus", label: copy.status, width: 100, render: statusCell },
    { key: "lastCheckedAt", label: copy.lastChecked, numeric: true, muted: true, width: 92, render: (row) => checkedAt(row.lastCheckedAt) },
    { key: "action", label: "", width: 118, align: "right", render: actionCell },
  ];

  const filters: readonly { readonly value: OwnershipFilter; readonly label: string }[] = [
    { value: "all", label: copy.all },
    { value: "verified", label: copy.verified },
    { value: "pending", label: copy.pending },
    { value: "failed", label: copy.invalid },
  ];
  const nameserverValid = isNameserverHost(nameservers[0] ?? "") && ((nameservers[1] ?? "") === "" || isNameserverHost(nameservers[1] ?? ""));

  return (
    <section className="dns-verification" aria-label={copy.title}>
      <MetricStrip
        label={copy.title}
        metrics={[
          { key: "verified", label: copy.verifiedOwnership, value: formatNumber(locale, view.metrics.verified), tone: "gold" },
          { key: "pending", label: copy.pendingOrInvalid, value: formatNumber(locale, view.metrics.pendingOrFailed), tone: view.metrics.pendingOrFailed > 0 ? "warning" : "muted" },
          { key: "ns", label: copy.nameserverMismatch, value: formatNumber(locale, view.metrics.nameserverIssues), tone: view.metrics.nameserverIssues > 0 ? "danger" : "muted" },
          { key: "records", label: copy.recordsWarningOrMissing, value: formatNumber(locale, view.metrics.recordIssues), tone: view.metrics.recordIssues > 0 ? "warning" : "muted" },
          { key: "propagating", label: copy.propagating, value: formatNumber(locale, view.metrics.propagating), tone: "blue" },
        ]}
      />
      <Toolbar
        region
        label={copy.title}
        left={(
          <>
            <Input size="sm" prefix={<SearchIcon size={13} />} placeholder={copy.searchPlaceholder} aria-label={copy.searchPlaceholder} value={query} onChange={(event) => setQuery(event.currentTarget.value)} />
            <Select
              size="sm"
              aria-label={copy.ownership}
              options={filters.map((item) => ({ value: item.value, label: item.label }))}
              value={filter}
              onChange={(event) => { const next = filters.find((item) => item.value === event.currentTarget.value); if (next !== undefined) setFilter(next.value); }}
            />
          </>
        )}
        right={onReverify === undefined || readOnly ? null : (
          <Button size="sm" variant="primary" icon={<ShieldIcon size={14} />} disabled={pendingRows.length === 0} onClick={() => onReverify(pendingRows)}>
            {copy.reverifyPending}{pendingRows.length > 0 ? ` · ${pendingRows.length}` : ""}
          </Button>
        )}
      />
      <div className="dns-guide">
        <ShieldIcon size={13} />
        <span>{copy.guide}</span>
        <span className="dns-source">{readOnly ? copy.sourceStandby : copy.sourceActive} · {copy.revision} {formatNumber(locale, view.serverRevision)}</span>
      </div>
      {readOnly ? <p className="dns-readonly gd-t-meta">{copy.readOnlyNotice}</p> : null}
      <div className="dns-body">
        <Table<DnsVerificationRowViewModel>
          label={copy.title}
          density="regular"
          rowKey="domainAssetId"
          columns={columns}
          rows={rows}
          maxHeight="100%"
          emptyText={view.rows.length === 0 ? copy.noRows : copy.searchEmpty}
        />
      </div>
      <Dialog
        open={dialog?.kind === "challenge"}
        onClose={() => setDialog(null)}
        title={copy.ownershipTitle}
        width={460}
        footer={<Button variant="primary" onClick={() => setDialog(null)}>{copy.close}</Button>}
      >
        {dialog?.kind !== "challenge" || dialog.row.challenge === null ? null : (
          <div className="dns-dialog">
            <div className="dns-dialog-row">
              {dialog.row.ownershipStatus === "verified" ? <Badge tone="gold">OWNER VERIFIED</Badge> : ownershipBadge(dialog.row)}
              <span className="gd-t-body-2">{dialog.row.domain} · {copy.lastChecked} {checkedAt(dialog.row.lastCheckedAt)}</span>
            </div>
            <dl className="dns-challenge">
              <dt>{copy.type}</dt><dd className="dns-record-type">{dialog.row.challenge.recordType}</dd>
              <dt>{copy.host}</dt><dd>{dialog.row.challenge.host}</dd>
              <dt>{copy.redactedPreview}</dt><dd>{dialog.row.challenge.valuePreview}</dd>
              <dt>{copy.fingerprint}</dt><dd className="dns-fingerprint">{dialog.row.challenge.fingerprint}</dd>
            </dl>
            <span className="gd-t-meta">{copy.secureHostChallengeNotice}</span>
          </div>
        )}
      </Dialog>
      <Dialog
        open={dialog?.kind === "txt"}
        onClose={() => setDialog(null)}
        title={copy.txtAppendTitle}
        width={480}
        footer={(
          <>
            <Button onClick={() => setDialog(null)}>{copy.cancel}</Button>
            <Button variant="primary" onClick={() => { if (dialog?.kind === "txt") onRequestTxtPlan?.(dialog.row); setDialog(null); }}>{copy.requestTxtPlan}</Button>
          </>
        )}
      >
        {dialog?.kind !== "txt" ? null : (
          <div className="dns-dialog">
            <div className="dns-dialog-row"><span className="gd-t-label">{copy.processingPlatform}</span><span className="gd-t-body-2">{dialog.row.providerDisplayName}</span><Badge tone="sync" mono={false}>{copy.appendOnly}</Badge></div>
            <span className="gd-t-body">{dialog.row.domain} · TXT _atomverify</span>
            <ul className="dns-points">
              <li>{copy.existingValuesPreserved}</li>
              <li>{copy.freshRrsetRequired}</li>
              <li>{copy.secureHostChallengeNotice}</li>
            </ul>
          </div>
        )}
      </Dialog>
      <Dialog
        open={dialog?.kind === "nameserver"}
        onClose={() => setDialog(null)}
        title={dialog?.kind === "nameserver" ? `${copy.nameserverChangeTitle} · ${dialog.row.domain}` : copy.nameserverChangeTitle}
        width={520}
        danger
        footer={(
          <>
            <Button onClick={() => setDialog(null)}>{copy.cancel}</Button>
            <Button
              variant="danger"
              disabled={!acknowledged || !nameserverValid}
              onClick={() => {
                if (dialog?.kind === "nameserver") onRequestNameserverPlan?.(dialog.row, nameservers.map((value) => value.trim().toLowerCase()).filter((value) => value !== ""));
                setDialog(null);
              }}
            >
              {copy.requestHighRiskPlan}
            </Button>
          </>
        )}
      >
        {dialog?.kind !== "nameserver" ? null : (
          <div className="dns-dialog">
            <div className="dns-dialog-row"><span className="gd-t-label">{copy.processingPlatform}</span><span className="gd-t-body-2">{copy.registrarDelegation}</span></div>
            <div className="dns-dialog-row"><span className="gd-t-label">{copy.currentNameservers}</span><span className="dns-mono dns-muted">{dialog.row.delegatedNameservers.join(" · ") || copy.unknownNameserver}</span></div>
            <div className="dns-ns-inputs">
              {nameservers.map((value, index) => (
                <Input
                  key={index}
                  label={`${copy.targetNameservers} ${index + 1}`}
                  mono
                  placeholder={`ns${index + 1}.example.com`}
                  value={value}
                  onChange={(event) => { const next = event.currentTarget.value; setNameservers((current) => current.map((item, position) => position === index ? next : item)); }}
                />
              ))}
            </div>
            <div className="dns-risk">
              <div className="dns-risk-head"><AlertTriangleIcon size={15} /><b>{copy.highRiskNameserver}</b></div>
              <span>{copy.highRiskNameserverDescription}</span>
              <div className="dns-risk-ack"><Checkbox checked={acknowledged} onChange={() => setAcknowledged((current) => !current)} label={copy.acknowledgeNameserver} /></div>
            </div>
          </div>
        )}
      </Dialog>
    </section>
  );
}
