import { createHash } from "node:crypto";

import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { encodeRestoreDiffDigestInput, type BackupDiffEntry } from "@gooddealer/protocol/recovery";
import { encodeDomainSeparatedWireValue } from "@gooddealer/protocol/wire";

import { runCloudMigrations, TenantTransactionRunner } from "../../src/db/index";
import { cloudMigrations } from "../../src/db/migrations";
import {
  PostgresRestoreCandidateRepository,
  type RestoreCandidateService,
  type RecoveryWorkflowAuthorityPort,
} from "../../src/modules/recovery/index";
import {
  createRestoreCandidateServiceForTesting,
  type RecoveryLifecycleAuthority,
} from "../../src/modules/recovery/restore-candidate-service";
import { PostgresWorkspaceRevisionRepository } from "../../src/modules/workspace/revisions/index";
import { PostgresPortfolioProjectionQuery, PostgresPortfolioRepository } from "../../src/modules/workspace/state/portfolio/index";

const ownerPool = new Pool({ connectionString: requiredEnvironment("GOODDEALER_POSTGRES_OWNER_URL"), max: 1 });
const appPool = new Pool({ connectionString: requiredEnvironment("GOODDEALER_POSTGRES_APP_URL"), max: 8 });
const transactions = new TenantTransactionRunner(appPool);
const revisions = new PostgresWorkspaceRevisionRepository();
const portfolio = new PostgresPortfolioRepository();
const query = new PostgresPortfolioProjectionQuery({ transactions, revisions });
const repository = new PostgresRestoreCandidateRepository();
const tenantA = { accountId: "recovery-account-a", workspaceId: "same-recovery-workspace" } as const;
const tenantB = { accountId: "recovery-account-b", workspaceId: "same-recovery-workspace" } as const;
const manifestDigest = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

beforeAll(async () => {
  if (process.env.GOODDEALER_UNQUALIFIED_POSTGRES_DIAGNOSTIC !== "true") {
    const version = await ownerPool.query<{ server_version: string }>("SHOW server_version");
    expect(version.rows[0]?.server_version).toMatch(/^18\.6(?:\D|$)/u);
  }
  await runCloudMigrations(ownerPool, cloudMigrations);
});

beforeEach(async () => {
  await ownerPool.query("TRUNCATE restore_candidates, restore_candidate_requests, workspace_replica_domain_assets, workspace_revisions CASCADE");
  for (const scope of [tenantA, tenantB]) {
    await transactions.withTenant(scope, async (transaction) => {
      await revisions.bind(transaction, 1);
      await portfolio.seed(transaction, {
        entityId: "a.test",
        note: scope.accountId,
        portfolioId: null,
        tags: [],
        targetPrice: null,
      });
    });
  }
});

afterAll(async () => Promise.all([ownerPool.end(), appPool.end()]));

describe("PostgreSQL RestoreCandidate foundation", () => {
  it("uses FORCE RLS with the non-superuser non-BYPASSRLS application role", async () => {
    const roles = await ownerPool.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'gooddealer_cloud_app'",
    );
    expect(roles.rows).toEqual([{ rolsuper: false, rolbypassrls: false }]);
    const policies = await ownerPool.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
       WHERE relname IN ('restore_candidate_requests','restore_candidates') ORDER BY relname`,
    );
    expect(policies.rows).toEqual([
      { relname: "restore_candidate_requests", relrowsecurity: true, relforcerowsecurity: true },
      { relname: "restore_candidates", relrowsecurity: true, relforcerowsecurity: true },
    ]);
  });

  it("derives candidate fields against the locked current baseline without mutating workspace state", async () => {
    const before = await query.readPortfolio(tenantA);
    const receipt = await service(tenantA).create(request("workflow-a", "backup-a", "backup-note"));
    expect(receipt.comparisonServerRevision).toBe(0);
    expect(receipt.candidates).toHaveLength(4);
    expect(receipt.candidates.every(({ status }) => status === "open")).toBe(true);
    expect(receipt.candidates[0]).toMatchObject({ entityId: "a.test", fieldPath: "note", backupValue: "backup-note" });
    expect(await query.readPortfolio(tenantA)).toEqual(before);
  });

  it("returns a byte-identical receipt for the same request and rejects workflow or backup digest conflicts", async () => {
    const recovery = service(tenantA);
    const value = request("workflow-a", "backup-a", "backup-note");
    const first = await recovery.create(value);
    expect(await recovery.create(value)).toEqual(first);
    await expect(recovery.create(request("workflow-a", "backup-a", "different"))).rejects.toThrow("identity conflict");
    await expect(recovery.create(request("workflow-b", "backup-a", "backup-note"))).rejects.toThrow("identity conflict");
  });

  it("isolates identical literal workflow backup and candidate ids across tenants", async () => {
    const value = request("workflow-shared", "backup-shared", "backup-note");
    const [a, b] = await Promise.all([service(tenantA).create(value), service(tenantB).create(value)]);
    expect(a.candidateRequestId).toBe(b.candidateRequestId);
    await transactions.withTenant(tenantA, async (transaction) => {
      const visible = await transaction.query<{ account_id: string }>("SELECT account_id FROM restore_candidate_requests");
      expect(visible.rows).toEqual([{ account_id: tenantA.accountId }]);
      const cross = await transaction.query(
        "UPDATE restore_candidates SET status = 'discarded' WHERE account_id = $1",
        [tenantB.accountId],
      );
      expect(cross.rowCount).toBe(0);
    });
  });

  it("keeps recovery evidence immutable to the application role", async () => {
    const receipt = await service(tenantA).create(request("workflow-evidence", "backup-evidence", "backup-note"));
    const candidate = receipt.candidates[0]!;
    await expect(transactions.withTenant(tenantA, (transaction) => transaction.query(
      `UPDATE restore_candidates
       SET backup_value = '"tampered"'::jsonb
       WHERE candidate_id = $1`,
      [candidate.candidateId],
    ))).rejects.toMatchObject({ code: "42501" });
    const unchanged = await transactions.withTenant(tenantA, (transaction) => transaction.query<{ backup_value: unknown }>(
      "SELECT backup_value FROM restore_candidates WHERE candidate_id = $1",
      [candidate.candidateId],
    ));
    expect(unchanged.rows[0]?.backup_value).toBe(candidate.backupValue);
  });

  it("serializes concurrent creators into one persistent request and candidate set", async () => {
    const value = request("workflow-race", "backup-race", "backup-note");
    const results = await Promise.all([service(tenantA).create(value), service(tenantA).create(value)]);
    expect(results[0]).toEqual(results[1]);
    await transactions.withTenant(tenantA, async (transaction) => {
      const counts = await transaction.query<{ requests: string; candidates: string }>(
        `SELECT (SELECT count(*) FROM restore_candidate_requests)::text AS requests,
                (SELECT count(*) FROM restore_candidates)::text AS candidates`,
      );
      expect(counts.rows[0]).toEqual({ requests: "1", candidates: "4" });
    });
  });

  it("enforces non-Apply lifecycle row-version CAS and exposes only unresolved non-expired watermark", async () => {
    const recovery = service(tenantA);
    const receipt = await recovery.create(request("workflow-cas", "backup-cas", "backup-note"));
    const candidate = receipt.candidates[0]!;
    expect(await transactions.withTenant(tenantA, (transaction) => repository.readOldestUnresolvedComparisonRevision(transaction))).toBe(0);
    await expect(transactions.withTenant(tenantA, (transaction) => transaction.query(
      `UPDATE restore_candidates
       SET status = 'applied', row_version = row_version + 1, updated_at = transaction_timestamp()
       WHERE candidate_id = $1`,
      [candidate.candidateId],
    ))).rejects.toMatchObject({ code: "P0001" });
    const transitioned = await recovery.transition({
      schemaVersion: 1,
      candidateId: candidate.candidateId,
      expectedRowVersion: 1,
      transition: "discarded",
    });
    expect(transitioned).toMatchObject({ status: "discarded", rowVersion: 2 });
    await expect(recovery.transition({
      schemaVersion: 1,
      candidateId: candidate.candidateId,
      expectedRowVersion: 1,
      transition: "expired",
    })).rejects.toThrow("compare-and-set lost");
    await expect(recovery.transition({
      schemaVersion: 1,
      candidateId: candidate.candidateId,
      expectedRowVersion: 2,
      transition: "applied",
    })).rejects.toThrow();
  });

  it("binds lifecycle CAS to tenant, status, baseline and complete authority provenance", async () => {
    const receipt = await service(tenantA).create(request("workflow-cas", "backup-cas", "backup-note"));
    const candidate = receipt.candidates[0]!;
    const command = {
      schemaVersion: 1,
      candidateId: candidate.candidateId,
      expectedRowVersion: 1,
      transition: "discarded",
    } as const;
    const mismatches: readonly [string, Partial<RecoveryLifecycleAuthority>][] = [
      ["tenant", { accountId: tenantB.accountId }],
      ["workflow", { recoveryWorkflowId: "workflow-other" }],
      ["backup", { backupId: "backup-other" }],
      ["manifest", { manifestDigest: "B".repeat(43) }],
      ["source device", { sourceDeviceId: "device-other" }],
      ["lease epoch", { activeLeaseEpoch: 8 }],
      ["expected lifecycle", { expectedStatus: "rebase_required" }],
      ["baseline and comparison", { pinnedBaselineRevision: 1, comparisonServerRevision: 1 }],
    ];
    for (const [label, overrides] of mismatches) {
      await expect(
        service(tenantA, overrides).transition(command),
        label,
      ).rejects.toThrow("compare-and-set lost");
      expect(await candidateState(candidate.candidateId), label).toEqual({ status: "open", rowVersion: "1" });
    }

    await expect(service(tenantA).transition({ ...command, expectedRowVersion: 2 })).rejects.toThrow("compare-and-set lost");
    expect(await candidateState(candidate.candidateId)).toEqual({ status: "open", rowVersion: "1" });

    const transitioned = await service(tenantA).transition(command);
    expect(transitioned).toMatchObject({ status: "discarded", rowVersion: 2 });
  });
});

function service(
  scope: typeof tenantA | typeof tenantB,
  lifecycleOverrides: Partial<RecoveryLifecycleAuthority> = {},
): RestoreCandidateService {
  const authorityPort: RecoveryWorkflowAuthorityPort = {
    async authorizeCandidateRequest(value) {
      const input = value as { recoveryWorkflowId: string; backupId: string; manifestDigest: string };
      return authority(scope, input.recoveryWorkflowId, input.backupId, input.manifestDigest);
    },
  };
  return createRestoreCandidateServiceForTesting({
    transactions,
    authority: authorityPort,
    lifecycleAuthority: lifecycleVerifier(scope, lifecycleOverrides),
    candidates: repository,
  });
}

function lifecycleVerifier(
  scope: typeof tenantA | typeof tenantB,
  lifecycleOverrides: Partial<RecoveryLifecycleAuthority>,
) {
  return {
    async verifyLifecycleCommand(value: unknown): Promise<RecoveryLifecycleAuthority> {
      const command = value as {
        candidateId: string;
        expectedRowVersion: number;
        transition: RecoveryLifecycleAuthority["transition"];
      };
      return {
        ...authority(scope, "workflow-cas", "backup-cas"),
        candidateId: command.candidateId,
        expectedRowVersion: command.expectedRowVersion,
        expectedStatus: "open",
        transition: command.transition,
        comparisonServerRevision: 0,
        ...lifecycleOverrides,
      };
    },
  };
}

async function candidateState(candidateId: string): Promise<{ status: string; rowVersion: string }> {
  return transactions.withTenant(tenantA, async (transaction) => {
    const result = await transaction.query<{ status: string; rowVersion: string }>(
      'SELECT status, row_version::text AS "rowVersion" FROM restore_candidates WHERE candidate_id = $1',
      [candidateId],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error("candidate unavailable");
    return row;
  });
}

function authority(
  scope: typeof tenantA | typeof tenantB,
  recoveryWorkflowId: string,
  backupId: string,
  digest = manifestDigest,
) {
  return {
    ...scope,
    sourceDeviceId: "device-a",
    activeLeaseEpoch: 7,
    recoveryWorkflowId,
    backupId,
    manifestDigest: digest,
    pinnedBaselineRevision: 0,
  };
}

function request(recoveryWorkflowId: string, backupId: string, note: string) {
  const values: readonly BackupDiffEntry[] = [
    entry("note", note), entry("portfolioId", null), entry("tags", []), entry("targetPrice", null),
  ];
  return {
    schemaVersion: 1,
    recoveryWorkflowId,
    backupId,
    manifestDigest,
    diffDigest: createHash("sha256").update(encodeRestoreDiffDigestInput(values)).digest("base64url"),
    entries: values,
  };
}

function entry(fieldPath: BackupDiffEntry["fieldPath"], backupValue: unknown): BackupDiffEntry {
  return {
    entityId: "a.test",
    fieldPath,
    backupValue,
    backupValueHash: digest("GOODDEALER-RESTORE-FIELD-V1", backupValue),
  } as BackupDiffEntry;
}

function digest(domain: string, value: unknown): string {
  return createHash("sha256").update(encodeDomainSeparatedWireValue(domain, value)).digest("base64url");
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) throw new Error(`${name} is required; PostgreSQL evidence never skips`);
  return value;
}
