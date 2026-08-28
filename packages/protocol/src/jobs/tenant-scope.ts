import { z } from "zod";

import { identifier } from "../wire/index";

export const workspaceTenantScopeSchema = z.object({
  accountId: identifier,
  workspaceId: identifier,
}).strict();

export type WorkspaceTenantScope = z.infer<typeof workspaceTenantScopeSchema>;
