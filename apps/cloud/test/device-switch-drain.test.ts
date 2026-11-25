import { describe, expect, it, vi } from "vitest";

import { PostgresDeviceSwitchDrain } from "../src/modules/devices/index";
import { drainProofKeyPair, signedHandoffDrainProof } from "./support/drain-proof";

const subject = { accountId: "account-drain", workspaceId: "workspace-drain", deviceId: "device-old" } as const;
const { privateKey, rawPublicKey } = drainProofKeyPair();
const view = {
  schemaVersion: 1 as const, accepted: true as const,
  request: { schemaVersion: 2 as const, requestId: "switch-1", mode: "normal" as const, status: "bootstrapping" as const,
    fromDeviceId: "device-old", toDeviceId: "device-new", requestedAt: "2026-11-17T00:00:00Z",
    normalHandoffReceipt: null, earliestTakeoverAt: null, bootstrapExpiresAt: "2026-11-17T01:00:00Z" },
};

function signed(overrides: Record<string, unknown> = {}, key = privateKey) {
  return signedHandoffDrainProof(key, overrides);
}

function fixture(outcome = "recorded", draining = true) {
  const queries: { sql: string; values: unknown[] }[] = [];
  const transaction = {
    query: vi.fn(async (sql: string, values: unknown[]) => {
      queries.push({ sql, values });
      if (sql.includes("FROM device_signing_keys")) return { rows: [{ public_key: rawPublicKey }] };
      if (sql.includes("device_record_drain_proof")) return { rows: [{ outcome }] };
      if (sql.includes("FROM device_switch_workflows")) return { rows: draining ? [{ workflow_revision: "1", to_device_id: "device-new" }] : [] };
      throw new Error(`unexpected query ${sql}`);
    }),
  };
  const commit = vi.fn(async () => ({ status: "bootstrapping" as const, workflowId: "switch-1", workflowRevision: 2,
    pendingLeaseEpoch: 2, bootstrapCapabilityJti: "bootstrap-x", bootstrapIssuedAt: "2026-11-17T00:00:00Z",
    bootstrapExpiresAt: "2026-11-17T01:00:00Z" }));
  const read = vi.fn(async () => view);
  const drain = new PostgresDeviceSwitchDrain({
    transactions: { withTenant: vi.fn(async (_scope, work) => work(transaction)) } as never,
    requests: { read },
    transition: { commit },
  });
  return { drain, queries, commit, read };
}

describe("device switch drain submission (ADR-0032 S1c2)", () => {
  it("records a proof signed by the source's device key and hands the switch to bootstrap", async () => {
    const { drain, queries, commit } = fixture();
    await expect(drain.submit(subject, "switch-1", signed())).resolves.toEqual(view);
    const record = queries.find(({ sql }) => sql.includes("device_record_drain_proof"));
    expect(record?.values.slice(0, 8)).toEqual(["proof-1", expect.any(Buffer), 2, "switch-1", "device-old", 1, "key-old", 1]);
    expect(commit).toHaveBeenCalledWith(expect.objectContaining({
      workflowId: "switch-1", expectedWorkflowRevision: 1, targetDeviceId: "device-new", proofId: "proof-1",
    }));
  });

  it("rejects a proof for another switch, workspace or device, or a forged signature, before recording", async () => {
    const { privateKey: otherKey } = drainProofKeyPair();
    for (const [proof, requestId] of [
      [signed({ deviceSwitchRequestId: "switch-2" }), "switch-1"],
      [signed({ workspaceId: "workspace-other" }), "switch-1"],
      [signed({ sourceDeviceId: "device-other" }), "switch-1"],
      [signed({}, otherKey), "switch-1"],
      [{ ...signed(), activeLeaseEpoch: 2 }, "switch-1"],
      [{ ...signed(), purpose: "synchronized_backup" }, "switch-1"],
      ["not a proof", "switch-1"],
    ] as const) {
      const { drain, queries, commit } = fixture();
      await expect(drain.submit(subject, requestId, proof)).resolves.toEqual({ schemaVersion: 1, accepted: false, code: "DRAIN_PROOF_INVALID" });
      expect(queries.some(({ sql }) => sql.includes("device_record_drain_proof"))).toBe(false);
      expect(commit).not.toHaveBeenCalled();
    }
  });

  it("maps admission and handoff refusals to closed codes without committing", async () => {
    for (const [outcome, code] of [
      ["PROOF_EXPIRED", "DRAIN_PROOF_EXPIRED"],
      ["PROOF_ID_CONFLICT", "DRAIN_PROOF_INVALID"],
      ["SIGNING_KEY_CONFLICT", "DRAIN_PROOF_INVALID"],
      ["LEASE_CONFLICT", "DRAIN_PROOF_INVALID"],
    ] as const) {
      const { drain, commit } = fixture(outcome);
      await expect(drain.submit(subject, "switch-1", signed())).resolves.toEqual({ schemaVersion: 1, accepted: false, code });
      expect(commit).not.toHaveBeenCalled();
    }
    const streams = fixture();
    streams.commit.mockResolvedValueOnce({ status: "rejected", reason: "STREAM_HEAD_CONFLICT" } as never);
    await expect(streams.drain.submit(subject, "switch-1", signed())).resolves.toEqual({ schemaVersion: 1, accepted: false, code: "DRAIN_STREAMS_INCOMPLETE" });
  });

  it("answers a replay after a completed handoff with the switch as it stands", async () => {
    const { drain, commit, read } = fixture("replayed");
    await expect(drain.submit(subject, "switch-1", signed())).resolves.toEqual(view);
    expect(read).toHaveBeenCalledWith(subject, "switch-1");
    expect(commit).not.toHaveBeenCalled();
  });

  it("answers with the current view when a concurrent submit finished the handoff first", async () => {
    const { drain, commit, read } = fixture("recorded", false);
    await expect(drain.submit(subject, "switch-1", signed())).resolves.toEqual(view);
    expect(read).toHaveBeenCalledWith(subject, "switch-1");
    expect(commit).not.toHaveBeenCalled();
  });
});
