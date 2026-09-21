import { createHash } from "node:crypto";

import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { IdentityCapabilityTransactionRunner, runCloudMigrations } from "../../src/db/index";
import { cloudMigrations } from "../../src/db/migrations";
import type {
  ApplyAgreementObservationCommand,
  BoundReconciliationWork,
  BoundProviderOperationWork,
  CommercialPurchaseKind,
  FirstPurchaseRefundDecision,
  SupplementalAgreementResourceFact,
} from "../../src/modules/licensing/commercial-domain";
import { PostgresCommercialAggregateRepository } from "../../src/modules/licensing/index";
import { clearLicensingTestData } from "../support/postgres-fixture";

const ownerPool = new Pool({ connectionString: required("GOODDEALER_POSTGRES_OWNER_URL"), max: 3 });
const accountPool = new Pool({ connectionString: required("GOODDEALER_POSTGRES_ACCOUNT_API_URL"), max: 3 });
const issuerPool = new Pool({ connectionString: required("GOODDEALER_POSTGRES_IDENTITY_ISSUER_URL"), max: 1 });
const transactions = new IdentityCapabilityTransactionRunner(accountPool, issuerPool);
const repository = new PostgresCommercialAggregateRepository();
const accountId = "commercial-lifecycle-regression";
const credential = "commercial-lifecycle-regression-credential";

beforeAll(async () => { await runCloudMigrations(ownerPool, cloudMigrations); });

beforeEach(async () => {
  await clearLicensingTestData(ownerPool);
  await withRole("gd_identity_owner", (client) => client.query(
    "DELETE FROM identity_private.account_transaction_capabilities WHERE account_id=$1",
    [accountId],
  ));
  await ownerPool.query("DELETE FROM public.identity_credential_jtis WHERE account_id=$1", [accountId]);
  await ownerPool.query("DELETE FROM public.identity_refresh_families WHERE account_id=$1", [accountId]);
  await ownerPool.query("DELETE FROM public.identity_auth_sessions WHERE account_id=$1", [accountId]);
  await ownerPool.query("DELETE FROM public.identity_account_security_states WHERE account_id=$1", [accountId]);
  await ownerPool.query("DELETE FROM public.workspace_account_bindings WHERE account_id=$1", [accountId]);
  await ownerPool.query("DELETE FROM public.workspace_workspaces WHERE account_id=$1", [accountId]);
  await ownerPool.query("DELETE FROM public.identity_accounts WHERE account_id=$1", [accountId]);
  await seedIdentity();
});

afterAll(async () => { await Promise.all([ownerPool.end(), accountPool.end(), issuerPool.end()]); });

describe("Licensing lifecycle regression closure", () => {
  it("releases a rejected attempt and advances the slot again when repurchasing through another provider", async () => {
    const first = await reserve("release-first", "stripe", "subscription");
    await withRole("gd_licensing_worker_definer", async (worker) => {
      const permit = await repository.issueDispatchPermit(worker, first.work, 30);
      await repository.consumeDispatchPermit(worker, first.work, permit);
      await repository.recordOperationResult(worker, first.work, permit, {
        outcome: "rejected", responseDigest: hash("release-first-rejected"), resources: [],
      });
      const release = await repository.leaseReleaseWork(worker, "release-worker");
      expect(release).not.toBeNull();
      await expect(repository.releaseProviderSlot(worker, release!))
        .resolves.toEqual({ released: true, slotEpoch: 2 });
    });

    const second = await reserve("release-second", "paypal", "subscription");
    expect(second).toMatchObject({ provider: "paypal", slotEpoch: 3, replay: "created" });
    expect(second.slotOwnershipId).not.toBe(first.slotOwnershipId);
  });

  it("dead-letters one operation, redrives exactly one child, and keeps the parent and old token terminal", async () => {
    const plan = await reserve("dead-letter", "stripe", "subscription");
    await withRole("gd_licensing_owner", (owner) => owner.query(
      `UPDATE licensing_private.provider_operation_work
        SET max_attempts=1,lease_expires_at=transaction_timestamp()-interval '1 second' WHERE work_id=$1`,
      [plan.work.workId],
    ));

    await withRole("gd_licensing_worker_definer", async (worker) => {
      const current = await repository.leaseProviderOperationWork(worker, "dead-letter-worker");
      expect(current).not.toBeNull();
      await expect(repository.failBoundWork(worker, current!, "transient_network", 0)).resolves.toBe("dead_letter");
    });
    const child = await withRole("gd_licensing_worker_definer", (worker) =>
      repository.redriveDeadLetterOperation(worker, "redrive-worker", "operator-reviewed"));
    expect(child).toMatchObject({ parentWorkId: plan.work.workId, providerOperationId: plan.providerOperationId });
    expect(child?.workId).not.toBe(plan.work.workId);
    await withRole("gd_licensing_worker_definer", async (worker) => {
      const permit = await repository.issueDispatchPermit(worker, child!, 30);
      await repository.consumeDispatchPermit(worker, child!, permit);
      await expect(repository.recordOperationResult(worker, child!, permit, {
        outcome: "confirmed",
        responseDigest: hash("dead-letter-redrive-success"),
        resources: [{ resourceKind: "subscription", resourceId: "subscription-dead-letter-redrive",
          bindingDigest: hash("subscription-dead-letter-redrive"), role: "created" }],
      })).resolves.toMatchObject({ state: "confirmed", disposition: "current" });
    });
    await expect(withRole("gd_licensing_worker_definer", (worker) =>
      repository.heartbeatBoundWork(worker, plan.work))).rejects.toMatchObject({ code: "40001" });

    await expect(withRole("gd_licensing_owner", (owner) => owner.query(
      "UPDATE licensing_private.provider_operation_work SET state='ready' WHERE work_id=$1",
      [plan.work.workId],
    ))).rejects.toMatchObject({ code: "55000" });
    await expect(withRole("gd_licensing_owner", (owner) => owner.query(
      "DELETE FROM licensing_private.provider_operation_work WHERE work_id=$1",
      [plan.work.workId],
    ))).rejects.toMatchObject({ code: "55000" });
    await withRole("gd_licensing_owner", async (owner) => {
      const rows = await owner.query<{ state: string; children: string }>(`
        SELECT parent.state,
          (SELECT count(*)::text FROM licensing_private.provider_operation_work child
            WHERE child.parent_work_id=parent.work_id) AS children
        FROM licensing_private.provider_operation_work parent WHERE parent.work_id=$1`, [plan.work.workId]);
      expect(rows.rows).toEqual([{ state: "dead_letter", children: "1" }]);
    });
  });

  it("linearizes concurrent equal and different first receipts as scheduled/duplicate/conflict without uniqueness errors", async () => {
    const base = {
      kind: "ignored" as const,
      provider: "stripe" as const,
      providerEventId: "evt-lifecycle-race",
      payloadDigest: hash("receipt-one"),
      eventType: "unrelated.event",
      triggerResourceKind: null,
      triggerResourceId: null,
      ignoredReason: "unsupported_event" as const,
      occurredAt: "2026-09-03T00:00:00Z",
      authenticatedEvidenceRef: "receipt:lifecycle-race",
    };
    const equal = await Promise.all([
      withRole("gd_licensing_ingress_definer", (ingress) => repository.receiveAuthenticatedReceipt(ingress, base)),
      withRole("gd_licensing_ingress_definer", (ingress) => repository.receiveAuthenticatedReceipt(ingress, base)),
    ]);
    expect(equal.sort()).toEqual(["duplicate", "ignored"]);

    const conflict = await Promise.all([
      withRole("gd_licensing_ingress_definer", (ingress) => repository.receiveAuthenticatedReceipt(ingress, {
        ...base, providerEventId: "evt-lifecycle-conflict", payloadDigest: hash("conflict-a"),
      })),
      withRole("gd_licensing_ingress_definer", (ingress) => repository.receiveAuthenticatedReceipt(ingress, {
        ...base, providerEventId: "evt-lifecycle-conflict", payloadDigest: hash("conflict-b"),
      })),
    ]);
    expect(conflict).toContain("ignored");
    expect(conflict).toContain("conflict");

    await withRole("gd_licensing_owner", async (owner) => {
      const counts = await owner.query<{ receipts: string; conflicts: string }>(`
        SELECT (SELECT count(*)::text FROM licensing_private.provider_receipts) AS receipts,
          (SELECT count(*)::text FROM licensing_private.provider_receipt_conflicts) AS conflicts`);
      expect(counts.rows).toEqual([{ receipts: "2", conflicts: "1" }]);
    });
  });

  it("advances E1 to renewed E2 grace without resetting first-payment eligibility and makes the old due job stale", async () => {
    const agreement = await establishAgreement("renewal", "subscription");
    const initialPayment = { kind: "sale" as const, id: "sale-renewal-initial", digest: hash("sale-renewal-initial") };
    const firstWork = await scheduleReconciliation(agreement, "renewal-e1", initialPayment);
    let firstApply;
    await withRole("gd_licensing_worker_definer", async (worker) => {
      firstApply = await repository.applyAgreementObservationAndAuthority(worker, firstWork, observationCommand({
        payment: { purpose: "acquisition_initial", resourceKind: initialPayment.kind,
          resourceId: initialPayment.id, bindingDigest: initialPayment.digest,
          settledAt: new Date(Date.now() - 60_000).toISOString(), grossMinor: 980, cumulativeRefundedMinor: 0 },
        digestLabel: "renewal-e1",
        paidThrough: new Date(Date.now() + 86_400_000).toISOString(),
      }));
    });
    expect(firstApply).toMatchObject({ disposition: "applied", authorityRevision: 1 });
    const initialEligibility = await eligibilityFacts();

    const renewalPayment = { kind: "sale" as const, id: "sale-renewal-cycle", digest: hash("sale-renewal-cycle") };
    const secondWork = await scheduleReconciliation(agreement, "renewal-e2", renewalPayment);
    await withRole("gd_licensing_worker_definer", async (worker) => {
      await expect(repository.applyAgreementObservationAndAuthority(worker, secondWork, observationCommand({
        payment: { purpose: "renewal", resourceKind: renewalPayment.kind,
          resourceId: renewalPayment.id, bindingDigest: renewalPayment.digest,
          settledAt: new Date().toISOString(), grossMinor: 980, cumulativeRefundedMinor: 0 },
        digestLabel: "renewal-e2", access: "delinquent",
        paidThrough: new Date(Date.now() + 172_800_000).toISOString(),
      }))).resolves.toMatchObject({ disposition: "applied", authorityRevision: 2 });
    });
    expect(await eligibilityFacts()).toEqual(initialEligibility);

    await withRole("gd_licensing_owner", async (owner) => {
      await owner.query(`UPDATE licensing_private.commercial_jobs SET next_attempt_at=transaction_timestamp()
        WHERE job_id=(SELECT job_id FROM licensing_private.commercial_jobs
          WHERE kind='due_authority' ORDER BY expected_agreement_revision,job_id LIMIT 1)`);
    });
    await withRole("gd_licensing_worker_definer", async (worker) => {
      const oldDue = await repository.leaseDueAuthorityWork(worker, "old-due-worker");
      expect(oldDue).not.toBeNull();
      await expect(repository.applyDueAuthority(worker, oldDue!))
        .resolves.toMatchObject({ disposition: "stale_agreement", authorityRevision: 2 });
    });
    await withRole("gd_licensing_owner", async (owner) => {
      const projection = await owner.query<{ state: string; authority_revision: string }>(
        `SELECT state,authority_revision::text FROM licensing_private.account_entitlement_projections
          WHERE account_id=$1`, [accountId],
      );
      expect(projection.rows).toEqual([{ state: "grace", authority_revision: "2" }]);
    });
  });

  it.each([
    ["amount", { grossMinor: 981 }],
    ["currency", { currency: "EUR" as "USD" }],
  ] as const)("rejects initial payment evidence whose %s differs from the immutable purchase price", async (_field, override) => {
    const agreement = await establishAgreement(`price-mismatch-${_field}`, "subscription");
    const payment = { kind: "sale" as const, id: `sale-price-mismatch-${_field}`,
      digest: hash(`sale-price-mismatch-${_field}`) };
    const work = await scheduleReconciliation(agreement, `price-mismatch-${_field}`, payment);
    const command = observationCommand({ payment: { purpose: "acquisition_initial", resourceKind: payment.kind,
      resourceId: payment.id, bindingDigest: payment.digest, settledAt: new Date().toISOString(),
      grossMinor: 980, cumulativeRefundedMinor: 0 }, digestLabel: `price-mismatch-${_field}` });

    await withRole("gd_licensing_worker_definer", async (worker) => {
      await expect(repository.applyAgreementObservationAndAuthority(worker, work, {
        ...command, paymentEvidence: { ...command.paymentEvidence!, ...override },
      })).rejects.toMatchObject({ code: "22023" });
    });
    await withRole("gd_licensing_owner", async (owner) => {
      const result = await owner.query<{ evidence_count: string; authority_revision: string }>(`
        SELECT (SELECT count(*)::text FROM licensing_private.commercial_payment_evidence
          WHERE account_id=$1) AS evidence_count,
          (SELECT authority_revision::text FROM licensing_private.commercial_authorities WHERE account_id=$1) AS authority_revision`,
      [accountId]);
      expect(result.rows).toEqual([{ evidence_count: "0", authority_revision: null }]);
    });
  });

  it.each([
    ["binding", (work: BoundReconciliationWork) => ({ ...work, expectedBindingDigest: hash("wrong-binding") })],
    ["slot", (work: BoundReconciliationWork) => ({ ...work, expectedSlotEpoch: work.expectedSlotEpoch + 1 })],
    ["agreement", (work: BoundReconciliationWork) => ({ ...work, expectedAgreementRevision: work.expectedAgreementRevision + 1 })],
    ["authority", (work: BoundReconciliationWork) => ({ ...work, expectedAuthorityRevision: work.expectedAuthorityRevision + 1 })],
  ] as const)("rejects an independently stale expected %s fence with zero observation or authority writes", async (_name, alter) => {
    const agreement = await establishAgreement("fence", "subscription");
    const work = await scheduleReconciliation(agreement, "fence", null);
    const before = await licensingCounts();
    await withRole("gd_licensing_worker_definer", async (worker) => {
      await expect(repository.applyAgreementObservationAndAuthority(worker, alter(work), observationCommand({
        payment: null, digestLabel: `fence-${_name}`,
      }))).rejects.toMatchObject({ code: "40001" });
    });
    expect(await licensingCounts()).toEqual(before);
  });

  it("keeps every accepted refund state permanently non-granting under fresh active Provider observations", async () => {
    const active = await activateAgreement("refund-regrant-fence", "subscription",
      new Date(Date.now() - 60_000).toISOString(), new Date(Date.now() + 86_400_000).toISOString());
    const accepted = acceptedRefund(await transactions.withAccountCredential(Buffer.from(credential), "refund_request", (transaction) =>
      repository.requestFirstPurchaseRefund(transaction, {
        requestId: "refund-regrant-fence-request",
        expectedPurchaseAttemptId: active.agreement.purchaseAttemptId,
        requestDigest: hash("refund-regrant-fence-request"),
      })));

    const acceptedStates = ["termination_pending", "termination_unknown", "refund_pending", "refund_unknown",
      "retry_wait", "manual_resolution", "refunded"] as const;
    for (const [index, state] of acceptedStates.entries()) {
      await withRole("gd_licensing_owner", (owner) => owner.query(`UPDATE licensing_private.first_purchase_refund_requests
        SET state=$3,retry_at=CASE WHEN $3='retry_wait' THEN transaction_timestamp()+interval '5 seconds' END,
          completed_at=CASE WHEN $3='refunded' THEN transaction_timestamp() END
        WHERE account_id=$1 AND refund_request_id=$2`, [accountId, accepted.refundRequestId, state]));
      const work = await scheduleReconciliation(active.agreement, `refund-regrant-${index}`, active.payment);
      await withRole("gd_licensing_worker_definer", async (worker) => {
        await expect(repository.applyAgreementObservationAndAuthority(worker, work, observationCommand({
          payment: { purpose: "acquisition_initial", resourceKind: active.payment.kind,
            resourceId: active.payment.id, bindingDigest: active.payment.digest,
            settledAt: active.settledAt, grossMinor: 980, cumulativeRefundedMinor: 0 },
          digestLabel: `refund-regrant-${index}`, access: "active", renewal: "renewing",
          paidThrough: active.paidThrough, refundFact: "none",
        }))).resolves.toMatchObject({ disposition: "applied" });
      });
      await expectReadOnlyAuthority();
    }
  });

  it("projects the account-lifetime first-purchase refund window only for the eligible current purchase", async () => {
    const active = await activateAgreement("refund-status-window", "subscription",
      new Date(Date.now() - 60_000).toISOString(), new Date(Date.now() + 86_400_000).toISOString());
    const initial = await transactions.withAccountCredential(Buffer.from(credential), "billing_read", (transaction) =>
      repository.readBillingStatus(transaction));
    expect(initial?.refundEligibleUntil).not.toBeNull();
    const originalDeadline = initial!.refundEligibleUntil;

    const renewalPayment = { kind: "sale" as const, id: "sale-refund-status-renewal",
      digest: hash("sale-refund-status-renewal") };
    const renewal = await scheduleReconciliation(active.agreement, "refund-status-renewal", renewalPayment);
    await withRole("gd_licensing_worker_definer", (worker) =>
      repository.applyAgreementObservationAndAuthority(worker, renewal, observationCommand({
        payment: { purpose: "renewal", resourceKind: renewalPayment.kind, resourceId: renewalPayment.id,
          bindingDigest: renewalPayment.digest, settledAt: new Date().toISOString(), grossMinor: 980, cumulativeRefundedMinor: 0 },
        digestLabel: "refund-status-renewal", paidThrough: new Date(Date.now() + 172_800_000).toISOString(),
      })));
    await expect(transactions.withAccountCredential(Buffer.from(credential), "billing_read", (transaction) =>
      repository.readBillingStatus(transaction))).resolves.toMatchObject({ refundEligibleUntil: originalDeadline });

    await withRole("gd_licensing_owner", (owner) => owner.query(`UPDATE licensing_private.first_paid_purchase_eligibilities
      SET window_starts_at=transaction_timestamp()-interval '337 hours',
        window_ends_at=transaction_timestamp()-interval '1 hour',state='expired_unclaimed' WHERE account_id=$1`, [accountId]));
    const elapsed = await transactions.withAccountCredential(Buffer.from(credential), "billing_read", (transaction) =>
      repository.readBillingStatus(transaction));
    expect(elapsed!.refundEligibleUntil).toBeNull();

    await withRole("gd_licensing_owner", (owner) => owner.query(`UPDATE licensing_private.first_paid_purchase_eligibilities
      SET window_starts_at=transaction_timestamp()-interval '1 hour',
        window_ends_at=transaction_timestamp()+interval '335 hours',state='available' WHERE account_id=$1`, [accountId]));
    await transactions.withAccountCredential(Buffer.from(credential), "refund_request", (transaction) =>
      repository.requestFirstPurchaseRefund(transaction, { requestId: "refund-status-window-claim",
        expectedPurchaseAttemptId: active.agreement.purchaseAttemptId, requestDigest: hash("refund-status-window-claim") }));
    await expect(transactions.withAccountCredential(Buffer.from(credential), "billing_read", (transaction) =>
      repository.readBillingStatus(transaction))).resolves.toMatchObject({
        state: "commercial_read_only", refundEligibleUntil: null,
      });
  });

  it("returns refund rejection reasons from locked database truth and linearizes competing claims", async () => {
    const unpaid = await reserve("refund-reason-unpaid", "stripe", "subscription");
    await expect(transactions.withAccountCredential(Buffer.from(credential), "refund_request", (transaction) =>
      repository.requestFirstPurchaseRefund(transaction, { requestId: "refund-reason-unpaid",
        expectedPurchaseAttemptId: unpaid.purchaseAttemptId, requestDigest: hash("refund-reason-unpaid") })))
      .resolves.toEqual({ disposition: "rejected", reason: "not_paid" });

    await clearLicensingTestData(ownerPool);
    const replayActive = await activateAgreement("refund-concurrent-replay", "subscription",
      new Date(Date.now() - 60_000).toISOString(), new Date(Date.now() + 86_400_000).toISOString());
    const replayCommand = { requestId: "refund-concurrent-same", expectedPurchaseAttemptId: replayActive.agreement.purchaseAttemptId,
      requestDigest: hash("refund-concurrent-same") };
    const replays = await withTimeout(Promise.all([
      transactions.withAccountCredential(Buffer.from(credential), "refund_request", (transaction) =>
        repository.requestFirstPurchaseRefund(transaction, replayCommand)),
      transactions.withAccountCredential(Buffer.from(credential), "refund_request", (transaction) =>
        repository.requestFirstPurchaseRefund(transaction, replayCommand)),
    ]), 5_000);
    expect(replays.every((decision) => decision.disposition === "accepted")).toBe(true);
    if (replays[0]?.disposition !== "accepted" || replays[1]?.disposition !== "accepted") {
      throw new Error("equal concurrent refund requests were not accepted");
    }
    expect(replays[0].acceptance.refundRequestId).toBe(replays[1].acceptance.refundRequestId);
    expect([replays[0].acceptance.replay, replays[1].acceptance.replay].sort()).toEqual(["created", "same_request"]);

    await clearLicensingTestData(ownerPool);
    const active = await activateAgreement("refund-reasons", "subscription",
      new Date(Date.now() - 60_000).toISOString(), new Date(Date.now() + 86_400_000).toISOString());
    await expect(transactions.withAccountCredential(Buffer.from(credential), "refund_request", (transaction) =>
      repository.requestFirstPurchaseRefund(transaction, { requestId: "refund-reason-mismatch",
        expectedPurchaseAttemptId: "00000000-0000-4000-8000-000000000001", requestDigest: hash("refund-reason-mismatch") })))
      .resolves.toEqual({ disposition: "rejected", reason: "purchase_mismatch" });

    const competing = await Promise.all([
      transactions.withAccountCredential(Buffer.from(credential), "refund_request", (transaction) =>
        repository.requestFirstPurchaseRefund(transaction, { requestId: "refund-competing-a",
          expectedPurchaseAttemptId: active.agreement.purchaseAttemptId, requestDigest: hash("refund-competing-a") })),
      transactions.withAccountCredential(Buffer.from(credential), "refund_request", (transaction) =>
        repository.requestFirstPurchaseRefund(transaction, { requestId: "refund-competing-b",
          expectedPurchaseAttemptId: active.agreement.purchaseAttemptId, requestDigest: hash("refund-competing-b") })),
    ]);
    expect(competing.filter((decision) => decision.disposition === "accepted")).toHaveLength(1);
    expect(competing.filter((decision) => decision.disposition === "rejected"))
      .toEqual([{ disposition: "rejected", reason: "already_claimed" }]);
    const winningRequestId = competing[0]?.disposition === "accepted" ? "refund-competing-a" : "refund-competing-b";
    await expect(transactions.withAccountCredential(Buffer.from(credential), "refund_request", (transaction) =>
      repository.requestFirstPurchaseRefund(transaction, { requestId: winningRequestId,
        expectedPurchaseAttemptId: active.agreement.purchaseAttemptId, requestDigest: hash("conflicting-replay") })))
      .rejects.toMatchObject({ code: "23505" });

    await clearLicensingTestData(ownerPool);
    const elapsed = await activateAgreement("refund-reason-elapsed", "subscription",
      new Date(Date.now() - 60_000).toISOString(), new Date(Date.now() + 86_400_000).toISOString());
    await withRole("gd_licensing_owner", (owner) => owner.query(`UPDATE licensing_private.first_paid_purchase_eligibilities
      SET window_starts_at=transaction_timestamp()-interval '337 hours',
        window_ends_at=transaction_timestamp()-interval '1 hour' WHERE account_id=$1`, [accountId]));
    await expect(transactions.withAccountCredential(Buffer.from(credential), "refund_request", (transaction) =>
      repository.requestFirstPurchaseRefund(transaction, { requestId: "refund-reason-elapsed",
        expectedPurchaseAttemptId: elapsed.agreement.purchaseAttemptId, requestDigest: hash("refund-reason-elapsed") })))
      .resolves.toEqual({ disposition: "rejected", reason: "window_elapsed" });

    await clearLicensingTestData(ownerPool);
    const reversed = await activateAgreement("refund-reason-reversed", "subscription",
      new Date(Date.now() - 60_000).toISOString(), new Date(Date.now() + 86_400_000).toISOString());
    await withRole("gd_licensing_owner", (owner) => owner.query(`UPDATE licensing_private.first_paid_purchase_eligibilities
      SET state='externally_reversed' WHERE account_id=$1`, [accountId]));
    await expect(transactions.withAccountCredential(Buffer.from(credential), "refund_request", (transaction) =>
      repository.requestFirstPurchaseRefund(transaction, { requestId: "refund-reason-reversed",
        expectedPurchaseAttemptId: reversed.agreement.purchaseAttemptId, requestDigest: hash("refund-reason-reversed") })))
      .resolves.toEqual({ disposition: "rejected", reason: "already_fully_reversed" });
  });

  it("rejects a first-purchase refund at the exact eligibility deadline", async () => {
    const active = await activateAgreement("refund-exact-deadline", "subscription",
      new Date(Date.now() - 60_000).toISOString(), new Date(Date.now() + 86_400_000).toISOString());

    await expect(transactions.withAccountCredential(Buffer.from(credential), "refund_request", async (transaction) => {
      const clock = await transaction.query<{ now: Date }>("SELECT transaction_timestamp() AS now");
      const transactionTime = clock.rows[0]?.now;
      if (transactionTime === undefined) throw new Error("database transaction clock is unavailable");
      await withRole("gd_licensing_owner", (owner) => owner.query(`UPDATE licensing_private.first_paid_purchase_eligibilities
        SET window_starts_at=$2::timestamptz-interval '336 hours',window_ends_at=$2::timestamptz,state='available'
        WHERE account_id=$1`, [accountId, transactionTime]));
      return repository.requestFirstPurchaseRefund(transaction, { requestId: "refund-exact-deadline",
        expectedPurchaseAttemptId: active.agreement.purchaseAttemptId, requestDigest: hash("refund-exact-deadline") });
    })).resolves.toEqual({ disposition: "rejected", reason: "window_elapsed" });
  });

  it("serializes an identical refund replay behind a terminating worker result without a row-lock deadlock", async () => {
    const active = await activateAgreement("refund-worker-replay", "subscription",
      new Date(Date.now() - 60_000).toISOString(), new Date(Date.now() + 86_400_000).toISOString());
    const command = { requestId: "refund-worker-replay-request",
      expectedPurchaseAttemptId: active.agreement.purchaseAttemptId,
      requestDigest: hash("refund-worker-replay-request") };
    const accepted = acceptedRefund(await transactions.withAccountCredential(Buffer.from(credential), "refund_request", (transaction) =>
      repository.requestFirstPurchaseRefund(transaction, command)));
    expect(accepted.operation).toBeNull();
    const acceptedOperation = await leaseFreshRefundOperation("refund-worker-replay");
    const permit = await withRole("gd_licensing_worker_definer", async (worker) => {
      const issued = await repository.issueDispatchPermit(worker, acceptedOperation, 30);
      await repository.consumeDispatchPermit(worker, acceptedOperation, issued);
      return issued;
    });

    const worker = await ownerPool.connect();
    let replayPromise: Promise<FirstPurchaseRefundDecision> | undefined;
    try {
      await worker.query("BEGIN");
      await worker.query("SET LOCAL ROLE gd_licensing_worker_definer");
      const backend = await worker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      await worker.query("SELECT pg_advisory_xact_lock(hashtextextended('gooddealer:commercial-account:'||$1,0))", [accountId]);
      replayPromise = transactions.withAccountCredential(Buffer.from(credential), "refund_request", (transaction) =>
        repository.requestFirstPurchaseRefund(transaction, command));
      await withTimeout(waitUntil(async () => {
        const waiting = await ownerPool.query<{ waiting: boolean }>(`SELECT EXISTS(
          SELECT 1 FROM pg_locks held JOIN pg_locks waiter
            ON waiter.locktype=held.locktype
            AND waiter.database IS NOT DISTINCT FROM held.database
            AND waiter.classid IS NOT DISTINCT FROM held.classid
            AND waiter.objid IS NOT DISTINCT FROM held.objid
            AND waiter.objsubid IS NOT DISTINCT FROM held.objsubid
          WHERE held.pid=$1 AND held.locktype='advisory' AND held.granted AND NOT waiter.granted
        ) AS waiting`, [backend.rows[0]!.pid]);
        return waiting.rows[0]?.waiting === true;
      }), 2_000);
      await expect(repository.recordOperationResult(worker, acceptedOperation, permit, {
        outcome: "confirmed", responseDigest: hash("refund-worker-replay-confirmed"), resources: [],
      })).resolves.toMatchObject({ state: "confirmed", disposition: "current" });
      await worker.query("COMMIT");
      const replay = acceptedRefund(await withTimeout(replayPromise, 5_000));
      expect(replay).toMatchObject({ refundRequestId: accepted.refundRequestId,
        state: "refund_pending", replay: "same_request", operation: null });
      const identity = await withRole("gd_licensing_owner", (owner) => owner.query<{
        refund_request_id: string; request_digest: Buffer;
      }>(`SELECT refund_request_id,request_digest FROM licensing_private.first_purchase_refund_requests
        WHERE account_id=$1 AND request_id=$2`, [accountId, command.requestId]));
      expect(identity.rows).toHaveLength(1);
      expect(identity.rows[0]!.refund_request_id).toBe(accepted.refundRequestId);
      expect(identity.rows[0]!.request_digest).toEqual(Buffer.from(command.requestDigest));
    } catch (error) {
      await worker.query("ROLLBACK");
      throw error;
    } finally {
      worker.release();
    }
  });

  it("keeps termination results behind a reconciliation-held slot and converges without a refund-row deadlock", async () => {
    const active = await activateAgreement("refund-result-reconciliation", "subscription",
      new Date(Date.now() - 60_000).toISOString(), new Date(Date.now() + 86_400_000).toISOString());
    const accepted = acceptedRefund(await transactions.withAccountCredential(Buffer.from(credential), "refund_request", (transaction) =>
      repository.requestFirstPurchaseRefund(transaction, {
        requestId: "refund-result-reconciliation-request",
        expectedPurchaseAttemptId: active.agreement.purchaseAttemptId,
        requestDigest: hash("refund-result-reconciliation-request"),
      })));
    expect(accepted.operation).toBeNull();
    const acceptedOperation = await leaseFreshRefundOperation("refund-result-reconciliation");
    const permit = await withRole("gd_licensing_worker_definer", async (worker) => {
      const issued = await repository.issueDispatchPermit(worker, acceptedOperation, 30);
      await repository.consumeDispatchPermit(worker, acceptedOperation, issued);
      return issued;
    });
    const reconciliation = await scheduleReconciliation(active.agreement,
      "refund-result-reconciliation-current", active.payment);

    const reconciliationWorker = await ownerPool.connect();
    let resultPromise: Promise<Awaited<ReturnType<typeof repository.recordOperationResult>>> | undefined;
    try {
      await reconciliationWorker.query("BEGIN");
      await reconciliationWorker.query("SET LOCAL ROLE gd_licensing_worker_definer");
      const backend = await reconciliationWorker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      await reconciliationWorker.query(`SELECT 1 FROM licensing_private.commercial_provider_slots
        WHERE account_id=$1 FOR UPDATE`, [accountId]);
      resultPromise = withRole("gd_licensing_worker_definer", (worker) =>
        repository.recordOperationResult(worker, acceptedOperation, permit, {
          outcome: "confirmed", responseDigest: hash("refund-result-reconciliation-confirmed"), resources: [],
        }));
      await withTimeout(waitUntil(async () => {
        const waiting = await ownerPool.query<{ waiting: boolean }>(`SELECT EXISTS(
          SELECT 1 FROM pg_stat_activity activity
          WHERE $1=ANY(pg_blocking_pids(activity.pid)) AND activity.wait_event_type='Lock'
        ) AS waiting`, [backend.rows[0]!.pid]);
        return waiting.rows[0]?.waiting === true;
      }), 2_000);
      const applied = await repository.applyAgreementObservationAndAuthority(reconciliationWorker, reconciliation,
        observationCommand({
          payment: { purpose: "acquisition_initial", resourceKind: active.payment.kind,
            resourceId: active.payment.id, bindingDigest: active.payment.digest,
            settledAt: active.settledAt, grossMinor: 980, cumulativeRefundedMinor: 0 },
          digestLabel: "refund-result-reconciliation-current", access: "active", renewal: "renewing",
          paidThrough: active.paidThrough, refundFact: "none",
        }));
      expect(applied.disposition).toBe("applied");
      await reconciliationWorker.query("COMMIT");
      await expect(withTimeout(resultPromise, 5_000))
        .resolves.toMatchObject({ state: "confirmed", disposition: "current" });
      await withRole("gd_licensing_owner", async (owner) => {
        const facts = await owner.query<{ refund_state: string; refund_operations: string;
          refund_work: string; reconciliation_state: string }>(`
          SELECT request.state AS refund_state,
            (SELECT count(*)::text FROM licensing_private.provider_operations operation
              WHERE operation.account_id=request.account_id
                AND operation.provider_operation_id=request.refund_operation_id
                AND operation.operation_kind='first_purchase_refund') AS refund_operations,
            (SELECT count(*)::text FROM licensing_private.provider_operation_work work
              WHERE work.account_id=request.account_id
                AND work.provider_operation_id=request.refund_operation_id) AS refund_work,
            job.state AS reconciliation_state
          FROM licensing_private.first_purchase_refund_requests request
          JOIN licensing_private.commercial_jobs job ON job.job_id=$2
          WHERE request.account_id=$1 AND request.refund_request_id=$3`,
        [accountId, reconciliation.workId, accepted.refundRequestId]);
        expect(facts.rows).toEqual([{ refund_state: "refund_pending", refund_operations: "1",
          refund_work: "1", reconciliation_state: "succeeded" }]);
      });
    } catch (error) {
      await reconciliationWorker.query("ROLLBACK");
      if (resultPromise !== undefined) await resultPromise.catch(() => undefined);
      throw error;
    } finally {
      reconciliationWorker.release();
    }
  });

  it.each(["refund_pending", "refund_succeeded", "partial_refund", "dispute_pending", "partial_reversal", "fraud_signal"] as const)(
    "makes authenticated %s facts non-granting without releasing a renewable slot", async (refundFact) => {
      const active = await activateAgreement(`blocking-${refundFact}`, "subscription",
        new Date(Date.now() - 60_000).toISOString(), new Date(Date.now() + 86_400_000).toISOString());
      const work = await scheduleReconciliation(active.agreement, `blocking-${refundFact}`, active.payment);
      await withRole("gd_licensing_worker_definer", async (worker) => {
        await expect(repository.applyAgreementObservationAndAuthority(worker, work, observationCommand({
          payment: { purpose: "acquisition_initial", resourceKind: active.payment.kind,
            resourceId: active.payment.id, bindingDigest: active.payment.digest,
            settledAt: active.settledAt, grossMinor: 980, cumulativeRefundedMinor: 400 },
          digestLabel: `blocking-${refundFact}`, access: "active", renewal: "renewing",
          paidThrough: active.paidThrough, refundFact,
        }))).resolves.toMatchObject({ disposition: "applied" });
      });
      await expectNonGrantingAuthority();
      await withRole("gd_licensing_owner", async (owner) => {
        const state = await owner.query<{ state: string; releases: string }>(`SELECT s.state,
          (SELECT count(*)::text FROM licensing_private.commercial_jobs j
            WHERE j.account_id=s.account_id AND j.kind='release') AS releases
          FROM licensing_private.commercial_provider_slots s WHERE s.account_id=$1`, [accountId]);
        expect(state.rows).toEqual([{ state: "agreement_held", releases: "0" }]);
      });
    });

  it("schedules a fresh bounded reconciliation generation for pending refund convergence and stops after exact settlement", async () => {
    const active = await activateAgreement("refund-convergence", "fixed_term",
      new Date(Date.now() - 60_000).toISOString(), new Date(Date.now() + 315_360_000_000).toISOString());
    const pending = await scheduleReconciliation(active.agreement, "refund-convergence-pending", active.payment, "capture_evidence");
    await withRole("gd_licensing_worker_definer", (worker) =>
      repository.applyAgreementObservationAndAuthority(worker, pending, observationCommand({
        payment: { purpose: "acquisition_initial", resourceKind: active.payment.kind,
          resourceId: active.payment.id, bindingDigest: active.payment.digest,
          settledAt: active.settledAt, grossMinor: 49_800, cumulativeRefundedMinor: 0 },
        digestLabel: "refund-convergence-pending", access: "refunded", renewal: "terminated",
        paidThrough: active.paidThrough, refundFact: "refund_pending",
      })));
    await expectNonGrantingAuthority();
    await withRole("gd_licensing_owner", async (owner) => {
      const child = await owner.query<{ requested_generation: string; state: string; parent_job_id: string }>(`
        SELECT requested_generation::text,state,parent_job_id FROM licensing_private.commercial_jobs
        WHERE parent_job_id=$1`, [pending.workId]);
      expect(child.rows).toEqual([{ requested_generation: String(pending.requestedGeneration + 1),
        state: "retry_wait", parent_job_id: pending.workId }]);
      await owner.query("UPDATE licensing_private.commercial_jobs SET next_attempt_at=transaction_timestamp() WHERE parent_job_id=$1",
        [pending.workId]);
    });
    await withRole("gd_licensing_worker_definer", async (worker) => {
      const reread = await repository.leaseReconciliationWork(worker, "refund-convergence-reread");
      expect(reread).toMatchObject({ requestedGeneration: pending.requestedGeneration + 1,
        expectedAgreementRevision: pending.expectedAgreementRevision + 1,
        receiptEventType: "payment.lifecycle.updated",
        receiptProviderEventId: "event-refund-convergence-pending",
        receiptTriggerResourceKind: active.payment.kind,
        receiptTriggerResourceId: active.payment.id });
      await repository.applyAgreementObservationAndAuthority(worker, reread!, observationCommand({
        payment: { purpose: "acquisition_initial", resourceKind: active.payment.kind,
          resourceId: active.payment.id, bindingDigest: active.payment.digest,
          settledAt: active.settledAt, grossMinor: 49_800, cumulativeRefundedMinor: 0 },
        digestLabel: "refund-convergence-pending-again", access: "refunded", renewal: "terminated",
        paidThrough: active.paidThrough, refundFact: "refund_pending",
      }));
    });
    await withRole("gd_licensing_owner", (owner) => owner.query(
      "UPDATE licensing_private.commercial_jobs SET next_attempt_at=transaction_timestamp() WHERE parent_job_id IN (SELECT job_id FROM licensing_private.commercial_jobs WHERE parent_job_id=$1)",
      [pending.workId]));
    await withRole("gd_licensing_worker_definer", async (worker) => {
      const grandchild = await repository.leaseReconciliationWork(worker, "refund-convergence-grandchild");
      expect(grandchild).toMatchObject({ requestedGeneration: pending.requestedGeneration + 2,
        expectedAgreementRevision: pending.expectedAgreementRevision + 2,
        receiptEventType: "payment.lifecycle.updated",
        receiptProviderEventId: "event-refund-convergence-pending",
        receiptTriggerResourceKind: active.payment.kind,
        receiptTriggerResourceId: active.payment.id });
      await repository.applyAgreementObservationAndAuthority(worker, grandchild!, observationCommand({
        payment: { purpose: "acquisition_initial", resourceKind: active.payment.kind,
          resourceId: active.payment.id, bindingDigest: active.payment.digest,
          settledAt: active.settledAt, grossMinor: 49_800, cumulativeRefundedMinor: 49_800 },
        digestLabel: "refund-convergence-settled", access: "refunded", renewal: "terminated",
        paidThrough: active.paidThrough, refundFact: "full_reversal_settled",
      }));
      const release = await repository.leaseReleaseWork(worker, "refund-convergence-release");
      expect(release).not.toBeNull();
      await expect(repository.releaseProviderSlot(worker, release!)).resolves.toMatchObject({ released: true });
    });
    await withRole("gd_licensing_owner", async (owner) => {
      const facts = await owner.query<{ pending: string; latest_requested_generation: string; latest_applied_generation: string }>(`
        SELECT (SELECT count(*)::text FROM licensing_private.commercial_jobs
            WHERE kind='reconciliation' AND state IN ('ready','retry_wait','leased')) AS pending,
          latest_requested_generation::text,latest_applied_generation::text
        FROM licensing_private.provider_resource_cursors WHERE provider=$1 AND resource_kind=$2 AND resource_id=$3`,
      [active.agreement.provider, active.agreement.anchorKind, active.agreement.anchorId]);
      expect(facts.rows).toEqual([{ pending: "0",
        latest_requested_generation: String(pending.requestedGeneration + 2),
        latest_applied_generation: String(pending.requestedGeneration + 2) }]);
    });
  });

  it("keeps unresolved payment evidence sticky across an unrelated newer receipt and clears it only on exact-payment failure", async () => {
    const active = await activateAgreement("refund-sticky-unrelated", "subscription",
      new Date(Date.now() - 60_000).toISOString(), new Date(Date.now() + 86_400_000).toISOString());
    const blocking = await scheduleReconciliation(active.agreement, "refund-sticky-blocking", active.payment);
    await withRole("gd_licensing_worker_definer", (worker) =>
      repository.applyAgreementObservationAndAuthority(worker, blocking, observationCommand({
        payment: { purpose: "acquisition_initial", resourceKind: active.payment.kind,
          resourceId: active.payment.id, bindingDigest: active.payment.digest,
          settledAt: active.settledAt, grossMinor: 980, cumulativeRefundedMinor: 0 },
        digestLabel: "refund-sticky-blocking", access: "active", renewal: "renewing",
        paidThrough: active.paidThrough, refundFact: "refund_pending",
      })));
    await expectNonGrantingAuthority();

    const unrelated = await scheduleReconciliation(active.agreement, "refund-sticky-unrelated-newer", null);
    await withRole("gd_licensing_worker_definer", (worker) =>
      repository.applyAgreementObservationAndAuthority(worker, unrelated, observationCommand({
        payment: null, digestLabel: "refund-sticky-unrelated-newer", access: "active", renewal: "renewing",
        paidThrough: active.paidThrough, refundFact: "none",
      })));
    await expectNonGrantingAuthority();
    await withRole("gd_licensing_owner", async (owner) => {
      const sticky = await owner.query<{ state: string; head_event: string; child_event: string }>(`
        SELECT head.state,head.provider_event_id AS head_event,receipt.provider_event_id AS child_event
        FROM licensing_private.agreement_refund_evidence_heads head
        JOIN licensing_private.commercial_jobs child ON child.parent_job_id=$1
        JOIN licensing_private.provider_receipts receipt ON receipt.receipt_id=child.receipt_id
        WHERE head.account_id=$2 AND head.provider_agreement_id=$3`,
      [unrelated.workId, accountId, active.agreement.providerAgreementId]);
      expect(sticky.rows).toEqual([{ state: "blocking", head_event: "event-refund-sticky-blocking",
        child_event: "event-refund-sticky-blocking" }]);
      await owner.query("UPDATE licensing_private.commercial_jobs SET next_attempt_at=transaction_timestamp() WHERE parent_job_id=$1",
        [unrelated.workId]);
    });

    await withRole("gd_licensing_worker_definer", async (worker) => {
      const exactFailure = await repository.leaseReconciliationWork(worker, "refund-sticky-exact-failure");
      expect(exactFailure).toMatchObject({
        receiptEventType: "payment.lifecycle.updated",
        receiptProviderEventId: "event-refund-sticky-blocking",
        receiptTriggerResourceKind: active.payment.kind,
        receiptTriggerResourceId: active.payment.id,
      });
      await repository.applyAgreementObservationAndAuthority(worker, exactFailure!, observationCommand({
        payment: { purpose: "acquisition_initial", resourceKind: active.payment.kind,
          resourceId: active.payment.id, bindingDigest: active.payment.digest,
          settledAt: active.settledAt, grossMinor: 980, cumulativeRefundedMinor: 0 },
        digestLabel: "refund-sticky-exact-failure", access: "active", renewal: "renewing",
        paidThrough: active.paidThrough, refundFact: "refund_failed",
      }));
    });
    await withRole("gd_licensing_owner", async (owner) => {
      const resolved = await owner.query<{ state: string; grants_access: boolean; projection_state: string; pending: string }>(`
        SELECT head.state,authority.grants_access,projection.state AS projection_state,
          (SELECT count(*)::text FROM licensing_private.commercial_jobs j
            WHERE j.account_id=head.account_id AND j.kind='reconciliation'
              AND j.state IN ('ready','retry_wait','leased')) AS pending
        FROM licensing_private.agreement_refund_evidence_heads head
        JOIN licensing_private.commercial_authorities authority USING(account_id)
        JOIN licensing_private.account_entitlement_projections projection USING(account_id)
        WHERE head.account_id=$1 AND head.provider_agreement_id=$2`,
      [accountId, active.agreement.providerAgreementId]);
      expect(resolved.rows).toEqual([{ state: "resolved_failed", grants_access: true,
        projection_state: "active", pending: "0" }]);
    });
  });

  it("does not let a same-payment terminal fact from another Provider trigger lineage clear a blocking head", async () => {
    const active = await activateAgreement("refund-lineage", "subscription",
      new Date(Date.now() - 60_000).toISOString(), new Date(Date.now() + 86_400_000).toISOString());
    const dispute = { kind: "dispute" as const, id: "dispute-refund-lineage", digest: hash("dispute-refund-lineage"),
      linkRole: "reversal_evidence" as const };
    const blocking = await scheduleReconciliation(active.agreement, "refund-lineage-blocking", active.payment,
      "initial_payment", dispute);
    await withRole("gd_licensing_worker_definer", (worker) =>
      repository.applyAgreementObservationAndAuthority(worker, blocking, observationCommand({
        payment: { purpose: "acquisition_initial", resourceKind: active.payment.kind,
          resourceId: active.payment.id, bindingDigest: active.payment.digest,
          settledAt: active.settledAt, grossMinor: 980, cumulativeRefundedMinor: 0 },
        digestLabel: "refund-lineage-blocking", paidThrough: active.paidThrough, refundFact: "dispute_pending",
      })));

    const unrelatedRefund = { kind: "refund" as const, id: "refund-other-lineage", digest: hash("refund-other-lineage"),
      linkRole: "refund_evidence" as const };
    const unrelatedFailure = await scheduleReconciliation(active.agreement, "refund-lineage-unrelated-failure",
      active.payment, "initial_payment", unrelatedRefund);
    await withRole("gd_licensing_worker_definer", (worker) =>
      repository.applyAgreementObservationAndAuthority(worker, unrelatedFailure, observationCommand({
        payment: { purpose: "acquisition_initial", resourceKind: active.payment.kind,
          resourceId: active.payment.id, bindingDigest: active.payment.digest,
          settledAt: active.settledAt, grossMinor: 980, cumulativeRefundedMinor: 0 },
        digestLabel: "refund-lineage-unrelated-failure", paidThrough: active.paidThrough, refundFact: "refund_failed",
      })));
    await expectNonGrantingAuthority();
    await withRole("gd_licensing_owner", async (owner) => {
      const head = await owner.query<{ state: string; trigger_resource_kind: string; trigger_resource_id: string }>(`
        SELECT state,trigger_resource_kind,trigger_resource_id
        FROM licensing_private.agreement_refund_evidence_heads
        WHERE account_id=$1 AND provider_agreement_id=$2`, [accountId, active.agreement.providerAgreementId]);
      expect(head.rows).toEqual([{ state: "blocking", trigger_resource_kind: dispute.kind,
        trigger_resource_id: dispute.id }]);
    });

    const matchingFailure = await scheduleReconciliation(active.agreement, "refund-lineage-matching-failure",
      active.payment, "initial_payment", dispute);
    await withRole("gd_licensing_worker_definer", (worker) =>
      repository.applyAgreementObservationAndAuthority(worker, matchingFailure, observationCommand({
        payment: { purpose: "acquisition_initial", resourceKind: active.payment.kind,
          resourceId: active.payment.id, bindingDigest: active.payment.digest,
          settledAt: active.settledAt, grossMinor: 980, cumulativeRefundedMinor: 0 },
        digestLabel: "refund-lineage-matching-failure", paidThrough: active.paidThrough, refundFact: "refund_failed",
      })));
    await withRole("gd_licensing_owner", async (owner) => {
      const resolved = await owner.query<{ state: string; grants_access: boolean }>(`
        SELECT head.state,authority.grants_access FROM licensing_private.agreement_refund_evidence_heads head
        JOIN licensing_private.commercial_authorities authority USING(account_id)
        WHERE head.account_id=$1 AND head.provider_agreement_id=$2`,
      [accountId, active.agreement.providerAgreementId]);
      expect(resolved.rows).toEqual([{ state: "resolved_failed", grants_access: true }]);
    });
  });

  it("releases a fully settled fixed-term slot from durable evidence after an unrelated observation supersedes current truth", async () => {
    const active = await activateAgreement("refund-durable-release", "fixed_term",
      new Date(Date.now() - 60_000).toISOString(), new Date(Date.now() + 315_360_000_000).toISOString());
    const settled = await scheduleReconciliation(active.agreement, "refund-durable-release-settled",
      active.payment, "capture_evidence");
    await withRole("gd_licensing_worker_definer", (worker) =>
      repository.applyAgreementObservationAndAuthority(worker, settled, observationCommand({
        payment: { purpose: "acquisition_initial", resourceKind: active.payment.kind,
          resourceId: active.payment.id, bindingDigest: active.payment.digest,
          settledAt: active.settledAt, grossMinor: 49_800, cumulativeRefundedMinor: 49_800 },
        digestLabel: "refund-durable-release-settled", access: "refunded", renewal: "terminated",
        paidThrough: active.paidThrough, refundFact: "full_reversal_settled",
      })));
    const unrelated = await scheduleReconciliation(active.agreement, "refund-durable-release-unrelated", null);
    await withRole("gd_licensing_worker_definer", (worker) =>
      repository.applyAgreementObservationAndAuthority(worker, unrelated, observationCommand({
        payment: null, digestLabel: "refund-durable-release-unrelated", access: "active", renewal: "renewing",
        paidThrough: active.paidThrough, refundFact: "none",
      })));
    await withRole("gd_licensing_worker_definer", async (worker) => {
      const release = await repository.leaseReleaseWork(worker, "refund-durable-release-worker");
      expect(release).not.toBeNull();
      await expect(repository.releaseProviderSlot(worker, release!)).resolves.toMatchObject({ released: true });
    });
  });

  it.each([
    ["renewal", "refund_succeeded"],
    ["renewal", "full_reversal_settled"],
    ["adjustment", "refund_succeeded"],
    ["adjustment", "full_reversal_settled"],
  ] as const)("does not let a fully settled %s payment with %s release a fixed-term acquisition", async (purpose, refundFact) => {
    const label = `non-acquisition-settlement-${purpose}-${refundFact}`;
    const active = await activateAgreement(label, "fixed_term",
      new Date(Date.now() - 60_000).toISOString(), new Date(Date.now() + 315_360_000_000).toISOString());
    const ancillary = { kind: "capture" as const, id: `capture-${purpose}-${refundFact}`,
      digest: hash(`capture-${purpose}-${refundFact}`) };
    const ancillarySettledAt = new Date().toISOString();
    const settled = await scheduleReconciliation(active.agreement, `${label}-settled`, ancillary, "refund_evidence");
    await withRole("gd_licensing_worker_definer", (worker) =>
      repository.applyAgreementObservationAndAuthority(worker, settled, observationCommand({
        payment: { purpose, resourceKind: ancillary.kind, resourceId: ancillary.id,
          bindingDigest: ancillary.digest, settledAt: ancillarySettledAt, grossMinor: 100,
          cumulativeRefundedMinor: refundFact === "refund_succeeded" ? 100 : 0 },
        digestLabel: `${label}-settled`, access: "refunded", renewal: "terminated",
        paidThrough: active.paidThrough, refundFact,
      })));
    await withRole("gd_licensing_owner", async (owner) => {
      const evidence = await owner.query<{ purpose: string; state: string; eligible: string }>(`
        SELECT payment.purpose,head.state,
          (SELECT count(*)::text FROM licensing_private.replacement_eligibility replacement
            WHERE replacement.account_id=head.account_id AND replacement.holder_id=head.provider_agreement_id
              AND replacement.verdict='eligible') AS eligible
        FROM licensing_private.agreement_refund_evidence_heads head
        JOIN licensing_private.commercial_payment_evidence payment USING(payment_evidence_id)
        WHERE head.account_id=$1 AND head.provider_agreement_id=$2 AND payment.resource_id=$3`,
      [accountId, active.agreement.providerAgreementId, ancillary.id]);
      expect(evidence.rows).toEqual([{ purpose, state: "resolved_settled", eligible: "0" }]);
      await owner.query(`INSERT INTO licensing_private.replacement_eligibility
        (eligibility_id,account_id,slot_ownership_id,slot_epoch,holder_kind,holder_id,verdict,reason,evidence_digest)
        SELECT gen_random_uuid(),account_id,slot_ownership_id,slot_epoch,'agreement',holder_agreement_id,
          'eligible','fixed_term_fully_reversed',$2 FROM licensing_private.commercial_provider_slots WHERE account_id=$1`,
      [accountId, hash(`${label}-forged-eligibility`)]);
      await owner.query(`INSERT INTO licensing_private.commercial_jobs(job_id,kind,account_id,provider_agreement_id,state)
        VALUES(gen_random_uuid(),'release',$1,$2,'ready')`, [accountId, active.agreement.providerAgreementId]);
    });
    await withRole("gd_licensing_worker_definer", async (worker) => {
      const retained = await repository.leaseReleaseWork(worker, `${label}-retained`);
      expect(retained).not.toBeNull();
      await expect(repository.releaseProviderSlot(worker, retained!)).resolves.toMatchObject({ released: false });
    });

    const acquisition = await scheduleReconciliation(active.agreement, `${label}-acquisition`, active.payment, "capture_evidence");
    await withRole("gd_licensing_worker_definer", (worker) =>
      repository.applyAgreementObservationAndAuthority(worker, acquisition, observationCommand({
        payment: { purpose: "acquisition_initial", resourceKind: active.payment.kind,
          resourceId: active.payment.id, bindingDigest: active.payment.digest,
          settledAt: active.settledAt, grossMinor: 49_800, cumulativeRefundedMinor: 49_800 },
        digestLabel: `${label}-acquisition`, access: "refunded", renewal: "terminated",
        paidThrough: active.paidThrough, refundFact: "refund_succeeded",
      })));
    await withRole("gd_licensing_worker_definer", async (worker) => {
      const release = await repository.leaseReleaseWork(worker, `${label}-released`);
      expect(release).not.toBeNull();
      await expect(repository.releaseProviderSlot(worker, release!)).resolves.toMatchObject({ released: true });
    });
  });

  it.each(["renewal", "adjustment"] as const)(
    "resolves a matching %s blocking lineage without shortening the fixed-term acquisition", async (purpose) => {
      const label = `non-acquisition-blocking-${purpose}`;
      const active = await activateAgreement(label, "fixed_term",
        new Date(Date.now() - 60_000).toISOString(), new Date(Date.now() + 315_360_000_000).toISOString());
      const ancillary = { kind: "capture" as const, id: `capture-ancillary-${label}`,
        digest: hash(`capture-ancillary-${label}`) };
      const settledAt = new Date().toISOString();
      const pending = await scheduleReconciliation(active.agreement, `${label}-pending`, ancillary, "refund_evidence");
      await withRole("gd_licensing_worker_definer", (worker) =>
        repository.applyAgreementObservationAndAuthority(worker, pending, observationCommand({
          payment: { purpose, resourceKind: ancillary.kind, resourceId: ancillary.id,
            bindingDigest: ancillary.digest, settledAt, grossMinor: 100, cumulativeRefundedMinor: 0 },
          digestLabel: `${label}-pending`, paidThrough: active.paidThrough, refundFact: "refund_pending",
        })));
      const resolved = await scheduleReconciliation(active.agreement, `${label}-resolved`, ancillary, "refund_evidence");
      await withRole("gd_licensing_worker_definer", (worker) =>
        repository.applyAgreementObservationAndAuthority(worker, resolved, observationCommand({
          payment: { purpose, resourceKind: ancillary.kind, resourceId: ancillary.id,
            bindingDigest: ancillary.digest, settledAt, grossMinor: 100, cumulativeRefundedMinor: 0 },
          digestLabel: `${label}-resolved`, paidThrough: active.paidThrough, refundFact: "refund_failed",
        })));
      await withRole("gd_licensing_owner", async (owner) => {
        const facts = await owner.query<{ evidence_state: string; slot_state: string; protected_paid_through: Date }>(`
          SELECT head.state AS evidence_state,slot.state AS slot_state,agreement.protected_paid_through
          FROM licensing_private.agreement_refund_evidence_heads head
          JOIN licensing_private.commercial_provider_slots slot USING(account_id)
          JOIN licensing_private.provider_agreements agreement
            ON agreement.account_id=head.account_id AND agreement.provider_agreement_id=head.provider_agreement_id
          JOIN licensing_private.commercial_payment_evidence payment USING(payment_evidence_id)
          WHERE head.account_id=$1 AND payment.resource_id=$2`, [accountId, ancillary.id]);
        expect(facts.rows).toHaveLength(1);
        expect(facts.rows[0]).toMatchObject({ evidence_state: "resolved_failed", slot_state: "agreement_held" });
        expect(facts.rows[0]!.protected_paid_through.getTime()).toBeGreaterThan(Date.now() + 9 * 365 * 86_400_000);
      });
    });

  it.each(["subscription", "fixed_term"] as const)(
    "retains an expired %s slot and its release job until the matching blocking lineage resolves", async (purchaseKind) => {
      const label = `refund-blocked-release-${purchaseKind}`;
      const active = await activateAgreement(label, purchaseKind,
        new Date(Date.now() - 60_000).toISOString(), new Date(Date.now() + 86_400_000).toISOString());
      const trigger = { kind: "dispute" as const, id: `dispute-${label}`, digest: hash(`dispute-${label}`),
        linkRole: "reversal_evidence" as const };
      const blocking = await scheduleReconciliation(active.agreement, `${label}-blocking`, active.payment,
        purchaseKind === "fixed_term" ? "capture_evidence" : "initial_payment", trigger);
      await withRole("gd_licensing_worker_definer", (worker) =>
        repository.applyAgreementObservationAndAuthority(worker, blocking, observationCommand({
          payment: { purpose: "acquisition_initial", resourceKind: active.payment.kind,
            resourceId: active.payment.id, bindingDigest: active.payment.digest,
            settledAt: active.settledAt, grossMinor: purchaseKind === "fixed_term" ? 49_800 : 980,
            cumulativeRefundedMinor: 0 },
          digestLabel: `${label}-blocking`, access: "refunded", renewal: "terminated",
          paidThrough: active.paidThrough, refundFact: "dispute_pending",
        })));
      await withRole("gd_licensing_owner", async (owner) => {
        await owner.query(`UPDATE licensing_private.provider_agreements
          SET protected_paid_through=transaction_timestamp()-interval '1 second',renewal_disposition='terminated'
          WHERE account_id=$1 AND provider_agreement_id=$2`, [accountId, active.agreement.providerAgreementId]);
        await owner.query(`INSERT INTO licensing_private.commercial_jobs(job_id,kind,account_id,provider_agreement_id,state)
          VALUES(gen_random_uuid(),'release',$1,$2,'ready')`, [accountId, active.agreement.providerAgreementId]);
      });
      await withRole("gd_licensing_worker_definer", async (worker) => {
        const retained = await repository.leaseReleaseWork(worker, `${label}-retained`);
        expect(retained).not.toBeNull();
        await expect(repository.releaseProviderSlot(worker, retained!)).resolves.toMatchObject({ released: false });
      });
      await withRole("gd_licensing_owner", async (owner) => {
        const retained = await owner.query<{ slot_state: string; job_state: string; evidence_state: string }>(`
          SELECT slot.state AS slot_state,job.state AS job_state,head.state AS evidence_state
          FROM licensing_private.commercial_provider_slots slot
          JOIN licensing_private.commercial_jobs job ON job.account_id=slot.account_id AND job.kind='release'
          JOIN licensing_private.agreement_refund_evidence_heads head ON head.account_id=slot.account_id
            AND head.provider_agreement_id=slot.holder_agreement_id
          WHERE slot.account_id=$1`, [accountId]);
        expect(retained.rows).toEqual([{ slot_state: "agreement_held", job_state: "retry_wait",
          evidence_state: "blocking" }]);
      });
      const matching = await scheduleReconciliation(active.agreement, `${label}-matching`, active.payment,
        purchaseKind === "fixed_term" ? "capture_evidence" : "initial_payment", trigger);
      await withRole("gd_licensing_worker_definer", (worker) =>
        repository.applyAgreementObservationAndAuthority(worker, matching, observationCommand({
          payment: { purpose: "acquisition_initial", resourceKind: active.payment.kind,
            resourceId: active.payment.id, bindingDigest: active.payment.digest,
            settledAt: active.settledAt, grossMinor: purchaseKind === "fixed_term" ? 49_800 : 980,
            cumulativeRefundedMinor: 0 },
          digestLabel: `${label}-matching`, access: "refunded", renewal: "terminated",
          paidThrough: new Date(Date.now() - 1_000).toISOString(), refundFact: "refund_failed",
        })));
      await withRole("gd_licensing_owner", (owner) => owner.query(
        "UPDATE licensing_private.commercial_jobs SET next_attempt_at=transaction_timestamp() WHERE account_id=$1 AND kind='release' AND state='retry_wait'",
        [accountId]));
      await withRole("gd_licensing_worker_definer", async (worker) => {
        const release = await repository.leaseReleaseWork(worker, `${label}-released`);
        expect(release).not.toBeNull();
        await expect(repository.releaseProviderSlot(worker, release!)).resolves.toMatchObject({ released: true });
      });
    });

  it.each(["subscription", "fixed_term"] as const)(
    "keeps an accepted %s refund and its current work fenced until exact settlement", async (purchaseKind) => {
      const label = `refund-accepted-release-${purchaseKind}`;
      const active = await activateAgreement(label, purchaseKind,
        new Date(Date.now() - 60_000).toISOString(), new Date(Date.now() + 86_400_000).toISOString());
      const accepted = acceptedRefund(await transactions.withAccountCredential(Buffer.from(credential), "refund_request", (transaction) =>
        repository.requestFirstPurchaseRefund(transaction, { requestId: `${label}-request`,
          expectedPurchaseAttemptId: active.agreement.purchaseAttemptId, requestDigest: hash(`${label}-request`) })));
      expect(accepted.operation).toBeNull();
      let refundOperation = await leaseFreshRefundOperation(`${label}-initial-worker`);
      if (purchaseKind === "subscription") {
        await withRole("gd_licensing_worker_definer", async (worker) => {
          const permit = await repository.issueDispatchPermit(worker, refundOperation, 30);
          await repository.consumeDispatchPermit(worker, refundOperation, permit);
          await repository.recordOperationResult(worker, refundOperation, permit, {
            outcome: "confirmed", responseDigest: hash(`${label}-termination-confirmed`), resources: [],
          });
          const leasedRefund = await repository.leaseProviderOperationWork(worker, `${label}-refund-worker`);
          if (leasedRefund === null) throw new Error("subscription refund work is unavailable");
          refundOperation = leasedRefund;
        });
      }
      await withRole("gd_licensing_worker_definer", async (worker) => {
        const permit = await repository.issueDispatchPermit(worker, refundOperation, 30);
        await repository.consumeDispatchPermit(worker, refundOperation, permit);
        await repository.recordOperationResult(worker, refundOperation, permit, {
          outcome: "confirmed", responseDigest: hash(`${label}-refund-confirmed`), resources: [],
        });
      });
      await withRole("gd_licensing_owner", (owner) => owner.query(`UPDATE licensing_private.provider_agreements
        SET protected_paid_through=transaction_timestamp()-interval '1 second',renewal_disposition='terminated'
        WHERE account_id=$1 AND provider_agreement_id=$2`, [accountId, active.agreement.providerAgreementId]));
      const elapsed = await scheduleReconciliation(active.agreement, `${label}-elapsed`, active.payment,
        purchaseKind === "fixed_term" ? "capture_evidence" : "initial_payment");
      await withRole("gd_licensing_worker_definer", (worker) =>
        repository.applyAgreementObservationAndAuthority(worker, elapsed, observationCommand({
          payment: { purpose: "acquisition_initial", resourceKind: active.payment.kind,
            resourceId: active.payment.id, bindingDigest: active.payment.digest,
            settledAt: active.settledAt, grossMinor: purchaseKind === "fixed_term" ? 49_800 : 980,
            cumulativeRefundedMinor: 0 },
          digestLabel: `${label}-elapsed`, access: "refunded", renewal: "terminated",
          paidThrough: new Date(Date.now() - 1_000).toISOString(), refundFact: "none",
        })));
      for (const state of ["refund_pending", "refund_unknown", "retry_wait", "manual_resolution"] as const) {
        await withRole("gd_licensing_owner", async (owner) => {
          await owner.query(`UPDATE licensing_private.first_purchase_refund_requests SET state=$3
            WHERE account_id=$1 AND refund_request_id=$2`, [accountId, accepted.refundRequestId, state]);
          await owner.query(`UPDATE licensing_private.commercial_jobs SET next_attempt_at=transaction_timestamp()
            WHERE account_id=$1 AND kind='release' AND state IN ('ready','retry_wait')`, [accountId]);
        });
        await withRole("gd_licensing_worker_definer", async (worker) => {
          const retained = await repository.leaseReleaseWork(worker, `${label}-${state}`);
          expect(retained).not.toBeNull();
          await expect(repository.releaseProviderSlot(worker, retained!)).resolves.toMatchObject({ released: false });
        });
      }
      await expectNonGrantingAuthority();
      await withRole("gd_licensing_owner", async (owner) => {
        const retained = await owner.query<{ slot_state: string; job_state: string; heads: string }>(`
          SELECT slot.state AS slot_state,job.state AS job_state,
            (SELECT count(*)::text FROM licensing_private.agreement_refund_evidence_heads head
              WHERE head.account_id=slot.account_id AND head.provider_agreement_id=slot.holder_agreement_id) AS heads
          FROM licensing_private.commercial_provider_slots slot
          JOIN licensing_private.commercial_jobs job ON job.account_id=slot.account_id AND job.kind='release'
          WHERE slot.account_id=$1`, [accountId]);
        expect(retained.rows).toEqual([{ slot_state: "agreement_held", job_state: "retry_wait", heads: "0" }]);
      });
      const settled = await scheduleReconciliation(active.agreement, `${label}-settled`, active.payment,
        purchaseKind === "fixed_term" ? "capture_evidence" : "initial_payment");
      await withRole("gd_licensing_worker_definer", (worker) =>
        repository.applyAgreementObservationAndAuthority(worker, settled, observationCommand({
          payment: { purpose: "acquisition_initial", resourceKind: active.payment.kind,
            resourceId: active.payment.id, bindingDigest: active.payment.digest,
            settledAt: active.settledAt, grossMinor: purchaseKind === "fixed_term" ? 49_800 : 980,
            cumulativeRefundedMinor: purchaseKind === "fixed_term" ? 49_800 : 980 },
          digestLabel: `${label}-settled`, access: "refunded", renewal: "terminated",
          paidThrough: new Date(Date.now() - 1_000).toISOString(), refundFact: "refund_succeeded",
        })));
      await withRole("gd_licensing_owner", (owner) => owner.query(`UPDATE licensing_private.commercial_jobs
        SET next_attempt_at=transaction_timestamp() WHERE account_id=$1 AND kind='release' AND state='retry_wait'`, [accountId]));
      await withRole("gd_licensing_worker_definer", async (worker) => {
        const release = await repository.leaseReleaseWork(worker, `${label}-released`);
        expect(release).not.toBeNull();
        await expect(repository.releaseProviderSlot(worker, release!)).resolves.toMatchObject({ released: true });
      });
    });

  it.each(["fixed_term", "subscription"] as const)(
    "keeps a settled %s refund fenced through its consumed permit and makes the late result monotonic", async (purchaseKind) => {
      const label = `refund-late-result-${purchaseKind}`;
      const active = await activateAgreement(label, purchaseKind,
        new Date(Date.now() - 60_000).toISOString(), new Date(Date.now() + 86_400_000).toISOString());
      const accepted = acceptedRefund(await transactions.withAccountCredential(Buffer.from(credential), "refund_request", (transaction) =>
        repository.requestFirstPurchaseRefund(transaction, { requestId: `${label}-request`,
          expectedPurchaseAttemptId: active.agreement.purchaseAttemptId, requestDigest: hash(`${label}-request`) })));
      expect(accepted.operation).toBeNull();
      let currentOperation = await leaseFreshRefundOperation(`${label}-initial-worker`);
      let permit: Awaited<ReturnType<typeof repository.issueDispatchPermit>>;
      await withRole("gd_licensing_worker_definer", async (worker) => {
        permit = await repository.issueDispatchPermit(worker, currentOperation, 30);
        await repository.consumeDispatchPermit(worker, currentOperation, permit);
      });
      if (purchaseKind === "subscription") {
        await withRole("gd_licensing_owner", (owner) => owner.query(`UPDATE licensing_private.provider_agreements
          SET protected_paid_through=transaction_timestamp()-interval '1 second',renewal_disposition='terminated'
          WHERE account_id=$1 AND provider_agreement_id=$2`, [accountId, active.agreement.providerAgreementId]));
      }
      const settled = await scheduleReconciliation(active.agreement, `${label}-settled`, active.payment,
        purchaseKind === "fixed_term" ? "capture_evidence" : "initial_payment");
      await withRole("gd_licensing_worker_definer", (worker) =>
        repository.applyAgreementObservationAndAuthority(worker, settled, observationCommand({
          payment: { purpose: "acquisition_initial", resourceKind: active.payment.kind,
            resourceId: active.payment.id, bindingDigest: active.payment.digest,
            settledAt: active.settledAt, grossMinor: purchaseKind === "fixed_term" ? 49_800 : 980,
            cumulativeRefundedMinor: purchaseKind === "fixed_term" ? 49_800 : 980 },
          digestLabel: `${label}-settled`, access: "refunded", renewal: "terminated",
          paidThrough: new Date(Date.now() - 1_000).toISOString(), refundFact: "refund_succeeded",
        })));
      if (purchaseKind === "subscription") {
        await expectRefundState(accepted.refundRequestId, "termination_pending");
        await withRole("gd_licensing_worker_definer", async (worker) => {
          await repository.recordOperationResult(worker, currentOperation, permit!, {
            outcome: "confirmed", responseDigest: hash(`${label}-termination-confirmed`), resources: [],
          });
          const refundWork = await repository.leaseProviderOperationWork(worker, `${label}-refund-worker`);
          if (refundWork === null) throw new Error("subscription refund child work is unavailable");
          currentOperation = refundWork;
          permit = await repository.issueDispatchPermit(worker, refundWork, 30);
          await repository.consumeDispatchPermit(worker, refundWork, permit);
        });
        const replay = await scheduleReconciliation(active.agreement, `${label}-settled-after-child`, active.payment,
          "initial_payment");
        await withRole("gd_licensing_worker_definer", (worker) =>
          repository.applyAgreementObservationAndAuthority(worker, replay, observationCommand({
            payment: { purpose: "acquisition_initial", resourceKind: active.payment.kind,
              resourceId: active.payment.id, bindingDigest: active.payment.digest,
              settledAt: active.settledAt, grossMinor: 980, cumulativeRefundedMinor: 980 },
            digestLabel: `${label}-settled-after-child`, access: "refunded", renewal: "terminated",
            paidThrough: new Date(Date.now() - 1_000).toISOString(), refundFact: "refund_succeeded",
          })));
      }
      await expectRefundState(accepted.refundRequestId, "refunded");
      await withRole("gd_licensing_worker_definer", async (worker) => {
        const retained = await repository.leaseReleaseWork(worker, `${label}-retained`);
        expect(retained).not.toBeNull();
        await expect(repository.releaseProviderSlot(worker, retained!)).resolves.toMatchObject({ released: false });
      });
      await withRole("gd_licensing_owner", async (owner) => {
        const wait = await owner.query<{ state: string; attempt_count: number; delayed: boolean }>(`
          SELECT state,attempt_count,next_attempt_at>transaction_timestamp()+interval '50 minutes' AS delayed
          FROM licensing_private.commercial_jobs WHERE account_id=$1 AND provider_agreement_id=$2 AND kind='release'`,
        [accountId, active.agreement.providerAgreementId]);
        expect(wait.rows).toEqual([{ state: "retry_wait", attempt_count: 0, delayed: true }]);
      });
      await withRole("gd_licensing_worker_definer", async (worker) => {
        await expect(repository.recordOperationResult(worker, currentOperation, permit!, {
          outcome: "confirmed", responseDigest: hash(`${label}-late-confirmed`), resources: [],
        })).resolves.toMatchObject({ state: "confirmed", disposition: "current" });
      });
      await withRole("gd_licensing_owner", async (owner) => {
        const terminal = await owner.query<{ state: string; refund_operation_id: string | null; work_state: string }>(`
          SELECT request.state,request.refund_operation_id,work.state AS work_state
          FROM licensing_private.first_purchase_refund_requests request
          JOIN licensing_private.provider_operation_work work ON work.account_id=request.account_id
            AND work.provider_operation_id=$2
          WHERE request.account_id=$1 AND request.refund_request_id=$3`,
        [accountId, currentOperation.providerOperationId, accepted.refundRequestId]);
        expect(terminal.rows).toEqual([{ state: "refunded",
          refund_operation_id: currentOperation.providerOperationId,
          work_state: "succeeded" }]);
      });
      await withRole("gd_licensing_worker_definer", async (worker) => {
        const release = await repository.leaseReleaseWork(worker, `${label}-released`);
        expect(release).not.toBeNull();
        await expect(repository.releaseProviderSlot(worker, release!)).resolves.toMatchObject({ released: true });
      });
      const replacement = await reserve(`${label}-replacement`, "stripe", "subscription");
      await withRole("gd_licensing_worker_definer", async (worker) => {
        await expect(repository.recordOperationResult(worker, currentOperation, permit!, {
          outcome: "confirmed", responseDigest: hash(`${label}-late-confirmed`), resources: [],
        })).rejects.toMatchObject({ code: "40001" });
      });
      await withRole("gd_licensing_owner", async (owner) => {
        const current = await owner.query<{ current_provider_operation_id: string }>(`
          SELECT current_provider_operation_id FROM licensing_private.commercial_provider_slots WHERE account_id=$1`, [accountId]);
        expect(current.rows).toEqual([{ current_provider_operation_id: replacement.providerOperationId }]);
      });
      await expectRefundState(accepted.refundRequestId, "refunded");
    });

  it("retains a terminated renewable slot while cancellation is unresolved and replaces an old dead release job on confirmation", async () => {
    const label = "cancellation-release-block";
    const active = await activateAgreement(label, "subscription",
      new Date(Date.now() - 60_000).toISOString(), new Date(Date.now() + 86_400_000).toISOString());
    const cancellation = await transactions.withAccountCredential(Buffer.from(credential), "cancellation_request", (transaction) =>
      repository.requestCancellation(transaction, { requestId: `${label}-request`,
        expectedAgreementId: active.agreement.providerAgreementId, requestDigest: hash(`${label}-request`) }));
    await withRole("gd_licensing_owner", (owner) => owner.query(`UPDATE licensing_private.provider_agreements
      SET protected_paid_through=transaction_timestamp()-interval '1 second',renewal_disposition='terminated'
      WHERE account_id=$1 AND provider_agreement_id=$2`, [accountId, active.agreement.providerAgreementId]));
    const elapsed = await scheduleReconciliation(active.agreement, `${label}-elapsed`, active.payment);
    await withRole("gd_licensing_worker_definer", (worker) =>
      repository.applyAgreementObservationAndAuthority(worker, elapsed, observationCommand({
        payment: { purpose: "acquisition_initial", resourceKind: active.payment.kind,
          resourceId: active.payment.id, bindingDigest: active.payment.digest,
          settledAt: active.settledAt, grossMinor: 980, cumulativeRefundedMinor: 0 },
        digestLabel: `${label}-elapsed`, access: "refunded", renewal: "terminated",
        paidThrough: new Date(Date.now() - 1_000).toISOString(), refundFact: "none",
      })));
    for (const state of ["requested", "outcome_unknown", "failed_retryable", "manual_resolution"] as const) {
      await withRole("gd_licensing_owner", async (owner) => {
        await owner.query(`UPDATE licensing_private.cancellation_intents SET state=$3
          WHERE account_id=$1 AND provider_operation_id=$2`, [accountId, cancellation.providerOperationId, state]);
        await owner.query(`UPDATE licensing_private.commercial_jobs SET next_attempt_at=transaction_timestamp()
          WHERE account_id=$1 AND kind='release' AND state IN ('ready','retry_wait')`, [accountId]);
      });
      await withRole("gd_licensing_worker_definer", async (worker) => {
        const retained = await repository.leaseReleaseWork(worker, `${label}-${state}`);
        expect(retained).not.toBeNull();
        await expect(repository.releaseProviderSlot(worker, retained!)).resolves.toMatchObject({ released: false });
      });
    }
    await withRole("gd_licensing_owner", (owner) => owner.query(`UPDATE licensing_private.commercial_jobs
      SET state='dead_letter',dead_letter_at=transaction_timestamp(),dead_letter_reason='legacy_business_wait'
      WHERE account_id=$1 AND provider_agreement_id=$2 AND kind='release' AND state='retry_wait'`,
    [accountId, active.agreement.providerAgreementId]));
    await withRole("gd_licensing_worker_definer", async (worker) => {
      const permit = await repository.issueDispatchPermit(worker, cancellation.work, 30);
      await repository.consumeDispatchPermit(worker, cancellation.work, permit);
      await repository.recordOperationResult(worker, cancellation.work, permit, {
        outcome: "confirmed", responseDigest: hash(`${label}-confirmed`), resources: [],
      });
    });
    await withRole("gd_licensing_owner", async (owner) => {
      const jobs = await owner.query<{ state: string; count: string }>(`
        SELECT state,count(*)::text AS count FROM licensing_private.commercial_jobs
        WHERE account_id=$1 AND provider_agreement_id=$2 AND kind='release' GROUP BY state ORDER BY state`,
      [accountId, active.agreement.providerAgreementId]);
      expect(jobs.rows).toEqual([{ state: "ready", count: "1" }, { state: "dead_letter", count: "1" }]);
    });
    await withRole("gd_licensing_owner", (owner) => owner.query(`UPDATE licensing_private.commercial_jobs
      SET next_attempt_at=transaction_timestamp() WHERE account_id=$1 AND kind='release' AND state='retry_wait'`, [accountId]));
    await withRole("gd_licensing_worker_definer", async (worker) => {
      const release = await repository.leaseReleaseWork(worker, `${label}-released`);
      expect(release).not.toBeNull();
      await expect(repository.releaseProviderSlot(worker, release!)).resolves.toMatchObject({ released: true });
    });
  });

  it("releases after a cancellation redrive child succeeds while retaining its dead parent for audit", async () => {
    const label = "cancel-redrive-release";
    const active = await activateAgreement(label, "subscription",
      new Date(Date.now() - 60_000).toISOString(), new Date(Date.now() + 86_400_000).toISOString());
    const cancellation = await transactions.withAccountCredential(Buffer.from(credential), "cancellation_request", (transaction) =>
      repository.requestCancellation(transaction, { requestId: `${label}-request`,
        expectedAgreementId: active.agreement.providerAgreementId, requestDigest: hash(`${label}-request`) }));
    await withRole("gd_licensing_owner", (owner) => owner.query(`UPDATE licensing_private.provider_operation_work
      SET attempt_count=1,max_attempts=1 WHERE work_id=$1`, [cancellation.work.workId]));
    await withRole("gd_licensing_worker_definer", async (worker) => {
      const permit = await repository.issueDispatchPermit(worker, cancellation.work, 30);
      await repository.consumeDispatchPermit(worker, cancellation.work, permit);
      await expect(repository.failBoundWork(worker, cancellation.work, "transient_network", 0))
        .resolves.toBe("dead_letter");
    });
    await withRole("gd_licensing_owner", (owner) => owner.query(`UPDATE licensing_private.provider_agreements
      SET protected_paid_through=transaction_timestamp()-interval '1 second',renewal_disposition='terminated'
      WHERE account_id=$1 AND provider_agreement_id=$2`, [accountId, active.agreement.providerAgreementId]));
    const elapsed = await scheduleReconciliation(active.agreement, `${label}-elapsed`, active.payment);
    await withRole("gd_licensing_worker_definer", (worker) =>
      repository.applyAgreementObservationAndAuthority(worker, elapsed, observationCommand({
        payment: { purpose: "acquisition_initial", resourceKind: active.payment.kind,
          resourceId: active.payment.id, bindingDigest: active.payment.digest,
          settledAt: active.settledAt, grossMinor: 980, cumulativeRefundedMinor: 0 },
        digestLabel: `${label}-elapsed`, access: "refunded", renewal: "terminated",
        paidThrough: new Date(Date.now() - 1_000).toISOString(), refundFact: "none",
      })));
    await withRole("gd_licensing_worker_definer", async (worker) => {
      const blocked = await repository.leaseReleaseWork(worker, `${label}-blocked`);
      expect(blocked).not.toBeNull();
      await expect(repository.releaseProviderSlot(worker, blocked!)).resolves.toMatchObject({ released: false });
    });
    const child = await withRole("gd_licensing_worker_definer", (worker) =>
      repository.redriveDeadLetterOperation(worker, `${label}-redrive`, "operator-reviewed"));
    expect(child).toMatchObject({ parentWorkId: cancellation.work.workId,
      providerOperationId: cancellation.providerOperationId });
    await withRole("gd_licensing_worker_definer", async (worker) => {
      const permit = await repository.issueDispatchPermit(worker, child!, 30);
      await repository.consumeDispatchPermit(worker, child!, permit);
      await repository.recordOperationResult(worker, child!, permit, {
        outcome: "confirmed", responseDigest: hash(`${label}-confirmed`), resources: [],
      });
      const release = await repository.leaseReleaseWork(worker, `${label}-released`);
      expect(release).not.toBeNull();
      await expect(repository.releaseProviderSlot(worker, release!)).resolves.toMatchObject({ released: true });
    });
    await withRole("gd_licensing_owner", async (owner) => {
      const lineage = await owner.query<{ work_id: string; state: string; parent_work_id: string | null }>(`
        SELECT work_id,state,parent_work_id FROM licensing_private.provider_operation_work
        WHERE provider_operation_id=$1 ORDER BY parent_work_id NULLS FIRST`, [cancellation.providerOperationId]);
      expect(lineage.rows).toEqual([
        { work_id: cancellation.work.workId, state: "dead_letter", parent_work_id: null },
        { work_id: child!.workId, state: "succeeded", parent_work_id: cancellation.work.workId },
      ]);
      await expect(owner.query("UPDATE licensing_private.provider_operation_work SET state='ready' WHERE work_id=$1",
        [cancellation.work.workId])).rejects.toMatchObject({ code: "55000" });
    });
  });

  it("releases a settled fixed-term refund after its dead parent is superseded by a successful redrive child", async () => {
    const label = "refund-redrive-release";
    const active = await activateAgreement(label, "fixed_term",
      new Date(Date.now() - 60_000).toISOString(), new Date(Date.now() + 315_360_000_000).toISOString());
    const accepted = acceptedRefund(await transactions.withAccountCredential(Buffer.from(credential), "refund_request", (transaction) =>
      repository.requestFirstPurchaseRefund(transaction, { requestId: `${label}-request`,
        expectedPurchaseAttemptId: active.agreement.purchaseAttemptId, requestDigest: hash(`${label}-request`) })));
    const acceptedOperation = await leaseFreshRefundOperation(`${label}-initial-worker`);
    await withRole("gd_licensing_owner", (owner) => owner.query(`UPDATE licensing_private.provider_operation_work
      SET attempt_count=1,max_attempts=1 WHERE work_id=$1`, [acceptedOperation.workId]));
    await withRole("gd_licensing_worker_definer", async (worker) => {
      const permit = await repository.issueDispatchPermit(worker, acceptedOperation, 30);
      await repository.consumeDispatchPermit(worker, acceptedOperation, permit);
      await expect(repository.failBoundWork(worker, acceptedOperation, "transient_network", 0))
        .resolves.toBe("dead_letter");
    });
    const child = await withRole("gd_licensing_worker_definer", (worker) =>
      repository.redriveDeadLetterOperation(worker, `${label}-redrive`, "operator-reviewed"));
    await withRole("gd_licensing_worker_definer", async (worker) => {
      const permit = await repository.issueDispatchPermit(worker, child!, 30);
      await repository.consumeDispatchPermit(worker, child!, permit);
      await repository.recordOperationResult(worker, child!, permit, {
        outcome: "confirmed", responseDigest: hash(`${label}-confirmed`), resources: [],
      });
    });
    const settled = await scheduleReconciliation(active.agreement, `${label}-settled`, active.payment, "capture_evidence");
    await withRole("gd_licensing_worker_definer", async (worker) => {
      await repository.applyAgreementObservationAndAuthority(worker, settled, observationCommand({
        payment: { purpose: "acquisition_initial", resourceKind: active.payment.kind,
          resourceId: active.payment.id, bindingDigest: active.payment.digest,
          settledAt: active.settledAt, grossMinor: 49_800, cumulativeRefundedMinor: 49_800 },
        digestLabel: `${label}-settled`, access: "refunded", renewal: "terminated",
        paidThrough: active.paidThrough, refundFact: "refund_succeeded",
      }));
      const release = await repository.leaseReleaseWork(worker, `${label}-released`);
      expect(release).not.toBeNull();
      await expect(repository.releaseProviderSlot(worker, release!)).resolves.toMatchObject({ released: true });
    });
    await withRole("gd_licensing_owner", async (owner) => {
      const states = await owner.query<{ state: string }>(`SELECT state FROM licensing_private.provider_operation_work
        WHERE provider_operation_id=$1 ORDER BY parent_work_id NULLS FIRST`, [acceptedOperation.providerOperationId]);
      expect(states.rows).toEqual([{ state: "dead_letter" }, { state: "succeeded" }]);
    });
  });

  it("keeps a dead redrive leaf blocking until a successful grandchild supersedes it", async () => {
    const label = "refund-redrive-grandchild";
    const active = await activateAgreement(label, "fixed_term",
      new Date(Date.now() - 60_000).toISOString(), new Date(Date.now() + 315_360_000_000).toISOString());
    const accepted = acceptedRefund(await transactions.withAccountCredential(Buffer.from(credential), "refund_request", (transaction) =>
      repository.requestFirstPurchaseRefund(transaction, { requestId: `${label}-request`,
        expectedPurchaseAttemptId: active.agreement.purchaseAttemptId, requestDigest: hash(`${label}-request`) })));
    const acceptedOperation = await leaseFreshRefundOperation(`${label}-initial-worker`);
    await withRole("gd_licensing_owner", (owner) => owner.query(`UPDATE licensing_private.provider_operation_work
      SET attempt_count=1,max_attempts=1 WHERE work_id=$1`, [acceptedOperation.workId]));
    await withRole("gd_licensing_worker_definer", async (worker) => {
      const permit = await repository.issueDispatchPermit(worker, acceptedOperation, 30);
      await repository.consumeDispatchPermit(worker, acceptedOperation, permit);
      await repository.recordOperationResult(worker, acceptedOperation, permit, {
        outcome: "outcome_unknown", responseDigest: hash(`${label}-parent-unknown`), resources: [],
      });
    });
    const child = await withRole("gd_licensing_worker_definer", (worker) =>
      repository.redriveDeadLetterOperation(worker, `${label}-child`, "first-redrive"));
    await withRole("gd_licensing_worker_definer", async (worker) => {
      const permit = await repository.issueDispatchPermit(worker, child!, 30);
      await repository.consumeDispatchPermit(worker, child!, permit);
      await repository.recordOperationResult(worker, child!, permit, {
        outcome: "outcome_unknown", responseDigest: hash(`${label}-child-unknown`), resources: [],
      });
    });
    const settled = await scheduleReconciliation(active.agreement, `${label}-settled`, active.payment, "capture_evidence");
    await withRole("gd_licensing_worker_definer", async (worker) => {
      await repository.applyAgreementObservationAndAuthority(worker, settled, observationCommand({
        payment: { purpose: "acquisition_initial", resourceKind: active.payment.kind,
          resourceId: active.payment.id, bindingDigest: active.payment.digest,
          settledAt: active.settledAt, grossMinor: 49_800, cumulativeRefundedMinor: 49_800 },
        digestLabel: `${label}-settled`, access: "refunded", renewal: "terminated",
        paidThrough: active.paidThrough, refundFact: "refund_succeeded",
      }));
      const blocked = await repository.leaseReleaseWork(worker, `${label}-blocked`);
      expect(blocked).not.toBeNull();
      await expect(repository.releaseProviderSlot(worker, blocked!)).resolves.toMatchObject({ released: false });
    });
    const grandchild = await withRole("gd_licensing_worker_definer", (worker) =>
      repository.redriveDeadLetterOperation(worker, `${label}-grandchild`, "second-redrive"));
    expect(grandchild?.parentWorkId).toBe(child!.workId);
    await withRole("gd_licensing_worker_definer", async (worker) => {
      const permit = await repository.issueDispatchPermit(worker, grandchild!, 30);
      await repository.consumeDispatchPermit(worker, grandchild!, permit);
      await repository.recordOperationResult(worker, grandchild!, permit, {
        outcome: "confirmed", responseDigest: hash(`${label}-confirmed`), resources: [],
      });
      const release = await repository.leaseReleaseWork(worker, `${label}-released`);
      expect(release).not.toBeNull();
      await expect(repository.releaseProviderSlot(worker, release!)).resolves.toMatchObject({ released: true });
    });
    await withRole("gd_licensing_owner", async (owner) => {
      const states = await owner.query<{ state: string }>(`SELECT state FROM licensing_private.provider_operation_work
        WHERE provider_operation_id=$1 ORDER BY last_attempt_at,work_id`, [acceptedOperation.providerOperationId]);
      expect(states.rows.map(({ state }) => state).sort()).toEqual(["dead_letter", "dead_letter", "succeeded"]);
    });
  });

  it.each(["fixed_term", "subscription"] as const)(
    "persists a zero-refund-progress full reversal for %s release under its normal term policy", async (purchaseKind) => {
      const label = `full-reversal-zero-progress-${purchaseKind}`;
      const active = await activateAgreement(label, purchaseKind,
        new Date(Date.now() - 60_000).toISOString(), new Date(Date.now() + 86_400_000).toISOString());
      const dispute = { kind: "dispute" as const, id: `dispute-${label}`, digest: hash(`dispute-${label}`),
        linkRole: "reversal_evidence" as const };
      const reversed = await scheduleReconciliation(active.agreement, `${label}-settled`, active.payment,
        purchaseKind === "fixed_term" ? "capture_evidence" : "initial_payment", dispute);
      await withRole("gd_licensing_worker_definer", (worker) =>
        repository.applyAgreementObservationAndAuthority(worker, reversed, observationCommand({
          payment: { purpose: "acquisition_initial", resourceKind: active.payment.kind,
            resourceId: active.payment.id, bindingDigest: active.payment.digest,
            settledAt: active.settledAt, grossMinor: purchaseKind === "fixed_term" ? 49_800 : 980,
            cumulativeRefundedMinor: 0 },
          digestLabel: `${label}-settled`, access: "refunded", renewal: "terminated",
          paidThrough: active.paidThrough, refundFact: "full_reversal_settled",
        })));
      await withRole("gd_licensing_owner", async (owner) => {
        const durable = await owner.query<{ state: string; refund_fact: string; cumulative: string }>(`
          SELECT head.state,head.refund_fact,progress.cumulative_refunded_minor::text AS cumulative
          FROM licensing_private.agreement_refund_evidence_heads head
          JOIN licensing_private.commercial_payment_refund_heads progress USING(payment_evidence_id)
          WHERE head.account_id=$1 AND head.provider_agreement_id=$2`,
        [accountId, active.agreement.providerAgreementId]);
        expect(durable.rows).toEqual([{ state: "resolved_settled",
          refund_fact: "full_reversal_settled", cumulative: "0" }]);
      });
      if (purchaseKind === "subscription") {
        await withRole("gd_licensing_owner", (owner) => owner.query(`INSERT INTO licensing_private.commercial_jobs
          (job_id,kind,account_id,provider_agreement_id,state) VALUES(gen_random_uuid(),'release',$1,$2,'ready')`,
        [accountId, active.agreement.providerAgreementId]));
        await withRole("gd_licensing_worker_definer", async (worker) => {
          const premature = await repository.leaseReleaseWork(worker, `${label}-premature`);
          expect(premature).not.toBeNull();
          await expect(repository.releaseProviderSlot(worker, premature!)).resolves.toMatchObject({ released: false });
        });
        await withRole("gd_licensing_owner", (owner) => owner.query(`UPDATE licensing_private.provider_agreements
          SET protected_paid_through=transaction_timestamp()-interval '1 second',renewal_disposition='terminated'
          WHERE account_id=$1 AND provider_agreement_id=$2`, [accountId, active.agreement.providerAgreementId]));
        const elapsed = await scheduleReconciliation(active.agreement, `${label}-elapsed`, null);
        await withRole("gd_licensing_worker_definer", (worker) =>
          repository.applyAgreementObservationAndAuthority(worker, elapsed, observationCommand({
            payment: null, digestLabel: `${label}-elapsed`, access: "refunded", renewal: "terminated",
            paidThrough: new Date(Date.now() - 1_000).toISOString(), refundFact: "none",
          })));
      }
      await withRole("gd_licensing_worker_definer", async (worker) => {
        const release = await repository.leaseReleaseWork(worker, `${label}-released`);
        expect(release).not.toBeNull();
        await expect(repository.releaseProviderSlot(worker, release!)).resolves.toMatchObject({ released: true });
      });
    });

  it("dead-letters an exhausted pending-refund convergence chain while retaining the slot and non-granting authority", async () => {
    const active = await activateAgreement("refund-convergence-exhausted", "subscription",
      new Date(Date.now() - 60_000).toISOString(), new Date(Date.now() + 86_400_000).toISOString());
    const first = await scheduleReconciliation(active.agreement, "refund-convergence-exhausted-1", active.payment);
    await withRole("gd_licensing_owner", (owner) => owner.query(
      "UPDATE licensing_private.commercial_jobs SET max_attempts=2 WHERE job_id=$1", [first.workId]));
    await withRole("gd_licensing_worker_definer", (worker) =>
      repository.applyAgreementObservationAndAuthority(worker, first, observationCommand({
        payment: { purpose: "acquisition_initial", resourceKind: active.payment.kind,
          resourceId: active.payment.id, bindingDigest: active.payment.digest,
          settledAt: active.settledAt, grossMinor: 980, cumulativeRefundedMinor: 0 },
        digestLabel: "refund-convergence-exhausted-1", access: "refunded", renewal: "terminated",
        paidThrough: active.paidThrough, refundFact: "refund_pending",
      })));
    await withRole("gd_licensing_owner", (owner) => owner.query(
      "UPDATE licensing_private.commercial_jobs SET next_attempt_at=transaction_timestamp() WHERE parent_job_id=$1", [first.workId]));
    await withRole("gd_licensing_worker_definer", async (worker) => {
      const second = await repository.leaseReconciliationWork(worker, "refund-convergence-exhausted-2");
      expect(second).not.toBeNull();
      await repository.applyAgreementObservationAndAuthority(worker, second!, observationCommand({
        payment: { purpose: "acquisition_initial", resourceKind: active.payment.kind,
          resourceId: active.payment.id, bindingDigest: active.payment.digest,
          settledAt: active.settledAt, grossMinor: 980, cumulativeRefundedMinor: 0 },
        digestLabel: "refund-convergence-exhausted-2", access: "refunded", renewal: "terminated",
        paidThrough: active.paidThrough, refundFact: "refund_pending",
      }));
    });
    await expectNonGrantingAuthority();
    await withRole("gd_licensing_owner", async (owner) => {
      const facts = await owner.query<{ state: string; dead_letter_reason: string; children: string;
        slot_state: string; evidence_state: string }>(`
        SELECT terminal.state,terminal.dead_letter_reason,
          (SELECT count(*)::text FROM licensing_private.commercial_jobs child WHERE child.parent_job_id=terminal.job_id) AS children,
          slot.state AS slot_state,evidence.state AS evidence_state FROM licensing_private.commercial_jobs terminal
        JOIN licensing_private.commercial_provider_slots slot ON slot.account_id=terminal.account_id
        JOIN licensing_private.agreement_refund_evidence_heads evidence
          ON evidence.account_id=terminal.account_id AND evidence.provider_agreement_id=terminal.provider_agreement_id
        WHERE terminal.parent_job_id=$1`, [first.workId]);
      expect(facts.rows).toEqual([{ state: "dead_letter", dead_letter_reason: "provider_convergence_exhausted",
        children: "0", slot_state: "agreement_held", evidence_state: "blocking" }]);
    });
  });

  it("rejects stale cancellation work before issue and after permit issue once refund termination supersedes it", async () => {
    const first = await activateAgreement("permit-fence-before", "subscription",
      new Date(Date.now() - 60_000).toISOString(), new Date(Date.now() + 86_400_000).toISOString());
    const cancellation = await transactions.withAccountCredential(Buffer.from(credential), "cancellation_request", (transaction) =>
      repository.requestCancellation(transaction, { requestId: "cancel-before-refund",
        expectedAgreementId: first.agreement.providerAgreementId, requestDigest: hash("cancel-before-refund") }));
    const refund = acceptedRefund(await transactions.withAccountCredential(Buffer.from(credential), "refund_request", (transaction) =>
      repository.requestFirstPurchaseRefund(transaction, { requestId: "refund-before-issue",
        expectedPurchaseAttemptId: first.agreement.purchaseAttemptId, requestDigest: hash("refund-before-issue") })));
    expect(refund.operation).toBeNull();
    const refundOperation = await leaseFreshRefundOperation("refund-before-issue-worker");
    await expect(withRole("gd_licensing_worker_definer", (worker) =>
      repository.issueDispatchPermit(worker, cancellation.work, 30))).rejects.toMatchObject({ code: "40001" });
    await withRole("gd_licensing_worker_definer", async (worker) => {
      const currentPermit = await repository.issueDispatchPermit(worker, refundOperation, 30);
      await expect(repository.consumeDispatchPermit(worker, refundOperation, currentPermit)).resolves.toMatchObject({
        providerOperationId: refundOperation.providerOperationId,
      });
    });

    await clearLicensingTestData(ownerPool);
    const second = await activateAgreement("permit-fence-after", "subscription",
      new Date(Date.now() - 60_000).toISOString(), new Date(Date.now() + 86_400_000).toISOString());
    const issuedCancellation = await transactions.withAccountCredential(Buffer.from(credential), "cancellation_request", (transaction) =>
      repository.requestCancellation(transaction, { requestId: "cancel-issued-before-refund",
        expectedAgreementId: second.agreement.providerAgreementId, requestDigest: hash("cancel-issued-before-refund") }));
    const oldPermit = await withRole("gd_licensing_worker_definer", (worker) =>
      repository.issueDispatchPermit(worker, issuedCancellation.work, 30));
    await transactions.withAccountCredential(Buffer.from(credential), "refund_request", (transaction) =>
      repository.requestFirstPurchaseRefund(transaction, { requestId: "refund-after-issue",
        expectedPurchaseAttemptId: second.agreement.purchaseAttemptId, requestDigest: hash("refund-after-issue") }));
    await withRole("gd_licensing_worker_definer", async (worker) => {
      await expect(repository.consumeDispatchPermit(worker, issuedCancellation.work, oldPermit))
        .rejects.toMatchObject({ code: "40001" });
    });
    await withRole("gd_licensing_owner", async (owner) => {
      const permit = await owner.query<{ state: string }>(
        "SELECT state FROM licensing_private.provider_dispatch_permits WHERE dispatch_permit_id=$1", [oldPermit.dispatchPermitId]);
      expect(permit.rows).toEqual([{ state: "issued" }]);
    });
  });

  it("rejects an old consumed permit paired with the current retry lease without changing current dispatch state", async () => {
    const label = "refund-stale-consumed-permit";
    const active = await activateAgreement(label, "fixed_term",
      new Date(Date.now() - 60_000).toISOString(), new Date(Date.now() + 315_360_000_000).toISOString());
    const accepted = acceptedRefund(await transactions.withAccountCredential(Buffer.from(credential), "refund_request", (transaction) =>
      repository.requestFirstPurchaseRefund(transaction, { requestId: `${label}-request`,
        expectedPurchaseAttemptId: active.agreement.purchaseAttemptId, requestDigest: hash(`${label}-request`) })));
    const acceptedOperation = await leaseFreshRefundOperation(`${label}-initial-worker`);
    let stalePermit: Awaited<ReturnType<typeof repository.issueDispatchPermit>>;
    await withRole("gd_licensing_worker_definer", async (worker) => {
      stalePermit = await repository.issueDispatchPermit(worker, acceptedOperation, 30);
      await repository.consumeDispatchPermit(worker, acceptedOperation, stalePermit);
      await repository.recordOperationResult(worker, acceptedOperation, stalePermit, {
        outcome: "outcome_unknown", responseDigest: hash(`${label}-first-unknown`), resources: [],
      });
    });
    await withRole("gd_licensing_owner", async (owner) => {
      await owner.query(`UPDATE licensing_private.provider_operation_work
        SET next_attempt_at=transaction_timestamp() WHERE work_id=$1`, [acceptedOperation.workId]);
      await owner.query(`UPDATE licensing_private.first_purchase_refund_requests
        SET retry_at=transaction_timestamp() WHERE refund_request_id=$1`, [accepted.refundRequestId]);
    });
    const current = await withRole("gd_licensing_worker_definer", (worker) =>
      repository.leaseProviderOperationWork(worker, `${label}-retry-worker`));
    expect(current?.workId).toBe(acceptedOperation.workId);
    let currentPermit: Awaited<ReturnType<typeof repository.issueDispatchPermit>>;
    await withRole("gd_licensing_worker_definer", async (worker) => {
      currentPermit = await repository.issueDispatchPermit(worker, current!, 30);
      await repository.consumeDispatchPermit(worker, current!, currentPermit);
    });
    const before = await withRole("gd_licensing_owner", async (owner) => {
      const facts = await owner.query<{ operation_state: string; operation_revision: string; work_state: string;
        request_state: string; results: string }>(`
        SELECT operation.state AS operation_state,operation.operation_revision::text,work.state AS work_state,
          request.state AS request_state,(SELECT count(*)::text FROM licensing_private.provider_operation_results result
            JOIN licensing_private.provider_dispatch_permits permit USING(dispatch_permit_id)
            WHERE permit.provider_operation_id=operation.provider_operation_id) AS results
        FROM licensing_private.provider_operations operation
        JOIN licensing_private.provider_operation_work work ON work.account_id=operation.account_id
          AND work.provider_operation_id=operation.provider_operation_id
        JOIN licensing_private.first_purchase_refund_requests request ON request.account_id=operation.account_id
          AND request.refund_operation_id=operation.provider_operation_id
        WHERE operation.account_id=$1 AND operation.provider_operation_id=$2`,
      [accountId, acceptedOperation.providerOperationId]);
      return facts.rows;
    });
    await withRole("gd_licensing_worker_definer", async (worker) => {
      await expect(repository.recordOperationResult(worker, current!, stalePermit!, {
        outcome: "confirmed", responseDigest: hash(`${label}-stale-confirmed`), resources: [],
      })).rejects.toMatchObject({ code: "40001" });
    });
    const after = await withRole("gd_licensing_owner", async (owner) => {
      const facts = await owner.query<{ operation_state: string; operation_revision: string; work_state: string;
        request_state: string; results: string }>(`
        SELECT operation.state AS operation_state,operation.operation_revision::text,work.state AS work_state,
          request.state AS request_state,(SELECT count(*)::text FROM licensing_private.provider_operation_results result
            JOIN licensing_private.provider_dispatch_permits permit USING(dispatch_permit_id)
            WHERE permit.provider_operation_id=operation.provider_operation_id) AS results
        FROM licensing_private.provider_operations operation
        JOIN licensing_private.provider_operation_work work ON work.account_id=operation.account_id
          AND work.provider_operation_id=operation.provider_operation_id
        JOIN licensing_private.first_purchase_refund_requests request ON request.account_id=operation.account_id
          AND request.refund_operation_id=operation.provider_operation_id
        WHERE operation.account_id=$1 AND operation.provider_operation_id=$2`,
      [accountId, acceptedOperation.providerOperationId]);
      return facts.rows;
    });
    expect(after).toEqual(before);
    await withRole("gd_licensing_worker_definer", async (worker) => {
      await expect(repository.recordOperationResult(worker, current!, currentPermit!, {
        outcome: "confirmed", responseDigest: hash(`${label}-current-confirmed`), resources: [],
      })).resolves.toMatchObject({ state: "confirmed", disposition: "current" });
    });
    await expectRefundState(accepted.refundRequestId, "refund_pending");
  });

  it.each(["checkout", "cancellation", "refund"] as const)(
    "turns a failed consumed %s operation into retryable uncertainty only for the exact lease", async (operationKind) => {
      const label = `fail-consumed-${operationKind}`;
      const work = await planOperationForFailure(label, operationKind);
      let firstPermit: Awaited<ReturnType<typeof repository.issueDispatchPermit>>;
      await withRole("gd_licensing_worker_definer", async (worker) => {
        firstPermit = await repository.issueDispatchPermit(worker, work, 30);
        await repository.consumeDispatchPermit(worker, work, firstPermit);
        await expect(repository.failBoundWork(worker, work, "transient_network", 0)).resolves.toBe("retry_wait");
      });
      await withRole("gd_licensing_owner", async (owner) => {
        const failed = await owner.query<{ operation_state: string; work_state: string }>(`
          SELECT operation.state AS operation_state,work.state AS work_state
          FROM licensing_private.provider_operations operation
          JOIN licensing_private.provider_operation_work work ON work.account_id=operation.account_id
            AND work.provider_operation_id=operation.provider_operation_id
          WHERE operation.account_id=$1 AND operation.provider_operation_id=$2 AND work.work_id=$3`,
        [accountId, work.providerOperationId, work.workId]);
        expect(failed.rows).toEqual([{ operation_state: "outcome_unknown", work_state: "retry_wait" }]);
        await owner.query(`UPDATE licensing_private.provider_operation_work SET next_attempt_at=transaction_timestamp()
          WHERE work_id=$1`, [work.workId]);
        if (operationKind === "refund") await owner.query(`UPDATE licensing_private.first_purchase_refund_requests
          SET retry_at=transaction_timestamp() WHERE refund_operation_id=$1`, [work.providerOperationId]);
      });
      const current = await withRole("gd_licensing_worker_definer", (worker) =>
        repository.leaseProviderOperationWork(worker, `${label}-retry-worker`));
      expect(current?.workId).toBe(work.workId);
      await withRole("gd_licensing_worker_definer", async (worker) => {
        await expect(repository.failBoundWork(worker, work, "transient_network", 0))
          .rejects.toMatchObject({ code: "40001" });
      });
      await withRole("gd_licensing_owner", async (owner) => {
        const unchanged = await owner.query<{ operation_state: string; work_state: string; lease_epoch: string }>(`
          SELECT operation.state AS operation_state,work.state AS work_state,work.lease_epoch::text
          FROM licensing_private.provider_operations operation
          JOIN licensing_private.provider_operation_work work ON work.account_id=operation.account_id
            AND work.provider_operation_id=operation.provider_operation_id
          WHERE operation.account_id=$1 AND operation.provider_operation_id=$2 AND work.work_id=$3`,
        [accountId, work.providerOperationId, work.workId]);
        expect(unchanged.rows).toEqual([{ operation_state: "outcome_unknown", work_state: "leased",
          lease_epoch: String(current!.leaseEpoch) }]);
      });
      await withRole("gd_licensing_worker_definer", async (worker) => {
        const freshPermit = await repository.issueDispatchPermit(worker, current!, 30);
        expect(freshPermit.operationRevision).toBeGreaterThan(firstPermit!.operationRevision);
      });
    });

  it("maps deterministic refund rejection to manual resolution and transient uncertainty to a bounded due retry", async () => {
    const rejectedActive = await activateAgreement("refund-rejected", "fixed_term",
      new Date(Date.now() - 60_000).toISOString(), new Date(Date.now() + 315_360_000_000).toISOString());
    const rejected = acceptedRefund(await transactions.withAccountCredential(Buffer.from(credential), "refund_request", (transaction) =>
      repository.requestFirstPurchaseRefund(transaction, { requestId: "refund-rejected-request",
        expectedPurchaseAttemptId: rejectedActive.agreement.purchaseAttemptId, requestDigest: hash("refund-rejected-request") })));
    const rejectedOperation = await leaseFreshRefundOperation("refund-rejected-worker");
    await withRole("gd_licensing_worker_definer", async (worker) => {
      const permit = await repository.issueDispatchPermit(worker, rejectedOperation, 30);
      await repository.consumeDispatchPermit(worker, rejectedOperation, permit);
      await repository.recordOperationResult(worker, rejectedOperation, permit, {
        outcome: "rejected", responseDigest: hash("refund-provider-rejected"), resources: [],
      });
    });
    await expect(transactions.withAccountCredential(Buffer.from(credential), "billing_read", (transaction) =>
      repository.readFirstPurchaseRefundStatus(transaction, rejected.refundRequestId)))
      .resolves.toMatchObject({ state: "manual_resolution", retryAt: null });
    await expectReadOnlyAuthority();

    await clearLicensingTestData(ownerPool);
    const retryActive = await activateAgreement("refund-retry", "fixed_term",
      new Date(Date.now() - 60_000).toISOString(), new Date(Date.now() + 315_360_000_000).toISOString());
    const retry = acceptedRefund(await transactions.withAccountCredential(Buffer.from(credential), "refund_request", (transaction) =>
      repository.requestFirstPurchaseRefund(transaction, { requestId: "refund-retry-request",
        expectedPurchaseAttemptId: retryActive.agreement.purchaseAttemptId, requestDigest: hash("refund-retry-request") })));
    const retryOperation = await leaseFreshRefundOperation("refund-retry-initial-worker");
    await withRole("gd_licensing_worker_definer", async (worker) => {
      const permit = await repository.issueDispatchPermit(worker, retryOperation, 30);
      await repository.consumeDispatchPermit(worker, retryOperation, permit);
      await repository.recordOperationResult(worker, retryOperation, permit, {
        outcome: "outcome_unknown", responseDigest: hash("refund-provider-unknown"), resources: [],
      });
    });
    const retryStatus = await transactions.withAccountCredential(Buffer.from(credential), "billing_read", (transaction) =>
      repository.readFirstPurchaseRefundStatus(transaction, retry.refundRequestId));
    expect(retryStatus).toMatchObject({ state: "retry_wait" });
    expect(retryStatus?.retryAt).not.toBeNull();
    await withRole("gd_licensing_owner", (owner) => owner.query(`
      UPDATE licensing_private.provider_operation_work SET next_attempt_at=transaction_timestamp() WHERE work_id=$1`,
    [retryOperation.workId]));
    const leaseBeforeReplay = await withRole("gd_licensing_owner", (owner) => owner.query<{ state: string; lease_epoch: string; lease_owner: string | null }>(
      `SELECT state,lease_epoch::text,lease_owner FROM licensing_private.provider_operation_work WHERE work_id=$1`, [retryOperation.workId]));
    const replay = acceptedRefund(await transactions.withAccountCredential(Buffer.from(credential), "refund_request", (transaction) =>
      repository.requestFirstPurchaseRefund(transaction, { requestId: "refund-retry-request",
        expectedPurchaseAttemptId: retryActive.agreement.purchaseAttemptId, requestDigest: hash("refund-retry-request") })));
    expect(replay).toMatchObject({ replay: "same_request", operation: null, state: "retry_wait" });
    const leaseAfterReplay = await withRole("gd_licensing_owner", (owner) => owner.query<{ state: string; lease_epoch: string; lease_owner: string | null }>(
      `SELECT state,lease_epoch::text,lease_owner FROM licensing_private.provider_operation_work WHERE work_id=$1`, [retryOperation.workId]));
    expect(leaseAfterReplay.rows).toEqual(leaseBeforeReplay.rows);
    await withRole("gd_licensing_worker_definer", async (worker) => {
      await expect(repository.leaseProviderOperationWork(worker, "refund-early-worker")).resolves.toBeNull();
    });
    await withRole("gd_licensing_owner", (owner) => owner.query(`
      UPDATE licensing_private.first_purchase_refund_requests
        SET retry_at=transaction_timestamp() WHERE refund_request_id=$1`, [retry.refundRequestId]));
    await withRole("gd_licensing_worker_definer", async (worker) => {
      const due = await repository.leaseProviderOperationWork(worker, "refund-retry-worker");
      expect(due).toMatchObject({ workId: retryOperation.workId, providerOperationId: retryOperation.providerOperationId });
      const permit = await repository.issueDispatchPermit(worker, due!, 30);
      await repository.consumeDispatchPermit(worker, due!, permit);
      await repository.recordOperationResult(worker, due!, permit, {
        outcome: "confirmed", responseDigest: hash("refund-provider-recovered"), resources: [],
      });
    });
    await expect(transactions.withAccountCredential(Buffer.from(credential), "billing_read", (transaction) =>
      repository.readFirstPurchaseRefundStatus(transaction, retry.refundRequestId)))
      .resolves.toMatchObject({ state: "refund_pending", retryAt: null });
    await expectReadOnlyAuthority();
  });

  it.each([
    ["fixed_term", "dead_letter", "transient_network" as const],
    ["fixed_term", "quarantined", "identity_conflict" as const],
    ["subscription", "dead_letter", "transient_network" as const],
    ["subscription", "quarantined", "identity_conflict" as const],
  ] as const)("terminalizes an accepted %s refund when provider work becomes %s", async (purchaseKind, terminal, failure) => {
    const label = `refund-work-${purchaseKind}-${terminal}`;
    const active = await activateAgreement(label, purchaseKind,
      new Date(Date.now() - 60_000).toISOString(), new Date(Date.now() + 315_360_000_000).toISOString());
    const accepted = acceptedRefund(await transactions.withAccountCredential(Buffer.from(credential), "refund_request", (transaction) =>
      repository.requestFirstPurchaseRefund(transaction, {
        requestId: `${label}-request`,
        expectedPurchaseAttemptId: active.agreement.purchaseAttemptId,
        requestDigest: hash(`${label}-request`),
      })));
    const acceptedOperation = await leaseFreshRefundOperation(`${label}-initial-worker`);
    await withRole("gd_licensing_owner", (owner) => owner.query(
      "UPDATE licensing_private.provider_operation_work SET max_attempts=1 WHERE work_id=$1",
      [acceptedOperation.workId],
    ));
    await withRole("gd_licensing_worker_definer", async (worker) => {
      const permit = await repository.issueDispatchPermit(worker, acceptedOperation, 30);
      await repository.consumeDispatchPermit(worker, acceptedOperation, permit);
      await expect(repository.failBoundWork(worker, acceptedOperation, failure, 0)).resolves.toBe(terminal);
    });
    await expect(transactions.withAccountCredential(Buffer.from(credential), "billing_read", (transaction) =>
      repository.readFirstPurchaseRefundStatus(transaction, accepted.refundRequestId)))
      .resolves.toMatchObject({ state: "manual_resolution", retryAt: null });
    await expectReadOnlyAuthority();
    await withRole("gd_licensing_owner", (owner) => owner.query(`INSERT INTO licensing_private.commercial_jobs
      (job_id,kind,account_id,provider_agreement_id,state) VALUES(gen_random_uuid(),'release',$1,$2,'ready')`,
    [accountId, active.agreement.providerAgreementId]));
    await withRole("gd_licensing_worker_definer", async (worker) => {
      const release = await repository.leaseReleaseWork(worker, `${label}-release`);
      expect(release).not.toBeNull();
      await expect(repository.releaseProviderSlot(worker, release!)).resolves.toMatchObject({ released: false });
    });
    await withRole("gd_licensing_owner", async (owner) => {
      const release = await owner.query<{ state: string; last_error_class: string }>(`SELECT state,last_error_class
        FROM licensing_private.commercial_jobs WHERE account_id=$1 AND provider_agreement_id=$2 AND kind='release'`,
      [accountId, active.agreement.providerAgreementId]);
      expect(release.rows).toEqual([{ state: "retry_wait", last_error_class: "refund_operation_unresolved" }]);
    });
  });

  it("reuses an immutable Stripe Charge payment link for a reversal receipt and revokes authority", async () => {
    const active = await activateAgreement("stripe-charge-reversed", "subscription",
      new Date(Date.now() - 60_000).toISOString(), new Date(Date.now() + 86_400_000).toISOString(), "stripe");
    const reversal = await scheduleReconciliation(active.agreement, "stripe-charge-refunded", active.payment, "initial_payment");
    await withRole("gd_licensing_worker_definer", async (worker) => {
      await expect(repository.applyAgreementObservationAndAuthority(worker, reversal, observationCommand({
        payment: { purpose: "acquisition_initial", resourceKind: active.payment.kind,
          resourceId: active.payment.id, bindingDigest: active.payment.digest,
          settledAt: active.settledAt, grossMinor: 980, cumulativeRefundedMinor: 980 },
        digestLabel: "stripe-charge-refunded", access: "refunded", renewal: "terminated",
        paidThrough: active.paidThrough, refundFact: "full_reversal_settled",
      }))).resolves.toMatchObject({ disposition: "applied" });
    });
    await expectReadOnlyAuthority();
    await withRole("gd_licensing_owner", async (owner) => {
      const links = await owner.query<{ role: string }>(`SELECT role FROM licensing_private.agreement_resource_links
        WHERE account_id=$1 AND provider='stripe' AND resource_kind='charge' AND resource_id=$2`,
      [accountId, active.payment.id]);
      expect(links.rows).toEqual([{ role: "initial_payment" }]);
    });
  });

  it("keeps an accepted renewable refund read-only through partial and ambiguous facts and releases only after termination plus paid-through", async () => {
    const active = await activateAgreement("refund-subscription", "subscription",
      new Date(Date.now() - 335 * 3_600_000).toISOString(), new Date(Date.now() + 86_400_000).toISOString());
    const beforeClaim = await eligibilityFacts();
    expect(beforeClaim).toHaveLength(1);
    expect(beforeClaim[0]!.window_ends_at.getTime() - beforeClaim[0]!.window_starts_at.getTime())
      .toBe(336 * 3_600_000);

    const accepted = acceptedRefund(await transactions.withAccountCredential(Buffer.from(credential), "refund_request", (transaction) =>
      repository.requestFirstPurchaseRefund(transaction, {
        requestId: "refund-subscription-request",
        expectedPurchaseAttemptId: active.agreement.purchaseAttemptId,
        requestDigest: hash("refund-subscription-request"),
      })));
    const acceptedOperation = await leaseFreshRefundOperation("refund-subscription-initial-worker");
    expect(accepted).toMatchObject({ state: "termination_pending", replay: "created", remainingMinorAtAcceptance: 980 });
    await expect(transactions.withAccountCredential(Buffer.from(credential), "billing_read", (transaction) =>
      repository.readFirstPurchaseRefundStatus(transaction, accepted.refundRequestId)))
      .resolves.toMatchObject({ state: "termination_pending" });
    await expectReadOnlyAuthority();

    const partial = await scheduleReconciliation(active.agreement, "refund-subscription-partial", active.payment);
    await withRole("gd_licensing_worker_definer", async (worker) => {
      await expect(repository.applyAgreementObservationAndAuthority(worker, partial, observationCommand({
        payment: { purpose: "acquisition_initial", resourceKind: active.payment.kind,
          resourceId: active.payment.id, bindingDigest: active.payment.digest,
          settledAt: active.settledAt, grossMinor: 980, cumulativeRefundedMinor: 400 },
        digestLabel: "refund-subscription-partial", access: "refunded", renewal: "terminated",
        paidThrough: active.paidThrough, refundFact: "partial_refund",
      }))).resolves.toMatchObject({ disposition: "applied" });
    });
    await expectRefundState(accepted.refundRequestId, "termination_pending");

    const mixed = await scheduleReconciliation(active.agreement, "refund-subscription-mixed", active.payment);
    await withRole("gd_licensing_worker_definer", async (worker) => {
      const command = observationCommand({
        payment: { purpose: "acquisition_initial", resourceKind: active.payment.kind,
          resourceId: active.payment.id, bindingDigest: active.payment.digest,
          settledAt: active.settledAt, grossMinor: 980, cumulativeRefundedMinor: 980 },
        digestLabel: "refund-subscription-mixed", access: "refunded", renewal: "terminated",
        paidThrough: active.paidThrough, refundFact: "refund_succeeded",
      });
      await expect(repository.applyAgreementObservationAndAuthority(worker, mixed, {
        ...command, paymentEvidence: { ...command.paymentEvidence!, currency: "EUR" as "USD" },
      })).rejects.toMatchObject({ code: "22023" });
    });
    await expectRefundState(accepted.refundRequestId, "termination_pending");

    const ambiguous = await scheduleReconciliation(active.agreement, "refund-subscription-ambiguous", active.payment);
    await withRole("gd_licensing_worker_definer", async (worker) => {
      await expect(repository.applyAgreementObservationAndAuthority(worker, ambiguous, observationCommand({
        payment: { purpose: "acquisition_initial", resourceKind: active.payment.kind,
          resourceId: active.payment.id, bindingDigest: active.payment.digest,
          settledAt: active.settledAt, grossMinor: 980, cumulativeRefundedMinor: 980 },
        digestLabel: "refund-subscription-ambiguous", access: "refunded", renewal: "terminated",
        paidThrough: active.paidThrough, refundFact: "refund_pending",
      }))).resolves.toMatchObject({ disposition: "applied" });
    });
    await expectRefundState(accepted.refundRequestId, "termination_pending");

    const exactFuture = await scheduleReconciliation(active.agreement, "refund-subscription-exact-future", active.payment);
    await withRole("gd_licensing_worker_definer", async (worker) => {
      await expect(repository.applyAgreementObservationAndAuthority(worker, exactFuture, observationCommand({
        payment: { purpose: "acquisition_initial", resourceKind: active.payment.kind,
          resourceId: active.payment.id, bindingDigest: active.payment.digest,
          settledAt: active.settledAt, grossMinor: 980, cumulativeRefundedMinor: 980 },
        digestLabel: "refund-subscription-exact-future", access: "refunded", renewal: "terminated",
        paidThrough: active.paidThrough, refundFact: "refund_succeeded",
      }))).resolves.toMatchObject({ disposition: "applied" });
    });
    await expectRefundState(accepted.refundRequestId, "termination_pending");
    await withRole("gd_licensing_worker_definer", async (worker) => {
      const terminationPermit = await repository.issueDispatchPermit(worker, acceptedOperation, 30);
      await repository.consumeDispatchPermit(worker, acceptedOperation, terminationPermit);
      await repository.recordOperationResult(worker, acceptedOperation, terminationPermit, {
        outcome: "confirmed", responseDigest: hash("refund-subscription-termination-confirmed"), resources: [],
      });
      const refundWork = await repository.leaseProviderOperationWork(worker, "refund-subscription-child");
      expect(refundWork).not.toBeNull();
      const refundPermit = await repository.issueDispatchPermit(worker, refundWork!, 30);
      await repository.consumeDispatchPermit(worker, refundWork!, refundPermit);
      await repository.recordOperationResult(worker, refundWork!, refundPermit, {
        outcome: "confirmed", responseDigest: hash("refund-subscription-child-confirmed"), resources: [],
      });
    });
    const exactSettled = await scheduleReconciliation(active.agreement, "refund-subscription-exact-settled", active.payment);
    await withRole("gd_licensing_worker_definer", (worker) =>
      repository.applyAgreementObservationAndAuthority(worker, exactSettled, observationCommand({
        payment: { purpose: "acquisition_initial", resourceKind: active.payment.kind,
          resourceId: active.payment.id, bindingDigest: active.payment.digest,
          settledAt: active.settledAt, grossMinor: 980, cumulativeRefundedMinor: 980 },
        digestLabel: "refund-subscription-exact-settled", access: "refunded", renewal: "terminated",
        paidThrough: active.paidThrough, refundFact: "refund_succeeded",
      })));
    await expectRefundState(accepted.refundRequestId, "refunded");
    await withRole("gd_licensing_owner", (owner) => owner.query(`INSERT INTO licensing_private.commercial_jobs
      (job_id,kind,account_id,provider_agreement_id,state) VALUES(gen_random_uuid(),'release',$1,$2,'ready')`,
    [accountId, active.agreement.providerAgreementId]));
    await withRole("gd_licensing_worker_definer", async (worker) => {
      const retained = await repository.leaseReleaseWork(worker, "refund-future-release");
      expect(retained).not.toBeNull();
      await expect(repository.releaseProviderSlot(worker, retained!)).resolves.toMatchObject({ released: false });
    });

    await withRole("gd_licensing_owner", (owner) => owner.query(`UPDATE licensing_private.provider_agreements
      SET protected_paid_through=transaction_timestamp()-interval '1 second' WHERE account_id=$1`, [accountId]));
    const exactDue = await scheduleReconciliation(active.agreement, "refund-subscription-exact-due", active.payment);
    await withRole("gd_licensing_worker_definer", async (worker) => {
      await repository.applyAgreementObservationAndAuthority(worker, exactDue, observationCommand({
        payment: { purpose: "acquisition_initial", resourceKind: active.payment.kind,
          resourceId: active.payment.id, bindingDigest: active.payment.digest,
          settledAt: active.settledAt, grossMinor: 980, cumulativeRefundedMinor: 980 },
        digestLabel: "refund-subscription-exact-due", access: "refunded", renewal: "terminated",
        paidThrough: new Date(Date.now() - 1_000).toISOString(), refundFact: "refund_succeeded",
      }));
      const release = await repository.leaseReleaseWork(worker, "refund-due-release");
      expect(release).not.toBeNull();
      await expect(repository.releaseProviderSlot(worker, release!)).resolves.toMatchObject({ released: true });
    });
  });

  it("releases a fixed-term slot immediately only on an exact full succeeded refund", async () => {
    const active = await activateAgreement("refund-fixed", "fixed_term",
      new Date(Date.now() - 60_000).toISOString(), new Date(Date.now() + 315_360_000_000).toISOString());
    const accepted = acceptedRefund(await transactions.withAccountCredential(Buffer.from(credential), "refund_request", (transaction) =>
      repository.requestFirstPurchaseRefund(transaction, {
        requestId: "refund-fixed-request", expectedPurchaseAttemptId: active.agreement.purchaseAttemptId,
        requestDigest: hash("refund-fixed-request"),
      })));
    const acceptedOperation = await leaseFreshRefundOperation("refund-fixed-initial-worker");
    expect(accepted.state).toBe("refund_pending");
    await expectReadOnlyAuthority();

    await withRole("gd_licensing_worker_definer", async (worker) => {
      const permit = await repository.issueDispatchPermit(worker, acceptedOperation, 30);
      await repository.consumeDispatchPermit(worker, acceptedOperation, permit);
      await repository.recordOperationResult(worker, acceptedOperation, permit, {
        outcome: "confirmed", responseDigest: hash("refund-fixed-provider-confirmed"), resources: [],
      });
    });

    const work = await scheduleReconciliation(active.agreement, "refund-fixed-exact", active.payment, "capture_evidence");
    await withRole("gd_licensing_worker_definer", async (worker) => {
      await expect(repository.applyAgreementObservationAndAuthority(worker, work, observationCommand({
        payment: { purpose: "acquisition_initial", resourceKind: active.payment.kind,
          resourceId: active.payment.id, bindingDigest: active.payment.digest,
          settledAt: active.settledAt, grossMinor: 49_800, cumulativeRefundedMinor: 49_800 },
        digestLabel: "refund-fixed-exact", access: "refunded", renewal: "terminated",
        paidThrough: active.paidThrough, refundFact: "refund_succeeded",
      }))).resolves.toMatchObject({ disposition: "applied" });
      const release = await repository.leaseReleaseWork(worker, "fixed-full-refund-release");
      expect(release).not.toBeNull();
      await expect(repository.releaseProviderSlot(worker, release!)).resolves.toMatchObject({ released: true });
    });
    await expectRefundState(accepted.refundRequestId, "refunded");
    await expect(transactions.withAccountCredential(Buffer.from(credential), "refund_request", (transaction) =>
      repository.requestFirstPurchaseRefund(transaction, { requestId: "refund-fixed-already-reversed",
        expectedPurchaseAttemptId: active.agreement.purchaseAttemptId,
        requestDigest: hash("refund-fixed-already-reversed") })))
      .resolves.toEqual({ disposition: "rejected", reason: "already_fully_reversed" });
    const replacement = await activateAgreement("refund-fixed-replacement", "subscription",
      new Date().toISOString(), new Date(Date.now() + 86_400_000).toISOString(), "stripe");
    await withRole("gd_licensing_owner", async (owner) => {
      const authority = await owner.query<{ grants_access: boolean; state: string }>(`SELECT a.grants_access,p.state
        FROM licensing_private.commercial_authorities a JOIN licensing_private.account_entitlement_projections p USING(account_id)
        WHERE a.account_id=$1`, [accountId]);
      expect(authority.rows).toEqual([{ grants_access: true, state: "active" }]);
    });
    await expect(transactions.withAccountCredential(Buffer.from(credential), "billing_read", (transaction) =>
      repository.readBillingStatus(transaction))).resolves.toMatchObject({
        purchaseAttemptId: replacement.agreement.purchaseAttemptId, refundEligibleUntil: null,
      });
    await expect(transactions.withAccountCredential(Buffer.from(credential), "refund_request", (transaction) =>
      repository.requestFirstPurchaseRefund(transaction, { requestId: "refund-fixed-replacement-rejected",
        expectedPurchaseAttemptId: replacement.agreement.purchaseAttemptId,
        requestDigest: hash("refund-fixed-replacement-rejected") })))
      .resolves.toEqual({ disposition: "rejected", reason: "not_first_paid_purchase" });
  });
});

type Provider = "stripe" | "paypal";

interface AgreementFixture {
  readonly provider: Provider;
  readonly purchaseKind: CommercialPurchaseKind;
  readonly purchaseAttemptId: string;
  readonly providerAgreementId: string;
  readonly anchorKind: string;
  readonly anchorId: string;
  readonly anchorDigest: Uint8Array;
}

async function reserve(label: string, provider: Provider, purchaseKind: CommercialPurchaseKind) {
  return transactions.withAccountCredential(Buffer.from(credential), "purchase_reserve", (transaction) =>
    repository.reservePurchase(transaction, {
      requestId: `request-${label}`,
      provider,
      purchaseKind,
      offer: purchaseKind === "fixed_term" ? "ten_year" : "monthly",
      providerCatalogItem: `catalog-${label}`,
      campaignCode: null,
      expectedGrossMinor: purchaseKind === "fixed_term" ? 49_800 : 980,
      expectedCurrency: "USD",
      requestDigest: hash(`reserve-${label}`),
    }));
}

async function planOperationForFailure(
  label: string,
  kind: "checkout" | "cancellation" | "refund",
): Promise<BoundProviderOperationWork> {
  if (kind === "checkout") return (await reserve(label, "stripe", "subscription")).work;
  const active = await activateAgreement(
    label,
    kind === "refund" ? "fixed_term" : "subscription",
    new Date(Date.now() - 60_000).toISOString(),
    new Date(Date.now() + (kind === "refund" ? 315_360_000_000 : 86_400_000)).toISOString(),
  );
  if (kind === "cancellation") {
    const cancellation = await transactions.withAccountCredential(
      Buffer.from(credential),
      "cancellation_request",
      (transaction) => repository.requestCancellation(transaction, {
        requestId: `${label}-request`,
        expectedAgreementId: active.agreement.providerAgreementId,
        requestDigest: hash(`${label}-request`),
      }),
    );
    return cancellation.work;
  }
  const accepted = acceptedRefund(await transactions.withAccountCredential(
    Buffer.from(credential),
    "refund_request",
    (transaction) => repository.requestFirstPurchaseRefund(transaction, {
      requestId: `${label}-request`,
      expectedPurchaseAttemptId: active.agreement.purchaseAttemptId,
      requestDigest: hash(`${label}-request`),
    }),
  ));
  return leaseFreshRefundOperation(`${label}-worker`);
}

async function establishAgreement(label: string, purchaseKind: CommercialPurchaseKind,
  provider: Provider = "paypal"): Promise<AgreementFixture> {
  const plan = await reserve(label, provider, purchaseKind);
  const anchorKind = purchaseKind === "fixed_term" ? "order" : "subscription";
  const anchorId = `${anchorKind}-${label}`;
  const anchorDigest = hash(`anchor-${label}`);
  const creationResources = provider === "stripe"
    ? [{ resourceKind: "checkout_session", resourceId: `checkout-${label}`,
        bindingDigest: hash(`checkout-${label}`), role: "created" as const },
      { resourceKind: anchorKind, resourceId: anchorId, bindingDigest: anchorDigest, role: "created" as const }]
    : [{ resourceKind: anchorKind, resourceId: anchorId, bindingDigest: anchorDigest, role: "created" as const }];
  let providerAgreementId = "";
  await withRole("gd_licensing_worker_definer", async (worker) => {
    const permit = await repository.issueDispatchPermit(worker, plan.work, 30);
    await repository.consumeDispatchPermit(worker, plan.work, permit);
    await repository.recordOperationResult(worker, plan.work, permit, {
      outcome: "confirmed", responseDigest: hash(`result-${label}`), resources: creationResources,
    });
    if (purchaseKind === "fixed_term") return;
    if (provider === "stripe") return;
    const result = await repository.handoffProviderAgreement(worker, plan.work, {
      observationDigest: hash(`handoff-${label}`),
      handoff: { kind: "paypal_subscription",
        subscription: { ...creationResources[0]!, role: "canonical_agreement" } },
      paymentResources: [],
    });
    providerAgreementId = result.providerAgreementId;
  });
  if (provider === "stripe" && purchaseKind === "subscription") {
    await withRole("gd_licensing_ingress_definer", (ingress) => repository.receiveAuthenticatedReceipt(ingress, {
      kind: "actionable", provider, providerEventId: `event-handoff-${label}`, payloadDigest: hash(`payload-handoff-${label}`),
      eventType: "checkout.session.completed", triggerResourceKind: anchorKind, triggerResourceId: anchorId,
      ignoredReason: null, occurredAt: new Date().toISOString(), authenticatedEvidenceRef: `receipt:handoff-${label}`,
    }));
    await withRole("gd_licensing_worker_definer", async (worker) => {
      const receiptWork = await repository.leaseReceiptWork(worker, `handoff-${label}`);
      if (receiptWork === null) throw new Error("Stripe handoff receipt is unavailable");
      const result = await repository.handoffProviderAgreement(worker, receiptWork, {
        observationDigest: hash(`handoff-${label}`), handoff: { kind: "stripe_subscription",
          checkoutSession: { ...creationResources[0]!, role: "checkout_origin" },
          subscription: { ...creationResources[1]!, role: "canonical_agreement" } }, paymentResources: [],
      });
      providerAgreementId = result.providerAgreementId;
    });
  }
  if (purchaseKind === "fixed_term") {
    const capturePlan = await transactions.withAccountCredential(Buffer.from(credential), "fixed_term_capture", (transaction) =>
      repository.confirmFixedTermCapture(transaction, {
        requestId: `capture-${label}`,
        expectedOrderOperationId: plan.providerOperationId,
        requestDigest: hash(`capture-${label}`),
      }));
    const capture = { resourceKind: "capture", resourceId: `capture-${label}`,
      bindingDigest: hash(`capture-${label}`) };
    await withRole("gd_licensing_worker_definer", async (worker) => {
      const permit = await repository.issueDispatchPermit(worker, capturePlan.work, 30);
      await repository.consumeDispatchPermit(worker, capturePlan.work, permit);
      await repository.recordOperationResult(worker, capturePlan.work, permit, {
        outcome: "confirmed", responseDigest: hash(`capture-result-${label}`),
        resources: [{ ...capture, role: "created" }],
      });
      const result = await repository.handoffProviderAgreement(worker, capturePlan.work, {
        observationDigest: hash(`handoff-${label}`),
        handoff: {
          kind: "paypal_fixed_term",
          order: { ...resourcesForHandoff(anchorKind, anchorId, anchorDigest), role: "order_origin" },
          capture: { ...capture, role: "capture_evidence" },
          capturedAt: new Date(Date.now() - 60_000).toISOString(),
        },
        paymentResources: [{ resourceKind: "capture", resourceId: capture.resourceId,
          bindingDigest: capture.bindingDigest }],
      });
      providerAgreementId = result.providerAgreementId;
    });
  }
  return { provider, purchaseKind, purchaseAttemptId: plan.purchaseAttemptId,
    providerAgreementId, anchorKind, anchorId, anchorDigest };
}

function resourcesForHandoff(resourceKind: string, resourceId: string, bindingDigest: Uint8Array) {
  return { resourceKind, resourceId, bindingDigest };
}

async function scheduleReconciliation(
  agreement: AgreementFixture,
  label: string,
  payment: { readonly kind: "charge" | "sale" | "capture"; readonly id: string; readonly digest: Uint8Array } | null,
  linkRole: "capture_evidence" | "initial_payment" | "refund_evidence" | "reversal_evidence" = "initial_payment",
  receiptTrigger?: { readonly kind: SupplementalAgreementResourceFact["resourceKind"];
    readonly id: string; readonly digest: Uint8Array;
    readonly linkRole: "refund_evidence" | "reversal_evidence" },
): Promise<BoundReconciliationWork> {
  const trigger = receiptTrigger ?? payment ?? { kind: agreement.anchorKind, id: agreement.anchorId };
  const receipt = {
    kind: "actionable" as const,
    provider: agreement.provider,
    providerEventId: `event-${label}`,
    payloadDigest: hash(`payload-${label}`),
    eventType: "payment.lifecycle.updated",
    triggerResourceKind: trigger.kind,
    triggerResourceId: trigger.id,
    ignoredReason: null,
    occurredAt: new Date().toISOString(),
    authenticatedEvidenceRef: `receipt:${label}`,
  };
  await withRole("gd_licensing_ingress_definer", (ingress) =>
    repository.receiveAuthenticatedReceipt(ingress, receipt));
  return withRole("gd_licensing_worker_definer", async (worker) => {
    const receiptWork = await repository.leaseReceiptWork(worker, `receipt-${label}`);
    if (receiptWork === null) throw new Error("receipt work is unavailable");
    if (payment !== null || receiptTrigger !== undefined) {
      const linked = receiptTrigger === undefined
        ? { resourceKind: payment!.kind, resourceId: payment!.id, bindingDigest: payment!.digest, linkRole }
        : { resourceKind: receiptTrigger.kind, resourceId: receiptTrigger.id,
            bindingDigest: receiptTrigger.digest, linkRole: receiptTrigger.linkRole };
      await repository.linkReceiptResourcesToAgreement(worker, receiptWork, {
        anchorResourceKind: agreement.anchorKind,
        anchorResourceId: agreement.anchorId,
        anchorBindingDigest: agreement.anchorDigest,
        resources: [linked],
      });
    }
    const bound = await repository.bindReceiptWork(worker, receiptWork);
    expect(bound.disposition).toBe("reconciliation_scheduled");
    let reconciliation = await repository.leaseReconciliationWork(worker, `reconcile-${label}`);
    if (reconciliation !== null && reconciliation.workId !== bound.reconciliationJobId) {
      expect(reconciliation.requestedGeneration).toBeLessThan(bound.requestedGeneration!);
      await expect(repository.applyAgreementObservationAndAuthority(worker, reconciliation, observationCommand({
        payment: null, digestLabel: `${label}-superseded-handoff`,
      }))).resolves.toMatchObject({ disposition: "stale_generation", authorityRevision: null });
      reconciliation = await repository.leaseReconciliationWork(worker, `reconcile-${label}-current`);
    }
    if (reconciliation === null) throw new Error("reconciliation work is unavailable");
    expect(reconciliation.workId).toBe(bound.reconciliationJobId);
    return reconciliation;
  });
}

async function activateAgreement(
  label: string,
  purchaseKind: CommercialPurchaseKind,
  settledAt: string,
  paidThrough: string,
  provider: Provider = "paypal",
) {
  const agreement = await establishAgreement(label, purchaseKind, provider);
  const payment = {
    kind: purchaseKind === "fixed_term" ? "capture" as const : provider === "stripe" ? "charge" as const : "sale" as const,
    id: purchaseKind === "fixed_term" ? `capture-${label}` : `initial-payment-${label}`,
    digest: hash(purchaseKind === "fixed_term" ? `capture-${label}` : `initial-payment-${label}`),
  };
  const work = await scheduleReconciliation(agreement, `${label}-initial`, payment,
    purchaseKind === "fixed_term" ? "capture_evidence" : "initial_payment");
  await withRole("gd_licensing_worker_definer", async (worker) => {
    const applied = await repository.applyAgreementObservationAndAuthority(worker, work, observationCommand({
      payment: { purpose: "acquisition_initial", resourceKind: payment.kind,
        resourceId: payment.id, bindingDigest: payment.digest, settledAt,
        grossMinor: purchaseKind === "fixed_term" ? 49_800 : 980, cumulativeRefundedMinor: 0 },
      digestLabel: `${label}-initial`, paidThrough,
    }));
    expect(applied.disposition).toBe("applied");
    expect(applied.authorityRevision).toBeGreaterThan(0);
  });
  return { agreement, payment, settledAt, paidThrough };
}

function observationCommand(input: {
  readonly payment: { readonly purpose: "acquisition_initial" | "renewal" | "adjustment";
    readonly resourceKind: "charge" | "sale" | "capture"; readonly resourceId: string;
    readonly bindingDigest: Uint8Array; readonly settledAt: string;
    readonly grossMinor: number; readonly cumulativeRefundedMinor: number } | null;
  readonly digestLabel: string;
  readonly access?: "active" | "delinquent" | "refunded";
  readonly renewal?: "renewing" | "nonrenewing" | "terminated";
  readonly paidThrough?: string;
  readonly refundFact?: ApplyAgreementObservationCommand["refundFact"];
}): ApplyAgreementObservationCommand {
  return {
    observation: {
      providerAccess: input.access ?? "active",
      renewalDisposition: input.renewal ?? "renewing",
      observedPaidThrough: input.paidThrough ?? new Date(Date.now() + 86_400_000).toISOString(),
      observedAt: new Date().toISOString(),
      plan: "pro",
      featureEntitlements: ["workspace:mutate"],
      reversal: "none",
    },
    observationDigest: hash(`observation-${input.digestLabel}`),
    paymentEvidence: input.payment === null ? null : {
      ...input.payment, currency: "USD", sourceDigest: hash(`source-${input.digestLabel}`),
    },
    refundFact: input.refundFact ?? "none",
  };
}

function acceptedRefund(decision: FirstPurchaseRefundDecision) {
  expect(decision.disposition).toBe("accepted");
  if (decision.disposition !== "accepted") throw new Error(`refund was rejected: ${decision.reason}`);
  return decision.acceptance;
}

async function leaseFreshRefundOperation(workerId: string) {
  const work = await withRole("gd_licensing_worker_definer", (worker) =>
    repository.leaseProviderOperationWork(worker, workerId));
  if (work === null) throw new Error("fresh refund work is unavailable");
  return work;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<T>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`concurrent PostgreSQL refund test exceeded ${timeoutMs}ms`)), timeoutMs);
    })]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function waitUntil(predicate: () => Promise<boolean>): Promise<void> {
  while (!await predicate()) await new Promise<void>((resolve) => setTimeout(resolve, 10));
}

async function licensingCounts() {
  return withRole("gd_licensing_owner", async (owner) => {
    const rows = await owner.query<{ observations: string; authorities: string; rights: string }>(`
      SELECT (SELECT count(*)::text FROM licensing_private.agreement_observations) AS observations,
        (SELECT count(*)::text FROM licensing_private.commercial_authorities) AS authorities,
        (SELECT count(*)::text FROM licensing_private.commercial_rights) AS rights`);
    return rows.rows[0];
  });
}

async function eligibilityFacts() {
  return withRole("gd_licensing_owner", async (owner) => {
    const rows = await owner.query<{
      first_payment_evidence_id: string;
      window_starts_at: Date;
      window_ends_at: Date;
      gross_minor: string;
      state: string;
      revision: string;
    }>(`SELECT first_payment_evidence_id,window_starts_at,window_ends_at,gross_minor::text,state,revision::text
      FROM licensing_private.first_paid_purchase_eligibilities WHERE account_id=$1`, [accountId]);
    return rows.rows;
  });
}

async function expectReadOnlyAuthority(): Promise<void> {
  await withRole("gd_licensing_owner", async (owner) => {
    const rows = await owner.query<{ grants_access: boolean; state: string }>(`
      SELECT authority.grants_access,projection.state
      FROM licensing_private.commercial_authorities authority
      JOIN licensing_private.account_entitlement_projections projection USING(account_id)
      WHERE authority.account_id=$1`, [accountId]);
    expect(rows.rows).toEqual([{ grants_access: false, state: "revoked" }]);
  });
}

async function expectNonGrantingAuthority(): Promise<void> {
  await withRole("gd_licensing_owner", async (owner) => {
    const rows = await owner.query<{ grants_access: boolean; state: string }>(`
      SELECT authority.grants_access,projection.state
      FROM licensing_private.commercial_authorities authority
      JOIN licensing_private.account_entitlement_projections projection USING(account_id)
      WHERE authority.account_id=$1`, [accountId]);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.grants_access).toBe(false);
    expect(["suspended", "revoked"]).toContain(rows.rows[0]?.state);
  });
}

async function expectRefundState(refundRequestId: string, state: string): Promise<void> {
  await withRole("gd_licensing_owner", async (owner) => {
    const rows = await owner.query<{ state: string }>(`
      SELECT state FROM licensing_private.first_purchase_refund_requests
      WHERE account_id=$1 AND refund_request_id=$2`, [accountId, refundRequestId]);
    expect(rows.rows).toEqual([{ state }]);
  });
}

async function seedIdentity(): Promise<void> {
  await ownerPool.query(`INSERT INTO public.identity_accounts
    (account_id,email_normalized,password_policy_id,password_hash_phc)
    VALUES($1,$2,'argon2id-v1',repeat('x',80))`, [accountId, `${accountId}@example.invalid`]);
  await ownerPool.query("INSERT INTO public.identity_account_security_states(account_id) VALUES($1)", [accountId]);
  await ownerPool.query(`INSERT INTO public.identity_auth_sessions
    (account_id,session_id,client_kind,auth_method,remember_device,epoch_at_issue,expires_at)
    VALUES($1,$2,'account_web','password',true,1,transaction_timestamp()+interval '1 hour')`, [accountId, credential]);
  await ownerPool.query(`INSERT INTO public.identity_refresh_families(account_id,family_id,session_id,current_refresh_jti)
    VALUES($1,$2,$3,$4)`, [accountId, `family-${accountId}`, credential, `refresh-${accountId}`]);
}

async function withRole<T>(role: "gd_identity_owner" | "gd_licensing_owner" | "gd_licensing_worker_definer"
  | "gd_licensing_ingress_definer", action: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await ownerPool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL ROLE ${role}`);
    const result = await action(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function hash(value: string): Uint8Array { return createHash("sha256").update(value).digest(); }
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new TypeError(`${name} is required`);
  return value;
}
