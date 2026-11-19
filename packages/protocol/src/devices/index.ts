export const DEVICES_PROTOCOL_VERSION = 1 as const;

export {
  AUTH_ACCESS_SIGNATURE_DOMAIN,
  AUTH_REFRESH_SIGNATURE_DOMAIN,
  ACTIVE_DEVICE_LEASE_SIGNATURE_DOMAIN,
  BOOTSTRAP_CAPABILITY_SIGNATURE_DOMAIN,
  DEVICE_IDENTITY_SCHEMA_VERSION,
  activeDeviceLeaseEnvelopeSchema,
  authAccessEnvelopeSchema,
  authRefreshEnvelopeSchema,
  bootstrapCapabilityEnvelopeSchema,
  deviceBindingChallengeSchema,
  deviceProofSchema,
  encodeAuthAccessSignatureTranscript,
  encodeAuthRefreshSignatureTranscript,
  encodeActiveDeviceLeaseSignatureTranscript,
  encodeBootstrapCapabilitySignatureTranscript,
  encodeBootstrapCapabilitySignedEnvelope,
  entitlementEnvelopeSchema,
  offlineDeviceLeaseEnvelopeSchema,
  signedCredentialEnvelopeSchema,
} from "./device-identity";
export type {
  AuthAccessEnvelope,
  AuthRefreshEnvelope,
  ActiveDeviceLeaseEnvelope,
  BootstrapCapabilityEnvelope,
  DeviceBindingChallenge,
  DeviceProof,
  SignedCredentialEnvelope,
} from "./device-identity";

export {
  DEVICE_MANAGEMENT_SCHEMA_VERSION,
  DEVICE_SWITCH_REQUEST_VIEW_SCHEMA_VERSION,
  activeDeviceLeaseStatusSchema,
  cloudScopeSchema,
  deviceAuthorityProjectionSchema,
  deviceBindingListSchema,
  deviceBindingSummarySchema,
  deviceListRequestSchema,
  devicePlatformSchema,
  deviceRemovalRequestSchema,
  deviceRoleSchema,
  deviceSelfReportSchema,
  deviceSwitchDrainRequestSchema,
  deviceSwitchLookupRequestSchema,
  deviceSwitchRejectionCodeSchema,
  deviceSwitchRequestSchema,
  deviceSwitchRequestViewSchema,
  normalHandoffReceiptSchema,
  deviceSwitchResponseSchema,
} from "./device-management";
export type {
  ActiveDeviceLeaseStatus,
  CloudScope,
  DeviceAuthorityProjection,
  DeviceBindingList,
  DeviceBindingSummary,
  DeviceListRequest,
  DevicePlatform,
  DeviceRemovalRequest,
  DeviceRole,
  DeviceSelfReport,
  DeviceSwitchDrainRequest,
  DeviceSwitchLookupRequest,
  DeviceSwitchRejectionCode,
  DeviceSwitchRequest,
  DeviceSwitchRequestView,
  NormalHandoffReceipt,
  DeviceSwitchResponse,
} from "./device-management";

export { deviceOperationSchema } from "./operations";
export type { DeviceOperation } from "./operations";

export {
  BOOTSTRAP_STEP_SCHEMA_VERSION,
  bootstrapStepRequestSchema,
  bootstrapStepResultSchema,
  encodeBootstrapStepRequestDigestInput,
  encodeBootstrapStepRequestReplayIdentity,
  encodeBootstrapStepReplayRequest,
  encodeBootstrapStepResultDigestInput,
  encodeBootstrapStepResultReplayIdentity,
} from "./bootstrap-steps";
export type { BootstrapStepRequest, BootstrapStepResult } from "./bootstrap-steps";

export {
  DESKTOP_AUTHORIZATION_GRANT_OPERATION_ID,
  DESKTOP_AUTHORIZATION_GRANT_ROLE_EXCHANGE_SCHEMA_VERSION,
  DESKTOP_AUTHORIZATION_GRANT_SCHEMA_VERSION,
  DESKTOP_AUTHORIZATION_GRANT_SIGNATURE_DOMAIN,
  DESKTOP_COMMERCIAL_CAPABILITIES,
  DESKTOP_STANDBY_GRANT_MAX_LIFETIME_SECONDS,
  DESKTOP_STANDBY_GRANT_SCHEMA_VERSION,
  DESKTOP_STANDBY_GRANT_SIGNATURE_DOMAIN,
  desktopAuthorizationGrantRoleRequestSchema,
  desktopAuthorizationGrantRoleResponseSchema,
  desktopAuthorizationGrantSchema,
  desktopCommercialCapabilitySchema,
  desktopCommercialCapabilitiesSchema,
  desktopStandbyGrantSchema,
  encodeDesktopAuthorizationGrantSignatureTranscript,
  encodeDesktopStandbyGrantSignatureTranscript,
} from "./authorization-grant";
export type {
  DesktopAuthorizationGrant,
  DesktopAuthorizationGrantRoleRequest,
  DesktopAuthorizationGrantRoleResponse,
  DesktopCommercialAuthority,
  DesktopCommercialCapability,
  DesktopStandbyGrant,
} from "./authorization-grant";
