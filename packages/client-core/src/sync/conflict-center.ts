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
const positiveSafeIntegerSchema = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const valueHashSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const canonicalUtcTimestampSchema = z.iso.datetime({ offset: false, precision: 0 });

export const conflictQuerySourceSchema = z.enum([
  "active_local",
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
export const conflictCandidateKindSchema = z.enum(["field_conflict", "delete_conflict"]);
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
    expectedRevision: positiveSafeIntegerSchema,
    expectedCandidateVersion: positiveSafeIntegerSchema,
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
    candidateKind: conflictCandidateKindSchema.default("field_conflict"),
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
      if (item.candidateKind === "delete_conflict" &&
          (admission.choices.length !== 1 || admission.choices[0] !== "accept_remote")) {
        context.addIssue({ code: "custom", path: ["resolutionAdmission", "choices"], message: "delete conflicts allow accept_remote only" });
      }
      if (
        admission.candidateId !== item.candidateId ||
        admission.expectedRevision !== item.comparisonServerRevision ||
        admission.expectedCandidateVersion < 1 ||
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
    readGeneration: revisionSchema,
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
    if (
      view.candidateSetVersion === 0 &&
      view.conflicts.some((item) =>
        item.status === "pending" && item.resolutionAdmission.state === "available"
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["candidateSetVersion"],
        message: "an actionable conflict set requires a positive version",
      });
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
    expectedReadGeneration: revisionSchema,
    candidateSetVersion: positiveSafeIntegerSchema,
    candidateId: identifierSchema,
    expectedRevision: positiveSafeIntegerSchema,
    expectedCandidateVersion: positiveSafeIntegerSchema,
    expectedCurrentValueHash: valueHashSchema,
    choice: conflictResolutionChoiceSchema,
  })
  .strict();

export const conflictResolutionReceiptSchema = z
  .object({
    schemaVersion: z.literal(1),
    readGeneration: revisionSchema,
    enqueuedForSync: z.boolean(),
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
export type ConflictResolutionReceipt = z.infer<typeof conflictResolutionReceiptSchema>;

export interface ConflictQueryBoundary {
  getConflictCenter(): Promise<unknown>;
}

export interface ConflictQueryPort {
  getConflictCenter(): Promise<ConflictCenterViewModel>;
}

export interface ConflictResolvePort {
  resolveConflict(intent: ConflictResolutionIntent): Promise<ConflictResolutionReceipt>;
}

export function parseConflictCenterViewModel(input: unknown): ConflictCenterViewModel {
  const parsed = conflictCenterViewModelSchema.safeParse(copyConflictWire(input));
  if (!parsed.success) throw new TypeError("invalid conflict center projection");
  return parsed.data;
}

export function parseConflictResolutionReceipt(input: unknown): ConflictResolutionReceipt {
  const parsed = conflictResolutionReceiptSchema.safeParse(copyConflictWire(input));
  if (!parsed.success) throw new TypeError("invalid conflict resolution receipt");
  return parsed.data;
}

function copyConflictWire(input: unknown, depth = 0, budget = { nodes: 0 }): unknown {
  budget.nodes += 1;
  if (depth > 8 || budget.nodes > 12_000) throw new TypeError("invalid conflict center projection");
  if (input === null || typeof input !== "object") return input;
  if (Object.getPrototypeOf(input) !== Object.prototype && !Array.isArray(input)) {
    throw new TypeError("invalid conflict center projection");
  }
  if (Object.getOwnPropertySymbols(input).length !== 0) throw new TypeError("invalid conflict center projection");
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (Array.isArray(input)) {
    if (Object.keys(descriptors).some((key) => key !== "length" && !/^(0|[1-9][0-9]*)$/u.test(key))) {
      throw new TypeError("invalid conflict center projection");
    }
    const copied: unknown[] = [];
    for (let index = 0; index < input.length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (descriptor === undefined || !("value" in descriptor)) throw new TypeError("invalid conflict center projection");
      copied.push(copyConflictWire(descriptor.value, depth + 1, budget));
    }
    return copied;
  }
  const copied: Record<string, unknown> = {};
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!("value" in descriptor)) throw new TypeError("invalid conflict center projection");
    copied[key] = copyConflictWire(descriptor.value, depth + 1, budget);
  }
  return copied;
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
  if (!positiveSafeIntegerSchema.safeParse(view.candidateSetVersion).success) return null;
  const item = view.conflicts.find((candidate) => candidate.candidateId === candidateId);
  if (item?.status !== "pending" || item.resolutionAdmission.state !== "available") return null;
  if (
    !positiveSafeIntegerSchema.safeParse(item.resolutionAdmission.expectedRevision).success ||
    !positiveSafeIntegerSchema.safeParse(item.resolutionAdmission.expectedCandidateVersion).success
  ) return null;
  if (!item.resolutionAdmission.choices.includes(choice)) return null;
  return conflictResolutionIntentSchema.parse({
    schemaVersion: 1,
    expectedReadGeneration: view.readGeneration,
    candidateSetVersion: view.candidateSetVersion,
    candidateId: item.resolutionAdmission.candidateId,
    expectedRevision: item.resolutionAdmission.expectedRevision,
    expectedCandidateVersion: item.resolutionAdmission.expectedCandidateVersion,
    expectedCurrentValueHash: item.resolutionAdmission.expectedCurrentValueHash,
    choice,
  });
}
