import { getAccountCopy, type Locale } from "@gooddealer/i18n";
import { AlertTriangleIcon, Banner } from "@gooddealer/ui";
import { useEffect, useSyncExternalStore } from "react";

import { AccountShell } from "../app-shell/account-shell";
import { productionAccountRouteIds } from "../app-shell/account-route";
import { AccountAccess } from "../features/access/account-access";
import { AccountLicense } from "../features/license/account-license";
import type { AccountController } from "./account-controller";
import "./account-app.css";

export interface AccountAppProps {
  readonly controller: AccountController;
  readonly locale: Locale;
  readonly onLocaleChange: (locale: Locale) => void;
  /** Already-localised deployment label; absent in production. */
  readonly environmentLabel?: string;
  /** IANA zone of the viewer's browser for every billing date. */
  readonly timeZone: string;
}

/**
 * Production composition: access until Identity confirms a session, then the account shell with the
 * Cloud-backed routes only. All state and side effects live in the controller; this renders them.
 */
export function AccountApp({ controller, locale, onLocaleChange, environmentLabel, timeZone }: AccountAppProps) {
  const state = useSyncExternalStore(controller.subscribe, controller.getState);
  const shellCopy = getAccountCopy(locale, "accountShell");
  const licenseCopy = getAccountCopy(locale, "accountLicense");
  const label = environmentLabel === undefined ? {} : { environmentLabel };

  useEffect(() => { document.documentElement.lang = locale; }, [locale]);

  if (state.phase === "loading") return <div className="account-loading" aria-busy="true" />;

  if (state.phase === "access") {
    return (
      <AccountAccess
        locale={locale}
        step={state.accessStep}
        notice={state.accessNotice}
        busy={state.accessBusy}
        desktopHandoff={state.desktopHandoff}
        onLocaleChange={onLocaleChange}
        onStepChange={(step) => controller.setAccessStep(step)}
        onSignIn={(email, password) => { void controller.signIn(email, password); }}
        onRegister={(email, password) => { void controller.register(email, password); }}
        onVerify={(email, code) => { void controller.verify(email, code); }}
        onResendVerification={(email) => { void controller.resendVerification(email); }}
        onRequestReset={(email) => { void controller.requestPasswordReset(email); }}
        onCompleteReset={(email, code, password) => { void controller.completePasswordReset(email, code, password); }}
        {...label}
      />
    );
  }

  return (
    <AccountShell
      locale={locale}
      title={shellCopy.license}
      availableRouteIds={productionAccountRouteIds}
      activeRouteId="license"
      onNavigate={() => undefined}
      onSignOut={() => { void controller.signOut(); }}
      signingOut={state.signingOut}
      onRefresh={() => { void controller.refresh(); }}
      refreshing={state.refreshing}
      {...label}
      {...(state.signOutUnconfirmed
        ? { banner: <Banner tone="danger" icon={<AlertTriangleIcon size={15} />}>{shellCopy.signOutUnconfirmed}</Banner> }
        : {})}
    >
      {state.billingStatus === null ? (
        // No authoritative status for this account yet: show only why, never a guessed state or action.
        <div className="account-pending" aria-live="polite" aria-busy={state.refreshing}>
          {state.licenseNotice === null ? null : (
            <Banner
              tone={state.licenseNotice.tone === "error" ? "danger" : "sync"}
              icon={state.licenseNotice.tone === "error" ? <AlertTriangleIcon size={15} /> : undefined}
            >
              {licenseCopy[state.licenseNotice.key]}
            </Banner>
          )}
        </div>
      ) : (
        <AccountLicense
          locale={locale}
          timeZone={timeZone}
          evaluatedAtMs={state.evaluatedAtMs}
          status={state.billingStatus}
          refund={state.refund}
          notice={state.licenseNotice}
          busy={state.billingBusy || state.refreshing}
          onCheckout={(offer, campaignCode) => { void controller.checkout(offer, campaignCode); }}
          onContinueCheckout={() => { void controller.continueCheckout(); }}
          onCancelRenewal={() => { void controller.cancelRenewal(); }}
          onRequestRefund={(purchaseId) => { void controller.requestRefund(purchaseId); }}
          onRetryRefund={() => { void controller.retryRefund(); }}
        />
      )}
    </AccountShell>
  );
}
