import { readFileSync } from "node:fs";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { executionEvidenceIngestResponseSchema, executionEvidenceReceiptsResponseSchema } from "@gooddealer/protocol/execution-events";
import { rateLimitPolicy } from "../../src/entrypoints/adapter/rate-limit";
import { createPublicHttp } from "../../src/entrypoints/http";
import {
  DEVICE_AUDIT_INGEST_ROUTE, DEVICE_AUDIT_RECEIPTS_ROUTE,
  EXECUTION_FACT_INGEST_ROUTE, EXECUTION_FACT_RECEIPTS_ROUTE,
} from "../../src/entrypoints/routes/public/boundary";
import { denyingPublicApplicationPorts, StaticPublicSessionVerifier } from "../support/public-session";

const vectors = JSON.parse(readFileSync(new URL(
  "../../../../packages/protocol/test-vectors/afternic-execution-evidence/valid.json", import.meta.url,
), "utf8"));
const principal = { accountId: "account-evidence", sessionId: "session-evidence", clientKind: "desktop" as const };
const query = {
  activeLeaseEpoch: 7, sequence: 1, eventId: vectors.fact.executionFactId,
  envelopeDigest: Buffer.alloc(32).toString("base64url"),
};
const lookup = { schemaVersion: 1, entries: [query] };
const routes = [
  [DEVICE_AUDIT_INGEST_ROUTE, { schemaVersion: 1, event: vectors.approvalAudit }, "auditIngest"],
  [EXECUTION_FACT_INGEST_ROUTE, { schemaVersion: 1, fact: vectors.fact }, "factIngest"],
  [DEVICE_AUDIT_RECEIPTS_ROUTE, lookup, "auditReceipts"],
  [EXECUTION_FACT_RECEIPTS_ROUTE, lookup, "factReceipts"],
] as const;
const headers = { authorization: "Bearer evidence-token" };
const apps: FastifyInstance[] = [];
afterEach(async () => Promise.all(apps.splice(0).map(app => app.close())));

function create(options: { active?: boolean; composed?: boolean; denied?: boolean; invalidResponse?: boolean; oversizedReceipts?: boolean } = {}) {
  const ingest = executionEvidenceIngestResponseSchema.parse({
    schemaVersion: 1, outcome: "pending", code: "PREDECESSOR_MISSING",
  });
  const result = <T>(response: T) => options.denied === true ? null
    : options.invalidResponse === true ? { ...response, cookie: "must-not-escape" } as T : response;
  const receiptResponse = options.oversizedReceipts === true ? executionEvidenceReceiptsResponseSchema.parse({
    schemaVersion: 1,
    results: Array.from({ length: 100 }, (_, index) => {
      const entry = { ...query, sequence: index + 1 };
      return { query: entry, receipt: {
        schemaVersion: 1, stream: "device_audit", ...entry,
        workspaceId: '"'.repeat(160), sourceDeviceId: '"'.repeat(160),
        outcome: "accepted", classification: "current", receivedAt: "2026-11-19T00:00:00Z",
      } };
    }),
  }) : { schemaVersion: 1 as const, results: [{ query, receipt: null }] };
  const calls = {
    auditIngest: vi.fn(async () => result(ingest)),
    factIngest: vi.fn(async () => result(ingest)),
    auditReceipts: vi.fn(async () => result(receiptResponse)),
    factReceipts: vi.fn(async () => result(receiptResponse)),
  };
  const authorize = vi.fn(async (_principal: unknown, required: string) => options.active !== false && required === "active");
  const app = createPublicHttp({
    sessions: new StaticPublicSessionVerifier([{ accountId: principal.accountId, sessionId: "web-session" }]),
    desktopAccessTokens: { verifyAccessToken: async token => token === "evidence-token" ? principal : null },
    now: () => new Date(), correlationIds: () => "evidence-route",
    preAuthRateLimit: rateLimitPolicy(60_000, 100), sessionRateLimit: rateLimitPolicy(60_000, 100),
    ports: {
      ...denyingPublicApplicationPorts, desktopRouteAuthority: { authorize },
      ...(options.composed === false ? {} : {
        deviceAuditEvidence: { ingest: calls.auditIngest, receipts: calls.auditReceipts },
        executionFactEvidence: { ingest: calls.factIngest, receipts: calls.factReceipts },
      }),
    },
  });
  apps.push(app);
  return { app, calls, authorize };
}

describe("fixed execution evidence routes", () => {
  it("passes each stream to its owner with only the authenticated principal", async () => {
    const { app, calls, authorize } = create();
    for (const [url, payload, name] of routes) {
      const response = await app.inject({ method: "POST", url, headers, payload });
      expect(response.statusCode).toBe(200);
      expect(calls[name]).toHaveBeenCalledExactlyOnceWith(payload, principal);
    }
    expect(authorize).toHaveBeenCalledTimes(4);
    for (const args of authorize.mock.calls) expect(args).toEqual([principal, "active"]);
  });

  it("denies Standby and account-web before entering either evidence owner", async () => {
    for (const active of [false, true]) {
      const { app, calls } = create({ active });
      for (const [url, payload] of routes) {
        const response = await app.inject({ method: "POST", url, payload,
          headers: active ? { cookie: "gd_session=web-session" } : headers });
        expect(response.statusCode).toBe(404);
      }
      for (const call of Object.values(calls)) expect(call).not.toHaveBeenCalled();
    }
  });

  it("rejects selectors, unsafe payloads, stream confusion and oversized bodies before ingestion", async () => {
    const { app, calls } = create();
    for (const [url, payload] of routes) {
      for (const key of ["accountId", "workspaceId", "sourceDeviceId", "stream"]) {
        const response = await app.inject({ method: "POST", url, headers, payload: { ...payload, [key]: "chosen" } });
        expect(response.statusCode).toBe(400);
      }
      const oversized = await app.inject({ method: "POST", url, headers, payload: { ...payload, extra: "x".repeat(32_768) } });
      expect(oversized.statusCode).toBe(413);
    }
    for (const [url, payload] of [
      [DEVICE_AUDIT_INGEST_ROUTE, { schemaVersion: 1, fact: vectors.fact }],
      [EXECUTION_FACT_INGEST_ROUTE, { schemaVersion: 1, event: vectors.approvalAudit }],
      [DEVICE_AUDIT_INGEST_ROUTE, { schemaVersion: 1, event: {
        ...vectors.approvalAudit, payloadRedacted: { ...vectors.approvalAudit.payloadRedacted, cookie: "secret" },
      } }],
      [EXECUTION_FACT_INGEST_ROUTE, { schemaVersion: 1, fact: {
        ...vectors.fact, payloadRedacted: { ...vectors.fact.payloadRedacted, endpoint: "private" },
      } }],
      [DEVICE_AUDIT_RECEIPTS_ROUTE, { schemaVersion: 1, entries: [] }],
      [EXECUTION_FACT_RECEIPTS_ROUTE, { schemaVersion: 1, entries: [query, query] }],
    ] as const) {
      expect((await app.inject({ method: "POST", url, headers, payload })).statusCode).toBe(400);
    }
    for (const call of Object.values(calls)) expect(call).not.toHaveBeenCalled();
  });

  it("rejects schema-valid receipt batches above the Native response byte cap", async () => {
    const { app } = create({ oversizedReceipts: true });
    for (const url of [DEVICE_AUDIT_RECEIPTS_ROUTE, EXECUTION_FACT_RECEIPTS_ROUTE]) {
      const response = await app.inject({ method: "POST", url, headers, payload: lookup });
      expect(response.statusCode).toBe(500);
      expect(response.json()).not.toHaveProperty("results");
    }
  });

  it("fails closed for missing services, denied ownership and invalid owner responses", async () => {
    for (const options of [{ composed: false }, { denied: true }, { invalidResponse: true }]) {
      const { app } = create(options);
      for (const [url, payload] of routes) {
        const response = await app.inject({ method: "POST", url, headers,
          payload: options.composed === false ? { schemaVersion: 1 } : payload });
        expect(response.statusCode).toBe(options.invalidResponse === true ? 500 : 404);
        expect(response.body).not.toContain("must-not-escape");
        expect(response.json()).not.toHaveProperty("receipt");
      }
    }
  });
});
