import { describe, expect, it } from "vitest";

import { DRAIN_STREAM_GENESIS_DIGEST } from "../src/execution-events/index";
import { deviceSwitchRequestSchema,deviceSwitchRequestResolutionRequestSchema,deviceSwitchRequestResolutionResponseSchema,deviceSwitchRequestViewSchema, deviceSwitchDrainRequestSchema, deviceSwitchLookupRequestSchema, deviceSwitchResponseSchema } from "../src/devices/index";

const request = {
  schemaVersion: 2, requestId: "switch-1", mode: "normal", status: "draining", fromDeviceId: "device-old",
  toDeviceId: "device-new", requestedAt: "2026-11-17T00:00:00Z", earliestTakeoverAt: null, bootstrapExpiresAt: null, normalHandoffReceipt: null,
} as const;

describe("device switch transport (ADR-0032 S1b)", () => {
  it("requires an epoch CAS for a v2 normal request and rejects the old first-POST shape",()=>{
    const normal={schemaVersion:2,mode:"normal",toDeviceId:"device-new",idempotencyKey:"idem-1",expectedSourceLeaseEpoch:7};
    expect(deviceSwitchRequestSchema.safeParse(normal).success).toBe(true);
    for(const changed of [{...normal,schemaVersion:1},{...normal,expectedSourceLeaseEpoch:0},{...normal,sourceDeviceId:"chosen"}])expect(deviceSwitchRequestSchema.safeParse(changed).success).toBe(false);
    const {expectedSourceLeaseEpoch:_epoch,...old}=normal;expect(deviceSwitchRequestSchema.safeParse(old).success).toBe(false);
  });
  it("resolves an unknown request using only its idempotency key and preserves unknown legacy epoch",()=>{
    const query={schemaVersion:1,idempotencyKey:"idem-1"};
    expect(deviceSwitchRequestResolutionRequestSchema.safeParse(query).success).toBe(true);
    for(const selector of ["accountId","workspaceId","sourceDeviceId","expectedSourceLeaseEpoch"])expect(deviceSwitchRequestResolutionRequestSchema.safeParse({...query,[selector]:"chosen"}).success).toBe(false);
    const found={...query,outcome:"found",request,targetSigningKeyId:"target-key",targetSigningKeyVersion:1,sourceLeaseEpoch:7};
    expect(deviceSwitchRequestResolutionResponseSchema.safeParse(found).success).toBe(true);
    expect(deviceSwitchRequestResolutionResponseSchema.safeParse({...found,sourceLeaseEpoch:null}).success).toBe(true);
    expect(deviceSwitchRequestResolutionResponseSchema.safeParse({...query,outcome:"not_found"}).success).toBe(true);
    for(const changed of [{...found,sourceLeaseEpoch:0},{...found,outcome:"not_found"},{...found,targetSigningKeyVersion:0}])expect(deviceSwitchRequestResolutionResponseSchema.safeParse(changed).success).toBe(false);
  });
  it("names a switch by id only", () => {
    expect(deviceSwitchLookupRequestSchema.parse({ schemaVersion: 1, requestId: "switch-1" })).toEqual({ schemaVersion: 1, requestId: "switch-1" });
    for (const hostile of [
      { schemaVersion: 1, requestId: "switch-1", deviceId: "device-x" },
      { schemaVersion: 1, requestId: "" },
      { schemaVersion: 2, requestId: "switch-1" },
    ]) {
      expect(deviceSwitchLookupRequestSchema.safeParse(hostile).success).toBe(false);
    }
  });

  it("accepts a view or one closed rejection code, never both", () => {
    expect(deviceSwitchResponseSchema.parse({ schemaVersion: 1, accepted: true, request }).accepted).toBe(true);
    expect(deviceSwitchResponseSchema.parse({ schemaVersion: 1, accepted: false, code: "FORCED_SWITCH_UNAVAILABLE" }).accepted).toBe(false);
    for (const hostile of [
      { schemaVersion: 1, accepted: true, request, code: "SWITCH_IN_PROGRESS" },
      { schemaVersion: 1, accepted: false, code: "SWITCH_IN_PROGRESS", request },
      { schemaVersion: 1, accepted: false, code: "ACTIVE_DEVICE_CONFLICT" },
      { schemaVersion: 1, accepted: true, request: { ...request, status: "bootstrapping" } },
      { schemaVersion: 1, accepted: true, request: { ...request, mode: "forced" } },
    ]) {
      expect(deviceSwitchResponseSchema.safeParse(hostile).success).toBe(false);
    }
  });

  it("requires the v2 view and strict, normal-only durable handoff evidence", () => {
    const receipt = { sourceLeaseEpoch: 7, proofId: "proof-1", proofDigest: "A".repeat(43), releasedAt: "2026-11-17T00:01:00Z" };
    for (const status of ["bootstrapping", "completed", "failed"] as const) {
      expect(deviceSwitchRequestViewSchema.safeParse({ ...request, status, normalHandoffReceipt: receipt,
        bootstrapExpiresAt: status === "bootstrapping" ? "2026-11-17T01:01:00Z" : null }).success).toBe(true);
    }
    const { normalHandoffReceipt: _receipt, ...oldShape } = request;
    for (const hostile of [
      oldShape, { ...request, schemaVersion: 1 },
      { ...request, normalHandoffReceipt: { ...receipt, extra: true } },
      { ...request, normalHandoffReceipt: { ...receipt, sourceLeaseEpoch: 0 } },
      { ...request, normalHandoffReceipt: { ...receipt, proofDigest: "a".repeat(64) } },
      { ...request, normalHandoffReceipt: { ...receipt, releasedAt: "2026-11-16T00:00:00Z" } },
      { ...request, fromDeviceId: null, normalHandoffReceipt: receipt },
      { ...request, toDeviceId: request.fromDeviceId, normalHandoffReceipt: receipt },
      { ...request, mode: "forced", earliestTakeoverAt: "2026-11-17T01:00:00Z", normalHandoffReceipt: receipt },
    ]) expect(deviceSwitchRequestViewSchema.safeParse(hostile).success).toBe(false);
  });

  it("carries a drain proof for one switch and nothing else (S1c2)", () => {
    const zero = { lastAssignedSequence: 0, contiguousReceivedThrough: 0, pendingCount: 0, rollingDigest: DRAIN_STREAM_GENESIS_DIGEST };
    const proof = {
      schemaVersion: 2, typ: "gd.drain-proof.v2", canonicalCodecVersion: 2, aud: "gooddealer-cloud/drain-verification",
      proofId: "proof-1", workspaceId: "workspace-1", sourceDeviceId: "device-old", activeLeaseEpoch: 1,
      streams: [{ stream: "mutation", ...zero }, { stream: "execution_fact", ...zero }, { stream: "device_audit", ...zero }],
      digestAlgorithm: "sha256-chain-v1", issuedAt: "2026-11-17T00:00:00Z", expiresAt: "2026-11-17T00:05:00Z",
      signingKeyId: "key-old", signingKeyVersion: 1, signatureTranscriptVersion: 1, deviceSignature: "A".repeat(86),
      purpose: "handoff", deviceSwitchRequestId: "switch-1",
    };
    expect(deviceSwitchDrainRequestSchema.parse({ schemaVersion: 1, requestId: "switch-1", proof }).proof.proofId).toBe("proof-1");
    for (const hostile of [
      { schemaVersion: 1, requestId: "switch-1", proof, deviceId: "device-x" },
      { schemaVersion: 1, requestId: "switch-1", proof: { ...proof, extra: true } },
      { schemaVersion: 1, requestId: "switch-1", proof: { ...proof, streams: proof.streams.slice(0, 2) } },
      { schemaVersion: 1, requestId: "switch-1", proof: { ...proof, streams: [{ stream: "mutation", ...zero, pendingCount: 1 }, ...proof.streams.slice(1)] } },
      { schemaVersion: 1, requestId: "switch-1" },
    ]) {
      expect(deviceSwitchDrainRequestSchema.safeParse(hostile).success).toBe(false);
    }
    expect(deviceSwitchResponseSchema.parse({ schemaVersion: 1, accepted: false, code: "DRAIN_STREAMS_INCOMPLETE" }).accepted).toBe(false);
  });
});
