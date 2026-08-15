export const EXECUTION_EVENTS_PROTOCOL_VERSION = 1 as const;

export {
  DEVICE_AUDIT_EVENT_SCHEMA_VERSION,
  deviceAuditEventSchema,
  encodeDeviceAuditEventSignatureTranscript,
} from "./device-audit";
export type { DeviceAuditEvent } from "./device-audit";

export {
  DRAIN_PROOF_DIGEST_DOMAIN,
  DRAIN_PROOF_SCHEMA_VERSION,
  DRAIN_PROOF_SIGNATURE_DOMAIN,
  drainManifestSchema,
  drainProofSchema,
  drainStreamsSchema,
  encodeDrainProofDigestInput,
  encodeDrainProofSignatureTranscript,
  synchronizedBackupDrainProofSchema,
} from "./drain-proof";
export type {
  DrainManifest,
  DrainProof,
  DrainStreamClaim,
  SynchronizedBackupDrainProof,
} from "./drain-proof";

export {
  EXECUTION_FACT_SCHEMA_VERSION,
  encodeExecutionFactSignatureTranscript,
  executionAuthorizationEvidenceSchema,
  executionFactSchema,
} from "./execution-fact";
export type { ExecutionAuthorizationEvidence, ExecutionFact } from "./execution-fact";

export {
  REDACTED_WIRE_VALUE_MAXIMUM_ARRAY_LENGTH,
  REDACTED_WIRE_VALUE_MAXIMUM_DEPTH,
  REDACTED_WIRE_VALUE_MAXIMUM_NODES,
  REDACTED_WIRE_VALUE_MAXIMUM_STRING_LENGTH,
  isRedactedWireValue,
  redactedWireValueSchema,
} from "./redacted-wire-value";
export type { RedactedWireValue } from "./redacted-wire-value";

export {
  DRAIN_CHAIN_GENESIS_INPUT,
  DRAIN_STREAMS,
  DRAIN_STREAM_GENESIS_DIGEST,
  DRAIN_STREAM_GENESIS_DOMAIN,
  drainSequenceDomainSchema,
  drainStreamSchema,
  encodeAccountDeviceAuditChainDomain,
  encodeDrainChainStepInput,
  encodeDrainSequenceDomain,
  encodeDrainStreamEnvelope,
  encodeWorkspaceDeviceAuditChainDomain,
} from "./streams";
export type { DrainSequenceDomain, DrainStream } from "./streams";
