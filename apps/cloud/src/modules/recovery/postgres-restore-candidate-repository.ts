import {
  RECOVERY_PROTOCOL_VERSION,
  restoreCandidateLifecycleCommandSchema,
  restoreCandidateReceiptSchema,
  restoreCandidateSchema,
  type RestoreCandidate,
  type RestoreCandidateReceipt,
} from "@gooddealer/protocol/recovery";

import type { TenantTransaction } from "../../db/index";
import type { RestoreCandidateWatermarkQueryPort } from "./index";
import {
  assertVerifiedRecoveryLifecycleCapability,
  type VerifiedRecoveryLifecycleCapability,
} from "./restore-candidate-service";

export interface RestoreCandidateInsert {
  readonly candidateId: string;
  readonly entityId: string;
  readonly fieldPath: "note" | "portfolioId" | "tags" | "targetPrice";
  readonly backupValue: unknown;
  readonly backupValueHash: string;
  readonly currentValueHash: string;
}

export interface RestoreCandidateRequestInsert {
  readonly candidateRequestId: string;
  readonly recoveryWorkflowId: string;
  readonly sourceDeviceId: string;
  readonly activeLeaseEpoch: number;
  readonly backupId: string;
  readonly manifestDigest: string;
  readonly baselineServerRevision: number;
  readonly diffDigest: string;
  readonly requestDigest: string;
  readonly receiptDigest: string;
  readonly expiresInSeconds: number;
  readonly candidates: readonly RestoreCandidateInsert[];
}

export interface RestoreCandidateRepositoryPort extends RestoreCandidateWatermarkQueryPort {
  readByWorkflowOrBackup(
    transaction: TenantTransaction,
    recoveryWorkflowId: string,
    backupId: string,
  ): Promise<RestoreCandidateReceipt | null>;
  insert(
    transaction: TenantTransaction,
    value: RestoreCandidateRequestInsert,
  ): Promise<RestoreCandidateReceipt>;
  transition(
    transaction: TenantTransaction,
    capability: VerifiedRecoveryLifecycleCapability,
  ): Promise<RestoreCandidate>;
}

export class PostgresRestoreCandidateRepository implements RestoreCandidateRepositoryPort {
  async readByWorkflowOrBackup(
    transaction: TenantTransaction,
    recoveryWorkflowId: string,
    backupId: string,
  ): Promise<RestoreCandidateReceipt | null> {
    // Serialize both first creation and idempotent replay without granting UPDATE on the immutable
    // request table. Hash collisions only serialize unrelated requests; they cannot merge identity.
    const { accountId, workspaceId } = transaction.scope;
    const lockIdentities = [
      JSON.stringify([accountId, workspaceId, "backup", backupId]),
      JSON.stringify([accountId, workspaceId, "workflow", recoveryWorkflowId]),
    ].sort();
    for (const identity of lockIdentities) {
      await transaction.query(
        "SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1::text, 0))",
        [identity],
      );
    }
    const request = await transaction.query<RequestRow>(
      `SELECT candidate_request_id, recovery_workflow_id, backup_id, manifest_digest,
              comparison_server_revision::text, request_digest, receipt_digest,
              to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at
       FROM restore_candidate_requests
       WHERE account_id = $1 AND workspace_id = $2
         AND (recovery_workflow_id = $3 OR backup_id = $4)
       ORDER BY candidate_request_id COLLATE "C"`,
      [transaction.scope.accountId, transaction.scope.workspaceId, recoveryWorkflowId, backupId],
    );
    const row = request.rows[0];
    if (row === undefined) return null;
    if (request.rows.length !== 1) throw new TypeError("recovery request identity conflict");
    const candidates = await this.readCandidates(transaction, row.candidate_request_id);
    return restoreCandidateReceiptSchema.parse({
      schemaVersion: RECOVERY_PROTOCOL_VERSION,
      candidateRequestId: row.candidate_request_id,
      recoveryWorkflowId: row.recovery_workflow_id,
      backupId: row.backup_id,
      manifestDigest: row.manifest_digest,
      comparisonServerRevision: safeInteger(row.comparison_server_revision),
      requestDigest: row.request_digest,
      receiptDigest: row.receipt_digest,
      createdAt: row.created_at,
      candidates,
    });
  }

  async insert(
    transaction: TenantTransaction,
    value: RestoreCandidateRequestInsert,
  ): Promise<RestoreCandidateReceipt> {
    await transaction.query(
      `INSERT INTO restore_candidate_requests (
         account_id, workspace_id, candidate_request_id, recovery_workflow_id,
         source_device_id, active_lease_epoch, backup_id, manifest_digest,
         baseline_server_revision, comparison_server_revision, diff_digest, request_digest,
         receipt_digest, expires_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10,$11,$12,
                 transaction_timestamp() + make_interval(secs => $13))`,
      [
        transaction.scope.accountId, transaction.scope.workspaceId,
        value.candidateRequestId, value.recoveryWorkflowId, value.sourceDeviceId,
        value.activeLeaseEpoch, value.backupId, value.manifestDigest, value.baselineServerRevision,
        value.diffDigest, value.requestDigest, value.receiptDigest, value.expiresInSeconds,
      ],
    );
    for (const candidate of value.candidates) {
      await transaction.query(
        `INSERT INTO restore_candidates (
           account_id, workspace_id, candidate_id, candidate_request_id,
           recovery_workflow_id, backup_id, manifest_digest, comparison_server_revision,
           entity_id, field_path, backup_value, backup_value_hash, current_value_hash,
           expires_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,
                   transaction_timestamp() + make_interval(secs => $14))`,
        [
          transaction.scope.accountId, transaction.scope.workspaceId,
          candidate.candidateId, value.candidateRequestId, value.recoveryWorkflowId,
          value.backupId, value.manifestDigest, value.baselineServerRevision,
          candidate.entityId, candidate.fieldPath, JSON.stringify(candidate.backupValue),
          candidate.backupValueHash, candidate.currentValueHash, value.expiresInSeconds,
        ],
      );
    }
    const receipt = await this.readByWorkflowOrBackup(
      transaction,
      value.recoveryWorkflowId,
      value.backupId,
    );
    if (receipt === null) throw new TypeError("recovery receipt unavailable");
    return receipt;
  }

  async transition(
    transaction: TenantTransaction,
    capability: VerifiedRecoveryLifecycleCapability,
  ): Promise<RestoreCandidate> {
    assertVerifiedRecoveryLifecycleCapability(capability);
    const command = restoreCandidateLifecycleCommandSchema.parse({
      schemaVersion: RECOVERY_PROTOCOL_VERSION,
      candidateId: capability.candidateId,
      expectedRowVersion: capability.expectedRowVersion,
      transition: capability.transition,
    });
    const result = await transaction.query<CandidateRow>(
      `UPDATE restore_candidates AS candidate
       SET status = $4, row_version = row_version + 1, updated_at = transaction_timestamp()
       FROM restore_candidate_requests AS request
       WHERE candidate.account_id = $1 AND candidate.workspace_id = $2
         AND candidate.candidate_id = $3 AND candidate.row_version = $5
         AND candidate.status = $6
         AND candidate.recovery_workflow_id = $7 AND candidate.backup_id = $8
         AND candidate.manifest_digest = $9 AND candidate.comparison_server_revision = $12
         AND request.account_id = candidate.account_id
         AND request.workspace_id = candidate.workspace_id
         AND request.candidate_request_id = candidate.candidate_request_id
         AND request.recovery_workflow_id = $7 AND request.backup_id = $8
         AND request.manifest_digest = $9 AND request.source_device_id = $10
         AND request.active_lease_epoch = $11
         AND request.comparison_server_revision = $12 AND request.baseline_server_revision = $13
       RETURNING candidate.candidate_id, candidate.candidate_request_id,
                 candidate.recovery_workflow_id, candidate.backup_id,
                 candidate.manifest_digest, candidate.comparison_server_revision::text,
                 candidate.entity_id, candidate.field_path, candidate.backup_value,
                 candidate.backup_value_hash, candidate.current_value_hash,
                 candidate.status, candidate.row_version::text,
                 to_char(candidate.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
                 to_char(candidate.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS updated_at,
                 to_char(candidate.expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS expires_at`,
      [
        transaction.scope.accountId,
        transaction.scope.workspaceId,
        command.candidateId,
        command.transition,
        command.expectedRowVersion,
        capability.expectedStatus,
        capability.recoveryWorkflowId,
        capability.backupId,
        capability.manifestDigest,
        capability.sourceDeviceId,
        capability.activeLeaseEpoch,
        capability.comparisonServerRevision,
        capability.pinnedBaselineRevision,
      ],
    );
    const row = result.rows[0];
    if (row === undefined) throw new TypeError("restore candidate compare-and-set lost");
    return parseCandidate(row);
  }

  async readOldestUnresolvedComparisonRevision(
    transaction: TenantTransaction,
  ): Promise<number | null> {
    const result = await transaction.query<{ oldest: string | null }>(
      `SELECT min(comparison_server_revision)::text AS oldest
       FROM restore_candidates
       WHERE account_id = $1 AND workspace_id = $2
         AND status IN ('open', 'rebase_required') AND expires_at > transaction_timestamp()`,
      [transaction.scope.accountId, transaction.scope.workspaceId],
    );
    const value = result.rows[0]?.oldest ?? null;
    return value === null ? null : safeInteger(value);
  }

  private async readCandidates(
    transaction: TenantTransaction,
    requestId: string,
  ): Promise<readonly RestoreCandidate[]> {
    const result = await transaction.query<CandidateRow>(
      `SELECT candidate_id, candidate_request_id, recovery_workflow_id, backup_id,
              manifest_digest, comparison_server_revision::text, entity_id, field_path,
              backup_value, backup_value_hash, current_value_hash, status, row_version::text,
              to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
              to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS updated_at,
              to_char(expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS expires_at
       FROM restore_candidates
       WHERE account_id = $1 AND workspace_id = $2 AND candidate_request_id = $3
       ORDER BY entity_id COLLATE "C",
         CASE field_path WHEN 'note' THEN 1 WHEN 'portfolioId' THEN 2 WHEN 'tags' THEN 3 ELSE 4 END`,
      [transaction.scope.accountId, transaction.scope.workspaceId, requestId],
    );
    return result.rows.map(parseCandidate);
  }
}

interface RequestRow {
  candidate_request_id: string;
  recovery_workflow_id: string;
  backup_id: string;
  manifest_digest: string;
  comparison_server_revision: string;
  request_digest: string;
  receipt_digest: string;
  created_at: string;
}

interface CandidateRow {
  candidate_id: string;
  candidate_request_id: string;
  recovery_workflow_id: string;
  backup_id: string;
  manifest_digest: string;
  comparison_server_revision: string;
  entity_id: string;
  field_path: string;
  backup_value: unknown;
  backup_value_hash: string;
  current_value_hash: string;
  status: string;
  row_version: string;
  created_at: string;
  updated_at: string;
  expires_at: string;
}

function parseCandidate(row: CandidateRow): RestoreCandidate {
  return restoreCandidateSchema.parse({
    schemaVersion: RECOVERY_PROTOCOL_VERSION,
    candidateId: row.candidate_id,
    candidateRequestId: row.candidate_request_id,
    recoveryWorkflowId: row.recovery_workflow_id,
    backupId: row.backup_id,
    manifestDigest: row.manifest_digest,
    comparisonServerRevision: safeInteger(row.comparison_server_revision),
    entityId: row.entity_id,
    fieldPath: row.field_path,
    backupValue: row.backup_value,
    backupValueHash: row.backup_value_hash,
    currentValueHash: row.current_value_hash,
    status: row.status,
    rowVersion: safeInteger(row.row_version),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
  });
}

function safeInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new TypeError("stored recovery integer invalid");
  return parsed;
}
