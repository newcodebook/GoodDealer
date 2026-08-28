import { formatDate, formatNumber, getPresentationCopy, type Locale } from "@gooddealer/i18n";
import {
  AlertTriangleIcon,
  Badge,
  Banner,
  Button,
  CheckIcon,
  KeyValueList,
  KeyValueRow,
  Panel,
  RefreshCwIcon,
} from "@gooddealer/ui";
import type { ReactElement } from "react";

import type { CloudflareConnectionState } from "./connection-presentation-contract";
import "./connection-settings.css";

export interface CloudflareConnectionPresentationProps {
  readonly locale: Locale;
  readonly presentation: CloudflareConnectionState;
  readonly onRetryRead?: () => void;
}

function statePresentation(
  locale: Locale,
  presentation: CloudflareConnectionState,
): { readonly label: string; readonly tone: "success" | "warning" | "danger" | "neutral" } {
  const settings = getPresentationCopy(locale, "settings");
  const dns = getPresentationCopy(locale, "dnsVerification");
  switch (presentation.state) {
    case "available":
      return { label: settings.connected, tone: "success" };
    case "loading":
    case "checking":
      return { label: settings.verifying, tone: "neutral" };
    case "not-configured":
      return { label: settings.neverConfigured, tone: "neutral" };
    case "stale":
      return { label: settings.retainedNotVerified, tone: "warning" };
    case "uncertain":
      return { label: settings.unknown, tone: "warning" };
    case "unavailable":
      return { label: settings.notConnected, tone: "warning" };
    case "error":
      return { label: dns.invalid, tone: "danger" };
  }
}

function canRetry(presentation: CloudflareConnectionState): boolean {
  return presentation.state === "stale" ||
    presentation.state === "uncertain" ||
    presentation.state === "unavailable" ||
    presentation.state === "error";
}

function formatObservedAt(locale: Locale, value: string | null, fallback: string): string {
  if (value === null) return fallback;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return fallback;
  return formatDate(locale, timestamp, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  });
}

export function CloudflareConnectionPresentation({
  locale,
  presentation,
  onRetryRead,
}: CloudflareConnectionPresentationProps): ReactElement {
  const settings = getPresentationCopy(locale, "settings");
  const dns = getPresentationCopy(locale, "dnsVerification");
  const history = getPresentationCopy(locale, "operationHistory");
  const detail = getPresentationCopy(locale, "domainDetail");
  const status = statePresentation(locale, presentation);
  const hasObservation = presentation.state === "available" ||
    presentation.state === "stale" ||
    presentation.state === "uncertain";
  const observedAt = hasObservation ? presentation.observedAt : null;
  const version = hasObservation ? presentation.version : null;
  const guidance = presentation.state === "not-configured" ||
    presentation.state === "unavailable" ||
    presentation.state === "error"
    ? presentation.manualGuidance
    : null;
  const issueCode = presentation.state === "unavailable" || presentation.state === "error"
    ? presentation.code
    : null;
  const availability = presentation.state === "available" || presentation.state === "stale" ||
    (presentation.state === "uncertain" && (
      presentation.zoneName !== null || presentation.observedAt !== null || presentation.version !== null
    ))
    ? "available"
    : "unavailable";
  const uncertainty = presentation.state === "available"
    ? "confirmed"
    : presentation.state === "stale"
      ? "stale"
      : "unknown";

  return (
    <section
      className="gd-cloudflare-connection"
      aria-label={settings.connections}
      data-state={presentation.state}
      data-availability={availability}
      data-uncertainty={uncertainty}
    >
      <Panel
        title={settings.connections}
        actions={<Badge tone={status.tone} mono={false}>{status.label}</Badge>}
      >
        <div className="gd-cloudflare-connection-heading">
          <span className="gd-cloudflare-mark" aria-hidden="true">CF</span>
          <div>
            <strong>Cloudflare</strong>
            <span>Zone DNS</span>
          </div>
        </div>

        {presentation.state === "stale" || presentation.state === "uncertain" ? (
          <Banner tone="warning" icon={<AlertTriangleIcon size={15} />} title={status.label}>
            {settings.offlineReadOnly}
          </Banner>
        ) : null}
        {guidance ? (
          <Banner
            tone={presentation.state === "error" ? "danger" : "warning"}
            icon={<AlertTriangleIcon size={15} />}
            title={status.label}
            role={presentation.state === "error" ? "alert" : "status"}
          >
            <bdi dir="auto">{guidance}</bdi>
          </Banner>
        ) : null}

        <KeyValueList>
          <KeyValueRow label={history.source} value="Cloudflare Zone DNS" mono />
          <KeyValueRow
            label={detail.status}
            value={<span>{status.label} · <code>{availability}</code> · <code>{uncertainty}</code></span>}
            tone={status.tone === "danger" ? "danger" : "body"}
          />
          {presentation.state === "checking" || hasObservation ? (
            <KeyValueRow
              label={settings.connections}
              value={<bdi dir="auto">{presentation.connectionLabel}</bdi>}
            />
          ) : null}
          {hasObservation ? (
            <KeyValueRow
              label={dns.domain}
              value={presentation.zoneName === null
                ? settings.unknown
                : <bdi dir="auto">{presentation.zoneName}</bdi>}
              mono
            />
          ) : null}
          <KeyValueRow
            label={dns.lastChecked}
            value={formatObservedAt(locale, observedAt, settings.unknown)}
            mono
          />
          <KeyValueRow
            label={settings.version}
            value={version === null ? settings.unknown : formatNumber(locale, version)}
            mono
          />
          {issueCode ? <KeyValueRow label={dns.status} value={issueCode} mono tone="danger" /> : null}
        </KeyValueList>

        <div className="gd-cloudflare-connection-footer">
          <span>
            {presentation.state === "available" ? <CheckIcon size={13} /> : <AlertTriangleIcon size={13} />}
            {presentation.state === "available" ? settings.connected : settings.readOnly}
          </span>
          {canRetry(presentation) && onRetryRead ? (
            <Button type="button" size="sm" variant="secondary" icon={<RefreshCwIcon size={13} />} onClick={onRetryRead}>
              {dns.retryValidation}
            </Button>
          ) : null}
        </div>
      </Panel>
    </section>
  );
}
