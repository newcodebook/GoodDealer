import { describe, expect, it } from "vitest";

import { DRAIN_STREAM_GENESIS_DIGEST } from "../src/execution-events/index";
import { deviceSwitchDrainRequestSchema, deviceSwitchLookupRequestSchema, deviceSwitchResponseSchema } from "../src/devices/index";

const request = {
  schemaVersion: 1, requestId: "switch-1", mode: "normal", status: "draining", fromDeviceId: "device-old",
  toDeviceId: "device-new", requestedAt: "2026-11-17T00:00:00Z", earliestTakeoverAt: null, bootstrapExpiresAt: null,
} as const;

describe("device switch transport (ADR-0032 S1b)", () => {
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
