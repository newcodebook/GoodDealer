import { describe, expect, expectTypeOf, it, vi } from "vitest";
import * as backupContract from "./backup-restore";

import {
  BackupIntentSession,
  REQUIRED_BACKUP_RESTORE_CONFIRMATION,
  ValidatingBackupRestoreStatusPort,
  backupArtifactSelectionIntentSchema,
  backupErrorCodeSchema,
  backupExportIntentSchema,
  backupRestoreViewModelSchema,
  bindRestoreConfirmation,
  createBackupArtifactSelectionIntent,
  createBackupExportIntent,
  createRestoreWorkflowIntent,
  localBackupCommandNames,
  parseBackupRestoreViewModel,
  restoreConfirmationStateSchema,
  restoreWorkflowIntentSchema,
  toBackupErrorCode,
  type BackupCommandPort,
  type BackupRestoreViewModel,
} from "./backup-restore";

const operationId = "operation-opaque-0001";
const dialogId = "dialog-opaque-0001";
const artifactId = "artifact-opaque-0001";

function artifact(overrides: Record<string, unknown> = {}) {
  return {
    state: "verified",
    artifactId,
    createdAt: "2026-08-16T05:00:00Z",
    backupSchemaVersion: 1,
    compatibility: "compatible",
    restoreAdmission: {
      state: "available",
      operationId,
      dialogId,
      expectedCurrentRevision: 12,
      candidateSetVersion: 4,
    },
    ...overrides,
  };
}

function view(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    kind: "local_backup_restore_status",
    authority: "active",
    exportAdmission: { state: "available", operationId: "export-opaque-0001" },
    artifactSelectionAdmission: { state: "available", operationId: "select-opaque-0001" },
    selectedArtifact: artifact(),
    error: null,
    ...overrides,
  };
}

describe("local backup client contract", () => {
  it("maps the four purpose-specific Desktop commands exactly", () => {
    expect(localBackupCommandNames).toEqual({
      status: "local_backup_restore_status",
      export: "local_backup_export",
      selectArtifact: "local_backup_artifact_select",
      beginRestore: "local_backup_restore_begin",
    });
  });

  it("exposes only purpose-specific command methods", () => {
    expectTypeOf<keyof BackupCommandPort>().toEqualTypeOf<
      "exportBackup" | "selectBackupArtifact" | "beginRestore"
    >();
  });

  it("admits active export and artifact inspection without workspace/path data", () => {
    const parsed = parseBackupRestoreViewModel(view());
    expect(createBackupExportIntent(parsed, false)).toEqual({
      schemaVersion: 1,
      operationId: "export-opaque-0001",
      includePlatformCredentials: false,
    });
    expect(createBackupArtifactSelectionIntent(parsed)).toEqual({
      schemaVersion: 1,
      operationId: "select-opaque-0001",
    });
    expect(JSON.stringify(parsed)).not.toMatch(/workspace|path|provider|account|manifest|digest|secret|key/i);
  });

  it("keeps verified local continuation export/inspect-only", () => {
    const parsed = parseBackupRestoreViewModel({
      ...view(),
      authority: "verified_local_continuation",
      selectedArtifact: artifact({ restoreAdmission: { state: "unavailable" } }),
    });
    expect(createBackupExportIntent(parsed, false)).not.toBeNull();
    expect(createBackupArtifactSelectionIntent(parsed)).not.toBeNull();
    expect(bindRestoreConfirmation(parsed, REQUIRED_BACKUP_RESTORE_CONFIRMATION)).toBeNull();
    expect(createRestoreWorkflowIntent(parsed, REQUIRED_BACKUP_RESTORE_CONFIRMATION)).toBeNull();
  });

  it("requires active authority and exact opaque CAS fields for restore", () => {
    const parsed = parseBackupRestoreViewModel(view());
    const confirmation = bindRestoreConfirmation(parsed, REQUIRED_BACKUP_RESTORE_CONFIRMATION);
    expect(confirmation).toEqual({
      operationId,
      dialogId,
      artifactId,
      expectedCurrentRevision: 12,
      candidateSetVersion: 4,
      confirmation: REQUIRED_BACKUP_RESTORE_CONFIRMATION,
    });
    expect(createRestoreWorkflowIntent(parsed, confirmation)).toEqual({
      schemaVersion: 1,
      ...confirmation,
    });
    expect(Object.keys(createRestoreWorkflowIntent(parsed, confirmation) ?? {}).sort()).toEqual([
      "artifactId",
      "candidateSetVersion",
      "confirmation",
      "dialogId",
      "expectedCurrentRevision",
      "operationId",
      "schemaVersion",
    ]);
    expect(createRestoreWorkflowIntent(parsed, {
      ...confirmation,
      candidateSetVersion: 5,
    })).toBeNull();
    expect(createRestoreWorkflowIntent(parsed, "RESTORE artifact-opaque-0001")).toBeNull();
  });

  it("rejects every stale restore binding independently", () => {
    const parsed = parseBackupRestoreViewModel(view());
    const confirmation = bindRestoreConfirmation(parsed, REQUIRED_BACKUP_RESTORE_CONFIRMATION);
    expect(confirmation).not.toBeNull();
    const staleViews = [
      view({
        selectedArtifact: artifact({
          restoreAdmission: {
            ...artifact().restoreAdmission,
            operationId: "operation-opaque-0002",
          },
        }),
      }),
      view({
        selectedArtifact: artifact({
          restoreAdmission: {
            ...artifact().restoreAdmission,
            dialogId: "dialog-opaque-0002",
          },
        }),
      }),
      view({ selectedArtifact: artifact({ artifactId: "artifact-opaque-0002" }) }),
      view({
        selectedArtifact: artifact({
          restoreAdmission: {
            ...artifact().restoreAdmission,
            candidateSetVersion: 5,
          },
        }),
      }),
      view({
        selectedArtifact: artifact({
          restoreAdmission: {
            ...artifact().restoreAdmission,
            expectedCurrentRevision: 13,
          },
        }),
      }),
    ];
    for (const stale of staleViews) {
      expect(createRestoreWorkflowIntent(stale, confirmation)).toBeNull();
    }
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects hostile Host candidate-set version %s at every wire schema",
    async (candidateSetVersion) => {
      const hostileView = view({
        selectedArtifact: artifact({
          restoreAdmission: {
            ...artifact().restoreAdmission,
            candidateSetVersion,
          },
        }),
      });
      expect(backupRestoreViewModelSchema.safeParse(hostileView).success).toBe(false);

      const port = new ValidatingBackupRestoreStatusPort({
        getBackupRestoreStatus: vi.fn(async () => hostileView),
      });
      await expect(port.getBackupRestoreStatus()).rejects.toThrow("invalid local backup response");

      const hostileConfirmation = {
        operationId,
        dialogId,
        artifactId,
        expectedCurrentRevision: 12,
        candidateSetVersion,
        confirmation: REQUIRED_BACKUP_RESTORE_CONFIRMATION,
      };
      expect(restoreConfirmationStateSchema.safeParse(hostileConfirmation).success).toBe(false);
      expect(restoreWorkflowIntentSchema.safeParse({
        schemaVersion: 1,
        ...hostileConfirmation,
      }).success).toBe(false);
      expect(createRestoreWorkflowIntent(view(), hostileConfirmation)).toBeNull();
    },
  );

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects unsafe expected-current revision %s across Host and restore boundaries",
    async (expectedCurrentRevision) => {
      const hostileView = view({
        selectedArtifact: artifact({
          restoreAdmission: {
            ...artifact().restoreAdmission,
            expectedCurrentRevision,
          },
        }),
      });
      const port = new ValidatingBackupRestoreStatusPort({
        getBackupRestoreStatus: vi.fn(async () => hostileView),
      });
      await expect(port.getBackupRestoreStatus()).rejects.toThrow("invalid local backup response");

      const hostileConfirmation = {
        operationId,
        dialogId,
        artifactId,
        expectedCurrentRevision,
        candidateSetVersion: 4,
        confirmation: REQUIRED_BACKUP_RESTORE_CONFIRMATION,
      };
      expect(restoreConfirmationStateSchema.safeParse(hostileConfirmation).success).toBe(false);
      expect(restoreWorkflowIntentSchema.safeParse({
        schemaVersion: 1,
        ...hostileConfirmation,
      }).success).toBe(false);
      expect(createRestoreWorkflowIntent(view(), hostileConfirmation)).toBeNull();
    },
  );

  it("allows current revision zero while still requiring a positive candidate-set version", () => {
    const initialRevisionView = view({
      selectedArtifact: artifact({
        restoreAdmission: {
          ...artifact().restoreAdmission,
          expectedCurrentRevision: 0,
          candidateSetVersion: 1,
        },
      }),
    });
    const confirmation = bindRestoreConfirmation(
      initialRevisionView,
      REQUIRED_BACKUP_RESTORE_CONFIRMATION,
    );
    expect(createRestoreWorkflowIntent(initialRevisionView, confirmation)).toMatchObject({
      expectedCurrentRevision: 0,
      candidateSetVersion: 1,
    });
  });

  it("rebuilds hostile confirmation state without invoking CAS accessors", () => {
    const confirmation = bindRestoreConfirmation(view(), REQUIRED_BACKUP_RESTORE_CONFIRMATION);
    const getter = vi.fn(() => 4);
    const hostile = Object.defineProperty(
      { ...confirmation },
      "candidateSetVersion",
      { enumerable: true, get: getter },
    );
    expect(createRestoreWorkflowIntent(view(), hostile)).toBeNull();
    expect(getter).not.toHaveBeenCalled();
  });

  it("accepts the largest safe positive candidate-set version without weakening exact CAS", () => {
    const maximumView = view({
      selectedArtifact: artifact({
        restoreAdmission: {
          ...artifact().restoreAdmission,
          expectedCurrentRevision: Number.MAX_SAFE_INTEGER,
          candidateSetVersion: Number.MAX_SAFE_INTEGER,
        },
      }),
    });
    const parsed = parseBackupRestoreViewModel(maximumView);
    const confirmation = bindRestoreConfirmation(parsed, REQUIRED_BACKUP_RESTORE_CONFIRMATION);
    expect(confirmation).toMatchObject({
      expectedCurrentRevision: Number.MAX_SAFE_INTEGER,
      candidateSetVersion: Number.MAX_SAFE_INTEGER,
    });
    expect(createRestoreWorkflowIntent(parsed, {
      ...confirmation,
      candidateSetVersion: Number.MAX_SAFE_INTEGER - 1,
    })).toBeNull();
  });

  it("always rejects credential inclusion, including truthy coercion attempts", () => {
    const parsed = parseBackupRestoreViewModel(view());
    expect(createBackupExportIntent(parsed, true)).toBeNull();
    expect(createBackupExportIntent(parsed, "true" as unknown as boolean)).toBeNull();
    expect(createBackupExportIntent(parsed, 0 as unknown as boolean)).toBeNull();
    expect(backupErrorCodeSchema.parse("BACKUP_CREDENTIALS_NOT_ALLOWED")).toBe(
      "BACKUP_CREDENTIALS_NOT_ALLOWED",
    );
    expect(backupExportIntentSchema.safeParse({
      schemaVersion: 1,
      operationId: "export-opaque-0001",
      includePlatformCredentials: true,
    }).success).toBe(false);
  });

  it("keeps every command intent exact and selector-free", () => {
    expect(backupArtifactSelectionIntentSchema.safeParse({
      schemaVersion: 1,
      operationId: "select-opaque-0001",
      filePath: "/tmp/artifact",
    }).success).toBe(false);
    expect(restoreWorkflowIntentSchema.safeParse({
      schemaVersion: 1,
      operationId,
      dialogId,
      artifactId,
      expectedCurrentRevision: 12,
      candidateSetVersion: 4,
      confirmation: REQUIRED_BACKUP_RESTORE_CONFIRMATION,
      workspaceId: "workspace-secret",
    }).success).toBe(false);
    expect(restoreWorkflowIntentSchema.safeParse({
      schemaVersion: 1,
      operationId,
      dialogId,
      artifactId,
      expectedCurrentRevision: 12,
      candidateSetVersion: 4,
      confirmation: `${REQUIRED_BACKUP_RESTORE_CONFIRMATION} `,
    }).success).toBe(false);
  });

  it.each([
    ["unknown root", { ...view(), extra: true }],
    ["wrong kind", { ...view(), kind: "backup_restore" }],
    ["unavailable authority grants export", { ...view(), authority: "unavailable" }],
    ["continuation restore grant", {
      ...view(),
      authority: "verified_local_continuation",
      selectedArtifact: artifact(),
    }],
    ["incompatible restore grant", {
      ...view(),
      selectedArtifact: artifact({ compatibility: "unsupported_schema" }),
    }],
    ["duplicate operation action", {
      ...view(),
      artifactSelectionAdmission: { state: "available", operationId: "export-opaque-0001" },
    }],
    ["path leak", { ...view(), destinationPath: "/tmp/backup" }],
    ["workspace leak", { ...view(), workspaceId: "workspace-secret" }],
    ["manifest leak", { ...view(), selectedArtifact: artifact({ manifestDigest: "D".repeat(43) }) }],
    ["bidi display", { ...view(), selectedArtifact: artifact({ createdAt: "2026-08-16T05:00:00\u202eZ" }) }],
  ])("fails closed for %s", (_label, input) => {
    expect(backupRestoreViewModelSchema.safeParse(input).success).toBe(false);
  });

  it("rebuilds hostile unknown values without invoking accessors", async () => {
    const payload = view();
    const getter = vi.fn(() => payload.kind);
    Object.defineProperty(payload, "kind", { enumerable: true, get: getter });
    const port = new ValidatingBackupRestoreStatusPort({
      getBackupRestoreStatus: vi.fn(async () => payload),
    });
    await expect(port.getBackupRestoreStatus()).rejects.toThrow("invalid local backup response");
    expect(getter).not.toHaveBeenCalled();
  });

  it("does not reflect hostile proxy or response diagnostics", async () => {
    const secretDiagnostic = "private-path-and-key-material";
    const proxy = new Proxy({}, {
      getPrototypeOf() {
        throw new Error(secretDiagnostic);
      },
    });
    expect(() => parseBackupRestoreViewModel(proxy)).toThrow("invalid local backup response");
    expect(() => parseBackupRestoreViewModel(proxy)).not.toThrow(secretDiagnostic);

    const port = new ValidatingBackupRestoreStatusPort({
      getBackupRestoreStatus: vi.fn(async () => ({ detail: secretDiagnostic })),
    });
    await expect(port.getBackupRestoreStatus()).rejects.toThrow("invalid local backup response");
    await expect(port.getBackupRestoreStatus()).rejects.not.toThrow(secretDiagnostic);
  });

  it("rejects prototypes, symbols, sparse/oversized values, hidden fields, cycles and unsafe numbers", () => {
    const inherited = Object.create({ authority: "active" });
    Object.assign(inherited, view());
    expect(() => parseBackupRestoreViewModel(inherited)).toThrow();

    const symbolic = { ...view(), [Symbol("secret")]: true };
    expect(() => parseBackupRestoreViewModel(symbolic)).toThrow();

    const cyclic: Record<string, unknown> = { ...view() };
    cyclic.cycle = cyclic;
    expect(() => parseBackupRestoreViewModel(cyclic)).toThrow();

    const sparse = new Array(2);
    sparse[1] = "value";
    expect(() => parseBackupRestoreViewModel({ ...view(), selectedArtifact: sparse })).toThrow();

    const hidden = Object.defineProperty(view(), "privateValue", {
      enumerable: false,
      value: "not-visible",
    });
    expect(() => parseBackupRestoreViewModel(hidden)).toThrow();

    expect(() => parseBackupRestoreViewModel({ ...view(), selectedArtifact: new Array(33) })).toThrow();
    expect(() => parseBackupRestoreViewModel({ ...view(), error: "A".repeat(257) })).toThrow();
    expect(() => parseBackupRestoreViewModel({
      ...view(),
      selectedArtifact: { a: { b: { c: { d: { e: { f: { g: true } } } } } } },
    })).toThrow();
    expect(() => parseBackupRestoreViewModel({ ...view(), schemaVersion: Number.MAX_SAFE_INTEGER + 1 })).toThrow();
  });

  it.each(["safe\u0000text", "safe\u200btext", "safe\u202etext", "safe\ufefftext"])(
    "rejects forbidden control text %j",
    (error) => {
      expect(() => parseBackupRestoreViewModel({ ...view(), error })).toThrow(
        "invalid local backup response",
      );
    },
  );

  it("returns a detached, plain rebuilt model", () => {
    const input = view();
    const parsed = parseBackupRestoreViewModel(input);
    expect(parsed).not.toBe(input);
    expect(parsed.selectedArtifact).not.toBe(input.selectedArtifact);
    input.authority = "unavailable";
    expect(parsed.authority).toBe("active");
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
  });

  it("fences stale status responses and consumes each operation once", () => {
    const session = new BackupIntentSession();
    const first = session.beginStatusRequest();
    const second = session.beginStatusRequest();
    expect(session.acceptStatusResponse(first, view())).toBeNull();
    expect(session.acceptStatusResponse(second, view())).not.toBeNull();
    expect(session.acceptStatusResponse(second, view())).toBeNull();
    expect(session.createExportIntent(false)).not.toBeNull();
    expect(session.createExportIntent(false)).toBeNull();
    session.invalidate();
    expect(session.createArtifactSelectionIntent()).toBeNull();
  });

  it("invalidates an active confirmation after an authority downgrade", () => {
    const session = new BackupIntentSession();
    const activeRequest = session.beginStatusRequest();
    session.acceptStatusResponse(activeRequest, view());
    const confirmation = session.bindRestoreConfirmation(REQUIRED_BACKUP_RESTORE_CONFIRMATION);
    const downgradeRequest = session.beginStatusRequest();
    session.acceptStatusResponse(downgradeRequest, {
      ...view(),
      authority: "verified_local_continuation",
      selectedArtifact: artifact({ restoreAdmission: { state: "unavailable" } }),
    });
    expect(session.createRestoreIntent(confirmation)).toBeNull();
  });

  it("keeps unknown and secret-bearing errors closed", () => {
    expect(backupErrorCodeSchema.safeParse("/private/key").success).toBe(false);
    expect(backupErrorCodeSchema.safeParse("raw provider token").success).toBe(false);
    expect(backupErrorCodeSchema.safeParse("BACKUP_ARTIFACT_REJECTED").success).toBe(true);
    expect(toBackupErrorCode(new Error("/private/key?token=secret"))).toBe(
      "BACKUP_RESPONSE_REJECTED",
    );
    expect(backupErrorCodeSchema.options.every((code) => /^(BACKUP|LOCAL)_[A-Z_]+$/u.test(code)))
      .toBe(true);
  });

  it("keeps the public backup surface opaque and purpose-specific", () => {
    for (const removed of [
      "backupExportSummarySchema",
      "backupScopeItemSchema",
      "internalRecoveryPointSchema",
      "redactedCredentialConnectionSchema",
      "requiredRestoreConfirmationText",
    ]) {
      expect(Object.keys(backupContract)).not.toContain(removed);
    }
    expect(Object.keys(backupContract)).toEqual(expect.arrayContaining([
      "localBackupCommandNames",
      "backupRestoreViewModelSchema",
      "backupExportIntentSchema",
      "backupArtifactSelectionIntentSchema",
      "restoreWorkflowIntentSchema",
    ]));
  });

  it("keeps the parsed model type exact", () => {
    expectTypeOf(parseBackupRestoreViewModel(view())).toEqualTypeOf<BackupRestoreViewModel>();
  });
});
