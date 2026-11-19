import type { CloudMigration } from "../../../db/index";

/** The account API has only Identity's no-selector capability projection, not its private enum. */
export const forcedIntentCapabilityPolicyMigration: CloudMigration = {
 id:"202611190029-forced-intent-capability-policy",owner:"devices",sql:`
ALTER POLICY forced_intent_target ON public.device_forced_intent_cancellations TO gd_account_api
 USING(current_setting('gooddealer.capability_purpose',true)='devices_account'
  AND account_id=identity_private.current_transaction_account()
  AND workspace_id=current_setting('gooddealer.workspace_id',true)
  AND target_device_id=identity_private.current_execution_context_device())
 WITH CHECK(current_setting('gooddealer.capability_purpose',true)='devices_account'
  AND account_id=identity_private.current_transaction_account()
  AND workspace_id=current_setting('gooddealer.workspace_id',true)
  AND target_device_id=identity_private.current_execution_context_device());
`};
