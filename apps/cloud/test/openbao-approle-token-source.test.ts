import { describe, expect, it, vi } from "vitest";

import {
  OpenBaoAppRoleAuthenticationError,
  OpenBaoAppRoleTokenSource,
} from "../src/entrypoints/openbao-approle-token-source";

describe("OpenBao AppRole token source", () => {
  it("deduplicates concurrent logins and refreshes before token expiry", async () => {
    let now = 1_000_000;
    let tokenNumber = 0;
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      tokenNumber += 1;
      expect(init.redirect).toBe("error");
      expect(JSON.parse(String(init.body))).toEqual({ role_id: "role-a", secret_id: "secret-a" });
      return jsonResponse({
        auth: {
          client_token: `token-${tokenNumber}`,
          lease_duration: 900,
          policies: ["default", "gooddealer-dev-authority"],
        },
      });
    });
    const source = new OpenBaoAppRoleTokenSource({
      address: "https://127.0.0.1:8200",
      requiredPolicy: "gooddealer-dev-authority",
      allowedPolicies: ["default", "gooddealer-dev-authority"],
      credentialsSource: async () => ({ roleId: "role-a", secretId: "secret-a" }),
      fetch,
      now: () => now,
    });

    await expect(Promise.all([source.token(), source.token(), source.token()]))
      .resolves.toEqual(["token-1", "token-1", "token-1"]);
    expect(fetch).toHaveBeenCalledOnce();
    now += 839_000;
    await expect(source.token()).resolves.toBe("token-1");
    now += 2_000;
    await expect(source.token()).resolves.toBe("token-2");
    expect(fetch).toHaveBeenCalledTimes(2);

    source.invalidate("token-1");
    await expect(source.token()).resolves.toBe("token-2");
    source.invalidate("token-2");
    await expect(source.token()).resolves.toBe("token-3");
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("fails closed for insecure origins, malformed credentials, policies and responses", async () => {
    expect(() => new OpenBaoAppRoleTokenSource({
      address: "http://openbao.internal",
      requiredPolicy: "authority",
      allowedPolicies: ["default", "authority"],
      credentialsSource: async () => ({ roleId: "role", secretId: "secret" }),
    })).toThrow(/HTTPS origin/u);

    const failures = [
      jsonResponse({ auth: { client_token: "token", lease_duration: 900, policies: ["other"] } }),
      jsonResponse({ auth: { client_token: "token", lease_duration: 900, policies: ["authority", "admin"] } }),
      jsonResponse({ auth: { client_token: "token", lease_duration: 9_000, policies: ["authority"] } }),
      new Response("not-json", { status: 200, headers: { "content-type": "text/plain" } }),
      jsonResponse({ errors: ["permission denied"] }, 403),
    ];
    for (const response of failures) {
      const source = new OpenBaoAppRoleTokenSource({
        address: "https://openbao.internal",
        requiredPolicy: "authority",
        allowedPolicies: ["default", "authority"],
        credentialsSource: async () => ({ roleId: "role", secretId: "secret" }),
        fetch: async () => response,
      });
      await expect(source.token()).rejects.toBeInstanceOf(OpenBaoAppRoleAuthenticationError);
    }
    const invalidCredential = new OpenBaoAppRoleTokenSource({
      address: "https://openbao.internal",
      requiredPolicy: "authority",
      allowedPolicies: ["default", "authority"],
      credentialsSource: async () => ({ roleId: "role", secretId: "do not accept whitespace" }),
      fetch: async () => jsonResponse({}),
    });
    await expect(invalidCredential.token()).rejects.toBeInstanceOf(OpenBaoAppRoleAuthenticationError);
  });

  it("bounds response bodies and does not expose credentials in errors", async () => {
    const source = new OpenBaoAppRoleTokenSource({
      address: "https://openbao.internal",
      requiredPolicy: "authority",
      allowedPolicies: ["default", "authority"],
      credentialsSource: async () => ({ roleId: "role-secret-marker", secretId: "secret-id-marker" }),
      fetch: async () => jsonResponse({ padding: "x".repeat(33_000) }),
    });
    let observed: unknown;
    try {
      await source.token();
    } catch (error) {
      observed = error;
    }
    expect(observed).toBeInstanceOf(OpenBaoAppRoleAuthenticationError);
    expect(String(observed)).not.toContain("role-secret-marker");
    expect(String(observed)).not.toContain("secret-id-marker");
  });

  it("cancels a streaming authentication error body before failing", async () => {
    let cancelled = false;
    const source = new OpenBaoAppRoleTokenSource({
      address: "https://openbao.internal",
      requiredPolicy: "authority",
      allowedPolicies: ["default", "authority"],
      credentialsSource: async () => ({ roleId: "role", secretId: "secret" }),
      fetch: async () => streamingErrorResponse(() => { cancelled = true; }),
    });

    await expect(source.token()).rejects.toBeInstanceOf(OpenBaoAppRoleAuthenticationError);
    expect(cancelled).toBe(true);
  });

  it("cancels a streaming successful response with invalid metadata", async () => {
    let cancelled = false;
    const source = new OpenBaoAppRoleTokenSource({
      address: "https://openbao.internal",
      requiredPolicy: "authority",
      allowedPolicies: ["default", "authority"],
      credentialsSource: async () => ({ roleId: "role", secretId: "secret" }),
      fetch: async () => streamingResponse(
        200,
        "text/plain",
        () => { cancelled = true; },
      ),
    });

    await expect(source.token()).rejects.toBeInstanceOf(OpenBaoAppRoleAuthenticationError);
    expect(cancelled).toBe(true);
  });

  it("rejects an allowlist that omits or duplicates the required policy", () => {
    const base = {
      address: "https://openbao.internal",
      requiredPolicy: "authority",
      credentialsSource: async () => ({ roleId: "role", secretId: "secret" }),
    };
    expect(() => new OpenBaoAppRoleTokenSource({ ...base, allowedPolicies: ["default"] }))
      .toThrow(/allowed policies/u);
    expect(() => new OpenBaoAppRoleTokenSource({
      ...base,
      allowedPolicies: ["authority", "authority"],
    })).toThrow(/allowed policies/u);
  });
});

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function streamingErrorResponse(onCancel: () => void): Response {
  return streamingResponse(403, "application/json", onCancel);
}

function streamingResponse(status: number, contentType: string, onCancel: () => void): Response {
  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"errors":['));
    },
    cancel() {
      onCancel();
    },
  }), {
    status,
    headers: { "content-type": contentType },
  });
}
