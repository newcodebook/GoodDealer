import { z } from "zod";

export const accountOperationSchema = z.enum([
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
