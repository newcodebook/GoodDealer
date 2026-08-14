import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, expectTypeOf, it, vi } from "vitest";

import { accountGateStatusSchema } from "@gooddealer/protocol/account";
import type { AccountGateStatus, EntitlementProjection } from "@gooddealer/protocol/account";
import {
  activeDeviceLeaseStatusSchema,
  deviceAuthorityProjectionSchema,
  runtimeStatusSchema,
} from "@gooddealer/protocol/devices";
import type {
  ActiveDeviceLeaseStatus,
  CloudScope,
  DeviceAuthorityProjection,
  DeviceBindingList,
  RuntimeStatus,
} from "@gooddealer/protocol/devices";

import {
  projectAccountSurface,
  type AccountGatePort,
  type AccountSurface,
  type AccountSurfaceView,
  type DeviceDirectoryPort,
  type EntitlementPort,
  type RuntimeMode,
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

    expectTypeOf<keyof EntitlementPort>().toEqualTypeOf<"getEntitlement">();
    expectTypeOf<EntitlementPort["getEntitlement"]>().returns.resolves.toEqualTypeOf<EntitlementProjection>();
  });

  it("keeps AccountSurface closed to the five frozen members", () => {
    expectTypeOf<AccountSurface>().toEqualTypeOf<
      "locked" | "standby_read_only" | "activating" | "active" | "local_continuation"
    >();
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
    expect(source).not.toMatch(/from\s+["'](?:@tauri-apps|apps\/cloud)|\b(?:set|update|remove|switch|transition|mutate)\w*\s*\(/i);
  });
});
