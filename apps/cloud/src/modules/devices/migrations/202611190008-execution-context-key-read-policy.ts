import type { CloudMigration } from "../../../db/index";

/** Use the account role's existing no-selector capability projection, retaining the fixed purpose. */
export const executionContextKeyReadPolicyMigration: CloudMigration = {
 id:"202611190008-execution-context-key-read-policy",owner:"devices",sql:`
ALTER POLICY execution_context_key_account ON public.device_execution_context_key_evidence TO gd_account_api
 USING(current_setting('gooddealer.capability_purpose',true)='devices_account'
 AND account_id=identity_private.current_transaction_account()
 AND workspace_id=current_setting('gooddealer.workspace_id',true));
`};
