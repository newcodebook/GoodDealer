import type { ManualTaskInboxViewModel } from "@gooddealer/client-core";
import { formatDate, formatNumber, getPresentationCopy, type Locale } from "@gooddealer/i18n";
import {
  Badge,
  Button,
  Checkbox,
  CheckIcon,
  Dialog,
  ExternalLinkIcon,
  FileTextIcon,
  MonitorIcon,
  Panel,
  PauseIcon,
  PlayIcon,
  RefreshCwIcon,
  StatusDot,
} from "@gooddealer/ui";
import { useState } from "react";

import "./manual-task-inbox.css";

type ManualTask = ManualTaskInboxViewModel["tasks"][number];
type TaskAction = "open_platform" | "request_automation_grant" | "mark_user_operation_done" | "request_recheck" | "cancel";
type BrowserControl = "pause_and_take_over" | "continue" | "terminate";

export interface ManualTaskInboxProps {
  readonly locale: Locale;
  readonly view: ManualTaskInboxViewModel;
  readonly onSelect?: (taskId: string) => void;
  /** Ordinary task actions; "mark done" only asks the Host to verify, it never marks success itself. */
  readonly onAction?: (task: ManualTask, action: TaskAction) => void;
  readonly onAcceptRisk?: (task: ManualTask, reason: string) => void;
  /** Browser handoff controls; the panel appears only when the Host supplies a browser task. */
  readonly onBrowserControl?: (task: ManualTask, control: BrowserControl) => void;
}

function fill(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{(\w+)\}/gu, (match, key: string) => values[key] ?? match);
}

const terminal = new Set<ManualTask["status"]>(["confirmed_completed", "cancelled", "risk_accepted"]);

/** Manual task inbox: tasks that need a person, each with its reason, checklist, and verified completion. */
export function ManualTaskInbox({ locale, view, onSelect, onAction, onAcceptRisk, onBrowserControl }: ManualTaskInboxProps) {
  const copy = getPresentationCopy(locale, "manualTaskInbox");
  const [riskTask, setRiskTask] = useState<ManualTask | null>(null);
  const [reason, setReason] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const readOnly = view.source === "standby_cloud" || view.commandAdmission !== "proven";
  const selected = view.tasks.find((task) => task.id === view.selectedTaskId) ?? view.tasks[0] ?? null;
  const open = view.tasks.filter((task) => !terminal.has(task.status)).length;
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const when = (value: string | null) => value === null ? "—" : formatDate(locale, Date.parse(value), { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, timeZone });

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
              <span className="tasks-item-meta">{statusBadge(task)}<span className="gd-t-meta">{task.account} · {formatNumber(locale, task.affectedDomains.length)} {copy.domainsUnit}</span></span>
            </button>
          ))}
          <span className="gd-t-meta">{copy.duplicatePrevention}</span>
        </aside>
        {selected === null ? null : (
          <div className="tasks-detail">
            {readOnly ? <p className="tasks-readonly gd-t-meta">{copy.readOnlyNotice}</p> : null}
            <Panel title={selected.title} actions={statusBadge(selected)}>
              <div className="tasks-stack">
                <dl className="tasks-facts">
                  <dt>{copy.whyManual}</dt><dd>{selected.reason}</dd>
                  <dt>{copy.target}</dt><dd>{selected.platform} · {selected.account}</dd>
                  <dt>{copy.affectedDomains}</dt><dd className="tasks-mono">{selected.affectedDomains.slice(0, 3).join(" · ")}{selected.affectedDomains.length > 3 ? ` +${selected.affectedDomains.length - 3}` : ""}</dd>
                  <dt>{copy.prepared}</dt><dd>{selected.preparedArtifactLabel === null ? "—" : <span className="tasks-artifact"><FileTextIcon size={13} />{selected.preparedArtifactLabel}</span>}</dd>
                  <dt>{copy.completionCondition}</dt><dd>{selected.completionCondition}</dd>
                  <dt>{copy.lastChecked}</dt><dd className="tasks-mono">{when(selected.lastCheckedAt)}</dd>
                </dl>
                <div className="tasks-checklist">
                  <span className="gd-t-label">{copy.checklist}</span>
                  {selected.checklist.map((item) => (
                    <span key={item.id} className={`tasks-check tasks-check--${item.state}`}>
                      <i>{item.state === "completed" ? <CheckIcon size={11} /> : null}</i>{item.label}
                    </span>
                  ))}
                </div>
                {onAction === undefined ? null : (
                  <div className="tasks-actions">
                    {can(selected, "open_platform") ? <Button icon={<ExternalLinkIcon size={13} />} onClick={() => onAction(selected, "open_platform")}>{copy.openPlatformAndSignIn}</Button> : null}
                    {can(selected, "request_automation_grant") ? <Button variant="primary" onClick={() => onAction(selected, "request_automation_grant")}>{copy.authorizeExecution}</Button> : null}
                    {can(selected, "mark_user_operation_done") ? <Button variant="ghost" onClick={() => onAction(selected, "mark_user_operation_done")}>{copy.markComplete}</Button> : null}
                    {can(selected, "request_recheck") ? <Button variant="ghost" icon={<RefreshCwIcon size={13} />} onClick={() => onAction(selected, "request_recheck")}>{copy.requestRecheck}</Button> : null}
                    <span className="tasks-spacer" />
                    {can(selected, "accept_residual_risk") && onAcceptRisk !== undefined
                      ? <Button size="sm" variant="ghost" onClick={() => { setReason(""); setAcknowledged(false); setRiskTask(selected); }}>{copy.acceptRisk}</Button> : null}
                    {can(selected, "cancel") ? <Button size="sm" variant="ghost" onClick={() => onAction(selected, "cancel")}>{copy.cancelTask}</Button> : null}
                  </div>
                )}
                <span className="gd-t-meta">{copy.completionRequiresVerification}</span>
              </div>
            </Panel>
            {selected.browserGrant === null ? null : (
              <Panel title={copy.grantTitle} actions={<Badge tone="gold" mono={false}>{selected.browserGrant.planActionLabel}</Badge>}>
                <dl className="tasks-facts">
                  <dt>{copy.grantScope}</dt><dd>{selected.browserGrant.provider} · {selected.browserGrant.accountAlias} · {formatNumber(locale, selected.browserGrant.planItemCount)}</dd>
                  <dt>{copy.allowedHost}</dt><dd className="tasks-mono">{selected.browserGrant.allowedHosts.join(" · ")}</dd>
                  <dt>{copy.grantExpires}</dt><dd className="tasks-mono">{when(selected.browserGrant.expiresAt)}</dd>
                </dl>
              </Panel>
            )}
            {selected.browserTask === null ? null : (
              <BrowserHandoff locale={locale} task={selected} {...(onBrowserControl === undefined || readOnly ? {} : { onControl: (control: BrowserControl) => onBrowserControl(selected, control) })} />
            )}
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

function BrowserHandoff({ locale, task, onControl }: { readonly locale: Locale; readonly task: ManualTask; readonly onControl?: (control: BrowserControl) => void }) {
  const copy = getPresentationCopy(locale, "manualTaskInbox");
  const browser = task.browserTask;
  if (browser === null) return null;
  const controls = browser.controlAdmission.status === "proven" ? browser.controlAdmission.controls : [];
  const status = browser.state === "running"
    ? <StatusDot kind="sync" pulse label={fill(copy.softwareRunningRemaining, { count: formatNumber(locale, browser.remainingItems) })} />
    : browser.state === "paused" ? <StatusDot kind="warning" label={copy.pausedForHandoff} />
      : browser.state === "outcome_unknown" ? <StatusDot kind="danger" label={copy.outcomeUnknown} />
        : browser.state === "awaiting_user" ? <StatusDot kind="neutral" label={copy.userOperation} />
          : <StatusDot kind="success" label={copy.finished} />;
  return (
    <Panel title={copy.remoteBrowserStatus} actions={<Badge tone="sync">{browser.operator === "software" ? "SOFTWARE" : "USER"}</Badge>}>
      <div className="tasks-stack">
        <div className="tasks-browser-row">
          <span className="tasks-browser-target"><MonitorIcon size={14} />{browser.provider} · {browser.accountAlias}</span>
          <span className="tasks-mono tasks-muted">{copy.allowedHost}: {browser.allowedHosts.join(" · ")}</span>
          <span className="tasks-browser-status">{status}</span>
        </div>
        <div className="tasks-browser-next">
          <span>{copy.nextStep}：{browser.nextStepLabel}</span>
          <span>{copy.queue} {formatNumber(locale, browser.remainingItems)}</span>
        </div>
        {onControl === undefined ? null : (
          <div className="tasks-actions">
            <Button size="sm" icon={<PauseIcon size={12} />} disabled={!controls.includes("pause_and_take_over")} onClick={() => onControl("pause_and_take_over")}>{copy.pauseAndTakeOver}</Button>
            <Button size="sm" icon={<PlayIcon size={12} />} disabled={!controls.includes("continue")} onClick={() => onControl("continue")}>{copy.continue}</Button>
            <Button size="sm" variant="danger" disabled={!controls.includes("terminate")} onClick={() => onControl("terminate")}>{copy.terminate}</Button>
            <span className="tasks-spacer" />
            <span className="gd-t-meta">{copy.secretPageHandoff}</span>
          </div>
        )}
      </div>
    </Panel>
  );
}
