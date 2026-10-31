import { formatDate, getAccountCopy, type Locale } from "@gooddealer/i18n";
import {
  AlertTriangleIcon,
  Badge,
  Banner,
  Button,
  Checkbox,
  Dialog,
  DownloadIcon,
  MetricStrip,
  MonitorIcon,
  Panel,
  StatusDot,
} from "@gooddealer/ui";
import activeLeaseUrl from "@gooddealer/ui/assets/icons/active-lease.svg";
import { useState } from "react";

import "./account-devices.css";

/**
 * A bound device as Account Web may show it. Only Active and Standby exist on the account side:
 * a removed device leaves the list, and local continuation is a Desktop-only concept.
 */
export interface AccountDeviceView {
  readonly deviceId: string;
  readonly displayName: string;
  readonly platform: string;
  readonly state: "active" | "standby";
  /** The ActiveDeviceLease epoch, present only on the Active device. */
  readonly leaseEpoch: number | null;
  readonly boundAt: string;
  readonly lastSeenAt: string;
}

export interface AccountDevicesProps {
  readonly locale: Locale;
  readonly timeZone: string;
  readonly devices: readonly AccountDeviceView[];
  readonly deviceLimit: number;
  readonly busy: boolean;
  readonly onRemove: (deviceId: string) => void;
  readonly onOpenDownload: () => void;
}

/**
 * Devices and execution rights. The web side shows lease state and can remove a Standby device to
 * free a slot; handing execution rights over needs both devices present, so it stays in Desktop.
 */
export function AccountDevices(props: AccountDevicesProps) {
  const { locale, timeZone, devices, deviceLimit, busy } = props;
  const copy = getAccountCopy(locale, "accountDevices");
  const shellCopy = getAccountCopy(locale, "accountShell");
  const [removing, setRemoving] = useState<AccountDeviceView | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const active = devices.find((device) => device.state === "active") ?? null;
  const full = devices.length >= deviceLimit;
  const date = (value: string) => formatDate(locale, Date.parse(value), { year: "numeric", month: "2-digit", day: "2-digit", timeZone });
  const dateTime = (value: string) => formatDate(locale, Date.parse(value), { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", timeZone });
  const count = (template: string) => template.replace("{count}", String(devices.length)).replace("{limit}", String(deviceLimit));
  const close = () => { setRemoving(null); setAcknowledged(false); };

  return (
    <div className="devices">
      {/* Three facts the list cannot show at a glance. Standby count and quota are already the two
          halves of "bound / limit". Gold marks only the Active device (ownership of execution rights);
          the Epoch is a system counter and stays neutral. */}
      <MetricStrip
        wrap
        metrics={[
          { key: "bound", label: copy.metricBound, value: count(copy.boundValue), meta: copy.metricBoundMeta.replace("{limit}", String(deviceLimit)) },
          { key: "active", label: copy.metricActive, value: active?.displayName ?? "—", tone: active === null ? "muted" : "gold", mono: false, meta: active === null ? copy.noActive : copy.metricActiveMeta },
          { key: "epoch", label: copy.metricEpoch, value: active?.leaseEpoch == null ? "—" : copy.epochValue.replace("{epoch}", String(active.leaseEpoch)), tone: active?.leaseEpoch == null ? "muted" : "body", meta: copy.metricEpochMeta },
        ]}
      />
      <div className="devices-body">
        <Panel flush title={copy.listTitle}>
          {devices.length === 0 ? (
            <div className="devices-empty">
              <MonitorIcon size={22} />
              <span className="devices-empty-title">{copy.empty}</span>
              <span className="gd-t-body-2">{copy.emptyDetail}</span>
              <Button size="sm" icon={<DownloadIcon size={13} />} onClick={props.onOpenDownload}>{copy.openDownload}</Button>
            </div>
          ) : devices.map((device) => (
            <div key={device.deviceId} className={`devices-row devices-row--${device.state}`}>
              <MonitorIcon size={19} className="devices-row-icon" />
              <div className="devices-row-identity">
                <span className="devices-row-name">{device.displayName}</span>
                <span className="devices-row-state">
                  <StatusDot kind={device.state} />
                  {device.state === "active" ? <Badge tone="gold">{copy.stateActive}</Badge> : <Badge tone="neutral" mono={false}>{copy.stateStandby}</Badge>}
                  {device.leaseEpoch === null ? null : <span className="devices-epoch">{copy.epochValue.replace("{epoch}", String(device.leaseEpoch))}</span>}
                </span>
              </div>
              <div className="devices-row-meta">
                <span className="devices-row-role">{device.state === "active" ? copy.activeMeta : copy.standbyMeta}</span>
                <span className="devices-row-facts">{device.platform} · {copy.boundOn.replace("{date}", date(device.boundAt))}</span>
              </div>
              <span className="devices-row-seen">{copy.lastSeen.replace("{time}", dateTime(device.lastSeenAt))}</span>
              <span className="devices-row-actions">
                {/* The Active device is never removable here: it must hand off in Desktop first. */}
                {device.state === "active" ? null : (
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => setRemoving(device)}>{copy.remove}</Button>
                )}
              </span>
            </div>
          ))}
        </Panel>

        <div className="devices-cards">
          <section className="devices-card">
            <img src={activeLeaseUrl} width="30" height="30" alt="" />
            <div className="devices-card-copy">
              <span className="devices-card-title">{copy.leaseTitle}</span>
              <span className="gd-t-body-2">{copy.leaseBody}</span>
            </div>
          </section>
          <section className="devices-card devices-card--bind">
            <span className="devices-card-title">{copy.bindTitle}</span>
            {full ? (
              <Banner tone="warning" icon={<AlertTriangleIcon size={15} />}>{count(copy.quotaFull)}</Banner>
            ) : (
              <ol className="devices-steps">
                {[copy.bindStepInstall, copy.bindStepBrowser, copy.bindStepPassword, copy.bindStepReturn].map((step, index) => (
                  <li key={step}><span className="devices-step-index">{index + 1}</span>{step}</li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </div>

      <Dialog
        open={removing !== null}
        onClose={close}
        closeLabel={shellCopy.close}
        title={copy.removeTitle}
        width={480}
        danger
        footer={(
          <>
            <Button onClick={close}>{copy.dismiss}</Button>
            <Button
              variant="danger"
              disabled={busy || !acknowledged}
              onClick={() => {
                if (removing === null) return;
                props.onRemove(removing.deviceId);
                close();
              }}
            >
              {copy.confirmRemove.replace("{device}", removing?.displayName ?? "")}
            </Button>
          </>
        )}
      >
        {removing === null ? null : (
          <div className="devices-dialog">
            <span className="devices-dialog-lead">{copy.removeLead.replace("{device}", removing.displayName)}</span>
            <div className="devices-dialog-facts">
              <span>{copy.removeConsequence}</span>
              <span>{copy.removeQuota.replace("{from}", `${devices.length}/${deviceLimit}`).replace("{to}", `${devices.length - 1}/${deviceLimit}`)}</span>
              <span>{copy.removeActiveUnaffected}</span>
            </div>
            <div className="devices-dialog-ack">
              <Checkbox checked={acknowledged} onChange={() => setAcknowledged((value) => !value)} label={copy.removeAck.replace("{device}", removing.displayName)} />
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
