import { ACCOUNT_PROTOCOL_VERSION } from "@gooddealer/protocol/account";

export { BillingClient } from "@gooddealer/cloud-client";
export {
  AccountBillingCancellationController,
  AccountBillingRecoveryController,
  AccountBillingRefundController,
  type BillingApprovalNavigator,
  type BillingCancellationRecoveryResult,
  type BillingCancellationRecoveryStore,
  type BillingCheckoutRecoveryRecord,
  type BillingCheckoutRecoveryStore,
  type BillingRecoveryResult,
  type BillingRefundRecoveryRecord,
  type BillingRefundRecoveryResult,
  type BillingRefundRecoveryStore,
} from "./billing-recovery-controller";

export const accountWebBoundary = { protocolVersion: ACCOUNT_PROTOCOL_VERSION } as const;
