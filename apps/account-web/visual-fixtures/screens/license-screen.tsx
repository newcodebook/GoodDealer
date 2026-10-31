import type { Locale } from "@gooddealer/i18n";
import type { BillingStatusReadResponse } from "@gooddealer/protocol/account";
import { useState } from "react";

import { AccountLicense, type LicenseNotice } from "../../src/features/license/account-license";
import type { LicenseRefundState } from "../../src/features/license/license-view";
import { FixtureShell } from "./fixture-shell";

export const licenseVariants = [
  { id: "none", label: "未购买" },
  { id: "checkout-pending", label: "结账未完成" },
  { id: "active", label: "年付 · 可退款" },
  { id: "ten-year", label: "10 年固定期" },
  { id: "cancelling", label: "取消确认中" },
  { id: "ending", label: "到期后结束" },
  { id: "refund-retry", label: "退款等待重试" },
  { id: "rejected", label: "退款被拒" },
  { id: "read-only", label: "商业只读" },
] as const;

type LicenseVariant = (typeof licenseVariants)[number]["id"];

/** Fixtures evaluate against a pinned clock and UTC so every render is deterministic. */
const evaluatedAtMs = Date.parse("2026-10-31T09:00:00.000Z");
const paidThrough = "2027-10-24T00:00:00.000Z";
const subscription = {
  schemaVersion: 1,
  provider: "stripe",
  offer: "annual",
  purchaseId: "pur_fixture_annual",
  paidThrough,
  refundEligibleUntil: "2026-11-07T00:00:00.000Z",
} as const;
const none: BillingStatusReadResponse = {
  schemaVersion: 1, state: "none", provider: null, offer: null, paidThrough: null, refundEligibleUntil: null,
};
const accepted = {
  schemaVersion: 1,
  refundRequestId: "rr_fixture",
  purchaseId: "pur_fixture_annual",
  commercialAccess: "read_only",
  requestedAmount: { minor: 9800, currency: "USD" },
} as const;

const fixtures: Record<LicenseVariant, { status: BillingStatusReadResponse; refund: LicenseRefundState; notice: LicenseNotice | null }> = {
  none: { status: none, refund: { kind: "none" }, notice: null },
  "checkout-pending": {
    status: { schemaVersion: 1, state: "approval_pending", provider: "stripe", offer: "monthly", checkoutId: "chk_fixture",
      requestId: "web-fixture", campaignCode: null, retryMode: "same_request", paidThrough: null, refundEligibleUntil: null },
    refund: { kind: "none" },
    notice: null,
  },
  active: { status: { ...subscription, state: "active" }, refund: { kind: "none" }, notice: { key: "noticeCheckoutReturned", tone: "info" } },
  "ten-year": {
    status: { ...subscription, offer: "ten_year", paidThrough: "2036-10-24T00:00:00.000Z", refundEligibleUntil: null, state: "active" },
    refund: { kind: "none" },
    notice: null,
  },
  cancelling: { status: { ...subscription, refundEligibleUntil: null, requestId: "cancel-fixture", state: "cancellation_pending" }, refund: { kind: "none" }, notice: null },
  ending: { status: { ...subscription, refundEligibleUntil: null, requestId: "cancel-fixture", state: "cancel_at_period_end" }, refund: { kind: "none" }, notice: null },
  "refund-retry": {
    status: { ...subscription, state: "active" },
    refund: { kind: "progress", response: { ...accepted, state: "retry_wait", retryable: true, retryAfter: "2026-10-31T08:30:00.000Z" } },
    notice: null,
  },
  rejected: { status: { ...subscription, state: "active" }, refund: { kind: "rejected", reason: "already_claimed" }, notice: null },
  "read-only": {
    status: { schemaVersion: 1, state: "commercial_read_only", provider: "stripe", offer: "annual", paidThrough: "2026-10-20T00:00:00.000Z", refundEligibleUntil: null },
    refund: { kind: "none" },
    notice: null,
  },
};

/**
 * Mock billing flow over typed wire fixtures. Actions settle locally after a short delay; nothing
 * reaches Cloud or Stripe. Production composes the same component with the billing recovery
 * controllers, request identities, and same-origin approval navigation.
 */
export function LicenseScreen({ variant, locale }: { readonly variant: string; readonly locale: Locale }) {
  const start = fixtures[(variant in fixtures ? variant : "active") as LicenseVariant];
  const [status, setStatus] = useState(start.status);
  const [refund, setRefund] = useState(start.refund);
  const [notice, setNotice] = useState(start.notice);
  const [busy, setBusy] = useState(false);
  const settle = (next: () => void) => {
    setBusy(true);
    setTimeout(() => { setBusy(false); next(); }, 700);
  };

  return (
    <FixtureShell locale={locale} routeId="license">
      <AccountLicense
        locale={locale}
        timeZone="UTC"
        evaluatedAtMs={evaluatedAtMs}
        status={status}
        refund={refund}
        notice={notice}
        busy={busy}
        onCheckout={() => { setNotice({ key: "noticeCheckoutCreating", tone: "info" }); settle(() => setNotice({ key: "noticeCheckoutUnconfirmed", tone: "error" })); }}
        onContinueCheckout={() => settle(() => setNotice({ key: "noticeCheckoutCancelled", tone: "info" }))}
        onCancelRenewal={() => {
          if (status.state !== "active") return;
          settle(() => setStatus({ ...status, refundEligibleUntil: null, requestId: "cancel-fixture", state: "cancel_at_period_end" }));
        }}
        onRequestRefund={() => {
          setRefund({ kind: "submitting" });
          settle(() => setRefund({ kind: "progress", response: { ...accepted, state: "refund_pending", retryable: false, retryAfter: null } }));
        }}
        onRetryRefund={() => {
          setRefund({ kind: "submitting" });
          settle(() => setRefund({ kind: "progress", response: { ...accepted, state: "refunded", retryable: false, retryAfter: null, completedAt: "2026-10-31T09:00:00.000Z" } }));
        }}
      />
    </FixtureShell>
  );
}
