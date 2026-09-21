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
import { PostgresDesktopLoginLease } from "../../src/modules/devices/postgres-desktop-login-lease";
import {
  PostgresEntitlementDeadlineReader,
} from "../../src/modules/licensing/postgres-repository";
import {
  DESKTOP_OAUTH_CLIENT_ID,
  DESKTOP_OAUTH_REDIRECT_URI,
  DesktopTokenRefreshService,
  PostgresDesktopOAuthAuthorizationService,
  PostgresIdentityAuthenticationRepository,
} from "../../src/modules/identity/index";
import { PostgresIdentitySessionVerificationReader } from "../../src/modules/identity/postgres-session-verification-reader";
import { PostgresDefaultWorkspaceTenantResolver } from "../../src/modules/workspace/default-workspace/index";
import { clearLicensingTestData } from "../support/postgres-fixture";

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
const leaseManager = new PostgresDesktopLoginLease({
  transactions,
  entitlement: new PostgresEntitlementDeadlineReader(identityTransactions),
  signer: leaseSigner,
  verifier: leaseVerifier,
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
const devicePublicKey = (deviceKeyPair.publicKey.export({ format: "der", type: "spki" }) as Buffer).subarray(-32);

beforeAll(async () => {
  await runCloudMigrations(ownerPool, cloudMigrations);
});

beforeEach(async () => {
  await clearLicensingTestData(ownerPool);
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
      redirectUri: DESKTOP_OAUTH_REDIRECT_URI,
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

  it("revalidates final session authority and the persisted signed Lease before issuing a Grant", async () => {
    const desktopPrincipal = await desktopGrantPrincipal();
    const sessionId = desktopPrincipal.sessionId;
    const service = new PostgresDesktopAuthorizationApplicationService(
      identityTransactions,
      new PostgresDefaultWorkspaceTenantResolver(identityTransactions),
      new DesktopAuthorizationGrantIssuer(grantSigner),
      leaseVerifier,
    );
    await expect(service.issue({ schemaVersion: 3 }, desktopPrincipal)).resolves.toMatchObject({
      activeDeviceLease: { accountId: "oauth-account", accountSecurityEpoch: 1 },
    });

    await ownerPool.query(
      "UPDATE identity_account_security_states SET status = 'recovery_pending' WHERE account_id = 'oauth-account'",
    );
    await expect(service.issue({ schemaVersion: 3 }, desktopPrincipal)).resolves.toBeNull();
    await ownerPool.query("UPDATE identity_account_security_states SET status = 'normal' WHERE account_id = 'oauth-account'");
    await ownerPool.query(`UPDATE identity_auth_sessions
         SET created_at = transaction_timestamp() - interval '1 hour',
             expires_at = transaction_timestamp() - interval '1 second'
       WHERE account_id = 'oauth-account' AND session_id = $1`, [sessionId]);
    await expect(service.issue({ schemaVersion: 3 }, desktopPrincipal)).resolves.toBeNull();
    await ownerPool.query(`UPDATE identity_auth_sessions SET expires_at = NULL
       WHERE account_id = 'oauth-account' AND session_id = $1`, [sessionId]);
    await ownerPool.query(`UPDATE identity_refresh_families SET state = 'revoked'
       WHERE account_id = 'oauth-account' AND session_id = $1`, [sessionId]);
    await expect(service.issue({ schemaVersion: 3 }, desktopPrincipal)).resolves.toBeNull();
    await ownerPool.query(`UPDATE identity_refresh_families SET state = 'active'
       WHERE account_id = 'oauth-account' AND session_id = $1`, [sessionId]);
    await ownerPool.query(`UPDATE device_active_leases
         SET released_at = transaction_timestamp(), release_reason = 'lease_verifier_upgrade',
             wire_envelope = NULL, signer_receipt_digest = NULL
       WHERE account_id = 'oauth-account'`);
    await expect(service.issue({ schemaVersion: 3 }, desktopPrincipal)).resolves.toBeNull();
    await expect(leaseManager.ensureCurrentLease({
      accountId: "oauth-account", deviceId: "device-a", accountSecurityEpoch: 1,
      transactionCredential: principal.transactionCredential,
    })).resolves.toMatchObject({ ensured: true });
    await ownerPool.query(`UPDATE device_active_leases
         SET wire_envelope = jsonb_set(wire_envelope, '{signature}', to_jsonb($1::text))
       WHERE account_id = 'oauth-account'`, [Buffer.alloc(64).toString("base64url")]);
    await expect(service.issue({ schemaVersion: 3 }, desktopPrincipal)).resolves.toBeNull();
    await expect(leaseManager.ensureCurrentLease({
      accountId: "oauth-account", deviceId: "device-a", accountSecurityEpoch: 1,
      transactionCredential: principal.transactionCredential,
    })).resolves.toEqual({ ensured: false });
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
    );

    const issue = service.issue({ schemaVersion: 3 }, desktopPrincipal);
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
    );

    const issue = service.issue({ schemaVersion: 3 }, desktopPrincipal);
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
    );
    const issue = service.issue({ schemaVersion: 3 }, desktopPrincipal);
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
      workspace: { workspaceId: "oauth-workspace", kind: "personal_default" },
      activeDeviceLease: { accountId: "oauth-account", deviceId: "device-a" },
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

  it("refuses inactive entitlement and a different device while one Lease is held", async () => {
    await applyEntitlementState("suspended", "desktop-oauth-entitlement-suspended", 2);
    const { base, challenged, transcript } = await beginAuthorization(new Date());
    await expect(completeAuthorization(base, challenged, transcript)).resolves.toEqual({ authorized: false });
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
    })).resolves.toMatchObject({ ensured: true });
    await expect(leaseManager.ensureCurrentLease({
      accountId: "oauth-account", deviceId: "device-b", accountSecurityEpoch: 1,
      transactionCredential: principal.transactionCredential,
    })).resolves.toEqual({ ensured: false });
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
});

async function authorize(evaluatedAt: Date): Promise<string> {
  const { base, challenged, transcript } = await beginAuthorization(evaluatedAt);
  const result = await completeAuthorization(base, challenged, transcript);
  if (!result.authorized) throw new Error("OAuth authorization failed");
  return result.code;
}

async function desktopGrantPrincipal() {
  const code = await authorize(new Date());
  const exchanged = await oauth.exchange(exchangeInput(code, verifier));
  if (!exchanged.exchanged) throw new Error("OAuth exchange failed");
  let accessToken = "";
  exchanged.credentials.consume((value) => { accessToken = value.accessToken; });
  if (accessToken.length === 0) throw new Error("desktop access credential is unavailable");
  const session = await ownerPool.query<{ session_id: string }>(
    "SELECT session_id FROM identity_auth_sessions WHERE account_id = 'oauth-account' AND client_kind = 'desktop'",
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
      ARRAY['cloudflare:dns:observe', 'workspace:mutate'], $5)`,
    [rightId, agreementId, state, commercialExpiresAt, observationId]);
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
      ARRAY['cloudflare:dns:observe', 'workspace:mutate'], $5)
    ON CONFLICT (account_id) DO UPDATE SET authority_revision = EXCLUDED.authority_revision,
      right_id = EXCLUDED.right_id, state = EXCLUDED.state,
      commercial_expires_at = EXCLUDED.commercial_expires_at, projection_digest = EXCLUDED.projection_digest,
      updated_at = transaction_timestamp()`,
    [sourceRevision, rightId, state, commercialExpiresAt, projectionDigest]);
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
) {
  const base = {
    principal,
    deviceId: "device-a",
    clientId: DESKTOP_OAUTH_CLIENT_ID,
    redirectUri: DESKTOP_OAUTH_REDIRECT_URI,
    codeChallenge: challenge,
    codeChallengeMethod: "S256",
    keyId: "device-key-a",
    publicKey: devicePublicKey.toString("base64url"),
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
    redirectUri: DESKTOP_OAUTH_REDIRECT_URI,
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
      signature: sign(null, transcript, deviceKeyPair.privateKey).toString("base64url"),
    },
  });
}

function exchangeInput(code: string, codeVerifier: string) {
  return {
    code,
    codeVerifier,
    clientId: DESKTOP_OAUTH_CLIENT_ID,
    redirectUri: DESKTOP_OAUTH_REDIRECT_URI,
    evaluatedAt: new Date(),
  } as const;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) throw new Error(`${name} is required; PostgreSQL evidence never skips`);
  return value;
}
