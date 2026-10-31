import { beforeEach, describe, expect, it } from "vitest";

import { ACTIVE_ACCOUNT_NAMESPACE_KEY, recoveryStorageKey, type RecoveryStorage } from "../browser-storage";
import { AccountController, type AccountControllerHost } from "./account-controller";

const accountA = "A".repeat(43);
const accountB = "B".repeat(43);
const handle = "h".repeat(43);
const startMs = Date.parse("2026-10-31T09:00:00Z");

type Reply = { readonly status: number; readonly body?: unknown } | Promise<{ readonly status: number; readonly body?: unknown }>;
type Route = (body: unknown) => Reply;

const noneStatus = { schemaVersion: 1, state: "none", provider: null, offer: null, paidThrough: null, refundEligibleUntil: null };
const activeMonthly = {
  schemaVersion: 1, state: "active", provider: "stripe", offer: "monthly", purchaseId: "pur_1",
  paidThrough: "2026-11-30T00:00:00Z", refundEligibleUntil: "2026-11-14T00:00:00Z",
};
const checkoutResponse = (requestId: string) => ({
  schemaVersion: 1, requestId, checkoutId: "chk_1", provider: "stripe", offer: "annual",
  approval: { kind: "gooddealer_redirect", handle, expiresAt: "2026-10-31T09:30:00Z" },
});
const accepted = {
  schemaVersion: 1, refundRequestId: "rr_1", purchaseId: "pur_1", commercialAccess: "read_only",
  requestedAmount: { minor: 980, currency: "USD" },
};

/** A same-origin server stand-in: each path answers through a replaceable route. */
function createHarness(options: { readonly pathname?: string; readonly search?: string } = {}) {
  const values = new Map<string, string>();
  const storage: RecoveryStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  };
  const routes = new Map<string, Route>();
  const requests: { readonly path: string; readonly init: RequestInit }[] = [];
  const navigations: { readonly kind: "assign" | "replace"; readonly url: string }[] = [];
  const timers = new Map<number, () => void>();
  let nextTimer = 1;
  let now = startMs;
  let nextId = 1;
  const host: AccountControllerHost = {
    async fetch(path, init) {
      requests.push({ path, init });
      const route = routes.get(path);
      if (route === undefined) throw new TypeError(`unexpected request ${path}`);
      const reply = await route(typeof init.body === "string" ? JSON.parse(init.body) : null);
      return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
        status: reply.status,
        headers: reply.body === undefined ? {} : { "content-type": "application/json" },
      });
    },
    storage,
    location: {
      origin: "https://account.gooddealer.test",
      pathname: options.pathname ?? "/",
      search: options.search ?? "",
      assign: (url) => { navigations.push({ kind: "assign", url }); },
      replace: (url) => { navigations.push({ kind: "replace", url }); },
    },
    now: () => now,
    randomId: () => `id${nextId++}`,
    setTimeout: (callback) => { const id = nextTimer++; timers.set(id, callback); return id; },
    clearTimeout: (id) => { timers.delete(id as number); },
  };
  const controller = new AccountController(host);
  return {
    controller, values, routes, requests, navigations, timers,
    advance(ms: number) { now += ms; },
    async runTimers() {
      const pending = [...timers.entries()];
      timers.clear();
      for (const [, callback] of pending) callback();
      await settle();
    },
    session(namespace: string | null) {
      routes.set("/v1/identity/session", () => namespace === null
        ? { status: 401 }
        : { status: 200, body: { status: "authenticated", namespace } });
    },
    status(value: unknown) {
      routes.set("/v1/account/billing/status", () => ({ status: 200, body: value }));
    },
  };
}

async function settle(): Promise<void> {
  for (let index = 0; index < 20; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("AccountController session discovery", () => {
  it("shows access and clears the namespace fence when Identity reports no session", async () => {
    const harness = createHarness();
    harness.values.set(ACTIVE_ACCOUNT_NAMESPACE_KEY, accountA);
    harness.session(null);
    await harness.controller.start();
    expect(harness.controller.getState()).toMatchObject({ phase: "access", accessStep: "sign_in", billingStatus: null });
    expect(harness.values.has(ACTIVE_ACCOUNT_NAMESPACE_KEY)).toBe(false);
  });

  it("treats a non-401 session refusal as an outage, not a sign-out", async () => {
    const harness = createHarness();
    harness.values.set(ACTIVE_ACCOUNT_NAMESPACE_KEY, accountA);
    harness.routes.set("/v1/identity/session", () => ({ status: 503 }));
    await harness.controller.start();
    expect(harness.controller.getState().accessNotice).toEqual({ key: "serviceUnavailable", tone: "error" });
    expect(harness.values.get(ACTIVE_ACCOUNT_NAMESPACE_KEY)).toBe(accountA);
  });

  it("rejects a session reply with extra fields instead of trusting the status code", async () => {
    const harness = createHarness();
    harness.routes.set("/v1/identity/session", () => ({ status: 200, body: { status: "authenticated", namespace: accountA, admin: true } }));
    await harness.controller.start();
    expect(harness.controller.getState()).toMatchObject({ phase: "access", accessNotice: { key: "sessionInvalid", tone: "error" } });
    expect(harness.values.has(ACTIVE_ACCOUNT_NAMESPACE_KEY)).toBe(false);
  });

  it("lands an authenticated account on License with an authoritative status and no custody writes", async () => {
    const harness = createHarness();
    harness.session(accountA);
    harness.status(noneStatus);
    await harness.controller.start();
    expect(harness.controller.getState()).toMatchObject({ phase: "account", billingStatus: noneStatus, refreshing: false });
    expect(harness.values.get(ACTIVE_ACCOUNT_NAMESPACE_KEY)).toBe(accountA);
    expect([...harness.values.keys()]).toEqual([ACTIVE_ACCOUNT_NAMESPACE_KEY]);
    for (const request of harness.requests) {
      expect(request.init).toMatchObject({ credentials: "same-origin", redirect: "error" });
      expect(request.path.startsWith("/")).toBe(true);
    }
  });

  it("returns to the Desktop authorize request once and never activates the account in this tab", async () => {
    const continuation = "/v1/desktop-oauth/authorize?client_id=desktop&state=s";
    const harness = createHarness({ search: `?continue=${encodeURIComponent(continuation)}` });
    harness.session(accountA);
    await harness.controller.start();
    expect(harness.navigations).toEqual([{ kind: "replace", url: continuation }]);
    expect(harness.controller.getState()).toMatchObject({ phase: "access", accessStep: "desktop_returning", desktopHandoff: true });
    expect(harness.values.has(ACTIVE_ACCOUNT_NAMESPACE_KEY)).toBe(false);
  });

  it("ignores a continuation that leaves the Desktop authorize path", async () => {
    const harness = createHarness({ search: "?continue=//evil.example/v1/desktop-oauth/authorize?x=1" });
    harness.session(accountA);
    harness.status(noneStatus);
    await harness.controller.start();
    expect(harness.navigations).toEqual([]);
    expect(harness.controller.getState()).toMatchObject({ phase: "account", desktopHandoff: false });
  });

  it("drops an older session read that resolves after a newer reload", async () => {
    const harness = createHarness();
    let releaseFirst: (reply: { status: number; body?: unknown }) => void = () => undefined;
    harness.routes.set("/v1/identity/session", () => new Promise((resolve) => { releaseFirst = resolve; }));
    const first = harness.controller.start();
    await settle();
    harness.session(null);
    await harness.controller.refresh();
    releaseFirst({ status: 200, body: { status: "authenticated", namespace: accountA } });
    await first;
    expect(harness.controller.getState().phase).toBe("access");
    expect(harness.values.has(ACTIVE_ACCOUNT_NAMESPACE_KEY)).toBe(false);
  });

  it("shows the Stripe return notices on their billing paths", async () => {
    for (const [pathname, key] of [["/billing/success", "noticeCheckoutReturned"], ["/billing/cancel", "noticeCheckoutCancelled"]] as const) {
      const harness = createHarness({ pathname });
      harness.session(accountA);
      harness.status(noneStatus);
      await harness.controller.start();
      expect(harness.controller.getState().licenseNotice).toEqual({ key, tone: "info" });
    }
  });
});

describe("AccountController Identity steps", () => {
  let harness: ReturnType<typeof createHarness>;
  beforeEach(async () => {
    harness = createHarness();
    harness.session(null);
    await harness.controller.start();
  });

  it("maps refusals to fixed copy and never exposes server text", async () => {
    harness.routes.set("/v1/identity/login", () => ({ status: 401, body: { message: "user exists" } }));
    await harness.controller.signIn("user@example.com", "a long password!");
    expect(harness.controller.getState().accessNotice).toEqual({ key: "invalidCredentials", tone: "error" });
    harness.routes.set("/v1/identity/login", () => ({ status: 429 }));
    await harness.controller.signIn("user@example.com", "a long password!");
    expect(harness.controller.getState().accessNotice).toEqual({ key: "rateLimited", tone: "error" });
  });

  it("fails closed when a 200 reply does not parse to the expected status", async () => {
    harness.routes.set("/v1/identity/login", () => ({ status: 200, body: { status: "authenticated", extra: 1 } }));
    await harness.controller.signIn("user@example.com", "a long password!");
    expect(harness.controller.getState()).toMatchObject({ phase: "access", accessNotice: { key: "serviceUnavailable", tone: "error" } });
  });

  it("signs in, then discovers the session before showing the account", async () => {
    harness.routes.set("/v1/identity/login", () => ({ status: 200, body: { status: "authenticated" } }));
    harness.session(accountA);
    harness.status(noneStatus);
    await harness.controller.signIn("user@example.com", "a long password!");
    expect(harness.controller.getState()).toMatchObject({ phase: "account", accessBusy: false, billingStatus: noneStatus });
  });

  it("moves register to verify, verify to sign-in, and reset request to reset only after acceptance", async () => {
    harness.routes.set("/v1/identity/registration", () => ({ status: 200, body: { status: "accepted" } }));
    await harness.controller.register("user@example.com", "a long password!");
    expect(harness.controller.getState()).toMatchObject({ accessStep: "verify", accessNotice: { key: "verificationSent" } });
    harness.routes.set("/v1/identity/registration/verify", () => ({ status: 400 }));
    await harness.controller.verify("user@example.com", "123456");
    expect(harness.controller.getState()).toMatchObject({ accessStep: "verify", accessNotice: { key: "codeRejected" } });
    harness.routes.set("/v1/identity/registration/verify", () => ({ status: 200, body: { status: "verified" } }));
    await harness.controller.verify("user@example.com", "123456");
    expect(harness.controller.getState()).toMatchObject({ accessStep: "sign_in", accessNotice: { key: "verified", tone: "success" } });
    harness.routes.set("/v1/identity/password-reset", () => ({ status: 400 }));
    await harness.controller.requestPasswordReset("bad");
    expect(harness.controller.getState()).toMatchObject({ accessStep: "sign_in", accessNotice: { key: "invalidEmail" } });
    harness.routes.set("/v1/identity/password-reset", () => ({ status: 200, body: { status: "accepted" } }));
    await harness.controller.requestPasswordReset("user@example.com");
    expect(harness.controller.getState()).toMatchObject({ accessStep: "reset", accessNotice: { key: "resetSent" } });
  });

  it("never writes a password or code to browser storage", async () => {
    harness.routes.set("/v1/identity/login", () => ({ status: 401 }));
    harness.routes.set("/v1/identity/password-reset/complete", () => ({ status: 200, body: { status: "completed" } }));
    await harness.controller.signIn("user@example.com", "secret-password-123");
    await harness.controller.completePasswordReset("user@example.com", "654321", "another-secret-456");
    const stored = [...harness.values.entries()].join("\n");
    expect(stored).not.toContain("secret-password-123");
    expect(stored).not.toContain("654321");
    expect(stored).not.toContain("another-secret-456");
  });
});

describe("AccountController sign-out", () => {
  it("claims sign-out only after the server confirms and clears account authority first", async () => {
    const harness = createHarness();
    harness.session(accountA);
    harness.status(noneStatus);
    await harness.controller.start();
    harness.routes.set("/v1/identity/logout", () => ({ status: 200, body: { status: "signed_out" } }));
    await harness.controller.signOut();
    expect(harness.controller.getState()).toMatchObject({ phase: "access", accessNotice: { key: "signedOut", tone: "success" }, billingStatus: null });
    expect(harness.values.has(ACTIVE_ACCOUNT_NAMESPACE_KEY)).toBe(false);
  });

  it("reports an unconfirmed sign-out and reloads the real session", async () => {
    const harness = createHarness();
    harness.session(accountA);
    harness.status(noneStatus);
    await harness.controller.start();
    harness.routes.set("/v1/identity/logout", () => ({ status: 502 }));
    await harness.controller.signOut();
    expect(harness.controller.getState()).toMatchObject({ phase: "account", signOutUnconfirmed: true, signingOut: false });
  });
});

describe("AccountController billing", () => {
  async function signedIn(status: unknown, options?: { readonly pathname?: string }) {
    const harness = createHarness(options);
    harness.session(accountA);
    harness.status(status);
    await harness.controller.start();
    return harness;
  }

  it("persists checkout custody before dispatch and navigates only to the same-origin approval path", async () => {
    const harness = await signedIn(noneStatus);
    const checkoutKey = recoveryStorageKey("gooddealer.billing.checkout", accountA);
    harness.routes.set("/v1/account/billing/checkout", (body) => {
      expect(JSON.parse(harness.values.get(checkoutKey) ?? "null")).toMatchObject({ state: "pending", request: body });
      return { status: 200, body: checkoutResponse((body as { requestId: string }).requestId) };
    });
    await harness.controller.checkout("annual", "LAUNCH");
    expect(harness.navigations).toEqual([{ kind: "assign", url: `https://account.gooddealer.test/billing/approval/${handle}` }]);
    expect(harness.requests.at(-1)?.path).toBe("/v1/account/billing/checkout");
  });

  it("does not start a checkout unless the authoritative status is none", async () => {
    const harness = await signedIn(activeMonthly);
    await harness.controller.checkout("annual", null);
    expect(harness.requests.some((request) => request.path === "/v1/account/billing/checkout")).toBe(false);
  });

  it("releases the request identity only after the exact deterministic rejection", async () => {
    const harness = await signedIn(noneStatus);
    harness.routes.set("/v1/account/billing/checkout", () => ({ status: 422, body: {
      schemaVersion: 1, code: "COMMERCIAL_CHECKOUT_REJECTED", retryable: false, retryAfterSeconds: null, correlationId: "corr_1",
    } }));
    await harness.controller.checkout("annual", "BAD");
    expect(harness.controller.getState()).toMatchObject({ licenseNotice: { key: "noticeCheckoutRejected" }, billingBusy: false });
    expect(JSON.parse(harness.values.get(recoveryStorageKey("gooddealer.billing.checkout", accountA)) ?? "null"))
      .toEqual({ state: "deterministically_rejected", requestId: "web-id1" });
  });

  it("keeps the request identity when the checkout outcome is unknown", async () => {
    const harness = await signedIn(noneStatus);
    harness.routes.set("/v1/account/billing/checkout", () => ({ status: 503 }));
    await harness.controller.checkout("annual", null);
    expect(harness.controller.getState().licenseNotice).toEqual({ key: "noticeCheckoutUnconfirmed", tone: "error" });
    expect(JSON.parse(harness.values.get(recoveryStorageKey("gooddealer.billing.checkout", accountA)) ?? "null")).toMatchObject({ state: "pending" });
  });

  it("returns to sign-in when billing reports the session gone", async () => {
    const harness = createHarness();
    harness.session(accountA);
    harness.routes.set("/v1/account/billing/status", () => ({ status: 401 }));
    await harness.controller.start();
    expect(harness.controller.getState()).toMatchObject({ phase: "access", accessNotice: { key: "sessionExpired", tone: "error" }, billingStatus: null });
    expect(harness.values.has(ACTIVE_ACCOUNT_NAMESPACE_KEY)).toBe(false);
  });

  it("shows a pending checkout without leaving the page, and resumes it only on request", async () => {
    const pending = {
      schemaVersion: 1, state: "approval_pending", provider: "stripe", offer: "annual", checkoutId: "chk_1",
      requestId: "web-old", campaignCode: null, retryMode: "same_request", paidThrough: null, refundEligibleUntil: null,
    };
    const harness = createHarness({ pathname: "/billing/cancel" });
    harness.session(accountA);
    harness.status(pending);
    harness.routes.set("/v1/account/billing/checkout", () => ({ status: 200, body: checkoutResponse("web-old") }));
    await harness.controller.start();
    expect(harness.navigations).toEqual([]);
    expect(harness.controller.getState()).toMatchObject({ billingStatus: pending, licenseNotice: { key: "noticeCheckoutCancelled" } });
    await harness.controller.continueCheckout();
    expect(harness.navigations).toEqual([{ kind: "assign", url: `https://account.gooddealer.test/billing/approval/${handle}` }]);
  });

  it("persists the cancellation identity before dispatch and shows the refreshed status", async () => {
    const harness = await signedIn(activeMonthly);
    const cancellationKey = recoveryStorageKey("gooddealer.billing.cancellation", accountA);
    harness.routes.set("/v1/account/billing/subscription/cancel", (body) => {
      expect(JSON.parse(harness.values.get(cancellationKey) ?? "null")).toEqual(body);
      harness.status({ ...activeMonthly, refundEligibleUntil: null, requestId: "cancel-id1", state: "cancel_at_period_end" });
      return { status: 200, body: { schemaVersion: 1, requestId: "cancel-id1", paidThrough: activeMonthly.paidThrough, state: "cancel_at_period_end" } };
    });
    await harness.controller.cancelRenewal();
    expect(harness.controller.getState().billingStatus).toMatchObject({ state: "cancel_at_period_end" });
    expect(harness.values.has(cancellationKey)).toBe(false);
  });

  it("replays a stored cancellation identity on load instead of minting a new one", async () => {
    const harness = createHarness();
    harness.values.set(recoveryStorageKey("gooddealer.billing.cancellation", accountA), JSON.stringify({ schemaVersion: 1, requestId: "cancel-lost" }));
    harness.session(accountA);
    harness.status(activeMonthly);
    const sent: unknown[] = [];
    harness.routes.set("/v1/account/billing/subscription/cancel", (body) => {
      sent.push(body);
      return { status: 200, body: { schemaVersion: 1, requestId: "cancel-lost", paidThrough: activeMonthly.paidThrough, state: "cancellation_pending" } };
    });
    await harness.controller.start();
    expect(sent).toEqual([{ schemaVersion: 1, requestId: "cancel-lost" }]);
  });

  it("switches to read-only on an accepted refund and polls within the bounded window", async () => {
    const harness = await signedIn(activeMonthly);
    harness.routes.set("/v1/account/billing/first-purchase-refund", () => ({ status: 200, body: { ...accepted, state: "refund_pending", retryable: false, retryAfter: null } }));
    await harness.controller.requestRefund("pur_1");
    expect(harness.controller.getState().refund).toMatchObject({ kind: "progress", response: { state: "refund_pending" } });
    expect(harness.timers.size).toBe(1);
    let reads = 0;
    harness.routes.set("/v1/account/billing/first-purchase-refund/status", () => {
      reads += 1;
      return { status: 200, body: { ...accepted, state: "refund_pending", retryable: false, retryAfter: null } };
    });
    for (let index = 0; index < 60; index += 1) {
      harness.advance(3_000);
      await harness.runTimers();
    }
    expect(reads).toBeLessThanOrEqual(40);
    expect(harness.timers.size).toBe(0);
  });

  it("stops polling once the refund completes", async () => {
    const harness = await signedIn(activeMonthly);
    harness.routes.set("/v1/account/billing/first-purchase-refund", () => ({ status: 200, body: { ...accepted, state: "refund_pending", retryable: false, retryAfter: null } }));
    await harness.controller.requestRefund("pur_1");
    harness.routes.set("/v1/account/billing/first-purchase-refund/status", () => ({ status: 200, body: {
      ...accepted, state: "refunded", retryable: false, retryAfter: null, completedAt: "2026-10-31T09:00:03Z",
    } }));
    harness.advance(3_000);
    await harness.runTimers();
    expect(harness.controller.getState().refund).toMatchObject({ kind: "progress", response: { state: "refunded" } });
    expect(harness.timers.size).toBe(0);
  });

  it("marks an unanswered refund unconfirmed and keeps its identity for recovery", async () => {
    const harness = await signedIn(activeMonthly);
    harness.routes.set("/v1/account/billing/first-purchase-refund", () => ({ status: 504 }));
    await harness.controller.requestRefund("pur_1");
    expect(harness.controller.getState().refund).toEqual({ kind: "unconfirmed" });
    expect(JSON.parse(harness.values.get(recoveryStorageKey("gooddealer.billing.refund", accountA)) ?? "null"))
      .toMatchObject({ state: "pending", request: { purchaseId: "pur_1" }, refundRequestId: null });
  });
});

describe("AccountController cross-tab changes", () => {
  it("returns to sign-in when another tab clears the active account", async () => {
    const harness = createHarness();
    harness.session(accountA);
    harness.status(activeMonthly);
    await harness.controller.start();
    harness.controller.handleStorage(ACTIVE_ACCOUNT_NAMESPACE_KEY, null);
    expect(harness.controller.getState()).toMatchObject({ phase: "access", billingStatus: null });
  });

  it("drops the old account's state before loading the account another tab activated", async () => {
    const harness = createHarness();
    harness.session(accountA);
    harness.status(activeMonthly);
    await harness.controller.start();
    harness.session(accountB);
    harness.status(noneStatus);
    harness.controller.handleStorage(ACTIVE_ACCOUNT_NAMESPACE_KEY, accountB);
    expect(harness.controller.getState().billingStatus).toBeNull();
    await settle();
    expect(harness.controller.getState()).toMatchObject({ phase: "account", billingStatus: noneStatus });
    expect(harness.values.get(ACTIVE_ACCOUNT_NAMESPACE_KEY)).toBe(accountB);
  });

  it("ignores storage keys it does not own", async () => {
    const harness = createHarness();
    harness.session(accountA);
    harness.status(activeMonthly);
    await harness.controller.start();
    const before = harness.controller.getState();
    harness.controller.handleStorage("unrelated", "x");
    expect(harness.controller.getState()).toBe(before);
  });
});
