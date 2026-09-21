import type { CloudMigration } from "../../../db/index";

/** Greenfield Licensing baseline. M015 owns every commercial object and capability façade. */
export const commercialEntitlementsMigration: CloudMigration = {
  id: "202608200015-commercial-entitlements",
  owner: "licensing",
  sql: `
    DO $roles$
    DECLARE role_name text; role_row record;
    BEGIN
      FOREACH role_name IN ARRAY ARRAY[
        'gd_licensing_owner','gd_licensing_command_definer','gd_licensing_worker_definer',
        'gd_licensing_ingress_definer','gd_account_api','gd_provider_worker','gd_provider_ingress'
      ] LOOP
        SELECT rolcanlogin, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb INTO role_row
          FROM pg_catalog.pg_roles WHERE rolname = role_name;
        IF NOT FOUND THEN RAISE EXCEPTION 'required externally provisioned role is missing: %', role_name; END IF;
        IF role_row.rolsuper OR role_row.rolbypassrls OR role_row.rolcreaterole OR role_row.rolcreatedb THEN
          RAISE EXCEPTION 'Licensing role is over-privileged: %', role_name;
        END IF;
        IF role_name LIKE '%owner' OR role_name LIKE '%definer' THEN
          IF role_row.rolcanlogin THEN RAISE EXCEPTION 'Licensing owner/definer must be NOLOGIN: %', role_name; END IF;
        ELSIF NOT role_row.rolcanlogin THEN RAISE EXCEPTION 'Licensing runtime must be LOGIN-capable: %', role_name;
        END IF;
      END LOOP;
      IF NOT pg_catalog.pg_has_role(current_user,'gd_licensing_owner','MEMBER')
         OR NOT pg_catalog.pg_has_role(current_user,'gd_licensing_command_definer','MEMBER')
         OR NOT pg_catalog.pg_has_role(current_user,'gd_licensing_worker_definer','MEMBER')
         OR NOT pg_catalog.pg_has_role(current_user,'gd_licensing_ingress_definer','MEMBER') THEN
        RAISE EXCEPTION 'migration role lacks exact Licensing ownership memberships';
      END IF;
      IF pg_catalog.pg_has_role('gd_account_api','gd_licensing_command_definer','MEMBER')
         OR pg_catalog.pg_has_role('gd_provider_worker','gd_licensing_worker_definer','MEMBER')
         OR pg_catalog.pg_has_role('gd_provider_ingress','gd_licensing_ingress_definer','MEMBER') THEN
        RAISE EXCEPTION 'Licensing runtime role crosses its definer trust boundary';
      END IF;
    END $roles$;

    CREATE SCHEMA licensing_private;
    CREATE SCHEMA licensing_api;
    CREATE SCHEMA licensing_worker_api;
    CREATE SCHEMA licensing_ingress_api;
    REVOKE ALL ON SCHEMA licensing_private, licensing_api, licensing_worker_api, licensing_ingress_api FROM PUBLIC;
    GRANT USAGE ON SCHEMA licensing_api TO gd_account_api;
    GRANT USAGE ON SCHEMA licensing_worker_api TO gd_provider_worker;
    GRANT USAGE ON SCHEMA licensing_ingress_api TO gd_provider_ingress;
    GRANT USAGE,CREATE ON SCHEMA licensing_api TO gd_licensing_command_definer;
    GRANT USAGE,CREATE ON SCHEMA licensing_worker_api TO gd_licensing_worker_definer;
    GRANT USAGE,CREATE ON SCHEMA licensing_ingress_api TO gd_licensing_ingress_definer;
    GRANT USAGE,CREATE ON SCHEMA licensing_private TO gd_licensing_owner,gd_licensing_worker_definer;

    CREATE TYPE licensing_private.commercial_provider AS ENUM ('stripe','paypal');
    CREATE TYPE licensing_private.purchase_kind AS ENUM ('subscription','fixed_term');
    CREATE TYPE licensing_private.operation_kind AS ENUM ('subscription_create','fixed_term_checkout_create',
      'fixed_term_order_create','fixed_term_order_capture','subscription_cancel','subscription_refund_terminate','first_purchase_refund');
    CREATE TYPE licensing_private.operation_state AS ENUM ('planned','permit_issued','dispatch_consumed',
      'confirmed','rejected','outcome_unknown','manual_resolution');
    CREATE TYPE licensing_private.job_kind AS ENUM ('provider_operation','receipt','reconciliation','due_authority','release');
    CREATE TYPE licensing_private.job_state AS ENUM ('ready','leased','retry_wait','succeeded','ignored','quarantined','dead_letter');

    CREATE TABLE licensing_private.purchase_attempts (
      account_id text NOT NULL REFERENCES public.identity_accounts(account_id), purchase_attempt_id uuid NOT NULL,
      request_id text NOT NULL CHECK (request_id ~ '^[!-~]{1,160}$'), request_digest bytea NOT NULL CHECK(octet_length(request_digest)=32),
      provider licensing_private.commercial_provider NOT NULL, purchase_kind licensing_private.purchase_kind NOT NULL,
      offer text NOT NULL CHECK(offer IN ('monthly','annual','ten_year')), provider_catalog_item text NOT NULL,
      campaign_code text, expected_gross_minor bigint NOT NULL CHECK(expected_gross_minor>0),
      expected_currency text NOT NULL CHECK(expected_currency='USD'),
      state text NOT NULL CHECK(state IN ('reserved','creating','creation_unknown','approval_pending',
        'agreement_bound','rejected','expired_unpaid','manual_resolution')), created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
      PRIMARY KEY(account_id,purchase_attempt_id), UNIQUE(account_id,request_id),
      CHECK((purchase_kind='fixed_term' AND offer='ten_year') OR (purchase_kind='subscription' AND offer IN ('monthly','annual')))
    );
    CREATE TABLE licensing_private.binding_claims (
      binding_claim_id uuid PRIMARY KEY, account_id text NOT NULL, purchase_attempt_id uuid NOT NULL,
      claim_digest bytea NOT NULL CHECK(octet_length(claim_digest)=32), UNIQUE(account_id,purchase_attempt_id,binding_claim_id),
      FOREIGN KEY(account_id,purchase_attempt_id) REFERENCES licensing_private.purchase_attempts(account_id,purchase_attempt_id)
    );
    CREATE TABLE licensing_private.provider_operations (
      account_id text NOT NULL, provider_operation_id uuid NOT NULL, operation_revision bigint NOT NULL DEFAULT 1 CHECK(operation_revision>0),
      purchase_attempt_id uuid NOT NULL, provider_agreement_id uuid, slot_ownership_id uuid NOT NULL,
      provider licensing_private.commercial_provider NOT NULL, operation_kind licensing_private.operation_kind NOT NULL,
      provider_idempotency_key text NOT NULL, request_digest bytea NOT NULL CHECK(octet_length(request_digest)=32),
      state licensing_private.operation_state NOT NULL DEFAULT 'planned', result_digest bytea CHECK(result_digest IS NULL OR octet_length(result_digest)=32),
      created_at timestamptz NOT NULL DEFAULT transaction_timestamp(), updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
      PRIMARY KEY(account_id,provider_operation_id), UNIQUE(provider,provider_idempotency_key),
      FOREIGN KEY(account_id,purchase_attempt_id) REFERENCES licensing_private.purchase_attempts(account_id,purchase_attempt_id)
    );
    CREATE TABLE licensing_private.commercial_provider_slot_versions (
      account_id text NOT NULL, slot_epoch bigint NOT NULL CHECK(slot_epoch>0), slot_ownership_id uuid,
      state text NOT NULL CHECK(state IN ('vacant','attempt_held','agreement_held')),
      release_status text NOT NULL CHECK(release_status IN ('not_requested','pending_provider_confirmation','pending_paid_through','manual_resolution','eligible')),
      holder_attempt_id uuid, holder_agreement_id uuid, current_provider_operation_id uuid,
      committed_at timestamptz NOT NULL DEFAULT transaction_timestamp(), PRIMARY KEY(account_id,slot_epoch)
    );
    CREATE TABLE licensing_private.commercial_provider_slots (
      account_id text PRIMARY KEY REFERENCES public.identity_accounts(account_id), slot_epoch bigint NOT NULL CHECK(slot_epoch>0),
      slot_ownership_id uuid, state text NOT NULL CHECK(state IN ('vacant','attempt_held','agreement_held')),
      release_status text NOT NULL, holder_attempt_id uuid, holder_agreement_id uuid, current_provider_operation_id uuid,
      FOREIGN KEY(account_id,slot_epoch) REFERENCES licensing_private.commercial_provider_slot_versions(account_id,slot_epoch),
      CHECK((state='vacant' AND slot_ownership_id IS NULL AND holder_attempt_id IS NULL AND holder_agreement_id IS NULL)
         OR (state='attempt_held' AND slot_ownership_id IS NOT NULL AND holder_attempt_id IS NOT NULL AND holder_agreement_id IS NULL)
         OR (state='agreement_held' AND slot_ownership_id IS NOT NULL AND holder_attempt_id IS NULL AND holder_agreement_id IS NOT NULL))
    );
    CREATE TABLE licensing_private.provider_operation_work (
      work_id uuid PRIMARY KEY, account_id text NOT NULL, provider_operation_id uuid NOT NULL,
      state licensing_private.job_state NOT NULL DEFAULT 'ready', lease_epoch bigint NOT NULL DEFAULT 0 CHECK(lease_epoch>=0),
      lease_owner text, lease_expires_at timestamptz, token_digest bytea CHECK(token_digest IS NULL OR octet_length(token_digest)=32),
      attempt_count integer NOT NULL DEFAULT 0, max_attempts integer NOT NULL DEFAULT 12, next_attempt_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
      first_attempt_at timestamptz, last_attempt_at timestamptz, dead_letter_at timestamptz, parent_work_id uuid,
      redrive_reason text CHECK(redrive_reason IS NULL OR redrive_reason ~ '^[!-~][ -~]{0,159}$'),
      FOREIGN KEY(account_id,provider_operation_id) REFERENCES licensing_private.provider_operations(account_id,provider_operation_id),
      FOREIGN KEY(parent_work_id) REFERENCES licensing_private.provider_operation_work(work_id),
      CHECK((state='leased')=(lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL AND token_digest IS NOT NULL))
    );
    CREATE TABLE licensing_private.provider_dispatch_permits (
      dispatch_permit_id uuid PRIMARY KEY, work_id uuid NOT NULL REFERENCES licensing_private.provider_operation_work(work_id),
      provider_operation_id uuid NOT NULL, operation_revision bigint NOT NULL, operation_kind licensing_private.operation_kind NOT NULL,
      dispatch_attempt integer NOT NULL CHECK(dispatch_attempt>0), state text NOT NULL CHECK(state IN ('issued','consumed','expired','revoked')),
      issued_at timestamptz NOT NULL DEFAULT transaction_timestamp(), expires_at timestamptz NOT NULL, consumed_at timestamptz,
      CHECK(issued_at<expires_at AND expires_at<=issued_at+interval '60 seconds'), CHECK((state='consumed')=(consumed_at IS NOT NULL))
    );
    CREATE TABLE licensing_private.provider_operation_results (
      dispatch_permit_id uuid PRIMARY KEY REFERENCES licensing_private.provider_dispatch_permits(dispatch_permit_id),
      outcome licensing_private.operation_state NOT NULL CHECK(outcome IN ('confirmed','rejected','outcome_unknown','manual_resolution')),
      response_digest bytea NOT NULL CHECK(octet_length(response_digest)=32), resource_kinds text[] NOT NULL,
      resource_ids text[] NOT NULL, resource_digests bytea[] NOT NULL, resource_roles text[] NOT NULL,
      recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
      CHECK(cardinality(resource_kinds)=cardinality(resource_ids)
        AND cardinality(resource_ids)=cardinality(resource_digests)
        AND cardinality(resource_digests)=cardinality(resource_roles))
    );
    CREATE TABLE licensing_private.provider_resource_bindings (
      provider licensing_private.commercial_provider NOT NULL, resource_kind text NOT NULL, resource_id text NOT NULL,
      binding_claim_id uuid NOT NULL REFERENCES licensing_private.binding_claims(binding_claim_id), account_id text NOT NULL,
      purchase_attempt_id uuid NOT NULL, creating_operation_id uuid NOT NULL, binding_digest bytea NOT NULL CHECK(octet_length(binding_digest)=32),
      bound_at timestamptz NOT NULL DEFAULT transaction_timestamp(), PRIMARY KEY(provider,resource_kind,resource_id),
      FOREIGN KEY(account_id,purchase_attempt_id,binding_claim_id) REFERENCES licensing_private.binding_claims(account_id,purchase_attempt_id,binding_claim_id)
    );
    CREATE TABLE licensing_private.provider_operation_resource_evidence (
      account_id text NOT NULL, provider_operation_id uuid NOT NULL, provider licensing_private.commercial_provider NOT NULL,
      resource_kind text NOT NULL, resource_id text NOT NULL, evidence_digest bytea NOT NULL CHECK(octet_length(evidence_digest)=32),
      role text NOT NULL CHECK(role IN ('created','target','capture_evidence')), PRIMARY KEY(account_id,provider_operation_id,provider,resource_kind,resource_id,role),
      FOREIGN KEY(provider,resource_kind,resource_id) REFERENCES licensing_private.provider_resource_bindings(provider,resource_kind,resource_id)
    );
    CREATE TABLE licensing_private.provider_agreements (
      account_id text NOT NULL, provider_agreement_id uuid NOT NULL, purchase_attempt_id uuid NOT NULL,
      provider licensing_private.commercial_provider NOT NULL, purchase_kind licensing_private.purchase_kind NOT NULL,
      canonical_provider licensing_private.commercial_provider NOT NULL, canonical_resource_kind text NOT NULL, canonical_resource_id text NOT NULL,
      state text NOT NULL CHECK(state IN ('pending','active','delinquent_grace','suspended','nonrenewing','ended','refunded')),
      agreement_revision bigint NOT NULL DEFAULT 1, latest_applied_generation bigint NOT NULL DEFAULT 0,
      provider_access text NOT NULL DEFAULT 'pending', renewal_disposition text NOT NULL DEFAULT 'unknown',
      protected_paid_through timestamptz, current_observation_id uuid, created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
      handoff_digest bytea NOT NULL CHECK(octet_length(handoff_digest)=32), handoff_captured_at timestamptz,
      PRIMARY KEY(account_id,provider_agreement_id), UNIQUE(canonical_provider,canonical_resource_kind,canonical_resource_id),
      FOREIGN KEY(canonical_provider,canonical_resource_kind,canonical_resource_id)
        REFERENCES licensing_private.provider_resource_bindings(provider,resource_kind,resource_id)
    );
    CREATE TABLE licensing_private.agreement_resource_links (
      account_id text NOT NULL, provider_agreement_id uuid NOT NULL, provider licensing_private.commercial_provider NOT NULL,
      resource_kind text NOT NULL, resource_id text NOT NULL,
      role text NOT NULL CHECK(role IN ('canonical_agreement','checkout_origin','order_origin','capture_evidence','initial_payment','refund_evidence','reversal_evidence')),
      link_digest bytea NOT NULL CHECK(octet_length(link_digest)=32), PRIMARY KEY(account_id,provider_agreement_id,provider,resource_kind,resource_id,role),
      UNIQUE(provider,resource_kind,resource_id),
      FOREIGN KEY(account_id,provider_agreement_id) REFERENCES licensing_private.provider_agreements(account_id,provider_agreement_id),
      FOREIGN KEY(provider,resource_kind,resource_id) REFERENCES licensing_private.provider_resource_bindings(provider,resource_kind,resource_id)
    );
    CREATE TABLE licensing_private.commercial_payment_evidence (
      payment_evidence_id uuid PRIMARY KEY, account_id text NOT NULL, purchase_attempt_id uuid NOT NULL,
      provider_agreement_id uuid NOT NULL, provider licensing_private.commercial_provider NOT NULL,
      resource_kind text NOT NULL CHECK(resource_kind IN ('invoice','payment_intent','charge','subscription_transaction','sale','capture')),
      resource_id text NOT NULL, purpose text NOT NULL CHECK(purpose IN ('acquisition_initial','renewal','adjustment')),
      settled_at timestamptz NOT NULL, gross_minor bigint NOT NULL CHECK(gross_minor>0), currency text NOT NULL CHECK(currency='USD'),
      cumulative_refunded_minor bigint NOT NULL DEFAULT 0 CHECK(cumulative_refunded_minor>=0 AND cumulative_refunded_minor<=gross_minor),
      source_digest bytea NOT NULL CHECK(octet_length(source_digest)=32), observation_generation bigint NOT NULL CHECK(observation_generation>0),
      created_at timestamptz NOT NULL DEFAULT transaction_timestamp(), UNIQUE(provider,resource_kind,resource_id),
      FOREIGN KEY(account_id,provider_agreement_id) REFERENCES licensing_private.provider_agreements(account_id,provider_agreement_id),
      FOREIGN KEY(provider,resource_kind,resource_id) REFERENCES licensing_private.provider_resource_bindings(provider,resource_kind,resource_id)
    );
    CREATE TABLE licensing_private.first_paid_purchase_eligibilities (
      account_id text PRIMARY KEY REFERENCES public.identity_accounts(account_id), first_payment_evidence_id uuid NOT NULL UNIQUE,
      purchase_attempt_id uuid NOT NULL, provider_agreement_id uuid NOT NULL, purchase_kind licensing_private.purchase_kind NOT NULL,
      window_starts_at timestamptz NOT NULL, window_ends_at timestamptz NOT NULL,
      gross_minor bigint NOT NULL CHECK(gross_minor>0), currency text NOT NULL CHECK(currency='USD'),
      state text NOT NULL CHECK(state IN ('available','claimed','expired_unclaimed','externally_reversed','manual_resolution')),
      claimed_refund_request_id uuid, revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
      CHECK(window_ends_at=window_starts_at+interval '336 hours'),
      FOREIGN KEY(first_payment_evidence_id) REFERENCES licensing_private.commercial_payment_evidence(payment_evidence_id),
      FOREIGN KEY(account_id,provider_agreement_id) REFERENCES licensing_private.provider_agreements(account_id,provider_agreement_id)
    );
    CREATE TABLE licensing_private.commercial_payment_refund_heads (
      payment_evidence_id uuid PRIMARY KEY REFERENCES licensing_private.commercial_payment_evidence(payment_evidence_id),
      cumulative_refunded_minor bigint NOT NULL CHECK(cumulative_refunded_minor>=0),
      source_digest bytea NOT NULL CHECK(octet_length(source_digest)=32), observation_generation bigint NOT NULL CHECK(observation_generation>0),
      updated_at timestamptz NOT NULL DEFAULT transaction_timestamp()
    );
    CREATE TABLE licensing_private.first_purchase_refund_requests (
      account_id text NOT NULL, refund_request_id uuid NOT NULL, request_id text NOT NULL, request_digest bytea NOT NULL CHECK(octet_length(request_digest)=32),
      expected_purchase_attempt_id uuid NOT NULL, provider_agreement_id uuid NOT NULL, eligibility_revision bigint NOT NULL,
      payment_evidence_id uuid NOT NULL, gross_minor bigint NOT NULL CHECK(gross_minor>0), currency text NOT NULL CHECK(currency='USD'),
      remaining_minor_at_acceptance bigint NOT NULL CHECK(remaining_minor_at_acceptance>0), accepted_at timestamptz NOT NULL,
      state text NOT NULL CHECK(state IN ('termination_pending','termination_unknown','refund_pending','refund_unknown','refunded','retry_wait','manual_resolution')),
      termination_operation_id uuid, refund_operation_id uuid, request_revision bigint NOT NULL DEFAULT 1 CHECK(request_revision>0),
      failure_class text, retry_at timestamptz, fulfillment_observation_id uuid, completed_at timestamptz,
      PRIMARY KEY(account_id,refund_request_id), UNIQUE(account_id,request_id),
      FOREIGN KEY(payment_evidence_id) REFERENCES licensing_private.commercial_payment_evidence(payment_evidence_id),
      FOREIGN KEY(account_id,provider_agreement_id) REFERENCES licensing_private.provider_agreements(account_id,provider_agreement_id)
    );
    CREATE TABLE licensing_private.agreement_observations (
      observation_id uuid PRIMARY KEY, account_id text NOT NULL, provider_agreement_id uuid NOT NULL, requested_generation bigint NOT NULL,
      lease_epoch bigint NOT NULL, provider_access text NOT NULL CHECK(provider_access IN ('pending','active','delinquent','suspended','ended','refunded')),
      renewal_disposition text NOT NULL CHECK(renewal_disposition IN ('renewing','nonrenewing','terminated','unknown')),
      observed_paid_through timestamptz, observed_at timestamptz NOT NULL, plan text NOT NULL, feature_entitlements text[] NOT NULL,
      reversal text NOT NULL CHECK(reversal IN ('none','refund','fraud')), observation_digest bytea NOT NULL CHECK(octet_length(observation_digest)=32),
      payment_evidence_id uuid, payment_purpose text CHECK(payment_purpose IS NULL OR payment_purpose IN ('acquisition_initial','renewal','adjustment')),
      payment_provider licensing_private.commercial_provider, payment_resource_kind text, payment_resource_id text,
      payment_settled_at timestamptz, payment_gross_minor bigint, payment_currency text,
      cumulative_refunded_minor bigint, payment_source_digest bytea,
      refund_fact text CHECK(refund_fact IS NULL OR refund_fact IN ('none','refund_pending','refund_succeeded','refund_failed','partial_refund','dispute_pending','full_reversal_settled','partial_reversal','fraud_signal')),
      disposition text NOT NULL CHECK(disposition IN ('applied','stale_generation','stale_binding','stale_slot','stale_agreement','stale_authority','conflict')),
      UNIQUE(account_id,provider_agreement_id,observation_digest)
    );
    CREATE TABLE licensing_private.cancellation_intents (
      account_id text NOT NULL, cancellation_intent_id uuid NOT NULL, request_id text NOT NULL, request_digest bytea NOT NULL CHECK(octet_length(request_digest)=32),
      provider_agreement_id uuid NOT NULL, provider_operation_id uuid NOT NULL, intent_revision bigint NOT NULL,
      protected_paid_through timestamptz, state text NOT NULL CHECK(state IN ('requested','dispatching','outcome_unknown','scheduled','completed','failed_retryable','manual_resolution','superseded')),
      PRIMARY KEY(account_id,cancellation_intent_id), UNIQUE(account_id,request_id)
    );
    CREATE TABLE licensing_private.fixed_term_capture_requests (
      account_id text NOT NULL, request_id text NOT NULL, request_digest bytea NOT NULL CHECK(octet_length(request_digest)=32),
      order_operation_id uuid NOT NULL, capture_operation_id uuid NOT NULL,
      PRIMARY KEY(account_id,request_id), UNIQUE(account_id,order_operation_id,capture_operation_id)
    );
    CREATE TABLE licensing_private.provider_receipts (
      receipt_id uuid PRIMARY KEY, provider licensing_private.commercial_provider NOT NULL, provider_event_id text NOT NULL,
      payload_digest bytea NOT NULL CHECK(octet_length(payload_digest)=32), event_type text NOT NULL,
      receipt_kind text NOT NULL CHECK(receipt_kind IN ('actionable','ignored')), trigger_resource_kind text, trigger_resource_id text,
      ignored_reason text CHECK(ignored_reason IS NULL OR ignored_reason IN ('unsupported_event','unrelated_object','test_event')),
      occurred_at timestamptz NOT NULL, authenticated_evidence_ref text NOT NULL,
      disposition text NOT NULL CHECK(disposition IN ('scheduled','ignored','quarantined')), received_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
      UNIQUE(provider,provider_event_id), CHECK((receipt_kind='actionable' AND trigger_resource_kind IS NOT NULL AND trigger_resource_id IS NOT NULL AND ignored_reason IS NULL)
        OR (receipt_kind='ignored' AND trigger_resource_kind IS NULL AND trigger_resource_id IS NULL AND ignored_reason IS NOT NULL))
    );
    CREATE TABLE licensing_private.provider_receipt_conflicts (
      conflict_id uuid PRIMARY KEY, provider licensing_private.commercial_provider NOT NULL, provider_event_id text NOT NULL,
      winning_digest bytea NOT NULL CHECK(octet_length(winning_digest)=32), conflicting_digest bytea NOT NULL CHECK(octet_length(conflicting_digest)=32),
      detected_at timestamptz NOT NULL DEFAULT transaction_timestamp(), UNIQUE(provider,provider_event_id,conflicting_digest)
    );
    CREATE TABLE licensing_private.agreement_refund_evidence_heads (
      account_id text NOT NULL, provider_agreement_id uuid NOT NULL, payment_evidence_id uuid NOT NULL,
      state text NOT NULL CHECK(state IN ('blocking','resolved_failed','resolved_settled')),
      refund_fact text NOT NULL CHECK(refund_fact IN ('refund_pending','refund_succeeded','refund_failed','partial_refund',
        'dispute_pending','full_reversal_settled','partial_reversal','fraud_signal')),
      observation_id uuid NOT NULL, receipt_id uuid NOT NULL, receipt_provider licensing_private.commercial_provider NOT NULL,
      provider_event_id text NOT NULL, trigger_resource_kind text NOT NULL, trigger_resource_id text NOT NULL,
      revision bigint NOT NULL DEFAULT 1 CHECK(revision>0), updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
      PRIMARY KEY(account_id,provider_agreement_id,payment_evidence_id,receipt_provider,trigger_resource_kind,trigger_resource_id),
      FOREIGN KEY(account_id,provider_agreement_id) REFERENCES licensing_private.provider_agreements(account_id,provider_agreement_id),
      FOREIGN KEY(payment_evidence_id) REFERENCES licensing_private.commercial_payment_evidence(payment_evidence_id),
      FOREIGN KEY(observation_id) REFERENCES licensing_private.agreement_observations(observation_id) DEFERRABLE INITIALLY DEFERRED,
      FOREIGN KEY(receipt_id) REFERENCES licensing_private.provider_receipts(receipt_id),
      CHECK((state='blocking' AND refund_fact IN ('refund_pending','refund_succeeded','partial_refund','dispute_pending',
          'full_reversal_settled','partial_reversal','fraud_signal'))
        OR (state='resolved_failed' AND refund_fact='refund_failed')
        OR (state='resolved_settled' AND refund_fact IN ('refund_succeeded','full_reversal_settled')))
    );
    CREATE TABLE licensing_private.commercial_jobs (
      job_id uuid PRIMARY KEY, kind licensing_private.job_kind NOT NULL, receipt_id uuid, binding_provider licensing_private.commercial_provider,
      binding_resource_kind text, binding_resource_id text, account_id text, provider_agreement_id uuid, requested_generation bigint,
      expected_binding_digest bytea CHECK(expected_binding_digest IS NULL OR octet_length(expected_binding_digest)=32),
      expected_slot_epoch bigint, expected_agreement_revision bigint, expected_authority_revision bigint, expected_right_id uuid,
      state licensing_private.job_state NOT NULL DEFAULT 'ready', lease_epoch bigint NOT NULL DEFAULT 0, lease_owner text,
      lease_expires_at timestamptz, token_digest bytea CHECK(token_digest IS NULL OR octet_length(token_digest)=32), attempt_count integer NOT NULL DEFAULT 0,
      max_attempts integer NOT NULL DEFAULT 12, max_age interval NOT NULL DEFAULT interval '7 days', first_attempt_at timestamptz,
      last_attempt_at timestamptz, next_attempt_at timestamptz NOT NULL DEFAULT transaction_timestamp(), last_error_class text,
      dead_letter_at timestamptz, dead_letter_reason text, parent_job_id uuid REFERENCES licensing_private.commercial_jobs(job_id),
      redrive_reason text CHECK(redrive_reason IS NULL OR redrive_reason ~ '^[!-~][ -~]{0,159}$'),
      CHECK((state='leased')=(lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL AND token_digest IS NOT NULL))
    );
    CREATE TABLE licensing_private.provider_resource_cursors (
      provider licensing_private.commercial_provider NOT NULL, resource_kind text NOT NULL, resource_id text NOT NULL,
      latest_requested_generation bigint NOT NULL DEFAULT 0, latest_applied_generation bigint NOT NULL DEFAULT 0,
      PRIMARY KEY(provider,resource_kind,resource_id), CHECK(latest_applied_generation<=latest_requested_generation)
    );
    CREATE TABLE licensing_private.replacement_eligibility (
      eligibility_id uuid PRIMARY KEY, account_id text NOT NULL, slot_ownership_id uuid NOT NULL, slot_epoch bigint NOT NULL,
      holder_kind text NOT NULL CHECK(holder_kind IN ('attempt','agreement')), holder_id uuid NOT NULL, verdict text NOT NULL CHECK(verdict IN ('eligible','not_eligible')),
      reason text NOT NULL, evidence_digest bytea NOT NULL CHECK(octet_length(evidence_digest)=32), evaluated_at timestamptz NOT NULL DEFAULT transaction_timestamp()
    );
    CREATE TABLE licensing_private.commercial_rights (
      account_id text NOT NULL, right_id uuid NOT NULL, provider_agreement_id uuid NOT NULL, state text NOT NULL CHECK(state IN ('active','grace','suspended','revoked','expired')),
      plan text NOT NULL, purchase_kind licensing_private.purchase_kind NOT NULL, commercial_expires_at timestamptz NOT NULL,
      feature_entitlements text[] NOT NULL, source_observation_id uuid NOT NULL,
      reason text NOT NULL DEFAULT 'provider_observation', created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
      PRIMARY KEY(account_id,right_id)
    );
    CREATE TABLE licensing_private.commercial_authorities (
      account_id text PRIMARY KEY REFERENCES public.identity_accounts(account_id), authority_revision bigint NOT NULL,
      provider_agreement_id uuid, right_id uuid, grants_access boolean NOT NULL, updated_at timestamptz NOT NULL DEFAULT transaction_timestamp()
    );
    CREATE TABLE licensing_private.account_entitlement_projections (
      account_id text PRIMARY KEY REFERENCES public.identity_accounts(account_id), authority_revision bigint NOT NULL,
      right_id uuid, state text NOT NULL, plan text, purchase_kind text, commercial_expires_at timestamptz,
      feature_entitlements text[] NOT NULL DEFAULT '{}', projection_digest bytea NOT NULL CHECK(octet_length(projection_digest)=32),
      updated_at timestamptz NOT NULL DEFAULT transaction_timestamp()
    );
    CREATE TABLE licensing_private.commercial_outbox (
      outbox_id uuid PRIMARY KEY, account_id text NOT NULL, authority_revision bigint NOT NULL,
      projection_digest bytea NOT NULL CHECK(octet_length(projection_digest)=32), created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
      UNIQUE(account_id,authority_revision)
    );
    CREATE TABLE licensing_private.approval_redirect_handles (
      handle_id uuid PRIMARY KEY, handle_digest bytea NOT NULL UNIQUE CHECK(octet_length(handle_digest)=32), account_id text NOT NULL,
      holder_id uuid NOT NULL, slot_ownership_id uuid NOT NULL, slot_epoch bigint NOT NULL,
      provider licensing_private.commercial_provider NOT NULL, resource_kind text NOT NULL, resource_id text NOT NULL,
      state text NOT NULL CHECK(state IN ('issued','claimed','consumed','expired','manual_resolution')), claim_id uuid UNIQUE,
      expires_at timestamptz NOT NULL, use_count integer NOT NULL DEFAULT 0 CHECK(use_count BETWEEN 0 AND 1), created_at timestamptz NOT NULL DEFAULT transaction_timestamp()
    );

    CREATE FUNCTION licensing_private.reject_immutable_change() RETURNS trigger LANGUAGE plpgsql
      SET search_path=pg_catalog AS $f$ BEGIN RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='immutable commercial evidence'; END $f$;
    CREATE TRIGGER provider_resource_bindings_immutable BEFORE UPDATE OR DELETE ON licensing_private.provider_resource_bindings
      FOR EACH ROW EXECUTE FUNCTION licensing_private.reject_immutable_change();
    CREATE TRIGGER commercial_payment_evidence_immutable BEFORE UPDATE OR DELETE ON licensing_private.commercial_payment_evidence
      FOR EACH ROW EXECUTE FUNCTION licensing_private.reject_immutable_change();
    CREATE TRIGGER agreement_observations_immutable BEFORE UPDATE OR DELETE ON licensing_private.agreement_observations
      FOR EACH ROW EXECUTE FUNCTION licensing_private.reject_immutable_change();
    CREATE TRIGGER provider_receipts_immutable BEFORE UPDATE OR DELETE ON licensing_private.provider_receipts
      FOR EACH ROW EXECUTE FUNCTION licensing_private.reject_immutable_change();
    CREATE TRIGGER replacement_eligibility_immutable BEFORE UPDATE OR DELETE ON licensing_private.replacement_eligibility
      FOR EACH ROW EXECUTE FUNCTION licensing_private.reject_immutable_change();
    CREATE FUNCTION licensing_private.protect_terminal_work() RETURNS trigger LANGUAGE plpgsql
      SET search_path=pg_catalog AS $f$
    BEGIN IF OLD.state IN ('quarantined','dead_letter') THEN
        RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='terminal commercial work is immutable';
      END IF; IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW; END $f$;
    CREATE TRIGGER provider_operation_terminal_immutable BEFORE UPDATE OR DELETE ON licensing_private.provider_operation_work
      FOR EACH ROW EXECUTE FUNCTION licensing_private.protect_terminal_work();
    CREATE TRIGGER commercial_job_terminal_immutable BEFORE UPDATE OR DELETE ON licensing_private.commercial_jobs
      FOR EACH ROW EXECUTE FUNCTION licensing_private.protect_terminal_work();

    CREATE FUNCTION licensing_private.work_digest(p_token bytea) RETURNS bytea LANGUAGE sql IMMUTABLE
      SET search_path=pg_catalog AS $f$ SELECT sha256(convert_to('GOODDEALER-COMMERCIAL-WORK-V1','UTF8')||decode('00','hex')||p_token) $f$;
    CREATE FUNCTION licensing_private.random_token() RETURNS bytea LANGUAGE sql VOLATILE
      SET search_path=pg_catalog AS $f$ SELECT decode(replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-',''),'hex') $f$;
    CREATE FUNCTION licensing_private.require_work(p_work_id uuid,p_epoch bigint,p_token bytea,p_kind licensing_private.job_kind)
      RETURNS licensing_private.commercial_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,licensing_private SET row_security=on AS $f$
    DECLARE j licensing_private.commercial_jobs;
    BEGIN SELECT * INTO j FROM licensing_private.commercial_jobs WHERE job_id=p_work_id FOR UPDATE;
      IF NOT FOUND OR j.kind<>p_kind OR j.state<>'leased' OR j.lease_epoch<>p_epoch OR j.lease_expires_at<=transaction_timestamp()
         OR j.token_digest<>licensing_private.work_digest(p_token) THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='stale commercial work'; END IF;
      RETURN j; END $f$;

    CREATE FUNCTION licensing_api.reserve_purchase(p_request_id text,p_provider licensing_private.commercial_provider,
      p_purchase_kind licensing_private.purchase_kind,p_offer text,p_catalog_item text,p_campaign text,
      p_expected_gross_minor bigint,p_expected_currency text,p_digest bytea)
      RETURNS TABLE(purchase_attempt_id uuid,slot_ownership_id uuid,slot_epoch bigint,provider licensing_private.commercial_provider,
        purchase_kind licensing_private.purchase_kind,offer text,provider_catalog_item text,campaign_code text,
        provider_operation_id uuid,operation_revision bigint,operation_kind licensing_private.operation_kind,
        provider_idempotency_key text,request_digest bytea,replay text,work_id uuid,lease_epoch bigint,lease_expires_at timestamptz,
        raw_token bytea,provider_resource_kind text,provider_resource_id text)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,licensing_private SET row_security=on AS $f$
    DECLARE a text; existing licensing_private.purchase_attempts; existing_operation licensing_private.provider_operations;
      s licensing_private.commercial_provider_slots; own uuid; op uuid; w uuid; raw bytea; epoch bigint;
    BEGIN
      a:=identity_private.current_transaction_account('purchase_reserve');
      IF a IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='account transaction capability is unavailable'; END IF;
      IF octet_length(p_digest)<>32 OR p_expected_gross_minor IS NULL OR p_expected_gross_minor<1
        OR p_expected_currency IS NULL OR p_expected_currency<>'USD'
        THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid request'; END IF;
      SELECT * INTO existing FROM licensing_private.purchase_attempts WHERE account_id=a AND request_id=p_request_id FOR UPDATE;
      IF FOUND THEN
        IF existing.request_digest<>p_digest OR existing.provider<>p_provider OR existing.purchase_kind<>p_purchase_kind
           OR existing.offer<>p_offer OR existing.provider_catalog_item<>p_catalog_item OR existing.campaign_code IS DISTINCT FROM p_campaign
           OR existing.expected_gross_minor<>p_expected_gross_minor OR existing.expected_currency<>p_expected_currency
          THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='commercial request conflict'; END IF;
        SELECT * INTO s FROM licensing_private.commercial_provider_slots cps WHERE cps.account_id=a FOR UPDATE;
        SELECT po.* INTO existing_operation FROM licensing_private.provider_operations po WHERE po.account_id=a
          AND po.purchase_attempt_id=existing.purchase_attempt_id
          AND po.operation_kind IN ('subscription_create','fixed_term_checkout_create','fixed_term_order_create')
          ORDER BY po.created_at LIMIT 1;
        own:=existing_operation.slot_ownership_id; epoch:=s.slot_epoch; op:=existing_operation.provider_operation_id;
        SELECT pow.work_id INTO w FROM licensing_private.provider_operation_work pow WHERE pow.account_id=a
          AND pow.provider_operation_id=op ORDER BY pow.parent_work_id NULLS FIRST,pow.lease_epoch DESC LIMIT 1 FOR UPDATE;
        raw:=licensing_private.random_token(); UPDATE licensing_private.provider_operation_work SET state='leased',lease_epoch=provider_operation_work.lease_epoch+1,
          lease_owner='account-command',lease_expires_at=transaction_timestamp()+interval '30 seconds',token_digest=licensing_private.work_digest(raw)
          WHERE provider_operation_work.work_id=w AND provider_operation_work.state NOT IN ('quarantined','dead_letter')
          RETURNING provider_operation_work.lease_epoch,provider_operation_work.lease_expires_at INTO lease_epoch,lease_expires_at;
        IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='55P03',MESSAGE='commercial operation requires controlled redrive'; END IF;
        replay:='same_request'; purchase_attempt_id:=existing.purchase_attempt_id;
      ELSE
        SELECT * INTO s FROM licensing_private.commercial_provider_slots cps WHERE cps.account_id=a FOR UPDATE;
        IF FOUND AND s.state<>'vacant' THEN RAISE EXCEPTION USING ERRCODE='55P03',MESSAGE='commercial provider slot is occupied'; END IF;
        purchase_attempt_id:=gen_random_uuid(); own:=gen_random_uuid(); op:=gen_random_uuid(); w:=gen_random_uuid();
        epoch:=coalesce(s.slot_epoch,0)+1; raw:=licensing_private.random_token();
        INSERT INTO licensing_private.purchase_attempts(account_id,purchase_attempt_id,request_id,request_digest,provider,purchase_kind,
          offer,provider_catalog_item,campaign_code,expected_gross_minor,expected_currency,state,created_at)
          VALUES(a,purchase_attempt_id,p_request_id,p_digest,p_provider,p_purchase_kind,p_offer,p_catalog_item,p_campaign,
            p_expected_gross_minor,p_expected_currency,'reserved',transaction_timestamp());
        INSERT INTO licensing_private.binding_claims VALUES(gen_random_uuid(),a,purchase_attempt_id,
          sha256(convert_to(a||purchase_attempt_id::text,'UTF8')));
        operation_kind:=CASE WHEN p_purchase_kind='subscription' THEN 'subscription_create'::licensing_private.operation_kind
          WHEN p_provider='stripe' THEN 'fixed_term_checkout_create'::licensing_private.operation_kind ELSE 'fixed_term_order_create'::licensing_private.operation_kind END;
        provider_idempotency_key:=encode(sha256(convert_to('commercial-operation:'||op::text,'UTF8')),'hex');
        INSERT INTO licensing_private.provider_operations(account_id,provider_operation_id,purchase_attempt_id,slot_ownership_id,provider,operation_kind,provider_idempotency_key,request_digest)
          VALUES(a,op,purchase_attempt_id,own,p_provider,operation_kind,provider_idempotency_key,p_digest);
        INSERT INTO licensing_private.commercial_provider_slot_versions VALUES(a,epoch,own,'attempt_held','not_requested',purchase_attempt_id,NULL,op,transaction_timestamp());
        IF s.account_id IS NULL THEN
          INSERT INTO licensing_private.commercial_provider_slots VALUES(a,epoch,own,'attempt_held','not_requested',purchase_attempt_id,NULL,op);
        ELSE
          UPDATE licensing_private.commercial_provider_slots SET slot_epoch=epoch,slot_ownership_id=own,state='attempt_held',
            release_status='not_requested',holder_attempt_id=purchase_attempt_id,holder_agreement_id=NULL,current_provider_operation_id=op
            WHERE account_id=a;
        END IF;
        lease_epoch:=1; lease_expires_at:=transaction_timestamp()+interval '30 seconds';
        INSERT INTO licensing_private.provider_operation_work(work_id,account_id,provider_operation_id,state,lease_epoch,lease_owner,lease_expires_at,token_digest)
          VALUES(w,a,op,'leased',lease_epoch,'account-command',lease_expires_at,licensing_private.work_digest(raw)); replay:='created';
      END IF;
      slot_ownership_id:=own; slot_epoch:=epoch; provider:=p_provider; purchase_kind:=p_purchase_kind; offer:=p_offer;
      provider_catalog_item:=p_catalog_item; campaign_code:=p_campaign; provider_operation_id:=op; operation_revision:=1;
      IF operation_kind IS NULL THEN SELECT o.operation_kind,o.provider_idempotency_key INTO operation_kind,provider_idempotency_key
        FROM licensing_private.provider_operations o WHERE o.account_id=a AND o.provider_operation_id=op; END IF;
      request_digest:=p_digest; work_id:=w; raw_token:=raw; provider_resource_kind:=NULL; provider_resource_id:=NULL; RETURN NEXT;
    END $f$;

    CREATE FUNCTION licensing_api.read_billing_status() RETURNS TABLE(purchase_attempt_id uuid,provider_agreement_id uuid,
      current_provider_operation_id uuid,request_id text,provider licensing_private.commercial_provider,offer text,campaign_code text,
      state text,paid_through timestamptz,refund_eligible_until timestamptz)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,licensing_private SET row_security=on AS $f$
    DECLARE a text; BEGIN a:=identity_private.current_transaction_account('billing_read');
      IF a IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='account transaction capability is unavailable'; END IF;
      RETURN QUERY SELECT p.purchase_attempt_id,s.holder_agreement_id,s.current_provider_operation_id,coalesce(ci.request_id,p.request_id),
        p.provider,p.offer,p.campaign_code,
        CASE WHEN g.provider_agreement_id IS NULL THEN CASE p.state
            WHEN 'reserved' THEN 'creating' WHEN 'creating' THEN 'creating' WHEN 'creation_unknown' THEN 'creation_unknown'
            WHEN 'approval_pending' THEN 'approval_pending' ELSE 'failed' END
          WHEN g.state='refunded' THEN 'refunded'
          WHEN g.state='pending' AND auth.account_id IS NULL THEN 'approval_pending'
          WHEN auth.account_id IS NULL OR NOT auth.grants_access THEN 'commercial_read_only'
          WHEN ci.state IN ('requested','dispatching','failed_retryable') THEN 'cancellation_pending'
          WHEN ci.state='outcome_unknown' THEN 'cancellation_unknown'
          WHEN ci.state IN ('scheduled','completed') THEN 'cancel_at_period_end'
          WHEN g.state='delinquent_grace' THEN 'grace' ELSE 'active' END,
        g.protected_paid_through,CASE WHEN eligibility.state IN ('available','expired_unclaimed')
          AND eligibility.purchase_attempt_id=p.purchase_attempt_id
          AND eligibility.provider_agreement_id=g.provider_agreement_id
          AND eligibility.window_ends_at>transaction_timestamp() THEN eligibility.window_ends_at END
        FROM licensing_private.purchase_attempts p
        LEFT JOIN licensing_private.commercial_provider_slots s ON s.account_id=p.account_id
        LEFT JOIN licensing_private.provider_agreements g ON g.account_id=s.account_id AND g.provider_agreement_id=s.holder_agreement_id
        LEFT JOIN licensing_private.commercial_authorities auth ON auth.account_id=g.account_id AND auth.provider_agreement_id=g.provider_agreement_id
        LEFT JOIN licensing_private.first_paid_purchase_eligibilities eligibility ON eligibility.account_id=p.account_id
        LEFT JOIN LATERAL (SELECT c.request_id,c.state FROM licensing_private.cancellation_intents c
          WHERE c.account_id=g.account_id AND c.provider_agreement_id=g.provider_agreement_id AND c.state<>'superseded'
          ORDER BY c.intent_revision DESC LIMIT 1) ci ON true
        WHERE p.account_id=a ORDER BY p.created_at DESC LIMIT 1; END $f$;

    CREATE FUNCTION licensing_api.read_entitlement_deadline()
      RETURNS TABLE(entitlement_deadline timestamptz,currently_active boolean)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,licensing_private SET row_security=on AS $f$
    DECLARE a text; BEGIN a:=identity_private.current_transaction_account('identity_account');
      IF a IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='account transaction capability is unavailable'; END IF;
      RETURN QUERY SELECT p.commercial_expires_at,p.state IN ('active','grace') AND p.commercial_expires_at>transaction_timestamp()
        FROM licensing_private.account_entitlement_projections p WHERE p.account_id=a FOR UPDATE; END $f$;

    CREATE FUNCTION licensing_api.read_authoritative_entitlement_snapshot()
      RETURNS TABLE(source_event_id text,source_revision bigint,occurred_at timestamptz,state text,
        license_id text,plan text,entitlement_kind text,commercial_expires_at timestamptz,
        offline_grace_until timestamptz,credential_refresh_due_at timestamptz,
        feature_entitlements text[],trusted_now timestamptz)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,licensing_private SET row_security=on AS $f$
    DECLARE a text; BEGIN a:=coalesce(identity_private.current_transaction_account('devices_account'),
      identity_private.current_transaction_account('identity_account'));
      IF a IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='account transaction capability is unavailable'; END IF;
      RETURN QUERY SELECT p.right_id::text,p.authority_revision,p.updated_at,p.state,p.right_id::text,
        p.plan,p.purchase_kind,p.commercial_expires_at,p.commercial_expires_at,p.commercial_expires_at,
        p.feature_entitlements,clock_timestamp()
        FROM licensing_private.account_entitlement_projections p WHERE p.account_id=a FOR UPDATE;
    END $f$;

    CREATE FUNCTION licensing_ingress_api.receive_authenticated_receipt(p_provider licensing_private.commercial_provider,p_event_id text,
      p_digest bytea,p_event_type text,p_kind text,p_resource_kind text,p_resource_id text,p_ignored_reason text,p_occurred_at timestamptz,p_evidence text)
      RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,licensing_private SET row_security=on AS $f$
    DECLARE r licensing_private.provider_receipts; rid uuid; inserted boolean;
    BEGIN rid:=gen_random_uuid();
      INSERT INTO licensing_private.provider_receipts VALUES(rid,p_provider,p_event_id,p_digest,p_event_type,p_kind,
        p_resource_kind,p_resource_id,p_ignored_reason,p_occurred_at,p_evidence,CASE WHEN p_kind='ignored' THEN 'ignored' ELSE 'scheduled' END,transaction_timestamp())
        ON CONFLICT(provider,provider_event_id) DO NOTHING RETURNING * INTO r;
      inserted:=FOUND;
      IF inserted THEN
        IF p_kind='actionable' THEN INSERT INTO licensing_private.commercial_jobs(job_id,kind,receipt_id,state)
          VALUES(gen_random_uuid(),'receipt',r.receipt_id,'ready'); RETURN 'scheduled'; END IF;
        RETURN 'ignored';
      END IF;
      SELECT pr.* INTO r FROM licensing_private.provider_receipts pr
        WHERE pr.provider=p_provider AND pr.provider_event_id=p_event_id FOR UPDATE;
      IF r.payload_digest=p_digest THEN RETURN 'duplicate'; END IF;
      INSERT INTO licensing_private.provider_receipt_conflicts VALUES(gen_random_uuid(),p_provider,p_event_id,r.payload_digest,p_digest,transaction_timestamp())
        ON CONFLICT DO NOTHING;
      RETURN 'conflict'; END $f$;

    CREATE FUNCTION licensing_worker_api.lease_provider_operation_work(p_worker text)
      RETURNS TABLE(work_id uuid,lease_epoch bigint,lease_expires_at timestamptz,raw_token bytea,provider licensing_private.commercial_provider,
        provider_operation_id uuid,operation_revision bigint,operation_kind licensing_private.operation_kind,provider_idempotency_key text,
        request_digest bytea,purchase_attempt_id uuid,purchase_kind licensing_private.purchase_kind,offer text,
        provider_catalog_item text,campaign_code text,expected_gross_minor bigint,expected_currency text,
        provider_resource_kind text,provider_resource_id text)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,licensing_private SET row_security=on AS $f$
    DECLARE w licensing_private.provider_operation_work; o licensing_private.provider_operations;
      s licensing_private.commercial_provider_slots; candidate uuid; raw bytea;
    BEGIN SELECT pow.work_id INTO candidate FROM licensing_private.provider_operation_work pow
        JOIN licensing_private.provider_operations po ON po.account_id=pow.account_id
          AND po.provider_operation_id=pow.provider_operation_id
        JOIN licensing_private.commercial_provider_slots current_slot ON current_slot.account_id=po.account_id
          AND current_slot.slot_ownership_id=po.slot_ownership_id
          AND current_slot.current_provider_operation_id=po.provider_operation_id
          AND ((current_slot.state='attempt_held' AND current_slot.holder_attempt_id=po.purchase_attempt_id
              AND po.provider_agreement_id IS NULL)
            OR (current_slot.state='agreement_held' AND current_slot.holder_agreement_id=po.provider_agreement_id
              AND po.provider_agreement_id IS NOT NULL))
        WHERE (pow.state='ready' OR (pow.state='retry_wait' AND pow.next_attempt_at<=transaction_timestamp())
          OR (pow.state='leased' AND pow.lease_expires_at<=transaction_timestamp()))
          AND (pow.state<>'retry_wait' OR po.operation_kind NOT IN ('subscription_refund_terminate','first_purchase_refund')
            OR EXISTS(SELECT 1 FROM licensing_private.first_purchase_refund_requests retry_request
              WHERE retry_request.account_id=po.account_id
                AND (retry_request.termination_operation_id=po.provider_operation_id
                  OR retry_request.refund_operation_id=po.provider_operation_id)
                AND retry_request.state='retry_wait' AND retry_request.retry_at<=transaction_timestamp()))
        ORDER BY pow.next_attempt_at,pow.work_id LIMIT 1; IF NOT FOUND THEN RETURN; END IF;
      SELECT cps.* INTO s FROM licensing_private.commercial_provider_slots cps
        WHERE cps.account_id=(SELECT pow.account_id FROM licensing_private.provider_operation_work pow WHERE pow.work_id=candidate) FOR UPDATE;
      SELECT pow.* INTO w FROM licensing_private.provider_operation_work pow WHERE pow.work_id=candidate FOR UPDATE;
      IF NOT FOUND OR NOT (w.state='ready' OR (w.state='retry_wait' AND w.next_attempt_at<=transaction_timestamp()
          AND EXISTS(SELECT 1 FROM licensing_private.provider_operations retry_operation
            WHERE retry_operation.account_id=w.account_id AND retry_operation.provider_operation_id=w.provider_operation_id
              AND (retry_operation.operation_kind NOT IN ('subscription_refund_terminate','first_purchase_refund')
                OR EXISTS(SELECT 1 FROM licensing_private.first_purchase_refund_requests retry_request
                  WHERE retry_request.account_id=retry_operation.account_id
                    AND (retry_request.termination_operation_id=retry_operation.provider_operation_id
                      OR retry_request.refund_operation_id=retry_operation.provider_operation_id)
                    AND retry_request.state='retry_wait' AND retry_request.retry_at<=transaction_timestamp()))))
          OR (w.state='leased' AND w.lease_expires_at<=transaction_timestamp())) THEN RETURN; END IF;
      SELECT po.* INTO o FROM licensing_private.provider_operations po
        WHERE po.account_id=w.account_id AND po.provider_operation_id=w.provider_operation_id FOR UPDATE;
      IF s.account_id IS NULL OR o.provider_operation_id IS NULL OR s.account_id<>o.account_id
        OR s.slot_ownership_id<>o.slot_ownership_id OR s.current_provider_operation_id IS DISTINCT FROM o.provider_operation_id
        OR NOT ((s.state='attempt_held' AND s.holder_attempt_id=o.purchase_attempt_id AND o.provider_agreement_id IS NULL)
          OR (s.state='agreement_held' AND s.holder_agreement_id=o.provider_agreement_id AND o.provider_agreement_id IS NOT NULL))
        THEN RETURN; END IF;
      IF w.state='leased' AND w.lease_expires_at<=transaction_timestamp() THEN
        IF o.state='permit_issued' THEN
          UPDATE licensing_private.provider_dispatch_permits SET state='revoked'
            WHERE provider_dispatch_permits.work_id=w.work_id AND provider_dispatch_permits.state='issued';
          UPDATE licensing_private.provider_operations SET state='planned',operation_revision=provider_operations.operation_revision+1,
            updated_at=transaction_timestamp() WHERE account_id=w.account_id AND provider_operations.provider_operation_id=w.provider_operation_id
            RETURNING provider_operations.* INTO o;
        ELSIF o.state='dispatch_consumed' THEN
          UPDATE licensing_private.provider_operations SET state='outcome_unknown',operation_revision=provider_operations.operation_revision+1,
            updated_at=transaction_timestamp() WHERE account_id=w.account_id AND provider_operations.provider_operation_id=w.provider_operation_id
            RETURNING provider_operations.* INTO o;
        END IF;
      END IF;
      raw:=licensing_private.random_token(); UPDATE licensing_private.provider_operation_work SET state='leased',lease_epoch=w.lease_epoch+1,lease_owner=p_worker,
        lease_expires_at=transaction_timestamp()+interval '30 seconds',token_digest=licensing_private.work_digest(raw),attempt_count=provider_operation_work.attempt_count+1,
        first_attempt_at=coalesce(first_attempt_at,transaction_timestamp()),last_attempt_at=transaction_timestamp() WHERE provider_operation_work.work_id=w.work_id
        RETURNING provider_operation_work.work_id,provider_operation_work.lease_epoch,provider_operation_work.lease_expires_at INTO work_id,lease_epoch,lease_expires_at;
      raw_token:=raw; SELECT o.provider,o.provider_operation_id,o.operation_revision,o.operation_kind,o.provider_idempotency_key,o.request_digest,
        pa.purchase_attempt_id,pa.purchase_kind,pa.offer,pa.provider_catalog_item,pa.campaign_code,
        pa.expected_gross_minor,pa.expected_currency,
        CASE o.operation_kind WHEN 'subscription_cancel' THEN g.canonical_resource_kind
          WHEN 'subscription_refund_terminate' THEN g.canonical_resource_kind
          WHEN 'first_purchase_refund' THEN refund_payment.resource_kind
          WHEN 'fixed_term_order_capture' THEN order_binding.resource_kind END,
        CASE o.operation_kind WHEN 'subscription_cancel' THEN g.canonical_resource_id
          WHEN 'subscription_refund_terminate' THEN g.canonical_resource_id
          WHEN 'first_purchase_refund' THEN refund_payment.resource_id
          WHEN 'fixed_term_order_capture' THEN order_binding.resource_id END
        INTO provider,provider_operation_id,operation_revision,operation_kind,provider_idempotency_key,request_digest,
          purchase_attempt_id,purchase_kind,offer,provider_catalog_item,campaign_code,expected_gross_minor,expected_currency,
          provider_resource_kind,provider_resource_id
        FROM licensing_private.purchase_attempts pa
        LEFT JOIN licensing_private.provider_agreements g ON g.account_id=o.account_id AND g.provider_agreement_id=o.provider_agreement_id
        LEFT JOIN LATERAL (SELECT rb.resource_kind,rb.resource_id FROM licensing_private.fixed_term_capture_requests fcr
          JOIN licensing_private.provider_resource_bindings rb ON rb.account_id=fcr.account_id
            AND rb.creating_operation_id=fcr.order_operation_id
          WHERE fcr.account_id=o.account_id AND fcr.capture_operation_id=o.provider_operation_id LIMIT 1) order_binding ON true
        LEFT JOIN licensing_private.first_purchase_refund_requests refund_request ON refund_request.account_id=o.account_id
          AND refund_request.refund_operation_id=o.provider_operation_id
        LEFT JOIN licensing_private.commercial_payment_evidence refund_payment
          ON refund_payment.payment_evidence_id=refund_request.payment_evidence_id
        WHERE pa.account_id=o.account_id AND pa.purchase_attempt_id=o.purchase_attempt_id; RETURN NEXT; END $f$;

    CREATE FUNCTION licensing_worker_api.issue_dispatch_permit(p_work uuid,p_epoch bigint,p_token bytea,p_ttl integer)
      RETURNS TABLE(dispatch_permit_id uuid,provider_operation_id uuid,operation_revision bigint,operation_kind licensing_private.operation_kind,
        dispatch_attempt integer,expires_at timestamptz)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,licensing_private SET row_security=on AS $f$
    DECLARE w licensing_private.provider_operation_work; o licensing_private.provider_operations; s licensing_private.commercial_provider_slots;
    BEGIN IF p_ttl<1 OR p_ttl>60 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid permit ttl'; END IF;
      SELECT pow.* INTO w FROM licensing_private.provider_operation_work pow WHERE pow.work_id=p_work;
      SELECT cps.* INTO s FROM licensing_private.commercial_provider_slots cps WHERE cps.account_id=w.account_id FOR UPDATE;
      SELECT po.* INTO o FROM licensing_private.provider_operations po
        WHERE po.account_id=w.account_id AND po.provider_operation_id=w.provider_operation_id FOR UPDATE;
      SELECT pow.* INTO w FROM licensing_private.provider_operation_work pow WHERE pow.work_id=p_work FOR UPDATE;
      IF NOT FOUND OR w.lease_epoch<>p_epoch OR w.state<>'leased' OR w.lease_expires_at<=transaction_timestamp() OR w.token_digest<>licensing_private.work_digest(p_token)
        THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='stale operation work'; END IF;
      IF s.account_id IS NULL OR o.provider_operation_id IS NULL OR s.account_id<>o.account_id
        OR s.slot_ownership_id<>o.slot_ownership_id OR s.current_provider_operation_id IS DISTINCT FROM o.provider_operation_id
        OR NOT ((s.state='attempt_held' AND s.holder_attempt_id=o.purchase_attempt_id AND o.provider_agreement_id IS NULL)
          OR (s.state='agreement_held' AND s.holder_agreement_id=o.provider_agreement_id AND o.provider_agreement_id IS NOT NULL))
        OR o.state NOT IN ('planned','outcome_unknown')
        THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='operation cannot dispatch'; END IF;
      dispatch_permit_id:=gen_random_uuid(); provider_operation_id:=o.provider_operation_id; operation_revision:=o.operation_revision+1;
      operation_kind:=o.operation_kind; SELECT count(*)+1 INTO dispatch_attempt FROM licensing_private.provider_dispatch_permits WHERE work_id=p_work;
      expires_at:=transaction_timestamp()+make_interval(secs=>p_ttl); INSERT INTO licensing_private.provider_dispatch_permits VALUES(dispatch_permit_id,p_work,
        provider_operation_id,operation_revision,operation_kind,dispatch_attempt,'issued',transaction_timestamp(),expires_at,NULL);
      UPDATE licensing_private.provider_operations SET state='permit_issued',operation_revision=provider_operations.operation_revision+1,updated_at=transaction_timestamp()
        WHERE account_id=w.account_id AND provider_operations.provider_operation_id=o.provider_operation_id; RETURN NEXT; END $f$;

    CREATE FUNCTION licensing_worker_api.heartbeat_bound_work(p_work uuid,p_epoch bigint,p_token bytea) RETURNS timestamptz
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,licensing_private SET row_security=on AS $f$
    DECLARE e timestamptz; BEGIN UPDATE licensing_private.commercial_jobs SET lease_expires_at=least(transaction_timestamp()+interval '30 seconds',
        coalesce(last_attempt_at,transaction_timestamp())+interval '5 minutes') WHERE job_id=p_work AND state='leased' AND lease_epoch=p_epoch
        AND lease_expires_at>transaction_timestamp() AND token_digest=licensing_private.work_digest(p_token) RETURNING lease_expires_at INTO e;
      IF NOT FOUND THEN UPDATE licensing_private.provider_operation_work SET lease_expires_at=least(transaction_timestamp()+interval '30 seconds',
        coalesce(last_attempt_at,transaction_timestamp())+interval '5 minutes') WHERE work_id=p_work AND state='leased' AND lease_epoch=p_epoch
        AND lease_expires_at>transaction_timestamp() AND token_digest=licensing_private.work_digest(p_token) RETURNING lease_expires_at INTO e; END IF;
      IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='stale commercial work'; END IF; RETURN e; END $f$;

    CREATE FUNCTION licensing_api.request_cancellation(p_request_id text,p_expected_agreement uuid,p_digest bytea)
      RETURNS TABLE(purchase_attempt_id uuid,slot_ownership_id uuid,slot_epoch bigint,provider licensing_private.commercial_provider,
        purchase_kind licensing_private.purchase_kind,offer text,provider_catalog_item text,campaign_code text,
        expected_gross_minor bigint,expected_currency text,
        provider_operation_id uuid,operation_revision bigint,operation_kind licensing_private.operation_kind,provider_idempotency_key text,
        request_digest bytea,replay text,work_id uuid,lease_epoch bigint,lease_expires_at timestamptz,raw_token bytea,
        provider_resource_kind text,provider_resource_id text,provider_agreement_id uuid,provider_agreement_resource_kind text,
        provider_agreement_resource_id text,protected_paid_through timestamptz,intent_revision bigint)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,licensing_private SET row_security=on AS $f$
    DECLARE a text; s licensing_private.commercial_provider_slots; g licensing_private.provider_agreements;
      op uuid; own_work uuid; raw bytea;
    BEGIN a:=identity_private.current_transaction_account('cancellation_request');
      IF a IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='account transaction capability is unavailable'; END IF;
      SELECT cps.* INTO s FROM licensing_private.commercial_provider_slots cps WHERE cps.account_id=a FOR UPDATE;
      IF NOT FOUND OR s.state<>'agreement_held' OR s.holder_agreement_id<>p_expected_agreement THEN
        RAISE EXCEPTION USING ERRCODE='55P03',MESSAGE='commercial provider slot is not cancellable'; END IF;
      SELECT pa.* INTO g FROM licensing_private.provider_agreements pa
        WHERE pa.account_id=a AND pa.provider_agreement_id=p_expected_agreement FOR UPDATE;
      IF g.purchase_kind<>'subscription' THEN RAISE EXCEPTION USING ERRCODE='55P03',MESSAGE='commercial provider slot is not cancellable'; END IF;
      SELECT ci.provider_operation_id,ci.intent_revision INTO op,intent_revision FROM licensing_private.cancellation_intents ci
        WHERE ci.account_id=a AND ci.request_id=p_request_id;
      IF FOUND THEN SELECT po.request_digest INTO request_digest FROM licensing_private.provider_operations po
          WHERE po.account_id=a AND po.provider_operation_id=op;
        IF request_digest<>p_digest THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='commercial request conflict'; END IF; replay:='same_request';
      ELSE op:=gen_random_uuid(); intent_revision:=1; request_digest:=p_digest; replay:='created';
        INSERT INTO licensing_private.provider_operations(account_id,provider_operation_id,purchase_attempt_id,provider_agreement_id,slot_ownership_id,
          provider,operation_kind,provider_idempotency_key,request_digest) VALUES(a,op,g.purchase_attempt_id,g.provider_agreement_id,s.slot_ownership_id,
          g.provider,'subscription_cancel',encode(sha256(convert_to('commercial-cancel:'||op::text,'UTF8')),'hex'),p_digest);
        INSERT INTO licensing_private.cancellation_intents VALUES(a,gen_random_uuid(),p_request_id,p_digest,g.provider_agreement_id,op,1,
          g.protected_paid_through,'requested');
        slot_epoch:=s.slot_epoch+1;
        INSERT INTO licensing_private.commercial_provider_slot_versions VALUES(a,slot_epoch,s.slot_ownership_id,'agreement_held',
          'pending_provider_confirmation',NULL,g.provider_agreement_id,op,transaction_timestamp());
        UPDATE licensing_private.commercial_provider_slots SET slot_epoch=request_cancellation.slot_epoch,current_provider_operation_id=op,
          release_status='pending_provider_confirmation' WHERE account_id=a;
      END IF;
      SELECT pow.work_id INTO own_work FROM licensing_private.provider_operation_work pow WHERE pow.account_id=a
        AND pow.provider_operation_id=op ORDER BY pow.parent_work_id NULLS FIRST,pow.lease_epoch DESC LIMIT 1 FOR UPDATE;
      raw:=licensing_private.random_token(); lease_expires_at:=transaction_timestamp()+interval '30 seconds';
      IF own_work IS NULL THEN own_work:=gen_random_uuid(); lease_epoch:=1;
        INSERT INTO licensing_private.provider_operation_work(work_id,account_id,provider_operation_id,state,lease_epoch,lease_owner,lease_expires_at,token_digest)
          VALUES(own_work,a,op,'leased',1,'account-command',lease_expires_at,licensing_private.work_digest(raw));
      ELSE UPDATE licensing_private.provider_operation_work SET state='leased',lease_epoch=provider_operation_work.lease_epoch+1,
          lease_owner='account-command',lease_expires_at=request_cancellation.lease_expires_at,token_digest=licensing_private.work_digest(raw)
          WHERE work_id=own_work AND state NOT IN ('quarantined','dead_letter') RETURNING provider_operation_work.lease_epoch INTO lease_epoch;
        IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='55P03',MESSAGE='cancellation operation requires controlled redrive'; END IF;
      END IF;
      purchase_attempt_id:=g.purchase_attempt_id; slot_ownership_id:=s.slot_ownership_id; IF slot_epoch IS NULL THEN slot_epoch:=s.slot_epoch; END IF;
      provider:=g.provider; provider_operation_id:=op; operation_kind:='subscription_cancel';
      SELECT pa.purchase_kind,pa.offer,pa.provider_catalog_item,pa.campaign_code,pa.expected_gross_minor,pa.expected_currency
        INTO purchase_kind,offer,provider_catalog_item,campaign_code,expected_gross_minor,expected_currency
        FROM licensing_private.purchase_attempts pa
        WHERE pa.account_id=a AND pa.purchase_attempt_id=g.purchase_attempt_id;
      SELECT po.provider_idempotency_key,po.operation_revision INTO provider_idempotency_key,operation_revision
        FROM licensing_private.provider_operations po WHERE po.account_id=a AND po.provider_operation_id=op;
      work_id:=own_work; raw_token:=raw; provider_agreement_id:=g.provider_agreement_id; provider_agreement_resource_kind:=g.canonical_resource_kind;
      provider_agreement_resource_id:=g.canonical_resource_id; protected_paid_through:=g.protected_paid_through; RETURN NEXT; END $f$;

    CREATE FUNCTION licensing_api.request_first_purchase_refund(p_request_id text,p_expected_purchase_attempt uuid,p_digest bytea)
      RETURNS TABLE(rejection_reason text,refund_request_id uuid,refund_state text,accepted_at timestamptz,remaining_minor_at_acceptance bigint,
        expected_purchase_attempt_id uuid,provider_agreement_id uuid,replay text)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,licensing_private SET row_security=on AS $f$
    DECLARE a text; s licensing_private.commercial_provider_slots; eligibility licensing_private.first_paid_purchase_eligibilities;
      payment licensing_private.commercial_payment_evidence; refund_head licensing_private.commercial_payment_refund_heads;
      g licensing_private.provider_agreements; current_agreement licensing_private.provider_agreements; current_purchase uuid;
      authority licensing_private.commercial_authorities; right_row licensing_private.commercial_rights;
      existing licensing_private.first_purchase_refund_requests;
      new_right uuid; projection bytea; planned_operation uuid;
      planned_operation_kind licensing_private.operation_kind; planned_idempotency_key text;
      new_authority_revision bigint; new_slot_epoch bigint;
    BEGIN
      a:=identity_private.current_transaction_account('refund_request');
      IF a IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='account transaction capability is unavailable'; END IF;
      IF p_request_id IS NULL OR p_request_id !~ '^[!-~]{1,160}$' OR p_expected_purchase_attempt IS NULL OR octet_length(p_digest)<>32
        THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='refund request is invalid'; END IF;
      PERFORM pg_advisory_xact_lock(hashtextextended('gooddealer:commercial-account:'||a,0));
      SELECT cps.* INTO s FROM licensing_private.commercial_provider_slots cps WHERE cps.account_id=a FOR UPDATE;
      SELECT rr.* INTO existing FROM licensing_private.first_purchase_refund_requests rr
        WHERE rr.account_id=a AND rr.request_id=p_request_id FOR UPDATE;
      IF FOUND THEN
        IF existing.request_digest<>p_digest OR existing.expected_purchase_attempt_id<>p_expected_purchase_attempt
          THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='commercial refund request conflict'; END IF;
        -- An account replay proves only request identity. It must never acquire, renew, or revoke
        -- the worker-owned execution lease; due work remains exclusively scheduler-driven.
        refund_request_id:=existing.refund_request_id; refund_state:=existing.state; accepted_at:=existing.accepted_at;
        remaining_minor_at_acceptance:=existing.remaining_minor_at_acceptance;
        expected_purchase_attempt_id:=existing.expected_purchase_attempt_id; provider_agreement_id:=existing.provider_agreement_id;
        replay:='same_request'; RETURN NEXT; RETURN;
      END IF;
      IF s.state='agreement_held' THEN
        SELECT pa.* INTO current_agreement FROM licensing_private.provider_agreements pa
          WHERE pa.account_id=a AND pa.provider_agreement_id=s.holder_agreement_id FOR UPDATE;
        current_purchase:=current_agreement.purchase_attempt_id;
      ELSIF s.state='attempt_held' THEN current_purchase:=s.holder_attempt_id;
      END IF;
      SELECT fpe.* INTO eligibility FROM licensing_private.first_paid_purchase_eligibilities fpe WHERE fpe.account_id=a FOR UPDATE;
      IF eligibility.account_id IS NULL THEN
        rejection_reason:=CASE WHEN current_purchase IS NULL OR current_purchase=p_expected_purchase_attempt
          THEN 'not_paid' ELSE 'purchase_mismatch' END; RETURN NEXT; RETURN;
      END IF;
      IF eligibility.purchase_attempt_id<>p_expected_purchase_attempt THEN
        rejection_reason:=CASE WHEN current_purchase=p_expected_purchase_attempt
          THEN 'not_first_paid_purchase' ELSE 'purchase_mismatch' END; RETURN NEXT; RETURN;
      END IF;
      SELECT cpe.* INTO payment FROM licensing_private.commercial_payment_evidence cpe
        WHERE cpe.payment_evidence_id=eligibility.first_payment_evidence_id;
      SELECT prh.* INTO refund_head FROM licensing_private.commercial_payment_refund_heads prh
        WHERE prh.payment_evidence_id=payment.payment_evidence_id FOR UPDATE;
      IF eligibility.state='externally_reversed' OR (refund_head.payment_evidence_id IS NOT NULL
        AND refund_head.cumulative_refunded_minor>=payment.gross_minor) THEN
        rejection_reason:='already_fully_reversed'; RETURN NEXT; RETURN;
      END IF;
      IF eligibility.state='claimed' THEN rejection_reason:='already_claimed'; RETURN NEXT; RETURN; END IF;
      IF eligibility.state='expired_unclaimed' OR transaction_timestamp()>=eligibility.window_ends_at THEN
        rejection_reason:='window_elapsed'; RETURN NEXT; RETURN;
      END IF;
      IF eligibility.state<>'available' OR payment.payment_evidence_id IS NULL OR refund_head.payment_evidence_id IS NULL THEN
        rejection_reason:='not_paid'; RETURN NEXT; RETURN;
      END IF;
      SELECT pa.* INTO g FROM licensing_private.provider_agreements pa WHERE pa.account_id=a
        AND pa.provider_agreement_id=eligibility.provider_agreement_id FOR UPDATE;
      SELECT ca.* INTO authority FROM licensing_private.commercial_authorities ca WHERE ca.account_id=a FOR UPDATE;
      IF authority.right_id IS NOT NULL THEN SELECT cr.* INTO right_row FROM licensing_private.commercial_rights cr
        WHERE cr.account_id=a AND cr.right_id=authority.right_id FOR UPDATE; END IF;
      IF current_purchase IS DISTINCT FROM p_expected_purchase_attempt OR s.state<>'agreement_held'
        OR s.holder_agreement_id<>g.provider_agreement_id THEN
        rejection_reason:='purchase_mismatch'; RETURN NEXT; RETURN;
      END IF;
      IF payment.purchase_attempt_id<>p_expected_purchase_attempt
        OR authority.provider_agreement_id IS DISTINCT FROM g.provider_agreement_id OR right_row.right_id IS NULL THEN
        rejection_reason:='not_paid'; RETURN NEXT; RETURN;
      END IF;
      refund_request_id:=gen_random_uuid(); planned_operation:=gen_random_uuid();
      planned_operation_kind:=CASE WHEN g.purchase_kind='subscription' THEN 'subscription_refund_terminate'::licensing_private.operation_kind
        ELSE 'first_purchase_refund'::licensing_private.operation_kind END;
      planned_idempotency_key:=encode(sha256(convert_to('commercial-first-refund:'||refund_request_id::text||':'||planned_operation_kind::text,'UTF8')),'hex');
      expected_purchase_attempt_id:=p_expected_purchase_attempt; provider_agreement_id:=g.provider_agreement_id;
      accepted_at:=transaction_timestamp(); remaining_minor_at_acceptance:=payment.gross_minor-refund_head.cumulative_refunded_minor;
      refund_state:=CASE WHEN g.purchase_kind='subscription' THEN 'termination_pending' ELSE 'refund_pending' END;
      INSERT INTO licensing_private.provider_operations(account_id,provider_operation_id,purchase_attempt_id,provider_agreement_id,
        slot_ownership_id,provider,operation_kind,provider_idempotency_key,request_digest)
        VALUES(a,planned_operation,g.purchase_attempt_id,g.provider_agreement_id,s.slot_ownership_id,g.provider,planned_operation_kind,
          planned_idempotency_key,p_digest);
      INSERT INTO licensing_private.first_purchase_refund_requests(account_id,refund_request_id,request_id,request_digest,
        expected_purchase_attempt_id,provider_agreement_id,eligibility_revision,payment_evidence_id,gross_minor,currency,
        remaining_minor_at_acceptance,accepted_at,state,termination_operation_id,refund_operation_id)
        VALUES(a,refund_request_id,p_request_id,p_digest,p_expected_purchase_attempt,g.provider_agreement_id,eligibility.revision,
          payment.payment_evidence_id,payment.gross_minor,payment.currency,remaining_minor_at_acceptance,accepted_at,refund_state,
          CASE WHEN g.purchase_kind='subscription' THEN planned_operation END,
          CASE WHEN g.purchase_kind='fixed_term' THEN planned_operation END);
      UPDATE licensing_private.first_paid_purchase_eligibilities SET state='claimed',claimed_refund_request_id=refund_request_id,
        revision=revision+1 WHERE account_id=a AND revision=eligibility.revision;
      new_right:=gen_random_uuid();
      INSERT INTO licensing_private.commercial_rights(account_id,right_id,provider_agreement_id,state,plan,purchase_kind,
        commercial_expires_at,feature_entitlements,source_observation_id,reason)
        VALUES(a,new_right,g.provider_agreement_id,'revoked',right_row.plan,right_row.purchase_kind,
          right_row.commercial_expires_at,right_row.feature_entitlements,right_row.source_observation_id,'first_purchase_refund_requested');
      new_authority_revision:=authority.authority_revision+1;
      UPDATE licensing_private.commercial_authorities SET authority_revision=new_authority_revision,
        right_id=new_right,grants_access=false,updated_at=transaction_timestamp() WHERE account_id=a;
      projection:=sha256(convert_to(a||':'||new_authority_revision::text||':'||new_right::text||':revoked:first_purchase_refund_requested','UTF8'));
      UPDATE licensing_private.account_entitlement_projections SET authority_revision=new_authority_revision,
        right_id=new_right,state='revoked',projection_digest=projection,updated_at=transaction_timestamp() WHERE account_id=a;
      INSERT INTO licensing_private.commercial_outbox VALUES(gen_random_uuid(),a,new_authority_revision,projection,transaction_timestamp());
      new_slot_epoch:=s.slot_epoch+1;
      INSERT INTO licensing_private.commercial_provider_slot_versions VALUES(a,new_slot_epoch,s.slot_ownership_id,'agreement_held',
        'pending_provider_confirmation',NULL,g.provider_agreement_id,planned_operation,transaction_timestamp());
      UPDATE licensing_private.commercial_provider_slots SET slot_epoch=new_slot_epoch,
        release_status='pending_provider_confirmation',current_provider_operation_id=planned_operation WHERE account_id=a;
      INSERT INTO licensing_private.provider_operation_work(work_id,account_id,provider_operation_id,state)
        VALUES(gen_random_uuid(),a,planned_operation,'ready');
      replay:='created'; RETURN NEXT;
    END $f$;

    CREATE FUNCTION licensing_api.read_first_purchase_refund_status(p_expected_refund_request uuid)
      RETURNS TABLE(refund_request_id uuid,expected_purchase_attempt_id uuid,state text,accepted_at timestamptz,
        remaining_minor_at_acceptance bigint,retry_at timestamptz,completed_at timestamptz)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,licensing_private SET row_security=on AS $f$
    DECLARE a text;
    BEGIN a:=identity_private.current_transaction_account('billing_read');
      IF a IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='account transaction capability is unavailable'; END IF;
      RETURN QUERY SELECT rr.refund_request_id,rr.expected_purchase_attempt_id,rr.state,rr.accepted_at,
        rr.remaining_minor_at_acceptance,rr.retry_at,rr.completed_at FROM licensing_private.first_purchase_refund_requests rr
        WHERE rr.account_id=a AND rr.refund_request_id=p_expected_refund_request;
    END $f$;

    CREATE FUNCTION licensing_api.confirm_fixed_term_capture(p_request_id text,p_expected_order_operation uuid,p_digest bytea)
      RETURNS TABLE(purchase_attempt_id uuid,slot_ownership_id uuid,slot_epoch bigint,provider licensing_private.commercial_provider,
        purchase_kind licensing_private.purchase_kind,offer text,provider_catalog_item text,campaign_code text,
        expected_gross_minor bigint,expected_currency text,
        provider_operation_id uuid,operation_revision bigint,operation_kind licensing_private.operation_kind,provider_idempotency_key text,
        request_digest bytea,replay text,work_id uuid,lease_epoch bigint,lease_expires_at timestamptz,raw_token bytea,
        provider_resource_kind text,provider_resource_id text,provider_order_resource_kind text,provider_order_resource_id text)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,licensing_private SET row_security=on AS $f$
    DECLARE a text; s licensing_private.commercial_provider_slots; o licensing_private.provider_operations; b licensing_private.provider_resource_bindings;
      capture_request licensing_private.fixed_term_capture_requests; op uuid; raw bytea; existing_work uuid;
    BEGIN a:=identity_private.current_transaction_account('fixed_term_capture');
      IF a IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='account transaction capability is unavailable'; END IF;
      SELECT fcr.* INTO capture_request FROM licensing_private.fixed_term_capture_requests fcr
        WHERE fcr.account_id=a AND fcr.request_id=p_request_id FOR UPDATE;
      IF FOUND THEN
        IF capture_request.request_digest<>p_digest OR (p_expected_order_operation<>capture_request.order_operation_id
          AND p_expected_order_operation<>capture_request.capture_operation_id)
          THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='commercial request conflict'; END IF;
        SELECT po.* INTO o FROM licensing_private.provider_operations po WHERE po.account_id=a
          AND po.provider_operation_id=capture_request.capture_operation_id;
        SELECT cps.* INTO s FROM licensing_private.commercial_provider_slots cps WHERE cps.account_id=a;
        IF s.state<>'attempt_held' OR s.current_provider_operation_id<>o.provider_operation_id OR s.slot_ownership_id<>o.slot_ownership_id
          THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='fixed-term capture replay is stale'; END IF;
        SELECT rb.* INTO b FROM licensing_private.provider_resource_bindings rb WHERE rb.account_id=a
          AND rb.creating_operation_id=capture_request.order_operation_id;
        SELECT pow.work_id INTO existing_work FROM licensing_private.provider_operation_work pow
          WHERE pow.account_id=a AND pow.provider_operation_id=o.provider_operation_id ORDER BY pow.lease_epoch DESC LIMIT 1 FOR UPDATE;
        raw:=licensing_private.random_token(); lease_expires_at:=transaction_timestamp()+interval '30 seconds';
        IF existing_work IS NULL THEN existing_work:=gen_random_uuid(); lease_epoch:=1;
          INSERT INTO licensing_private.provider_operation_work(work_id,account_id,provider_operation_id,state,lease_epoch,lease_owner,lease_expires_at,token_digest)
            VALUES(existing_work,a,o.provider_operation_id,'leased',1,'account-command',lease_expires_at,licensing_private.work_digest(raw));
        ELSE UPDATE licensing_private.provider_operation_work SET state='leased',lease_epoch=provider_operation_work.lease_epoch+1,
          lease_owner='account-command',lease_expires_at=confirm_fixed_term_capture.lease_expires_at,token_digest=licensing_private.work_digest(raw)
          WHERE provider_operation_work.work_id=existing_work RETURNING provider_operation_work.lease_epoch INTO lease_epoch; END IF;
        purchase_attempt_id:=o.purchase_attempt_id; slot_ownership_id:=o.slot_ownership_id; slot_epoch:=s.slot_epoch; provider:=o.provider;
        SELECT pa.purchase_kind,pa.offer,pa.provider_catalog_item,pa.campaign_code,pa.expected_gross_minor,pa.expected_currency
          INTO purchase_kind,offer,provider_catalog_item,campaign_code,expected_gross_minor,expected_currency FROM licensing_private.purchase_attempts pa
          WHERE pa.account_id=a AND pa.purchase_attempt_id=o.purchase_attempt_id;
        provider_operation_id:=o.provider_operation_id; operation_revision:=o.operation_revision; operation_kind:=o.operation_kind;
        provider_idempotency_key:=o.provider_idempotency_key; request_digest:=o.request_digest; replay:='same_request'; work_id:=existing_work;
        raw_token:=raw; provider_order_resource_kind:=b.resource_kind; provider_order_resource_id:=b.resource_id; RETURN NEXT; RETURN;
      END IF;
      SELECT cps.* INTO s FROM licensing_private.commercial_provider_slots cps WHERE cps.account_id=a FOR UPDATE;
      SELECT po.* INTO o FROM licensing_private.provider_operations po WHERE po.account_id=a
        AND po.provider_operation_id=p_expected_order_operation FOR UPDATE;
      IF s.account_id IS NULL OR o.provider_operation_id IS NULL OR o.provider<>'paypal' OR o.operation_kind<>'fixed_term_order_create' OR o.state<>'confirmed'
         OR s.state<>'attempt_held' OR s.current_provider_operation_id<>o.provider_operation_id THEN
        RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='fixed-term order is not capturable'; END IF;
      SELECT rb.* INTO b FROM licensing_private.provider_resource_bindings rb WHERE rb.account_id=a
        AND rb.purchase_attempt_id=o.purchase_attempt_id AND rb.creating_operation_id=o.provider_operation_id;
      IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='fixed-term order binding is missing'; END IF;
      op:=gen_random_uuid(); provider_idempotency_key:=encode(sha256(convert_to('commercial-capture:'||op::text,'UTF8')),'hex');
      INSERT INTO licensing_private.provider_operations(account_id,provider_operation_id,purchase_attempt_id,slot_ownership_id,provider,operation_kind,
        provider_idempotency_key,request_digest) VALUES(a,op,o.purchase_attempt_id,s.slot_ownership_id,'paypal','fixed_term_order_capture',provider_idempotency_key,p_digest);
      INSERT INTO licensing_private.fixed_term_capture_requests VALUES(a,p_request_id,p_digest,p_expected_order_operation,op);
      slot_epoch:=s.slot_epoch+1;
      INSERT INTO licensing_private.commercial_provider_slot_versions VALUES(a,slot_epoch,s.slot_ownership_id,'attempt_held','not_requested',
        o.purchase_attempt_id,NULL,op,transaction_timestamp());
      UPDATE licensing_private.commercial_provider_slots SET slot_epoch=confirm_fixed_term_capture.slot_epoch,
        current_provider_operation_id=op WHERE account_id=a;
      raw:=licensing_private.random_token(); work_id:=gen_random_uuid(); lease_epoch:=1; lease_expires_at:=transaction_timestamp()+interval '30 seconds';
      INSERT INTO licensing_private.provider_operation_work(work_id,account_id,provider_operation_id,state,lease_epoch,lease_owner,lease_expires_at,token_digest)
        VALUES(work_id,a,op,'leased',1,'account-command',lease_expires_at,licensing_private.work_digest(raw));
      purchase_attempt_id:=o.purchase_attempt_id; slot_ownership_id:=s.slot_ownership_id; provider:='paypal'; provider_operation_id:=op;
      SELECT pa.purchase_kind,pa.offer,pa.provider_catalog_item,pa.campaign_code,pa.expected_gross_minor,pa.expected_currency
        INTO purchase_kind,offer,provider_catalog_item,campaign_code,expected_gross_minor,expected_currency FROM licensing_private.purchase_attempts pa
        WHERE pa.account_id=a AND pa.purchase_attempt_id=o.purchase_attempt_id;
      operation_revision:=1; operation_kind:='fixed_term_order_capture'; request_digest:=p_digest; replay:='created'; raw_token:=raw;
      provider_order_resource_kind:=b.resource_kind; provider_order_resource_id:=b.resource_id; RETURN NEXT; END $f$;

    CREATE FUNCTION licensing_api.issue_approval_redirect(p_expected_holder uuid)
      RETURNS TABLE(raw_handle bytea,expires_at timestamptz) LANGUAGE plpgsql SECURITY DEFINER
      SET search_path=pg_catalog,licensing_private SET row_security=on AS $f$
    DECLARE a text; s licensing_private.commercial_provider_slots; b licensing_private.provider_resource_bindings; raw bytea;
    BEGIN a:=identity_private.current_transaction_account('billing_approval_redirect');
      IF a IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='account transaction capability is unavailable'; END IF;
      SELECT * INTO s FROM licensing_private.commercial_provider_slots WHERE account_id=a FOR UPDATE;
      IF NOT FOUND OR s.slot_ownership_id IS NULL OR (p_expected_holder IS DISTINCT FROM s.holder_attempt_id
        AND p_expected_holder IS DISTINCT FROM s.holder_agreement_id)
        THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='approval target is stale'; END IF;
      IF s.holder_attempt_id IS NOT NULL THEN
        SELECT rb.* INTO b FROM licensing_private.provider_resource_bindings rb WHERE rb.account_id=a
          AND rb.purchase_attempt_id=s.holder_attempt_id ORDER BY rb.bound_at DESC LIMIT 1;
      ELSE
        SELECT rb.* INTO b FROM licensing_private.agreement_resource_links l JOIN licensing_private.provider_resource_bindings rb
          ON rb.provider=l.provider AND rb.resource_kind=l.resource_kind AND rb.resource_id=l.resource_id
          WHERE l.account_id=a AND l.provider_agreement_id=s.holder_agreement_id
          ORDER BY CASE l.role WHEN 'checkout_origin' THEN 1 WHEN 'order_origin' THEN 2 WHEN 'canonical_agreement' THEN 3 ELSE 4 END LIMIT 1;
      END IF;
      IF b.resource_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='approval resource is unavailable'; END IF;
      IF NOT EXISTS(SELECT 1 FROM licensing_private.purchase_attempts p
        WHERE p.account_id=a AND p.purchase_attempt_id=b.purchase_attempt_id
          AND p.state IN ('approval_pending','agreement_bound'))
        THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='approval context is unavailable'; END IF;
      raw:=licensing_private.random_token(); expires_at:=transaction_timestamp()+interval '5 minutes';
      INSERT INTO licensing_private.approval_redirect_handles VALUES(gen_random_uuid(),licensing_private.work_digest(raw),a,p_expected_holder,
        s.slot_ownership_id,s.slot_epoch,b.provider,b.resource_kind,b.resource_id,'issued',NULL,expires_at,0,transaction_timestamp()); raw_handle:=raw; RETURN NEXT; END $f$;

    CREATE FUNCTION licensing_api.claim_approval_redirect(p_raw bytea)
      RETURNS TABLE(claim_id uuid,provider licensing_private.commercial_provider,provider_resource_kind text,provider_resource_id text,
        expected_purchase_attempt_id uuid,expected_purchase_kind licensing_private.purchase_kind,
        expected_offer text,expected_provider_catalog_item text,
        expected_amount_minor bigint,expected_currency text)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,licensing_private SET row_security=on AS $f$
    DECLARE a text; h licensing_private.approval_redirect_handles; s licensing_private.commercial_provider_slots;
    BEGIN a:=identity_private.current_transaction_account('billing_approval_redirect');
      IF a IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='account transaction capability is unavailable'; END IF;
      SELECT * INTO h FROM licensing_private.approval_redirect_handles WHERE handle_digest=licensing_private.work_digest(p_raw) FOR UPDATE;
      SELECT * INTO s FROM licensing_private.commercial_provider_slots WHERE account_id=a FOR UPDATE;
      IF h.handle_id IS NULL OR s.account_id IS NULL OR h.account_id<>a OR h.state<>'issued'
        OR h.expires_at<=transaction_timestamp() OR h.slot_epoch<>s.slot_epoch
        THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='approval handle is unavailable'; END IF;
      claim_id:=gen_random_uuid(); UPDATE licensing_private.approval_redirect_handles SET state='claimed',claim_id=claim_approval_redirect.claim_id,use_count=1 WHERE handle_id=h.handle_id;
      IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='approval handle is unavailable'; END IF;
      provider:=h.provider; provider_resource_kind:=h.resource_kind; provider_resource_id:=h.resource_id;
      SELECT p.purchase_attempt_id,p.purchase_kind,p.offer,p.provider_catalog_item,p.expected_gross_minor,p.expected_currency
        INTO expected_purchase_attempt_id,expected_purchase_kind,expected_offer,expected_provider_catalog_item,
          expected_amount_minor,expected_currency
        FROM licensing_private.purchase_attempts p
        WHERE p.account_id=a AND p.purchase_attempt_id=h.holder_id;
      IF expected_purchase_attempt_id IS NULL THEN
        SELECT rb.purchase_attempt_id,p.purchase_kind,p.offer,p.provider_catalog_item,p.expected_gross_minor,p.expected_currency
          INTO expected_purchase_attempt_id,expected_purchase_kind,expected_offer,expected_provider_catalog_item,
            expected_amount_minor,expected_currency
          FROM licensing_private.provider_resource_bindings rb
          JOIN licensing_private.purchase_attempts p ON p.account_id=rb.account_id AND p.purchase_attempt_id=rb.purchase_attempt_id
          WHERE rb.account_id=a AND rb.provider=h.provider AND rb.resource_kind=h.resource_kind AND rb.resource_id=h.resource_id;
      END IF;
      IF expected_purchase_attempt_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='approval context is unavailable'; END IF;
      RETURN NEXT; END $f$;

    CREATE FUNCTION licensing_api.complete_approval_redirect(p_claim uuid,p_outcome text) RETURNS void
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,licensing_private SET row_security=on AS $f$
    DECLARE a text; h licensing_private.approval_redirect_handles; attempt uuid;
    BEGIN a:=identity_private.current_transaction_account('billing_approval_redirect');
      IF a IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='account transaction capability is unavailable'; END IF;
      IF p_outcome NOT IN ('consumed','expired','manual_resolution') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='approval outcome is invalid'; END IF;
      SELECT arh.* INTO h FROM licensing_private.approval_redirect_handles arh
        WHERE arh.account_id=a AND arh.claim_id=p_claim AND arh.state='claimed' FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='approval claim is stale'; END IF;
      UPDATE licensing_private.approval_redirect_handles SET state=p_outcome WHERE account_id=a AND claim_id=p_claim AND state='claimed'
        AND p_outcome IN ('consumed','expired','manual_resolution');
      IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='approval claim is stale'; END IF;
      IF p_outcome='manual_resolution' THEN
        SELECT rb.purchase_attempt_id INTO attempt FROM licensing_private.provider_resource_bindings rb
          WHERE rb.account_id=a AND rb.provider=h.provider AND rb.resource_kind=h.resource_kind AND rb.resource_id=h.resource_id;
        IF attempt IS NULL THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='approval context is unavailable'; END IF;
        UPDATE licensing_private.purchase_attempts SET state='manual_resolution'
          WHERE account_id=a AND purchase_attempt_id=attempt AND state IN ('approval_pending','agreement_bound');
      END IF;
    END $f$;

    CREATE FUNCTION licensing_worker_api.consume_dispatch_permit(p_work uuid,p_epoch bigint,p_token bytea,p_permit uuid,p_kind licensing_private.operation_kind)
      RETURNS TABLE(dispatch_permit_id uuid,provider_operation_id uuid,operation_revision bigint,operation_kind licensing_private.operation_kind,
        dispatch_attempt integer,expires_at timestamptz,consumed_at timestamptz,provider licensing_private.commercial_provider,provider_idempotency_key text)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,licensing_private SET row_security=on AS $f$
    DECLARE w licensing_private.provider_operation_work; p licensing_private.provider_dispatch_permits;
      o licensing_private.provider_operations; s licensing_private.commercial_provider_slots;
    BEGIN SELECT pow.* INTO w FROM licensing_private.provider_operation_work pow WHERE pow.work_id=p_work;
      SELECT cps.* INTO s FROM licensing_private.commercial_provider_slots cps WHERE cps.account_id=w.account_id FOR UPDATE;
      SELECT po.* INTO o FROM licensing_private.provider_operations po
        WHERE po.account_id=w.account_id AND po.provider_operation_id=w.provider_operation_id FOR UPDATE;
      SELECT pow.* INTO w FROM licensing_private.provider_operation_work pow WHERE pow.work_id=p_work FOR UPDATE;
      IF NOT FOUND OR w.state<>'leased' OR w.lease_epoch<>p_epoch OR w.lease_expires_at<=transaction_timestamp()
         OR w.token_digest<>licensing_private.work_digest(p_token) THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='stale operation work'; END IF;
      SELECT pdp.* INTO p FROM licensing_private.provider_dispatch_permits pdp WHERE pdp.dispatch_permit_id=p_permit FOR UPDATE;
      IF p.dispatch_permit_id IS NULL OR o.provider_operation_id IS NULL OR p.work_id<>w.work_id OR p.state<>'issued'
         OR p.expires_at<=transaction_timestamp() OR p.operation_kind<>p_kind
         OR s.account_id IS NULL OR s.account_id<>o.account_id OR s.slot_ownership_id<>o.slot_ownership_id
         OR s.current_provider_operation_id IS DISTINCT FROM o.provider_operation_id
         OR NOT ((s.state='attempt_held' AND s.holder_attempt_id=o.purchase_attempt_id AND o.provider_agreement_id IS NULL)
           OR (s.state='agreement_held' AND s.holder_agreement_id=o.provider_agreement_id AND o.provider_agreement_id IS NOT NULL))
         OR o.state<>'permit_issued' OR o.operation_revision<>p.operation_revision THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='dispatch permit is stale'; END IF;
      consumed_at:=transaction_timestamp(); UPDATE licensing_private.provider_dispatch_permits SET state='consumed',consumed_at=consume_dispatch_permit.consumed_at WHERE provider_dispatch_permits.dispatch_permit_id=p_permit;
      IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='dispatch permit is stale'; END IF;
      UPDATE licensing_private.provider_operations SET state='dispatch_consumed',operation_revision=provider_operations.operation_revision+1,updated_at=transaction_timestamp()
        WHERE account_id=w.account_id AND provider_operations.provider_operation_id=o.provider_operation_id;
      dispatch_permit_id:=p.dispatch_permit_id; provider_operation_id:=o.provider_operation_id; operation_revision:=p.operation_revision;
      operation_kind:=o.operation_kind; dispatch_attempt:=p.dispatch_attempt; expires_at:=p.expires_at; provider:=o.provider;
      provider_idempotency_key:=o.provider_idempotency_key; RETURN NEXT; END $f$;

    CREATE FUNCTION licensing_worker_api.record_operation_result(p_work uuid,p_epoch bigint,p_token bytea,p_permit uuid,p_outcome text,
      p_response_digest bytea,p_resource_kinds text[],p_resource_ids text[],p_resource_digests bytea[],p_resource_roles text[])
      RETURNS TABLE(state licensing_private.operation_state,response_digest bytea,resource_kinds text[],resource_ids text[],
        resource_digests bytea[],resource_roles text[],disposition text)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,licensing_private SET row_security=on AS $f$
    DECLARE w licensing_private.provider_operation_work; p licensing_private.provider_dispatch_permits; o licensing_private.provider_operations;
      claim licensing_private.binding_claims; i integer; existing licensing_private.provider_operation_results;
      refund_request licensing_private.first_purchase_refund_requests; refund_operation uuid; refund_key text;
      refund_slot licensing_private.commercial_provider_slots; lock_account text;
    BEGIN SELECT pow.account_id INTO lock_account FROM licensing_private.provider_operation_work pow WHERE pow.work_id=p_work;
      IF lock_account IS NULL THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='stale operation work'; END IF;
      PERFORM pg_advisory_xact_lock(hashtextextended('gooddealer:commercial-account:'||lock_account,0));
      SELECT cps.* INTO refund_slot FROM licensing_private.commercial_provider_slots cps
        WHERE cps.account_id=lock_account FOR UPDATE;
      IF refund_slot.account_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='stale operation work'; END IF;
      SELECT pow.* INTO w FROM licensing_private.provider_operation_work pow WHERE pow.work_id=p_work FOR UPDATE;
      IF NOT FOUND OR w.state<>'leased' OR w.lease_epoch<>p_epoch OR w.lease_expires_at<=transaction_timestamp()
        OR w.account_id<>lock_account OR w.token_digest<>licensing_private.work_digest(p_token)
        THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='stale operation work'; END IF;
      SELECT pdp.* INTO p FROM licensing_private.provider_dispatch_permits pdp
        WHERE pdp.dispatch_permit_id=p_permit AND pdp.work_id=p_work FOR UPDATE;
      SELECT po.* INTO o FROM licensing_private.provider_operations po
        WHERE po.account_id=w.account_id AND po.provider_operation_id=w.provider_operation_id FOR UPDATE;
      IF p.dispatch_permit_id IS NULL OR o.provider_operation_id IS NULL OR p.state<>'consumed'
        OR p.provider_operation_id<>o.provider_operation_id OR p.operation_kind<>o.operation_kind
        OR EXISTS(SELECT 1 FROM licensing_private.provider_dispatch_permits newer_permit
          WHERE newer_permit.provider_operation_id=o.provider_operation_id
            AND newer_permit.operation_revision>p.operation_revision)
        OR octet_length(p_response_digest)<>32 OR refund_slot.slot_ownership_id IS DISTINCT FROM o.slot_ownership_id
        OR refund_slot.current_provider_operation_id IS DISTINCT FROM o.provider_operation_id
        OR NOT ((refund_slot.state='attempt_held' AND refund_slot.holder_attempt_id=o.purchase_attempt_id
              AND o.provider_agreement_id IS NULL)
          OR (refund_slot.state='agreement_held' AND refund_slot.holder_agreement_id=o.provider_agreement_id
              AND o.provider_agreement_id IS NOT NULL))
        THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='dispatch result is stale'; END IF;
      IF coalesce(cardinality(p_resource_kinds),-1)<>coalesce(cardinality(p_resource_ids),-2)
         OR coalesce(cardinality(p_resource_ids),-1)<>coalesce(cardinality(p_resource_digests),-2)
         OR coalesce(cardinality(p_resource_digests),-1)<>coalesce(cardinality(p_resource_roles),-2)
        THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='resource evidence shape is invalid'; END IF;
      FOR i IN 1..cardinality(p_resource_kinds) LOOP
        IF p_resource_kinds[i] IS NULL OR p_resource_kinds[i]='' OR p_resource_ids[i] IS NULL OR p_resource_ids[i]=''
          OR octet_length(p_resource_digests[i])<>32 OR p_resource_roles[i] NOT IN ('created','target','capture_evidence')
          THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='resource evidence is invalid'; END IF;
      END LOOP;
      SELECT por.* INTO existing FROM licensing_private.provider_operation_results por WHERE por.dispatch_permit_id=p_permit;
      IF FOUND THEN IF existing.outcome::text<>p_outcome OR existing.response_digest<>p_response_digest
          OR existing.resource_kinds IS DISTINCT FROM p_resource_kinds OR existing.resource_ids IS DISTINCT FROM p_resource_ids
          OR existing.resource_digests IS DISTINCT FROM p_resource_digests OR existing.resource_roles IS DISTINCT FROM p_resource_roles THEN
          UPDATE licensing_private.provider_operation_work SET state='quarantined',lease_owner=NULL,lease_expires_at=NULL,token_digest=NULL
            WHERE work_id=p_work;
          UPDATE licensing_private.first_purchase_refund_requests request SET state='manual_resolution',
            failure_class='provider_work_quarantined',retry_at=NULL,request_revision=request_revision+1
            WHERE request.account_id=o.account_id AND request.state<>'refunded'
              AND (request.termination_operation_id=o.provider_operation_id
                OR request.refund_operation_id=o.provider_operation_id);
          disposition:='quarantined'; state:=o.state; response_digest:=o.result_digest; RETURN NEXT; RETURN; END IF;
        state:=o.state; response_digest:=existing.response_digest; resource_kinds:=existing.resource_kinds;
        resource_ids:=existing.resource_ids; resource_digests:=existing.resource_digests;
        resource_roles:=existing.resource_roles; disposition:='current'; RETURN NEXT; RETURN;
      ELSE
        IF o.state<>'dispatch_consumed' OR o.operation_revision<>p.operation_revision+1
          THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='dispatch result is stale'; END IF;
        INSERT INTO licensing_private.provider_operation_results(dispatch_permit_id,outcome,response_digest,resource_kinds,resource_ids,
        resource_digests,resource_roles) VALUES(p_permit,p_outcome::licensing_private.operation_state,p_response_digest,p_resource_kinds,
          p_resource_ids,p_resource_digests,p_resource_roles);
      END IF;
      SELECT bc.* INTO claim FROM licensing_private.binding_claims bc
        WHERE bc.account_id=o.account_id AND bc.purchase_attempt_id=o.purchase_attempt_id;
      FOR i IN 1..coalesce(array_length(p_resource_kinds,1),0) LOOP
        IF p_resource_roles[i]='created' THEN
          INSERT INTO licensing_private.provider_resource_bindings VALUES(o.provider,p_resource_kinds[i],p_resource_ids[i],claim.binding_claim_id,
            o.account_id,o.purchase_attempt_id,o.provider_operation_id,p_resource_digests[i],transaction_timestamp()) ON CONFLICT DO NOTHING;
        END IF;
        IF NOT EXISTS(SELECT 1 FROM licensing_private.provider_resource_bindings rb WHERE rb.provider=o.provider
          AND rb.resource_kind=p_resource_kinds[i] AND rb.resource_id=p_resource_ids[i] AND rb.account_id=o.account_id
          AND rb.purchase_attempt_id=o.purchase_attempt_id AND rb.binding_claim_id=claim.binding_claim_id
          AND rb.binding_digest=p_resource_digests[i]) THEN
          UPDATE licensing_private.provider_operation_work SET state='quarantined',lease_owner=NULL,lease_expires_at=NULL,token_digest=NULL
            WHERE work_id=p_work;
          UPDATE licensing_private.first_purchase_refund_requests request SET state='manual_resolution',
            failure_class='provider_work_quarantined',retry_at=NULL,request_revision=request_revision+1
            WHERE request.account_id=o.account_id AND request.state<>'refunded'
              AND (request.termination_operation_id=o.provider_operation_id
                OR request.refund_operation_id=o.provider_operation_id);
          state:=o.state; response_digest:=o.result_digest; resource_kinds:=p_resource_kinds; resource_ids:=p_resource_ids;
          resource_digests:=p_resource_digests; resource_roles:=p_resource_roles; disposition:='quarantined'; RETURN NEXT; RETURN;
        END IF;
        INSERT INTO licensing_private.provider_operation_resource_evidence VALUES(o.account_id,o.provider_operation_id,o.provider,
          p_resource_kinds[i],p_resource_ids[i],p_resource_digests[i],p_resource_roles[i]) ON CONFLICT DO NOTHING;
      END LOOP;
      UPDATE licensing_private.provider_operations SET state=p_outcome::licensing_private.operation_state,result_digest=p_response_digest,
        operation_revision=provider_operations.operation_revision+1,updated_at=transaction_timestamp() WHERE account_id=o.account_id AND provider_operation_id=o.provider_operation_id;
      IF o.operation_kind IN ('subscription_create','fixed_term_checkout_create','fixed_term_order_create')
         AND EXISTS(SELECT 1 FROM licensing_private.commercial_provider_slots s WHERE s.account_id=o.account_id
           AND s.state='attempt_held' AND s.slot_ownership_id=o.slot_ownership_id AND s.current_provider_operation_id=o.provider_operation_id) THEN
        UPDATE licensing_private.purchase_attempts SET state=CASE p_outcome WHEN 'confirmed' THEN 'approval_pending'
          WHEN 'outcome_unknown' THEN 'creation_unknown' WHEN 'rejected' THEN 'rejected' ELSE 'manual_resolution' END
          WHERE account_id=o.account_id AND purchase_attempt_id=o.purchase_attempt_id;
      ELSIF o.operation_kind='subscription_cancel' THEN
        UPDATE licensing_private.cancellation_intents intent SET state=CASE p_outcome WHEN 'confirmed' THEN 'scheduled'
          WHEN 'outcome_unknown' THEN 'outcome_unknown' WHEN 'rejected' THEN 'failed_retryable' ELSE 'manual_resolution' END
          WHERE intent.account_id=o.account_id AND intent.provider_operation_id=o.provider_operation_id
            AND intent.state NOT IN ('scheduled','completed','superseded');
      ELSIF o.operation_kind='subscription_refund_terminate' THEN
        SELECT rr.* INTO refund_request FROM licensing_private.first_purchase_refund_requests rr WHERE rr.account_id=o.account_id
          AND rr.termination_operation_id=o.provider_operation_id FOR UPDATE;
        IF refund_request.refund_request_id IS NOT NULL AND refund_request.state<>'refunded' AND p_outcome='confirmed' THEN
          IF refund_request.refund_operation_id IS NULL THEN
            refund_operation:=gen_random_uuid();
            refund_key:=encode(sha256(convert_to('commercial-first-refund:'||refund_request.refund_request_id::text||':first_purchase_refund','UTF8')),'hex');
            INSERT INTO licensing_private.provider_operations(account_id,provider_operation_id,purchase_attempt_id,provider_agreement_id,
              slot_ownership_id,provider,operation_kind,provider_idempotency_key,request_digest)
              VALUES(o.account_id,refund_operation,o.purchase_attempt_id,o.provider_agreement_id,o.slot_ownership_id,o.provider,
                'first_purchase_refund',refund_key,o.request_digest);
            INSERT INTO licensing_private.commercial_provider_slot_versions VALUES(o.account_id,refund_slot.slot_epoch+1,o.slot_ownership_id,
              'agreement_held','pending_provider_confirmation',NULL,o.provider_agreement_id,refund_operation,transaction_timestamp());
            UPDATE licensing_private.commercial_provider_slots SET slot_epoch=refund_slot.slot_epoch+1,
              current_provider_operation_id=refund_operation WHERE account_id=o.account_id;
            INSERT INTO licensing_private.provider_operation_work(work_id,account_id,provider_operation_id,state)
              VALUES(gen_random_uuid(),o.account_id,refund_operation,'ready');
            UPDATE licensing_private.first_purchase_refund_requests SET state='refund_pending',refund_operation_id=refund_operation,
              failure_class=NULL,retry_at=NULL,request_revision=request_revision+1
              WHERE account_id=o.account_id AND refund_request_id=refund_request.refund_request_id;
          END IF;
        ELSIF refund_request.refund_request_id IS NOT NULL AND refund_request.state<>'refunded' THEN
          UPDATE licensing_private.first_purchase_refund_requests SET
            state=CASE WHEN p_outcome='outcome_unknown' AND w.attempt_count<w.max_attempts THEN 'retry_wait' ELSE 'manual_resolution' END,
            failure_class=CASE p_outcome WHEN 'outcome_unknown' THEN CASE WHEN w.attempt_count<w.max_attempts
              THEN 'provider_outcome_unknown' ELSE 'provider_outcome_unknown_exhausted' END
              WHEN 'rejected' THEN 'provider_rejected' ELSE 'provider_manual_resolution' END,
            retry_at=CASE WHEN p_outcome='outcome_unknown' AND w.attempt_count<w.max_attempts
              THEN transaction_timestamp()+interval '5 seconds' END,request_revision=request_revision+1
            WHERE account_id=o.account_id AND refund_request_id=refund_request.refund_request_id;
        END IF;
      ELSIF o.operation_kind='first_purchase_refund' THEN
        UPDATE licensing_private.first_purchase_refund_requests request SET
          state=CASE WHEN p_outcome='confirmed' THEN 'refund_pending'
            WHEN p_outcome='outcome_unknown' AND w.attempt_count<w.max_attempts THEN 'retry_wait' ELSE 'manual_resolution' END,
          failure_class=CASE WHEN p_outcome='confirmed' THEN NULL WHEN p_outcome='outcome_unknown' THEN CASE WHEN w.attempt_count<w.max_attempts
            THEN 'provider_outcome_unknown' ELSE 'provider_outcome_unknown_exhausted' END
            WHEN p_outcome='rejected' THEN 'provider_rejected' ELSE 'provider_manual_resolution' END,
          retry_at=CASE WHEN p_outcome='outcome_unknown' AND w.attempt_count<w.max_attempts
            THEN transaction_timestamp()+interval '5 seconds' END,
          request_revision=request_revision+1 WHERE request.account_id=o.account_id
            AND request.refund_operation_id=o.provider_operation_id AND request.state<>'refunded';
      END IF;
      IF p_outcome='rejected' AND o.operation_kind<>'subscription_cancel'
         AND EXISTS(SELECT 1 FROM licensing_private.commercial_provider_slots s WHERE s.account_id=o.account_id
           AND s.state='attempt_held' AND s.slot_ownership_id=o.slot_ownership_id AND s.current_provider_operation_id=o.provider_operation_id) THEN
        INSERT INTO licensing_private.replacement_eligibility(eligibility_id,account_id,slot_ownership_id,slot_epoch,holder_kind,
          holder_id,verdict,reason,evidence_digest) SELECT gen_random_uuid(),o.account_id,o.slot_ownership_id,s.slot_epoch,'attempt',
          o.purchase_attempt_id,'eligible',CASE WHEN o.operation_kind='fixed_term_order_capture' THEN 'expired_unpaid' ELSE 'rejected_before_resource' END,
          p_response_digest FROM licensing_private.commercial_provider_slots s WHERE s.account_id=o.account_id;
        INSERT INTO licensing_private.commercial_jobs(job_id,kind,account_id,state)
          VALUES(gen_random_uuid(),'release',o.account_id,'ready');
      END IF;
      UPDATE licensing_private.provider_operation_work SET
        state=CASE WHEN p_outcome='outcome_unknown' AND w.attempt_count>=w.max_attempts THEN 'dead_letter'::licensing_private.job_state
          WHEN p_outcome='outcome_unknown' THEN 'retry_wait'::licensing_private.job_state
          WHEN p_outcome='confirmed' AND ((o.provider='paypal' AND o.operation_kind='subscription_create')
            OR o.operation_kind='fixed_term_order_capture') THEN 'leased'::licensing_private.job_state
          ELSE 'succeeded'::licensing_private.job_state END,
        lease_owner=CASE WHEN p_outcome='confirmed' AND ((o.provider='paypal' AND o.operation_kind='subscription_create')
          OR o.operation_kind='fixed_term_order_capture') THEN provider_operation_work.lease_owner END,
        lease_expires_at=CASE WHEN p_outcome='confirmed' AND ((o.provider='paypal' AND o.operation_kind='subscription_create')
          OR o.operation_kind='fixed_term_order_capture') THEN provider_operation_work.lease_expires_at END,
        token_digest=CASE WHEN p_outcome='confirmed' AND ((o.provider='paypal' AND o.operation_kind='subscription_create')
          OR o.operation_kind='fixed_term_order_capture') THEN provider_operation_work.token_digest END,
        next_attempt_at=CASE WHEN p_outcome='outcome_unknown' THEN transaction_timestamp()+interval '5 seconds'
          ELSE provider_operation_work.next_attempt_at END,
        dead_letter_at=CASE WHEN p_outcome='outcome_unknown' AND w.attempt_count>=w.max_attempts THEN transaction_timestamp() END
        WHERE work_id=p_work;
      IF (o.operation_kind='subscription_cancel' AND p_outcome='confirmed')
        OR (o.operation_kind IN ('subscription_refund_terminate','first_purchase_refund')
          AND EXISTS(SELECT 1 FROM licensing_private.first_purchase_refund_requests terminal_refund
            WHERE terminal_refund.account_id=o.account_id AND terminal_refund.provider_agreement_id=o.provider_agreement_id
              AND terminal_refund.state='refunded')) THEN
        UPDATE licensing_private.commercial_jobs release_job SET next_attempt_at=transaction_timestamp()
          WHERE release_job.kind='release' AND release_job.account_id=o.account_id
            AND release_job.provider_agreement_id=o.provider_agreement_id AND release_job.state='retry_wait';
        INSERT INTO licensing_private.commercial_jobs(job_id,kind,account_id,provider_agreement_id,state)
          SELECT gen_random_uuid(),'release',o.account_id,o.provider_agreement_id,'ready'
          WHERE o.provider_agreement_id IS NOT NULL
            AND NOT EXISTS(SELECT 1 FROM licensing_private.commercial_jobs release_job WHERE release_job.kind='release'
              AND release_job.account_id=o.account_id AND release_job.provider_agreement_id=o.provider_agreement_id
              AND release_job.state IN ('ready','retry_wait','leased'));
      END IF;
      state:=p_outcome::licensing_private.operation_state; response_digest:=p_response_digest; resource_kinds:=p_resource_kinds;
      resource_ids:=p_resource_ids; resource_digests:=p_resource_digests; resource_roles:=p_resource_roles; disposition:='current'; RETURN NEXT; END $f$;

    CREATE FUNCTION licensing_worker_api.read_operation_replay(p_work uuid,p_epoch bigint,p_token bytea)
      RETURNS TABLE(state licensing_private.operation_state,response_digest bytea,resource_kinds text[],resource_ids text[],
        resource_digests bytea[],resource_roles text[],disposition text)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,licensing_private SET row_security=on AS $f$
    DECLARE w licensing_private.provider_operation_work; op_state licensing_private.operation_state;
      op_provider licensing_private.commercial_provider; op_kind licensing_private.operation_kind; op_agreement uuid;
    BEGIN SELECT * INTO w FROM licensing_private.provider_operation_work WHERE work_id=p_work;
      IF NOT FOUND OR w.state<>'leased' OR w.lease_epoch<>p_epoch OR w.lease_expires_at<=transaction_timestamp()
        OR w.token_digest<>licensing_private.work_digest(p_token) THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='stale operation work'; END IF;
      SELECT o.state,o.provider,o.operation_kind,o.provider_agreement_id INTO op_state,op_provider,op_kind,op_agreement
        FROM licensing_private.provider_operations o WHERE o.account_id=w.account_id AND o.provider_operation_id=w.provider_operation_id;
      RETURN QUERY SELECT o.state,o.result_digest,array_agg(e.resource_kind ORDER BY e.resource_kind) FILTER(WHERE e.resource_kind IS NOT NULL),
        array_agg(e.resource_id ORDER BY e.resource_kind) FILTER(WHERE e.resource_id IS NOT NULL),
        array_agg(e.evidence_digest ORDER BY e.resource_kind) FILTER(WHERE e.resource_kind IS NOT NULL),
        array_agg(e.role ORDER BY e.resource_kind) FILTER(WHERE e.resource_kind IS NOT NULL),'current'::text
        FROM licensing_private.provider_operations o LEFT JOIN licensing_private.provider_operation_resource_evidence e
          ON e.account_id=o.account_id AND e.provider_operation_id=o.provider_operation_id
        WHERE o.account_id=w.account_id AND o.provider_operation_id=w.provider_operation_id GROUP BY o.state,o.result_digest;
      IF op_state IN ('confirmed','rejected','manual_resolution') AND NOT (op_state='confirmed' AND op_agreement IS NULL
        AND ((op_provider='paypal' AND op_kind='subscription_create') OR op_kind='fixed_term_order_capture')) THEN
        UPDATE licensing_private.provider_operation_work SET state='succeeded',lease_owner=NULL,lease_expires_at=NULL,token_digest=NULL
          WHERE work_id=p_work;
      END IF; END $f$;

    CREATE FUNCTION licensing_worker_api.lease_receipt_work(p_worker text)
      RETURNS TABLE(work_id uuid,lease_epoch bigint,lease_expires_at timestamptz,raw_token bytea,provider licensing_private.commercial_provider,
        provider_event_id text,payload_digest bytea,event_type text,trigger_resource_kind text,trigger_resource_id text,
        occurred_at timestamptz,authenticated_evidence_ref text)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,licensing_private SET row_security=on AS $f$
    DECLARE j licensing_private.commercial_jobs; raw bytea;
    BEGIN SELECT cj.* INTO j FROM licensing_private.commercial_jobs cj WHERE cj.kind='receipt' AND
        (cj.state='ready' OR (cj.state='retry_wait' AND cj.next_attempt_at<=transaction_timestamp()) OR (cj.state='leased' AND cj.lease_expires_at<=transaction_timestamp()))
        ORDER BY cj.next_attempt_at FOR UPDATE SKIP LOCKED LIMIT 1; IF NOT FOUND THEN RETURN; END IF;
      raw:=licensing_private.random_token(); UPDATE licensing_private.commercial_jobs SET state='leased',lease_epoch=j.lease_epoch+1,lease_owner=p_worker,
        lease_expires_at=transaction_timestamp()+interval '30 seconds',token_digest=licensing_private.work_digest(raw),attempt_count=commercial_jobs.attempt_count+1,
        first_attempt_at=coalesce(first_attempt_at,transaction_timestamp()),last_attempt_at=transaction_timestamp() WHERE job_id=j.job_id
        RETURNING job_id,commercial_jobs.lease_epoch,commercial_jobs.lease_expires_at INTO work_id,lease_epoch,lease_expires_at;
      raw_token:=raw; RETURN QUERY SELECT work_id,lease_epoch,lease_expires_at,raw_token,r.provider,r.provider_event_id,r.payload_digest,
        r.event_type,r.trigger_resource_kind,r.trigger_resource_id,r.occurred_at,r.authenticated_evidence_ref
        FROM licensing_private.provider_receipts r WHERE r.receipt_id=j.receipt_id;
    END $f$;

    CREATE FUNCTION licensing_worker_api.redrive_dead_letter_operation(p_worker text,p_reason text)
      RETURNS TABLE(work_id uuid,lease_epoch bigint,lease_expires_at timestamptz,raw_token bytea,parent_work_id uuid,
        provider licensing_private.commercial_provider,provider_operation_id uuid,operation_revision bigint,
        operation_kind licensing_private.operation_kind,provider_idempotency_key text,request_digest bytea,purchase_attempt_id uuid,
        purchase_kind licensing_private.purchase_kind,offer text,provider_catalog_item text,campaign_code text,
        provider_resource_kind text,provider_resource_id text)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,licensing_private SET row_security=on AS $f$
    DECLARE parent licensing_private.provider_operation_work; o licensing_private.provider_operations; raw bytea;
    BEGIN
      IF p_worker IS NULL OR p_worker='' OR p_reason IS NULL OR p_reason !~ '^[!-~][ -~]{0,159}$'
        THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='dead-letter redrive audit context is invalid'; END IF;
      SELECT pow.* INTO parent FROM licensing_private.provider_operation_work pow WHERE pow.state='dead_letter'
        AND NOT EXISTS(SELECT 1 FROM licensing_private.provider_operation_work child WHERE child.parent_work_id=pow.work_id)
        ORDER BY pow.dead_letter_at,pow.work_id FOR UPDATE SKIP LOCKED LIMIT 1;
      IF NOT FOUND THEN RETURN; END IF;
      SELECT po.* INTO o FROM licensing_private.provider_operations po WHERE po.account_id=parent.account_id
        AND po.provider_operation_id=parent.provider_operation_id FOR UPDATE;
      raw:=licensing_private.random_token(); work_id:=gen_random_uuid(); lease_epoch:=1;
      lease_expires_at:=transaction_timestamp()+interval '30 seconds'; parent_work_id:=parent.work_id;
      INSERT INTO licensing_private.provider_operation_work(work_id,account_id,provider_operation_id,state,lease_epoch,lease_owner,
        lease_expires_at,token_digest,attempt_count,max_attempts,first_attempt_at,last_attempt_at,parent_work_id,redrive_reason)
        VALUES(work_id,parent.account_id,parent.provider_operation_id,'leased',1,p_worker,lease_expires_at,
          licensing_private.work_digest(raw),1,parent.max_attempts,transaction_timestamp(),transaction_timestamp(),parent.work_id,p_reason);
      raw_token:=raw;
      SELECT o.provider,o.provider_operation_id,o.operation_revision,o.operation_kind,o.provider_idempotency_key,o.request_digest,
        pa.purchase_attempt_id,pa.purchase_kind,pa.offer,pa.provider_catalog_item,pa.campaign_code,
        CASE o.operation_kind WHEN 'subscription_cancel' THEN g.canonical_resource_kind
          WHEN 'subscription_refund_terminate' THEN g.canonical_resource_kind
          WHEN 'first_purchase_refund' THEN refund_payment.resource_kind
          WHEN 'fixed_term_order_capture' THEN order_binding.resource_kind END,
        CASE o.operation_kind WHEN 'subscription_cancel' THEN g.canonical_resource_id
          WHEN 'subscription_refund_terminate' THEN g.canonical_resource_id
          WHEN 'first_purchase_refund' THEN refund_payment.resource_id
          WHEN 'fixed_term_order_capture' THEN order_binding.resource_id END
        INTO provider,provider_operation_id,operation_revision,operation_kind,provider_idempotency_key,request_digest,
          purchase_attempt_id,purchase_kind,offer,provider_catalog_item,campaign_code,provider_resource_kind,provider_resource_id
        FROM licensing_private.purchase_attempts pa
        LEFT JOIN licensing_private.provider_agreements g ON g.account_id=o.account_id AND g.provider_agreement_id=o.provider_agreement_id
        LEFT JOIN LATERAL (SELECT rb.resource_kind,rb.resource_id FROM licensing_private.fixed_term_capture_requests fcr
          JOIN licensing_private.provider_resource_bindings rb ON rb.account_id=fcr.account_id AND rb.creating_operation_id=fcr.order_operation_id
          WHERE fcr.account_id=o.account_id AND fcr.capture_operation_id=o.provider_operation_id LIMIT 1) order_binding ON true
        LEFT JOIN licensing_private.first_purchase_refund_requests refund_request ON refund_request.account_id=o.account_id
          AND refund_request.refund_operation_id=o.provider_operation_id
        LEFT JOIN licensing_private.commercial_payment_evidence refund_payment
          ON refund_payment.payment_evidence_id=refund_request.payment_evidence_id
        WHERE pa.account_id=o.account_id AND pa.purchase_attempt_id=o.purchase_attempt_id;
      RETURN NEXT;
    END $f$;

    CREATE FUNCTION licensing_worker_api.redrive_dead_letter_job(p_worker text,p_reason text)
      RETURNS TABLE(work_id uuid,kind licensing_private.job_kind,lease_epoch bigint,lease_expires_at timestamptz,
        raw_token bytea,parent_job_id uuid)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,licensing_private SET row_security=on AS $f$
    DECLARE parent licensing_private.commercial_jobs; raw bytea;
    BEGIN
      IF p_worker IS NULL OR p_worker='' OR p_reason IS NULL OR p_reason !~ '^[!-~][ -~]{0,159}$'
        THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='dead-letter redrive audit context is invalid'; END IF;
      SELECT cj.* INTO parent FROM licensing_private.commercial_jobs cj WHERE cj.state='dead_letter'
        AND NOT EXISTS(SELECT 1 FROM licensing_private.commercial_jobs child WHERE child.parent_job_id=cj.job_id)
        ORDER BY cj.dead_letter_at,cj.job_id FOR UPDATE SKIP LOCKED LIMIT 1;
      IF NOT FOUND THEN RETURN; END IF;
      raw:=licensing_private.random_token(); work_id:=gen_random_uuid(); kind:=parent.kind; lease_epoch:=1;
      lease_expires_at:=transaction_timestamp()+interval '30 seconds'; raw_token:=raw; parent_job_id:=parent.job_id;
      INSERT INTO licensing_private.commercial_jobs(job_id,kind,receipt_id,binding_provider,binding_resource_kind,binding_resource_id,
        account_id,provider_agreement_id,requested_generation,expected_binding_digest,expected_slot_epoch,
        expected_agreement_revision,expected_authority_revision,expected_right_id,state,lease_epoch,lease_owner,lease_expires_at,
        token_digest,attempt_count,max_attempts,max_age,first_attempt_at,last_attempt_at,next_attempt_at,parent_job_id,redrive_reason)
        VALUES(work_id,parent.kind,parent.receipt_id,parent.binding_provider,parent.binding_resource_kind,parent.binding_resource_id,
          parent.account_id,parent.provider_agreement_id,parent.requested_generation,parent.expected_binding_digest,parent.expected_slot_epoch,
          parent.expected_agreement_revision,parent.expected_authority_revision,parent.expected_right_id,'leased',1,p_worker,lease_expires_at,
          licensing_private.work_digest(raw),1,parent.max_attempts,parent.max_age,transaction_timestamp(),transaction_timestamp(),
          transaction_timestamp(),parent.job_id,p_reason);
      RETURN NEXT;
    END $f$;

    CREATE FUNCTION licensing_worker_api.link_receipt_resources_to_agreement(p_work uuid,p_epoch bigint,p_token bytea,
      p_anchor_kind text,p_anchor_id text,p_anchor_digest bytea,p_resource_kinds text[],p_resource_ids text[],
      p_resource_digests bytea[],p_link_roles text[]) RETURNS uuid
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,licensing_private SET row_security=on AS $f$
    DECLARE j licensing_private.commercial_jobs; r licensing_private.provider_receipts;
      anchor licensing_private.provider_resource_bindings; link licensing_private.agreement_resource_links; i integer; trigger_present boolean:=false;
    BEGIN j:=licensing_private.require_work(p_work,p_epoch,p_token,'receipt');
      SELECT pr.* INTO r FROM licensing_private.provider_receipts pr WHERE pr.receipt_id=j.receipt_id;
      IF r.receipt_kind<>'actionable' OR octet_length(p_anchor_digest)<>32
        OR p_anchor_kind IS NULL OR p_anchor_kind='' OR p_anchor_id IS NULL OR p_anchor_id=''
        OR coalesce(cardinality(p_resource_kinds),-1)<>coalesce(cardinality(p_resource_ids),-2)
        OR coalesce(cardinality(p_resource_ids),-1)<>coalesce(cardinality(p_resource_digests),-2)
        OR coalesce(cardinality(p_resource_digests),-1)<>coalesce(cardinality(p_link_roles),-2)
        OR cardinality(p_resource_kinds)<1
        THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='supplemental receipt binding is invalid'; END IF;
      SELECT rb.* INTO anchor FROM licensing_private.provider_resource_bindings rb WHERE rb.provider=r.provider
        AND rb.resource_kind=p_anchor_kind AND rb.resource_id=p_anchor_id AND rb.binding_digest=p_anchor_digest;
      IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='supplemental binding anchor is unavailable'; END IF;
      SELECT arl.* INTO link FROM licensing_private.agreement_resource_links arl WHERE arl.account_id=anchor.account_id
        AND arl.provider=r.provider AND arl.resource_kind=p_anchor_kind AND arl.resource_id=p_anchor_id
        AND arl.link_digest=p_anchor_digest;
      IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='supplemental binding agreement is unavailable'; END IF;
      trigger_present:=(p_anchor_kind=r.trigger_resource_kind AND p_anchor_id=r.trigger_resource_id);
      FOR i IN 1..cardinality(p_resource_kinds) LOOP
        IF p_resource_kinds[i] NOT IN ('invoice','payment_intent','charge','subscription_transaction','sale','capture','refund','dispute')
          OR p_resource_ids[i] IS NULL OR p_resource_ids[i]='' OR octet_length(p_resource_digests[i])<>32
          OR p_link_roles[i] NOT IN ('capture_evidence','initial_payment','refund_evidence','reversal_evidence')
          THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='supplemental receipt evidence is invalid'; END IF;
        trigger_present:=trigger_present OR (p_resource_kinds[i]=r.trigger_resource_kind AND p_resource_ids[i]=r.trigger_resource_id);
        IF p_link_roles[i]='capture_evidence' AND NOT EXISTS(
          SELECT 1 FROM licensing_private.agreement_resource_links arl WHERE arl.account_id=anchor.account_id
            AND arl.provider_agreement_id=link.provider_agreement_id AND arl.provider=r.provider
            AND arl.resource_kind=p_resource_kinds[i] AND arl.resource_id=p_resource_ids[i]
            AND arl.role='capture_evidence' AND arl.link_digest=p_resource_digests[i])
          THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='capture evidence replay is unavailable'; END IF;
        INSERT INTO licensing_private.provider_resource_bindings(provider,resource_kind,resource_id,binding_claim_id,account_id,
          purchase_attempt_id,creating_operation_id,binding_digest) VALUES(r.provider,p_resource_kinds[i],p_resource_ids[i],
            anchor.binding_claim_id,anchor.account_id,anchor.purchase_attempt_id,anchor.creating_operation_id,p_resource_digests[i])
          ON CONFLICT DO NOTHING;
        IF NOT EXISTS(SELECT 1 FROM licensing_private.provider_resource_bindings rb WHERE rb.provider=r.provider
          AND rb.resource_kind=p_resource_kinds[i] AND rb.resource_id=p_resource_ids[i]
          AND rb.binding_claim_id=anchor.binding_claim_id AND rb.account_id=anchor.account_id
          AND rb.purchase_attempt_id=anchor.purchase_attempt_id AND rb.binding_digest=p_resource_digests[i])
          THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='supplemental receipt binding conflicts'; END IF;
        INSERT INTO licensing_private.agreement_resource_links(account_id,provider_agreement_id,provider,resource_kind,resource_id,role,link_digest)
          VALUES(anchor.account_id,link.provider_agreement_id,r.provider,p_resource_kinds[i],p_resource_ids[i],p_link_roles[i],p_resource_digests[i])
          ON CONFLICT DO NOTHING;
        IF NOT EXISTS(SELECT 1 FROM licensing_private.agreement_resource_links arl WHERE arl.account_id=anchor.account_id
          AND arl.provider_agreement_id=link.provider_agreement_id AND arl.provider=r.provider
          AND arl.resource_kind=p_resource_kinds[i] AND arl.resource_id=p_resource_ids[i]
          AND arl.link_digest=p_resource_digests[i]
          AND (arl.role=p_link_roles[i] OR (p_link_roles[i] IN ('refund_evidence','reversal_evidence')
            AND arl.role IN ('initial_payment','capture_evidence'))))
          THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='supplemental agreement link conflicts'; END IF;
      END LOOP;
      IF NOT trigger_present THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='receipt trigger evidence is missing'; END IF;
      RETURN link.provider_agreement_id; END $f$;

    CREATE FUNCTION licensing_worker_api.bind_receipt_work(p_work uuid,p_epoch bigint,p_token bytea,p_payload_digest bytea)
      RETURNS TABLE(disposition text,reconciliation_job_id uuid,requested_generation bigint)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,licensing_private SET row_security=on AS $f$
    DECLARE j licensing_private.commercial_jobs; r licensing_private.provider_receipts; b licensing_private.provider_resource_bindings;
      canonical_binding licensing_private.provider_resource_bindings; g licensing_private.provider_agreements;
      s licensing_private.commercial_provider_slots; a licensing_private.commercial_authorities;
    BEGIN j:=licensing_private.require_work(p_work,p_epoch,p_token,'receipt'); SELECT * INTO r FROM licensing_private.provider_receipts WHERE receipt_id=j.receipt_id;
      IF r.payload_digest<>p_payload_digest THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='receipt digest is stale'; END IF;
      SELECT * INTO b FROM licensing_private.provider_resource_bindings WHERE provider=r.provider AND resource_kind=r.trigger_resource_kind AND resource_id=r.trigger_resource_id;
      IF NOT FOUND THEN disposition:='handoff_required'; RETURN NEXT; RETURN; END IF;
      SELECT pa.* INTO g FROM licensing_private.provider_agreements pa WHERE pa.account_id=b.account_id AND
        ((pa.canonical_provider=b.provider AND pa.canonical_resource_kind=b.resource_kind AND pa.canonical_resource_id=b.resource_id)
          OR EXISTS(SELECT 1 FROM licensing_private.agreement_resource_links arl WHERE arl.account_id=pa.account_id
            AND arl.provider_agreement_id=pa.provider_agreement_id AND arl.provider=b.provider
            AND arl.resource_kind=b.resource_kind AND arl.resource_id=b.resource_id));
      IF NOT FOUND THEN disposition:='handoff_required'; RETURN NEXT; RETURN; END IF;
      SELECT rb.* INTO canonical_binding FROM licensing_private.provider_resource_bindings rb WHERE rb.provider=g.canonical_provider
        AND rb.resource_kind=g.canonical_resource_kind AND rb.resource_id=g.canonical_resource_id;
      SELECT cps.* INTO s FROM licensing_private.commercial_provider_slots cps WHERE cps.account_id=b.account_id FOR UPDATE;
      SELECT ca.* INTO a FROM licensing_private.commercial_authorities ca WHERE ca.account_id=b.account_id FOR UPDATE;
      INSERT INTO licensing_private.provider_resource_cursors VALUES(g.canonical_provider,g.canonical_resource_kind,g.canonical_resource_id,1,0)
        ON CONFLICT(provider,resource_kind,resource_id) DO UPDATE SET latest_requested_generation=provider_resource_cursors.latest_requested_generation+1
        RETURNING latest_requested_generation INTO requested_generation;
      UPDATE licensing_private.commercial_jobs SET state='succeeded'
        WHERE kind='reconciliation' AND account_id=b.account_id AND provider_agreement_id=g.provider_agreement_id
          AND binding_provider=g.canonical_provider AND binding_resource_kind=g.canonical_resource_kind
          AND binding_resource_id=g.canonical_resource_id
          AND commercial_jobs.requested_generation<bind_receipt_work.requested_generation
          AND state IN ('ready','retry_wait');
      reconciliation_job_id:=gen_random_uuid(); INSERT INTO licensing_private.commercial_jobs(job_id,kind,receipt_id,binding_provider,binding_resource_kind,
        binding_resource_id,account_id,provider_agreement_id,requested_generation,expected_binding_digest,expected_slot_epoch,
        expected_agreement_revision,expected_authority_revision,state) VALUES(reconciliation_job_id,'reconciliation',j.receipt_id,g.canonical_provider,
        g.canonical_resource_kind,g.canonical_resource_id,b.account_id,g.provider_agreement_id,requested_generation,canonical_binding.binding_digest,
        s.slot_epoch,g.agreement_revision,coalesce(a.authority_revision,0),'ready');
      UPDATE licensing_private.commercial_jobs SET state='succeeded',lease_owner=NULL,lease_expires_at=NULL,token_digest=NULL WHERE job_id=p_work;
      disposition:='reconciliation_scheduled'; RETURN NEXT; END $f$;

    CREATE FUNCTION licensing_worker_api.fail_bound_work(p_work uuid,p_epoch bigint,p_token bytea,p_failure text,p_retry_after integer)
      RETURNS licensing_private.job_state LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,licensing_private SET row_security=on AS $f$
    DECLARE j licensing_private.commercial_jobs; ow licensing_private.provider_operation_work;
      o licensing_private.provider_operations; s licensing_private.commercial_provider_slots;
      next_state licensing_private.job_state; delay_seconds integer; lock_account text; lock_operation uuid;
    BEGIN SELECT * INTO j FROM licensing_private.commercial_jobs WHERE job_id=p_work;
      IF NOT FOUND THEN
        SELECT account_id,provider_operation_id INTO lock_account,lock_operation
          FROM licensing_private.provider_operation_work WHERE work_id=p_work;
        IF lock_account IS NULL THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='stale commercial work'; END IF;
        PERFORM pg_advisory_xact_lock(hashtextextended('gooddealer:commercial-account:'||lock_account,0));
        SELECT cps.* INTO s FROM licensing_private.commercial_provider_slots cps WHERE cps.account_id=lock_account FOR UPDATE;
        SELECT * INTO ow FROM licensing_private.provider_operation_work WHERE work_id=p_work FOR UPDATE;
        SELECT po.* INTO o FROM licensing_private.provider_operations po
          WHERE po.account_id=lock_account AND po.provider_operation_id=lock_operation FOR UPDATE;
        IF NOT FOUND OR ow.state<>'leased' OR ow.lease_epoch<>p_epoch OR ow.lease_expires_at<=transaction_timestamp()
          OR ow.account_id<>lock_account OR ow.provider_operation_id<>lock_operation
          OR ow.token_digest<>licensing_private.work_digest(p_token)
          OR o.provider_operation_id IS NULL OR s.account_id IS NULL OR s.slot_ownership_id IS DISTINCT FROM o.slot_ownership_id
          OR s.current_provider_operation_id IS DISTINCT FROM o.provider_operation_id
          OR NOT ((s.state='attempt_held' AND s.holder_attempt_id=o.purchase_attempt_id AND o.provider_agreement_id IS NULL)
            OR (s.state='agreement_held' AND s.holder_agreement_id=o.provider_agreement_id AND o.provider_agreement_id IS NOT NULL))
          THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='stale commercial work'; END IF;
        IF o.state IN ('permit_issued','dispatch_consumed') THEN
          UPDATE licensing_private.provider_operations SET state='outcome_unknown',
            operation_revision=provider_operations.operation_revision+1,updated_at=transaction_timestamp()
            WHERE account_id=lock_account AND provider_operation_id=lock_operation
              AND operation_revision=o.operation_revision AND state=o.state;
          IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='stale commercial work'; END IF;
        END IF;
        next_state:=CASE WHEN p_failure IN ('identity_conflict','digest_conflict','unsupported_state') THEN 'quarantined'::licensing_private.job_state
          WHEN ow.attempt_count>=ow.max_attempts THEN 'dead_letter'::licensing_private.job_state ELSE 'retry_wait'::licensing_private.job_state END;
        delay_seconds:=greatest(coalesce(p_retry_after,0),least(1800,5*(2^greatest(ow.attempt_count-1,0))::integer)+(abs(hashtext(ow.work_id::text||':'||ow.attempt_count::text))%5));
        UPDATE licensing_private.provider_operation_work SET state=next_state,lease_owner=NULL,lease_expires_at=NULL,token_digest=NULL,
          next_attempt_at=transaction_timestamp()+make_interval(secs=>delay_seconds),dead_letter_at=CASE WHEN next_state='dead_letter' THEN transaction_timestamp() END
          WHERE work_id=p_work;
        IF o.operation_kind IN ('subscription_refund_terminate','first_purchase_refund') AND next_state='retry_wait' THEN
          UPDATE licensing_private.first_purchase_refund_requests request SET state='retry_wait',
            failure_class=p_failure,retry_at=transaction_timestamp()+make_interval(secs=>delay_seconds),request_revision=request_revision+1
            WHERE request.account_id=o.account_id AND request.state<>'refunded'
              AND (request.termination_operation_id=o.provider_operation_id
                OR request.refund_operation_id=o.provider_operation_id);
        ELSIF next_state IN ('quarantined','dead_letter') AND o.operation_kind IN ('subscription_refund_terminate','first_purchase_refund') THEN
          UPDATE licensing_private.first_purchase_refund_requests request SET state='manual_resolution',
            failure_class=CASE next_state WHEN 'dead_letter' THEN 'provider_work_exhausted' ELSE 'provider_work_quarantined' END,
            retry_at=NULL,request_revision=request_revision+1
            WHERE request.account_id=o.account_id AND request.state<>'refunded'
              AND (request.termination_operation_id=o.provider_operation_id
                OR request.refund_operation_id=o.provider_operation_id);
        END IF;
        RETURN next_state; END IF;
      j:=licensing_private.require_work(p_work,p_epoch,p_token,j.kind);
      next_state:=CASE WHEN p_failure IN ('identity_conflict','digest_conflict','unsupported_state') THEN 'quarantined'::licensing_private.job_state
        WHEN j.attempt_count>=j.max_attempts OR transaction_timestamp()-coalesce(j.first_attempt_at,transaction_timestamp())>=j.max_age THEN 'dead_letter'::licensing_private.job_state
        ELSE 'retry_wait'::licensing_private.job_state END;
      delay_seconds:=greatest(coalesce(p_retry_after,0),least(1800,5*(2^greatest(j.attempt_count-1,0))::integer)+(abs(hashtext(j.job_id::text||':'||j.attempt_count::text))%5));
      UPDATE licensing_private.commercial_jobs SET state=next_state,lease_owner=NULL,lease_expires_at=NULL,token_digest=NULL,
        next_attempt_at=transaction_timestamp()+make_interval(secs=>delay_seconds),last_error_class=p_failure,
        dead_letter_at=CASE WHEN next_state='dead_letter' THEN transaction_timestamp() END,
      dead_letter_reason=CASE WHEN next_state='dead_letter' THEN p_failure END WHERE job_id=p_work; RETURN next_state; END $f$;

    CREATE FUNCTION licensing_worker_api.handoff_provider_agreement(p_work uuid,p_epoch bigint,p_token bytea,p_handoff text,
      p_resource_kinds text[],p_resource_ids text[],p_resource_digests bytea[],p_observation_digest bytea,p_captured_at timestamptz,
      p_payment_resource_kinds text[],p_payment_resource_ids text[],p_payment_resource_digests bytea[])
      RETURNS TABLE(provider_agreement_id uuid,slot_epoch bigint,replay text)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,licensing_private SET row_security=on AS $f$
    DECLARE ow licensing_private.provider_operation_work; j licensing_private.commercial_jobs; o licensing_private.provider_operations;
      s licensing_private.commercial_provider_slots; authority licensing_private.commercial_authorities;
      claim licensing_private.binding_claims; canonical_index integer; i integer;
      kind licensing_private.purchase_kind; canonical_kind text; canonical_id text; existing licensing_private.provider_agreements; p_agreement uuid;
    BEGIN
      SELECT * INTO ow FROM licensing_private.provider_operation_work WHERE work_id=p_work;
      IF FOUND THEN
        IF ow.state<>'leased' OR ow.lease_epoch<>p_epoch OR ow.lease_expires_at<=transaction_timestamp()
          OR ow.token_digest<>licensing_private.work_digest(p_token) THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='stale handoff work'; END IF;
        SELECT * INTO o FROM licensing_private.provider_operations WHERE account_id=ow.account_id AND provider_operation_id=ow.provider_operation_id;
      ELSE
        SELECT * INTO j FROM licensing_private.commercial_jobs WHERE job_id=p_work FOR UPDATE;
        IF NOT FOUND OR j.state<>'leased' OR j.lease_epoch<>p_epoch OR j.lease_expires_at<=transaction_timestamp()
          OR j.token_digest<>licensing_private.work_digest(p_token) OR j.kind NOT IN ('receipt','reconciliation')
          THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='stale handoff work'; END IF;
        SELECT po.* INTO o FROM licensing_private.provider_operations po JOIN licensing_private.provider_resource_bindings rb
          ON rb.account_id=po.account_id AND rb.creating_operation_id=po.provider_operation_id
          WHERE rb.provider=j.binding_provider AND rb.resource_kind=j.binding_resource_kind AND rb.resource_id=j.binding_resource_id LIMIT 1;
        IF NOT FOUND AND j.receipt_id IS NOT NULL THEN SELECT po.* INTO o FROM licensing_private.provider_operations po
          JOIN licensing_private.provider_resource_bindings rb ON rb.account_id=po.account_id AND rb.creating_operation_id=po.provider_operation_id
          JOIN licensing_private.provider_receipts r ON r.provider=rb.provider AND r.trigger_resource_kind=rb.resource_kind AND r.trigger_resource_id=rb.resource_id
          WHERE r.receipt_id=j.receipt_id LIMIT 1; END IF;
      END IF;
      IF p_handoff='paypal_fixed_term' AND o.operation_kind='fixed_term_order_create' THEN
        SELECT capture.* INTO o FROM licensing_private.fixed_term_capture_requests capture_request
          JOIN licensing_private.provider_operations capture ON capture.account_id=o.account_id
            AND capture.provider_operation_id=capture_request.capture_operation_id
          WHERE capture_request.account_id=o.account_id AND capture_request.order_operation_id=o.provider_operation_id
          ORDER BY capture.created_at DESC LIMIT 1;
      END IF;
      IF o.provider_operation_id IS NULL OR o.state<>'confirmed' THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='handoff operation is not confirmed'; END IF;
      SELECT * INTO s FROM licensing_private.commercial_provider_slots WHERE account_id=o.account_id FOR UPDATE;
      IF octet_length(p_observation_digest)<>32 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='handoff evidence is invalid'; END IF;
      IF p_handoff='stripe_subscription' THEN canonical_index:=2; kind:='subscription';
        IF o.provider<>'stripe' OR o.operation_kind<>'subscription_create' OR cardinality(p_resource_kinds)<>2
          OR p_resource_kinds IS DISTINCT FROM ARRAY['checkout_session','subscription']::text[] OR p_captured_at IS NOT NULL
          THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='handoff evidence shape is invalid'; END IF;
      ELSIF p_handoff='paypal_subscription' THEN canonical_index:=1; kind:='subscription';
        IF o.provider<>'paypal' OR o.operation_kind<>'subscription_create' OR cardinality(p_resource_kinds)<>1
          OR p_resource_kinds IS DISTINCT FROM ARRAY['subscription']::text[] OR p_captured_at IS NOT NULL
          THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='handoff evidence shape is invalid'; END IF;
      ELSIF p_handoff='stripe_fixed_term' THEN canonical_index:=1; kind:='fixed_term';
        IF o.provider<>'stripe' OR o.operation_kind<>'fixed_term_checkout_create' OR cardinality(p_resource_kinds)<>1
          OR p_resource_kinds IS DISTINCT FROM ARRAY['checkout_session']::text[] OR p_captured_at IS NULL
          THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='handoff evidence shape is invalid'; END IF;
      ELSIF p_handoff='paypal_fixed_term' THEN canonical_index:=1; kind:='fixed_term';
        IF o.provider<>'paypal' OR o.operation_kind<>'fixed_term_order_capture' OR cardinality(p_resource_kinds)<>2
          OR p_resource_kinds IS DISTINCT FROM ARRAY['order','capture']::text[] OR p_captured_at IS NULL
          THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='handoff evidence shape is invalid'; END IF;
      ELSE RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='unknown agreement handoff'; END IF;
      IF coalesce(cardinality(p_resource_kinds),-1)<>coalesce(cardinality(p_resource_ids),-2)
        OR coalesce(cardinality(p_resource_ids),-1)<>coalesce(cardinality(p_resource_digests),-2)
        OR coalesce(cardinality(p_payment_resource_kinds),-1)<>coalesce(cardinality(p_payment_resource_ids),-2)
        OR coalesce(cardinality(p_payment_resource_ids),-1)<>coalesce(cardinality(p_payment_resource_digests),-2)
        THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='handoff evidence shape is invalid'; END IF;
      FOR i IN 1..cardinality(p_resource_kinds) LOOP
        IF p_resource_ids[i] IS NULL OR p_resource_ids[i]='' OR octet_length(p_resource_digests[i])<>32
          THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='handoff evidence is invalid'; END IF;
      END LOOP;
      FOR i IN 1..coalesce(cardinality(p_payment_resource_kinds),0) LOOP
        IF p_payment_resource_kinds[i] NOT IN ('invoice','payment_intent','charge','subscription_transaction','sale','capture')
          OR p_payment_resource_ids[i] IS NULL OR p_payment_resource_ids[i]='' OR octet_length(p_payment_resource_digests[i])<>32
          THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='initial payment handoff evidence is invalid'; END IF;
      END LOOP;
      canonical_kind:=p_resource_kinds[canonical_index]; canonical_id:=p_resource_ids[canonical_index];
      SELECT pa.* INTO existing FROM licensing_private.provider_agreements pa WHERE pa.canonical_provider=o.provider
        AND pa.canonical_resource_kind=canonical_kind AND pa.canonical_resource_id=canonical_id;
      IF FOUND THEN
        IF existing.account_id<>o.account_id OR existing.purchase_attempt_id<>o.purchase_attempt_id OR existing.purchase_kind<>kind
          OR s.state<>'agreement_held' OR s.slot_ownership_id<>o.slot_ownership_id
          OR s.holder_agreement_id<>existing.provider_agreement_id OR existing.handoff_digest<>p_observation_digest
          OR existing.handoff_captured_at IS DISTINCT FROM p_captured_at
          THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='agreement handoff conflict'; END IF;
        FOR i IN 1..cardinality(p_resource_kinds) LOOP
          IF NOT EXISTS(SELECT 1 FROM licensing_private.agreement_resource_links arl WHERE arl.account_id=o.account_id
            AND arl.provider_agreement_id=existing.provider_agreement_id AND arl.provider=o.provider
            AND arl.resource_kind=p_resource_kinds[i] AND arl.resource_id=p_resource_ids[i]
            AND arl.link_digest=p_resource_digests[i])
            THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='agreement handoff conflict'; END IF;
        END LOOP;
        FOR i IN 1..coalesce(cardinality(p_payment_resource_kinds),0) LOOP
          IF NOT EXISTS(SELECT 1 FROM licensing_private.agreement_resource_links arl WHERE arl.account_id=o.account_id
            AND arl.provider_agreement_id=existing.provider_agreement_id AND arl.provider=o.provider
            AND arl.resource_kind=p_payment_resource_kinds[i] AND arl.resource_id=p_payment_resource_ids[i]
            AND arl.role IN ('initial_payment','capture_evidence') AND arl.link_digest=p_payment_resource_digests[i])
            THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='agreement handoff payment conflict'; END IF;
        END LOOP;
        UPDATE licensing_private.provider_operation_work SET state='succeeded',lease_owner=NULL,lease_expires_at=NULL,token_digest=NULL
          WHERE work_id=p_work;
        UPDATE licensing_private.commercial_jobs SET state='succeeded',lease_owner=NULL,lease_expires_at=NULL,token_digest=NULL
          WHERE job_id=p_work;
        provider_agreement_id:=existing.provider_agreement_id; slot_epoch:=s.slot_epoch; replay:='same_handoff'; RETURN NEXT; RETURN;
      END IF;
      IF s.state<>'attempt_held' OR s.slot_ownership_id<>o.slot_ownership_id OR s.holder_attempt_id<>o.purchase_attempt_id
        THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='handoff slot is stale'; END IF;
      SELECT * INTO claim FROM licensing_private.binding_claims WHERE account_id=o.account_id AND purchase_attempt_id=o.purchase_attempt_id;
      FOR i IN 1..array_length(p_resource_kinds,1) LOOP
        INSERT INTO licensing_private.provider_resource_bindings VALUES(o.provider,p_resource_kinds[i],p_resource_ids[i],claim.binding_claim_id,
          o.account_id,o.purchase_attempt_id,o.provider_operation_id,p_resource_digests[i],transaction_timestamp()) ON CONFLICT DO NOTHING;
        IF NOT EXISTS(SELECT 1 FROM licensing_private.provider_resource_bindings rb WHERE rb.provider=o.provider AND rb.resource_kind=p_resource_kinds[i]
          AND rb.resource_id=p_resource_ids[i] AND rb.account_id=o.account_id AND rb.purchase_attempt_id=o.purchase_attempt_id
          AND rb.binding_claim_id=claim.binding_claim_id AND rb.binding_digest=p_resource_digests[i]) THEN
          UPDATE licensing_private.provider_operation_work SET state='quarantined',lease_owner=NULL,lease_expires_at=NULL,token_digest=NULL WHERE work_id=p_work;
          RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='provider resource identity conflict'; END IF;
      END LOOP;
      FOR i IN 1..coalesce(cardinality(p_payment_resource_kinds),0) LOOP
        INSERT INTO licensing_private.provider_resource_bindings VALUES(o.provider,p_payment_resource_kinds[i],p_payment_resource_ids[i],
          claim.binding_claim_id,o.account_id,o.purchase_attempt_id,o.provider_operation_id,p_payment_resource_digests[i],transaction_timestamp())
          ON CONFLICT DO NOTHING;
        IF NOT EXISTS(SELECT 1 FROM licensing_private.provider_resource_bindings rb WHERE rb.provider=o.provider
          AND rb.resource_kind=p_payment_resource_kinds[i] AND rb.resource_id=p_payment_resource_ids[i]
          AND rb.account_id=o.account_id AND rb.purchase_attempt_id=o.purchase_attempt_id
          AND rb.binding_claim_id=claim.binding_claim_id AND rb.binding_digest=p_payment_resource_digests[i])
          THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='initial payment resource identity conflict'; END IF;
      END LOOP;
      p_agreement:=gen_random_uuid();
      INSERT INTO licensing_private.provider_agreements(account_id,provider_agreement_id,purchase_attempt_id,provider,purchase_kind,canonical_provider,
        canonical_resource_kind,canonical_resource_id,state,provider_access,renewal_disposition,protected_paid_through,handoff_digest,handoff_captured_at)
        VALUES(o.account_id,p_agreement,o.purchase_attempt_id,o.provider,kind,o.provider,canonical_kind,canonical_id,'pending','pending',
          CASE WHEN kind='fixed_term' THEN 'nonrenewing' ELSE 'unknown' END,
          CASE WHEN kind='fixed_term' THEN p_captured_at+interval '10 years' END,p_observation_digest,p_captured_at);
      FOR i IN 1..array_length(p_resource_kinds,1) LOOP
        INSERT INTO licensing_private.agreement_resource_links VALUES(o.account_id,p_agreement,o.provider,p_resource_kinds[i],p_resource_ids[i],
          CASE WHEN i=canonical_index THEN 'canonical_agreement' WHEN p_handoff LIKE 'stripe_%' THEN 'checkout_origin'
            WHEN p_handoff='paypal_fixed_term' AND i=2 THEN 'capture_evidence' ELSE 'order_origin' END,
          p_resource_digests[i]) ON CONFLICT DO NOTHING; END LOOP;
      FOR i IN 1..coalesce(cardinality(p_payment_resource_kinds),0) LOOP
        IF EXISTS(SELECT 1 FROM licensing_private.agreement_resource_links arl WHERE arl.account_id=o.account_id
          AND arl.provider_agreement_id=p_agreement AND arl.provider=o.provider
          AND arl.resource_kind=p_payment_resource_kinds[i] AND arl.resource_id=p_payment_resource_ids[i]
          AND arl.role='capture_evidence' AND arl.link_digest=p_payment_resource_digests[i]) THEN CONTINUE; END IF;
        INSERT INTO licensing_private.agreement_resource_links(account_id,provider_agreement_id,provider,resource_kind,resource_id,role,link_digest)
          VALUES(o.account_id,p_agreement,o.provider,p_payment_resource_kinds[i],p_payment_resource_ids[i],'initial_payment',
            p_payment_resource_digests[i]);
      END LOOP;
      slot_epoch:=s.slot_epoch+1;
      INSERT INTO licensing_private.commercial_provider_slot_versions VALUES(o.account_id,slot_epoch,s.slot_ownership_id,'agreement_held',
        'not_requested',NULL,p_agreement,o.provider_operation_id,transaction_timestamp());
      UPDATE licensing_private.commercial_provider_slots SET slot_epoch=handoff_provider_agreement.slot_epoch,
        state='agreement_held',holder_attempt_id=NULL,holder_agreement_id=p_agreement WHERE account_id=o.account_id;
      UPDATE licensing_private.purchase_attempts SET state='agreement_bound' WHERE account_id=o.account_id AND purchase_attempt_id=o.purchase_attempt_id;
      UPDATE licensing_private.provider_operations SET provider_agreement_id=p_agreement WHERE account_id=o.account_id AND provider_operation_id=o.provider_operation_id;
      INSERT INTO licensing_private.provider_resource_cursors VALUES(o.provider,canonical_kind,canonical_id,1,0);
      SELECT ca.* INTO authority FROM licensing_private.commercial_authorities ca WHERE ca.account_id=o.account_id FOR UPDATE;
      INSERT INTO licensing_private.commercial_jobs(job_id,kind,binding_provider,binding_resource_kind,binding_resource_id,account_id,
        provider_agreement_id,requested_generation,expected_binding_digest,expected_slot_epoch,expected_agreement_revision,
        expected_authority_revision,state) VALUES(gen_random_uuid(),'reconciliation',o.provider,canonical_kind,canonical_id,o.account_id,
          p_agreement,1,p_resource_digests[canonical_index],slot_epoch,1,coalesce(authority.authority_revision,0),'ready');
      UPDATE licensing_private.provider_operation_work SET state='succeeded',lease_owner=NULL,lease_expires_at=NULL,token_digest=NULL
        WHERE work_id=p_work;
      UPDATE licensing_private.commercial_jobs SET state='succeeded',lease_owner=NULL,lease_expires_at=NULL,token_digest=NULL
        WHERE job_id=p_work;
      provider_agreement_id:=p_agreement; replay:='created'; RETURN NEXT; END $f$;

    CREATE FUNCTION licensing_worker_api.lease_reconciliation_work(p_worker text)
      RETURNS TABLE(work_id uuid,lease_epoch bigint,lease_expires_at timestamptz,raw_token bytea,requested_generation bigint,
        provider licensing_private.commercial_provider,provider_resource_kind text,provider_resource_id text,purchase_kind licensing_private.purchase_kind,
        expected_binding_digest bytea,expected_slot_epoch bigint,expected_agreement_revision bigint,expected_authority_revision bigint,
        receipt_event_type text,receipt_provider_event_id text,receipt_trigger_resource_kind text,receipt_trigger_resource_id text)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,licensing_private SET row_security=on AS $f$
    DECLARE j licensing_private.commercial_jobs; raw bytea;
    BEGIN SELECT cj.* INTO j FROM licensing_private.commercial_jobs cj WHERE cj.kind='reconciliation' AND
        (cj.state='ready' OR (cj.state='retry_wait' AND cj.next_attempt_at<=transaction_timestamp()) OR (cj.state='leased' AND cj.lease_expires_at<=transaction_timestamp()))
        ORDER BY cj.next_attempt_at FOR UPDATE SKIP LOCKED LIMIT 1; IF NOT FOUND THEN RETURN; END IF;
      raw:=licensing_private.random_token(); UPDATE licensing_private.commercial_jobs SET state='leased',lease_epoch=j.lease_epoch+1,lease_owner=p_worker,
        lease_expires_at=transaction_timestamp()+interval '30 seconds',token_digest=licensing_private.work_digest(raw),attempt_count=commercial_jobs.attempt_count+1,
        first_attempt_at=coalesce(first_attempt_at,transaction_timestamp()),last_attempt_at=transaction_timestamp() WHERE job_id=j.job_id
        RETURNING job_id,commercial_jobs.lease_epoch,commercial_jobs.lease_expires_at INTO work_id,lease_epoch,lease_expires_at;
      raw_token:=raw; requested_generation:=j.requested_generation; provider:=j.binding_provider;
      provider_resource_kind:=j.binding_resource_kind; provider_resource_id:=j.binding_resource_id;
      expected_binding_digest:=j.expected_binding_digest; expected_slot_epoch:=j.expected_slot_epoch;
      expected_agreement_revision:=j.expected_agreement_revision; expected_authority_revision:=j.expected_authority_revision;
      SELECT g.purchase_kind INTO purchase_kind FROM licensing_private.provider_agreements g
        WHERE g.account_id=j.account_id AND g.provider_agreement_id=j.provider_agreement_id;
      SELECT r.event_type,r.provider_event_id,r.trigger_resource_kind,r.trigger_resource_id
        INTO receipt_event_type,receipt_provider_event_id,receipt_trigger_resource_kind,receipt_trigger_resource_id
        FROM licensing_private.provider_receipts r WHERE r.receipt_id=j.receipt_id;
      RETURN NEXT; END $f$;

    CREATE FUNCTION licensing_worker_api.lease_due_authority_work(p_worker text)
      RETURNS TABLE(work_id uuid,lease_epoch bigint,lease_expires_at timestamptz,raw_token bytea,
        expected_slot_epoch bigint,expected_agreement_revision bigint,expected_authority_revision bigint,expected_right_id uuid)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,licensing_private SET row_security=on AS $f$
    DECLARE j licensing_private.commercial_jobs; raw bytea;
    BEGIN SELECT cj.* INTO j FROM licensing_private.commercial_jobs cj WHERE cj.kind='due_authority' AND
        ((cj.state IN ('ready','retry_wait') AND cj.next_attempt_at<=transaction_timestamp())
          OR (cj.state='leased' AND cj.lease_expires_at<=transaction_timestamp()))
        ORDER BY cj.next_attempt_at FOR UPDATE SKIP LOCKED LIMIT 1; IF NOT FOUND THEN RETURN; END IF;
      raw:=licensing_private.random_token(); UPDATE licensing_private.commercial_jobs SET state='leased',lease_epoch=j.lease_epoch+1,lease_owner=p_worker,
        lease_expires_at=transaction_timestamp()+interval '30 seconds',token_digest=licensing_private.work_digest(raw),attempt_count=commercial_jobs.attempt_count+1,
        first_attempt_at=coalesce(first_attempt_at,transaction_timestamp()),last_attempt_at=transaction_timestamp() WHERE job_id=j.job_id
        RETURNING job_id,commercial_jobs.lease_epoch,commercial_jobs.lease_expires_at INTO work_id,lease_epoch,lease_expires_at;
      raw_token:=raw; expected_slot_epoch:=j.expected_slot_epoch; expected_agreement_revision:=j.expected_agreement_revision;
      expected_authority_revision:=j.expected_authority_revision; expected_right_id:=j.expected_right_id; RETURN NEXT; END $f$;

    CREATE FUNCTION licensing_worker_api.lease_release_work(p_worker text)
      RETURNS TABLE(work_id uuid,lease_epoch bigint,lease_expires_at timestamptz,raw_token bytea)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,licensing_private SET row_security=on AS $f$
    DECLARE j licensing_private.commercial_jobs; raw bytea;
    BEGIN SELECT cj.* INTO j FROM licensing_private.commercial_jobs cj WHERE cj.kind='release' AND
        (cj.state='ready' OR (cj.state='retry_wait' AND cj.next_attempt_at<=transaction_timestamp()) OR (cj.state='leased' AND cj.lease_expires_at<=transaction_timestamp()))
        ORDER BY cj.next_attempt_at FOR UPDATE SKIP LOCKED LIMIT 1; IF NOT FOUND THEN RETURN; END IF;
      raw:=licensing_private.random_token(); UPDATE licensing_private.commercial_jobs SET state='leased',lease_epoch=j.lease_epoch+1,lease_owner=p_worker,
        lease_expires_at=transaction_timestamp()+interval '30 seconds',token_digest=licensing_private.work_digest(raw),attempt_count=commercial_jobs.attempt_count+1,
        first_attempt_at=coalesce(first_attempt_at,transaction_timestamp()),last_attempt_at=transaction_timestamp() WHERE job_id=j.job_id
        RETURNING job_id,commercial_jobs.lease_epoch,commercial_jobs.lease_expires_at INTO work_id,lease_epoch,lease_expires_at;
      raw_token:=raw; RETURN NEXT; END $f$;

    CREATE FUNCTION licensing_worker_api.apply_agreement_observation_and_authority(p_work uuid,p_generation bigint,p_epoch bigint,p_token bytea,
      p_expected_binding_digest bytea,p_expected_slot_epoch bigint,p_expected_agreement_revision bigint,p_expected_authority_revision bigint,
      p_access text,p_renewal text,p_paid_through timestamptz,p_observed_at timestamptz,p_plan text,p_features text[],p_reversal text,p_digest bytea,
      p_payment_purpose text,p_payment_resource_kind text,p_payment_resource_id text,p_payment_digest bytea,p_payment_settled_at timestamptz,
      p_payment_gross_minor bigint,p_payment_currency text,p_cumulative_refunded_minor bigint,p_payment_source_digest bytea,p_refund_fact text)
      RETURNS TABLE(disposition text,authority_revision bigint,right_id uuid)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,licensing_private SET row_security=on AS $f$
    DECLARE j licensing_private.commercial_jobs; g licensing_private.provider_agreements; s licensing_private.commercial_provider_slots;
      attempt licensing_private.purchase_attempts;
      c licensing_private.provider_resource_cursors; binding licensing_private.provider_resource_bindings;
      old_authority licensing_private.commercial_authorities; old_right licensing_private.commercial_rights;
      payment licensing_private.commercial_payment_evidence; refund_head licensing_private.commercial_payment_refund_heads;
      eligibility licensing_private.first_paid_purchase_eligibilities;
      accepted_refund licensing_private.first_purchase_refund_requests;
      refund_evidence licensing_private.agreement_refund_evidence_heads; current_receipt licensing_private.provider_receipts;
      obs uuid; payment_id uuid; new_state text; expires_at timestamptz; grants boolean; projection bytea; changed boolean;
      refund_locked boolean; refund_evidence_locked boolean; refund_settled_locked boolean; durable_full_refund boolean;
      exact_refund_settled boolean; incoming_refund_blocking boolean;
      requires_reread boolean; reread_receipt_id uuid; retry_generation bigint; retry_delay integer;
    BEGIN j:=licensing_private.require_work(p_work,p_epoch,p_token,'reconciliation');
      IF j.requested_generation IS DISTINCT FROM p_generation OR j.expected_binding_digest IS DISTINCT FROM p_expected_binding_digest
        OR j.expected_slot_epoch IS DISTINCT FROM p_expected_slot_epoch OR j.expected_agreement_revision IS DISTINCT FROM p_expected_agreement_revision
        OR j.expected_authority_revision IS DISTINCT FROM p_expected_authority_revision
        THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='reconciliation snapshot is stale'; END IF;
      IF octet_length(p_digest)<>32 OR p_observed_at>transaction_timestamp()+interval '5 minutes' OR p_features IS NULL
        OR p_refund_fact NOT IN ('none','refund_pending','refund_succeeded','refund_failed','partial_refund','dispute_pending','full_reversal_settled','partial_reversal','fraud_signal')
        THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='normalized observation is invalid'; END IF;
      SELECT cps.* INTO s FROM licensing_private.commercial_provider_slots cps WHERE cps.account_id=j.account_id FOR UPDATE;
      SELECT pa.* INTO g FROM licensing_private.provider_agreements pa WHERE pa.account_id=j.account_id AND pa.provider_agreement_id=j.provider_agreement_id FOR UPDATE;
      SELECT pa.* INTO attempt FROM licensing_private.purchase_attempts pa
        WHERE pa.account_id=g.account_id AND pa.purchase_attempt_id=g.purchase_attempt_id;
      SELECT ca.* INTO old_authority FROM licensing_private.commercial_authorities ca WHERE ca.account_id=j.account_id FOR UPDATE;
      IF old_authority.right_id IS NOT NULL THEN SELECT cr.* INTO old_right FROM licensing_private.commercial_rights cr
        WHERE cr.account_id=j.account_id AND cr.right_id=old_authority.right_id FOR UPDATE; END IF;
      SELECT prc.* INTO c FROM licensing_private.provider_resource_cursors prc WHERE prc.provider=j.binding_provider
        AND prc.resource_kind=j.binding_resource_kind AND prc.resource_id=j.binding_resource_id FOR UPDATE;
      SELECT rb.* INTO binding FROM licensing_private.provider_resource_bindings rb WHERE rb.provider=j.binding_provider
        AND rb.resource_kind=j.binding_resource_kind AND rb.resource_id=j.binding_resource_id;
      SELECT fpe.* INTO eligibility FROM licensing_private.first_paid_purchase_eligibilities fpe
        WHERE fpe.account_id=j.account_id FOR UPDATE;
      SELECT rr.* INTO accepted_refund FROM licensing_private.first_purchase_refund_requests rr
        WHERE rr.account_id=j.account_id AND rr.provider_agreement_id=g.provider_agreement_id
        ORDER BY rr.accepted_at,rr.refund_request_id LIMIT 1 FOR UPDATE;
      PERFORM 1 FROM licensing_private.agreement_refund_evidence_heads arh
        WHERE arh.account_id=j.account_id AND arh.provider_agreement_id=g.provider_agreement_id
        ORDER BY arh.payment_evidence_id FOR UPDATE;
      refund_locked:=coalesce(eligibility.state='claimed' AND eligibility.provider_agreement_id=g.provider_agreement_id,false)
        OR accepted_refund.refund_request_id IS NOT NULL;
      IF c.latest_requested_generation IS DISTINCT FROM p_generation OR p_generation<=coalesce(c.latest_applied_generation,p_generation) THEN disposition:='stale_generation';
      ELSIF binding.binding_digest IS DISTINCT FROM p_expected_binding_digest THEN disposition:='stale_binding';
      ELSIF s.state IS DISTINCT FROM 'agreement_held' OR s.holder_agreement_id IS DISTINCT FROM g.provider_agreement_id
        OR s.slot_epoch IS DISTINCT FROM p_expected_slot_epoch THEN disposition:='stale_slot';
      ELSIF g.agreement_revision IS DISTINCT FROM p_expected_agreement_revision THEN disposition:='stale_agreement';
      ELSIF coalesce(old_authority.authority_revision,0) IS DISTINCT FROM p_expected_authority_revision THEN disposition:='stale_authority';
      ELSE disposition:='applied'; END IF;
      IF disposition<>'applied' THEN UPDATE licensing_private.commercial_jobs SET state='succeeded',lease_owner=NULL,lease_expires_at=NULL,token_digest=NULL
          WHERE job_id=p_work; RETURN NEXT; RETURN; END IF;
      SELECT pr.* INTO current_receipt FROM licensing_private.provider_receipts pr WHERE pr.receipt_id=j.receipt_id;
      IF p_payment_purpose IS NOT NULL THEN
        IF p_payment_purpose NOT IN ('acquisition_initial','renewal','adjustment') OR p_payment_resource_kind IS NULL
          OR p_payment_resource_id IS NULL OR octet_length(p_payment_digest)<>32 OR octet_length(p_payment_source_digest)<>32
          OR p_payment_settled_at>transaction_timestamp()+interval '5 minutes' OR p_payment_gross_minor<1 OR p_payment_currency<>'USD'
          OR p_cumulative_refunded_minor<0 OR p_cumulative_refunded_minor>p_payment_gross_minor
          OR (p_payment_purpose='acquisition_initial' AND
            (p_payment_gross_minor<>attempt.expected_gross_minor OR p_payment_currency<>attempt.expected_currency))
          THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='normalized payment evidence is invalid'; END IF;
        SELECT cpe.* INTO payment FROM licensing_private.commercial_payment_evidence cpe WHERE cpe.provider=g.provider
          AND cpe.resource_kind=p_payment_resource_kind AND cpe.resource_id=p_payment_resource_id;
        IF payment.payment_evidence_id IS NULL THEN
          IF NOT EXISTS(SELECT 1 FROM licensing_private.provider_resource_bindings rb JOIN licensing_private.agreement_resource_links arl
            ON arl.account_id=g.account_id AND arl.provider_agreement_id=g.provider_agreement_id AND arl.provider=rb.provider
              AND arl.resource_kind=rb.resource_kind AND arl.resource_id=rb.resource_id
            WHERE rb.provider=g.provider AND rb.resource_kind=p_payment_resource_kind AND rb.resource_id=p_payment_resource_id
              AND rb.account_id=g.account_id AND rb.purchase_attempt_id=g.purchase_attempt_id AND rb.binding_digest=p_payment_digest
              AND arl.link_digest=p_payment_digest AND (p_payment_purpose<>'acquisition_initial'
                OR arl.role IN ('initial_payment','capture_evidence')))
            THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='payment evidence binding is unavailable'; END IF;
          payment_id:=gen_random_uuid(); INSERT INTO licensing_private.commercial_payment_evidence(payment_evidence_id,account_id,purchase_attempt_id,
            provider_agreement_id,provider,resource_kind,resource_id,purpose,settled_at,gross_minor,currency,cumulative_refunded_minor,
            source_digest,observation_generation) VALUES(payment_id,g.account_id,g.purchase_attempt_id,g.provider_agreement_id,g.provider,
              p_payment_resource_kind,p_payment_resource_id,p_payment_purpose,p_payment_settled_at,p_payment_gross_minor,p_payment_currency,
              p_cumulative_refunded_minor,p_payment_source_digest,p_generation);
          INSERT INTO licensing_private.commercial_payment_refund_heads(payment_evidence_id,cumulative_refunded_minor,source_digest,
            observation_generation) VALUES(payment_id,p_cumulative_refunded_minor,p_payment_source_digest,p_generation);
        ELSE
          SELECT prh.* INTO refund_head FROM licensing_private.commercial_payment_refund_heads prh
            WHERE prh.payment_evidence_id=payment.payment_evidence_id FOR UPDATE;
          IF payment.account_id<>g.account_id OR payment.provider_agreement_id<>g.provider_agreement_id OR payment.purpose<>p_payment_purpose
            OR payment.settled_at<>p_payment_settled_at OR payment.gross_minor<>p_payment_gross_minor OR payment.currency<>p_payment_currency
            OR refund_head.payment_evidence_id IS NULL OR p_cumulative_refunded_minor<refund_head.cumulative_refunded_minor
            THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='payment evidence conflicts'; END IF;
          payment_id:=payment.payment_evidence_id;
          UPDATE licensing_private.commercial_payment_refund_heads SET cumulative_refunded_minor=p_cumulative_refunded_minor,
            source_digest=p_payment_source_digest,observation_generation=p_generation,updated_at=transaction_timestamp()
            WHERE payment_evidence_id=payment_id;
        END IF;
        IF p_payment_purpose='acquisition_initial' THEN
          SELECT fpe.* INTO eligibility FROM licensing_private.first_paid_purchase_eligibilities fpe WHERE fpe.account_id=g.account_id FOR UPDATE;
          IF eligibility.account_id IS NULL THEN INSERT INTO licensing_private.first_paid_purchase_eligibilities(account_id,first_payment_evidence_id,
              purchase_attempt_id,provider_agreement_id,purchase_kind,window_starts_at,window_ends_at,gross_minor,currency,state)
            VALUES(g.account_id,payment_id,g.purchase_attempt_id,g.provider_agreement_id,g.purchase_kind,p_payment_settled_at,
              p_payment_settled_at+interval '336 hours',p_payment_gross_minor,p_payment_currency,'available');
          ELSIF eligibility.first_payment_evidence_id<>payment_id AND eligibility.purchase_attempt_id=g.purchase_attempt_id THEN
            RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='first payment eligibility conflicts';
          END IF;
        END IF;
      END IF;
      obs:=gen_random_uuid();
      exact_refund_settled:=payment_id IS NOT NULL AND (p_refund_fact='full_reversal_settled'
        OR (p_refund_fact='refund_succeeded' AND p_cumulative_refunded_minor=p_payment_gross_minor));
      incoming_refund_blocking:=p_refund_fact NOT IN ('none','refund_failed') AND NOT exact_refund_settled;
      IF (incoming_refund_blocking OR exact_refund_settled)
        AND (payment_id IS NULL OR current_receipt.receipt_id IS NULL OR current_receipt.receipt_kind<>'actionable') THEN
        RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='refund evidence provenance is unavailable';
      END IF;
      IF exact_refund_settled THEN
          INSERT INTO licensing_private.agreement_refund_evidence_heads(account_id,provider_agreement_id,payment_evidence_id,state,
            refund_fact,observation_id,receipt_id,receipt_provider,provider_event_id,trigger_resource_kind,trigger_resource_id)
            VALUES(g.account_id,g.provider_agreement_id,payment_id,'resolved_settled',p_refund_fact,obs,current_receipt.receipt_id,
              current_receipt.provider,current_receipt.provider_event_id,current_receipt.trigger_resource_kind,current_receipt.trigger_resource_id)
            ON CONFLICT(account_id,provider_agreement_id,payment_evidence_id,receipt_provider,trigger_resource_kind,trigger_resource_id) DO UPDATE SET
              state=excluded.state,refund_fact=excluded.refund_fact,observation_id=excluded.observation_id,receipt_id=excluded.receipt_id,
              provider_event_id=excluded.provider_event_id,
              revision=agreement_refund_evidence_heads.revision+1,updated_at=transaction_timestamp()
            RETURNING * INTO refund_evidence;
      ELSIF p_refund_fact='refund_failed' AND payment_id IS NOT NULL AND current_receipt.receipt_id IS NOT NULL
        AND current_receipt.receipt_kind='actionable' THEN
          UPDATE licensing_private.agreement_refund_evidence_heads SET state='resolved_failed',refund_fact=p_refund_fact,
            observation_id=obs,receipt_id=current_receipt.receipt_id,receipt_provider=current_receipt.provider,
            provider_event_id=current_receipt.provider_event_id,trigger_resource_kind=current_receipt.trigger_resource_kind,
            trigger_resource_id=current_receipt.trigger_resource_id,revision=revision+1,updated_at=transaction_timestamp()
            WHERE account_id=g.account_id AND provider_agreement_id=g.provider_agreement_id
              AND payment_evidence_id=payment_id AND receipt_provider=current_receipt.provider
              AND trigger_resource_kind=current_receipt.trigger_resource_kind
              AND trigger_resource_id=current_receipt.trigger_resource_id AND state='blocking' RETURNING * INTO refund_evidence;
      ELSIF incoming_refund_blocking THEN
          INSERT INTO licensing_private.agreement_refund_evidence_heads(account_id,provider_agreement_id,payment_evidence_id,state,
            refund_fact,observation_id,receipt_id,receipt_provider,provider_event_id,trigger_resource_kind,trigger_resource_id)
            VALUES(g.account_id,g.provider_agreement_id,payment_id,'blocking',p_refund_fact,obs,current_receipt.receipt_id,
              current_receipt.provider,current_receipt.provider_event_id,current_receipt.trigger_resource_kind,current_receipt.trigger_resource_id)
            ON CONFLICT(account_id,provider_agreement_id,payment_evidence_id,receipt_provider,trigger_resource_kind,trigger_resource_id) DO UPDATE SET
              state=excluded.state,refund_fact=excluded.refund_fact,observation_id=excluded.observation_id,receipt_id=excluded.receipt_id,
              provider_event_id=excluded.provider_event_id,
              revision=agreement_refund_evidence_heads.revision+1,updated_at=transaction_timestamp()
            WHERE agreement_refund_evidence_heads.state<>'resolved_settled' RETURNING * INTO refund_evidence;
      END IF;
      SELECT EXISTS(SELECT 1 FROM licensing_private.agreement_refund_evidence_heads arh WHERE arh.account_id=g.account_id
          AND arh.provider_agreement_id=g.provider_agreement_id AND arh.state IN ('blocking','resolved_settled')),
        EXISTS(SELECT 1 FROM licensing_private.agreement_refund_evidence_heads arh WHERE arh.account_id=g.account_id
          AND arh.provider_agreement_id=g.provider_agreement_id AND arh.state='resolved_settled'),
        EXISTS(SELECT 1 FROM licensing_private.agreement_refund_evidence_heads arh
          JOIN licensing_private.commercial_payment_evidence evidence ON evidence.payment_evidence_id=arh.payment_evidence_id
          JOIN licensing_private.commercial_payment_refund_heads progress ON progress.payment_evidence_id=evidence.payment_evidence_id
          WHERE arh.account_id=g.account_id AND arh.provider_agreement_id=g.provider_agreement_id
            AND evidence.purpose='acquisition_initial' AND arh.state='resolved_settled'
            AND (arh.refund_fact='full_reversal_settled'
              OR (arh.refund_fact='refund_succeeded' AND progress.cumulative_refunded_minor=evidence.gross_minor)))
        INTO refund_evidence_locked,refund_settled_locked,durable_full_refund;
      expires_at:=CASE WHEN g.purchase_kind='fixed_term' THEN g.protected_paid_through ELSE greatest(g.protected_paid_through,p_paid_through) END;
      IF expires_at IS NULL THEN
        RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='normalized observation lacks a commercial deadline';
      END IF;
      grants:=NOT refund_locked AND NOT refund_evidence_locked AND p_reversal='none' AND p_refund_fact IN ('none','refund_failed')
        AND expires_at IS NOT NULL AND expires_at>transaction_timestamp() AND p_access NOT IN ('suspended','refunded');
      IF grants AND NOT EXISTS(SELECT 1 FROM licensing_private.first_paid_purchase_eligibilities fpe WHERE fpe.account_id=g.account_id)
        THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='paid authority lacks first-payment evidence'; END IF;
      INSERT INTO licensing_private.agreement_observations(observation_id,account_id,provider_agreement_id,requested_generation,lease_epoch,
        provider_access,renewal_disposition,observed_paid_through,observed_at,plan,feature_entitlements,reversal,observation_digest,
        payment_evidence_id,payment_purpose,payment_provider,payment_resource_kind,payment_resource_id,payment_settled_at,payment_gross_minor,
        payment_currency,cumulative_refunded_minor,payment_source_digest,refund_fact,disposition)
        VALUES(obs,g.account_id,g.provider_agreement_id,p_generation,p_epoch,p_access,p_renewal,p_paid_through,p_observed_at,p_plan,p_features,
          p_reversal,p_digest,payment_id,p_payment_purpose,CASE WHEN p_payment_purpose IS NULL THEN NULL ELSE g.provider END,
          p_payment_resource_kind,p_payment_resource_id,p_payment_settled_at,p_payment_gross_minor,p_payment_currency,
          p_cumulative_refunded_minor,p_payment_source_digest,p_refund_fact,'applied');
      new_state:=CASE WHEN refund_locked OR refund_settled_locked OR p_reversal<>'none'
          OR p_refund_fact IN ('full_reversal_settled','fraud_signal') THEN 'revoked'
        WHEN expires_at<=transaction_timestamp() THEN 'expired' WHEN p_access='delinquent' THEN 'grace' WHEN grants THEN 'active' ELSE 'suspended' END;
      UPDATE licensing_private.provider_agreements SET agreement_revision=provider_agreements.agreement_revision+1,
        latest_applied_generation=p_generation,provider_access=p_access,renewal_disposition=p_renewal,protected_paid_through=expires_at,
        current_observation_id=obs,state=CASE WHEN p_reversal<>'none' OR p_refund_fact='full_reversal_settled' THEN 'refunded'
          WHEN p_renewal IN ('nonrenewing','terminated') THEN 'nonrenewing' WHEN p_access='active' THEN 'active'
          WHEN p_access='delinquent' THEN 'delinquent_grace' WHEN p_access='suspended' THEN 'suspended' ELSE 'ended' END
        WHERE account_id=g.account_id AND provider_agreement_id=g.provider_agreement_id AND agreement_revision=p_expected_agreement_revision;
      IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='agreement revision is stale'; END IF;
      changed:=old_authority.authority_revision IS NULL OR old_authority.grants_access<>grants
        OR old_authority.provider_agreement_id IS DISTINCT FROM g.provider_agreement_id OR old_right.state IS DISTINCT FROM new_state
        OR old_right.plan IS DISTINCT FROM p_plan OR old_right.purchase_kind IS DISTINCT FROM g.purchase_kind
        OR old_right.commercial_expires_at IS DISTINCT FROM expires_at OR old_right.feature_entitlements IS DISTINCT FROM p_features;
      IF changed THEN
        authority_revision:=coalesce(old_authority.authority_revision,0)+1; right_id:=gen_random_uuid();
        INSERT INTO licensing_private.commercial_rights(account_id,right_id,provider_agreement_id,state,plan,purchase_kind,commercial_expires_at,
          feature_entitlements,source_observation_id,reason) VALUES(g.account_id,right_id,g.provider_agreement_id,new_state,p_plan,g.purchase_kind,
            expires_at,p_features,obs,'provider_observation');
        INSERT INTO licensing_private.commercial_authorities VALUES(g.account_id,authority_revision,g.provider_agreement_id,right_id,grants,transaction_timestamp())
          ON CONFLICT(account_id) DO UPDATE SET authority_revision=excluded.authority_revision,provider_agreement_id=excluded.provider_agreement_id,
            right_id=excluded.right_id,grants_access=excluded.grants_access,updated_at=excluded.updated_at;
        projection:=sha256(convert_to(g.account_id||':'||authority_revision::text||':'||right_id::text||':'||new_state||':'||p_plan||':'
          ||coalesce(expires_at::text,'')||':'||array_to_string(p_features,','),'UTF8'));
        INSERT INTO licensing_private.account_entitlement_projections VALUES(g.account_id,authority_revision,right_id,new_state,p_plan,g.purchase_kind::text,
          expires_at,p_features,projection,transaction_timestamp()) ON CONFLICT(account_id) DO UPDATE SET authority_revision=excluded.authority_revision,
          right_id=excluded.right_id,state=excluded.state,plan=excluded.plan,purchase_kind=excluded.purchase_kind,
          commercial_expires_at=excluded.commercial_expires_at,feature_entitlements=excluded.feature_entitlements,
          projection_digest=excluded.projection_digest,updated_at=excluded.updated_at;
        INSERT INTO licensing_private.commercial_outbox VALUES(gen_random_uuid(),g.account_id,authority_revision,projection,transaction_timestamp());
      ELSE authority_revision:=old_authority.authority_revision; right_id:=old_authority.right_id; END IF;
      INSERT INTO licensing_private.replacement_eligibility VALUES(gen_random_uuid(),g.account_id,s.slot_ownership_id,s.slot_epoch,'agreement',
        g.provider_agreement_id,CASE WHEN (g.purchase_kind='fixed_term' AND (expires_at<=transaction_timestamp()
          OR durable_full_refund))
          OR (g.purchase_kind='subscription' AND p_renewal IN ('nonrenewing','terminated') AND expires_at<=transaction_timestamp())
          THEN 'eligible' ELSE 'not_eligible' END,
        CASE WHEN g.purchase_kind='fixed_term' AND durable_full_refund THEN 'fixed_term_fully_reversed'
          WHEN g.purchase_kind='fixed_term' AND expires_at<=transaction_timestamp() THEN 'fixed_term_expired'
          WHEN g.purchase_kind='subscription' AND p_renewal IN ('nonrenewing','terminated') AND expires_at<=transaction_timestamp() THEN 'paid_term_ended'
          ELSE 'current_evidence_not_releasable' END,p_digest,transaction_timestamp());
      IF p_refund_fact='full_reversal_settled' AND payment_id IS NOT NULL THEN UPDATE licensing_private.first_paid_purchase_eligibilities
        SET state='externally_reversed',revision=revision+1 WHERE account_id=g.account_id AND first_payment_evidence_id=payment_id AND state<>'claimed'; END IF;
      IF exact_refund_settled THEN
        UPDATE licensing_private.first_purchase_refund_requests SET state='refunded',fulfillment_observation_id=obs,completed_at=transaction_timestamp(),
          request_revision=request_revision+1 WHERE account_id=g.account_id AND payment_evidence_id=payment_id
            AND refund_operation_id IS NOT NULL AND state<>'refunded';
        UPDATE licensing_private.commercial_jobs SET next_attempt_at=transaction_timestamp()
          WHERE kind='release' AND account_id=g.account_id AND provider_agreement_id=g.provider_agreement_id
            AND state='retry_wait';
      END IF;
      SELECT arh.* INTO refund_evidence FROM licensing_private.agreement_refund_evidence_heads arh
        WHERE arh.account_id=g.account_id AND arh.provider_agreement_id=g.provider_agreement_id AND arh.state='blocking'
        ORDER BY arh.updated_at,arh.payment_evidence_id,arh.receipt_provider,arh.trigger_resource_kind,arh.trigger_resource_id LIMIT 1;
      requires_reread:=coalesce(refund_evidence.state='blocking',false); reread_receipt_id:=refund_evidence.receipt_id;
      IF requires_reread AND (j.attempt_count>=j.max_attempts
        OR transaction_timestamp()-coalesce(j.first_attempt_at,transaction_timestamp())>=j.max_age) THEN
        UPDATE licensing_private.provider_resource_cursors SET latest_applied_generation=p_generation
          WHERE provider=j.binding_provider AND resource_kind=j.binding_resource_kind AND resource_id=j.binding_resource_id;
        UPDATE licensing_private.commercial_jobs SET state='dead_letter',lease_owner=NULL,lease_expires_at=NULL,token_digest=NULL,
          dead_letter_at=transaction_timestamp(),dead_letter_reason='provider_convergence_exhausted' WHERE job_id=p_work;
      ELSIF requires_reread THEN
        retry_generation:=p_generation+1;
        retry_delay:=least(1800,5*(2^greatest(j.attempt_count-1,0))::integer)
          +(abs(hashtext(j.job_id::text||':'||j.attempt_count::text))%5);
        UPDATE licensing_private.provider_resource_cursors SET latest_applied_generation=p_generation,
          latest_requested_generation=retry_generation WHERE provider=j.binding_provider
          AND resource_kind=j.binding_resource_kind AND resource_id=j.binding_resource_id;
        UPDATE licensing_private.commercial_jobs SET state='succeeded',lease_owner=NULL,lease_expires_at=NULL,token_digest=NULL WHERE job_id=p_work;
        INSERT INTO licensing_private.commercial_jobs(job_id,kind,receipt_id,binding_provider,binding_resource_kind,binding_resource_id,
          account_id,provider_agreement_id,requested_generation,expected_binding_digest,expected_slot_epoch,
          expected_agreement_revision,expected_authority_revision,state,attempt_count,max_attempts,max_age,first_attempt_at,
          next_attempt_at,parent_job_id,redrive_reason)
          VALUES(gen_random_uuid(),'reconciliation',reread_receipt_id,j.binding_provider,j.binding_resource_kind,j.binding_resource_id,
            g.account_id,g.provider_agreement_id,retry_generation,p_expected_binding_digest,s.slot_epoch,
            p_expected_agreement_revision+1,authority_revision,'retry_wait',j.attempt_count,j.max_attempts,j.max_age,
            coalesce(j.first_attempt_at,transaction_timestamp()),transaction_timestamp()+make_interval(secs=>retry_delay),
            p_work,'provider-convergence-reread');
      ELSE
        UPDATE licensing_private.provider_resource_cursors SET latest_applied_generation=p_generation WHERE provider=j.binding_provider
          AND resource_kind=j.binding_resource_kind AND resource_id=j.binding_resource_id;
        UPDATE licensing_private.commercial_jobs SET state='succeeded',lease_owner=NULL,lease_expires_at=NULL,token_digest=NULL WHERE job_id=p_work;
        UPDATE licensing_private.commercial_jobs SET next_attempt_at=transaction_timestamp()
          WHERE kind='release' AND account_id=g.account_id AND provider_agreement_id=g.provider_agreement_id
            AND state='retry_wait';
      END IF;
      IF expires_at IS NOT NULL THEN INSERT INTO licensing_private.commercial_jobs(job_id,kind,account_id,provider_agreement_id,
          expected_slot_epoch,expected_agreement_revision,expected_authority_revision,expected_right_id,state,next_attempt_at)
        VALUES(gen_random_uuid(),'due_authority',g.account_id,g.provider_agreement_id,s.slot_epoch,p_expected_agreement_revision+1,
          authority_revision,right_id,'ready',expires_at); END IF;
      IF NOT requires_reread AND ((g.purchase_kind='fixed_term' AND (expires_at<=transaction_timestamp() OR durable_full_refund))
        OR (g.purchase_kind='subscription' AND p_renewal IN ('nonrenewing','terminated') AND expires_at<=transaction_timestamp()))
        THEN INSERT INTO licensing_private.commercial_jobs(job_id,kind,account_id,provider_agreement_id,state)
          SELECT gen_random_uuid(),'release',g.account_id,g.provider_agreement_id,'ready'
          WHERE NOT EXISTS(SELECT 1 FROM licensing_private.commercial_jobs release_job WHERE release_job.kind='release'
            AND release_job.account_id=g.account_id AND release_job.provider_agreement_id=g.provider_agreement_id
            AND release_job.state IN ('ready','retry_wait','leased')); END IF;
      RETURN NEXT; END $f$;

    CREATE FUNCTION licensing_worker_api.apply_due_authority(p_work uuid,p_epoch bigint,p_token bytea,
      p_expected_slot_epoch bigint,p_expected_agreement_revision bigint,p_expected_authority_revision bigint,p_expected_right_id uuid)
      RETURNS TABLE(disposition text,authority_revision bigint,right_id uuid)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,licensing_private SET row_security=on AS $f$
    DECLARE j licensing_private.commercial_jobs; a licensing_private.commercial_authorities; r licensing_private.commercial_rights;
      g licensing_private.provider_agreements; s licensing_private.commercial_provider_slots; projection bytea;
    BEGIN j:=licensing_private.require_work(p_work,p_epoch,p_token,'due_authority');
      IF j.expected_slot_epoch IS DISTINCT FROM p_expected_slot_epoch
        OR j.expected_agreement_revision IS DISTINCT FROM p_expected_agreement_revision
        OR j.expected_authority_revision IS DISTINCT FROM p_expected_authority_revision
        OR j.expected_right_id IS DISTINCT FROM p_expected_right_id
        THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='due authority snapshot is stale'; END IF;
      SELECT cps.* INTO s FROM licensing_private.commercial_provider_slots cps WHERE cps.account_id=j.account_id FOR UPDATE;
      SELECT pa.* INTO g FROM licensing_private.provider_agreements pa WHERE pa.account_id=j.account_id
        AND pa.provider_agreement_id=j.provider_agreement_id FOR UPDATE;
      SELECT ca.* INTO a FROM licensing_private.commercial_authorities ca WHERE ca.account_id=j.account_id FOR UPDATE;
      IF a.right_id IS NOT NULL THEN SELECT cr.* INTO r FROM licensing_private.commercial_rights cr
        WHERE cr.account_id=j.account_id AND cr.right_id=a.right_id FOR UPDATE; END IF;
      IF s.slot_epoch IS DISTINCT FROM p_expected_slot_epoch OR s.state<>'agreement_held'
        OR s.holder_agreement_id IS DISTINCT FROM j.provider_agreement_id THEN disposition:='stale_slot';
      ELSIF g.agreement_revision IS DISTINCT FROM p_expected_agreement_revision THEN disposition:='stale_agreement';
      ELSIF a.authority_revision IS DISTINCT FROM p_expected_authority_revision
        OR a.right_id IS DISTINCT FROM p_expected_right_id OR a.provider_agreement_id IS DISTINCT FROM j.provider_agreement_id
        THEN disposition:='stale_authority';
      ELSIF r.right_id IS NULL THEN disposition:='stale_authority';
      ELSE disposition:='applied'; END IF;
      IF disposition<>'applied' THEN
        authority_revision:=a.authority_revision; right_id:=a.right_id;
        UPDATE licensing_private.commercial_jobs SET state='succeeded',lease_owner=NULL,lease_expires_at=NULL,token_digest=NULL WHERE job_id=p_work;
        RETURN NEXT; RETURN;
      END IF;
      IF r.commercial_expires_at>transaction_timestamp() THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='authority deadline is not due'; END IF;
      authority_revision:=a.authority_revision+1; right_id:=gen_random_uuid();
      INSERT INTO licensing_private.commercial_rights(account_id,right_id,provider_agreement_id,state,plan,purchase_kind,
        commercial_expires_at,feature_entitlements,source_observation_id,reason)
        VALUES(r.account_id,right_id,r.provider_agreement_id,'expired',r.plan,r.purchase_kind,
          r.commercial_expires_at,r.feature_entitlements,r.source_observation_id,'commercial_deadline_elapsed');
      UPDATE licensing_private.commercial_authorities SET authority_revision=apply_due_authority.authority_revision,right_id=apply_due_authority.right_id,
        grants_access=false,updated_at=transaction_timestamp() WHERE account_id=j.account_id;
      projection:=sha256(convert_to(j.account_id||':'||authority_revision::text||':'||right_id::text||':expired','UTF8'));
      UPDATE licensing_private.account_entitlement_projections SET authority_revision=apply_due_authority.authority_revision,right_id=apply_due_authority.right_id,
        state='expired',projection_digest=projection,updated_at=transaction_timestamp() WHERE account_id=j.account_id;
      INSERT INTO licensing_private.commercial_outbox VALUES(gen_random_uuid(),j.account_id,authority_revision,projection,transaction_timestamp());
      IF g.purchase_kind='fixed_term' OR (g.purchase_kind='subscription'
        AND g.renewal_disposition IN ('nonrenewing','terminated') AND g.protected_paid_through<=transaction_timestamp()) THEN
        INSERT INTO licensing_private.replacement_eligibility VALUES(gen_random_uuid(),j.account_id,s.slot_ownership_id,s.slot_epoch,'agreement',
          g.provider_agreement_id,'eligible',CASE WHEN g.purchase_kind='fixed_term' THEN 'fixed_term_expired' ELSE 'paid_term_ended' END,
          sha256(convert_to('due:'||p_work::text||':'||p_epoch::text,'UTF8')),transaction_timestamp());
        INSERT INTO licensing_private.commercial_jobs(job_id,kind,account_id,provider_agreement_id,state)
          VALUES(gen_random_uuid(),'release',j.account_id,g.provider_agreement_id,'ready');
      END IF;
      UPDATE licensing_private.commercial_jobs SET state='succeeded',lease_owner=NULL,lease_expires_at=NULL,token_digest=NULL WHERE job_id=p_work;
      RETURN NEXT; END $f$;

    CREATE FUNCTION licensing_worker_api.release_provider_slot(p_work uuid,p_epoch bigint,p_token bytea)
      RETURNS TABLE(released boolean,slot_epoch bigint) LANGUAGE plpgsql SECURITY DEFINER
      SET search_path=pg_catalog,licensing_private SET row_security=on AS $f$
    DECLARE j licensing_private.commercial_jobs; s licensing_private.commercial_provider_slots; a licensing_private.commercial_authorities;
      g licensing_private.provider_agreements; eligible boolean:=false; blocked_refund boolean:=false; durable_full_refund boolean:=false;
      accepted_refund_blocked boolean:=false; cancellation_blocked boolean:=false; current_operation_blocked boolean:=false;
      release_blocked boolean:=false; blocked_reason text;
    BEGIN j:=licensing_private.require_work(p_work,p_epoch,p_token,'release');
      SELECT cps.* INTO s FROM licensing_private.commercial_provider_slots cps WHERE cps.account_id=j.account_id FOR UPDATE;
      SELECT ca.* INTO a FROM licensing_private.commercial_authorities ca WHERE ca.account_id=j.account_id FOR UPDATE;
      IF s.state='attempt_held' THEN
        eligible:=EXISTS(SELECT 1 FROM licensing_private.replacement_eligibility e WHERE e.account_id=j.account_id
          AND e.slot_ownership_id=s.slot_ownership_id AND e.slot_epoch=s.slot_epoch AND e.holder_kind='attempt'
          AND e.holder_id=s.holder_attempt_id AND e.verdict='eligible');
      ELSIF s.state='agreement_held' AND s.holder_agreement_id IS NOT NULL AND NOT coalesce(a.grants_access,false) THEN
        SELECT pa.* INTO g FROM licensing_private.provider_agreements pa WHERE pa.account_id=j.account_id
          AND pa.provider_agreement_id=s.holder_agreement_id FOR UPDATE;
        SELECT EXISTS(SELECT 1 FROM licensing_private.agreement_refund_evidence_heads head
            WHERE head.account_id=g.account_id AND head.provider_agreement_id=g.provider_agreement_id AND head.state='blocking'),
          EXISTS(SELECT 1 FROM licensing_private.agreement_refund_evidence_heads head
            JOIN licensing_private.commercial_payment_evidence evidence ON evidence.payment_evidence_id=head.payment_evidence_id
            JOIN licensing_private.commercial_payment_refund_heads progress ON progress.payment_evidence_id=evidence.payment_evidence_id
            WHERE head.account_id=g.account_id AND head.provider_agreement_id=g.provider_agreement_id
              AND evidence.purpose='acquisition_initial' AND head.state='resolved_settled'
              AND (head.refund_fact='full_reversal_settled'
                OR (head.refund_fact='refund_succeeded' AND progress.cumulative_refunded_minor=evidence.gross_minor)))
          INTO blocked_refund,durable_full_refund;
        SELECT (EXISTS(SELECT 1 FROM licensing_private.first_purchase_refund_requests request
              WHERE request.account_id=g.account_id AND request.provider_agreement_id=g.provider_agreement_id
                AND request.state IN ('termination_pending','termination_unknown','refund_pending','refund_unknown','retry_wait','manual_resolution'))
            OR EXISTS(SELECT 1 FROM licensing_private.first_paid_purchase_eligibilities eligibility
              WHERE eligibility.account_id=g.account_id AND eligibility.provider_agreement_id=g.provider_agreement_id
                AND eligibility.state='claimed' AND NOT EXISTS(SELECT 1 FROM licensing_private.first_purchase_refund_requests completed
                  WHERE completed.account_id=eligibility.account_id
                    AND completed.refund_request_id=eligibility.claimed_refund_request_id AND completed.state='refunded'))),
          EXISTS(SELECT 1 FROM licensing_private.cancellation_intents intent
            WHERE intent.account_id=g.account_id AND intent.provider_agreement_id=g.provider_agreement_id
              AND intent.state IN ('requested','dispatching','outcome_unknown','failed_retryable','manual_resolution')),
          EXISTS(SELECT 1 FROM licensing_private.provider_operations operation
            WHERE operation.account_id=g.account_id AND operation.provider_agreement_id=g.provider_agreement_id
              AND operation.provider_operation_id=s.current_provider_operation_id
              AND operation.operation_kind IN ('subscription_refund_terminate','first_purchase_refund','subscription_cancel')
              AND (operation.state IN ('planned','permit_issued','dispatch_consumed','outcome_unknown','manual_resolution')
                OR EXISTS(SELECT 1 FROM licensing_private.provider_operation_work work
                  WHERE work.account_id=operation.account_id AND work.provider_operation_id=operation.provider_operation_id
                    AND work.state IN ('ready','leased','retry_wait','quarantined','dead_letter')
                    AND NOT EXISTS(SELECT 1 FROM licensing_private.provider_operation_work child
                      WHERE child.parent_work_id=work.work_id))))
          INTO accepted_refund_blocked,cancellation_blocked,current_operation_blocked;
        release_blocked:=blocked_refund OR accepted_refund_blocked OR cancellation_blocked OR current_operation_blocked;
        blocked_reason:=CASE WHEN blocked_refund THEN 'refund_evidence_unresolved'
          WHEN accepted_refund_blocked OR current_operation_blocked THEN 'refund_operation_unresolved'
          ELSE 'cancellation_operation_unresolved' END;
        eligible:=EXISTS(SELECT 1 FROM licensing_private.replacement_eligibility e WHERE e.account_id=j.account_id
          AND e.slot_ownership_id=s.slot_ownership_id AND e.slot_epoch=s.slot_epoch AND e.holder_kind='agreement'
          AND e.holder_id=g.provider_agreement_id AND e.verdict='eligible')
          AND NOT release_blocked
          AND ((g.purchase_kind='fixed_term' AND (g.protected_paid_through<=transaction_timestamp() OR durable_full_refund))
            OR (g.purchase_kind='subscription' AND g.renewal_disposition IN ('nonrenewing','terminated')
              AND g.protected_paid_through<=transaction_timestamp()));
      END IF;
      IF release_blocked THEN
        UPDATE licensing_private.commercial_jobs SET state='retry_wait',attempt_count=greatest(attempt_count-1,0),
          lease_owner=NULL,lease_expires_at=NULL,token_digest=NULL,next_attempt_at=transaction_timestamp()+interval '1 hour',
          last_error_class=blocked_reason,dead_letter_at=NULL,dead_letter_reason=NULL
          WHERE job_id=p_work;
        released:=false; slot_epoch:=s.slot_epoch; RETURN NEXT; RETURN;
      END IF;
      IF NOT eligible
        THEN UPDATE licensing_private.commercial_jobs SET state='succeeded',lease_owner=NULL,lease_expires_at=NULL,token_digest=NULL
          WHERE job_id=p_work;
          released:=false; slot_epoch:=s.slot_epoch; RETURN NEXT; RETURN; END IF;
      slot_epoch:=s.slot_epoch+1; INSERT INTO licensing_private.commercial_provider_slot_versions VALUES(j.account_id,slot_epoch,NULL,'vacant',
        'not_requested',NULL,NULL,NULL,transaction_timestamp());
      UPDATE licensing_private.commercial_provider_slots SET slot_epoch=release_provider_slot.slot_epoch,slot_ownership_id=NULL,state='vacant',
        release_status='not_requested',holder_attempt_id=NULL,holder_agreement_id=NULL,current_provider_operation_id=NULL WHERE account_id=j.account_id;
      UPDATE licensing_private.commercial_jobs SET state='succeeded',lease_owner=NULL,lease_expires_at=NULL,token_digest=NULL WHERE job_id=p_work;
      released:=true; RETURN NEXT; END $f$;

    -- All private evidence is owner/definer-only even though RLS is also forced as defense in depth.
    DO $rls$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['purchase_attempts','binding_claims','provider_operations',
      'commercial_provider_slot_versions','commercial_provider_slots','provider_operation_work','provider_dispatch_permits',
      'provider_operation_results','provider_resource_bindings','provider_operation_resource_evidence','provider_agreements',
      'agreement_resource_links','commercial_payment_evidence','commercial_payment_refund_heads','first_paid_purchase_eligibilities','first_purchase_refund_requests',
      'agreement_observations','cancellation_intents','provider_receipts','provider_receipt_conflicts','agreement_refund_evidence_heads',
      'fixed_term_capture_requests',
      'commercial_jobs','provider_resource_cursors','replacement_eligibility','commercial_rights','commercial_authorities',
      'commercial_outbox','approval_redirect_handles'] LOOP EXECUTE format('ALTER TABLE licensing_private.%I ENABLE ROW LEVEL SECURITY',t);
      EXECUTE format('ALTER TABLE licensing_private.%I FORCE ROW LEVEL SECURITY',t);
      EXECUTE format('CREATE POLICY %I ON licensing_private.%I TO gd_licensing_owner,gd_licensing_command_definer,gd_licensing_worker_definer,gd_licensing_ingress_definer USING (true) WITH CHECK (true)',t||'_definers',t);
    END LOOP; END $rls$;
    ALTER TABLE licensing_private.account_entitlement_projections ENABLE ROW LEVEL SECURITY;
    ALTER TABLE licensing_private.account_entitlement_projections FORCE ROW LEVEL SECURITY;
    CREATE POLICY licensing_projection_definers ON licensing_private.account_entitlement_projections
      TO gd_licensing_owner,gd_licensing_command_definer,gd_licensing_worker_definer USING(true) WITH CHECK(true);

    GRANT USAGE ON SCHEMA licensing_private TO gd_licensing_command_definer,gd_licensing_worker_definer,gd_licensing_ingress_definer;
    GRANT SELECT,INSERT,UPDATE ON licensing_private.purchase_attempts,licensing_private.binding_claims,
      licensing_private.provider_operations,licensing_private.commercial_provider_slot_versions,
      licensing_private.commercial_provider_slots,licensing_private.provider_operation_work,
      licensing_private.cancellation_intents,licensing_private.approval_redirect_handles TO gd_licensing_command_definer;
    GRANT SELECT,UPDATE ON licensing_private.provider_agreements TO gd_licensing_command_definer;
    GRANT SELECT ON licensing_private.commercial_authorities,
      licensing_private.provider_resource_bindings,licensing_private.agreement_resource_links TO gd_licensing_command_definer;
    GRANT SELECT ON licensing_private.commercial_payment_evidence TO gd_licensing_command_definer;
    GRANT SELECT,UPDATE ON licensing_private.commercial_payment_refund_heads,
      licensing_private.first_paid_purchase_eligibilities TO gd_licensing_command_definer;
    GRANT SELECT,INSERT,UPDATE ON licensing_private.first_purchase_refund_requests TO gd_licensing_command_definer;
    GRANT SELECT,INSERT,UPDATE ON licensing_private.commercial_rights TO gd_licensing_command_definer;
    GRANT SELECT,INSERT ON licensing_private.commercial_outbox TO gd_licensing_command_definer;
    GRANT UPDATE ON licensing_private.commercial_authorities TO gd_licensing_command_definer;
    GRANT SELECT,INSERT,UPDATE ON licensing_private.fixed_term_capture_requests TO gd_licensing_command_definer;
    GRANT SELECT ON licensing_private.account_entitlement_projections TO gd_licensing_command_definer;
    GRANT UPDATE ON licensing_private.account_entitlement_projections TO gd_licensing_command_definer;
    GRANT SELECT,INSERT,UPDATE ON licensing_private.provider_operations,licensing_private.provider_operation_work,
      licensing_private.provider_dispatch_permits,licensing_private.provider_operation_results,
      licensing_private.provider_resource_bindings,licensing_private.provider_operation_resource_evidence,
      licensing_private.provider_agreements,licensing_private.agreement_resource_links,
      licensing_private.commercial_payment_evidence,licensing_private.commercial_payment_refund_heads,
      licensing_private.first_paid_purchase_eligibilities,
      licensing_private.first_purchase_refund_requests,licensing_private.agreement_observations,
      licensing_private.agreement_refund_evidence_heads,licensing_private.cancellation_intents,
      licensing_private.commercial_jobs,licensing_private.provider_resource_cursors,
      licensing_private.replacement_eligibility,licensing_private.commercial_rights,
      licensing_private.commercial_authorities,licensing_private.commercial_outbox,
      licensing_private.commercial_provider_slots,licensing_private.commercial_provider_slot_versions,
      licensing_private.account_entitlement_projections TO gd_licensing_worker_definer;
    GRANT SELECT ON licensing_private.binding_claims,licensing_private.fixed_term_capture_requests
      TO gd_licensing_worker_definer;
    GRANT SELECT,UPDATE ON licensing_private.purchase_attempts,licensing_private.provider_receipts
      TO gd_licensing_worker_definer;
    GRANT SELECT,INSERT,UPDATE ON licensing_private.provider_receipts TO gd_licensing_ingress_definer;
    GRANT SELECT,INSERT ON licensing_private.provider_receipt_conflicts,
      licensing_private.commercial_jobs TO gd_licensing_ingress_definer;

    REVOKE ALL ON ALL TABLES IN SCHEMA licensing_private FROM PUBLIC,gd_account_api,gd_provider_worker,gd_provider_ingress;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA licensing_private FROM PUBLIC,gd_account_api,gd_provider_worker,gd_provider_ingress;
    REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA licensing_private FROM PUBLIC,gd_account_api,gd_provider_worker,gd_provider_ingress;
    GRANT EXECUTE ON FUNCTION licensing_private.work_digest(bytea) TO gd_licensing_command_definer,gd_licensing_worker_definer;
    GRANT EXECUTE ON FUNCTION licensing_private.random_token() TO gd_licensing_command_definer,gd_licensing_worker_definer;
    GRANT EXECUTE ON FUNCTION licensing_private.require_work(uuid,bigint,bytea,licensing_private.job_kind) TO gd_licensing_worker_definer;
    REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA licensing_api,licensing_worker_api,licensing_ingress_api FROM PUBLIC;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA licensing_api TO gd_account_api;
    GRANT EXECUTE ON FUNCTION licensing_ingress_api.receive_authenticated_receipt(licensing_private.commercial_provider,text,bytea,text,text,text,text,text,timestamptz,text) TO gd_provider_ingress;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA licensing_worker_api TO gd_provider_worker;
    ALTER DEFAULT PRIVILEGES REVOKE ALL ON TABLES FROM PUBLIC;
    ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
    ALTER FUNCTION licensing_api.reserve_purchase(text,licensing_private.commercial_provider,licensing_private.purchase_kind,text,text,text,bigint,text,bytea) OWNER TO gd_licensing_command_definer;
    ALTER FUNCTION licensing_api.read_billing_status() OWNER TO gd_licensing_command_definer;
    ALTER FUNCTION licensing_api.read_entitlement_deadline() OWNER TO gd_licensing_command_definer;
    ALTER FUNCTION licensing_api.read_authoritative_entitlement_snapshot() OWNER TO gd_licensing_command_definer;
    ALTER FUNCTION licensing_api.request_cancellation(text,uuid,bytea) OWNER TO gd_licensing_command_definer;
    ALTER FUNCTION licensing_api.request_first_purchase_refund(text,uuid,bytea) OWNER TO gd_licensing_command_definer;
    ALTER FUNCTION licensing_api.read_first_purchase_refund_status(uuid) OWNER TO gd_licensing_command_definer;
    ALTER FUNCTION licensing_api.confirm_fixed_term_capture(text,uuid,bytea) OWNER TO gd_licensing_command_definer;
    ALTER FUNCTION licensing_api.issue_approval_redirect(uuid) OWNER TO gd_licensing_command_definer;
    ALTER FUNCTION licensing_api.claim_approval_redirect(bytea) OWNER TO gd_licensing_command_definer;
    ALTER FUNCTION licensing_api.complete_approval_redirect(uuid,text) OWNER TO gd_licensing_command_definer;
    ALTER FUNCTION licensing_ingress_api.receive_authenticated_receipt(licensing_private.commercial_provider,text,bytea,text,text,text,text,text,timestamptz,text) OWNER TO gd_licensing_ingress_definer;
    ALTER FUNCTION licensing_worker_api.lease_provider_operation_work(text) OWNER TO gd_licensing_worker_definer;
    ALTER FUNCTION licensing_worker_api.issue_dispatch_permit(uuid,bigint,bytea,integer) OWNER TO gd_licensing_worker_definer;
    ALTER FUNCTION licensing_worker_api.consume_dispatch_permit(uuid,bigint,bytea,uuid,licensing_private.operation_kind) OWNER TO gd_licensing_worker_definer;
    ALTER FUNCTION licensing_worker_api.record_operation_result(uuid,bigint,bytea,uuid,text,bytea,text[],text[],bytea[],text[]) OWNER TO gd_licensing_worker_definer;
    ALTER FUNCTION licensing_worker_api.read_operation_replay(uuid,bigint,bytea) OWNER TO gd_licensing_worker_definer;
    ALTER FUNCTION licensing_worker_api.lease_receipt_work(text) OWNER TO gd_licensing_worker_definer;
    ALTER FUNCTION licensing_worker_api.redrive_dead_letter_operation(text,text) OWNER TO gd_licensing_worker_definer;
    ALTER FUNCTION licensing_worker_api.redrive_dead_letter_job(text,text) OWNER TO gd_licensing_worker_definer;
    ALTER FUNCTION licensing_worker_api.link_receipt_resources_to_agreement(uuid,bigint,bytea,text,text,bytea,text[],text[],bytea[],text[]) OWNER TO gd_licensing_worker_definer;
    ALTER FUNCTION licensing_worker_api.bind_receipt_work(uuid,bigint,bytea,bytea) OWNER TO gd_licensing_worker_definer;
    ALTER FUNCTION licensing_worker_api.fail_bound_work(uuid,bigint,bytea,text,integer) OWNER TO gd_licensing_worker_definer;
    ALTER FUNCTION licensing_worker_api.handoff_provider_agreement(uuid,bigint,bytea,text,text[],text[],bytea[],bytea,timestamptz,text[],text[],bytea[]) OWNER TO gd_licensing_worker_definer;
    ALTER FUNCTION licensing_worker_api.lease_reconciliation_work(text) OWNER TO gd_licensing_worker_definer;
    ALTER FUNCTION licensing_worker_api.lease_due_authority_work(text) OWNER TO gd_licensing_worker_definer;
    ALTER FUNCTION licensing_worker_api.lease_release_work(text) OWNER TO gd_licensing_worker_definer;
    ALTER FUNCTION licensing_worker_api.apply_agreement_observation_and_authority(uuid,bigint,bigint,bytea,bytea,bigint,bigint,bigint,text,text,timestamptz,timestamptz,text,text[],text,bytea,text,text,text,bytea,timestamptz,bigint,text,bigint,bytea,text) OWNER TO gd_licensing_worker_definer;
    ALTER FUNCTION licensing_worker_api.apply_due_authority(uuid,bigint,bytea,bigint,bigint,bigint,uuid) OWNER TO gd_licensing_worker_definer;
    ALTER FUNCTION licensing_worker_api.release_provider_slot(uuid,bigint,bytea) OWNER TO gd_licensing_worker_definer;
    ALTER FUNCTION licensing_worker_api.heartbeat_bound_work(uuid,bigint,bytea) OWNER TO gd_licensing_worker_definer;
    ALTER FUNCTION licensing_private.reject_immutable_change() OWNER TO gd_licensing_owner;
    ALTER FUNCTION licensing_private.protect_terminal_work() OWNER TO gd_licensing_owner;
    ALTER FUNCTION licensing_private.work_digest(bytea) OWNER TO gd_licensing_owner;
    ALTER FUNCTION licensing_private.random_token() OWNER TO gd_licensing_owner;
    ALTER FUNCTION licensing_private.require_work(uuid,bigint,bytea,licensing_private.job_kind) OWNER TO gd_licensing_worker_definer;
    DO $owners$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['purchase_attempts','binding_claims','provider_operations',
      'commercial_provider_slot_versions','commercial_provider_slots','provider_operation_work','provider_dispatch_permits',
      'provider_operation_results','provider_resource_bindings','provider_operation_resource_evidence','provider_agreements',
      'agreement_resource_links','commercial_payment_evidence','commercial_payment_refund_heads','first_paid_purchase_eligibilities','first_purchase_refund_requests',
      'agreement_observations','cancellation_intents','fixed_term_capture_requests','provider_receipts','provider_receipt_conflicts',
      'agreement_refund_evidence_heads',
      'commercial_jobs','provider_resource_cursors','replacement_eligibility','commercial_rights','commercial_authorities',
      'commercial_outbox','approval_redirect_handles','account_entitlement_projections'] LOOP EXECUTE format('ALTER TABLE licensing_private.%I OWNER TO gd_licensing_owner',t); END LOOP; END $owners$;
    ALTER TYPE licensing_private.commercial_provider OWNER TO gd_licensing_owner;
    ALTER TYPE licensing_private.purchase_kind OWNER TO gd_licensing_owner;
    ALTER TYPE licensing_private.operation_kind OWNER TO gd_licensing_owner;
    ALTER TYPE licensing_private.operation_state OWNER TO gd_licensing_owner;
    ALTER TYPE licensing_private.job_kind OWNER TO gd_licensing_owner;
    ALTER TYPE licensing_private.job_state OWNER TO gd_licensing_owner;
    REVOKE CREATE ON SCHEMA licensing_private FROM gd_licensing_worker_definer;
    ALTER SCHEMA licensing_private OWNER TO gd_licensing_owner;
    REVOKE CREATE ON SCHEMA licensing_api FROM gd_licensing_command_definer;
    REVOKE CREATE ON SCHEMA licensing_worker_api FROM gd_licensing_worker_definer;
    REVOKE CREATE ON SCHEMA licensing_ingress_api FROM gd_licensing_ingress_definer;
    ALTER SCHEMA licensing_api OWNER TO gd_licensing_owner;
    ALTER SCHEMA licensing_worker_api OWNER TO gd_licensing_owner;
    ALTER SCHEMA licensing_ingress_api OWNER TO gd_licensing_owner;
  `,
};
