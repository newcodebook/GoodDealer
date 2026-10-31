import { BillingClient } from "@gooddealer/cloud-client";
import {
  BILLING_SCHEMA_VERSION,
  type BillingFirstPurchaseRefundAcceptedResponse,
  type BillingStatusReadResponse,
  type BillingSubscriptionCancelRequest,
  type CommercialOffer,
} from "@gooddealer/protocol/account";

import {
  AccountBillingCancellationController,
  AccountBillingRecoveryController,
  AccountBillingRefundController,
  type BillingCheckoutRecoveryRecord,
  type BillingRefundRecoveryRecord,
} from "../billing-recovery-controller";
import {
  createSameOriginApprovalNavigator,
  createSameOriginBillingTransport,
  HttpFailure,
  isDeterministicCheckoutRejection,
} from "../billing/same-origin-billing";
import {
  ACTIVE_ACCOUNT_NAMESPACE_KEY,
  createAccountNamespaceFence,
  createNamespacedRecoveryStore,
  recoveryStorageKey,
  supersedeGeneration,
  type NamespacedRecoveryStore,
  type RecoveryStorage,
} from "../browser-storage";
import { parseDesktopAuthorizationContinuation } from "../desktop-authorization-continuation";
import type { AccountAccessNotice, AccountAccessStep } from "../features/access/account-access";
import type { LicenseNotice } from "../features/license/account-license";
import { refundProgressView, type LicenseRefundState } from "../features/license/license-view";
import { createIdentityClient, type IdentityClient, type IdentityRejection } from "../identity/identity-client";

/** Everything the controller needs from the browser, injected so the flow runs unchanged in tests. */
export interface AccountControllerHost {
  readonly fetch: (path: string, init: RequestInit) => Promise<Response>;
  readonly storage: RecoveryStorage;
  readonly location: {
    readonly origin: string;
    readonly pathname: string;
    readonly search: string;
    assign(url: string): void;
    replace(url: string): void;
  };
  readonly now: () => number;
  readonly randomId: () => string;
  readonly setTimeout: (callback: () => void, delayMs: number) => unknown;
  readonly clearTimeout: (handle: unknown) => void;
}

export interface AccountAppState {
  /** `loading` lasts only until the first session read settles. */
  readonly phase: "loading" | "access" | "account";
  readonly accessStep: AccountAccessStep;
  readonly accessNotice: AccountAccessNotice | null;
  readonly accessBusy: boolean;
  /** Desktop's browser sign-in sent the user here; a session returns to the authorize request. */
  readonly desktopHandoff: boolean;
  /** Null until an authoritative read for the current account; the page then offers no action. */
  readonly billingStatus: BillingStatusReadResponse | null;
  readonly refund: LicenseRefundState;
  readonly licenseNotice: LicenseNotice | null;
  readonly billingBusy: boolean;
  /** An authoritative reload is in flight; actions stay disabled until it settles. */
  readonly refreshing: boolean;
  readonly signingOut: boolean;
  readonly signOutUnconfirmed: boolean;
  readonly evaluatedAtMs: number;
}

interface BillingContext {
  readonly namespace: string;
  readonly recovery: AccountBillingRecoveryController;
  readonly cancellation: AccountBillingCancellationController;
  readonly cancellationStore: NamespacedRecoveryStore<BillingSubscriptionCancelRequest>;
  readonly refundRecovery: AccountBillingRefundController;
}

const refundPollIntervalMs = 3_000;
const refundPollWindowMs = 120_000;

/**
 * Production Account Web flow: session discovery, Identity steps, and billing recovery for the one
 * authenticated account. Three fences keep stale work from writing over newer state:
 *
 * - the initialization generation: every reload, sign-in, sign-out, or cross-tab change supersedes
 *   it, and an async step that resumes under an older generation does nothing;
 * - the billing context: recovery custody is bound to the server-returned account namespace, and
 *   a context stops being current the moment another tab activates a different namespace;
 * - the refund flow generation: stopping refund polling invalidates every pending poll.
 *
 * Cloud owns every billing and identity fact; this class only replays the browser's own request
 * identities and renders what Cloud answers.
 */
export class AccountController {
  readonly #host: AccountControllerHost;
  readonly #identity: IdentityClient;
  readonly #billing: BillingClient;
  readonly #fence;
  readonly #navigator;
  /** Read once: a later navigation inside the page must not re-arm a consumed authorize request. */
  readonly #continuation: string | null;
  readonly #listeners = new Set<() => void>();
  #state: AccountAppState;
  #generation = 0;
  #refundGeneration = 0;
  #context: BillingContext | null = null;
  #busyOwner: BillingContext | null = null;
  #refundTimer: unknown = null;
  #refundDeadline: number | null = null;

  constructor(host: AccountControllerHost) {
    this.#host = host;
    this.#identity = createIdentityClient(host.fetch);
    this.#billing = new BillingClient(createSameOriginBillingTransport(host.fetch));
    this.#fence = createAccountNamespaceFence(host.storage);
    this.#navigator = createSameOriginApprovalNavigator(host.location);
    this.#continuation = parseDesktopAuthorizationContinuation(host.location.search, host.location.origin);
    this.#state = {
      phase: "loading",
      accessStep: "sign_in",
      accessNotice: null,
      accessBusy: false,
      desktopHandoff: this.#continuation !== null,
      billingStatus: null,
      refund: { kind: "none" },
      licenseNotice: null,
      billingBusy: false,
      refreshing: false,
      signingOut: false,
      signOutUnconfirmed: false,
      evaluatedAtMs: host.now(),
    };
  }

  readonly getState = (): AccountAppState => this.#state;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  };

  start(): Promise<void> {
    return this.#initialize();
  }

  refresh(): Promise<void> {
    return this.#initialize();
  }

  dispose(): void {
    this.#stopRefundRecovery();
    this.#listeners.clear();
  }

  /** Same-origin `storage` events: another tab changed the active account or this account's refund custody. */
  handleStorage(key: string | null, newValue: string | null): void {
    const context = this.#context;
    if (context !== null && key === recoveryStorageKey("gooddealer.billing.refund", context.namespace)) {
      this.#generation = supersedeGeneration(this.#generation);
      this.#stopRefundRecovery();
      this.#update({ refund: { kind: "none" }, refreshing: true });
      void this.#initialize();
      return;
    }
    // A null key means another tab cleared all storage, which removes the namespace too.
    if (key !== null && key !== ACTIVE_ACCOUNT_NAMESPACE_KEY) return;
    this.#generation = supersedeGeneration(this.#generation);
    this.#context = null;
    this.#busyOwner = null;
    this.#stopRefundRecovery();
    this.#update({ billingStatus: null, refund: { kind: "none" }, billingBusy: false, licenseNotice: null });
    if (key === null || newValue === null) {
      this.#update({ phase: "access", accessStep: "sign_in", accessNotice: null, refreshing: false });
      return;
    }
    void this.#initialize();
  }

  setAccessStep(step: AccountAccessStep): void {
    this.#update({ accessStep: step, accessNotice: null });
  }

  async signIn(email: string, password: string): Promise<void> {
    this.#invalidateBillingContext();
    this.#update({ accessBusy: true, accessNotice: null });
    try {
      const outcome = await this.#identity.signIn(email, password);
      if (!outcome.ok) {
        this.#accessNotice(rejectionKey(outcome, "invalidCredentials"), "error");
        return;
      }
      await this.#initialize();
    } catch {
      this.#accessNotice("serviceUnavailable", "error");
    } finally {
      this.#update({ accessBusy: false });
    }
  }

  async register(email: string, password: string): Promise<void> {
    this.#invalidateBillingContext();
    await this.#accessRequest(() => this.#identity.register(email, password), "invalidFormat", () => {
      this.#update({ accessStep: "verify", accessNotice: { key: "verificationSent", tone: "info" } });
    });
  }

  async verify(email: string, code: string): Promise<void> {
    this.#invalidateBillingContext();
    await this.#accessRequest(() => this.#identity.verify(email, code), "codeRejected", () => {
      this.#update({ accessStep: "sign_in", accessNotice: { key: "verified", tone: "success" } });
    });
  }

  async resendVerification(email: string): Promise<void> {
    await this.#accessRequest(() => this.#identity.resendVerification(email), "invalidEmail", () => {
      this.#accessNotice("verificationResent", "info");
    });
  }

  async requestPasswordReset(email: string): Promise<void> {
    await this.#accessRequest(() => this.#identity.requestPasswordReset(email), "invalidEmail", () => {
      this.#update({ accessStep: "reset", accessNotice: { key: "resetSent", tone: "info" } });
    });
  }

  async completePasswordReset(email: string, code: string, password: string): Promise<void> {
    await this.#accessRequest(() => this.#identity.completePasswordReset(email, code, password), "codeRejected", () => {
      this.#update({ accessStep: "sign_in", accessNotice: { key: "resetCompleted", tone: "success" } });
    });
  }

  /** Signing out claims completion only after the server confirms the session is revoked. */
  async signOut(): Promise<void> {
    this.#invalidateBillingContext();
    this.#update({ signingOut: true, signOutUnconfirmed: false });
    try {
      const outcome = await this.#identity.signOut();
      if (!outcome.ok) throw new TypeError("Identity logout was refused");
      this.#update({ phase: "access", accessStep: "sign_in", accessNotice: { key: "signedOut", tone: "success" } });
    } catch {
      this.#update({ signOutUnconfirmed: true });
      await this.#initialize();
    } finally {
      this.#update({ signingOut: false });
    }
  }

  async checkout(offer: CommercialOffer, campaignCode: string | null): Promise<void> {
    const context = this.#context;
    // Cloud enforces the single provider slot; this only avoids sending a request it must refuse.
    if (context === null || this.#state.billingStatus?.state !== "none") return;
    this.#beginBusy(context, { key: "noticeCheckoutCreating", tone: "info" });
    const requestId = `web-${this.#host.randomId()}`;
    try {
      const checkout = await context.recovery.startCheckout({
        schemaVersion: BILLING_SCHEMA_VERSION,
        requestId,
        provider: "stripe",
        offer,
        campaignCode,
      });
      if (!this.#isCurrentContext(context)) return;
      await context.recovery.navigateToApproval(checkout, this.#navigator);
    } catch (error) {
      const rejected = error instanceof HttpFailure && isDeterministicCheckoutRejection(error.payload);
      if (rejected) {
        try {
          await context.recovery.markDeterministicallyRejected(requestId, error.payload);
        } catch {
          // Custody that no longer matches keeps the request identity; recovery reconciles it later.
        }
      }
      if (!this.#isCurrentContext(context)) return;
      if (this.#expireOn401(error)) return;
      this.#update({ licenseNotice: rejected
        ? { key: "noticeCheckoutRejected", tone: "error" }
        : { key: "noticeCheckoutUnconfirmed", tone: "error" } });
    } finally {
      this.#endBusy(context);
    }
  }

  /**
   * Resumes the pending checkout. Recovery replays the same GoodDealer request identity and yields
   * a fresh approval handle, so an expired handle from an earlier page view is never reused.
   */
  async continueCheckout(): Promise<void> {
    const context = this.#context;
    if (context === null) return;
    this.#beginBusy(context, null);
    try {
      const result = await context.recovery.recover();
      if (!this.#isCurrentContext(context)) return;
      if (result.state === "checkout_recovered") {
        await context.recovery.navigateToApproval(result.checkout, this.#navigator);
        return;
      }
      this.#update({ billingStatus: result.status, evaluatedAtMs: this.#host.now() });
    } catch (error) {
      if (!this.#isCurrentContext(context) || this.#expireOn401(error)) return;
      this.#update({ licenseNotice: { key: "noticeCheckoutUnconfirmed", tone: "error" } });
    } finally {
      this.#endBusy(context);
    }
  }

  async cancelRenewal(): Promise<void> {
    const context = this.#context;
    const status = this.#state.billingStatus;
    if (context === null || status?.state !== "active" || status.offer === "ten_year") return;
    this.#beginBusy(context, null);
    try {
      // A stored identity from a lost response is replayed before any new request is minted.
      const recovered = await context.cancellation.recover();
      if (!this.#isCurrentContext(context)) return;
      if (recovered.state === "new_request_required") {
        await context.cancellation.requestCancellation({
          schemaVersion: BILLING_SCHEMA_VERSION,
          requestId: `cancel-${this.#host.randomId()}`,
        });
      }
      if (!this.#isCurrentContext(context)) return;
      const next = await this.#billing.readStatus();
      if (!this.#isCurrentContext(context)) return;
      this.#update({ billingStatus: next, evaluatedAtMs: this.#host.now() });
    } catch (error) {
      if (!this.#isCurrentContext(context) || this.#expireOn401(error)) return;
      this.#update({ licenseNotice: { key: "noticeCancelUnconfirmed", tone: "error" } });
    } finally {
      this.#endBusy(context);
    }
  }

  requestRefund(purchaseId: string): Promise<void> {
    return this.#submitRefund((context) => context.refundRecovery.requestRefund({
      schemaVersion: BILLING_SCHEMA_VERSION,
      requestId: `refund-${this.#host.randomId()}`,
      purchaseId,
    }));
  }

  retryRefund(): Promise<void> {
    return this.#submitRefund((context) => context.refundRecovery.retryRefund());
  }

  async #initialize(): Promise<void> {
    this.#generation = supersedeGeneration(this.#generation);
    const generation = this.#generation;
    this.#stopRefundRecovery();
    this.#context = null;
    this.#update({ refund: { kind: "none" }, refreshing: true });
    let session;
    try {
      session = await this.#identity.readSession();
    } catch {
      if (generation !== this.#generation) return;
      this.#showAccess({ key: "serviceUnavailable", tone: "error" });
      return;
    }
    if (generation !== this.#generation) return;
    if (session.kind === "unauthenticated") {
      // Only 401 proves there is no session; any other refusal is an outage, not a sign-out.
      if (session.httpStatus === 401) {
        this.#fence.clear();
        this.#showAccess(undefined);
      } else this.#showAccess({ key: "serviceUnavailable", tone: "error" });
      return;
    }
    if (session.kind === "invalid") {
      this.#showAccess({ key: "sessionInvalid", tone: "error" });
      return;
    }
    if (this.#continuation !== null) {
      this.#update({ phase: "access", accessStep: "desktop_returning", accessNotice: null, refreshing: false });
      // Replace, not assign: Back must not reopen an authorize request that has been consumed.
      this.#host.location.replace(this.#continuation);
      return;
    }
    this.#fence.activate(session.namespace);
    const context = this.#createBillingContext(session.namespace);
    this.#context = context;
    const returnNotice: LicenseNotice | null = this.#host.location.pathname === "/billing/success"
      ? { key: "noticeCheckoutReturned", tone: "info" }
      : this.#host.location.pathname === "/billing/cancel" ? { key: "noticeCheckoutCancelled", tone: "info" } : null;
    this.#update({ phase: "account", licenseNotice: returnNotice });
    try {
      const recovered = await context.recovery.recover();
      if (!this.#isCurrent(generation, context)) return;
      // A recovered checkout replayed the stored request, so Cloud now reports it as pending.
      let status = recovered.state === "checkout_recovered" ? await this.#billing.readStatus() : recovered.status;
      if (!this.#isCurrent(generation, context)) return;
      if (status.state === "cancellation_pending" || status.state === "cancellation_unknown"
        || await context.cancellationStore.load() !== null) {
        try {
          const cancellation = await context.cancellation.recover();
          if (!this.#isCurrent(generation, context)) return;
          if (cancellation.state === "settled") status = cancellation.status;
          else if (cancellation.state === "cancellation_recovered") status = await this.#billing.readStatus();
        } catch (error) {
          if (!this.#isCurrent(generation, context) || this.#expireOn401(error)) return;
          this.#update({ licenseNotice: { key: "noticeCancelUnconfirmed", tone: "error" } });
        }
        if (!this.#isCurrent(generation, context)) return;
      }
      this.#update({ billingStatus: status, refreshing: false, evaluatedAtMs: this.#host.now() });
      const refundGeneration = this.#refundGeneration;
      try {
        const refund = await context.refundRecovery.recover();
        if (!this.#isCurrent(generation, context) || refundGeneration !== this.#refundGeneration) return;
        if (refund.state === "refund_recovered") this.#renderRefund(refund.response);
      } catch {
        if (generation !== this.#generation || refundGeneration !== this.#refundGeneration) return;
        this.#update({ refund: { kind: "unconfirmed" } });
        this.#scheduleRefundRecovery(context);
      }
    } catch (error) {
      if (generation !== this.#generation || this.#expireOn401(error)) return;
      this.#update({ billingStatus: null, refreshing: false, licenseNotice: { key: "noticeStatusUnavailable", tone: "error" } });
    }
  }

  #createBillingContext(namespace: string): BillingContext {
    const storage = this.#host.storage;
    let context: BillingContext | undefined;
    const assertCurrent = (): void => {
      if (context === undefined || !this.#isCurrentContext(context)) {
        throw new TypeError("billing session changed while recovery was in progress");
      }
    };
    const cancellationStore = createNamespacedRecoveryStore<BillingSubscriptionCancelRequest>("gooddealer.billing.cancellation", namespace, storage);
    context = {
      namespace,
      recovery: new AccountBillingRecoveryController(this.#billing,
        createNamespacedRecoveryStore<BillingCheckoutRecoveryRecord>("gooddealer.billing.checkout", namespace, storage), assertCurrent),
      cancellation: new AccountBillingCancellationController(this.#billing, cancellationStore, assertCurrent),
      cancellationStore,
      refundRecovery: new AccountBillingRefundController(this.#billing,
        createNamespacedRecoveryStore<BillingRefundRecoveryRecord>("gooddealer.billing.refund", namespace, storage),
        () => new Date(this.#host.now()), assertCurrent),
    };
    return context;
  }

  async #submitRefund(
    send: (context: BillingContext) => ReturnType<AccountBillingRefundController["requestRefund"]>,
  ): Promise<void> {
    const context = this.#context;
    if (context === null) return;
    this.#stopRefundRecovery();
    this.#beginBusy(context, this.#state.licenseNotice);
    this.#update({ refund: { kind: "submitting" } });
    try {
      const response = await send(context);
      if (!this.#isCurrentContext(context)) return;
      if (response.state === "rejected") this.#update({ refund: { kind: "rejected", reason: response.reason } });
      else this.#renderRefund(response);
    } catch {
      if (!this.#isCurrentContext(context)) return;
      // The request may have been accepted; refreshing recovers it with the same stored identity.
      this.#update({ refund: { kind: "unconfirmed" } });
      this.#scheduleRefundRecovery(context);
    } finally {
      this.#endBusy(context);
    }
  }

  #renderRefund(response: BillingFirstPurchaseRefundAcceptedResponse): void {
    const evaluatedAtMs = this.#host.now();
    this.#update({ refund: { kind: "progress", response }, evaluatedAtMs });
    if (refundProgressView(response, evaluatedAtMs).shouldPoll) this.#scheduleRefundRecovery(this.#context);
    else this.#stopRefundRecovery();
  }

  #scheduleRefundRecovery(context: BillingContext | null, generation: number = this.#generation): void {
    if (context === null || context !== this.#context) return;
    const refundGeneration = this.#refundGeneration;
    const now = this.#host.now();
    if (this.#refundDeadline === null) this.#refundDeadline = now + refundPollWindowMs;
    if (now >= this.#refundDeadline || this.#refundTimer !== null) return;
    this.#refundTimer = this.#host.setTimeout(() => {
      this.#refundTimer = null;
      void this.#recoverRefundProgress(generation, refundGeneration, context);
    }, refundPollIntervalMs);
  }

  async #recoverRefundProgress(generation: number, refundGeneration: number, context: BillingContext): Promise<void> {
    const current = () => generation === this.#generation && refundGeneration === this.#refundGeneration && context === this.#context;
    if (!current()) return;
    try {
      const result = await context.refundRecovery.recover();
      if (!current()) return;
      if (result.state === "refund_recovered") {
        this.#renderRefund(result.response);
        return;
      }
      // Custody cleared (completed or removed by another tab): reload authoritative billing state.
      this.#stopRefundRecovery();
      await this.#initialize();
    } catch {
      if (generation === this.#generation && refundGeneration === this.#refundGeneration) {
        this.#scheduleRefundRecovery(context, generation);
      }
    }
  }

  #stopRefundRecovery(): void {
    if (this.#refundTimer !== null) this.#host.clearTimeout(this.#refundTimer);
    this.#refundTimer = null;
    this.#refundDeadline = null;
    this.#refundGeneration += 1;
  }

  async #accessRequest(
    send: () => Promise<{ readonly ok: true } | IdentityRejection>,
    rejectedKey: AccountAccessNotice["key"],
    onAccepted: () => void,
  ): Promise<void> {
    this.#update({ accessBusy: true, accessNotice: null });
    try {
      const outcome = await send();
      if (outcome.ok) onAccepted();
      else this.#accessNotice(rejectionKey(outcome, rejectedKey), "error");
    } catch {
      this.#accessNotice("serviceUnavailable", "error");
    } finally {
      this.#update({ accessBusy: false });
    }
  }

  /** Drops all browser-side account authority before a request that may replace the session cookie. */
  #invalidateBillingContext(): void {
    this.#generation = supersedeGeneration(this.#generation);
    this.#context = null;
    this.#busyOwner = null;
    this.#stopRefundRecovery();
    this.#fence.clear();
    this.#update({ billingStatus: null, refund: { kind: "none" }, billingBusy: false, licenseNotice: null, signOutUnconfirmed: false });
  }

  /** A 401 from billing means the session is gone: return to sign-in instead of acting on stale state. */
  #expireOn401(error: unknown): boolean {
    if (!(error instanceof HttpFailure) || error.status !== 401) return false;
    this.#generation = supersedeGeneration(this.#generation);
    this.#context = null;
    this.#busyOwner = null;
    this.#stopRefundRecovery();
    this.#fence.clear();
    this.#update({ billingStatus: null, refund: { kind: "none" }, billingBusy: false, licenseNotice: null });
    this.#showAccess({ key: "sessionExpired", tone: "error" });
    return true;
  }

  #showAccess(notice: AccountAccessNotice | undefined): void {
    this.#update({
      phase: "access",
      billingStatus: null,
      refreshing: false,
      ...(notice === undefined ? {} : { accessNotice: notice }),
    });
  }

  #accessNotice(key: AccountAccessNotice["key"], tone: AccountAccessNotice["tone"]): void {
    this.#update({ accessNotice: { key, tone } });
  }

  #beginBusy(context: BillingContext, notice: LicenseNotice | null): void {
    this.#busyOwner = context;
    this.#update({ billingBusy: true, licenseNotice: notice });
  }

  /** Only the context that set busy may clear it; a newer account's in-flight work keeps its own. */
  #endBusy(context: BillingContext): void {
    if (this.#busyOwner !== context) return;
    this.#busyOwner = null;
    this.#update({ billingBusy: false });
  }

  #isCurrentContext(context: BillingContext): boolean {
    return context === this.#context && this.#fence.isCurrent(context.namespace);
  }

  #isCurrent(generation: number, context: BillingContext): boolean {
    return generation === this.#generation && this.#isCurrentContext(context);
  }

  #update(patch: Partial<AccountAppState>): void {
    this.#state = { ...this.#state, ...patch };
    for (const listener of this.#listeners) listener();
  }
}

function rejectionKey(outcome: IdentityRejection, fallback: AccountAccessNotice["key"]): AccountAccessNotice["key"] {
  return outcome.httpStatus === 429 ? "rateLimited" : fallback;
}
