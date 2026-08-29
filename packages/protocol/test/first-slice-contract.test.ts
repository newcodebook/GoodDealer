import { describe, expect, it } from "vitest";

import {
  desktopAuthorizationGrantRequestSchema,
  desktopAuthorizationGrantSchema,
} from "../src/devices/index";
import {
  workspaceCheckpointReadRequestSchema,
  workspaceMutationPullRequestSchema,
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
  accountId: "account-1",
  deviceId: "device-1",
  accountSecurityEpoch: 1,
  jti: "lease-1",
  issuedAt: "2026-08-29T10:00:00Z",
  expiresAt: "2026-08-30T10:00:00Z",
  payload: {
    leaseEpoch: 1,
    renewAfter: "2026-08-29T10:05:00Z",
    onlineExpiresAt: "2026-08-29T10:15:00Z",
    offlineExecuteUntil: "2026-08-30T10:00:00Z",
  },
  signature: "c2lnbmF0dXJl",
} as const;

const mutation = {
  schemaVersion: 1,
  mutationId: "mutation-1",
  workspaceSchemaVersion: 1,
  entityType: "domain_asset",
  entityId: "example.test",
  baseServerRevision: 0,
  changedFields: [{ fieldPath: "note", value: "local note" }],
  sourceDeviceId: "device-1",
  activeLeaseEpoch: 1,
  deviceMutationSequence: 1,
} as const;

describe("first-slice shared transport contract", () => {
  it("binds the personal default workspace to a strictly parsed active-device grant", () => {
    expect(desktopAuthorizationGrantRequestSchema.parse({ schemaVersion: 1 })).toEqual({
      schemaVersion: 1,
    });
    expect(desktopAuthorizationGrantSchema.parse({
      schemaVersion: 1,
      workspace: { workspaceId: "workspace-1", kind: "personal_default" },
      activeDeviceLease,
      scopes: ["workspace:mutate", "workspace:read"],
    })).toMatchObject({ workspace: { workspaceId: "workspace-1" } });
  });

  it.each([
    { schemaVersion: 1, accountId: "account-1" },
    { schemaVersion: 1, workspaceId: "workspace-1" },
    { schemaVersion: 1, deviceId: "device-1" },
    { schemaVersion: 1, credentialRef: "secret" },
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
    expect(workspaceMutationPushRequestSchema.parse({ schemaVersion: 1, mutations: [mutation] }))
      .toEqual({ schemaVersion: 1, mutations: [mutation] });
    expect(workspaceMutationPullRequestSchema.parse({
      schemaVersion: 1,
      afterServerRevision: 0,
      cursor: null,
      pageLimit: 64,
    })).toMatchObject({ afterServerRevision: 0, cursor: null });
    expect(workspaceCheckpointReadRequestSchema.parse({ schemaVersion: 1 })).toEqual({
      schemaVersion: 1,
    });
  });

  it.each([
    { ...mutation, workspaceId: "workspace-1" },
    { ...mutation, accountId: "account-1" },
    { ...mutation, providerAccountId: "provider-account" },
    { ...mutation, accessToken: "secret" },
  ])("rejects tenant, Provider identity, and secret fields from mutation wire items %#", (value) => {
    expect(workspaceMutationPushRequestSchema.safeParse({ schemaVersion: 1, mutations: [value] }).success)
      .toBe(false);
  });

  it("rejects non-contiguous pushes and malformed acknowledgements", () => {
    expect(workspaceMutationPushRequestSchema.safeParse({
      schemaVersion: 1,
      mutations: [mutation, { ...mutation, mutationId: "mutation-2", deviceMutationSequence: 3 }],
    }).success).toBe(false);
    expect(workspaceMutationPushResponseSchema.safeParse({
      schemaVersion: 1,
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
});
