import { z } from "zod";

import { ACCOUNT_ACTIVATION_OPERATION_ID } from "./activation";

export const accountOperationSchema = z.enum([
  ACCOUNT_ACTIVATION_OPERATION_ID,
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
