import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, expectTypeOf, it, vi } from "vitest";

import {
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
import { deviceSwitchRequestViewSchema } from "@gooddealer/protocol/devices";
import type {
  ActiveDeviceLeaseStatus,
  DeviceAuthorityProjection,
  DeviceBindingList,
  DeviceSwitchRequest,
  DeviceSwitchRequestView,
} from "@gooddealer/protocol/devices";

import {
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
  type SessionInventoryStatus,
  type SessionInventoryView,
  type SwitchProgress,
  projectSwitchProgress,
} from "../src/index";

const timestamp = "2026-08-13T12:00:00Z";

const gateOutcomes = ["locked", "standby_eligible", "active_eligible"] as const;

const authStates = [
  "signed_out",
  "authenticated",
  "refresh_required",
  "reauth_required",
  "revoked",
] as const satisfies readonly AuthSessionState[];

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

const activeAccountSurface = {
  surface: "active",
  lockReason: null,
  capabilities: [
    "account:manage",
    "operation:approve",
    "platform:read",
    "platform:write",
    "workspace:mutate",
    "workspace:read",
  ],
} as const satisfies AccountSurfaceView;

const standbyAccountSurface = {
  surface: "standby_read_only",
  lockReason: null,
  capabilities: ["account:manage", "workspace:read"],
} as const satisfies AccountSurfaceView;

const authAccountSurfaces = [
  activeAccountSurface,
  standbyAccountSurface,
] as const satisfies readonly AccountSurfaceView[];

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
      for (const account of authAccountSurfaces) {
        it(`projects ${state} / ${outcome} / ${account.surface} restrictively`, () => {
          const projectedGate = gate(outcome);
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
            expect(result.capabilities).toEqual(activeAccountSurface.capabilities);
          } else {
            expect(result.capabilities).toEqual(standbyAccountSurface.capabilities);
          }
        });
      }
    }
  }

  it("does not turn access expiry into a locked surface", () => {
    const projectedGate = gate("active_eligible");

    expect(projectAuthSurface(activeAccountSurface, projectedGate, authStatus("refresh_required"))).toMatchObject({
      surface: "standby_read_only",
      authState: "refresh_required",
    });
  });

  it("does not inspect clocks or expiry metadata", () => {
    const now = vi.spyOn(Date, "now").mockImplementation(() => {
      throw new Error("projectAuthSurface must not read the wall clock");
    });
    const projectedGate = gate("active_eligible");
    const before = authStatus("authenticated");
    const after = {
      ...before,
      accessTokenExpiresAt: "2099-12-31T23:59:59Z",
      refreshRotationGeneration: 999,
      lastTrustedTimeAt: "1900-01-01T00:00:00Z",
    } satisfies AuthSessionStatus;

    expect(projectAuthSurface(activeAccountSurface, projectedGate, after)).toEqual(
      projectAuthSurface(activeAccountSurface, projectedGate, before),
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
