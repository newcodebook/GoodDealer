import { readFileSync } from "node:fs";

import { drainProofSchema, type DrainManifest, type DrainStream } from "@gooddealer/protocol/execution-events";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

import {
  DRAIN_PROOF_MAX_TTL_SECONDS,
  DrainVerifier,
  InMemoryDrainProofRegistry,
  RefusingDrainProofSignature,
  type AuditChainRegistryPort,
  type DrainProofConsumptionPort,
  type DrainProofSignaturePort,
  type DrainLeaseStatePort,
  type DrainStreamWatermarkPort,
} from "../src/modules/devices/index";

const validProof = drainProofSchema.parse(JSON.parse(readFileSync(
  new URL("../../../packages/protocol/test-vectors/drain/valid/proof-handoff-three-streams.json", import.meta.url),
  "utf8",
))) as DrainManifest;
const backupProof = JSON.parse(readFileSync(
  new URL("../../../packages/protocol/test-vectors/drain/valid/proof-synchronized-backup.json", import.meta.url),
  "utf8",
)) as unknown;

const expected = {
  workflowId: "switch-request-1",
  accountId: "account-a",
  workspaceId: "workspace-a",
  fromDeviceId: "device-a",
  leaseEpoch: 2,
  evaluatedAt: "2026-08-14T18:05:00Z",
} as const;

function proof(overrides: Partial<DrainManifest> = {}): DrainManifest {
  return drainProofSchema.parse({ ...structuredClone(validProof), ...overrides }) as DrainManifest;
}

function cleanWatermarks(overrides: Partial<Record<DrainStream, Partial<Awaited<ReturnType<DrainStreamWatermarkPort["readWatermark"]>>>>> = {}) {
  const claims = new Map(validProof.streams.map((claim) => [claim.stream, claim] as const));
  const calls: DrainStream[] = [];
  const domains: Parameters<DrainStreamWatermarkPort["readWatermark"]>[0][] = [];
  const port: DrainStreamWatermarkPort = {
    readWatermark: async (domain) => {
      calls.push(domain.stream);
      domains.push(domain);
      const claim = claims.get(domain.stream);
      if (claim === undefined) throw new TypeError("unknown stream");
      return {
        contiguousReceivedThrough: claim.contiguousReceivedThrough,
        highestReceivedSequence: claim.contiguousReceivedThrough,
        missingRanges: [],
        rollingDigest: claim.rollingDigest,
        ...overrides[domain.stream],
      };
    },
  };
  return { port, calls, domains };
}

function cleanAudit(overrides: Partial<NonNullable<Awaited<ReturnType<AuditChainRegistryPort["readChainRegistration"]>>>> = {}) {
  const readChainRegistration = vi.fn(async () => ({
    chainId: "DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD",
    headSequence: 3,
    headHash: "EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE",
    forked: false,
    ...overrides,
  }));
  return { port: { readChainRegistration } satisfies AuditChainRegistryPort, readChainRegistration };
}

function heldLease() {
  return { readHeldLease: () => ({ deviceId: "device-a", leaseEpoch: 2, releasedAt: null }) };
}

function verifier(input: {
  readonly watermarks?: ReturnType<typeof cleanWatermarks>;
  readonly audit?: ReturnType<typeof cleanAudit>;
  readonly leaseHeld?: boolean;
  readonly heldLease?: DrainLeaseStatePort;
  readonly proofRegistry?: DrainProofConsumptionPort;
} = {}) {
  const watermarks = input.watermarks ?? cleanWatermarks();
  const audit = input.audit ?? cleanAudit();
  const signature = new RefusingDrainProofSignature();
  const check = vi.spyOn(signature, "checkDrainProofSignature");
  return {
    subject: new DrainVerifier({
      drainSignature: signature,
      mutationWatermarks: watermarks.port,
      executionFactWatermarks: watermarks.port,
      deviceAuditWatermarks: watermarks.port,
      auditChainRegistry: audit.port,
      leaseState: input.leaseHeld === false ? { readHeldLease: () => null } : (input.heldLease ?? heldLease()),
      proofRegistry: input.proofRegistry ?? new InMemoryDrainProofRegistry(),
    }),
    watermarks,
    audit,
    check,
  };
}

describe("DrainVerifier frozen guard order", () => {
  it("P17-INV-12 guard 1 rejects DRAIN_PROOF_MALFORMED before storage", async () => {
    const harness = verifier();
    const result = await harness.subject.verifyHandoff({ ...expected, manifest: {} });
    expect(result).toMatchObject({ accepted: false, reason: "DRAIN_PROOF_MALFORMED" });
    expect(harness.watermarks.calls).toEqual([]);
    expect(harness.check).not.toHaveBeenCalled();
  });

  it("P17-INV-16 guard 2 rejects DRAIN_PROOF_PURPOSE_MISMATCH before watermark reads", async () => {
    const harness = verifier();
    const result = await harness.subject.verifyHandoff({ ...expected, manifest: backupProof });
    expect(result).toMatchObject({ accepted: false, reason: "DRAIN_PROOF_PURPOSE_MISMATCH" });
    expect(harness.watermarks.calls).toEqual([]);
  });

  it("P17-INV-1/3 guard 3 rejects DRAIN_PROOF_BINDING_MISMATCH", async () => {
    const harness = verifier();
    const result = await harness.subject.verifyHandoff({ ...expected, manifest: proof({ workspaceId: "workspace-b" }) });
    expect(result).toMatchObject({ accepted: false, reason: "DRAIN_PROOF_BINDING_MISMATCH" });
    expect(harness.check).not.toHaveBeenCalled();
  });

  it("P17-INV-23 guard 4 rejects DRAIN_LEASE_NOT_HELD instead of using an account-head epoch", async () => {
    const harness = verifier({ leaseHeld: false });
    const result = await harness.subject.verifyHandoff({ ...expected, manifest: proof() });
    expect(result).toMatchObject({ accepted: false, reason: "DRAIN_LEASE_NOT_HELD" });
    expect(harness.check).not.toHaveBeenCalled();
  });

  it("guard 4 rejects a proof bound to an allocated epoch the predecessor never held", async () => {
    const harness = verifier();
    const result = await harness.subject.verifyHandoff({
      ...expected,
      leaseEpoch: 5,
      manifest: proof({ activeLeaseEpoch: 5 }),
    });
    expect(result).toMatchObject({ accepted: false, reason: "DRAIN_LEASE_NOT_HELD" });
    expect(harness.watermarks.calls).toEqual([]);
    expect(harness.check).not.toHaveBeenCalled();
  });

  it("guard 4 rejects a released predecessor lease even when device and epoch still match", async () => {
    const harness = verifier({
      heldLease: { readHeldLease: () => ({
        deviceId: "device-a",
        leaseEpoch: 2,
        releasedAt: "2026-08-14T18:04:00Z",
      }) },
    });
    const result = await harness.subject.verifyHandoff({ ...expected, manifest: proof() });
    expect(result).toMatchObject({ accepted: false, reason: "DRAIN_LEASE_NOT_HELD" });
    expect(harness.watermarks.calls).toEqual([]);
    expect(harness.check).not.toHaveBeenCalled();
  });

  it("guards 5 and 6 reject DRAIN_PROOF_EXPIRED and DRAIN_PROOF_TTL_EXCESSIVE", async () => {
    const expiredHarness = verifier();
    const expired = await expiredHarness.subject.verifyHandoff({
      ...expected,
      evaluatedAt: validProof.expiresAt,
      manifest: proof(),
    });
    expect(expired).toMatchObject({ accepted: false, reason: "DRAIN_PROOF_EXPIRED" });
    expect(expiredHarness.check).not.toHaveBeenCalled();

    expect(DRAIN_PROOF_MAX_TTL_SECONDS).toBe(600);
    const ttlHarness = verifier();
    const excessive = await ttlHarness.subject.verifyHandoff({
      ...expected,
      manifest: proof({ expiresAt: "2026-08-14T18:10:01Z" }),
    });
    expect(excessive).toMatchObject({ accepted: false, reason: "DRAIN_PROOF_TTL_EXCESSIVE" });
    expect(ttlHarness.check).not.toHaveBeenCalled();
  });

  it("guard 7 binds proof identity and rejects DRAIN_PROOF_ID_CONFLICT", async () => {
    const registry = new InMemoryDrainProofRegistry();
    const first = verifier({ proofRegistry: registry });
    expect(await first.subject.verifyHandoff({ ...expected, manifest: proof() })).toMatchObject({
      accepted: false,
      reason: "DRAIN_SIGNATURE_UNVERIFIED",
    });
    const second = verifier({ proofRegistry: registry });
    const result = await second.subject.verifyHandoff({
      ...expected,
      manifest: proof({ deviceSignature: "ZGlmZmVyZW50" }),
    });
    expect(result).toMatchObject({ accepted: false, reason: "DRAIN_PROOF_ID_CONFLICT" });
    expect(second.check).not.toHaveBeenCalled();
  });

  it("guard 8 rejects DRAIN_PROOF_CONSUMED when no accepted stored verdict exists", async () => {
    const consumed: DrainProofConsumptionPort = {
      inspectProof: () => ({ status: "consumed", accepted: false }),
      rememberProof: () => {},
      consumeProof: () => ({ rollback() {} }),
    };
    const harness = verifier({ proofRegistry: consumed });
    const result = await harness.subject.verifyHandoff({ ...expected, manifest: proof() });
    expect(result).toMatchObject({ accepted: false, reason: "DRAIN_PROOF_CONSUMED" });
    expect(harness.check).not.toHaveBeenCalled();
  });

  it("P17-INV-20/23 guards 9-12 collect all streams and exact DRAIN_STREAM_GAP diagnostics", async () => {
    const watermarks = cleanWatermarks({
      execution_fact: {
        contiguousReceivedThrough: 0,
        highestReceivedSequence: 1,
        missingRanges: [{ fromSequence: 1, toSequence: 1 }],
      },
    });
    const harness = verifier({ watermarks });
    const result = await harness.subject.verifyHandoff({ ...expected, manifest: proof() });
    expect(result).toMatchObject({ accepted: false, reason: "DRAIN_STREAM_GAP" });
    expect(result.accepted ? [] : result.streams.map(({ stream }) => stream)).toEqual(["execution_fact"]);
    expect(result.accepted ? [] : result.streams[0]?.missingRanges).toEqual([{ fromSequence: 1, toSequence: 1 }]);
    expect(watermarks.calls).toEqual(["mutation", "execution_fact", "device_audit"]);
    expect(harness.audit.readChainRegistration).toHaveBeenCalledOnce();
    expect(harness.check).not.toHaveBeenCalled();
  });

  it("P17-INV-22 guard 10 rejects DRAIN_STREAM_WATERMARK_SHORT even when highestSeen reaches the claim", async () => {
    const watermarks = cleanWatermarks({
      execution_fact: { contiguousReceivedThrough: 0, highestReceivedSequence: 1 },
    });
    const harness = verifier({ watermarks });
    const result = await harness.subject.verifyHandoff({ ...expected, manifest: proof() });
    expect(result).toMatchObject({ accepted: false, reason: "DRAIN_STREAM_WATERMARK_SHORT" });
    expect(result.accepted ? null : result.streams[0]).toMatchObject({
      stream: "execution_fact",
      cloudContiguousReceivedThrough: 0,
      cloudHighestReceivedSequence: 1,
    });
    expect(harness.check).not.toHaveBeenCalled();
  });

  it("guard 11 rejects DRAIN_STREAM_DIGEST_MISMATCH after every stream read", async () => {
    const watermarks = cleanWatermarks({ execution_fact: { rollingDigest: validProof.streams[0].rollingDigest } });
    const harness = verifier({ watermarks });
    const result = await harness.subject.verifyHandoff({ ...expected, manifest: proof() });
    expect(result).toMatchObject({ accepted: false, reason: "DRAIN_STREAM_DIGEST_MISMATCH" });
    expect(watermarks.calls).toEqual(["mutation", "execution_fact", "device_audit"]);
    expect(harness.check).not.toHaveBeenCalled();
  });

  it("P17-INV-4 guard 12 rejects DRAIN_AUDIT_CHAIN_FORKED", async () => {
    const harness = verifier({ audit: cleanAudit({ forked: true }) });
    const result = await harness.subject.verifyHandoff({ ...expected, manifest: proof() });
    expect(result).toMatchObject({ accepted: false, reason: "DRAIN_AUDIT_CHAIN_FORKED" });
    expect(harness.check).not.toHaveBeenCalled();
  });

  it("P17-INV-24/25/41 reaches guard 13 last and refuses DRAIN_SIGNATURE_UNVERIFIED", async () => {
    type SignatureResult = Awaited<ReturnType<DrainProofSignaturePort["checkDrainProofSignature"]>>;
    expectTypeOf<SignatureResult>().toEqualTypeOf<{
      readonly verified: false;
      readonly reason: "signature_verification_disabled";
    }>();
    const harness = verifier();
    const result = await harness.subject.verifyHandoff({ ...expected, manifest: proof() });
    expect(result).toEqual({ accepted: false, reason: "DRAIN_SIGNATURE_UNVERIFIED", streams: [] });
    expect(harness.watermarks.calls).toEqual(["mutation", "execution_fact", "device_audit"]);
    expect(harness.watermarks.domains).toEqual([
      { workspaceId: "workspace-a", sourceDeviceId: "device-a", activeLeaseEpoch: 2, stream: "mutation" },
      { workspaceId: "workspace-a", sourceDeviceId: "device-a", activeLeaseEpoch: 2, stream: "execution_fact" },
      { workspaceId: "workspace-a", sourceDeviceId: "device-a", activeLeaseEpoch: 2, stream: "device_audit" },
    ]);
    expect(harness.audit.readChainRegistration).toHaveBeenCalledOnce();
    expect(harness.check).toHaveBeenCalledOnce();
  });
});
