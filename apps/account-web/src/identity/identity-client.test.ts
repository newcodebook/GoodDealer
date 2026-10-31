import { describe, expect, it } from "vitest";

import { createIdentityClient, readIdentityStatus } from "./identity-client";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("readIdentityStatus", () => {
  it("accepts exactly one allowed status property", async () => {
    await expect(readIdentityStatus(json({ status: "accepted" }), ["accepted"])).resolves.toBe("accepted");
  });

  it.each([
    ["an extra key", { status: "accepted", account: "x" }],
    ["an unexpected status", { status: "authenticated" }],
    ["a non-string status", { status: 1 }],
    ["an array", ["accepted"]],
    ["null", null],
  ])("rejects %s", async (_label, body) => {
    await expect(readIdentityStatus(json(body), ["accepted"])).resolves.toBeNull();
  });

  it("rejects a body that is not JSON", async () => {
    await expect(readIdentityStatus(new Response("accepted"), ["accepted"])).resolves.toBeNull();
  });
});

describe("createIdentityClient", () => {
  it("sends credentials only to the fixed same-origin path with no redirects", async () => {
    const calls: { path: string; init: RequestInit }[] = [];
    const client = createIdentityClient(async (path, init) => { calls.push({ path, init }); return json({ status: "authenticated" }); });
    await expect(client.signIn("user@example.com", "pw")).resolves.toEqual({ ok: true, status: "authenticated" });
    expect(calls).toEqual([{ path: "/v1/identity/login", init: expect.objectContaining({ method: "POST", credentials: "same-origin", redirect: "error" }) }]);
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ email: "user@example.com", password: "pw" });
  });

  it("returns refusals as an HTTP status only and throws on a malformed success", async () => {
    const refused = createIdentityClient(async () => json({ message: "account exists" }, 409));
    await expect(refused.register("user@example.com", "pw")).resolves.toEqual({ ok: false, httpStatus: 409 });
    const malformed = createIdentityClient(async () => json({ status: "accepted", extra: true }));
    await expect(malformed.register("user@example.com", "pw")).rejects.toThrow(TypeError);
  });

  it("reports an invalid session reply instead of trusting HTTP 200", async () => {
    const client = createIdentityClient(async () => json({ status: "authenticated", namespace: "short" }));
    await expect(client.readSession()).resolves.toEqual({ kind: "invalid" });
  });
});
