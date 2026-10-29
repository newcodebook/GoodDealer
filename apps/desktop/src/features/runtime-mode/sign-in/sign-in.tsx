import type { AuthGateViewModel } from "@gooddealer/client-core";
import { defaultLocale, getPresentationCopy, supportedLocales, type Locale } from "@gooddealer/i18n";
import { Button, Checkbox, CheckIcon, Input, RefreshCwIcon, SegmentedControl, ShieldIcon, StatusDot } from "@gooddealer/ui";
import keyholeUrl from "@gooddealer/ui/assets/icons/keyhole.svg";
import markUrl from "@gooddealer/ui/assets/logo/mark.svg";
import { useRef, useState, type FormEvent } from "react";

import { NativeWindow, type ShellWindowFrame } from "../../../app-shell";
import "./sign-in.css";

type AuthAction = AuthGateViewModel["availableActions"][number];

/** Secret entries the form hands straight to the write-only boundary; they never enter the view model. */
export interface AuthGateSubmission {
  readonly email?: string;
  readonly password?: string;
  readonly confirmPassword?: string;
  readonly code?: string;
}

export interface SignInProps {
  readonly locale: Locale;
  readonly view: AuthGateViewModel;
  readonly windowFrame: ShellWindowFrame;
  readonly onSubmit: (submission: AuthGateSubmission) => void;
  readonly onAction: (action: Exclude<AuthAction, "submit">) => void;
  readonly onLocaleChange?: (locale: Locale) => void;
}

/** Account gate: brand panel beside sign-in, registration, email verification, and recovery forms. */
export function SignIn({ locale, view, windowFrame, onSubmit, onAction, onLocaleChange }: SignInProps) {
  const copy = getPresentationCopy(locale, "signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [code, setCode] = useState("");
  const can = (action: AuthAction) => view.availableActions.includes(action);
  const revealed = (view.kind === "sign_in" || view.kind === "register") && view.entryRevealed;
  const errorText = view.errorKey === "password_mismatch" ? copy.passwordMismatch
    : view.errorKey === "must_agree" ? copy.mustAgree
      : view.errorKey === "invalid_code" ? copy.codeError : null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!can("submit") || view.busy) return;
    if (view.kind === "sign_in") onSubmit({ email, password });
    else if (view.kind === "register") onSubmit({ email, password, confirmPassword });
    else if (view.kind === "verify_email") onSubmit({ code });
    else onSubmit({ email });
  };
  const revealToggle = can("toggle_entry_visibility") ? (
    <button type="button" className="signin-reveal" tabIndex={-1} onClick={() => onAction("toggle_entry_visibility")}>{revealed ? copy.hide : copy.show}</button>
  ) : undefined;
  const busyIcon = view.busy ? <RefreshCwIcon size={15} className="signin-spin" /> : undefined;

  const [title, subtitle] = view.kind === "sign_in" ? [copy.signInTitle, copy.signInSubtitle]
    : view.kind === "register" ? [copy.registerTitle, null]
      : view.kind === "verify_email" ? [copy.verifyTitle, null]
        : [copy.resetTitle, copy.resetSubtitle];

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
            <form className="signin-form" onSubmit={submit} noValidate>
              <header>
                <h1 className="signin-title">{title}</h1>
                {subtitle === null ? null : <p className="gd-t-body-2">{subtitle}</p>}
                {view.kind === "verify_email" ? (
                  <p className="gd-t-body-2">{copy.verifySubtitlePrefix}<span className="signin-mono">{view.emailDisplay}</span>{copy.verifySubtitleSuffix}</p>
                ) : null}
              </header>

              {view.kind === "account_recovery" && view.resetLinkSent ? (
                <div className="signin-sent">
                  <span className="signin-sent-icon"><CheckIcon size={26} /></span>
                  <strong>{copy.resetLinkSent}</strong>
                  <span className="gd-t-body-2">{copy.resetSentDescription}</span>
                  {can("back") ? <Button size="lg" block onClick={() => onAction("back")}>{copy.backToSignIn}</Button> : null}
                </div>
              ) : (
                <>
                  {view.kind === "verify_email" ? (
                    <CodeField label={copy.verificationCode} value={code} onChange={setCode} error={view.errorKey === "invalid_code"} />
                  ) : (
                    <Input label={copy.email} size="lg" type="email" autoComplete="email" placeholder={copy.emailPlaceholder} value={email} onChange={(event) => setEmail(event.currentTarget.value)} />
                  )}
                  {view.kind === "sign_in" || view.kind === "register" ? (
                    <Input
                      label={copy.password}
                      size="lg"
                      type={revealed ? "text" : "password"}
                      autoComplete={view.kind === "sign_in" ? "current-password" : "new-password"}
                      placeholder={copy.passwordPlaceholder}
                      value={password}
                      onChange={(event) => setPassword(event.currentTarget.value)}
                      {...(revealToggle === undefined ? {} : { suffix: revealToggle })}
                      {...(view.kind === "register" ? { hint: copy.passwordRule } : {})}
                    />
                  ) : null}
                  {view.kind === "register" ? (
                    <Input label={copy.confirmPassword} size="lg" type={revealed ? "text" : "password"} autoComplete="new-password" placeholder={copy.confirmPasswordPlaceholder} value={confirmPassword} onChange={(event) => setConfirmPassword(event.currentTarget.value)} />
                  ) : null}
                  {view.kind === "sign_in" ? (
                    <div className="signin-row">
                      <Checkbox checked={view.rememberDevice} disabled={!can("toggle_remember_device")} onChange={() => onAction("toggle_remember_device")} label={copy.rememberDevice} />
                      {can("start_account_recovery") ? <button type="button" className="signin-link" onClick={() => onAction("start_account_recovery")}>{copy.forgotPassword}</button> : null}
                    </div>
                  ) : null}
                  {view.kind === "register" ? (
                    <div className="signin-terms">
                      <Checkbox checked={view.termsAccepted} disabled={!can("accept_terms")} onChange={() => onAction("accept_terms")} ariaLabel={copy.terms} />
                      <span>
                        {copy.agreementPrefix} <button type="button" className="signin-link" onClick={() => onAction("open_terms")}>{copy.terms}</button>
                        {" "}{copy.conjunction}{" "}<button type="button" className="signin-link" onClick={() => onAction("open_privacy")}>{copy.privacy}</button>
                      </span>
                    </div>
                  ) : null}
                  {errorText === null ? null : <p className="signin-error" role="alert">{errorText}</p>}
                  <Button
                    type="submit"
                    variant="primary"
                    size="lg"
                    block
                    disabled={!can("submit") || view.busy || (view.kind === "verify_email" ? code.length < 6 : email === "")}
                    {...(busyIcon === undefined ? (view.kind === "verify_email" ? { icon: <ShieldIcon size={15} /> } : {}) : { icon: busyIcon })}
                  >
                    {view.kind === "sign_in" ? (view.busy ? copy.signingIn : copy.signIn)
                      : view.kind === "register" ? (view.busy ? copy.creating : copy.createAccount)
                        : view.kind === "verify_email" ? (view.busy ? copy.verifying : copy.verifyAndContinue)
                          : (view.busy ? copy.sending : copy.sendResetLink)}
                  </Button>
                  {view.kind === "sign_in" ? (
                    <>
                      <div className="signin-divider"><span />{copy.divider}<span /></div>
                      <div className="signin-alternatives">
                        {can("oauth_google") ? <Button block onClick={() => onAction("oauth_google")}><span className="signin-provider">G</span>{copy.continueGoogle}</Button> : null}
                        {can("oauth_github") ? <Button block onClick={() => onAction("oauth_github")}><span className="signin-provider">GH</span>{copy.continueGitHub}</Button> : null}
                        {can("passkey") ? <Button block variant="gold" onClick={() => onAction("passkey")}><img src={keyholeUrl} width="18" height="18" alt="" />{copy.continuePasskey}</Button> : null}
                      </div>
                    </>
                  ) : null}
                  {view.kind === "verify_email" ? (
                    <div className="signin-row">
                      {can("back") ? <button type="button" className="signin-link" onClick={() => onAction("back")}>{copy.back}</button> : <span />}
                      {view.resend.kind === "unavailable"
                        ? <span className="signin-mono signin-faint">{view.resend.remainingLabel} {copy.resendInSuffix}</span>
                        : can("resend_code") ? <button type="button" className="signin-link" onClick={() => onAction("resend_code")}>{copy.resendCode}</button> : null}
                    </div>
                  ) : null}
                  {view.kind === "account_recovery" && can("back") ? (
                    <button type="button" className="signin-link signin-left" onClick={() => onAction("back")}>{copy.backToSignIn}</button>
                  ) : null}
                </>
              )}
              {view.kind === "sign_in" && can("create_account") ? (
                <p className="signin-switch">{copy.noAccount} <button type="button" className="signin-link" onClick={() => onAction("create_account")}>{copy.createOne}</button></p>
              ) : null}
              {view.kind === "register" && can("sign_in") ? (
                <p className="signin-switch">{copy.haveAccount} <button type="button" className="signin-link" onClick={() => onAction("sign_in")}>{copy.toSignIn}</button></p>
              ) : null}
            </form>
          </div>
        </div>
      </NativeWindow>
    </div>
  );
}

/** Six single-digit cells; focus advances on entry and steps back on Backspace. */
function CodeField({ label, value, onChange, error }: { readonly label: string; readonly value: string; readonly onChange: (value: string) => void; readonly error: boolean }) {
  const cells = useRef<(HTMLInputElement | null)[]>([]);
  const setDigit = (index: number, digit: string) => {
    const digits = value.padEnd(6, " ").split("");
    digits[index] = digit === "" ? " " : digit;
    onChange(digits.join("").replace(/ /gu, "").slice(0, 6));
  };
  return (
    <fieldset className="signin-code">
      <legend className="gd-t-label">{label}</legend>
      <div className="signin-code-cells">
        {Array.from({ length: 6 }, (_, index) => (
          <input
            key={index}
            ref={(element) => { cells.current[index] = element; }}
            className={`signin-code-cell${error ? " signin-code-cell--error" : ""}`}
            inputMode="numeric"
            autoComplete={index === 0 ? "one-time-code" : "off"}
            maxLength={1}
            aria-label={`${label} ${index + 1}`}
            value={value[index] ?? ""}
            onChange={(event) => {
              const digit = event.currentTarget.value.replace(/\D/gu, "").slice(-1);
              setDigit(index, digit);
              if (digit !== "") cells.current[index + 1]?.focus();
            }}
            onKeyDown={(event) => { if (event.key === "Backspace" && (value[index] ?? "") === "") cells.current[index - 1]?.focus(); }}
          />
        ))}
      </div>
    </fieldset>
  );
}
