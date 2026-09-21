import { generateKeyPairSync, sign } from "node:crypto";

import {
  encodeActiveDeviceLeaseSignatureTranscript,
  encodeDesktopAuthorizationGrantSignatureTranscript,
} from "@gooddealer/protocol/devices";
import { describe, expect, it } from "vitest";

import type { AccountTransaction } from "../src/db/index";
import {
  DESKTOP_AUTHORIZATION_GRANT_KEY_PURPOSE,
  DesktopAuthorizationGrantIssuer,
  type DesktopAuthorizationGrantSigner,
} from "../src/modules/devices/authorization-grant-issuer";
import { PostgresDesktopAuthorizationApplicationService } from "../src/modules/devices/postgres-desktop-authorization";
import { TrustedActiveDeviceLeaseVerifier } from "../src/modules/devices/active-device-lease-verifier";

const leaseAuthority = generateKeyPairSync("ed25519");
const unsignedLease = {
  schemaVersion: 1 as const,
  typ: "gd.active-device-lease.v1" as const,
  iss: "https://accounts.gooddealer.com" as const,
  aud: "gooddealer-desktop/active-device-lease" as const,
  kid: "lease-v1",
  accountId: "account-a",
  deviceId: "device-a",
  accountSecurityEpoch: 4,
  jti: "lease-a",
  issuedAt: "2026-08-29T00:00:00Z",
  expiresAt: "2026-08-30T00:00:00Z",
  payload: {
    leaseEpoch: 7,
    renewAfter: "2026-08-29T00:05:00Z",
    onlineExpiresAt: "2026-08-29T00:15:00Z",
    offlineExecuteUntil: "2026-08-30T00:00:00Z",
  },
};
const lease = {
  ...unsignedLease,
  signature: sign(
    null,
    encodeActiveDeviceLeaseSignatureTranscript({ ...unsignedLease, signature: "placeholder" }),
    leaseAuthority.privateKey,
  ).toString("base64url"),
};
const leaseVerifier = new TrustedActiveDeviceLeaseVerifier([{
  kid: lease.kid,
  publicKey: leaseAuthority.publicKey,
}]);

const principal = {
  accountId: "account-a",
  sessionId: "session-a",
  clientKind: "desktop" as const,
  transactionCredential: new TextEncoder().encode("opaque-session-credential"),
};

class Ed25519GrantSigner implements DesktopAuthorizationGrantSigner {
  readonly pair = generateKeyPairSync("ed25519");
  calls = 0;

  async sign(input: Parameters<DesktopAuthorizationGrantSigner["sign"]>[0]) {
    expect(input.purpose).toBe(DESKTOP_AUTHORIZATION_GRANT_KEY_PURPOSE);
    this.calls += 1;
    const unsigned = { ...input.claims, kid: "grant-v1", signature: "placeholder" };
    const signature = sign(
      null,
      encodeDesktopAuthorizationGrantSignatureTranscript(unsigned),
      this.pair.privateKey,
    ).toString("base64url");
    return {
      signed: true as const,
      envelope: { ...unsigned, signature },
      verificationKey: this.pair.publicKey,
      receipt: Buffer.from("test-receipt"),
    };
  }
}

describe("PostgreSQL Desktop authorization application service", () => {
  it("requires a non-empty, unique Ed25519 public-key registry for persisted Leases", () => {
    expect(() => new TrustedActiveDeviceLeaseVerifier([])).toThrow("unavailable");
    expect(() => new TrustedActiveDeviceLeaseVerifier([{
      kid: lease.kid,
      publicKey: leaseAuthority.privateKey,
    }])).toThrow("Ed25519 public material");
    expect(() => new TrustedActiveDeviceLeaseVerifier([
      { kid: lease.kid, publicKey: leaseAuthority.publicKey },
      { kid: lease.kid, publicKey: generateKeyPairSync("ed25519").publicKey },
    ])).toThrow("duplicated");
  });

  it("derives every authority selector from the verified session and current server state", async () => {
    const signer = new Ed25519GrantSigner();
    const observed: readonly unknown[][] = [];
    const service = serviceFor(signer, async (text, values) => {
      (observed as unknown[][]).push([text, ...(values ?? [])]);
      if (text.includes("AS authorized")) return rows([{ authorized: true }]);
      if (text.includes("identity_account_security_states")) {
        return rows([{ account_security_epoch: "4", status: "normal" }]);
      }
      if (text.includes("identity_auth_sessions")) return rows([{ device_id: "device-a" }]);
      if (text.includes("read_authoritative_entitlement_snapshot")) return rows([commercialRow()]);
      return rows([leaseRow()]);
    });

    const grant = await service.issue({ schemaVersion: 3 }, principal);
    expect(grant).toMatchObject({
      workspace: { workspaceId: "workspace-a", kind: "personal_default" },
      activeDeviceLease: { accountId: "account-a", deviceId: "device-a" },
      scopes: ["workspace:mutate", "workspace:read"],
    });
    expect(signer.calls).toBe(1);
    expect(observed.flat()).toContain("session-a");
    expect(observed.flat()).toContain("device-a");
    expect(String(observed[0]?.[0])).toContain("identity_account_security_states");
    expect(String(observed[1]?.[0])).toContain("identity_auth_sessions");
    expect(String(observed[2]?.[0])).toContain("device_active_leases");
    expect(String(observed[3]?.[0])).toContain("read_authoritative_entitlement_snapshot");
    expect(String(observed[4]?.[0])).toContain("read_authoritative_entitlement_snapshot");
    expect(String(observed[5]?.[0])).toContain("clock_timestamp()");
    expect(String(observed[5]?.[0])).toContain("workspace_account_bindings");
  });

  it("fails closed before opening a database transaction without the server-internal credential", async () => {
    const signer = new Ed25519GrantSigner();
    let opened = false;
    const service = new PostgresDesktopAuthorizationApplicationService(
      {
        async withAccountCredential<Result>(): Promise<Result> {
          opened = true;
          throw new Error("must not open");
        },
      },
      { async resolveLocked() { throw new Error("must not resolve"); } },
      new DesktopAuthorizationGrantIssuer(signer),
      leaseVerifier,
    );

    await expect(service.issue(
      { schemaVersion: 3 },
      { accountId: principal.accountId, sessionId: principal.sessionId, clientKind: "desktop" },
    )).resolves.toBeNull();
    expect(opened).toBe(false);
    expect(signer.calls).toBe(0);
  });

  it("maps only Identity's indistinguishable capability rejection to a closed Grant denial", async () => {
    const signer = new Ed25519GrantSigner();
    const rejected = new PostgresDesktopAuthorizationApplicationService(
      {
        async withAccountCredential<Result>(): Promise<Result> {
          throw Object.assign(new Error("account authorization failed"), { code: "42501" });
        },
      },
      { async resolveLocked() { throw new Error("must not resolve"); } },
      new DesktopAuthorizationGrantIssuer(signer),
      leaseVerifier,
    );
    await expect(rejected.issue({ schemaVersion: 3 }, principal)).resolves.toBeNull();

    const unavailable = new PostgresDesktopAuthorizationApplicationService(
      {
        async withAccountCredential<Result>(): Promise<Result> {
          throw Object.assign(new Error("database unavailable"), { code: "08006" });
        },
      },
      { async resolveLocked() { throw new Error("must not resolve"); } },
      new DesktopAuthorizationGrantIssuer(signer),
      leaseVerifier,
    );
    await expect(unavailable.issue({ schemaVersion: 3 }, principal)).rejects.toThrow("database unavailable");
    expect(signer.calls).toBe(0);
  });

  it("does not publish a signer result after final clock/state revalidation fails", async () => {
    const signer = new Ed25519GrantSigner();
    const service = serviceFor(signer, async (text) => {
      if (text.includes("AS authorized")) return rows([{ authorized: false }]);
      if (text.includes("identity_account_security_states")) {
        return rows([{ account_security_epoch: "4", status: "normal" }]);
      }
      if (text.includes("identity_auth_sessions")) return rows([{ device_id: "device-a" }]);
      if (text.includes("read_authoritative_entitlement_snapshot")) return rows([commercialRow()]);
      return rows([leaseRow()]);
    });
    await expect(service.issue({ schemaVersion: 3 }, principal)).resolves.toBeNull();
    expect(signer.calls).toBe(1);
  });

  it.each([
    ["recovery-pending security", [{ account_security_epoch: "4", status: "recovery_pending" }], [], []],
    ["missing session", [{ account_security_epoch: "4", status: "normal" }], [], []],
    ["wrong session device", [{ account_security_epoch: "4", status: "normal" }], [{ device_id: "device-b" }], []],
    ["released or stale Lease", [{ account_security_epoch: "4", status: "normal" }], [{ device_id: "device-a" }], [
      leaseRow({ lease_live: false }),
    ]],
    ["non-current epoch", [{ account_security_epoch: "4", status: "normal" }], [{ device_id: "device-a" }], [
      leaseRow({ current_epoch: false }),
    ]],
    ["stored columns disagree with signed Lease", [{ account_security_epoch: "4", status: "normal" }], [
      { device_id: "device-a" },
    ], [leaseRow({ jti: "substituted-jti" })]],
    ["stored Lease signature is invalid", [{ account_security_epoch: "4", status: "normal" }], [
      { device_id: "device-a" },
    ], [leaseRow({ wire_envelope: { ...lease, signature: Buffer.alloc(64).toString("base64url") } })]],
    ["stored Lease key id is untrusted", [{ account_security_epoch: "4", status: "normal" }], [
      { device_id: "device-a" },
    ], [leaseRow({ wire_envelope: { ...lease, kid: "substituted-lease-key" } })]],
    ["signed Lease has stale security epoch", [{ account_security_epoch: "5", status: "normal" }], [
      { device_id: "device-a" },
    ], [leaseRow()]],
  ])("fails closed for %s", async (_name, securityRows, sessionRows, leaseRows) => {
    const signer = new Ed25519GrantSigner();
    const service = serviceFor(signer, async (text) => {
      if (text.includes("identity_account_security_states")) return rows(securityRows);
      if (text.includes("identity_auth_sessions")) return rows(sessionRows);
      return text.includes("read_authoritative_entitlement_snapshot") ? rows([commercialRow()]) : rows(leaseRows);
    });
    await expect(service.issue({ schemaVersion: 3 }, principal)).resolves.toBeNull();
    expect(signer.calls).toBe(0);
  });
});

function serviceFor(
  signer: DesktopAuthorizationGrantSigner,
  query: (text: string, values?: readonly unknown[]) => Promise<unknown>,
) {
  return new PostgresDesktopAuthorizationApplicationService(
    {
      withAccountCredential: async <Result>(credential: Uint8Array, purpose: string, operation: (transaction: AccountTransaction) => Promise<Result>) => {
        expect(credential).toEqual(principal.transactionCredential);
        expect(purpose).toBe("devices_account");
        return operation({ accountId: "account-a", query: query as AccountTransaction["query"] });
      },
    },
    {
      resolveLocked: async (transaction) =>
        transaction.accountId === "account-a"
          ? { accountId: "account-a", workspaceId: "workspace-a" }
          : null,
    },
    new DesktopAuthorizationGrantIssuer(signer),
    leaseVerifier,
  );
}

function leaseRow(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    device_id: "device-a",
    wire_envelope: lease,
    binding_live: true,
    lease_live: true,
    current_epoch: true,
    lease_epoch: "7",
    jti: lease.jti,
    issued_at: new Date(lease.issuedAt),
    renew_after: new Date(lease.payload.renewAfter),
    online_expires_at: new Date(lease.payload.onlineExpiresAt),
    offline_execute_until: new Date(lease.payload.offlineExecuteUntil),
    ...overrides,
  };
}

function commercialRow(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    source_event_id: "right-a",
    source_revision: "2",
    occurred_at: new Date("2026-08-29T00:00:00Z"),
    state: "active",
    license_id: "right-a",
    plan: "pro",
    entitlement_kind: "subscription",
    commercial_expires_at: new Date("2026-09-30T00:00:00Z"),
    offline_grace_until: new Date("2026-10-03T00:00:00Z"),
    credential_refresh_due_at: new Date("2026-09-01T00:00:00Z"),
    feature_entitlements: ["cloudflare:dns:observe", "feature:portfolio"],
    trusted_now: new Date("2026-08-30T00:00:00Z"),
    ...overrides,
  };
}

function rows<Row>(values: readonly Row[]) {
  return {
    command: "SELECT",
    rowCount: values.length,
    oid: 0,
    fields: [],
    rows: [...values],
  };
}
