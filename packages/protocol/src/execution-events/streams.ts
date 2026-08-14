import { z } from "zod";

import type { SubmittedSyncMutation, SyncMutation } from "../workspace/index";
import { submittedSyncMutationSchema, syncMutationSchema } from "../workspace/index";
import {
  encodeDomainSeparatedWireValue,
  identifier,
  safePositiveInteger,
} from "../wire/index";
import type { DeviceAuditEvent } from "./device-audit";
import {
  deviceAuditEventSchema,
  encodeDeviceAuditEventSignatureTranscript,
} from "./device-audit";
import type { ExecutionFact } from "./execution-fact";
import { encodeExecutionFactSignatureTranscript, executionFactSchema } from "./execution-fact";

const encoder = new TextEncoder();

export const DRAIN_STREAMS = ["mutation", "execution_fact", "device_audit"] as const;
export const drainStreamSchema = z.enum(DRAIN_STREAMS);
export type DrainStream = (typeof DRAIN_STREAMS)[number];

export const drainSequenceDomainSchema = z
  .object({
    workspaceId: identifier,
    sourceDeviceId: identifier,
    activeLeaseEpoch: safePositiveInteger,
    stream: drainStreamSchema,
  })
  .strict();

export interface DrainSequenceDomain {
  readonly workspaceId: string;
  readonly sourceDeviceId: string;
  readonly activeLeaseEpoch: number;
  readonly stream: DrainStream;
}

export function encodeDrainSequenceDomain(domain: DrainSequenceDomain): Uint8Array {
  return encodeDomainSeparatedWireValue(
    "GOODDEALER-DRAIN-SEQUENCE-DOMAIN-V1",
    drainSequenceDomainSchema.parse(domain),
  );
}

const workspaceDeviceAuditChainDomainSchema = z
  .object({
    workspaceId: identifier,
    sourceDeviceId: identifier,
    activeLeaseEpoch: safePositiveInteger,
  })
  .strict();

const accountDeviceAuditChainDomainSchema = z
  .object({
    accountId: identifier,
    sourceDeviceId: identifier,
    credentialEpoch: safePositiveInteger,
  })
  .strict();

export function encodeWorkspaceDeviceAuditChainDomain(input: {
  readonly workspaceId: string;
  readonly sourceDeviceId: string;
  readonly activeLeaseEpoch: number;
}): Uint8Array {
  return encodeDomainSeparatedWireValue("GOODDEALER-DEVICE-AUDIT-CHAIN-V1", {
    scope: "workspace",
    ...workspaceDeviceAuditChainDomainSchema.parse(input),
  });
}

export function encodeAccountDeviceAuditChainDomain(input: {
  readonly accountId: string;
  readonly sourceDeviceId: string;
  readonly credentialEpoch: number;
}): Uint8Array {
  return encodeDomainSeparatedWireValue("GOODDEALER-DEVICE-AUDIT-CHAIN-V1", {
    scope: "account",
    ...accountDeviceAuditChainDomainSchema.parse(input),
  });
}

export const DRAIN_STREAM_GENESIS_DOMAIN = "GOODDEALER-DRAIN-SHA256-V1" as const;
export const DRAIN_STREAM_GENESIS_DIGEST =
  "58It6o62GZGmXgy6-ER1rezwYX-LCZVJzlZuZOGcWUs" as const;
export const DRAIN_CHAIN_GENESIS_INPUT = encoder.encode(DRAIN_STREAM_GENESIS_DOMAIN);

function encodeUint32(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new RangeError("byte length must fit an unsigned 32-bit integer");
  }
  const encoded = new Uint8Array(4);
  new DataView(encoded.buffer).setUint32(0, value, false);
  return encoded;
}

export function concatenateDrainBytes(parts: readonly Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.byteLength, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

export function encodeLengthPrefixedDrainBytes(value: Uint8Array): Uint8Array {
  return concatenateDrainBytes([encodeUint32(value.byteLength), value]);
}

export function encodeDrainChainStepInput(
  previousDigest: Uint8Array,
  envelope: Uint8Array,
): Uint8Array {
  if (previousDigest.byteLength !== 32) {
    throw new TypeError("previous drain digest must contain exactly 32 bytes");
  }
  return concatenateDrainBytes([previousDigest, encodeLengthPrefixedDrainBytes(envelope)]);
}

function submittedMutation(record: SubmittedSyncMutation | SyncMutation): SubmittedSyncMutation {
  const submitted = submittedSyncMutationSchema.safeParse(record);
  if (submitted.success) return submitted.data;
  const enriched = syncMutationSchema.parse(record);
  const { serverRevision: _serverRevision, ...deviceCommitted } = enriched;
  return submittedSyncMutationSchema.parse(deviceCommitted);
}

function executionFactWithoutServerEnrichment(record: ExecutionFact): ExecutionFact {
  if (typeof record !== "object" || record === null || Array.isArray(record)) {
    return executionFactSchema.parse(record);
  }
  const copy = { ...(record as unknown as Record<string, unknown>) };
  delete copy.receivedAt;
  delete copy.classification;
  delete copy.quarantineState;
  return executionFactSchema.parse(copy);
}

export function encodeDrainStreamEnvelope(
  stream: "mutation",
  record: SubmittedSyncMutation | SyncMutation,
): Uint8Array;
export function encodeDrainStreamEnvelope(stream: "execution_fact", record: ExecutionFact): Uint8Array;
export function encodeDrainStreamEnvelope(stream: "device_audit", record: DeviceAuditEvent): Uint8Array;
export function encodeDrainStreamEnvelope(
  stream: DrainStream,
  record: SubmittedSyncMutation | SyncMutation | ExecutionFact | DeviceAuditEvent,
): Uint8Array {
  if (stream === "mutation") {
    return encodeDomainSeparatedWireValue(
      "GOODDEALER-SYNC-MUTATION-SUBMITTED-V1",
      submittedMutation(record as SubmittedSyncMutation | SyncMutation),
    );
  }
  if (stream === "execution_fact") {
    const parsed = executionFactWithoutServerEnrichment(record as ExecutionFact);
    return concatenateDrainBytes([
      encodeExecutionFactSignatureTranscript(parsed),
      encodeLengthPrefixedDrainBytes(encoder.encode(parsed.deviceSignature)),
    ]);
  }
  const parsed = deviceAuditEventSchema.parse(record);
  return concatenateDrainBytes([
    encodeDeviceAuditEventSignatureTranscript(parsed),
    encodeLengthPrefixedDrainBytes(encoder.encode(parsed.deviceSignature)),
  ]);
}
