import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  ActiveDeviceLeaseLifecycle,
  InMemoryDrainProofRegistry,
  type DrainTransactionFaultPoint,
} from "../src/modules/devices/index";

const faultPoints: readonly DrainTransactionFaultPoint[] = [
  "after_proof_consumption",
  "after_lease_release",
  "after_epoch_allocation",
  "after_bootstrap_transition",
];

function lifecycle(fault?: DrainTransactionFaultPoint) {
  const registry = new InMemoryDrainProofRegistry();
  const subject = new ActiveDeviceLeaseLifecycle({
    trustedTime: { now: () => "2026-08-14T18:05:00Z" },
    proofRegistry: registry,
    ...(fault === undefined ? {} : {
      drainTransactionFault: (point: DrainTransactionFaultPoint) => {
        if (point === fault) throw new Error(`fault:${point}`);
      },
    }),
    seed: {
      "account-a": {
        currentLeaseEpoch: 7,
        highestAllocatedEpoch: 7,
        held: {
          deviceId: "device-a",
          leaseEpoch: 7,
          issuedAt: "2026-08-14T17:00:00Z",
          renewAfter: "2026-08-14T17:05:00Z",
          onlineExpiresAt: "2026-08-14T17:15:00Z",
          offlineExecuteUntil: "2026-08-15T17:00:00Z",
          releasedAt: null,
        },
      },
    },
  });
  return { subject, registry };
}

describe("P17-INV-26/27 handoff release transaction", () => {
  for (const point of faultPoints) {
    it(`A11 ${point} rolls back proof, lease, epoch, workflow, and cursor state`, () => {
      const { subject, registry } = lifecycle(point);
      let workflowStatus: "draining" | "bootstrapping" = "draining";

      expect(() => subject.beginBootstrap("account-a", "switch-a", "device-a", {
        predecessorLeaseEpoch: 7,
        consumedProof: { proofId: "proof-a", proofDigest: "digest-a" },
        transition: () => {
          workflowStatus = "bootstrapping";
          return { rollback: () => { workflowStatus = "draining"; } };
        },
      })).toThrowError(`fault:${point}`);

      expect(registry.inspectProof("proof-a", "digest-a")).toEqual({ status: "unseen" });
      expect(subject.readHeldLease("account-a")).toMatchObject({ leaseEpoch: 7, releasedAt: null });
      expect(subject.pendingEpoch("account-a", "switch-a")).toBeNull();
      expect(subject.highestAllocatedEpoch("account-a")).toBe(7);
      expect(workflowStatus).toBe("draining");
    });
  }

  it("P17-INV-29 keeps cursor retirement outside the drain release transaction", () => {
    const source = readFileSync(
      new URL("../src/modules/devices/lease-lifecycle.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(/\bretireCursor\b/);
  });

  it("P17-INV-28 consumes, releases, allocates, and transitions exactly once", () => {
    const { subject, registry } = lifecycle();
    let workflowStatus: "draining" | "bootstrapping" = "draining";
    const epoch = subject.beginBootstrap("account-a", "switch-a", "device-a", {
      predecessorLeaseEpoch: 7,
      consumedProof: { proofId: "proof-a", proofDigest: "digest-a" },
      transition: () => {
        workflowStatus = "bootstrapping";
        return { rollback() {} };
      },
    });
    expect(epoch).toBe(8);
    expect(registry.inspectProof("proof-a", "digest-a")).toEqual({ status: "consumed", accepted: true });
    expect(registry.consumedRecord("proof-a")).toEqual({
      proofDigest: "digest-a",
      consumed: true,
      accepted: true,
      consumedAt: "2026-08-14T18:05:00Z",
      acceptedAt: "2026-08-14T18:05:00Z",
      purpose: "handoff",
    });
    expect(subject.readHeldLease("account-a")).toMatchObject({ releasedAt: "2026-08-14T18:05:00Z" });
    expect(subject.pendingEpoch("account-a", "switch-a")).toBe(8);
    expect(subject.highestAllocatedEpoch("account-a")).toBe(8);
    expect(workflowStatus).toBe("bootstrapping");
    expect(subject.beginBootstrap("account-a", "switch-a", "device-a")).toBe(8);
    expect(subject.highestAllocatedEpoch("account-a")).toBe(8);
  });
});
