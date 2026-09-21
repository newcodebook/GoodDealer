import type { AccountTransaction, DatabaseQuery } from "../../db/index";
import type {
  ApplyAgreementObservationCommand, ApplyAgreementObservationResult, ApprovalRedirectHandle,
  AuthenticatedProviderReceipt, BoundCommercialWork, BoundDueAuthorityWork,
  BoundProviderOperationWork, BoundReceiptWork, BoundReconciliationWork, BoundReleaseWork,
  CancellationPlan, ClaimedApprovalRedirect, CommercialAggregateRepositoryPort,
  CommercialBillingStatus, CommercialFailureClass, CommercialJobState, CommercialOperationPlan,
  ConfirmFixedTermCaptureCommand, ConsumedProviderDispatch, FirstPurchaseRefundDecision,
  FirstPurchaseRefundStatus, FixedTermCapturePlan,
  HandoffProviderAgreementCommand, HandoffProviderAgreementResult, ProviderDispatchPermit,
  LinkReceiptResourcesCommand, ProviderAgreementHandoffWork, ProviderOperationReplay, ProviderReceiptDisposition, ProviderResourceFact,
  RecordProviderOperationResultCommand, RedrivenCommercialWork, RedrivenProviderOperationWork,
  RequestCancellationCommand, RequestFirstPurchaseRefundCommand, ReservePurchaseCommand,
} from "./commercial-domain";

type Queryable = AccountTransaction | DatabaseQuery;
type Row = Readonly<Record<string, unknown>>;

/** Runtime SQL is intentionally limited to the three least-privilege façade schemas. */
export class PostgresCommercialAggregateRepository implements CommercialAggregateRepositoryPort {
  async readBillingStatus(transaction: AccountTransaction): Promise<CommercialBillingStatus | null> {
    const row = await maybeOne(transaction, "SELECT * FROM licensing_api.read_billing_status()", []);
    if (row === null) return null;
    return {
      purchaseAttemptId: string(row, "purchase_attempt_id"), requestId: string(row, "request_id"),
      providerAgreementId: nullableString(row, "provider_agreement_id"),
      currentProviderOperationId: nullableString(row, "current_provider_operation_id"),
      provider: provider(row, "provider"), offer: offer(row, "offer"),
      campaignCode: nullableString(row, "campaign_code"), state: billingState(row, "state"),
      paidThrough: nullableTimestamp(row, "paid_through"),
      refundEligibleUntil: nullableTimestamp(row, "refund_eligible_until"),
    };
  }

  async reservePurchase(transaction: AccountTransaction, command: ReservePurchaseCommand): Promise<CommercialOperationPlan> {
    const row = await one(transaction,
      "SELECT * FROM licensing_api.reserve_purchase($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [command.requestId, command.provider, command.purchaseKind, command.offer,
        command.providerCatalogItem, command.campaignCode, command.expectedGrossMinor,
        command.expectedCurrency, digest(command.requestDigest)]);
    return operationPlan(row, command.requestDigest);
  }

  async requestCancellation(transaction: AccountTransaction,
    command: RequestCancellationCommand): Promise<CancellationPlan> {
    const row = await one(transaction, "SELECT * FROM licensing_api.request_cancellation($1,$2,$3)",
      [command.requestId, command.expectedAgreementId, digest(command.requestDigest)]);
    return {
      ...operationPlan(row, command.requestDigest), operationKind: "subscription_cancel",
      providerAgreementId: string(row, "provider_agreement_id"),
      providerAgreementResourceKind: string(row, "provider_agreement_resource_kind"),
      providerAgreementResourceId: string(row, "provider_agreement_resource_id"),
      protectedPaidThrough: nullableTimestamp(row, "protected_paid_through"),
      intentRevision: positive(row, "intent_revision"),
    };
  }

  async confirmFixedTermCapture(transaction: AccountTransaction,
    command: ConfirmFixedTermCaptureCommand): Promise<FixedTermCapturePlan> {
    const row = await one(transaction, "SELECT * FROM licensing_api.confirm_fixed_term_capture($1,$2,$3)",
      [command.requestId, command.expectedOrderOperationId, digest(command.requestDigest)]);
    return {
      ...operationPlan(row, command.requestDigest), operationKind: "fixed_term_order_capture",
      providerOrderResourceKind: string(row, "provider_order_resource_kind"),
      providerOrderResourceId: string(row, "provider_order_resource_id"),
    };
  }

  async requestFirstPurchaseRefund(transaction: AccountTransaction,
    command: RequestFirstPurchaseRefundCommand): Promise<FirstPurchaseRefundDecision> {
    const row = await one(transaction, "SELECT * FROM licensing_api.request_first_purchase_refund($1,$2,$3)",
      [command.requestId, command.expectedPurchaseAttemptId, digest(command.requestDigest)]);
    const rejectionReason = value(row, "rejection_reason");
    if (rejectionReason !== null) return { disposition: "rejected", reason: member(row, "rejection_reason", [
      "not_first_paid_purchase", "window_elapsed", "not_paid", "already_claimed", "already_fully_reversed", "purchase_mismatch",
    ] as const) };
    return { disposition: "accepted", acceptance: {
      refundRequestId: string(row, "refund_request_id"), state: refundState(row, "refund_state"),
      acceptedAt: timestamp(row, "accepted_at"), remainingMinorAtAcceptance: positive(row, "remaining_minor_at_acceptance"),
      expectedPurchaseAttemptId: string(row, "expected_purchase_attempt_id"),
      providerAgreementId: string(row, "provider_agreement_id"), replay: replay(row, "replay"),
      operation: null,
    } };
  }

  async readFirstPurchaseRefundStatus(transaction: AccountTransaction,
    expectedRefundRequestId: string): Promise<FirstPurchaseRefundStatus | null> {
    const row = await maybeOne(transaction, "SELECT * FROM licensing_api.read_first_purchase_refund_status($1)",
      [expectedRefundRequestId]);
    return row === null ? null : { refundRequestId: string(row, "refund_request_id"),
      expectedPurchaseAttemptId: string(row, "expected_purchase_attempt_id"), state: refundState(row, "state"),
      acceptedAt: timestamp(row, "accepted_at"), remainingMinorAtAcceptance: positive(row, "remaining_minor_at_acceptance"),
      retryAt: nullableTimestamp(row, "retry_at"), completedAt: nullableTimestamp(row, "completed_at") };
  }

  async issueApprovalRedirect(transaction: AccountTransaction,
    expectedHolderId: string): Promise<ApprovalRedirectHandle> {
    const row = await one(transaction, "SELECT * FROM licensing_api.issue_approval_redirect($1)", [expectedHolderId]);
    return { handle: bytes(row, "raw_handle"), expiresAt: timestamp(row, "expires_at") };
  }

  async claimApprovalRedirect(transaction: AccountTransaction,
    rawHandle: Uint8Array): Promise<ClaimedApprovalRedirect> {
    const row = await one(transaction, "SELECT * FROM licensing_api.claim_approval_redirect($1)", [Buffer.from(rawHandle)]);
    return { claimId: string(row, "claim_id"), provider: provider(row, "provider"),
      providerResourceKind: string(row, "provider_resource_kind"),
      providerResourceId: string(row, "provider_resource_id"),
      expectedPurchaseAttemptId: string(row, "expected_purchase_attempt_id"),
      expectedPurchaseKind: purchaseKind(row, "expected_purchase_kind"),
      expectedOffer: offer(row, "expected_offer"),
      expectedProviderCatalogItem: string(row, "expected_provider_catalog_item"),
      expectedAmountMinor: positive(row, "expected_amount_minor"),
      expectedCurrency: currency(row, "expected_currency") };
  }

  async completeApprovalRedirect(transaction: AccountTransaction, claimId: string,
    outcome: "consumed" | "expired" | "manual_resolution"): Promise<void> {
    await transaction.query("SELECT licensing_api.complete_approval_redirect($1,$2)", [claimId, outcome]);
  }

  async receiveAuthenticatedReceipt(query: DatabaseQuery,
    receipt: AuthenticatedProviderReceipt): Promise<ProviderReceiptDisposition> {
    const row = await one(query,
      "SELECT licensing_ingress_api.receive_authenticated_receipt($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS disposition",
      [receipt.provider, receipt.providerEventId, digest(receipt.payloadDigest), receipt.eventType,
        receipt.kind, receipt.triggerResourceKind, receipt.triggerResourceId, receipt.ignoredReason,
        receipt.occurredAt, receipt.authenticatedEvidenceRef]);
    return receiptDisposition(row, "disposition");
  }

  async leaseProviderOperationWork(query: DatabaseQuery,
    workerInstanceId: string): Promise<BoundProviderOperationWork | null> {
    const row = await maybeOne(query, "SELECT * FROM licensing_worker_api.lease_provider_operation_work($1)",
      [workerInstanceId]);
    return row === null ? null : operationWork(row);
  }

  async redriveDeadLetterOperation(query: DatabaseQuery, workerInstanceId: string,
    auditReason: string): Promise<RedrivenProviderOperationWork | null> {
    const row = await maybeOne(query, "SELECT * FROM licensing_worker_api.redrive_dead_letter_operation($1,$2)",
      [workerInstanceId, auditReason]);
    return row === null ? null : { ...operationWork(row), parentWorkId: string(row, "parent_work_id") };
  }

  async redriveDeadLetterJob(query: DatabaseQuery, workerInstanceId: string,
    auditReason: string): Promise<RedrivenCommercialWork | null> {
    const row = await maybeOne(query, "SELECT * FROM licensing_worker_api.redrive_dead_letter_job($1,$2)",
      [workerInstanceId, auditReason]);
    if (row === null) return null;
    return { ...baseWork(row, jobKind(row, "kind")), parentJobId: string(row, "parent_job_id") };
  }

  async issueDispatchPermit(query: DatabaseQuery, work: BoundProviderOperationWork,
    requestedTtlSeconds: number): Promise<ProviderDispatchPermit> {
    const row = await one(query, "SELECT * FROM licensing_worker_api.issue_dispatch_permit($1,$2,$3,$4)",
      [work.workId, work.leaseEpoch, Buffer.from(work.rawToken), requestedTtlSeconds]);
    return dispatchPermit(row);
  }

  async consumeDispatchPermit(query: DatabaseQuery, work: BoundProviderOperationWork,
    permit: ProviderDispatchPermit): Promise<ConsumedProviderDispatch> {
    const row = await one(query, "SELECT * FROM licensing_worker_api.consume_dispatch_permit($1,$2,$3,$4,$5)",
      [work.workId, work.leaseEpoch, Buffer.from(work.rawToken), permit.dispatchPermitId, permit.operationKind]);
    return { ...dispatchPermit(row), consumedAt: timestamp(row, "consumed_at"),
      provider: provider(row, "provider"), providerIdempotencyKey: string(row, "provider_idempotency_key") };
  }

  async recordOperationResult(query: DatabaseQuery, work: BoundProviderOperationWork,
    permit: ProviderDispatchPermit, command: RecordProviderOperationResultCommand): Promise<ProviderOperationReplay> {
    const facts = resourceArrays(command.resources);
    const row = await one(query,
      "SELECT * FROM licensing_worker_api.record_operation_result($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [work.workId, work.leaseEpoch, Buffer.from(work.rawToken), permit.dispatchPermitId, command.outcome,
        digest(command.responseDigest), facts.kinds, facts.ids, facts.digests, facts.roles]);
    return operationReplay(row);
  }

  async readOperationReplay(query: DatabaseQuery,
    work: BoundProviderOperationWork): Promise<ProviderOperationReplay> {
    return operationReplay(await one(query,
      "SELECT * FROM licensing_worker_api.read_operation_replay($1,$2,$3)",
      [work.workId, work.leaseEpoch, Buffer.from(work.rawToken)]));
  }

  async handoffProviderAgreement(query: DatabaseQuery, work: ProviderAgreementHandoffWork,
    command: HandoffProviderAgreementCommand): Promise<HandoffProviderAgreementResult> {
    const facts = handoffArrays(command);
    const row = await one(query,
      "SELECT * FROM licensing_worker_api.handoff_provider_agreement($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
      [work.workId, work.leaseEpoch, Buffer.from(work.rawToken), command.handoff.kind,
        facts.kinds, facts.ids, facts.digests, digest(command.observationDigest),
        handoffCapturedAt(command), command.paymentResources.map((fact) => fact.resourceKind),
        command.paymentResources.map((fact) => fact.resourceId),
        command.paymentResources.map((fact) => digest(fact.bindingDigest))]);
    return { providerAgreementId: string(row, "provider_agreement_id"),
      slotEpoch: positive(row, "slot_epoch"), replay: handoffReplay(row, "replay") };
  }

  async leaseReceiptWork(query: DatabaseQuery, workerInstanceId: string): Promise<BoundReceiptWork | null> {
    const row = await maybeOne(query, "SELECT * FROM licensing_worker_api.lease_receipt_work($1)", [workerInstanceId]);
    return row === null ? null : {
      ...baseWork(row, "receipt"), provider: provider(row, "provider"),
      providerEventId: string(row, "provider_event_id"), payloadDigest: bytes(row, "payload_digest"),
      eventType: string(row, "event_type"),
      receiptKind: "actionable", triggerResourceKind: string(row, "trigger_resource_kind"),
      triggerResourceId: string(row, "trigger_resource_id"), occurredAt: timestamp(row, "occurred_at"),
      authenticatedEvidenceRef: string(row, "authenticated_evidence_ref"),
    };
  }

  async linkReceiptResourcesToAgreement(query: DatabaseQuery, work: BoundReceiptWork,
    command: LinkReceiptResourcesCommand): Promise<string> {
    const row = await one(query,
      "SELECT licensing_worker_api.link_receipt_resources_to_agreement($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS provider_agreement_id",
      [work.workId, work.leaseEpoch, Buffer.from(work.rawToken), command.anchorResourceKind,
        command.anchorResourceId, digest(command.anchorBindingDigest), command.resources.map((fact) => fact.resourceKind),
        command.resources.map((fact) => fact.resourceId), command.resources.map((fact) => digest(fact.bindingDigest)),
        command.resources.map((fact) => fact.linkRole)]);
    return string(row, "provider_agreement_id");
  }

  async bindReceiptWork(query: DatabaseQuery, work: BoundReceiptWork): Promise<
    | { readonly disposition: "reconciliation_scheduled"; readonly reconciliationJobId: string;
        readonly requestedGeneration: number }
    | { readonly disposition: "handoff_required"; readonly reconciliationJobId: null;
        readonly requestedGeneration: null }> {
    const row = await one(query, "SELECT * FROM licensing_worker_api.bind_receipt_work($1,$2,$3,$4)",
      [work.workId, work.leaseEpoch, Buffer.from(work.rawToken), digest(work.payloadDigest)]);
    const state = member(row, "disposition", ["reconciliation_scheduled", "handoff_required"] as const);
    return state === "handoff_required"
      ? { disposition: state, reconciliationJobId: null, requestedGeneration: null }
      : { disposition: state, reconciliationJobId: string(row, "reconciliation_job_id"),
          requestedGeneration: positive(row, "requested_generation") };
  }

  async leaseReconciliationWork(query: DatabaseQuery,
    workerInstanceId: string): Promise<BoundReconciliationWork | null> {
    const row = await maybeOne(query, "SELECT * FROM licensing_worker_api.lease_reconciliation_work($1)",
      [workerInstanceId]);
    return row === null ? null : { ...baseWork(row, "reconciliation"),
      requestedGeneration: positive(row, "requested_generation"), provider: provider(row, "provider"),
      providerResourceKind: string(row, "provider_resource_kind"),
      providerResourceId: string(row, "provider_resource_id"),
      purchaseKind: purchaseKind(row, "purchase_kind"),
      expectedBindingDigest: bytes(row, "expected_binding_digest"),
      expectedSlotEpoch: positive(row, "expected_slot_epoch"),
      expectedAgreementRevision: positive(row, "expected_agreement_revision"),
      expectedAuthorityRevision: nonNegative(row, "expected_authority_revision"),
      receiptEventType: nullableString(row, "receipt_event_type"),
      receiptProviderEventId: nullableString(row, "receipt_provider_event_id"),
      receiptTriggerResourceKind: nullableString(row, "receipt_trigger_resource_kind"),
      receiptTriggerResourceId: nullableString(row, "receipt_trigger_resource_id") };
  }

  async leaseDueAuthorityWork(query: DatabaseQuery,
    workerInstanceId: string): Promise<BoundDueAuthorityWork | null> {
    const row = await maybeOne(query, "SELECT * FROM licensing_worker_api.lease_due_authority_work($1)", [workerInstanceId]);
    return row === null ? null : { ...baseWork(row, "due_authority"),
      expectedSlotEpoch: positive(row, "expected_slot_epoch"),
      expectedAgreementRevision: positive(row, "expected_agreement_revision"),
      expectedAuthorityRevision: positive(row, "expected_authority_revision"),
      expectedRightId: string(row, "expected_right_id") };
  }

  async leaseReleaseWork(query: DatabaseQuery, workerInstanceId: string): Promise<BoundReleaseWork | null> {
    const row = await maybeOne(query, "SELECT * FROM licensing_worker_api.lease_release_work($1)", [workerInstanceId]);
    return row === null ? null : baseWork(row, "release");
  }

  async heartbeatBoundWork(query: DatabaseQuery, work: BoundCommercialWork): Promise<string> {
    const row = await one(query, "SELECT licensing_worker_api.heartbeat_bound_work($1,$2,$3) AS lease_expires_at",
      [work.workId, work.leaseEpoch, Buffer.from(work.rawToken)]);
    return timestamp(row, "lease_expires_at");
  }

  async failBoundWork(query: DatabaseQuery, work: BoundCommercialWork,
    failureClass: CommercialFailureClass, retryAfterSeconds?: number): Promise<CommercialJobState> {
    const row = await one(query, "SELECT licensing_worker_api.fail_bound_work($1,$2,$3,$4,$5) AS state",
      [work.workId, work.leaseEpoch, Buffer.from(work.rawToken), failureClass, retryAfterSeconds ?? null]);
    return jobState(row, "state");
  }

  async applyAgreementObservationAndAuthority(query: DatabaseQuery, work: BoundReconciliationWork,
    command: ApplyAgreementObservationCommand): Promise<ApplyAgreementObservationResult> {
    const o = command.observation, payment = command.paymentEvidence;
    const row = await one(query,
      "SELECT * FROM licensing_worker_api.apply_agreement_observation_and_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)",
      [work.workId, work.requestedGeneration, work.leaseEpoch, Buffer.from(work.rawToken),
        digest(work.expectedBindingDigest), work.expectedSlotEpoch, work.expectedAgreementRevision,
        work.expectedAuthorityRevision, o.providerAccess, o.renewalDisposition, o.observedPaidThrough, o.observedAt,
        o.plan, [...o.featureEntitlements], o.reversal, digest(command.observationDigest), payment?.purpose ?? null,
        payment?.resourceKind ?? null, payment?.resourceId ?? null,
        payment === null ? null : digest(payment.bindingDigest), payment?.settledAt ?? null,
        payment?.grossMinor ?? null, payment?.currency ?? null, payment?.cumulativeRefundedMinor ?? null,
        payment === null ? null : digest(payment.sourceDigest), command.refundFact]);
    return applyResult(row);
  }

  async applyDueAuthority(query: DatabaseQuery,
    work: BoundDueAuthorityWork): Promise<ApplyAgreementObservationResult> {
    return applyResult(await one(query, "SELECT * FROM licensing_worker_api.apply_due_authority($1,$2,$3,$4,$5,$6,$7)",
      [work.workId, work.leaseEpoch, Buffer.from(work.rawToken), work.expectedSlotEpoch,
        work.expectedAgreementRevision, work.expectedAuthorityRevision, work.expectedRightId]));
  }

  async releaseProviderSlot(query: DatabaseQuery,
    work: BoundReleaseWork): Promise<{ readonly released: boolean; readonly slotEpoch: number }> {
    const row = await one(query, "SELECT * FROM licensing_worker_api.release_provider_slot($1,$2,$3)",
      [work.workId, work.leaseEpoch, Buffer.from(work.rawToken)]);
    return { released: boolean(row, "released"), slotEpoch: positive(row, "slot_epoch") };
  }
}

function operationPlan(row: Row, requestDigest: Uint8Array): CommercialOperationPlan {
  return { purchaseAttemptId: string(row, "purchase_attempt_id"), slotOwnershipId: string(row, "slot_ownership_id"),
    slotEpoch: positive(row, "slot_epoch"), provider: provider(row, "provider"),
    providerOperationId: string(row, "provider_operation_id"), operationRevision: positive(row, "operation_revision"),
    operationKind: operationKind(row, "operation_kind"), providerIdempotencyKey: string(row, "provider_idempotency_key"),
    requestDigest, replay: replay(row, "replay"), work: operationWork(row) };
}

function operationWork(row: Row): BoundProviderOperationWork {
  return { ...baseWork(row, "provider_operation"), purchaseAttemptId: string(row, "purchase_attempt_id"),
    purchaseKind: purchaseKind(row, "purchase_kind"), offer: offer(row, "offer"),
    providerCatalogItem: string(row, "provider_catalog_item"), campaignCode: nullableString(row, "campaign_code"),
    ...(value(row, "expected_gross_minor") === undefined ? {} : {
      expectedGrossMinor: positive(row, "expected_gross_minor"), expectedCurrency: currency(row, "expected_currency"),
    }),
    provider: provider(row, "provider"),
    providerOperationId: string(row, "provider_operation_id"), operationRevision: positive(row, "operation_revision"),
    operationKind: operationKind(row, "operation_kind"), providerIdempotencyKey: string(row, "provider_idempotency_key"),
    requestDigest: bytes(row, "request_digest"), providerResourceKind: nullableString(row, "provider_resource_kind"),
    providerResourceId: nullableString(row, "provider_resource_id") };
}
function baseWork<K extends BoundCommercialWork["kind"]>(row: Row, kind: K): BoundCommercialWork & { readonly kind: K } {
  return { workId: string(row, "work_id"), kind, leaseEpoch: positive(row, "lease_epoch"),
    leaseExpiresAt: timestamp(row, "lease_expires_at"), rawToken: bytes(row, "raw_token") };
}
function dispatchPermit(row: Row): ProviderDispatchPermit { return {
  dispatchPermitId: string(row, "dispatch_permit_id"), providerOperationId: string(row, "provider_operation_id"),
  operationRevision: positive(row, "operation_revision"), operationKind: operationKind(row, "operation_kind"),
  dispatchAttempt: positive(row, "dispatch_attempt"), expiresAt: timestamp(row, "expires_at") } }
function operationReplay(row: Row): ProviderOperationReplay { return {
  state: operationState(row, "state"), responseDigest: nullableBytes(row, "response_digest"),
  resources: resourceFacts(row), disposition: disposition(row, "disposition") } }
function resourceArrays(resources: readonly ProviderResourceFact[]) { return {
  kinds: resources.map((x) => x.resourceKind), ids: resources.map((x) => x.resourceId),
  digests: resources.map((x) => digest(x.bindingDigest)), roles: resources.map((x) => x.role) } }
function handoffArrays(command: HandoffProviderAgreementCommand) {
  const h = command.handoff; const facts = h.kind === "stripe_subscription" ? [h.checkoutSession, h.subscription]
    : h.kind === "paypal_subscription" ? [h.subscription]
      : h.kind === "stripe_fixed_term" ? [h.checkoutSession] : [h.order, h.capture];
  return resourceArrays(facts);
}
function handoffCapturedAt(command: HandoffProviderAgreementCommand): string | null {
  return command.handoff.kind === "stripe_fixed_term" || command.handoff.kind === "paypal_fixed_term"
    ? command.handoff.capturedAt : null;
}
function resourceFacts(row: Row): readonly ProviderResourceFact[] {
  const rawKinds = value(row, "resource_kinds"), rawIds = value(row, "resource_ids"),
    rawDigests = value(row, "resource_digests"), rawRoles = value(row, "resource_roles");
  if (rawKinds === null && rawIds === null && rawDigests === null && rawRoles === null) return [];
  const kinds = stringArray(row, "resource_kinds"), ids = stringArray(row, "resource_ids"),
    digests = bytesArray(row, "resource_digests"), roles = stringArray(row, "resource_roles");
  if (kinds.length !== ids.length || ids.length !== digests.length || digests.length !== roles.length)
    throw new TypeError("commercial resource fact row is inconsistent");
  return kinds.map((resourceKind, i) => ({ resourceKind, resourceId: ids[i]!, bindingDigest: digests[i]!,
    role: resourceRole(roles[i]!) }));
}
function applyResult(row: Row): ApplyAgreementObservationResult { return {
  disposition: applyDisposition(row, "disposition"), authorityRevision: nullablePositive(row, "authority_revision"),
  rightId: nullableString(row, "right_id") } }

async function one(query: Queryable, sql: string, values: readonly unknown[]): Promise<Row> {
  const rows = (await query.query<Row>(sql, values)).rows;
  if (rows.length !== 1) throw new TypeError("commercial façade returned an invalid row count");
  return rows[0]!;
}
async function maybeOne(query: Queryable, sql: string, values: readonly unknown[]): Promise<Row | null> {
  const rows = (await query.query<Row>(sql, values)).rows;
  if (rows.length > 1) throw new TypeError("commercial façade returned multiple rows");
  return rows[0] ?? null;
}
function digest(value: Uint8Array): Buffer { return Buffer.from(value); }
function value(row: Row, key: string): unknown { return row[key]; }
function string(row: Row, key: string): string { const v = value(row, key); if (typeof v !== "string" || v.length === 0) throw new TypeError(`invalid ${key}`); return v; }
function nullableString(row: Row, key: string): string | null { const v = value(row, key); return v === null ? null : string(row, key); }
function positive(row: Row, key: string): number { const n = Number(value(row, key)); if (!Number.isSafeInteger(n) || n < 1) throw new TypeError(`invalid ${key}`); return n; }
function nonNegative(row: Row, key: string): number { const n = Number(value(row, key)); if (!Number.isSafeInteger(n) || n < 0) throw new TypeError(`invalid ${key}`); return n; }
function nullablePositive(row: Row, key: string): number | null { return value(row, key) === null ? null : positive(row, key); }
function boolean(row: Row, key: string): boolean { const v = value(row, key); if (typeof v !== "boolean") throw new TypeError(`invalid ${key}`); return v; }
function timestamp(row: Row, key: string): string {
  const v = value(row, key);
  const d = v instanceof Date ? v : new Date(string(row, key));
  if (Number.isNaN(d.valueOf())) throw new TypeError(`invalid ${key}`);
  // Public protocol timestamps are intentionally second-precision. Truncation keeps a published
  // deadline conservative when PostgreSQL transaction timestamps contain fractional seconds.
  return d.toISOString().replace(/\.\d{3}Z$/u, "Z");
}
function nullableTimestamp(row: Row, key: string): string | null { return value(row, key) === null ? null : timestamp(row, key); }
function bytes(row: Row, key: string): Uint8Array { const v = value(row, key); if (!(v instanceof Uint8Array)) throw new TypeError(`invalid ${key}`); return v; }
function nullableBytes(row: Row, key: string): Uint8Array | null { return value(row, key) === null ? null : bytes(row, key); }
function stringArray(row: Row, key: string): string[] { const v = value(row, key); if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) throw new TypeError(`invalid ${key}`); return v; }
function bytesArray(row: Row, key: string): Uint8Array[] { const v = value(row, key); if (!Array.isArray(v) || v.some((x) => !(x instanceof Uint8Array))) throw new TypeError(`invalid ${key}`); return v; }
function member<T extends string>(row: Row, key: string, allowed: readonly T[]): T { const v = string(row, key); if (!allowed.includes(v as T)) throw new TypeError(`invalid ${key}`); return v as T; }
const provider = (r: Row, k: string) => member(r, k, ["stripe", "paypal"] as const);
const currency = (r: Row, k: string) => member(r, k, ["USD"] as const);
const offer = (r: Row, k: string) => member(r, k, ["monthly", "annual", "ten_year"] as const);
const purchaseKind = (r: Row, k: string) => member(r, k, ["subscription", "fixed_term"] as const);
const replay = (r: Row, k: string) => member(r, k, ["created", "same_request", "same_handoff"] as const) as "created" | "same_request";
const handoffReplay = (r: Row, k: string) => member(r, k, ["created", "same_handoff"] as const);
const disposition = (r: Row, k: string) => member(r, k, ["current", "stale", "quarantined"] as const);
const operationKind = (r: Row, k: string) => member(r, k, ["subscription_create", "fixed_term_checkout_create", "fixed_term_order_create", "fixed_term_order_capture", "subscription_cancel", "subscription_refund_terminate", "first_purchase_refund"] as const);
const operationState = (r: Row, k: string) => member(r, k, ["planned", "permit_issued", "dispatch_consumed", "confirmed", "rejected", "outcome_unknown", "manual_resolution"] as const);
const billingState = (r: Row, k: string) => member(r, k, ["creating", "creation_unknown", "approval_pending", "active", "grace", "cancellation_pending", "cancellation_unknown", "cancel_at_period_end", "commercial_read_only", "failed", "refunded"] as const);
const refundState = (r: Row, k: string) => member(r, k, ["termination_pending", "termination_unknown", "refund_pending", "refund_unknown", "refunded", "retry_wait", "manual_resolution"] as const);
const receiptDisposition = (r: Row, k: string) => member(r, k, ["scheduled", "ignored", "duplicate", "conflict", "quarantined"] as const);
const jobState = (r: Row, k: string) => member(r, k, ["ready", "leased", "retry_wait", "succeeded", "ignored", "quarantined", "dead_letter"] as const);
const jobKind = (r: Row, k: string) => member(r, k, ["provider_operation", "receipt", "reconciliation", "due_authority", "release"] as const);
const applyDisposition = (r: Row, k: string) => member(r, k, ["applied", "stale_generation", "stale_binding", "stale_slot", "stale_agreement", "stale_authority", "conflict"] as const);
function resourceRole(value: string): ProviderResourceFact["role"] { const allowed = ["created", "target", "canonical_agreement", "checkout_origin", "order_origin", "capture_evidence"] as const; if (!allowed.includes(value as typeof allowed[number])) throw new TypeError("invalid resource role"); return value as typeof allowed[number]; }
