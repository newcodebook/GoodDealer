import type { BatchOperationViewModel } from "@gooddealer/client-core";
import { formatNumber, getPresentationCopy, type Locale } from "@gooddealer/i18n";
import {
  AlertTriangleIcon,
  Badge,
  Button,
  Checkbox,
  ChevronLeftIcon,
  ChevronRightIcon,
  DiffValue,
  Dialog,
  KpiStat,
  Panel,
  ProgressBar,
  Table,
  Tabs,
} from "@gooddealer/ui";
import { shellTableLabels } from "../../../app-shell";
import { useState } from "react";

import { batchDetailMode, type BatchExecutionProgress } from "./batch-operations-contract";
import { BatchPhaseBadge } from "./batch-phase-badge";
import "./batch-operations.css";

type BatchItem = BatchOperationViewModel["itemWindow"]["items"][number];
type ItemTab = "all" | "automatic" | "manual" | "excluded";

export interface BatchDetailProps {
  readonly locale: Locale;
  readonly batch: BatchOperationViewModel;
  /** Running and result totals; the Host projection does not carry them yet. */
  readonly progress?: BatchExecutionProgress;
  readonly onBack: () => void;
  /** Approval of every planned item; `highRiskAcknowledged` mirrors the acknowledgement gate. */
  readonly onApprove?: (highRiskAcknowledged: boolean) => void;
  /** Approval that skips the high-risk subset, offered only when one exists. */
  readonly onApproveStandardOnly?: () => void;
  readonly onExcludeItem?: (itemId: string, excluded: boolean) => void;
  readonly onRetryFailed?: () => void;
  readonly onCheckUnknown?: () => void;
  readonly onOpenManualTasks?: () => void;
  readonly onOpenHistory?: () => void;
}

function fill(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{(\w+)\}/gu, (match, key: string) => values[key] ?? match);
}

/** Batch detail: plan diff and approval ceremony, live execution, and the per-outcome result. */
export function BatchDetail({
  locale,
  batch,
  progress,
  onBack,
  onApprove,
  onApproveStandardOnly,
  onExcludeItem,
  onRetryFailed,
  onCheckUnknown,
  onOpenManualTasks,
  onOpenHistory,
}: BatchDetailProps) {
  const copy = getPresentationCopy(locale, "batchOperation");
  const [tab, setTab] = useState<ItemTab>("all");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const mode = batchDetailMode(batch.phase);
  const { summary } = batch;
  const number = (value: number) => formatNumber(locale, value);
  const items = batch.itemWindow.items;
  const excludedCount = items.filter((item) => item.result === "excluded").length;
  const highRiskItems = items.filter((item) => item.risk === "high" && item.result !== "excluded");
  const highRiskCount = summary.highRiskCount;
  const submitCount = Math.max(0, batch.itemWindow.totalItems - excludedCount - summary.conflictCount);
  const canApprove = batch.availableActions.includes("approve") && onApprove !== undefined;
  const closeConfirm = () => { setConfirmOpen(false); setAcknowledged(false); };

  const visibleItems = tab === "all" ? items
    : tab === "excluded" ? items.filter((item) => item.result === "excluded")
      : items.filter((item) => item.result !== "excluded" && item.executionMode === tab);

  const header = (
    <header className="batch-detail-head">
      <Button size="sm" variant="ghost" icon={<ChevronLeftIcon size={15} />} onClick={onBack}>{copy.title}</Button>
      <span className="batch-detail-title">{batch.title}</span>
      <span className="batch-faint">{fill(copy.targetSummary, { count: number(summary.targetDomainCount) })}</span>
      <span className="batch-detail-badges">
        {highRiskCount > 0 ? <Badge tone="danger" mono={false}>{copy.highRisk}</Badge> : null}
        <BatchPhaseBadge locale={locale} phase={batch.phase} />
      </span>
    </header>
  );

  const resultKpis = (counts: BatchExecutionProgress["counts"]) => (
    <div className="batch-kpis">
      <KpiStat label={copy.success} value={counts.succeeded} />
      <KpiStat label={copy.waitingConfirmation} value={counts.waitingRemote} meta={copy.remoteAccepted} />
      <KpiStat label={copy.retryable} value={counts.retryable} tone="danger" />
      <KpiStat label={copy.unknownResult} value={counts.outcomeUnknown} tone="warning" meta={copy.confirmOnly} />
      <KpiStat label={copy.manualHandling} value={counts.manual} />
      <KpiStat label={copy.finalFailure} value={counts.failedFinal} />
    </div>
  );

  const planBody = (
    <div className="batch-detail-plan">
      <Panel>
        <div className="batch-kpis">
          <KpiStat label={copy.targetDomains} value={summary.targetDomainCount} meta={fill(copy.platformSummary, { platforms: number(summary.platformCount), requests: number(summary.requestOrFileCount) })} />
          <KpiStat label={copy.automatic} value={summary.automaticCount} />
          <KpiStat label={copy.manual} value={summary.manualCount} tone="warning" />
          <KpiStat label={copy.highRisk} value={highRiskCount} tone="danger" meta={copy.nameserverChange} />
          <KpiStat label={copy.conflict} value={summary.conflictCount} tone="danger" meta={copy.remoteFieldChanged} />
          <KpiStat label={copy.estimatedDuration} value={summary.estimatedDurationLabel} />
        </div>
      </Panel>
      <Panel flush title={copy.groups}>
        <ul className="batch-groups">
          {batch.groups.map((group) => (
            <li key={group.id}>
              <span className="batch-group-platform">{group.platform}</span>
              <span className="batch-group-account">{group.account}</span>
              <span className="batch-group-action">{group.actionLabel}</span>
              <span className="batch-mono batch-group-count">{number(group.itemCount)}</span>
              <ChevronRightIcon size={13} className="batch-faint" />
            </li>
          ))}
        </ul>
      </Panel>
      <div className="batch-items">
        <Tabs
          active={tab}
          onChange={(key) => { if (key === "all" || key === "automatic" || key === "manual" || key === "excluded") setTab(key); }}
          items={[
            { key: "all", label: copy.allItems, count: items.length },
            { key: "automatic", label: copy.automatic, count: items.filter((item) => item.result !== "excluded" && item.executionMode === "automatic").length },
            { key: "manual", label: copy.manual, count: items.filter((item) => item.result !== "excluded" && item.executionMode === "manual").length },
            { key: "excluded", label: copy.excluded, count: excludedCount },
          ]}
        />
        <Table<BatchItem>
          {...shellTableLabels(locale)}
          density="compact"
          rowKey="id"
          rows={visibleItems}
          emptyText={copy.noItems}
          columns={[
            { key: "domain", label: copy.domain, render: (item) => <span className="batch-mono">{item.domain}</span> },
            { key: "fieldLabel", label: copy.field, muted: true, width: 110 },
            { key: "diff", label: copy.beforeAfter, render: (item) => <DiffValue oldValue={item.oldValue ?? "—"} newValue={item.newValue ?? "—"} /> },
            { key: "sourceLabel", label: copy.source, muted: true, priority: "supplementary" },
            {
              key: "risk",
              label: copy.risk,
              width: 90,
              render: (item) => item.risk === "high"
                ? <span className="batch-risk-high"><AlertTriangleIcon size={12} />{copy.highRisk}</span>
                : <span className="batch-faint">—</span>,
            },
            {
              key: "executionMode",
              label: copy.status,
              width: 86,
              render: (item) => item.result === "excluded"
                ? <Badge mono={false}>{copy.excluded}</Badge>
                : item.executionMode === "automatic"
                  ? <Badge tone="sync" mono={false}>{copy.automaticLabel}</Badge>
                  : <Badge tone="warning" mono={false}>{copy.manualLabel}</Badge>,
            },
            ...(canApprove && onExcludeItem !== undefined ? [{
              key: "toggle",
              label: "",
              width: 60,
              align: "right" as const,
              render: (item: BatchItem) => (
                <Button size="sm" variant="ghost" onClick={() => onExcludeItem(item.id, item.result !== "excluded")}>
                  {item.result === "excluded" ? copy.restore : copy.exclude}
                </Button>
              ),
            }] : []),
          ]}
          footer={<span className="gd-t-meta">{fill(copy.previewFooter, { shown: number(visibleItems.length), total: number(batch.itemWindow.totalItems) })}</span>}
        />
      </div>
      {canApprove ? (
        <div className="batch-commit-bar">
          <span>
            {copy.willSubmit} <b className="batch-mono batch-commit-count">{number(submitCount)}</b> {copy.itemsUnit}
            {highRiskCount > 0 ? <> · {copy.including} <b className="batch-mono batch-commit-risk">{number(highRiskCount)}</b> {copy.highRiskItems}</> : null}
            {" "}· {copy.conflict} {number(summary.conflictCount)} {copy.notSubmitted}
          </span>
          <span className="batch-commit-actions">
            <Button onClick={onBack}>{copy.cancel}</Button>
            <Button variant="primary" onClick={() => setConfirmOpen(true)}>{copy.confirmAndRun}</Button>
          </span>
        </div>
      ) : null}
    </div>
  );

  const runBody = (
    <Panel title={copy.executing} actions={<Badge tone="sync">RUNNING</Badge>}>
      <div className="batch-detail-stack">
        <ProgressBar segments={[{ value: progress?.percent ?? 0, tone: "sync" }]} height={8} label={copy.progress} />
        {progress === undefined ? null : resultKpis(progress.counts)}
        {progress?.throughputLabel === undefined || progress.throughputLabel === null ? null : <span className="gd-t-body-2">{progress.throughputLabel}</span>}
      </div>
    </Panel>
  );

  const counts = progress?.counts ?? { succeeded: 0, waitingRemote: 0, retryable: summary.retryableCount, outcomeUnknown: summary.outcomeUnknownCount, manual: summary.manualCount, failedFinal: 0 };
  const total = Math.max(1, batch.itemWindow.totalItems);
  const hasFailures = counts.retryable > 0 || counts.outcomeUnknown > 0;
  const resultBody = batch.phase === "rolled_back" || batch.phase === "cancelled" ? (
    <Panel title={batch.phase === "rolled_back" ? copy.rolledBackTitle : copy.cancelled} actions={<BatchPhaseBadge locale={locale} phase={batch.phase} />}>
      <div className="batch-detail-stack">
        <p className="batch-note">{batch.phase === "rolled_back" ? copy.rolledBackBody : copy.cancelledBody}</p>
        <div className="batch-actions">
          {onOpenHistory === undefined ? null : <Button size="sm" variant="primary" onClick={onOpenHistory}>{copy.viewInHistory}</Button>}
          <Button size="sm" variant="ghost" onClick={onBack}>{copy.backToBatches}</Button>
          {progress?.operationId === undefined || progress.operationId === null ? null : <span className="batch-audit">{progress.operationId}</span>}
        </div>
      </div>
    </Panel>
  ) : (
    <>
      <Panel title={copy.completedTitle} actions={<Badge tone={hasFailures ? "warning" : "success"} mono={false}>{hasFailures ? copy.partiallyFailed : copy.completed}</Badge>}>
        <div className="batch-detail-stack">
          <ProgressBar
            height={8}
            label={copy.result}
            segments={[
              { value: counts.succeeded / total * 100, tone: "success" },
              { value: counts.retryable / total * 100, tone: "danger" },
              { value: counts.manual / total * 100, tone: "warning" },
            ]}
          />
          {resultKpis(counts)}
          <div className="batch-actions">
            {batch.availableActions.includes("retry_failed") && onRetryFailed !== undefined
              ? <Button size="sm" variant="primary" onClick={onRetryFailed}>{copy.retryFailed} · {number(counts.retryable)}</Button> : null}
            {batch.availableActions.includes("check_unknown") && onCheckUnknown !== undefined
              ? <Button size="sm" onClick={onCheckUnknown}>{copy.checkUnknown} · {number(counts.outcomeUnknown)}</Button> : null}
            {counts.manual > 0 && onOpenManualTasks !== undefined
              ? <Button size="sm" variant="ghost" onClick={onOpenManualTasks}>{copy.openManualTasks} · {number(counts.manual)}</Button> : null}
            <Button size="sm" variant="ghost" onClick={onBack}>{copy.backToBatches}</Button>
            {progress?.operationId === undefined || progress.operationId === null ? null : <span className="batch-audit">{copy.auditRecorded} · {progress.operationId}</span>}
          </div>
        </div>
      </Panel>
      {counts.manual > 0 ? (
        <Panel title={copy.manualTaskCreated} actions={<Badge tone="warning" mono={false}>{number(counts.manual)} {copy.itemsUnit}</Badge>}>
          <p className="batch-note batch-note--muted">{copy.manualTaskBody}</p>
        </Panel>
      ) : null}
    </>
  );

  return (
    <section className="batch-detail" aria-label={copy.details}>
      {header}
      <div className="batch-detail-scroll">
        <div className={`batch-detail-content batch-detail-content--${mode}`}>
          {mode === "plan" ? planBody : mode === "run" ? runBody : resultBody}
        </div>
      </div>
      <Dialog
        open={confirmOpen}
        onClose={closeConfirm}
        title={copy.finalConfirmation}
        width={highRiskCount > 0 ? 544 : 480}
        danger={highRiskCount > 0}
        footer={highRiskCount > 0 ? (
          <>
            <Button onClick={closeConfirm}>{copy.backToEdit}</Button>
            {onApproveStandardOnly === undefined ? null : (
              <Button onClick={() => { closeConfirm(); onApproveStandardOnly(); }}>
                {copy.submitStandardOnly} · {number(Math.max(0, submitCount - highRiskCount))} {copy.itemsUnit}
              </Button>
            )}
            <Button variant="danger" disabled={!acknowledged} onClick={() => { closeConfirm(); onApprove?.(true); }}>
              {copy.submitAll} · {number(submitCount)} {copy.itemsUnit}
            </Button>
          </>
        ) : (
          <>
            <Button onClick={closeConfirm}>{copy.backToEdit}</Button>
            <Button variant="primary" onClick={() => { closeConfirm(); onApprove?.(false); }}>
              {fill(copy.submitCount, { count: number(submitCount) })}
            </Button>
          </>
        )}
      >
        <div className="batch-detail-stack">
          <span className="gd-t-body">
            {batch.groups.map((group) => `${group.platform} · ${group.actionLabel} ${number(group.itemCount)}`).join("；")}
          </span>
          {highRiskCount > 0 ? (
            <div className="batch-risk-box">
              <div className="batch-risk-box-head">
                <AlertTriangleIcon size={15} />
                <b>{fill(copy.highRiskTitle, { count: number(highRiskCount) })}</b>
                <span className="batch-risk-box-meta">{copy.rollbackAvailable}</span>
              </div>
              <span className="batch-risk-box-body">{copy.highRiskConsequence}</span>
              <div className="batch-risk-box-domains">
                {highRiskItems.map((item) => <span key={item.id}>{item.domain}</span>)}
              </div>
              <div className="batch-risk-box-ack">
                <Checkbox
                  checked={acknowledged}
                  onChange={() => setAcknowledged((value) => !value)}
                  label={fill(copy.highRiskAcknowledge, { count: number(highRiskCount) })}
                />
              </div>
            </div>
          ) : null}
          <span className="gd-t-body-2">{summary.estimatedDurationLabel} · {copy.pausable}</span>
          <span className="gd-t-meta">{copy.auditNote}</span>
        </div>
      </Dialog>
    </section>
  );
}
