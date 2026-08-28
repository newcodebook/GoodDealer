import { describe, expect, it } from "vitest";

import {
  ValidatingConnectionSettingsPort,
  parseConnectionSettingsViewModel,
  type ConnectionSettingsBoundary,
} from "./index";

const activeSettings = {
  schemaVersion: 1,
  surface: "active",
  groups: [
    {
      category: "marketplace",
      connections: [
        {
          providerConnectionId: "pc_atom_main",
          provider: "Atom",
          accountAlias: "主账户",
          remoteAccountId: "atom:acc_7Q2",
          category: "marketplace",
          method: "api",
          summary: "423 Listing",
          view: "active",
          credentialHealth: "healthy",
          quotaSummary: "独立限流",
          lastCheckedAt: "2026-08-17T06:00:00Z",
          admission: { actionAvailability: "available", action: "manage" },
        },
      ],
    },
  ],
} as const;

describe("connection settings boundary", () => {
  it("parses redacted Active settings and preserves only the proven row action", () => {
    const model = parseConnectionSettingsViewModel(activeSettings);

    expect(model.surface).toBe("active");
    expect(model.groups[0]?.connections[0]?.admission).toEqual({
      actionAvailability: "available",
      action: "manage",
    });
  });

  it("keeps Standby limited to a non-secret candidate marker with no action", () => {
    const model = parseConnectionSettingsViewModel({
      schemaVersion: 1,
      surface: "standby",
      groups: [
        {
          category: "marketplace",
          connections: [
            {
              providerConnectionId: "pc_atom_main",
              provider: "Atom",
              accountAlias: "主账户",
              remoteAccountId: null,
              category: "marketplace",
              method: "api",
              summary: "未验证，切换为 Active 后才能检查",
              view: "standby",
              candidateState: "configured_candidate",
              admission: { actionAvailability: "unavailable" },
            },
          ],
        },
      ],
    });
    const connection = model.groups[0]?.connections[0];

    expect(connection?.view).toBe("standby");
    expect(connection?.admission).toEqual({ actionAvailability: "unavailable" });
    expect(connection).not.toHaveProperty("credentialHealth");
    expect(connection).not.toHaveProperty("lastCheckedAt");
    expect(connection).not.toHaveProperty("quotaSummary");
  });

  it("rejects mismatched surfaces, duplicate ids, categories, and state-derived actions", () => {
    const cases: unknown[] = [
      { ...activeSettings, surface: "standby" },
      {
        ...activeSettings,
        groups: [
          {
            ...activeSettings.groups[0],
            connections: [
              activeSettings.groups[0].connections[0],
              activeSettings.groups[0].connections[0],
            ],
          },
        ],
      },
      {
        ...activeSettings,
        groups: [{ ...activeSettings.groups[0], category: "dns" }],
      },
      {
        ...activeSettings,
        groups: [{ ...activeSettings.groups[0], label: "untrusted presentation copy" }],
      },
      {
        ...activeSettings,
        groups: [
          {
            ...activeSettings.groups[0],
            connections: [
              {
                ...activeSettings.groups[0].connections[0],
                admission: { actionAvailability: "available", action: "connect" },
              },
            ],
          },
        ],
      },
    ];

    for (const candidate of cases) {
      expect(() => parseConnectionSettingsViewModel(candidate)).toThrow(
        "invalid connection settings projection",
      );
    }
  });

  it("fails closed on unknown fields without echoing their values into errors", () => {
    const canary = "GD_PRIVATE_VALUE_CANARY_57A6";
    const poisoned = {
      ...activeSettings,
      groups: [
        {
          ...activeSettings.groups[0],
          connections: [{ ...activeSettings.groups[0].connections[0], apiKey: canary }],
        },
      ],
    };

    let error: unknown;
    try {
      parseConnectionSettingsViewModel(poisoned);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(TypeError);
    expect(String(error)).not.toContain(canary);
  });

  it("validates unknown boundary output without adding any concrete Host or network behavior", async () => {
    const boundary: ConnectionSettingsBoundary = {
      getConnectionSettings: async () => activeSettings,
    };
    const port = new ValidatingConnectionSettingsPort(boundary);

    await expect(port.getConnectionSettings()).resolves.toEqual(activeSettings);
  });
});
