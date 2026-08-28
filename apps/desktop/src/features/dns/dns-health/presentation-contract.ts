export type DnsRecordType = "A" | "AAAA" | "CAA" | "CNAME" | "MX" | "NS" | "SRV" | "TXT";
export type DnsRecordFilter = "all" | DnsRecordType;

export interface DnsObservationMeta {
  readonly source: "cloudflare-zone-dns";
  readonly observedAt: string | null;
  readonly version: number;
  readonly availability: "available" | "unavailable";
  readonly uncertainty: "confirmed" | "stale" | "conflicted" | "unknown";
}

export interface ObservedDnsRecord {
  readonly recordId: string;
  readonly fqdn: string;
  readonly type: DnsRecordType;
  readonly displayValue: string;
  readonly ttl: number | null;
  readonly proxied: boolean;
  readonly providerVersionToken: number;
  readonly classification: "ordinary" | "redacted";
}

export interface ZoneDnsObservationData {
  readonly zoneId: string;
  readonly zoneLabel: string;
  readonly zoneStatus: "active" | "pending" | "moved" | "unknown";
  readonly records: readonly ObservedDnsRecord[];
}

export type ZoneDnsObservationState =
  | { readonly state: "loading" }
  | {
      readonly state: "empty";
      readonly meta: DnsObservationMeta & { readonly availability: "available" };
      readonly manualGuidance: string;
    }
  | {
      readonly state: "available";
      readonly meta: DnsObservationMeta & {
        readonly availability: "available";
        readonly uncertainty: "confirmed";
      };
      readonly data: ZoneDnsObservationData;
    }
  | {
      readonly state: "stale";
      readonly meta: DnsObservationMeta & {
        readonly availability: "available";
        readonly uncertainty: "stale";
      };
      readonly data: ZoneDnsObservationData;
    }
  | {
      readonly state: "uncertain";
      readonly meta: DnsObservationMeta & {
        readonly availability: "available";
        readonly uncertainty: "conflicted" | "unknown";
      };
      readonly data: ZoneDnsObservationData | null;
      readonly manualGuidance: string;
    }
  | {
      readonly state: "uncertain";
      readonly meta: DnsObservationMeta & {
        readonly availability: "unavailable";
        readonly uncertainty: "conflicted" | "unknown";
      };
      readonly data: null;
      readonly manualGuidance: string;
    }
  | {
      readonly state: "unavailable";
      readonly code: "authentication" | "permission" | "rate-limited" | "temporarily-unavailable" | "invalid-observation";
      readonly retryAfterSeconds: number | null;
      readonly manualGuidance: string;
    }
  | {
      readonly state: "error";
      readonly code: "invalid-projection" | "read-failed";
      readonly manualGuidance: string;
    };

export interface ZoneDnsObservationActions {
  readonly onQueryChange?: (query: string) => void;
  readonly onRecordFilterChange?: (filter: DnsRecordFilter) => void;
  readonly onRetryRead?: () => void;
}
