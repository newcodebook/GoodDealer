import { describe, expect, it } from "vitest";

import { parseConnectionSettingsViewModel } from "./index";
import { parseSettingsRead, projectConnectionSettings, settingsConnectionHealth, type SettingsConnection } from "./settings-read";

const connection = {
  providerKind: "cloudflare",
  connectionLabel: "Cloudflare",
  lifecycleStatus: "active",
  validationStatus: "valid",
  credentialUseState: "active",
  lastValidatedAt: "2026-08-28T00:00:00Z",
  roles: [{ role: "dns", availability: "unavailable", unavailableReason: "qualification_pending" }],
} as const;

function read(overrides: Record<string, unknown> = {}): unknown {
  return {
    schemaVersion: 1,
    kind: "settings",
    readGeneration: 3,
    freshness: { source: "active_local", readOnlyReason: null, serverRevision: 2, lastReplicationActivityAt: null, lastSuccessfulProviderObservationAt: null, canEdit: true },
    connections: [connection],
    ...overrides,
  };
}

describe("settings Host read", () => {
  it("places each connection under its declared roles with no executable action", () => {
    const view = projectConnectionSettings(parseSettingsRead(read()), () => "unavailable before qualification");
    // The projection must satisfy the settings view-model contract it feeds.
    expect(parseConnectionSettingsViewModel(view)).toEqual(view);
    const dns = view.groups.find((group) => group.category === "dns");
    expect(dns?.connections).toHaveLength(1);
    expect(dns?.connections[0]).toMatchObject({
      provider: "Cloudflare",
      accountAlias: "Cloudflare",
      credentialHealth: "healthy",
      admission: { actionAvailability: "unavailable" },
      summary: "unavailable before qualification",
    });
    expect(view.groups.filter((group) => group.category !== "dns").every((group) => group.connections.length === 0)).toBe(true);
  });

  it("lists a connection on any ADR-0027 platform without guessing how it authenticates", () => {
    const view = projectConnectionSettings(parseSettingsRead(read({ connections: [
      connection,
      { ...connection, providerKind: "porkbun", connectionLabel: "Porkbun main", roles: [{ role: "registrar", availability: "unavailable", unavailableReason: "qualification_pending" }] },
      { ...connection, providerKind: "godaddy", connectionLabel: "GoDaddy", roles: [{ role: "marketplace", availability: "unavailable", unavailableReason: "qualification_pending" }] },
    ] })), () => "unavailable before qualification");
    expect(parseConnectionSettingsViewModel(view)).toEqual(view);
    const byCategory = Object.fromEntries(view.groups.map((group) => [group.category, group.connections.map((item) => [item.provider, item.method, item.admission.actionAvailability])]));
    expect(byCategory).toEqual({
      registrar: [["Porkbun", null, "unavailable"]],
      dns: [["Cloudflare", "api", "unavailable"]],
      marketplace: [["GoDaddy", null, "unavailable"]],
    });
  });

  it("rejects unknown fields, identifiers, executable roles and unknown roles", () => {
    for (const bad of [
      read({ extra: true }),
      read({ connections: [{ ...connection, connectionId: "cf-1" }] }),
      read({ connections: [{ ...connection, roles: [{ role: "dns", availability: "available", unavailableReason: "qualification_pending" }] }] }),
      read({ connections: [{ ...connection, roles: [{ role: "acquisition", availability: "unavailable", unavailableReason: "qualification_pending" }] }] }),
      read({ connections: [{ ...connection, roles: [connection.roles[0], connection.roles[0]] }] }),
      read({ connections: [{ ...connection, connectionLabel: "Cloud\u0007flare" }] }),
      read({ connections: [{ ...connection, providerKind: "sedo" }] }),
    ]) {
      expect(() => parseSettingsRead(bad)).toThrow();
    }
  });

  it("maps credential facts to a badge where revocation and remediation win", () => {
    const health = (overrides: Partial<SettingsConnection>) => settingsConnectionHealth({ ...connection, ...overrides } as SettingsConnection);
    expect(health({})).toBe("healthy");
    expect(health({ validationStatus: "unknown" })).toBe("retained_unverified");
    expect(health({ validationStatus: "unreachable" })).toBe("retained_unverified");
    expect(health({ validationStatus: "insufficient_scope" })).toBe("action_required");
    expect(health({ validationStatus: "invalid" })).toBe("invalid");
    expect(health({ credentialUseState: "inactive" })).toBe("unconfigured");
    expect(health({ credentialUseState: "transition_pending" })).toBe("verifying");
    expect(health({ credentialUseState: "remediation_required" })).toBe("action_required");
    expect(health({ lifecycleStatus: "revoked", validationStatus: "valid" })).toBe("revoked");
  });
});
