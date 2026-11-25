import { canonicalUtcTimestamp } from "@gooddealer/protocol/wire";
import { z } from "zod";
import { canonicalDomainNameSchema } from "../portfolio/domain-name";
import { copyPlainData } from "../portfolio/index";

const connectionIdSchema = z.uuidv4().refine((value) => value === value.toLowerCase());
const version = z.literal(1);
const count = z.number().int().min(0).max(10_000);
const scanSchema = z.object({
  observed: count,
  imported: count,
  skipped: count,
  completedAt: canonicalUtcTimestamp,
}).strict().refine((scan) => scan.imported + scan.skipped <= scan.observed);

export const porkbunRegistrarIntentSchema = z.discriminatedUnion("action", [
  z.object({ schemaVersion: version, action: z.literal("connect") }).strict(),
  z.object({ schemaVersion: version, action: z.literal("refresh"), connectionId: connectionIdSchema }).strict(),
  z.object({ schemaVersion: version, action: z.literal("revoke"), connectionId: connectionIdSchema }).strict(),
  // One read-only Zone record read of an asset in that connection's latest inventory.
  z.object({ schemaVersion: version, action: z.literal("observe-dns"), connectionId: connectionIdSchema,
    domain: canonicalDomainNameSchema }).strict(),
]);

const statusSchema = z.object({
  schemaVersion: version,
  observeQualified: z.boolean(),
  observeEntitled: z.boolean(),
  /** Zone record reads through the same connection, qualified and entitled on their own. */
  dnsObserve: z.object({ qualified: z.boolean(), entitled: z.boolean() }).strict(),
  capturable: z.boolean(),
  laneState: z.enum(["recovering", "ready", "busy", "blocked"]),
  connections: z.array(z.object({
    connectionId: connectionIdSchema,
    state: z.enum(["prepared", "active", "revoked"]),
    scanPending: z.boolean(),
    lastScan: scanSchema.nullable(),
  }).strict().refine((row) => {
    if (row.state === "revoked") return !row.scanPending;
    if (row.state === "prepared") return row.scanPending && row.lastScan === null;
    return row.lastScan !== null;
  })).max(64),
  lastOperation: z.object({
    kind: z.enum(["porkbun_connect", "porkbun_refresh", "porkbun_revoke", "porkbun_dns_observe"]),
    outcome: z.enum(["confirmed", "unqualified", "unreachable", "retry_later", "credential_rejected",
      "credential_store_unavailable", "local_operation_blocked", "provider_response_rejected", "capture_incomplete", "failed",
      "answered_elsewhere", "api_access_disabled", "not_in_account", "domain_not_active"]),
  }).strict().refine((operation) => operation.kind === "porkbun_dns_observe"
    || !["answered_elsewhere", "api_access_disabled", "not_in_account", "domain_not_active"].includes(operation.outcome))
    .nullable(),
}).strict().refine(({ connections }) =>
  new Set(connections.map((row) => row.connectionId)).size === connections.length);

export type PorkbunRegistrarIntent = z.infer<typeof porkbunRegistrarIntentSchema>;
export type PorkbunRegistrarStatus = z.infer<typeof statusSchema>;

export interface PorkbunRegistrarPort {
  status(): Promise<PorkbunRegistrarStatus>;
  submit(intent: PorkbunRegistrarIntent): Promise<void>;
}

export function parsePorkbunRegistrarStatus(value: unknown): PorkbunRegistrarStatus {
  const parsed = statusSchema.safeParse(copyPlainData(value));
  if (!parsed.success) throw new TypeError("invalid Porkbun registrar projection");
  return parsed.data;
}
