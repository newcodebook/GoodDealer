import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, expectTypeOf, it, vi } from "vitest";

import {
  DRAIN_PROOF_SCHEMA_VERSION,
  DRAIN_STREAM_GENESIS_DIGEST,
  drainProofSchema,
  encodeDrainChainStepInput,
  encodeDrainStreamEnvelope,
  type DrainProof,
  type DrainStream,
} from "@gooddealer/protocol/execution-events";
import type { SubmittedSyncMutation } from "@gooddealer/protocol/workspace";

import {
  DrainStreamLedger,
  buildDrainProofClaims,
  projectDrainReadiness,
  type DrainReadiness,
  type DrainStreamState,
  type Sha256Port,
  type UnsignedDrainProof,
} from "../src/index";

const ZERO_DIGEST = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

function digest(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(createHash("sha256").update(bytes).digest());
}

const sha256: Sha256Port = { digest: async (bytes) => digest(bytes) };

const mutation = {
  schemaVersion: 1,
  mutationId: "mutation-5",
  workspaceId: "workspace-a",
  workspaceSchemaVersion: 1,
  entityType: "domain_asset",
  entityId: "example.com",
  baseServerRevision: 4,
  changedFields: [{ fieldPath: "note", value: "Priority portfolio" }],
  sourceDeviceId: "device-a",
  activeLeaseEpoch: 2,
  deviceMutationSequence: 9,
} as const satisfies SubmittedSyncMutation;

function state(
  stream: DrainStream,
  progress: "empty" | "pending" | "complete",
): DrainStreamState {
  if (progress === "empty") {
    return {
      stream,
      lastAssignedSequence: 0,
      contiguousReceivedThrough: 0,
      pendingCount: 0,
      rollingDigest: DRAIN_STREAM_GENESIS_DIGEST,
    };
  }
  if (progress === "pending") {
    return {
      stream,
      lastAssignedSequence: 2,
      contiguousReceivedThrough: 1,
      pendingCount: 1,
      rollingDigest: ZERO_DIGEST,
    };
  }
  return {
    stream,
    lastAssignedSequence: 2,
    contiguousReceivedThrough: 2,
    pendingCount: 0,
    rollingDigest: ZERO_DIGEST,
  };
}

const completeStreams = [
  state("mutation", "complete"),
  state("execution_fact", "complete"),
  state("device_audit", "complete"),
] as const;

const claimsInput = {
  purpose: "handoff",
  workspaceId: "workspace-a",
  sourceDeviceId: "device-a",
  activeLeaseEpoch: 2,
  deviceSwitchRequestId: "switch-1",
  streams: completeStreams,
  issuedAt: "2026-08-14T18:00:00Z",
  expiresAt: "2026-08-14T18:05:00Z",
} as const;

describe("DrainStreamLedger", () => {
  it("folds a protocol canonical envelope through the injected SHA-256 port", async () => {
    const digestSpy = vi.fn(async (bytes: Uint8Array) => digest(bytes));
    const ledger = new DrainStreamLedger({ stream: "mutation", sha256: { digest: digestSpy } });
    const envelope = encodeDrainStreamEnvelope("mutation", mutation);

    expect(ledger.state()).toEqual(state("mutation", "empty"));
    await ledger.appendCommitted(1, envelope);

    const expectedInput = encodeDrainChainStepInput(
      new Uint8Array(Buffer.from(DRAIN_STREAM_GENESIS_DIGEST, "base64url")),
      envelope,
    );
    expect(digestSpy).toHaveBeenCalledOnce();
    expect(digestSpy).toHaveBeenCalledWith(expectedInput);
    expect(ledger.state()).toEqual({
      stream: "mutation",
      lastAssignedSequence: 1,
      contiguousReceivedThrough: 0,
      pendingCount: 1,
      rollingDigest: createHash("sha256").update(expectedInput).digest("base64url"),
    });
  });

  it("rejects gaps and rewrites without repairing or renumbering (P17-INV-38)", async () => {
    const ledger = new DrainStreamLedger({ stream: "execution_fact", sha256 });
    const firstEnvelope = new TextEncoder().encode("fact-1");
    const secondEnvelope = new TextEncoder().encode("fact-2");

    await expect(ledger.appendCommitted(2, secondEnvelope)).rejects.toThrow(/gap|next contiguous/i);
    expect(ledger.state()).toEqual(state("execution_fact", "empty"));

    await ledger.appendCommitted(1, firstEnvelope);
    const afterFirst = ledger.state();
    await expect(ledger.appendCommitted(1, secondEnvelope)).rejects.toThrow(/rewrit/i);
    expect(ledger.state()).toEqual(afterFirst);

    await ledger.appendCommitted(2, secondEnvelope);
    expect(ledger.state().lastAssignedSequence).toBe(2);
  });

  it("accepts only monotone acknowledgements through locally committed sequences", async () => {
    const ledger = new DrainStreamLedger({ stream: "device_audit", sha256 });
    await ledger.appendCommitted(1, new TextEncoder().encode("audit-1"));
    await ledger.appendCommitted(2, new TextEncoder().encode("audit-2"));

    ledger.acknowledgeThrough(1);
    expect(ledger.state()).toMatchObject({ contiguousReceivedThrough: 1, pendingCount: 1 });
    ledger.acknowledgeThrough(1);
    expect(() => ledger.acknowledgeThrough(0)).toThrow(/monotone/i);
    expect(() => ledger.acknowledgeThrough(3)).toThrow(/committed/i);
    expect(ledger.state()).toMatchObject({ contiguousReceivedThrough: 1, pendingCount: 1 });

    ledger.acknowledgeThrough(2);
    expect(ledger.state()).toMatchObject({ contiguousReceivedThrough: 2, pendingCount: 0 });
  });

  it("keeps ledger state unchanged when hashing fails or returns a non-SHA-256 value", async () => {
    const failure = new DrainStreamLedger({
      stream: "mutation",
      sha256: { digest: async () => Promise.reject(new Error("digest unavailable")) },
    });
    const wrongLength = new DrainStreamLedger({
      stream: "mutation",
      sha256: { digest: async () => new Uint8Array(31) },
    });

    await expect(failure.appendCommitted(1, new Uint8Array([1]))).rejects.toThrow(/unavailable/i);
    await expect(wrongLength.appendCommitted(1, new Uint8Array([1]))).rejects.toThrow(/32 bytes/i);
    expect(failure.state()).toEqual(state("mutation", "empty"));
    expect(wrongLength.state()).toEqual(state("mutation", "empty"));
  });
});

describe("projectDrainReadiness", () => {
  const progressKinds = ["empty", "pending", "complete"] as const;
  const decisionTable = progressKinds.flatMap((mutationProgress) =>
    progressKinds.flatMap((executionProgress) =>
      progressKinds.map((auditProgress) => {
        const progress = [mutationProgress, executionProgress, auditProgress] as const;
        const expected: DrainReadiness = progress.includes("pending")
          ? "flushing"
          : progress.every((entry) => entry === "empty")
            ? "not_started"
            : "ready_to_sign";
        return { progress, expected };
      }),
    ),
  );

  it.each(decisionTable)(
    "projects mutation=$progress.0 execution_fact=$progress.1 device_audit=$progress.2 as $expected",
    ({ progress, expected }) => {
      expect(projectDrainReadiness([
        state("mutation", progress[0]),
        state("execution_fact", progress[1]),
        state("device_audit", progress[2]),
      ])).toBe(expected);
    },
  );

  it("fails closed on missing, reordered, duplicate, unknown, or conflicting state", () => {
    expect(projectDrainReadiness(completeStreams.slice(0, 2))).toBe("blocked");
    expect(projectDrainReadiness([
      completeStreams[1],
      completeStreams[0],
      completeStreams[2],
    ])).toBe("blocked");
    expect(projectDrainReadiness([
      completeStreams[0],
      { ...completeStreams[1], stream: "mutation" },
      completeStreams[2],
    ])).toBe("blocked");
    expect(projectDrainReadiness([
      completeStreams[0],
      { ...completeStreams[1], stream: "account_device_audit" as never },
      completeStreams[2],
    ])).toBe("blocked");
    expect(projectDrainReadiness([
      completeStreams[0],
      { ...completeStreams[1], pendingCount: 1 },
      completeStreams[2],
    ])).toBe("blocked");
    expect(projectDrainReadiness([
      state("mutation", "empty"),
      { ...state("execution_fact", "empty"), rollingDigest: ZERO_DIGEST },
      state("device_audit", "empty"),
    ])).toBe("blocked");
  });
});

describe("buildDrainProofClaims", () => {
  it("assembles handoff claims compatible with the public DrainProof contract", () => {
    const unsigned = buildDrainProofClaims(claimsInput);

    expect(unsigned).toEqual({
      schemaVersion: DRAIN_PROOF_SCHEMA_VERSION,
      typ: "gd.drain-proof.v1",
      aud: "gooddealer-cloud/drain-verification",
      purpose: "handoff",
      workspaceId: "workspace-a",
      sourceDeviceId: "device-a",
      activeLeaseEpoch: 2,
      deviceSwitchRequestId: "switch-1",
      streams: completeStreams,
      canonicalCodecVersion: 1,
      digestAlgorithm: "sha256-chain-v1",
      issuedAt: "2026-08-14T18:00:00Z",
      expiresAt: "2026-08-14T18:05:00Z",
    });
    expect(unsigned.streams).not.toBe(completeStreams);
    expect(unsigned.streams[0]).not.toBe(completeStreams[0]);

    const signed: DrainProof = {
      ...unsigned,
      proofId: "proof-1",
      signingKeyId: "device-key-1",
      signingKeyVersion: 1,
      signatureTranscriptVersion: 1,
      deviceSignature: "c2lnbmF0dXJl",
    };
    expect(drainProofSchema.parse(signed)).toEqual(signed);
    expectTypeOf(unsigned).toEqualTypeOf<UnsignedDrainProof>();
  });

  it("assembles synchronized-backup claims and preserves Host-supplied timestamps verbatim", () => {
    const { deviceSwitchRequestId: _deviceSwitchRequestId, ...claimsWithoutSwitchRequest } = claimsInput;
    const unsigned = buildDrainProofClaims({
      ...claimsWithoutSwitchRequest,
      purpose: "synchronized_backup",
      synchronizedSnapshotBinding: { localCommitSequence: 0, serverRevision: 0 },
      issuedAt: "2099-12-31T23:59:58Z",
      expiresAt: "1900-01-01T00:00:00Z",
    });

    expect(unsigned).toMatchObject({
      purpose: "synchronized_backup",
      synchronizedSnapshotBinding: { localCommitSequence: 0, serverRevision: 0 },
      issuedAt: "2099-12-31T23:59:58Z",
      expiresAt: "1900-01-01T00:00:00Z",
    });
    expect(unsigned).not.toHaveProperty("deviceSwitchRequestId");
  });

  it("allows the protocol's legal all-empty proof claims but refuses pending or blocked claims", () => {
    const emptyStreams = [
      state("mutation", "empty"),
      state("execution_fact", "empty"),
      state("device_audit", "empty"),
    ] as const;
    expect(buildDrainProofClaims({ ...claimsInput, streams: emptyStreams }).streams).toEqual(emptyStreams);

    expect(() => buildDrainProofClaims({
      ...claimsInput,
      streams: [state("mutation", "pending"), completeStreams[1], completeStreams[2]],
    })).toThrow(/fully acknowledged/i);
    expect(() => buildDrainProofClaims({
      ...claimsInput,
      streams: [completeStreams[1], completeStreams[0], completeStreams[2]],
    })).toThrow(/valid drain stream order/i);
  });

  it("enforces purpose isolation without signing or inventing Host-owned proof metadata", () => {
    const { deviceSwitchRequestId: _deviceSwitchRequestId, ...claimsWithoutSwitchRequest } = claimsInput;
    expect(() => buildDrainProofClaims({
      ...claimsWithoutSwitchRequest,
    })).toThrow(/switch request/i);
    expect(() => buildDrainProofClaims({
      ...claimsInput,
      synchronizedSnapshotBinding: { localCommitSequence: 1, serverRevision: 1 },
    })).toThrow(/snapshot binding/i);
    expect(() => buildDrainProofClaims({
      ...claimsInput,
      purpose: "synchronized_backup",
      synchronizedSnapshotBinding: { localCommitSequence: 1, serverRevision: 1 },
    })).toThrow(/switch request/i);

    const unsigned = buildDrainProofClaims(claimsInput);
    expect(unsigned).not.toHaveProperty("proofId");
    expect(unsigned).not.toHaveProperty("signingKeyId");
    expect(unsigned).not.toHaveProperty("signingKeyVersion");
    expect(unsigned).not.toHaveProperty("signatureTranscriptVersion");
    expect(unsigned).not.toHaveProperty("deviceSignature");
  });

  it.each([
    ["workspace identifier", { workspaceId: "workspace with spaces" }],
    ["source device identifier", { sourceDeviceId: "d".repeat(200) }],
    ["issued timestamp", { issuedAt: "yesterday" }],
  ] as const)("rejects malformed protocol scalar format for %s", (_label, override) => {
    expect(() => buildDrainProofClaims({ ...claimsInput, ...override })).toThrow();
  });

  it("uses no local clock even when Date is poisoned (P17-INV-37)", async () => {
    const now = vi.spyOn(Date, "now").mockImplementation(() => {
      throw new Error("drain bookkeeping must not read the wall clock");
    });
    try {
      const ledger = new DrainStreamLedger({ stream: "mutation", sha256 });
      await ledger.appendCommitted(1, encodeDrainStreamEnvelope("mutation", mutation));
      ledger.acknowledgeThrough(1);

      expect(projectDrainReadiness([
        ledger.state(),
        state("execution_fact", "empty"),
        state("device_audit", "empty"),
      ])).toBe("ready_to_sign");
      expect(buildDrainProofClaims(claimsInput).issuedAt).toBe(claimsInput.issuedAt);
      expect(now).not.toHaveBeenCalled();
    } finally {
      now.mockRestore();
    }
  });

  it("contains no clock, signing, crypto-runtime, Cloud, Tauri, network, or retry policy", () => {
    const source = readFileSync(resolve(import.meta.dirname, "../src/sync/index.ts"), "utf8");

    expect(source).not.toMatch(/\bDate\b|Date\.now|Date\.parse|getTime|performance\.now/);
    expect(source).not.toMatch(/(?:issuedAt|expiresAt)\s*[<>]=?|\.(?:sign|verify)\s*\(|\b(?:sign|verify)\s*\(/);
    expect(source).not.toMatch(/node:crypto|globalThis\.crypto|crypto\.subtle/);
    expect(source).not.toMatch(/from\s+["'](?:@tauri-apps|apps\/cloud)/);
    expect(source).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket|setTimeout|setInterval|\bretry\b|\bbackoff\b/i);
  });
});
