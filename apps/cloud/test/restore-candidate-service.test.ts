import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  encodeRestoreDiffDigestInput,
  type BackupDiffEntry,
  type RestoreCandidate,
  type RestoreCandidateReceipt,
} from "@gooddealer/protocol/recovery";
import { encodeDomainSeparatedWireValue } from "@gooddealer/protocol/wire";

import type { TenantTransaction } from "../src/db/index";
import {
  DenyingRecoveryWorkflowAuthority,
  PostgresRestoreCandidateRepository,
  createRestoreCandidateService,
  type RecoveryTenantTransactionPort,
  type RecoveryWorkflowAuthority,
  type RecoveryWorkflowAuthorityPort,
} from "../src/modules/recovery/index";
import {
  createRestoreCandidateServiceForTesting,
  type RecoveryLifecycleAuthority,
  type RecoveryLifecycleAuthorityVerifierPort,
} from "../src/modules/recovery/restore-candidate-service";
import type {
  RestoreCandidateRepositoryPort,
  RestoreCandidateRequestInsert,
} from "../src/modules/recovery/postgres-restore-candidate-repository";
import type { VerifiedRecoveryLifecycleCapability } from "../src/modules/recovery/restore-candidate-service";

const digestValue = (domain: string, value: unknown): string =>
  createHash("sha256").update(encodeDomainSeparatedWireValue(domain, value)).digest("base64url");

function entries(): readonly BackupDiffEntry[] {
  return [
    { entityId: "a.test", fieldPath: "note", backupValue: "backup", backupValueHash: digestValue("GOODDEALER-RESTORE-FIELD-V1", "backup") },
    { entityId: "a.test", fieldPath: "portfolioId", backupValue: null, backupValueHash: digestValue("GOODDEALER-RESTORE-FIELD-V1", null) },
    { entityId: "a.test", fieldPath: "tags", backupValue: ["tag-a"], backupValueHash: digestValue("GOODDEALER-RESTORE-FIELD-V1", ["tag-a"]) },
    { entityId: "a.test", fieldPath: "targetPrice", backupValue: null, backupValueHash: digestValue("GOODDEALER-RESTORE-FIELD-V1", null) },
  ];
}

function request() {
  const value = entries();
  return {
    schemaVersion: 1,
    recoveryWorkflowId: "workflow-a",
    backupId: "backup-a",
    manifestDigest: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    diffDigest: createHash("sha256").update(encodeRestoreDiffDigestInput(value)).digest("base64url"),
    entries: value,
  };
}

const authority: RecoveryWorkflowAuthority = {
  accountId: "account-a",
  workspaceId: "workspace-a",
  sourceDeviceId: "device-a",
  activeLeaseEpoch: 7,
  recoveryWorkflowId: "workflow-a",
  backupId: "backup-a",
  manifestDigest: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  pinnedBaselineRevision: 12,
};

class FixtureTransactions implements RecoveryTenantTransactionPort {
  calls = 0;
  readonly transaction: TenantTransaction = {
    scope: { accountId: "account-a", workspaceId: "workspace-a" },
    query: vi.fn(async (sql: string) => {
      if (sql.includes("FROM workspace_revisions")) return { rows: [{ server_revision: "12" }], rowCount: 1 };
      if (sql.includes("FROM workspace_replica_domain_assets")) {
        return {
          rows: [{
            entity_id: "a.test",
            note: "current",
            portfolio_id: null,
            tags: ["tag-current"],
            target_price_currency: null,
            target_price_amount: null,
          }],
          rowCount: 1,
        };
      }
      throw new Error("unexpected query");
    }) as unknown as TenantTransaction["query"],
  };

  async withTenant<Result>(value: unknown, operation: (transaction: TenantTransaction) => Promise<Result>): Promise<Result> {
    this.calls += 1;
    expect(value).toMatchObject({ accountId: "account-a", workspaceId: "workspace-a" });
    return operation(this.transaction);
  }
}

class FixtureRepository implements RestoreCandidateRepositoryPort {
  inserted: RestoreCandidateRequestInsert | null = null;
  receipt: RestoreCandidateReceipt | null = null;
  transitioned: VerifiedRecoveryLifecycleCapability | null = null;

  async readByWorkflowOrBackup(): Promise<RestoreCandidateReceipt | null> {
    return this.receipt;
  }

  async insert(_transaction: TenantTransaction, value: RestoreCandidateRequestInsert): Promise<RestoreCandidateReceipt> {
    this.inserted = value;
    const candidates = value.candidates.map((candidate): RestoreCandidate => ({
      schemaVersion: 1,
      candidateId: candidate.candidateId,
      candidateRequestId: value.candidateRequestId,
      recoveryWorkflowId: value.recoveryWorkflowId,
      backupId: value.backupId,
      manifestDigest: value.manifestDigest,
      comparisonServerRevision: value.baselineServerRevision,
      entityId: candidate.entityId,
      fieldPath: candidate.fieldPath,
      backupValue: candidate.backupValue,
      backupValueHash: candidate.backupValueHash,
      currentValueHash: candidate.currentValueHash,
      status: "open",
      rowVersion: 1,
      createdAt: "2026-08-20T10:00:00Z",
      updatedAt: "2026-08-20T10:00:00Z",
      expiresAt: "2026-08-21T10:00:00Z",
    }));
    this.receipt = {
      schemaVersion: 1,
      candidateRequestId: value.candidateRequestId,
      recoveryWorkflowId: value.recoveryWorkflowId,
      backupId: value.backupId,
      manifestDigest: value.manifestDigest,
      comparisonServerRevision: value.baselineServerRevision,
      requestDigest: value.requestDigest,
      receiptDigest: value.receiptDigest,
      createdAt: "2026-08-20T10:00:00Z",
      candidates,
    };
    return this.receipt;
  }

  async transition(
    _transaction: TenantTransaction,
    capability: VerifiedRecoveryLifecycleCapability,
  ): Promise<RestoreCandidate> {
    this.transitioned = capability;
    throw new TypeError("restore candidate compare-and-set lost");
  }
  async readOldestUnresolvedComparisonRevision(): Promise<number | null> { return null; }
}

describe("RestoreCandidateService", () => {
  it("derives tenant, baseline, current hashes, ids, status and receipt from authority/current Cloud state", async () => {
    const repository = new FixtureRepository();
    const service = createRestoreCandidateService({
      transactions: new FixtureTransactions(),
      authority: { authorizeCandidateRequest: vi.fn(async () => authority) },
      candidates: repository,
    });
    const receipt = await service.create(request());
    expect(receipt.candidates).toHaveLength(4);
    expect(receipt.candidates.every(({ status, rowVersion }) => status === "open" && rowVersion === 1)).toBe(true);
    expect(repository.inserted).toMatchObject({
      sourceDeviceId: "device-a",
      activeLeaseEpoch: 7,
      baselineServerRevision: 12,
    });
    expect(receipt.candidates[0]!.currentValueHash).toBe(digestValue("GOODDEALER-RESTORE-FIELD-V1", "current"));
    expect(await service.create(request())).toEqual(receipt);
  });

  it("rejects forged authority fields, noncanonical diff and bad field hashes before persistence", async () => {
    const transactions = new FixtureTransactions();
    const repository = new FixtureRepository();
    const authorityPort: RecoveryWorkflowAuthorityPort = { authorizeCandidateRequest: vi.fn(async () => authority) };
    const service = createRestoreCandidateService({ transactions, authority: authorityPort, candidates: repository });
    await expect(service.create({ ...request(), accountId: "forged" })).rejects.toThrow();
    await expect(service.create({ ...request(), entries: [...entries()].reverse() })).rejects.toThrow();
    await expect(service.create({ ...request(), entries: entries().map((entry, index) => index === 0 ? { ...entry, backupValueHash: "B".repeat(43) } : entry) })).rejects.toThrow();
    expect(repository.inserted).toBeNull();
  });

  it("keeps production authority denying and lifecycle Apply unrepresentable", async () => {
    const callerSelectedVerifier = vi.fn(async () => lifecycleAuthority());
    const service = createRestoreCandidateService({
      transactions: new FixtureTransactions(),
      authority: new DenyingRecoveryWorkflowAuthority(),
      candidates: new FixtureRepository(),
      lifecycleAuthority: { verifyLifecycleCommand: callerSelectedVerifier },
    } as Parameters<typeof createRestoreCandidateService>[0]);
    await expect(service.create(request())).rejects.toThrow("authority unavailable");
    await expect(service.transition({ schemaVersion: 1, candidateId: "candidate-a", expectedRowVersion: 1, transition: "applied" })).rejects.toThrow();
    await expect(service.transition(lifecycleCommand())).rejects.toThrow("lifecycle authority unavailable");
    expect(callerSelectedVerifier).not.toHaveBeenCalled();
  });

  it("mints a frozen lifecycle capability only after the fixed verifier binds every command field", async () => {
    const repository = new FixtureRepository();
    const { service } = lifecycleService({ repository });
    await expect(service.transition(lifecycleCommand())).rejects.toThrow("compare-and-set lost");
    expect(repository.transitioned).toMatchObject(lifecycleAuthority());
    expect(Object.isFrozen(repository.transitioned)).toBe(true);
    expect(() => {
      (repository.transitioned as { recoveryWorkflowId: string }).recoveryWorkflowId = "forged";
    }).toThrow();
  });

  it("rejects forged, revoked and command-mismatched lifecycle inputs before tenant or repository access", async () => {
    const forgedVerifier = { verifyLifecycleCommand: vi.fn(async () => lifecycleAuthority()) };
    const forged = lifecycleService({ lifecycleAuthority: forgedVerifier });
    await expect(forged.service.transition({ ...lifecycleCommand(), accountId: "forged" })).rejects.toThrow();
    expect(forgedVerifier.verifyLifecycleCommand).not.toHaveBeenCalled();
    expect(forged.transactions.calls).toBe(0);
    expect(forged.repository.transitioned).toBeNull();

    const revoked = lifecycleService({
      lifecycleAuthority: { verifyLifecycleCommand: vi.fn(async () => { throw new TypeError("recovery authority revoked"); }) },
    });
    await expect(revoked.service.transition(lifecycleCommand())).rejects.toThrow("authority revoked");
    expect(revoked.transactions.calls).toBe(0);
    expect(revoked.repository.transitioned).toBeNull();

    for (const mismatch of [
      { candidateId: "candidate-other" },
      { expectedRowVersion: 2 },
      { transition: "expired" as const },
      { comparisonServerRevision: 11 },
    ]) {
      const fixture = lifecycleService({
        lifecycleAuthority: {
          verifyLifecycleCommand: vi.fn(async () => ({ ...lifecycleAuthority(), ...mismatch })),
        },
      });
      await expect(fixture.service.transition(lifecycleCommand())).rejects.toThrow("binding invalid");
      expect(fixture.transactions.calls).toBe(0);
      expect(fixture.repository.transitioned).toBeNull();
    }
  });

  it("rejects a structurally forged repository capability before SQL access", async () => {
    const query = vi.fn();
    const transaction = {
      scope: { accountId: "account-a", workspaceId: "workspace-a" },
      query,
    } as unknown as TenantTransaction;
    await expect(new PostgresRestoreCandidateRepository().transition(
      transaction,
      lifecycleAuthority() as unknown as VerifiedRecoveryLifecycleCapability,
    )).rejects.toThrow("capability not verified");
    expect(query).not.toHaveBeenCalled();
  });
});

function lifecycleCommand() {
  return {
    schemaVersion: 1,
    candidateId: "candidate-a",
    expectedRowVersion: 1,
    transition: "discarded",
  } as const;
}

function lifecycleAuthority(): RecoveryLifecycleAuthority {
  return {
    ...authority,
    candidateId: "candidate-a",
    expectedRowVersion: 1,
    expectedStatus: "open",
    transition: "discarded",
    comparisonServerRevision: 12,
  };
}

function lifecycleService(options: {
  readonly repository?: FixtureRepository;
  readonly lifecycleAuthority?: RecoveryLifecycleAuthorityVerifierPort;
} = {}) {
  const transactions = new FixtureTransactions();
  const repository = options.repository ?? new FixtureRepository();
  const service = createRestoreCandidateServiceForTesting({
    transactions,
    authority: { authorizeCandidateRequest: vi.fn(async () => authority) },
    lifecycleAuthority: options.lifecycleAuthority ?? {
      verifyLifecycleCommand: vi.fn(async () => lifecycleAuthority()),
    },
    candidates: repository,
  });
  return { service, transactions, repository };
}
