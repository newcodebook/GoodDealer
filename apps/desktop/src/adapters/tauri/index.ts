import { invoke } from "@tauri-apps/api/core";

export interface LocalBusinessStatus {
  readonly schemaVersion: 1;
  readonly state: "authorization_required" | "ready";
}

export interface LocalDomainAsset {
  readonly entityId: string;
  readonly note: string | null;
  readonly portfolioId: string | null;
  readonly tags: readonly string[];
  readonly targetPrice: { readonly currency: string; readonly amount: string } | null;
}

export interface LocalPortfolioSnapshot {
  readonly workspaceId: string;
  readonly domains: readonly LocalDomainAsset[];
  readonly appliedThroughServerRevision: number;
  readonly lastReplicationActivityAt: string | null;
  readonly lastSuccessfulProviderObservationAt: string | null;
}

export interface LocalDomainAssetUpsert {
  readonly mutationId: string;
  readonly createdAt: string;
  readonly asset: LocalDomainAsset;
}

export interface LocalBusinessPort {
  status(): Promise<LocalBusinessStatus>;
  readPortfolio(): Promise<LocalPortfolioSnapshot>;
  upsertDomainAsset(request: LocalDomainAssetUpsert): Promise<void>;
}

const commands = {
  status: "local_business_status",
  readPortfolio: "local_portfolio_read",
  upsertDomainAsset: "local_domain_asset_upsert",
} as const;

/** The adapter exposes only named local business capabilities; it has no path, key, SQL, or Cloud API. */
export function createLocalBusinessPort(): LocalBusinessPort {
  return {
    async status() {
      return parseStatus(await invoke(commands.status));
    },
    async readPortfolio() {
      return parsePortfolio(await invoke(commands.readPortfolio));
    },
    async upsertDomainAsset(request) {
      await invoke(commands.upsertDomainAsset, { request });
    },
  };
}

function parseStatus(value: unknown): LocalBusinessStatus {
  const record = exactRecord(value, ["schemaVersion", "state"]);
  if (
    record["schemaVersion"] !== 1 ||
    (record["state"] !== "authorization_required" && record["state"] !== "ready")
  ) {
    throw new TypeError("invalid local business status");
  }
  return Object.freeze({ schemaVersion: 1, state: record["state"] });
}

function parsePortfolio(value: unknown): LocalPortfolioSnapshot {
  const record = exactRecord(value, [
    "workspaceId",
    "domains",
    "appliedThroughServerRevision",
    "lastReplicationActivityAt",
    "lastSuccessfulProviderObservationAt",
  ]);
  if (
    typeof record["workspaceId"] !== "string" ||
    !Array.isArray(record["domains"]) ||
    !Number.isSafeInteger(record["appliedThroughServerRevision"]) ||
    (record["lastReplicationActivityAt"] !== null && typeof record["lastReplicationActivityAt"] !== "string") ||
    (record["lastSuccessfulProviderObservationAt"] !== null && typeof record["lastSuccessfulProviderObservationAt"] !== "string")
  ) {
    throw new TypeError("invalid local portfolio snapshot");
  }
  const domains = record["domains"].map(parseDomainAsset);
  return Object.freeze({
    workspaceId: record["workspaceId"],
    domains: Object.freeze(domains),
    appliedThroughServerRevision: record["appliedThroughServerRevision"] as number,
    lastReplicationActivityAt: record["lastReplicationActivityAt"] as string | null,
    lastSuccessfulProviderObservationAt: record["lastSuccessfulProviderObservationAt"] as string | null,
  });
}

function parseDomainAsset(value: unknown): LocalDomainAsset {
  const record = exactRecord(value, ["entityId", "note", "portfolioId", "tags", "targetPrice"]);
  if (
    typeof record["entityId"] !== "string" ||
    (record["note"] !== null && typeof record["note"] !== "string") ||
    (record["portfolioId"] !== null && typeof record["portfolioId"] !== "string") ||
    !Array.isArray(record["tags"]) ||
    !record["tags"].every((tag) => typeof tag === "string")
  ) {
    throw new TypeError("invalid local domain asset");
  }
  let targetPrice: LocalDomainAsset["targetPrice"] = null;
  if (record["targetPrice"] !== null) {
    const money = exactRecord(record["targetPrice"], ["currency", "amount"]);
    if (typeof money["currency"] !== "string" || typeof money["amount"] !== "string") {
      throw new TypeError("invalid local money");
    }
    targetPrice = Object.freeze({ currency: money["currency"], amount: money["amount"] });
  }
  return Object.freeze({
    entityId: record["entityId"],
    note: record["note"] as string | null,
    portfolioId: record["portfolioId"] as string | null,
    tags: Object.freeze([...(record["tags"] as string[])]),
    targetPrice,
  });
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("invalid local business response");
  }
  const record = value as Record<string, unknown>;
  const observed = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (observed.length !== expected.length || observed.some((key, index) => key !== expected[index])) {
    throw new TypeError("invalid local business response shape");
  }
  return record;
}
