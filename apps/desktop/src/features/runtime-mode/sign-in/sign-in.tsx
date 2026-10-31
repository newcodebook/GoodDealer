import { defaultLocale, getPresentationCopy, supportedLocales, type Locale } from "@gooddealer/i18n";
import { AlertTriangleIcon, Button, ExternalLinkIcon, RefreshCwIcon, SegmentedControl, ShieldIcon, StatusDot } from "@gooddealer/ui";
import markUrl from "@gooddealer/ui/assets/logo/mark.svg";

import { NativeWindow, type ShellWindowFrame } from "../../../app-shell";
import "./sign-in.css";

/**
 * Sanitized sign-in progress. Native runs Authorization Code + PKCE in the system browser, so the
 * Renderer only ever learns which of these states it is in; it never sees a URL, code, or token.
 */
export type BrowserSignInState =
  | "signed_out"
  | "pending"
  | "establishing"
  | "authorization_failed"
  | "authorization_retryable"
  | "host_unavailable";

export interface SignInProps {
  readonly locale: Locale;
  readonly state: BrowserSignInState;
  readonly windowFrame: ShellWindowFrame;
  /** Asks Native to open the system browser at the fixed authorization endpoint. */
  readonly onBegin?: () => void;
  /** Asks Native to retry the authorization refresh; offered only for the retryable state. */
  readonly onRetry?: () => void;
  readonly onLocaleChange?: (locale: Locale) => void;
}

/** Account gate: brand panel beside the browser sign-in progress. No credential is entered here. */
export function SignIn({ locale, state, windowFrame, onBegin, onRetry, onLocaleChange }: SignInProps) {
  const copy = getPresentationCopy(locale, "signIn");
  const busy = state === "pending" || state === "establishing";

  return (
    <div className="signin-window">
      <NativeWindow locale={locale} windowFrame={windowFrame} context={copy.context}>
        <div className="signin">
          <aside className="signin-brand">
            <div className="signin-brand-glow" aria-hidden="true" />
            <div className="signin-brand-mark">
              <img src={markUrl} width="132" height="132" alt="GoodDealer" />
              <span className="signin-tagline">{copy.tagline}</span>
            </div>
            <div className="signin-brand-foot">
              <span className="signin-rule" />
              <span className="signin-trust"><ShieldIcon size={14} />{copy.accountCredentialTrust}</span>
              <span className="signin-quota"><StatusDot kind="active" size={7} />{copy.deviceQuota}</span>
            </div>
          </aside>
          <div className="signin-panel">
            {onLocaleChange === undefined ? null : (
              <div className="signin-locale">
                <SegmentedControl
                  label="Language"
                  value={locale}
                  onChange={onLocaleChange}
                  items={supportedLocales.map((value) => ({ value, label: value === defaultLocale ? copy.chineseLanguageLabel : copy.englishLanguageLabel }))}
                />
              </div>
            )}
            <div className="signin-form" aria-live="polite">
              <header>
                <h1 className="signin-title">{copy.signInTitle}</h1>
                <p className="gd-t-body-2">{copy.browserDescription}</p>
              </header>

              {state === "authorization_failed" ? <p className="signin-alert" role="alert"><AlertTriangleIcon size={14} />{copy.signInFailed}</p> : null}
              {state === "authorization_retryable" ? <p className="signin-alert signin-alert--warning" role="alert"><AlertTriangleIcon size={14} />{copy.retryableNotice}</p> : null}
              {state === "host_unavailable" ? <p className="signin-alert" role="alert"><AlertTriangleIcon size={14} />{copy.hostUnavailable}</p> : null}

              {busy ? (
                <div className="signin-progress">
                  <RefreshCwIcon size={15} className="signin-spin" />
                  <span>{state === "pending" ? copy.waitingForBrowser : copy.establishing}</span>
                </div>
              ) : null}

              {state === "authorization_retryable" && onRetry !== undefined ? (
                <Button variant="primary" size="lg" block icon={<RefreshCwIcon size={15} />} onClick={onRetry}>{copy.retry}</Button>
              ) : null}
              {state !== "host_unavailable" && state !== "establishing" && onBegin !== undefined ? (
                <Button
                  variant={state === "authorization_retryable" ? "secondary" : state === "pending" ? "ghost" : "primary"}
                  size="lg"
                  block
                  icon={<ExternalLinkIcon size={15} />}
                  onClick={onBegin}
                >
                  {state === "pending" ? copy.reopenBrowser : state === "signed_out" ? copy.continueInBrowser : copy.signInAgain}
                </Button>
              ) : null}

              <p className="signin-switch gd-t-meta">{copy.accountPagesNotice}</p>
            </div>
          </div>
        </div>
      </NativeWindow>
    </div>
  );
}
