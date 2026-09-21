import { z } from "zod";

const MAXIMUM_WIRE_DEPTH = 6;
const MAXIMUM_WIRE_ENTRIES = 128;
const MAXIMUM_WIRE_STRING_LENGTH = 256;
const FORBIDDEN_TEXT = /[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb]/u;

const opaqueIdentifierSchema = z
  .string()
  .min(16)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/u);
const safeRevisionSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const positiveSafeIntegerSchema = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const candidateSetVersionSchema = positiveSafeIntegerSchema;
const canonicalUtcTimestampSchema = z.iso.datetime({ offset: false, precision: 0 });

export const backupOperationIdSchema = opaqueIdentifierSchema.brand<"BackupOperationId">();
export const backupDialogIdSchema = opaqueIdentifierSchema.brand<"BackupDialogId">();
export const backupArtifactIdSchema = opaqueIdentifierSchema.brand<"BackupArtifactId">();

export const localBackupCommandNames = {
  status: "local_backup_restore_status",
  export: "local_backup_export",
  selectArtifact: "local_backup_artifact_select",
  beginRestore: "local_backup_restore_begin",
} as const;

export const backupAuthoritySchema = z.enum([
  "active",
  "verified_local_continuation",
  "unavailable",
]);

export const backupErrorCodeSchema = z.enum([
  "BACKUP_ARTIFACT_REJECTED",
  "BACKUP_KEY_UNAVAILABLE",
  "BACKUP_CREDENTIALS_NOT_ALLOWED",
  "BACKUP_AUTHORITY_REJECTED",
  "BACKUP_OPERATION_REJECTED",
  "BACKUP_CONFLICT_REJECTED",
  "BACKUP_STORAGE_REJECTED",
  "BACKUP_RESPONSE_REJECTED",
  "LOCAL_AUTHORIZATION_REQUIRED",
  "LOCAL_STORAGE_REJECTED",
  "LOCAL_REVISION_REJECTED",
  "LOCAL_RESPONSE_REJECTED",
]);

const unavailableAdmissionSchema = z.object({ state: z.literal("unavailable") }).strict();
const availableAdmissionSchema = z
  .object({
    state: z.literal("available"),
    operationId: backupOperationIdSchema,
  })
  .strict();

const restoreAdmissionSchema = z.discriminatedUnion("state", [
  unavailableAdmissionSchema,
  z
    .object({
      state: z.literal("available"),
      operationId: backupOperationIdSchema,
      dialogId: backupDialogIdSchema,
      expectedCurrentRevision: safeRevisionSchema,
      candidateSetVersion: candidateSetVersionSchema,
    })
    .strict(),
]);

export const verifiedBackupArtifactSchema = z
  .object({
    state: z.literal("verified"),
    artifactId: backupArtifactIdSchema,
    createdAt: canonicalUtcTimestampSchema,
    backupSchemaVersion: positiveSafeIntegerSchema,
    compatibility: z.enum(["compatible", "unsupported_schema"]),
    restoreAdmission: restoreAdmissionSchema,
  })
  .strict()
  .superRefine((artifact, context) => {
    if (artifact.compatibility !== "compatible" && artifact.restoreAdmission.state === "available") {
      context.addIssue({
        code: "custom",
        path: ["restoreAdmission"],
        message: "an incompatible artifact cannot admit restore",
      });
    }
  });

export const selectedBackupArtifactSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("none") }).strict(),
  z.object({ state: z.literal("inspecting") }).strict(),
  z
    .object({
      state: z.literal("rejected"),
      error: z.enum(["BACKUP_ARTIFACT_REJECTED", "BACKUP_KEY_UNAVAILABLE"]),
    })
    .strict(),
  verifiedBackupArtifactSchema,
]);

export const backupRestoreViewModelSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("local_backup_restore_status"),
    authority: backupAuthoritySchema,
    exportAdmission: z.discriminatedUnion("state", [
      unavailableAdmissionSchema,
      availableAdmissionSchema,
    ]),
    artifactSelectionAdmission: z.discriminatedUnion("state", [
      unavailableAdmissionSchema,
      availableAdmissionSchema,
    ]),
    selectedArtifact: selectedBackupArtifactSchema,
    error: backupErrorCodeSchema.nullable(),
  })
  .strict()
  .superRefine((view, context) => {
    const canExportOrInspect = view.authority === "active" ||
      view.authority === "verified_local_continuation";
    if (!canExportOrInspect && view.exportAdmission.state === "available") {
      context.addIssue({
        code: "custom",
        path: ["exportAdmission"],
        message: "the current authority cannot export",
      });
    }
    if (!canExportOrInspect && view.artifactSelectionAdmission.state === "available") {
      context.addIssue({
        code: "custom",
        path: ["artifactSelectionAdmission"],
        message: "the current authority cannot inspect artifacts",
      });
    }
    if (
      view.selectedArtifact.state === "verified" &&
      view.selectedArtifact.restoreAdmission.state === "available" &&
      view.authority !== "active"
    ) {
      context.addIssue({
        code: "custom",
        path: ["selectedArtifact", "restoreAdmission"],
        message: "only active authority can restore",
      });
    }

    const operationIds = [
      view.exportAdmission.state === "available" ? view.exportAdmission.operationId : null,
      view.artifactSelectionAdmission.state === "available"
        ? view.artifactSelectionAdmission.operationId
        : null,
      view.selectedArtifact.state === "verified" &&
      view.selectedArtifact.restoreAdmission.state === "available"
        ? view.selectedArtifact.restoreAdmission.operationId
        : null,
    ].filter((operationId): operationId is BackupOperationId => operationId !== null);
    if (new Set(operationIds).size !== operationIds.length) {
      context.addIssue({
        code: "custom",
        path: ["exportAdmission"],
        message: "an operation cannot authorize more than one action",
      });
    }
  });

export const backupExportIntentSchema = z
  .object({
    schemaVersion: z.literal(1),
    operationId: backupOperationIdSchema,
    includePlatformCredentials: z.literal(false),
  })
  .strict();

export const backupArtifactSelectionIntentSchema = z
  .object({
    schemaVersion: z.literal(1),
    operationId: backupOperationIdSchema,
  })
  .strict();

export const REQUIRED_BACKUP_RESTORE_CONFIRMATION = "RESTORE LOCAL BACKUP" as const;

export const restoreConfirmationStateSchema = z
  .object({
    operationId: backupOperationIdSchema,
    dialogId: backupDialogIdSchema,
    artifactId: backupArtifactIdSchema,
    expectedCurrentRevision: safeRevisionSchema,
    candidateSetVersion: candidateSetVersionSchema,
    confirmation: z.literal(REQUIRED_BACKUP_RESTORE_CONFIRMATION),
  })
  .strict();

export const restoreWorkflowIntentSchema = restoreConfirmationStateSchema
  .extend({ schemaVersion: z.literal(1) })
  .strict();

export type BackupOperationId = z.infer<typeof backupOperationIdSchema>;
export type BackupDialogId = z.infer<typeof backupDialogIdSchema>;
export type BackupArtifactId = z.infer<typeof backupArtifactIdSchema>;
export type BackupAuthority = z.infer<typeof backupAuthoritySchema>;
export type BackupErrorCode = z.infer<typeof backupErrorCodeSchema>;
export type VerifiedBackupArtifact = z.infer<typeof verifiedBackupArtifactSchema>;
export type SelectedBackupArtifact = z.infer<typeof selectedBackupArtifactSchema>;
export type BackupRestoreViewModel = z.infer<typeof backupRestoreViewModelSchema>;
export type BackupExportIntent = z.infer<typeof backupExportIntentSchema>;
export type BackupArtifactSelectionIntent = z.infer<typeof backupArtifactSelectionIntentSchema>;
export type RestoreConfirmationState = z.infer<typeof restoreConfirmationStateSchema>;
export type RestoreWorkflowIntent = z.infer<typeof restoreWorkflowIntentSchema>;

export interface BackupRestoreStatusBoundary {
  getBackupRestoreStatus(): Promise<unknown>;
}

export interface BackupRestoreStatusPort {
  getBackupRestoreStatus(): Promise<BackupRestoreViewModel>;
}

export interface BackupCommandPort {
  exportBackup(intent: BackupExportIntent): Promise<void>;
  selectBackupArtifact(intent: BackupArtifactSelectionIntent): Promise<void>;
  beginRestore(intent: RestoreWorkflowIntent): Promise<void>;
}

export function parseBackupRestoreViewModel(input: unknown): BackupRestoreViewModel {
  let copied: unknown;
  try {
    copied = copyBackupWireValue(input);
  } catch {
    throw new TypeError("invalid local backup response");
  }
  const parsed = backupRestoreViewModelSchema.safeParse(copied);
  if (!parsed.success) throw new TypeError("invalid local backup response");
  return parsed.data;
}

export function parseRestoreConfirmationState(input: unknown): RestoreConfirmationState {
  let copied: unknown;
  try {
    copied = copyBackupWireValue(input);
  } catch {
    throw new TypeError("invalid local backup confirmation");
  }
  const parsed = restoreConfirmationStateSchema.safeParse(copied);
  if (!parsed.success) throw new TypeError("invalid local backup confirmation");
  return parsed.data;
}

export function toBackupErrorCode(input: unknown): BackupErrorCode {
  const parsed = backupErrorCodeSchema.safeParse(input);
  return parsed.success ? parsed.data : "BACKUP_RESPONSE_REJECTED";
}

export class ValidatingBackupRestoreStatusPort implements BackupRestoreStatusPort {
  readonly #boundary: BackupRestoreStatusBoundary;

  constructor(boundary: BackupRestoreStatusBoundary) {
    this.#boundary = boundary;
  }

  async getBackupRestoreStatus(): Promise<BackupRestoreViewModel> {
    return parseBackupRestoreViewModel(await this.#boundary.getBackupRestoreStatus());
  }
}

export function createBackupExportIntent(
  viewInput: unknown,
  includePlatformCredentials: boolean,
): BackupExportIntent | null {
  if (includePlatformCredentials !== false) return null;
  const view = parseBackupRestoreViewModel(viewInput);
  if (view.exportAdmission.state !== "available" || !canExportOrInspect(view.authority)) return null;
  return backupExportIntentSchema.parse({
    schemaVersion: 1,
    operationId: view.exportAdmission.operationId,
    includePlatformCredentials: false,
  });
}

export function createBackupArtifactSelectionIntent(
  viewInput: unknown,
): BackupArtifactSelectionIntent | null {
  const view = parseBackupRestoreViewModel(viewInput);
  if (
    view.artifactSelectionAdmission.state !== "available" ||
    !canExportOrInspect(view.authority)
  ) return null;
  return backupArtifactSelectionIntentSchema.parse({
    schemaVersion: 1,
    operationId: view.artifactSelectionAdmission.operationId,
  });
}

export function bindRestoreConfirmation(
  viewInput: unknown,
  confirmationInput: unknown,
): RestoreConfirmationState | null {
  if (confirmationInput !== REQUIRED_BACKUP_RESTORE_CONFIRMATION) return null;
  const view = parseBackupRestoreViewModel(viewInput);
  if (view.authority !== "active" || view.selectedArtifact.state !== "verified") return null;
  const admission = view.selectedArtifact.restoreAdmission;
  if (view.selectedArtifact.compatibility !== "compatible" || admission.state !== "available") {
    return null;
  }
  return restoreConfirmationStateSchema.parse({
    operationId: admission.operationId,
    dialogId: admission.dialogId,
    artifactId: view.selectedArtifact.artifactId,
    expectedCurrentRevision: admission.expectedCurrentRevision,
    candidateSetVersion: admission.candidateSetVersion,
    confirmation: confirmationInput,
  });
}

export function createRestoreWorkflowIntent(
  viewInput: unknown,
  confirmationInput: unknown,
): RestoreWorkflowIntent | null {
  const view = parseBackupRestoreViewModel(viewInput);
  if (view.authority !== "active" || view.selectedArtifact.state !== "verified") return null;
  const admission = view.selectedArtifact.restoreAdmission;
  if (view.selectedArtifact.compatibility !== "compatible" || admission.state !== "available") {
    return null;
  }

  let confirmation: RestoreConfirmationState;
  try {
    confirmation = parseRestoreConfirmationState(confirmationInput);
  } catch {
    return null;
  }
  if (
    confirmation.operationId !== admission.operationId ||
    confirmation.dialogId !== admission.dialogId ||
    confirmation.artifactId !== view.selectedArtifact.artifactId ||
    confirmation.expectedCurrentRevision !== admission.expectedCurrentRevision ||
    confirmation.candidateSetVersion !== admission.candidateSetVersion
  ) return null;

  return restoreWorkflowIntentSchema.parse({ schemaVersion: 1, ...confirmation });
}

/**
 * Renderer-local request and replay fence. It never derives Host authority and never invokes IPC.
 */
export class BackupIntentSession {
  #latestRequest = 0;
  #acceptedRequest = 0;
  #view: BackupRestoreViewModel | null = null;
  readonly #consumedOperationIds = new Set<BackupOperationId>();

  beginStatusRequest(): number {
    this.#latestRequest += 1;
    this.#view = null;
    return this.#latestRequest;
  }

  acceptStatusResponse(request: number, input: unknown): BackupRestoreViewModel | null {
    if (
      !Number.isSafeInteger(request) ||
      request <= 0 ||
      request !== this.#latestRequest ||
      request === this.#acceptedRequest
    ) return null;
    this.#view = parseBackupRestoreViewModel(input);
    this.#acceptedRequest = request;
    return this.#view;
  }

  invalidate(): void {
    this.#latestRequest += 1;
    this.#view = null;
  }

  createExportIntent(includePlatformCredentials: boolean): BackupExportIntent | null {
    if (this.#view === null) return null;
    const intent = createBackupExportIntent(this.#view, includePlatformCredentials);
    return intent === null || !this.#consume(intent.operationId) ? null : intent;
  }

  createArtifactSelectionIntent(): BackupArtifactSelectionIntent | null {
    if (this.#view === null) return null;
    const intent = createBackupArtifactSelectionIntent(this.#view);
    return intent === null || !this.#consume(intent.operationId) ? null : intent;
  }

  bindRestoreConfirmation(input: unknown): RestoreConfirmationState | null {
    return this.#view === null ? null : bindRestoreConfirmation(this.#view, input);
  }

  createRestoreIntent(confirmation: unknown): RestoreWorkflowIntent | null {
    if (this.#view === null) return null;
    const intent = createRestoreWorkflowIntent(this.#view, confirmation);
    return intent === null || !this.#consume(intent.operationId) ? null : intent;
  }

  #consume(operationId: BackupOperationId): boolean {
    if (this.#consumedOperationIds.has(operationId)) return false;
    // An unexpectedly long-lived UI session fails closed instead of forgetting replay history.
    if (this.#consumedOperationIds.size >= 128) {
      this.invalidate();
      return false;
    }
    this.#consumedOperationIds.add(operationId);
    return true;
  }
}

function canExportOrInspect(authority: BackupAuthority): boolean {
  return authority === "active" || authority === "verified_local_continuation";
}

function copyBackupWireValue(input: unknown): unknown {
  let entries = 0;
  const seen = new Set<object>();

  const copy = (value: unknown, depth: number): unknown => {
    entries += 1;
    if (depth > MAXIMUM_WIRE_DEPTH || entries > MAXIMUM_WIRE_ENTRIES) {
      throw new TypeError("invalid local backup response");
    }
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "number") {
      if (!Number.isSafeInteger(value)) throw new TypeError("invalid local backup response");
      return value;
    }
    if (typeof value === "string") {
      if (value.length > MAXIMUM_WIRE_STRING_LENGTH || FORBIDDEN_TEXT.test(value)) {
        throw new TypeError("invalid local backup response");
      }
      return value;
    }
    if (typeof value !== "object") throw new TypeError("invalid local backup response");
    if (seen.has(value)) throw new TypeError("invalid local backup response");
    seen.add(value);

    try {
      const prototype = Object.getPrototypeOf(value);
      const descriptors = Object.getOwnPropertyDescriptors(value);
      const keys = Reflect.ownKeys(descriptors);
      if (Array.isArray(value)) {
        if (prototype !== Array.prototype || value.length > 32) {
          throw new TypeError("invalid local backup response");
        }
        if (
          keys.some((key) =>
            typeof key !== "string" || (key !== "length" && !/^(0|[1-9][0-9]*)$/u.test(key))
          )
        ) throw new TypeError("invalid local backup response");
        const result: unknown[] = [];
        for (let index = 0; index < value.length; index += 1) {
          const descriptor = descriptors[String(index)];
          if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
            throw new TypeError("invalid local backup response");
          }
          result.push(copy(descriptor.value, depth + 1));
        }
        return result;
      }
      if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError("invalid local backup response");
      }
      if (keys.some((key) => typeof key !== "string")) {
        throw new TypeError("invalid local backup response");
      }
      const result: Record<string, unknown> = Object.create(null);
      for (const key of keys) {
        if (typeof key !== "string") throw new TypeError("invalid local backup response");
        const descriptor = descriptors[key];
        if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
          throw new TypeError("invalid local backup response");
        }
        result[key] = copy(descriptor.value, depth + 1);
      }
      return result;
    } finally {
      seen.delete(value);
    }
  };

  return copy(input, 0);
}
