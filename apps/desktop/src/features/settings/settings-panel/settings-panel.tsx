import type {
  ConnectionSettingsAction,
  ConnectionSettingsItemViewModel,
  ConnectionSettingsViewModel,
  SyncSettingsViewModel,
} from "@gooddealer/client-core";
import { defaultLocale, formatDate, formatNumber, getPresentationCopy, isLocale, supportedLocales, type Locale } from "@gooddealer/i18n";
import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  ExternalLinkIcon,
  KeyValueList,
  KeyValueRow,
  MonitorIcon,
  Panel,
  RefreshCwIcon,
  Select,
  StatusDot,
  Switch,
  Tag,
} from "@gooddealer/ui";
import activeLeaseUrl from "@gooddealer/ui/assets/icons/active-lease.svg";
import keyholeUrl from "@gooddealer/ui/assets/icons/keyhole.svg";
import { useState } from "react";

import {
  canHandoffTo,
  connectionStatus,
  leaseHolder,
  settingsSections,
  type AboutView,
  type DeviceRuntimeEntry,
  type DeviceRuntimeView,
  type LicenseView,
  type SettingsSection,
} from "./settings-contract";
import "./settings-panel.css";

type PullRefreshCadence = SyncSettingsViewModel["pullRefreshCadence"];

export interface SettingsPanelProps {
  readonly locale: Locale;
  readonly initialSection?: SettingsSection;
  readonly connections: ConnectionSettingsViewModel;
  readonly onConnectionAction?: (connection: ConnectionSettingsItemViewModel, action: ConnectionSettingsAction) => void;
  readonly onAddConnection?: () => void;
  readonly onRunOnboarding?: () => void;
  readonly devices: DeviceRuntimeView;
  /** Fires only after the handoff acknowledgement, for a target the Host admitted. */
  readonly onHandoff?: (deviceId: string) => void;
  readonly license: LicenseView | null;
  readonly onManageSubscription?: () => void;
  readonly onRenew?: () => void;
  readonly sync: SyncSettingsViewModel;
  readonly onPullRefreshChange?: (cadence: PullRefreshCadence) => void;
  readonly about: AboutView;
  readonly onLocaleChange?: (locale: Locale) => void;
}

function fill(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{(\w+)\}/gu, (match, key: string) => values[key] ?? match);
}

const cadences: readonly PullRefreshCadence[] = ["when_visible", "every_5_minutes", "every_15_minutes"];
const methodLabel = { api: "API", browser: "Browser", csv: "CSV", oauth: "OAuth" } as const;

/** Settings: connections, the device lease and handoff ceremony, license, sync policy, and about. */
export function SettingsPanel({
  locale,
  initialSection = "devices",
  connections,
  onConnectionAction,
  onAddConnection,
  onRunOnboarding,
  devices,
  onHandoff,
  license,
  onManageSubscription,
  onRenew,
  sync,
  onPullRefreshChange,
  about,
  onLocaleChange,
}: SettingsPanelProps) {
  const copy = getPresentationCopy(locale, "settings");
  const [section, setSection] = useState<SettingsSection>(initialSection);
  const [handoffTarget, setHandoffTarget] = useState<DeviceRuntimeEntry | null>(null);
  const [handoffAck, setHandoffAck] = useState(false);
  const sectionLabels: Readonly<Record<SettingsSection, string>> = {
    connections: copy.connections,
    devices: copy.devicesAndRuntime,
    license: copy.license,
    sync: copy.syncPreferences,
    about: copy.about,
  };
  const holder = leaseHolder(devices);
  const closeHandoff = () => { setHandoffTarget(null); setHandoffAck(false); };
  const cadenceLabel = (cadence: PullRefreshCadence) => cadence === "when_visible" ? copy.whenVisible : cadence === "every_5_minutes" ? copy.every5Minutes : copy.every15Minutes;

  return (
    <section className="settings" aria-label={copy.title}>
      <nav className="settings-nav" aria-label={copy.title}>
        {settingsSections.map((key) => (
          <button key={key} type="button" className={`settings-nav-item${section === key ? " settings-nav-item--active" : ""}`} aria-current={section === key ? "page" : undefined} onClick={() => setSection(key)}>
            {sectionLabels[key]}
          </button>
        ))}
      </nav>
      <div className="settings-content">
        <div className="settings-column">
          {section === "connections" ? (
            <ConnectionsSection locale={locale} view={connections} {...(onConnectionAction === undefined ? {} : { onAction: onConnectionAction })} />
          ) : null}
          {section === "connections" ? (
            <div className="settings-notes">
              <span className="gd-t-meta">{connections.surface === "standby" ? copy.connectionReadOnlyNotice : copy.platformCredentialNotice}</span>
              {connections.surface === "active" ? <span className="gd-t-meta">{copy.multiAccountIsolationNotice}</span> : null}
              {connections.surface === "active" && (onAddConnection !== undefined || onRunOnboarding !== undefined) ? (
                <div className="settings-row">
                  {onAddConnection === undefined ? null : <Button size="sm" variant="primary" onClick={onAddConnection}>{copy.addAccountConnection}</Button>}
                  {onRunOnboarding === undefined ? null : <Button size="sm" onClick={onRunOnboarding}>{copy.rerunOnboarding}</Button>}
                  {onRunOnboarding === undefined ? null : <span className="gd-t-meta">{copy.onboardingScope}</span>}
                </div>
              ) : null}
            </div>
          ) : null}

          {section === "devices" ? (
            <>
              <Panel flush title={copy.deviceExecutionTitle} actions={devices.leaseEpoch === null ? null : <span className="settings-mono settings-gold">{copy.epoch} {formatNumber(locale, devices.leaseEpoch)}</span>}>
                {devices.devices.map((device) => (
                  <DeviceRow
                    key={device.id}
                    locale={locale}
                    device={device}
                    epoch={device.id === holder?.id ? devices.leaseEpoch : null}
                    {...(onHandoff !== undefined && canHandoffTo(devices, device.id) ? { onHandoff: () => { setHandoffAck(false); setHandoffTarget(device); } } : {})}
                  />
                ))}
              </Panel>
              <div className="settings-legend">
                <img src={activeLeaseUrl} width="26" height="26" alt="" />
                <span>{copy.leaseLegend}</span>
              </div>
            </>
          ) : null}

          {section === "license" ? (
            <Panel title={copy.licenseOwnership} actions={license === null ? <Badge mono={false}>{copy.notInitialized}</Badge> : <Badge tone="gold" mono={false}>{license.planLabel}</Badge>}>
              {license === null ? <span className="gd-t-meta">{copy.notInitialized}</span> : (
                <div className="settings-license">
                  <img src={keyholeUrl} width="30" height="30" alt="" />
                  <div className="settings-license-body">
                    <KeyValueList>
                      <KeyValueRow label={copy.licenseLabel} value={fill(copy.licenseValidUntil, { plan: license.planLabel, date: formatDate(locale, Date.parse(`${license.validUntil}T00:00:00Z`), { timeZone: "UTC" }) })} />
                      <KeyValueRow label={copy.ownershipVerification} value={license.ownershipVerified ? <span className="settings-success">{copy.verified}</span> : <span className="settings-warning">{copy.notVerified}</span>} />
                      <KeyValueRow label={copy.workspaceLabel} value={license.workspaceSummary} tone="muted" />
                    </KeyValueList>
                    <div className="settings-row settings-row--end">
                      {onManageSubscription === undefined ? null : <Button size="sm" variant="ghost" icon={<ExternalLinkIcon size={13} />} onClick={onManageSubscription}>{copy.manageSubscription}</Button>}
                      {onRenew === undefined ? null : <Button size="sm" onClick={onRenew}>{copy.renew}</Button>}
                    </div>
                  </div>
                </div>
              )}
            </Panel>
          ) : null}

          {section === "sync" ? (
            <Panel title={copy.syncPreferences}>
              <KeyValueList>
                {/* Business synchronization is mandatory, so the switch only reports the policy. */}
                <KeyValueRow label={copy.autoSync} value={<Switch checked={sync.businessSynchronization === "mandatory"} disabled label={<span className="settings-sr">{copy.autoSync}</span>} />} />
                <KeyValueRow
                  label={copy.pullRefresh}
                  value={(
                    <Select
                      size="sm"
                      aria-label={copy.pullRefresh}
                      disabled={onPullRefreshChange === undefined}
                      options={cadences.map((cadence) => ({ value: cadence, label: cadenceLabel(cadence) }))}
                      value={sync.pullRefreshCadence}
                      onChange={(event) => { const next = cadences.find((cadence) => cadence === event.currentTarget.value); if (next !== undefined) onPullRefreshChange?.(next); }}
                    />
                  )}
                />
                <KeyValueRow label={copy.conflictPolicy} value={<Select size="sm" aria-label={copy.conflictPolicy} disabled options={[{ value: sync.conflictResolution, label: copy.alwaysManual }]} value={sync.conflictResolution} />} />
              </KeyValueList>
              <div className="settings-notes settings-notes--inset">
                <span className="gd-t-meta">{copy.cloudSyncRequired}</span>
                <span className="gd-t-meta">{copy.syncCadence}</span>
                <span className="gd-t-meta">{copy.offlineReadOnly}</span>
              </div>
            </Panel>
          ) : null}

          {section === "about" ? (
            <Panel title={copy.about}>
              <KeyValueList>
                <KeyValueRow
                  label={copy.locale}
                  value={(
                    <Select
                      size="sm"
                      aria-label={copy.locale}
                      disabled={onLocaleChange === undefined}
                      options={supportedLocales.map((value) => ({ value, label: value === defaultLocale ? copy.simplifiedChinese : copy.englishLanguage }))}
                      value={locale}
                      onChange={(event) => { const next = event.currentTarget.value; if (isLocale(next)) onLocaleChange?.(next); }}
                    />
                  )}
                />
                <KeyValueRow label={copy.version} value={about.version} mono tone="muted" />
                <KeyValueRow label={copy.localDataDirectory} value={about.dataDirectory} mono tone="muted" />
                <KeyValueRow label={copy.revisionBase} value={formatNumber(locale, about.revisionBase)} mono tone="muted" />
              </KeyValueList>
            </Panel>
          ) : null}
        </div>
      </div>

      <Dialog
        open={handoffTarget !== null}
        onClose={closeHandoff}
        title={copy.transferTitle}
        width={512}
        footer={handoffTarget === null ? null : (
          <>
            <Button onClick={closeHandoff}>{copy.cancel}</Button>
            <Button variant="primary" disabled={!handoffAck} onClick={() => { onHandoff?.(handoffTarget.id); closeHandoff(); }}>{fill(copy.handoffTo, { name: handoffTarget.name })}</Button>
          </>
        )}
      >
        {handoffTarget === null || holder === null ? null : (
          <div className="settings-dialog">
            <span className="gd-t-body">{fill(copy.handoffDescription, { from: holder.self ? fill(copy.selfDeviceName, { name: holder.name }) : holder.name, to: handoffTarget.name })}</span>
            <div className="settings-steps">
              <span><b>{copy.handoffDrainStep}</b>{copy.handoffDrainDetail}</span>
              <span><b>{copy.handoffActivateStep}</b>{fill(copy.handoffActivateDetail, { name: handoffTarget.name })}</span>
              {devices.leaseEpoch === null ? null : (
                <span><b>{copy.handoffEpochStep}</b>{fill(copy.handoffEpochDetail, { from: formatNumber(locale, devices.leaseEpoch), to: formatNumber(locale, devices.leaseEpoch + 1) })}</span>
              )}
            </div>
            <div className="settings-ack"><Checkbox checked={handoffAck} onChange={() => setHandoffAck((value) => !value)} label={copy.transferAck} /></div>
          </div>
        )}
      </Dialog>
    </section>
  );
}

function ConnectionsSection({ locale, view, onAction }: {
  readonly locale: Locale;
  readonly view: ConnectionSettingsViewModel;
  readonly onAction?: (connection: ConnectionSettingsItemViewModel, action: ConnectionSettingsAction) => void;
}) {
  const copy = getPresentationCopy(locale, "settings");
  const groups = { registrar: [copy.registrar, copy.registrarDescription], dns: [copy.dnsProvider, copy.dnsProviderDescription], marketplace: [copy.salesPlatform, copy.salesPlatformDescription] } as const;
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const checked = (value: string | null) => value === null ? "—" : formatDate(locale, Date.parse(value), { hour: "2-digit", minute: "2-digit", hour12: false, timeZone });
  const actionLabel = (action: ConnectionSettingsAction) => action === "connect" ? copy.connect : action === "reauthorize" ? copy.reauthorize : copy.manage;

  return (
    <>
      {view.groups.map((group) => (
        <Panel key={group.category} flush title={groups[group.category][0]} actions={<span className="gd-t-meta">{groups[group.category][1]}</span>}>
          {group.connections.length === 0 ? <div className="settings-conn settings-faint">{copy.neverConfigured}</div> : null}
          {group.connections.map((connection) => {
            const status = connectionStatus(connection);
            const admission = connection.admission;
            return (
              <div key={connection.providerConnectionId} className="settings-conn">
                <StatusDot kind={status.tone} pulse={status.tone === "sync"} />
                <span className="settings-conn-name">{connection.provider}</span>
                <span className="settings-conn-badge"><Badge tone={status.tone === "neutral" ? "neutral" : status.tone} mono={false}>{copy[status.copyKey]}</Badge></span>
                <span className="settings-conn-meta">{connection.accountAlias} · {connection.view === "active" ? connection.summary : copy.cannotVerifyOnStandby}</span>
                {connection.method === null ? null : <Tag>{methodLabel[connection.method]}</Tag>}
                <span className="settings-conn-time">{connection.view === "active" ? checked(connection.lastCheckedAt) : copy.readOnly}</span>
                <span className="settings-conn-action">
                  {admission.actionAvailability === "available" && onAction !== undefined ? (
                    <Button size="sm" variant={admission.action === "connect" ? "primary" : admission.action === "manage" ? "ghost" : "secondary"} onClick={() => onAction(connection, admission.action)}>{actionLabel(admission.action)}</Button>
                  ) : null}
                </span>
              </div>
            );
          })}
        </Panel>
      ))}
    </>
  );
}

function DeviceRow({ locale, device, epoch, onHandoff }: {
  readonly locale: Locale;
  readonly device: DeviceRuntimeEntry;
  readonly epoch: number | null;
  readonly onHandoff?: () => void;
}) {
  const copy = getPresentationCopy(locale, "settings");
  const busy = device.state === "activating" || device.state === "draining";
  const [dot, badge, meta] = device.state === "active" ? ["active", <Badge key="b" tone="gold">ACTIVE</Badge>, copy.holdsLease] as const
    : device.state === "standby" ? ["standby", <Badge key="b" mono={false}>Standby</Badge>, copy.standbyMeta] as const
      : device.state === "activating" ? ["sync", <Badge key="b" tone="sync" mono={false}>{copy.activatingDevice}</Badge>, copy.activatingMeta] as const
        : ["warning", <Badge key="b" tone="warning" mono={false}>{copy.drainingDevice}</Badge>, copy.drainingMeta] as const;
  return (
    <div className={`settings-device${device.state === "active" ? " settings-device--active" : ""}`}>
      <MonitorIcon size={17} className={device.state === "active" ? "settings-gold" : "settings-muted"} />
      <div className="settings-device-id">
        <span className="settings-device-name">{device.name}{device.self ? <span className="settings-self">{copy.thisDevice}</span> : null}</span>
        <span className="settings-row">
          <StatusDot kind={dot} pulse={busy} />
          {badge}
          {device.state === "active" && epoch !== null ? <span className="settings-mono settings-gold">{copy.epoch} {formatNumber(locale, epoch)}</span> : null}
        </span>
      </div>
      <span className="settings-device-meta">{meta}</span>
      <span className="settings-conn-time">{device.lastSeenLabel}</span>
      <span className="settings-conn-action">
        {onHandoff === undefined ? null : <Button size="sm" onClick={onHandoff}>{copy.handoff}</Button>}
        {busy ? <RefreshCwIcon size={14} className="settings-muted settings-spin" /> : null}
      </span>
    </div>
  );
}
