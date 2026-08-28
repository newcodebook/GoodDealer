import { formatDate, formatNumber, getPresentationCopy, type Locale } from "@gooddealer/i18n";
import {
  AlertTriangleIcon,
  Badge,
  Banner,
  Button,
  CheckIcon,
  Input,
  KeyValueList,
  KeyValueRow,
  Panel,
  RefreshCwIcon,
  SearchIcon,
  Select,
  Table,
  type TableColumn,
} from "@gooddealer/ui";
import type { ReactElement } from "react";

import type {
  DnsObservationMeta,
  DnsRecordFilter,
  ObservedDnsRecord,
  ZoneDnsObservationActions,
  ZoneDnsObservationState,
} from "./presentation-contract";
import "./zone-dns-observation.css";

export interface ZoneDnsObservationPresentationProps {
  readonly locale: Locale;
  readonly presentation: ZoneDnsObservationState;
  readonly query?: string;
  readonly recordFilter?: DnsRecordFilter;
  readonly actions?: ZoneDnsObservationActions;
}

interface ZoneDnsObservationReadSectionProps extends ZoneDnsObservationPresentationProps {
  readonly showControls: boolean;
}

const recordFilters: readonly DnsRecordFilter[] = [
  "all",
  "A",
  "AAAA",
  "CAA",
  "CNAME",
  "MX",
  "NS",
  "SRV",
  "TXT",
];

function isDnsRecordFilter(value: string): value is DnsRecordFilter {
  return recordFilters.some((filter) => filter === value);
}

function observationMeta(presentation: ZoneDnsObservationState): DnsObservationMeta | null {
  switch (presentation.state) {
    case "empty":
    case "available":
    case "stale":
    case "uncertain":
      return presentation.meta;
    case "loading":
    case "unavailable":
    case "error":
      return null;
  }
}

function observationData(presentation: ZoneDnsObservationState) {
  switch (presentation.state) {
    case "available":
    case "stale":
      return presentation.data;
    case "uncertain":
      return presentation.data;
    case "loading":
    case "empty":
    case "unavailable":
    case "error":
      return null;
  }
}

function canRetry(presentation: ZoneDnsObservationState): boolean {
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

export function ZoneDnsObservationReadSection({
  locale,
  presentation,
  query = "",
  recordFilter = "all",
  actions = {},
  showControls,
}: ZoneDnsObservationReadSectionProps): ReactElement {
  const dns = getPresentationCopy(locale, "dnsVerification");
  const detail = getPresentationCopy(locale, "domainDetail");
  const settings = getPresentationCopy(locale, "settings");
  const history = getPresentationCopy(locale, "operationHistory");
  const meta = observationMeta(presentation);
  const data = observationData(presentation);
  const normalizedQuery = query.trim().toLocaleLowerCase(locale);
  const rows = data?.records.filter((record) => {
    const matchesType = recordFilter === "all" || record.type === recordFilter;
    const matchesQuery = normalizedQuery === "" ||
      record.fqdn.toLocaleLowerCase(locale).includes(normalizedQuery) ||
      record.displayValue.toLocaleLowerCase(locale).includes(normalizedQuery);
    return matchesType && matchesQuery;
  }) ?? [];
  const statusLabel = presentation.state === "available"
    ? settings.connected
    : presentation.state === "loading"
      ? settings.verifying
      : presentation.state === "empty"
        ? dns.noRows
        : presentation.state === "stale"
          ? settings.retainedNotVerified
          : presentation.state === "uncertain"
            ? settings.unknown
            : presentation.state === "unavailable"
              ? settings.notConnected
              : dns.invalid;
  const guidance = presentation.state === "empty" ||
    presentation.state === "uncertain" ||
    presentation.state === "unavailable" ||
    presentation.state === "error"
    ? presentation.manualGuidance
    : presentation.state === "stale"
      ? settings.offlineReadOnly
      : null;
  const code = presentation.state === "unavailable" || presentation.state === "error"
    ? presentation.code
    : null;
  const availability = meta?.availability ?? "unavailable";
  const uncertainty = meta?.uncertainty ?? "unknown";

  const columns: readonly TableColumn<ObservedDnsRecord>[] = [
    {
      key: "type",
      label: dns.type,
      priority: "essential",
      width: 72,
      render: (record) => <code className="gd-zone-dns-type">{record.type}</code>,
    },
    {
      key: "fqdn",
      label: dns.domain,
      priority: "essential",
      render: (record) => <code><bdi dir="auto">{record.fqdn}</bdi></code>,
    },
    {
      key: "value",
      label: detail.value,
      priority: "essential",
      render: (record) => (
        <span className="gd-zone-dns-value">
          <code><bdi dir="auto">{record.displayValue}</bdi></code>
          {record.classification === "redacted" ? <Badge tone="neutral">{dns.redactedPreview}</Badge> : null}
        </span>
      ),
    },
    {
      key: "ttl",
      label: dns.ttl,
      priority: "secondary",
      numeric: true,
      muted: true,
      width: 80,
      render: (record) => record.ttl === null ? dns.auto : formatNumber(locale, record.ttl),
    },
    {
      key: "proxied",
      label: dns.status,
      priority: "supplementary",
      width: 96,
      render: (record) => record.proxied ? dns.normal : settings.readOnly,
    },
    {
      key: "providerVersionToken",
      label: settings.version,
      priority: "supplementary",
      numeric: true,
      muted: true,
      width: 78,
      render: (record) => formatNumber(locale, record.providerVersionToken),
    },
  ];

  return (
    <div
      className="gd-zone-dns-read"
      data-state={presentation.state}
      data-availability={availability}
      data-uncertainty={uncertainty}
    >
      {guidance ? (
        <Banner
          tone={presentation.state === "error" ? "danger" : "warning"}
          icon={<AlertTriangleIcon size={15} />}
          title={statusLabel}
          role={presentation.state === "error" ? "alert" : "status"}
        >
          <bdi dir="auto">{guidance}</bdi>
        </Banner>
      ) : null}

      <KeyValueList>
        <KeyValueRow label={history.source} value={meta?.source ?? "cloudflare-zone-dns"} mono />
        <KeyValueRow
          label={detail.status}
          value={<span>{statusLabel} · <code>{availability}</code> · <code>{uncertainty}</code></span>}
        />
        <KeyValueRow
          label={dns.lastChecked}
          value={formatObservedAt(locale, meta?.observedAt ?? null, settings.unknown)}
          mono
        />
        <KeyValueRow
          label={settings.version}
          value={meta === null ? settings.unknown : formatNumber(locale, meta.version)}
          mono
        />
        {data ? (
          <KeyValueRow label={dns.domain} value={<bdi dir="auto">{data.zoneLabel}</bdi>} mono />
        ) : null}
        {data ? <KeyValueRow label={dns.status} value={data.zoneStatus} mono /> : null}
        {code ? <KeyValueRow label={dns.status} value={code} mono tone="danger" /> : null}
      </KeyValueList>

      {showControls && data ? (
        <div className="gd-zone-dns-controls">
          <Input
            size="sm"
            prefix={<SearchIcon size={13} />}
            placeholder={dns.searchPlaceholder}
            value={query}
            onChange={(event) => actions.onQueryChange?.(event.currentTarget.value)}
          />
          <Select
            size="sm"
            aria-label={dns.type}
            options={recordFilters.map((filter) => ({
              value: filter,
              label: filter === "all" ? dns.all : filter,
            }))}
            value={recordFilter}
            onChange={(event) => {
              if (isDnsRecordFilter(event.currentTarget.value)) {
                actions.onRecordFilterChange?.(event.currentTarget.value);
              }
            }}
          />
        </div>
      ) : null}

      {data ? (
        <Table
          columns={columns}
          rows={rows}
          rowKey="recordId"
          density="compact"
          label={detail.dnsRecords}
          emptyText={dns.noRows}
        />
      ) : null}

      <div className="gd-zone-dns-footer">
        <span>
          {presentation.state === "available" ? <CheckIcon size={13} /> : <AlertTriangleIcon size={13} />}
          {statusLabel}
        </span>
        {canRetry(presentation) && actions.onRetryRead ? (
          <Button type="button" size="sm" variant="secondary" icon={<RefreshCwIcon size={13} />} onClick={actions.onRetryRead}>
            {dns.retryValidation}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function ZoneDnsObservationPresentation(
  props: ZoneDnsObservationPresentationProps,
): ReactElement {
  const detail = getPresentationCopy(props.locale, "domainDetail");
  return (
    <section className="gd-zone-dns-observation" aria-label={detail.dnsRecords}>
      <Panel title={detail.dnsRecords} flush>
        <ZoneDnsObservationReadSection {...props} showControls />
      </Panel>
    </section>
  );
}
