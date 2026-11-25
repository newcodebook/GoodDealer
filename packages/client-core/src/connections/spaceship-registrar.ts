import { canonicalUtcTimestamp } from "@gooddealer/protocol/wire";
import { z } from "zod";
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

export const spaceshipRegistrarIntentSchema = z.discriminatedUnion("action", [
  z.object({ schemaVersion: version, action: z.literal("connect") }).strict(),
  z.object({ schemaVersion: version, action: z.literal("refresh"), connectionId: connectionIdSchema }).strict(),
  z.object({ schemaVersion: version, action: z.literal("revoke"), connectionId: connectionIdSchema }).strict(),
]);

const statusSchema = z.object({
  schemaVersion: version,
  observeQualified: z.boolean(),
  observeEntitled: z.boolean(),
  // One connect serves Registrar and SellerHub; it opens when either role is available.
  connectAvailable: z.boolean(),
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
    kind: z.enum(["spaceship_connect", "spaceship_refresh", "spaceship_revoke"]),
    outcome: z.enum(["confirmed", "unqualified", "unreachable", "retry_later", "credential_rejected",
      "credential_store_unavailable", "local_operation_blocked", "provider_response_rejected", "capture_incomplete", "failed"]),
  }).strict().nullable(),
}).strict().refine(({ connections }) =>
  new Set(connections.map((row) => row.connectionId)).size === connections.length);

export type SpaceshipRegistrarIntent = z.infer<typeof spaceshipRegistrarIntentSchema>;
export type SpaceshipRegistrarStatus = z.infer<typeof statusSchema>;

export interface SpaceshipRegistrarPort {
  status(): Promise<SpaceshipRegistrarStatus>;
  submit(intent: SpaceshipRegistrarIntent): Promise<void>;
}

export function parseSpaceshipRegistrarStatus(value: unknown): SpaceshipRegistrarStatus {
  const parsed = statusSchema.safeParse(copyPlainData(value));
  if (!parsed.success) throw new TypeError("invalid Spaceship registrar projection");
  return parsed.data;
}
