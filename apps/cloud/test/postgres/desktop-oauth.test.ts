import { leaseIssuedOfflineHighWaterMigration } from "../../src/modules/devices/migrations/202611190026-lease-issued-offline-high-water";
import { encodeAfternicListingWriteItemApprovalSignatureTranscript, encodeAfternicListingWriteItemApprovalEnvelope, encodeAfternicListingWriteItemApprovalJson } from "@gooddealer/protocol/execution-events";
import { submittedSyncMutationSchema, computeWorkspaceCheckpointEntityDigests, encodeCheckpointEntityDigestsInput } from "@gooddealer/protocol/workspace";
import { PostgresWorkspaceMutationRepository } from "../../src/modules/workspace/mutations/index";
import { PostgresPortfolioRepository } from "../../src/modules/workspace/state/portfolio/index";
import { PostgresCheckpointRepository } from "../../src/modules/workspace/checkpoints/index";
import { PostgresForcedTakeover, PostgresTargetBootstrapInstallation, TrustedBootstrapVerificationKeySource } from "../../src/modules/devices/index";
import { deviceBootstrapActivationRequestSchema, encodeBootstrapActivationRequestDigestInput, encodeBootstrapStepReplayRequest, encodeBootstrapCheckpointPageDigestInput, type DeviceBootstrapClaim } from "@gooddealer/protocol/devices";
import { PostgresBootstrapActivation } from "../../src/modules/devices/postgres-bootstrap-activation";
import { PostgresDeviceCursorRepository } from "../../src/modules/workspace/cursors/index";
import { PostgresWorkspaceRevisionRepository } from "../../src/modules/workspace/revisions/index";
import { PostgresBootstrapStepService } from "../../src/modules/devices/postgres-bootstrap-step-service";
import { BootstrapCapabilityVerifier, BOOTSTRAP_CAPABILITY_KEY_PURPOSE } from "../../src/modules/devices/bootstrap-capability-verifier";
import { bootstrapStepRequestSchema, encodeBootstrapStepRequestDigestInput, encodeBootstrapCapabilitySignatureTranscript, encodeBootstrapCapabilitySignedEnvelope } from "@gooddealer/protocol/devices";
import { PostgresDeviceSwitchDrain, PostgresDeviceDrainTransition } from "../../src/modules/devices/index";
import { PostgresMutationDrainLedger } from "../../src/modules/workspace/mutations/index";
import { PostgresExecutionFactDrainLedger } from "../../src/modules/execution-ledger/index";
import { PostgresWorkspaceDeviceAuditDrainLedger } from "../../src/modules/audit/index";
import { signedHandoffDrainProof } from "../support/drain-proof";
import { DRAIN_STREAM_GENESIS_DIGEST } from "@gooddealer/protocol/execution-events";
import { PostgresTargetBootstrapControl } from "../../src/modules/devices/postgres-target-bootstrap-control";
import { PostgresDeviceSwitchRequestResolution } from "../../src/modules/devices/postgres-switch-request-resolution";
import { PostgresExecutionEvidenceAuthority } from "../../src/modules/devices/execution-evidence-authority";
import { PostgresDeviceAuditEvidenceReader, PostgresDeviceAuditEvidenceService } from "../../src/modules/audit/index";
import { PostgresExecutionFactEvidenceReader, PostgresExecutionFactEvidenceService } from "../../src/modules/execution-ledger/index";
import { encodeAfternicLocalDispatchKeyDigestInput,encodeAfternicDelistItemApprovalSignatureTranscript,encodeAfternicDelistItemApprovalEnvelope,encodeAfternicDelistItemApprovalJson,encodeDeviceAuditEventSignatureTranscript,encodeDeviceAuditEventHashInput,encodeExecutionFactSignatureTranscript,encodeWorkspaceDeviceAuditChainDomain,encodeDrainStreamEnvelope,deviceAuditIngestRequestSchema,executionFactIngestRequestSchema } from "@gooddealer/protocol/execution-events";
import { PostgresHistoricalExecutionContext } from "../../src/modules/devices/historical-execution-context";
import { readFileSync } from "node:fs";
import { DesktopExecutionContextIssuer, type DesktopExecutionContextSigner } from "../../src/modules/devices/execution-context-issuer";
import { PostgresDesktopExecutionContextService } from "../../src/modules/devices/postgres-execution-context";
import { encodeDesktopExecutionContextSignatureTranscript, encodeDesktopExecutionAuthorizationDigestInput, encodeDesktopExecutionContextEnvelope } from "@gooddealer/protocol/devices";
import { PostgresDesktopSyncAuthority, PostgresDesktopRouteAuthority } from "../../src/modules/devices/postgres-sync-authority";
import { DesktopStandbyGrantIssuer, type DesktopStandbyGrantSigner } from "../../src/modules/devices/standby-grant-issuer";
import { standbyGrantSigner } from "../support/standby-grant";
import { createHash, generateKeyPairSync, sign, verify } from "node:crypto";

import {
  activeDeviceLeaseEnvelopeSchema,
  encodeActiveDeviceLeaseSignatureTranscript,
  encodeDesktopAuthorizationGrantSignatureTranscript,
} from "@gooddealer/protocol/devices";
import { encodeDomainSeparatedWireValue } from "@gooddealer/protocol/wire";

import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  AccountTransactionRunner,
  type AccountTransaction,
  TenantTransactionRunner,
  IdentityCapabilityTransactionRunner,
  PreAuthEmailTransactionRunner,
  runCloudMigrations,
} from "../../src/db/index";
import { cloudMigrations } from "../../src/db/migrations";
import {
  PostgresDeviceLoginProof,
  desktopDeviceProofTranscript,
} from "../../src/modules/devices/postgres-device-login-proof";
import type { ActiveDeviceLeaseSigner } from "../../src/modules/devices/postgres-bootstrap-activation";
import { TrustedActiveDeviceLeaseVerifier } from "../../src/modules/devices/active-device-lease-verifier";
import {
  DesktopAuthorizationGrantIssuer,
  type DesktopAuthorizationGrantSigner,
} from "../../src/modules/devices/authorization-grant-issuer";
import { PostgresDesktopAuthorizationApplicationService } from "../../src/modules/devices/postgres-desktop-authorization";
import { PostgresExpiredDeviceBootstrap } from "../../src/modules/devices/postgres-expired-device-bootstrap";
import { PostgresBootstrapCheckpointPort } from "../../src/modules/workspace/checkpoints/index";
import { PostgresDeviceSwitchRequests } from "../../src/modules/devices/index";
import { PostgresIdentityAccountSecurityStatePort } from "../../src/modules/identity/index";
import { PostgresDesktopLoginLease } from "../../src/modules/devices/postgres-desktop-login-lease";
import {
  PostgresEntitlementDeadlineReader,
} from "../../src/modules/licensing/postgres-repository";
import {
  DESKTOP_OAUTH_CLIENT_ID,
  DesktopTokenRefreshService,
  PostgresDesktopOAuthAuthorizationService,
  PostgresIdentityAuthenticationRepository,
} from "../../src/modules/identity/index";
import { PostgresIdentitySessionVerificationReader } from "../../src/modules/identity/postgres-session-verification-reader";
import { PostgresDefaultWorkspaceTenantResolver } from "../../src/modules/workspace/default-workspace/index";
import { clearLicensingTestData } from "../support/postgres-fixture";

const LOOPBACK_REDIRECT_URI = "http://127.0.0.1:53682/oauth/callback";

const ownerPool = new Pool({ connectionString: requiredEnvironment("GOODDEALER_POSTGRES_OWNER_URL"), max: 3 });
const appPool = new Pool({ connectionString: requiredEnvironment("GOODDEALER_POSTGRES_APP_URL"), max: 6 });
const accountApiPool = new Pool({ connectionString: requiredEnvironment("GOODDEALER_POSTGRES_ACCOUNT_API_URL"), max: 3 });
const issuerPool = new Pool({ connectionString: requiredEnvironment("GOODDEALER_POSTGRES_IDENTITY_ISSUER_URL"), max: 2 });
const transactions = new AccountTransactionRunner(appPool);
const identityTransactions = new IdentityCapabilityTransactionRunner(accountApiPool, issuerPool);
const authentication = new PostgresIdentityAuthenticationRepository(
  new PreAuthEmailTransactionRunner(appPool),
  transactions,
);
const leaseAuthority = generateKeyPairSync("ed25519");
const grantAuthority = generateKeyPairSync("ed25519");
const leaseSigner: ActiveDeviceLeaseSigner = {
  async sign(input) {
    const unsigned = {
      ...input.claims,
      kid: "test-active-device-lease-v1",
      signature: Buffer.alloc(64).toString("base64url"),
    };
    const signature = sign(
      null,
      encodeActiveDeviceLeaseSignatureTranscript(unsigned),
      leaseAuthority.privateKey,
    ).toString("base64url");
    return {
      signed: true,
      envelope: { ...unsigned, signature },
      verificationKey: leaseAuthority.publicKey,
      receipt: Buffer.from("test-lease-signing-receipt"),
    };
  },
};
const leaseVerifier = new TrustedActiveDeviceLeaseVerifier([{
  kid: "test-active-device-lease-v1",
  publicKey: leaseAuthority.publicKey,
}]);
const grantSigner: DesktopAuthorizationGrantSigner = {
  async sign(input) {
    const draft = { ...input.claims, kid: "test-desktop-grant-v3", signature: "placeholder" };
    return {
      signed: true,
      envelope: {
        ...draft,
        signature: sign(
          null,
          encodeDesktopAuthorizationGrantSignatureTranscript(draft),
          grantAuthority.privateKey,
        ).toString("base64url"),
      },
      verificationKey: grantAuthority.publicKey,
      receipt: Buffer.from("test-grant-signing-receipt"),
    };
  },
};
const bootstrapExpiry = new PostgresExpiredDeviceBootstrap({
  workspaces: new PostgresDefaultWorkspaceTenantResolver(transactions),
  checkpoints: new PostgresBootstrapCheckpointPort(),
});
const leaseManager = new PostgresDesktopLoginLease({
  transactions,
  entitlement: new PostgresEntitlementDeadlineReader(identityTransactions),
  signer: leaseSigner,
  verifier: leaseVerifier,
  bootstrapExpiry,
});
const oauth = new PostgresDesktopOAuthAuthorizationService(
  transactions,
  authentication,
  new PostgresDeviceLoginProof(transactions),
  leaseManager,
  identityTransactions,
);
const refresh = new DesktopTokenRefreshService(authentication, leaseManager);
const principal = {
  accountId: "oauth-account",
  sessionId: "web-session-live",
  clientKind: "account_web" as const,
  transactionCredential: new TextEncoder().encode("web-session-live"),
};
const verifier = "V".repeat(64);
const challenge = createHash("sha256").update(verifier, "ascii").digest("base64url");
const deviceKeyPair = generateKeyPairSync("ed25519");
const otherDeviceKeyPair = generateKeyPairSync("ed25519");
const devicePublicKey = (deviceKeyPair.publicKey.export({ format: "der", type: "spki" }) as Buffer).subarray(-32);

beforeAll(async () => {
  await runCloudMigrations(ownerPool, cloudMigrations);
});

beforeEach(async () => {
  await clearLicensingTestData(ownerPool);
  await ownerPool.query("TRUNCATE workspace_device_audit_drain_records,workspace_device_audit_drain_heads,workspace_device_audit_drain_seals,audit_execution_evidence_quarantines,execution_fact_drain_records,execution_fact_drain_heads,execution_fact_drain_seals,execution_fact_evidence_quarantines CASCADE");
  await ownerPool.query("TRUNCATE workspace_device_cursors CASCADE");
  await ownerPool.query("TRUNCATE mutation_drain_records, mutation_drain_heads, mutation_drain_seals, workspace_mutations, workspace_mutation_receipts CASCADE");
  await ownerPool.query("DELETE FROM workspace_revisions WHERE account_id = 'oauth-account'");
  await ownerPool.query(`TRUNCATE workspace_account_bindings, workspace_workspaces,
    identity_desktop_authorization_codes, identity_credential_jtis,
    identity_refresh_families, identity_auth_sessions, device_signing_keys, device_bindings,
    device_login_challenges, device_account_states, identity_account_security_states CASCADE`);
  await ownerPool.query("DELETE FROM identity_accounts");
  await ownerPool.query(
    `INSERT INTO identity_accounts
       (account_id, email_normalized, email_verified_at, password_policy_id, password_hash_phc)
     VALUES ('oauth-account', 'oauth@example.com', transaction_timestamp(), 'argon2id-v1', $1)`,
    ["$argon2id$v=19$m=19456,t=2,p=1$".padEnd(96, "A")],
  );
  await ownerPool.query(
    `INSERT INTO identity_account_security_states (account_id) VALUES ('oauth-account');
     INSERT INTO identity_auth_sessions
       (account_id, session_id, client_kind, auth_method, remember_device, epoch_at_issue, expires_at)
     VALUES ('oauth-account', 'web-session-live', 'account_web', 'password', true, 1,
       transaction_timestamp() + interval '1 hour');
     INSERT INTO identity_refresh_families
       (account_id, family_id, session_id, current_refresh_jti)
     VALUES ('oauth-account', 'web-family', 'web-session-live', 'web-refresh-jti');
     INSERT INTO workspace_workspaces (workspace_id, account_id, kind, name)
     VALUES ('oauth-workspace', 'oauth-account', 'personal', 'OAuth workspace');
     INSERT INTO workspace_account_bindings
       (account_id, workspace_id, owner_kind, role, is_default)
     VALUES ('oauth-account', 'oauth-workspace', 'account', 'default_owner', true);
     INSERT INTO device_account_states (account_id) VALUES ('oauth-account');
     INSERT INTO device_bindings
       (account_id, device_id, slot, status, credential_epoch)
     VALUES ('oauth-account', 'device-a', 1, 'bound', 1)`,
  );
  await applyEntitlementState("active", "desktop-oauth-entitlement-initial", 1);
  await ownerPool.query(
    `INSERT INTO device_signing_keys
       (account_id, device_id, key_version, key_id, public_key, fingerprint, status)
     VALUES ('oauth-account', 'device-a', 1, 'device-key-a', $1, $2, 'active')`,
    [devicePublicKey, createHash("sha256").update(devicePublicKey).digest()],
  );
});

afterAll(async () => Promise.all([
  ownerPool.end(), appPool.end(), accountApiPool.end(), issuerPool.end(),
]));

describe("PostgreSQL target bootstrap termination", () => {
  const lookup = { schemaVersion: 1, requestId: "switch-guard" };
  const control = (checkpoints = new PostgresBootstrapCheckpointPort()) => new PostgresTargetBootstrapControl(
    identityTransactions, new PostgresDefaultWorkspaceTenantResolver(identityTransactions), checkpoints,
  );
  async function fixture(withPin = true) {
    const source = await desktopGrantPrincipal();
    const target = await loginStandbyDevice();
    await seedExpiredBootstrap(withPin);
    await ownerPool.query("UPDATE device_bootstrap_capabilities SET expires_at=clock_timestamp()+interval '1 hour'");
    return { source, target: target.principal, service: control() };
  }
  const scope = {accountId:"oauth-account",workspaceId:"oauth-workspace"};
  const canonicalTime = (at: number) => new Date(at).toISOString().replace(/\.\d{3}Z$/u,"Z");
  function gate() {
    let entered!: () => void; let proceed!: () => void;
    const ready = new Promise<void>(resolve => {entered=resolve;});
    const resumed = new Promise<void>(resolve => {proceed=resolve;});
    return {ready,proceed,async hold(){entered();await resumed;}};
  }
  function blockedControl(barrier: ReturnType<typeof gate>, delayUntilExpired = false) {
    const real=new PostgresBootstrapCheckpointPort();
    return new PostgresTargetBootstrapControl(identityTransactions,new PostgresDefaultWorkspaceTenantResolver(identityTransactions),{
      async release(tx,id){await real.release(tx,id);if(delayUntilExpired)await tx.query("SELECT pg_sleep(0.6)");await barrier.hold();},
    });
  }
  async function signedCapability() {
    const pair=generateKeyPairSync("ed25519");
    const issuedAt=canonicalTime(Date.now()-60000),expiresAt=canonicalTime(Date.now()+3600000);
    const draft={schemaVersion:1 as const,typ:"gd.bootstrap-capability.v1" as const,
      iss:"https://accounts.gooddealer.com" as const,aud:"gooddealer-desktop/bootstrap" as const,
      kid:"target-control-test",accountId:scope.accountId,deviceId:"device-b",accountSecurityEpoch:1,
      jti:"expiry-cap",issuedAt,expiresAt,payload:{deviceSwitchRequestId:"switch-guard"},signature:Buffer.alloc(64).toString("base64url")};
    const envelope={...draft,signature:sign(null,encodeBootstrapCapabilitySignatureTranscript(draft),pair.privateKey).toString("base64url")};
    const canonical=Buffer.from(encodeBootstrapCapabilitySignedEnvelope(envelope));
    await ownerPool.query(`UPDATE device_bootstrap_capabilities SET issued_at=$1,expires_at=$2,
      canonical_signed_envelope=$3,signed_envelope_digest=$4,signing_key_id=$5,ready_at=clock_timestamp()`,
      [issuedAt,expiresAt,canonical,createHash("sha256").update(canonical).digest(),envelope.kid]);
    return {envelope,expected:{accountId:scope.accountId,deviceId:"device-b",accountSecurityEpoch:1,jti:envelope.jti,
      deviceSwitchRequestId:"switch-guard",issuedAt,expiresAt,evaluatedAt:canonicalTime(Date.now())},
      verifier:new BootstrapCapabilityVerifier({async findVerificationKey(input){return input.purpose===BOOTSTRAP_CAPABILITY_KEY_PURPOSE&&input.kid===envelope.kid?pair.publicKey:null;}})};
  }
  async function activationFixture() {
    const f=await fixture();await signedCapability();
    await ownerPool.query(`UPDATE device_bootstrap_step_nonces SET state='consumed',consumed_at=clock_timestamp();
      UPDATE device_bootstrap_authorities SET next_step_kind=NULL,next_nonce_digest=NULL,next_step_number=4,
        pin_expires_at=clock_timestamp()+interval '1 hour',verified_entity_digests='verified-digests'::bytea,verified_rebuild_digest=sha256('rebuild'::bytea);
      UPDATE workspace_checkpoint_pins SET expires_at=clock_timestamp()+interval '1 hour'`);
    const activation=(signer=leaseSigner)=>new PostgresBootstrapActivation({transactions:new TenantTransactionRunner(appPool),
      accountSecurity:new PostgresIdentityAccountSecurityStatePort(),
      // Fixture commercial approval and signer exercise actual transaction effects, not production activation qualification.
      entitlement:{async lockCurrent(){return {active:true,entitlementDeadline:canonicalTime(Date.now()+86400000)};}},
      checkpoints:new PostgresBootstrapCheckpointPort(),cursors:new PostgresDeviceCursorRepository(),signer});
    return {...f,activation,input:{...scope,workflowId:"switch-guard",expectedWorkflowRevision:1}};
  }
  it("discovers only the exact target and terminates all authority without granting a Lease", async () => {
    const f = await fixture();
    await expect(f.service.status({schemaVersion:1,requestId:null},f.source)).resolves.toEqual({schemaVersion:1,found:false});
    await expect(f.service.cancel(lookup,f.source)).resolves.toMatchObject({accepted:false,code:"SWITCH_NOT_FOUND"});
    await expect(f.service.status(lookup,{...f.target,accountId:"foreign-account"})).resolves.toBeNull();
    await expect(f.service.status({...lookup,deviceId:"device-b"},f.target)).rejects.toThrow();
    await expect(f.service.status({schemaVersion:1,requestId:null},f.target)).resolves.toMatchObject({found:true,request:{requestId:"switch-guard",status:"bootstrapping",toDeviceId:"device-b"}});
    const cancelled = await f.service.cancel(lookup,f.target);
    expect(cancelled).toMatchObject({accepted:true,request:{status:"cancelled",normalHandoffReceipt:null}});
    expect(await expiryState()).toMatchObject({workflow:"cancelled",pending:null,revision:"2",allocation:"burned",consumed:"cancelled",highest:"2",current:"1",held:"0"});
    expect((await ownerPool.query(`SELECT
      (SELECT released_at IS NOT NULL FROM workspace_checkpoint_pins WHERE consumer_id='switch-guard') AS released,
      (SELECT state FROM device_bootstrap_step_nonces WHERE workflow_id='switch-guard') AS nonce,
      (SELECT next_step_kind FROM device_bootstrap_authorities WHERE workflow_id='switch-guard') AS next`)).rows).toEqual([{released:true,nonce:"consumed",next:null}]);
    expect(await f.service.cancel(lookup,f.target)).toEqual(cancelled);
    await expect(f.service.status({schemaVersion:1,requestId:null},f.target)).resolves.toEqual({schemaVersion:1,found:false});
    await expect(f.service.status(lookup,f.target)).resolves.toMatchObject({found:true,request:{status:"cancelled"}});
  });
  it("preserves a real normal handoff receipt, source release and three seals after target cancellation",async()=>{
    const sourcePrincipal=await desktopGrantPrincipal();const target=await loginStandbyDevice();
    const txs=new TenantTransactionRunner(appPool);const security=new PostgresIdentityAccountSecurityStatePort();
    const requests=new PostgresDeviceSwitchRequests({transactions:txs,accountSecurity:security});
    const source={accountId:"oauth-account",workspaceId:"oauth-workspace",deviceId:"device-a"};
    const opened=await requests.requestNormal(source,{toDeviceId:"device-b",idempotencyKey:"real-target-cancel",expectedSourceLeaseEpoch:1});
    if(opened===null||!opened.accepted)throw new Error("switch refused");
    const drains=new PostgresDeviceSwitchDrain({transactions:txs,requests,transition:new PostgresDeviceDrainTransition(txs,security,new PostgresMutationDrainLedger(),new PostgresExecutionFactDrainLedger(),new PostgresWorkspaceDeviceAuditDrainLedger())});
    const now=Date.now();const stamp=(at:number)=>new Date(at).toISOString().replace(/\.\d{3}Z$/u,"Z");
    const proof=signedHandoffDrainProof(deviceKeyPair.privateKey,{workspaceId:"oauth-workspace",sourceDeviceId:"device-a",signingKeyId:"device-key-a",deviceSwitchRequestId:opened.request.requestId,issuedAt:stamp(now),expiresAt:stamp(now+300000),streams:["mutation","execution_fact","device_audit"].map(stream=>({stream,lastAssignedSequence:0,contiguousReceivedThrough:0,pendingCount:0,rollingDigest:DRAIN_STREAM_GENESIS_DIGEST}))});
    const handoff=await drains.submit(source,opened.request.requestId,proof);
    expect(handoff).toMatchObject({accepted:true,request:{status:"bootstrapping",normalHandoffReceipt:{sourceLeaseEpoch:1}}});
    if(handoff===null||!handoff.accepted)throw new Error("drain refused");
    const query={schemaVersion:1,requestId:opened.request.requestId};
    const service=control();const cancelled=await service.cancel(query,target.principal);
    expect(cancelled).toMatchObject({accepted:true,request:{status:"cancelled",normalHandoffReceipt:handoff.request.normalHandoffReceipt}});
    await expect(service.status(query,sourcePrincipal)).resolves.toEqual({schemaVersion:1,found:false});
    expect((await ownerPool.query(`SELECT
      (SELECT count(*) FROM mutation_drain_seals)::text AS mutations,
      (SELECT count(*) FROM execution_fact_drain_seals)::text AS facts,
      (SELECT count(*) FROM workspace_device_audit_drain_seals)::text AS audits,
      (SELECT count(*) FROM device_drain_proofs WHERE consumed_at IS NOT NULL)::text AS proofs,
      (SELECT release_reason FROM device_active_leases WHERE lease_epoch=1) AS release,
      (SELECT highest_allocated_lease_epoch FROM device_account_states)::text AS highest`)).rows).toEqual([{mutations:"1",facts:"1",audits:"1",proofs:"1",release:"normal_handoff",highest:"2"}]);
  });
  it("keeps the login allocation drain exception bound to its activated default workspace and exact epoch",async()=>{
    await desktopGrantPrincipal();
    const txs=new TenantTransactionRunner(appPool);
    const lock=(workspaceId="oauth-workspace",deviceId="device-a",epoch=1)=>txs.withTenant({...scope,workspaceId},tx=>tx.query("SELECT workspace_mutation_drain_lock_domain($1,$2)",[deviceId,epoch]));
    await expect(lock()).resolves.toBeDefined();
    await expect(lock("foreign-workspace")).rejects.toMatchObject({code:"42501"});
    await expect(lock("oauth-workspace","device-b")).rejects.toMatchObject({code:"42501"});
    await expect(lock("oauth-workspace","device-a",2)).rejects.toMatchObject({code:"42501"});
    await ownerPool.query("INSERT INTO workspace_workspaces(workspace_id,account_id,kind,name) VALUES ('nondefault-workspace','oauth-account','personal','Unbound workspace')");
    await expect(lock("nondefault-workspace")).rejects.toMatchObject({code:"42501"});
    await ownerPool.query("UPDATE device_lease_epoch_allocations SET status='burned'");
    await expect(lock()).rejects.toMatchObject({code:"42501"});
    // SQL's purpose/selector constraint must still prohibit disguising a NULL-workspace switch allocation as login.
    await expect(ownerPool.query("UPDATE device_lease_epoch_allocations SET allocation_source='device_switch'")).rejects.toMatchObject({code:"23514"});
  });
  it.each(["activation","cancel"] as const)("serializes activation against cancellation when %s owns the account first",async(winner)=>{
    const f=await activationFixture();const barrier=gate();
    if(winner==="activation"){
      const activating=f.activation({async sign(input){await barrier.hold();return leaseSigner.sign(input);}}).activate(f.input);
      await barrier.ready;const cancelling=f.service.cancel(lookup,f.target);barrier.proceed();
      await expect(activating).resolves.toMatchObject({installed:true});
      await expect(cancelling).resolves.toMatchObject({accepted:false,code:"SWITCH_NOT_CANCELLABLE"});
      expect(await expiryState()).toMatchObject({workflow:"completed",allocation:"activated",current:"2",highest:"2",held:"1",consumed:"activated"});
    }else{
      const cancelling=blockedControl(barrier).cancel(lookup,f.target);await barrier.ready;
      const activating=f.activation().activate(f.input);barrier.proceed();
      await expect(cancelling).resolves.toMatchObject({accepted:true,request:{status:"cancelled"}});
      await expect(activating).resolves.toEqual({installed:false,code:"ACTIVATION_CONFLICT"});
      expect(await expiryState()).toMatchObject({workflow:"cancelled",allocation:"burned",current:"1",highest:"2",held:"0"});
    }
  });
  it.each(["expiry","cancel"] as const)("serializes expiry against cancellation when %s owns the account first",async(winner)=>{
    const f=await fixture();await ownerPool.query(`UPDATE device_bootstrap_capabilities SET expires_at=clock_timestamp()+interval '${winner==="expiry"?"-1 second":"500 milliseconds"}'`);
    const barrier=gate(),real=new PostgresBootstrapCheckpointPort();
    const expirer=new PostgresExpiredDeviceBootstrap({workspaces:new PostgresDefaultWorkspaceTenantResolver(transactions),
      checkpoints:{async release(tx,id){await real.release(tx,id);if(winner==="expiry")await barrier.hold();}}});
    const expire=()=>transactions.withAccount(scope.accountId,async tx=>{
      await tx.query("SELECT 1 FROM identity_account_security_states WHERE account_id=$1 FOR UPDATE",[scope.accountId]);
      await tx.query("SELECT 1 FROM device_account_states WHERE account_id=$1 FOR UPDATE",[scope.accountId]);
      return expirer.expireLocked(tx);
    });
    if(winner==="expiry"){
      const expiring=expire();await barrier.ready;const cancelling=f.service.cancel(lookup,f.target);barrier.proceed();
      await expect(expiring).resolves.toBe(true);await expect(cancelling).resolves.toMatchObject({accepted:false,code:"SWITCH_NOT_CANCELLABLE"});
    }else{
      const cancelling=blockedControl(barrier,true).cancel(lookup,f.target);await barrier.ready;const expiring=expire();barrier.proceed();
      await expect(cancelling).resolves.toMatchObject({accepted:true});await expect(expiring).resolves.toBe(true);
    }
    expect(await expiryState()).toMatchObject({workflow:winner==="expiry"?"failed":"cancelled",allocation:"burned",revision:"2",highest:"2",held:"0"});
  });
  it.each(["step","cancel"] as const)("serializes a valid signed bootstrap step against cancellation when %s owns the account first",async(winner)=>{
    const f=await fixture();const capability=await signedCapability();const barrier=gate();
    const nonce=Buffer.alloc(32,31).toString("base64url");
    const nonceDigest=createHash("sha256").update(encodeDomainSeparatedWireValue("GOODDEALER-BOOTSTRAP-STEP-NONCE-V2",nonce)).digest();
    await ownerPool.query(`DELETE FROM device_bootstrap_step_nonces;
      UPDATE device_bootstrap_authorities SET next_step_kind='pin_checkpoint',next_step_number=1,
      pin_expires_at=clock_timestamp()+interval '1 hour'`);
    await ownerPool.query("UPDATE device_bootstrap_authorities SET next_nonce_digest=$1",[nonceDigest]);
    await ownerPool.query(`INSERT INTO device_bootstrap_step_nonces (nonce_digest,account_id,workspace_id,workflow_id,step_number,state)
      VALUES ($1,'oauth-account','oauth-workspace','switch-guard',1,'active')`,[nonceDigest]);
    const real=new PostgresBootstrapCheckpointPort();
    const step=new PostgresBootstrapStepService({transactions:new TenantTransactionRunner(appPool),verifier:capability.verifier,
      accountSecurity:new PostgresIdentityAccountSecurityStatePort(),revisions:new PostgresWorkspaceRevisionRepository(),
      checkpoints:{lockAvailableAndPin:real.lockAvailableAndPin.bind(real),async ensureBootstrapCheckpointLocked(tx,input){
        const descriptor={schemaVersion:3 as const,workspaceId:scope.workspaceId,workspaceSchemaVersion:1,checkpointId:"expiry-checkpoint",throughServerRevision:0,checkpointDigest:createHash("sha256").update("checkpoint").digest("base64url")};
        const pinned=await real.lockAvailableAndPin(tx,{...input,descriptor});if(winner==="step")await barrier.hold();
        return pinned===null?null:{checkpoint:pinned,checkpointEntityDigests:[{entityType:"domain_asset" as const,partitionId:"empty",digest:descriptor.checkpointDigest}],targetServerRevision:0,workspaceSchemaVersion:1};
      },release:real.release.bind(real)},
      mutations:{async readDensePage(){throw new Error("pin must not read mutations");}},projection:{async readEntityDigestsAt(){throw new Error("pin must not read projection");}}});
    const draft={schemaVersion:2,deviceSwitchRequestId:"switch-guard",capabilityJti:"expiry-cap",stepNumber:1,stepNonce:nonce,
      expectedWorkflowRevision:1,stepKind:"pin_checkpoint",stepPayload:{},requestDigest:Buffer.alloc(32).toString("base64url")};
    const request=bootstrapStepRequestSchema.parse({...draft,requestDigest:createHash("sha256").update(encodeBootstrapStepRequestDigestInput(draft)).digest("base64url")});
    const execute=()=>step.execute({scope,expectedCapability:capability.expected,capability:capability.envelope,request});
    if(winner==="step"){
      const stepping=execute();await barrier.ready;const cancelling=f.service.cancel(lookup,f.target);barrier.proceed();
      await expect(stepping).resolves.toMatchObject({accepted:true,replay:false});
      await expect(cancelling).resolves.toMatchObject({accepted:true,request:{status:"cancelled"}});
    }else{
      const cancelling=blockedControl(barrier).cancel(lookup,f.target);await barrier.ready;const stepping=execute();barrier.proceed();
      await expect(cancelling).resolves.toMatchObject({accepted:true});
      await expect(stepping).resolves.toEqual({accepted:false,code:"BOOTSTRAP_CONFLICT"});
    }
    await expect(execute()).resolves.toEqual({accepted:false,code:"BOOTSTRAP_CONFLICT"});
    expect((await ownerPool.query(`SELECT
      (SELECT count(*) FROM device_bootstrap_step_nonces WHERE state='active')::text AS active,
      (SELECT count(*) FROM workspace_checkpoint_pins WHERE released_at IS NULL)::text AS pins,
      (SELECT count(*) FROM device_bootstrap_steps)::text AS steps`)).rows).toEqual([{active:"0",pins:"0",steps:winner==="step"?"1":"0"}]);
    expect(await expiryState()).toMatchObject({workflow:"cancelled",allocation:"burned",revision:winner==="step"?"3":"2",held:"0"});
  });
  it("replays an old cancelled id without touching a later bootstrap reservation",async()=>{
    const f=await fixture();const cancelled=await f.service.cancel(lookup,f.target);
    await ownerPool.query(`INSERT INTO device_switch_workflows
      (account_id,workspace_id,workflow_id,purpose,mode,request_digest,idempotency_key,status,workflow_revision,
       from_device_id,to_device_id,bound_key_id,bound_key_version,bound_account_security_epoch,pending_lease_epoch,state_deadline)
      SELECT account_id,workspace_id,'later-switch',purpose,mode,request_digest,'later-key','bootstrapping',1,
       from_device_id,to_device_id,bound_key_id,bound_key_version,bound_account_security_epoch,3,state_deadline
       FROM device_switch_workflows WHERE workflow_id='switch-guard';
      INSERT INTO device_lease_epoch_allocations (account_id,workspace_id,workflow_id,lease_epoch,status)
       VALUES ('oauth-account','oauth-workspace','later-switch',3,'pending');
      INSERT INTO device_bootstrap_capabilities (account_id,workspace_id,workflow_id,jti,target_device_id,issued_at,expires_at)
       VALUES ('oauth-account','oauth-workspace','later-switch','later-cap','device-b',clock_timestamp(),clock_timestamp()+interval '1 hour');
      UPDATE device_account_states SET highest_allocated_lease_epoch=3`);
    await expect(f.service.cancel(lookup,f.target)).resolves.toEqual(cancelled);
    await expect(f.service.status({schemaVersion:1,requestId:null},f.target)).resolves.toMatchObject({found:true,request:{requestId:"later-switch",status:"bootstrapping"}});
    expect((await ownerPool.query(`SELECT w.status,a.status AS allocation,c.consumed_at FROM device_switch_workflows w
      JOIN device_lease_epoch_allocations a USING(account_id,workspace_id,workflow_id)
      JOIN device_bootstrap_capabilities c USING(account_id,workspace_id,workflow_id) WHERE w.workflow_id='later-switch'`)).rows).toEqual([{status:"bootstrapping",allocation:"pending",consumed_at:null}]);
  });
  it("refuses inconsistent pending authority without changing reservations",async()=>{
    const f=await fixture();await ownerPool.query("UPDATE device_account_states SET highest_allocated_lease_epoch=3");
    await expect(f.service.cancel(lookup,f.target)).resolves.toMatchObject({accepted:false,code:"SWITCH_NOT_CANCELLABLE"});
    expect(await expiryState()).toMatchObject({workflow:"bootstrapping",allocation:"pending",consumed:null,revision:"1"});
    await ownerPool.query("UPDATE device_account_states SET highest_allocated_lease_epoch=2; UPDATE device_bootstrap_authorities SET target_device_id='device-a'");
    await expect(f.service.cancel(lookup,f.target)).resolves.toMatchObject({accepted:false,code:"SWITCH_NOT_CANCELLABLE"});
    expect(await expiryState()).toMatchObject({workflow:"bootstrapping",allocation:"pending",consumed:null,revision:"1"});
  });
  it("rolls back the terminal write when the exact target session expires before the final fence",async()=>{
    const f=await fixture();const real=new PostgresBootstrapCheckpointPort();
    await ownerPool.query("UPDATE identity_auth_sessions SET expires_at=clock_timestamp()+interval '500 milliseconds' WHERE session_id=$1",[f.target.sessionId]);
    const delayed=new PostgresTargetBootstrapControl(identityTransactions,new PostgresDefaultWorkspaceTenantResolver(identityTransactions),{
      async release(tx,id){await real.release(tx,id);await tx.query("SELECT pg_sleep(0.6)");},
    });
    await expect(delayed.cancel(lookup,f.target)).resolves.toBeNull();
    expect(await expiryState()).toMatchObject({workflow:"bootstrapping",allocation:"pending",consumed:null,revision:"1"});
    expect((await ownerPool.query("SELECT released_at FROM workspace_checkpoint_pins")).rows).toEqual([{released_at:null}]);
  });
  it("serializes duplicate target cancellations and never changes the terminal revision twice",async()=>{
    const f=await fixture();const results=await Promise.all([f.service.cancel(lookup,f.target),f.service.cancel(lookup,f.target)]);
    expect(results[0]).toMatchObject({accepted:true,request:{status:"cancelled"}});expect(results[1]).toEqual(results[0]);
    expect(await expiryState()).toMatchObject({revision:"2",allocation:"burned",highest:"2",held:"0"});
  });
  it("allows the target to cancel before capability claim creates an authority row",async()=>{
    const f=await fixture(false);
    await expect(f.service.cancel(lookup,f.target)).resolves.toMatchObject({accepted:true,request:{status:"cancelled"}});
    expect((await ownerPool.query("SELECT count(*) FROM device_bootstrap_authorities")).rows[0].count).toBe("0");
  });
  it("rolls back epoch, capability and nonce changes if checkpoint release fails",async()=>{
    const f=await fixture();
    const real=new PostgresBootstrapCheckpointPort();
    const denied=new PostgresTargetBootstrapControl(identityTransactions,new PostgresDefaultWorkspaceTenantResolver(identityTransactions),{
      async release(tx,id,checkpoint){await real.release(tx,id);throw new Error("fixture checkpoint failure");},
    });
    await expect(denied.cancel(lookup,f.target)).rejects.toThrow("fixture checkpoint failure");
    expect(await expiryState()).toMatchObject({workflow:"bootstrapping",allocation:"pending",consumed:null,revision:"1",highest:"2",held:"0"});
    expect((await ownerPool.query("SELECT released_at FROM workspace_checkpoint_pins")).rows).toEqual([{released_at:null}]);
    await expect(f.service.cancel(lookup,f.target)).resolves.toMatchObject({accepted:true});
  });
  it("hides revoked target credentials and preserves every reservation",async()=>{
    const f=await fixture();
    await ownerPool.query("UPDATE identity_refresh_families SET state='revoked',revoked_at=clock_timestamp(),revocation_reason='fixture' WHERE session_id=$1",[f.target.sessionId]);
    await expect(f.service.status(lookup,f.target)).resolves.toBeNull();
    await expect(f.service.cancel(lookup,f.target)).resolves.toBeNull();
    expect(await expiryState()).toMatchObject({workflow:"bootstrapping",allocation:"pending",consumed:null,revision:"1"});
  });
});

describe("PostgreSQL execution context historical evidence", () => {
  const contextPair = generateKeyPairSync("ed25519");
  const contextSigner: DesktopExecutionContextSigner = { async sign(input) {
    const draft = { ...input.claims, kid: "test-execution-context", signature: Buffer.alloc(64).toString("base64url") };
    return { signed: true, envelope: { ...draft, signature: sign(null, encodeDesktopExecutionContextSignatureTranscript(draft), contextPair.privateKey).toString("base64url") }, verificationKey: contextPair.publicKey, receipt: Buffer.from("context-signing-receipt") };
  } };
  const contextService = (signer = contextSigner) => new PostgresDesktopExecutionContextService(identityTransactions,
    new PostgresDefaultWorkspaceTenantResolver(identityTransactions), new DesktopAuthorizationGrantIssuer(grantSigner), leaseVerifier, new DesktopExecutionContextIssuer(signer));
  const request = (n: number) => ({ schemaVersion: 1, nonce: Buffer.alloc(32,n).toString("base64url") });
  const hash=(bytes:Uint8Array)=>createHash("sha256").update(bytes).digest("base64url");
  it("forced takeover historical block prevents fresh execution context evidence",async()=>{
    const active=await desktopGrantPrincipal();
    expect(await contextService().issue(request(77),active)).not.toBeNull();
    await ownerPool.query("UPDATE device_account_states SET exclusive_execution_block_until=clock_timestamp()+interval '1 day'");
    expect(await contextService().issue(request(78),active)).toBeNull();
    expect((await ownerPool.query("SELECT count(*)::int AS count FROM device_execution_contexts")).rows).toEqual([{count:1}]);
  });
  async function executionFixture(nonce=50, action:"remove"|"create"|"update"="remove"){
    const approvalTranscript=action==="remove"?encodeAfternicDelistItemApprovalSignatureTranscript:encodeAfternicListingWriteItemApprovalSignatureTranscript;
    const approvalEnvelope=action==="remove"?encodeAfternicDelistItemApprovalEnvelope:encodeAfternicListingWriteItemApprovalEnvelope;
    const approvalJson=action==="remove"?encodeAfternicDelistItemApprovalJson:encodeAfternicListingWriteItemApprovalJson;
    if(nonce===50)await applyEntitlementState("active","evidence-afternic",2,["afternic:marketplace:observe","afternic:marketplace:write"]);
    const principal=await desktopGrantPrincipal();const response=await contextService().issue(request(nonce),principal);
    if(response===null)throw new Error("context refused");const c=response.context;
    const v=JSON.parse(readFileSync(new URL(action==="remove"?"../../../../packages/protocol/test-vectors/afternic-execution-evidence/valid.json":`../../../../packages/protocol/test-vectors/afternic-listing-write-evidence/${action}.json`,import.meta.url),"utf8"));
    // Distinct context fixtures retain each vector's internal UUID references without sharing event identities.
    if(nonce!==50){
      const replacements=new Map<string,string>();let sequence=1;
      const remap=(value:unknown):unknown=>{
        if(typeof value==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value)){
          let replacement=replacements.get(value);if(replacement===undefined){replacement=`00000000-0000-4000-8000-${String(nonce*100+sequence++).padStart(12,"0")}`;replacements.set(value,replacement);}return replacement;
        }
        if(Array.isArray(value))return value.map(remap);
        if(typeof value==="object"&&value!==null)return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,remap(item)]));
        return value;
      };
      Object.assign(v,remap(v));
    }
    const base={accountId:c.accountId,workspaceId:c.workspaceId,sourceDeviceId:c.deviceId,activeLeaseEpoch:c.activeLeaseEpoch,credentialEpoch:c.credentialEpoch,signingKeyId:c.signingKeyId,signingKeyVersion:c.signingKeyVersion,trustedTimeAnchorId:hash(encodeDesktopExecutionContextEnvelope(c))};
    const boundary=(delta:number)=>new Date(Date.parse(c.serverObservedAt)+1000+delta).toISOString().replace(".000Z","Z");
    const approval={...v.approval,...base,authorizationHash:c.authorizationGrantDigest,approvedAt:boundary(1000)};
    approval.deviceSignature=sign(null,approvalTranscript(approval),deviceKeyPair.privateKey).toString("base64url");
    const approvalDigest=hash(approvalEnvelope(approval));
    const audit=(draft:unknown)=>{
      const event=deviceAuditIngestRequestSchema.parse({schemaVersion:1,event:draft}).event;
      event.eventHash=hash(encodeDeviceAuditEventHashInput(event));event.deviceSignature=sign(null,encodeDeviceAuditEventSignatureTranscript(event),deviceKeyPair.privateKey).toString("base64url");return event;
    };
    const auditBase={...base,authorizationContextHash:c.authorizationGrantDigest,chainId:hash(encodeWorkspaceDeviceAuditChainDomain({workspaceId:c.workspaceId,sourceDeviceId:c.deviceId,activeLeaseEpoch:c.activeLeaseEpoch}))};
    const approvalAudit=audit({...v.approvalAudit,...auditBase,occurredAt:boundary(1000)});
    const claimAudit=audit({...v.claimAudit,...auditBase,occurredAt:boundary(2000),previousHash:approvalAudit.eventHash,payloadRedacted:{...v.claimAudit.payloadRedacted,approvalEnvelopeDigest:approvalDigest}});
    const {accountId:_account,...factBase}=base;
    const fact=executionFactIngestRequestSchema.parse({schemaVersion:1,fact:{...v.fact,...factBase,authorizationHash:c.authorizationGrantDigest,idempotencyKeyHash:hash(encodeAfternicLocalDispatchKeyDigestInput({schemaVersion:1,operationId:approval.operationId,operationItemId:approval.operationItemId,attemptNo:1,localOperationKey:approval.planId})),occurredAt:boundary(2000),requestStartBoundary:boundary(2000),executionAuthorizationEvidence:{...v.fact.executionAuthorizationEvidence,signingKeyId:c.signingKeyId,signingKeyVersion:c.signingKeyVersion,credentialEpoch:c.credentialEpoch,approvedOperationDigest:approvalDigest,approvedOperationEnvelope:Buffer.from(approvalJson(approval)).toString("base64url")},auditEventHash:claimAudit.eventHash,payloadRedacted:{...v.fact.payloadRedacted,approvalEnvelopeDigest:approvalDigest}}}).fact;
    const signFact=(draft:typeof fact)=>({...draft,deviceSignature:sign(null,encodeExecutionFactSignatureTranscript(draft),deviceKeyPair.privateKey).toString("base64url")});
    const authority=new PostgresExecutionEvidenceAuthority(identityTransactions,new PostgresDefaultWorkspaceTenantResolver(identityTransactions));
    const contexts=new PostgresHistoricalExecutionContext();
    const audits=new PostgresDeviceAuditEvidenceService(authority,contexts,new PostgresExecutionFactEvidenceReader());
    const facts=new PostgresExecutionFactEvidenceService(authority,contexts,new PostgresDeviceAuditEvidenceReader());
    return {principal,response,approval,approvalAudit,claimAudit,fact:signFact(fact),audits,facts,signFact,audit,authority,contexts};
  }
  describe.each(["remove","create","update"] as const)("Afternic %s production stream",action=>{
  it("production evidence rejects a signed batch action substituted across the same opaque references",async()=>{
    const f=await executionFixture(50,action);
    const other=action==="create"?"update":"create";
    const event=f.audit({...f.approvalAudit,targetType:"afternic_listing_write_approval",payloadRedacted:{...f.approvalAudit.payloadRedacted,action:other}});
    await expect(f.audits.ingest({schemaVersion:1,event},f.principal)).resolves.toMatchObject({outcome:"accepted"});
    const claim=f.audit({...f.claimAudit,previousHash:event.eventHash});
    await expect(f.audits.ingest({schemaVersion:1,event:claim},f.principal)).resolves.toMatchObject({outcome:"quarantined",receipt:{reason:"authorization"}});
    await expect(f.facts.ingest({schemaVersion:1,fact:f.fact},f.principal)).resolves.toMatchObject({outcome:"quarantined",receipt:{reason:"authorization"}});
  });
  it("production evidence rejects substituted signed item action and legacy signature purpose",async()=>{
    const f=await executionFixture(50,action);
    const changed={...f.approval,action:action==="create"?"update":"create",typ:"gd.afternic-listing-write-item-approval.v1"};
    changed.deviceSignature=sign(null,encodeAfternicListingWriteItemApprovalSignatureTranscript(changed),deviceKeyPair.privateKey).toString("base64url");
    const digest=hash(encodeAfternicListingWriteItemApprovalEnvelope(changed));
    const fact=f.signFact({...f.fact,payloadRedacted:{...f.fact.payloadRedacted,approvalEnvelopeDigest:digest},executionAuthorizationEvidence:{...f.fact.executionAuthorizationEvidence,approvedOperationDigest:digest,approvedOperationEnvelope:Buffer.from(encodeAfternicListingWriteItemApprovalJson(changed)).toString("base64url")}});
    await expect(f.facts.ingest({schemaVersion:1,fact},f.principal)).resolves.toMatchObject({outcome:"quarantined",receipt:{reason:"authorization"}});
  });
  it("production evidence rejects a mathematically valid signature in another approval domain",async()=>{
    const f=await executionFixture(50,action);
    const {deviceSignature:_signature,...claims}=f.approval;
    const domain=action==="remove"?"GOODDEALER-AFTERNIC-LISTING-WRITE-ITEM-APPROVAL-V1":"GOODDEALER-AFTERNIC-DELIST-ITEM-APPROVAL-V1";
    const changed={...f.approval,deviceSignature:sign(null,encodeDomainSeparatedWireValue(domain,claims),deviceKeyPair.privateKey).toString("base64url")};
    const encodeEnvelope=action==="remove"?encodeAfternicDelistItemApprovalEnvelope:encodeAfternicListingWriteItemApprovalEnvelope;
    const encodeJson=action==="remove"?encodeAfternicDelistItemApprovalJson:encodeAfternicListingWriteItemApprovalJson;
    const digest=hash(encodeEnvelope(changed));
    const fact=f.signFact({...f.fact,payloadRedacted:{...f.fact.payloadRedacted,approvalEnvelopeDigest:digest},executionAuthorizationEvidence:{...f.fact.executionAuthorizationEvidence,approvedOperationDigest:digest,approvedOperationEnvelope:Buffer.from(encodeJson(changed)).toString("base64url")}});
    await expect(f.facts.ingest({schemaVersion:1,fact},f.principal)).resolves.toMatchObject({outcome:"quarantined",receipt:{reason:"authorization"}});
  });
  it("production evidence prevents caller-selected account workspace and source",async()=>{
    const f=await executionFixture(50,action);
    await expect(f.audits.ingest({schemaVersion:1,event:f.audit({...f.approvalAudit,accountId:"another-account"})},f.principal)).resolves.toBeNull();
    await expect(f.facts.ingest({schemaVersion:1,fact:f.signFact({...f.fact,workspaceId:"another-workspace"})},f.principal)).resolves.toBeNull();
    await expect(f.facts.ingest({schemaVersion:1,fact:f.signFact({...f.fact,sourceDeviceId:"another-device"})},f.principal)).resolves.toBeNull();
    expect((await ownerPool.query("SELECT count(*) FROM execution_fact_drain_records")).rows[0].count).toBe("0");
  });
  it("production evidence rejects reconciliation borrowed from another action",async()=>{
    const f=await executionFixture(50,action);
    for(const event of [f.approvalAudit,f.claimAudit])await f.audits.ingest({schemaVersion:1,event},f.principal);
    await expect(f.facts.ingest({schemaVersion:1,fact:f.fact},f.principal)).resolves.toMatchObject({outcome:"accepted"});
    const other=action==="create"?"update":"create";
    const event=f.audit({...f.claimAudit,auditEventId:"00000000-0000-4000-8000-000000000096",auditSequence:3,previousHash:f.claimAudit.eventHash,eventType:"runtime_security_lifecycle",authorizationSource:"runtime_security_context",targetType:"afternic_listing_write_attempt",payloadRedacted:{schemaVersion:1,provider:"afternic",action:other,stage:"reconciled",operationId:f.fact.operationId,operationItemId:f.fact.operationItemId,attemptId:f.fact.attemptId,originalExecutionFactId:f.fact.executionFactId,originalExecutionFactDigest:hash(encodeDrainStreamEnvelope("execution_fact",f.fact)),outcome:"matched",reason:null}});
    await expect(f.audits.ingest({schemaVersion:1,event},f.principal)).resolves.toMatchObject({outcome:"quarantined",receipt:{reason:"authorization"}});
  });
  it("production role directly rejects wrong action event purpose and private payload fields",async()=>{
    const f=await executionFixture(50,action);
    for(const mutation of ["action","event","private"]){
      await expect(identityTransactions.withAccountCredential(f.principal.transactionCredential!,"devices_account",async tx=>{
        await tx.query("SELECT set_config('gooddealer.workspace_id',$1,true)",[f.fact.workspaceId]);
        const fact=structuredClone(f.fact);
        if(mutation==="action")Object.assign(fact.payloadRedacted,{action:"buy"});
        if(mutation==="event")fact.eventType="unapproved_execution";
        if(mutation==="private")Object.assign(fact.payloadRedacted,{domain:"wecin.com"});
        const bytes=Buffer.from(encodeDrainStreamEnvelope("execution_fact",fact));
        await tx.query("SELECT public.execution_fact_evidence_append($1::jsonb,$2::bytea,NULL,true,NULL)",[fact,bytes]);
      })).rejects.toMatchObject({code:"42501"});
    }
    await expect(identityTransactions.withAccountCredential(f.principal.transactionCredential!,"devices_account",async tx=>{
      await tx.query("SELECT set_config('gooddealer.workspace_id',$1,true)",[f.fact.workspaceId]);
      const event={...f.approvalAudit,targetType:"unapproved_target"};
      await tx.query("SELECT public.audit_execution_evidence_append($1::jsonb,$2::bytea,NULL,true,NULL)",[event,Buffer.from(encodeDrainStreamEnvelope("device_audit",event))]);
    })).rejects.toMatchObject({code:"42501"});
  });
  it("production evidence commits ordered approval/claim/fact and exact lost-response receipts",async()=>{
    const f=await executionFixture(50,action);const upload=(event:unknown)=>f.audits.ingest({schemaVersion:1,event},f.principal);
    const fact=()=>f.facts.ingest({schemaVersion:1,fact:f.fact},f.principal);
    await expect(fact()).resolves.toMatchObject({outcome:"pending",code:"APPROVAL_AUDIT_MISSING"});
    await expect(upload(f.claimAudit)).resolves.toMatchObject({outcome:"pending",code:"PREDECESSOR_MISSING"});
    await expect(upload(f.approvalAudit)).resolves.toMatchObject({outcome:"accepted"});
    await expect(fact()).resolves.toMatchObject({outcome:"pending",code:"PAIRED_AUDIT_MISSING"});
    await expect(upload(f.claimAudit)).resolves.toMatchObject({outcome:"accepted"});
    const accepted=await fact();expect(accepted).toMatchObject({outcome:"accepted",receipt:{stream:"execution_fact",classification:"current"}});
    expect(await fact()).toEqual(accepted);
    const query={activeLeaseEpoch:f.fact.activeLeaseEpoch,sequence:f.fact.executionFactSequence,eventId:f.fact.executionFactId,envelopeDigest:hash(encodeDrainStreamEnvelope("execution_fact",f.fact))};
    expect(await f.facts.receipts({schemaVersion:1,entries:[query,{...query,envelopeDigest:Buffer.alloc(32).toString("base64url")}]},f.principal)).toMatchObject({results:[{query,receipt:accepted?.outcome==="accepted"?accepted.receipt:null},{receipt:null}]});
    expect((await ownerPool.query("SELECT count(*) FROM execution_fact_drain_records")).rows[0].count).toBe("1");
    expect((await ownerPool.query("SELECT count(*) FROM execution_fact_evidence_quarantines")).rows[0].count).toBe("0");
  });
  it("production evidence separates nonblocking invalid signatures from signed semantic violations",async()=>{
    const f=await executionFixture(50,action);const invalid={...f.fact,deviceSignature:Buffer.alloc(64).toString("base64url")};
    await expect(f.facts.ingest({schemaVersion:1,fact:invalid},f.principal)).resolves.toMatchObject({outcome:"quarantined",receipt:{reason:"signature"}});
    expect((await ownerPool.query("SELECT domain_blocking FROM execution_fact_evidence_quarantines")).rows).toEqual([{domain_blocking:false}]);
    expect((await ownerPool.query("SELECT count(*) FROM execution_fact_drain_records")).rows[0].count).toBe("0");
    const wrong=f.signFact({...f.fact,requestStartBoundary:f.response.context.serverObservedAt});
    await expect(f.facts.ingest({schemaVersion:1,fact:wrong},f.principal)).resolves.toMatchObject({outcome:"quarantined",receipt:{reason:"authorization"}});
    expect((await ownerPool.query("SELECT domain_blocking FROM execution_fact_evidence_quarantines ORDER BY received_at")).rows).toEqual([{domain_blocking:false},{domain_blocking:true}]);
    await expect(appPool.query("SELECT * FROM execution_fact_drain_records")).rejects.toMatchObject({code:"42501"});
  });
  it("production evidence attributes a signed missing-context violation without inventing execution authority",async()=>{
    const f=await executionFixture(50,action);const wrong=f.signFact({...f.fact,trustedTimeAnchorId:Buffer.alloc(32,7).toString("base64url")});
    await expect(f.facts.ingest({schemaVersion:1,fact:wrong},f.principal)).resolves.toMatchObject({outcome:"quarantined",receipt:{reason:"epoch_unknown"}});
    expect((await ownerPool.query("SELECT domain_blocking FROM execution_fact_evidence_quarantines")).rows).toEqual([{domain_blocking:true}]);
    expect((await ownerPool.query("SELECT count(*) FROM execution_fact_drain_records")).rows[0].count).toBe("0");
  });
  it("production evidence returns original receipt after seal and quarantines new signed bytes",async()=>{
    const f=await executionFixture(50,action);for(const event of [f.approvalAudit,f.claimAudit])await f.audits.ingest({schemaVersion:1,event},f.principal);
    const accepted=await f.facts.ingest({schemaVersion:1,fact:f.fact},f.principal);
    await ownerPool.query("INSERT INTO execution_fact_drain_seals(account_id,workspace_id,source_device_id,active_lease_epoch,last_assigned_execution_fact_sequence,rolling_digest,proof_id) SELECT account_id,workspace_id,source_device_id,active_lease_epoch,contiguous_received_through,rolling_digest,'fixture-accepted-seal' FROM execution_fact_drain_heads");
    expect(await f.facts.ingest({schemaVersion:1,fact:f.fact},f.principal)).toEqual(accepted);
    const next=f.signFact({...f.fact,executionFactSequence:2,executionFactId:"00000000-0000-4000-8000-000000000099",attemptId:"00000000-0000-4000-8000-000000000097",auditEventRef:"00000000-0000-4000-8000-000000000096"});
    await expect(f.facts.ingest({schemaVersion:1,fact:next},f.principal)).resolves.toMatchObject({outcome:"quarantined",receipt:{reason:"drain_seal_violation"}});
    expect((await ownerPool.query("SELECT domain_blocking FROM execution_fact_evidence_quarantines")).rows).toEqual([{domain_blocking:false}]);
  });
  it("production evidence refuses new fact identities reusing a durable claim across sequences and epochs",async()=>{
    const f=await executionFixture(50,action);for(const event of [f.approvalAudit,f.claimAudit])await f.audits.ingest({schemaVersion:1,event},f.principal);
    await expect(f.facts.ingest({schemaVersion:1,fact:f.fact},f.principal)).resolves.toMatchObject({outcome:"accepted"});
    const copies=[{...f.fact,executionFactSequence:2,executionFactId:"00000000-0000-4000-8000-000000000091"},{...f.fact,activeLeaseEpoch:f.fact.activeLeaseEpoch+1,executionFactId:"00000000-0000-4000-8000-000000000092"}].map(f.signFact);
    for(const fact of copies)await expect(f.facts.ingest({schemaVersion:1,fact},f.principal)).resolves.toMatchObject({outcome:"quarantined",receipt:{reason:"sequence_replay"}});
    expect((await ownerPool.query("SELECT count(*) FROM execution_fact_drain_records")).rows[0].count).toBe("1");
  });
  it("production evidence rejects a concurrent cross-epoch claim replay at the database unique fence",async()=>{
    const first=await executionFixture(50,action);
    await new Promise(resolve=>setTimeout(resolve,3100));
    await releaseHeldLease();
    await leaseManager.ensureCurrentLease({accountId:"oauth-account",deviceId:"device-a",accountSecurityEpoch:1,transactionCredential:first.principal.transactionCredential});
    const second=await executionFixture(51,action);
    expect(second.fact.activeLeaseEpoch).toBe(first.fact.activeLeaseEpoch+1);
    second.claimAudit=second.audit({...second.claimAudit,targetRef:first.fact.attemptId,payloadRedacted:{...second.claimAudit.payloadRedacted,attemptId:first.fact.attemptId}});
    second.fact=second.signFact({...second.fact,attemptId:first.fact.attemptId,auditEventHash:second.claimAudit.eventHash});
    for(const fixture of [first,second])for(const event of [fixture.approvalAudit,fixture.claimAudit]){
      await expect(fixture.audits.ingest({schemaVersion:1,event},fixture.principal)).resolves.toMatchObject({outcome:"accepted"});
    }
    const blocker=await ownerPool.connect();
    let pending:Promise<unknown[]>|undefined;
    try{
      await blocker.query("BEGIN");
      // Both production transactions finish semantic checks before either INSERT can win.
      await blocker.query("LOCK TABLE execution_fact_drain_records IN SHARE MODE");
      pending=Promise.all([first,second].map(fixture=>fixture.facts.ingest({schemaVersion:1,fact:fixture.fact},fixture.principal)));
      let waiters=0;
      for(let attempt=0;attempt<100;attempt++){
        waiters=Number((await ownerPool.query("SELECT count(*) FROM pg_locks WHERE relation='execution_fact_drain_records'::regclass AND mode='RowExclusiveLock' AND NOT granted")).rows[0].count);
        if(waiters===2)break;await new Promise(resolve=>setTimeout(resolve,10));
      }
      expect(waiters).toBe(2);
      await blocker.query("COMMIT");
      const results=await pending;
      expect(results).toEqual(expect.arrayContaining([
        expect.objectContaining({outcome:"accepted"}),
        expect.objectContaining({outcome:"quarantined",receipt:expect.objectContaining({reason:"sequence_replay"})}),
      ]));
      expect((await ownerPool.query("SELECT count(*) FROM execution_fact_drain_records")).rows[0].count).toBe("1");
      expect((await ownerPool.query("SELECT domain_blocking FROM execution_fact_evidence_quarantines")).rows).toEqual([{domain_blocking:true}]);
    }finally{
      await blocker.query("ROLLBACK");blocker.release();await pending;
    }
  });
  it("production evidence commits concurrent exact retries only once and rolls back a lost transaction",async()=>{
    const f=await executionFixture(50,action);
    const rollback=new PostgresDeviceAuditEvidenceService({withActiveSource:async(principal,work)=>f.authority.withActiveSource(principal,async source=>{await work(source);throw new Error("fixture crash before commit");})},f.contexts,new PostgresExecutionFactEvidenceReader());
    await expect(rollback.ingest({schemaVersion:1,event:f.approvalAudit},f.principal)).rejects.toThrow("fixture crash before commit");
    expect((await ownerPool.query("SELECT count(*) FROM workspace_device_audit_drain_records")).rows[0].count).toBe("0");
    const results=await Promise.all([1,2,3].map(()=>f.audits.ingest({schemaVersion:1,event:f.approvalAudit},f.principal)));
    expect(results[0]).toMatchObject({outcome:"accepted"});expect(results[1]).toEqual(results[0]);expect(results[2]).toEqual(results[0]);
    expect((await ownerPool.query("SELECT count(*) FROM workspace_device_audit_drain_records")).rows[0].count).toBe("1");
  });
  it("production evidence keeps reconciled pending until the immutable original fact exists",async()=>{
    const f=await executionFixture(50,action);for(const event of [f.approvalAudit,f.claimAudit])await f.audits.ingest({schemaVersion:1,event},f.principal);
    const event=f.audit({...f.claimAudit,auditEventId:"00000000-0000-4000-8000-000000000098",auditSequence:3,previousHash:f.claimAudit.eventHash,eventType:"runtime_security_lifecycle",authorizationSource:"runtime_security_context",payloadRedacted:{schemaVersion:1,provider:"afternic",action,stage:"reconciled",operationId:f.fact.operationId,operationItemId:f.fact.operationItemId,attemptId:f.fact.attemptId,originalExecutionFactId:f.fact.executionFactId,originalExecutionFactDigest:hash(encodeDrainStreamEnvelope("execution_fact",f.fact)),outcome:action==="remove"?"absent":"matched",reason:null}});
    await expect(f.audits.ingest({schemaVersion:1,event},f.principal)).resolves.toMatchObject({outcome:"pending",code:"ORIGINAL_FACT_MISSING"});
    expect((await ownerPool.query("SELECT count(*) FROM workspace_device_audit_drain_records")).rows[0].count).toBe("2");
    await expect(f.facts.ingest({schemaVersion:1,fact:f.fact},f.principal)).resolves.toMatchObject({outcome:"accepted"});
    await expect(f.audits.ingest({schemaVersion:1,event},f.principal)).resolves.toMatchObject({outcome:"accepted"});
  });
  it("production evidence owner rejects forged scope, unknown payload keys and divergent canonical bytes",async()=>{
    const f=await executionFixture(50,action);
    for(const mutation of ["scope","payload","bytes"]){
      await expect(identityTransactions.withAccountCredential(f.principal.transactionCredential!,"devices_account",async tx=>{
        await tx.query("SELECT set_config('gooddealer.workspace_id',$1,true)",[f.fact.workspaceId]);
        const fact=structuredClone(f.fact);let bytes=Buffer.from(encodeDrainStreamEnvelope("execution_fact",fact));
        if(mutation==="scope")fact.sourceDeviceId="another-device";
        if(mutation==="payload")Object.assign(fact.payloadRedacted as object,{cookie:"unsafe"});
        if(mutation==="bytes")bytes=Buffer.from("wrong-canonical-bytes");
        await tx.query("SELECT public.execution_fact_evidence_append($1::jsonb,$2::bytea,NULL,true,NULL)",[fact,bytes]);
      })).rejects.toMatchObject({code:"42501"});
    }
    expect((await ownerPool.query("SELECT count(*) FROM execution_fact_drain_records")).rows[0].count).toBe("0");
    const client=await appPool.connect();try{
      await client.query("BEGIN");await client.query("SELECT set_config('gooddealer.account_id','oauth-account',true),set_config('gooddealer.workspace_id','oauth-workspace',true)");
      await expect(client.query("SELECT public.execution_fact_evidence_receipt(1,1,'00000000-0000-4000-8000-000000000001',decode(repeat('00',32),'hex'))")).rejects.toMatchObject({code:"42501"});
      await client.query("ROLLBACK");
    }finally{client.release();}
  });
  it("production evidence domain lock serializes a concurrent seal before a new append",async()=>{
    const f=await executionFixture(50,action);for(const event of [f.approvalAudit,f.claimAudit])await f.audits.ingest({schemaVersion:1,event},f.principal);
    const client=await ownerPool.connect();let completed=false;
    try{
      await client.query("BEGIN");await client.query("SELECT set_config('gooddealer.account_id',$1,true),set_config('gooddealer.workspace_id',$2,true)",[f.principal.accountId,f.fact.workspaceId]);
      await client.query("SELECT * FROM execution_fact_drain_recompute_head($1,$2)",[f.fact.sourceDeviceId,f.fact.activeLeaseEpoch]);
      const pending=f.facts.ingest({schemaVersion:1,fact:f.fact},f.principal).then(value=>{completed=true;return value;});
      await new Promise(resolve=>setTimeout(resolve,60));expect(completed).toBe(false);
      await client.query("INSERT INTO execution_fact_drain_seals(account_id,workspace_id,source_device_id,active_lease_epoch,last_assigned_execution_fact_sequence,rolling_digest,proof_id) SELECT account_id,workspace_id,source_device_id,active_lease_epoch,contiguous_received_through,rolling_digest,'fixture-racing-seal' FROM execution_fact_drain_heads");
      await client.query("COMMIT");await expect(pending).resolves.toMatchObject({outcome:"quarantined",receipt:{reason:"drain_seal_violation"}});
    }finally{await client.query("ROLLBACK");client.release();}
  });
  it("production evidence accepts historical signed events strictly before a real security epoch transition",async()=>{
    const f=await executionFixture(50,action);
    await new Promise(resolve=>setTimeout(resolve,3100));
    const transition=await ownerPool.connect();try{
      await transition.query("BEGIN");await transition.query("UPDATE identity_account_security_states SET account_security_epoch=2 WHERE account_id='oauth-account'");await transition.query("ROLLBACK");
    }finally{transition.release();}
    // A rolled-back real transition must not leave an end boundary that rejects the issued epoch.
    await expect(f.audits.ingest({schemaVersion:1,event:f.approvalAudit},f.principal)).resolves.toMatchObject({outcome:"accepted"});
    await ownerPool.query("UPDATE identity_account_security_states SET account_security_epoch=2 WHERE account_id='oauth-account'");
    // Model the already authenticated web session after reauthentication, then exercise the real
    // Desktop OAuth exchange and new Lease issuance rather than mutating a Desktop access token.
    await ownerPool.query("UPDATE identity_auth_sessions SET epoch_at_issue=2 WHERE account_id='oauth-account' AND session_id='web-session-live'");
    await releaseHeldLease();const current=await desktopGrantPrincipal();
    await expect(f.audits.ingest({schemaVersion:1,event:f.claimAudit},current)).resolves.toMatchObject({outcome:"accepted",receipt:{classification:"late"}});
    await expect(f.facts.ingest({schemaVersion:1,fact:f.fact},current)).resolves.toMatchObject({outcome:"accepted",receipt:{classification:"late"}});
    const occurredAt=new Date(Date.parse(f.response.context.serverObservedAt)+11000).toISOString().replace(".000Z","Z");
    const after=f.signFact({...f.fact,executionFactId:"00000000-0000-4000-8000-000000000094",attemptId:"00000000-0000-4000-8000-000000000095",auditEventRef:"00000000-0000-4000-8000-000000000093",executionFactSequence:2,monotonicDeltaMs:10000,occurredAt,requestStartBoundary:occurredAt});
    await expect(f.facts.ingest({schemaVersion:1,fact:after},current)).resolves.toMatchObject({outcome:"quarantined",receipt:{reason:"authorization"}});
  });
  });
  it("commits fresh context and exact Grant/key history, refuses nonce reuse and permits a new sample", async () => {
    const principal = await desktopGrantPrincipal();
    const service = contextService();
    const response = await service.issue(request(21), principal);
    expect(response).not.toBeNull();
    if (response === null) throw new Error("context refused");
    expect(response.context.credentialEpoch).toBe(1);
    expect(response.context.signingKeyId).toBe("device-key-a");
    expect(response.context.authorizationGrantDigest).toBe(createHash("sha256").update(encodeDesktopExecutionAuthorizationDigestInput(response.grant)).digest("base64url"));
    expect(verify(null,encodeDesktopExecutionContextSignatureTranscript(response.context),contextPair.publicKey,Buffer.from(response.context.signature,"base64url"))).toBe(true);
    const rows = await ownerPool.query("SELECT * FROM device_execution_contexts");
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].device_public_key).toEqual(devicePublicKey);
    expect(rows.rows[0].context_digest).toEqual(createHash("sha256").update(encodeDesktopExecutionContextEnvelope(response.context)).digest());
    expect(rows.rows[0].signed_grant).toEqual(response.grant);
    await expect(service.issue(request(21), principal)).resolves.toBeNull();
    await expect(service.issue(request(22), principal)).resolves.not.toBeNull();
    await expect(ownerPool.query("UPDATE device_execution_contexts SET device_credential_epoch=2")).rejects.toMatchObject({ code: "55000" });
    await expect(ownerPool.query("DELETE FROM device_execution_contexts")).rejects.toMatchObject({ code: "55000" });
    await expect(appPool.query("SELECT * FROM device_execution_contexts")).rejects.toMatchObject({ code: "42501" });
    await expect(appPool.query("INSERT INTO device_execution_contexts(account_id) VALUES('oauth-account')")).rejects.toMatchObject({ code: "42501" });
  });
  it("retains immutable purpose keys and verifies history with no current keyring dependency", async () => {
    await applyEntitlementState("active","historical-afternic",2,["afternic:marketplace:observe","afternic:marketplace:write"]);
    const principal=await desktopGrantPrincipal();const response=await contextService().issue(request(40),principal);
    if(response===null)throw new Error("context refused");
    const c=response.context;
    const input={workspaceId:c.workspaceId,sourceDeviceId:c.deviceId,activeLeaseEpoch:c.activeLeaseEpoch,
      credentialEpoch:c.credentialEpoch,signingKeyId:c.signingKeyId,signingKeyVersion:c.signingKeyVersion,
      trustedTimeAnchorId:createHash("sha256").update(encodeDesktopExecutionContextEnvelope(c)).digest("base64url"),
      authorizationHash:c.authorizationGrantDigest,monotonicDeltaMs:0,
      occurredAt:new Date(Date.parse(c.serverObservedAt)+1000).toISOString().replace(".000Z","Z")};
    const history=new PostgresHistoricalExecutionContext();
    const read=(value=input)=>identityTransactions.withAccountCredential(principal.transactionCredential!,"devices_account",async tx=>{
      await tx.query("SELECT set_config('gooddealer.workspace_id',$1,true)",[c.workspaceId]);return history.read(tx,value);
    });
    await expect(read()).resolves.toMatchObject({found:true,authorizationFailure:null});
    await expect(read({...input,authorizationHash:Buffer.alloc(32).toString("base64url")})).resolves.toMatchObject({found:true,authorizationFailure:"authorization"});
    await expect(read({...input,sourceDeviceId:"another-device"})).resolves.toMatchObject({found:false});
    await expect(read({...input,monotonicDeltaMs:1})).resolves.toMatchObject({found:true,authorizationFailure:"time_unprovable"});
    const evidence=await ownerPool.query("SELECT * FROM device_execution_context_key_evidence");
    expect(evidence.rows).toHaveLength(1);expect(evidence.rows[0].context_public_key).toEqual(contextPair.publicKey.export({format:"der",type:"spki"}));
    await expect(ownerPool.query("UPDATE device_execution_context_key_evidence SET context_key_id='replacement'")).rejects.toMatchObject({code:"55000"});
    await expect(ownerPool.query("DELETE FROM device_execution_context_key_evidence")).rejects.toMatchObject({code:"55000"});
    await expect(appPool.query("SELECT * FROM device_execution_context_key_evidence")).rejects.toMatchObject({code:"42501"});
    // A later rotation retains an actual boundary. Verification needs neither old current-ring
    // entries nor the new device key; only the captured key can verify the old signature.
    await new Promise(resolve=>setTimeout(resolve,1100));
    await ownerPool.query("UPDATE device_signing_keys SET status='rotated',retired_at=clock_timestamp() WHERE account_id='oauth-account'");
    await expect(read()).resolves.toMatchObject({found:true,authorizationFailure:null});
    await expect(read({...input,occurredAt:new Date(Date.parse(c.serverObservedAt)+10000).toISOString().replace(".000Z","Z"),monotonicDeltaMs:9000})).resolves.toMatchObject({found:true,authorizationFailure:"removal_boundary"});
  });
  it("does not issue evidence for web callers, missing credentials or substituted request selectors", async () => {
    const principal = await desktopGrantPrincipal();
    const service = contextService();
    await expect(service.issue(request(23), { ...principal, clientKind: "account_web" })).resolves.toBeNull();
    const { transactionCredential: _credential, ...missing } = principal;
    await expect(service.issue(request(23), missing)).resolves.toBeNull();
    await expect(service.issue({ ...request(23), workspaceId: "other" },principal)).rejects.toThrow();
    expect((await ownerPool.query("SELECT * FROM device_execution_contexts")).rowCount).toBe(0);
  });
  it("checks signer claims/signature before storing and signs no Provider operation", async () => {
    const principal = await desktopGrantPrincipal();
    const bad: DesktopExecutionContextSigner = { async sign(input) {
      const signed = await contextSigner.sign(input);
      if (!signed.signed) return signed;
      return { ...signed, envelope: { ...(signed.envelope as Record<string,unknown>), credentialEpoch: 8 } };
    } };
    await expect(contextService(bad).issue(request(24),principal)).rejects.toThrow("invalid evidence");
    expect((await ownerPool.query("SELECT * FROM device_execution_contexts")).rowCount).toBe(0);
    await expect(contextService({sign: async () => ({signed:false})}).issue(request(25),principal)).resolves.toBeNull();
  });
  it.each([
    ["device credential epoch", "UPDATE device_bindings SET credential_epoch=credential_epoch+1 WHERE account_id='oauth-account'"],
    ["device key revocation", "UPDATE device_signing_keys SET status='revoked' WHERE account_id='oauth-account'"],
    ["session revocation", "UPDATE identity_auth_sessions SET revoked_at=clock_timestamp() WHERE account_id='oauth-account' AND client_kind='desktop'"],
    ["Lease online expiry", "UPDATE device_active_leases SET issued_at=clock_timestamp()-interval '10 minutes',renew_after=clock_timestamp()-interval '5 minutes',online_expires_at=clock_timestamp()-interval '1 second' WHERE account_id='oauth-account'"],
  ])("rejects %s after signing without committing evidence", async (_label, statement) => {
    const principal = await desktopGrantPrincipal();
    let current: AccountTransaction | undefined;
    const txs: Pick<IdentityCapabilityTransactionRunner,"withAccountCredential"> = {
      withAccountCredential: (credential,purpose,operation) => identityTransactions.withAccountCredential(credential,purpose,async tx=>{current=tx;return operation(tx);}),
    };
    const changed: DesktopExecutionContextSigner = { async sign(input) {
      const result = await contextSigner.sign(input);
      if (current === undefined) throw new Error("transaction not captured");
      await current.query(statement);
      return result;
    } };
    const service=new PostgresDesktopExecutionContextService(txs,new PostgresDefaultWorkspaceTenantResolver(identityTransactions),new DesktopAuthorizationGrantIssuer(grantSigner),leaseVerifier,new DesktopExecutionContextIssuer(changed));
    await expect(service.issue(request(28),principal)).resolves.toBeNull();
    expect((await ownerPool.query("SELECT * FROM device_execution_contexts")).rowCount).toBe(0);
  });
  it("rejects a substituted principal despite possession of another account credential",async()=>{
    const principal=await desktopGrantPrincipal();
    await expect(contextService().issue(request(29),{...principal,accountId:"other-account"})).resolves.toBeNull();
    expect((await ownerPool.query("SELECT * FROM device_execution_contexts")).rowCount).toBe(0);
  });
  it("rolls back signed evidence if the enclosing transaction cannot commit",async()=>{
    const principal=await desktopGrantPrincipal();
    const failing: Pick<IdentityCapabilityTransactionRunner,"withAccountCredential"> = {
      withAccountCredential:(credential,purpose,operation)=>identityTransactions.withAccountCredential(credential,purpose,async tx=>{await operation(tx);throw new Error("fixture commit aborted");}),
    };
    const service=new PostgresDesktopExecutionContextService(failing,new PostgresDefaultWorkspaceTenantResolver(identityTransactions),new DesktopAuthorizationGrantIssuer(grantSigner),leaseVerifier,new DesktopExecutionContextIssuer(contextSigner));
    await expect(service.issue(request(30),principal)).rejects.toThrow("fixture commit aborted");
    expect((await ownerPool.query("SELECT * FROM device_execution_contexts")).rowCount).toBe(0);
    await expect(contextService().issue(request(31),principal)).resolves.not.toBeNull();
  });
  it("matches the protocol golden canonical bytes in PostgreSQL",async()=>{
    const vector=JSON.parse(readFileSync(new URL("../../../../packages/protocol/test-vectors/execution-context/valid.json",import.meta.url),"utf8"));
    for(const [value,domain,hex] of [[vector.response.context,"GOODDEALER-DESKTOP-EXECUTION-CONTEXT-ENVELOPE-V1",vector.contextEnvelopeHex],[vector.response.grant,"GOODDEALER-DESKTOP-EXECUTION-AUTHORIZATION-V1",vector.authorizationDigestInputHex]]){
      const encoded=await ownerPool.query("SELECT public.device_execution_context_frame('d',convert_to($1,'UTF8')) || public.device_execution_context_frame('v',public.device_execution_context_value($2::jsonb,0)) AS bytes",[domain,value]);
      expect(encoded.rows[0].bytes.toString("hex")).toBe(hex);
    }
  });
  it("rejects forged selectors and mismatched JSON/bytes even with an authentic account capability",async()=>{
    const principal=await desktopGrantPrincipal();const result=await contextService().issue(request(32),principal);if(result===null)throw new Error("context refused");
    for(const mutation of ["workspace","device","context-bytes","grant-bytes"]){
      await expect(identityTransactions.withAccountCredential(principal.transactionCredential,"devices_account",async tx=>{
        const context={...result.context};const grant=structuredClone(result.grant);
        if(mutation==="workspace"){context.workspaceId="other-workspace";grant.workspace.workspaceId="other-workspace";}
        if(mutation==="device"){context.deviceId="other-device";grant.activeDeviceLease.deviceId="other-device";}
        await tx.query("SELECT set_config('gooddealer.workspace_id',$1,true)",[context.workspaceId]);
        const cb=Buffer.from(encodeDesktopExecutionContextEnvelope(context));const gb=Buffer.from(encodeDesktopExecutionAuthorizationDigestInput(grant));
        if(mutation==="context-bytes")cb[cb.length-1]=cb[cb.length-1]!^1;if(mutation==="grant-bytes")gb[gb.length-1]=gb[gb.length-1]!^1;
        await tx.query("SELECT public.device_execution_context_append($1::jsonb,$2::jsonb,$3::bytea,$4::bytea,$5::bytea,$6::bytea,$7::bytea)",[context,grant,cb,gb,devicePublicKey,Buffer.alloc(32),Buffer.alloc(32)]);
      })).rejects.toMatchObject({code:"42501"});
    }
    const client=await appPool.connect();try{
      await client.query("BEGIN");await client.query("SELECT set_config('gooddealer.account_id','oauth-account',true),set_config('gooddealer.workspace_id','oauth-workspace',true)");
      await expect(client.query("SELECT * FROM device_execution_contexts")).rejects.toMatchObject({code:"42501"});
    }finally{await client.query("ROLLBACK");client.release();}
    await expect(accountApiPool.query("SELECT * FROM device_execution_contexts")).resolves.toMatchObject({rows:[]});
    expect((await ownerPool.query("SELECT * FROM device_execution_contexts")).rowCount).toBe(1);
  });
  it("refuses a context signer response after the real 30-second freshness window",async()=>{
    const principal=await desktopGrantPrincipal();
    const delayed:DesktopExecutionContextSigner={async sign(input){const signed=await contextSigner.sign(input);await new Promise(resolve=>setTimeout(resolve,30100));return signed;}};
    await expect(contextService(delayed).issue(request(33),principal)).resolves.toBeNull();
    expect((await ownerPool.query("SELECT * FROM device_execution_contexts")).rowCount).toBe(0);
  },40000);
  it("rechecks access expiry with live time after M019 admitted the transaction",async()=>{
    const principal=await desktopGrantPrincipal();let current:AccountTransaction|undefined;
    const txs:Pick<IdentityCapabilityTransactionRunner,"withAccountCredential">={withAccountCredential:(credential,purpose,operation)=>identityTransactions.withAccountCredential(credential,purpose,async tx=>{current=tx;return operation(tx);})};
    const expiring:DesktopExecutionContextSigner={async sign(input){
      const result=await contextSigner.sign(input);if(current===undefined)throw new Error("transaction missing");
      await current.query("UPDATE identity_credential_jtis SET expires_at=clock_timestamp()+interval '100 milliseconds' WHERE account_id='oauth-account' AND kind='access'");
      await current.query("SELECT pg_sleep(0.2)");return result;
    }};
    const service=new PostgresDesktopExecutionContextService(txs,new PostgresDefaultWorkspaceTenantResolver(identityTransactions),new DesktopAuthorizationGrantIssuer(grantSigner),leaseVerifier,new DesktopExecutionContextIssuer(expiring));
    await expect(service.issue(request(34),principal)).resolves.toBeNull();
    expect((await ownerPool.query("SELECT * FROM device_execution_contexts")).rowCount).toBe(0);
  });
  it("commits one concurrent repeated nonce and preserves immutable evidence after a lost reply", async () => {
    const principal = await desktopGrantPrincipal();
    const service = contextService();
    const results = await Promise.all([service.issue(request(26),principal),service.issue(request(26),principal)]);
    expect(results.filter(v=>v!==null)).toHaveLength(1);
    expect((await ownerPool.query("SELECT * FROM device_execution_contexts")).rowCount).toBe(1);
    await expect(service.issue(request(27),principal)).resolves.not.toBeNull();
  });
});

describe("PostgreSQL Desktop OAuth and refresh persistence", () => {
  it("resolves a public session only through the identity-owned verification function", async () => {
    const reader = new PostgresIdentitySessionVerificationReader(appPool);
    await expect(reader.readSessionVerification("web-session-live")).resolves.toMatchObject({
      sessionId: "web-session-live",
      accountId: "oauth-account",
      clientKind: "account_web",
      sessionAccountSecurityEpoch: 1,
      currentAccountSecurityEpoch: 1,
      familyState: "active",
    });
    await expect(reader.readSessionVerification("missing-session")).resolves.toBeNull();
  });

  it("enrolls a first device only after its proposed key proves possession", async () => {
    await ownerPool.query(`DELETE FROM device_signing_keys WHERE account_id = 'oauth-account';
      DELETE FROM device_bindings WHERE account_id = 'oauth-account'`);
    const code = await authorize(new Date());
    expect(code).toMatch(/^gd_ac1\./u);
    const stored = await ownerPool.query<{
      device_id: string;
      slot: number;
      key_id: string;
      public_key_matches: boolean;
    }>(`SELECT b.device_id, b.slot, k.key_id, k.public_key = $1 AS public_key_matches
          FROM device_bindings b JOIN device_signing_keys k USING (account_id, device_id)
         WHERE b.account_id = 'oauth-account'`, [devicePublicKey]);
    expect(stored.rows).toEqual([{
      device_id: "device-a",
      slot: 1,
      key_id: "device-key-a",
      public_key_matches: true,
    }]);
  });

  it("requires recent password or passkey authentication for first-device enrollment", async () => {
    await ownerPool.query(`DELETE FROM device_signing_keys WHERE account_id = 'oauth-account';
      DELETE FROM device_bindings WHERE account_id = 'oauth-account';
      UPDATE identity_auth_sessions
         SET created_at = transaction_timestamp() - interval '10 minutes'
       WHERE account_id = 'oauth-account' AND session_id = 'web-session-live'`);
    await expect(oauth.authorize({
      principal,
      deviceId: "device-a",
      clientId: DESKTOP_OAUTH_CLIENT_ID,
      redirectUri: LOOPBACK_REDIRECT_URI,
      codeChallenge: challenge,
      codeChallengeMethod: "S256",
      keyId: "device-key-a",
      publicKey: devicePublicKey.toString("base64url"),
      evaluatedAt: new Date(),
    })).resolves.toEqual({ authorized: false });
    const stored = await ownerPool.query<{ challenges: string; bindings: string }>(`SELECT
      (SELECT count(*) FROM device_login_challenges)::text AS challenges,
      (SELECT count(*) FROM device_bindings)::text AS bindings`);
    expect(stored.rows).toEqual([{ challenges: "0", bindings: "0" }]);
  });

  it("binds both browser authorization legs to the same Account Web session", async () => {
    await ownerPool.query(`INSERT INTO identity_auth_sessions
      (account_id, session_id, client_kind, auth_method, remember_device, epoch_at_issue, expires_at)
      VALUES ('oauth-account', 'other-web-session', 'account_web', 'password', true, 1,
        transaction_timestamp() + interval '1 hour');
      INSERT INTO identity_refresh_families
        (account_id, family_id, session_id, current_refresh_jti)
      VALUES ('oauth-account', 'other-web-family', 'other-web-session', 'other-web-refresh-jti')`);
    const { base, challenged, transcript } = await beginAuthorization(new Date());
    await expect(oauth.authorize({
      ...base,
      principal: { ...principal, sessionId: "other-web-session" },
      proof: {
        challengeId: challenged.challenge.challengeId,
        signature: sign(null, transcript, deviceKeyPair.privateKey).toString("base64url"),
      },
    })).resolves.toEqual({ authorized: false });
    await expect(completeAuthorization(base, challenged, transcript)).resolves.toMatchObject({ authorized: true });
  });

  it("does not consume a device challenge for a substituted signature", async () => {
    const { base, challenged, transcript } = await beginAuthorization(new Date());
    const denied = await oauth.authorize({
      ...base,
      proof: {
        challengeId: challenged.challenge.challengeId,
        signature: sign(null, Buffer.from("substituted"), deviceKeyPair.privateKey).toString("base64url"),
      },
    });
    expect(denied).toEqual({ authorized: false });
    const accepted = await completeAuthorization(base, challenged, transcript);
    expect(accepted.authorized).toBe(true);
  });

  it("does not consume a code for the wrong verifier and consumes it exactly once under concurrency", async () => {
    const code = await authorize(new Date());
    await expect(oauth.exchange(exchangeInput(code, "W".repeat(64)))).resolves.toEqual({ exchanged: false });
    const [first, second] = await Promise.all([
      oauth.exchange(exchangeInput(code, verifier)),
      oauth.exchange(exchangeInput(code, verifier)),
    ]);
    expect([first.exchanged, second.exchanged].sort()).toEqual([false, true]);
    const counts = await transactions.withAccount("oauth-account", (transaction) => transaction.query<{
      codes: string;
      sessions: string;
      families: string;
      leases: string;
      allocations: string;
    }>(`SELECT
      (SELECT count(*) FROM identity_desktop_authorization_codes WHERE consumed_at IS NOT NULL)::text AS codes,
      (SELECT count(*) FROM identity_auth_sessions WHERE client_kind = 'desktop')::text AS sessions,
      (SELECT count(*) FROM identity_refresh_families f
        JOIN identity_auth_sessions a USING (account_id, session_id)
       WHERE a.client_kind = 'desktop')::text AS families,
      (SELECT count(*) FROM device_active_leases WHERE released_at IS NULL)::text AS leases,
      (SELECT count(*) FROM device_lease_epoch_allocations
        WHERE allocation_source = 'desktop_login' AND status = 'activated')::text AS allocations`));
    expect(counts.rows[0]).toEqual({
      codes: "1", sessions: "1", families: "1", leases: "1", allocations: "1",
    });
    const persisted = await ownerPool.query<{ wire_envelope: unknown }>(
      "SELECT wire_envelope FROM device_active_leases WHERE account_id = 'oauth-account'",
    );
    const envelope = activeDeviceLeaseEnvelopeSchema.parse(persisted.rows[0]?.wire_envelope);
    expect(verify(
      null,
      encodeActiveDeviceLeaseSignatureTranscript(envelope),
      leaseAuthority.publicKey,
      Buffer.from(envelope.signature, "base64url"),
    )).toBe(true);
  });

  it("reuses the current same-device Lease without allocating another epoch", async () => {
    const firstCode = await authorize(new Date());
    const first = await oauth.exchange(exchangeInput(firstCode, verifier));
    expect(first.exchanged).toBe(true);
    const secondCode = await authorize(new Date());
    const second = await oauth.exchange(exchangeInput(secondCode, verifier));
    expect(second.exchanged).toBe(true);
    const stored = await ownerPool.query<{ lease_epoch: string; allocations: string; highest: string }>(`SELECT
      l.lease_epoch::text, (SELECT count(*) FROM device_lease_epoch_allocations)::text AS allocations,
      s.highest_allocated_lease_epoch::text AS highest
      FROM device_active_leases l JOIN device_account_states s USING (account_id)
      WHERE l.account_id = 'oauth-account' AND l.released_at IS NULL`);
    expect(stored.rows).toEqual([{ lease_epoch: "1", allocations: "1", highest: "1" }]);
  });

  it("resolves a lost first switch response by its own source key after becoming Standby",async()=>{
    const current=await desktopGrantPrincipal();const target=await loginStandbyDevice();
    const requests=new PostgresDeviceSwitchRequests({transactions:new TenantTransactionRunner(appPool),accountSecurity:new PostgresIdentityAccountSecurityStatePort()});
    const resolution=new PostgresDeviceSwitchRequestResolution(identityTransactions,new PostgresDefaultWorkspaceTenantResolver(identityTransactions));
    const source={accountId:"oauth-account",workspaceId:"oauth-workspace",deviceId:"device-a"};
    const input={toDeviceId:"device-b",idempotencyKey:"lost-first-response",expectedSourceLeaseEpoch:1};
    const opened=await requests.requestNormal(source,input);if(opened===null||!opened.accepted)throw new Error("switch refused");
    const query={schemaVersion:1,idempotencyKey:input.idempotencyKey};
    await expect(resolution.resolve(query,current)).resolves.toMatchObject({outcome:"found",idempotencyKey:input.idempotencyKey,sourceLeaseEpoch:1,request:opened.request,targetSigningKeyVersion:1});
    await expect(resolution.resolve(query,target.principal)).resolves.toEqual({schemaVersion:1,outcome:"not_found",idempotencyKey:input.idempotencyKey});
    await expect(resolution.resolve(query,{...current,accountId:"other-account"})).resolves.toBeNull();
    await expect(resolution.resolve({...query,workspaceId:"chosen"},current)).rejects.toThrow();
    await expect(ownerPool.query("UPDATE device_switch_workflows SET source_lease_epoch=2 WHERE idempotency_key='lost-first-response'")).rejects.toMatchObject({code:"55000"});
    await requests.cancel(source,opened.request.requestId);await releaseHeldLease();await loginStandbyDevice();
    await expect(resolution.resolve(query,current)).resolves.toMatchObject({outcome:"found",sourceLeaseEpoch:1,request:{status:"cancelled",fromDeviceId:"device-a",toDeviceId:"device-b"}});
    await expect(resolution.resolve({schemaVersion:1,idempotencyKey:"never-created"},current)).resolves.toEqual({schemaVersion:1,outcome:"not_found",idempotencyKey:"never-created"});
    expect((await ownerPool.query("SELECT count(*) FROM device_switch_workflows")).rows[0].count).toBe("1");
  });
  it("rejects a delayed first switch POST after a real new source Lease epoch and preserves authoritative absence",async()=>{
    const current=await desktopGrantPrincipal();await loginStandbyDevice();
    await releaseHeldLease();await leaseManager.ensureCurrentLease({accountId:"oauth-account",deviceId:"device-a",accountSecurityEpoch:1,transactionCredential:current.transactionCredential});
    const requests=new PostgresDeviceSwitchRequests({transactions:new TenantTransactionRunner(appPool),accountSecurity:new PostgresIdentityAccountSecurityStatePort()});
    const source={accountId:"oauth-account",workspaceId:"oauth-workspace",deviceId:"device-a"};
    const delayed={toDeviceId:"device-b",idempotencyKey:"delayed-old-epoch",expectedSourceLeaseEpoch:1};
    await expect(requests.requestNormal(source,delayed)).resolves.toEqual({schemaVersion:1,accepted:false,code:"SOURCE_LEASE_CHANGED"});
    const resolution=new PostgresDeviceSwitchRequestResolution(identityTransactions,new PostgresDefaultWorkspaceTenantResolver(identityTransactions));
    await expect(resolution.resolve({schemaVersion:1,idempotencyKey:delayed.idempotencyKey},current)).resolves.toEqual({schemaVersion:1,outcome:"not_found",idempotencyKey:delayed.idempotencyKey});
    expect((await ownerPool.query("SELECT count(*) FROM device_switch_workflows")).rows[0].count).toBe("0");
    const fresh={...delayed,idempotencyKey:"fresh-confirmed-epoch",expectedSourceLeaseEpoch:2};
    const created=await requests.requestNormal(source,fresh);expect(created).toMatchObject({accepted:true});
    expect(await requests.requestNormal(source,fresh)).toEqual(created);
    await expect(resolution.resolve({schemaVersion:1,idempotencyKey:fresh.idempotencyKey},current)).resolves.toMatchObject({outcome:"found",sourceLeaseEpoch:2});
    await ownerPool.query("UPDATE device_switch_workflows SET state_deadline=created_at WHERE idempotency_key='fresh-confirmed-epoch'");
    await expect(requests.requestNormal(source,{...delayed,idempotencyKey:"stale-cannot-expire-existing"})).resolves.toMatchObject({accepted:false,code:"SOURCE_LEASE_CHANGED"});
    expect((await ownerPool.query("SELECT status,workflow_revision::text FROM device_switch_workflows")).rows).toEqual([{status:"draining",workflow_revision:"1"}]);
    if(created===null||!created.accepted)throw new Error("fresh request missing");
    const cancelled=await requests.cancel(source,created.request.requestId);
    await releaseHeldLease();await leaseManager.ensureCurrentLease({accountId:"oauth-account",deviceId:"device-a",accountSecurityEpoch:1,transactionCredential:current.transactionCredential});
    expect(await requests.requestNormal(source,fresh)).toEqual(cancelled);
    await expect(resolution.resolve({schemaVersion:1,idempotencyKey:fresh.idempotencyKey},current)).resolves.toMatchObject({outcome:"found",sourceLeaseEpoch:2,request:{status:"cancelled"}});
    expect((await ownerPool.query("SELECT count(*) FROM device_switch_workflows")).rows[0].count).toBe("1");
  });
  it("serializes request resolution behind a first POST holding the actual source locks",async()=>{
    const current=await desktopGrantPrincipal();await loginStandbyDevice();
    let entered!:()=>void;let release!:()=>void;
    const blocked=new Promise<void>(resolve=>{entered=resolve;});const gate=new Promise<void>(resolve=>{release=resolve;});
    const real=new TenantTransactionRunner(appPool);
    const transactions:Pick<TenantTransactionRunner,"withTenant">={withTenant:async(scope,work)=>real.withTenant(scope,async tx=>work(new Proxy(tx,{get(target,key){
      if(key==="query")return async(sql:string,parameters:unknown[])=>{if(sql.includes("INSERT INTO device_switch_workflows")){entered();await gate;}return target.query(sql,parameters);};
      return Reflect.get(target,key);
    }})))};
    const requests=new PostgresDeviceSwitchRequests({transactions,accountSecurity:new PostgresIdentityAccountSecurityStatePort()});
    const pending=requests.requestNormal({accountId:"oauth-account",workspaceId:"oauth-workspace",deviceId:"device-a"},{toDeviceId:"device-b",idempotencyKey:"concurrent-first-response",expectedSourceLeaseEpoch:1});
    await blocked;
    const resolution=new PostgresDeviceSwitchRequestResolution(identityTransactions,new PostgresDefaultWorkspaceTenantResolver(identityTransactions));
    let completed=false;const read=resolution.resolve({schemaVersion:1,idempotencyKey:"concurrent-first-response"},current).then(value=>{completed=true;return value;});
    await new Promise(resolve=>setTimeout(resolve,60));expect(completed).toBe(false);
    release();await expect(pending).resolves.toMatchObject({accepted:true});
    await expect(read).resolves.toMatchObject({outcome:"found",sourceLeaseEpoch:1,request:{status:"draining"}});
  });
  it("resolves owner-retained legacy switch history without inventing a source epoch",async()=>{
    const current=await desktopGrantPrincipal();await loginStandbyDevice();await insertSwitchWorkflow("draining");
    const resolution=new PostgresDeviceSwitchRequestResolution(identityTransactions,new PostgresDefaultWorkspaceTenantResolver(identityTransactions));
    await expect(resolution.resolve({schemaVersion:1,idempotencyKey:"switch-guard-key"},current)).resolves.toMatchObject({outcome:"found",sourceLeaseEpoch:null,request:{requestId:"switch-guard"}});
    await ownerPool.query("UPDATE identity_refresh_families SET state='revoked' WHERE account_id='oauth-account' AND session_id=$1",[current.sessionId]);
    await expect(resolution.resolve({schemaVersion:1,idempotencyKey:"switch-guard-key"},current)).resolves.toBeNull();
  });
  it("starts normal handoff from a real OAuth Lease only in its resolved default workspace", async () => {
    await desktopGrantPrincipal();
    await loginStandbyDevice();
    const requests = new PostgresDeviceSwitchRequests({ transactions: new TenantTransactionRunner(appPool),
      accountSecurity: new PostgresIdentityAccountSecurityStatePort() });
    const source = { accountId: "oauth-account", workspaceId: "oauth-workspace", deviceId: "device-a" };
    await expect(requests.requestNormal({ ...source, workspaceId: "foreign-workspace" },
      { toDeviceId: "device-b", idempotencyKey: "oauth-foreign-switch",expectedSourceLeaseEpoch:1 })).resolves.toBeNull();
    await expect(requests.requestNormal(source, { toDeviceId: "device-b", idempotencyKey: "oauth-normal-switch",expectedSourceLeaseEpoch:1 }))
      .resolves.toMatchObject({ accepted: true, request: { schemaVersion: 2, fromDeviceId: "device-a", toDeviceId: "device-b",
        status: "draining", normalHandoffReceipt: null } });
  });

  it("completes second-device OAuth, Standby exchange and refresh without commercial or Lease escalation", async () => {
    await desktopGrantPrincipal();
    const standby = await loginStandbyDevice();
    await applyEntitlementState("suspended", "standby-no-entitlement", 2);
    const service = authorizationService();
    await expect(service.issue({ schemaVersion: 5 }, standby.principal)).resolves.toMatchObject({
      schemaVersion: 5, role: "standby", grant: { accountId: "oauth-account", deviceId: "device-b",
        leaseEpochFloor: 1, scopes: ["workspace:read"] },
    });
    const sync = new PostgresDesktopSyncAuthority(transactions);
    await expect(sync.resolveSessionDevice(standby.principal, "oauth-workspace")).resolves.toEqual({ deviceId: "device-b", role: "standby" });
    await expect(sync.resolveSessionDevice(standby.principal, "other-workspace")).resolves.toBeNull();
    await expect(sync.resolveActiveDevice(standby.principal, "oauth-workspace")).resolves.toBeNull();
    const gate = new PostgresDesktopRouteAuthority(new PostgresDefaultWorkspaceTenantResolver(transactions), sync);
    await expect(gate.authorize(standby.principal, "active_or_standby")).resolves.toBe(true);
    await expect(gate.authorize(standby.principal, "active")).resolves.toBe(false);
    const rotated = await refresh.rotate({ refreshToken: standby.refreshToken, deviceId: "device-b", requestId: "standby-refresh", evaluatedAt: new Date() });
    expect(rotated.rotated).toBe(true);
    const counts = await ownerPool.query(`SELECT
      (SELECT count(*)::text FROM device_active_leases WHERE released_at IS NULL) AS held,
      (SELECT count(*)::text FROM device_lease_epoch_allocations) AS allocated`);
    expect(counts.rows).toEqual([{ held: "1", allocated: "1" }]);
  });

  it("issues Standby without any Lease or entitlement and refuses revoked eligibility", async () => {
    await applyEntitlementState("suspended", "standby-no-entitlement", 2);
    const caller = await desktopGrantPrincipal();
    const service = authorizationService();
    await expect(service.issue({ schemaVersion: 5 }, caller)).resolves.toMatchObject({ role: "standby", grant: { leaseEpochFloor: 0 } });
    expect((await ownerPool.query("SELECT count(*)::text AS count FROM device_lease_epoch_allocations")).rows).toEqual([{ count: "0" }]);
    await ownerPool.query("UPDATE device_signing_keys SET status = 'revoked' WHERE account_id = 'oauth-account'");
    await expect(service.issue({ schemaVersion: 5 }, caller)).resolves.toBeNull();
  });

  it("rechecks a Standby session deadline after its external signer returns", async () => {
    await applyEntitlementState("suspended", "standby-no-entitlement", 2);
    const caller = await desktopGrantPrincipal();
    const expires = await ownerPool.query<{ expires_at: Date }>(`UPDATE identity_auth_sessions
      SET expires_at = date_trunc('second', clock_timestamp()) + interval '3 seconds'
      WHERE account_id = 'oauth-account' AND session_id = $1 RETURNING expires_at`, [caller.sessionId]);
    const deadline = expires.rows[0]?.expires_at;
    if (deadline === undefined) throw new Error("session missing");
    const blocker = blockingStandbySigner();
    const issue = authorizationService(blocker.signer).issue({ schemaVersion: 5 }, caller);
    await blocker.started;
    try { await waitForDatabaseDeadline(deadline); } finally { blocker.release(); }
    await expect(issue).resolves.toBeNull();
  });

  it.each([
    ["key", "UPDATE device_signing_keys SET status = 'revoked' WHERE account_id = 'oauth-account'"],
    ["binding", "UPDATE device_bindings SET status = 'removed', slot = NULL, removed_at = clock_timestamp(), removal_reason = 'test' WHERE account_id = 'oauth-account'"],
  ])("serializes Standby issuance with concurrent %s revocation", async (kind, sql) => {
    await applyEntitlementState("suspended", "standby-no-entitlement", 2);
    const caller = await desktopGrantPrincipal();
    const blocker = blockingStandbySigner();
    const service = authorizationService(blocker.signer);
    const issue = service.issue({ schemaVersion: 5 }, caller);
    await blocker.started;
    const marker = `standby_${kind}_revocation`;
    const mutation = ownerPool.query(`${sql} /* ${marker} */`);
    try { await waitForBlockedQuery(marker); } finally { blocker.release(); }
    await expect(issue).resolves.toMatchObject({ role: "standby" });
    await mutation;
    await expect(service.issue({ schemaVersion: 5 }, caller)).resolves.toBeNull();
  });

  it("reserves an exact bootstrap target's pending epoch without lowering the source floor", async () => {
    const source = await desktopGrantPrincipal();
    const target = await loginStandbyDevice();
    await releaseHeldLease();
    await insertSwitchWorkflow("bootstrapping", 2);
    await insertBootstrapCapability(false);
    await ownerPool.query(`INSERT INTO device_lease_epoch_allocations
      (account_id, workspace_id, workflow_id, lease_epoch, status)
      VALUES ('oauth-account', 'oauth-workspace', 'switch-guard', 2, 'pending');
      UPDATE device_account_states SET highest_allocated_lease_epoch = 2 WHERE account_id = 'oauth-account'`);
    const service = authorizationService();
    await expect(service.issue({ schemaVersion: 5 }, target.principal)).resolves.toMatchObject({ role: "standby", grant: { leaseEpochFloor: 1 } });
    await expect(service.issue({ schemaVersion: 5 }, source)).resolves.toMatchObject({ role: "standby", grant: { leaseEpochFloor: 2 } });
    await ownerPool.query("UPDATE device_switch_workflows SET bound_key_version = 2 WHERE account_id = 'oauth-account'");
    await expect(service.issue({ schemaVersion: 5 }, target.principal)).resolves.toBeNull();
  });

  it("revalidates final session authority and the persisted signed Lease before issuing a Grant", async () => {
    const desktopPrincipal = await desktopGrantPrincipal();
    const sessionId = desktopPrincipal.sessionId;
    const service = new PostgresDesktopAuthorizationApplicationService(
      identityTransactions,
      new PostgresDefaultWorkspaceTenantResolver(identityTransactions),
      new DesktopAuthorizationGrantIssuer(grantSigner),
      leaseVerifier,
      new DesktopStandbyGrantIssuer(standbyGrantSigner),
    );
    await expect(service.issue({ schemaVersion: 5 }, desktopPrincipal)).resolves.toMatchObject({
      schemaVersion: 5, role: "active", grant: { activeDeviceLease: { accountId: "oauth-account", accountSecurityEpoch: 1 } },
    });

    await ownerPool.query(`UPDATE identity_auth_sessions
         SET created_at = transaction_timestamp() - interval '1 hour',
             expires_at = transaction_timestamp() - interval '1 second'
       WHERE account_id = 'oauth-account' AND session_id = $1`, [sessionId]);
    await expect(service.issue({ schemaVersion: 5 }, desktopPrincipal)).resolves.toBeNull();
    await ownerPool.query(`UPDATE identity_auth_sessions SET expires_at = NULL
       WHERE account_id = 'oauth-account' AND session_id = $1`, [sessionId]);
    await ownerPool.query(`UPDATE identity_refresh_families SET state = 'revoked'
       WHERE account_id = 'oauth-account' AND session_id = $1`, [sessionId]);
    await expect(service.issue({ schemaVersion: 5 }, desktopPrincipal)).resolves.toBeNull();
    await ownerPool.query(`UPDATE identity_refresh_families SET state = 'active'
       WHERE account_id = 'oauth-account' AND session_id = $1`, [sessionId]);
    await ownerPool.query(`UPDATE device_active_leases
         SET released_at = transaction_timestamp(), release_reason = 'lease_verifier_upgrade',
             wire_envelope = NULL, signer_receipt_digest = NULL
       WHERE account_id = 'oauth-account'`);
    await expect(service.issue({ schemaVersion: 5 }, desktopPrincipal)).resolves.toMatchObject({ role: "standby" });
    await expect(leaseManager.ensureCurrentLease({
      accountId: "oauth-account", deviceId: "device-a", accountSecurityEpoch: 1,
      transactionCredential: principal.transactionCredential,
    })).resolves.toMatchObject({ outcome: "active" });
    await ownerPool.query(`UPDATE device_active_leases
         SET wire_envelope = jsonb_set(wire_envelope, '{signature}', to_jsonb($1::text))
       WHERE account_id = 'oauth-account'`, [Buffer.alloc(64).toString("base64url")]);
    await expect(service.issue({ schemaVersion: 5 }, desktopPrincipal)).resolves.toBeNull();
    await expect(leaseManager.ensureCurrentLease({
      accountId: "oauth-account", deviceId: "device-a", accountSecurityEpoch: 1,
      transactionCredential: principal.transactionCredential,
    })).resolves.toEqual({ outcome: "refused" });
  });

  it("refuses a security-ended epoch and never reopens it by restoring status", async () => {
    const desktopPrincipal = await desktopGrantPrincipal();
    await ownerPool.query("UPDATE identity_account_security_states SET status='recovery_pending' WHERE account_id='oauth-account'");
    await expect(authorizationService().issue({schemaVersion:5},desktopPrincipal)).resolves.toBeNull();
    await expect(ownerPool.query("UPDATE identity_account_security_states SET status='normal' WHERE account_id='oauth-account'")).rejects.toMatchObject({code:"42501"});
    await ownerPool.query("UPDATE identity_account_security_states SET status='normal',account_security_epoch=2 WHERE account_id='oauth-account'");
    await expect(ownerPool.query("UPDATE identity_account_security_states SET account_security_epoch=1 WHERE account_id='oauth-account'")).rejects.toMatchObject({code:"42501"});
  });

  it("derives Provider capabilities from current Licensing revisions without upgrading old rights", async () => {
    const principal = await desktopGrantPrincipal();
    const service = authorizationService();
    const first = await service.issue({ schemaVersion: 5 }, principal);
    expect(first).toMatchObject({ role: "active", grant: { schemaVersion: 4,
      commercialAuthority: { schemaVersion: 2, capabilities: ["cloudflare:dns:observe"] } } });
    const capabilities = ["afternic:marketplace:observe", "afternic:marketplace:write", "cloudflare:dns:observe"];
    await applyEntitlementState("active", "features-expanded", 2, capabilities);
    const expanded = await service.issue({ schemaVersion: 5 }, principal);
    expect(expanded).toMatchObject({ role: "active", grant: { commercialAuthority: {
      entitlementRevision: 2, capabilities,
    } } });
    await applyEntitlementState("active", "features-removed", 3, ["feature:portfolio"]);
    const local = await service.issue({ schemaVersion: 5 }, principal);
    expect(local).toMatchObject({ role: "active", grant: { commercialAuthority: {
      entitlementRevision: 3, capabilities: [],
    } } });
    if (expanded?.role !== "active" || local?.role !== "active") throw new Error("expected Active Grants");
    expect(local.grant.commercialAuthority.entitlementProjectionDigest)
      .not.toBe(expanded.grant.commercialAuthority.entitlementProjectionDigest);
    const owner = await ownerPool.connect();
    try {
      await owner.query("BEGIN");
      await owner.query("SET LOCAL ROLE gd_licensing_owner");
      const historical = await owner.query<{ feature_entitlements: string[] }>(
        "SELECT feature_entitlements FROM licensing_private.commercial_rights WHERE account_id='oauth-account' AND right_id='00000000-0000-4000-8000-000000000001'",
      );
      expect(historical.rows[0]?.feature_entitlements).toEqual(["cloudflare:dns:observe", "workspace:mutate"]);
    } finally {
      await owner.query("ROLLBACK");
      owner.release();
    }
    await applyEntitlementState("active", "write-without-observe", 4, ["afternic:marketplace:write"]);
    await expect(service.issue({ schemaVersion: 5 }, principal)).resolves.toBeNull();
  });

  it("refuses a Grant when the Desktop session expires while the signer is blocked", async () => {
    const desktopPrincipal = await desktopGrantPrincipal();
    const deadlineResult = await ownerPool.query<{ expires_at: Date }>(`UPDATE identity_auth_sessions
         SET expires_at = date_trunc('second', clock_timestamp()) + interval '6 seconds'
       WHERE account_id = 'oauth-account' AND session_id = $1
       RETURNING expires_at`, [desktopPrincipal.sessionId]);
    const deadline = deadlineResult.rows[0]?.expires_at;
    if (!(deadline instanceof Date)) throw new Error("desktop session deadline fixture is unavailable");
    const blocker = blockingGrantSigner();
    const service = new PostgresDesktopAuthorizationApplicationService(
      identityTransactions,
      new PostgresDefaultWorkspaceTenantResolver(identityTransactions),
      new DesktopAuthorizationGrantIssuer(blocker.signer),
      leaseVerifier,
      new DesktopStandbyGrantIssuer(standbyGrantSigner),
    );

    const issue = service.issue({ schemaVersion: 5 }, desktopPrincipal);
    await blocker.started;
    try {
      await waitForDatabaseDeadline(deadline);
    } finally {
      blocker.release();
    }

    await expect(issue).resolves.toBeNull();
  }, 20_000);

  it("refuses a Grant when the signed Lease online deadline passes while the signer is blocked", async () => {
    const desktopPrincipal = await desktopGrantPrincipal();
    const deadlines = await ownerPool.query<{
      issued_at: Date;
      renew_after: Date;
      online_expires_at: Date;
      offline_execute_until: Date;
    }>(`SELECT
         date_trunc('second', clock_timestamp()) - interval '2 seconds' AS issued_at,
         date_trunc('second', clock_timestamp()) - interval '1 second' AS renew_after,
         date_trunc('second', clock_timestamp()) + interval '6 seconds' AS online_expires_at,
         date_trunc('second', clock_timestamp()) + interval '1 minute' AS offline_execute_until`);
    const window = deadlines.rows[0];
    if (window === undefined) throw new Error("Lease deadline fixture is unavailable");
    await replacePersistedLeaseWindow(window);
    const blocker = blockingGrantSigner();
    const service = new PostgresDesktopAuthorizationApplicationService(
      identityTransactions,
      new PostgresDefaultWorkspaceTenantResolver(identityTransactions),
      new DesktopAuthorizationGrantIssuer(blocker.signer),
      leaseVerifier,
      new DesktopStandbyGrantIssuer(standbyGrantSigner),
    );

    const issue = service.issue({ schemaVersion: 5 }, desktopPrincipal);
    await blocker.started;
    try {
      await waitForDatabaseDeadline(window.online_expires_at);
    } finally {
      blocker.release();
    }

    await expect(issue).resolves.toBeNull();
  }, 20_000);

  it.each([
    ["security", `UPDATE identity_account_security_states SET status = 'recovery_pending'
       WHERE account_id = 'oauth-account'`],
    ["session", `UPDATE identity_auth_sessions
       SET revoked_at = clock_timestamp(), revocation_reason = 'test_concurrent_revoke'
       WHERE account_id = 'oauth-account' AND client_kind = 'desktop'`],
    ["family", `UPDATE identity_refresh_families
       SET state = 'revoked', revoked_at = clock_timestamp(), revocation_reason = 'test_concurrent_revoke'
       WHERE account_id = 'oauth-account' AND session_id IN
         (SELECT session_id FROM identity_auth_sessions WHERE account_id = 'oauth-account' AND client_kind = 'desktop')`],
    ["workspace binding", `DELETE FROM workspace_account_bindings
       WHERE account_id = 'oauth-account' AND workspace_id = 'oauth-workspace'`],
    ["Lease", `UPDATE device_active_leases
       SET released_at = clock_timestamp(), release_reason = 'test_concurrent_release'
       WHERE account_id = 'oauth-account' AND released_at IS NULL`],
  ] as const)("linearizes a Grant before a concurrent %s change blocked during signing", async (name, mutationSql) => {
    const desktopPrincipal = await desktopGrantPrincipal();
    let announceSigning!: () => void;
    let releaseSigning!: () => void;
    const signingStarted = new Promise<void>((resolve) => { announceSigning = resolve; });
    const signingGate = new Promise<void>((resolve) => { releaseSigning = resolve; });
    const blockingSigner: DesktopAuthorizationGrantSigner = {
      async sign(input) {
        announceSigning();
        await signingGate;
        return grantSigner.sign(input);
      },
    };
    const service = new PostgresDesktopAuthorizationApplicationService(
      identityTransactions,
      new PostgresDefaultWorkspaceTenantResolver(identityTransactions),
      new DesktopAuthorizationGrantIssuer(blockingSigner),
      leaseVerifier,
      new DesktopStandbyGrantIssuer(standbyGrantSigner),
    );
    const issue = service.issue({ schemaVersion: 5 }, desktopPrincipal);
    await signingStarted;
    const marker = `desktop_grant_linearization_${name.replaceAll(" ", "_")}`;
    const mutation = ownerPool.query(`${mutationSql} /* ${marker} */`);
    let waitError: unknown;
    try {
      await waitForBlockedQuery(marker);
    } catch (error) {
      waitError = error;
    } finally {
      releaseSigning();
    }
    const grant = await issue;
    await mutation;
    if (waitError !== undefined) throw waitError;
    expect(grant).toMatchObject({
      schemaVersion: 5, role: "active", grant: {
        workspace: { workspaceId: "oauth-workspace", kind: "personal_default" },
        activeDeviceLease: { accountId: "oauth-account", deviceId: "device-a" },
      },
    });
  });

  it("does not expose an authorization code or create a session when Lease signing fails", async () => {
    const refusing = new PostgresDesktopOAuthAuthorizationService(
      transactions,
      authentication,
      new PostgresDeviceLoginProof(transactions),
      new PostgresDesktopLoginLease({
        transactions,
        entitlement: new PostgresEntitlementDeadlineReader(identityTransactions),
        signer: { async sign() { return { signed: false }; } },
        verifier: leaseVerifier,
        bootstrapExpiry,
      }),
      identityTransactions,
    );
    const { base, challenged, transcript } = await beginAuthorization(new Date(), refusing);
    await expect(completeAuthorization(base, challenged, transcript, refusing))
      .resolves.toEqual({ authorized: false });
    const stored = await ownerPool.query<{ issued: string; consumed: string; sessions: string; leases: string }>(`SELECT
      (SELECT count(*) FROM identity_desktop_authorization_codes)::text AS issued,
      (SELECT count(*) FROM identity_desktop_authorization_codes WHERE consumed_at IS NOT NULL)::text AS consumed,
      (SELECT count(*) FROM identity_auth_sessions WHERE client_kind = 'desktop')::text AS sessions,
      (SELECT count(*) FROM device_active_leases)::text AS leases`);
    expect(stored.rows).toEqual([{ issued: "1", consumed: "0", sessions: "0", leases: "0" }]);
  });

  it("keeps inactive entitlement and a different device as Standby without a new Lease", async () => {
    await applyEntitlementState("suspended", "desktop-oauth-entitlement-suspended", 2);
    const { base, challenged, transcript } = await beginAuthorization(new Date());
    await expect(completeAuthorization(base, challenged, transcript)).resolves.toMatchObject({ authorized: true });
    await expect(ownerPool.query("SELECT count(*)::text AS count FROM device_active_leases"))
      .resolves.toMatchObject({ rows: [{ count: "0" }] });
    await applyEntitlementState("active", "desktop-oauth-entitlement-reactivated", 3);
    await authorize(new Date());
    await expect(new PostgresEntitlementDeadlineReader(identityTransactions).readCurrent({
      transactionCredential: principal.transactionCredential,
      expectedAccountId: "oauth-account",
    })).resolves.toMatchObject({ active: true });
    await ownerPool.query(`INSERT INTO device_bindings (account_id, device_id, slot, status, credential_epoch)
      VALUES ('oauth-account', 'device-b', 2, 'bound', 1)`);
    const otherKey = generateKeyPairSync("ed25519").publicKey.export({ format: "der", type: "spki" }) as Buffer;
    await ownerPool.query(`INSERT INTO device_signing_keys
      (account_id, device_id, key_version, key_id, public_key, fingerprint, status)
      VALUES ('oauth-account', 'device-b', 1, 'device-key-b', $1, $2, 'active')`,
    [otherKey.subarray(-32), createHash("sha256").update(otherKey.subarray(-32)).digest()]);
    await expect(leaseManager.ensureCurrentLease({
      accountId: "oauth-account", deviceId: "device-a", accountSecurityEpoch: 1,
      transactionCredential: principal.transactionCredential,
    })).resolves.toMatchObject({ outcome: "active" });
    await expect(leaseManager.ensureCurrentLease({
      accountId: "oauth-account", deviceId: "device-b", accountSecurityEpoch: 1,
      transactionCredential: principal.transactionCredential,
    })).resolves.toEqual({ outcome: "standby" });
  });

  it("burns a reserved code and creates no session when the device is removed before exchange", async () => {
    const code = await authorize(new Date());
    await ownerPool.query(`UPDATE device_bindings
      SET status = 'removed', slot = NULL, removed_at = transaction_timestamp(), removal_reason = 'user_removed'
      WHERE account_id = 'oauth-account' AND device_id = 'device-a'`);
    await expect(oauth.exchange(exchangeInput(code, verifier))).resolves.toEqual({ exchanged: false });
    const counts = await ownerPool.query<{ consumed: string; sessions: string }>(`SELECT
      (SELECT count(*) FROM identity_desktop_authorization_codes WHERE consumed_at IS NOT NULL)::text AS consumed,
      (SELECT count(*) FROM identity_auth_sessions WHERE client_kind = 'desktop')::text AS sessions`);
    expect(counts.rows[0]).toEqual({ consumed: "1", sessions: "0" });
  });

  it("rejects an expired code without consuming it", async () => {
    const code = await authorize(new Date());
    await ownerPool.query(
      `UPDATE identity_desktop_authorization_codes
          SET issued_at = '2020-01-01T00:00:00Z', expires_at = '2020-01-01T00:05:00Z'
        WHERE account_id = 'oauth-account'`,
    );
    await expect(oauth.exchange(exchangeInput(code, verifier))).resolves.toEqual({ exchanged: false });
    const stored = await ownerPool.query<{ consumed_at: Date | null }>(
      "SELECT consumed_at FROM identity_desktop_authorization_codes",
    );
    expect(stored.rows).toEqual([{ consumed_at: null }]);
  });

  it("replays one rotation request exactly and revokes the family for a different replay identity", async () => {
    const code = await authorize(new Date());
    const exchanged = await oauth.exchange(exchangeInput(code, verifier));
    if (!exchanged.exchanged) throw new Error("OAuth exchange failed");
    const initial = exchanged.credentials.consume((value) => value);
    const rotated = await refresh.rotate({
      refreshToken: initial.refreshToken,
      deviceId: "device-a",
      requestId: "refresh-request-a",
      evaluatedAt: new Date(),
    });
    expect(rotated.rotated).toBe(true);
    if (!rotated.rotated) throw new Error("refresh rotation failed");
    const firstCredentials = rotated.credentials.consume((value) => value);
    const replayed = await refresh.rotate({
      refreshToken: initial.refreshToken,
      deviceId: "device-a",
      requestId: "refresh-request-a",
      evaluatedAt: new Date(),
    });
    expect(replayed.rotated).toBe(true);
    if (!replayed.rotated) throw new Error("refresh replay failed");
    expect(replayed.credentials.consume((value) => value)).toEqual(firstCredentials);
    await expect(refresh.rotate({
      refreshToken: initial.refreshToken,
      deviceId: "device-a",
      requestId: "refresh-request-b",
      evaluatedAt: new Date(),
    })).resolves.toEqual({ rotated: false, reason: "refresh_reuse_detected" });
    const stored = await ownerPool.query<{ family_state: string; session_revoked: boolean }>(`SELECT
      f.state AS family_state, a.revoked_at IS NOT NULL AS session_revoked
      FROM identity_refresh_families f JOIN identity_auth_sessions a USING (account_id, session_id)
      WHERE a.client_kind = 'desktop'`);
    expect(stored.rows).toEqual([{ family_state: "revoked", session_revoked: true }]);
  });

  it("renews the same Lease epoch before committing refresh-token rotation", async () => {
    const code = await authorize(new Date());
    const exchanged = await oauth.exchange(exchangeInput(code, verifier));
    if (!exchanged.exchanged) throw new Error("OAuth exchange failed");
    const initial = exchanged.credentials.consume((value) => value);
    const before = await ownerPool.query<{ jti: string }>(
      "SELECT jti FROM device_active_leases WHERE account_id = 'oauth-account'",
    );
    const renewalWindow = await ownerPool.query<{
      issued_at: Date;
      renew_after: Date;
      online_expires_at: Date;
      offline_execute_until: Date;
    }>(`SELECT
      date_trunc('second', clock_timestamp()) - interval '10 minutes' AS issued_at,
      date_trunc('second', clock_timestamp()) - interval '5 minutes' AS renew_after,
      date_trunc('second', clock_timestamp()) + interval '5 minutes' AS online_expires_at,
      date_trunc('second', clock_timestamp()) + interval '1 hour' AS offline_execute_until`);
    const renewalDeadline = renewalWindow.rows[0];
    if (renewalDeadline === undefined) throw new Error("Lease renewal window fixture is unavailable");
    await replacePersistedLeaseWindow(renewalDeadline);
    const rotated = await refresh.rotate({
      refreshToken: initial.refreshToken,
      deviceId: "device-a",
      requestId: "refresh-request-renewal",
      evaluatedAt: new Date(),
    });
    expect(rotated.rotated).toBe(true);
    const after = await ownerPool.query<{ jti: string; lease_epoch: string; allocations: string }>(`SELECT
      l.jti, l.lease_epoch::text,
      (SELECT count(*) FROM device_lease_epoch_allocations WHERE account_id = l.account_id)::text AS allocations
      FROM device_active_leases l WHERE l.account_id = 'oauth-account'`);
    expect(after.rows[0]).toMatchObject({ lease_epoch: "1", allocations: "1" });
    expect(after.rows[0]?.jti).not.toBe(before.rows[0]?.jti);
  });

  it("never allocates a Lease during an unfinished switch, a pending allocation, or an execution block (ADR-0032 Standby S1)", async () => {
    // device-a logs in and holds epoch 1; then the Lease is released as a drain handoff releases it.
    await authorize(new Date());
    await releaseHeldLease();
    const ensure = async () => leaseManager.ensureCurrentLease({
      accountId: "oauth-account", deviceId: "device-a", accountSecurityEpoch: 1,
      transactionCredential: principal.transactionCredential,
    });
    const require = async () => leaseManager.requireCurrentLease({
      accountId: "oauth-account", deviceId: "device-a", accountSecurityEpoch: 1,
    });
    for (const status of ["requested", "draining", "waiting_expiry"] as const) {
      await ownerPool.query("DELETE FROM device_switch_workflows WHERE account_id = 'oauth-account'");
      await insertSwitchWorkflow(status);
      await expect(ensure()).resolves.toEqual({ outcome: "standby" });
      await expect(require()).resolves.toEqual({ outcome: "standby" });
      // Standby sessions are admitted while the execution reservation remains unchanged.
      const { base, challenged, transcript } = await beginAuthorization(new Date());
      await expect(completeAuthorization(base, challenged, transcript)).resolves.toMatchObject({ authorized: true });
    }
    // A bootstrapping switch reserves its pending epoch; a login must not take the next one.
    await ownerPool.query("DELETE FROM device_switch_workflows WHERE account_id = 'oauth-account'");
    await insertSwitchWorkflow("bootstrapping", 2);
    await insertBootstrapCapability(false);
    await ownerPool.query(`INSERT INTO device_lease_epoch_allocations
        (account_id, workspace_id, workflow_id, lease_epoch, status)
      VALUES ('oauth-account', 'oauth-workspace', 'switch-guard', 2, 'pending');
      UPDATE device_account_states SET highest_allocated_lease_epoch = 2 WHERE account_id = 'oauth-account'`);
    await expect(ensure()).resolves.toEqual({ outcome: "standby" });
    // A pending allocation alone still reserves the Lease after its workflow ended.
    await ownerPool.query(`UPDATE device_switch_workflows SET status = 'failed', pending_lease_epoch = NULL
      WHERE account_id = 'oauth-account'`);
    await expect(ensure()).resolves.toEqual({ outcome: "standby" });
    await ownerPool.query(`UPDATE device_lease_epoch_allocations SET status = 'burned', terminal_at = transaction_timestamp()
      WHERE account_id = 'oauth-account' AND lease_epoch = 2`);
    await ownerPool.query(`UPDATE device_account_states
      SET exclusive_execution_block_until = transaction_timestamp() + interval '1 hour' WHERE account_id = 'oauth-account'`);
    await expect(ensure()).resolves.toEqual({ outcome: "standby" });
    await expect(require()).resolves.toEqual({ outcome: "standby" });
    expect((await ownerPool.query<{ allocations: string; held: string; highest: string }>(`SELECT
        (SELECT count(*) FROM device_lease_epoch_allocations WHERE account_id = 'oauth-account')::text AS allocations,
        (SELECT count(*) FROM device_active_leases WHERE account_id = 'oauth-account' AND released_at IS NULL)::text AS held,
        (SELECT highest_allocated_lease_epoch FROM device_account_states WHERE account_id = 'oauth-account')::text AS highest`)).rows)
      .toEqual([{ allocations: "2", held: "0", highest: "2" }]);
    // With nothing reserving it, the next login allocates above every earlier epoch.
    await ownerPool.query(`UPDATE device_account_states SET exclusive_execution_block_until = NULL
      WHERE account_id = 'oauth-account'`);
    await expect(require()).resolves.toEqual({ outcome: "standby" });
    const allocated = await ensure();
    expect(allocated).toMatchObject({ outcome: "active", lease: { payload: { leaseEpoch: 3 } } });
  });

  it("reclaims an expired bootstrap during real OAuth login and never reuses its burned epoch", async () => {
    await seedExpiredBootstrap();
    const code = await authorize(new Date());
    await expect(oauth.exchange(exchangeInput(code, verifier))).resolves.toMatchObject({ exchanged: true });
    expect(await expiryState()).toMatchObject({ workflow: "failed", pending: null, revision: "2",
      allocation: "burned", consumed: "expired", highest: "3", current: "3", held: "1" });
    // A lost successful response can be retried: no fourth epoch and no second terminal revision.
    await expect(ensureLease()).resolves.toMatchObject({ outcome: "active", lease: { payload: { leaseEpoch: 3 } } });
    expect(await expiryState()).toMatchObject({ revision: "2", highest: "3", held: "1" });
  });

  it("preserves live or inconsistent bootstrap reservations and rejects revoked or stale login subjects", async () => {
    await seedExpiredBootstrap();
    await ownerPool.query("UPDATE device_bootstrap_capabilities SET expires_at = clock_timestamp() + interval '1 hour'");
    await expect(ensureLease()).resolves.toEqual({ outcome: "standby" });
    expect(await expiryState()).toMatchObject({ workflow: "bootstrapping", allocation: "pending", consumed: null });
    await ownerPool.query("UPDATE device_bootstrap_capabilities SET expires_at = clock_timestamp() - interval '1 second'");
    await expect(ensureLease(2)).resolves.toEqual({ outcome: "refused" });
    await ownerPool.query("UPDATE device_signing_keys SET status = 'revoked', retired_at = clock_timestamp()");
    await expect(ensureLease()).resolves.toEqual({ outcome: "refused" });
    expect(await expiryState()).toMatchObject({ workflow: "bootstrapping", allocation: "pending", consumed: null });
    await ownerPool.query("UPDATE device_signing_keys SET status = 'active', retired_at = NULL");
    await ownerPool.query("UPDATE device_bootstrap_capabilities SET target_device_id = 'wrong-device'");
    await expect(ensureLease()).resolves.toEqual({ outcome: "refused" });
    expect(await expiryState()).toMatchObject({ workflow: "bootstrapping", allocation: "pending", consumed: null });
  });

  it.each(["current", "high", "lease"])("refuses inconsistent pending epoch authority: %s", async (shape) => {
    await seedExpiredBootstrap();
    if (shape === "current") await ownerPool.query("UPDATE device_account_states SET current_lease_epoch = 2");
    if (shape === "high") await ownerPool.query("UPDATE device_account_states SET highest_allocated_lease_epoch = 3");
    if (shape === "lease") await ownerPool.query("UPDATE device_active_leases SET lease_epoch = 2");
    await expect(ensureLease()).resolves.toEqual({ outcome: "refused" });
    expect(await expiryState()).toMatchObject({ workflow: "bootstrapping", allocation: "pending", consumed: null });
  });

  it("serializes two login recoveries into one burned epoch and one new Lease", async () => {
    await seedExpiredBootstrap();
    const results = await Promise.all([ensureLease(), ensureLease()]);
    expect(results).toHaveLength(2);
    for (const result of results) expect(result).toMatchObject({ outcome: "active", lease: { payload: { leaseEpoch: 3 } } });
    expect(await expiryState()).toMatchObject({ revision: "2", highest: "3", current: "3", held: "1" });
  });

  it("rolls back expiry, nonce consumption and pin release when a later part of login fails", async () => {
    await seedExpiredBootstrap(true);
    const denied = new PostgresDesktopLoginLease({ transactions, bootstrapExpiry,
      entitlement: new PostgresEntitlementDeadlineReader(identityTransactions),
      verifier: leaseVerifier, signer: { async sign() { return { signed: false }; } },
    });
    await expect(ensureLease(1, denied)).resolves.toEqual({ outcome: "refused" });
    expect(await expiryState()).toMatchObject({ workflow: "bootstrapping", pending: "2", revision: "1",
      allocation: "pending", consumed: null, highest: "2", current: "1", held: "0" });
    const stillPinned = async () => (await ownerPool.query(`SELECT
      (SELECT released_at IS NULL FROM workspace_checkpoint_pins WHERE consumer_id = 'switch-guard') AS pinned,
      (SELECT state FROM device_bootstrap_step_nonces WHERE workflow_id = 'switch-guard') AS nonce,
      (SELECT next_step_kind FROM device_bootstrap_authorities WHERE workflow_id = 'switch-guard') AS next`)).rows[0];
    expect(await stillPinned()).toEqual({ pinned: true, nonce: "active", next: "fetch_mutations" });
    await expect(ensureLease()).resolves.toMatchObject({ outcome: "active" });
    expect(await stillPinned()).toEqual({ pinned: false, nonce: "consumed", next: null });
  });

  it("does not reclaim an expired bootstrap from another account", async () => {
    await seedExpiredBootstrap();
    await ownerPool.query(`INSERT INTO identity_accounts
      (account_id, email_normalized, password_policy_id, password_hash_phc)
      VALUES ('other-expiry', 'other-expiry@example.test', 'argon2id-v1', repeat('x', 80));
      INSERT INTO workspace_workspaces (workspace_id, account_id, kind, name)
      VALUES ('other-workspace', 'other-expiry', 'personal', 'Other');
      INSERT INTO workspace_account_bindings (account_id, workspace_id, owner_kind, role, is_default)
      VALUES ('other-expiry', 'other-workspace', 'account', 'default_owner', true)`);
    await transactions.withAccount("other-expiry", (transaction) => bootstrapExpiry.expireLocked(transaction));
    expect(await expiryState()).toMatchObject({ workflow: "bootstrapping", allocation: "pending", consumed: null });
  });

  it("keeps the allocation guard to the caller's own resolved account", async () => {
    await ownerPool.query(`INSERT INTO identity_accounts
        (account_id, email_normalized, email_verified_at, password_policy_id, password_hash_phc)
      VALUES ('oauth-other', 'other@example.com', transaction_timestamp(), 'argon2id-v1', $1)`,
    ["$argon2id$v=19$m=19456,t=2,p=1$".padEnd(96, "A")]);
    await insertSwitchWorkflow("draining");
    const reserved = async (accountId: string) => transactions.withAccount(accountId, async (transaction) =>
      (await transaction.query<{ reserved: boolean }>("SELECT public.device_lease_allocation_reserved() AS reserved")).rows);
    await expect(reserved("oauth-account")).resolves.toEqual([{ reserved: true }]);
    await expect(reserved("oauth-other")).resolves.toEqual([{ reserved: false }]);
    await expect(appPool.query("SELECT public.device_lease_allocation_reserved()")).rejects.toMatchObject({ code: "42501" });
    const privileges = await ownerPool.query<{ owner: string; app: boolean; public: boolean; definer: boolean; configuration: string[] }>(`SELECT
        pg_get_userbyid(p.proowner) AS owner,
        has_function_privilege('gooddealer_cloud_app', 'public.device_lease_allocation_reserved()', 'EXECUTE') AS app,
        has_function_privilege('public', 'public.device_lease_allocation_reserved()', 'EXECUTE') AS public,
        p.prosecdef AS definer, p.proconfig AS configuration
      FROM pg_proc p WHERE p.oid = 'public.device_lease_allocation_reserved()'::regprocedure`);
    // The workflow policy exempts the owner by role name, so any other owner would fail open.
    expect(privileges.rows).toEqual([{
      owner: "gooddealer_cloud_owner", app: true, public: false, definer: true, configuration: ["search_path=pg_catalog, public"],
    }]);
  });
});

async function insertBootstrapCapability(expired: boolean) {
  await ownerPool.query(`INSERT INTO device_bootstrap_capabilities
    (account_id, workspace_id, workflow_id, jti, target_device_id, issued_at, expires_at)
    VALUES ('oauth-account', 'oauth-workspace', 'switch-guard', 'expiry-cap', 'device-b',
      clock_timestamp() - interval '1 hour', clock_timestamp() + make_interval(secs => $1))`, [expired ? -1 : 3600]);
}

async function ensureLease(accountSecurityEpoch = 1, manager = leaseManager) {
  return manager.ensureCurrentLease({ accountId: "oauth-account", deviceId: "device-a", accountSecurityEpoch,
    transactionCredential: principal.transactionCredential });
}

async function expiryState() {
  return (await ownerPool.query(`SELECT w.status AS workflow, w.pending_lease_epoch AS pending,
    w.workflow_revision AS revision, a.status AS allocation, c.consumed_reason AS consumed,
    s.highest_allocated_lease_epoch AS highest, s.current_lease_epoch AS current,
    (SELECT count(*)::text FROM device_active_leases WHERE account_id = w.account_id AND released_at IS NULL) AS held
    FROM device_switch_workflows w JOIN device_lease_epoch_allocations a USING (account_id, workspace_id, workflow_id)
    JOIN device_bootstrap_capabilities c USING (account_id, workspace_id, workflow_id)
    JOIN device_account_states s USING (account_id) WHERE w.account_id = 'oauth-account'`)).rows[0];
}

async function seedExpiredBootstrap(withPin = false) {
  await authorize(new Date());
  await releaseHeldLease();
  await insertSwitchWorkflow("bootstrapping", 2);
  await ownerPool.query(`INSERT INTO device_lease_epoch_allocations
    (account_id, workspace_id, workflow_id, lease_epoch, status)
    VALUES ('oauth-account', 'oauth-workspace', 'switch-guard', 2, 'pending');
    UPDATE device_account_states SET highest_allocated_lease_epoch = 2 WHERE account_id = 'oauth-account';
    INSERT INTO device_bootstrap_capabilities
    (account_id, workspace_id, workflow_id, jti, target_device_id, issued_at, expires_at)
    VALUES ('oauth-account', 'oauth-workspace', 'switch-guard', 'expiry-cap', 'device-b',
      clock_timestamp() - interval '1 hour', clock_timestamp() - interval '1 second')`);
  if (!withPin) return;
  await ownerPool.query(`INSERT INTO workspace_revisions (account_id, workspace_id, workspace_schema_version)
    VALUES ('oauth-account', 'oauth-workspace', 1) ON CONFLICT DO NOTHING;
    INSERT INTO workspace_checkpoints (account_id, workspace_id, checkpoint_id, schema_version,
      workspace_schema_version, through_server_revision, checkpoint_digest, capture_codec, capture_schema_version,
      status, verified_at, published_at)
    VALUES ('oauth-account', 'oauth-workspace', 'expiry-checkpoint', 3, 1, 0, sha256('checkpoint'::bytea),
      'workspace-checkpoint-state-v3', 3, 'available', clock_timestamp(), clock_timestamp());
    INSERT INTO workspace_checkpoint_pins (account_id, workspace_id, checkpoint_id, consumer_kind, consumer_id,
      expected_through_server_revision, expected_checkpoint_digest, created_at, expires_at)
    VALUES ('oauth-account', 'oauth-workspace', 'expiry-checkpoint', 'bootstrap', 'switch-guard',
      0, sha256('checkpoint'::bytea), clock_timestamp() - interval '1 hour', clock_timestamp() - interval '1 second');
    INSERT INTO device_bootstrap_authorities (account_id, workspace_id, workflow_id, capability_jti,
      target_device_id, account_security_epoch, pending_lease_epoch, next_step_number, next_step_kind,
      next_nonce_digest, pinned_checkpoint_id, pinned_checkpoint_through_server_revision, pinned_checkpoint_digest,
      pin_expires_at, target_server_revision, target_schema_version, row_version)
    VALUES ('oauth-account', 'oauth-workspace', 'switch-guard', 'expiry-cap', 'device-b', 1, 2, 2,
      'fetch_mutations', sha256('expiry-nonce'::bytea), 'expiry-checkpoint', 0, sha256('checkpoint'::bytea),
      clock_timestamp() - interval '1 second', 0, 1, 1);
    INSERT INTO device_bootstrap_step_nonces (nonce_digest, account_id, workspace_id, workflow_id, step_number, state)
    VALUES (sha256('expiry-nonce'::bytea), 'oauth-account', 'oauth-workspace', 'switch-guard', 2, 'active')`);
}

async function releaseHeldLease(): Promise<void> {
  await ownerPool.query(`UPDATE device_active_leases
       SET released_at = transaction_timestamp(), release_reason = 'device_switch'
     WHERE account_id = 'oauth-account' AND released_at IS NULL`);
}

async function insertSwitchWorkflow(
  status: "requested" | "draining" | "waiting_expiry" | "bootstrapping",
  pendingLeaseEpoch: number | null = null,
): Promise<void> {
  await ownerPool.query(`INSERT INTO device_switch_workflows
      (account_id, workspace_id, workflow_id, purpose, mode, request_digest, idempotency_key, status,
       workflow_revision, from_device_id, to_device_id, bound_key_id, bound_key_version,
       bound_account_security_epoch, pending_lease_epoch, state_deadline)
    VALUES ('oauth-account', 'oauth-workspace', 'switch-guard', 'device_switch', 'normal', $1, 'switch-guard-key', $2,
      1, 'device-a', 'device-b', 'device-key-b', 1, 1, $3, transaction_timestamp() + interval '1 day')`,
  [Buffer.alloc(32, 7), status, pendingLeaseEpoch]);
}

async function authorize(evaluatedAt: Date): Promise<string> {
  const { base, challenged, transcript } = await beginAuthorization(evaluatedAt);
  const result = await completeAuthorization(base, challenged, transcript);
  if (!result.authorized) throw new Error("OAuth authorization failed");
  return result.code;
}

function authorizationService(standbySigner: DesktopStandbyGrantSigner = standbyGrantSigner) {
  return new PostgresDesktopAuthorizationApplicationService(identityTransactions,
    new PostgresDefaultWorkspaceTenantResolver(identityTransactions),
    new DesktopAuthorizationGrantIssuer(grantSigner), leaseVerifier,
    new DesktopStandbyGrantIssuer(standbySigner));
}
async function loginStandbyDevice(requireReauthentication = false) {
  const { base, challenged, transcript } = await beginAuthorization(new Date(), oauth, "device-b", requireReauthentication);
  const authorized = await completeAuthorization(base, challenged, transcript);
  if (!authorized.authorized) throw new Error("Standby authorization failed");
  const exchanged = await oauth.exchange(exchangeInput(authorized.code, verifier));
  if (!exchanged.exchanged) throw new Error("Standby exchange failed");
  const credentials = exchanged.credentials.consume((value) => value);
  const session = await ownerPool.query<{ session_id: string }>(
    "SELECT session_id FROM identity_auth_sessions WHERE account_id = 'oauth-account' AND device_id = 'device-b'");
  const sessionId = session.rows[0]?.session_id;
  if (sessionId === undefined) throw new Error("Standby session missing");
  return { principal: { accountId: "oauth-account", sessionId, clientKind: "desktop" as const,
    transactionCredential: new TextEncoder().encode(credentials.accessToken) }, refreshToken: credentials.refreshToken };
}

async function desktopGrantPrincipal() {
  const code = await authorize(new Date());
  const exchanged = await oauth.exchange(exchangeInput(code, verifier));
  if (!exchanged.exchanged) throw new Error("OAuth exchange failed");
  let accessToken = "";
  exchanged.credentials.consume((value) => { accessToken = value.accessToken; });
  if (accessToken.length === 0) throw new Error("desktop access credential is unavailable");
  const session = await ownerPool.query<{ session_id: string }>(
    `SELECT s.session_id FROM identity_auth_sessions s JOIN identity_credential_jtis j USING(account_id,session_id)
     WHERE s.account_id='oauth-account' AND s.client_kind='desktop' AND j.jti=$1 AND j.kind='access'`,
    [createHash("sha256").update(accessToken).digest("hex")],
  );
  const sessionId = session.rows[0]?.session_id;
  if (sessionId === undefined) throw new Error("desktop session fixture is unavailable");
  return {
    accountId: "oauth-account",
    sessionId,
    clientKind: "desktop" as const,
    transactionCredential: new TextEncoder().encode(accessToken),
  };
}

function blockingStandbySigner() {
  let announceSigning!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => { announceSigning = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const signer: DesktopStandbyGrantSigner = { async sign(input) {
    announceSigning(); await gate; return standbyGrantSigner.sign(input);
  } };
  return { signer, started, release };
}

function blockingGrantSigner() {
  let announceSigning!: () => void;
  let releaseSigning!: () => void;
  const started = new Promise<void>((resolve) => { announceSigning = resolve; });
  const gate = new Promise<void>((resolve) => { releaseSigning = resolve; });
  const signer: DesktopAuthorizationGrantSigner = {
    async sign(input) {
      announceSigning();
      await gate;
      return grantSigner.sign(input);
    },
  };
  return { signer, started, release: releaseSigning };
}

function canonicalUtcSecond(value: Date): string {
  return value.toISOString().replace(".000Z", "Z");
}

async function applyEntitlementState(
  state: "active" | "suspended",
  sourceEventId: string,
  sourceRevision: number,
  features: readonly string[] = ["cloudflare:dns:observe", "workspace:mutate"],
): Promise<void> {
  const clock = await ownerPool.query<{ now: Date }>(
    "SELECT date_trunc('second', clock_timestamp()) AS now",
  );
  const now = clock.rows[0]?.now;
  if (!(now instanceof Date)) throw new Error("Entitlement fixture clock is unavailable");
  const commercialExpiresAt = canonicalUtcSecond(new Date(now.getTime() + 30 * 86_400_000));
  const rightId = `00000000-0000-4000-8000-${String(sourceRevision).padStart(12, "0")}`;
  const agreementId = "10000000-0000-4000-8000-000000000001";
  const observationId = `20000000-0000-4000-8000-${String(sourceRevision).padStart(12, "0")}`;
  const projectionDigest = createHash("sha256").update(sourceEventId, "utf8").digest();
  // Owner-only fixture builds the narrow authority/right/projection shape read by the facade.
  // Runtime code has no direct Licensing-private write capability here.
  const fixture = await ownerPool.connect();
  try {
    await fixture.query("BEGIN");
    await fixture.query("SET LOCAL ROLE gd_licensing_owner");
    await fixture.query(`INSERT INTO licensing_private.commercial_rights
      (account_id, right_id, provider_agreement_id, state, plan, purchase_kind,
       commercial_expires_at, feature_entitlements, source_observation_id)
    VALUES ('oauth-account', $1, $2, $3, 'pro', 'subscription', $4,
      $6::text[], $5)`,
    [rightId, agreementId, state, commercialExpiresAt, observationId, features]);
    await fixture.query(`INSERT INTO licensing_private.commercial_authorities
      (account_id, authority_revision, provider_agreement_id, right_id, grants_access)
    VALUES ('oauth-account', $1, $2, $3, $4 = 'active')
    ON CONFLICT (account_id) DO UPDATE SET authority_revision = EXCLUDED.authority_revision,
      provider_agreement_id = EXCLUDED.provider_agreement_id,
      right_id = EXCLUDED.right_id, grants_access = EXCLUDED.grants_access,
      updated_at = transaction_timestamp()`, [sourceRevision, agreementId, rightId, state]);
    await fixture.query(`INSERT INTO licensing_private.account_entitlement_projections
      (account_id, authority_revision, right_id, state, plan, purchase_kind,
       commercial_expires_at, feature_entitlements, projection_digest)
    VALUES ('oauth-account', $1, $2, $3, 'pro', 'subscription', $4,
      $6::text[], $5)
    ON CONFLICT (account_id) DO UPDATE SET authority_revision = EXCLUDED.authority_revision,
      right_id = EXCLUDED.right_id, state = EXCLUDED.state,
      commercial_expires_at = EXCLUDED.commercial_expires_at, projection_digest = EXCLUDED.projection_digest,
      feature_entitlements = EXCLUDED.feature_entitlements,
      updated_at = transaction_timestamp()`,
    [sourceRevision, rightId, state, commercialExpiresAt, projectionDigest, features]);
    await fixture.query("COMMIT");
  } catch (error) {
    await fixture.query("ROLLBACK");
    throw error;
  } finally {
    fixture.release();
  }
}

async function replacePersistedLeaseWindow(window: {
  readonly issued_at: Date;
  readonly renew_after: Date;
  readonly online_expires_at: Date;
  readonly offline_execute_until: Date;
}): Promise<void> {
  const persisted = await ownerPool.query<{ wire_envelope: unknown }>(
    "SELECT wire_envelope FROM device_active_leases WHERE account_id = 'oauth-account'",
  );
  const current = activeDeviceLeaseEnvelopeSchema.parse(persisted.rows[0]?.wire_envelope);
  const unsigned = {
    ...current,
    issuedAt: canonicalUtcSecond(window.issued_at),
    expiresAt: canonicalUtcSecond(window.offline_execute_until),
    payload: {
      ...current.payload,
      renewAfter: canonicalUtcSecond(window.renew_after),
      onlineExpiresAt: canonicalUtcSecond(window.online_expires_at),
      offlineExecuteUntil: canonicalUtcSecond(window.offline_execute_until),
    },
    signature: Buffer.alloc(64).toString("base64url"),
  };
  const envelope = activeDeviceLeaseEnvelopeSchema.parse({
    ...unsigned,
    signature: sign(
      null,
      encodeActiveDeviceLeaseSignatureTranscript(unsigned),
      leaseAuthority.privateKey,
    ).toString("base64url"),
  });
  const canonicalEnvelope = Buffer.from(encodeDomainSeparatedWireValue(
    "GOODDEALER-ACTIVE-DEVICE-LEASE-ENVELOPE-V1",
    envelope,
  ));
  await ownerPool.query(`UPDATE device_active_leases
       SET issued_at = $1, renew_after = $2, online_expires_at = $3, offline_execute_until = $4,
           signed_envelope = $5, wire_envelope = $6, signer_receipt_digest = $7
     WHERE account_id = 'oauth-account'`, [
    envelope.issuedAt,
    envelope.payload.renewAfter,
    envelope.payload.onlineExpiresAt,
    envelope.payload.offlineExecuteUntil,
    canonicalEnvelope,
    JSON.stringify(envelope),
    createHash("sha256").update("test-lease-window-receipt").digest(),
  ]);
}

async function waitForDatabaseDeadline(deadline: Date): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const observed = await ownerPool.query<{ crossed: boolean }>(
      "SELECT clock_timestamp() >= $1::timestamptz AS crossed",
      [deadline],
    );
    if (observed.rows[0]?.crossed === true) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new TypeError(`database clock did not cross ${deadline.toISOString()}`);
}

async function waitForBlockedQuery(marker: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    await ownerPool.query("SELECT pg_stat_clear_snapshot()");
    const observed = await ownerPool.query<{ blocked: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM pg_stat_activity
          WHERE datname = current_database() AND pid <> pg_backend_pid()
            AND wait_event_type = 'Lock' AND query LIKE '%' || $1 || '%'
       ) AS blocked`,
      [marker],
    );
    if (observed.rows[0]?.blocked === true) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new TypeError(`expected ${marker} to wait for Grant authority locks`);
}

async function beginAuthorization(
  evaluatedAt: Date,
  service: PostgresDesktopOAuthAuthorizationService = oauth,
  deviceId = "device-a",
  requireReauthentication = false,
) {
  const key = deviceId === "device-a" ? deviceKeyPair : otherDeviceKeyPair;
  const base = {
    ...(requireReauthentication ? {requireReauthentication:true as const} : {}),
    principal,
    deviceId,
    clientId: DESKTOP_OAUTH_CLIENT_ID,
    redirectUri: LOOPBACK_REDIRECT_URI,
    codeChallenge: challenge,
    codeChallengeMethod: "S256",
    keyId: deviceId === "device-a" ? "device-key-a" : "device-key-b",
    publicKey: (key.publicKey.export({ format: "der", type: "spki" }) as Buffer).subarray(-32).toString("base64url"),
    evaluatedAt,
  } as const;
  const challenged = await service.authorize(base);
  if (!("challengeRequired" in challenged) || !challenged.challengeRequired) {
    throw new Error("OAuth device challenge failed");
  }
  const transcript = desktopDeviceProofTranscript({
    accountId: challenged.challenge.accountId,
    deviceId: challenged.challenge.deviceId,
    keyId: challenged.challenge.keyId,
    challengeId: challenged.challenge.challengeId,
    codeChallenge: challenge,
    clientId: DESKTOP_OAUTH_CLIENT_ID,
    redirectUri: LOOPBACK_REDIRECT_URI,
    nonceDigest: challenged.challenge.nonceDigest,
    expiresAt: challenged.challenge.expiresAt,
  });
  return { base, challenged, transcript };
}

function completeAuthorization(
  base: Parameters<PostgresDesktopOAuthAuthorizationService["authorize"]>[0],
  challenged: { readonly challenge: { readonly challengeId: string } },
  transcript: Buffer,
  service: PostgresDesktopOAuthAuthorizationService = oauth,
) {
  return service.authorize({
    ...base,
    proof: {
      challengeId: challenged.challenge.challengeId,
      signature: sign(null, transcript, (base.deviceId === "device-a" ? deviceKeyPair : otherDeviceKeyPair).privateKey).toString("base64url"),
    },
  });
}

function exchangeInput(code: string, codeVerifier: string) {
  return {
    code,
    codeVerifier,
    clientId: DESKTOP_OAUTH_CLIENT_ID,
    redirectUri: LOOPBACK_REDIRECT_URI,
    evaluatedAt: new Date(),
  } as const;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) throw new Error(`${name} is required; PostgreSQL evidence never skips`);
  return value;
}

/** Transactionally reconstruct only the pre-026 Lease columns in this disposable PG database.
 * Rollback restores the installed schema and fixture; production migration text is never rewritten. */
async function checkHistoricalLeaseUpgrade(expectBlock:boolean) {
  const client=await ownerPool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DROP TRIGGER device_lease_offline_high_water_guard ON device_active_leases");
    await client.query("DROP FUNCTION public.device_lease_offline_high_water_guard()");
    await client.query("ALTER TABLE device_active_leases DROP COLUMN max_issued_offline_execute_until");
    const before=(await client.query("SELECT clock_timestamp() AS now")).rows[0].now;
    await client.query(leaseIssuedOfflineHighWaterMigration.sql);
    const lease=(await client.query("SELECT max_issued_offline_execute_until,offline_execute_until FROM device_active_leases")).rows[0];
    expect(lease.max_issued_offline_execute_until.getTime()).toBeGreaterThanOrEqual(before.getTime()+86_400_000);
    expect(lease.max_issued_offline_execute_until.getTime()).toBeGreaterThanOrEqual(lease.offline_execute_until.getTime());
    const state=(await client.query("SELECT exclusive_execution_block_until FROM device_account_states")).rows[0];
    if(expectBlock)expect(state.exclusive_execution_block_until).toEqual(lease.max_issued_offline_execute_until);
    else expect(state.exclusive_execution_block_until).toBeNull();
  } finally {await client.query("ROLLBACK");client.release();}
}
describe("forced takeover historical Lease upgrade",()=>{
  it.each(["device_switch","lease_verifier_upgrade","normal_handoff"])("blocks released history labelled %s without exact consumed proof",async reason=>{
    await desktopGrantPrincipal();
    await ownerPool.query("UPDATE device_active_leases SET released_at=clock_timestamp(),release_reason=$1",[reason]);
    await checkHistoricalLeaseUpgrade(true);
  });
  it("does not add an execution block for an exact verified and consumed normal handoff",async()=>{
    await desktopGrantPrincipal();await loginStandbyDevice();
    const txs=new TenantTransactionRunner(appPool),security=new PostgresIdentityAccountSecurityStatePort();
    const requests=new PostgresDeviceSwitchRequests({transactions:txs,accountSecurity:security});
    const source={accountId:"oauth-account",workspaceId:"oauth-workspace",deviceId:"device-a"};
    const opened=await requests.requestNormal(source,{toDeviceId:"device-b",idempotencyKey:"upgrade-normal",expectedSourceLeaseEpoch:1});
    if(!opened?.accepted)throw new Error("normal switch refused");
    const drains=new PostgresDeviceSwitchDrain({transactions:txs,requests,transition:new PostgresDeviceDrainTransition(txs,security,new PostgresMutationDrainLedger(),new PostgresExecutionFactDrainLedger(),new PostgresWorkspaceDeviceAuditDrainLedger())});
    const now=Math.floor(Date.now()/1000)*1000;
    const proof=signedHandoffDrainProof(deviceKeyPair.privateKey,{workspaceId:"oauth-workspace",sourceDeviceId:"device-a",signingKeyId:"device-key-a",deviceSwitchRequestId:opened.request.requestId,
      issuedAt:canonicalUtcSecond(new Date(now)),expiresAt:canonicalUtcSecond(new Date(now+300000)),
      streams:["mutation","execution_fact","device_audit"].map(stream=>({stream,lastAssignedSequence:0,contiguousReceivedThrough:0,pendingCount:0,rollingDigest:DRAIN_STREAM_GENESIS_DIGEST}))});
    expect(await drains.submit(source,opened.request.requestId,proof)).toMatchObject({accepted:true,request:{normalHandoffReceipt:{sourceLeaseEpoch:1}}});
    await checkHistoricalLeaseUpgrade(false);
  });
  it("blocks newly issued execution grants while released history is still isolated",async()=>{
    const active=await desktopGrantPrincipal();
    await ownerPool.query("UPDATE device_account_states SET exclusive_execution_block_until=clock_timestamp()+interval '1 day'");
    expect(await authorizationService().issue({schemaVersion:5},active)).toBeNull();
    expect(await ensureLease()).toEqual({outcome:"refused"});
  });
});

// Real account-capability transactions and persisted workspace owners; fixture keys are test-only.
describe("PostgreSQL target bootstrap installation", () => {
  const lookup={schemaVersion:1 as const,requestId:"switch-guard"};
  const corpus=JSON.parse(readFileSync(new URL("../../../../packages/protocol/test-vectors/target-installation/valid.json",import.meta.url),"utf8"));
  const signing=generateKeyPairSync("ed25519");
  let signedClaims=0;
  const capabilitySigner={async sign(input:Parameters<import("../../src/modules/devices/bootstrap-capability-issuer").BootstrapCapabilitySigner["sign"]>[0]){
    signedClaims+=1;
    const draft={...input.claims,kid:"installation-pg-bootstrap",signature:Buffer.alloc(64).toString("base64url")};
    return {signed:true as const,envelope:{...draft,signature:sign(null,encodeBootstrapCapabilitySignatureTranscript(draft),signing.privateKey).toString("base64url")},verificationKey:signing.publicKey,receipt:Buffer.from("fixture-bootstrap-receipt")};
  }};
  const service=(fault?: (point:string)=>void, signer=capabilitySigner, activateSigner=leaseSigner)=>new PostgresTargetBootstrapInstallation({
    transactions:identityTransactions,workspaces:new PostgresDefaultWorkspaceTenantResolver(identityTransactions),capabilitySigner:signer,
    capabilityKeys:new TrustedBootstrapVerificationKeySource([{kid:"installation-pg-bootstrap",publicKey:signing.publicKey}]),
    leaseSigner:activateSigner,leaseVerifier,...(fault===undefined?{}:{fault})});
  const hash=(v:Uint8Array)=>createHash("sha256").update(v).digest("base64url");
  async function fixture(existingCheckpoint=true, forced=false) {
    signedClaims=0;
    await ownerPool.query("TRUNCATE mutation_drain_records, mutation_drain_heads, mutation_drain_seals CASCADE");
    const source=await desktopGrantPrincipal(),target=(await loginStandbyDevice(forced)).principal;
    const scope={accountId:"oauth-account",workspaceId:"oauth-workspace"};
    const txs=new TenantTransactionRunner(appPool),mutations=new PostgresWorkspaceMutationRepository(),portfolio=new PostgresPortfolioRepository(),revisions=new PostgresWorkspaceRevisionRepository();
    await txs.withTenant(scope,async tx=>{
      await revisions.bind(tx,1);
      await tx.query("INSERT INTO workspace_replica_domain_assets(account_id,workspace_id,entity_id) VALUES ('oauth-account','oauth-workspace','deleted.test')");
    });
    const kept=corpus.checkpointState.assets[0];
    const edits=[
      {entityId:"kept.test",entityGeneration:1,operationKind:"upsert",changedFields:[{fieldPath:"note",value:"first life"}]},
      {entityId:"kept.test",entityGeneration:1,operationKind:"delete",deletedAt:"2030-01-01T00:00:00Z",changedFields:[]},
      {entityId:"kept.test",entityGeneration:2,operationKind:"upsert",reAddsDeletedRevision:2,changedFields:[{fieldPath:"note",value:kept.note},{fieldPath:"portfolioId",value:kept.portfolioId},{fieldPath:"tags",value:kept.tags},{fieldPath:"targetPrice",value:kept.targetPrice}]},
      {entityId:"deleted.test",entityGeneration:1,operationKind:"delete",deletedAt:corpus.checkpointState.tombstones[0].deletedAt,changedFields:[]},
      {entityId:"removed.test",entityGeneration:1,operationKind:"upsert",changedFields:[{fieldPath:"note",value:corpus.checkpointState.assets[1].note}]},
      {entityId:"kept.test",entityGeneration:2,operationKind:"upsert",changedFields:[{fieldPath:"note",value:corpus.finalState.assets[0].note}]},
      {entityId:"removed.test",entityGeneration:1,operationKind:"delete",deletedAt:corpus.finalState.tombstones[1].deletedAt,changedFields:[]},
    ];
    for(const [index,edit] of edits.entries())await txs.withTenant(scope,async tx=>{
      const mutation=submittedSyncMutationSchema.parse({schemaVersion:3,mutationId:`installation-pg-${index+1}`,workspaceId:scope.workspaceId,workspaceSchemaVersion:1,entityType:"domain_asset",baseServerRevision:index,sourceDeviceId:"device-a",activeLeaseEpoch:1,deviceMutationSequence:index+1,...edit});
      const lock=await mutations.lockDrainDomain(tx,{sourceDeviceId:"device-a",activeLeaseEpoch:1});
      await revisions.lock(tx);
      await mutations.appendAccepted(tx,lock,[{mutation,serverRevision:index+1}]);
      await portfolio.applyAcceptedMutations(tx,[{mutation,serverRevision:index+1}]);
      await revisions.compareAndAdvance(tx,index,index+1);
      if(index===4 && existingCheckpoint){
        const repository=new PostgresCheckpointRepository(),state=await portfolio.captureCheckpointState(tx);
        const digests=await computeWorkspaceCheckpointEntityDigests(state,async bytes=>createHash("sha256").update(bytes).digest());
        const descriptor={schemaVersion:3,checkpointId:"installation-existing",workspaceId:scope.workspaceId,workspaceSchemaVersion:1,throughServerRevision:5,checkpointDigest:hash(encodeCheckpointEntityDigestsInput(digests))};
        const built=await repository.createBuilding(tx,descriptor,state,digests);
        await repository.publish(tx,await repository.markVerified(tx,built));
      }
    });
    let requestId=lookup.requestId;
    if (forced) {
      await historicalForcedSource();
      const response=await forcedService().request(forcedRequest,target);
      expect(response).toMatchObject({accepted:true,request:{status:"waiting_expiry"}});
      if(!response?.accepted)throw new Error("forced request failed");
      requestId=response.request.requestId;
      await waitForDatabaseDeadline(new Date(response.request.earliestTakeoverAt!));
    } else {
      await seedExpiredBootstrap();
      await ownerPool.query("UPDATE device_bootstrap_capabilities SET issued_at=date_trunc('second',clock_timestamp())-interval '1 minute',expires_at=date_trunc('second',clock_timestamp())+interval '59 minutes'");
    }
    return {source,target,service:service(),requestId};
  }
  function requestFor(claim:DeviceBootstrapClaim,stepNumber:number,workflowRevision:number,nonce:string,stepKind:string,stepPayload:unknown) {
    const draft={schemaVersion:2,deviceSwitchRequestId:claim.requestId,capabilityJti:claim.capability.jti,
      stepNumber,expectedWorkflowRevision:workflowRevision,stepNonce:nonce,stepKind,stepPayload,requestDigest:Buffer.alloc(32).toString("base64url")};
    return bootstrapStepRequestSchema.parse({...draft,requestDigest:hash(encodeBootstrapStepRequestDigestInput(draft))});
  }
  async function install(f:Awaited<ReturnType<typeof fixture>>) {
    const lookup={schemaVersion:1 as const,requestId:f.requestId};
    const claim=await f.service.claim(lookup,f.target);expect(claim).toMatchObject({accepted:true});
    if(!claim?.accepted)throw new Error("claim refused");
    const pin=requestFor(claim.claim,1,claim.claim.workflowRevision,claim.claim.nextStep.stepNonce,"pin_checkpoint",{});
    const pinned=await f.service.step({schemaVersion:1,capability:claim.claim.capability,step:pin},f.target);
    expect(pinned).toMatchObject({accepted:true,result:{stepKind:"pin_checkpoint",resultPayload:{targetServerRevision:7}}});
    if(!pinned?.accepted||pinned.result.stepKind!=="pin_checkpoint")throw new Error("pin refused");
    const checkpoint=pinned.result.resultPayload.checkpoint;
    const fetch=requestFor(claim.claim,2,pinned.result.workflowRevision,pinned.result.nextStepNonce!,"fetch_mutations",{
      pinnedCheckpointId:checkpoint.checkpointId,pinnedCheckpointDigest:checkpoint.checkpointDigest,pinnedCheckpointThroughServerRevision:checkpoint.throughServerRevision,
      fromServerRevisionExclusive:checkpoint.throughServerRevision,throughServerRevisionInclusive:7,cursor:null,pageLimit:256});
    const fetched=await f.service.step({schemaVersion:1,capability:claim.claim.capability,step:fetch},f.target);
    expect(fetched).toMatchObject({accepted:true});
    if(!fetched?.accepted)throw new Error("fetch refused");
    const submit=requestFor(claim.claim,3,fetched.result.workflowRevision,fetched.result.nextStepNonce!,"submit_rebuild_digest",{
      targetServerRevision:7,workspaceSchemaVersion:1,entityDigests:corpus.finalDigests});
    const submitted=await f.service.step({schemaVersion:1,capability:claim.claim.capability,step:submit},f.target);
    expect(submitted).toMatchObject({accepted:true});
    if(!submitted?.accepted||submitted.result.stepKind!=="submit_rebuild_digest")throw new Error("digest refused");
    const draft={...lookup,capability:claim.claim.capability,activationId:"00000000-0000-4000-8000-000000000071",
      expectedWorkflowRevision:submitted.result.workflowRevision,pendingLeaseEpoch:2,targetServerRevision:7,workspaceSchemaVersion:1,
      verifiedRebuildDigest:submitted.result.resultPayload.verifiedDigest,requestDigest:Buffer.alloc(32).toString("base64url")};
    const activation=deviceBootstrapActivationRequestSchema.parse({...draft,requestDigest:hash(encodeBootstrapActivationRequestDigestInput(draft,hash(encodeBootstrapCapabilitySignedEnvelope(draft.capability))))});
    return {claim:claim.claim,pin,pinned,fetch,fetched,submit,submitted,activation};
  }
  const forcedService=()=>new PostgresForcedTakeover({transactions:identityTransactions,workspaces:new PostgresDefaultWorkspaceTenantResolver(identityTransactions)});
  const forcedRequest={schemaVersion:2 as const,mode:"forced" as const,toDeviceId:"device-b",expectedSourceLeaseEpoch:1,idempotencyKey:"forced-pg-original"};
  // Historical source fixture: replace the initial test-issued row with an independently signed,
  // already expired source. Production renewal tests below never lower or reset the high-water mark.
  async function historicalForcedSource() {
    const now=Math.floor(Date.now()/1000)*1000;
    await replacePersistedLeaseWindow({issued_at:new Date(now-7200000),renew_after:new Date(now-6900000),online_expires_at:new Date(now-6600000),offline_execute_until:new Date(now-1000)});
    await ownerPool.query(`WITH old AS (DELETE FROM device_active_leases WHERE account_id='oauth-account' RETURNING *)
      INSERT INTO device_active_leases(account_id,lease_epoch,device_id,jti,issued_at,renew_after,online_expires_at,offline_execute_until,signed_envelope,wire_envelope,signer_receipt_digest)
      SELECT account_id,lease_epoch,device_id,jti,issued_at,renew_after,online_expires_at,offline_execute_until,signed_envelope,wire_envelope,signer_receipt_digest FROM old`);
  }
  it("forced takeover consumes only dedicated OAuth freshness and persists exact concurrent intent before installation",async()=>{
    const source=await desktopGrantPrincipal(),target=(await loginStandbyDevice(true)).principal;
    const forced=forcedService();
    expect(await forced.preview({schemaVersion:1},target)).toMatchObject({available:true,sourceLeaseEpoch:1});
    expect(await forced.request({...forcedRequest,expectedSourceLeaseEpoch:2},target)).toMatchObject({accepted:false,code:"SOURCE_LEASE_CHANGED"});
    const results=await Promise.all([forced.request(forcedRequest,target),forced.request(forcedRequest,target)]);
    expect(results[0]).toEqual(results[1]);expect(results[0]).toMatchObject({accepted:true,request:{status:"waiting_expiry"}});
    if(!results[0]?.accepted)throw new Error("request failed");
    const lookup={schemaVersion:1 as const,requestId:results[0].request.requestId};
    expect(await forced.status(lookup,target)).toMatchObject({found:true,workflow:{claimable:false,sourceLeaseEpoch:1}});
    expect(await service().claim(lookup,target)).toMatchObject({accepted:false,code:"TAKEOVER_NOT_READY"});
    expect(await service().receipt({...lookup,operation:{kind:"claim"}},target)).toMatchObject({outcome:"uncommitted",workflow:{status:"waiting_expiry"},nextStep:null});
    expect(await forcedService().resolve({schemaVersion:1,idempotencyKey:forcedRequest.idempotencyKey},target)).toMatchObject({found:true,originalRequest:forcedRequest});
    expect(await forced.resolve({schemaVersion:1,idempotencyKey:forcedRequest.idempotencyKey},source)).toMatchObject({found:false});
    expect(await forced.request({...forcedRequest,expectedSourceLeaseEpoch:2},target)).toMatchObject({accepted:false,code:"IDEMPOTENCY_CONFLICT"});
    expect(await forced.cancelIfForced(lookup,target)).toMatchObject({accepted:true,request:{status:"cancelled"}});
    expect(await service().receipt({...lookup,operation:{kind:"claim"}},target)).toMatchObject({outcome:"terminal",workflow:{status:"cancelled"}});
    expect(await forced.request({...forcedRequest,idempotencyKey:"second-intent"},target)).toMatchObject({accepted:false,code:"REAUTH_REQUIRED"});
    expect((await ownerPool.query("SELECT released_at FROM device_active_leases")).rows).toEqual([{released_at:null}]);
  });
  it("forced takeover cancellation tombstone rejects late original POST without consuming reauthentication",async()=>{
    await desktopGrantPrincipal();const target=(await loginStandbyDevice(true)).principal;
    const forced=forcedService(),cancel={schemaVersion:1,originalRequest:forcedRequest};
    expect(await forced.resolve({schemaVersion:1,idempotencyKey:forcedRequest.idempotencyKey},target)).toEqual({schemaVersion:1,found:false});
    const results=await Promise.all([forced.cancelIntent(cancel,target),forced.cancelIntent(cancel,target)]);
    expect(results[0]).toEqual(results[1]);expect(results[0]).toMatchObject({outcome:"cancelled_before_request",originalRequest:forcedRequest});
    expect(await forced.request(forcedRequest,target)).toMatchObject({accepted:false,code:"FORCED_INTENT_CANCELLED"});
    expect(await forced.request({...forcedRequest,expectedSourceLeaseEpoch:2},target)).toMatchObject({accepted:false,code:"IDEMPOTENCY_CONFLICT"});
    expect(await forced.cancelIntent({schemaVersion:1,originalRequest:{...forcedRequest,expectedSourceLeaseEpoch:2}},target)).toBeNull();
    expect((await ownerPool.query("SELECT forced_reauth_consumed_at FROM identity_auth_sessions WHERE session_id=$1",[target.sessionId])).rows).toEqual([{forced_reauth_consumed_at:null}]);
    expect(await forced.request({...forcedRequest,idempotencyKey:"new-approved-intent"},target)).toMatchObject({accepted:true});
  });
  it("forced takeover original POST and unknown cancellation converge under the account writer lock",async()=>{
    await desktopGrantPrincipal();const target=(await loginStandbyDevice(true)).principal,forced=forcedService();
    const [request,cancel]=await Promise.all([forced.request(forcedRequest,target),forced.cancelIntent({schemaVersion:1,originalRequest:forcedRequest},target)]);
    if(cancel?.outcome==="workflow")expect(cancel.workflow.request.status).toBe("cancelled");
    else expect(cancel).toMatchObject({outcome:"cancelled_before_request"});
    if(request?.accepted)expect(await forced.status({schemaVersion:1,requestId:request.request.requestId},target)).toMatchObject({workflow:{request:{status:"cancelled"}}});
    expect((await ownerPool.query("SELECT count(*)::int AS count FROM device_bootstrap_capabilities")).rows).toEqual([{count:0}]);
  });
  it("forced takeover request crash rolls back session-window consumption and original intent",async()=>{
    await desktopGrantPrincipal();const target=(await loginStandbyDevice(true)).principal;
    const failed=new PostgresForcedTakeover({transactions:identityTransactions,workspaces:new PostgresDefaultWorkspaceTenantResolver(identityTransactions),fault(point){if(point==="after_forced_request")throw new Error("forced-request-crash");}});
    await expect(failed.request(forcedRequest,target)).rejects.toThrow("forced-request-crash");
    expect((await ownerPool.query("SELECT forced_reauth_consumed_at FROM identity_auth_sessions WHERE session_id=$1",[target.sessionId])).rows).toEqual([{forced_reauth_consumed_at:null}]);
    expect(await forcedService().resolve({schemaVersion:1,idempotencyKey:forcedRequest.idempotencyKey},target)).toEqual({schemaVersion:1,found:false});
    expect(await forcedService().request(forcedRequest,target)).toMatchObject({accepted:true});
  });
  it("forced takeover code exchange never extends an expired original authentication deadline",async()=>{
    await desktopGrantPrincipal();const pending=await beginAuthorization(new Date(),oauth,"device-b",true);
    const authorized=await completeAuthorization(pending.base,pending.challenged,pending.transcript);if(!authorized.authorized)throw new Error("authorization failed");
    await ownerPool.query("UPDATE identity_desktop_authorization_codes SET forced_reauth_until=clock_timestamp()-interval '1 second' WHERE device_id='device-b'");
    expect(await oauth.exchange(exchangeInput(authorized.code,verifier))).toEqual({exchanged:false});
    expect((await ownerPool.query("SELECT count(*)::int AS count FROM identity_auth_sessions WHERE device_id='device-b'")).rows).toEqual([{count:0}]);
  });
  it("forced takeover ordinary OAuth cannot preview or consume a takeover window",async()=>{
    await desktopGrantPrincipal();const target=(await loginStandbyDevice()).principal;
    expect(await forcedService().preview({schemaVersion:1},target)).toMatchObject({available:false,reason:"REAUTH_REQUIRED"});
    expect(await forcedService().request(forcedRequest,target)).toMatchObject({accepted:false,code:"REAUTH_REQUIRED"});
  });
  it("forced takeover rejects old web authentication and challenge freshness expiry",async()=>{
    await desktopGrantPrincipal();const initial=await beginAuthorization(new Date(),oauth,"device-b",true);
    await ownerPool.query("UPDATE identity_auth_sessions SET created_at=clock_timestamp()-interval '301 seconds' WHERE client_kind='account_web'");
    expect(await completeAuthorization(initial.base,initial.challenged,initial.transcript)).toEqual({authorized:false,reauthRequired:true});
    expect(await oauth.authorize(initial.base)).toEqual({authorized:false,reauthRequired:true});
  });
  it("forced takeover refresh preserves the original deadline and consumed state",async()=>{
    await desktopGrantPrincipal();const target=await loginStandbyDevice(true);
    const before=(await ownerPool.query("SELECT forced_reauth_until FROM identity_auth_sessions WHERE session_id=$1",[target.principal.sessionId])).rows[0];
    expect(await forcedService().request(forcedRequest,target.principal)).toMatchObject({accepted:true});
    const rotated=await refresh.rotate({refreshToken:target.refreshToken,deviceId:"device-b",requestId:"forced-refresh",evaluatedAt:new Date()});
    expect(rotated.rotated).toBe(true);
    const after=(await ownerPool.query("SELECT forced_reauth_until,forced_reauth_consumed_at IS NOT NULL AS consumed FROM identity_auth_sessions WHERE session_id=$1",[target.principal.sessionId])).rows[0];
    expect(after).toEqual({...before,consumed:true});
  });
  it("forced takeover persists waiting expiry before returning terminal claim history",async()=>{
    await desktopGrantPrincipal();const target=(await loginStandbyDevice(true)).principal,forced=forcedService();
    const created=await forced.request(forcedRequest,target);if(!created?.accepted)throw new Error("request failed");
    const lookup={schemaVersion:1 as const,requestId:created.request.requestId};
    await ownerPool.query("UPDATE device_switch_workflows SET state_deadline=clock_timestamp()-interval '1 second'");
    expect(await service().claim(lookup,target)).toMatchObject({accepted:false,code:"BOOTSTRAP_EXPIRED"});
    expect(await service().receipt({...lookup,operation:{kind:"claim"}},target)).toMatchObject({outcome:"terminal",workflow:{status:"failed"}});
    expect((await ownerPool.query("SELECT status FROM device_switch_workflows")).rows).toEqual([{status:"failed"}]);
    expect((await ownerPool.query("SELECT released_at FROM device_active_leases")).rows).toEqual([{released_at:null}]);
  });
  it("forced takeover claim rollback preserves source and epoch then returns one original concurrent capability",async()=>{
    const f=await fixture(true,true),lookup={schemaVersion:1 as const,requestId:f.requestId};
    await expect(service(point=>{if(point==="after_claim_persisted")throw new Error("forced crash");}).claim(lookup,f.target)).rejects.toThrow("forced crash");
    expect((await ownerPool.query("SELECT released_at FROM device_active_leases")).rows).toEqual([{released_at:null}]);
    expect((await ownerPool.query("SELECT highest_allocated_lease_epoch FROM device_account_states")).rows).toEqual([{highest_allocated_lease_epoch:"1"}]);
    const claims=await Promise.all([service().claim(lookup,f.target),service().claim(lookup,f.target)]);
    expect(claims[0]).toEqual(claims[1]);expect(claims[0]).toMatchObject({accepted:true});
    expect(await forcedService().cancelIntent({schemaVersion:1,originalRequest:forcedRequest},f.target)).toMatchObject({outcome:"workflow",workflow:{request:{status:"bootstrapping"}}});
  });
  it("forced takeover shorter renewed windows preserve historical maximum and later renewal advances waiting revision",async()=>{
    await desktopGrantPrincipal();const target=(await loginStandbyDevice(true)).principal;
    const original=(await ownerPool.query("SELECT max_issued_offline_execute_until FROM device_active_leases")).rows[0].max_issued_offline_execute_until;
    const now=Math.floor(Date.now()/1000)*1000;
    await replacePersistedLeaseWindow({issued_at:new Date(now-600000),renew_after:new Date(now-300000),online_expires_at:new Date(now+300000),offline_execute_until:new Date(now+3600000)});
    expect((await ownerPool.query("SELECT max_issued_offline_execute_until FROM device_active_leases")).rows[0].max_issued_offline_execute_until).toEqual(original);
    const created=await forcedService().request(forcedRequest,target);if(!created?.accepted)throw new Error("request failed");
    expect(Date.parse(created.request.earliestTakeoverAt!)).toBeGreaterThanOrEqual(original.getTime());
    const later=new Date(now+90000000);
    await ownerPool.query("UPDATE device_active_leases SET max_issued_offline_execute_until=$1",[later]);
    expect(await ensureLease()).toMatchObject({outcome:"active"});
    expect(await forcedService().status({schemaVersion:1,requestId:created.request.requestId},target)).toMatchObject({workflow:{workflowRevision:2,request:{earliestTakeoverAt:canonicalUtcSecond(later)},claimable:false}});
  });
  it("forced takeover freezes late source renewal at the claim boundary",async()=>{
    const f=await fixture(true,true),lookup={schemaVersion:1 as const,requestId:f.requestId};
    expect(await ensureLease()).toEqual({outcome:"refused"});
    expect(await forcedService().status(lookup,f.target)).toMatchObject({workflow:{claimable:true,workflowRevision:1}});
  });
  it("forced takeover slow capability signer crossing claim deadline rolls back release and reservation",async()=>{
    const f=await fixture(true,true),lookup={schemaVersion:1 as const,requestId:f.requestId};
    const deadline=(await ownerPool.query("UPDATE device_switch_workflows SET state_deadline=clock_timestamp()+interval '250 milliseconds' RETURNING state_deadline")).rows[0].state_deadline;
    const slow={async sign(input:Parameters<typeof capabilitySigner.sign>[0]){await waitForDatabaseDeadline(deadline);return capabilitySigner.sign(input);}};
    expect(await service(undefined,slow).claim(lookup,f.target)).toMatchObject({accepted:false,code:"BOOTSTRAP_EXPIRED"});
    expect((await ownerPool.query("SELECT released_at FROM device_active_leases")).rows).toEqual([{released_at:null}]);
    expect((await ownerPool.query("SELECT highest_allocated_lease_epoch FROM device_account_states")).rows).toEqual([{highest_allocated_lease_epoch:"1"}]);
    expect((await ownerPool.query("SELECT count(*)::int AS count FROM device_bootstrap_capabilities")).rows).toEqual([{count:0}]);
  });
  it("forced takeover slow source signer cannot move an already reached claim boundary",async()=>{
    await desktopGrantPrincipal();const target=(await loginStandbyDevice(true)).principal;await historicalForcedSource();
    await ownerPool.query("UPDATE device_active_leases SET max_issued_offline_execute_until=clock_timestamp()+interval '1 second'");
    const created=await forcedService().request(forcedRequest,target);if(!created?.accepted)throw new Error("request failed");
    const slow:ActiveDeviceLeaseSigner={async sign(input){await waitForDatabaseDeadline(new Date(created.request.earliestTakeoverAt!));return leaseSigner.sign(input);}};
    const manager=new PostgresDesktopLoginLease({transactions,entitlement:new PostgresEntitlementDeadlineReader(identityTransactions),signer:slow,verifier:leaseVerifier,bootstrapExpiry});
    expect(await ensureLease(1,manager)).toEqual({outcome:"refused"});
    expect(await forcedService().status({schemaVersion:1,requestId:created.request.requestId},target)).toMatchObject({workflow:{claimable:true,workflowRevision:1}});
  });
  it("forced takeover current target identity rejects tenant spoofing, rotated keys and revoked sessions",async()=>{
    const f=await fixture(true,true),lookup={schemaVersion:1 as const,requestId:f.requestId};
    expect(await forcedService().status(lookup,{...f.target,accountId:"other-account"})).toBeNull();
    expect(await service().claim(lookup,f.source)).toMatchObject({accepted:false});
    await ownerPool.query("UPDATE device_signing_keys SET key_id='rotated-key' WHERE device_id='device-b'");
    expect(await forcedService().status(lookup,f.target)).toMatchObject({workflow:{claimable:false}});
    expect(await service().claim(lookup,f.target)).toBeNull();
    await ownerPool.query("UPDATE identity_auth_sessions SET revoked_at=clock_timestamp() WHERE session_id=$1",[f.target.sessionId]);
    expect(await forcedService().status(lookup,f.target)).toBeNull();
  });
  it("forced takeover rejects no-held source without consuming the dedicated window",async()=>{
    await desktopGrantPrincipal();const target=(await loginStandbyDevice(true)).principal;
    await releaseHeldLease();
    expect(await forcedService().preview({schemaVersion:1},target)).toMatchObject({available:false,reason:"SOURCE_UNAVAILABLE"});
    expect(await forcedService().request(forcedRequest,target)).toMatchObject({accepted:false,code:"SOURCE_LEASE_CHANGED"});
    expect((await ownerPool.query("SELECT forced_reauth_consumed_at FROM identity_auth_sessions WHERE session_id=$1",[target.sessionId])).rows).toEqual([{forced_reauth_consumed_at:null}]);
  });
  it("forced takeover restores real nonempty checkpoint and mutations then activates a new Lease",async()=>{
    const f=await fixture(true,true),lookup={schemaVersion:1 as const,requestId:f.requestId};
    expect(await forcedService().status(lookup,f.target)).toMatchObject({found:true,workflow:{claimable:true}});
    const journey=await install(f);
    expect(await service().claim(lookup,f.target)).toEqual({schemaVersion:1,accepted:true,claim:journey.claim});
    expect(journey.fetched.result).toMatchObject({stepKind:"fetch_mutations",resultPayload:{mutationPage:{mutations:[{entityId:"kept.test",entityGeneration:2},{entityId:"removed.test",operationKind:"delete"}]}}});
    expect(await service().activate(journey.activation,f.target)).toMatchObject({accepted:true,receipt:{pendingLeaseEpoch:2,status:"completed"}});
    expect((await ownerPool.query("SELECT device_id FROM device_active_leases WHERE released_at IS NULL")).rows).toEqual([{device_id:"device-b"}]);
  });
  it("installs nonempty generation/tombstone state, resolves each lost ACK, and replays the original signed activation",async()=>{
    const f=await fixture(),journey=await install(f);
    const fresh=service();
    expect(await fresh.claim(lookup,f.target)).toEqual({schemaVersion:1,accepted:true,claim:journey.claim});
    expect(signedClaims).toBe(1);
    expect(await fresh.receipt({...lookup,operation:{kind:"claim"}},f.target)).toMatchObject({outcome:"committed",operation:{claim:journey.claim}});
    for(const [request,result] of [[journey.pin,journey.pinned],[journey.fetch,journey.fetched],[journey.submit,journey.submitted]] as const){
      expect(await fresh.step({schemaVersion:1,capability:journey.claim.capability,step:request},f.target)).toEqual(result);
      expect(await fresh.receipt({...lookup,operation:{kind:"step",stepNumber:request.stepNumber,requestDigest:request.requestDigest,replayDigest:hash(encodeBootstrapStepReplayRequest(request))}},f.target))
        .toMatchObject({outcome:"committed",operation:{result:result.result}});
    }
    const rows:unknown[]=[];
    if(journey.pinned.result.stepKind!=="pin_checkpoint")throw new Error("wrong pin result");
    for(const partition of journey.pinned.result.resultPayload.checkpointEntityDigests){
      const page=await fresh.checkpoint({...lookup,capability:journey.claim.capability,
        checkpointId:journey.pinned.result.resultPayload.checkpoint.checkpointId,checkpointDigest:journey.pinned.result.resultPayload.checkpoint.checkpointDigest,
        entityType:partition.entityType,partitionId:partition.partitionId,offset:0,pageLimit:256},f.target);
      expect(page).toMatchObject({accepted:true});if(page?.accepted){expect(hash(encodeBootstrapCheckpointPageDigestInput(page.page))).toBe(page.page.pageDigest);rows.push(...page.page.rows);}
    }
    expect(rows).toEqual([...corpus.checkpointState.assets,...corpus.checkpointState.tombstones]);
    expect(journey.fetched.result).toMatchObject({stepKind:"fetch_mutations",resultPayload:{mutationPage:{mutations:[{entityId:"kept.test",entityGeneration:2},{entityId:"removed.test",operationKind:"delete"}]}}});
    const result=await fresh.activate(journey.activation,f.target);expect(result).toMatchObject({accepted:true,receipt:{status:"completed",pendingLeaseEpoch:2,targetServerRevision:7}});
    expect(await service().activate(journey.activation,f.target)).toEqual(result);
    expect(await service().receipt({...lookup,operation:{kind:"activate",activationId:journey.activation.activationId,requestDigest:journey.activation.requestDigest}},f.target))
      .toMatchObject({outcome:"committed",operation:{receipt:result?.accepted?result.receipt:null}});
    expect(await expiryState()).toMatchObject({workflow:"completed",allocation:"activated",highest:"2",current:"2",held:"1"});
    expect((await ownerPool.query("SELECT count(*)::int AS count FROM device_bootstrap_activation_attempts")).rows).toEqual([{count:1}]);
  });
  it("rolls back claim, step and activation crash windows, then reuses the original operation",async()=>{
    const f=await fixture();
    await expect(service(point=>{if(point==="after_claim_persisted")throw new Error("crash");}).claim(lookup,f.target)).rejects.toThrow("crash");
    expect(await service().receipt({...lookup,operation:{kind:"claim"}},f.target)).toMatchObject({outcome:"uncommitted",nextStep:null});
    const journey=await install(f);
    await expect(service(point=>{if(point==="after_activation_receipt_persisted")throw new Error("crash");}).activate(journey.activation,f.target)).rejects.toThrow("crash");
    expect(await service().receipt({...lookup,operation:{kind:"activate",activationId:journey.activation.activationId,requestDigest:journey.activation.requestDigest}},f.target)).toMatchObject({outcome:"uncommitted"});
    expect(await expiryState()).toMatchObject({workflow:"bootstrapping",allocation:"pending",highest:"2",current:"1",held:"0"});
    expect(await service().activate(journey.activation,f.target)).toMatchObject({accepted:true});
  });
  it("builds, reads back, publishes and pins the full nonempty checkpoint atomically",async()=>{
    const f=await fixture(false);const claim=await f.service.claim(lookup,f.target);if(!claim?.accepted)throw new Error("claim refused");
    const pin=requestFor(claim.claim,1,claim.claim.workflowRevision,claim.claim.nextStep.stepNonce,"pin_checkpoint",{});
    const input={schemaVersion:1,capability:claim.claim.capability,step:pin};
    await expect(service(point=>{if(point==="after_step_ports")throw new Error("pin-crash");}).step(input,f.target)).rejects.toThrow("pin-crash");
    expect((await ownerPool.query("SELECT count(*)::int AS count FROM workspace_checkpoints")).rows).toEqual([{count:0}]);
    expect(await f.service.receipt({...lookup,operation:{kind:"step",stepNumber:1,requestDigest:pin.requestDigest,replayDigest:hash(encodeBootstrapStepReplayRequest(pin))}},f.target)).toMatchObject({outcome:"uncommitted",nextStep:{stepNumber:1,stepKind:"pin_checkpoint"}});
    const result=await f.service.step(input,f.target);expect(result).toMatchObject({accepted:true,result:{stepKind:"pin_checkpoint",resultPayload:{checkpoint:{throughServerRevision:7},checkpointEntityDigests:corpus.finalDigests}}});
    expect((await ownerPool.query("SELECT status FROM workspace_checkpoints")).rows).toEqual([{status:"available"}]);
    expect(await service().step(input,f.target)).toEqual(result);
  });
  it("serializes concurrent claims and returns one original nonce and signature",async()=>{
    const f=await fixture();const results=await Promise.all([service().claim(lookup,f.target),service().claim(lookup,f.target)]);
    expect(results[0]).toMatchObject({accepted:true});expect(results[1]).toEqual(results[0]);expect(signedClaims).toBe(1);
    expect((await ownerPool.query("SELECT count(*)::int AS count FROM device_bootstrap_step_nonces")).rows).toEqual([{count:1}]);
  });
  it("rolls back a signed claim when its current desktop session expires before commit",async()=>{
    const f=await fixture();await ownerPool.query("UPDATE identity_auth_sessions SET expires_at=clock_timestamp()+interval '300 milliseconds' WHERE session_id=$1",[f.target.sessionId]);
    const delayed={async sign(input:Parameters<typeof capabilitySigner.sign>[0]){await new Promise(resolve=>setTimeout(resolve,500));return capabilitySigner.sign(input);}};
    expect(await service(undefined,delayed).claim(lookup,f.target)).toBeNull();
    expect((await ownerPool.query("SELECT ready_at,claim_response FROM device_bootstrap_capabilities")).rows).toEqual([{ready_at:null,claim_response:null}]);
    expect((await ownerPool.query("SELECT count(*)::int AS count FROM device_bootstrap_authorities")).rows).toEqual([{count:0}]);
  });
  it("serializes final activation with target cancellation without reallocating the epoch",async()=>{
    const f=await fixture(),journey=await install(f);
    let entered!:()=>void,release!:()=>void;
    const ready=new Promise<void>(resolve=>{entered=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
    const slow:ActiveDeviceLeaseSigner={async sign(input){entered();await gate;return leaseSigner.sign(input);}};
    const activation=service(undefined,capabilitySigner,slow).activate(journey.activation,f.target);await ready;
    const control=new PostgresTargetBootstrapControl(identityTransactions,new PostgresDefaultWorkspaceTenantResolver(identityTransactions),new PostgresBootstrapCheckpointPort());
    const cancelled=control.cancel(lookup,f.target);release();
    expect(await activation).toMatchObject({accepted:true});expect(await cancelled).toMatchObject({accepted:false,code:"SWITCH_NOT_CANCELLABLE"});
    expect(await expiryState()).toMatchObject({workflow:"completed",allocation:"activated",highest:"2",current:"2",held:"1"});
  });
  it("keeps cancellation authoritative over prepared activation and returns terminal original-operation history",async()=>{
    const f=await fixture(),journey=await install(f);
    const control=new PostgresTargetBootstrapControl(identityTransactions,new PostgresDefaultWorkspaceTenantResolver(identityTransactions),new PostgresBootstrapCheckpointPort());
    expect(await control.cancel(lookup,f.target)).toMatchObject({accepted:true});
    expect(await f.service.activate(journey.activation,f.target)).toMatchObject({accepted:false});
    expect(await f.service.receipt({...lookup,operation:{kind:"activate",activationId:journey.activation.activationId,requestDigest:journey.activation.requestDigest}},f.target)).toMatchObject({outcome:"terminal",workflow:{status:"cancelled"}});
    expect(await expiryState()).toMatchObject({workflow:"cancelled",allocation:"burned",highest:"2",current:"1",held:"0"});
  });
  it("does not persist a capability whose signer key is absent from the trusted bootstrap registry",async()=>{
    const f=await fixture();
    const untrusted=new PostgresTargetBootstrapInstallation({transactions:identityTransactions,workspaces:new PostgresDefaultWorkspaceTenantResolver(identityTransactions),
      capabilitySigner,capabilityKeys:new TrustedBootstrapVerificationKeySource([]),leaseSigner,leaseVerifier});
    expect(await untrusted.claim(lookup,f.target)).toEqual({schemaVersion:1,accepted:false,code:"SIGNING_UNAVAILABLE"});
    expect((await ownerPool.query("SELECT ready_at,claim_response FROM device_bootstrap_capabilities")).rows).toEqual([{ready_at:null,claim_response:null}]);
  });
  it("rejects a trusted signature for another device and a changed semantic request digest before consuming the nonce",async()=>{
    const f=await fixture(),response=await f.service.claim(lookup,f.target);if(!response?.accepted)throw new Error("claim refused");
    const claim=response.claim,pin=requestFor(claim,1,claim.workflowRevision,claim.nextStep.stepNonce,"pin_checkpoint",{});
    const foreign={...claim.capability,deviceId:"device-a"};
    foreign.signature=sign(null,encodeBootstrapCapabilitySignatureTranscript(foreign),signing.privateKey).toString("base64url");
    expect(await f.service.step({schemaVersion:1,capability:foreign,step:pin},f.target)).toEqual({schemaVersion:1,accepted:false,code:"CAPABILITY_INVALID"});
    expect(await f.service.step({schemaVersion:1,capability:claim.capability,step:{...pin,requestDigest:Buffer.alloc(32).toString("base64url")}},f.target)).toEqual({schemaVersion:1,accepted:false,code:"BOOTSTRAP_CONFLICT"});
    expect((await ownerPool.query("SELECT state FROM device_bootstrap_step_nonces")).rows).toEqual([{state:"active"}]);
    await ownerPool.query("UPDATE device_account_states SET highest_allocated_lease_epoch=3");
    expect(await f.service.step({schemaVersion:1,capability:claim.capability,step:pin},f.target)).toMatchObject({accepted:false,code:"BOOTSTRAP_CONFLICT"});
  });
  it("does not install an Active Lease signed by an unconfigured Lease key",async()=>{
    const f=await fixture(),journey=await install(f),foreign=generateKeyPairSync("ed25519");
    const badSigner:ActiveDeviceLeaseSigner={async sign(input){const draft={...input.claims,kid:"unconfigured-lease",signature:Buffer.alloc(64).toString("base64url")};
      return {signed:true,envelope:{...draft,signature:sign(null,encodeActiveDeviceLeaseSignatureTranscript(draft),foreign.privateKey).toString("base64url")},verificationKey:foreign.publicKey,receipt:Buffer.from("untrusted-fixture")};}};
    expect(await service(undefined,capabilitySigner,badSigner).activate(journey.activation,f.target)).toEqual({schemaVersion:1,accepted:false,code:"SIGNING_UNAVAILABLE"});
    expect(await expiryState()).toMatchObject({workflow:"bootstrapping",allocation:"pending",highest:"2",current:"1",held:"0"});
    expect((await ownerPool.query("SELECT count(*)::int AS count FROM device_bootstrap_activation_attempts")).rows).toEqual([{count:0}]);
  });
  it("keeps v3 checkpoint tombstones behind the consumed devices capability despite selector spoofing",async()=>{
    const f=await fixture();
    expect((await accountApiPool.query("SELECT entity_id FROM workspace_checkpoint_domain_asset_tombstones")).rows).toEqual([]);
    const read=(purpose:"identity_account"|"devices_account",spoofPurpose=false)=>identityTransactions.withAccountCredential(f.target.transactionCredential,purpose,async tx=>{
      await tx.query("SELECT set_config('gooddealer.workspace_id','oauth-workspace',true)");
      if(spoofPurpose)await tx.query("SELECT set_config('gooddealer.capability_purpose','devices_account',true)");
      return (await tx.query("SELECT entity_id FROM workspace_checkpoint_domain_asset_tombstones")).rows;
    });
    expect(await read("identity_account")).toEqual([]);
    expect(await read("identity_account",true)).toEqual([]);
    expect(await read("devices_account")).toEqual([{entity_id:"deleted.test"}]);
  });
  it("keeps expired history queryable through a bound identity and burns authority before suggesting any retry",async()=>{
    const f=await fixture();await f.service.claim(lookup,f.target);
    await ownerPool.query("UPDATE device_bootstrap_capabilities SET expires_at=clock_timestamp()-interval '1 second'");
    const routes=new PostgresDesktopRouteAuthority(new PostgresDefaultWorkspaceTenantResolver(transactions),new PostgresDesktopSyncAuthority(transactions));
    expect(await routes.authorize(f.target,"bound_device")).toBe(true);expect(await routes.authorize(f.target,"active_or_standby")).toBe(false);
    const control=new PostgresTargetBootstrapControl(identityTransactions,new PostgresDefaultWorkspaceTenantResolver(identityTransactions),new PostgresBootstrapCheckpointPort());
    expect(await control.status(lookup,f.target)).toMatchObject({found:true,request:{status:"bootstrapping"}});
    expect(await f.service.receipt({...lookup,operation:{kind:"claim"}},f.target)).toMatchObject({outcome:"committed",workflow:{status:"failed"}});
    expect(await expiryState()).toMatchObject({workflow:"failed",allocation:"burned",highest:"2",current:"1",held:"0"});
    expect(await f.service.claim(lookup,f.target)).toMatchObject({accepted:false});
  });
  it("rejects source/cross-account/nonce tampering and preserves exact receipt identity",async()=>{
    const f=await fixture();expect(await f.service.claim(lookup,f.source)).toMatchObject({accepted:false});
    expect(await f.service.claim(lookup,{...f.target,accountId:"foreign"})).toBeNull();
    const journey=await install(f);
    expect(await f.service.receipt({...lookup,operation:{kind:"step",stepNumber:1,requestDigest:journey.pin.requestDigest,replayDigest:Buffer.alloc(32).toString("base64url")}},f.target)).toEqual({schemaVersion:1,outcome:"conflict"});
    expect(await f.service.step({schemaVersion:1,capability:journey.claim.capability,step:{...journey.pin,stepNonce:Buffer.alloc(32,99).toString("base64url")}},f.target)).toMatchObject({accepted:false});
    await ownerPool.query("UPDATE device_signing_keys SET status='revoked' WHERE device_id='device-b'");
    expect(await f.service.receipt({...lookup,operation:{kind:"claim"}},f.target)).toBeNull();
  });
});
