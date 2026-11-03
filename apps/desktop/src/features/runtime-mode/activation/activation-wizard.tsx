import type { ActivationAction, ActivationWizardViewModel } from "@gooddealer/client-core";
import { formatNumber, getPresentationCopy, type Locale } from "@gooddealer/i18n";
import { Badge, Button, CheckIcon, Input, ProgressBar, RefreshCwIcon, ShieldIcon, StatusDot } from "@gooddealer/ui";
import keyholeUrl from "@gooddealer/ui/assets/icons/keyhole.svg";
import markUrl from "@gooddealer/ui/assets/logo/mark.svg";
import mark16Url from "@gooddealer/ui/assets/logo/mark-16.svg";
import { useState, type ReactNode } from "react";

import "./activation-wizard.css";

type ConnectionsStep = Extract<ActivationWizardViewModel, { readonly step: "connections" }>;
type Provider = ConnectionsStep["providers"][number];

export interface ActivationWizardProps {
  readonly locale: Locale;
  readonly view: ActivationWizardViewModel;
  readonly onAction: (action: Exclude<ActivationAction, "submit_device" | "connect_provider" | "disconnect_provider">) => void;
  readonly onSubmitDevice?: (deviceName: string) => void;
  readonly onToggleProvider?: (providerId: string, connect: boolean) => void;
}

const steps = ["welcome", "device", "connections", "initial_import", "complete"] as const;

function fill(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{(\w+)\}/gu, (match, key: string) => values[key] ?? match);
}

/** First-run activation: welcome, device gate, connections, initial import, and completion. */
export function ActivationWizard({ locale, view, onAction, onSubmitDevice, onToggleProvider }: ActivationWizardProps) {
  const copy = getPresentationCopy(locale, "activation");
  const index = steps.indexOf(view.step);
  const can = (action: ActivationAction) => view.availableActions.includes(action);
  const stepLabels = [copy.welcome, copy.deviceGate, copy.connectAccount, copy.firstImport, copy.done];

  const footer = (next: { readonly label: string; readonly action: "continue" | "enter_workspace" }) => (
    <footer className="activation-foot">
      {can("back") ? <Button variant="ghost" onClick={() => onAction("back")}>{copy.back}</Button> : null}
      {can("skip") ? <Button variant="ghost" onClick={() => onAction("skip")}>{copy.skip}</Button> : null}
      <span className="activation-spacer" />
      <span className="activation-mono activation-faint">{fill(copy.stepProgress, { index: String(index + 1), total: String(steps.length) })}</span>
      <Button variant="primary" disabled={!can(next.action)} onClick={() => onAction(next.action)}>{next.label}</Button>
    </footer>
  );

  return (
    <div className="activation">
      <nav className="activation-steps" aria-label={copy.tagline}>
        <div className="activation-brand"><img src={mark16Url} width="18" height="18" alt="" /><span>GoodDealer</span></div>
        <ol>
          {stepLabels.map((label, position) => {
            const state = position < index ? "done" : position === index ? "current" : "upcoming";
            return (
              <li key={label} className={`activation-step activation-step--${state}`} aria-current={state === "current" ? "step" : undefined}>
                <span className="activation-step-dot">{state === "done" ? <CheckIcon size={12} /> : position + 1}</span>
                {label}
              </li>
            );
          })}
        </ol>
        <p className="activation-steps-note">{copy.tagline}</p>
      </nav>
      <section className="activation-pane">
        {view.step === "welcome" ? (
          <>
            <div className="activation-welcome">
              <img src={markUrl} width="76" height="76" alt="" />
              <div>
                <h1 className="activation-hero-title">GoodDealer</h1>
                <p className="gd-t-body-2">{copy.terminalDescription}</p>
              </div>
              <div className="activation-values">
                {([[copy.privateControl, copy.preciseConfirmation], [copy.hardwareWalletGate, copy.oneActiveDevice], [copy.reversibleAudit, copy.revisionNotice]] as const).map(([title, body]) => (
                  <div key={title} className="activation-value"><strong>{title}</strong><span>{body}</span></div>
                ))}
              </div>
            </div>
            {footer({ label: copy.start, action: "continue" })}
          </>
        ) : null}
        {view.step === "device" ? <DeviceStep locale={locale} view={view} {...(onSubmitDevice === undefined ? {} : { onSubmitDevice })} footer={footer({ label: copy.continue, action: "continue" })} /> : null}
        {view.step === "connections" ? (
          <>
            <header className="activation-head">
              <h2>{copy.connectAccount}</h2>
              <p className="gd-t-body-2">{copy.connectSubtitle}</p>
            </header>
            {([["registrar", copy.registrar], ["dns", copy.dnsProvider], ["marketplace", copy.salesPlatform]] as const).map(([category, label]) => {
              const providers = view.providers.filter((provider) => provider.category === category);
              return providers.length === 0 ? null : (
                <div key={category} className="activation-group">
                  <span className="gd-t-label">{label}</span>
                  <div className="activation-providers">
                    {providers.map((provider) => <ProviderCard key={provider.providerId} locale={locale} provider={provider} {...(onToggleProvider === undefined ? {} : { onToggle: onToggleProvider })} canConnect={can("connect_provider")} canDisconnect={can("disconnect_provider")} />)}
                  </div>
                </div>
              );
            })}
            {footer({ label: view.connectedCount > 0 ? fill(copy.continueConnected, { count: formatNumber(locale, view.connectedCount) }) : copy.continue, action: "continue" })}
          </>
        ) : null}
        {view.step === "initial_import" ? (
          <>
            <header className="activation-head">
              <h2>{copy.firstImportTitle}</h2>
              <p className="gd-t-body-2">{copy.importSubtitlePrefix}</p>
            </header>
            {view.importState === "completed" ? (
              <>
                <div className="activation-summary">
                  <div><span className="gd-t-label">{copy.domain}</span><span className="gd-t-metric-sm">{formatNumber(locale, view.importedDomains ?? 0)}</span></div>
                  <div><span className="gd-t-label">{copy.listing}</span><span className="gd-t-metric-sm">{formatNumber(locale, view.importedListings ?? 0)}</span></div>
                  <div><span className="gd-t-label">{copy.conflict}</span><span className="gd-t-metric-sm activation-danger">{formatNumber(locale, view.conflicts ?? 0)}</span></div>
                  <div><span className="gd-t-label">{copy.baseline}</span><span className="gd-t-metric-sm activation-gold">rev {formatNumber(locale, view.baselineServerRevision ?? 0)}</span></div>
                </div>
                <p className="gd-t-body-2">{copy.importCompleted}</p>
              </>
            ) : (
              <div className="activation-card">
                {view.importState === "in_progress" ? (
                  <>
                    <ProgressBar segments={[{ value: view.progress, tone: "sync" }]} height={8} label={copy.importProgress} />
                    <span className="activation-mono activation-muted">{view.progress}% · {copy.importProgress}</span>
                  </>
                ) : (
                  <div className="activation-row">
                    <RefreshCwIcon size={16} className="activation-muted" />
                    <span className="gd-t-body-2">{view.importState === "failed" ? copy.importFailed : copy.importReady}</span>
                    <span className="activation-spacer" />
                    {can("start_import") ? <Button variant="primary" onClick={() => onAction("start_import")}>{copy.importStart}</Button> : null}
                  </div>
                )}
              </div>
            )}
            {footer({ label: copy.continue, action: "continue" })}
          </>
        ) : null}
        {view.step === "complete" ? (
          <>
            <div className="activation-done">
              <span className={`activation-done-icon${view.syncReady ? "" : " activation-done-icon--pending"}`}>{view.syncReady ? <CheckIcon size={30} /> : <RefreshCwIcon size={26} />}</span>
              <div>
                <h2>{view.syncReady ? copy.completionTitle : copy.cloudValidationPendingTitle}</h2>
                <p className="gd-t-body-2">
                  {view.syncReady
                    ? fill(copy.completionDetail, { device: view.deviceName, count: formatNumber(locale, view.importedDomains), revision: formatNumber(locale, view.baselineServerRevision) })
                    : copy.cloudValidationPendingDescription}
                </p>
              </div>
              <div className="activation-row activation-faint">
                {view.syncReady ? <><StatusDot kind="active" label="Active" /><span>·</span><StatusDot kind="sync" label={copy.syncReady} /></> : <StatusDot kind="warning" pulse label={copy.leasePending} />}
              </div>
            </div>
            {footer({ label: copy.enterWorkspace, action: "enter_workspace" })}
          </>
        ) : null}
      </section>
    </div>
  );
}

function DeviceStep({ locale, view, onSubmitDevice, footer }: {
  readonly locale: Locale;
  readonly view: Extract<ActivationWizardViewModel, { readonly step: "device" }>;
  readonly onSubmitDevice?: (deviceName: string) => void;
  readonly footer: ReactNode;
}) {
  const copy = getPresentationCopy(locale, "activation");
  const [name, setName] = useState(view.deviceName);
  const canSubmit = view.availableActions.includes("submit_device") && onSubmitDevice !== undefined;
  const busy = view.activationState === "activating" || view.activationState === "awaiting_cloud";
  return (
    <>
      <header className="activation-head">
        <h2>{copy.deviceTitle}</h2>
        <p className="gd-t-body-2">{copy.deviceDescription}</p>
      </header>
      <div className="activation-card activation-device">
        <img src={keyholeUrl} width="40" height="40" alt="" className={view.activationState === "active" ? undefined : "activation-dim"} />
        <div className="activation-device-body">
          <Input label={copy.deviceName} value={name} disabled={!canSubmit} onChange={(event) => setName(event.currentTarget.value)} />
          {view.activationState === "active" && view.activeLease.status === "issued" ? (
            <div className="activation-row">
              <StatusDot kind="active" />
              <Badge tone="gold">ACTIVE</Badge>
              <span className="gd-t-body-2">{copy.leaseIssued} · <span className="activation-mono activation-gold">{copy.epoch} {view.activeLease.leaseEpoch}</span></span>
            </div>
          ) : (
            <div className="activation-row">
              {canSubmit ? (
                <Button variant="primary" disabled={name.trim() === ""} icon={<ShieldIcon size={14} />} onClick={() => onSubmitDevice?.(name.trim())}>{copy.submitDevice}</Button>
              ) : null}
              {busy ? <span className="activation-busy"><RefreshCwIcon size={13} className="activation-spin" />{view.activationState === "awaiting_cloud" ? copy.awaitingCloud : copy.activationInProgress}</span> : null}
              {view.activationState === "failed" ? <span className="activation-danger">{copy.activationFailed}</span> : null}
              {view.activationState === "ready" && !canSubmit ? <span className="gd-t-meta">{copy.activationReady}</span> : null}
            </div>
          )}
        </div>
      </div>
      <p className="gd-t-meta">{copy.leaseSigner}</p>
      <p className="gd-t-meta">{copy.keyNote}</p>
      {footer}
    </>
  );
}

function ProviderCard({ locale, provider, onToggle, canConnect, canDisconnect }: {
  readonly locale: Locale;
  readonly provider: Provider;
  readonly onToggle?: (providerId: string, connect: boolean) => void;
  readonly canConnect: boolean;
  readonly canDisconnect: boolean;
}) {
  const copy = getPresentationCopy(locale, "activation");
  const connected = provider.connectionState === "connected";
  const enabled = onToggle !== undefined && provider.connectionState !== "connecting" && (connected ? canDisconnect : canConnect);
  return (
    <button type="button" className={`activation-provider activation-provider--${provider.connectionState}`} disabled={!enabled} onClick={() => onToggle?.(provider.providerId, !connected)}>
      <StatusDot kind={connected ? "success" : provider.connectionState === "failed" ? "danger" : provider.connectionState === "connecting" ? "sync" : "neutral"} pulse={provider.connectionState === "connecting"} />
      <span className="activation-provider-text"><strong>{provider.displayName}</strong><span>{provider.metadata}</span></span>
      {connected ? <Badge tone="success" mono={false}>{copy.connected}</Badge>
        : provider.connectionState === "connecting" ? <span className="activation-link">{copy.connecting}</span>
          : provider.connectionState === "failed" ? <span className="activation-danger">{copy.connectionFailed}</span>
            : <span className="activation-link">{copy.connect}</span>}
    </button>
  );
}
