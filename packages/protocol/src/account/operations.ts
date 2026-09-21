import { z } from "zod";

import { ACCOUNT_ACTIVATION_OPERATION_ID } from "./activation";
import {
  BILLING_CHECKOUT_CREATE_OPERATION_ID,
  BILLING_FIXED_TERM_CONFIRM_OPERATION_ID,
  BILLING_FIRST_PURCHASE_REFUND_REQUEST_OPERATION_ID,
  BILLING_FIRST_PURCHASE_REFUND_STATUS_READ_OPERATION_ID,
  BILLING_STATUS_READ_OPERATION_ID,
  BILLING_SUBSCRIPTION_CANCEL_OPERATION_ID,
} from "./billing";

export const accountOperationSchema = z.enum([
  ACCOUNT_ACTIVATION_OPERATION_ID,
  BILLING_CHECKOUT_CREATE_OPERATION_ID,
  BILLING_FIXED_TERM_CONFIRM_OPERATION_ID,
  BILLING_FIRST_PURCHASE_REFUND_REQUEST_OPERATION_ID,
  BILLING_FIRST_PURCHASE_REFUND_STATUS_READ_OPERATION_ID,
  BILLING_STATUS_READ_OPERATION_ID,
  BILLING_SUBSCRIPTION_CANCEL_OPERATION_ID,
  "account.session.login",
  "account.session.refresh",
  "account.session.signOut",
  "account.session.status",
  "account.sessions.list",
  "account.sessions.revoke",
  "account.entitlement.status",
  "account.gate.status",
]);

export type AccountOperation = z.infer<typeof accountOperationSchema>;
