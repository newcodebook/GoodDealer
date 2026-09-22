import type { CloudMigration } from "../../../../db/index";

/** Grants the account-scoped default-workspace lookup without rewriting M019. */
export const accountDefaultWorkspaceCapabilityPolicyMigration: CloudMigration = {
  id: "202609220002-account-default-workspace-capability-policy",
  owner: "workspace/default-workspace",
  sql: `
    CREATE POLICY workspace_account_bindings_default_owner_capability_select
      ON public.workspace_account_bindings
      FOR SELECT
      TO gd_account_api
      USING (
        current_setting('gooddealer.capability_purpose', true) IN ('devices_account', 'workspace_tenant')
        AND current_setting('gooddealer.account_id', true) ~ '^[!-~]{1,160}$'
        AND account_id = current_setting('gooddealer.account_id', true)
        AND owner_kind = 'account'
        AND role = 'default_owner'
        AND is_default = true
      );
  `,
};
