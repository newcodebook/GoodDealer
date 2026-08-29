export const ACCOUNT_PROTOCOL_VERSION = 1 as const;

export {
  ACCOUNT_ACTIVATION_OPERATION_ID,
  ACCOUNT_ACTIVATION_SCHEMA_VERSION,
  accountActivationRequestSchema,
  accountActivationResponseSchema,
} from "./activation";
export type {
  AccountActivationRequest,
  AccountActivationResponse,
} from "./activation";

export {
  AUTH_SESSION_SCHEMA_VERSION,
  authLoginRequestSchema,
  authRefreshRequestSchema,
  authRevocationReasonSchema,
  authSessionStateSchema,
  authSessionStatusSchema,
  authSignOutRequestSchema,
  reauthProofRefSchema,
} from "./auth-session";
export type {
  AuthLoginRequest,
  AuthRefreshRequest,
  AuthRevocationReason,
  AuthSessionState,
  AuthSessionStatus,
  AuthSignOutRequest,
  ReauthProofRef,
} from "./auth-session";

export {
  ACCOUNT_SESSION_SCHEMA_VERSION,
  accountSessionClientKindSchema,
  accountSessionListSchema,
  accountSessionRevokeRequestSchema,
  accountSessionSummarySchema,
} from "./account-sessions";
export type {
  AccountSessionClientKind,
  AccountSessionList,
  AccountSessionRevokeRequest,
  AccountSessionSummary,
} from "./account-sessions";

export {
  ENTITLEMENT_PROJECTION_SCHEMA_VERSION,
  entitlementProjectionSchema,
  entitlementStateSchema,
} from "./entitlement-projection";
export type { EntitlementProjection, EntitlementState } from "./entitlement-projection";

export {
  ACCOUNT_GATE_SCHEMA_VERSION,
  accountGateCheckSchema,
  accountGateStatusSchema,
  accountLockReasonSchema,
  accountSecurityStateSchema,
} from "./account-gate";
export type { AccountGateCheck, AccountGateStatus, AccountLockReason, AccountSecurityState } from "./account-gate";

export {
  ACCOUNT_REJECTION_SCHEMA_VERSION,
  accountRejectionCodeSchema,
  accountRejectionSchema,
} from "./errors";
export type { AccountRejection, AccountRejectionCode } from "./errors";

export { accountOperationSchema } from "./operations";
export type { AccountOperation } from "./operations";
