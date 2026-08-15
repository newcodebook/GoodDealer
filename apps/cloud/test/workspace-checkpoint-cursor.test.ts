import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  bootstrapStepRequestSchema,
  encodeBootstrapStepRequestDigestInput,
  type BootstrapStepRequest,
} from "@gooddealer/protocol/devices";
import type { SubmittedSyncMutation } from "@gooddealer/protocol/workspace";
import { describe, expect, it } from "vitest";

import {
  ActiveDeviceLeaseLifecycle,
  BindingOnlyCapabilityVerifier,
  BootstrapWorkflow,
  DeviceSwitchWorkflow,
  type MutationPagePort,
} from "../src/modules/devices/index";
import { InMemoryCheckpointCatalog } from "../src/modules/workspace/checkpoints/index";
import {
  InMemoryDeviceCursors,
  InMemoryReaderCursors,
} from "../src/modules/workspace/cursors/index";
import {
  InMemoryMutationDrainWatermarks,
  InMemoryWorkspaceLeaseRegistry,
  InMemoryWorkspaceMutationIngest,
} from "../src/modules/workspace/mutations/index";
import {
  InMemoryWorkspaceMutationReader,
  MutationPageReadError,
} from "../src/modules/workspace/read/index";
import { InMemoryWorkspaceRevisions } from "../src/modules/workspace/revisions/index";
import { InMemoryDomainAssetPortfolio } from "../src/modules/workspace/state/portfolio/index";

const scope = { accountId: "account-1", workspaceId: "workspace-1" } as const;
const zeroDigest = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const sha256 = { digest: async (bytes: Uint8Array) => createHash("sha256").update(bytes).digest() };

function mutation(sequence: number): SubmittedSyncMutation {
  return {
    schemaVersion: 1,
    mutationId: `mutation-${sequence}`,
    workspaceId: scope.workspaceId,
    workspaceSchemaVersion: 1,
    entityType: "domain_asset",
    entityId: "asset-1",
    baseRevision: sequence - 1,
    changedFields: [{ fieldPath: "tags", value: [`tag-${sequence}`] }],
    sourceDeviceId: "device-a",
    activeLeaseEpoch: 7,
    mutationSequence: sequence,
  };
}

function request(sequence: number) {
  return {
    schemaVersion: 1,
    workspaceId: scope.workspaceId,
    sourceDeviceId: "device-a",
    activeLeaseEpoch: 7,
    mutations: [mutation(sequence)],
  };
}

function createHarness() {
  let now = "2026-08-15T08:00:00Z";
  let corruptCheckpointRead = false;
  const time = { now: () => now };
  const revisions = new InMemoryWorkspaceRevisions();
  const portfolio = new InMemoryDomainAssetPortfolio();
  const leases = new InMemoryWorkspaceLeaseRegistry();
  const ledger = new InMemoryMutationDrainWatermarks();
  const ingest = new InMemoryWorkspaceMutationIngest({
    bindings: revisions,
    revisions,
    leases,
    portfolio,
    ledger,
  });
  const reader = new InMemoryWorkspaceMutationReader({ bindings: revisions, mutations: ingest, sha256 });
  const deviceCursors = new InMemoryDeviceCursors(time);
  const readerCursors = new InMemoryReaderCursors({
    bindings: revisions,
    heads: revisions,
    pages: reader,
    time,
    config: { schemaVersion: 1, leaseTtlSeconds: 60 },
  });
  const checkpointState = {
    readEntityDigestsAt: async (
      checkpointScope: typeof scope,
      throughRevision: number,
      digest: (bytes: Uint8Array) => Promise<Uint8Array>,
    ) => {
      const entityDigests = await portfolio.readEntityDigestsAt(checkpointScope, throughRevision, digest);
      return corruptCheckpointRead
        ? entityDigests.map((entry) => ({ ...entry, digest: zeroDigest }))
        : entityDigests;
    },
  };
  const checkpoints = new InMemoryCheckpointCatalog({
    bindings: revisions,
    revisions,
    state: checkpointState,
    mutations: ingest,
    deviceCursors,
    readerCursors,
    sha256,
    time,
  });
  revisions.bindWorkspace(scope, 1);
  portfolio.seedDomainAsset(scope, { entityId: "asset-1" });
  leases.bindDevice(scope, "device-a", "active", 7);
  leases.bindDevice(scope, "device-b", "standby", 7);
  return {
    revisions,
    portfolio,
    ledger,
    ingest,
    reader,
    deviceCursors,
    readerCursors,
    checkpoints,
    setNow(value: string) { now = value; },
    setCheckpointCorruption(value: boolean) { corruptCheckpointRead = value; },
  };
}

async function ingestThrough(subject: ReturnType<typeof createHarness>, through: number): Promise<void> {
  for (let sequence = subject.revisions.readHead(scope).serverRevision + 1; sequence <= through; sequence += 1) {
    expect(await subject.ingest.ingest(scope, request(sequence))).toMatchObject({
      accepted: true,
      headRevision: sequence,
    });
  }
}

describe("workspace checkpoint, cursor, and reader lifecycle", () => {
  it("P20-INV-28/29/30 keeps a mismatched checkpoint building and invisible", async () => {
    const subject = createHarness();
    await ingestThrough(subject, 2);
    expect(await subject.checkpoints.buildCheckpoint(scope, "checkpoint-bad", 1)).toMatchObject({
      accepted: true,
      checkpoint: { status: "building", publishedAt: null, throughRevision: 1 },
    });
    expect(await subject.checkpoints.selectPublishedCheckpoint(scope, "checkpoint-bad")).toBeNull();
    expect(await subject.checkpoints.publishCheckpoint(scope, "checkpoint-bad")).toEqual({
      accepted: false,
      code: "CHECKPOINT_NOT_AVAILABLE",
    });

    subject.setCheckpointCorruption(true);
    expect(await subject.checkpoints.verifyCheckpoint(scope, "checkpoint-bad")).toEqual({
      accepted: false,
      code: "CHECKPOINT_DIGEST_MISMATCH",
    });
    expect(subject.checkpoints.inspectCheckpoint(scope, "checkpoint-bad")).toMatchObject({
      status: "building",
      publishedAt: null,
    });
    expect(subject.checkpoints.diagnostics(scope)).toContainEqual({
      checkpointId: "checkpoint-bad",
      code: "checkpoint_digest_mismatch",
    });
    expect(subject.checkpoints.compact(scope, 1)).toEqual({
      accepted: false,
      code: "COMPACTION_CHAIN_INCOMPLETE",
    });
    expect(subject.ingest.readCommitted(scope, 0, 2)).toHaveLength(2);
  });

  it("P20-INV-40/41/42 compacts one dense prefix while preserving Bootstrap and drain watermarks", async () => {
    const subject = createHarness();
    await ingestThrough(subject, 3);
    expect(await subject.checkpoints.buildCheckpoint(scope, "checkpoint-1", 1)).toMatchObject({ accepted: true });
    expect(await subject.checkpoints.verifyCheckpoint(scope, "checkpoint-1")).toMatchObject({ accepted: true });
    expect(await subject.checkpoints.publishCheckpoint(scope, "checkpoint-1")).toMatchObject({
      accepted: true,
      checkpoint: { status: "available", publishedAt: "2026-08-15T08:00:00Z" },
    });
    expect(await subject.checkpoints.pinCheckpoint(scope, "checkpoint-1", "2026-08-15T08:10:00Z")).toBe(true);
    expect(await subject.checkpoints.pinCheckpoint(scope, "checkpoint-1", "2026-08-15T08:11:00Z")).toBe(true);
    await subject.checkpoints.releasePin(scope, "checkpoint-1", "workflow-1");
    expect(subject.checkpoints.pinCount(scope)).toBe(1);
    expect(subject.checkpoints.compactionWatermark(scope)).toBe(1);
    expect(subject.checkpoints.compact(scope, 2)).toEqual({
      accepted: false,
      code: "COMPACTION_WATERMARK_BLOCKED",
    });
    expect(subject.checkpoints.compact(scope, 1)).toEqual({
      accepted: true,
      compactionWatermark: 1,
      deletedMutationCount: 1,
    });
    expect(subject.checkpoints.supersedeCheckpoint(scope, "checkpoint-1")).toEqual({
      accepted: false,
      code: "CHECKPOINT_PINNED",
    });
    await subject.checkpoints.releasePin(scope, "checkpoint-1", "workflow-2");
    expect(subject.checkpoints.supersedeCheckpoint(scope, "checkpoint-1")).toMatchObject({
      accepted: true,
      checkpoint: { status: "superseded" },
    });

    expect(subject.revisions.resolveWorkspace(scope)).toMatchObject({ compactionWatermark: 1 });
    expect(subject.revisions.assignedRevisions(scope)).toEqual([2, 3]);
    expect(subject.ingest.readCommitted(scope, 1, 3).map((entry) => entry.serverRevision)).toEqual([2, 3]);
    await expect(subject.reader.readPage(scope, {
      fromRevisionExclusive: 0,
      throughRevisionInclusive: 3,
      cursor: null,
      pageLimit: 3,
    })).rejects.toEqual(new MutationPageReadError("MUTATION_PAGE_COMPACTED"));
    expect((await subject.reader.readPage(scope, {
      fromRevisionExclusive: 1,
      throughRevisionInclusive: 3,
      cursor: null,
      pageLimit: 3,
    })).mutations.map((entry) => entry.serverRevision)).toEqual([2, 3]);
    expect(await subject.ledger.readWatermark(scope, {
      sourceDeviceId: "device-a",
      activeLeaseEpoch: 7,
      stream: "mutation",
    })).toMatchObject({ contiguousReceivedThrough: 3, highestReceivedSequence: 3 });
  });

  it("P20-INV-9/34/35/36 projects the complete two-enum ReaderCursor lifecycle", async () => {
    const subject = createHarness();
    expect(await subject.readerCursors.renewReaderCursor(scope, "unknown-device")).toEqual({
      accepted: false,
      code: "READER_CURSOR_UNKNOWN",
    });
    expect(await subject.readerCursors.openReaderCursor(scope, "device-b", 0)).toEqual({
      accepted: true,
      cursor: {
        schemaVersion: 1,
        workspaceId: scope.workspaceId,
        deviceId: "device-b",
        lastReadRevision: 0,
        leaseExpiresAt: "2026-08-15T08:01:00Z",
        status: "active",
        resumeRequirement: "none",
        retiredAt: null,
        retiredReason: null,
      },
    });
    const before = {
      head: subject.revisions.readHead(scope),
      state: subject.portfolio.snapshot(scope),
      watermark: await subject.ledger.readWatermark(scope, {
        sourceDeviceId: "device-b",
        activeLeaseEpoch: 7,
        stream: "mutation",
      }),
      deviceCursors: subject.deviceCursors.snapshot(scope),
    };
    expect(await subject.readerCursors.readAfter(scope, "device-b", 1)).toMatchObject({ accepted: true });
    subject.setNow("2026-08-15T08:01:00Z");
    expect(await subject.readerCursors.renewReaderCursor(scope, "device-b")).toEqual({
      accepted: false,
      code: "READER_CURSOR_TTL_EXPIRED",
    });
    expect(await subject.readerCursors.renewReaderCursor(scope, "device-b")).toEqual({
      accepted: false,
      code: "READER_CURSOR_RETIRED",
    });
    expect(subject.readerCursors.snapshot(scope)).toMatchObject([{
      leaseExpiresAt: "2026-08-15T08:01:00Z",
      status: "retired",
      resumeRequirement: "rebootstrap_required",
      retiredAt: "2026-08-15T08:01:00Z",
      retiredReason: "ttl_expired",
    }]);
    expect(subject.readerCursors.minimumActiveRevision(scope)).toBeNull();

    subject.setNow("2026-08-15T08:02:00Z");
    expect(await subject.readerCursors.openReaderCursor(scope, "removed-device", 0)).toMatchObject({ accepted: true });
    await subject.readerCursors.retireReaderCursor(scope, "removed-device", "device_removed");
    expect(await subject.readerCursors.renewReaderCursor(scope, "removed-device")).toEqual({
      accepted: false,
      code: "READER_CURSOR_DEVICE_REMOVED",
    });
    expect(subject.readerCursors.snapshot(scope)).toContainEqual(expect.objectContaining({
      deviceId: "removed-device",
      status: "retired",
      resumeRequirement: "none",
      retiredReason: "device_removed",
    }));

    const compactionRace = createHarness();
    await ingestThrough(compactionRace, 1);
    expect(await compactionRace.readerCursors.openReaderCursor(scope, "race-device", 1))
      .toMatchObject({ accepted: true });
    expect(await compactionRace.readerCursors.openReaderCursor(scope, "race-device", 0)).toEqual({
      accepted: false,
      code: "CURSOR_REVISION_REGRESSION",
    });
    expect(await compactionRace.readerCursors.openReaderCursor(scope, "race-device-2", 0))
      .toMatchObject({ accepted: true });
    compactionRace.revisions.advanceCompactionWatermark(scope, 1);
    expect(await compactionRace.readerCursors.renewReaderCursor(scope, "race-device-2")).toEqual({
      accepted: false,
      code: "READER_CURSOR_COMPACTION_RACE",
    });
    expect(compactionRace.readerCursors.snapshot(scope)).toContainEqual(expect.objectContaining({
      deviceId: "race-device-2",
      status: "retired",
      resumeRequirement: "rebootstrap_required",
      retiredReason: "compaction_race",
    }));

    expect(subject.revisions.readHead(scope)).toEqual(before.head);
    expect(subject.portfolio.snapshot(scope)).toEqual(before.state);
    expect(await subject.ledger.readWatermark(scope, {
      sourceDeviceId: "device-b",
      activeLeaseEpoch: 7,
      stream: "mutation",
    })).toEqual(before.watermark);
    expect(subject.deviceCursors.snapshot(scope)).toEqual(before.deviceCursors);
    const source = readFileSync(new URL("../src/modules/workspace/cursors/index.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/from ["']\.\.\/(mutations|revisions)/);
  });

  it("P20-INV-32/33 keeps DeviceCursor monotonic and retired cursors non-reactivatable", async () => {
    const subject = createHarness();
    await subject.deviceCursors.activateCursor(scope, "device-a", 0);
    subject.deviceCursors.advanceCursor(scope, "device-a", 2);
    expect(() => subject.deviceCursors.advanceCursor(scope, "device-a", 1)).toThrow("CURSOR_REVISION_REGRESSION");
    await subject.deviceCursors.retireCursor(scope, "device-a", "replaced");
    await expect(subject.deviceCursors.activateCursor(scope, "device-a", 2))
      .rejects.toThrow("a retired device cursor cannot be reactivated");
  });

  it("P20-INV-45/46/47/48/49/51 returns stable schema-ordered pages across later ingest", async () => {
    const subject = createHarness();
    await ingestThrough(subject, 2);
    const bootstrapPort: MutationPagePort = subject.reader;
    const pageRequest = {
      fromRevisionExclusive: 0,
      throughRevisionInclusive: 2,
      cursor: null,
      pageLimit: 1,
    } as const;
    const first = await bootstrapPort.readPage(scope, pageRequest);
    await expect(bootstrapPort.readPage(scope, {
      fromRevisionExclusive: 2,
      throughRevisionInclusive: 1,
      cursor: null,
      pageLimit: 1,
    })).rejects.toMatchObject({ code: "MUTATION_PAGE_RANGE_INVALID" });
    await ingestThrough(subject, 3);
    const repeated = await bootstrapPort.readPage(scope, pageRequest);
    expect(JSON.stringify(repeated)).toBe(JSON.stringify(first));
    expect((await bootstrapPort.readPage(scope, {
      ...pageRequest,
      fromRevisionExclusive: 1,
      cursor: first.nextCursor,
    })).mutations.map((entry) => entry.serverRevision)).toEqual([2]);
    await expect(bootstrapPort.readPage(
      { accountId: "account-2", workspaceId: scope.workspaceId },
      { ...pageRequest, fromRevisionExclusive: 1, cursor: first.nextCursor },
    )).rejects.toMatchObject({ code: "WORKSPACE_TENANT_UNRESOLVED" });

    expect(await subject.readerCursors.openReaderCursor(scope, "device-b", 0)).toMatchObject({ accepted: true });
    expect(await subject.readerCursors.readAfter(scope, "device-b", 1)).toMatchObject({
      accepted: true,
      page: { throughRevisionInclusive: 3, returnedThroughRevision: 1 },
    });
    await ingestThrough(subject, 4);
    expect(await subject.readerCursors.readAfter(scope, "device-b", 1)).toMatchObject({
      accepted: true,
      page: { throughRevisionInclusive: 3, returnedThroughRevision: 2 },
    });
    expect(await subject.readerCursors.readAfter(scope, "device-b", 1)).toMatchObject({
      accepted: true,
      page: { throughRevisionInclusive: 3, returnedThroughRevision: 3, nextCursor: null },
    });
    expect(await subject.readerCursors.readAfter(scope, "device-b", 1)).toMatchObject({
      accepted: true,
      page: { throughRevisionInclusive: 4, returnedThroughRevision: 4, nextCursor: null },
    });
  });

  it("A11 runs Bootstrap fetch_mutations unchanged against the real compacted MutationPagePort", async () => {
    const subject = createHarness();
    await ingestThrough(subject, 3);
    await subject.checkpoints.buildCheckpoint(scope, "checkpoint-1", 1);
    await subject.checkpoints.verifyCheckpoint(scope, "checkpoint-1");
    await subject.checkpoints.publishCheckpoint(scope, "checkpoint-1");
    expect(subject.checkpoints.compact(scope, 1)).toMatchObject({ accepted: true });
    const checkpoint = await subject.checkpoints.selectPublishedCheckpoint(scope, "checkpoint-1");
    if (checkpoint === null) throw new TypeError("published checkpoint is unavailable");
    const chain = subject.ingest.readCommitted(scope, 1, 3);
    const entityDigests = await subject.portfolio.readEntityDigestsAt(scope, 3, sha256.digest);
    const lifecycle = new ActiveDeviceLeaseLifecycle({ trustedTime: { now: () => "2026-08-15T08:00:00Z" } });
    const aggregate = new DeviceSwitchWorkflow({
      workflowId: "switch-1",
      accountId: scope.accountId,
      workspaceId: scope.workspaceId,
      mode: "normal",
      fromDeviceId: "device-a",
      toDeviceId: "device-b",
      idempotencyKey: "idempotency-1",
      requestedAt: "2026-08-15T08:00:00Z",
      exclusiveExecutionBlockUntil: null,
      oldLeaseOfflineExecuteUntil: null,
      workspaceHasPublishedCheckpoint: true,
      boundKeyId: "key-b",
      boundKeyVersion: 1,
      boundAccountSecurityEpoch: 1,
    });
    aggregate.enterBootstrapping({
      pendingLeaseEpoch: lifecycle.beginBootstrap(scope.accountId, "switch-1", "device-a"),
      capabilityJti: "capability-1",
      now: "2026-08-15T08:00:00Z",
    });
    const capability = aggregate.capability;
    if (capability === null) throw new TypeError("bootstrap capability was not prepared");
    const presentedCapability = {
      schemaVersion: 1,
      typ: "gd.bootstrap-capability.v1",
      iss: "https://accounts.gooddealer.com",
      aud: "gooddealer-desktop/bootstrap",
      kid: "bootstrap-key-1",
      accountId: scope.accountId,
      deviceId: "device-b",
      accountSecurityEpoch: 1,
      jti: capability.jti,
      issuedAt: capability.issuedAt,
      expiresAt: capability.expiresAt,
      signature: "c2ln",
      payload: { deviceSwitchRequestId: "switch-1" },
    };
    const workflow = new BootstrapWorkflow({
      workflow: aggregate,
      checkpoint,
      mutations: chain,
      expectedEntityDigests: entityDigests,
      stepNonceFor: (stepNumber) => `nonce-${stepNumber}`,
      capabilityVerifier: new BindingOnlyCapabilityVerifier(),
      checkpointCatalog: subject.checkpoints,
      workspaceRevision: { readHead: async (workspaceScope) => subject.revisions.readHead(workspaceScope) },
      mutationPages: subject.reader,
      trustedTime: { now: () => "2026-08-15T08:00:00Z" },
      accountSecurity: { read: async () => ({ accountSecurityEpoch: 1, state: "normal" }) },
      leaseLifecycle: lifecycle,
      readTargetBinding: () => ({ signingKeyId: "key-b", signingKeyVersion: 1 }),
    });
    const pin = signedStep({
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
    });
    expect(await workflow.executeStep(presentedCapability, pin)).toMatchObject({
      acceptedStepNumber: 1,
      nextStepNonce: "nonce-2",
    });
    const fetch = signedStep({
      schemaVersion: 2,
      deviceSwitchRequestId: "switch-1",
      capabilityJti: "capability-1",
      stepNumber: 2,
      stepNonce: "nonce-2",
      expectedWorkflowRevision: 2,
      stepKind: "fetch_mutations",
      stepPayload: {
        pinnedCheckpointId: checkpoint.checkpointId,
        pinnedCheckpointRevision: checkpoint.throughRevision,
        pinnedCheckpointDigest: checkpoint.checkpointDigest,
        fromRevisionExclusive: 1,
        throughRevisionInclusive: 3,
        cursor: null,
        pageLimit: 256,
      },
    });
    expect(await workflow.executeStep(presentedCapability, fetch)).toMatchObject({
      acceptedStepNumber: 2,
      resultPayload: { mutationPage: { returnedThroughRevision: 3, nextCursor: null } },
    });
  });
});

function signedStep(value: Omit<BootstrapStepRequest, "requestDigest">): BootstrapStepRequest {
  const draft = bootstrapStepRequestSchema.parse({ ...value, requestDigest: zeroDigest });
  const requestDigest = createHash("sha256")
    .update(encodeBootstrapStepRequestDigestInput(draft))
    .digest("base64url");
  return bootstrapStepRequestSchema.parse({ ...draft, requestDigest });
}
