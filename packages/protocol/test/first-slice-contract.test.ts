import { describe, expect, it } from "vitest";

import {
  desktopAuthorizationGrantRequestSchema,
  desktopAuthorizationGrantSchema,
  encodeDesktopAuthorizationGrantSignatureTranscript,
} from "../src/devices/index";
import {
  workspaceCheckpointReadRequestSchema,
  workspaceMutationPullRequestSchema,
  workspaceMutationPullResponseSchema,
  workspaceMutationPushRequestSchema,
  workspaceMutationPushResponseSchema,
  workspaceSyncOperationSchema,
} from "../src/workspace/index";

const activeDeviceLease = {
  schemaVersion: 1,
  typ: "gd.active-device-lease.v1",
  iss: "https://accounts.gooddealer.com",
  aud: "gooddealer-desktop/active-device-lease",
  kid: "lease-key-1",
  accountId: "account-local",
  deviceId: "device-local",
  accountSecurityEpoch: 4,
  jti: "lease-local",
  issuedAt: "2026-08-29T00:00:00Z",
  expiresAt: "2026-08-30T00:00:00Z",
  payload: {
    leaseEpoch: 7,
    renewAfter: "2026-08-29T06:00:00Z",
    onlineExpiresAt: "2026-08-29T12:00:00Z",
    offlineExecuteUntil: "2026-08-30T00:00:00Z",
  },
  signature: "fixture-signature",
} as const;

const desktopGrant = {
  schemaVersion: 3,
  typ: "gd.desktop-authorization-grant.v3",
  iss: "https://accounts.gooddealer.com",
  aud: "gooddealer-desktop/local-business",
  kid: "grant-key-1",
  issuedAt: activeDeviceLease.issuedAt,
  expiresAt: activeDeviceLease.expiresAt,
  workspace: { workspaceId: "workspace-local", kind: "personal_default" },
  activeDeviceLease,
  scopes: ["workspace:mutate", "workspace:read"],
  commercialAuthority: {
    schemaVersion: 1,
    entitlementRevision: 9,
    entitlementProjectionDigest: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    state: "active",
    commercialExpiresAt: "2026-08-29T23:00:00Z",
    capability: "cloudflare:dns:observe",
  },
  signature: "fixture-grant-signature",
} as const;

const mutation = {
  schemaVersion: 2,
  mutationId: "mutation-1",
  workspaceSchemaVersion: 1,
  entityType: "domain_asset",
  entityId: "example.test",
  operationKind: "upsert",
  baseServerRevision: 0,
  changedFields: [{ fieldPath: "note", value: "local note" }],
  sourceDeviceId: "device-1",
  activeLeaseEpoch: 1,
  deviceMutationSequence: 1,
} as const;

describe("first-slice shared transport contract", () => {
  it("binds the personal default workspace to a strictly parsed active-device grant", () => {
    expect(desktopAuthorizationGrantRequestSchema.parse({ schemaVersion: 3 })).toEqual({
      schemaVersion: 3,
    });
    expect(desktopAuthorizationGrantSchema.parse(desktopGrant))
      .toMatchObject({ workspace: { workspaceId: "workspace-local" } });
  });

  it("freezes the complete authority-bearing grant signature transcript", () => {
    const transcript = encodeDesktopAuthorizationGrantSignatureTranscript(desktopGrant);
    const hash = transcript.reduce(
      (value, byte) => BigInt.asUintN(64, (value ^ BigInt(byte)) * 0x100000001b3n),
      0xcbf29ce484222325n,
    );
    expect([transcript.length, hash.toString(16)]).toEqual([1562, "86a8523c3848bf9a"]);
  });

  it("rejects V2 and malformed commercial authority without fallback", () => {
    expect(desktopAuthorizationGrantSchema.safeParse({ ...desktopGrant, schemaVersion: 2, typ: "gd.desktop-authorization-grant.v2" }).success).toBe(false);
    expect(desktopAuthorizationGrantSchema.safeParse({ ...desktopGrant, commercialAuthority: { ...desktopGrant.commercialAuthority, state: "grace" } }).success).toBe(false);
    expect(desktopAuthorizationGrantSchema.safeParse({ ...desktopGrant, commercialAuthority: { ...desktopGrant.commercialAuthority, capability: "workspace:read" } }).success).toBe(false);
  });

  it.each([
    { schemaVersion: 3, accountId: "account-1" },
    { schemaVersion: 3, workspaceId: "workspace-1" },
    { schemaVersion: 3, deviceId: "device-1" },
    { schemaVersion: 3, credentialRef: "secret" },
  ])("rejects caller-selected authorization scope %#", (value) => {
    expect(desktopAuthorizationGrantRequestSchema.safeParse(value).success).toBe(false);
  });

  it("freezes tenant-neutral push, pull, checkpoint, and recovery operation names", () => {
    expect(workspaceSyncOperationSchema.options).toEqual([
      "workspace.sync.mutations.push",
      "workspace.sync.mutations.pull",
      "workspace.sync.checkpoint.read",
      "workspace.sync.domainAssetReplica.recover",
    ]);
  });

  it("accepts only tenant-neutral mutation push and progress requests", () => {
    expect(workspaceMutationPushRequestSchema.parse({ schemaVersion: 2, mutations: [mutation] }))
      .toEqual({ schemaVersion: 2, mutations: [mutation] });
    expect(workspaceMutationPullRequestSchema.parse({
      schemaVersion: 2,
      afterServerRevision: 0,
      cursor: null,
      pageLimit: 64,
      confirm: null,
    })).toMatchObject({ afterServerRevision: 0, cursor: null });
    expect(workspaceCheckpointReadRequestSchema.parse({ schemaVersion: 2 })).toEqual({
      schemaVersion: 2,
    });
  });

  it.each([
    { ...mutation, workspaceId: "workspace-1" },
    { ...mutation, accountId: "account-1" },
    { ...mutation, providerAccountId: "provider-account" },
    { ...mutation, accessToken: "secret" },
  ])("rejects tenant, Provider identity, and secret fields from mutation wire items %#", (value) => {
    expect(workspaceMutationPushRequestSchema.safeParse({ schemaVersion: 2, mutations: [value] }).success)
      .toBe(false);
  });

  it("rejects non-contiguous pushes and malformed acknowledgements", () => {
    expect(workspaceMutationPushRequestSchema.safeParse({
      schemaVersion: 2,
      mutations: [mutation, { ...mutation, mutationId: "mutation-2", deviceMutationSequence: 3 }],
    }).success).toBe(false);
    expect(workspaceMutationPushResponseSchema.safeParse({
      schemaVersion: 2,
      accepted: true,
      acknowledgements: [{
        mutationId: "mutation-1",
        deviceMutationSequence: 1,
        serverRevision: 2,
        duplicate: false,
      }],
      headServerRevision: 1,
    }).success).toBe(false);
    expect(workspaceMutationPushResponseSchema.safeParse({
      schemaVersion: 1,
      accepted: false,
      code: "MUTATION_MALFORMED",
      correlationId: "correlation-1",
      message: "internal detail",
    }).success).toBe(false);
  });

  it.each([
    { schemaVersion: 1, mutations: [mutation] },
    { schemaVersion: 2, mutations: [mutation], workspaceId: "workspace-1" },
    { schemaVersion: 2, mutations: [mutation], deviceId: "device-1" },
    { schemaVersion: 2, mutations: [mutation], currentLeaseEpoch: 2 },
  ])("rejects v1 and transport scope selectors %#", (value) => {
    expect(workspaceMutationPushRequestSchema.safeParse(value).success).toBe(false);
  });

  it("requires the v2 pull confirmation and delivery proof fields", () => {
    expect(workspaceMutationPullRequestSchema.safeParse({
      schemaVersion: 2,
      afterServerRevision: 0,
      cursor: null,
      pageLimit: 1,
    }).success).toBe(false);
    const page = {
      schemaVersion: 2,
      workspaceId: "workspace-local",
      fromServerRevisionExclusive: 0,
      throughServerRevisionInclusive: 0,
      mutations: [],
      returnedThroughServerRevision: 0,
      nextCursor: null,
      pageDigest: "B".repeat(43),
    } as const;
    expect(workspaceMutationPullResponseSchema.safeParse({
      schemaVersion: 2,
      accepted: true,
      page,
    }).success).toBe(false);
  });
});
