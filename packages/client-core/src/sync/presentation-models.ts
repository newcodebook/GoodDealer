import { z } from "zod";

const sequenceSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

export const syncStreamProgressSchema = z
  .object({
    stream: z.enum(["mutation", "execution_fact", "device_audit"]),
    lastAssignedSequence: sequenceSchema,
    contiguousReceivedThrough: sequenceSchema,
    pendingCount: sequenceSchema,
  })
  .strict()
  .superRefine((stream, context) => {
    if (stream.contiguousReceivedThrough > stream.lastAssignedSequence) {
      context.addIssue({
        code: "custom",
        path: ["contiguousReceivedThrough"],
        message: "Cloud acknowledgement cannot exceed the locally assigned sequence",
      });
    }
    if (stream.pendingCount !== stream.lastAssignedSequence - stream.contiguousReceivedThrough) {
      context.addIssue({
        code: "custom",
        path: ["pendingCount"],
        message: "pending count must be derived from the Cloud acknowledgement watermark",
      });
    }
  });

export const syncStatusViewModelSchema = z
  .object({
    schemaVersion: z.literal(1),
    surface: z.enum(["active_local", "standby_cloud"]),
    phase: z.enum(["idle", "uploading", "backoff", "unavailable"]),
    serverRevision: sequenceSchema,
    lastSuccessfulSyncAt: z.iso.datetime().nullable(),
    unsyncedCount: sequenceSchema,
    streams: z.array(syncStreamProgressSchema).length(3),
  })
  .strict()
  .superRefine((view, context) => {
    const streamNames = view.streams.map(({ stream }) => stream);
    if (new Set(streamNames).size !== 3) {
      context.addIssue({
        code: "custom",
        path: ["streams"],
        message: "all three synchronization streams are required exactly once",
      });
    }
    const derivedUnsyncedCount = view.streams.reduce((sum, stream) => sum + stream.pendingCount, 0);
    if (!Number.isSafeInteger(derivedUnsyncedCount) || view.unsyncedCount !== derivedUnsyncedCount) {
      context.addIssue({
        code: "custom",
        path: ["unsyncedCount"],
        message: "unsynced count must equal the three acknowledged stream gaps",
      });
    }
    if (view.surface === "standby_cloud" && view.phase === "uploading") {
      context.addIssue({
        code: "custom",
        path: ["phase"],
        message: "Standby cannot upload business synchronization streams",
      });
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

export type SyncStreamProgress = z.infer<typeof syncStreamProgressSchema>;
export type SyncStatusViewModel = z.infer<typeof syncStatusViewModelSchema>;
export type SyncSettingsViewModel = z.infer<typeof syncSettingsViewModelSchema>;

export interface SyncPresentationBoundary {
  getSyncStatus(): Promise<unknown>;
  getSyncSettings(): Promise<unknown>;
}

/** Read-only presentation Port; upload scheduling and acknowledgements remain outside client-core. */
export interface SyncPresentationPort {
  getSyncStatus(): Promise<SyncStatusViewModel>;
  getSyncSettings(): Promise<SyncSettingsViewModel>;
}

export function parseSyncStatusViewModel(input: unknown): SyncStatusViewModel {
  const parsed = syncStatusViewModelSchema.safeParse(input);
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

  async getSyncStatus(): Promise<SyncStatusViewModel> {
    return parseSyncStatusViewModel(await this.#boundary.getSyncStatus());
  }

  async getSyncSettings(): Promise<SyncSettingsViewModel> {
    return parseSyncSettingsViewModel(await this.#boundary.getSyncSettings());
  }
}
