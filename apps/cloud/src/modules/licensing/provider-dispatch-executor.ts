import { createHash } from "node:crypto";

import type { DatabaseQuery } from "../../db/index";
import type {
  BoundProviderOperationWork,
  CommercialProvider,
  CommercialWorkerRepositoryPort,
  ConsumedProviderDispatch,
  ProviderOperationReplay,
  ProviderResourceFact,
  RecordProviderOperationResultCommand,
} from "./commercial-domain";
import type { ResolvedCommercialCheckout } from "./commercial-checkout";
import { CommercialCheckoutCatalog } from "./commercial-checkout";
import { commercialCheckoutRequestDigest } from "./commercial-checkout-identity";
import type { CommercialProviderReader } from "./payment-webhook-service";
import { providerResourceBindingDigest } from "./provider-resource-identity";

export interface ProviderMutationResult {
  readonly resources: readonly Omit<ProviderResourceFact, "bindingDigest">[];
  readonly responseEvidence: unknown;
}

declare const providerSdkAuthorizationBrand: unique symbol;
export interface ProviderSdkAuthorization extends ConsumedProviderDispatch {
  readonly [providerSdkAuthorizationBrand]: true;
}
const liveSdkAuthorizations = new WeakSet<object>();

/** Gateways use this runtime check; structural similarity is deliberately insufficient. */
export function consumeProviderSdkAuthorization(value: unknown): asserts value is ProviderSdkAuthorization {
  if (value === null || typeof value !== "object" || !liveSdkAuthorizations.has(value)) {
    throw new TypeError("provider SDK authorization is not in executor custody");
  }
  liveSdkAuthorizations.delete(value);
}

/** Provider mutation adapters are held only by ProviderDispatchExecutor in production composition. */
export interface CommercialProviderMutationGateway {
  readonly provider: CommercialProvider;
  create(input: {
    readonly authorization: ProviderSdkAuthorization;
    readonly purchaseAttemptId: string;
    readonly definition: ResolvedCommercialCheckout;
  }): Promise<ProviderMutationResult>;
  cancelSubscription(input: {
    readonly authorization: ProviderSdkAuthorization;
    readonly providerAgreementResourceId: string;
  }): Promise<ProviderMutationResult>;
  captureFixedTerm(input: {
    readonly authorization: ProviderSdkAuthorization;
    readonly providerOrderResourceId: string;
    readonly expectedPurchase: {
      readonly purchaseAttemptId: string;
      readonly purchaseKind: "subscription" | "fixed_term";
      readonly offer: "monthly" | "annual" | "ten_year";
      readonly providerItemId: string;
      readonly amountMinor: number;
      readonly currency: "USD";
    };
  }): Promise<ProviderMutationResult>;
  terminateSubscriptionForRefund?(input: {
    readonly authorization: ProviderSdkAuthorization;
    readonly providerAgreementResourceId: string;
  }): Promise<ProviderMutationResult>;
  refundFirstPurchase?(input: {
    readonly authorization: ProviderSdkAuthorization;
    readonly providerPaymentResourceKind: string;
    readonly providerPaymentResourceId: string;
    readonly providerOperationId: string;
  }): Promise<ProviderMutationResult>;
  recover(input: {
    readonly operationKind: BoundProviderOperationWork["operationKind"];
    readonly providerOperationId: string;
    readonly resources: readonly ProviderResourceFact[];
    readonly evaluatedAt: Date;
    readonly creation?: {
      readonly purchaseAttemptId: string;
      readonly definition: ResolvedCommercialCheckout;
    };
    readonly expectedPurchase?: {
      readonly purchaseAttemptId: string;
      readonly purchaseKind: "subscription" | "fixed_term";
      readonly offer: "monthly" | "annual" | "ten_year";
      readonly providerItemId: string;
      readonly amountMinor: number;
      readonly currency: "USD";
    };
  }): Promise<ProviderMutationResult | null>;
  readApprovalUrl(input: {
    readonly providerResourceKind: string;
    readonly providerResourceId: string;
    /** Immutable attempt context is required when a provider resource can carry mutable order fields. */
    readonly expectedPurchase?: {
      readonly purchaseAttemptId: string;
      readonly purchaseKind: "subscription" | "fixed_term";
      readonly offer: "monthly" | "annual" | "ten_year";
      readonly providerItemId: string;
      readonly amountMinor: number;
      readonly currency: "USD";
    };
  }): Promise<string>;
  /** Test-fixture compatibility only; production dispatch never calls these legacy methods. */
  reconcileCheckout?(input: unknown): Promise<unknown>;
  prepareSubscriptionCancellation?(input: unknown): Promise<unknown>;
  confirmFixedTerm?(input: unknown): Promise<unknown>;
}
/** Compatibility name for composition sites; the gateway remains executor-only custody. */
export type CommercialCheckoutGateway = CommercialProviderMutationGateway;

export type ProviderDispatchExecution =
  | { readonly outcome: "confirmed"; readonly replay: ProviderOperationReplay }
  | { readonly outcome: "rejected"; readonly replay: ProviderOperationReplay }
  | { readonly outcome: "outcome_unknown"; readonly replay: ProviderOperationReplay }
  | { readonly outcome: "manual_resolution"; readonly replay: ProviderOperationReplay };

export class ProviderDispatchRejectedError extends Error {}
export class ProviderDispatchOutcomeUnknownError extends Error {}
/** Durable Provider checkout facts conflict with the authorized commercial request. */
export class ProviderDispatchManualResolutionError extends Error {
  constructor() { super("provider response requires manual_resolution"); }
}
class ProviderOperationWorkContractError extends Error {}

/**
 * Sole runtime custody for mutating Provider SDK calls. A TypeScript value never authorizes a
 * mutation: the database permit is atomically consumed and committed immediately before the SDK
 * call. Confirmed and rejected operations replay stored truth; unknown operations are read first.
 */
export class ProviderDispatchExecutor {
  readonly #gateways: ReadonlyMap<CommercialProvider, CommercialProviderMutationGateway>;

  constructor(
    private readonly query: DatabaseQuery,
    private readonly repository: Pick<CommercialWorkerRepositoryPort,
      "issueDispatchPermit" | "consumeDispatchPermit" | "recordOperationResult" | "readOperationReplay">,
    gateways: readonly CommercialProviderMutationGateway[],
    private readonly now: () => Date = () => new Date(),
  ) {
    this.#gateways = new Map(gateways.map((gateway) => [gateway.provider, gateway]));
    if (this.#gateways.size !== 2) throw new TypeError("both commercial provider mutation gateways are required");
  }

  async create(
    work: BoundProviderOperationWork,
    purchaseAttemptId: string,
    definition: ResolvedCommercialCheckout,
  ): Promise<ProviderDispatchExecution> {
    if (work.provider !== definition.provider || !["subscription_create", "fixed_term_checkout_create",
      "fixed_term_order_create"].includes(work.operationKind)) {
      throw new TypeError("provider creation work is invalid");
    }
    return this.execute(work, (gateway, authorization) => gateway.create({
      authorization,
      purchaseAttemptId,
      definition,
    }), false, { purchaseAttemptId, definition });
  }

  async cancelSubscription(
    work: BoundProviderOperationWork,
    providerAgreementResourceId: string,
  ): Promise<ProviderDispatchExecution> {
    if (work.operationKind !== "subscription_cancel") throw new TypeError("provider cancellation work is invalid");
    return this.execute(work, (gateway, authorization) => gateway.cancelSubscription({
      authorization,
      providerAgreementResourceId,
    }));
  }

  async captureFixedTerm(
    work: BoundProviderOperationWork,
    providerOrderResourceId: string,
  ): Promise<ProviderDispatchExecution> {
    if (work.provider !== "paypal" || work.operationKind !== "fixed_term_order_capture") {
      throw new TypeError("provider capture work is invalid");
    }
    if (!Number.isSafeInteger(work.expectedGrossMinor) || work.expectedGrossMinor === undefined
      || work.expectedGrossMinor < 1 || work.expectedCurrency !== "USD") {
      throw new ProviderOperationWorkContractError("provider capture work has no immutable purchase expectation");
    }
    const expectedPurchase = { purchaseAttemptId: work.purchaseAttemptId,
      purchaseKind: work.purchaseKind, offer: work.offer, providerItemId: work.providerCatalogItem,
      amountMinor: work.expectedGrossMinor, currency: work.expectedCurrency } as const;
    return this.execute(work, (gateway, authorization) => gateway.captureFixedTerm({
      authorization,
      providerOrderResourceId,
      expectedPurchase,
    }), false, undefined, expectedPurchase);
  }

  async readApprovalUrl(
    provider: CommercialProvider,
    providerResourceKind: string,
    providerResourceId: string,
    expectedPurchase?: { readonly purchaseAttemptId: string; readonly purchaseKind: "subscription" | "fixed_term";
      readonly offer: "monthly" | "annual" | "ten_year"; readonly providerItemId: string;
      readonly amountMinor: number; readonly currency: "USD" },
  ): Promise<string> {
    return this.gateway(provider).readApprovalUrl({ providerResourceKind, providerResourceId,
      ...(expectedPurchase === undefined ? {} : { expectedPurchase }) });
  }

  /** Dispatches only the operation and exact target carried by a DB-leased work capability. */
  async resume(work: BoundProviderOperationWork, catalog: CommercialCheckoutCatalog): Promise<ProviderDispatchExecution> {
    if (["subscription_create", "fixed_term_checkout_create", "fixed_term_order_create"].includes(work.operationKind)) {
      const definition = catalog.resolve(work.provider, work.offer, work.campaignCode);
      const expectedKind = definition.purchaseKind === "subscription" ? "subscription_create"
        : definition.provider === "stripe" ? "fixed_term_checkout_create" : "fixed_term_order_create";
      if (definition.providerItemId !== work.providerCatalogItem || definition.purchaseKind !== work.purchaseKind
        || work.operationKind !== expectedKind || work.providerResourceKind !== null || work.providerResourceId !== null
        || !Buffer.from(work.requestDigest).equals(Buffer.from(commercialCheckoutRequestDigest(definition)))) {
        throw new ProviderOperationWorkContractError("provider creation work conflicts with the commercial catalog");
      }
      return this.create(work, work.purchaseAttemptId, definition);
    }
    if (work.operationKind === "subscription_cancel") {
      if (work.purchaseKind !== "subscription" || work.providerResourceKind !== "subscription"
        || work.providerResourceId === null) {
        throw new ProviderOperationWorkContractError("provider cancellation work has no exact Subscription target");
      }
      return this.cancelSubscription(work, work.providerResourceId);
    }
    if (work.operationKind === "fixed_term_order_capture") {
      if (work.provider !== "paypal" || work.purchaseKind !== "fixed_term"
        || work.providerResourceKind !== "order" || work.providerResourceId === null) {
        throw new ProviderOperationWorkContractError("provider capture work has no exact Order target");
      }
      return this.captureFixedTerm(work, work.providerResourceId);
    }
    if (work.operationKind === "subscription_refund_terminate") {
      if (work.purchaseKind !== "subscription" || work.providerResourceKind !== "subscription"
        || work.providerResourceId === null) {
        throw new ProviderOperationWorkContractError("provider refund termination has no exact Subscription target");
      }
      return this.execute(work, (gateway, authorization) => {
        if (gateway.terminateSubscriptionForRefund === undefined) {
          throw new ProviderOperationWorkContractError("provider refund termination gateway is unavailable");
        }
        return gateway.terminateSubscriptionForRefund({ authorization,
          providerAgreementResourceId: work.providerResourceId! });
      }, true);
    }
    if (work.operationKind === "first_purchase_refund") {
      if (work.providerResourceId === null || work.providerResourceKind === null
        || work.provider === "stripe" && !["charge", "payment_intent"].includes(work.providerResourceKind)
        || work.provider === "paypal" && !["capture", "subscription_transaction", "sale"].includes(work.providerResourceKind)) {
        throw new ProviderOperationWorkContractError("provider refund work has no exact initial-payment target");
      }
      const providerPaymentResourceKind = work.providerResourceKind;
      const providerPaymentResourceId = work.providerResourceId;
      return this.execute(work, (gateway, authorization) => {
        if (gateway.refundFirstPurchase === undefined) {
          throw new ProviderOperationWorkContractError("provider refund gateway is unavailable");
        }
        return gateway.refundFirstPurchase({ authorization, providerPaymentResourceKind,
          providerPaymentResourceId, providerOperationId: work.providerOperationId });
      }, true);
    }
    throw new ProviderOperationWorkContractError("provider operation work kind is unsupported");
  }

  private async execute(
    work: BoundProviderOperationWork,
    mutate: (gateway: CommercialProviderMutationGateway,
      authorization: ProviderSdkAuthorization) => Promise<ProviderMutationResult>,
    recoverBeforeWrite = false,
    creation?: { readonly purchaseAttemptId: string; readonly definition: ResolvedCommercialCheckout },
    expectedPurchase?: { readonly purchaseAttemptId: string; readonly purchaseKind: "subscription" | "fixed_term";
      readonly offer: "monthly" | "annual" | "ten_year"; readonly providerItemId: string;
      readonly amountMinor: number; readonly currency: "USD" },
  ): Promise<ProviderDispatchExecution> {
    const existing = await this.repository.readOperationReplay(this.query, work);
    if (["confirmed", "rejected", "manual_resolution"].includes(existing.state)) {
      return execution(existing);
    }
    const gateway = this.gateway(work.provider);
    if (existing.state === "outcome_unknown") {
      const recoveryResources = existing.resources.length > 0 ? existing.resources : recoveryTarget(work);
      let recovered: ProviderMutationResult | null;
      try {
        recovered = await gateway.recover({
          operationKind: work.operationKind,
          providerOperationId: work.providerOperationId,
          resources: recoveryResources,
          evaluatedAt: this.validNow(),
          ...(creation === undefined ? {} : { creation }),
          ...(expectedPurchase === undefined ? {} : { expectedPurchase }),
        });
      } catch (error) {
        if (!(error instanceof ProviderDispatchManualResolutionError)) throw error;
        const permit = await this.repository.issueDispatchPermit(this.query, work, 60);
        await this.repository.consumeDispatchPermit(this.query, work, permit);
        return this.record(work, permit, result("manual_resolution", { outcome: "manual_resolution" }, []));
      }
      if (recovered !== null) {
        const permit = await this.repository.issueDispatchPermit(this.query, work, 60);
        await this.repository.consumeDispatchPermit(this.query, work, permit);
        return this.record(work, permit, confirmed(work.provider, recovered));
      }
      // A negative read cannot distinguish a request that never arrived from eventual Provider
      // visibility. Re-dispatching the same logical operation is safe because its idempotency key
      // survives every fresh permit.
    }
    if (recoverBeforeWrite && existing.state !== "outcome_unknown") {
      const recovered = await gateway.recover({ operationKind: work.operationKind,
        providerOperationId: work.providerOperationId, resources: recoveryTarget(work), evaluatedAt: this.validNow() });
      if (recovered !== null) {
        const permit = await this.repository.issueDispatchPermit(this.query, work, 60);
        await this.repository.consumeDispatchPermit(this.query, work, permit);
        return this.record(work, permit, confirmed(work.provider, recovered));
      }
    }
    const permit = await this.repository.issueDispatchPermit(this.query, work, 60);
    const authorization = sdkAuthorization(await this.repository.consumeDispatchPermit(this.query, work, permit));
    let mutation: ProviderMutationResult;
    try {
      mutation = await mutate(gateway, authorization);
    } catch (error) {
      const outcome = error instanceof ProviderDispatchRejectedError ? "rejected"
        : error instanceof ProviderDispatchManualResolutionError ? "manual_resolution" : "outcome_unknown";
      return this.record(work, permit, result(outcome, { outcome }, []));
    }
    // Once the Provider has returned, this exact confirmed command is the only admissible result.
    // A persistence/ack failure must be recovered from durable replay, never rewritten as unknown.
    return this.record(work, permit, confirmed(work.provider, mutation));
  }

  private async record(
    work: BoundProviderOperationWork,
    permit: Parameters<CommercialWorkerRepositoryPort["recordOperationResult"]>[2],
    command: RecordProviderOperationResultCommand,
  ): Promise<ProviderDispatchExecution> {
    return execution(await this.repository.recordOperationResult(this.query, work, permit, command));
  }

  private gateway(provider: CommercialProvider): CommercialProviderMutationGateway {
    const gateway = this.#gateways.get(provider);
    if (gateway === undefined) throw new TypeError("commercial provider mutation gateway is unavailable");
    return gateway;
  }

  private validNow(): Date {
    const value = this.now();
    if (!Number.isFinite(value.getTime())) throw new TypeError("provider evaluation time is invalid");
    return value;
  }
}

export type ProviderOperationWorkResult =
  | { readonly status: "idle" }
  | { readonly status: "confirmed" | "rejected" | "manual_resolution" | "retry_scheduled"
      | "quarantined" | "dead_letter"; readonly provider: CommercialProvider };

/** Recovers abandoned provider mutations without accepting an account or provider target selector. */
export class ProviderOperationRecoveryService {
  constructor(
    private readonly query: DatabaseQuery,
    private readonly repository: Pick<CommercialWorkerRepositoryPort,
      "leaseProviderOperationWork" | "heartbeatBoundWork" | "failBoundWork" | "handoffProviderAgreement">,
    private readonly catalog: CommercialCheckoutCatalog,
    private readonly dispatch: ProviderDispatchExecutor,
    readers: readonly CommercialProviderReader[],
    private readonly now: () => Date = () => new Date(),
  ) {
    this.readers = new Map(readers.map((reader) => [reader.provider, reader]));
    if (this.readers.size !== 2) throw new TypeError("both commercial provider readers are required");
  }

  private readonly readers: ReadonlyMap<CommercialProvider, CommercialProviderReader>;

  async processNextOperation(workerId: string): Promise<ProviderOperationWorkResult> {
    const work = await this.repository.leaseProviderOperationWork(this.query, workerId);
    if (work === null) return { status: "idle" };
    try {
      await this.repository.heartbeatBoundWork(this.query, work);
      const execution = await this.dispatch.resume(work, this.catalog);
      if (execution.outcome === "confirmed"
        && (work.operationKind === "subscription_create" && work.provider === "paypal"
          || work.operationKind === "fixed_term_order_capture")) {
        const reader = this.readers.get(work.provider);
        const evaluatedAt = this.now();
        if (reader === undefined || !Number.isFinite(evaluatedAt.getTime())) {
          throw new ProviderOperationWorkContractError("provider handoff reader is unavailable");
        }
        const handoff = await reader.handoffForOperation?.(work, execution.replay.resources, evaluatedAt) ?? null;
        if (handoff === null) throw new ProviderOperationWorkContractError("provider operation handoff is unavailable");
        await this.repository.handoffProviderAgreement(this.query, work, handoff);
      }
      return { status: execution.outcome === "outcome_unknown" ? "retry_scheduled" : execution.outcome,
        provider: work.provider };
    } catch (error) {
      const failure = error instanceof ProviderOperationWorkContractError ? "unsupported_state" : "transient_network";
      const state = await this.repository.failBoundWork(this.query, work, failure);
      return { status: state === "dead_letter" ? "dead_letter" : state === "quarantined" ? "quarantined" : "retry_scheduled",
        provider: work.provider };
    }
  }
}

function sdkAuthorization(consumed: ConsumedProviderDispatch): ProviderSdkAuthorization {
  const authorization = Object.freeze({ ...consumed }) as ProviderSdkAuthorization;
  liveSdkAuthorizations.add(authorization);
  return authorization;
}

function confirmed(provider: CommercialProvider, value: ProviderMutationResult): RecordProviderOperationResultCommand {
  return result("confirmed", value.responseEvidence, value.resources.map((resource) => ({
    ...resource,
    bindingDigest: providerResourceBindingDigest(provider, resource.resourceKind, resource.resourceId),
  })));
}

function result(
  outcome: RecordProviderOperationResultCommand["outcome"],
  evidence: unknown,
  resources: readonly ProviderResourceFact[],
): RecordProviderOperationResultCommand {
  return { outcome, responseDigest: digest(evidence), resources };
}

function execution(replay: ProviderOperationReplay): ProviderDispatchExecution {
  const outcome = replay.state === "confirmed" || replay.state === "rejected"
    || replay.state === "outcome_unknown" || replay.state === "manual_resolution"
    ? replay.state
    : "outcome_unknown";
  return { outcome, replay };
}

function digest(value: unknown): Uint8Array {
  return createHash("sha256").update(JSON.stringify(value)).digest();
}

function recoveryTarget(work: BoundProviderOperationWork): readonly ProviderResourceFact[] {
  if (work.providerResourceKind === null || work.providerResourceId === null) return [];
  return [{ resourceKind: work.providerResourceKind, resourceId: work.providerResourceId, role: "target",
    bindingDigest: providerResourceBindingDigest(work.provider, work.providerResourceKind, work.providerResourceId) }];
}
