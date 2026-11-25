import { describe, expect, it } from "vitest";
import type { AccountTransaction } from "../src/db/index";
import { readDesktopSessionAuthority } from "../src/modules/devices/desktop-session-authority";

const principal = { accountId: "account-a", sessionId: "session-a", clientKind: "desktop" as const };
type QueryResult = readonly Record<string, unknown>[];

describe("locked Desktop role derivation", () => {
  it("grants Standby to a bound session without commercial or execution authority", async () => {
    await expect(resolve()).resolves.toEqual({ deviceId: "device-a", role: "standby", accountSecurityEpoch: 3, leaseEpochFloor: 7 });
  });
  it("denies cross-account scope before reading persistence", async () => {
    const transaction = { accountId: "account-b", query: async () => { throw new Error("must not query"); } } as AccountTransaction;
    await expect(readDesktopSessionAuthority(transaction, principal, "workspace-a")).resolves.toBeNull();
  });
  it.each([
    ["security", "identity_account_security_states", [{ status: "recovery_pending", account_security_epoch: "3" }]],
    ["session/family", "identity_auth_sessions", []],
    ["workspace", "workspace_account_bindings", []],
    ["binding/key", "SELECT 1 FROM device_bindings", []],
    ["epoch ordering", "SELECT highest_allocated", [{ highest_allocated_lease_epoch: "6", current_lease_epoch: "7" }]],
    ["expired own lease", "AS allocation_valid", [{ device_id: "device-a", lease_epoch: "7", live: false, allocation_valid: true }]],
    ["unactivated own lease", "AS allocation_valid", [{ device_id: "device-a", lease_epoch: "7", live: true, allocation_valid: false }]],
    ["stale own lease", "AS allocation_valid", [{ device_id: "device-a", lease_epoch: "6", live: true, allocation_valid: true }]],
  ] as const)("denies invalid %s", async (_label, query, rows) => {
    await expect(resolve({ [query]: rows })).resolves.toBeNull();
  });
  it("requires current, live, activated own Lease for Active", async () => {
    await expect(resolve({ "AS allocation_valid": [{ device_id: "device-a", lease_epoch: "7", live: true, allocation_valid: true }] }))
      .resolves.toMatchObject({ role: "active", leaseEpochFloor: 7 });
  });
  it("reserves the pending epoch only for its exact bootstrapping target", async () => {
    const pending = { "status = 'pending'": [{ lease_epoch: "8", workspace_id: "workspace-a", workflow_id: "switch-a" }],
      "SELECT highest_allocated": [{ highest_allocated_lease_epoch: "8", current_lease_epoch: "7" }] };
    await expect(resolve({ ...pending, "SELECT w.to_device_id": [{ to_device_id: "device-a" }] })).resolves.toMatchObject({ role: "standby", leaseEpochFloor: 7 });
    await expect(resolve({ ...pending, "SELECT w.to_device_id": [{ to_device_id: "device-b" }] })).resolves.toMatchObject({ role: "standby", leaseEpochFloor: 8 });
    // The query requires matching active key, security epoch, deadline and unconsumed capability.
    await expect(resolve({ ...pending, "SELECT w.to_device_id": [] })).resolves.toBeNull();
    await expect(resolve({ ...pending, "status = 'pending'": [{ lease_epoch: "8", workspace_id: "workspace-b", workflow_id: "switch-a" }] })).resolves.toBeNull();
  });
});
function resolve(overrides: Record<string, QueryResult> = {}) {
  const transaction = { accountId: "account-a", query: async (sql: string) => {
    for (const [fragment, rows] of Object.entries(overrides)) if (sql.includes(fragment)) return { rows: [...rows] };
    if (sql.includes("identity_account_security_states")) return { rows: [{ status: "normal", account_security_epoch: "3" }] };
    if (sql.includes("identity_auth_sessions")) return { rows: [{ device_id: "device-a" }] };
    if (sql.includes("SELECT highest_allocated")) return { rows: [{ highest_allocated_lease_epoch: "7", current_lease_epoch: "7" }] };
    if (sql.includes("AS allocation_valid") || sql.includes("status = 'pending'")) return { rows: [] };
    if (sql.includes("workspace_account_bindings") || sql.includes("set_config") || sql.includes("SELECT 1 FROM device_bindings")) return { rows: [{}] };
    throw new Error("unexpected authority query");
  } } as AccountTransaction;
  return readDesktopSessionAuthority(transaction, principal, "workspace-a");
}
