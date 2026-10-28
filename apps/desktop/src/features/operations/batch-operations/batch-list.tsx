import { formatNumber, getPresentationCopy, type Locale } from "@gooddealer/i18n";
import {
  Badge,
  Button,
  ChevronRightIcon,
  Input,
  MetricStrip,
  ProgressBar,
  SearchIcon,
  Select,
  Table,
  Toolbar,
  type TableColumn,
} from "@gooddealer/ui";
import { useState } from "react";

import { batchDetailMode, batchPhaseTone, type BatchJobSummary, type BatchPhase } from "./batch-operations-contract";
import { BatchPhaseBadge, batchPhaseLabel } from "./batch-phase-badge";
import "./batch-operations.css";

export interface BatchListProps {
  readonly locale: Locale;
  readonly jobs: readonly BatchJobSummary[];
  readonly onOpen?: (id: string) => void;
  readonly onCreateFromLibrary?: () => void;
}

type PhaseFilter = "all" | "plan" | "running" | "completed" | "partially_failed" | "rolled_back";

function matchesFilter(phase: BatchPhase, filter: PhaseFilter): boolean {
  if (filter === "all") return true;
  if (filter === "plan") return batchDetailMode(phase) === "plan";
  if (filter === "running") return batchDetailMode(phase) === "run";
  return phase === filter;
}

/** Batch job list: phase ribbon, search and phase filter, and one row per orchestrated batch. */
export function BatchList({ locale, jobs, onOpen, onCreateFromLibrary }: BatchListProps) {
  const copy = getPresentationCopy(locale, "batchOperation");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<PhaseFilter>("all");
  const count = (predicate: (job: BatchJobSummary) => boolean) => jobs.filter(predicate).length;
  const running = count((job) => batchDetailMode(job.phase) === "run");
  const planned = count((job) => batchDetailMode(job.phase) === "plan");
  const completed = count((job) => job.phase === "completed");
  const partial = count((job) => job.phase === "partially_failed");
  const rolledBack = count((job) => job.phase === "rolled_back");
  const needle = query.trim();
  const rows = jobs.filter((job) => matchesFilter(job.phase, filter) && (needle === "" || job.title.includes(needle) || job.ruleLabel.includes(needle)));

  const filters: readonly { readonly value: PhaseFilter; readonly label: string }[] = [
    { value: "all", label: copy.allStatuses },
    { value: "plan", label: copy.planned },
    { value: "running", label: copy.running },
    { value: "completed", label: copy.completed },
    { value: "partially_failed", label: copy.partiallyFailed },
    { value: "rolled_back", label: copy.rolledBack },
  ];

  const columns: TableColumn<BatchJobSummary>[] = [
    {
      key: "title",
      label: copy.batch,
      priority: "essential",
      render: (job) => (
        <span className="batch-two-line">
          <span className="batch-two-line-primary">{job.title}</span>
          <span className="batch-two-line-secondary">{job.ruleLabel}</span>
        </span>
      ),
    },
    { key: "targetCount", label: copy.target, numeric: true, width: 76, render: (job) => <span className="batch-mono">{formatNumber(locale, job.targetCount)}</span> },
    {
      key: "platform",
      label: copy.platformAccount,
      priority: "secondary",
      render: (job) => (
        <span className="batch-two-line">
          <span>{job.platform}</span>
          <span className="batch-two-line-secondary">{job.account}</span>
        </span>
      ),
    },
    { key: "createdLabel", label: copy.created, width: 92, muted: true, priority: "supplementary" },
    { key: "phase", label: copy.status, width: 92, render: (job) => <BatchPhaseBadge locale={locale} phase={job.phase} /> },
    {
      key: "progress",
      label: copy.progress,
      width: 150,
      render: (job) => {
        const mode = batchDetailMode(job.phase);
        if (mode === "plan") return <span className="batch-pending">{copy.awaitingExecution}</span>;
        if (job.phase === "rolled_back" || job.phase === "cancelled") return <span className="batch-faint">{batchPhaseLabel(locale, job.phase)}</span>;
        const tone = batchPhaseTone(job.phase);
        return (
          <span className="batch-progress">
            <span className="batch-progress-bar"><ProgressBar segments={[{ value: job.progressPercent, tone: tone === "neutral" ? "sync" : tone }]} height={5} /></span>
            <span className={`batch-mono batch-progress-value${mode === "run" ? " batch-progress-value--live" : ""}`}>{job.progressPercent}%</span>
          </span>
        );
      },
    },
    {
      key: "result",
      label: copy.result,
      priority: "secondary",
      render: (job) => {
        if (job.plannedCounts !== null && batchDetailMode(job.phase) === "plan") {
          return <span className="batch-faint">{copy.automaticLabel} {job.plannedCounts.automatic} · {copy.manualLabel} {job.plannedCounts.manual} · {copy.conflict} {job.plannedCounts.conflict}</span>;
        }
        if (job.resultCounts === null) return <span className="batch-faint">—</span>;
        const chips = ([
          ["success", job.resultCounts.succeeded],
          ["warning", job.resultCounts.manual],
          ["danger", job.resultCounts.retryable + job.resultCounts.outcomeUnknown],
        ] as const).filter(([, value]) => value > 0);
        return (
          <span className="batch-result-chips">
            {chips.map(([tone, value]) => <span key={tone}><i className={`batch-dot batch-dot--${tone}`} />{formatNumber(locale, value)}</span>)}
          </span>
        );
      },
    },
    {
      key: "risk",
      label: copy.risk,
      width: 72,
      render: (job) => job.highRisk ? <Badge tone="danger" mono={false}>{copy.highRisk}</Badge> : <span className="batch-faint">—</span>,
    },
    { key: "open", label: "", width: 40, align: "right", render: () => <ChevronRightIcon size={14} className="batch-faint" /> },
  ];

  return (
    <section className="batch-list" aria-label={copy.title}>
      <MetricStrip
        label={copy.title}
        metrics={[
          { key: "running", label: copy.running, value: running, tone: running > 0 ? "blue" : "muted", ...(running > 0 ? { meta: copy.liveProgress } : {}) },
          { key: "planned", label: copy.awaitingConfirmation, value: planned, tone: planned > 0 ? "warning" : "muted", ...(planned > 0 ? { meta: copy.awaitingExecution } : {}) },
          { key: "completed", label: copy.completedToday, value: completed, tone: completed > 0 ? "success" : "muted" },
          { key: "partial", label: copy.partiallyFailed, value: partial, tone: partial > 0 ? "danger" : "muted", ...(partial > 0 ? { meta: copy.failuresPending } : {}) },
          { key: "rolledBack", label: copy.rolledBack, value: rolledBack, tone: "muted" },
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
              aria-label={copy.status}
              options={filters.map((item) => ({ value: item.value, label: item.label }))}
              value={filter}
              onChange={(event) => {
                const next = filters.find((item) => item.value === event.currentTarget.value);
                if (next !== undefined) setFilter(next.value);
              }}
            />
          </>
        )}
        right={onCreateFromLibrary === undefined ? null : <Button size="sm" variant="primary" onClick={onCreateFromLibrary}>{copy.createFromLibrary}</Button>}
      />
      <div className="batch-list-body">
        <Table<BatchJobSummary>
          label={copy.title}
          density="regular"
          rowKey="id"
          columns={columns}
          rows={rows}
          maxHeight="100%"
          emptyText={copy.empty}
          {...(onOpen === undefined ? {} : { onRowClick: (job: BatchJobSummary) => onOpen(job.id) })}
          footer={<span className="gd-t-meta">{copy.listFooter.replace("{count}", formatNumber(locale, rows.length))}</span>}
        />
      </div>
    </section>
  );
}
