import { z } from "zod";

const identifierSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const safeDisplayTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .refine(
    (value) => !/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(value),
    "display text contains control characters",
  );
const revisionSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const positiveSafeIntegerSchema = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const digestSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/u);
const canonicalUtcTimestampSchema = z.iso.datetime({ offset: false, precision: 0 });

export const backupSurfaceSchema = z.enum([
  "active",
  "local_continuation",
  "standby",
  "locked",
  "draining",
  "isolated_recovery",
]);
export const backupScopeItemSchema = z.enum([
  "portfolio",
  "listing_target_state",
  "tags_cost_notes",
  "redacted_execution_fact_summary",
]);

const unavailableAdmissionSchema = z.object({ state: z.literal("unavailable") }).strict();
const availableExportAdmissionSchema = z
  .object({
    state: z.literal("available"),
    operationId: identifierSchema,
  })
  .strict();

export const redactedCredentialConnectionSchema = z
  .object({
    providerDisplay: safeDisplayTextSchema,
    accountAlias: safeDisplayTextSchema,
  })
  .strict();

export const backupExportSummarySchema = z
  .object({
    sourceDeviceDisplay: safeDisplayTextSchema,
    backupSchemaVersion: positiveSafeIntegerSchema,
    encryptionDisplay: safeDisplayTextSchema,
    destinationKind: z.literal("user_selected_location"),
    scope: z.array(backupScopeItemSchema).min(1).max(4),
    credentialConnections: z.array(redactedCredentialConnectionSchema).max(64),
    credentialsIncludedByDefault: z.literal(false),
  })
  .strict()
  .superRefine((summary, context) => {
    if (new Set(summary.scope).size !== summary.scope.length) {
      context.addIssue({ code: "custom", path: ["scope"], message: "backup scope entries must be unique" });
    }
    const labels = summary.credentialConnections.map(
      ({ providerDisplay, accountAlias }) => `${providerDisplay}\u0000${accountAlias}`,
    );
    if (new Set(labels).size !== labels.length) {
      context.addIssue({ code: "custom", path: ["credentialConnections"], message: "redacted connections must be unique" });
    }
  });

export const internalRecoveryPointSchema = z
  .object({
    recoveryPointId: identifierSchema,
    createdAt: canonicalUtcTimestampSchema,
    backupSchemaVersion: positiveSafeIntegerSchema,
    sizeBytes: positiveSafeIntegerSchema,
    reason: z.literal("pre_restore"),
  })
  .strict();

const verifiedArtifactBase = {
  protection: z.literal("host_decrypted_and_manifest_verified"),
  backupId: identifierSchema,
  manifestDigest: digestSchema,
  workspaceId: identifierSchema,
  backupSchemaVersion: positiveSafeIntegerSchema,
  backupCreatedAt: canonicalUtcTimestampSchema,
  backupRevision: revisionSchema,
} as const;

const noArtifactSchema = z.object({ state: z.literal("none") }).strict();
const unverifiedArtifactSchema = z.object({ state: z.literal("unverified") }).strict();
const incompatibleArtifactSchema = z
  .object({
    state: z.literal("verified_incompatible"),
    ...verifiedArtifactBase,
    incompatibility: z.enum(["workspace_mismatch", "schema_unsupported", "manifest_mismatch"]),
  })
  .strict();
const compatibleArtifactSchema = z
  .object({
    state: z.literal("verified_compatible"),
    ...verifiedArtifactBase,
    restoreAdmission: z.discriminatedUnion("state", [
      unavailableAdmissionSchema,
      z
        .object({
          state: z.literal("available"),
          operationId: identifierSchema,
          dialogBindingId: identifierSchema,
          candidateSetVersion: revisionSchema,
          expectedCurrentRevision: revisionSchema,
        })
        .strict(),
    ]),
  })
  .strict();

export const selectedBackupArtifactSchema = z.discriminatedUnion("state", [
  noArtifactSchema,
  unverifiedArtifactSchema,
  incompatibleArtifactSchema,
  compatibleArtifactSchema,
]);

export const backupRestoreViewModelSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("backup_restore"),
    workspaceId: identifierSchema,
    surface: backupSurfaceSchema,
    currentRevision: revisionSchema,
    supportedBackupSchemaVersions: z.array(positiveSafeIntegerSchema).min(1).max(16),
    exportSummary: backupExportSummarySchema,
    exportAdmission: z.discriminatedUnion("state", [
      unavailableAdmissionSchema,
      availableExportAdmissionSchema,
    ]),
    artifactSelectionAdmission: z.discriminatedUnion("state", [
      unavailableAdmissionSchema,
      z.object({ state: z.literal("available"), operationId: identifierSchema }).strict(),
    ]),
    selectedArtifact: selectedBackupArtifactSchema,
    recoveryPoints: z.array(internalRecoveryPointSchema).max(100),
  })
  .strict()
  .superRefine((view, context) => {
    if (new Set(view.supportedBackupSchemaVersions).size !== view.supportedBackupSchemaVersions.length) {
      context.addIssue({ code: "custom", path: ["supportedBackupSchemaVersions"], message: "supported schema versions must be unique" });
    }
    const pointIds = view.recoveryPoints.map(({ recoveryPointId }) => recoveryPointId);
    if (new Set(pointIds).size !== pointIds.length) {
      context.addIssue({ code: "custom", path: ["recoveryPoints"], message: "recovery point ids must be unique" });
    }
    if (!canReadExportOrInspectBackup(view.surface)) {
      if (view.exportAdmission.state === "available") {
        context.addIssue({ code: "custom", path: ["exportAdmission"], message: "surface cannot export backups" });
      }
      if (view.artifactSelectionAdmission.state === "available") {
        context.addIssue({ code: "custom", path: ["artifactSelectionAdmission"], message: "surface cannot select restore artifacts" });
      }
    }
    const artifact = view.selectedArtifact;
    if (artifact.state === "verified_compatible") {
      const compatible =
        artifact.workspaceId === view.workspaceId &&
        view.supportedBackupSchemaVersions.includes(artifact.backupSchemaVersion);
      if (!compatible) {
        context.addIssue({ code: "custom", path: ["selectedArtifact"], message: "compatible artifact identity must match workspace and schema" });
      }
      if (artifact.restoreAdmission.state === "available") {
        if (!canRestoreBackup(view.surface)) {
          context.addIssue({ code: "custom", path: ["selectedArtifact", "restoreAdmission"], message: "surface cannot start restore" });
        }
        if (artifact.restoreAdmission.expectedCurrentRevision !== view.currentRevision) {
          context.addIssue({ code: "custom", path: ["selectedArtifact", "restoreAdmission", "expectedCurrentRevision"], message: "restore admission must bind current revision" });
        }
      }
    }
    if (artifact.state === "verified_incompatible") {
      const workspaceMatches = artifact.workspaceId === view.workspaceId;
      const schemaSupported = view.supportedBackupSchemaVersions.includes(artifact.backupSchemaVersion);
      if (artifact.incompatibility === "workspace_mismatch" && workspaceMatches) {
        context.addIssue({ code: "custom", path: ["selectedArtifact", "incompatibility"], message: "workspace mismatch requires a different workspace" });
      }
      if (artifact.incompatibility === "schema_unsupported" && schemaSupported) {
        context.addIssue({ code: "custom", path: ["selectedArtifact", "incompatibility"], message: "unsupported schema must be outside the allowlist" });
      }
    }
  });

export const backupExportIntentSchema = z
  .object({
    schemaVersion: z.literal(1),
    workspaceId: identifierSchema,
    operationId: identifierSchema,
    includePlatformCredentials: z.boolean(),
  })
  .strict();

export const backupArtifactSelectionIntentSchema = z
  .object({
    schemaVersion: z.literal(1),
    workspaceId: identifierSchema,
    operationId: identifierSchema,
  })
  .strict();

export const restoreConfirmationStateSchema = z
  .object({
    operationId: identifierSchema,
    dialogBindingId: identifierSchema,
    backupId: identifierSchema,
    manifestDigest: digestSchema,
    workspaceId: identifierSchema,
    candidateSetVersion: revisionSchema,
    expectedCurrentRevision: revisionSchema,
    confirmationText: z.string().max(256),
  })
  .strict();

export const restoreWorkflowIntentSchema = restoreConfirmationStateSchema
  .extend({
    schemaVersion: z.literal(1),
    confirmationText: z.string().min(1).max(256),
  })
  .strict();

export type BackupSurface = z.infer<typeof backupSurfaceSchema>;
export type BackupScopeItem = z.infer<typeof backupScopeItemSchema>;
export type RedactedCredentialConnection = z.infer<typeof redactedCredentialConnectionSchema>;
export type BackupExportSummary = z.infer<typeof backupExportSummarySchema>;
export type InternalRecoveryPoint = z.infer<typeof internalRecoveryPointSchema>;
export type SelectedBackupArtifact = z.infer<typeof selectedBackupArtifactSchema>;
export type BackupRestoreViewModel = z.infer<typeof backupRestoreViewModelSchema>;
export type BackupExportIntent = z.infer<typeof backupExportIntentSchema>;
export type BackupArtifactSelectionIntent = z.infer<typeof backupArtifactSelectionIntentSchema>;
export type RestoreConfirmationState = z.infer<typeof restoreConfirmationStateSchema>;
export type RestoreWorkflowIntent = z.infer<typeof restoreWorkflowIntentSchema>;

export interface BackupRestoreQueryBoundary {
  getBackupRestore(): Promise<unknown>;
}

export interface BackupRestoreQueryPort {
  getBackupRestore(): Promise<BackupRestoreViewModel>;
}

export interface BackupExportPort {
  exportBackup(intent: BackupExportIntent): Promise<void>;
}

export interface BackupArtifactSelectionPort {
  selectBackupArtifact(intent: BackupArtifactSelectionIntent): Promise<void>;
}

export interface RecoveryWorkflowPort {
  beginRestore(intent: RestoreWorkflowIntent): Promise<void>;
}

export function parseBackupRestoreViewModel(input: unknown): BackupRestoreViewModel {
  const parsed = backupRestoreViewModelSchema.safeParse(input);
  if (!parsed.success) throw new TypeError("invalid backup and restore projection");
  return parsed.data;
}

export class ValidatingBackupRestoreQueryPort implements BackupRestoreQueryPort {
  readonly #boundary: BackupRestoreQueryBoundary;

  constructor(boundary: BackupRestoreQueryBoundary) {
    this.#boundary = boundary;
  }

  async getBackupRestore(): Promise<BackupRestoreViewModel> {
    return parseBackupRestoreViewModel(await this.#boundary.getBackupRestore());
  }
}

export function createBackupExportIntent(
  view: BackupRestoreViewModel,
  includePlatformCredentials: boolean,
): BackupExportIntent | null {
  if (view.exportAdmission.state !== "available") return null;
  if (!canReadExportOrInspectBackup(view.surface)) return null;
  return backupExportIntentSchema.parse({
    schemaVersion: 1,
    workspaceId: view.workspaceId,
    operationId: view.exportAdmission.operationId,
    includePlatformCredentials,
  });
}

export function createBackupArtifactSelectionIntent(
  view: BackupRestoreViewModel,
): BackupArtifactSelectionIntent | null {
  if (view.artifactSelectionAdmission.state !== "available") return null;
  if (!canReadExportOrInspectBackup(view.surface)) return null;
  return backupArtifactSelectionIntentSchema.parse({
    schemaVersion: 1,
    workspaceId: view.workspaceId,
    operationId: view.artifactSelectionAdmission.operationId,
  });
}

export function requiredRestoreConfirmationText(backupId: string): string {
  return `RESTORE ${identifierSchema.parse(backupId)}`;
}

export function bindRestoreConfirmation(
  view: BackupRestoreViewModel,
  confirmationText: string,
): RestoreConfirmationState | null {
  if (!canRestoreBackup(view.surface)) return null;
  const artifact = view.selectedArtifact;
  if (artifact.state !== "verified_compatible" || artifact.restoreAdmission.state !== "available") return null;
  return restoreConfirmationStateSchema.parse({
    operationId: artifact.restoreAdmission.operationId,
    dialogBindingId: artifact.restoreAdmission.dialogBindingId,
    backupId: artifact.backupId,
    manifestDigest: artifact.manifestDigest,
    workspaceId: view.workspaceId,
    candidateSetVersion: artifact.restoreAdmission.candidateSetVersion,
    expectedCurrentRevision: artifact.restoreAdmission.expectedCurrentRevision,
    confirmationText,
  });
}

export function createRestoreWorkflowIntent(
  view: BackupRestoreViewModel,
  confirmation: RestoreConfirmationState | null,
): RestoreWorkflowIntent | null {
  if (!canRestoreBackup(view.surface)) return null;
  const artifact = view.selectedArtifact;
  if (confirmation === null || artifact.state !== "verified_compatible") return null;
  const admission = artifact.restoreAdmission;
  if (admission.state !== "available") return null;
  const expected = {
    operationId: admission.operationId,
    dialogBindingId: admission.dialogBindingId,
    backupId: artifact.backupId,
    manifestDigest: artifact.manifestDigest,
    workspaceId: view.workspaceId,
    candidateSetVersion: admission.candidateSetVersion,
    expectedCurrentRevision: admission.expectedCurrentRevision,
  };
  if (
    confirmation.operationId !== expected.operationId ||
    confirmation.dialogBindingId !== expected.dialogBindingId ||
    confirmation.backupId !== expected.backupId ||
    confirmation.manifestDigest !== expected.manifestDigest ||
    confirmation.workspaceId !== expected.workspaceId ||
    confirmation.candidateSetVersion !== expected.candidateSetVersion ||
    confirmation.expectedCurrentRevision !== expected.expectedCurrentRevision ||
    confirmation.confirmationText !== requiredRestoreConfirmationText(artifact.backupId)
  ) return null;
  return restoreWorkflowIntentSchema.parse({ schemaVersion: 1, ...expected, confirmationText: confirmation.confirmationText });
}

function canReadExportOrInspectBackup(surface: BackupSurface): boolean {
  return surface === "active" || surface === "local_continuation";
}

/** Current LocalContinuation remains read/export-only until Sunset authority is delivered. */
function canRestoreBackup(surface: BackupSurface): boolean {
  return surface === "active";
}
