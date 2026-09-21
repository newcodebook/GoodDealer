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
  BILLING_CHECKOUT_CREATE_OPERATION_ID,
  BILLING_FIXED_TERM_CONFIRM_OPERATION_ID,
  BILLING_FIRST_PURCHASE_REFUND_REQUEST_OPERATION_ID,
  BILLING_FIRST_PURCHASE_REFUND_STATUS_READ_OPERATION_ID,
  BILLING_SCHEMA_VERSION,
  BILLING_STATUS_READ_OPERATION_ID,
  BILLING_SUBSCRIPTION_CANCEL_OPERATION_ID,
  billingApprovalSchema,
  billingCheckoutCreateRequestSchema,
  billingCheckoutCreateResponseSchema,
  billingFixedTermConfirmRequestSchema,
  billingFixedTermConfirmResponseSchema,
  billingFirstPurchaseRefundAcceptedResponseSchema,
  billingFirstPurchaseRefundRejectionReasonSchema,
  billingFirstPurchaseRefundRequestResponseSchema,
  billingFirstPurchaseRefundRequestSchema,
  billingFirstPurchaseRefundStatusReadRequestSchema,
  billingFirstPurchaseRefundStatusReadResponseSchema,
  billingProviderSchema,
  billingStatusReadRequestSchema,
  billingStatusReadResponseSchema,
  billingSubscriptionCancelRequestSchema,
  billingSubscriptionCancelResponseSchema,
  commercialOfferSchema,
} from "./billing";
export type {
  BillingApproval,
  BillingCheckoutCreateRequest,
  BillingCheckoutCreateResponse,
  BillingFixedTermConfirmRequest,
  BillingFixedTermConfirmResponse,
  BillingFirstPurchaseRefundAcceptedResponse,
  BillingFirstPurchaseRefundRejectionReason,
  BillingFirstPurchaseRefundRequest,
  BillingFirstPurchaseRefundRequestResponse,
  BillingFirstPurchaseRefundStatusReadRequest,
  BillingFirstPurchaseRefundStatusReadResponse,
  BillingProvider,
  BillingStatusReadResponse,
  BillingSubscriptionCancelRequest,
  BillingSubscriptionCancelResponse,
  CommercialOffer,
} from "./billing";

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
  versionEntitlementSchema,
} from "./entitlement-projection";
export type { EntitlementProjection, EntitlementState, VersionEntitlement } from "./entitlement-projection";

export {
  AUTHORITATIVE_ENTITLEMENT_SNAPSHOT_DIGEST_DOMAIN,
  authoritativeEntitlementSnapshotDigest,
  authoritativeEntitlementSnapshotSchema,
  encodeAuthoritativeEntitlementSnapshotDigestInput,
} from "./authoritative-entitlement-snapshot";
export type { AuthoritativeEntitlementSnapshot } from "./authoritative-entitlement-snapshot";

export {
  ACCOUNT_GATE_SCHEMA_VERSION,
  accountAccessModeSchema,
  accountGateCheckSchema,
  accountGateStatusSchema,
  accountRestrictionReasonSchema,
  accountSecurityStateSchema,
  localAccessCapabilitySchema,
} from "./account-gate";
export type {
  AccountAccessMode,
  AccountGateCheck,
  AccountGateStatus,
  AccountRestrictionReason,
  AccountSecurityState,
  LocalAccessCapability,
} from "./account-gate";

export {
  ACCOUNT_REJECTION_SCHEMA_VERSION,
  accountRejectionCodeSchema,
  accountRejectionSchema,
} from "./errors";
export type { AccountRejection, AccountRejectionCode } from "./errors";

export { accountOperationSchema } from "./operations";
export type { AccountOperation } from "./operations";
