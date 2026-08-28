import { createHash } from "node:crypto";

import {
  encodeRestoreDiffDigestInput,
  manifestBoundDiffRequestSchema,
  restoreCandidateLifecycleCommandSchema,
  type BackupDiffEntry,
  type ManifestBoundDiffRequest,
  type RestoreCandidate,
  type RestoreCandidateLifecycleCommand,
  type RestoreCandidateReceipt,
} from "@gooddealer/protocol/recovery";
import { encodeDomainSeparatedWireValue, identifier, safePositiveInteger } from "@gooddealer/protocol/wire";

import type { TenantTransaction } from "../../db/index";
import {
  type RestoreCandidateInsert,
  type RestoreCandidateRepositoryPort,
} from "./postgres-restore-candidate-repository";

const FIELD_VALUE_DIGEST_DOMAIN = "GOODDEALER-RESTORE-FIELD-V1";
const REQUEST_DIGEST_DOMAIN = "GOODDEALER-RESTORE-REQUEST-V1";
const RECEIPT_DIGEST_DOMAIN = "GOODDEALER-RESTORE-RECEIPT-V1";

export interface RecoveryWorkflowAuthority {
  readonly accountId: string;
  readonly workspaceId: string;
  readonly sourceDeviceId: string;
  readonly activeLeaseEpoch: number;
  readonly recoveryWorkflowId: string;
  readonly backupId: string;
  readonly manifestDigest: string;
  readonly pinnedBaselineRevision: number;
}

export interface RecoveryWorkflowAuthorityPort {
  authorizeCandidateRequest(value: unknown): Promise<RecoveryWorkflowAuthority>;
}

export interface RecoveryLifecycleAuthority extends RecoveryWorkflowAuthority {
  readonly candidateId: string;
  readonly expectedRowVersion: number;
  readonly expectedStatus: "open" | "rebase_required";
  readonly transition: RestoreCandidateLifecycleCommand["transition"];
  readonly comparisonServerRevision: number;
}

export interface RecoveryLifecycleAuthorityVerifierPort {
  verifyLifecycleCommand(value: unknown): Promise<RecoveryLifecycleAuthority>;
}

export interface RecoveryTenantTransactionPort {
  withTenant<Result>(
    value: unknown,
    operation: (transaction: TenantTransaction) => Promise<Result>,
  ): Promise<Result>;
}

export class DenyingRecoveryWorkflowAuthority implements RecoveryWorkflowAuthorityPort {
  async authorizeCandidateRequest(_value: unknown): Promise<RecoveryWorkflowAuthority> {
    throw new TypeError("recovery workflow authority unavailable");
  }
}

class DenyingRecoveryLifecycleAuthorityVerifier implements RecoveryLifecycleAuthorityVerifierPort {
  async verifyLifecycleCommand(_value: unknown): Promise<RecoveryLifecycleAuthority> {
    throw new TypeError("recovery lifecycle authority unavailable");
  }
}

const verifiedLifecycleCapabilityBrand: unique symbol = Symbol("verified recovery lifecycle capability");
const verifiedLifecycleCapabilities = new WeakSet<object>();

/** Minted only after the recovery-owned verifier binds the command to its authority provenance. */
export interface VerifiedRecoveryLifecycleCapability extends RecoveryLifecycleAuthority {
  readonly [verifiedLifecycleCapabilityBrand]: true;
}

/** Runtime provenance check used only by the recovery-owned repository adapter. */
export function assertVerifiedRecoveryLifecycleCapability(
  value: unknown,
): asserts value is VerifiedRecoveryLifecycleCapability {
  if (typeof value !== "object" || value === null || !verifiedLifecycleCapabilities.has(value)) {
    throw new TypeError("recovery lifecycle capability not verified");
  }
}

interface RestoreCandidateServiceDependencies {
  readonly transactions: RecoveryTenantTransactionPort;
  readonly authority: RecoveryWorkflowAuthorityPort;
  readonly candidates: RestoreCandidateRepositoryPort;
}

export interface RestoreCandidateService {
  create(value: unknown): Promise<RestoreCandidateReceipt>;
  transition(value: unknown): Promise<RestoreCandidate>;
}

class RecoveryRestoreCandidateService implements RestoreCandidateService {
  constructor(
    private readonly dependencies: RestoreCandidateServiceDependencies,
    private readonly lifecycleAuthority: RecoveryLifecycleAuthorityVerifierPort,
  ) {}

  async create(value: unknown): Promise<RestoreCandidateReceipt> {
    const request = manifestBoundDiffRequestSchema.parse(value);
    const requestDigest = digest(REQUEST_DIGEST_DOMAIN, request);
    verifyRequestDigests(request);
    const authority = await this.dependencies.authority.authorizeCandidateRequest(request);
    validateAuthority(authority, request);
    return this.dependencies.transactions.withTenant(tenantScope(authority), async (transaction) => {
      const revision = await lockCurrentRevision(transaction);
      if (revision !== authority.pinnedBaselineRevision) {
        throw new TypeError("recovery baseline changed");
      }
      const existing = await this.dependencies.candidates.readByWorkflowOrBackup(
        transaction,
        authority.recoveryWorkflowId,
        authority.backupId,
      );
      if (existing !== null) {
        if (
          existing.recoveryWorkflowId !== authority.recoveryWorkflowId
          || existing.backupId !== authority.backupId
          || existing.manifestDigest !== authority.manifestDigest
          || existing.requestDigest !== requestDigest
          || existing.comparisonServerRevision !== revision
        ) {
          throw new TypeError("recovery request identity conflict");
        }
        return existing;
      }
      const current = await readCurrentValues(transaction, request.entries);
      const inserts = request.entries.map((entry, index): RestoreCandidateInsert => ({
        candidateId: stableId("candidate", `${requestDigest}:${index}`),
        entityId: entry.entityId,
        fieldPath: entry.fieldPath,
        backupValue: entry.backupValue,
        backupValueHash: entry.backupValueHash,
        currentValueHash: digest(FIELD_VALUE_DIGEST_DOMAIN, current.get(key(entry)) ?? null),
      }));
      const candidateRequestId = stableId("request", requestDigest);
      const receiptDigest = digest(RECEIPT_DIGEST_DOMAIN, {
        candidateRequestId,
        recoveryWorkflowId: authority.recoveryWorkflowId,
        backupId: authority.backupId,
        manifestDigest: authority.manifestDigest,
        comparisonServerRevision: revision,
        requestDigest,
        candidates: inserts.map(({ candidateId, entityId, fieldPath, backupValueHash, currentValueHash }) => ({
          candidateId, entityId, fieldPath, backupValueHash, currentValueHash,
        })),
      });
      return this.dependencies.candidates.insert(transaction, {
        candidateRequestId,
        recoveryWorkflowId: authority.recoveryWorkflowId,
        sourceDeviceId: authority.sourceDeviceId,
        activeLeaseEpoch: authority.activeLeaseEpoch,
        backupId: authority.backupId,
        manifestDigest: authority.manifestDigest,
        baselineServerRevision: revision,
        diffDigest: request.diffDigest,
        requestDigest,
        receiptDigest,
        expiresInSeconds: 86_400,
        candidates: inserts,
      });
    });
  }

  async transition(value: unknown): Promise<RestoreCandidate> {
    const command = restoreCandidateLifecycleCommandSchema.parse(value);
    const authority = await this.lifecycleAuthority.verifyLifecycleCommand(command);
    const capability = verifyLifecycleCapability(authority, command);
    return this.dependencies.transactions.withTenant(tenantScope(capability), (transaction) =>
      this.dependencies.candidates.transition(transaction, capability));
  }
}

/** Public production composition is fail-closed until a recovery authority runtime exists. */
export function createRestoreCandidateService(
  dependencies: RestoreCandidateServiceDependencies,
): RestoreCandidateService {
  return new RecoveryRestoreCandidateService(
    dependencies,
    new DenyingRecoveryLifecycleAuthorityVerifier(),
  );
}

/** Test-only composition seam; deliberately absent from the recovery package index. */
export function createRestoreCandidateServiceForTesting(
  dependencies: RestoreCandidateServiceDependencies & {
    readonly lifecycleAuthority: RecoveryLifecycleAuthorityVerifierPort;
  },
): RestoreCandidateService {
  if (process.env.NODE_ENV !== "test") {
    throw new TypeError("recovery lifecycle test composition unavailable");
  }
  return new RecoveryRestoreCandidateService(dependencies, dependencies.lifecycleAuthority);
}

function tenantScope(authority: RecoveryWorkflowAuthority): Pick<RecoveryWorkflowAuthority, "accountId" | "workspaceId"> {
  return { accountId: authority.accountId, workspaceId: authority.workspaceId };
}

function verifyRequestDigests(request: ManifestBoundDiffRequest): void {
  const expectedDiff = createHash("sha256")
    .update(encodeRestoreDiffDigestInput(request.entries))
    .digest("base64url");
  if (expectedDiff !== request.diffDigest) throw new TypeError("recovery diff digest invalid");
  for (const entry of request.entries) {
    if (entry.backupValueHash !== digest(FIELD_VALUE_DIGEST_DOMAIN, entry.backupValue)) {
      throw new TypeError("recovery field digest invalid");
    }
  }
}

function validateAuthority(authority: RecoveryWorkflowAuthority, request: ManifestBoundDiffRequest): void {
  validateAuthorityShape(authority);
  if (
    authority.recoveryWorkflowId !== request.recoveryWorkflowId
    || authority.backupId !== request.backupId
    || authority.manifestDigest !== request.manifestDigest
  ) {
    throw new TypeError("recovery workflow binding invalid");
  }
}

function validateAuthorityShape(authority: RecoveryWorkflowAuthority): void {
  for (const value of [
    authority.accountId,
    authority.workspaceId,
    authority.sourceDeviceId,
    authority.recoveryWorkflowId,
    authority.backupId,
  ]) identifier.parse(value);
  safePositiveInteger.parse(authority.activeLeaseEpoch);
  if (!Number.isSafeInteger(authority.pinnedBaselineRevision) || authority.pinnedBaselineRevision < 0) {
    throw new TypeError("recovery baseline invalid");
  }
  if (!/^[A-Za-z0-9_-]{43}$/.test(authority.manifestDigest)) {
    throw new TypeError("recovery manifest binding invalid");
  }
}

function verifyLifecycleCapability(
  authority: RecoveryLifecycleAuthority,
  command: RestoreCandidateLifecycleCommand,
): VerifiedRecoveryLifecycleCapability {
  validateAuthorityShape(authority);
  identifier.parse(authority.candidateId);
  safePositiveInteger.parse(authority.expectedRowVersion);
  if (authority.expectedStatus !== "open" && authority.expectedStatus !== "rebase_required") {
    throw new TypeError("recovery lifecycle status invalid");
  }
  if (!Number.isSafeInteger(authority.comparisonServerRevision) || authority.comparisonServerRevision < 0) {
    throw new TypeError("recovery comparison revision invalid");
  }
  if (authority.comparisonServerRevision !== authority.pinnedBaselineRevision) {
    throw new TypeError("recovery lifecycle baseline binding invalid");
  }
  if (
    authority.candidateId !== command.candidateId
    || authority.expectedRowVersion !== command.expectedRowVersion
    || authority.transition !== command.transition
  ) {
    throw new TypeError("recovery lifecycle command binding invalid");
  }
  const capability: VerifiedRecoveryLifecycleCapability = Object.freeze({
    ...authority,
    [verifiedLifecycleCapabilityBrand]: true as const,
  });
  verifiedLifecycleCapabilities.add(capability);
  return capability;
}

async function lockCurrentRevision(transaction: TenantTransaction): Promise<number> {
  const result = await transaction.query<{ server_revision: string }>(
    `SELECT server_revision::text
     FROM workspace_revisions
     WHERE account_id = $1 AND workspace_id = $2 FOR UPDATE`,
    [transaction.scope.accountId, transaction.scope.workspaceId],
  );
  const parsed = Number(result.rows[0]?.server_revision);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new TypeError("recovery workspace unavailable");
  return parsed;
}

async function readCurrentValues(
  transaction: TenantTransaction,
  entries: readonly BackupDiffEntry[],
): Promise<Map<string, unknown>> {
  const entityIds = [...new Set(entries.map(({ entityId }) => entityId))];
  const result = await transaction.query<{
    entity_id: string;
    note: string | null;
    portfolio_id: string | null;
    tags: string[];
    target_price_currency: string | null;
    target_price_amount: string | null;
  }>(
    `SELECT entity_id, note, portfolio_id, tags, target_price_currency, target_price_amount
     FROM workspace_replica_domain_assets
     WHERE account_id = $1 AND workspace_id = $2 AND entity_id = ANY($3::text[])
     ORDER BY entity_id COLLATE "C"`,
    [transaction.scope.accountId, transaction.scope.workspaceId, entityIds],
  );
  const values = new Map<string, unknown>();
  for (const row of result.rows) {
    values.set(`${row.entity_id}\u0000note`, row.note);
    values.set(`${row.entity_id}\u0000portfolioId`, row.portfolio_id);
    values.set(`${row.entity_id}\u0000tags`, row.tags);
    values.set(
      `${row.entity_id}\u0000targetPrice`,
      row.target_price_currency === null || row.target_price_amount === null
        ? null
        : { currency: row.target_price_currency, amount: row.target_price_amount },
    );
  }
  return values;
}

function key(entry: BackupDiffEntry): string {
  return `${entry.entityId}\u0000${entry.fieldPath}`;
}

function digest(domain: string, value: unknown): string {
  return createHash("sha256").update(encodeDomainSeparatedWireValue(domain, value)).digest("base64url");
}

function stableId(prefix: string, value: string): string {
  return `${prefix}-${createHash("sha256").update(value).digest("base64url").slice(0, 40)}`;
}
