import { canonicalUtcTimestamp } from "@gooddealer/protocol/wire";
import { z } from "zod";
import { canonicalDomainNameSchema, copyPlainData } from "../portfolio/index";

const connectionIdSchema = z.uuidv4().refine((value) => value === value.toLowerCase());
const version = z.literal(1);
const count = z.number().int().min(0).max(10_000);
const standardSampleLimit = 12;
const standardReviewSchema = z.object({
  observed: count,
  sample: z.array(canonicalDomainNameSchema).max(standardSampleLimit),
}).strict().refine(({ observed, sample }) =>
  sample.length === Math.min(observed, standardSampleLimit) &&
  sample.every((domain, i) => i === 0 || sample[i - 1]! < domain));

const scanSchema = z.object({
  observed: count,
  imported: count,
  skipped: count,
  completedAt: canonicalUtcTimestamp,
  standardReview: standardReviewSchema.nullable(),
}).strict().refine((scan) => scan.imported + scan.skipped <= scan.observed
  && (scan.standardReview === null || scan.standardReview.observed <= scan.observed - scan.skipped));

export const atomMarketplaceIntentSchema = z.discriminatedUnion("action", [
  z.object({ schemaVersion: version, action: z.literal("connect") }).strict(),
  z.object({ schemaVersion: version, action: z.literal("refresh"), connectionId: connectionIdSchema }).strict(),
  z.object({ schemaVersion: version, action: z.literal("revoke"), connectionId: connectionIdSchema }).strict(),
]);

const statusSchema = z.object({
  schemaVersion: version,
  observeQualified: z.boolean(),
  observeEntitled: z.boolean(),
  capturable: z.boolean(),
  laneState: z.enum(["recovering", "ready", "busy", "blocked"]),
  connections: z.array(z.object({
    connectionId: connectionIdSchema,
    state: z.enum(["prepared", "active", "revoked"]),
    scanPending: z.boolean(),
    lastScan: scanSchema.nullable(),
  }).strict().refine((row) => {
    if (row.state === "revoked") return !row.scanPending && row.lastScan?.standardReview == null;
    if (row.state === "prepared") return row.scanPending && row.lastScan === null;
    return row.lastScan !== null;
  })).max(64),
  lastOperation: z.object({
    kind: z.enum(["atom_connect", "atom_refresh", "atom_revoke"]),
    outcome: z.enum(["confirmed", "unqualified", "unreachable", "retry_later", "credential_rejected",
      "credential_store_unavailable", "local_operation_blocked", "provider_response_rejected", "capture_incomplete", "failed"]),
  }).strict().nullable(),
}).strict().refine(({ connections }) =>
  new Set(connections.map((row) => row.connectionId)).size === connections.length);

export type AtomMarketplaceIntent = z.infer<typeof atomMarketplaceIntentSchema>;
export type AtomMarketplaceStatus = z.infer<typeof statusSchema>;

export interface AtomMarketplacePort {
  status(): Promise<AtomMarketplaceStatus>;
  submit(intent: AtomMarketplaceIntent): Promise<void>;
}

export function parseAtomMarketplaceStatus(value: unknown): AtomMarketplaceStatus {
  const parsed = statusSchema.safeParse(copyPlainData(value));
  if (!parsed.success) throw new TypeError("invalid Atom seller portfolio projection");
  return parsed.data;
}
