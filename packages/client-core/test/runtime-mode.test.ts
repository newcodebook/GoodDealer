import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, expectTypeOf, it, vi } from "vitest";

import {
  accountGateStatusSchema,
  accountRejectionSchema,
  accountSessionListSchema,
  authSessionStatusSchema,
} from "@gooddealer/protocol/account";
import type {
  AccountGateStatus,
  AccountRejection,
  AccountSessionList,
  AuthSessionState,
  AuthSessionStatus,
  EntitlementProjection,
} from "@gooddealer/protocol/account";
import {
  activeDeviceLeaseStatusSchema,
  deviceAuthorityProjectionSchema,
  deviceSwitchRequestViewSchema,
  runtimeStatusSchema,
} from "@gooddealer/protocol/devices";
import type {
  ActiveDeviceLeaseStatus,
  CloudScope,
  DeviceAuthorityProjection,
  DeviceBindingList,
  DeviceSwitchRequest,
  DeviceSwitchRequestView,
  RuntimeStatus,
} from "@gooddealer/protocol/devices";

import {
  projectAccountSurface,
  projectAuthSurface,
  projectSessionInventory,
  type AccountGatePort,
  type AccountSurface,
  type AccountSurfaceView,
  type AuthSessionPort,
  type AuthSurfaceView,
  type DeviceDirectoryPort,
  type DeviceSwitchPort,
  type EntitlementPort,
  type RuntimeMode,
  type SessionInventoryStatus,
  type SessionInventoryView,
  type SwitchProgress,
  projectSwitchProgress,
} from "../src/index";

const timestamp = "2026-08-13T12:00:00Z";

const runtimeModes = [
  "locked",
  "standby",
  "activating",
  "active",
  "draining",
  "local_continuation",
] as const satisfies readonly RuntimeMode[];

const gateOutcomes = ["locked", "standby_eligible", "active_eligible"] as const;

const authStates = [
  "signed_out",
  "authenticated",
  "refresh_required",
  "reauth_required",
  "revoked",
] as const satisfies readonly AuthSessionState[];

function runtime(mode: RuntimeMode): RuntimeStatus {
  return {
    schemaVersion: 1,
    mode,
    activationPurpose: mode === "activating" ? "bootstrap" : null,
  };
}

function gate(outcome: (typeof gateOutcomes)[number]): AccountGateStatus {
  return {
    schemaVersion: 1,
    outcome,
    lockReason: outcome === "locked" ? "offline_lease_expired" : null,
    accountCheck: outcome === "locked" ? "fail" : "pass",
    deviceBindingCheck: "pass",
    entitlementCheck: "pass",
    activeLeaseCheck: outcome === "active_eligible" ? "pass" : "fail",
    accountSecurityState: "normal",
    trustedTimeState: "trusted",
    evaluatedAt: timestamp,
  };
}

function lease(held: boolean): ActiveDeviceLeaseStatus {
  return held
    ? {
        schemaVersion: 1,
        held: true,
        deviceId: "device-a",
        leaseEpoch: 1,
        issuedAt: "2026-08-13T11:00:00Z",
        renewAfter: "2026-08-13T11:15:00Z",
        onlineExpiresAt: "2026-08-13T11:30:00Z",
        offlineExecuteUntil: "2026-08-14T11:00:00Z",
        renewalState: "offline_grace",
        evaluatedAt: timestamp,
      }
    : {
        schemaVersion: 1,
        held: false,
        deviceId: null,
        leaseEpoch: null,
        issuedAt: null,
        renewAfter: null,
        onlineExpiresAt: null,
        offlineExecuteUntil: null,
        renewalState: "expired",
        evaluatedAt: timestamp,
      };
}

function authStatus(state: AuthSessionState): AuthSessionStatus {
  if (state === "signed_out") {
    return authSessionStatusSchema.parse({
      schemaVersion: 1,
      state,
      accountId: null,
      deviceId: null,
      accountSecurityEpoch: null,
      sessionId: null,
      accessTokenExpiresAt: null,
      refreshRotationGeneration: null,
      lastTrustedTimeAt: null,
      revocationReason: null,
    });
  }

  return authSessionStatusSchema.parse({
    schemaVersion: 1,
    state,
    accountId: "account-a",
    deviceId: "device-a",
    accountSecurityEpoch: 3,
    sessionId: "session-a",
    accessTokenExpiresAt:
      state === "authenticated" || state === "refresh_required" ? "2026-08-13T12:30:00Z" : null,
    refreshRotationGeneration: 2,
    lastTrustedTimeAt: timestamp,
    revocationReason: state === "revoked" ? "remote_sign_out" : null,
  });
}

function activeAuthority(scopes: readonly CloudScope[]): DeviceAuthorityProjection {
  return {
    schemaVersion: 1,
    role: "active",
    scopes: [...scopes],
  };
}

const fullActiveScopes = [
  "account:manage",
  "operation:approve",
  "platform:read",
  "platform:write",
  "workspace:mutate",
  "workspace:read",
] as const satisfies readonly CloudScope[];

const projectedActiveAuthority = activeAuthority(fullActiveScopes);

const readOnlyAuthority = {
  schemaVersion: 1,
  role: "standby",
  scopes: ["account:manage", "workspace:read"],
} as const satisfies DeviceAuthorityProjection;

const noAuthority = {
  schemaVersion: 1,
  role: "none",
  scopes: [],
} as const satisfies DeviceAuthorityProjection;

function expectedSurface(
  mode: RuntimeMode,
  outcome: (typeof gateOutcomes)[number],
  held: boolean,
): AccountSurfaceView["surface"] {
  if (mode === "locked" || outcome === "locked") {
    return "locked";
  }
  if (mode === "local_continuation") {
    return "local_continuation";
  }
  if (mode === "standby" || outcome === "standby_eligible") {
    return "standby_read_only";
  }
  if (mode === "activating" || mode === "draining") {
    return "activating";
  }
  return held ? "active" : "standby_read_only";
}

describe("runtime-mode read-only ports", () => {
  it("exposes only the frozen read methods", () => {
    expectTypeOf<keyof AccountGatePort>().toEqualTypeOf<"getGateStatus">();
    expectTypeOf<AccountGatePort["getGateStatus"]>().returns.resolves.toEqualTypeOf<AccountGateStatus>();

    expectTypeOf<keyof DeviceDirectoryPort>().toEqualTypeOf<
      "listBindings" | "getLeaseStatus" | "getAuthority"
    >();
    expectTypeOf<DeviceDirectoryPort["listBindings"]>().returns.resolves.toEqualTypeOf<DeviceBindingList>();
    expectTypeOf<DeviceDirectoryPort["getLeaseStatus"]>().returns.resolves.toEqualTypeOf<ActiveDeviceLeaseStatus>();
    expectTypeOf<DeviceDirectoryPort["getAuthority"]>().returns.resolves.toEqualTypeOf<DeviceAuthorityProjection>();

    expectTypeOf<keyof DeviceSwitchPort>().toEqualTypeOf<"requestSwitch" | "getSwitchStatus">();
    expectTypeOf<DeviceSwitchPort["requestSwitch"]>().parameter(0).toEqualTypeOf<DeviceSwitchRequest>();
    expectTypeOf<DeviceSwitchPort["requestSwitch"]>().returns.resolves.toEqualTypeOf<
      DeviceSwitchRequestView | AccountRejection
    >();
    expectTypeOf<DeviceSwitchPort["getSwitchStatus"]>().parameter(0).toEqualTypeOf<string>();
    expectTypeOf<DeviceSwitchPort["getSwitchStatus"]>().returns.resolves.toEqualTypeOf<
      DeviceSwitchRequestView | null
    >();

    expectTypeOf<keyof EntitlementPort>().toEqualTypeOf<"getEntitlement">();
    expectTypeOf<EntitlementPort["getEntitlement"]>().returns.resolves.toEqualTypeOf<EntitlementProjection>();

    expectTypeOf<keyof AuthSessionPort>().toEqualTypeOf<"getAuthStatus" | "listSessions">();
    expectTypeOf<AuthSessionPort["getAuthStatus"]>().returns.resolves.toEqualTypeOf<AuthSessionStatus>();
    expectTypeOf<AuthSessionPort["listSessions"]>().returns.resolves.toEqualTypeOf<AccountSessionList>();
  });

  it("surfaces Cloud-adjudicated switch rejections and takeover timestamps unchanged", async () => {
    const rejection = accountRejectionSchema.parse({
      schemaVersion: 1,
      code: "EXCLUSIVE_EXECUTION_BLOCKED",
      retryable: false,
      retryAfterSeconds: null,
      correlationId: "correlation-1",
    });
    const adjudicatedView = switchView("waiting_expiry", "device-a");
    const port: DeviceSwitchPort = {
      requestSwitch: async () => rejection,
      getSwitchStatus: async () => adjudicatedView,
    };

    await expect(port.requestSwitch({
      schemaVersion: 1,
      mode: "forced",
      toDeviceId: "device-b",
      idempotencyKey: "switch-attempt-1",
      reauthProofId: "reauth-proof-1",
    })).resolves.toEqual(rejection);
    await expect(port.getSwitchStatus(adjudicatedView.requestId)).resolves.toMatchObject({
      earliestTakeoverAt: "2026-08-14T12:00:00Z",
    });
  });

  it("keeps AccountSurface closed to the five frozen members", () => {
    expectTypeOf<AccountSurface>().toEqualTypeOf<
      "locked" | "standby_read_only" | "activating" | "active" | "local_continuation"
    >();
  });

  it("keeps auth and inventory states closed to the frozen protocol members", () => {
    expectTypeOf<AuthSurfaceView["authState"]>().toEqualTypeOf<
      "signed_out" | "authenticated" | "refresh_required" | "reauth_required" | "revoked"
    >();
    expectTypeOf<SessionInventoryStatus>().toEqualTypeOf<"active" | "revoked">();
  });
});

describe("projectAccountSurface", () => {
  it("uses only schema-valid authority fixtures", () => {
    expect(deviceAuthorityProjectionSchema.safeParse(projectedActiveAuthority).success).toBe(true);
    expect(deviceAuthorityProjectionSchema.safeParse(readOnlyAuthority).success).toBe(true);
    expect(deviceAuthorityProjectionSchema.safeParse(noAuthority).success).toBe(true);
  });

  for (const mode of runtimeModes) {
    for (const outcome of gateOutcomes) {
      for (const held of [false, true] as const) {
        it(`projects ${mode} / ${outcome} / lease ${held ? "held" : "not held"}`, () => {
          const projectedSurface = expectedSurface(mode, outcome, held);
          const projectedRuntime = runtime(mode);
          const projectedGate = gate(outcome);
          const projectedLease = lease(held);

          expect(runtimeStatusSchema.safeParse(projectedRuntime).success).toBe(true);
          expect(accountGateStatusSchema.safeParse(projectedGate).success).toBe(true);
          expect(activeDeviceLeaseStatusSchema.safeParse(projectedLease).success).toBe(true);
          expect(deviceAuthorityProjectionSchema.safeParse(projectedActiveAuthority).success).toBe(true);

          const result = projectAccountSurface(
            projectedRuntime,
            projectedGate,
            projectedLease,
            projectedActiveAuthority,
          );

          expect(result.surface).toBe(projectedSurface);
          expect(result.lockReason).toBe(outcome === "locked" ? "offline_lease_expired" : null);

          if (projectedSurface === "active") {
            expect(result.capabilities).toEqual(fullActiveScopes);
          } else {
            expect(result.capabilities).toEqual(["account:manage", "workspace:read"]);
          }
        });
      }
    }
  }

  it("copies already-decided scopes without sharing or re-deriving them", () => {
    const result = projectAccountSurface(
      runtime("active"),
      gate("active_eligible"),
      lease(true),
      projectedActiveAuthority,
    );

    expect(result.capabilities).toEqual(fullActiveScopes);
    expect(result.capabilities).not.toBe(projectedActiveAuthority.scopes);
    expectTypeOf(result.capabilities).toEqualTypeOf<readonly CloudScope[]>();
  });

  it("removes active-only capabilities when an active authority is downgraded", () => {
    const result = projectAccountSurface(
      runtime("active"),
      gate("active_eligible"),
      lease(false),
      projectedActiveAuthority,
    );

    expect(result.surface).toBe("standby_read_only");
    expect(result.capabilities).toEqual(["account:manage", "workspace:read"]);
    expect(result.capabilities).not.toContain("workspace:mutate");
    expect(result.capabilities).not.toContain("platform:read");
    expect(result.capabilities).not.toContain("platform:write");
    expect(result.capabilities).not.toContain("operation:approve");
  });

  it("does not route to active when the authoritative role is standby or none", () => {
    const activeRuntime = runtime("active");
    const activeGate = gate("active_eligible");
    const heldLease = lease(true);

    expect(projectAccountSurface(activeRuntime, activeGate, heldLease, readOnlyAuthority).surface).toBe(
      "standby_read_only",
    );
    expect(projectAccountSurface(activeRuntime, activeGate, heldLease, noAuthority).surface).toBe("locked");
  });

  it("locks role none for every runtime, gate, and lease combination", () => {
    for (const mode of runtimeModes) {
      for (const outcome of gateOutcomes) {
        for (const held of [false, true] as const) {
          expect(projectAccountSurface(runtime(mode), gate(outcome), lease(held), noAuthority).surface).toBe(
            "locked",
          );
        }
      }
    }
  });

  it("gives a locked gate priority over local continuation", () => {
    const result = projectAccountSurface(
      runtime("local_continuation"),
      gate("locked"),
      lease(true),
      projectedActiveAuthority,
    );

    expect(result.surface).toBe("locked");
    expect(result.lockReason).toBe("offline_lease_expired");
    expect(result.capabilities).toEqual(["account:manage", "workspace:read"]);
  });

  it("does not inspect clocks or timestamp fields", () => {
    const now = vi.spyOn(Date, "now").mockImplementation(() => {
      throw new Error("projectAccountSurface must not read the wall clock");
    });
    const before = projectAccountSurface(runtime("active"), gate("active_eligible"), lease(true), readOnlyAuthority);
    const after = projectAccountSurface(
      runtime("active"),
      { ...gate("active_eligible"), evaluatedAt: "2099-12-31T23:59:59Z" },
      {
        ...lease(true),
        issuedAt: "1900-01-01T00:00:00Z",
        renewAfter: "1900-01-01T00:00:01Z",
        onlineExpiresAt: "1900-01-01T00:00:02Z",
        offlineExecuteUntil: "1900-01-01T00:00:03Z",
        evaluatedAt: "1900-01-01T00:00:04Z",
      },
      readOnlyAuthority,
    );

    expect(after).toEqual(before);
    expect(now).not.toHaveBeenCalled();
  });

  it("contains no clock arithmetic, timestamp inspection, mutation port, Cloud implementation, or Tauri import", () => {
    const source = readFileSync(resolve(import.meta.dirname, "../src/runtime-mode/index.ts"), "utf8");

    expect(source).not.toMatch(/\bDate\b|evaluatedAt|issuedAt|renewAfter|onlineExpiresAt|offlineExecuteUntil/);
    expect(source).not.toMatch(/from\s+["'](?:@tauri-apps|apps\/cloud)|\b(?:set|update|remove|transition|mutate)\w*\s*\(|\bswitch[A-Z]\w*\s*\(/i);
  });
});

function expectedAuthSurface(
  accountSurface: AccountSurface,
  outcome: (typeof gateOutcomes)[number],
  state: AuthSessionState,
): AccountSurface {
  if (state === "signed_out" || state === "revoked" || outcome === "locked") return "locked";
  if (
    (state === "refresh_required" || state === "reauth_required") &&
    (accountSurface === "active" || accountSurface === "activating")
  ) {
    return "standby_read_only";
  }
  return accountSurface;
}

describe("projectAuthSurface", () => {
  for (const state of authStates) {
    for (const outcome of gateOutcomes) {
      for (const held of [false, true] as const) {
        it(`projects ${state} / ${outcome} / lease ${held ? "held" : "not held"} restrictively`, () => {
          const projectedGate = gate(outcome);
          const account = projectAccountSurface(
            runtime("active"),
            projectedGate,
            lease(held),
            projectedActiveAuthority,
          );
          const auth = authStatus(state);
          const result = projectAuthSurface(account, projectedGate, auth);
          const expected = expectedAuthSurface(account.surface, outcome, state);

          expect(result.surface).toBe(expected);
          expect(result.authState).toBe(state);
          expect(result.accountId).toBe(auth.accountId);
          expect(result.sessionId).toBe(auth.sessionId);
          expect(result.revocationReason).toBe(auth.revocationReason);

          if (state === "signed_out" || state === "revoked") {
            expect(result.capabilities).toEqual([]);
          } else if (expected === "active") {
            expect(result.capabilities).toEqual(fullActiveScopes);
          } else {
            expect(result.capabilities).toEqual(["account:manage", "workspace:read"]);
          }
        });
      }
    }
  }

  it("does not turn access expiry into a locked surface", () => {
    const projectedGate = gate("active_eligible");
    const account = projectAccountSurface(
      runtime("active"),
      projectedGate,
      lease(true),
      projectedActiveAuthority,
    );

    expect(projectAuthSurface(account, projectedGate, authStatus("refresh_required"))).toMatchObject({
      surface: "standby_read_only",
      authState: "refresh_required",
    });
  });

  it("does not inspect clocks or expiry metadata", () => {
    const now = vi.spyOn(Date, "now").mockImplementation(() => {
      throw new Error("projectAuthSurface must not read the wall clock");
    });
    const projectedGate = gate("active_eligible");
    const account = projectAccountSurface(
      runtime("active"),
      projectedGate,
      lease(true),
      projectedActiveAuthority,
    );
    const before = authStatus("authenticated");
    const after = {
      ...before,
      accessTokenExpiresAt: "2099-12-31T23:59:59Z",
      refreshRotationGeneration: 999,
      lastTrustedTimeAt: "1900-01-01T00:00:00Z",
    } satisfies AuthSessionStatus;

    expect(projectAuthSurface(account, projectedGate, after)).toEqual(
      projectAuthSurface(account, projectedGate, before),
    );
    expect(now).not.toHaveBeenCalled();
  });

  it("contains no clock, credential, lease, or authority inspection", () => {
    const source = readFileSync(resolve(import.meta.dirname, "../src/runtime-mode/index.ts"), "utf8");
    const projection = source.match(
      /export function projectAuthSurface[\s\S]*?(?=\/\*\* Copies the frozen wire DTO)/,
    )?.[0];

    expect(projection).toBeDefined();
    expect(projection).not.toMatch(/\bDate\b|Date\.now|Date\.parse|getTime|performance\.now/);
    expect(projection).not.toMatch(/accessToken|refreshToken|password|passphrase|secret|credential|\bjti\b/i);
    expect(projection).not.toMatch(/\.role\b|\.scopes\b|\blease\b/);
    expect(projection).not.toMatch(/(?:accessTokenExpiresAt|lastTrustedTimeAt|createdAt|lastSeenAt)\s*[<>]=?/);
  });
});

describe("projectSessionInventory", () => {
  const inventory = accountSessionListSchema.parse({
    schemaVersion: 1,
    listRevision: 7,
    sessions: [
      {
        schemaVersion: 1,
        sessionId: "desktop-session",
        clientKind: "desktop",
        deviceId: "device-a",
        displayName: "Main Mac",
        createdAt: "2026-08-12T12:00:00Z",
        lastSeenAt: "2026-08-13T12:00:00Z",
        currentSession: true,
        status: "active",
        revokedAt: null,
      },
      {
        schemaVersion: 1,
        sessionId: "web-session",
        clientKind: "account_web",
        deviceId: null,
        displayName: "Chrome on macOS",
        createdAt: "2026-08-10T12:00:00Z",
        lastSeenAt: "2026-08-11T12:00:00Z",
        currentSession: false,
        status: "revoked",
        revokedAt: "2026-08-12T12:00:00Z",
      },
    ],
  });

  it("copies the redacted inventory into a client-owned display view", () => {
    const result = projectSessionInventory(inventory);

    expect(result).toEqual({
      listRevision: 7,
      sessions: inventory.sessions.map(({ schemaVersion: _schemaVersion, ...session }) => session),
    });
    expect(result.sessions).not.toBe(inventory.sessions);
    expect(result.sessions[0]).not.toBe(inventory.sessions[0]);
    expectTypeOf(result).toEqualTypeOf<SessionInventoryView>();
  });

  it("passes timestamps through without clock arithmetic", () => {
    const now = vi.spyOn(Date, "now").mockImplementation(() => {
      throw new Error("projectSessionInventory must not read the wall clock");
    });
    const earlier = projectSessionInventory(inventory);
    const later = projectSessionInventory({
      ...inventory,
      sessions: inventory.sessions.map((session) => ({
        ...session,
        createdAt: "2099-12-31T23:59:57Z",
        lastSeenAt: "2099-12-31T23:59:58Z",
        revokedAt: session.revokedAt === null ? null : "2099-12-31T23:59:59Z",
      })),
    });

    expect(earlier.sessions[0]?.createdAt).toBe("2026-08-12T12:00:00Z");
    expect(later.sessions[0]?.createdAt).toBe("2099-12-31T23:59:57Z");
    expect(now).not.toHaveBeenCalled();
  });

  it("contains no clock, credential, lease, or authority inspection", () => {
    const source = readFileSync(resolve(import.meta.dirname, "../src/runtime-mode/index.ts"), "utf8");
    const projection = source.match(
      /export function projectSessionInventory[\s\S]*?(?=export type SwitchProgress)/,
    )?.[0];

    expect(projection).toBeDefined();
    expect(projection).not.toMatch(/\bDate\b|Date\.now|Date\.parse|getTime|performance\.now/);
    expect(projection).not.toMatch(/accessToken|refreshToken|password|passphrase|secret|credential|\bjti\b/i);
    expect(projection).not.toMatch(/\.role\b|\.scopes\b|\blease\b|\.outcome\b/);
    expect(projection).not.toMatch(/(?:createdAt|lastSeenAt|revokedAt)\s*[<>]=?/);
  });
});

const switchStatuses = [
  "requested",
  "draining",
  "waiting_expiry",
  "bootstrapping",
  "completed",
  "cancelled",
  "failed",
] as const satisfies readonly DeviceSwitchRequestView["status"][];

function switchView(
  status: DeviceSwitchRequestView["status"],
  fromDeviceId: string | null,
): DeviceSwitchRequestView {
  const mode = status === "waiting_expiry" ? "forced" : "normal";
  return {
    schemaVersion: 1,
    requestId: `switch-${status}`,
    mode,
    status,
    fromDeviceId,
    toDeviceId: "device-b",
    requestedAt: "2026-08-13T12:00:00Z",
    earliestTakeoverAt: mode === "forced" ? "2026-08-14T12:00:00Z" : null,
    bootstrapExpiresAt: status === "bootstrapping" ? "2026-08-13T12:30:00Z" : null,
  };
}

function expectedSwitchProgress(
  status: DeviceSwitchRequestView["status"],
  fromDeviceId: string | null,
): SwitchProgress {
  if (status === "draining") return fromDeviceId === null ? "idle" : "awaiting_drain";
  if (status === "waiting_expiry") return "awaiting_takeover_window";
  if (status === "bootstrapping") return "rebuilding";
  if (status === "completed") return "finished";
  if (status === "cancelled" || status === "failed") return "abandoned";
  return "idle";
}

describe("projectSwitchProgress", () => {
  it("keeps SwitchProgress closed to the six frozen members", () => {
    expectTypeOf<SwitchProgress>().toEqualTypeOf<
      "idle" | "awaiting_drain" | "awaiting_takeover_window" | "rebuilding" | "finished" | "abandoned"
    >();
  });

  for (const status of switchStatuses) {
    for (const fromDeviceId of [null, "device-a"] as const) {
      it(`projects ${status} with ${fromDeviceId === null ? "no predecessor" : "a predecessor"}`, () => {
        const view = switchView(status, fromDeviceId);

        expect(deviceSwitchRequestViewSchema.safeParse(view).success).toBe(true);
        expect(projectSwitchProgress(view)).toBe(expectedSwitchProgress(status, fromDeviceId));
      });
    }
  }

  it("projects null, unknown, and conflicting inputs to idle", () => {
    expect(projectSwitchProgress(null)).toBe("idle");
    expect(projectSwitchProgress({ ...switchView("draining", null), status: "unknown" } as never)).toBe("idle");
    expect(projectSwitchProgress(switchView("draining", null))).toBe("idle");
    expect(
      projectSwitchProgress({
        ...switchView("waiting_expiry", "device-a"),
        mode: "normal",
        earliestTakeoverAt: null,
      } as DeviceSwitchRequestView),
    ).toBe("idle");
    expect(
      projectSwitchProgress({
        ...switchView("bootstrapping", "device-a"),
        bootstrapExpiresAt: null,
      } as DeviceSwitchRequestView),
    ).toBe("idle");
  });

  it("renders the server timestamp without comparing it to a local clock (P16-INV-29)", () => {
    const now = vi.spyOn(Date, "now").mockImplementation(() => {
      throw new Error("projectSwitchProgress must not read the wall clock");
    });
    const earlier = switchView("waiting_expiry", "device-a");
    const later = { ...earlier, earliestTakeoverAt: "2099-12-31T23:59:59Z" };

    expect(earlier.earliestTakeoverAt).toBe("2026-08-14T12:00:00Z");
    expect(projectSwitchProgress(earlier)).toBe("awaiting_takeover_window");
    expect(projectSwitchProgress(later)).toBe("awaiting_takeover_window");
    expect(now).not.toHaveBeenCalled();
  });

  it("contains no timestamp comparison or local clock arithmetic (P16-INV-29)", () => {
    const source = readFileSync(resolve(import.meta.dirname, "../src/runtime-mode/index.ts"), "utf8");

    expect(source).not.toMatch(/\bDate\b|Date\.now|Date\.parse|getTime|performance\.now/);
    expect(source).not.toMatch(/(?:earliestTakeoverAt|requestedAt|bootstrapExpiresAt)\s*[<>]=?/);
    expect(source).not.toMatch(/from\s+["'](?:@tauri-apps|apps\/cloud)/);
  });
});
