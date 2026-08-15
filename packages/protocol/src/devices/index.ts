export const DEVICES_PROTOCOL_VERSION = 1 as const;

export {
  AUTH_ACCESS_SIGNATURE_DOMAIN,
  AUTH_REFRESH_SIGNATURE_DOMAIN,
  DEVICE_IDENTITY_SCHEMA_VERSION,
  activeDeviceLeaseEnvelopeSchema,
  authAccessEnvelopeSchema,
  authRefreshEnvelopeSchema,
  bootstrapCapabilityEnvelopeSchema,
  deviceBindingChallengeSchema,
  deviceProofSchema,
  encodeAuthAccessSignatureTranscript,
  encodeAuthRefreshSignatureTranscript,
  entitlementEnvelopeSchema,
  offlineDeviceLeaseEnvelopeSchema,
  signedCredentialEnvelopeSchema,
} from "./device-identity";
export type {
  AuthAccessEnvelope,
  AuthRefreshEnvelope,
  DeviceBindingChallenge,
  DeviceProof,
  SignedCredentialEnvelope,
} from "./device-identity";

export {
  RUNTIME_STATUS_SCHEMA_VERSION,
  runtimeStatusSchema,
} from "./runtime-status";
export type { RuntimeStatus } from "./runtime-status";

export {
  DEVICE_MANAGEMENT_SCHEMA_VERSION,
  activeDeviceLeaseStatusSchema,
  cloudScopeSchema,
  deviceAuthorityProjectionSchema,
  deviceBindingListSchema,
  deviceBindingSummarySchema,
  devicePlatformSchema,
  deviceRemovalRequestSchema,
  deviceRoleSchema,
  deviceSwitchRequestSchema,
  deviceSwitchRequestViewSchema,
} from "./device-management";
export type {
  ActiveDeviceLeaseStatus,
  CloudScope,
  DeviceAuthorityProjection,
  DeviceBindingList,
  DeviceBindingSummary,
  DevicePlatform,
  DeviceRemovalRequest,
  DeviceRole,
  DeviceSwitchRequest,
  DeviceSwitchRequestView,
} from "./device-management";

export { deviceOperationSchema } from "./operations";
export type { DeviceOperation } from "./operations";

export {
  BOOTSTRAP_STEP_SCHEMA_VERSION,
  bootstrapStepRequestSchema,
  bootstrapStepResultSchema,
  encodeBootstrapStepRequestDigestInput,
  encodeBootstrapStepResultDigestInput,
} from "./bootstrap-steps";
export type { BootstrapStepRequest, BootstrapStepResult } from "./bootstrap-steps";
