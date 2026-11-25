import { z } from "zod";
import { canonicalUtcTimestamp } from "@gooddealer/protocol/wire";
import { connectionLabelSchema } from "../connections/connection-label";
import { canonicalDomainNameSchema, copyPlainData } from "../portfolio/index";

const reference = z.uuidv4().refine(value => value === value.toLowerCase());
const hash = z.string().regex(/^[0-9a-f]{64}$/u);
const version = z.literal(1);
const domains = z.array(canonicalDomainNameSchema).min(1).max(500);
const planHeader = {
  planId: reference, connectionId: reference, planHash: hash, expiresAt: canonicalUtcTimestamp,
};
const ordered = (values: readonly string[]) => values.every((value, index) => index === 0 || values[index - 1]! < value);

export const atomStandardDelistPreviewRequestSchema = z.object({
  schemaVersion: version, connectionId: reference, domains,
}).strict().refine(request => new Set(request.domains).size === request.domains.length);
const previewSchema = z.object({ schemaVersion: version, ...planHeader, domains }).strict()
  .refine(preview => ordered(preview.domains));
export const atomStandardDelistApproveRequestSchema = z.object({
  schemaVersion: version, planId: reference, planHash: hash,
}).strict();
export const atomStandardDelistStatusRequestSchema = z.object({
  schemaVersion: version, planId: reference.nullable(),
}).strict();

const refused = z.enum(["precondition_changed", "connection_changed", "provider_state_blocked"]);
const item = z.discriminatedUnion("state", [
  z.object({ domain: canonicalDomainNameSchema, state: z.literal("awaiting_approval"), reason: z.null(), retryAt: z.null() }).strict(),
  z.object({ domain: canonicalDomainNameSchema, state: z.literal("expired"), reason: z.null(), retryAt: z.null() }).strict(),
  z.object({ domain: canonicalDomainNameSchema, state: z.literal("queued"), reason: z.literal("read_failed").nullable(), retryAt: canonicalUtcTimestamp.nullable() }).strict(),
  z.object({ domain: canonicalDomainNameSchema, state: z.literal("outcome_unknown"), reason: z.enum(["read_failed", "postcondition_pending"]).nullable(), retryAt: canonicalUtcTimestamp.nullable() }).strict(),
  z.object({ domain: canonicalDomainNameSchema, state: z.literal("failed_final"), reason: refused, retryAt: z.null() }).strict(),
]);
const plan = z.object({
  ...planHeader,
  state: z.enum(["awaiting_approval", "expired", "executing", "partially_failed"]),
  items: z.array(item).min(1).max(500),
}).strict().refine(({ state, items }) => {
  if (!ordered(items.map(entry => entry.domain))) return false;
  if (state === "awaiting_approval" || state === "expired") return items.every(entry => entry.state === state);
  if (state === "partially_failed") return items.every(entry => entry.state === "failed_final");
  return items.every(entry => entry.state !== "awaiting_approval" && entry.state !== "expired")
    && items.some(entry => entry.state === "queued" || entry.state === "outcome_unknown");
});
const status = z.object({
  schemaVersion: version, executionAvailable: z.boolean(), plan: plan.nullable(),
  recent: z.array(z.object({ planId: reference, connectionLabel: connectionLabelSchema, createdAt: canonicalUtcTimestamp }).strict()).max(20),
}).strict().refine(({ recent }) => new Set(recent.map(entry => entry.planId)).size === recent.length);

export type AtomStandardDelistPreview = z.infer<typeof previewSchema>;
export type AtomStandardDelistStatus = z.infer<typeof status>;
export interface AtomStandardDelistPort {
  preview(request: z.infer<typeof atomStandardDelistPreviewRequestSchema>): Promise<AtomStandardDelistPreview>;
  approve(request: z.infer<typeof atomStandardDelistApproveRequestSchema>): Promise<string>;
  status(request: z.infer<typeof atomStandardDelistStatusRequestSchema>): Promise<AtomStandardDelistStatus>;
}
export const parseAtomStandardDelistPreview = (wire: unknown) => previewSchema.parse(copyPlainData(wire));
export const parseAtomStandardDelistApproval = (wire: unknown) => reference.parse(wire);
export const parseAtomStandardDelistStatus = (wire: unknown) => status.parse(copyPlainData(wire));
