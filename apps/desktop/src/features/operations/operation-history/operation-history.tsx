import type { OperationHistoryEntry, OperationHistoryViewModel } from "@gooddealer/client-core";
import { formatDate, formatNumber, getPresentationCopy, type Locale } from "@gooddealer/i18n";
import {
  AlertTriangleIcon,
  Badge,
  Button,
  Checkbox,
  Dialog,
  DiffValue,
  FileTextIcon,
  HistoryIcon,
  Input,
  MetricStrip,
  SearchIcon,
  Select,
  Table,
  Toolbar,
  type TableColumn,
} from "@gooddealer/ui";
import { shellTableLabels } from "../../../app-shell";
import { useState } from "react";

import "./operation-history.css";

type ScopeFilter = "all" | OperationHistoryEntry["scope"];

export interface OperationHistoryProps {
  readonly locale: Locale;
  readonly view: OperationHistoryViewModel;
  readonly onSelect?: (revisionId: string) => void;
  /** Plans a reversal: a new forward Revision; the ledger itself is never edited. */
  readonly onPlanReversal?: (entry: OperationHistoryEntry, nameserverRiskAcknowledged: boolean) => void;
  readonly onExport?: (entry: OperationHistoryEntry) => void;
}

function fill(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{(\w+)\}/gu, (match, key: string) => values[key] ?? match);
}

/** Operation history: the append-only Revision ledger beside a field-level detail pane. */
export function OperationHistory({ locale, view, onSelect, onPlanReversal, onExport }: OperationHistoryProps) {
  const copy = getPresentationCopy(locale, "operationHistory");
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<ScopeFilter>("all");
  const [reversal, setReversal] = useState<OperationHistoryEntry | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const readOnly = view.source === "standby_cloud" || view.commandAdmission !== "proven";
  const needle = query.trim();
  const rows = view.entries.filter((entry) =>
    (scope === "all" || entry.scope === scope)
    && (needle === "" || entry.actionLabel.includes(needle) || entry.revisionLabel.includes(needle) || entry.platformLabel.includes(needle)));
  const selected = view.entries.find((entry) => entry.revisionId === view.selectedRevisionId) ?? rows[0] ?? null;
  const rolledBack = view.entries.filter((entry) => entry.state === "rolled_back").length;
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const when = (value: string) => formatDate(locale, Date.parse(value), { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, timeZone });

  const stateBadge = (entry: OperationHistoryEntry) => {
    switch (entry.state) {
      case "applied": return <Badge mono={false}>{copy.local}</Badge>;
      case "synced": return <Badge tone="success" mono={false}>{copy.synced}</Badge>;
      case "rolled_back": return <Badge tone="warning" mono={false}>{copy.rolledBack}</Badge>;
      case "cloud_pull": return <Badge tone="sync" mono={false}>{copy.cloudPull}</Badge>;
      case "device_event": return <Badge tone="gold" mono={false}>{copy.device}</Badge>;
      case "late_execution": return <Badge tone="danger" mono={false}>{copy.lateExecution}</Badge>;
    }
  };
  const scopes: readonly { readonly value: ScopeFilter; readonly label: string }[] = [
    { value: "all", label: copy.allTypes },
    { value: "batch", label: copy.batch },
    { value: "single_domain", label: copy.singleDomain },
    { value: "sync", label: copy.sync },
    { value: "system", label: copy.system },
  ];

  const columns: TableColumn<OperationHistoryEntry>[] = [
    { key: "revisionLabel", label: copy.revision, width: 96, render: (entry) => <span className={`history-mono${entry.revisionId === selected?.revisionId ? " history-selected" : ""}`}>rev {entry.revisionLabel}</span> },
    {
      key: "actionLabel",
      label: copy.action,
      render: (entry) => <span className="history-action">{entry.actionLabel}{entry.risk === "nameserver_high" ? <AlertTriangleIcon size={12} className="history-danger" /> : null}</span>,
    },
    { key: "platformLabel", label: copy.platform, muted: true, priority: "secondary" },
    { key: "actorLabel", label: copy.source, muted: true, width: 104, priority: "supplementary" },
    { key: "itemCount", label: copy.items, numeric: true, width: 64, render: (entry) => <span className="history-mono">{formatNumber(locale, entry.itemCount)}</span> },
    { key: "state", label: copy.status, width: 96, render: stateBadge },
    { key: "occurredAt", label: copy.time, numeric: true, muted: true, width: 104, render: (entry) => when(entry.occurredAt) },
  ];

  return (
    <section className="history" aria-label={copy.title}>
      <MetricStrip
        label={copy.title}
        metrics={[
          { key: "total", label: copy.totalRevisions, value: formatNumber(locale, view.totalRevisions) },
          { key: "today", label: copy.changesToday, value: formatNumber(locale, view.changesToday) },
          { key: "pending", label: copy.pendingRevisions, value: formatNumber(locale, view.pendingRevisionCount), tone: view.pendingRevisionCount > 0 ? "blue" : "muted" },
          { key: "rolledBack", label: copy.rolledBack, value: formatNumber(locale, rolledBack), tone: rolledBack > 0 ? "warning" : "muted" },
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
              aria-label={copy.allTypes}
              options={scopes.map((item) => ({ value: item.value, label: item.label }))}
              value={scope}
              onChange={(event) => { const next = scopes.find((item) => item.value === event.currentTarget.value); if (next !== undefined) setScope(next.value); }}
            />
          </>
        )}
        right={<span className="gd-t-meta history-nowrap">{copy.ledgerNotice}</span>}
      />
      {readOnly ? <p className="history-readonly gd-t-meta">{copy.readOnlyNotice}</p> : null}
      <div className="history-body">
        <div className="history-ledger">
          <Table<OperationHistoryEntry>
            {...shellTableLabels(locale)}
            label={copy.title}
            density="regular"
            rowKey="revisionId"
            columns={columns}
            rows={rows}
            maxHeight="100%"
            emptyText={copy.noEntries}
            {...(onSelect === undefined ? {} : { onRowClick: (entry: OperationHistoryEntry) => onSelect(entry.revisionId) })}
          />
        </div>
        <aside className="history-detail" aria-label={copy.revision}>
          {selected === null ? <p className="history-detail-empty gd-t-meta">{copy.selectRevision}</p> : (
            <>
              <header className="history-detail-head">
                <div className="history-detail-title">
                  <span className="history-mono history-rev">rev {selected.revisionLabel}</span>
                  {stateBadge(selected)}
                  {selected.risk === "nameserver_high" ? <Badge tone="danger" mono={false}>{copy.highRisk}</Badge> : null}
                </div>
                <span className="gd-t-body">{selected.actionLabel}</span>
              </header>
              <dl className="history-meta">
                <dt>{copy.revision}</dt><dd className="history-mono">{selected.revisionLabel}</dd>
                <dt>{copy.time}</dt><dd>{when(selected.occurredAt)}</dd>
                <dt>{copy.source}</dt><dd>{selected.actorLabel}</dd>
                <dt>{copy.platform}</dt><dd>{selected.platformLabel}</dd>
                <dt>{copy.affectedItems}</dt><dd>{formatNumber(locale, selected.itemCount)} {copy.itemsUnit}</dd>
              </dl>
              <div className="history-diffs">
                {selected.lateExecution !== null ? (
                  <div className="history-late">
                    <span>{fill(copy.lateExecutionBody, { device: selected.lateExecution.sourceDeviceLabel, epoch: String(selected.lateExecution.leaseEpoch) })}</span>
                    <Badge mono={false}>{selected.lateExecution.evidenceLevel === "confirmed" ? copy.evidenceConfirmed : selected.lateExecution.evidenceLevel === "provider_observed" ? copy.evidenceObserved : copy.evidenceReported}</Badge>
                  </div>
                ) : null}
                {selected.diffs.length > 0 ? (
                  <>
                    <span className="gd-t-label">{fill(copy.fieldChangesSample, { shown: formatNumber(locale, selected.diffs.length), total: formatNumber(locale, selected.itemCount) })}</span>
                    {selected.diffs.map((diff, index) => (
                      <div key={`${diff.entityLabel}:${diff.fieldLabel}:${index}`} className="history-diff">
                        <span className="history-mono">{diff.entityLabel} <span className="history-faint">· {diff.fieldLabel}</span></span>
                        <DiffValue oldValue={diff.oldValue ?? "—"} newValue={diff.newValue ?? "—"} size={11} />
                      </div>
                    ))}
                  </>
                ) : (
                  <p className="gd-t-meta">{selected.state === "cloud_pull" ? copy.cloudPullNoLocalChanges : selected.state === "device_event" ? copy.deviceGateEvent : copy.noFieldChanges}</p>
                )}
              </div>
              <footer className="history-detail-actions">
                {onExport === undefined ? null : <Button size="sm" variant="ghost" icon={<FileTextIcon size={13} />} onClick={() => onExport(selected)}>{copy.export}</Button>}
                <span className="history-spacer" />
                {selected.availableActions.includes("plan_reversal") && onPlanReversal !== undefined ? (
                  <Button size="sm" variant={selected.risk === "nameserver_high" ? "danger" : "primary"} icon={<HistoryIcon size={13} />} onClick={() => { setAcknowledged(false); setReversal(selected); }}>
                    {copy.rollbackThis}
                  </Button>
                ) : <span className="gd-t-meta">{selected.state === "rolled_back" ? copy.rolledBack : copy.cannotRollback}</span>}
              </footer>
            </>
          )}
        </aside>
      </div>
      <Dialog
        open={reversal !== null}
        onClose={() => setReversal(null)}
        title={reversal === null ? copy.rollback : fill(copy.rollbackTitle, { rev: reversal.revisionLabel })}
        width={reversal?.risk === "nameserver_high" ? 528 : 460}
        danger={reversal?.risk === "nameserver_high"}
        footer={reversal === null ? null : (
          <>
            <Button onClick={() => setReversal(null)}>{copy.cancel}</Button>
            <Button
              variant={reversal.risk === "nameserver_high" ? "danger" : "primary"}
              disabled={reversal.risk === "nameserver_high" && !acknowledged}
              onClick={() => { onPlanReversal?.(reversal, reversal.risk === "nameserver_high" && acknowledged); setReversal(null); }}
            >
              {fill(copy.rollbackConfirm, { count: formatNumber(locale, reversal.itemCount) })}
            </Button>
          </>
        )}
      >
        {reversal === null ? null : (
          <div className="history-dialog">
            <span className="gd-t-body">{fill(copy.rollbackBody, { rev: `rev ${reversal.revisionLabel}`, action: reversal.actionLabel, count: formatNumber(locale, reversal.itemCount) })}</span>
            {reversal.risk === "nameserver_high" ? (
              <div className="history-risk">
                <div className="history-risk-head"><AlertTriangleIcon size={15} /><b>{copy.rollbackNsTitle}</b></div>
                <span>{copy.rollbackNsBody}</span>
                <div className="history-risk-ack">
                  <Checkbox checked={acknowledged} onChange={() => setAcknowledged((value) => !value)} label={fill(copy.rollbackAck, { count: formatNumber(locale, reversal.itemCount) })} />
                </div>
              </div>
            ) : null}
            <span className="gd-t-meta">{copy.rollbackNote}</span>
          </div>
        )}
      </Dialog>
    </section>
  );
}
