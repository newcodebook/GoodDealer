import { describe, expect, it } from "vitest";
import { afternicControlledAcceptanceSchema } from "./afternic-controlled-acceptance";
import { afternicConnectIntentSchema, afternicConnectionIntentSchema, parseAfternicConnectionsStatus } from "./afternic";
import {
  afternicDelistApproveRequestSchema, afternicDelistPreviewRequestSchema,
  afternicDelistStatusRequestSchema, parseAfternicDelistStatus,
} from "../operations/afternic-delist";
import {
  afternicListingWriteApproveRequestSchema, afternicListingWritePreviewRequestSchema,
  afternicListingWriteStatusRequestSchema, parseAfternicListingWriteStatus,
} from "../operations/afternic-listing-write";

const connectionId = "aa000000-0000-4000-8000-000000000001";
const otherConnectionId = "aa000000-0000-4000-8000-000000000002";
const acceptance = {
  runId: "afternic-wecin-linux-20261119", domain: "wecin.com",
  expiresAt: "2026-11-26T23:59:59Z", connectionId,
};
const connection = { connectionId, displayLabel: "Afternic", state: "active", purgePending: false, lastScan: null };
const connections = { schemaVersion: 1, controlledAcceptance: null, observeQualified: false,
  observeEntitled: true, capturable: true, connections: [connection], laneState: "ready", lastOperation: null };
const operations = { schemaVersion: 1, controlledAcceptance: null, writeQualified: false,
  writeEntitled: true, executionAvailable: true, plans: [], detail: null };
const surfaces = [
  { name: "connections", parse: parseAfternicConnectionsStatus, status: connections, qualified: "observeQualified" },
  { name: "delist", parse: parseAfternicDelistStatus, status: operations, qualified: "writeQualified" },
  { name: "listing write", parse: parseAfternicListingWriteStatus, status: operations, qualified: "writeQualified" },
];

describe("Afternic controlled acceptance result boundaries", () => {
  it.each(surfaces)("requires an explicit nullable output on $name", ({ parse, status }) => {
    expect(parse(status).controlledAcceptance).toBeNull();
    const { controlledAcceptance: _scope, ...missing } = status;
    expect(() => parse(missing)).toThrow();
    expect(() => parse({ ...status, controlledAcceptance: undefined })).toThrow();
    for (const scope of [acceptance, { ...acceptance, connectionId: null }]) {
      expect(parse({ ...status, controlledAcceptance: scope }).controlledAcceptance).toEqual(scope);
    }
  });

  it.each(surfaces)("refuses widened or malformed scope on $name", ({ parse, status }) => {
    const { connectionId: _id, ...missingConnection } = acceptance;
    for (const scope of [
      missingConnection, { ...acceptance, connectionId: undefined }, { ...acceptance, connectionId: "*" },
      { ...acceptance, connectionId: "aa000000-0000-5000-8000-000000000001" },
      { ...acceptance, connectionId: connectionId.toUpperCase() },
      { ...acceptance, runId: "afternic-wecin-linux-20261120" },
      { ...acceptance, domain: "other.com" }, { ...acceptance, domain: "WECIN.com" },
      { ...acceptance, expiresAt: "2026-11-27T23:59:59Z" },
      { ...acceptance, expiresAt: "2026-11-26T23:59:59.000Z" },
      { ...acceptance, provider: "cloudflare" }, { ...acceptance, actions: ["create", "transfer"] },
      { ...acceptance, cookie: "secret-canary" }, true, [], "accepted",
    ]) expect(() => parse({ ...status, controlledAcceptance: scope })).toThrow();
    expect(() => parse({ ...status, controlledAcceptance: acceptance, acceptance: true })).toThrow();
  });

  it.each(surfaces)("never represents the run as production qualification on $name", ({ parse, status, qualified }) => {
    expect(() => parse({ ...status, [qualified]: true, controlledAcceptance: acceptance })).toThrow();
    expect(parse({ ...status, [qualified]: true }).controlledAcceptance).toBeNull();
  });

  it("correlates the exact live bound connection while retaining unrelated read-only history", () => {
    for (const state of ["prepared", "active"]) {
      const input = { ...connections, controlledAcceptance: acceptance,
        connections: [{ ...connection, state }, { ...connection, connectionId: otherConnectionId, state: "revoked" }] };
      expect(parseAfternicConnectionsStatus(input).controlledAcceptance?.connectionId).toBe(connectionId);
    }
    for (const state of ["remediation_required", "revoked"]) {
      expect(() => parseAfternicConnectionsStatus({ ...connections, controlledAcceptance: acceptance,
        connections: [{ ...connection, state }] })).toThrow();
    }
    expect(() => parseAfternicConnectionsStatus({ ...connections, controlledAcceptance: acceptance, connections: [] })).toThrow();
    expect(() => parseAfternicConnectionsStatus({ ...connections,
      controlledAcceptance: { ...acceptance, connectionId: otherConnectionId } })).toThrow();
    expect(parseAfternicConnectionsStatus({ ...connections,
      controlledAcceptance: { ...acceptance, connectionId: null } }).controlledAcceptance?.connectionId).toBeNull();
  });

  it.each(surfaces)("does not evaluate hostile nested accessors or leak rejected values on $name", ({ parse, status }) => {
    let invoked = false;
    const hostile = { ...acceptance };
    Object.defineProperty(hostile, "domain", { enumerable: true, get() { invoked = true; return "secret-canary"; } });
    expect(() => parse({ ...status, controlledAcceptance: hostile })).toThrow();
    expect(invoked).toBe(false);
    try { parse({ ...status, controlledAcceptance: { ...acceptance, domain: "secret-canary" } }); }
    catch (error) { expect(String(error)).not.toContain("secret-canary"); }
  });

  it("never accepts the output scope as caller authority in any existing intent", () => {
    const selected = { schemaVersion: 1, planRef: connectionId };
    const approval = { ...selected, planHash: "a".repeat(64) };
    const intents = [
      [afternicConnectIntentSchema, { schemaVersion: 1, displayLabel: "Afternic" }],
      [afternicConnectionIntentSchema, { schemaVersion: 1, connectionId }],
      [afternicDelistPreviewRequestSchema, { schemaVersion: 1, connectionId, domains: ["wecin.com"] }],
      [afternicDelistApproveRequestSchema, approval], [afternicDelistStatusRequestSchema, selected],
      [afternicListingWritePreviewRequestSchema, { schemaVersion: 1, connectionId, action: "update",
        items: [{ domain: "wecin.com", patch: { hidden: false } }] }],
      [afternicListingWriteApproveRequestSchema, approval], [afternicListingWriteStatusRequestSchema, selected],
    ] as const;
    for (const [schema, intent] of intents) {
      expect(schema.safeParse(intent).success).toBe(true);
      expect(schema.safeParse({ ...intent, controlledAcceptance: acceptance }).success).toBe(false);
      expect(schema.safeParse({ ...intent, acceptance: true }).success).toBe(false);
    }
    expect(afternicControlledAcceptanceSchema.parse(acceptance)).toEqual(acceptance);
  });
});
