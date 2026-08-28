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
const valueHashSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/u);
const digestSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/u);
const canonicalUtcTimestampSchema = z.iso.datetime({ offset: false, precision: 0 });

export const recoverySurfaceSchema = z.enum([
  "active",
  "standby",
  "local_continuation",
  "isolated_recovery",
]);
export const recoveryCandidateRiskSchema = z.enum(["normal", "high", "safety_priority"]);
export const recoveryCandidateStatusSchema = z.enum([
  "pending",
  "review_stale",
  "applied",
  "kept_current",
]);

const unavailableCandidateAdmissionSchema = z.object({ state: z.literal("unavailable") }).strict();
const availableCandidateAdmissionSchema = z
  .object({
    state: z.literal("available"),
    candidateId: identifierSchema,
    expectedRevision: revisionSchema,
    expectedCurrentValueHash: valueHashSchema,
  })
  .strict();

const recoveryCandidateBaseSchema = z.object({
  candidateId: identifierSchema,
  entityDisplay: safeDisplayTextSchema,
  fieldDisplay: safeDisplayTextSchema,
  baseValue: safeDisplayTextSchema,
  candidateValue: safeDisplayTextSchema,
  currentValue: safeDisplayTextSchema,
  comparisonServerRevision: revisionSchema,
  currentValueHash: valueHashSchema,
  risk: recoveryCandidateRiskSchema,
  status: recoveryCandidateStatusSchema,
  admission: z.discriminatedUnion("state", [
    unavailableCandidateAdmissionSchema,
    availableCandidateAdmissionSchema,
  ]),
});

export const staleDeviceCandidateSchema = recoveryCandidateBaseSchema
  .extend({
    kind: z.literal("stale_device_candidate"),
    sourceDeviceDisplay: safeDisplayTextSchema,
    sourceEpoch: positiveSafeIntegerSchema,
  })
  .strict();

export const restoreCandidateSchema = recoveryCandidateBaseSchema
  .extend({
    kind: z.literal("restore_candidate"),
    backupId: identifierSchema,
    manifestDigest: digestSchema,
    backupCreatedAt: canonicalUtcTimestampSchema,
    backupRevision: revisionSchema,
  })
  .strict();

export const recoveryCandidateSchema = z
  .discriminatedUnion("kind", [staleDeviceCandidateSchema, restoreCandidateSchema])
  .superRefine((candidate, context) => {
    if (candidate.admission.state === "available") {
      if (candidate.status !== "pending") {
        context.addIssue({ code: "custom", path: ["admission"], message: "only pending candidates can be applied" });
      }
      if (
        candidate.admission.candidateId !== candidate.candidateId ||
        candidate.admission.expectedRevision !== candidate.comparisonServerRevision ||
        candidate.admission.expectedCurrentValueHash !== candidate.currentValueHash
      ) {
        context.addIssue({ code: "custom", path: ["admission"], message: "candidate admission must bind the reviewed comparison" });
      }
    }
  });

export const lateExecutionEventSchema = z
  .object({
    kind: z.literal("late_execution_event"),
    eventId: identifierSchema,
    entityDisplay: safeDisplayTextSchema,
    operationDisplay: safeDisplayTextSchema,
    sourceDeviceDisplay: safeDisplayTextSchema,
    sourceEpoch: positiveSafeIntegerSchema,
    occurredAt: canonicalUtcTimestampSchema,
    receivedAt: canonicalUtcTimestampSchema,
    evidenceLevel: z.enum(["verified", "incomplete", "contested"]),
  })
  .strict()
  .superRefine((event, context) => {
    // Canonical ISO instants sort chronologically; no client clock or authority is consulted.
    if (event.receivedAt < event.occurredAt) {
      context.addIssue({ code: "custom", path: ["receivedAt"], message: "receipt cannot precede occurrence" });
    }
  });

export const recoveryCenterViewModelSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("recovery_center"),
    workspaceId: identifierSchema,
    surface: recoverySurfaceSchema,
    candidateSetVersion: revisionSchema,
    freshness: z
      .object({
        source: z.enum(["cloud", "isolated_recovery"]),
        serverRevision: revisionSchema,
        observedAt: canonicalUtcTimestampSchema,
      })
      .strict(),
    staleDeviceCandidates: z.array(staleDeviceCandidateSchema).max(1_000),
    restoreCandidates: z.array(restoreCandidateSchema).max(1_000),
    lateExecutionEvents: z.array(lateExecutionEventSchema).max(1_000),
  })
  .strict()
  .superRefine((view, context) => {
    const candidates = [...view.staleDeviceCandidates, ...view.restoreCandidates];
    const ids = candidates.map(({ candidateId }) => candidateId);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: "custom", path: ["candidateSetVersion"], message: "candidate ids must be unique" });
    }
    const eventIds = view.lateExecutionEvents.map(({ eventId }) => eventId);
    if (new Set(eventIds).size !== eventIds.length) {
      context.addIssue({ code: "custom", path: ["lateExecutionEvents"], message: "late event ids must be unique" });
    }
    candidates.forEach((candidate, index) => {
      if (candidate.admission.state === "available") {
        if (candidate.status !== "pending") {
          context.addIssue({ code: "custom", path: ["candidates", index, "admission"], message: "only pending candidates can be applied" });
        }
        if (
          candidate.admission.candidateId !== candidate.candidateId ||
          candidate.admission.expectedRevision !== candidate.comparisonServerRevision ||
          candidate.admission.expectedCurrentValueHash !== candidate.currentValueHash
        ) {
          context.addIssue({ code: "custom", path: ["candidates", index, "admission"], message: "candidate admission must bind the reviewed comparison" });
        }
      }
      if (candidate.comparisonServerRevision > view.freshness.serverRevision) {
        context.addIssue({ code: "custom", path: ["candidates", index, "comparisonServerRevision"], message: "comparison cannot be from a future revision" });
      }
      if (candidate.status === "pending" && candidate.comparisonServerRevision !== view.freshness.serverRevision) {
        context.addIssue({ code: "custom", path: ["candidates", index, "status"], message: "stale candidates require renewed review" });
      }
      if (view.surface !== "active" && candidate.admission.state === "available") {
        context.addIssue({ code: "custom", path: ["candidates", index, "admission"], message: "only Active can apply a candidate" });
      }
    });
    if (view.freshness.source === "isolated_recovery" && view.surface !== "isolated_recovery") {
      context.addIssue({ code: "custom", path: ["freshness", "source"], message: "isolated recovery data must remain on the isolated surface" });
    }
  });

export const recoveryCandidateDecisionIntentSchema = z
  .object({
    schemaVersion: z.literal(1),
    decision: z.enum(["apply_candidate", "keep_current"]),
    workspaceId: identifierSchema,
    candidateSetVersion: revisionSchema,
    candidateId: identifierSchema,
    expectedRevision: revisionSchema,
    expectedCurrentValueHash: valueHashSchema,
  })
  .strict();

export type RecoverySurface = z.infer<typeof recoverySurfaceSchema>;
export type RecoveryCandidateRisk = z.infer<typeof recoveryCandidateRiskSchema>;
export type RecoveryCandidateStatus = z.infer<typeof recoveryCandidateStatusSchema>;
export type StaleDeviceCandidate = z.infer<typeof staleDeviceCandidateSchema>;
export type RestoreCandidate = z.infer<typeof restoreCandidateSchema>;
export type RecoveryCandidate = z.infer<typeof recoveryCandidateSchema>;
export type LateExecutionEvent = z.infer<typeof lateExecutionEventSchema>;
export type RecoveryCenterViewModel = z.infer<typeof recoveryCenterViewModelSchema>;
export type RecoveryCandidateDecisionIntent = z.infer<typeof recoveryCandidateDecisionIntentSchema>;

export interface RecoveryQueryBoundary {
  getRecoveryCenter(): Promise<unknown>;
}

export interface RecoveryQueryPort {
  getRecoveryCenter(): Promise<RecoveryCenterViewModel>;
}

export interface RecoveryCandidateDecisionPort {
  decideCandidate(intent: RecoveryCandidateDecisionIntent): Promise<void>;
}

export function parseRecoveryCenterViewModel(input: unknown): RecoveryCenterViewModel {
  const parsed = recoveryCenterViewModelSchema.safeParse(input);
  if (!parsed.success) throw new TypeError("invalid recovery center projection");
  return parsed.data;
}

export class ValidatingRecoveryQueryPort implements RecoveryQueryPort {
  readonly #boundary: RecoveryQueryBoundary;

  constructor(boundary: RecoveryQueryBoundary) {
    this.#boundary = boundary;
  }

  async getRecoveryCenter(): Promise<RecoveryCenterViewModel> {
    return parseRecoveryCenterViewModel(await this.#boundary.getRecoveryCenter());
  }
}

export function createRecoveryCandidateDecisionIntent(
  view: RecoveryCenterViewModel,
  candidateId: string,
  decision: RecoveryCandidateDecisionIntent["decision"],
): RecoveryCandidateDecisionIntent | null {
  if (view.surface !== "active") return null;
  const candidates = [...view.staleDeviceCandidates, ...view.restoreCandidates];
  const candidate = candidates.find((entry) => entry.candidateId === candidateId);
  if (candidate?.status !== "pending" || candidate.admission.state !== "available") return null;
  return recoveryCandidateDecisionIntentSchema.parse({
    schemaVersion: 1,
    decision,
    workspaceId: view.workspaceId,
    candidateSetVersion: view.candidateSetVersion,
    candidateId: candidate.admission.candidateId,
    expectedRevision: candidate.admission.expectedRevision,
    expectedCurrentValueHash: candidate.admission.expectedCurrentValueHash,
  });
}

export function createLowRiskRecoveryApplyIntents(
  view: RecoveryCenterViewModel,
  kind: RecoveryCandidate["kind"],
): readonly RecoveryCandidateDecisionIntent[] {
  const candidates = kind === "stale_device_candidate"
    ? view.staleDeviceCandidates
    : view.restoreCandidates;
  return candidates.flatMap((candidate) => {
    if (candidate.risk !== "normal") return [];
    const intent = createRecoveryCandidateDecisionIntent(view, candidate.candidateId, "apply_candidate");
    return intent === null ? [] : [intent];
  });
}
