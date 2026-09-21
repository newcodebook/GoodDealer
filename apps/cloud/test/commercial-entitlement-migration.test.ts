import { describe, expect, it } from "vitest";

import { commercialEntitlementsMigration } from "../src/modules/licensing/migrations/202608200015-commercial-entitlements";

describe("greenfield commercial entitlement migration", () => {
  const sql = commercialEntitlementsMigration.sql;

  it("owns the normalized commercial aggregate, evidence, authority, and job model", () => {
    for (const relation of [
      "purchase_attempts", "commercial_provider_slots", "commercial_provider_slot_versions",
      "provider_operations", "provider_operation_work", "provider_dispatch_permits",
      "provider_resource_bindings", "provider_operation_resource_evidence", "agreement_resource_links",
      "provider_agreements", "commercial_payment_evidence", "commercial_payment_refund_heads",
      "first_paid_purchase_eligibilities", "first_purchase_refund_requests", "agreement_observations",
      "agreement_refund_evidence_heads", "cancellation_intents", "provider_receipts",
      "fixed_term_capture_requests",
      "provider_receipt_conflicts", "commercial_jobs", "provider_resource_cursors",
      "replacement_eligibility", "commercial_rights", "commercial_authorities", "commercial_outbox",
      "approval_redirect_handles", "account_entitlement_projections",
    ]) expect(sql).toContain(`licensing_private.${relation}`);
    expect(sql).not.toContain("licensing_commercial_purchases");
    expect(sql).not.toContain("jsonb");
  });

  it("separates account, ingress, worker, owner, and definer trust domains", () => {
    for (const role of ["gd_licensing_owner", "gd_licensing_command_definer", "gd_licensing_worker_definer",
      "gd_licensing_ingress_definer", "gd_account_api", "gd_provider_worker", "gd_provider_ingress"]) {
      expect(sql).toContain(role);
    }
    expect(sql).toContain("CREATE SCHEMA licensing_api");
    expect(sql).toContain("CREATE SCHEMA licensing_worker_api");
    expect(sql).toContain("CREATE SCHEMA licensing_ingress_api");
    expect(sql).toContain("REVOKE ALL ON ALL TABLES IN SCHEMA licensing_private");
    expect(sql).not.toContain("gooddealer_cloud_app");
  });

  it("uses literal-purpose account façades with no account selector", () => {
    for (const purpose of ["billing_read", "purchase_reserve", "cancellation_request",
      "fixed_term_capture", "refund_request", "billing_approval_redirect", "identity_account", "devices_account"]) {
      expect(sql).toContain(`current_transaction_account('${purpose}')`);
    }
    for (const routine of ["read_billing_status", "reserve_purchase", "request_cancellation",
      "request_first_purchase_refund", "read_first_purchase_refund_status",
      "confirm_fixed_term_capture", "issue_approval_redirect", "claim_approval_redirect",
      "complete_approval_redirect", "read_entitlement_deadline", "read_authoritative_entitlement_snapshot"]) {
      expect(sql).toContain(`licensing_api.${routine}`);
    }
    expect(sql).toContain("ERRCODE='42501'");
  });

  it("fences worker mutation with targetless leases, epochs, token digests, and separate permit transitions", () => {
    for (const routine of ["lease_provider_operation_work", "issue_dispatch_permit", "consume_dispatch_permit",
      "record_operation_result", "read_operation_replay", "handoff_provider_agreement",
      "redrive_dead_letter_operation", "redrive_dead_letter_job", "link_receipt_resources_to_agreement",
      "lease_receipt_work", "bind_receipt_work", "lease_reconciliation_work", "heartbeat_bound_work",
      "fail_bound_work", "apply_agreement_observation_and_authority", "lease_due_authority_work",
      "apply_due_authority", "lease_release_work", "release_provider_slot"]) {
      expect(sql).toContain(`licensing_worker_api.${routine}`);
    }
    expect(sql).toContain("GOODDEALER-COMMERCIAL-WORK-V1");
    expect(sql).toContain("FOR UPDATE SKIP LOCKED");
    expect(sql).toContain("'dead_letter'");
    for (const fence of ["expected_binding_digest", "expected_slot_epoch", "expected_agreement_revision",
      "expected_authority_revision", "expected_right_id"]) expect(sql).toContain(fence);
  });

  it("honors scheduled retry/due deadlines and terminally records retained release decisions", () => {
    expect(sql).toContain("pow.state='retry_wait' AND pow.next_attempt_at<=transaction_timestamp()");
    expect(sql).toContain("retry_request.state='retry_wait' AND retry_request.retry_at<=transaction_timestamp()");
    expect(sql).toContain("An account replay proves only request identity");
    expect(sql).toContain("INSERT INTO licensing_private.provider_operation_work(work_id,account_id,provider_operation_id,state)\n        VALUES(gen_random_uuid(),a,planned_operation,'ready')");
    expect(sql).not.toContain("VALUES(work_id,a,provider_operation_id,'leased',1,'account-command'");
    expect(sql).toContain("cj.state IN ('ready','retry_wait') AND cj.next_attempt_at<=transaction_timestamp()");
    expect(sql).toContain("THEN UPDATE licensing_private.commercial_jobs SET state='succeeded'");
  });

  it("owns refund decisions, agreement-scoped non-granting, and the exclusive deadline boundary", () => {
    expect(sql).toContain("RETURNS TABLE(rejection_reason text,refund_request_id uuid");
    for (const reason of ["not_first_paid_purchase", "window_elapsed", "not_paid", "already_claimed",
      "already_fully_reversed", "purchase_mismatch"]) expect(sql).toContain(`'${reason}'`);
    expect(sql).toContain("transaction_timestamp()>=eligibility.window_ends_at");
    expect(sql).not.toContain("transaction_timestamp()>eligibility.window_ends_at");
    expect(sql).toContain("eligibility.provider_agreement_id=g.provider_agreement_id");
    expect(sql).toContain("p_refund_fact IN ('none','refund_failed')");
    const start = sql.indexOf("CREATE FUNCTION licensing_api.request_first_purchase_refund");
    const end = sql.indexOf("CREATE FUNCTION licensing_api.read_first_purchase_refund_status", start);
    const commandSql = sql.slice(start, end);
    expect(commandSql.indexOf("pg_advisory_xact_lock(hashtextextended('gooddealer:commercial-account:'||a,0))"))
      .toBeLessThan(commandSql.indexOf("SELECT cps.* INTO s FROM licensing_private.commercial_provider_slots cps WHERE cps.account_id=a FOR UPDATE"));
    expect(commandSql.indexOf("SELECT cps.* INTO s FROM licensing_private.commercial_provider_slots cps WHERE cps.account_id=a FOR UPDATE"))
      .toBeLessThan(commandSql.indexOf("SELECT rr.* INTO existing FROM licensing_private.first_purchase_refund_requests rr"));
    const resultStart = sql.indexOf("CREATE FUNCTION licensing_worker_api.record_operation_result");
    const resultEnd = sql.indexOf("CREATE FUNCTION licensing_worker_api.read_operation_replay", resultStart);
    const resultSql = sql.slice(resultStart, resultEnd);
    expect(resultSql.indexOf("pg_advisory_xact_lock(hashtextextended('gooddealer:commercial-account:'||lock_account,0))"))
      .toBeLessThan(resultSql.indexOf("SELECT cps.* INTO refund_slot FROM licensing_private.commercial_provider_slots cps"));
    expect(resultSql.indexOf("SELECT cps.* INTO refund_slot FROM licensing_private.commercial_provider_slots cps"))
      .toBeLessThan(resultSql.indexOf("SELECT pow.* INTO w FROM licensing_private.provider_operation_work pow WHERE pow.work_id=p_work FOR UPDATE"));
    expect(resultSql.indexOf("SELECT pow.* INTO w FROM licensing_private.provider_operation_work pow WHERE pow.work_id=p_work FOR UPDATE"))
      .toBeLessThan(resultSql.indexOf("SELECT rr.* INTO refund_request FROM licensing_private.first_purchase_refund_requests rr"));
    expect(resultSql.match(/failure_class='provider_work_quarantined'/g)).toHaveLength(2);
    expect(resultSql).toContain("AND (request.termination_operation_id=o.provider_operation_id");
    expect(sql).toContain("PRIMARY KEY(account_id,provider_agreement_id,payment_evidence_id,receipt_provider,trigger_resource_kind,trigger_resource_id)");
    expect(sql).toContain("requires_reread:=coalesce(refund_evidence.state='blocking',false)");
    expect(sql).toContain("VALUES(gen_random_uuid(),'reconciliation',reread_receipt_id");
    const reconciliationStart = sql.indexOf("CREATE FUNCTION licensing_worker_api.apply_agreement_observation_and_authority");
    const reconciliationEnd = sql.indexOf("CREATE FUNCTION licensing_worker_api.apply_due_authority", reconciliationStart);
    const reconciliationSql = sql.slice(reconciliationStart, reconciliationEnd);
    expect(reconciliationSql.indexOf("SELECT cps.* INTO s FROM licensing_private.commercial_provider_slots cps"))
      .toBeLessThan(reconciliationSql.indexOf("SELECT rr.* INTO accepted_refund FROM licensing_private.first_purchase_refund_requests rr"));
    expect(reconciliationSql.indexOf("SELECT rr.* INTO accepted_refund FROM licensing_private.first_purchase_refund_requests rr"))
      .toBeLessThan(reconciliationSql.indexOf("PERFORM 1 FROM licensing_private.agreement_refund_evidence_heads arh"));
    expect(sql).toContain("AND payment_evidence_id=payment_id AND receipt_provider=current_receipt.provider");
    expect(sql).toContain("AND NOT release_blocked");
    expect(sql).toContain("evidence.purpose='acquisition_initial' AND head.state='resolved_settled'");
    expect(sql).toContain("p_refund_fact='refund_succeeded' AND p_cumulative_refunded_minor=p_payment_gross_minor");
    expect(sql).toContain("request.state IN ('termination_pending','termination_unknown','refund_pending','refund_unknown','retry_wait','manual_resolution')");
    expect(sql).toContain("eligibility.state='claimed' AND NOT EXISTS");
    expect(sql).toContain("intent.state IN ('requested','dispatching','outcome_unknown','failed_retryable','manual_resolution')");
    expect(sql).toContain("work.state IN ('ready','leased','retry_wait','quarantined','dead_letter')");
    expect(sql).toContain("refund_slot.current_provider_operation_id IS DISTINCT FROM o.provider_operation_id");
    expect(sql).toContain("o.state<>'dispatch_consumed' OR o.operation_revision<>p.operation_revision+1");
    const failureStart = sql.indexOf("CREATE FUNCTION licensing_worker_api.fail_bound_work");
    const failureEnd = sql.indexOf("CREATE FUNCTION licensing_worker_api.handoff_provider_agreement", failureStart);
    const failureSql = sql.slice(failureStart, failureEnd);
    expect(failureSql).toContain("IF o.state IN ('permit_issued','dispatch_consumed') THEN");
    expect(failureSql).toContain("SET state='outcome_unknown'");
    expect(failureSql.indexOf("pg_advisory_xact_lock(hashtextextended('gooddealer:commercial-account:'||lock_account,0))"))
      .toBeLessThan(failureSql.indexOf("SELECT cps.* INTO s FROM licensing_private.commercial_provider_slots cps"));
    expect(failureSql.indexOf("SELECT cps.* INTO s FROM licensing_private.commercial_provider_slots cps"))
      .toBeLessThan(failureSql.indexOf("SELECT * INTO ow FROM licensing_private.provider_operation_work"));
    expect(failureSql.indexOf("SELECT * INTO ow FROM licensing_private.provider_operation_work"))
      .toBeLessThan(failureSql.indexOf("SELECT po.* INTO o FROM licensing_private.provider_operations po"));
    expect(failureSql).toContain("IF next_state IN ('quarantined','dead_letter')");
    expect(failureSql).toContain("WHEN 'dead_letter' THEN 'provider_work_exhausted'");
    expect(failureSql).toContain("retry_at=NULL,request_revision=request_revision+1");
    expect(sql).toContain("AND state<>'refunded'");
    expect(sql).toContain("next_attempt_at=transaction_timestamp()+interval '1 hour'");
    expect(sql).toContain("WHERE child.parent_work_id=work.work_id");
    expect(sql).not.toContain("ao.observation_id=g.current_observation_id");
    expect(sql).toContain("dead_letter_reason='provider_convergence_exhausted'");
    expect(sql).toContain("p_work,'provider-convergence-reread'");
  });

  it("recovers operation leases without changing permit identity or losing linked agreement routing", () => {
    expect(sql).toContain("operation_revision:=p.operation_revision");
    expect(sql).toContain("pa.account_id=b.account_id");
    expect(sql).toContain("FROM licensing_private.agreement_resource_links arl");
    expect(sql).toContain("o.state='dispatch_consumed'");
    expect(sql).toContain("SET state='outcome_unknown'");
    expect(sql).toContain("SET state='revoked'");
  });

  it("compare-all replays operation results and exact provider agreement handoffs", () => {
    expect(sql).toContain("existing.resource_kinds IS DISTINCT FROM p_resource_kinds");
    expect(sql).toContain("existing.resource_roles IS DISTINCT FROM p_resource_roles");
    expect(sql).toContain("p_resource_kinds IS DISTINCT FROM ARRAY['checkout_session','subscription']::text[]");
    expect(sql).toContain("p_resource_kinds IS DISTINCT FROM ARRAY['order','capture']::text[]");
    expect(sql).toContain("existing.handoff_digest<>p_observation_digest");
    expect(sql).toContain("existing.handoff_captured_at IS DISTINCT FROM p_captured_at");
    expect(sql).toContain("arl.link_digest=p_resource_digests[i]");
    expect(sql).not.toContain("arl.evidence_digest");
  });

  it("forces RLS and guards immutable provider and policy evidence", () => {
    expect(sql).toContain("FORCE ROW LEVEL SECURITY");
    for (const trigger of ["provider_resource_bindings_immutable", "agreement_observations_immutable",
      "provider_receipts_immutable", "replacement_eligibility_immutable", "commercial_payment_evidence_immutable",
      "provider_operation_terminal_immutable", "commercial_job_terminal_immutable"]) expect(sql).toContain(trigger);
    expect(sql).toContain("ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC");
  });
});
