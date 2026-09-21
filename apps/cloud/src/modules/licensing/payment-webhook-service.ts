import { createHash } from "node:crypto";
import type { DatabaseQuery } from "../../db/index";
import type {
  BoundProviderOperationWork, BoundReceiptWork, BoundReconciliationWork, CommercialAggregateRepositoryPort, CommercialProvider,
  HandoffProviderAgreementCommand, LinkReceiptResourcesCommand, NormalizedAgreementObservation,
  NormalizedPaymentEvidence, NormalizedRefundFact, ProviderResourceFact,
} from "./commercial-domain";

interface AuthenticatedEventBase { readonly provider: CommercialProvider; readonly providerEventId: string;
  readonly eventType: string; readonly occurredAt: string; readonly authenticatedEvidenceRef: string; }
export type AuthenticatedProviderEvent =
  | AuthenticatedEventBase & { readonly kind: "actionable"; readonly triggerResourceKind: string; readonly triggerResourceId: string }
  | AuthenticatedEventBase & { readonly kind: "ignored"; readonly ignoredReason: "unsupported_event" | "unrelated_object" | "test_event" };

export interface PaymentWebhookAuthenticator { authenticate(rawBody: Buffer,
  headers: Readonly<Record<string, string | string[] | undefined>>, evaluatedAt: Date): Promise<AuthenticatedProviderEvent>; }
export interface PaymentWebhookApplicationPort { process(provider: CommercialProvider, rawBody: Buffer,
  headers: Readonly<Record<string, string | string[] | undefined>>, evaluatedAt: Date): Promise<void>; }

export interface ReconciledCommercialObservation extends NormalizedAgreementObservation {
  readonly provider: CommercialProvider; readonly providerResourceKind: string; readonly providerResourceId: string;
  readonly paymentEvidence: NormalizedPaymentEvidence | null;
  readonly refundFact: NormalizedRefundFact;
}
export interface CommercialProviderReader { readonly provider: CommercialProvider;
  read(input: { readonly providerResourceKind: string; readonly providerResourceId: string;
    readonly purchaseKind: "subscription" | "fixed_term"; readonly evaluatedAt: Date;
    readonly receiptEventType: string | null; readonly receiptProviderEventId: string | null;
    readonly receiptTriggerResourceKind: string | null; readonly receiptTriggerResourceId: string | null;
  }): Promise<ReconciledCommercialObservation>;
  handoffForReceipt?(work: BoundReceiptWork, evaluatedAt: Date): Promise<HandoffProviderAgreementCommand | null>;
  resolveReceiptResourceBinding?(work: BoundReceiptWork, evaluatedAt: Date): Promise<LinkReceiptResourcesCommand | null>;
  handoffForOperation?(work: BoundProviderOperationWork, resources: readonly ProviderResourceFact[],
    evaluatedAt: Date): Promise<HandoffProviderAgreementCommand | null>;
}

export class PaymentWebhookAuthenticationError extends Error { constructor() { super("payment webhook authentication failed"); this.name = "PaymentWebhookAuthenticationError"; } }
export class PaymentWebhookConflictError extends Error { constructor() { super("payment webhook identity conflicts"); this.name = "PaymentWebhookConflictError"; } }
class ProviderWorkIdentityConflictError extends Error {}

/** Authenticates exact bytes and commits actionable and ignored receipts before returning. */
export class PaymentWebhookApplicationService implements PaymentWebhookApplicationPort {
  readonly #authenticators: ReadonlyMap<CommercialProvider, PaymentWebhookAuthenticator>;
  constructor(private readonly query: DatabaseQuery,
    private readonly repository: Pick<CommercialAggregateRepositoryPort, "receiveAuthenticatedReceipt">,
    stripe: PaymentWebhookAuthenticator, paypal: PaymentWebhookAuthenticator) {
    this.#authenticators = new Map([["stripe", stripe], ["paypal", paypal]]);
  }
  async process(provider: CommercialProvider, rawBody: Buffer,
    headers: Readonly<Record<string, string | string[] | undefined>>, evaluatedAt: Date): Promise<void> {
    const authenticator = this.#authenticators.get(provider); if (authenticator === undefined) throw new PaymentWebhookAuthenticationError();
    const event = await authenticator.authenticate(rawBody, headers, evaluatedAt);
    if (event.provider !== provider) throw new PaymentWebhookAuthenticationError();
    const base = { provider, providerEventId: event.providerEventId, payloadDigest: createHash("sha256").update(rawBody).digest(),
      eventType: event.eventType, occurredAt: event.occurredAt, authenticatedEvidenceRef: event.authenticatedEvidenceRef };
    const receipt = event.kind === "actionable"
      ? { ...base, kind: "actionable" as const, triggerResourceKind: event.triggerResourceKind,
          triggerResourceId: event.triggerResourceId, ignoredReason: null }
      : { ...base, kind: "ignored" as const, triggerResourceKind: null, triggerResourceId: null,
          ignoredReason: event.ignoredReason };
    if (await this.repository.receiveAuthenticatedReceipt(this.query, receipt) === "conflict") throw new PaymentWebhookConflictError();
  }
}

export type ProviderInboxWorkResult = { readonly status: "idle" } | { readonly status: "scheduled"; readonly provider: CommercialProvider }
  | { readonly status: "retry_scheduled" | "quarantined" | "dead_letter"; readonly provider: CommercialProvider };
export type ProviderReconciliationWorkResult = { readonly status: "idle" } | { readonly status: "applied"; readonly provider: CommercialProvider }
  | { readonly status: "retry_scheduled" | "quarantined" | "dead_letter"; readonly provider: CommercialProvider };

export class PaymentWebhookReconciliationService {
  static readonly #heartbeatIntervalMilliseconds = 10_000;
  readonly #readers: ReadonlyMap<CommercialProvider, CommercialProviderReader>;
  constructor(private readonly query: DatabaseQuery, private readonly repository: CommercialAggregateRepositoryPort,
    readers: readonly CommercialProviderReader[], private readonly now: () => Date) {
    this.#readers = new Map(readers.map((reader) => [reader.provider, reader]));
    if (this.#readers.size !== 2) throw new TypeError("both commercial provider readers are required");
  }
  async processNextInbox(workerId: string): Promise<ProviderInboxWorkResult> {
    const work = await this.repository.leaseReceiptWork(this.query, workerId); if (work === null) return { status: "idle" };
    try {
      await this.repository.heartbeatBoundWork(this.query, work);
      const reader = this.reader(work.provider);
      const evaluatedAt = this.validNow();
      const supplemental = await this.withLeaseHeartbeat(work,
        async () => await reader.resolveReceiptResourceBinding?.(work, evaluatedAt) ?? null);
      if (supplemental !== null) {
        try {
          await this.repository.linkReceiptResourcesToAgreement(this.query, work, supplemental);
        } catch (error) {
          if (!isSupplementalAnchorRace(error)) throw error;
          const handoff = await this.withLeaseHeartbeat(work,
            async () => await reader.handoffForReceipt?.(work, evaluatedAt) ?? null);
          if (handoff === null) throw error;
          await this.repository.handoffProviderAgreement(this.query, work, handoff);
          return { status: "scheduled", provider: work.provider };
        }
      } else {
        const handoff = await this.withLeaseHeartbeat(work,
          async () => await reader.handoffForReceipt?.(work, evaluatedAt) ?? null);
        if (handoff !== null) {
          await this.repository.handoffProviderAgreement(this.query, work, handoff);
          return { status: "scheduled", provider: work.provider };
        }
      }
      const result = await this.repository.bindReceiptWork(this.query, work);
      if (result.disposition === "handoff_required") {
        // A canonical-resource event may race the origin Checkout/Order handoff. Retrying lets the
        // immutable origin binding arrive; it must not be permanently quarantined as unsupported.
        throw new Error("provider receipt handoff is not ready");
      }
      return { status: "scheduled", provider: work.provider };
    } catch (error) { return this.failed(work, error); }
  }
  async processNextReconciliation(workerId: string): Promise<ProviderReconciliationWorkResult> {
    const work = await this.repository.leaseReconciliationWork(this.query, workerId); if (work === null) return { status: "idle" };
    try {
      await this.repository.heartbeatBoundWork(this.query, work);
      const observation = await this.reader(work.provider).read({ providerResourceKind: work.providerResourceKind,
        providerResourceId: work.providerResourceId, purchaseKind: work.purchaseKind, evaluatedAt: this.validNow(),
        receiptEventType: work.receiptEventType, receiptProviderEventId: work.receiptProviderEventId,
        receiptTriggerResourceKind: work.receiptTriggerResourceKind,
        receiptTriggerResourceId: work.receiptTriggerResourceId });
      assertObservationMatchesWork(observation, work);
      await this.repository.heartbeatBoundWork(this.query, work);
      const result = await this.repository.applyAgreementObservationAndAuthority(this.query, work, {
        observation, observationDigest: observationDigest(work, observation),
        paymentEvidence: observation.paymentEvidence, refundFact: observation.refundFact });
      if (result.disposition === "conflict") throw new ProviderWorkIdentityConflictError("provider observation conflicts");
      return { status: "applied", provider: work.provider };
    } catch (error) { return this.failed(work, error); }
  }
  async processNextDueAuthority(workerId: string): Promise<{ readonly status: "idle" | "applied" | "retry_scheduled" | "dead_letter" }> {
    const work = await this.repository.leaseDueAuthorityWork(this.query, workerId); if (work === null) return { status: "idle" };
    try { await this.repository.heartbeatBoundWork(this.query, work); await this.repository.applyDueAuthority(this.query, work);
      return { status: "applied" }; }
    catch { const state = await this.repository.failBoundWork(this.query, work, "transient_network");
      return { status: state === "dead_letter" ? "dead_letter" : "retry_scheduled" }; }
  }
  async processNextRelease(workerId: string): Promise<{ readonly status: "idle" | "released" | "retained" | "retry_scheduled" | "dead_letter" }> {
    const work = await this.repository.leaseReleaseWork(this.query, workerId); if (work === null) return { status: "idle" };
    try { await this.repository.heartbeatBoundWork(this.query, work); const result = await this.repository.releaseProviderSlot(this.query, work);
      return { status: result.released ? "released" : "retained" }; }
    catch { const state = await this.repository.failBoundWork(this.query, work, "transient_network");
      return { status: state === "dead_letter" ? "dead_letter" : "retry_scheduled" }; }
  }
  private reader(provider: CommercialProvider): CommercialProviderReader { const value = this.#readers.get(provider);
    if (value === undefined) throw new TypeError("commercial provider reader is unavailable"); return value; }
  private validNow(): Date { const value = this.now(); if (!Number.isFinite(value.getTime())) throw new TypeError("provider time is invalid"); return value; }
  private async withLeaseHeartbeat<T>(work: BoundReceiptWork, operation: () => Promise<T>): Promise<T> {
    let heartbeat: Promise<void> | null = null;
    let heartbeatFailed = false;
    let heartbeatFailure: unknown;
    const timer = setInterval(() => {
      if (heartbeat !== null || heartbeatFailed) return;
      heartbeat = this.repository.heartbeatBoundWork(this.query, work)
        .then(() => undefined, (error: unknown) => { heartbeatFailed = true; heartbeatFailure = error; })
        .finally(() => { heartbeat = null; });
    }, PaymentWebhookReconciliationService.#heartbeatIntervalMilliseconds);
    timer.unref();
    let result: T | undefined;
    let operationFailure: { readonly error: unknown } | null = null;
    try {
      result = await operation();
    } catch (error) {
      operationFailure = { error };
    } finally {
      clearInterval(timer);
      if (heartbeat !== null) await heartbeat;
    }
    if (heartbeatFailed) throw heartbeatFailure;
    if (operationFailure !== null) throw operationFailure.error;
    await this.repository.heartbeatBoundWork(this.query, work);
    return result as T;
  }
  private async failed(work: BoundReceiptWork | BoundReconciliationWork, error: unknown): Promise<{
    readonly status: "retry_scheduled" | "quarantined" | "dead_letter"; readonly provider: CommercialProvider }> {
    const failureClass = error instanceof ProviderWorkIdentityConflictError ? "identity_conflict"
      : "transient_network";
    const state = await this.repository.failBoundWork(this.query, work, failureClass);
    return { status: state === "dead_letter" ? "dead_letter" : state === "quarantined" ? "quarantined" : "retry_scheduled",
      provider: work.provider };
  }
}

function isSupplementalAnchorRace(error: unknown): boolean {
  if (error === null || typeof error !== "object" || !("code" in error) || (error as { code?: unknown }).code !== "40001") {
    return false;
  }
  const message = "message" in error ? (error as { message?: unknown }).message : null;
  return message === "supplemental binding anchor is unavailable"
    || message === "supplemental binding agreement is unavailable";
}

function observationDigest(work: BoundReconciliationWork, observation: NormalizedAgreementObservation): Uint8Array {
  return createHash("sha256").update(JSON.stringify({ workId: work.workId, generation: work.requestedGeneration, observation })).digest();
}
function assertObservationMatchesWork(observation: ReconciledCommercialObservation, work: BoundReconciliationWork): void {
  if (observation.provider !== work.provider || observation.providerResourceKind !== work.providerResourceKind
    || observation.providerResourceId !== work.providerResourceId) throw new ProviderWorkIdentityConflictError("provider reconciliation identity conflicts");
}
