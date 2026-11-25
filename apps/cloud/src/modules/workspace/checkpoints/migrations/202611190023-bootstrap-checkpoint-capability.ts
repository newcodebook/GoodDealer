import type { CloudMigration } from "../../../../db/index";

/** The v3 table postdates Identity's original account-role privilege snapshot. */
export const bootstrapCheckpointCapabilityMigration: CloudMigration = {
  id: "202611190023-bootstrap-checkpoint-capability",
  owner: "workspace/checkpoints",
  sql: `
GRANT SELECT, INSERT ON workspace_checkpoint_domain_asset_tombstones TO gd_account_api;
CREATE POLICY workspace_checkpoint_domain_asset_tombstones_identity_capability
 ON workspace_checkpoint_domain_asset_tombstones AS RESTRICTIVE TO gd_account_api
 USING (account_id=identity_private.current_transaction_account('devices_account'::identity_private.transaction_capability_purpose))
 WITH CHECK (account_id=identity_private.current_transaction_account('devices_account'::identity_private.transaction_capability_purpose));
`,
};
