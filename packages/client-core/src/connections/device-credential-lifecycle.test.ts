import { describe, expect, it } from "vitest";

import {
  ValidatingDeviceCredentialLifecyclePort,
  parseDeviceCredentialLifecycleObservation,
  planDeviceCredentialLifecycleIntent,
  type DeviceCredentialLifecycleBoundary,
} from "./device-credential-lifecycle";

const healthyProvider = {
  schemaVersion: 1,
  surface: "active",
  providerConnectionId: "connection-a",
  deviceId: "device-a",
  source: "provider_secret",
  credentialHealth: "healthy",
  candidateState: "configured_candidate",
  healthGeneration: 4,
  bindingVersion: 7,
  lastCheckedAt: "2026-08-20T00:00:00Z",
  requiredAction: "none",
} as const;

describe("device credential lifecycle redacted orchestration", () => {
  it("first configuration exposes only capture intent until Host reports healthy", () => {
    expect(
      planDeviceCredentialLifecycleIntent({
        ...healthyProvider,
        credentialHealth: "unconfigured",
        candidateState: "never_configured",
        lastCheckedAt: null,
        requiredAction: "capture_credentials",
      }),
    ).toEqual({ kind: "capture_credentials", providerConnectionId: "connection-a" });
    expect(planDeviceCredentialLifecycleIntent(healthyProvider)).toEqual({
      kind: "none",
      providerConnectionId: "connection-a",
    });
  });

  it("switch-back candidate remains non-authoritative and requests Active reverification", () => {
    const standby = {
      ...healthyProvider,
      surface: "standby",
      credentialHealth: "retained_unverified",
      lastCheckedAt: null,
      requiredAction: "reverify_when_active",
    } as const;
    expect(planDeviceCredentialLifecycleIntent(standby)).toEqual({
      kind: "reverify_when_active",
      providerConnectionId: "connection-a",
    });
    for (const forbidden of [
      { ...standby, credentialHealth: "healthy", requiredAction: "none" },
      { ...standby, lastCheckedAt: "2026-08-20T00:00:00Z" },
      { ...standby, runtimeMode: "active" },
    ]) {
      expect(() => parseDeviceCredentialLifecycleObservation(forbidden)).toThrow(
        "invalid device credential lifecycle observation",
      );
    }
  });

  it("revocation and keychain loss require capture and never expose a usable action", () => {
    for (const credentialHealth of ["revoked", "invalid"] as const) {
      expect(
        planDeviceCredentialLifecycleIntent({
          ...healthyProvider,
          credentialHealth,
          candidateState: credentialHealth === "revoked" ? "never_configured" : "unknown",
          lastCheckedAt: null,
          requiredAction: "capture_credentials",
        }),
      ).toEqual({ kind: "capture_credentials", providerConnectionId: "connection-a" });
    }
    expect(
      planDeviceCredentialLifecycleIntent({
        ...healthyProvider,
        credentialHealth: "action_required",
        candidateState: "unknown",
        lastCheckedAt: null,
        requiredAction: "unavailable",
      }),
    ).toEqual({ kind: "unavailable", providerConnectionId: "connection-a" });
  });

  it("browser session expiry is type-distinct and requires sign-in", () => {
    const expiredBrowser = {
      ...healthyProvider,
      source: "browser_session",
      credentialHealth: "action_required",
      lastCheckedAt: null,
      requiredAction: "sign_in",
    } as const;
    expect(planDeviceCredentialLifecycleIntent(expiredBrowser)).toEqual({
      kind: "sign_in",
      providerConnectionId: "connection-a",
    });
    expect(() =>
      parseDeviceCredentialLifecycleObservation({
        ...expiredBrowser,
        requiredAction: "capture_credentials",
      }),
    ).toThrow("invalid device credential lifecycle observation");
    expect(() =>
      parseDeviceCredentialLifecycleObservation({
        ...expiredBrowser,
        authSessionState: "refresh_required",
      }),
    ).toThrow("invalid device credential lifecycle observation");
  });

  it("keeps capturing authenticating and verifying without an available business action", () => {
    for (const credentialHealth of ["capturing", "authenticating", "verifying"] as const) {
      expect(
        planDeviceCredentialLifecycleIntent({
          ...healthyProvider,
          credentialHealth,
          lastCheckedAt: null,
          requiredAction: "unavailable",
        }).kind,
      ).toBe("unavailable");
    }
  });

  it("rejects secret authority profile and caller-verdict fields", () => {
    for (const field of [
      "apiKey",
      "credentialRef",
      "slots",
      "credentialProfileId",
      "runtimeMode",
      "leaseEpoch",
      "accountSecurityEpoch",
      "sessionGeneration",
      "verificationSucceeded",
      "reusable",
    ]) {
      expect(() =>
        parseDeviceCredentialLifecycleObservation({ ...healthyProvider, [field]: "forbidden" }),
      ).toThrow("invalid device credential lifecycle observation");
    }
  });

  it("rejects inherited custom-prototype accessor and symbol inputs without getter execution", () => {
    expect(() => parseDeviceCredentialLifecycleObservation(Object.create(healthyProvider))).toThrow();
    expect(() =>
      parseDeviceCredentialLifecycleObservation(
        Object.assign(Object.create({ inherited: true }), healthyProvider),
      ),
    ).toThrow();
    let getterCalls = 0;
    const accessor = { ...healthyProvider } as Record<string, unknown>;
    Object.defineProperty(accessor, "providerConnectionId", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "connection-a";
      },
    });
    expect(() => parseDeviceCredentialLifecycleObservation(accessor)).toThrow();
    expect(getterCalls).toBe(0);
    expect(() =>
      parseDeviceCredentialLifecycleObservation({
        ...healthyProvider,
        [Symbol("secret")]: "hidden",
      }),
    ).toThrow();
  });

  it("rejects unsafe stale-shaped generations and mismatched source/action pairs", () => {
    for (const candidate of [
      { ...healthyProvider, healthGeneration: 0 },
      { ...healthyProvider, bindingVersion: Number.MAX_SAFE_INTEGER + 1 },
      { ...healthyProvider, requiredAction: "capture_credentials" },
      { ...healthyProvider, source: "browser_session", credentialHealth: "invalid" },
      { ...healthyProvider, lastCheckedAt: null },
    ]) {
      expect(() => parseDeviceCredentialLifecycleObservation(candidate)).toThrow(
        "invalid device credential lifecycle observation",
      );
    }
  });

  it("validates unknown Host output without adding network Keychain or browser behavior", async () => {
    const boundary: DeviceCredentialLifecycleBoundary = {
      observe: async () => healthyProvider,
    };
    const port = new ValidatingDeviceCredentialLifecyclePort(boundary);
    await expect(port.observe("connection-a")).resolves.toEqual(healthyProvider);
    await expect(port.observe("bad connection")).rejects.toThrow("invalid provider connection id");
  });
});
