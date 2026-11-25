import type { CloudMigration } from "../../../db/index";

/** Cancelling an unknown original POST must win durably against a later arrival of those bytes. */
export const forcedIntentCancellationMigration: CloudMigration = {
 id:"202611190028-forced-intent-cancellation",owner:"devices",sql:`
CREATE TABLE public.device_forced_intent_cancellations (
 account_id text NOT NULL REFERENCES public.device_account_states(account_id) ON DELETE CASCADE,
 workspace_id text NOT NULL,target_device_id text NOT NULL,idempotency_key text NOT NULL,
 request_digest bytea NOT NULL CHECK(octet_length(request_digest)=32),
 source_lease_epoch bigint NOT NULL CHECK(source_lease_epoch BETWEEN 1 AND 9007199254740991),
 account_security_epoch bigint NOT NULL CHECK(account_security_epoch BETWEEN 1 AND 9007199254740991),
 key_id text NOT NULL,key_version bigint NOT NULL CHECK(key_version BETWEEN 1 AND 9007199254740991),
 cancelled_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(account_id,idempotency_key)
);
ALTER TABLE public.device_forced_intent_cancellations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_forced_intent_cancellations FORCE ROW LEVEL SECURITY;
CREATE POLICY forced_intent_owner ON public.device_forced_intent_cancellations TO gooddealer_cloud_owner USING(true) WITH CHECK(true);
CREATE POLICY forced_intent_target ON public.device_forced_intent_cancellations TO gd_account_api
 USING(account_id=identity_private.current_transaction_account('devices_account'::identity_private.transaction_capability_purpose)
  AND workspace_id=current_setting('gooddealer.workspace_id',true)
  AND target_device_id=identity_private.current_execution_context_device())
 WITH CHECK(account_id=identity_private.current_transaction_account('devices_account'::identity_private.transaction_capability_purpose)
  AND workspace_id=current_setting('gooddealer.workspace_id',true)
  AND target_device_id=identity_private.current_execution_context_device());
REVOKE ALL ON public.device_forced_intent_cancellations FROM PUBLIC,gooddealer_cloud_app,gd_account_api;
GRANT SELECT,INSERT ON public.device_forced_intent_cancellations TO gd_account_api;
`};
