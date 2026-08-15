import { readFileSync } from "node:fs";

import { deviceSwitchRequestViewSchema, type DeviceBindingSummary } from "@gooddealer/protocol/devices";
import { drainProofSchema, type DrainManifest, type DrainStream } from "@gooddealer/protocol/execution-events";
import { describe, expect, it, vi } from "vitest";

import {
  ActiveDeviceLeaseLifecycle,
  DeviceSwitchWorkflow,
  DevicesFixtureService,
  type DrainStreamWatermarkPort,
  type DrainVerificationPort,
} from "../src/modules/devices/index";
import { InMemoryDeviceAuditLedger } from "../src/modules/audit/index";
import { InMemoryExecutionLedger } from "../src/modules/execution-ledger/index";
import { InMemoryMutationDrainWatermarks } from "../src/modules/workspace/mutations/index";

const manifest = drainProofSchema.parse(JSON.parse(readFileSync(
  new URL("../../../packages/protocol/test-vectors/drain/valid/proof-handoff-three-streams.json", import.meta.url),
  "utf8",
))) as DrainManifest;

const verifiedSealClaims = {
  workspaceId: manifest.workspaceId,
  sourceDeviceId: manifest.sourceDeviceId,
  activeLeaseEpoch: manifest.activeLeaseEpoch,
  lastAssignedSequence: Object.fromEntries(
    manifest.streams.map((claim) => [claim.stream, claim.lastAssignedSequence]),
  ) as Record<DrainStream, number>,
} as const;

function sealLedgers() {
  const mutation = new InMemoryMutationDrainWatermarks();
  const executionFact = new InMemoryExecutionLedger();
  const deviceAudit = new InMemoryDeviceAuditLedger();
  return {
    mutation,
    executionFact,
    deviceAudit,
    options: {
      mutationDrainSeals: mutation,
      executionFactDrainSeals: executionFact,
      deviceAuditDrainSeals: deviceAudit,
    },
  };
}

function binding(deviceId: string, role: "active" | "standby"): DeviceBindingSummary {
  return {
    schemaVersion: 1,
    deviceId,
    displayName: deviceId,
    platform: "macos",
    status: "bound",
    role,
    credentialEpoch: 3,
    signingKeyId: `key-${deviceId}`,
    signingKeyVersion: 1,
    signingKeyStatus: "active",
    boundAt: "2026-08-14T17:00:00Z",
    removedAt: null,
    lastSeenAt: "2026-08-14T18:00:00Z",
    currentDevice: false,
  };
}

const activeLease = {
  deviceId: "device-a",
  leaseEpoch: 2,
  issuedAt: "2026-08-14T17:00:00Z",
  renewAfter: "2026-08-14T17:05:00Z",
  onlineExpiresAt: "2026-08-14T17:15:00Z",
  offlineExecuteUntil: "2026-08-15T17:00:00Z",
} as const;

function watermarks(gapStream?: DrainStream): DrainStreamWatermarkPort {
  const claims = new Map(manifest.streams.map((claim) => [claim.stream, claim] as const));
  return {
    readWatermark: async (_scope, { stream }) => {
      const claim = claims.get(stream);
      if (claim === undefined) throw new TypeError("unknown stream");
      if (stream === gapStream) {
        return {
          contiguousReceivedThrough: claim.lastAssignedSequence - 1,
          highestReceivedSequence: claim.lastAssignedSequence,
          missingRanges: [{ fromSequence: claim.lastAssignedSequence, toSequence: claim.lastAssignedSequence }],
          rollingDigest: claim.rollingDigest,
        };
      }
      return {
        contiguousReceivedThrough: claim.lastAssignedSequence,
        highestReceivedSequence: claim.lastAssignedSequence,
        missingRanges: [],
        rollingDigest: claim.rollingDigest,
      };
    },
  };
}

function serviceOptions() {
  return {
    accountId: "account-a",
    workspaceId: "workspace-a",
    now: () => new Date("2026-08-14T18:05:00Z"),
    seedBindings: [binding("device-a", "active"), binding("device-b", "standby")],
    activeLease,
  } as const;
}

const switchRequest = {
  schemaVersion: 1 as const,
  mode: "normal" as const,
  toDeviceId: "device-b",
  idempotencyKey: "switch-key",
};

describe("acceptDrain orchestration", () => {
  it("A5 keeps the workflow draining and lease held for a one-stream gap with a complete report", async () => {
    const gapWatermarks = watermarks("execution_fact");
    const service = new DevicesFixtureService({
      ...serviceOptions(),
      mutationWatermarks: gapWatermarks,
      executionFactWatermarks: gapWatermarks,
      deviceAuditWatermarks: gapWatermarks,
      auditChainRegistry: {
        readChainRegistration: async () => ({
          chainId: "DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD",
          headSequence: 3,
          headHash: "EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE",
          forked: false,
        }),
      },
    });
    const view = deviceSwitchRequestViewSchema.parse(service.requestSwitch(switchRequest));
    const result = await service.acceptDrain(view.requestId, {
      ...manifest,
      deviceSwitchRequestId: view.requestId,
    });
    expect(result).toMatchObject({ code: "DRAIN_PROOF_UNVERIFIED", reason: "DRAIN_STREAM_GAP" });
    expect("streams" in result ? result.streams.map(({ stream }) => stream) : []).toEqual(["execution_fact"]);
    expect(service.getSwitchStatus(view.requestId)?.status).toBe("draining");
    expect(service.getLeaseStatus()).toMatchObject({ held: true, deviceId: "device-a", leaseEpoch: 2 });
  });

  it("C0 items 3-5 bind the held predecessor epoch and consume proof in the release transition", async () => {
    const calls: Parameters<DrainVerificationPort["verifyHandoff"]>[0][] = [];
    const accepting: DrainVerificationPort = {
      verifyHandoff: async (input) => {
        calls.push(input);
        return {
          accepted: true,
          proofId: "proof-accepted",
          proofDigest: "digest-accepted",
          sealClaims: verifiedSealClaims,
        };
      },
    };
    const ledgers = sealLedgers();
    const service = new DevicesFixtureService({ ...serviceOptions(), ...ledgers.options, drainVerifier: accepting });
    const view = deviceSwitchRequestViewSchema.parse(service.requestSwitch(switchRequest));
    const result = deviceSwitchRequestViewSchema.parse(await service.acceptDrain(view.requestId, manifest));
    expect(result.status).toBe("bootstrapping");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      workflowId: view.requestId,
      accountId: "account-a",
      workspaceId: "workspace-a",
      fromDeviceId: "device-a",
      leaseEpoch: 2,
      evaluatedAt: "2026-08-14T18:05:00Z",
    });
    expect(service.getLeaseStatus()).toMatchObject({ held: false });
    const sealDomain = {
      sourceDeviceId: manifest.sourceDeviceId,
      activeLeaseEpoch: manifest.activeLeaseEpoch,
    };
    const sealScope = { accountId: "account-a", workspaceId: manifest.workspaceId };
    expect(() => ledgers.mutation.installAcceptedDrainSeal(sealScope, {
      ...sealDomain,
      stream: "mutation",
      lastAssignedSequence: verifiedSealClaims.lastAssignedSequence.mutation + 1,
    })).toThrowError("an accepted handoff proof is immutable");
    expect(() => ledgers.executionFact.installAcceptedDrainSeal(sealScope, {
      ...sealDomain,
      stream: "execution_fact",
      lastAssignedSequence: verifiedSealClaims.lastAssignedSequence.execution_fact + 1,
    })).toThrowError("an accepted handoff proof is immutable");
    expect(() => ledgers.deviceAudit.installAcceptedDrainSeal(sealScope, {
      ...sealDomain,
      stream: "device_audit",
      lastAssignedSequence: verifiedSealClaims.lastAssignedSequence.device_audit + 1,
    })).toThrowError("an accepted handoff proof is immutable");
  });

  it("C0 item 4 rejects DRAIN_LEASE_NOT_HELD and never substitutes a synthetic account epoch", async () => {
    const clean = watermarks();
    const service = new DevicesFixtureService({
      ...serviceOptions(),
      activeLease: null,
      mutationWatermarks: clean,
      executionFactWatermarks: clean,
      deviceAuditWatermarks: clean,
      auditChainRegistry: { readChainRegistration: vi.fn(async () => null) },
    });
    const view = deviceSwitchRequestViewSchema.parse(service.requestSwitch(switchRequest));
    expect(await service.acceptDrain(view.requestId, {
      ...manifest,
      deviceSwitchRequestId: view.requestId,
    })).toEqual({
      code: "DRAIN_PROOF_UNVERIFIED",
      reason: "DRAIN_LEASE_NOT_HELD",
      streams: [],
    });
    expect(service.getSwitchStatus(view.requestId)?.status).toBe("draining");
  });

  it("fails closed when an accepting verifier returns seal claims outside the verified workflow binding", async () => {
    const ledgers = sealLedgers();
    const service = new DevicesFixtureService({
      ...serviceOptions(),
      ...ledgers.options,
      drainVerifier: {
        verifyHandoff: async () => ({
          accepted: true,
          proofId: "proof-wrong-binding",
          proofDigest: "digest-wrong-binding",
          sealClaims: { ...verifiedSealClaims, workspaceId: "workspace-other" },
        }),
      },
    });
    const view = deviceSwitchRequestViewSchema.parse(service.requestSwitch(switchRequest));
    expect(await service.acceptDrain(view.requestId, manifest)).toEqual({
      code: "DRAIN_PROOF_UNVERIFIED",
      reason: "DRAIN_PROOF_BINDING_MISMATCH",
      streams: [],
    });
    expect(service.getSwitchStatus(view.requestId)?.status).toBe("draining");
    expect(service.getLeaseStatus()).toMatchObject({ held: true, leaseEpoch: 2 });
  });

  it("P17-INV-42 lease renewal cannot move the independently-owned draining deadline", async () => {
    const workflow = new DeviceSwitchWorkflow({
      workflowId: "switch-deadline",
      accountId: "account-a",
      workspaceId: "workspace-a",
      mode: "normal",
      fromDeviceId: "device-a",
      toDeviceId: "device-b",
      idempotencyKey: "deadline-key",
      requestedAt: "2026-08-14T18:00:00Z",
      exclusiveExecutionBlockUntil: null,
      oldLeaseOfflineExecuteUntil: "2026-08-20T00:00:00Z",
      workspaceHasPublishedCheckpoint: true,
      boundKeyId: "key-device-b",
      boundKeyVersion: 1,
      boundAccountSecurityEpoch: 1,
    });
    const deadlineBeforeRenewal = workflow.stateDeadline;
    const lifecycle = new ActiveDeviceLeaseLifecycle({
      trustedTime: { now: () => "2026-08-14T18:05:00Z" },
      seed: {
        "account-a": {
          currentLeaseEpoch: 2,
          held: { ...activeLease, releasedAt: null },
        },
      },
    });
    await lifecycle.renew("account-a", "draining", {
      read: async () => ({
        active: true,
        offlineGraceUntil: "2026-08-15T18:05:00Z",
        commercialExpiresAt: null,
      }),
    }, 1);
    expect(workflow.stateDeadline).toBe(deadlineBeforeRenewal);
    expect(workflow.stateDeadline).toBe("2026-08-15T18:00:00Z");
  });

  it("P17-INV-43 normal handoff does not wait for offlineExecuteUntil", async () => {
    const accepting: DrainVerificationPort = {
      verifyHandoff: async () => ({
        accepted: true,
        proofId: "proof-expired-offline",
        proofDigest: "digest-expired-offline",
        sealClaims: verifiedSealClaims,
      }),
    };
    const ledgers = sealLedgers();
    const service = new DevicesFixtureService({
      ...serviceOptions(),
      ...ledgers.options,
      activeLease: { ...activeLease, offlineExecuteUntil: "2026-08-14T18:00:00Z" },
      drainVerifier: accepting,
    });
    const view = deviceSwitchRequestViewSchema.parse(service.requestSwitch(switchRequest));
    expect(deviceSwitchRequestViewSchema.parse(await service.acceptDrain(view.requestId, manifest)).status).toBe("bootstrapping");
  });
});
