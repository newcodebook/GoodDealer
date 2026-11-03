import type { ConflictCenterViewModel, ConflictResolutionChoice } from "@gooddealer/client-core";
import { formatNumber, getPresentationCopy, type Locale } from "@gooddealer/i18n";
import { AlertTriangleIcon, Badge, Button, Panel, Tabs } from "@gooddealer/ui";
import { useState } from "react";

import "./conflict-center.css";

type ConflictItem = ConflictCenterViewModel["conflicts"][number];
type GroupTab = "all" | ConflictItem["group"];

export interface ConflictCenterProps {
  readonly locale: Locale;
  readonly view: ConflictCenterViewModel;
  /** Exactly one candidate and one explicit choice per call; there is no bulk resolution. */
  readonly onResolve?: (candidateId: string, choice: ConflictResolutionChoice) => void;
  readonly resolvingId?: string | null;
}

function fill(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{(\w+)\}/gu, (match, key: string) => values[key] ?? match);
}

/** Conflict center: Base / Local / Remote side by side, decided one candidate at a time. */
export function ConflictCenter({ locale, view, onResolve, resolvingId = null }: ConflictCenterProps) {
  const copy = getPresentationCopy(locale, "conflictCenter");
  const [tab, setTab] = useState<GroupTab>("all");
  const pending = view.conflicts.filter((item) => item.status === "pending" || item.status === "review_stale");
  const visible = view.conflicts.filter((item) => tab === "all" || item.group === tab);
  const groupLabel: Readonly<Record<ConflictItem["group"], string>> = { price: copy.price, dns: copy.dns, sales_status: copy.salesStatus };
  const pendingIn = (group: GroupTab) => pending.filter((item) => group === "all" || item.group === group).length;

  return (
    <section className="conflict-center" aria-label={copy.title}>
      <div className="conflict-center-content">
        <header className="conflict-center-head">
          <span className="gd-t-section">{copy.title}</span>
          <Badge tone={pending.length > 0 ? "danger" : "success"} mono={false}>
            {pending.length > 0 ? fill(copy.pendingCount, { count: formatNumber(locale, pending.length) }) : copy.allResolved}
          </Badge>
          <span className="gd-t-meta conflict-center-notice">{copy.singleChoiceNotice}</span>
        </header>
        <Tabs
          active={tab}
          onChange={(key) => { if (key === "all" || key === "price" || key === "dns" || key === "sales_status") setTab(key); }}
          items={[
            { key: "all", label: copy.all, count: pendingIn("all") },
            { key: "price", label: copy.price, count: pendingIn("price") },
            { key: "dns", label: copy.dns, count: pendingIn("dns") },
            { key: "sales_status", label: copy.salesStatus, count: pendingIn("sales_status") },
          ]}
        />
        {visible.length === 0 ? <p className="gd-t-body-2 conflict-center-empty">{copy.empty}</p> : null}
        {visible.map((item) => <ConflictCard key={item.candidateId} locale={locale} item={item} groupLabel={groupLabel[item.group]} resolving={resolvingId === item.candidateId} {...(onResolve === undefined ? {} : { onResolve })} />)}
      </div>
    </section>
  );
}

function ConflictCard({ locale, item, groupLabel, resolving, onResolve }: {
  readonly locale: Locale;
  readonly item: ConflictItem;
  readonly groupLabel: string;
  readonly resolving: boolean;
  readonly onResolve?: (candidateId: string, choice: ConflictResolutionChoice) => void;
}) {
  const copy = getPresentationCopy(locale, "conflictCenter");
  const admission = item.resolutionAdmission;
  const choices = admission.state === "available" && onResolve !== undefined && !resolving ? admission.choices : [];
  const resolved = item.status === "resolved_local" || item.status === "resolved_remote";
  const pick = (choice: ConflictResolutionChoice) => { if (choices.includes(choice)) onResolve?.(item.candidateId, choice); };

  return (
    <Panel>
      <div className={`conflict-card${resolved ? " conflict-card--resolved" : ""}`}>
        <div className="conflict-card-head">
          <span className="conflict-mono">{item.entityDisplay}</span>
          <span className="gd-t-body-2">{item.fieldDisplay}</span>
          <Badge mono={false}>{groupLabel}</Badge>
          {item.risk === "high" ? <Badge tone="danger" mono={false}>{copy.riskHigh}</Badge> : null}
          {item.risk === "safety_priority" ? <Badge tone="warning" mono={false}>{copy.riskSafety}</Badge> : null}
          <span className="gd-t-meta conflict-card-note">{item.note}</span>
        </div>
        <div className="conflict-values">
          <ConflictValue label={copy.base} value={item.baseValue} />
          <ConflictValue label={copy.local} value={item.localValue} tone="local" chosen={item.status === "resolved_local"} {...(choices.includes("keep_local") ? { onPick: () => pick("keep_local") } : {})} />
          <ConflictValue label={copy.remote} value={item.remoteValue} tone="remote" chosen={item.status === "resolved_remote"} {...(choices.includes("accept_remote") ? { onPick: () => pick("accept_remote") } : {})} />
        </div>
        <div className="conflict-card-actions">
          {resolved ? (
            <Badge tone="success" mono={false}>{item.status === "resolved_local" ? copy.keptLocal : copy.acceptedRemote}</Badge>
          ) : resolving ? (
            <span className="gd-t-body-2">{copy.resolving}</span>
          ) : item.status === "review_stale" ? (
            <span className="conflict-warning"><AlertTriangleIcon size={13} />{copy.reviewStale}</span>
          ) : choices.length === 0 ? (
            <span className="gd-t-meta">{copy.admissionUnavailable}</span>
          ) : (
            <>
              {choices.includes("keep_local") ? <Button size="sm" variant="primary" onClick={() => pick("keep_local")}>{copy.keepLocal}</Button> : null}
              {choices.includes("accept_remote") ? <Button size="sm" variant={choices.includes("keep_local") ? "secondary" : "primary"} onClick={() => pick("accept_remote")}>{copy.acceptRemote}</Button> : null}
              {item.candidateKind === "delete_conflict" ? <span className="gd-t-meta">{copy.deleteConflictNote}</span> : null}
            </>
          )}
          <span className="conflict-mono conflict-card-rev">{copy.baseRevision} {formatNumber(locale, item.comparisonServerRevision)}</span>
        </div>
      </div>
    </Panel>
  );
}

function ConflictValue({ label, value, tone, chosen = false, onPick }: {
  readonly label: string;
  readonly value: string;
  readonly tone?: "local" | "remote";
  readonly chosen?: boolean;
  readonly onPick?: () => void;
}) {
  const className = `conflict-value${tone === undefined ? "" : ` conflict-value--${tone}`}${chosen ? " conflict-value--chosen" : ""}`;
  const content = <><span className="conflict-value-label">{label}</span><span className="conflict-value-text">{value}</span></>;
  return onPick === undefined
    ? <div className={className}>{content}</div>
    : <button type="button" className={`${className} conflict-value--pickable`} onClick={onPick}>{content}</button>;
}
