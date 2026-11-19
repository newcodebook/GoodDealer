import { createHash, randomBytes } from "node:crypto";
import {
  deviceBootstrapClaimRequestSchema, deviceBootstrapClaimResponseSchema,
  deviceBootstrapStepRequestSchema, deviceBootstrapStepResponseSchema,
  deviceBootstrapCheckpointRequestSchema, deviceBootstrapCheckpointResponseSchema,
  deviceBootstrapActivationRequestSchema, deviceBootstrapActivationResponseSchema,
  deviceBootstrapReceiptRequestSchema, deviceBootstrapReceiptResponseSchema,
  bootstrapStepResultSchema, encodeBootstrapCapabilitySignedEnvelope,
  encodeBootstrapActivationRequestDigestInput,
  type DeviceBootstrapClaimResponse, type DeviceBootstrapStepResponse,
  type DeviceBootstrapCheckpointResponse, type DeviceBootstrapActivationResponse,
  type DeviceBootstrapReceiptResponse, type BootstrapCapabilityEnvelope,
} from "@gooddealer/protocol/devices";
import { encodeDomainSeparatedWireValue } from "@gooddealer/protocol/wire";
import type { AccountTransaction, IdentityCapabilityTransactionRunner, TenantTransaction } from "../../db/index";
import type { PublicPrincipal } from "../../entrypoints/ports/public-session";
import { PostgresIdentityAccountSecurityStatePort } from "../identity/index";
import { PostgresDeviceActivationEntitlementPort } from "../licensing/index";
import type { LockedDefaultWorkspaceAuthorityPort } from "../workspace/default-workspace/index";
import { PostgresWorkspaceRevisionRepository } from "../workspace/revisions/index";
import { PostgresBootstrapCheckpointPort, PostgresCheckpointRepository } from "../workspace/checkpoints/index";
import { PostgresBootstrapMutationPagePort, PostgresWorkspaceMutationRepository } from "../workspace/mutations/index";
import { PostgresBootstrapProjectionDigestPort, PostgresPortfolioRepository } from "../workspace/state/portfolio/index";
import { PostgresDeviceCursorRepository } from "../workspace/cursors/index";
import type { ActiveDeviceLeaseVerifier } from "./active-device-lease-verifier";
import { BootstrapCapabilityIssuer, type BootstrapCapabilitySigner } from "./bootstrap-capability-issuer";
import { BootstrapCapabilityVerifier, type BootstrapVerificationKeySource } from "./bootstrap-capability-verifier";
import { BootstrapRefusal, PostgresBootstrapStepService } from "./postgres-bootstrap-step-service";
import { ActivationRefusal, PostgresBootstrapActivation, type ActiveDeviceLeaseSigner } from "./postgres-bootstrap-activation";
import { canonicalSecond, isPostgresAuthorizationFailure, readCurrentIdentity } from "./desktop-authorization-readers";
import { bootstrapDeadlineIsLive } from "./bootstrap-deadline";
import { terminateDeviceBootstrap } from "./terminate-device-bootstrap";

type RejectionCode = "CAPABILITY_INVALID" | "BOOTSTRAP_CONFLICT" | "BOOTSTRAP_EXPIRED" | "CHECKPOINT_UNAVAILABLE" | "ENTITLEMENT_INACTIVE" | "SIGNING_UNAVAILABLE";
class InstallationRefusal extends Error { constructor(readonly code: RejectionCode) { super(code); } }
class InstallationSessionExpired extends Error {}
interface TargetContext { readonly transaction: TenantTransaction; readonly workflow: WorkflowRow; readonly securityEpoch: number; }
interface WorkflowRow { workflow_id: string; status: string; workflow_revision: string; to_device_id: string;
  bound_key_id: string; bound_key_version: string; bound_account_security_epoch: string; pending_lease_epoch: string | null; }
interface CapabilityRow { jti: string; target_device_id: string; issued_at: Date; expires_at: Date; consumed_at: Date | null;
  canonical_signed_envelope: Buffer | null; signed_envelope_digest: Buffer | null; ready_at: Date | null;
  claim_response: Buffer | null; claim_response_digest: Buffer | null; live: boolean; now: Date; }

/** One consumed account capability owns every checkpoint, nonce, activation and final session fence. */
export class PostgresTargetBootstrapInstallation {
  private readonly verifier: BootstrapCapabilityVerifier;
  private readonly issuer: BootstrapCapabilityIssuer;
  private readonly security = new PostgresIdentityAccountSecurityStatePort();
  private readonly entitlement = new PostgresDeviceActivationEntitlementPort();
  private readonly checkpoints: PostgresBootstrapCheckpointPort;
  private readonly steps: PostgresBootstrapStepService;
  private readonly activation: PostgresBootstrapActivation;
  constructor(private readonly dependencies: {
    readonly transactions: Pick<IdentityCapabilityTransactionRunner, "withAccountCredential">;
    readonly workspaces: LockedDefaultWorkspaceAuthorityPort;
    readonly capabilitySigner: BootstrapCapabilitySigner;
    readonly capabilityKeys: BootstrapVerificationKeySource;
    readonly leaseSigner: ActiveDeviceLeaseSigner;
    readonly leaseVerifier: ActiveDeviceLeaseVerifier;
    readonly fault?: (point: string) => void;
  }) {
    const revisions = new PostgresWorkspaceRevisionRepository();
    this.verifier = new BootstrapCapabilityVerifier(dependencies.capabilityKeys);
    this.issuer = new BootstrapCapabilityIssuer(dependencies.capabilitySigner);
    this.checkpoints = new PostgresBootstrapCheckpointPort(new PostgresCheckpointRepository(), {
      revisions, portfolio: new PostgresPortfolioRepository(), mutations: new PostgresWorkspaceMutationRepository(),
    });
    this.steps = new PostgresBootstrapStepService({verifier: this.verifier, accountSecurity: this.security, revisions,
      checkpoints: this.checkpoints, mutations: new PostgresBootstrapMutationPagePort(),
      projection: new PostgresBootstrapProjectionDigestPort({revisions}),
      ...(dependencies.fault === undefined ? {} : {fault: dependencies.fault})});
    this.activation = new PostgresBootstrapActivation({accountSecurity: this.security, entitlement: this.entitlement,
      signer: {async sign(input) {
        const signed = await dependencies.leaseSigner.sign(input);
        if (!signed.signed || dependencies.leaseVerifier.verify(signed.envelope) === null) return {signed:false};
        return signed;
      }}, checkpoints: this.checkpoints, cursors: new PostgresDeviceCursorRepository(),
      ...(dependencies.fault === undefined ? {} : {fault: dependencies.fault})});
  }

  async claim(value: unknown, principal: PublicPrincipal): Promise<DeviceBootstrapClaimResponse | null> {
    const request = deviceBootstrapClaimRequestSchema.parse(value);
    return this.execute(principal, request.requestId, async ({transaction, workflow, securityEpoch}) => {
      const row = await this.capability(transaction, workflow.workflow_id);
      this.assertLive(workflow, row);
      await this.assertReservedEpoch(transaction,workflow);
      if (row.claim_response !== null) {
        if (!await bootstrapDeadlineIsLive(transaction,request.requestId)) refuse("BOOTSTRAP_EXPIRED");
        if (row.claim_response_digest === null || !hash(row.claim_response).equals(row.claim_response_digest)) refuse("BOOTSTRAP_CONFLICT");
        return deviceBootstrapClaimResponseSchema.parse(json(row.claim_response));
      }
      if (row.ready_at !== null || workflow.pending_lease_epoch === null || row.target_device_id !== workflow.to_device_id) refuse("BOOTSTRAP_CONFLICT");
      if (await this.entitlement.lockCurrent(transaction) === null) refuse("ENTITLEMENT_INACTIVE");
      const signed = await this.issuer.issue({schemaVersion: 1, typ: "gd.bootstrap-capability.v1", iss: "https://accounts.gooddealer.com",
        aud: "gooddealer-desktop/bootstrap", accountId: transaction.scope.accountId, deviceId: workflow.to_device_id,
        accountSecurityEpoch: securityEpoch, jti: row.jti, issuedAt: canonicalSecond(row.issued_at), expiresAt: canonicalSecond(row.expires_at),
        payload: {deviceSwitchRequestId: workflow.workflow_id}});
      if (signed === null) refuse("SIGNING_UNAVAILABLE");
      // A signer-returned public key proves mathematics, not configured trust. Admit the
      // result through the independently provisioned purpose-specific verification registry.
      const admitted = await this.verifier.verify(signed.capability, {accountId:transaction.scope.accountId,
        deviceId:workflow.to_device_id,accountSecurityEpoch:securityEpoch,jti:row.jti,
        deviceSwitchRequestId:workflow.workflow_id,issuedAt:canonicalSecond(row.issued_at),
        expiresAt:canonicalSecond(row.expires_at),evaluatedAt:canonicalSecond(row.now)});
      if (!admitted.accepted) refuse("SIGNING_UNAVAILABLE");
      const stepNonce = randomBytes(32).toString("base64url");
      const response = deviceBootstrapClaimResponseSchema.parse({schemaVersion: 1, accepted: true, claim: {
        requestId: request.requestId, stepSchemaVersion: 2, capability: signed.capability,
        pendingLeaseEpoch: integer(workflow.pending_lease_epoch), workflowRevision: integer(workflow.workflow_revision),
        nextStep: {stepNumber: 1, stepKind: "pin_checkpoint", stepNonce}}});
      const wire = bytes(response);
      const envelope = Buffer.from(encodeBootstrapCapabilitySignedEnvelope(signed.capability));
      await transaction.query(`UPDATE device_bootstrap_capabilities SET canonical_signed_envelope=$4, signed_envelope_digest=$5,
        signing_key_id=$6, ready_at=clock_timestamp(), claim_response=$7, claim_response_digest=$8, signer_receipt_digest=$9
        WHERE account_id=$1 AND workspace_id=$2 AND workflow_id=$3 AND ready_at IS NULL`,
        [...scope(transaction, request.requestId), envelope, hash(envelope), signed.capability.kid, wire, hash(wire), Buffer.from(signed.receiptDigest,"hex")]);
      const nonceDigest = hash(encodeDomainSeparatedWireValue("GOODDEALER-BOOTSTRAP-STEP-NONCE-V2",stepNonce));
      await transaction.query(`INSERT INTO device_bootstrap_authorities
        (account_id,workspace_id,workflow_id,capability_jti,target_device_id,account_security_epoch,pending_lease_epoch,
         next_step_number,next_step_kind,next_nonce_digest,row_version) VALUES($1,$2,$3,$4,$5,$6,$7,1,'pin_checkpoint',$8,1)`,
        [...scope(transaction,request.requestId),row.jti,workflow.to_device_id,securityEpoch,integer(workflow.pending_lease_epoch),nonceDigest]);
      await transaction.query(`INSERT INTO device_bootstrap_step_nonces (nonce_digest,account_id,workspace_id,workflow_id,step_number,state)
        VALUES($1,$2,$3,$4,1,'active')`,[nonceDigest,...scope(transaction,request.requestId)]);
      this.dependencies.fault?.("after_claim_persisted");
      if (!await bootstrapDeadlineIsLive(transaction,request.requestId)) refuse("BOOTSTRAP_EXPIRED");
      return response;
    });
  }

  async step(value: unknown, principal: PublicPrincipal): Promise<DeviceBootstrapStepResponse | null> {
    const request = deviceBootstrapStepRequestSchema.parse(value);
    return this.execute(principal,request.step.deviceSwitchRequestId,async ({transaction,workflow,securityEpoch}) => {
      const presentation = await this.verifyCapability(transaction,workflow,securityEpoch,request.capability);
      const result = await this.steps.executeVerifiedLocked(transaction,presentation,request.step);
      if (!result.accepted) return rejection(result.code);
      return deviceBootstrapStepResponseSchema.parse({schemaVersion:1,accepted:true,result:result.result});
    });
  }

  async checkpoint(value: unknown, principal: PublicPrincipal): Promise<DeviceBootstrapCheckpointResponse | null> {
    const request = deviceBootstrapCheckpointRequestSchema.parse(value);
    return this.execute(principal,request.requestId,async ({transaction,workflow,securityEpoch}) => {
      await this.verifyCapability(transaction,workflow,securityEpoch,request.capability);
      const authority = await transaction.query<{pinned_checkpoint_id:string|null;pinned_checkpoint_digest:Buffer|null}>(
        `SELECT pinned_checkpoint_id,pinned_checkpoint_digest FROM device_bootstrap_authorities
         WHERE account_id=$1 AND workspace_id=$2 AND workflow_id=$3 FOR UPDATE`,scope(transaction,request.requestId));
      const row = authority.rows[0];
      if (row?.pinned_checkpoint_id !== request.checkpointId || row.pinned_checkpoint_digest?.toString("base64url") !== request.checkpointDigest)
        refuse("CHECKPOINT_UNAVAILABLE");
      if (!await bootstrapDeadlineIsLive(transaction,request.requestId)) refuse("BOOTSTRAP_EXPIRED");
      const page = await this.checkpoints.readBootstrapPageLocked(transaction,request);
      if (page === null) refuse("CHECKPOINT_UNAVAILABLE");
      if (!await bootstrapDeadlineIsLive(transaction,request.requestId)) refuse("BOOTSTRAP_EXPIRED");
      return deviceBootstrapCheckpointResponseSchema.parse({schemaVersion:1,accepted:true,page});
    });
  }

  async activate(value: unknown, principal: PublicPrincipal): Promise<DeviceBootstrapActivationResponse | null> {
    const request = deviceBootstrapActivationRequestSchema.parse(value);
    const capabilityDigest = hash(encodeBootstrapCapabilitySignedEnvelope(request.capability)).toString("base64url");
    if (hash(encodeBootstrapActivationRequestDigestInput(request,capabilityDigest)).toString("base64url") !== request.requestDigest)
      return rejection("BOOTSTRAP_CONFLICT");
    return this.execute(principal,request.requestId,async ({transaction,workflow,securityEpoch}) => {
      const original = await transaction.query<{canonical_request:Buffer|null;canonical_response:Buffer|null}>(
        `SELECT canonical_request,canonical_response FROM device_bootstrap_activation_attempts
         WHERE account_id=$1 AND workspace_id=$2 AND workflow_id=$3 AND attempt_id=$4 FOR UPDATE`,[...scope(transaction,request.requestId),request.activationId]);
      if (original.rows[0] !== undefined) {
        if (!original.rows[0].canonical_request?.equals(bytes(request)) || original.rows[0].canonical_response === null) refuse("BOOTSTRAP_CONFLICT");
        return deviceBootstrapActivationResponseSchema.parse(json(original.rows[0].canonical_response));
      }
      await this.verifyCapability(transaction,workflow,securityEpoch,request.capability);
      const authority = await transaction.query<{pending_lease_epoch:string;target_server_revision:string|null;target_schema_version:string|null;verified_rebuild_digest:Buffer|null}>(
        `SELECT pending_lease_epoch,target_server_revision,target_schema_version,verified_rebuild_digest FROM device_bootstrap_authorities
         WHERE account_id=$1 AND workspace_id=$2 AND workflow_id=$3 FOR UPDATE`,scope(transaction,request.requestId));
      const row = authority.rows[0];
      if (row === undefined || integer(row.pending_lease_epoch) !== request.pendingLeaseEpoch || row.target_server_revision === null ||
        integer(row.target_server_revision) !== request.targetServerRevision || row.target_schema_version === null ||
        integer(row.target_schema_version) !== request.workspaceSchemaVersion || row.verified_rebuild_digest?.toString("base64url") !== request.verifiedRebuildDigest)
        refuse("BOOTSTRAP_CONFLICT");
      const result = await this.activation.activateLocked(transaction,{workflowId:request.requestId,
        expectedWorkflowRevision:request.expectedWorkflowRevision,activationId:request.activationId});
      if (!result.installed) refuse(result.code === "LEASE_SIGNING_DISABLED" ? "SIGNING_UNAVAILABLE" : "BOOTSTRAP_CONFLICT");
      const response = deviceBootstrapActivationResponseSchema.parse({schemaVersion:1,accepted:true,receipt:{
        requestId:request.requestId,activationId:request.activationId,requestDigest:request.requestDigest,
        workflowRevision:request.expectedWorkflowRevision+1,status:"completed",pendingLeaseEpoch:request.pendingLeaseEpoch,
        targetServerRevision:request.targetServerRevision,workspaceSchemaVersion:request.workspaceSchemaVersion,
        verifiedRebuildDigest:request.verifiedRebuildDigest,cursorGeneration:result.cursorGeneration,lease:result.lease}});
      await transaction.query(`UPDATE device_bootstrap_activation_attempts SET request_digest=$5,canonical_request=$6,canonical_response=$7
        WHERE account_id=$1 AND workspace_id=$2 AND workflow_id=$3 AND attempt_id=$4`,
        [...scope(transaction,request.requestId),request.activationId,Buffer.from(request.requestDigest,"base64url"),bytes(request),bytes(response)]);
      this.dependencies.fault?.("after_activation_receipt_persisted");
      return response;
    });
  }

  async receipt(value: unknown, principal: PublicPrincipal): Promise<DeviceBootstrapReceiptResponse | null> {
    const request = deviceBootstrapReceiptRequestSchema.parse(value);
    return this.withTarget(principal,request.requestId,async ({transaction,workflow}) => {
      // Expired authority is reconciled before exposing a retry decision. Historical receipts do not revive it.
      if (workflow.status === "bootstrapping") {
        const deadline = await transaction.query<{live:boolean}>(`SELECT clock_timestamp()<least(w.state_deadline,c.expires_at,coalesce(a.pin_expires_at,c.expires_at)) AS live
          FROM device_switch_workflows w JOIN device_bootstrap_capabilities c USING(account_id,workspace_id,workflow_id)
          LEFT JOIN device_bootstrap_authorities a USING(account_id,workspace_id,workflow_id)
          WHERE w.account_id=$1 AND w.workspace_id=$2 AND w.workflow_id=$3`,scope(transaction,request.requestId));
        if (deadline.rows[0]?.live !== true) {
          await terminateDeviceBootstrap(transaction,this.checkpoints,request.requestId,"expired");
          const updated = await transaction.query<WorkflowRow>(`SELECT * FROM device_switch_workflows WHERE account_id=$1 AND workspace_id=$2 AND workflow_id=$3`,scope(transaction,request.requestId));
          if (updated.rows[0] === undefined) throw new TypeError("terminated bootstrap history missing");
          workflow = updated.rows[0];
        }
      }
      const view = {requestId:request.requestId,status:workflow.status,workflowRevision:integer(workflow.workflow_revision)};
      const operation = request.operation;
      let committed: unknown = null;
      if (operation.kind === "claim") {
        const row = await this.capability(transaction,request.requestId);
        if (row.claim_response !== null) {
          if (row.claim_response_digest === null || !hash(row.claim_response).equals(row.claim_response_digest)) throw new TypeError("claim receipt corrupted");
          const response = deviceBootstrapClaimResponseSchema.parse(json(row.claim_response));
          if (!response.accepted) throw new TypeError("claim receipt is a rejection");
          committed = {kind:"claim",claim:response.claim};
        }
      } else if (operation.kind === "step") {
        const stored = await transaction.query<{request_digest:Buffer;canonical_request:Buffer|null;canonical_result:Buffer}>(
          `SELECT request_digest,canonical_request,canonical_result FROM device_bootstrap_steps
           WHERE account_id=$1 AND workspace_id=$2 AND workflow_id=$3 AND step_number=$4`,[...scope(transaction,request.requestId),operation.stepNumber]);
        const row = stored.rows[0];
        if (row !== undefined) {
          if (row.request_digest.toString("base64url") !== operation.requestDigest || row.canonical_request === null || hash(row.canonical_request).toString("base64url") !== operation.replayDigest)
            return {schemaVersion:1,outcome:"conflict"};
          committed = {...operation,result:bootstrapStepResultSchema.parse(json(row.canonical_result))};
        }
      } else {
        const stored = await transaction.query<{request_digest:Buffer|null;canonical_response:Buffer|null}>(
          `SELECT request_digest,canonical_response FROM device_bootstrap_activation_attempts
           WHERE account_id=$1 AND workspace_id=$2 AND workflow_id=$3 AND attempt_id=$4`,[...scope(transaction,request.requestId),operation.activationId]);
        const row = stored.rows[0];
        if (row !== undefined) {
          if (row.request_digest?.toString("base64url") !== operation.requestDigest || row.canonical_response === null) return {schemaVersion:1,outcome:"conflict"};
          const response = deviceBootstrapActivationResponseSchema.parse(json(row.canonical_response));
          if (!response.accepted) throw new TypeError("activation receipt is a rejection");
          committed = {...operation,receipt:response.receipt};
        }
      }
      if (committed !== null) return deviceBootstrapReceiptResponseSchema.parse({schemaVersion:1,outcome:"committed",workflow:view,operation:committed});
      if (workflow.status !== "bootstrapping") return deviceBootstrapReceiptResponseSchema.parse({schemaVersion:1,outcome:"terminal",workflow:view,operation});
      const authority = await transaction.query<{next_step_number:string;next_step_kind:string|null}>(`SELECT next_step_number,next_step_kind FROM device_bootstrap_authorities
        WHERE account_id=$1 AND workspace_id=$2 AND workflow_id=$3`,scope(transaction,request.requestId));
      const next = authority.rows[0];
      return deviceBootstrapReceiptResponseSchema.parse({schemaVersion:1,outcome:"uncommitted",workflow:view,operation,
        nextStep:next === undefined || next.next_step_kind === null ? null : {stepNumber:integer(next.next_step_number),stepKind:next.next_step_kind}});
    },{schemaVersion:1,outcome:"not_found"});
  }

  private async capability(transaction: TenantTransaction, requestId: string): Promise<CapabilityRow> {
    const result = await transaction.query<CapabilityRow>(`SELECT *,clock_timestamp() AS now,
      clock_timestamp()>=issued_at AND clock_timestamp()<expires_at AS live FROM device_bootstrap_capabilities
      WHERE account_id=$1 AND workspace_id=$2 AND workflow_id=$3 FOR UPDATE`,scope(transaction,requestId));
    if (result.rows[0] === undefined) refuse("CAPABILITY_INVALID");
    return result.rows[0];
  }
  private async assertReservedEpoch(transaction:TenantTransaction,workflow:WorkflowRow):Promise<void> {
    const result=await transaction.query(`SELECT 1 FROM device_lease_epoch_allocations a JOIN device_account_states s USING(account_id)
      WHERE a.account_id=$1 AND a.workspace_id=$2 AND a.workflow_id=$3 AND a.lease_epoch=$4
        AND a.status='pending' AND s.highest_allocated_lease_epoch=a.lease_epoch AND s.current_lease_epoch<a.lease_epoch FOR UPDATE OF a,s`,
      [...scope(transaction,workflow.workflow_id),workflow.pending_lease_epoch]);
    if(result.rows.length!==1)refuse("BOOTSTRAP_CONFLICT");
  }
  private assertLive(workflow: WorkflowRow, row: CapabilityRow): void {
    if (workflow.status !== "bootstrapping" || row.consumed_at !== null) refuse("BOOTSTRAP_CONFLICT");
    if (!row.live) refuse("BOOTSTRAP_EXPIRED");
  }
  private async verifyCapability(transaction: TenantTransaction, workflow: WorkflowRow, securityEpoch: number, capability: BootstrapCapabilityEnvelope) {
    const row = await this.capability(transaction,workflow.workflow_id);
    this.assertLive(workflow,row);
    await this.assertReservedEpoch(transaction,workflow);
    const result = await this.verifier.verify(capability,{accountId:transaction.scope.accountId,deviceId:workflow.to_device_id,
      accountSecurityEpoch:securityEpoch,jti:row.jti,deviceSwitchRequestId:workflow.workflow_id,
      issuedAt:canonicalSecond(row.issued_at),expiresAt:canonicalSecond(row.expires_at),evaluatedAt:canonicalSecond(row.now)});
    if (!result.accepted || row.ready_at === null || row.canonical_signed_envelope === null ||
      !row.canonical_signed_envelope.equals(Buffer.from(result.presentation.canonicalSignedEnvelope)) ||
      row.signed_envelope_digest === null || !row.signed_envelope_digest.equals(Buffer.from(result.presentation.signedEnvelopeDigest))) refuse("CAPABILITY_INVALID");
    return result.presentation;
  }

  private async execute<T>(principal:PublicPrincipal,requestId:string,work:(context:TargetContext)=>Promise<T>) {
    try { return await this.withTarget(principal,requestId,work,rejection("BOOTSTRAP_CONFLICT"),true); }
    catch(error) {
      if (error instanceof InstallationRefusal) return rejection(error.code);
      if (error instanceof BootstrapRefusal || error instanceof ActivationRefusal) return rejection("BOOTSTRAP_CONFLICT");
      throw error;
    }
  }
  private async withTarget<T, Missing>(principal:PublicPrincipal,requestId:string,work:(context:TargetContext)=>Promise<T>,missing:Missing,enforceDeadline=false):Promise<T|Missing|null> {
    if (principal.clientKind !== "desktop" || principal.transactionCredential === undefined) return null;
    try {
      return await this.dependencies.transactions.withAccountCredential(principal.transactionCredential,"devices_account",async(accountTransaction:AccountTransaction) => {
        // The writer lock precedes shared identity reads, avoiding lock upgrades during concurrent target requests.
        await accountTransaction.query("SELECT 1 FROM identity_account_security_states WHERE account_id=$1 FOR UPDATE",[principal.accountId]);
        const identity = await readCurrentIdentity(accountTransaction,principal);
        if (identity === null || accountTransaction.accountId !== principal.accountId) return null;
        const workspace = await this.dependencies.workspaces.resolveLocked(accountTransaction);
        if (workspace === null || workspace.accountId !== principal.accountId) return null;
        await accountTransaction.query("SELECT set_config('gooddealer.workspace_id',$1,true)",[workspace.workspaceId]);
        const transaction:TenantTransaction = {scope:workspace,query:accountTransaction.query.bind(accountTransaction)};
        await transaction.query("SELECT 1 FROM device_account_states WHERE account_id=$1 FOR UPDATE",[principal.accountId]);
        const binding = await transaction.query<{key_id:string;key_version:string}>(`SELECT k.key_id,k.key_version FROM device_bindings b JOIN device_signing_keys k USING(account_id,device_id)
          WHERE b.account_id=$1 AND b.device_id=$2 AND b.status='bound' AND k.status='active' FOR UPDATE OF b,k`,[principal.accountId,identity.deviceId]);
        if (binding.rows.length !== 1) return null;
        const found = await transaction.query<WorkflowRow>(`SELECT * FROM device_switch_workflows
          WHERE account_id=$1 AND workspace_id=$2 AND workflow_id=$3 AND to_device_id=$4
            AND status IN ('bootstrapping','completed','cancelled','failed')
            AND EXISTS (SELECT 1 FROM device_bootstrap_capabilities c WHERE c.account_id=device_switch_workflows.account_id
              AND c.workspace_id=device_switch_workflows.workspace_id AND c.workflow_id=device_switch_workflows.workflow_id) FOR UPDATE`,[...scope(transaction,requestId),identity.deviceId]);
        const workflow = found.rows[0];
        if (workflow === undefined) return missing;
        if (workflow.bound_key_id !== binding.rows[0]?.key_id || workflow.bound_key_version !== binding.rows[0]?.key_version ||
          integer(workflow.bound_account_security_epoch) !== identity.accountSecurityEpoch) return null;
        const result = await work({transaction,workflow,securityEpoch:identity.accountSecurityEpoch});
        this.dependencies.fault?.("before_installation_commit");
        if(enforceDeadline && workflow.status === "bootstrapping" && !await bootstrapDeadlineIsLive(transaction,requestId)) refuse("BOOTSTRAP_EXPIRED");
        const after = await readCurrentIdentity(accountTransaction,principal);
        const live = await transaction.query<{device:string|null}>("SELECT identity_private.current_execution_context_device() AS device");
        if (after === null || after.deviceId !== identity.deviceId || after.accountSecurityEpoch !== identity.accountSecurityEpoch ||
          live.rows[0]?.device !== identity.deviceId) throw new InstallationSessionExpired();
        return result;
      });
    } catch(error) { if (error instanceof InstallationSessionExpired || isPostgresAuthorizationFailure(error)) return null; throw error; }
  }
}
function refuse(code:RejectionCode):never { throw new InstallationRefusal(code); }
function rejection(code:RejectionCode) { return {schemaVersion:1 as const,accepted:false as const,code}; }
function scope(transaction:TenantTransaction,requestId:string) { return [transaction.scope.accountId,transaction.scope.workspaceId,requestId]; }
function hash(value:Uint8Array):Buffer { return createHash("sha256").update(value).digest(); }
function bytes(value:unknown):Buffer { return Buffer.from(JSON.stringify(value),"utf8"); }
function json(value:Buffer):unknown { return JSON.parse(value.toString("utf8")); }
function integer(value:string):number { const parsed=Number(value); if(!/^(?:0|[1-9][0-9]*)$/u.test(value)||!Number.isSafeInteger(parsed)) throw new TypeError("invalid stored bootstrap integer"); return parsed; }
