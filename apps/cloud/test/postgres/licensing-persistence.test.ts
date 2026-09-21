import { createHash } from "node:crypto";

import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { IdentityCapabilityTransactionRunner, runCloudMigrations } from "../../src/db/index";
import { cloudMigrations } from "../../src/db/migrations";
import type { FirstPurchaseRefundDecision } from "../../src/modules/licensing/commercial-domain";
import { PostgresCommercialAggregateRepository } from "../../src/modules/licensing/index";
import { clearLicensingTestData } from "../support/postgres-fixture";

const ownerPool = new Pool({ connectionString: required("GOODDEALER_POSTGRES_OWNER_URL"), max: 1 });
const accountPool = new Pool({ connectionString: required("GOODDEALER_POSTGRES_ACCOUNT_API_URL"), max: 2 });
const issuerPool = new Pool({ connectionString: required("GOODDEALER_POSTGRES_IDENTITY_ISSUER_URL"), max: 1 });
const transactions = new IdentityCapabilityTransactionRunner(accountPool, issuerPool);
const repository = new PostgresCommercialAggregateRepository();
const credential = "commercial-account-session";

beforeAll(async () => { await runCloudMigrations(ownerPool, cloudMigrations); });
beforeEach(async () => {
  await clearLicensingTestData(ownerPool);
  await ownerPool.query("SET ROLE gd_identity_owner");
  await ownerPool.query("DELETE FROM identity_private.account_transaction_capabilities WHERE account_id='commercial-a'");
  await ownerPool.query("RESET ROLE");
  await ownerPool.query("DELETE FROM public.identity_credential_jtis WHERE account_id='commercial-a'");
  await ownerPool.query("DELETE FROM public.identity_refresh_families WHERE account_id='commercial-a'");
  await ownerPool.query("DELETE FROM public.identity_auth_sessions WHERE account_id='commercial-a'");
  await ownerPool.query("DELETE FROM public.identity_account_security_states WHERE account_id='commercial-a'");
  await ownerPool.query("DELETE FROM public.identity_accounts WHERE account_id='commercial-a'");
  await seed("commercial-a", credential);
});
afterAll(async () => { await Promise.all([ownerPool.end(), accountPool.end(), issuerPool.end()]); });

describe("capability-bound commercial PostgreSQL persistence", () => {
  it("reserves exactly one slot and compare-all replays the account request", async () => {
    const command = { requestId: "checkout-1", provider: "stripe" as const,
      purchaseKind: "subscription" as const, offer: "monthly" as const,
      providerCatalogItem: "price-monthly", campaignCode: null, expectedGrossMinor: 980,
      expectedCurrency: "USD" as const, requestDigest: hash("same") };
    const first = await transactions.withAccountCredential(Buffer.from(credential), "purchase_reserve",
      (transaction) => repository.reservePurchase(transaction, command));
    const second = await transactions.withAccountCredential(Buffer.from(credential), "purchase_reserve",
      (transaction) => repository.reservePurchase(transaction, command));
    expect(first.replay).toBe("created");
    expect(second).toMatchObject({ replay: "same_request", purchaseAttemptId: first.purchaseAttemptId,
      providerOperationId: first.providerOperationId, slotOwnershipId: first.slotOwnershipId });
    expect(first.work.rawToken).toHaveLength(32);
    expect(second.work.leaseEpoch).toBeGreaterThan(first.work.leaseEpoch);

    await expect(transactions.withAccountCredential(Buffer.from(credential), "purchase_reserve",
      (transaction) => repository.reservePurchase(transaction, { ...command, requestDigest: hash("different") })))
      .rejects.toMatchObject({ code: "23505" });
    await expect(transactions.withAccountCredential(Buffer.from(credential), "purchase_reserve",
      (transaction) => repository.reservePurchase(transaction, { ...command, expectedGrossMinor: 981 })))
      .rejects.toMatchObject({ code: "23505" });

    await ownerPool.query("SET ROLE gd_licensing_owner");
    const pricing = await ownerPool.query<{ expected_gross_minor: string; expected_currency: string }>(
      "SELECT expected_gross_minor::text,expected_currency FROM licensing_private.purchase_attempts WHERE account_id='commercial-a'",
    );
    await ownerPool.query("RESET ROLE");
    expect(pricing.rows).toEqual([{ expected_gross_minor: "980", expected_currency: "USD" }]);
  });

  it("rejects wrong-purpose account entry before commercial mutation", async () => {
    const command = { requestId: "checkout-wrong-purpose", provider: "paypal" as const,
      purchaseKind: "subscription" as const, offer: "annual" as const,
      providerCatalogItem: "plan-annual", campaignCode: null, expectedGrossMinor: 1_900,
      expectedCurrency: "USD" as const, requestDigest: hash("wrong-purpose") };
    await expect(transactions.withAccountCredential(Buffer.from(credential), "billing_read",
      (transaction) => repository.reservePurchase(transaction, command))).rejects.toMatchObject({ code: "42501" });
    await ownerPool.query("SET ROLE gd_licensing_owner");
    const count = await ownerPool.query<{ count: string }>("SELECT count(*)::text FROM licensing_private.purchase_attempts");
    await ownerPool.query("RESET ROLE");
    expect(count.rows).toEqual([{ count: "0" }]);
  });

  it("grants only the exact façade schemas and no private-table DML to runtime roles", async () => {
    await ownerPool.query("SET ROLE gd_licensing_owner");
    const result = await ownerPool.query<{ account_private: boolean; worker_private: boolean; ingress_private: boolean;
      account_reserve: boolean; worker_lease: boolean; ingress_receive: boolean; generic_schema: boolean }>(`
      SELECT has_table_privilege('gd_account_api','licensing_private.purchase_attempts','SELECT,INSERT,UPDATE,DELETE') AS account_private,
        has_table_privilege('gd_provider_worker','licensing_private.commercial_jobs','SELECT,INSERT,UPDATE,DELETE') AS worker_private,
        has_table_privilege('gd_provider_ingress','licensing_private.provider_receipts','SELECT,INSERT,UPDATE,DELETE') AS ingress_private,
        has_function_privilege('gd_account_api','licensing_api.reserve_purchase(text,licensing_private.commercial_provider,licensing_private.purchase_kind,text,text,text,bigint,text,bytea)','EXECUTE') AS account_reserve,
        has_function_privilege('gd_provider_worker','licensing_worker_api.lease_provider_operation_work(text)','EXECUTE') AS worker_lease,
        has_function_privilege('gd_provider_ingress','licensing_ingress_api.receive_authenticated_receipt(licensing_private.commercial_provider,text,bytea,text,text,text,text,text,timestamptz,text)','EXECUTE') AS ingress_receive,
        has_schema_privilege('gooddealer_cloud_app','licensing_api','USAGE') AS generic_schema`);
    await ownerPool.query("RESET ROLE");
    expect(result.rows).toEqual([{ account_private: false, worker_private: false, ingress_private: false,
      account_reserve: true, worker_lease: true, ingress_receive: true, generic_schema: false }]);
  });

  it("commits authenticated ignored receipts and digest conflicts without inventing account work", async () => {
    const receipt = { kind: "ignored" as const, provider: "stripe" as const, providerEventId: "evt-ignored-1",
      payloadDigest: hash("receipt-a"), eventType: "unrelated.event", triggerResourceKind: null,
      triggerResourceId: null, ignoredReason: "unsupported_event" as const, occurredAt: "2026-09-03T00:00:00Z",
      authenticatedEvidenceRef: "receipt:evidence:1" };
    await ownerPool.query("SET ROLE gd_licensing_ingress_definer");
    await expect(repository.receiveAuthenticatedReceipt(ownerPool, receipt)).resolves.toBe("ignored");
    await expect(repository.receiveAuthenticatedReceipt(ownerPool, receipt)).resolves.toBe("duplicate");
    await expect(repository.receiveAuthenticatedReceipt(ownerPool,
      { ...receipt, payloadDigest: hash("receipt-conflict") })).resolves.toBe("conflict");
    await ownerPool.query("RESET ROLE");

    await ownerPool.query("SET ROLE gd_licensing_owner");
    const facts = await ownerPool.query<{ receipts: string; conflicts: string; jobs: string }>(`
      SELECT (SELECT count(*)::text FROM licensing_private.provider_receipts) AS receipts,
        (SELECT count(*)::text FROM licensing_private.provider_receipt_conflicts) AS conflicts,
        (SELECT count(*)::text FROM licensing_private.commercial_jobs) AS jobs`);
    await ownerPool.query("RESET ROLE");
    expect(facts.rows).toEqual([{ receipts: "1", conflicts: "1", jobs: "0" }]);
  });

  it("honors retry and due scheduling deadlines before leasing work", async () => {
    const plan = await transactions.withAccountCredential(Buffer.from(credential), "purchase_reserve",
      (transaction) => repository.reservePurchase(transaction, { requestId: "checkout-backoff", provider: "stripe",
        purchaseKind: "subscription", offer: "monthly", providerCatalogItem: "price-monthly", campaignCode: null,
        expectedGrossMinor: 980, expectedCurrency: "USD", requestDigest: hash("backoff") }));
    await ownerPool.query("SET ROLE gd_licensing_owner");
    await ownerPool.query(`UPDATE licensing_private.provider_operation_work
      SET state='retry_wait',lease_owner=NULL,lease_expires_at=NULL,token_digest=NULL,
        next_attempt_at=transaction_timestamp()+interval '1 hour' WHERE work_id=$1`, [plan.work.workId]);
    await ownerPool.query(`INSERT INTO licensing_private.commercial_jobs(job_id,kind,account_id,state,next_attempt_at)
      VALUES(gen_random_uuid(),'due_authority','commercial-a','ready',transaction_timestamp()+interval '1 hour')`);
    await ownerPool.query("RESET ROLE");

    await ownerPool.query("SET ROLE gd_licensing_worker_definer");
    await expect(repository.leaseProviderOperationWork(ownerPool, "worker-backoff")).resolves.toBeNull();
    await expect(repository.leaseDueAuthorityWork(ownerPool, "worker-due")).resolves.toBeNull();
    await ownerPool.query("RESET ROLE");
  });

  it("bounds heartbeat renewal by the current attempt rather than the job's first attempt", async () => {
    await ownerPool.query("SET ROLE gd_licensing_owner");
    await ownerPool.query(`INSERT INTO licensing_private.commercial_jobs(job_id,kind,account_id,state)
      VALUES(gen_random_uuid(),'release','commercial-a','ready')`);
    await ownerPool.query("RESET ROLE");

    await ownerPool.query("SET ROLE gd_licensing_worker_definer");
    const work = await repository.leaseReleaseWork(ownerPool, "worker-old-retry");
    expect(work).not.toBeNull();
    await ownerPool.query("RESET ROLE");

    await ownerPool.query("SET ROLE gd_licensing_owner");
    await ownerPool.query(`UPDATE licensing_private.commercial_jobs
      SET first_attempt_at=transaction_timestamp()-interval '1 hour' WHERE job_id=$1`, [work!.workId]);
    await ownerPool.query("RESET ROLE");

    await ownerPool.query("SET ROLE gd_licensing_worker_definer");
    const renewed = await repository.heartbeatBoundWork(ownerPool, work!);
    await ownerPool.query("RESET ROLE");
    expect(new Date(renewed).getTime()).toBeGreaterThan(Date.now());
  });

  it("terminally completes a retained release decision", async () => {
    await transactions.withAccountCredential(Buffer.from(credential), "purchase_reserve",
      (transaction) => repository.reservePurchase(transaction, { requestId: "checkout-retained", provider: "paypal",
        purchaseKind: "subscription", offer: "annual", providerCatalogItem: "plan-annual", campaignCode: null,
        expectedGrossMinor: 1_900, expectedCurrency: "USD", requestDigest: hash("retained") }));
    await ownerPool.query("SET ROLE gd_licensing_owner");
    await ownerPool.query(`INSERT INTO licensing_private.commercial_jobs(job_id,kind,account_id,state)
      VALUES(gen_random_uuid(),'release','commercial-a','ready')`);
    await ownerPool.query("RESET ROLE");

    await ownerPool.query("SET ROLE gd_licensing_worker_definer");
    const work = await repository.leaseReleaseWork(ownerPool, "worker-retained");
    expect(work).not.toBeNull();
    await expect(repository.releaseProviderSlot(ownerPool, work!)).resolves.toMatchObject({ released: false, slotEpoch: 1 });
    await ownerPool.query("RESET ROLE");

    await ownerPool.query("SET ROLE gd_licensing_owner");
    const job = await ownerPool.query<{ state: string; lease_owner: string | null }>(
      "SELECT state,lease_owner FROM licensing_private.commercial_jobs WHERE job_id=$1", [work!.workId]);
    await ownerPool.query("RESET ROLE");
    expect(job.rows).toEqual([{ state: "succeeded", lease_owner: null }]);
  });

  it("accepts the first paid fixed-term refund once and immediately makes authority read-only", async () => {
    const purchase = "10000000-0000-4000-8000-000000000001";
    const claim = "10000000-0000-4000-8000-000000000002";
    const agreement = "10000000-0000-4000-8000-000000000003";
    const ownership = "10000000-0000-4000-8000-000000000004";
    const operation = "10000000-0000-4000-8000-000000000005";
    const observation = "10000000-0000-4000-8000-000000000006";
    const right = "10000000-0000-4000-8000-000000000007";
    const payment = "10000000-0000-4000-8000-000000000008";
    const canonicalDigest = hash("refund-canonical");
    const paymentDigest = hash("refund-payment");
    await ownerPool.query("SET ROLE gd_licensing_owner");
    await ownerPool.query(`INSERT INTO licensing_private.purchase_attempts(account_id,purchase_attempt_id,request_id,request_digest,
      provider,purchase_kind,offer,provider_catalog_item,expected_gross_minor,expected_currency,state)
      VALUES('commercial-a',$1,'original-fixed',$2,'stripe','fixed_term','ten_year','price-ten-year',49_800,'USD','agreement_bound')`, [purchase, hash("original-fixed")]);
    await ownerPool.query(`INSERT INTO licensing_private.binding_claims VALUES($1,'commercial-a',$2,$3)`, [claim, purchase, hash("claim")]);
    await ownerPool.query(`INSERT INTO licensing_private.provider_resource_bindings(provider,resource_kind,resource_id,binding_claim_id,
      account_id,purchase_attempt_id,creating_operation_id,binding_digest) VALUES
      ('stripe','checkout_session','cs_refund',$1,'commercial-a',$2,$3,$4),
      ('stripe','charge','ch_refund',$1,'commercial-a',$2,$3,$5)`, [claim, purchase, operation, canonicalDigest, paymentDigest]);
    await ownerPool.query(`INSERT INTO licensing_private.provider_agreements(account_id,provider_agreement_id,purchase_attempt_id,provider,
      purchase_kind,canonical_provider,canonical_resource_kind,canonical_resource_id,state,agreement_revision,latest_applied_generation,
      provider_access,renewal_disposition,protected_paid_through,current_observation_id,handoff_digest)
      VALUES('commercial-a',$1,$2,'stripe','fixed_term','stripe','checkout_session','cs_refund','active',1,1,'active','nonrenewing',
      transaction_timestamp()+interval '10 years',$3,$4)`, [agreement, purchase, observation, hash("handoff")]);
    await ownerPool.query(`INSERT INTO licensing_private.agreement_resource_links VALUES
      ('commercial-a',$1,'stripe','checkout_session','cs_refund','canonical_agreement',$2),
      ('commercial-a',$1,'stripe','charge','ch_refund','initial_payment',$3)`, [agreement, canonicalDigest, paymentDigest]);
    await ownerPool.query(`INSERT INTO licensing_private.agreement_observations(observation_id,account_id,provider_agreement_id,
      requested_generation,lease_epoch,provider_access,renewal_disposition,observed_paid_through,observed_at,plan,
      feature_entitlements,reversal,observation_digest,refund_fact,disposition) VALUES($1,'commercial-a',$2,1,1,'active',
      'nonrenewing',transaction_timestamp()+interval '10 years',transaction_timestamp(),'ten-year',ARRAY['core'],'none',$3,'none','applied')`,
      [observation, agreement, hash("observation")]);
    await ownerPool.query(`INSERT INTO licensing_private.commercial_payment_evidence(payment_evidence_id,account_id,purchase_attempt_id,
      provider_agreement_id,provider,resource_kind,resource_id,purpose,settled_at,gross_minor,currency,source_digest,observation_generation)
      VALUES($1,'commercial-a',$2,$3,'stripe','charge','ch_refund','acquisition_initial',transaction_timestamp(),12000,'USD',$4,1)`,
      [payment, purchase, agreement, paymentDigest]);
    await ownerPool.query(`INSERT INTO licensing_private.commercial_payment_refund_heads
      (payment_evidence_id,cumulative_refunded_minor,source_digest,observation_generation) VALUES($1,0,$2,1)`,
      [payment, paymentDigest]);
    await ownerPool.query(`INSERT INTO licensing_private.first_paid_purchase_eligibilities(account_id,first_payment_evidence_id,
      purchase_attempt_id,provider_agreement_id,purchase_kind,window_starts_at,window_ends_at,gross_minor,currency,state)
      VALUES('commercial-a',$1,$2,$3,'fixed_term',transaction_timestamp(),transaction_timestamp()+interval '336 hours',12000,'USD','available')`,
      [payment, purchase, agreement]);
    await ownerPool.query(`INSERT INTO licensing_private.commercial_provider_slot_versions VALUES
      ('commercial-a',1,$1,'agreement_held','not_requested',NULL,$2,$3,transaction_timestamp())`, [ownership, agreement, operation]);
    await ownerPool.query(`INSERT INTO licensing_private.commercial_provider_slots VALUES
      ('commercial-a',1,$1,'agreement_held','not_requested',NULL,$2,$3)`, [ownership, agreement, operation]);
    await ownerPool.query(`INSERT INTO licensing_private.commercial_rights(account_id,right_id,provider_agreement_id,state,plan,purchase_kind,
      commercial_expires_at,feature_entitlements,source_observation_id) VALUES('commercial-a',$1,$2,'active','ten-year','fixed_term',
      transaction_timestamp()+interval '10 years',ARRAY['core'],$3)`, [right, agreement, observation]);
    await ownerPool.query(`INSERT INTO licensing_private.commercial_authorities VALUES('commercial-a',1,$1,$2,true,transaction_timestamp())`,
      [agreement, right]);
    await ownerPool.query(`INSERT INTO licensing_private.account_entitlement_projections VALUES
      ('commercial-a',1,$1,'active','ten-year','fixed_term',transaction_timestamp()+interval '10 years',ARRAY['core'],$2,transaction_timestamp())`,
      [right, hash("projection")]);
    await ownerPool.query("RESET ROLE");

    const accepted = acceptedRefund(await transactions.withAccountCredential(Buffer.from(credential), "refund_request",
      (transaction) => repository.requestFirstPurchaseRefund(transaction, { requestId: "refund-first",
        expectedPurchaseAttemptId: purchase, requestDigest: hash("refund-first") })));
    expect(accepted).toMatchObject({ state: "refund_pending", expectedPurchaseAttemptId: purchase, replay: "created" });
    expect(accepted.operation).toBeNull();
    await ownerPool.query("SET ROLE gd_licensing_worker_definer");
    const freshWork = await repository.leaseProviderOperationWork(ownerPool, "refund-first-worker");
    await ownerPool.query("RESET ROLE");
    expect(freshWork).toMatchObject({ operationKind: "first_purchase_refund",
      providerResourceKind: "charge", providerResourceId: "ch_refund" });
    const status = await transactions.withAccountCredential(Buffer.from(credential), "billing_read",
      (transaction) => repository.readFirstPurchaseRefundStatus(transaction, accepted.refundRequestId));
    expect(status).toMatchObject({ state: "refund_pending", remainingMinorAtAcceptance: 12000 });

    await ownerPool.query("SET ROLE gd_licensing_owner");
    const authority = await ownerPool.query<{ grants_access: boolean; reason: string }>(`SELECT a.grants_access,r.reason
      FROM licensing_private.commercial_authorities a JOIN licensing_private.commercial_rights r
        ON r.account_id=a.account_id AND r.right_id=a.right_id WHERE a.account_id='commercial-a'`);
    await ownerPool.query("RESET ROLE");
    expect(authority.rows).toEqual([{ grants_access: false, reason: "first_purchase_refund_requested" }]);
  });

  it("revokes an unconsumed permit and safely replans expired work", async () => {
    const plan = await transactions.withAccountCredential(Buffer.from(credential), "purchase_reserve",
      (transaction) => repository.reservePurchase(transaction, { requestId: "checkout-issued-crash", provider: "stripe",
        purchaseKind: "subscription", offer: "monthly", providerCatalogItem: "price-monthly", campaignCode: null,
        expectedGrossMinor: 980, expectedCurrency: "USD", requestDigest: hash("issued-crash") }));
    await ownerPool.query("SET ROLE gd_licensing_worker_definer");
    const permit = await repository.issueDispatchPermit(ownerPool, plan.work, 30);
    await ownerPool.query("SET ROLE gd_licensing_owner");
    await ownerPool.query("UPDATE licensing_private.provider_operation_work SET lease_expires_at=transaction_timestamp()-interval '1 second' WHERE work_id=$1",
      [plan.work.workId]);
    await ownerPool.query("RESET ROLE");

    await ownerPool.query("SET ROLE gd_licensing_worker_definer");
    const recovered = await repository.leaseProviderOperationWork(ownerPool, "worker-issued-recovery");
    await ownerPool.query("RESET ROLE");
    expect(recovered).toMatchObject({ purchaseAttemptId: plan.purchaseAttemptId, purchaseKind: "subscription",
      offer: "monthly", providerCatalogItem: "price-monthly", campaignCode: null,
      operationKind: "subscription_create", providerResourceKind: null, providerResourceId: null });

    await ownerPool.query("SET ROLE gd_licensing_owner");
    const facts = await ownerPool.query<{ operation_state: string; permit_state: string }>(`
      SELECT po.state AS operation_state,pdp.state AS permit_state FROM licensing_private.provider_operations po
      JOIN licensing_private.provider_dispatch_permits pdp ON pdp.provider_operation_id=po.provider_operation_id
      WHERE pdp.dispatch_permit_id=$1`, [permit.dispatchPermitId]);
    await ownerPool.query("RESET ROLE");
    expect(facts.rows).toEqual([{ operation_state: "planned", permit_state: "revoked" }]);
  });

  it("recovers a consumed crash as read-before-write outcome unknown", async () => {
    const plan = await transactions.withAccountCredential(Buffer.from(credential), "purchase_reserve",
      (transaction) => repository.reservePurchase(transaction, { requestId: "checkout-consumed-crash", provider: "paypal",
        purchaseKind: "subscription", offer: "annual", providerCatalogItem: "plan-annual", campaignCode: null,
        expectedGrossMinor: 1_900, expectedCurrency: "USD", requestDigest: hash("consumed-crash") }));
    await ownerPool.query("SET ROLE gd_licensing_worker_definer");
    const permit = await repository.issueDispatchPermit(ownerPool, plan.work, 30);
    await repository.consumeDispatchPermit(ownerPool, plan.work, permit);
    await ownerPool.query("RESET ROLE");
    await ownerPool.query("SET ROLE gd_licensing_owner");
    await ownerPool.query("UPDATE licensing_private.provider_operation_work SET lease_expires_at=transaction_timestamp()-interval '1 second' WHERE work_id=$1",
      [plan.work.workId]);
    await ownerPool.query("RESET ROLE");

    await ownerPool.query("SET ROLE gd_licensing_worker_definer");
    const recovered = await repository.leaseProviderOperationWork(ownerPool, "worker-consumed-recovery");
    expect(recovered).not.toBeNull();
    await expect(repository.readOperationReplay(ownerPool, recovered!)).resolves.toMatchObject({
      state: "outcome_unknown", resources: [], disposition: "current",
    });
    await ownerPool.query("RESET ROLE");
  });

  it("replays the same agreement handoff after the slot becomes agreement-held", async () => {
    const command = { requestId: "checkout-handoff-replay", provider: "paypal" as const,
      purchaseKind: "subscription" as const, offer: "monthly" as const,
      providerCatalogItem: "plan-monthly", campaignCode: null, expectedGrossMinor: 980,
      expectedCurrency: "USD" as const, requestDigest: hash("handoff-replay") };
    const plan = await transactions.withAccountCredential(Buffer.from(credential), "purchase_reserve",
      (transaction) => repository.reservePurchase(transaction, command));
    const bindingDigest = hash("paypal-subscription-binding");
    await ownerPool.query("SET ROLE gd_licensing_worker_definer");
    const permit = await repository.issueDispatchPermit(ownerPool, plan.work, 30);
    await repository.consumeDispatchPermit(ownerPool, plan.work, permit);
    await repository.recordOperationResult(ownerPool, plan.work, permit, { outcome: "confirmed",
      responseDigest: hash("paypal-subscription-created"), resources: [{ resourceKind: "subscription",
        resourceId: "I-SUBSCRIPTION-1", bindingDigest, role: "created" }] });
    const initialPaymentDigest = hash("paypal-initial-payment");
    const handoff = { observationDigest: hash("paypal-subscription-observation"), paymentResources: [{
      resourceKind: "sale" as const, resourceId: "SALE-INITIAL-1", bindingDigest: initialPaymentDigest,
    }], handoff: {
      kind: "paypal_subscription" as const, subscription: { resourceKind: "subscription",
        resourceId: "I-SUBSCRIPTION-1", bindingDigest, role: "canonical_agreement" as const } } };
    const first = await repository.handoffProviderAgreement(ownerPool, plan.work, handoff);
    await ownerPool.query("RESET ROLE");
    expect(first.replay).toBe("created");

    const replayPlan = await transactions.withAccountCredential(Buffer.from(credential), "purchase_reserve",
      (transaction) => repository.reservePurchase(transaction, command));
    await ownerPool.query("SET ROLE gd_licensing_worker_definer");
    await expect(repository.handoffProviderAgreement(ownerPool, replayPlan.work,
      { ...handoff, observationDigest: hash("changed-handoff-observation") })).rejects.toMatchObject({ code: "23505" });
    await ownerPool.query("SET ROLE gd_licensing_worker_definer");
    const second = await repository.handoffProviderAgreement(ownerPool, replayPlan.work, handoff);
    await ownerPool.query("RESET ROLE");
    expect(second).toEqual({ providerAgreementId: first.providerAgreementId, slotEpoch: first.slotEpoch,
      replay: "same_handoff" });
    await ownerPool.query("SET ROLE gd_licensing_owner");
    const initialLink = await ownerPool.query<{ role: string; linked: boolean }>(`SELECT arl.role,
      rb.binding_digest=$2 AS linked FROM licensing_private.agreement_resource_links arl
      JOIN licensing_private.provider_resource_bindings rb USING(provider,resource_kind,resource_id)
      WHERE arl.provider_agreement_id=$1 AND arl.resource_id='SALE-INITIAL-1'`, [first.providerAgreementId, initialPaymentDigest]);
    await ownerPool.query("RESET ROLE");
    expect(initialLink.rows).toEqual([{ role: "initial_payment", linked: true }]);
  });

  it("quarantines altered resource evidence for the same consumed permit", async () => {
    const plan = await transactions.withAccountCredential(Buffer.from(credential), "purchase_reserve",
      (transaction) => repository.reservePurchase(transaction, { requestId: "checkout-result-conflict", provider: "paypal",
        purchaseKind: "subscription", offer: "monthly", providerCatalogItem: "plan-monthly", campaignCode: null,
        expectedGrossMinor: 980, expectedCurrency: "USD", requestDigest: hash("result-conflict") }));
    await ownerPool.query("SET ROLE gd_licensing_worker_definer");
    const permit = await repository.issueDispatchPermit(ownerPool, plan.work, 30);
    await repository.consumeDispatchPermit(ownerPool, plan.work, permit);
    const result = { outcome: "confirmed" as const, responseDigest: hash("same-provider-result"), resources: [{
      resourceKind: "subscription", resourceId: "I-ORIGINAL", bindingDigest: hash("original-binding"), role: "created" as const }] };
    await expect(repository.recordOperationResult(ownerPool, plan.work, permit, result)).resolves.toMatchObject({ disposition: "current" });
    await expect(repository.recordOperationResult(ownerPool, plan.work, permit, { ...result, resources: [{ ...result.resources[0]!,
      resourceId: "I-ALTERED", bindingDigest: hash("altered-binding") }] })).resolves.toMatchObject({ disposition: "quarantined" });
    await ownerPool.query("RESET ROLE");

    await ownerPool.query("SET ROLE gd_licensing_owner");
    const work = await ownerPool.query<{ state: string }>(
      "SELECT state FROM licensing_private.provider_operation_work WHERE work_id=$1", [plan.work.workId]);
    await ownerPool.query("RESET ROLE");
    expect(work.rows).toEqual([{ state: "quarantined" }]);
  });

  it("consumes one permit and releases only a deterministically rejected current attempt", async () => {
    const command = { requestId: "checkout-rejected", provider: "paypal" as const,
      purchaseKind: "subscription" as const, offer: "monthly" as const,
      providerCatalogItem: "plan-monthly", campaignCode: null, expectedGrossMinor: 980,
      expectedCurrency: "USD" as const, requestDigest: hash("rejected") };
    const plan = await transactions.withAccountCredential(Buffer.from(credential), "purchase_reserve",
      (transaction) => repository.reservePurchase(transaction, command));
    await ownerPool.query("SET ROLE gd_licensing_worker_definer");
    const permit = await repository.issueDispatchPermit(ownerPool, plan.work, 30);
    const consumed = await repository.consumeDispatchPermit(ownerPool, plan.work, permit);
    expect(consumed.operationRevision).toBe(permit.operationRevision);
    await expect(repository.consumeDispatchPermit(ownerPool, plan.work, permit)).rejects.toMatchObject({ code: "40001" });
    await ownerPool.query("SET ROLE gd_licensing_worker_definer");
    await repository.recordOperationResult(ownerPool, plan.work, permit,
      { outcome: "rejected", responseDigest: hash("provider-rejected"), resources: [] });
    const release = await repository.leaseReleaseWork(ownerPool, "worker-release-1");
    expect(release).not.toBeNull();
    await expect(repository.releaseProviderSlot(ownerPool, release!)).resolves.toMatchObject({ released: true, slotEpoch: 2 });
    await ownerPool.query("RESET ROLE");

    await ownerPool.query("SET ROLE gd_licensing_owner");
    const slot = await ownerPool.query<{ state: string; slot_epoch: string }>(
      "SELECT state,slot_epoch::text FROM licensing_private.commercial_provider_slots WHERE account_id='commercial-a'",
    );
    const operationWork = await ownerPool.query<{ state: string }>(
      "SELECT state FROM licensing_private.provider_operation_work WHERE work_id=$1", [plan.work.workId]);
    await ownerPool.query("RESET ROLE");
    expect(slot.rows).toEqual([{ state: "vacant", slot_epoch: "2" }]);
    expect(operationWork.rows).toEqual([{ state: "succeeded" }]);

    const reacquired = await transactions.withAccountCredential(Buffer.from(credential), "purchase_reserve",
      (transaction) => repository.reservePurchase(transaction, { ...command, requestId: "checkout-after-release",
        requestDigest: hash("after-release") }));
    expect(reacquired).toMatchObject({ replay: "created", slotEpoch: 3 });
    expect(reacquired.slotOwnershipId).not.toBe(plan.slotOwnershipId);
  });
});

async function seed(accountId: string, sessionCredential: string): Promise<void> {
  await ownerPool.query(`INSERT INTO public.identity_accounts
    (account_id,email_normalized,password_policy_id,password_hash_phc)
    VALUES($1,$2,'argon2id-v1',repeat('x',80))`, [accountId, `${accountId}@example.invalid`]);
  await ownerPool.query("INSERT INTO public.identity_account_security_states(account_id) VALUES($1)", [accountId]);
  await ownerPool.query(`INSERT INTO public.identity_auth_sessions
    (account_id,session_id,client_kind,auth_method,remember_device,epoch_at_issue,expires_at)
    VALUES($1,$2,'account_web','password',true,1,transaction_timestamp()+interval '1 hour')`, [accountId, sessionCredential]);
  await ownerPool.query(`INSERT INTO public.identity_refresh_families(account_id,family_id,session_id,current_refresh_jti)
    VALUES($1,$2,$3,$4)`, [accountId, `family-${accountId}`, sessionCredential, `refresh-${accountId}`]);
}

function hash(value: string): Uint8Array { return createHash("sha256").update(value).digest(); }
function acceptedRefund(decision: FirstPurchaseRefundDecision) {
  expect(decision.disposition).toBe("accepted");
  if (decision.disposition !== "accepted") throw new Error(`refund was rejected: ${decision.reason}`);
  return decision.acceptance;
}
function required(name: string): string { const value = process.env[name]; if (!value) throw new TypeError(`${name} is required`); return value; }
