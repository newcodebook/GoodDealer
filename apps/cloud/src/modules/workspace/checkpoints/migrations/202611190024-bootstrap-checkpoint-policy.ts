import type { CloudMigration } from "../../../../db/index";

/** Account API deliberately exposes only the no-argument consumed-capability reader. */
export const bootstrapCheckpointPolicyMigration: CloudMigration = {
  id: "202611190024-bootstrap-checkpoint-policy",
  owner: "workspace/checkpoints",
  sql: `
ALTER POLICY workspace_checkpoint_domain_asset_tombstones_identity_capability
 ON workspace_checkpoint_domain_asset_tombstones
 USING (current_setting('gooddealer.capability_purpose',true)='devices_account'
   AND account_id=identity_private.current_transaction_account())
 WITH CHECK (current_setting('gooddealer.capability_purpose',true)='devices_account'
   AND account_id=identity_private.current_transaction_account());
`,
};
