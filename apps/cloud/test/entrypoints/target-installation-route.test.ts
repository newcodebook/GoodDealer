import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { bootstrapCapabilityEnvelopeSchema } from "@gooddealer/protocol/devices";
import { createPublicHttp } from "../../src/entrypoints/http";
import { rateLimitPolicy } from "../../src/entrypoints/adapter/rate-limit";
import {
  TARGET_BOOTSTRAP_CLAIM_ROUTE, TARGET_BOOTSTRAP_STEP_ROUTE, TARGET_BOOTSTRAP_CHECKPOINT_ROUTE,
  TARGET_BOOTSTRAP_ACTIVATION_ROUTE, TARGET_BOOTSTRAP_RECEIPT_ROUTE,
} from "../../src/entrypoints/routes/public/target-installation";
import { denyingPublicApplicationPorts, StaticPublicSessionVerifier } from "../support/public-session";

const apps: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });
const principal = { accountId: "account-target", sessionId: "session-target", clientKind: "desktop" as const };
const headers = { authorization: "Bearer fixture" };
const capability = bootstrapCapabilityEnvelopeSchema.parse(JSON.parse(readFileSync(
  new URL("../../../../packages/protocol/test-vectors/device-identity/valid/bootstrap-capability.json", import.meta.url), "utf8",
)));
const digest = "A".repeat(43);
const lookup = { schemaVersion: 1, requestId: capability.payload.deviceSwitchRequestId };
const requests = [
  [TARGET_BOOTSTRAP_CLAIM_ROUTE, "claim", lookup, 2 * 1024],
  [TARGET_BOOTSTRAP_STEP_ROUTE, "step", { schemaVersion: 1, capability, step: {
    schemaVersion: 2, deviceSwitchRequestId: lookup.requestId, capabilityJti: capability.jti,
    stepNumber: 1, stepNonce: digest, expectedWorkflowRevision: 1, requestDigest: digest,
    stepKind: "pin_checkpoint", stepPayload: {},
  } }, 1024 * 1024],
  [TARGET_BOOTSTRAP_CHECKPOINT_ROUTE, "checkpoint", { ...lookup, capability, checkpointId: "checkpoint-a",
    checkpointDigest: digest, entityType: "domain_asset", partitionId: "empty", offset: 0, pageLimit: 256 }, 16 * 1024],
  [TARGET_BOOTSTRAP_ACTIVATION_ROUTE, "activate", { ...lookup, capability,
    activationId: "11111111-1111-4111-8111-111111111111", expectedWorkflowRevision: 3,
    pendingLeaseEpoch: 2, targetServerRevision: 0, workspaceSchemaVersion: 3,
    verifiedRebuildDigest: digest, requestDigest: digest }, 16 * 1024],
  [TARGET_BOOTSTRAP_RECEIPT_ROUTE, "receipt", { ...lookup, operation: { kind: "claim" } }, 16 * 1024],
] as const;
function create({ allowed = true, absent = false, invalid = false, denied = false, web = false } = {}) {
  const refusal = async () => denied ? null : invalid ? { schemaVersion: 1, accepted: false,
    code: "BOOTSTRAP_CONFLICT", privateData: "must-not-leak" } as never
    : { schemaVersion: 1 as const, accepted: false as const, code: "BOOTSTRAP_CONFLICT" as const };
  const installation = {
    claim: vi.fn(refusal), step: vi.fn(refusal), checkpoint: vi.fn(refusal), activate: vi.fn(refusal),
    receipt: vi.fn(async () => denied ? null : invalid ? { schemaVersion: 1, outcome: "not_found", privateData: "must-not-leak" } as never
      : { schemaVersion: 1 as const, outcome: "not_found" as const }),
  };
  const authorize = vi.fn(async (_principal: unknown, role: string) => allowed && ["active_or_standby", "bound_device"].includes(role));
  const app = createPublicHttp({
    sessions: new StaticPublicSessionVerifier(web ? [{ ...principal, sessionId: "web", clientKind: "account_web" }] : []),
    desktopAccessTokens: { verifyAccessToken: async () => principal },
    preAuthRateLimit: rateLimitPolicy(60_000, 100), sessionRateLimit: rateLimitPolicy(60_000, 100),
    now: () => new Date(), correlationIds: () => "target-installation-test",
    ports: { ...denyingPublicApplicationPorts, desktopRouteAuthority: { authorize },
      ...(absent ? {} : { targetBootstrapInstallation: installation }) },
  });
  apps.push(app);
  return { app, installation, authorize };
}
describe("target installation fixed HTTP routes", () => {
  it("admits each strict operation only through the current Desktop role and exact owner", async () => {
    const { app, installation, authorize } = create();
    for (const [url, operation, payload] of requests) {
      const reply = await app.inject({ method: "POST", url, headers, payload });
      expect(reply.statusCode).toBe(200);
      expect(reply.json()).toEqual(operation === "receipt" ? { schemaVersion: 1, outcome: "not_found" }
        : { schemaVersion: 1, accepted: false, code: "BOOTSTRAP_CONFLICT" });
      expect(installation[operation]).toHaveBeenCalledExactlyOnceWith(payload, principal);
    }
    expect(authorize).toHaveBeenCalledWith(principal, "active_or_standby");
  });
  it("rejects foreign selectors, missing fields and each route's byte overflow before the owner", async () => {
    const { app, installation } = create();
    for (const [url, operation, payload, limit] of requests) {
      for (const body of [{}, { ...payload, accountId: "foreign" }, { ...payload, workspaceId: "foreign" },
        { ...payload, targetDeviceId: "foreign" }]) {
        expect((await app.inject({ method: "POST", url, headers, payload: body })).statusCode).toBe(400);
      }
      const tooLarge = JSON.stringify(payload) + " ".repeat(limit);
      expect((await app.inject({ method: "POST", url, headers: { ...headers, "content-type": "application/json" }, payload: tooLarge })).statusCode).toBe(413);
      expect(installation[operation]).not.toHaveBeenCalled();
    }
  });
  it("hides missing composition, role denial, and Account Web without invoking installation", async () => {
    for (const options of [{ allowed: false }, { absent: true }, { web: true }]) {
      const { app, installation } = create(options);
      for (const [url, operation, payload] of requests) {
        const reply = await app.inject({ method: "POST", url,
          headers: options.web ? { cookie: "gd_session=web" } : headers, payload });
        expect(reply.statusCode).toBeGreaterThanOrEqual(400);
        expect(installation[operation]).not.toHaveBeenCalled();
      }
    }
  });
  it("fails closed on final owner rejection or malformed output without leaking extra fields", async () => {
    for (const options of [{ denied: true }, { invalid: true }]) {
      const { app } = create(options);
      for (const [url, , payload] of requests) {
        const reply = await app.inject({ method: "POST", url, headers, payload });
        expect(reply.statusCode).toBeGreaterThanOrEqual(400);
        expect(reply.body).not.toContain("must-not-leak");
      }
    }
  });
});

it("rejects duplicate and escaped-alias fields before target installation admission", async () => {
  const { app, installation, authorize } = create();
  const payloads = [
    '{"schemaVersion":1,"requestId":"first","requestId":"second"}',
    '{"schemaVersion":1,"requestId":"first","request\\u0049d":"first"}',
  ];
  for (const payload of payloads) {
    const reply = await app.inject({ method: "POST", url: TARGET_BOOTSTRAP_CLAIM_ROUTE,
      headers: { ...headers, "content-type": "application/json" }, payload });
    expect(reply.statusCode).toBe(400);
  }
  const step = requests[1][2];
  const repeatedNonce = JSON.stringify(step).replace('"stepNonce":', '"stepNonce":"'+digest+'","stepNonce":');
  expect((await app.inject({ method: "POST", url: TARGET_BOOTSTRAP_STEP_ROUTE,
    headers: { ...headers, "content-type": "application/json" }, payload: repeatedNonce })).statusCode).toBe(400);
  expect(installation.claim).not.toHaveBeenCalled();
  expect(installation.step).not.toHaveBeenCalled();
  expect(authorize).not.toHaveBeenCalled();
});

it("retains JSON syntax and prototype protections and bounds nested input before admission", async () => {
  const { app, installation, authorize } = create();
  const valid = JSON.stringify(lookup);
  for (const payload of [
    `${valid} {}`, valid.slice(0, -1),
    '{"schemaVersion":1,"requestId":"invalid\\x20escape"}',
    '{"schemaVersion":1,"requestId":"target","__proto__":{"polluted":true}}',
    '{"schemaVersion":1,"requestId":"target","constructor":{"prototype":{"polluted":true}}}',
    '['.repeat(33) + '0' + ']'.repeat(33),
  ]) {
    const reply = await app.inject({ method: "POST", url: TARGET_BOOTSTRAP_CLAIM_ROUTE,
      headers: { ...headers, "content-type": "application/json" }, payload });
    expect(reply.statusCode).toBe(400);
    expect(reply.body).not.toContain("polluted");
  }
  expect(installation.claim).not.toHaveBeenCalled();
  expect(authorize).not.toHaveBeenCalled();
});
