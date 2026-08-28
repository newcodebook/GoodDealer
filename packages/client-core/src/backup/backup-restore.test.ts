import { describe, expect, expectTypeOf, it, vi } from "vitest";

import {
  ValidatingBackupRestoreQueryPort,
  backupRestoreViewModelSchema,
  bindRestoreConfirmation,
  createBackupArtifactSelectionIntent,
  createBackupExportIntent,
  createRestoreWorkflowIntent,
  parseBackupRestoreViewModel,
  requiredRestoreConfirmationText,
  type BackupExportPort,
  type BackupRestoreViewModel,
  type RecoveryWorkflowPort,
} from "./backup-restore";

const DIGEST = "D".repeat(43);
const restoreAdmission = {
  state: "available",
  operationId: "restore-operation-1",
  dialogBindingId: "restore-dialog-1",
  candidateSetVersion: 4,
  expectedCurrentRevision: 12,
} as const;

function compatibleArtifact(overrides: Record<string, unknown> = {}) {
  return {
    state: "verified_compatible",
    protection: "host_decrypted_and_manifest_verified",
    backupId: "backup-1",
    manifestDigest: DIGEST,
    workspaceId: "workspace-1",
    backupSchemaVersion: 1,
    backupCreatedAt: "2026-08-16T05:00:00Z",
    backupRevision: 10,
    restoreAdmission,
    ...overrides,
  };
}

function view(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    kind: "backup_restore",
    workspaceId: "workspace-1",
    surface: "active",
    currentRevision: 12,
    supportedBackupSchemaVersions: [1],
    exportSummary: {
      sourceDeviceDisplay: "This device",
      backupSchemaVersion: 1,
      encryptionDisplay: "Host-managed encryption",
      destinationKind: "user_selected_location",
      scope: ["portfolio", "listing_target_state", "tags_cost_notes", "redacted_execution_fact_summary"],
      credentialConnections: [{ providerDisplay: "Example provider", accountAlias: "Primary" }],
      credentialsIncludedByDefault: false,
    },
    exportAdmission: { state: "available", operationId: "export-operation-1" },
    artifactSelectionAdmission: { state: "available", operationId: "selection-operation-1" },
    selectedArtifact: compatibleArtifact(),
    recoveryPoints: [{
      recoveryPointId: "point-1",
      createdAt: "2026-08-16T04:00:00Z",
      backupSchemaVersion: 1,
      sizeBytes: 4_200_000,
      reason: "pre_restore",
    }],
    ...overrides,
  };
}

describe("BackupRestore contract", () => {
  it("exposes only typed query/export/workflow Ports and no rollback authority", () => {
    expectTypeOf<keyof BackupExportPort>().toEqualTypeOf<"exportBackup">();
    expectTypeOf<keyof RecoveryWorkflowPort>().toEqualTypeOf<"beginRestore">();
    expectTypeOf<keyof RecoveryWorkflowPort>().not.toEqualTypeOf<"rollbackRecoveryPoint">();
  });

  it("keeps unverified artifact summaries opaque and action-free", () => {
    const parsed = parseBackupRestoreViewModel({
      ...view(),
      selectedArtifact: { state: "unverified" },
    });
    expect(parsed.selectedArtifact).toEqual({ state: "unverified" });
    expect(parsed.selectedArtifact).not.toHaveProperty("backupId");
    expect(parsed.selectedArtifact).not.toHaveProperty("restoreAdmission");
    expect(createRestoreWorkflowIntent(parsed, null)).toBeNull();
  });

  it("requires exact operation-bound confirmation for a verified compatible artifact", () => {
    const parsed = parseBackupRestoreViewModel(view());
    expect(requiredRestoreConfirmationText("backup-1")).toBe("RESTORE backup-1");
    const confirmation = bindRestoreConfirmation(parsed, "RESTORE backup-1");
    expect(createRestoreWorkflowIntent(parsed, confirmation)).toEqual({
      schemaVersion: 1,
      operationId: "restore-operation-1",
      dialogBindingId: "restore-dialog-1",
      backupId: "backup-1",
      manifestDigest: DIGEST,
      workspaceId: "workspace-1",
      candidateSetVersion: 4,
      expectedCurrentRevision: 12,
      confirmationText: "RESTORE backup-1",
    });
    expect(createRestoreWorkflowIntent(parsed, bindRestoreConfirmation(parsed, "restore backup-1"))).toBeNull();
  });

  it("rejects LocalContinuation restore admission and blocks typed surface laundering", () => {
    const active = parseBackupRestoreViewModel(view());
    const activeConfirmation = bindRestoreConfirmation(active, "RESTORE backup-1");
    const forgedLocalContinuation = {
      ...active,
      surface: "local_continuation",
    } as BackupRestoreViewModel;

    expect(backupRestoreViewModelSchema.safeParse(forgedLocalContinuation).success).toBe(false);
    expect(() => parseBackupRestoreViewModel(forgedLocalContinuation)).toThrow(
      "invalid backup and restore projection",
    );
    expect(bindRestoreConfirmation(forgedLocalContinuation, "RESTORE backup-1")).toBeNull();
    expect(createRestoreWorkflowIntent(forgedLocalContinuation, activeConfirmation)).toBeNull();
  });

  it("keeps LocalContinuation export and inspection-only selection without restore authority", () => {
    const localContinuation = parseBackupRestoreViewModel({
      ...view(),
      surface: "local_continuation",
      selectedArtifact: compatibleArtifact({ restoreAdmission: { state: "unavailable" } }),
    });

    expect(createBackupExportIntent(localContinuation, false)).toEqual({
      schemaVersion: 1,
      workspaceId: "workspace-1",
      operationId: "export-operation-1",
      includePlatformCredentials: false,
    });
    expect(createBackupArtifactSelectionIntent(localContinuation)).toEqual({
      schemaVersion: 1,
      workspaceId: "workspace-1",
      operationId: "selection-operation-1",
    });
    expect(bindRestoreConfirmation(localContinuation, "RESTORE backup-1")).toBeNull();
    expect(createRestoreWorkflowIntent(localContinuation, null)).toBeNull();
  });

  it("invalidates confirmation when candidate, artifact, workspace, revision, or dialog binding changes", () => {
    const parsed = parseBackupRestoreViewModel(view());
    const confirmation = bindRestoreConfirmation(parsed, "RESTORE backup-1");
    const variants = [
      { ...view(), selectedArtifact: compatibleArtifact({ backupId: "backup-2" }) },
      { ...view(), selectedArtifact: compatibleArtifact({ manifestDigest: "E".repeat(43) }) },
      { ...view(), workspaceId: "workspace-2", selectedArtifact: compatibleArtifact({ workspaceId: "workspace-2" }) },
      { ...view(), currentRevision: 13, selectedArtifact: compatibleArtifact({ restoreAdmission: { ...restoreAdmission, expectedCurrentRevision: 13 } }) },
      { ...view(), selectedArtifact: compatibleArtifact({ restoreAdmission: { ...restoreAdmission, dialogBindingId: "restore-dialog-2" } }) },
      { ...view(), selectedArtifact: compatibleArtifact({ restoreAdmission: { ...restoreAdmission, candidateSetVersion: 5 } }) },
    ];
    for (const variant of variants) {
      expect(createRestoreWorkflowIntent(parseBackupRestoreViewModel(variant), confirmation)).toBeNull();
    }
  });

  it.each([
    ["unknown root", { ...view(), extra: true }],
    ["unknown version", { ...view(), schemaVersion: 999 }],
    ["workspace mismatch marked compatible", { ...view(), selectedArtifact: compatibleArtifact({ workspaceId: "workspace-2" }) }],
    ["unsupported schema marked compatible", { ...view(), selectedArtifact: compatibleArtifact({ backupSchemaVersion: 99 }) }],
    ["truncated manifest digest", { ...view(), selectedArtifact: compatibleArtifact({ manifestDigest: "short" }) }],
    ["revision mismatch", { ...view(), currentRevision: 13 }],
    ["standby export authority", { ...view(), surface: "standby", exportAdmission: { state: "available", operationId: "export-operation-1" }, artifactSelectionAdmission: { state: "unavailable" }, selectedArtifact: { state: "none" } }],
    ["duplicate recovery point", { ...view(), recoveryPoints: [{ recoveryPointId: "point-1", createdAt: "2026-08-16T04:00:00Z", backupSchemaVersion: 1, sizeBytes: 1, reason: "pre_restore" }, { recoveryPointId: "point-1", createdAt: "2026-08-16T05:00:00Z", backupSchemaVersion: 1, sizeBytes: 2, reason: "pre_restore" }] }],
    ["raw path field", { ...view(), exportSummary: { ...(view()["exportSummary"] as Record<string, unknown>), destinationPath: "/tmp/backup" } }],
    ["bidi metadata", { ...view(), exportSummary: { ...(view()["exportSummary"] as Record<string, unknown>), sourceDeviceDisplay: "safe\u202Eevil" } }],
  ])("fails closed for %s", (_label, input) => {
    expect(backupRestoreViewModelSchema.safeParse(input).success).toBe(false);
  });

  it("creates export intent only from an adjudicated surface and keeps credentials opt-in", () => {
    const parsed = parseBackupRestoreViewModel(view());
    expect(parsed.exportSummary.credentialsIncludedByDefault).toBe(false);
    expect(createBackupExportIntent(parsed, false)).toEqual({
      schemaVersion: 1,
      workspaceId: "workspace-1",
      operationId: "export-operation-1",
      includePlatformCredentials: false,
    });
    expect(createBackupArtifactSelectionIntent(parsed)).toEqual({
      schemaVersion: 1,
      workspaceId: "workspace-1",
      operationId: "selection-operation-1",
    });
    const unavailable = parseBackupRestoreViewModel({ ...view(), exportAdmission: { state: "unavailable" } });
    expect(createBackupExportIntent(unavailable, true)).toBeNull();
  });

  it("validates unknown boundary output with a non-reflective error", async () => {
    const port = new ValidatingBackupRestoreQueryPort({
      getBackupRestore: vi.fn(async () => ({ privateKey: "do-not-leak" })),
    });
    await expect(port.getBackupRestore()).rejects.toThrow("invalid backup and restore projection");
    await expect(port.getBackupRestore()).rejects.not.toThrow("do-not-leak");
  });

  it("rejects backup projections that try to resurrect runtime authority", () => {
    for (const forbidden of [
      { workerLease: "lease-1" },
      { activeLeaseEpoch: 99 },
      { trustedTime: "2099-01-01T00:00:00Z" },
      { deviceIdentity: "device-key-1" },
      { approvedOperation: "approval-1" },
      { automationExecutionTicket: "ticket-1" },
      { queue: [] },
      { outbox: [] },
    ]) {
      expect(backupRestoreViewModelSchema.safeParse({ ...view(), ...forbidden }).success).toBe(false);
    }
  });

  it("keeps the valid model type exact", () => {
    expectTypeOf(parseBackupRestoreViewModel(view())).toEqualTypeOf<BackupRestoreViewModel>();
  });
});
