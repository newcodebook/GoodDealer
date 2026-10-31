import { formatDate, getAccountCopy, type AccountCopy, type Locale } from "@gooddealer/i18n";
import type { BillingStatusReadResponse, CommercialOffer } from "@gooddealer/protocol/account";
import {
  AlertTriangleIcon,
  Badge,
  Banner,
  Button,
  CheckIcon,
  Checkbox,
  Dialog,
  ExternalLinkIcon,
  Input,
  KeyValueList,
  KeyValueRow,
  MetricStrip,
  Money,
  Panel,
  type BadgeTone,
  type MetricTone,
} from "@gooddealer/ui";
import sealUrl from "@gooddealer/ui/assets/graphics/seal.svg";
import { useState } from "react";

import {
  commercialOffers,
  licensePhaseCopyKey,
  licenseView,
  offerCopyKey,
  offerListPrice,
  providerCopyKey,
  offerUnitCopyKey,
  refundProgressView,
  refundRejectionCopyKey,
  type LicensePhase,
  type LicenseRefundState,
} from "./license-view";
import "./account-license.css";

type LicenseCopy = AccountCopy["accountLicense"];

export type LicenseNoticeKey = keyof Pick<
  LicenseCopy,
  | "noticeCheckoutCreating"
  | "noticeCheckoutReturned"
  | "noticeCheckoutCancelled"
  | "noticeCheckoutUnconfirmed"
  | "noticeCancelUnconfirmed"
  | "noticeCheckoutRejected"
  | "noticeStatusUnavailable"
>;

export interface LicenseNotice {
  readonly key: LicenseNoticeKey;
  readonly tone: "info" | "success" | "error";
}

export interface AccountLicenseProps {
  readonly locale: Locale;
  /** IANA zone used for every date; production passes the browser's zone, fixtures pin UTC. */
  readonly timeZone: string;
  readonly evaluatedAtMs: number;
  readonly status: BillingStatusReadResponse;
  readonly refund: LicenseRefundState;
  readonly notice: LicenseNotice | null;
  /** True while a billing request is in flight; every billing action is disabled. */
  readonly busy: boolean;
  readonly onCheckout: (offer: CommercialOffer, campaignCode: string | null) => void;
  readonly onContinueCheckout: () => void;
  readonly onCancelRenewal: () => void;
  readonly onRequestRefund: (purchaseId: string) => void;
  readonly onRetryRefund: () => void;
}

type OpenDialog = { readonly kind: "checkout"; readonly offer: CommercialOffer } | { readonly kind: "cancel" } | { readonly kind: "refund" } | null;

/** Mirrors the wire `campaignCodeSchema`; Cloud still validates and maps the code itself. */
const campaignCodePattern = /^[A-Z0-9_-]{1,64}$/u;

const phaseBadgeTone = {
  none: "neutral",
  checkout_pending: "sync",
  active: "success",
  cancelling: "sync",
  ending: "warning",
  read_only: "neutral",
} as const satisfies Record<LicensePhase, BadgeTone>;

const phaseMetricTone = {
  none: "muted",
  checkout_pending: "blue",
  active: "success",
  cancelling: "blue",
  ending: "warning",
  read_only: "muted",
} as const satisfies Record<LicensePhase, MetricTone>;

const offerNoteKey = {
  monthly: "monthlyNote",
  annual: "annualNote",
  ten_year: "tenYearNote",
} as const satisfies Record<CommercialOffer, keyof LicenseCopy>;

/**
 * Subscription and License: the account's single commercial state from Cloud billing, the three
 * paid terms, Stripe-hosted checkout, renewal cancellation, and the first-purchase refund. It only
 * renders state and reports intent; recovery, request identities, and navigation stay in the caller.
 */
export function AccountLicense(props: AccountLicenseProps) {
  const { locale, timeZone, evaluatedAtMs, status, refund, notice, busy } = props;
  const copy = getAccountCopy(locale, "accountLicense");
  const shellCopy = getAccountCopy(locale, "accountShell");
  const view = licenseView(status, evaluatedAtMs, refund.kind);
  const [dialog, setDialog] = useState<OpenDialog>(null);
  const [campaignCode, setCampaignCode] = useState("");
  const [refundAcknowledged, setRefundAcknowledged] = useState(false);
  const date = (value: string) => formatDate(locale, Date.parse(value), { year: "numeric", month: "2-digit", day: "2-digit", timeZone });
  const dateTime = (value: string) => formatDate(locale, Date.parse(value), { dateStyle: "medium", timeStyle: "short", timeZone });
  const termName = (offer: CommercialOffer) => copy[offerCopyKey[offer]];
  const closeDialog = () => { setDialog(null); setCampaignCode(""); setRefundAcknowledged(false); };
  const normalizedCampaign = campaignCode.trim().toUpperCase();
  const campaignValid = normalizedCampaign === "" || campaignCodePattern.test(normalizedCampaign);

  const refundEligibilityVisible = view.refund !== null && refund.kind === "none";
  const progress = refund.kind === "progress" ? refundProgressView(refund.response, evaluatedAtMs) : null;
  const refundMessage = (() => {
    switch (refund.kind) {
      case "none": return view.refund === null ? null : copy.refundEligible.replace("{date}", date(view.refund.refundEligibleUntil));
      case "submitting": return copy.refundSubmitting;
      case "unconfirmed": return copy.refundUnconfirmed;
      case "rejected": return copy[refundRejectionCopyKey[refund.reason]];
      case "progress": return progress === null ? null
        : copy[progress.messageKey].replace("{time}", progress.retryAfter === null ? "" : dateTime(progress.retryAfter));
    }
  })();

  return (
    <div className="license">
      {/* The ribbon summarises a held term. Without one every cell would read "—", and the status it
          would repeat already sits on the panel badge, so the page opens on the work surface instead. */}
      {view.currentOffer === null ? null : (
      <MetricStrip
        wrap
        metrics={[
          { key: "term", label: copy.metricTerm, value: termName(view.currentOffer), tone: "gold", mono: false, meta: copy.singleTier },
          { key: "status", label: copy.metricStatus, value: copy[licensePhaseCopyKey[view.phase]], tone: phaseMetricTone[view.phase], mono: false, meta: view.currentOffer === "ten_year" ? copy.fixedTermNoRenewal : undefined },
          { key: "paid", label: copy.metricPaidThrough, value: view.paidThrough === null ? "—" : date(view.paidThrough), mono: true, meta: view.daysRemaining === null ? undefined : copy.daysRemaining.replace("{days}", String(view.daysRemaining)) },
          view.refund === null
            ? { key: "refund", label: copy.metricRefund, value: copy.refundUnavailable, tone: "muted", mono: false }
            // An open window is a deadline, not a success state, so it keeps the neutral value tone.
            : { key: "refund", label: copy.metricRefund, value: date(view.refund.refundEligibleUntil), mono: true, meta: copy.refundAvailable },
        ]}
      />
      )}

      {/* The live region stays mounted so assistive technology announces notices that appear later;
          a check mark is reserved for success, since info notices report work still in progress. */}
      <div className="license-notice" aria-live="polite">
        {notice === null ? null : (
          <Banner
            tone={notice.tone === "error" ? "danger" : notice.tone === "success" ? "success" : "sync"}
            icon={notice.tone === "error" ? <AlertTriangleIcon size={15} /> : notice.tone === "success" ? <CheckIcon size={15} /> : undefined}
          >
            {copy[notice.key]}
          </Banner>
        )}
      </div>

      <div className="license-body">
        <div className="license-main">
          <Panel title={copy.currentTermTitle} actions={<Badge tone={phaseBadgeTone[view.phase]} dot mono={false}>{copy[licensePhaseCopyKey[view.phase]]}</Badge>}>
            {view.currentOffer !== null ? (
              <div className="license-term">
                <span className="license-term-name">{copy.termLicense.replace("{term}", termName(view.currentOffer))}</span>
                <Money amount={offerListPrice[view.currentOffer]} size={16} showCurrency />
                <span className="license-term-unit">{copy[offerUnitCopyKey[view.currentOffer]]}</span>
              </div>
            ) : view.phase === "none" ? (
              <div className="license-empty">
                <span className="license-empty-title">{copy.noTerm}</span>
                <span className="gd-t-body-2">{copy.noTermDetail}</span>
              </div>
            ) : null}

            <PhaseCallout phase={view.phase} copy={copy} paidThrough={view.paidThrough === null ? null : date(view.paidThrough)} busy={busy} onContinueCheckout={props.onContinueCheckout} />

            {/* Paid-through and the refund deadline live in the ribbon and the refund panel; the list keeps
                only the facts shown nowhere else on the page. */}
            {view.currentOffer === null ? null : (
              <KeyValueList>
                <KeyValueRow label={copy.providerLabel} value={view.provider === null ? "—" : copy[providerCopyKey[view.provider]]} />
                <KeyValueRow
                  label={copy.renewalLabel}
                  value={view.currentOffer === "ten_year" ? copy.fixedTermNoRenewal
                    : view.phase === "active" ? copy.renewsAutomatically
                      : view.phase === "cancelling" ? copy.renewalConfirming
                        : view.phase === "ending" ? copy.renewalCancelled : "—"}
                />
              </KeyValueList>
            )}

            {view.canCancel ? (
              <div className="license-actions">
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => setDialog({ kind: "cancel" })}>{copy.cancelRenewal}</Button>
              </div>
            ) : null}
          </Panel>

          {refundMessage === null ? null : (
            <Panel title={copy.refundPanelTitle} actions={refund.kind === "progress" || refund.kind === "unconfirmed" ? <Badge tone="neutral" mono={false}>{copy.stateReadOnly}</Badge> : undefined}>
              <div className="license-refund">
                <span className="gd-t-body-2">{refundMessage}</span>
                {progress?.canRetry === true ? <Button size="sm" disabled={busy} onClick={props.onRetryRefund}>{copy.retryRefund}</Button> : null}
                {refundEligibilityVisible ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => setDialog({ kind: "refund" })}>{copy.requestRefund}</Button> : null}
              </div>
            </Panel>
          )}

        </div>

        <aside className="license-side">
          <Panel flush title={copy.compareTitle}>
            {/* One feature tier: the inclusions describe every term, so they sit with the comparison
                rather than with the held term's state. */}
            <div className="license-included">
              <span className="gd-t-label">{copy.includedTitle}</span>
              <ul className="license-features">
                {[copy.featureDevices, copy.featurePlatforms, copy.featureBatch, copy.featureSync].map((feature) => (
                  <li key={feature} className="license-feature"><CheckIcon size={13} aria-hidden="true" />{feature}</li>
                ))}
              </ul>
            </div>
            {commercialOffers.map((offer) => {
              const current = view.currentOffer === offer;
              return (
                <div key={offer} className={`license-offer${current ? " license-offer--current" : ""}`}>
                  <div className="license-offer-head">
                    <span className="license-offer-name">{termName(offer)}</span>
                    {current ? <Badge tone="gold" mono={false}>{copy.current}</Badge> : null}
                    <span className="license-offer-price">
                      <Money amount={offerListPrice[offer]} size={13} tone={current ? "gold" : "body"} />
                      <span className="license-offer-unit">{copy[offerUnitCopyKey[offer]]}</span>
                    </span>
                  </div>
                  <span className="license-offer-note">{copy[offerNoteKey[offer]]}</span>
                  {/* Equal weight on purpose: the page states facts per term and never nudges toward one. */}
                  {view.canCheckout ? (
                    <Button size="sm" block variant="secondary" disabled={busy} onClick={() => setDialog({ kind: "checkout", offer })}>
                      {copy.choose.replace("{term}", termName(offer))}
                    </Button>
                  ) : null}
                </div>
              );
            })}
            {view.canCheckout ? null : (
              <p className="license-offer-locked">
                {view.phase === "checkout_pending" ? copy.lockedCheckoutPending
                  : view.phase === "read_only" ? copy.lockedReadOnly
                    : view.refundOutcomePending ? copy.lockedRefundPending : copy.checkoutLockedNote}
              </p>
            )}
          </Panel>
        </aside>

        {/* Explanatory reference sits below the work surface: it follows the comparison in DOM and focus
            order, and the grid places it under the main column on wide layouts. */}
        <div className="license-reference">
          <Panel title={copy.authorityTitle}>
            <div className="license-authority">
              <img src={sealUrl} width="44" height="44" alt="" />
              <div className="license-authority-copy">
                <p className="gd-t-body-2">{copy.authorityBody}</p>
                <p className="license-rule"><strong>{copy.readOnlyRuleTitle}</strong>{copy.readOnlyRuleBody}</p>
              </div>
            </div>
          </Panel>
        </div>
      </div>

      <Dialog
        open={dialog?.kind === "checkout" && view.canCheckout}
        onClose={closeDialog}
        closeLabel={shellCopy.close}
        title={dialog?.kind === "checkout" ? copy.checkoutTitle.replace("{term}", termName(dialog.offer)) : undefined}
        width={460}
        footer={(
          <>
            <Button onClick={closeDialog}>{copy.dismiss}</Button>
            <Button
              variant="primary"
              icon={<ExternalLinkIcon size={13} />}
              disabled={busy || !campaignValid}
              onClick={() => {
                // Re-check at submit: a refreshed status may have closed checkout while the dialog was open.
                if (dialog?.kind !== "checkout" || !view.canCheckout) return;
                props.onCheckout(dialog.offer, normalizedCampaign === "" ? null : normalizedCampaign);
                closeDialog();
              }}
            >
              {copy.goToCheckout}
            </Button>
          </>
        )}
      >
        {dialog?.kind === "checkout" ? (
          <div className="license-dialog">
            <div className="license-dialog-term">
              <span>{termName(dialog.offer)}</span>
              <span className="license-offer-price"><Money amount={offerListPrice[dialog.offer]} size={15} showCurrency /><span className="license-offer-unit">{copy[offerUnitCopyKey[dialog.offer]]}</span></span>
            </div>
            <span className="gd-t-body-2">{copy.checkoutSummary}</span>
            <Input label={copy.campaignCode} mono maxLength={64} autoComplete="off" value={campaignCode} hint={copy.campaignHint} onChange={(event) => setCampaignCode(event.currentTarget.value)} />
            <span className="license-fineprint">{copy.checkoutTerms}</span>
          </div>
        ) : null}
      </Dialog>

      <Dialog
        open={dialog?.kind === "cancel" && view.canCancel}
        onClose={closeDialog}
        closeLabel={shellCopy.close}
        title={copy.cancelTitle}
        width={440}
        footer={(
          <>
            <Button onClick={closeDialog}>{copy.keepSubscription}</Button>
            <Button variant="primary" disabled={busy} onClick={() => { if (view.canCancel) props.onCancelRenewal(); closeDialog(); }}>
              {copy.confirmCancel.replace("{date}", view.paidThrough === null ? "—" : date(view.paidThrough))}
            </Button>
          </>
        )}
      >
        {/* Elevated tier (orange): access lasts to the paid-through date, so the outcome is predictable
            and needs an explanation, not the red acknowledgement gate reserved for irreversible acts. */}
        <Banner tone="warning" icon={<AlertTriangleIcon size={15} />}>
          {copy.cancelBody.replace("{date}", view.paidThrough === null ? "—" : date(view.paidThrough))}
        </Banner>
      </Dialog>

      <Dialog
        open={dialog?.kind === "refund"}
        onClose={closeDialog}
        closeLabel={shellCopy.close}
        title={copy.refundTitle}
        width={460}
        danger
        footer={(
          <>
            <Button onClick={closeDialog}>{copy.dismiss}</Button>
            <Button
              variant="danger"
              disabled={busy || !refundAcknowledged || view.refund === null}
              onClick={() => {
                if (view.refund === null) return;
                props.onRequestRefund(view.refund.purchaseId);
                closeDialog();
              }}
            >
              {copy.confirmRefund}
            </Button>
          </>
        )}
      >
        <div className="license-dialog">
          <p className="license-dialog-body">{copy.refundBody}</p>
          <div className="license-dialog-ack">
            <Checkbox checked={refundAcknowledged} onChange={() => setRefundAcknowledged((value) => !value)} label={copy.refundAck} />
          </div>
        </div>
      </Dialog>
    </div>
  );
}

function PhaseCallout(props: {
  readonly phase: LicensePhase;
  readonly copy: LicenseCopy;
  readonly paidThrough: string | null;
  readonly busy: boolean;
  readonly onContinueCheckout: () => void;
}) {
  const { phase, copy, paidThrough, busy } = props;
  switch (phase) {
    case "checkout_pending":
      return (
        <Banner tone="sync" icon={<ExternalLinkIcon size={15} />} actions={<Button size="sm" variant="primary" disabled={busy} onClick={props.onContinueCheckout}>{copy.continueCheckout}</Button>}>
          {copy.checkoutPendingDetail}
        </Banner>
      );
    case "cancelling":
      return <Banner tone="sync">{copy.cancellingDetail}</Banner>;
    case "ending":
      return <Banner tone="warning" icon={<AlertTriangleIcon size={15} />}>{copy.endingDetail.replace("{date}", paidThrough ?? "—")}</Banner>;
    case "read_only":
      return <Banner tone="neutral" icon={<AlertTriangleIcon size={15} />}>{copy.readOnlyDetail}</Banner>;
    case "none":
    case "active":
      return null;
  }
}
