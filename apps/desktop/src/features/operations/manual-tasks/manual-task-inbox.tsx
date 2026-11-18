import type { ManualTaskInboxViewModel } from "@gooddealer/client-core";
import { formatNumber, getPresentationCopy, type Locale } from "@gooddealer/i18n";
import {
  Badge,
  Button,
  Checkbox,
  CheckIcon,
  Dialog,
  ExternalLinkIcon,
  FileTextIcon,
  Panel,
  RefreshCwIcon,
} from "@gooddealer/ui";
import { useState } from "react";

import { relativeTime } from "../relative-time";

import "./manual-task-inbox.css";

type ManualTask = ManualTaskInboxViewModel["tasks"][number];
type TaskAction = "open_platform" | "mark_user_operation_done" | "request_recheck" | "cancel";

export interface ManualTaskInboxProps {
  readonly locale: Locale;
  readonly view: ManualTaskInboxViewModel;
  readonly onSelect?: (taskId: string) => void;
  /** Ordinary task actions; "mark done" only asks the Host to verify, it never marks success itself. */
  readonly onAction?: (task: ManualTask, action: TaskAction) => void;
  readonly onAcceptRisk?: (task: ManualTask, reason: string) => void;
  /** The local clock relative times are measured from; defaults to now. */
  readonly now?: Date;
}

function fill(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{(\w+)\}/gu, (match, key: string) => values[key] ?? match);
}

const terminal = new Set<ManualTask["status"]>(["confirmed_completed", "cancelled", "risk_accepted"]);

/**
 * Manual task inbox: steps a platform offers only in its own console. The person completes them in
 * their own browser; returning only asks the Host to re-observe the platform (ADR-0017, ADR-0027).
 */
export function ManualTaskInbox({ locale, view, onSelect, onAction, onAcceptRisk, now }: ManualTaskInboxProps) {
  const copy = getPresentationCopy(locale, "manualTaskInbox");
  const [riskTask, setRiskTask] = useState<ManualTask | null>(null);
  const [reason, setReason] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const readOnly = view.source === "standby_cloud" || view.commandAdmission !== "proven";
  const selected = view.tasks.find((task) => task.id === view.selectedTaskId) ?? view.tasks[0] ?? null;
  const open = view.tasks.filter((task) => !terminal.has(task.status)).length;
  const when = (value: string | null) => value === null ? "—" : relativeTime(value, copy, now);

  const statusBadge = (task: ManualTask) => {
    switch (task.status) {
      case "confirmed_completed": return <Badge tone="success" mono={false}>{copy.completed}</Badge>;
      case "cancelled": return <Badge mono={false}>{copy.cancelled}</Badge>;
      case "risk_accepted": return <Badge tone="warning" mono={false}>{copy.riskAccepted}</Badge>;
      case "verification_pending": return <Badge tone="sync" mono={false}>{copy.verificationPending}</Badge>;
      default: return task.priority === "high"
        ? <Badge tone="danger" mono={false}>{copy.highPriority}</Badge>
        : task.priority === "low" ? <Badge mono={false}>{copy.lowPriority}</Badge> : <Badge tone="warning" mono={false}>{copy.waitingManual}</Badge>;
    }
  };
  const can = (task: ManualTask, action: ManualTask["availableActions"][number]) => !readOnly && task.availableActions.includes(action);

  return (
    <section className="tasks" aria-label={copy.title}>
      <div className="tasks-content">
        <aside className="tasks-list">
          <span className="gd-t-section">{copy.manualTasks} <span className="tasks-count">· {formatNumber(locale, open)} {copy.pending}</span></span>
          {view.tasks.length === 0 ? <p className="gd-t-meta">{copy.empty}</p> : null}
          {view.tasks.map((task) => (
            <button
              key={task.id}
              type="button"
              className={`tasks-item${task.id === selected?.id ? " tasks-item--active" : ""}${terminal.has(task.status) ? " tasks-item--done" : ""}`}
              aria-current={task.id === selected?.id ? "true" : undefined}
              onClick={() => onSelect?.(task.id)}
            >
              <span className="tasks-item-title">{task.status === "confirmed_completed" ? <CheckIcon size={13} className="tasks-success" /> : null}{task.title}</span>
              <span className="tasks-item-meta">{statusBadge(task)}<span className="gd-t-meta">{task.account} · {formatNumber(locale, task.affectedDomainCount)} {copy.domainsUnit}</span></span>
            </button>
          ))}
          <span className="gd-t-meta">{copy.duplicatePrevention}</span>
        </aside>
        {selected === null ? null : (
          <div className="tasks-detail">
            {view.source === "standby_cloud" ? <p className="tasks-readonly gd-t-meta">{copy.readOnlyNotice}</p>
              : readOnly ? <p className="tasks-readonly gd-t-meta">{copy.actionsUnavailable}</p> : null}
            <Panel title={selected.title} actions={statusBadge(selected)}>
              <div className="tasks-stack">
                <dl className="tasks-facts">
                  <dt>{copy.whyManual}</dt><dd>{selected.reason}</dd>
                  <dt>{copy.target}</dt><dd>{selected.platform} · {selected.account}</dd>
                  <dt>{copy.affectedDomains}</dt><dd className="tasks-mono">{selected.affectedDomainCount === 0 ? "—" : selected.affectedDomains.join(" · ")}{selected.affectedDomainCount > selected.affectedDomains.length ? ` +${formatNumber(locale, selected.affectedDomainCount - selected.affectedDomains.length)}` : ""}</dd>
                  <dt>{copy.prepared}</dt><dd>{selected.preparedArtifactLabel === null ? "—" : <span className="tasks-artifact"><FileTextIcon size={13} />{selected.preparedArtifactLabel}</span>}</dd>
                  <dt>{copy.completionCondition}</dt><dd>{selected.completionCondition}</dd>
                  <dt>{copy.lastChecked}</dt><dd className="tasks-mono">{when(selected.lastCheckedAt)}</dd>
                </dl>
                {selected.checklist.length === 0 ? null : (
                  <div className="tasks-checklist">
                    <span className="gd-t-label">{copy.checklist}</span>
                    {selected.checklist.map((item) => (
                      <span key={item.id} className={`tasks-check tasks-check--${item.state}`}>
                        <i>{item.state === "completed" ? <CheckIcon size={11} /> : null}</i>{item.label}
                      </span>
                    ))}
                  </div>
                )}
                {onAction === undefined ? null : (
                  <div className="tasks-actions">
                    {can(selected, "open_platform") ? <Button icon={<ExternalLinkIcon size={13} />} onClick={() => onAction(selected, "open_platform")}>{copy.openPlatformAndSignIn}</Button> : null}
                    {can(selected, "mark_user_operation_done") ? <Button variant="ghost" onClick={() => onAction(selected, "mark_user_operation_done")}>{copy.markComplete}</Button> : null}
                    {can(selected, "request_recheck") ? <Button variant="ghost" icon={<RefreshCwIcon size={13} />} onClick={() => onAction(selected, "request_recheck")}>{copy.requestRecheck}</Button> : null}
                    <span className="tasks-spacer" />
                    {can(selected, "accept_residual_risk") && onAcceptRisk !== undefined
                      ? <Button size="sm" variant="ghost" onClick={() => { setReason(""); setAcknowledged(false); setRiskTask(selected); }}>{copy.acceptRisk}</Button> : null}
                    {can(selected, "cancel") ? <Button size="sm" variant="ghost" onClick={() => onAction(selected, "cancel")}>{copy.cancelTask}</Button> : null}
                  </div>
                )}
                {onAction !== undefined && can(selected, "mark_user_operation_done") ? <span className="gd-t-meta">{copy.completionRequiresVerification}</span> : null}
              </div>
            </Panel>
          </div>
        )}
      </div>
      <Dialog
        open={riskTask !== null}
        onClose={() => setRiskTask(null)}
        title={riskTask === null ? copy.acceptRisk : fill(copy.acceptRiskTitle, { title: riskTask.title })}
        width={480}
        danger
        footer={riskTask === null ? null : (
          <>
            <Button onClick={() => setRiskTask(null)}>{copy.cancelTask}</Button>
            <Button variant="danger" disabled={!acknowledged || reason.trim() === ""} onClick={() => { onAcceptRisk?.(riskTask, reason.trim()); setRiskTask(null); }}>{copy.acceptRisk}</Button>
          </>
        )}
      >
        {riskTask === null ? null : (
          <div className="tasks-stack">
            <span className="gd-t-body">{copy.acceptRiskBody}</span>
            {riskTask.riskAcceptancePolicy === "fresh_reauth_required" ? <span className="tasks-warning">{copy.reauthRequired}</span> : null}
            <label className="gd-field">
              <span className="gd-field-label">{copy.reason}</span>
              <textarea className="tasks-reason" maxLength={2_000} placeholder={copy.reasonPlaceholder} value={reason} onChange={(event) => setReason(event.currentTarget.value)} />
            </label>
            <Checkbox checked={acknowledged} onChange={() => setAcknowledged((value) => !value)} label={copy.acceptRiskAck} />
          </div>
        )}
      </Dialog>
    </section>
  );
}
