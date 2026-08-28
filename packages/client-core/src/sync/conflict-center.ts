import { z } from "zod";

const identifierSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const safeDisplayTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(512)
  .refine(
    (value) => !/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(value),
    "display text contains control characters",
  );
const revisionSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const valueHashSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/u);
const canonicalUtcTimestampSchema = z.iso.datetime({ offset: false, precision: 0 });

export const conflictQuerySourceSchema = z.enum([
  "active_local",
  "standby_cloud",
  "local_continuation",
]);
export const conflictRiskSchema = z.enum(["normal", "high", "safety_priority"]);
export const conflictGroupSchema = z.enum(["price", "dns", "sales_status"]);
export const conflictStatusSchema = z.enum([
  "pending",
  "review_stale",
  "resolved_local",
  "resolved_remote",
]);
export const conflictResolutionChoiceSchema = z.enum([
  "keep_local",
  "accept_remote",
]);

const unavailableResolutionSchema = z
  .object({ state: z.literal("unavailable") })
  .strict();
const availableResolutionSchema = z
  .object({
    state: z.literal("available"),
    candidateId: identifierSchema,
    expectedRevision: revisionSchema,
    expectedCurrentValueHash: valueHashSchema,
    choices: z.array(conflictResolutionChoiceSchema).min(1).max(2),
  })
  .strict()
  .superRefine((admission, context) => {
    if (new Set(admission.choices).size !== admission.choices.length) {
      context.addIssue({ code: "custom", path: ["choices"], message: "resolution choices must be unique" });
    }
  });

export const conflictItemSchema = z
  .object({
    candidateId: identifierSchema,
    entityDisplay: safeDisplayTextSchema,
    fieldDisplay: safeDisplayTextSchema,
    group: conflictGroupSchema,
    risk: conflictRiskSchema,
    note: safeDisplayTextSchema,
    baseValue: safeDisplayTextSchema,
    localValue: safeDisplayTextSchema,
    remoteValue: safeDisplayTextSchema,
    comparisonServerRevision: revisionSchema,
    currentValueHash: valueHashSchema,
    status: conflictStatusSchema,
    resolutionAdmission: z.discriminatedUnion("state", [
      unavailableResolutionSchema,
      availableResolutionSchema,
    ]),
  })
  .strict()
  .superRefine((item, context) => {
    const admission = item.resolutionAdmission;
    if (admission.state === "available") {
      if (item.status !== "pending") {
        context.addIssue({ code: "custom", path: ["resolutionAdmission"], message: "only pending conflicts can be resolved" });
      }
      if (
        admission.candidateId !== item.candidateId ||
        admission.expectedRevision !== item.comparisonServerRevision ||
        admission.expectedCurrentValueHash !== item.currentValueHash
      ) {
        context.addIssue({ code: "custom", path: ["resolutionAdmission"], message: "resolution admission must bind the compared value" });
      }
    }
  });

export const conflictCenterViewModelSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("conflict_center"),
    workspaceId: identifierSchema,
    candidateSetVersion: revisionSchema,
    freshness: z
      .object({
        source: conflictQuerySourceSchema,
        serverRevision: revisionSchema,
        observedAt: canonicalUtcTimestampSchema,
      })
      .strict(),
    conflicts: z.array(conflictItemSchema).max(1_000),
  })
  .strict()
  .superRefine((view, context) => {
    const ids = view.conflicts.map(({ candidateId }) => candidateId);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: "custom", path: ["conflicts"], message: "conflict candidate ids must be unique" });
    }
    view.conflicts.forEach((item, index) => {
      if (item.comparisonServerRevision > view.freshness.serverRevision) {
        context.addIssue({ code: "custom", path: ["conflicts", index, "comparisonServerRevision"], message: "comparison cannot be from a future revision" });
      }
      if (item.status === "pending" && item.comparisonServerRevision !== view.freshness.serverRevision) {
        context.addIssue({ code: "custom", path: ["conflicts", index, "status"], message: "a stale comparison requires renewed review" });
      }
      if (view.freshness.source !== "active_local" && item.resolutionAdmission.state === "available") {
        context.addIssue({ code: "custom", path: ["conflicts", index, "resolutionAdmission"], message: "non-Active projections cannot grant resolution authority" });
      }
    });
  });

export const conflictResolutionIntentSchema = z
  .object({
    schemaVersion: z.literal(1),
    workspaceId: identifierSchema,
    candidateSetVersion: revisionSchema,
    candidateId: identifierSchema,
    expectedRevision: revisionSchema,
    expectedCurrentValueHash: valueHashSchema,
    choice: conflictResolutionChoiceSchema,
  })
  .strict();

export type ConflictQuerySource = z.infer<typeof conflictQuerySourceSchema>;
export type ConflictRisk = z.infer<typeof conflictRiskSchema>;
export type ConflictGroup = z.infer<typeof conflictGroupSchema>;
export type ConflictStatus = z.infer<typeof conflictStatusSchema>;
export type ConflictResolutionChoice = z.infer<typeof conflictResolutionChoiceSchema>;
export type ConflictItem = z.infer<typeof conflictItemSchema>;
export type ConflictCenterViewModel = z.infer<typeof conflictCenterViewModelSchema>;
export type ConflictResolutionIntent = z.infer<typeof conflictResolutionIntentSchema>;

export interface ConflictQueryBoundary {
  getConflictCenter(): Promise<unknown>;
}

export interface ConflictQueryPort {
  getConflictCenter(): Promise<ConflictCenterViewModel>;
}

export interface ConflictResolvePort {
  resolveConflict(intent: ConflictResolutionIntent): Promise<void>;
}

export function parseConflictCenterViewModel(input: unknown): ConflictCenterViewModel {
  const parsed = conflictCenterViewModelSchema.safeParse(input);
  if (!parsed.success) throw new TypeError("invalid conflict center projection");
  return parsed.data;
}

export class ValidatingConflictQueryPort implements ConflictQueryPort {
  readonly #boundary: ConflictQueryBoundary;

  constructor(boundary: ConflictQueryBoundary) {
    this.#boundary = boundary;
  }

  async getConflictCenter(): Promise<ConflictCenterViewModel> {
    return parseConflictCenterViewModel(await this.#boundary.getConflictCenter());
  }
}

export function createConflictResolutionIntent(
  view: ConflictCenterViewModel,
  candidateId: string,
  choice: ConflictResolutionChoice,
): ConflictResolutionIntent | null {
  if (view.freshness.source !== "active_local") return null;
  const item = view.conflicts.find((candidate) => candidate.candidateId === candidateId);
  if (item?.status !== "pending" || item.resolutionAdmission.state !== "available") return null;
  if (!item.resolutionAdmission.choices.includes(choice)) return null;
  return conflictResolutionIntentSchema.parse({
    schemaVersion: 1,
    workspaceId: view.workspaceId,
    candidateSetVersion: view.candidateSetVersion,
    candidateId: item.resolutionAdmission.candidateId,
    expectedRevision: item.resolutionAdmission.expectedRevision,
    expectedCurrentValueHash: item.resolutionAdmission.expectedCurrentValueHash,
    choice,
  });
}

export function createLowRiskConflictResolutionIntents(
  view: ConflictCenterViewModel,
  group: ConflictGroup,
  choice: ConflictResolutionChoice,
): readonly ConflictResolutionIntent[] {
  if (view.freshness.source !== "active_local") return [];
  return view.conflicts.flatMap((item) => {
    if (item.group !== group || item.risk !== "normal") return [];
    const intent = createConflictResolutionIntent(view, item.candidateId, choice);
    return intent === null ? [] : [intent];
  });
}
