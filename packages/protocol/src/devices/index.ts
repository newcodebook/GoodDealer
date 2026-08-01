export const DEVICES_PROTOCOL_VERSION = 1 as const;

export {
  DEVICE_IDENTITY_SCHEMA_VERSION,
  activeDeviceLeaseEnvelopeSchema,
  bootstrapCapabilityEnvelopeSchema,
  deviceBindingChallengeSchema,
  deviceProofSchema,
  entitlementEnvelopeSchema,
  offlineDeviceLeaseEnvelopeSchema,
  signedCredentialEnvelopeSchema,
} from "./device-identity";
export type {
  DeviceBindingChallenge,
  DeviceProof,
  SignedCredentialEnvelope,
} from "./device-identity";
