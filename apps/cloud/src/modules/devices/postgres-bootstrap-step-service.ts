import { createHash, randomBytes } from "node:crypto";

import {
  bootstrapStepRequestSchema,
  bootstrapStepResultSchema,
  encodeBootstrapStepReplayRequest,
  encodeBootstrapStepRequestDigestInput,
  encodeBootstrapStepResultDigestInput,
  type BootstrapStepRequest,
  type BootstrapStepResult,
} from "@gooddealer/protocol/devices";
import {
  WORKSPACE_SYNC_SCHEMA_VERSION,
  checkpointDescriptorSchema,
  encodeMutationPageDigestInput,
  encodeWorkspaceEntityDigestsInput,
} from "@gooddealer/protocol/workspace";
import { encodeDomainSeparatedWireValue } from "@gooddealer/protocol/wire";

import { type TenantTransaction, type TenantTransactionRunner } from "../../db/index";
import {
  BootstrapCapabilityVerifier,
  copyBoundedWireValue,
  type BootstrapCapabilityExpectedBinding,
  type VerifiedBootstrapCapabilityPresentation,
} from "./bootstrap-capability-verifier";
import type {
  BootstrapAccountSecurityPort,
  BootstrapCheckpointPort,
  BootstrapMutationPagePort,
  BootstrapProjectionDigestPort,
  BootstrapRevisionPort,
} from "./bootstrap-persistence-ports";

export const BOOTSTRAP_PERSISTENCE_LOCK_ORDER = [
  "identity_account_security",
  "device_account_state",
  "target_binding",
  "target_signing_key",
  "workflow",
  "capability",
  "bootstrap_authority",
  "current_nonce_and_step_ledger",
  "workspace_revision",
  "checkpoint_pin",
  "mutation_range",
] as const;

export type BootstrapPersistenceAttempt =
  | { readonly accepted: true; readonly result: BootstrapStepResult; readonly replay: boolean }
  | { readonly accepted: false; readonly code: "CAPABILITY_INVALID" | "BOOTSTRAP_CONFLICT" };

export class PostgresBootstrapStepService {
  constructor(private readonly dependencies: {
    readonly transactions: TenantTransactionRunner;
    readonly verifier: BootstrapCapabilityVerifier;
    readonly accountSecurity: BootstrapAccountSecurityPort;
    readonly revisions: BootstrapRevisionPort;
    readonly checkpoints: BootstrapCheckpointPort;
    readonly mutations: BootstrapMutationPagePort;
    readonly projection: BootstrapProjectionDigestPort;
    readonly fault?: (point: string) => void;
  }) {}

  async execute(input: {
    readonly scope: { readonly accountId: string; readonly workspaceId: string };
    readonly expectedCapability: BootstrapCapabilityExpectedBinding;
    readonly capability: unknown;
    readonly request: unknown;
  }): Promise<BootstrapPersistenceAttempt> {
    const copiedRequest = copyBoundedWireValue(input.request);
    const parsedRequest = bootstrapStepRequestSchema.safeParse(copiedRequest);
    if (!parsedRequest.success || !requestDigestMatches(parsedRequest.data)) return conflict();
    const admission = await this.dependencies.verifier.verify(input.capability, input.expectedCapability);
    if (!admission.accepted) return { accepted: false, code: "CAPABILITY_INVALID" };
    const request = parsedRequest.data;
    if (request.deviceSwitchRequestId !== input.expectedCapability.deviceSwitchRequestId ||
      request.capabilityJti !== input.expectedCapability.jti) return conflict();

    try {
      return await this.dependencies.transactions.withTenant(input.scope, async (transaction) => {
        await transaction.query("SET LOCAL lock_timeout = '2s'");
        await transaction.query("SET LOCAL statement_timeout = '10s'");
        return this.#executeOnce(transaction, admission.presentation, request);
      });
    } catch (error) {
      if (error instanceof BootstrapRefusal) return conflict();
      throw error;
    }
  }

  async #executeOnce(
    transaction: TenantTransaction,
    presentation: VerifiedBootstrapCapabilityPresentation,
    request: BootstrapStepRequest,
  ): Promise<BootstrapPersistenceAttempt> {
    if (!this.dependencies.verifier.owns(presentation)) refuse();
    const security = await this.dependencies.accountSecurity.lockCurrent(transaction);
    if (security === null || security.status !== "normal" ||
      security.accountSecurityEpoch !== presentation.envelope.accountSecurityEpoch) refuse();

    const account = await transaction.query(
      `SELECT account_id FROM device_account_states WHERE account_id = $1 FOR UPDATE`,
      [transaction.scope.accountId],
    );
    if (account.rowCount !== 1) refuse();
    const binding = await transaction.query<{ status: string }>(
      `SELECT status FROM device_bindings
       WHERE account_id = $1 AND device_id = $2 FOR UPDATE`,
      [transaction.scope.accountId, presentation.envelope.deviceId],
    );
    if (binding.rows[0]?.status !== "bound") refuse();

    const workflow = await transaction.query<{
      status: string; workflow_revision: string; to_device_id: string; bound_key_id: string;
      bound_key_version: string; bound_account_security_epoch: string; pending_lease_epoch: string | null;
    }>(
      `SELECT status, workflow_revision, to_device_id, bound_key_id, bound_key_version,
              bound_account_security_epoch, pending_lease_epoch
       FROM device_switch_workflows
       WHERE account_id = $1 AND workspace_id = $2 AND workflow_id = $3 FOR UPDATE`,
      [transaction.scope.accountId, transaction.scope.workspaceId, request.deviceSwitchRequestId],
    );
    const workflowRow = workflow.rows[0];
    if (workflowRow === undefined || workflowRow.status !== "bootstrapping" ||
      workflowRow.to_device_id !== presentation.envelope.deviceId ||
      parseInteger(workflowRow.bound_account_security_epoch) !== security.accountSecurityEpoch ||
      workflowRow.pending_lease_epoch === null) refuse();
    const key = await transaction.query<{ status: string }>(
      `SELECT status FROM device_signing_keys
       WHERE account_id = $1 AND device_id = $2 AND key_id = $3 AND key_version = $4 FOR UPDATE`,
      [transaction.scope.accountId, presentation.envelope.deviceId,
        workflowRow.bound_key_id, parseInteger(workflowRow.bound_key_version)],
    );
    if (key.rows[0]?.status !== "active") refuse();

    const capability = await transaction.query<{
      jti: string; target_device_id: string; issued_at: Date; expires_at: Date; consumed_at: Date | null;
      canonical_signed_envelope: Buffer | null; signed_envelope_digest: Buffer | null; ready_at: Date | null;
      live: boolean;
    }>(
      `SELECT jti, target_device_id, issued_at, expires_at, consumed_at,
              canonical_signed_envelope, signed_envelope_digest, ready_at,
              transaction_timestamp() >= issued_at AND transaction_timestamp() < expires_at AS live
       FROM device_bootstrap_capabilities
       WHERE account_id = $1 AND workspace_id = $2 AND workflow_id = $3 FOR UPDATE`,
      [transaction.scope.accountId, transaction.scope.workspaceId, request.deviceSwitchRequestId],
    );
    const capabilityRow = capability.rows[0];
    if (capabilityRow === undefined || !capabilityRow.live || capabilityRow.consumed_at !== null ||
      capabilityRow.ready_at === null || capabilityRow.jti !== presentation.envelope.jti ||
      capabilityRow.target_device_id !== presentation.envelope.deviceId ||
      capabilityRow.canonical_signed_envelope === null || capabilityRow.signed_envelope_digest === null ||
      !capabilityRow.canonical_signed_envelope.equals(Buffer.from(presentation.canonicalSignedEnvelope)) ||
      !capabilityRow.signed_envelope_digest.equals(Buffer.from(presentation.signedEnvelopeDigest))) refuse();

    const authority = await transaction.query<AuthorityRow>(
      `SELECT * FROM device_bootstrap_authorities
       WHERE account_id = $1 AND workspace_id = $2 AND workflow_id = $3 FOR UPDATE`,
      [transaction.scope.accountId, transaction.scope.workspaceId, request.deviceSwitchRequestId],
    );
    const authorityRow = authority.rows[0];
    if (authorityRow === undefined || authorityRow.capability_jti !== presentation.envelope.jti ||
      authorityRow.target_device_id !== presentation.envelope.deviceId ||
      parseInteger(authorityRow.account_security_epoch) !== security.accountSecurityEpoch ||
      parseInteger(authorityRow.pending_lease_epoch) !== parseInteger(workflowRow.pending_lease_epoch)) refuse();

    const canonicalRequest = Buffer.from(encodeBootstrapStepReplayRequest(request));
    const stored = await transaction.query<{ canonical_request: Buffer | null; canonical_result: Buffer }>(
      `SELECT canonical_request, canonical_result FROM device_bootstrap_steps
       WHERE account_id = $1 AND workspace_id = $2 AND workflow_id = $3 AND step_number = $4 FOR UPDATE`,
      [transaction.scope.accountId, transaction.scope.workspaceId, request.deviceSwitchRequestId, request.stepNumber],
    );
    if (stored.rows[0] !== undefined) {
      if (stored.rows[0].canonical_request === null ||
        !stored.rows[0].canonical_request.equals(canonicalRequest)) refuse();
      const result = bootstrapStepResultSchema.parse(decodeCanonicalJson(stored.rows[0].canonical_result));
      if (!stored.rows[0].canonical_result.equals(canonicalResultBytes(result))) refuse();
      return { accepted: true, result, replay: true };
    }
    if (request.stepNumber !== parseInteger(authorityRow.next_step_number) ||
      request.stepKind !== authorityRow.next_step_kind ||
      request.expectedWorkflowRevision !== parseInteger(workflowRow.workflow_revision)) refuse();
    const nonceDigest = digestNonce(request.stepNonce);
    if (authorityRow.next_nonce_digest === null || !authorityRow.next_nonce_digest.equals(nonceDigest)) refuse();
    const nonce = await transaction.query<{ state: string }>(
      `SELECT state FROM device_bootstrap_step_nonces
       WHERE nonce_digest = $1 AND account_id = $2 AND workspace_id = $3
         AND workflow_id = $4 AND step_number = $5 FOR UPDATE`,
      [nonceDigest, transaction.scope.accountId, transaction.scope.workspaceId,
        request.deviceSwitchRequestId, request.stepNumber],
    );
    if (nonce.rows[0]?.state !== "active") refuse();

    const draft = await this.#executeStep(transaction, authorityRow, request, capabilityRow.expires_at);
    this.dependencies.fault?.("after_step_ports");
    const nextStepNonce = request.stepKind === "submit_rebuild_digest" ? null : randomBytes(32).toString("base64url");
    const resultDraft = {
      schemaVersion: 1 as const,
      workflowRevision: request.expectedWorkflowRevision + 1,
      acceptedStepNumber: request.stepNumber,
      nextStepNonce,
      ...draft,
      resultDigest: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    };
    const result = bootstrapStepResultSchema.parse({
      ...resultDraft,
      resultDigest: digest(encodeBootstrapStepResultDigestInput(resultDraft)).toString("base64url"),
    });
    const canonicalResult = canonicalResultBytes(result);

    const nonceConsumption = await transaction.query(
      `UPDATE device_bootstrap_step_nonces SET state = 'consumed', consumed_at = transaction_timestamp()
       WHERE nonce_digest = $1 AND state = 'active'`, [nonceDigest]);
    if (nonceConsumption.rowCount !== 1) refuse();
    this.dependencies.fault?.("after_nonce_consumed");
    await transaction.query(
      `INSERT INTO device_bootstrap_steps
         (account_id, workspace_id, workflow_id, step_number, nonce_digest, request_digest,
          canonical_request, step_kind, canonical_result, result_digest, accepted_workflow_revision)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [transaction.scope.accountId, transaction.scope.workspaceId, request.deviceSwitchRequestId,
        request.stepNumber, nonceDigest, Buffer.from(request.requestDigest, "base64url"), canonicalRequest,
        request.stepKind, canonicalResult, Buffer.from(result.resultDigest, "base64url"), result.workflowRevision],
    );
    if (nextStepNonce !== null) {
      const nextDigest = digestNonce(nextStepNonce);
      await transaction.query(
        `INSERT INTO device_bootstrap_step_nonces
           (nonce_digest, account_id, workspace_id, workflow_id, step_number, state)
         VALUES ($1,$2,$3,$4,$5,'active')`,
        [nextDigest, transaction.scope.accountId, transaction.scope.workspaceId,
          request.deviceSwitchRequestId, request.stepNumber + 1],
      );
      const authorityUpdate = await transaction.query(
        `UPDATE device_bootstrap_authorities
         SET next_step_number = $4, next_step_kind = $5, next_nonce_digest = $6,
             row_version = row_version + 1, updated_at = transaction_timestamp()
         WHERE account_id = $1 AND workspace_id = $2 AND workflow_id = $3 AND row_version = $7`,
        [transaction.scope.accountId, transaction.scope.workspaceId, request.deviceSwitchRequestId,
          request.stepNumber + 1, nextKind(request, draft), nextDigest, parseInteger(authorityRow.row_version)],
      );
      if (authorityUpdate.rowCount !== 1) refuse();
    } else {
      const authorityUpdate = await transaction.query(
        `UPDATE device_bootstrap_authorities
         SET next_step_number = $4, next_step_kind = NULL, next_nonce_digest = NULL,
             row_version = row_version + 1, updated_at = transaction_timestamp()
         WHERE account_id = $1 AND workspace_id = $2 AND workflow_id = $3 AND row_version = $5`,
        [transaction.scope.accountId, transaction.scope.workspaceId, request.deviceSwitchRequestId,
          request.stepNumber + 1, parseInteger(authorityRow.row_version)],
      );
      if (authorityUpdate.rowCount !== 1) refuse();
    }
    const workflowUpdate = await transaction.query(
      `UPDATE device_switch_workflows SET workflow_revision = $4, updated_at = transaction_timestamp()
       WHERE account_id = $1 AND workspace_id = $2 AND workflow_id = $3 AND workflow_revision = $5`,
      [transaction.scope.accountId, transaction.scope.workspaceId, request.deviceSwitchRequestId,
        result.workflowRevision, request.expectedWorkflowRevision],
    );
    if (workflowUpdate.rowCount !== 1) refuse();
    this.dependencies.fault?.("before_commit");
    return { accepted: true, result, replay: false };
  }

  async #executeStep(
    transaction: TenantTransaction,
    authority: AuthorityRow,
    request: BootstrapStepRequest,
    capabilityExpiresAt: Date,
  ) {
    if (request.stepKind === "pin_checkpoint") {
      const head = await this.dependencies.revisions.lock(transaction);
      if (head === null) refuse();
      const descriptor = checkpointDescriptorSchema.parse({
        schemaVersion: WORKSPACE_SYNC_SCHEMA_VERSION,
        workspaceId: transaction.scope.workspaceId,
        workspaceSchemaVersion: head.workspaceSchemaVersion,
        checkpointId: request.stepPayload.checkpointId,
        throughServerRevision: request.stepPayload.checkpointThroughServerRevision,
        checkpointDigest: request.stepPayload.checkpointDigest,
      });
      const deadline = await transaction.query<{ expires_at: Date }>(
        `SELECT least(transaction_timestamp() + interval '15 minutes', $1::timestamptz) AS expires_at`,
        [capabilityExpiresAt.toISOString()],
      );
      const expiresAt = deadline.rows[0] === undefined ? undefined : canonicalSecond(deadline.rows[0].expires_at);
      if (expiresAt === undefined) refuse();
      const pinned = await this.dependencies.checkpoints.lockAvailableAndPin(transaction, {
        workflowId: request.deviceSwitchRequestId, descriptor, expiresAt,
      });
      if (pinned === null || pinned.checkpointDigest !== descriptor.checkpointDigest) refuse();
      await transaction.query(
        `UPDATE device_bootstrap_authorities SET pinned_checkpoint_id = $4,
           pinned_checkpoint_through_server_revision = $5, pinned_checkpoint_digest = $6, pin_expires_at = $7,
           target_server_revision = $8, target_schema_version = $9
           , next_from_revision = $5, next_cursor_presentation = NULL, next_cursor_digest = NULL
         WHERE account_id = $1 AND workspace_id = $2 AND workflow_id = $3`,
        [transaction.scope.accountId, transaction.scope.workspaceId, request.deviceSwitchRequestId,
          pinned.checkpointId, pinned.throughServerRevision, Buffer.from(pinned.checkpointDigest, "base64url"),
          expiresAt, head.serverRevision, head.workspaceSchemaVersion],
      );
      return { stepKind: "pin_checkpoint" as const, resultPayload: {
        checkpointId: pinned.checkpointId, checkpointThroughServerRevision: pinned.throughServerRevision,
        checkpointDigest: pinned.checkpointDigest, pinExpiresAt: expiresAt,
      } };
    }
    if (request.stepKind === "fetch_mutations") {
      if (authority.pinned_checkpoint_id !== request.stepPayload.pinnedCheckpointId ||
        parseInteger(authority.pinned_checkpoint_through_server_revision) !== request.stepPayload.pinnedCheckpointThroughServerRevision ||
        authority.pinned_checkpoint_digest === null ||
        authority.pinned_checkpoint_digest.toString("base64url") !== request.stepPayload.pinnedCheckpointDigest ||
        parseInteger(authority.target_server_revision) !== request.stepPayload.throughServerRevisionInclusive ||
        parseInteger(authority.next_from_revision) !== request.stepPayload.fromServerRevisionExclusive ||
        authority.next_cursor_presentation !== request.stepPayload.cursor) refuse();
      const page = await this.dependencies.mutations.readDensePage(transaction, request.stepPayload);
      if (digest(encodeMutationPageDigestInput(page)).toString("base64url") !== page.pageDigest) refuse();
      await transaction.query(
        `UPDATE device_bootstrap_authorities SET next_from_revision = $4,
           next_cursor_presentation = $5, next_cursor_digest = $6
         WHERE account_id = $1 AND workspace_id = $2 AND workflow_id = $3`,
        [transaction.scope.accountId, transaction.scope.workspaceId, request.deviceSwitchRequestId,
          page.returnedThroughServerRevision, page.nextCursor,
          page.nextCursor === null ? null : digest(Buffer.from(page.nextCursor, "utf8"))],
      );
      return { stepKind: "fetch_mutations" as const, resultPayload: { mutationPage: page } };
    }
    if (parseInteger(authority.target_server_revision) !== request.stepPayload.targetServerRevision ||
      parseInteger(authority.target_schema_version) !== request.stepPayload.workspaceSchemaVersion ||
      authority.next_cursor_presentation !== null ||
      parseInteger(authority.next_from_revision) !== request.stepPayload.targetServerRevision) refuse();
    const entityDigests = await this.dependencies.projection.readEntityDigestsAt(transaction, {
      checkpointId: required(authority.pinned_checkpoint_id),
      throughServerRevisionInclusive: request.stepPayload.targetServerRevision,
      workspaceSchemaVersion: request.stepPayload.workspaceSchemaVersion,
    });
    const canonical = Buffer.from(encodeWorkspaceEntityDigestsInput(entityDigests));
    if (!canonical.equals(Buffer.from(encodeWorkspaceEntityDigestsInput(request.stepPayload.entityDigests)))) refuse();
    const verifiedDigest = digest(canonical).toString("base64url");
    await transaction.query(
      `UPDATE device_bootstrap_authorities
       SET verified_entity_digests = $4, verified_rebuild_digest = $5
       WHERE account_id = $1 AND workspace_id = $2 AND workflow_id = $3`,
      [transaction.scope.accountId, transaction.scope.workspaceId, request.deviceSwitchRequestId,
        canonical, Buffer.from(verifiedDigest, "base64url")],
    );
    return { stepKind: "submit_rebuild_digest" as const, resultPayload: {
      verifiedRevision: request.stepPayload.targetServerRevision, verifiedDigest, accepted: true as const,
    } };
  }
}

interface AuthorityRow {
  capability_jti: string; target_device_id: string; account_security_epoch: string;
  pending_lease_epoch: string; next_step_number: string; next_step_kind: BootstrapStepRequest["stepKind"] | null;
  next_nonce_digest: Buffer | null; pinned_checkpoint_id: string | null;
  pinned_checkpoint_through_server_revision: string | null; pinned_checkpoint_digest: Buffer | null;
  pin_expires_at: Date | null; target_server_revision: string | null; target_schema_version: string | null;
  next_from_revision: string | null; next_cursor_presentation: string | null; row_version: string;
}

class BootstrapRefusal extends Error {}
function refuse(): never { throw new BootstrapRefusal("bootstrap authority conflict"); }
function conflict(): BootstrapPersistenceAttempt { return { accepted: false, code: "BOOTSTRAP_CONFLICT" }; }
function digest(value: Uint8Array): Buffer { return createHash("sha256").update(value).digest(); }
function digestNonce(value: string): Buffer {
  return digest(encodeDomainSeparatedWireValue("GOODDEALER-BOOTSTRAP-STEP-NONCE-V1", value));
}
function requestDigestMatches(value: BootstrapStepRequest): boolean {
  return digest(encodeBootstrapStepRequestDigestInput(value)).toString("base64url") === value.requestDigest;
}
function parseInteger(value: string | null): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) refuse();
  return parsed;
}
function decodeCanonicalJson(value: Buffer): unknown {
  try { return JSON.parse(value.toString("utf8")); } catch { refuse(); }
}
function canonicalResultBytes(value: BootstrapStepResult): Buffer {
  return Buffer.from(JSON.stringify(bootstrapStepResultSchema.parse(value)), "utf8");
}
function canonicalSecond(value: Date): string {
  return value.toISOString().replace(/\.\d{3}Z$/u, "Z");
}
function required<T>(value: T | null): T { if (value === null) refuse(); return value; }
function nextKind(request: BootstrapStepRequest, draft: { stepKind: BootstrapStepRequest["stepKind"]; resultPayload: unknown }) {
  if (request.stepKind === "pin_checkpoint") return "fetch_mutations";
  if (request.stepKind === "fetch_mutations") {
    const page = (draft.resultPayload as { mutationPage: { nextCursor: string | null } }).mutationPage;
    return page.nextCursor === null ? "submit_rebuild_digest" : "fetch_mutations";
  }
  return null;
}
