import { defaultLocale, getAccountCopy, supportedLocales, type AccountCopy, type Locale } from "@gooddealer/i18n";
import { AlertTriangleIcon, Button, CheckIcon, ExternalLinkIcon, Input, MailIcon, RefreshCwIcon, SegmentedControl, ShieldIcon, StatusDot } from "@gooddealer/ui";
import markUrl from "@gooddealer/ui/assets/logo/mark.svg";
import { useState, type FormEvent } from "react";

import { accessSubmission, type AccessFields, type AccountAccessStep } from "./access-submission";
import "./account-access.css";

export type { AccountAccessStep } from "./access-submission";

/** Outcomes Identity reports; each maps to fixed copy so no server text reaches the page. */
export type AccountAccessNoticeKey = keyof Pick<
  AccountCopy["accountAccess"],
  | "invalidCredentials"
  | "invalidFormat"
  | "invalidEmail"
  | "rateLimited"
  | "serviceUnavailable"
  | "sessionInvalid"
  | "verificationSent"
  | "verificationResent"
  | "verified"
  | "codeRejected"
  | "resetSent"
  | "resetCompleted"
  | "signedOut"
>;

export interface AccountAccessNotice {
  readonly key: AccountAccessNoticeKey;
  readonly tone: "info" | "success" | "error";
}

export interface AccountAccessProps {
  readonly locale: Locale;
  readonly step: AccountAccessStep;
  readonly notice: AccountAccessNotice | null;
  /** True while an Identity request is in flight; every submit is disabled. */
  readonly busy: boolean;
  /** Set when Desktop's browser sign-in sent the user here; signing in returns to Desktop. */
  readonly desktopHandoff: boolean;
  readonly onStepChange: (step: AccountAccessStep) => void;
  readonly onSignIn: (email: string, password: string) => void;
  readonly onRegister: (email: string, password: string) => void;
  readonly onVerify: (email: string, code: string) => void;
  readonly onResendVerification: (email: string) => void;
  /** The caller moves to `reset` only after Identity accepts; the reply never reveals the account. */
  readonly onRequestReset: (email: string) => void;
  readonly onCompleteReset: (email: string, code: string, newPassword: string) => void;
  readonly onLocaleChange?: (locale: Locale) => void;
}

/**
 * Account access: sign-in, registration, email verification, and password reset beside the brand
 * panel. Secrets live only in this component's state and are cleared the moment they are handed
 * to Identity, so a password or code never outlives its request or reaches browser storage.
 */
export function AccountAccess(props: AccountAccessProps) {
  const { locale, step, notice, busy, desktopHandoff, onStepChange, onLocaleChange } = props;
  const copy = getAccountCopy(locale, "accountAccess");
  const [fields, setFields] = useState<AccessFields>({ email: "", password: "", code: "", newPassword: "" });
  const { email, password, code, newPassword } = fields;
  const setField = (name: keyof AccessFields, value: string) => setFields((current) => ({ ...current, [name]: value }));

  // The browser's constraint validation runs before this handler, so only well-formed input submits.
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const { intent, fields: remaining } = accessSubmission(step, fields);
    setFields(remaining);
    if (intent === null) return;
    switch (intent.kind) {
      case "sign_in": props.onSignIn(intent.email, intent.password); return;
      case "register": props.onRegister(intent.email, intent.password); return;
      case "verify": props.onVerify(intent.email, intent.code); return;
      case "request_reset": props.onRequestReset(intent.email); return;
      case "complete_reset": props.onCompleteReset(intent.email, intent.code, intent.newPassword); return;
    }
  };
  const goTo = (next: AccountAccessStep) => {
    setFields((current) => ({ email: current.email, password: "", code: "", newPassword: "" }));
    onStepChange(next);
  };

  const [title, subtitle] = ((): readonly [string, string | null] => {
    switch (step) {
      case "sign_in": return [desktopHandoff ? copy.desktopHandoffTitle : copy.signInTitle, desktopHandoff ? copy.desktopHandoffNotice : copy.signInSubtitle];
      case "register": return [copy.registerTitle, copy.registerSubtitle];
      case "verify": return [copy.verifyTitle, null];
      case "reset_request": return [copy.resetTitle, copy.resetRequestSubtitle];
      case "reset": return [copy.resetTitle, null];
      case "desktop_returning": return [copy.desktopReturningTitle, copy.desktopReturningDescription];
    }
  })();

  return (
    <div className="access">
      <aside className="access-brand">
        <div className="access-brand-glow" aria-hidden="true" />
        <div className="access-brand-mark">
          <img src={markUrl} width="132" height="132" alt="GoodDealer" />
          <span className="access-tagline">{copy.tagline}</span>
        </div>
        <div className="access-brand-foot">
          <span className="access-rule" />
          <span className="access-trust"><ShieldIcon size={14} />{copy.passwordTrust}</span>
          <span className="access-quota"><StatusDot kind="active" size={7} />{copy.deviceQuota}</span>
        </div>
      </aside>
      <main className="access-panel">
        <div className="access-topline">
          <span className="access-context gd-t-meta">{copy.context}</span>
          {onLocaleChange === undefined ? null : (
            <SegmentedControl
              label={copy.languageLabel}
              value={locale}
              onChange={onLocaleChange}
              items={supportedLocales.map((value) => ({ value, label: value === defaultLocale ? copy.chineseLanguageLabel : copy.englishLanguageLabel }))}
            />
          )}
        </div>
        <form className="access-form" onSubmit={submit}>
          <header>
            <img className="access-compact-mark" src={markUrl} width="44" height="44" alt="" aria-hidden="true" />
            <h1 className="access-title">{title}</h1>
            {subtitle === null ? null : <p className="gd-t-body-2">{subtitle}</p>}
          </header>

          {/* The polite region stays mounted so a notice that arrives after an Identity reply is announced;
              errors additionally carry role="alert" to interrupt. */}
          <div className="access-notice-region" aria-live="polite">
            {notice === null ? null : (
              <p className={`access-notice access-notice--${notice.tone}`} role={notice.tone === "error" ? "alert" : undefined}>
                {notice.tone === "error" ? <AlertTriangleIcon size={14} aria-hidden="true" /> : notice.tone === "success" ? <CheckIcon size={14} aria-hidden="true" /> : <MailIcon size={14} aria-hidden="true" />}
                {copy[notice.key]}
              </p>
            )}
          </div>

          {step === "desktop_returning" ? (
            <div className="access-progress"><ExternalLinkIcon size={15} /><span>{copy.desktopReturningTitle}</span><RefreshCwIcon size={14} className="access-spin" /></div>
          ) : (
            <>
              <Input
                label={copy.email}
                type="email"
                name="email"
                autoComplete="email"
                maxLength={320}
                required
                size="lg"
                value={email}
                onChange={(event) => setField("email", event.currentTarget.value)}
              />
              {step === "sign_in" || step === "register" ? (
                <Input
                  label={copy.password}
                  type="password"
                  name="password"
                  autoComplete={step === "register" ? "new-password" : "current-password"}
                  minLength={12}
                  maxLength={1024}
                  required
                  size="lg"
                  {...(step === "register" ? { hint: copy.passwordHint } : {})}
                  value={password}
                  onChange={(event) => setField("password", event.currentTarget.value)}
                />
              ) : null}
              {step === "verify" || step === "reset" ? (
                <Input
                  label={step === "verify" ? copy.verificationCode : copy.resetCode}
                  name="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  required
                  mono
                  size="lg"
                  hint={copy.codeHint}
                  value={code}
                  onChange={(event) => setField("code", event.currentTarget.value)}
                />
              ) : null}
              {step === "reset" ? (
                <Input
                  label={copy.newPassword}
                  type="password"
                  name="new-password"
                  autoComplete="new-password"
                  minLength={12}
                  maxLength={1024}
                  required
                  size="lg"
                  hint={copy.passwordHint}
                  value={newPassword}
                  onChange={(event) => setField("newPassword", event.currentTarget.value)}
                />
              ) : null}

              <Button type="submit" variant="primary" size="lg" block disabled={busy}>
                {busy ? (step === "sign_in" ? copy.signingIn : copy.submitting)
                  : step === "sign_in" ? copy.signIn
                    : step === "register" ? copy.createAccount
                      : step === "verify" ? copy.verify
                        : step === "reset_request" ? copy.sendResetCode : copy.setNewPassword}
              </Button>

              <div className="access-links">
                {step === "sign_in" ? (
                  <>
                    <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => goTo("reset_request")}>{copy.forgotPassword}</Button>
                    <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => goTo("register")}>{copy.switchToRegister}</Button>
                  </>
                ) : null}
                {step === "register" ? <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => goTo("sign_in")}>{copy.switchToSignIn}</Button> : null}
                {step === "verify" ? (
                  <>
                    <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => props.onResendVerification(email)}>{copy.resendVerification}</Button>
                    <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => goTo("sign_in")}>{copy.backToSignIn}</Button>
                  </>
                ) : null}
                {step === "reset_request" ? <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => goTo("sign_in")}>{copy.backToSignIn}</Button> : null}
                {step === "reset" ? (
                  <>
                    {/* Resending goes through the same accepted-only request; it never reveals the account. */}
                    <Button type="button" variant="ghost" size="sm" disabled={busy || email === ""} onClick={() => props.onRequestReset(email)}>{copy.resendVerification}</Button>
                    <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => goTo("sign_in")}>{copy.backToSignIn}</Button>
                  </>
                ) : null}
              </div>
            </>
          )}
        </form>
      </main>
    </div>
  );
}
