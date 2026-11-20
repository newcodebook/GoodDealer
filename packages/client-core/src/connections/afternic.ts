import { z } from "zod";
import { canonicalUtcTimestamp } from "@gooddealer/protocol/wire";
import { copyPlainData } from "../portfolio/index";
import { afternicControlledAcceptanceSchema } from "./afternic-controlled-acceptance";
import { connectionLabelSchema } from "./connection-label";

const connectionIdSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
const count = z.number().int().min(0).max(10_000);
const scanSchema = z.object({ observed: count, imported: count, skippedDeleted: count, completedAt: canonicalUtcTimestamp }).strict()
  .refine((scan) => scan.imported <= scan.observed && scan.observed + scan.skippedDeleted <= 10_000);
export const afternicConnectionIntentSchema = z.object({ schemaVersion: z.literal(1), connectionId: connectionIdSchema }).strict();
export const afternicConnectIntentSchema = z.object({ schemaVersion: z.literal(1), displayLabel: connectionLabelSchema.refine((label) => label.length <= 80) }).strict();
export const afternicConnectionsStatusSchema = z.object({
  schemaVersion: z.literal(1),
  connections: z.array(z.object({
    connectionId: connectionIdSchema,
    displayLabel: connectionLabelSchema,
    state: z.enum(["prepared", "active", "remediation_required", "revoked"]),
    purgePending: z.boolean(),
    lastScan: scanSchema.nullable(),
  }).strict().refine((connection) => !connection.purgePending || connection.state === "revoked")).max(100),
  observeQualified: z.boolean(),
  controlledAcceptance: afternicControlledAcceptanceSchema.nullable(),
  capturable: z.boolean(),
  observeEntitled: z.boolean(),
  laneState: z.enum(["recovering", "ready", "busy", "blocked"]),
  lastOperation: z.object({
    kind: z.enum(["afternic_connect", "afternic_refresh", "afternic_revoke"]),
    outcome: z.enum(["confirmed", "unconfirmed", "unqualified", "unreachable", "retry_later", "credential_rejected", "failed"]),
  }).strict().nullable(),
}).strict().superRefine((status, context) => {
  if (new Set(status.connections.map((connection) => connection.connectionId)).size !== status.connections.length) {
    context.addIssue({ code: "custom", message: "duplicate Afternic connection" });
  }
  const acceptance = status.controlledAcceptance;
  if (acceptance === null) return;
  if (status.observeQualified) {
    context.addIssue({ code: "custom", message: "controlled acceptance is not production qualification" });
  }
  if (acceptance.connectionId !== null && !status.connections.some(connection =>
    connection.connectionId === acceptance.connectionId && (connection.state === "prepared" || connection.state === "active"))) {
    context.addIssue({ code: "custom", message: "controlled acceptance connection is unavailable" });
  }
});
export type AfternicConnectionsStatus = z.infer<typeof afternicConnectionsStatusSchema>;
export interface AfternicConnectionPort {
  status(): Promise<AfternicConnectionsStatus>;
  connect(displayLabel: string): Promise<void>;
  refresh(connectionId: string): Promise<void>;
  revoke(connectionId: string): Promise<void>;
}
export function parseAfternicConnectionsStatus(value: unknown): AfternicConnectionsStatus {
  const parsed = afternicConnectionsStatusSchema.safeParse(copyPlainData(value));
  if (!parsed.success) throw new TypeError("invalid Afternic connection projection");
  return parsed.data;
}
