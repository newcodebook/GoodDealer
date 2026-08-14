import { createHash } from "node:crypto";

import {
  bootstrapStepRequestSchema,
  encodeBootstrapStepRequestDigestInput,
  type BootstrapStepRequest,
} from "@gooddealer/protocol/devices";
import * as devicesProtocol from "@gooddealer/protocol/devices";
import {
  encodeMutationPageDigestInput,
  mutationPageSchema,
  type CheckpointDescriptor,
  type MutationPage,
  type SyncMutation,
} from "@gooddealer/protocol/workspace";
import { describe, expect, it, vi } from "vitest";

import {
  ActiveDeviceLeaseLifecycle,
  BindingOnlyCapabilityVerifier,
  BootstrapWorkflow,
  DeviceSwitchWorkflow,
  type BootstrapFixtureRejection,
  type CheckpointCatalogPort,
  type DeviceCursorPort,
  type LeaseSignerPort,
  type MutationPagePort,
  type TrustedTimePort,
} from "../src/modules/devices/index";

const ZERO_DIGEST = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const ENTITY_DIGEST = "DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD";

const checkpoint: CheckpointDescriptor = {
  schemaVersion: 1,
  checkpointId: "checkpoint-4",
  workspaceId: "workspace-1",
  workspaceSchemaVersion: 1,
  throughRevision: 4,
  checkpointDigest: ZERO_DIGEST,
};

function mutation(serverRevision: number): SyncMutation {
  return {
    schemaVersion: 1,
    mutationId: `mutation-${serverRevision}`,
    workspaceId: "workspace-1",
    workspaceSchemaVersion: 1,
    entityType: "domain_asset",
    entityId: "domain-example-com",
    baseRevision: serverRevision - 1,
    changedFields: [{ fieldPath: "tags", value: [`tag-${serverRevision}`] }],
    sourceDeviceId: "device-a",
    activeLeaseEpoch: 2,
    mutationSequence: serverRevision,
    serverRevision,
  };
}

const mutations = [mutation(5), mutation(6)];

function signedRequest(value: Omit<BootstrapStepRequest, "requestDigest">): BootstrapStepRequest {
  const draft = bootstrapStepRequestSchema.parse({ ...value, requestDigest: ZERO_DIGEST });
  const requestDigest = createHash("sha256")
    .update(encodeBootstrapStepRequestDigestInput(draft))
    .digest("base64url");
  return bootstrapStepRequestSchema.parse({ ...draft, requestDigest });
}

function pinRequest(overrides: Partial<Omit<BootstrapStepRequest, "requestDigest">> = {}): BootstrapStepRequest {
  return signedRequest({
    schemaVersion: 2,
    deviceSwitchRequestId: "switch-1",
    capabilityJti: "capability-1",
    stepNumber: 1,
    stepNonce: "nonce-1",
    expectedWorkflowRevision: 1,
    stepKind: "pin_checkpoint",
    stepPayload: {
      checkpointId: checkpoint.checkpointId,
      checkpointRevision: checkpoint.throughRevision,
      checkpointDigest: checkpoint.checkpointDigest,
    },
    ...overrides,
  } as Omit<BootstrapStepRequest, "requestDigest">);
}

function fetchRequest(input: {
  stepNumber?: number;
  nonce?: string;
  expectedRevision?: number;
  fromRevision?: number;
  throughRevision?: number;
  cursor?: string | null;
  pageLimit?: number;
} = {}): BootstrapStepRequest {
  const stepNumber = input.stepNumber ?? 2;
  return signedRequest({
    schemaVersion: 2,
    deviceSwitchRequestId: "switch-1",
    capabilityJti: "capability-1",
    stepNumber,
    stepNonce: input.nonce ?? `nonce-${stepNumber}`,
    expectedWorkflowRevision: input.expectedRevision ?? 2,
    stepKind: "fetch_mutations",
    stepPayload: {
      pinnedCheckpointId: checkpoint.checkpointId,
      pinnedCheckpointRevision: checkpoint.throughRevision,
      pinnedCheckpointDigest: checkpoint.checkpointDigest,
      fromRevisionExclusive: input.fromRevision ?? 4,
      throughRevisionInclusive: input.throughRevision ?? 6,
      cursor: input.cursor ?? null,
      pageLimit: input.pageLimit ?? 256,
    },
  });
}

function submitRequest(input: { targetRevision?: number; schemaVersion?: number; expectedRevision?: number } = {}): BootstrapStepRequest {
  return signedRequest({
    schemaVersion: 2,
    deviceSwitchRequestId: "switch-1",
    capabilityJti: "capability-1",
    stepNumber: 3,
    stepNonce: "nonce-3",
    expectedWorkflowRevision: input.expectedRevision ?? 3,
    stepKind: "submit_rebuild_digest",
    stepPayload: {
      targetRevision: input.targetRevision ?? 6,
      workspaceSchemaVersion: input.schemaVersion ?? 1,
      entityDigests: [{ entityType: "domain_asset", partitionId: null, digest: ENTITY_DIGEST }],
    },
  });
}

function buildPage(request: Parameters<MutationPagePort["readPage"]>[0], chain = mutations): MutationPage {
  const offset = request.fromRevisionExclusive - checkpoint.throughRevision;
  const selected = chain.slice(offset, offset + request.pageLimit);
  const returnedThroughRevision = selected.length === 0
    ? request.fromRevisionExclusive
    : selected[selected.length - 1]!.serverRevision;
  const nextCursor = returnedThroughRevision < request.throughRevisionInclusive
    ? `bootstrap-after-${returnedThroughRevision}`
    : null;
  const draft = {
    schemaVersion: 1 as const,
    workspaceId: "workspace-1",
    fromRevisionExclusive: request.fromRevisionExclusive,
    throughRevisionInclusive: request.throughRevisionInclusive,
    mutations: selected,
    returnedThroughRevision,
    nextCursor,
  };
  return mutationPageSchema.parse({
    ...draft,
    pageDigest: createHash("sha256")
      .update(encodeMutationPageDigestInput({ ...draft, pageDigest: ZERO_DIGEST }))
      .digest("base64url"),
  });
}

function createHarness(input: {
  checkpointValue?: CheckpointDescriptor;
  mutationsValue?: readonly SyncMutation[];
  targetRevision?: number;
  targetSchemaVersion?: number;
  enterBootstrapping?: boolean;
  pinAvailable?: boolean;
  entitlementActive?: boolean;
} = {}) {
  let now = "2026-08-14T08:00:00Z";
  const trustedTime: TrustedTimePort = { now: () => now };
  const signActiveDeviceLease = vi.fn<LeaseSignerPort["signActiveDeviceLease"]>(async () => ({
    issued: false,
    reason: "lease_issuance_disabled",
  }));
  const lifecycle = new ActiveDeviceLeaseLifecycle({
    trustedTime,
    signer: { signActiveDeviceLease },
  });
  const aggregate = new DeviceSwitchWorkflow({
    workflowId: "switch-1",
    accountId: "account-1",
    workspaceId: "workspace-1",
    mode: "normal",
    fromDeviceId: null,
    toDeviceId: "device-b",
    idempotencyKey: "idempotency-1",
    requestedAt: now,
    exclusiveExecutionBlockUntil: null,
    oldLeaseOfflineExecuteUntil: null,
    workspaceHasPublishedCheckpoint: false,
    boundKeyId: "key-b",
    boundKeyVersion: 1,
    boundAccountSecurityEpoch: 1,
  });
  if (input.enterBootstrapping !== false) {
    aggregate.enterBootstrapping({
      pendingLeaseEpoch: lifecycle.beginBootstrap("account-1", "switch-1", null),
      capabilityJti: "capability-1",
      now,
    });
  }
  const selectedCheckpoint = input.checkpointValue ?? checkpoint;
  const chain = input.mutationsValue ?? mutations;
  const releasePin = vi.fn(async () => undefined);
  const checkpointCatalog: CheckpointCatalogPort = {
    selectPublishedCheckpoint: async () => selectedCheckpoint,
    pinCheckpoint: async () => input.pinAvailable ?? true,
    releasePin,
  };
  const mutationPages: MutationPagePort = {
    readPage: async (request) => buildPage(request, [...chain]),
  };
  const retireCursor = vi.fn(async () => undefined);
  const activateCursor = vi.fn(async () => undefined);
  const deviceCursor: DeviceCursorPort = { retireCursor, activateCursor };
  const capability = aggregate.capability;
  const presentedCapability = capability === null ? {} : {
    schemaVersion: 1,
    typ: "gd.bootstrap-capability.v1",
    iss: "https://accounts.gooddealer.com",
    aud: "gooddealer-desktop/bootstrap",
    kid: "bootstrap-key-1",
    accountId: "account-1",
    deviceId: "device-b",
    accountSecurityEpoch: 1,
    jti: capability.jti,
    issuedAt: capability.issuedAt,
    expiresAt: capability.expiresAt,
    signature: "c2ln",
    payload: { deviceSwitchRequestId: "switch-1" },
  };
  const orchestration = new BootstrapWorkflow({
    workflow: aggregate,
    checkpoint: selectedCheckpoint,
    mutations: chain,
    expectedEntityDigests: [{ entityType: "domain_asset", partitionId: null, digest: ENTITY_DIGEST }],
    stepNonceFor: (stepNumber) => `nonce-${stepNumber}`,
    capabilityVerifier: new BindingOnlyCapabilityVerifier(),
    checkpointCatalog,
    workspaceRevision: {
      readHead: async () => ({
        serverRevision: input.targetRevision ?? 6,
        workspaceSchemaVersion: input.targetSchemaVersion ?? 1,
      }),
    },
    mutationPages,
    deviceCursor,
    trustedTime,
    entitlement: {
      read: async () => ({
        active: input.entitlementActive ?? true,
        offlineGraceUntil: "2026-08-15T08:00:00Z",
        commercialExpiresAt: "2026-08-15T08:00:00Z",
      }),
    },
    accountSecurity: { read: async () => ({ accountSecurityEpoch: 1, state: "normal" }) },
    leaseLifecycle: lifecycle,
    readTargetBinding: () => ({ signingKeyId: "key-b", signingKeyVersion: 1 }),
  });
  return {
    aggregate,
    lifecycle,
    orchestration,
    presentedCapability,
    releasePin,
    retireCursor,
    activateCursor,
    signActiveDeviceLease,
    setNow: (value: string) => { now = value; },
  };
}

function expectCode(value: unknown, code: BootstrapFixtureRejection["code"]): void {
  expect(value).toEqual({ accepted: false, code });
}

describe("BootstrapWorkflow", () => {
  it("P16-INV-2/12/16/17 consumes nextStepNonce and returns replay bytes identically", async () => {
    const harness = createHarness();
    const pin = await harness.orchestration.executeStep(harness.presentedCapability, pinRequest());
    expect(pin).toMatchObject({
      workflowRevision: 2,
      acceptedStepNumber: 1,
      nextStepNonce: "nonce-2",
    });
    const replay = await harness.orchestration.executeStep(harness.presentedCapability, pinRequest());
    expect(JSON.stringify(replay)).toBe(JSON.stringify(pin));
    expect(harness.aggregate.snapshot()).toMatchObject({
      workflowRevision: 2,
      targetRevision: 6,
      targetSchemaVersion: 1,
    });
  });

  it("P16-INV-15/16 returns one persisted byte-identical result to concurrent identical steps", async () => {
    const harness = createHarness();
    const request = pinRequest();
    const [left, right] = await Promise.all([
      harness.orchestration.executeStep(harness.presentedCapability, request),
      harness.orchestration.executeStep(harness.presentedCapability, request),
    ]);
    expect(JSON.stringify(right)).toBe(JSON.stringify(left));
    expect(harness.aggregate.workflowRevision).toBe(2);
  });

  it("P16-INV-14 rejects Recovery and non-bootstrap capability envelopes", async () => {
    const harness = createHarness();
    expectCode(await harness.orchestration.executeStep({
      ...harness.presentedCapability,
      typ: "gd.recovery-capability.v1",
      aud: "gooddealer-desktop/local-recovery",
    }, pinRequest()), "CAPABILITY_INVALID");
    expectCode(await harness.orchestration.executeStep({
      ...harness.presentedCapability,
      typ: "gd.active-device-lease.v1",
      aud: "gooddealer-desktop/active-device-lease",
    }, pinRequest()), "CAPABILITY_INVALID");
  });

  it("covers the frozen workflow and capability lifecycle rejection vocabulary", async () => {
    const notStarted = createHarness({ enterBootstrapping: false });
    expectCode(await notStarted.orchestration.executeStep({}, pinRequest()), "WORKFLOW_NOT_BOOTSTRAPPING");

    const cancelled = createHarness();
    cancelled.aggregate.cancel("2026-08-14T08:01:00Z");
    expectCode(await cancelled.orchestration.executeStep(cancelled.presentedCapability, pinRequest()), "WORKFLOW_CANCELLED");

    const failed = createHarness();
    failed.aggregate.fail("2026-08-14T08:01:00Z", "security_cascade");
    expectCode(await failed.orchestration.executeStep(failed.presentedCapability, pinRequest()), "WORKFLOW_FAILED");

    const consumed = createHarness();
    consumed.aggregate.consumeCapability("2026-08-14T08:01:00Z", "failed");
    expectCode(await consumed.orchestration.executeStep(consumed.presentedCapability, pinRequest()), "CAPABILITY_CONSUMED");

    const expired = createHarness();
    expired.setNow("2026-08-14T09:00:00Z");
    expectCode(await expired.orchestration.executeStep(expired.presentedCapability, pinRequest()), "CAPABILITY_EXPIRED");

    const unavailable = createHarness({ pinAvailable: false });
    expectCode(await unavailable.orchestration.executeStep(unavailable.presentedCapability, pinRequest()), "CHECKPOINT_PIN_UNAVAILABLE");
  });

  it("P16-INV-15/26 rejects nonce reuse, cross-step nonce, stale CAS, and concurrent different payload", async () => {
    const harness = createHarness();
    await harness.orchestration.executeStep(harness.presentedCapability, pinRequest());
    expectCode(await harness.orchestration.executeStep(
      harness.presentedCapability,
      pinRequest({ stepNonce: "other-nonce" }),
    ), "STEP_REPLAY_CONFLICT");
    expectCode(await harness.orchestration.executeStep(
      harness.presentedCapability,
      fetchRequest({ nonce: "nonce-3" }),
    ), "NONCE_MISMATCH");
    expectCode(await harness.orchestration.executeStep(
      harness.presentedCapability,
      fetchRequest({ expectedRevision: 1 }),
    ), "WORKFLOW_REVISION_STALE");

    const [first, second] = await Promise.all([
      harness.orchestration.executeStep(harness.presentedCapability, fetchRequest({ pageLimit: 1 })),
      harness.orchestration.executeStep(harness.presentedCapability, fetchRequest({ pageLimit: 2 })),
    ]);
    expect([first, second].filter((value) => "acceptedStepNumber" in value)).toHaveLength(1);
    expect([first, second]).toContainEqual({ accepted: false, code: "STEP_REPLAY_CONFLICT" });
  });

  it("P16-INV-12/13 fails closed on target drift and unsupported workspace schema", async () => {
    const targetHarness = createHarness();
    await targetHarness.orchestration.executeStep(targetHarness.presentedCapability, pinRequest());
    expectCode(await targetHarness.orchestration.executeStep(
      targetHarness.presentedCapability,
      fetchRequest({ throughRevision: 5 }),
    ), "TARGET_REVISION_MISMATCH");

    const schemaHarness = createHarness();
    await schemaHarness.orchestration.executeStep(schemaHarness.presentedCapability, pinRequest());
    await schemaHarness.orchestration.executeStep(schemaHarness.presentedCapability, fetchRequest());
    expectCode(await schemaHarness.orchestration.executeStep(
      schemaHarness.presentedCapability,
      submitRequest({ schemaVersion: 2 }),
    ), "WORKSPACE_SCHEMA_UNSUPPORTED");
    expect(schemaHarness.aggregate.status).toBe("failed");
  });

  it("P16-INV-18 rejects a step when the pin has expired", async () => {
    const harness = createHarness();
    await harness.orchestration.executeStep(harness.presentedCapability, pinRequest());
    harness.setNow("2026-08-14T08:10:00Z");
    expectCode(await harness.orchestration.executeStep(
      harness.presentedCapability,
      fetchRequest(),
    ), "PIN_EXPIRED");
  });

  it("P16-INV-8 cleanup releases the pin without retiring or activating a cursor", async () => {
    const harness = createHarness();
    await harness.orchestration.executeStep(harness.presentedCapability, pinRequest());
    await harness.orchestration.cancel();
    expect(harness.aggregate.status).toBe("cancelled");
    expect(harness.releasePin).toHaveBeenCalledOnce();
    expect(harness.retireCursor).not.toHaveBeenCalled();
    expect(harness.activateCursor).not.toHaveBeenCalled();
    expect(harness.lifecycle.getStatus("account-1")).toMatchObject({ held: false });
  });

  it("expires at the exact state deadline with cancel-equivalent resource cleanup", async () => {
    const expired = createHarness();
    await expired.orchestration.executeStep(expired.presentedCapability, pinRequest());
    expired.setNow("2026-08-14T09:00:00Z");
    expect(await expired.orchestration.expire()).toBe(true);
    expect(expired.aggregate.snapshot()).toMatchObject({
      status: "failed",
      pendingLeaseEpoch: null,
      pin: null,
      bootstrapExpiresAt: null,
      stateDeadline: null,
      capability: { consumedAt: "2026-08-14T09:00:00Z", consumedReason: "expired" },
    });
    expect(expired.lifecycle.pendingEpoch("account-1", "switch-1")).toBeNull();
    expect(expired.releasePin).toHaveBeenCalledOnce();
    expect(expired.retireCursor).not.toHaveBeenCalled();
    expect(expired.activateCursor).not.toHaveBeenCalled();

    const cancelled = createHarness();
    await cancelled.orchestration.executeStep(cancelled.presentedCapability, pinRequest());
    await cancelled.orchestration.cancel();
    expect(cancelled.lifecycle.pendingEpoch("account-1", "switch-1")).toBeNull();
    expect(cancelled.releasePin).toHaveBeenCalledOnce();
    expect(cancelled.retireCursor).not.toHaveBeenCalled();
    expect(cancelled.activateCursor).not.toHaveBeenCalled();
  });

  it("P16-INV-27 keeps step-plane rejection vocabulary out of protocol", () => {
    expect("bootstrapStepRejectionCodeSchema" in devicesProtocol).toBe(false);
    expect("BootstrapFixtureRejectionCode" in devicesProtocol).toBe(false);
  });

  it("A5/P16-INV-7/25 completes rebuild but stops before lease, scope, and cursor changes", async () => {
    const harness = createHarness();
    const pin = await harness.orchestration.executeStep(harness.presentedCapability, pinRequest());
    expect(pin).toMatchObject({ nextStepNonce: "nonce-2" });
    const page = await harness.orchestration.executeStep(harness.presentedCapability, fetchRequest());
    expect(page).toMatchObject({ nextStepNonce: "nonce-3" });
    const terminal = await harness.orchestration.executeStep(harness.presentedCapability, submitRequest());
    expect(terminal).toMatchObject({ nextStepNonce: null, resultPayload: { accepted: true } });
    expect(harness.aggregate.rebuildVerified).toBe(true);
    expect(await harness.orchestration.activate()).toEqual({ activated: false, code: "LEASE_ISSUANCE_DISABLED" });
    expect(harness.signActiveDeviceLease).toHaveBeenCalledOnce();
    expect(harness.signActiveDeviceLease).toHaveBeenCalledWith(expect.objectContaining({
      accountId: "account-1",
      deviceId: "device-b",
      payload: expect.objectContaining({ leaseEpoch: 1 }),
    }));
    expect(harness.aggregate.status).toBe("bootstrapping");
    expect(harness.lifecycle.getStatus("account-1")).toMatchObject({ held: false });
    expect(harness.aggregate.targetAuthority()).toEqual({
      schemaVersion: 1,
      role: "standby",
      scopes: ["account:manage", "workspace:read"],
    });
    expect(harness.retireCursor).not.toHaveBeenCalled();
    expect(harness.activateCursor).not.toHaveBeenCalled();
  });

  it("separates inactive entitlement from a consulted signer refusal", async () => {
    const harness = createHarness({ entitlementActive: false });
    await harness.orchestration.executeStep(harness.presentedCapability, pinRequest());
    await harness.orchestration.executeStep(harness.presentedCapability, fetchRequest());
    await harness.orchestration.executeStep(harness.presentedCapability, submitRequest());
    expect(await harness.orchestration.activate()).toEqual({ activated: false, code: "ENTITLEMENT_INACTIVE" });
    expect(harness.signActiveDeviceLease).not.toHaveBeenCalled();
    expect(harness.retireCursor).not.toHaveBeenCalled();
    expect(harness.activateCursor).not.toHaveBeenCalled();
  });

  it("§11 risk 2 accepts a legal zero-mutation terminal page at the pinned target", async () => {
    const harness = createHarness({ mutationsValue: [], targetRevision: 4 });
    await harness.orchestration.executeStep(harness.presentedCapability, pinRequest());
    const emptyFetch = fetchRequest({ throughRevision: 4 });
    const result = await harness.orchestration.executeStep(harness.presentedCapability, emptyFetch);
    expect(result).toMatchObject({
      stepKind: "fetch_mutations",
      resultPayload: {
        mutationPage: {
          mutations: [],
          fromRevisionExclusive: 4,
          returnedThroughRevision: 4,
          throughRevisionInclusive: 4,
          nextCursor: null,
        },
      },
    });
  });
});
