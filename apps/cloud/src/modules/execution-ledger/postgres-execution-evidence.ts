import { createHash, verify } from "node:crypto";
import {
  executionFactIngestRequestSchema,
  executionEvidenceIngestResponseSchema,
  executionEvidenceReceiptsRequestSchema,
  executionEvidenceReceiptsResponseSchema,
  afternicListingWriteClaimPayloadSchema, afternicListingWriteClaimAuditPayloadSchema, afternicListingWriteApprovalAuditPayloadSchema,
  decodeAfternicListingWriteItemApprovalJson, encodeAfternicListingWriteItemApprovalEnvelope, encodeAfternicListingWriteItemApprovalSignatureTranscript,
  afternicDelistClaimPayloadSchema,
  afternicDelistClaimAuditPayloadSchema,
  afternicDelistApprovalAuditPayloadSchema,
  decodeAfternicDelistItemApprovalJson,
  encodeAfternicDelistItemApprovalEnvelope,
  encodeAfternicDelistItemApprovalSignatureTranscript,
  encodeAfternicLocalDispatchKeyDigestInput,
  encodeExecutionFactSignatureTranscript,
  encodeDrainStreamEnvelope,
  type ExecutionFact,
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
import type { DeviceAuditEvidenceReadPort } from "../audit/index";
export interface ExecutionFactEvidenceReadPort {
  event(
    transaction: AccountTransaction,
    source: { workspaceId: string; sourceDeviceId: string },
    eventId: string,
  ): Promise<ExecutionFact | null>;
}
export class PostgresExecutionFactEvidenceReader implements ExecutionFactEvidenceReadPort {
  async event(
    tx: AccountTransaction,
    source: { workspaceId: string; sourceDeviceId: string },
    eventId: string,
  ): Promise<ExecutionFact | null> {
    const rows = await tx.query(
      `SELECT signed_event FROM execution_fact_drain_records WHERE account_id=$1 AND workspace_id=$2 AND source_device_id=$3 AND event_id=$4 AND quarantine_reason IS NULL`,
      [tx.accountId, source.workspaceId, source.sourceDeviceId, eventId],
    );
    if (rows.rows.length !== 1) return null;
    const row: unknown = rows.rows[0];
    if (typeof row !== "object" || row === null || !("signed_event" in row)) return null;
    const parsed = executionFactIngestRequestSchema.safeParse({ schemaVersion: 1, fact: row.signed_event });
    return parsed.success ? parsed.data.fact : null;
  }
}
export class PostgresExecutionFactEvidenceService {
  constructor(
    private readonly authority: ExecutionEvidenceAuthorityPort,
    private readonly contexts: HistoricalExecutionContextPort,
    private readonly audits: DeviceAuditEvidenceReadPort,
  ) {}
  async ingest(value: unknown, principal: PublicPrincipal): Promise<ExecutionEvidenceIngestResponse | null> {
    const { fact } = executionFactIngestRequestSchema.parse(value);
    return this.authority.withActiveSource(principal, async (source) => {
      if (fact.workspaceId !== source.workspaceId || fact.sourceDeviceId !== source.sourceDeviceId)
        return null;
      const result = await this.adjudicate(source, fact);
      const rows = await source.transaction.query<{ response: unknown }>(
        "SELECT public.execution_fact_evidence_append($1::jsonb,$2::bytea,$3::text,$4::boolean,$5::text) AS response",
        [
          fact,
          Buffer.from(encodeDrainStreamEnvelope("execution_fact", fact)),
          result.reason,
          result.signatureVerified,
          result.pending,
        ],
      );
      return executionEvidenceIngestResponseSchema.parse(rows.rows[0]?.response);
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
          "SELECT public.execution_fact_evidence_receipt($1,$2,$3,$4) AS receipt",
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
    fact: ExecutionFact,
  ): Promise<{
    reason: ExecutionEvidenceQuarantineReason | null;
    signatureVerified: boolean;
    pending: string | null;
  }> {
    const context = await this.contexts.read(source.transaction, {
      workspaceId: fact.workspaceId,
      sourceDeviceId: fact.sourceDeviceId,
      activeLeaseEpoch: fact.activeLeaseEpoch,
      credentialEpoch: fact.credentialEpoch,
      signingKeyId: fact.signingKeyId,
      signingKeyVersion: fact.signingKeyVersion,
      trustedTimeAnchorId: fact.trustedTimeAnchorId,
      authorizationHash: fact.authorizationHash,
      monotonicDeltaMs: fact.monotonicDeltaMs,
      occurredAt: fact.occurredAt,
    });
    if (!context.found) {
      const key = await this.contexts.readSourceSigningKeyForQuarantine(source.transaction, fact);
      const signatureVerified =
        key !== null &&
        verify(
          null,
          encodeExecutionFactSignatureTranscript(fact),
          key,
          Buffer.from(fact.deviceSignature, "base64url"),
        );
      return {
        reason: key !== null && !signatureVerified ? "signature" : context.reason,
        signatureVerified,
        pending: null,
      };
    }
    const signed = verify(
      null,
      encodeExecutionFactSignatureTranscript(fact),
      context.devicePublicKey,
      Buffer.from(fact.deviceSignature, "base64url"),
    );
    const verdict = (reason: ExecutionEvidenceQuarantineReason | null, pending: string | null = null) => ({
      reason,
      signatureVerified: signed,
      pending,
    });
    if (!signed) return verdict("signature");
    if (context.authorizationFailure !== null) return verdict(context.authorizationFailure);
    const evidence = fact.executionAuthorizationEvidence;
    const writePayload = afternicListingWriteClaimPayloadSchema.safeParse(fact.payloadRedacted);
    const payload = writePayload.success ? writePayload.data : afternicDelistClaimPayloadSchema.parse(fact.payloadRedacted);
    const encodeApproval = writePayload.success ? encodeAfternicListingWriteItemApprovalEnvelope : encodeAfternicDelistItemApprovalEnvelope;
    const encodeApprovalSignature = writePayload.success ? encodeAfternicListingWriteItemApprovalSignatureTranscript : encodeAfternicDelistItemApprovalSignatureTranscript;
    let approval;
    try {
      approval = (writePayload.success ? decodeAfternicListingWriteItemApprovalJson : decodeAfternicDelistItemApprovalJson)(
        Buffer.from(evidence.approvedOperationEnvelope, "base64url"),
      );
    } catch {
      return verdict("authorization");
    }
    const approvalDigest = hash(encodeApproval(approval));
    if (
      approval.action !== payload.action ||
      approval.accountId !== source.transaction.accountId ||
      approval.workspaceId !== fact.workspaceId ||
      approval.sourceDeviceId !== fact.sourceDeviceId ||
      approval.activeLeaseEpoch !== fact.activeLeaseEpoch ||
      approval.credentialEpoch !== fact.credentialEpoch ||
      approval.signingKeyId !== fact.signingKeyId ||
      approval.signingKeyVersion !== fact.signingKeyVersion ||
      evidence.credentialEpoch !== approval.credentialEpoch ||
      evidence.signingKeyId !== approval.signingKeyId ||
      evidence.signingKeyVersion !== approval.signingKeyVersion ||
      evidence.signatureTranscriptVersion !== 1 ||
      approval.approvedOperationId !== fact.approvedOperationId ||
      approval.operationId !== fact.operationId ||
      approval.operationItemId !== fact.operationItemId ||
      approval.planHash !== fact.planHash ||
      approval.requestDigest !== payload.requestDigest ||
      approvalDigest !== payload.approvalEnvelopeDigest ||
      approvalDigest !== evidence.approvedOperationDigest ||
      fact.requestStartBoundary !== fact.occurredAt ||
      approval.approvedAt > fact.occurredAt ||
      hash(
        encodeAfternicLocalDispatchKeyDigestInput({
          schemaVersion: 1,
          operationId: fact.operationId,
          operationItemId: fact.operationItemId,
          attemptNo: 1,
          localOperationKey: approval.planId,
        }),
      ) !== fact.idempotencyKeyHash
    )
      return verdict("authorization");
    const original = await this.contexts.read(source.transaction, {
      workspaceId: approval.workspaceId,
      sourceDeviceId: approval.sourceDeviceId,
      activeLeaseEpoch: approval.activeLeaseEpoch,
      credentialEpoch: approval.credentialEpoch,
      signingKeyId: approval.signingKeyId,
      signingKeyVersion: approval.signingKeyVersion,
      trustedTimeAnchorId: approval.trustedTimeAnchorId,
      authorizationHash: approval.authorizationHash,
      monotonicDeltaMs: approval.monotonicDeltaMs,
      occurredAt: approval.approvedAt,
    });
    if (!original.found) return verdict(original.reason);
    if (original.authorizationFailure !== null) return verdict(original.authorizationFailure);
    if (
      !verify(
        null,
        encodeApprovalSignature(approval),
        original.devicePublicKey,
        Buffer.from(approval.deviceSignature, "base64url"),
      )
    )
      return verdict("authorization");
    const approvedAudit = await this.audits.approval(source.transaction, fact, fact.approvedOperationId);
    if (approvedAudit === null) return verdict(null, "APPROVAL_AUDIT_MISSING");
    const batchResult = writePayload.success ? afternicListingWriteApprovalAuditPayloadSchema.safeParse(approvedAudit.payloadRedacted) : afternicDelistApprovalAuditPayloadSchema.safeParse(approvedAudit.payloadRedacted);
    if (!batchResult.success) return verdict("authorization");
    const batch = batchResult.data;
    if (
      batch.action !== approval.action ||
      batch.planId !== approval.planId ||
      batch.planHash !== approval.planHash ||
      batch.operationId !== approval.operationId ||
      batch.targetCount !== approval.targetCount ||
      batch.targetSetDigest !== approval.targetSetDigest ||
      approvedAudit.occurredAt !== approval.approvedAt ||
      approvedAudit.authorizationContextHash !== approval.authorizationHash ||
      approvedAudit.trustedTimeAnchorId !== approval.trustedTimeAnchorId ||
      approvedAudit.monotonicDeltaMs !== approval.monotonicDeltaMs ||
      approvedAudit.credentialEpoch !== approval.credentialEpoch ||
      approvedAudit.signingKeyId !== approval.signingKeyId ||
      approvedAudit.signingKeyVersion !== approval.signingKeyVersion
    )
      return verdict("authorization");
    const audit = await this.audits.event(source.transaction, fact, fact.auditEventRef);
    if (audit === null) return verdict(null, "PAIRED_AUDIT_MISSING");
    const paired = writePayload.success ? afternicListingWriteClaimAuditPayloadSchema.safeParse(audit.payloadRedacted) : afternicDelistClaimAuditPayloadSchema.safeParse(audit.payloadRedacted);
    if (!paired.success) return verdict("authorization");
    const p = paired.data;
    return verdict(
      p.action === approval.action &&
        audit.eventHash === fact.auditEventHash &&
        audit.occurredAt === fact.occurredAt &&
        audit.monotonicDeltaMs === fact.monotonicDeltaMs &&
        audit.trustedTimeAnchorId === fact.trustedTimeAnchorId &&
        audit.authorizationContextHash === fact.authorizationHash &&
        audit.signingKeyId === fact.signingKeyId &&
        audit.signingKeyVersion === fact.signingKeyVersion &&
        audit.credentialEpoch === fact.credentialEpoch &&
        p.approvedOperationId === fact.approvedOperationId &&
        p.operationId === fact.operationId &&
        p.operationItemId === fact.operationItemId &&
        p.attemptId === fact.attemptId &&
        p.attemptNo === fact.attemptNo &&
        p.planHash === fact.planHash &&
        p.requestDigest === payload.requestDigest &&
        p.approvalEnvelopeDigest === approvalDigest
        ? null
        : "authorization",
    );
  }
}
function hash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("base64url");
}
