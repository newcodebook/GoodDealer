import { createHash, createPublicKey, randomUUID, verify as verifySignature } from "node:crypto";

import {
  DEVICE_MANAGEMENT_SCHEMA_VERSION,
  type DeviceSwitchRejectionCode,
  type DeviceSwitchResponse,
} from "@gooddealer/protocol/devices";
import {
  drainManifestSchema,
  encodeDrainProofDigestInput,
  encodeDrainProofSignatureTranscript,
  type DrainManifest,
} from "@gooddealer/protocol/execution-events";

import type { TenantTransactionRunner } from "../../db/index";
import type { PostgresDeviceDrainTransition } from "./postgres-drain-transition";
import type { DeviceSwitchSubject, PostgresDeviceSwitchRequests } from "./postgres-switch-requests";

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const ED25519_SIGNATURE_BYTES = 64;

type RecordOutcome =
  | "recorded" | "replayed" | "PROOF_MALFORMED" | "PROOF_ID_CONFLICT" | "PROOF_EXPIRED"
  | "WORKFLOW_CONFLICT" | "SIGNING_KEY_CONFLICT" | "LEASE_CONFLICT";

/**
 * Accepts the source device's signed drain proof for its own normal switch (ADR-0032 S1c2).
 *
 * The proof must name this switch, workspace and session device, carry a valid Ed25519 signature
 * by the source's active ADR-0011 device key under the drain-proof signature domain, and pass the
 * owner routine `device_record_drain_proof`, which re-checks workflow, key, Lease and window. The
 * handoff transition then consumes it and seals all three streams against the immutable heads in
 * one transaction, so a short, gapped or diverging stream rolls the whole handoff back. A replay
 * after a successful handoff returns the switch as it now stands.
 */
export class PostgresDeviceSwitchDrain {
  constructor(private readonly dependencies: {
    readonly transactions: TenantTransactionRunner;
    readonly requests: Pick<PostgresDeviceSwitchRequests, "read">;
    readonly transition: Pick<PostgresDeviceDrainTransition, "commit">;
  }) {}

  async submit(subject: DeviceSwitchSubject, requestId: string, value: unknown): Promise<DeviceSwitchResponse | null> {
    const parsed = drainManifestSchema.safeParse(value);
    if (!parsed.success) return rejected("DRAIN_PROOF_INVALID");
    const proof = parsed.data;
    if (proof.deviceSwitchRequestId !== requestId || proof.workspaceId !== subject.workspaceId ||
      proof.sourceDeviceId !== subject.deviceId) {
      return rejected("DRAIN_PROOF_INVALID");
    }
    const scope = { accountId: subject.accountId, workspaceId: subject.workspaceId };
    const proofDigest = createHash("sha256").update(encodeDrainProofDigestInput(proof)).digest();

    const admitted = await this.dependencies.transactions.withTenant(scope, async (transaction) => {
      const key = await transaction.query<{ public_key: Buffer }>(
        `SELECT public_key FROM device_signing_keys
         WHERE account_id = $1 AND device_id = $2 AND key_id = $3 AND key_version = $4 AND status = 'active'`,
        [subject.accountId, subject.deviceId, proof.signingKeyId, proof.signingKeyVersion]);
      const publicKey = key.rows[0]?.public_key;
      if (publicKey === undefined || !verifyProofSignature(publicKey, proof)) return "SIGNATURE_INVALID" as const;
      const recorded = await transaction.query<{ outcome: RecordOutcome }>(
        `SELECT public.device_record_drain_proof(
           $1, $2, $3::smallint, $4, $5, $6, $7, $8, $9::timestamptz, $10::timestamptz,
           $11, $12, $13, $14, $15, $16) AS outcome`,
        [proof.proofId, proofDigest, proof.schemaVersion, requestId, subject.deviceId, proof.activeLeaseEpoch,
          proof.signingKeyId, proof.signingKeyVersion, proof.issuedAt, proof.expiresAt,
          ...streamArguments(proof)]);
      return recorded.rows[0]?.outcome ?? "PROOF_MALFORMED";
    });
    if (admitted === "PROOF_EXPIRED") return rejected("DRAIN_PROOF_EXPIRED");
    if (admitted === "WORKFLOW_CONFLICT" || admitted === "replayed") {
      // Either the switch already left `draining` (possibly through this very proof) or it is not
      // this device's open switch; the current view answers both without revealing more.
      const current = await this.dependencies.requests.read(subject, requestId);
      if (current === null || !current.accepted || current.request.status !== "draining") return current;
      if (admitted === "WORKFLOW_CONFLICT") return rejected("DRAIN_PROOF_INVALID");
    } else if (admitted !== "recorded") {
      return rejected("DRAIN_PROOF_INVALID");
    }

    const workflow = await this.dependencies.transactions.withTenant(scope, (transaction) =>
      transaction.query<{ workflow_revision: string; to_device_id: string }>(
        `SELECT workflow_revision, to_device_id FROM device_switch_workflows
         WHERE account_id = $1 AND workspace_id = $2 AND workflow_id = $3 AND from_device_id = $4 AND status = 'draining'`,
        [subject.accountId, subject.workspaceId, requestId, subject.deviceId]));
    const row = workflow.rows[0];
    // A concurrent submit of the same proof may have completed the handoff in between.
    if (row === undefined) return this.dependencies.requests.read(subject, requestId);
    const result = await this.dependencies.transition.commit({
      accountId: subject.accountId,
      workspaceId: subject.workspaceId,
      workflowId: requestId,
      expectedWorkflowRevision: Number(row.workflow_revision),
      targetDeviceId: row.to_device_id,
      proofId: proof.proofId,
      proofDigest: proofDigest.toString("base64url"),
      bootstrapCapabilityJti: `bootstrap-${randomUUID()}`,
    });
    if (result.status === "rejected") {
      if (result.reason === "STREAM_HEAD_CONFLICT") return rejected("DRAIN_STREAMS_INCOMPLETE");
      if (result.reason === "PROOF_EXPIRED" || result.reason === "WORKFLOW_EXPIRED") return rejected("DRAIN_PROOF_EXPIRED");
      return rejected("DRAIN_PROOF_INVALID");
    }
    return this.dependencies.requests.read(subject, requestId);
  }
}

function verifyProofSignature(publicKey: Buffer, proof: DrainManifest): boolean {
  const signature = Buffer.from(proof.deviceSignature, "base64url");
  if (publicKey.length !== 32 || signature.length !== ED25519_SIGNATURE_BYTES ||
    signature.toString("base64url") !== proof.deviceSignature) {
    return false;
  }
  try {
    const key = createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, publicKey]), format: "der", type: "spki" });
    return verifySignature(null, Buffer.from(encodeDrainProofSignatureTranscript(proof)), key, signature);
  } catch {
    return false;
  }
}

/** Sequence and rolling digest per stream, in the routine's fixed mutation, execution_fact, device_audit order. */
function streamArguments(proof: DrainManifest): (number | Buffer)[] {
  return proof.streams.flatMap((claim) => [claim.lastAssignedSequence, Buffer.from(claim.rollingDigest, "base64url")]);
}

function rejected(code: DeviceSwitchRejectionCode): DeviceSwitchResponse {
  return { schemaVersion: DEVICE_MANAGEMENT_SCHEMA_VERSION, accepted: false, code };
}
