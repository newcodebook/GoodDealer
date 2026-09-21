import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const browser = readFileSync(new URL("../src/browser.ts", import.meta.url), "utf8");
const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

describe("Account Web access surface", () => {
  it("loads the bundle from an absolute path on billing return routes", () => {
    expect(html).toContain('<script type="module" src="/app.js"></script>');
  });

  it("keeps passwords and verification codes out of browser persistence", () => {
    expect(browser).not.toMatch(/(?:localStorage|sessionStorage)\.setItem\([^\n]*(?:password|code)/u);
    expect(browser).toContain('passwordInput.value = ""');
    expect(browser).toContain('codeInput.value = ""');
  });

  it("uses only same-origin credentialed Identity requests", () => {
    expect(browser).toContain('credentials: "same-origin"');
    expect(browser).toContain('redirect: "error"');
    expect(browser).not.toMatch(/https?:\/\//u);
  });

  it("exposes a server-correlated first-purchase refund surface", () => {
    expect(html).toContain('id="refund-panel"');
    expect(html).toContain('id="refund-submit"');
    expect(browser).toContain("AccountBillingRefundController");
    expect(browser).toContain("first-purchase-refund");
    expect(browser).toContain("purchaseId");
    expect(browser).toContain("refundRecovery.recover");
    expect(browser).toContain("refundRecovery.retryRefund()");
    expect(html).toMatch(/id="refund-copy"[^>]*role="status"[^>]*aria-live="polite"/u);
    expect(html.match(/data-checkout="[^"]+"[^>]*disabled/gmu)).toHaveLength(3);
  });

  it("partitions recovery custody by the authenticated server namespace", () => {
    expect(browser).toContain("createNamespacedRecoveryStore");
    expect(browser).toContain("readAuthenticatedSession");
    expect(browser).toContain("activeBillingContext = null");
    expect(browser).toContain("createBillingContext(sessionValue.namespace)");
    expect(browser).toContain("invalidateBillingContext()");
    expect(browser).toContain("event.newValue === null");
    expect(browser).not.toContain('localStorage.getItem("gooddealer.billing.checkout.v1")');
  });

  it("keeps account tabs and panels accessible and synchronizes selection state", () => {
    expect(html).toContain('role="tablist"');
    expect(html).toContain('id="login-tab" class="tab active" type="button" role="tab" aria-selected="true" aria-controls="access-form"');
    expect(html).toContain('id="register-tab" class="tab" type="button" role="tab" aria-selected="false" aria-controls="access-form"');
    expect(html).toContain('id="access-form" class="access-form" role="tabpanel" aria-labelledby="login-tab"');
    expect(browser).toContain('loginTab.setAttribute("aria-selected"');
    expect(browser).toContain('registerTab.setAttribute("aria-selected"');
    expect(browser).toContain('accessForm.setAttribute("aria-labelledby"');
    const namespaceSwitch = browser.indexOf("if (event.key !== ACTIVE_ACCOUNT_NAMESPACE_KEY) return;");
    const disableCheckout = browser.indexOf("setCheckoutEligibility(false);", namespaceSwitch);
    const resetRefund = browser.indexOf("resetRefundUi();", namespaceSwitch);
    const reinitialize = browser.indexOf("void initialize();", namespaceSwitch);
    expect(namespaceSwitch).toBeGreaterThan(-1);
    expect(disableCheckout).toBeGreaterThan(namespaceSwitch);
    expect(resetRefund).toBeGreaterThan(namespaceSwitch);
    expect(reinitialize).toBeGreaterThan(disableCheckout);
    expect(reinitialize).toBeGreaterThan(resetRefund);
    expect(browser).toContain("activeBillingContext = null;");
    expect(browser).toContain('recoveryStorageKey("gooddealer.billing.refund", context.namespace)');
  });

  it("owns busy-state cleanup and refund custody refresh by the active context", () => {
    expect(browser).toContain("if (checkoutBusyOwner === context)");
    expect(browser).toContain("markDeterministicallyRejected(requestId, error.payload)");
    expect(browser).toContain("if (!isCurrentBillingContext(context)) return;");
    expect(browser).toContain("recoveryStorageKey(\"gooddealer.billing.refund\", context.namespace)");
    expect(browser).toContain("resetRefundUi()");
    expect(browser).toContain("delete refundSubmit.dataset.purchaseId");
    const refundStart = browser.indexOf("async function submitRefund");
    const refundEnd = browser.indexOf("function scheduleRefundRecovery", refundStart);
    const refundBody = browser.slice(refundStart, refundEnd);
    expect(refundBody.match(/if \(!isCurrentBillingContext\(context\)\) return;/gu)).toHaveLength(2);
    expect(refundBody.indexOf("if (!isCurrentBillingContext(context)) return;"))
      .toBeLessThan(refundBody.indexOf('refundCopy.textContent = "退款结果尚未确认'));
  });

  it("synchronously removes stale refund actions before cross-tab custody refresh", () => {
    const refundStorageEvent = browser.indexOf('event.key === recoveryStorageKey("gooddealer.billing.refund"');
    const resetRefund = browser.indexOf("resetRefundUi();", refundStorageEvent);
    const reinitialize = browser.indexOf("void initialize();", refundStorageEvent);
    expect(refundStorageEvent).toBeGreaterThan(-1);
    expect(resetRefund).toBeGreaterThan(refundStorageEvent);
    expect(reinitialize).toBeGreaterThan(resetRefund);
    expect(browser).toContain("refundPanel.hidden = true;");
    expect(browser).toContain("refundSubmit.disabled = true;");
    expect(browser).toContain("refundRetryReady = false;");
    expect(browser).toContain("delete refundSubmit.dataset.purchaseId;");
  });

  it("supersedes initialization even when no active billing context exists", () => {
    const namespaceHandler = browser.indexOf("if (event.key !== ACTIVE_ACCOUNT_NAMESPACE_KEY) return;");
    const nullContext = browser.indexOf("activeBillingContext = null;", namespaceHandler);
    const generation = browser.indexOf("initializeGeneration = supersedeGeneration", namespaceHandler);
    const reinitialize = browser.indexOf("void initialize();", namespaceHandler);
    expect(generation).toBeGreaterThan(namespaceHandler);
    expect(nullContext).toBeGreaterThan(namespaceHandler);
    expect(reinitialize).toBeGreaterThan(generation);
  });
});
