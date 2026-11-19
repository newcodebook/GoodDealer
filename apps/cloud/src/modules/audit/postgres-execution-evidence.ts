import { createHash, verify } from "node:crypto";
import {
  deviceAuditIngestRequestSchema,
  executionEvidenceIngestResponseSchema,
  executionEvidenceReceiptsRequestSchema,
  executionEvidenceReceiptsResponseSchema,
  afternicListingWriteApprovalAuditPayloadSchema, afternicListingWriteClaimAuditPayloadSchema,
  afternicListingWriteReconciledAuditPayloadSchema, afternicListingWritePreflightRefusedAuditPayloadSchema,
  afternicDelistClaimPayloadSchema, afternicListingWriteClaimPayloadSchema,
  afternicDelistApprovalAuditPayloadSchema,
  afternicDelistClaimAuditPayloadSchema,
  afternicDelistReconciledAuditPayloadSchema,
  afternicDelistPreflightRefusedAuditPayloadSchema,
  encodeDeviceAuditEventSignatureTranscript,
  encodeDeviceAuditEventHashInput,
  encodeDrainStreamEnvelope,
  encodeWorkspaceDeviceAuditChainDomain,
  type DeviceAuditEvent,
  type ExecutionEvidenceIngestResponse,
  type ExecutionEvidenceReceiptsResponse,
  type ExecutionEvidenceQuarantineReason,
} from "@gooddealer/protocol/execution-events";
import type { AccountTransaction } from "../../db/index";
import type { PublicPrincipal } from "../../entrypoints/ports/public-session";
import type {
  ExecutionEvidenceAuthorityPort,
  ExecutionEvidenceSource,
  HistoricalExecutionContextPort,
} from "../devices/index";
import type { ExecutionFactEvidenceReadPort } from "../execution-ledger/index";
type WorkspaceAudit = DeviceAuditEvent & { scopeKind: "workspace" };
export interface DeviceAuditEvidenceReadPort {
  approval(
    transaction: AccountTransaction,
    source: { workspaceId: string; sourceDeviceId: string; activeLeaseEpoch: number },
    approvedOperationId: string,
  ): Promise<WorkspaceAudit | null>;
  event(
    transaction: AccountTransaction,
    source: { workspaceId: string; sourceDeviceId: string; activeLeaseEpoch: number },
    eventId: string,
  ): Promise<WorkspaceAudit | null>;
}
/** Only accepted immutable records are visible through this owning-module port. */
export class PostgresDeviceAuditEvidenceReader implements DeviceAuditEvidenceReadPort {
  async approval(
    tx: AccountTransaction,
    source: { workspaceId: string; sourceDeviceId: string; activeLeaseEpoch: number },
    approvedOperationId: string,
  ) {
    const rows = await tx.query(
      `SELECT signed_event FROM workspace_device_audit_drain_records WHERE account_id=$1 AND workspace_id=$2 AND source_device_id=$3 AND active_lease_epoch=$4 AND signed_event->'payloadRedacted'->>'stage'='approved' AND signed_event->'payloadRedacted'->>'approvedOperationId'=$5 AND quarantine_reason IS NULL`,
      [tx.accountId, source.workspaceId, source.sourceDeviceId, source.activeLeaseEpoch, approvedOperationId],
    );
    return readEvent(rows.rows);
  }
  async event(
    tx: AccountTransaction,
    source: { workspaceId: string; sourceDeviceId: string; activeLeaseEpoch: number },
    eventId: string,
  ) {
    const rows = await tx.query(
      `SELECT signed_event FROM workspace_device_audit_drain_records WHERE account_id=$1 AND workspace_id=$2 AND source_device_id=$3 AND active_lease_epoch=$4 AND event_id=$5 AND quarantine_reason IS NULL`,
      [tx.accountId, source.workspaceId, source.sourceDeviceId, source.activeLeaseEpoch, eventId],
    );
    return readEvent(rows.rows);
  }
}
function readEvent(rows: readonly unknown[]): WorkspaceAudit | null {
  if (rows.length !== 1 || typeof rows[0] !== "object" || rows[0] === null || !("signed_event" in rows[0]))
    return null;
  const parsed = deviceAuditIngestRequestSchema.safeParse({ schemaVersion: 1, event: rows[0].signed_event });
  return parsed.success && parsed.data.event.scopeKind === "workspace" ? parsed.data.event : null;
}
export class PostgresDeviceAuditEvidenceService {
  private readonly audits = new PostgresDeviceAuditEvidenceReader();
  constructor(
    private readonly authority: ExecutionEvidenceAuthorityPort,
    private readonly contexts: HistoricalExecutionContextPort,
    private readonly facts: ExecutionFactEvidenceReadPort,
  ) {}
  async ingest(value: unknown, principal: PublicPrincipal): Promise<ExecutionEvidenceIngestResponse | null> {
    const { event } = deviceAuditIngestRequestSchema.parse(value);
    if (event.scopeKind !== "workspace") return null;
    return this.authority.withActiveSource(principal, async (source) => {
      if (
        event.accountId !== source.transaction.accountId ||
        event.workspaceId !== source.workspaceId ||
        event.sourceDeviceId !== source.sourceDeviceId
      )
        return null;
      const result = await this.adjudicate(source, event);
      const row = await source.transaction.query<{ response: unknown }>(
        "SELECT public.audit_execution_evidence_append($1::jsonb,$2::bytea,$3::text,$4::boolean,$5::text) AS response",
        [
          event,
          Buffer.from(encodeDrainStreamEnvelope("device_audit", event)),
          result.reason,
          result.signatureVerified,
          result.pending,
        ],
      );
      return executionEvidenceIngestResponseSchema.parse(row.rows[0]?.response);
    });
  }
  async receipts(
    value: unknown,
    principal: PublicPrincipal,
  ): Promise<ExecutionEvidenceReceiptsResponse | null> {
    const request = executionEvidenceReceiptsRequestSchema.parse(value);
    return this.authority.withActiveSource(principal, async (source) => {
      const results = [];
      for (const query of request.entries) {
        const rows = await source.transaction.query<{ receipt: unknown }>(
          "SELECT public.audit_execution_evidence_receipt($1,$2,$3,$4) AS receipt",
          [
            query.activeLeaseEpoch,
            query.sequence,
            query.eventId,
            Buffer.from(query.envelopeDigest, "base64url"),
          ],
        );
        results.push({ query, receipt: rows.rows[0]?.receipt ?? null });
      }
      return executionEvidenceReceiptsResponseSchema.parse({ schemaVersion: 1, results });
    });
  }
  private async adjudicate(
    source: ExecutionEvidenceSource,
    event: WorkspaceAudit,
  ): Promise<{
    reason: ExecutionEvidenceQuarantineReason | null;
    signatureVerified: boolean;
    pending: string | null;
  }> {
    const context = await this.contexts.read(source.transaction, {
      workspaceId: event.workspaceId,
      sourceDeviceId: event.sourceDeviceId,
      activeLeaseEpoch: event.activeLeaseEpoch,
      credentialEpoch: event.credentialEpoch,
      signingKeyId: event.signingKeyId,
      signingKeyVersion: event.signingKeyVersion,
      trustedTimeAnchorId: event.trustedTimeAnchorId,
      authorizationHash: event.authorizationContextHash,
      monotonicDeltaMs: event.monotonicDeltaMs,
      occurredAt: event.occurredAt,
    });
    if (!context.found) {
      const key = await this.contexts.readSourceSigningKeyForQuarantine(source.transaction, event);
      const signatureVerified =
        key !== null &&
        verify(
          null,
          encodeDeviceAuditEventSignatureTranscript(event),
          key,
          Buffer.from(event.deviceSignature, "base64url"),
        );
      return {
        reason: key !== null && !signatureVerified ? "signature" : context.reason,
        signatureVerified,
        pending: null,
      };
    }
    const signed = verify(
      null,
      encodeDeviceAuditEventSignatureTranscript(event),
      context.devicePublicKey,
      Buffer.from(event.deviceSignature, "base64url"),
    );
    const verdict = (reason: ExecutionEvidenceQuarantineReason | null, pending: string | null = null) => ({
      reason,
      signatureVerified: signed,
      pending,
    });
    if (!signed) return verdict("signature");
    if (context.authorizationFailure !== null) return verdict(context.authorizationFailure);
    if (
      hash(encodeDeviceAuditEventHashInput(event)) !== event.eventHash ||
      hash(
        encodeWorkspaceDeviceAuditChainDomain({
          workspaceId: event.workspaceId,
          sourceDeviceId: event.sourceDeviceId,
          activeLeaseEpoch: event.activeLeaseEpoch,
        }),
      ) !== event.chainId
    )
      return verdict("audit_chain");
    const legacyApproved = afternicDelistApprovalAuditPayloadSchema.safeParse(event.payloadRedacted);
    const approved = legacyApproved.success ? legacyApproved : afternicListingWriteApprovalAuditPayloadSchema.safeParse(event.payloadRedacted);
    if (approved.success)
      return verdict(
        event.actorKind === "user" &&
          event.eventType === "approved_operation_execution" &&
          event.targetType === (approved.data.action === "remove" ? "afternic_delist_approval" : "afternic_listing_write_approval") &&
          event.targetRef === approved.data.approvedOperationId
          ? null
          : "authorization",
      );
    const legacyClaim = afternicDelistClaimAuditPayloadSchema.safeParse(event.payloadRedacted);
    const claim = legacyClaim.success ? legacyClaim : afternicListingWriteClaimAuditPayloadSchema.safeParse(event.payloadRedacted);
    const legacyPreflight = afternicDelistPreflightRefusedAuditPayloadSchema.safeParse(event.payloadRedacted);
    const preflight = legacyPreflight.success ? legacyPreflight : afternicListingWritePreflightRefusedAuditPayloadSchema.safeParse(event.payloadRedacted);
    if (claim.success || preflight.success) {
      const p = claim.success ? claim.data : preflight.data!;
      if (
        event.actorKind !== "device_service" ||
        event.targetType !== (p.action === "remove" ? "afternic_delist_attempt" : "afternic_listing_write_attempt") ||
        event.targetRef !== p.attemptId ||
        event.eventType !== (claim.success ? "approved_operation_execution" : "runtime_security_lifecycle")
      )
        return verdict("authorization");
      const original = await this.audits.approval(source.transaction, event, p.approvedOperationId);
      if (original === null) return verdict(null, "APPROVAL_AUDIT_MISSING");
      const batchResult = p.action === "remove" ? afternicDelistApprovalAuditPayloadSchema.safeParse(original.payloadRedacted) : afternicListingWriteApprovalAuditPayloadSchema.safeParse(original.payloadRedacted);
      if (!batchResult.success) return verdict("authorization");
      const batch = batchResult.data;
      return verdict(
        batch.action === p.action &&
          batch.operationId === p.operationId &&
          batch.planHash === p.planHash &&
          original.occurredAt <= event.occurredAt &&
          original.credentialEpoch === event.credentialEpoch &&
          original.signingKeyId === event.signingKeyId &&
          original.signingKeyVersion === event.signingKeyVersion
          ? null
          : "authorization",
      );
    }
    const legacyReconciled = afternicDelistReconciledAuditPayloadSchema.safeParse(event.payloadRedacted);
    const reconciled = legacyReconciled.success ? legacyReconciled.data : afternicListingWriteReconciledAuditPayloadSchema.parse(event.payloadRedacted);
    if (
      event.actorKind !== "device_service" ||
      event.eventType !== "runtime_security_lifecycle" ||
      event.targetType !== (reconciled.action === "remove" ? "afternic_delist_attempt" : "afternic_listing_write_attempt") ||
      event.targetRef !== reconciled.attemptId
    )
      return verdict("authorization");
    const original = await this.facts.event(source.transaction, event, reconciled.originalExecutionFactId);
    if (original === null) return verdict(null, "ORIGINAL_FACT_MISSING");
    const originalPayload = reconciled.action === "remove" ? afternicDelistClaimPayloadSchema.safeParse(original.payloadRedacted) : afternicListingWriteClaimPayloadSchema.safeParse(original.payloadRedacted);
    if (!originalPayload.success || originalPayload.data.action !== reconciled.action) return verdict("authorization");
    return verdict(
      hash(encodeDrainStreamEnvelope("execution_fact", original)) ===
        reconciled.originalExecutionFactDigest &&
        original.operationId === reconciled.operationId &&
        original.operationItemId === reconciled.operationItemId &&
        original.attemptId === reconciled.attemptId &&
        original.occurredAt <= event.occurredAt
        ? null
        : "authorization",
    );
  }
}
function hash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("base64url");
}
