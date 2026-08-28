import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";

import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  bootstrapStepRequestSchema,
  encodeActiveDeviceLeaseSignatureTranscript,
  encodeBootstrapCapabilitySignatureTranscript,
  encodeBootstrapCapabilitySignedEnvelope,
  encodeBootstrapStepRequestDigestInput,
} from "@gooddealer/protocol/devices";
import { encodeDomainSeparatedWireValue } from "@gooddealer/protocol/wire";

import { runCloudMigrations, TenantTransactionRunner, type TenantTransaction } from "../../src/db/index";
import { checkedCloudMigrationCatalog, cloudMigrations } from "../../src/db/migrations";
import {
  BOOTSTRAP_CAPABILITY_KEY_PURPOSE,
  BootstrapCapabilityVerifier,
} from "../../src/modules/devices/bootstrap-capability-verifier";
import { PostgresBootstrapStepService } from "../../src/modules/devices/postgres-bootstrap-step-service";
import {
  DenyingActiveDeviceLeaseSigner,
  PostgresBootstrapActivation,
} from "../../src/modules/devices/postgres-bootstrap-activation";
import { PostgresIdentityAccountSecurityStatePort } from "../../src/modules/identity/index";
import { PostgresDeviceCursorRepository } from "../../src/modules/workspace/cursors/postgres-repository";

const ownerPool = new Pool({ connectionString: requiredEnvironment("GOODDEALER_POSTGRES_OWNER_URL"), max: 1 });
const appPool = new Pool({ connectionString: requiredEnvironment("GOODDEALER_POSTGRES_APP_URL"), max: 4 });
const transactions = new TenantTransactionRunner(appPool);

beforeAll(async () => {
  await runCloudMigrations(ownerPool, cloudMigrations);
  const version = await ownerPool.query<{ server_version: string }>("SHOW server_version");
  if (process.env.GOODDEALER_UNQUALIFIED_POSTGRES_DIAGNOSTIC !== "true") {
    expect(version.rows[0]?.server_version).toMatch(/^18\.6(?:\D|$)/u);
  }
});

afterAll(async () => Promise.all([ownerPool.end(), appPool.end()]));

describe("PostgreSQL Bootstrap persistence foundation", () => {
  it("lands Bootstrap and cursor authority in their consolidated owner snapshots", async () => {
    expect(checkedCloudMigrationCatalog.slice(3, 5).map(({ id, owner }) => ({ id, owner }))).toEqual([
      { id: "202608200004-device-control", owner: "devices" },
      { id: "202608200005-device-cursors", owner: "workspace/cursors" },
    ]);
    const landed = await ownerPool.query<{ id: string; owner_module: string; checksum: string }>(
      `SELECT id, owner_module, checksum FROM gooddealer_cloud_migrations
       WHERE id IN (
         '202608200004-device-control',
         '202608200005-device-cursors'
       ) ORDER BY id COLLATE "C"`,
    );
    expect(landed.rows).toEqual([
      { id: "202608200004-device-control", owner_module: "devices",
        checksum: expect.stringMatching(/^[0-9a-f]{64}$/u) },
      { id: "202608200005-device-cursors", owner_module: "workspace/cursors",
        checksum: expect.stringMatching(/^[0-9a-f]{64}$/u) },
    ]);
  });

  it("forces tenant RLS on every new authority table under non-bypass roles", async () => {
    const roles = await ownerPool.query<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean }>(
      `SELECT rolname, rolsuper, rolbypassrls FROM pg_roles
       WHERE rolname IN ('gooddealer_cloud_app', 'gooddealer_cloud_owner') ORDER BY rolname`,
    );
    expect(roles.rows.every(({ rolsuper, rolbypassrls }) => !rolsuper && !rolbypassrls)).toBe(true);
    const tables = await ownerPool.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
       WHERE relname IN ('device_bootstrap_authorities', 'device_bootstrap_step_nonces',
         'device_bootstrap_activation_attempts') ORDER BY relname`,
    );
    expect(tables.rows.map(({ relname }) => relname)).toEqual([
      "device_bootstrap_activation_attempts",
      "device_bootstrap_authorities",
      "device_bootstrap_step_nonces",
    ]);
    expect(tables.rows.every(({ relrowsecurity, relforcerowsecurity }) => relrowsecurity && relforcerowsecurity)).toBe(true);
  });

  it("binds authority to signed capability and pending epoch with compound foreign keys", async () => {
    const foreignKeys = await ownerPool.query<{ conname: string; target: string }>(
      `SELECT conname, confrelid::regclass::text AS target FROM pg_constraint
       WHERE conrelid = 'device_bootstrap_authorities'::regclass AND contype = 'f'
       ORDER BY conname`,
    );
    expect(foreignKeys.rows.map(({ target }) => target).sort()).toEqual([
      "device_bootstrap_capabilities", "device_lease_epoch_allocations", "device_switch_workflows",
    ]);
  });

  it("retains cursor history with generation in the primary key and one active workspace row", async () => {
    const primary = await ownerPool.query<{ definition: string }>(
      `SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
       WHERE conrelid = 'workspace_device_cursors'::regclass AND contype = 'p'`,
    );
    expect(primary.rows[0]?.definition).toContain("account_id, workspace_id, device_id, cursor_generation");
    const active = await ownerPool.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes WHERE indexname = 'workspace_device_cursors_one_active_per_workspace'`,
    );
    expect(active.rows[0]?.indexdef).toMatch(/UNIQUE.*\(account_id, workspace_id\).*WHERE/su);
    expect(active.rows[0]?.indexdef).toContain("WHERE (status = 'active'::text)");
  });

  it("rejects a second active device cursor in one tenant workspace while allowing distinct scopes", async () => {
    const primary = { accountId: "cursor-unique-account-a", workspaceId: "cursor-unique-workspace-a" } as const;
    const otherTenant = { accountId: "cursor-unique-account-b", workspaceId: primary.workspaceId } as const;
    const otherWorkspace = { accountId: primary.accountId, workspaceId: "cursor-unique-workspace-b" } as const;
    await ownerPool.query("TRUNCATE workspace_device_cursors, workspace_revisions CASCADE");
    for (const scope of [primary, otherTenant, otherWorkspace]) {
      await transactions.withTenant(scope, (transaction) => transaction.query(
        `INSERT INTO workspace_revisions (account_id, workspace_id, workspace_schema_version)
         VALUES ($1, $2, 1)`, [scope.accountId, scope.workspaceId],
      ));
    }
    const insertActive = (scope: { readonly accountId: string; readonly workspaceId: string }, deviceId: string) =>
      transactions.withTenant(scope, (transaction) => transaction.query(
        `INSERT INTO workspace_device_cursors
          (account_id, workspace_id, device_id, cursor_generation, acknowledged_through_server_revision, status)
         VALUES ($1, $2, $3, 1, 0, 'active')`, [scope.accountId, scope.workspaceId, deviceId],
      ));

    await expect(insertActive(primary, "cursor-device-a")).resolves.toBeDefined();
    await expect(insertActive(primary, "cursor-device-b")).rejects.toMatchObject({ code: "23505" });
    await expect(insertActive(otherTenant, "cursor-device-b")).resolves.toBeDefined();
    await expect(insertActive(otherWorkspace, "cursor-device-b")).resolves.toBeDefined();
    await expect(transactions.withTenant(primary, (transaction) => transaction.query(
      `INSERT INTO workspace_device_cursors
        (account_id, workspace_id, device_id, cursor_generation, acknowledged_through_server_revision, status, retirement_reason, retired_at)
       VALUES ($1, $2, 'cursor-device-b', 1, 0, 'retired', 'replaced', transaction_timestamp())`,
      [primary.accountId, primary.workspaceId],
    ))).resolves.toBeDefined();
  });
});

describe("PostgreSQL strict Bootstrap step transaction", () => {
  const scope = { accountId: "bootstrap-account", workspaceId: "bootstrap-workspace" } as const;
  let fixture: ReturnType<typeof signedFixture>;

  beforeEach(async () => {
    fixture = signedFixture();
    await ownerPool.query(`TRUNCATE device_bootstrap_activation_attempts, device_bootstrap_step_nonces,
      device_bootstrap_authorities, device_bootstrap_steps, device_bootstrap_capabilities,
      device_lease_epoch_allocations, device_switch_workflows, device_signing_keys, device_bindings,
      device_account_states, workspace_revisions, identity_accounts CASCADE`);
    await seedBootstrap(scope, fixture);
  });

  it("persists pin and returns byte-identical replay after service reconstruction with zero port calls", async () => {
    const ports = new TestBootstrapPorts(scope.workspaceId);
    const firstService = createStepService(fixture, ports);
    const request = pinRequest(fixture.envelope.jti, fixture.nonce);
    const first = await firstService.execute({
      scope, expectedCapability: fixture.expected, capability: fixture.envelope, request,
    });
    expect(first).toMatchObject({ accepted: true, replay: false, result: { stepKind: "pin_checkpoint" } });
    expect(ports.calls).toEqual({ revisions: 1, checkpoints: 1, mutations: 0, projection: 0 });

    const reconstructed = createStepService(fixture, ports);
    const replay = await reconstructed.execute({
      scope, expectedCapability: fixture.expected, capability: fixture.envelope, request,
    });
    expect(replay).toEqual({ ...(first as { accepted: true; result: unknown }), replay: true });
    expect(ports.calls).toEqual({ revisions: 1, checkpoints: 1, mutations: 0, projection: 0 });

    const stored = await transactions.withTenant(scope, (transaction) => transaction.query<{
      steps: string; active_nonces: string; workflow_revision: string;
    }>(`SELECT (SELECT count(*) FROM device_bootstrap_steps)::text AS steps,
          (SELECT count(*) FROM device_bootstrap_step_nonces WHERE state = 'active')::text AS active_nonces,
          workflow_revision
        FROM device_switch_workflows WHERE workflow_id = 'switch-request-1'`));
    expect(stored.rows[0]).toEqual({ steps: "1", active_nonces: "1", workflow_revision: "5" });
  });

  it("rejects a same-step different canonical request before workspace ports", async () => {
    const ports = new TestBootstrapPorts(scope.workspaceId);
    const service = createStepService(fixture, ports);
    const request = pinRequest(fixture.envelope.jti, fixture.nonce);
    await expect(service.execute({ scope, expectedCapability: fixture.expected,
      capability: fixture.envelope, request })).resolves.toMatchObject({ accepted: true });
    const conflict = pinRequest(fixture.envelope.jti, fixture.nonce, "different-checkpoint");
    await expect(service.execute({ scope, expectedCapability: fixture.expected,
      capability: fixture.envelope, request: conflict }))
      .resolves.toEqual({ accepted: false, code: "BOOTSTRAP_CONFLICT" });
    expect(ports.calls).toEqual({ revisions: 1, checkpoints: 1, mutations: 0, projection: 0 });
  });

  it("rolls back nonce, pin-side writes, ledger, and workflow revision on an injected write-boundary fault", async () => {
    const ports = new TestBootstrapPorts(scope.workspaceId);
    const service = createStepService(fixture, ports, (point) => {
      if (point === "after_nonce_consumed") throw new Error("fault-after-nonce");
    });
    await expect(service.execute({ scope, expectedCapability: fixture.expected,
      capability: fixture.envelope, request: pinRequest(fixture.envelope.jti, fixture.nonce) }))
      .rejects.toThrow("fault-after-nonce");
    const stored = await transactions.withTenant(scope, (transaction) => transaction.query<{
      steps: string; nonce_state: string; workflow_revision: string; next_step: string;
    }>(`SELECT (SELECT count(*) FROM device_bootstrap_steps)::text AS steps,
          (SELECT state FROM device_bootstrap_step_nonces WHERE step_number = 1) AS nonce_state,
          w.workflow_revision, a.next_step_number AS next_step
        FROM device_switch_workflows w JOIN device_bootstrap_authorities a USING (account_id, workspace_id, workflow_id)
        WHERE w.workflow_id = 'switch-request-1'`));
    expect(stored.rows[0]).toEqual({ steps: "0", nonce_state: "active", workflow_revision: "4", next_step: "1" });
  });

  it("production Lease signing denial changes zero rows and never reaches cursor or pin release ports", async () => {
    await terminalizeAuthority(scope);
    const cursorPinCalls = { lock: 0, retire: 0, insert: 0, release: 0 };
    const service = new PostgresBootstrapActivation({
      transactions,
      accountSecurity: new PostgresIdentityAccountSecurityStatePort(),
      entitlement: { async lockCurrent() {
        return { active: true as const, securityDeadline: canonicalTime(new Date(Date.now() + 86_400_000)),
          entitlementDeadline: canonicalTime(new Date(Date.now() + 86_400_000)) };
      } },
      signer: new DenyingActiveDeviceLeaseSigner(),
      checkpoints: { async lockAvailableAndPin() { throw new Error("unreachable"); },
        async release() { cursorPinCalls.release += 1; } },
      cursors: {
        async lockDomain() { cursorPinCalls.lock += 1; },
        async retireCurrent() { cursorPinCalls.retire += 1; },
        async insertNextGeneration() { cursorPinCalls.insert += 1; return 1; },
      },
    });
    await expect(service.activate({ ...scope, workflowId: "switch-request-1", expectedWorkflowRevision: 4 }))
      .resolves.toEqual({ installed: false, code: "LEASE_SIGNING_DISABLED" });
    const state = await transactions.withTenant(scope, (transaction) => transaction.query<{
      leases: string; attempts: string; current_epoch: string; allocation_status: string;
      workflow_status: string; capability_consumed: boolean;
    }>(`SELECT (SELECT count(*) FROM device_active_leases)::text AS leases,
          (SELECT count(*) FROM device_bootstrap_activation_attempts)::text AS attempts,
          s.current_lease_epoch AS current_epoch, a.status AS allocation_status,
          w.status AS workflow_status, c.consumed_at IS NOT NULL AS capability_consumed
        FROM device_account_states s
        JOIN device_lease_epoch_allocations a ON a.account_id = s.account_id
        JOIN device_switch_workflows w ON w.account_id = s.account_id AND w.workflow_id = a.workflow_id
        JOIN device_bootstrap_capabilities c ON c.account_id = a.account_id
          AND c.workspace_id = a.workspace_id AND c.workflow_id = a.workflow_id
        WHERE s.account_id = $1`, [scope.accountId]));
    expect(state.rows[0]).toEqual({ leases: "0", attempts: "0", current_epoch: "1",
      allocation_status: "pending", workflow_status: "bootstrapping", capability_consumed: false });
    expect(cursorPinCalls).toEqual({ lock: 0, retire: 0, insert: 0, release: 0 });
  });

  it("fixture signer installs every activation effect atomically and creates a new cursor generation", async () => {
    await terminalizeAuthority(scope, true);
    let releases = 0;
    const cursors = new PostgresDeviceCursorRepository();
    const service = new PostgresBootstrapActivation({
      transactions,
      accountSecurity: new PostgresIdentityAccountSecurityStatePort(),
      entitlement: activeEntitlement(),
      signer: fixtureLeaseSigner(fixture),
      checkpoints: { async lockAvailableAndPin() { throw new Error("unreachable"); },
        async release() { releases += 1; } },
      cursors,
    });
    const result = await service.activate({ ...scope, workflowId: "switch-request-1", expectedWorkflowRevision: 4 });
    expect(result).toMatchObject({ installed: true, lease: { deviceId: "device-target",
      payload: { leaseEpoch: 2 } }, cursorGeneration: 1 });
    const state = await transactions.withTenant(scope, (transaction) => transaction.query<{
      current_epoch: string; allocation: string; capability_reason: string; workflow: string;
      pending_epoch: string | null; attempts: string; held_leases: string;
    }>(`SELECT s.current_lease_epoch AS current_epoch, a.status AS allocation,
          c.consumed_reason AS capability_reason, w.status AS workflow,
          w.pending_lease_epoch AS pending_epoch,
          (SELECT count(*) FROM device_bootstrap_activation_attempts)::text AS attempts,
          (SELECT count(*) FROM device_active_leases WHERE released_at IS NULL)::text AS held_leases
        FROM device_account_states s
        JOIN device_lease_epoch_allocations a ON a.account_id=s.account_id AND a.lease_epoch=2
        JOIN device_switch_workflows w ON w.account_id=s.account_id AND w.workflow_id=a.workflow_id
        JOIN device_bootstrap_capabilities c ON c.account_id=a.account_id AND c.workflow_id=a.workflow_id
        WHERE s.account_id=$1`, [scope.accountId]));
    expect(state.rows[0]).toEqual({ current_epoch: "2", allocation: "activated",
      capability_reason: "activated", workflow: "completed", pending_epoch: null, attempts: "1", held_leases: "1" });
    const cursorRows = await transactions.withTenant(scope, (transaction) => transaction.query<{
      device_id: string; cursor_generation: string; status: string; retirement_reason: string | null;
    }>(`SELECT device_id,cursor_generation,status,retirement_reason FROM workspace_device_cursors
        ORDER BY device_id COLLATE "C",cursor_generation`));
    expect(cursorRows.rows).toEqual([
      { device_id: "device-old", cursor_generation: "1", status: "retired", retirement_reason: "replaced" },
      { device_id: "device-target", cursor_generation: "1", status: "active", retirement_reason: null },
    ]);
    expect(releases).toBe(1);
  });

  it("fixture activation fault rolls back Lease Epoch capability workflow attempt pin and cursors together", async () => {
    await terminalizeAuthority(scope, true);
    let releases = 0;
    const service = new PostgresBootstrapActivation({
      transactions, accountSecurity: new PostgresIdentityAccountSecurityStatePort(),
      entitlement: activeEntitlement(), signer: fixtureLeaseSigner(fixture),
      checkpoints: { async lockAvailableAndPin() { throw new Error("unreachable"); },
        async release() { releases += 1; } },
      cursors: new PostgresDeviceCursorRepository(),
      fault(point) { if (point === "before_activation_commit") throw new Error("fixture-activation-fault"); },
    });
    await expect(service.activate({ ...scope, workflowId: "switch-request-1", expectedWorkflowRevision: 4 }))
      .rejects.toThrow("fixture-activation-fault");
    const state = await transactions.withTenant(scope, (transaction) => transaction.query<{
      current_epoch: string; allocation: string; capability_consumed: boolean; workflow: string;
      attempts: string; leases: string; active_device: string;
    }>(`SELECT s.current_lease_epoch AS current_epoch, a.status AS allocation,
          c.consumed_at IS NOT NULL AS capability_consumed, w.status AS workflow,
          (SELECT count(*) FROM device_bootstrap_activation_attempts)::text AS attempts,
          (SELECT count(*) FROM device_active_leases)::text AS leases,
          (SELECT device_id FROM workspace_device_cursors WHERE status='active') AS active_device
        FROM device_account_states s
        JOIN device_lease_epoch_allocations a ON a.account_id=s.account_id AND a.lease_epoch=2
        JOIN device_switch_workflows w ON w.account_id=s.account_id AND w.workflow_id=a.workflow_id
        JOIN device_bootstrap_capabilities c ON c.account_id=a.account_id AND c.workflow_id=a.workflow_id
        WHERE s.account_id=$1`, [scope.accountId]));
    expect(state.rows[0]).toEqual({ current_epoch: "1", allocation: "pending", capability_consumed: false,
      workflow: "bootstrapping", attempts: "0", leases: "0", active_device: "device-old" });
    expect(releases).toBe(1);
  });
});

function signedFixture() {
  const corpus = JSON.parse(readFileSync(new URL(
    "../../../../packages/protocol/test-vectors/bootstrap-crypto/ed25519-fixture.json",
    import.meta.url,
  ), "utf8")) as { testPrivateKeyPkcs8DerBase64Url: string; publicKeySpkiDerBase64Url: string };
  const privateKey = createPrivateKey({ key: Buffer.from(corpus.testPrivateKeyPkcs8DerBase64Url, "base64url"),
    format: "der", type: "pkcs8" });
  const publicKey = createPublicKey({ key: Buffer.from(corpus.publicKeySpkiDerBase64Url, "base64url"),
    format: "der", type: "spki" });
  const issuedAt = canonicalTime(new Date(Date.now() - 60_000));
  const expiresAt = canonicalTime(new Date(Date.now() + 30 * 60_000));
  const draft = {
    schemaVersion: 1 as const, typ: "gd.bootstrap-capability.v1" as const,
    iss: "https://accounts.gooddealer.com" as const, aud: "gooddealer-desktop/bootstrap" as const,
    kid: "bootstrap-fixture-key-1", accountId: "bootstrap-account", deviceId: "device-target",
    accountSecurityEpoch: 7, jti: "bootstrap-jti-1", issuedAt, expiresAt,
    payload: { deviceSwitchRequestId: "switch-request-1" }, signature: Buffer.alloc(64).toString("base64url"),
  };
  const envelope = { ...draft, signature: sign(null, encodeBootstrapCapabilitySignatureTranscript(draft), privateKey).toString("base64url") };
  return {
    envelope, privateKey, publicKey, nonce: Buffer.alloc(32, 5).toString("base64url"),
    expected: { accountId: envelope.accountId, deviceId: envelope.deviceId,
      accountSecurityEpoch: envelope.accountSecurityEpoch, jti: envelope.jti,
      deviceSwitchRequestId: envelope.payload.deviceSwitchRequestId, issuedAt, expiresAt,
      evaluatedAt: canonicalTime(new Date()) },
  };
}

async function terminalizeAuthority(
  scope: { readonly accountId: string; readonly workspaceId: string },
  withExistingCursor = false,
): Promise<void> {
  await transactions.withTenant(scope, async (transaction) => {
    await transaction.query(`UPDATE device_bootstrap_step_nonces
      SET state = 'consumed', consumed_at = transaction_timestamp() WHERE step_number = 1`);
    await transaction.query(`UPDATE device_bootstrap_authorities SET
      next_step_number = 4, next_step_kind = NULL, next_nonce_digest = NULL,
      pinned_checkpoint_id = 'checkpoint-1', pinned_checkpoint_through_server_revision = 0,
      pinned_checkpoint_digest = $3, pin_expires_at = transaction_timestamp() + interval '20 minutes',
      target_server_revision = 0, target_schema_version = 1, next_from_revision = 0,
      verified_entity_digests = $4, verified_rebuild_digest = $5
      WHERE account_id = $1 AND workspace_id = $2`,
      [scope.accountId, scope.workspaceId, Buffer.alloc(32, 9), Buffer.from("verified-digests"), Buffer.alloc(32, 7)]);
    if (withExistingCursor) {
      await transaction.query(`INSERT INTO workspace_device_cursors
        (account_id,workspace_id,device_id,cursor_generation,acknowledged_through_server_revision,status)
        VALUES ($1,$2,'device-old',1,0,'active')`, [scope.accountId, scope.workspaceId]);
    }
  });
}

function activeEntitlement() {
  return { async lockCurrent() { return { active: true as const,
    securityDeadline: canonicalTime(new Date(Date.now() + 86_400_000)),
    entitlementDeadline: canonicalTime(new Date(Date.now() + 86_400_000)) }; } };
}

function fixtureLeaseSigner(fixture: ReturnType<typeof signedFixture>) {
  return { async signLeaseUnused() {}, async sign(input: { readonly claims: Record<string, unknown> }) {
    const draft = { ...input.claims, kid: "lease-fixture-key-1",
      signature: Buffer.alloc(64).toString("base64url") };
    const signature = sign(null, encodeActiveDeviceLeaseSignatureTranscript(draft), fixture.privateKey)
      .toString("base64url");
    return { signed: true as const, envelope: { ...draft, signature },
      verificationKey: fixture.publicKey, receipt: Buffer.from("fixture-signer-receipt") };
  } };
}

async function seedBootstrap(
  scope: { readonly accountId: string; readonly workspaceId: string },
  fixture: ReturnType<typeof signedFixture>,
): Promise<void> {
  await transactions.withTenant(scope, async (transaction) => {
    await transaction.query(`INSERT INTO identity_accounts
      (account_id, email_normalized, password_policy_id, password_hash_phc)
      VALUES ($1, 'bootstrap@example.test', 'argon2id-v1', repeat('x', 80))`, [scope.accountId]);
    await transaction.query(`INSERT INTO identity_account_security_states
      (account_id, account_security_epoch, status) VALUES ($1, 7, 'normal')`, [scope.accountId]);
    await transaction.query(`INSERT INTO device_account_states
      (account_id, highest_allocated_lease_epoch, current_lease_epoch) VALUES ($1, 2, 1)`, [scope.accountId]);
    await transaction.query(`INSERT INTO workspace_revisions
      (account_id, workspace_id, workspace_schema_version) VALUES ($1, $2, 1)`, [scope.accountId, scope.workspaceId]);
    await transaction.query(`INSERT INTO device_bindings
      (account_id, device_id, slot, status, credential_epoch) VALUES ($1, 'device-target', 1, 'bound', 1)`,
      [scope.accountId]);
    await transaction.query(`INSERT INTO device_signing_keys
      (account_id, device_id, key_version, key_id, public_key, fingerprint, status)
      VALUES ($1, 'device-target', 1, 'device-key-1', $2, $3, 'active')`,
      [scope.accountId, Buffer.alloc(32, 3), Buffer.alloc(32, 4)]);
    await transaction.query(`INSERT INTO device_switch_workflows
      (account_id, workspace_id, workflow_id, purpose, mode, request_digest, idempotency_key, status,
       workflow_revision, to_device_id, bound_key_id, bound_key_version, bound_account_security_epoch,
       pending_lease_epoch, state_deadline)
      VALUES ($1,$2,'switch-request-1','first_device','normal',$3,'bootstrap-idem','bootstrapping',
       4,'device-target','device-key-1',1,7,2,transaction_timestamp() + interval '1 hour')`,
      [scope.accountId, scope.workspaceId, Buffer.alloc(32, 8)]);
    await transaction.query(`INSERT INTO device_lease_epoch_allocations
      (account_id, workspace_id, workflow_id, lease_epoch, status)
      VALUES ($1,$2,'switch-request-1',2,'pending')`, [scope.accountId, scope.workspaceId]);
    const canonical = Buffer.from(encodeBootstrapCapabilitySignedEnvelope(fixture.envelope));
    await transaction.query(`INSERT INTO device_bootstrap_capabilities
      (account_id, workspace_id, workflow_id, jti, target_device_id, issued_at, expires_at,
       canonical_signed_envelope, signed_envelope_digest, signing_key_id, ready_at)
      VALUES ($1,$2,'switch-request-1',$3,'device-target',$4,$5,$6,$7,$8,transaction_timestamp())`,
      [scope.accountId, scope.workspaceId, fixture.envelope.jti, fixture.envelope.issuedAt,
        fixture.envelope.expiresAt, canonical, createHash("sha256").update(canonical).digest(), fixture.envelope.kid]);
    const nonceDigest = createHash("sha256").update(encodeDomainSeparatedWireValue(
      "GOODDEALER-BOOTSTRAP-STEP-NONCE-V1", fixture.nonce,
    )).digest();
    await transaction.query(`INSERT INTO device_bootstrap_authorities
      (account_id, workspace_id, workflow_id, capability_jti, target_device_id, account_security_epoch,
       pending_lease_epoch, next_step_number, next_step_kind, next_nonce_digest, row_version)
      VALUES ($1,$2,'switch-request-1',$3,'device-target',7,2,1,'pin_checkpoint',$4,1)`,
      [scope.accountId, scope.workspaceId, fixture.envelope.jti, nonceDigest]);
    await transaction.query(`INSERT INTO device_bootstrap_step_nonces
      (nonce_digest, account_id, workspace_id, workflow_id, step_number, state)
      VALUES ($1,$2,$3,'switch-request-1',1,'active')`, [nonceDigest, scope.accountId, scope.workspaceId]);
  });
}

function createStepService(fixture: ReturnType<typeof signedFixture>, ports: TestBootstrapPorts, fault?: (point: string) => void) {
  const verifier = new BootstrapCapabilityVerifier({
    async findVerificationKey(input) {
      return input.purpose === BOOTSTRAP_CAPABILITY_KEY_PURPOSE && input.kid === fixture.envelope.kid
        ? fixture.publicKey : null;
    },
  });
  return new PostgresBootstrapStepService({ transactions, verifier,
    accountSecurity: new PostgresIdentityAccountSecurityStatePort(), revisions: ports,
    checkpoints: ports, mutations: ports, projection: ports, ...(fault === undefined ? {} : { fault }) });
}

function pinRequest(capabilityJti: string, stepNonce: string, checkpointId = "checkpoint-1") {
  const draft = { schemaVersion: 1 as const, deviceSwitchRequestId: "switch-request-1", capabilityJti,
    stepNumber: 1, stepNonce, expectedWorkflowRevision: 4, stepKind: "pin_checkpoint" as const,
    stepPayload: { checkpointId, checkpointThroughServerRevision: 0,
      checkpointDigest: Buffer.alloc(32, 9).toString("base64url") },
    requestDigest: Buffer.alloc(32).toString("base64url") };
  return bootstrapStepRequestSchema.parse({ ...draft,
    requestDigest: createHash("sha256").update(encodeBootstrapStepRequestDigestInput(draft)).digest("base64url") });
}

class TestBootstrapPorts {
  readonly calls = { revisions: 0, checkpoints: 0, mutations: 0, projection: 0 };
  constructor(private readonly workspaceId: string) {}
  async lock(_transaction: TenantTransaction) { this.calls.revisions += 1; return { serverRevision: 0, workspaceSchemaVersion: 1 }; }
  async lockAvailableAndPin(_transaction: TenantTransaction, input: { readonly descriptor: object }) {
    this.calls.checkpoints += 1; return { ...input.descriptor } as never;
  }
  async release(): Promise<void> {}
  async readDensePage(): Promise<never> { this.calls.mutations += 1; throw new Error("unexpected mutation read"); }
  async readEntityDigestsAt(): Promise<never> { this.calls.projection += 1; throw new Error("unexpected projection read"); }
}

function canonicalTime(value: Date): string { return value.toISOString().replace(/\.\d{3}Z$/u, "Z"); }

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) throw new Error(`${name} is required; PostgreSQL tests never skip`);
  return value;
}
