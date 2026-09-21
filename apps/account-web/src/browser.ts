import {
  BILLING_CHECKOUT_CREATE_OPERATION_ID,
  BILLING_FIXED_TERM_CONFIRM_OPERATION_ID,
  BILLING_FIRST_PURCHASE_REFUND_REQUEST_OPERATION_ID,
  BILLING_FIRST_PURCHASE_REFUND_STATUS_READ_OPERATION_ID,
  BILLING_STATUS_READ_OPERATION_ID,
  BILLING_SUBSCRIPTION_CANCEL_OPERATION_ID,
  BillingClient,
  type CloudOperationId,
  type CloudTransport,
} from "@gooddealer/cloud-client";
import {
  BILLING_SCHEMA_VERSION,
  type BillingFirstPurchaseRefundAcceptedResponse,
  type BillingStatusReadResponse,
  type CommercialOffer,
} from "@gooddealer/protocol/account";

import {
  AccountBillingRecoveryController,
  AccountBillingRefundController,
  type BillingCheckoutRecoveryRecord,
  type BillingRefundRecoveryRecord,
} from "./billing-recovery-controller";
import {
  refundablePurchase,
  refundProgressPresentation,
} from "./billing-refund-presentation";
import {
  ACTIVE_ACCOUNT_NAMESPACE_KEY,
  createAccountNamespaceFence,
  createNamespacedRecoveryStore,
  parseAuthenticatedIdentitySession,
  recoveryStorageKey,
  supersedeGeneration,
} from "./browser-storage";

const routes: Readonly<Partial<Record<CloudOperationId, { readonly method: "GET" | "POST"; readonly path: string }>>> = {
  [BILLING_CHECKOUT_CREATE_OPERATION_ID]: { method: "POST", path: "/v1/account/billing/checkout" },
  [BILLING_STATUS_READ_OPERATION_ID]: { method: "GET", path: "/v1/account/billing/status" },
  [BILLING_SUBSCRIPTION_CANCEL_OPERATION_ID]: { method: "POST", path: "/v1/account/billing/subscription/cancel" },
  [BILLING_FIXED_TERM_CONFIRM_OPERATION_ID]: { method: "POST", path: "/v1/account/billing/fixed-term/confirm" },
  [BILLING_FIRST_PURCHASE_REFUND_REQUEST_OPERATION_ID]: {
    method: "POST", path: "/v1/account/billing/first-purchase-refund",
  },
  [BILLING_FIRST_PURCHASE_REFUND_STATUS_READ_OPERATION_ID]: {
    method: "POST", path: "/v1/account/billing/first-purchase-refund/status",
  },
};

class HttpFailure extends Error {
  constructor(readonly status: number, readonly payload: unknown) {
    super(`GoodDealer request failed with HTTP ${status}`);
  }
}

const transport: CloudTransport = {
  async send(operationId, payload): Promise<unknown> {
    const route = routes[operationId];
    if (route === undefined) throw new TypeError("Account Web operation is unavailable");
    const request: RequestInit = {
      method: route.method,
      credentials: "same-origin",
      redirect: "error",
      ...(route.method === "POST" ? {
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      } : {}),
    };
    const response = await fetch(route.path, request);
    const value = response.headers.get("content-type")?.startsWith("application/json") === true
      ? await response.json() as unknown : null;
    if (!response.ok) throw new HttpFailure(response.status, value);
    return value;
  },
};

const billing = new BillingClient(transport);
const accountNamespaceFence = createAccountNamespaceFence();
interface BillingContext {
  readonly namespace: string;
  readonly recovery: AccountBillingRecoveryController;
  readonly refundRecovery: AccountBillingRefundController;
}
function createBillingContext(namespace: string): BillingContext {
  let context: BillingContext | undefined;
  const assertCurrent = (): void => {
    if (context === undefined || activeBillingContext !== context
      || !accountNamespaceFence.isCurrent(namespace)) {
      throw new TypeError("billing session changed while recovery was in progress");
    }
  };
  context = {
    namespace,
    recovery: new AccountBillingRecoveryController(billing,
      createNamespacedRecoveryStore<BillingCheckoutRecoveryRecord>("gooddealer.billing.checkout", namespace),
      assertCurrent),
    refundRecovery: new AccountBillingRefundController(billing,
      createNamespacedRecoveryStore<BillingRefundRecoveryRecord>("gooddealer.billing.refund", namespace),
      () => new Date(), assertCurrent),
  };
  return context;
}
function isCurrentBillingContext(context: BillingContext): boolean {
  return activeBillingContext === context && accountNamespaceFence.isCurrent(context.namespace);
}
const accessPanel = requiredElement("access-panel");
const billingPanel = requiredElement("billing-panel");
const accessForm = requiredForm("access-form");
const verifyForm = requiredForm("verify-form");
const accessNotice = requiredElement("access-notice");
const emailInput = requiredInput("email");
const passwordInput = requiredInput("password");
const codeInput = requiredInput("verification-code");
const loginTab = requiredButton("login-tab");
const registerTab = requiredButton("register-tab");
const accessSubmit = requiredButton("access-submit");
const sessionState = requiredElement("session-state");
const notice = requiredElement("notice");
const refundPanel = requiredElement("refund-panel");
const refundCopy = requiredElement("refund-copy");
const refundSubmit = requiredButton("refund-submit");
const buttons = [...document.querySelectorAll<HTMLButtonElement>("[data-checkout]")];
const refundPollIntervalMs = 3_000;
const refundPollWindowMs = 120_000;
let refundPollTimer: number | null = null;
let refundPollDeadline: number | null = null;
let checkoutEligible = false;
let checkoutBusy = false;
let refundRetryReady = false;
let initializeGeneration = 0;
let refundFlowGeneration = 0;
let activeBillingContext: BillingContext | null = null;
let checkoutBusyOwner: BillingContext | null = null;

for (const button of buttons) {
  button.addEventListener("click", () => { void beginCheckout(button); });
}
let accessMode: "login" | "register" = "login";
loginTab.addEventListener("click", () => setAccessMode("login"));
registerTab.addEventListener("click", () => setAccessMode("register"));
accessForm.addEventListener("submit", (event) => { event.preventDefault(); void submitAccess(); });
verifyForm.addEventListener("submit", (event) => { event.preventDefault(); void submitVerification(); });
refundSubmit.addEventListener("click", () => { void submitRefund(); });
window.addEventListener("storage", (event) => {
  const context = activeBillingContext;
  if (context !== null
    && event.key === recoveryStorageKey("gooddealer.billing.refund", context.namespace)) {
    initializeGeneration = supersedeGeneration(initializeGeneration);
    stopRefundRecovery();
    resetRefundUi();
    setCheckoutEligibility(false);
    void initialize();
    return;
  }
  if (event.key !== ACTIVE_ACCOUNT_NAMESPACE_KEY) return;
  if (event.newValue === null) {
    initializeGeneration = supersedeGeneration(initializeGeneration);
    activeBillingContext = null;
    checkoutBusyOwner = null;
    stopRefundRecovery();
    resetRefundUi();
    setCheckoutEligibility(false);
    setCheckoutBusy(false);
    billingPanel.hidden = true;
    accessPanel.hidden = false;
    return;
  }
  {
    initializeGeneration = supersedeGeneration(initializeGeneration);
    activeBillingContext = null;
    checkoutBusyOwner = null;
    stopRefundRecovery();
    setCheckoutEligibility(false);
    resetRefundUi();
    setCheckoutBusy(false);
    void initialize();
  }
});
void initialize();

async function initialize(): Promise<void> {
  initializeGeneration = supersedeGeneration(initializeGeneration);
  const generation = initializeGeneration;
  stopRefundRecovery();
  activeBillingContext = null;
  resetRefundUi();
  let session: Response;
  try {
    session = await fetch("/v1/identity/session", { credentials: "same-origin", redirect: "error" });
  } catch {
    if (generation !== initializeGeneration) return;
    accessPanel.hidden = false;
    billingPanel.hidden = true;
    showAccessNotice("账户服务暂时不可用，请稍后重试。", true);
    return;
  }
  if (!session.ok) {
    if (generation !== initializeGeneration) return;
    if (session.status === 401) accountNamespaceFence.clear();
    accessPanel.hidden = false;
    billingPanel.hidden = true;
    return;
  }
  const sessionValue = await readAuthenticatedSession(session);
  if (sessionValue === null) {
    if (generation !== initializeGeneration) return;
    accessPanel.hidden = false;
    billingPanel.hidden = true;
    showAccessNotice("账户会话响应无效，请重新登录。", true);
    return;
  }
  if (generation !== initializeGeneration) return;
  accountNamespaceFence.activate(sessionValue.namespace);
  const context = createBillingContext(sessionValue.namespace);
  activeBillingContext = context;
  accessPanel.hidden = true;
  billingPanel.hidden = false;
  if (location.pathname === "/billing/success") showNotice("Stripe 已返回 GoodDealer。正在等待已认证 webhook 完成结算确认。", false);
  if (location.pathname === "/billing/cancel") showNotice("本次付款已取消，没有创建新的商业授权。", false);
  try {
    const result = await context.recovery.recover();
    if (generation !== initializeGeneration || context !== activeBillingContext) return;
    if (result.state === "checkout_recovered") {
      setCheckoutEligibility(false);
      showNotice("检测到未完成的 Stripe Checkout，可继续前往 Provider 托管页面。", false);
      await context.recovery.navigateToApproval(result.checkout, sameOriginNavigator);
      return;
    }
    setCheckoutEligibility(result.status.state === "none");
    sessionState.textContent = result.status.state === "none" ? "账户会话有效 · 尚无付款计划" : `账户会话有效 · ${result.status.state}`;
    sessionState.className = "session-state active";
    renderRefundEligibility(result.status);
    const refundGeneration = refundFlowGeneration;
    try {
      const refundResult = await context.refundRecovery.recover();
      if (generation !== initializeGeneration || refundGeneration !== refundFlowGeneration
        || context !== activeBillingContext) return;
      if (refundResult.state === "refund_recovered") renderRefundResult(refundResult.response);
    } catch {
      if (generation !== initializeGeneration || refundGeneration !== refundFlowGeneration) return;
      scheduleRefundRecovery(context);
    }
  } catch (error) {
    if (generation !== initializeGeneration) return;
    setCheckoutEligibility(false);
    if (error instanceof HttpFailure && error.status === 401) {
      sessionState.textContent = "需要 GoodDealer Account 登录会话";
      sessionState.className = "session-state blocked";
      showNotice("Account Web 会话已失效，请重新登录。", true);
      return;
    }
    showNotice("暂时无法读取账单状态，请稍后重试。", true);
  }
}

async function readAuthenticatedSession(response: Response): Promise<{ readonly namespace: string } | null> {
  let value: unknown;
  try { value = await response.json() as unknown; } catch { return null; }
  return parseAuthenticatedIdentitySession(value);
}

function renderRefundEligibility(status: BillingStatusReadResponse): void {
  refundRetryReady = false;
  const eligibility = refundablePurchase(status);
  if (eligibility === null) {
    refundPanel.hidden = true;
    return;
  }
  refundPanel.hidden = false;
  refundSubmit.hidden = false;
  refundSubmit.disabled = false;
  refundSubmit.textContent = "申请全额退款";
  refundCopy.textContent = `首次购买可退款至 ${formatTimestamp(eligibility.refundEligibleUntil)}。接受后商业功能会立即切换为只读。`;
  refundSubmit.dataset.purchaseId = eligibility.purchaseId;
}

function resetRefundUi(): void {
  refundRetryReady = false;
  refundPanel.hidden = true;
  refundSubmit.hidden = false;
  refundSubmit.disabled = true;
  delete refundSubmit.dataset.purchaseId;
}

function renderRefundResult(response: BillingFirstPurchaseRefundAcceptedResponse): void {
  const presentation = refundProgressPresentation(response, formatTimestamp);
  refundRetryReady = presentation.action === "retry";
  refundPanel.hidden = false;
  refundSubmit.dataset.purchaseId = response.purchaseId;
  refundSubmit.disabled = presentation.action !== "retry";
  refundSubmit.hidden = presentation.action === "hidden";
  refundSubmit.textContent = presentation.action === "retry" ? "重试退款" : "申请全额退款";
  refundCopy.textContent = presentation.message;
  sessionState.textContent = `账户会话有效 · ${response.commercialAccess === "read_only" ? "商业只读" : response.state}`;
  if (presentation.shouldPoll) scheduleRefundRecovery(activeBillingContext);
  else stopRefundRecovery();
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: "short" });
}

async function submitRefund(): Promise<void> {
  const context = activeBillingContext;
  if (context === null) return;
  const purchaseId = refundSubmit.dataset.purchaseId;
  if (purchaseId === undefined) return;
  if (!window.confirm("接受退款后，GoodDealer 商业功能会立即切换为只读。确认申请首购全额退款？")) return;
  stopRefundRecovery();
  checkoutBusyOwner = context;
  setCheckoutBusy(true);
  refundSubmit.disabled = true;
  refundCopy.textContent = "正在提交首购退款请求…";
  try {
    const response = refundRetryReady
      ? await context.refundRecovery.retryRefund()
      : await context.refundRecovery.requestRefund({ schemaVersion: BILLING_SCHEMA_VERSION,
          requestId: `refund-${crypto.randomUUID()}`, purchaseId });
    if (!isCurrentBillingContext(context)) return;
    if (response.state === "rejected") {
      refundPanel.hidden = false;
      refundSubmit.hidden = true;
      refundCopy.textContent = `退款申请未接受：${refundReason(response.reason)}`;
    } else renderRefundResult(response);
  } catch {
    if (!isCurrentBillingContext(context)) return;
    refundCopy.textContent = "退款结果尚未确认。请保留当前页面，刷新后系统会使用同一请求身份恢复。";
    scheduleRefundRecovery(context);
  } finally {
    if (checkoutBusyOwner === context) {
      checkoutBusyOwner = null;
      setCheckoutBusy(false);
    }
  }
}

function scheduleRefundRecovery(context: BillingContext | null, generation: number = initializeGeneration): void {
  if (context === null || context !== activeBillingContext) return;
  const refundGeneration = refundFlowGeneration;
  if (refundPollDeadline === null) refundPollDeadline = Date.now() + refundPollWindowMs;
  if (Date.now() >= refundPollDeadline || refundPollTimer !== null) return;
  refundPollTimer = window.setTimeout(() => {
    refundPollTimer = null;
    void recoverRefundProgress(generation, refundGeneration, context);
  }, refundPollIntervalMs);
}

async function recoverRefundProgress(generation: number, refundGeneration: number, context: BillingContext): Promise<void> {
  if (generation !== initializeGeneration || refundGeneration !== refundFlowGeneration
    || context !== activeBillingContext) return;
  try {
    const result = await context.refundRecovery.recover();
    if (generation !== initializeGeneration || refundGeneration !== refundFlowGeneration
      || context !== activeBillingContext) return;
    if (result.state === "refund_recovered") {
      renderRefundResult(result.response);
      return;
    }
    stopRefundRecovery();
    await initialize();
  } catch {
    if (generation === initializeGeneration && refundGeneration === refundFlowGeneration) {
      scheduleRefundRecovery(context, generation);
    }
  }
}

function stopRefundRecovery(): void {
  if (refundPollTimer !== null) window.clearTimeout(refundPollTimer);
  refundPollTimer = null;
  refundPollDeadline = null;
  refundFlowGeneration += 1;
}

function refundReason(reason: string): string {
  const messages: Record<string, string> = {
    not_first_paid_purchase: "该付款不是账号首次结算购买。",
    window_elapsed: "首购退款窗口已结束。",
    not_paid: "付款尚未完成结算。",
    already_claimed: "该首购退款资格已被使用。",
    already_fully_reversed: "该付款已经全额冲正。",
    purchase_mismatch: "付款身份不匹配。",
  };
  return messages[reason] ?? "当前付款不符合退款条件。";
}

async function submitAccess(): Promise<void> {
  invalidateBillingContext();
  setAccessDisabled(true);
  showAccessNotice(accessMode === "login" ? "正在登录…" : "正在创建验证请求…", false);
  try {
    const response = await identityPost(
      accessMode === "login" ? "/v1/identity/login" : "/v1/identity/registration",
      { email: emailInput.value, password: passwordInput.value },
    );
    passwordInput.value = "";
    if (!response.ok) {
      showAccessNotice(accessMode === "login" ? "邮箱或密码无效。" : "请检查邮箱和密码格式。", true);
      return;
    }
    if (accessMode === "register") {
      accessForm.hidden = true;
      verifyForm.hidden = false;
      showAccessNotice("验证码已进入开发邮件收件箱。请输入 6 位验证码。", false);
      codeInput.focus();
      return;
    }
    await enterBilling();
  } catch {
    showAccessNotice("账户服务暂时不可用，请稍后重试。", true);
  } finally {
    setAccessDisabled(false);
  }
}

async function submitVerification(): Promise<void> {
  invalidateBillingContext();
  setAccessDisabled(true);
  try {
    const response = await identityPost("/v1/identity/registration/verify", {
      email: emailInput.value, code: codeInput.value,
    });
    codeInput.value = "";
    if (!response.ok) {
      showAccessNotice("验证码无效、已过期或尝试次数已用尽。", true);
      return;
    }
    await enterBilling();
  } catch {
    showAccessNotice("验证服务暂时不可用，请稍后重试。", true);
  } finally {
    setAccessDisabled(false);
  }
}

async function identityPost(path: string, body: Record<string, string>): Promise<Response> {
  return fetch(path, {
    method: "POST", credentials: "same-origin", redirect: "error",
    headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
}

/** Invalidate all browser-side account authority before a request that may replace the session cookie. */
function invalidateBillingContext(): void {
  initializeGeneration = supersedeGeneration(initializeGeneration);
  activeBillingContext = null;
  checkoutBusyOwner = null;
  stopRefundRecovery();
  resetRefundUi();
  accountNamespaceFence.clear();
  setCheckoutEligibility(false);
  setCheckoutBusy(false);
}

async function enterBilling(): Promise<void> {
  accessPanel.hidden = true;
  billingPanel.hidden = false;
  await initialize();
}

function setAccessMode(mode: "login" | "register"): void {
  accessMode = mode;
  loginTab.classList.toggle("active", mode === "login");
  registerTab.classList.toggle("active", mode === "register");
  accessSubmit.textContent = mode === "login" ? "登录" : "创建账户";
  passwordInput.autocomplete = mode === "login" ? "current-password" : "new-password";
  accessForm.hidden = false;
  verifyForm.hidden = true;
  loginTab.setAttribute("aria-selected", mode === "login" ? "true" : "false");
  registerTab.setAttribute("aria-selected", mode === "register" ? "true" : "false");
  accessForm.setAttribute("aria-labelledby", mode === "login" ? "login-tab" : "register-tab");
  accessNotice.hidden = true;
}

function setAccessDisabled(disabled: boolean): void {
  for (const control of [emailInput, passwordInput, codeInput, loginTab, registerTab, accessSubmit]) {
    control.disabled = disabled;
  }
}

function showAccessNotice(message: string, error: boolean): void {
  accessNotice.hidden = false;
  accessNotice.textContent = message;
  accessNotice.dataset.tone = error ? "error" : "info";
}

async function beginCheckout(button: HTMLButtonElement): Promise<void> {
  const context = activeBillingContext;
  if (context === null) return;
  const offer = button.dataset.checkout;
  if (offer !== "monthly" && offer !== "annual" && offer !== "ten_year") return;
  checkoutBusyOwner = context;
  setCheckoutBusy(true);
  showNotice("正在创建 Stripe 托管 Checkout…", false);
  const campaignInput = document.querySelector<HTMLInputElement>("#campaign");
  const campaignCode = campaignInput?.value.trim().toUpperCase() || null;
  const requestId = `web-${crypto.randomUUID()}`;
  try {
    const checkout = await context.recovery.startCheckout({
      schemaVersion: BILLING_SCHEMA_VERSION,
      requestId,
      provider: "stripe",
      offer: offer satisfies CommercialOffer,
      campaignCode,
    });
    if (!isCurrentBillingContext(context)) return;
    await context.recovery.navigateToApproval(checkout, sameOriginNavigator);
  } catch (error) {
    if (error instanceof HttpFailure && isDeterministicCheckoutRejection(error.payload)) {
      try {
        await context.recovery.markDeterministicallyRejected(requestId, error.payload);
      } catch {
        if (!isCurrentBillingContext(context)) return;
      }
    }
    if (!isCurrentBillingContext(context)) return;
    showNotice(error instanceof HttpFailure && error.status === 401
      ? "登录会话无效，请重新登录后再试。"
      : "Checkout 创建结果尚未确认。请保留当前页面，刷新后系统会使用同一请求身份恢复。", true);
  } finally {
    if (checkoutBusyOwner === context) {
      checkoutBusyOwner = null;
      setCheckoutBusy(false);
    }
  }
}

const sameOriginNavigator = {
  navigate(relativePath: string): void {
    const target = new URL(relativePath, location.origin);
    if (target.origin !== location.origin || !target.pathname.startsWith("/billing/approval/")) {
      throw new TypeError("billing approval path is invalid");
    }
    location.assign(target);
  },
};

function isDeterministicCheckoutRejection(value: unknown): boolean {
  return typeof value === "object" && value !== null
    && Reflect.get(value, "code") === "COMMERCIAL_CHECKOUT_REJECTED"
    && Reflect.get(value, "retryable") === false;
}

function setCheckoutEligibility(eligible: boolean): void {
  checkoutEligible = eligible;
  updateCheckoutButtons();
}

function setCheckoutBusy(busy: boolean): void {
  checkoutBusy = busy;
  updateCheckoutButtons();
}

function updateCheckoutButtons(): void {
  for (const button of buttons) button.disabled = checkoutBusy || !checkoutEligible;
}

function showNotice(message: string, error: boolean): void {
  notice.hidden = false;
  notice.textContent = message;
  notice.dataset.tone = error ? "error" : "info";
}

function requiredElement(id: string): HTMLElement {
  const value = document.getElementById(id);
  if (value === null) throw new TypeError(`missing Account Web element: ${id}`);
  return value;
}

function requiredForm(id: string): HTMLFormElement {
  const value = document.getElementById(id);
  if (!(value instanceof HTMLFormElement)) throw new TypeError(`missing Account Web form: ${id}`);
  return value;
}

function requiredInput(id: string): HTMLInputElement {
  const value = document.getElementById(id);
  if (!(value instanceof HTMLInputElement)) throw new TypeError(`missing Account Web input: ${id}`);
  return value;
}

function requiredButton(id: string): HTMLButtonElement {
  const value = document.getElementById(id);
  if (!(value instanceof HTMLButtonElement)) throw new TypeError(`missing Account Web button: ${id}`);
  return value;
}
