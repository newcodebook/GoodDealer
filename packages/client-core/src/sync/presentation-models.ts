import { z } from "zod";

import { copyPlainData } from "../portfolio/view-models";

const sequenceSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const canonicalUtcTimestampSchema = z.iso.datetime({ offset: false, precision: 0 });

// Kept as an internal protocol diagnostic contract. Customer UI uses SyncSnapshot below.
export const syncStreamProgressSchema = z.object({
  stream: z.enum(["mutation", "execution_fact", "device_audit"]),
  lastAssignedSequence: sequenceSchema,
  contiguousReceivedThrough: sequenceSchema,
  pendingCount: sequenceSchema,
}).strict().superRefine((stream, context) => {
  if (stream.contiguousReceivedThrough > stream.lastAssignedSequence ||
      stream.pendingCount !== stream.lastAssignedSequence - stream.contiguousReceivedThrough) {
    context.addIssue({ code: "custom", path: ["pendingCount"], message: "invalid stream progress" });
  }
});
export const syncStatusViewModelSchema = z.object({
  schemaVersion: z.literal(1), surface: z.enum(["active_local", "standby_cloud"]),
  phase: z.enum(["idle", "uploading", "backoff", "unavailable"]), serverRevision: sequenceSchema,
  lastSuccessfulSyncAt: z.iso.datetime().nullable(), unsyncedCount: sequenceSchema,
  streams: z.array(syncStreamProgressSchema).length(3),
}).strict().superRefine((view, context) => {
  if (new Set(view.streams.map(({ stream }) => stream)).size !== 3 ||
      view.unsyncedCount !== view.streams.reduce((sum, stream) => sum + stream.pendingCount, 0) ||
      view.surface === "standby_cloud" && view.phase === "uploading") {
    context.addIssue({ code: "custom", path: ["streams"], message: "invalid diagnostic sync status" });
  }
});

export const syncSnapshotViewModelSchema = z
  .object({
    schemaVersion: z.literal(1),
    source: z.enum(["active_local", "local_continuation"]),
    readGeneration: sequenceSchema,
    transport: z.enum(["checking", "reachable", "offline", "blocked"]),
    blockedReason: z.enum(["authorization", "security", "recovery_required"]).nullable(),
    activity: z.enum(["idle", "syncing"]),
    pendingMutationCount: sequenceSchema,
    openConflictCount: sequenceSchema,
    rejectedMutationCount: sequenceSchema,
    recoveryRequired: z.boolean(),
    appliedThroughServerRevision: sequenceSchema,
    lastReplicationActivityAt: canonicalUtcTimestampSchema.nullable(),
    transportObservedAt: canonicalUtcTimestampSchema.nullable(),
  })
  .strict()
  .superRefine((view, context) => {
    if ((view.transport === "blocked") !== (view.blockedReason !== null)) {
      context.addIssue({
        code: "custom",
        path: ["blockedReason"],
        message: "a blocked reason is required exactly when transport is blocked",
      });
    }
    if (view.transport === "blocked" && view.activity === "syncing") {
      context.addIssue({
        code: "custom",
        path: ["activity"],
        message: "blocked transport cannot claim active synchronization",
      });
    }
    if (view.transport === "checking" && view.transportObservedAt !== null) {
      context.addIssue({
        code: "custom",
        path: ["transportObservedAt"],
        message: "checking has no current transport observation",
      });
    }
    if (view.source === "local_continuation" && (view.transport !== "blocked" || view.blockedReason !== "authorization" && view.blockedReason !== "recovery_required")) {
      context.addIssue({ code: "custom", path: ["source"], message: "local continuation is authorization or recovery blocked" });
    }
    if (view.recoveryRequired !== (view.blockedReason === "recovery_required")) {
      context.addIssue({ code: "custom", path: ["recoveryRequired"], message: "recovery state must be explicit" });
    }
  });

export const syncSettingsViewModelSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("sync_settings"),
    businessSynchronization: z.literal("mandatory"),
    pullRefreshCadence: z.enum(["when_visible", "every_5_minutes", "every_15_minutes"]),
    conflictResolution: z.literal("manual_review"),
  })
  .strict();

// Mandatory synchronization is an asynchronous replication policy. It does not make Cloud
// acknowledgement a prerequisite for committing business work to the local SQLCipher authority.

export type SyncSnapshotViewModel = z.infer<typeof syncSnapshotViewModelSchema>;
export type SyncStreamProgress = z.infer<typeof syncStreamProgressSchema>;
export type SyncStatusViewModel = z.infer<typeof syncStatusViewModelSchema>;
export type SyncSettingsViewModel = z.infer<typeof syncSettingsViewModelSchema>;

export interface SyncPresentationBoundary {
  getSyncStatus(): Promise<unknown>;
  getSyncSettings(): Promise<unknown>;
}

/** Read-only presentation Port; upload scheduling and acknowledgements remain outside client-core. */
export interface SyncPresentationPort {
  getSyncStatus(): Promise<SyncSnapshotViewModel>;
  getSyncSettings(): Promise<SyncSettingsViewModel>;
}

export function parseSyncSnapshotViewModel(input: unknown): SyncSnapshotViewModel {
  let copied: unknown;
  try { copied = copyPlainData(input); }
  catch { throw new TypeError("invalid sync snapshot projection"); }
  const parsed = syncSnapshotViewModelSchema.safeParse(copied);
  if (!parsed.success) throw new TypeError("invalid sync snapshot projection");
  return parsed.data;
}

/** @deprecated Use the durable SyncSnapshot name. */
export function parseSyncStatusViewModel(input: unknown): SyncStatusViewModel {
  const parsed = syncStatusViewModelSchema.safeParse(copyPlainData(input));
  if (!parsed.success) throw new TypeError("invalid sync status projection");
  return parsed.data;
}

export function parseSyncSettingsViewModel(input: unknown): SyncSettingsViewModel {
  const parsed = syncSettingsViewModelSchema.safeParse(input);
  if (!parsed.success) throw new TypeError("invalid sync settings projection");
  return parsed.data;
}

/** Strict host-independent adapter with no timer, upload, persistence, or transport behavior. */
export class ValidatingSyncPresentationPort implements SyncPresentationPort {
  readonly #boundary: SyncPresentationBoundary;

  constructor(boundary: SyncPresentationBoundary) {
    this.#boundary = boundary;
  }

  async getSyncStatus(): Promise<SyncSnapshotViewModel> {
    return parseSyncSnapshotViewModel(await this.#boundary.getSyncStatus());
  }

  async getSyncSettings(): Promise<SyncSettingsViewModel> {
    return parseSyncSettingsViewModel(await this.#boundary.getSyncSettings());
  }
}
