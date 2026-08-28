import type { AuthGateViewModel } from "@gooddealer/client-core";
import { getPresentationCopy, type Locale } from "@gooddealer/i18n";
import {
  Badge,
  Button,
  Checkbox,
  CheckIcon,
  Input,
  RefreshCwIcon,
  ShieldIcon,
  StatusDot,
  WindowChrome,
} from "@gooddealer/ui";
import keyholeUrl from "@gooddealer/ui/assets/icons/keyhole.svg";
import markUrl from "@gooddealer/ui/assets/logo/mark-16.svg";
import fullMarkUrl from "@gooddealer/ui/assets/logo/mark.svg";
import type { FormEvent, ReactElement } from "react";

import "../runtime-presentation.css";

type AuthAction = AuthGateViewModel["availableActions"][number];

export interface SignInActions {
  readonly submitForm: (form: HTMLFormElement) => void;
  readonly invoke: (action: Exclude<AuthAction, "submit">) => void;
  readonly changeLocale: (locale: Locale) => void;
  readonly close: () => void;
}

export interface SignInPageProps {
  readonly locale: Locale;
  readonly viewModel: AuthGateViewModel;
  readonly actions: SignInActions;
}

function LocaleToggle({ locale, onChange, chineseLabel, englishLabel }: { readonly locale: Locale; readonly onChange: (locale: Locale) => void; readonly chineseLabel: string; readonly englishLabel: string }) {
  return (
    <div className="gd-runtime-locale-toggle">
      <button type="button" aria-pressed={locale === "zh-CN"} onClick={() => onChange("zh-CN")}>{chineseLabel}</button>
      <button type="button" aria-pressed={locale === "en-US"} onClick={() => onChange("en-US")}>{englishLabel}</button>
    </div>
  );
}

function TextAction({ children, action, actions }: {
  readonly children: string;
  readonly action: Exclude<AuthAction, "submit">;
  readonly actions: SignInActions;
}) {
  return <button type="button" className="gd-runtime-text-action" onClick={() => actions.invoke(action)}>{children}</button>;
}

function FormError({ errorKey, copy }: {
  readonly errorKey: AuthGateViewModel["errorKey"];
  readonly copy: { readonly passwordMismatch: string; readonly mustAgree: string; readonly codeError: string };
}) {
  if (errorKey === null) return null;
  const message = errorKey === "password_mismatch"
    ? copy.passwordMismatch
    : errorKey === "must_agree"
      ? copy.mustAgree
      : copy.codeError;
  return <div className="gd-runtime-form-error" role="alert">{message}</div>;
}

function VerificationCodeFields({ length, label }: { readonly length: 6; readonly label: string }) {
  return <fieldset className="gd-runtime-code-fieldset">
    <legend>{label}</legend>
    <div className="gd-runtime-code-inputs">
      {Array.from({ length }, (_, index) => (
        <input
          key={index}
          name={`oneTimeCodeDigit${index + 1}`}
          aria-label={`${label} ${index + 1}`}
          inputMode="numeric"
          pattern="[0-9]"
          maxLength={1}
          autoComplete={index === 0 ? "one-time-code" : "off"}
          autoFocus={index === 0}
          onChange={(event) => {
            event.currentTarget.value = event.currentTarget.value.replace(/\D/g, "").slice(-1);
            if (event.currentTarget.value) {
              const next = event.currentTarget.nextElementSibling;
              if (next instanceof HTMLInputElement) next.focus();
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Backspace" && !event.currentTarget.value) {
              const previous = event.currentTarget.previousElementSibling;
              if (previous instanceof HTMLInputElement) previous.focus();
            }
          }}
        />
      ))}
    </div>
  </fieldset>;
}

export function SignInPage({ locale, viewModel, actions }: SignInPageProps): ReactElement {
  const copy = getPresentationCopy(locale, "signIn");
  const can = (action: AuthAction) => viewModel.availableActions.includes(action);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (can("submit") && !viewModel.busy) actions.submitForm(event.currentTarget);
  };
  const title = viewModel.kind === "sign_in"
    ? copy.signInTitle
    : viewModel.kind === "register"
      ? copy.registerTitle
      : viewModel.kind === "verify_email"
        ? copy.verifyTitle
        : viewModel.resetLinkSent
          ? copy.resetLinkSent
          : copy.resetTitle;
  const subtitle = viewModel.kind === "sign_in"
    ? copy.signInSubtitle
    : viewModel.kind === "register"
      ? copy.deviceQuota
      : viewModel.kind === "verify_email"
        ? <>{copy.verifySubtitlePrefix}<span className="gd-runtime-mono">{viewModel.emailDisplay}</span>{copy.verifySubtitleSuffix}</>
        : viewModel.resetLinkSent
          ? copy.resetSentDescription
          : copy.resetSubtitle;

  return (
    <WindowChrome
      appName="GoodDealer"
      context={copy.context}
      mark={<img src={markUrl} width="16" height="16" alt="" />}
      onClose={actions.close}
      style={{ width: 920, height: 600, maxWidth: "100%", maxHeight: "100%" }}
    >
      <aside className="gd-runtime-sign-in-brand">
        <div className="gd-runtime-brand-mark">
          <img src={fullMarkUrl} width="132" height="132" alt="GoodDealer" />
          <span>{copy.tagline}</span>
        </div>
        <div className="gd-runtime-trust-block">
          <ShieldIcon size={14} />
          <span>{copy.accountCredentialTrust}</span>
          <div><StatusDot kind="active" size={7} /><span>{copy.deviceQuota}</span></div>
        </div>
      </aside>
      <section className="gd-runtime-auth-panel">
        <div className="gd-runtime-locale-row"><LocaleToggle locale={locale} onChange={actions.changeLocale} chineseLabel={copy.chineseLanguageLabel} englishLabel={copy.englishLanguageLabel} /></div>
        <form className="gd-runtime-auth-form" onSubmit={submit}>
          <header><h1>{title}</h1><p>{subtitle}</p></header>

          {viewModel.kind === "sign_in" ? <>
            <Input name="email" label={copy.email} size="lg" type="email" placeholder={copy.emailPlaceholder} autoComplete="email" autoFocus />
            <Input
              name="password"
              label={copy.password}
              size="lg"
              type={viewModel.entryRevealed ? "text" : "password"}
              placeholder={copy.passwordPlaceholder}
              autoComplete="current-password"
              suffix={can("toggle_entry_visibility") ? <TextAction action="toggle_entry_visibility" actions={actions}>{viewModel.entryRevealed ? copy.hide : copy.show}</TextAction> : undefined}
            />
            <div className="gd-runtime-form-inline">
              <Checkbox checked={viewModel.rememberDevice} onChange={() => actions.invoke("toggle_remember_device")} label={copy.rememberDevice} disabled={!can("toggle_remember_device")} />
              {can("start_account_recovery") ? <TextAction action="start_account_recovery" actions={actions}>{copy.forgotPassword}</TextAction> : null}
            </div>
            <FormError errorKey={viewModel.errorKey} copy={copy} />
            <Button type="submit" variant="primary" size="lg" block disabled={!can("submit") || viewModel.busy} icon={viewModel.busy ? <RefreshCwIcon size={15} /> : undefined}>
              {viewModel.busy ? copy.signingIn : copy.signIn}
            </Button>
            <div className="gd-runtime-divider"><span />{copy.divider}<span /></div>
            <div className="gd-runtime-oauth-list">
              <Button type="button" variant="secondary" block disabled={!can("oauth_google")} {...(can("oauth_google") ? { onClick: () => actions.invoke("oauth_google") } : {})}><Badge>G</Badge>{copy.continueGoogle}</Button>
              <Button type="button" variant="secondary" block disabled={!can("oauth_github")} {...(can("oauth_github") ? { onClick: () => actions.invoke("oauth_github") } : {})}><Badge>GH</Badge>{copy.continueGitHub}</Button>
              <Button type="button" variant="gold" block disabled={!can("passkey")} {...(can("passkey") ? { onClick: () => actions.invoke("passkey") } : {})}><img src={keyholeUrl} width="18" height="18" alt="" />{copy.continuePasskey}</Button>
            </div>
            <footer>{copy.noAccount} {can("create_account") ? <TextAction action="create_account" actions={actions}>{copy.createOne}</TextAction> : null}</footer>
          </> : null}

          {viewModel.kind === "register" ? <>
            <Input name="email" label={copy.email} size="lg" type="email" placeholder={copy.emailPlaceholder} autoComplete="email" autoFocus />
            <Input name="password" label={copy.password} size="lg" type={viewModel.entryRevealed ? "text" : "password"} placeholder={copy.passwordPlaceholder} autoComplete="new-password" hint={copy.passwordRule} />
            <Input name="confirmPassword" label={copy.confirmPassword} size="lg" type={viewModel.entryRevealed ? "text" : "password"} placeholder={copy.confirmPasswordPlaceholder} autoComplete="new-password" />
            <div className="gd-runtime-agreement">
              <Checkbox checked={viewModel.termsAccepted} onChange={() => actions.invoke("accept_terms")} disabled={!can("accept_terms")} />
              <span>{copy.agreementPrefix} {can("open_terms") ? <TextAction action="open_terms" actions={actions}>{copy.terms}</TextAction> : copy.terms} {copy.conjunction} {can("open_privacy") ? <TextAction action="open_privacy" actions={actions}>{copy.privacy}</TextAction> : copy.privacy}</span>
            </div>
            <FormError errorKey={viewModel.errorKey} copy={copy} />
            <Button type="submit" variant="primary" size="lg" block disabled={!can("submit") || viewModel.busy}>
              {viewModel.busy ? copy.creating : copy.createAccount}
            </Button>
            <footer>{copy.haveAccount} {can("sign_in") ? <TextAction action="sign_in" actions={actions}>{copy.toSignIn}</TextAction> : null}</footer>
          </> : null}

          {viewModel.kind === "verify_email" ? <>
            <VerificationCodeFields length={viewModel.oneTimeCodeLength} label={copy.verificationCode} />
            <FormError errorKey={viewModel.errorKey} copy={copy} />
            <Button type="submit" variant="primary" size="lg" block disabled={!can("submit") || viewModel.busy} icon={<ShieldIcon size={15} />}>
              {viewModel.busy ? copy.verifying : copy.verifyAndContinue}
            </Button>
            <div className="gd-runtime-form-inline">
              {can("back") ? <TextAction action="back" actions={actions}>{copy.back}</TextAction> : <span />}
              {viewModel.resend.kind === "available" && can("resend_code")
                ? <TextAction action="resend_code" actions={actions}>{copy.resendCode}</TextAction>
                : viewModel.resend.kind === "unavailable"
                  ? <span className="gd-runtime-muted">{viewModel.resend.remainingLabel} {copy.resendInSuffix}</span>
                  : null}
            </div>
          </> : null}

          {viewModel.kind === "account_recovery" ? viewModel.resetLinkSent ? <>
            <div className="gd-runtime-success-state"><CheckIcon size={30} /><p>{copy.resetSentDescription}</p></div>
            <Button type="button" variant="secondary" size="lg" block disabled={!can("back")} onClick={() => actions.invoke("back")}>{copy.backToSignIn}</Button>
          </> : <>
            <Input name="email" label={copy.email} size="lg" type="email" placeholder={copy.emailPlaceholder} autoComplete="email" autoFocus />
            <Button type="submit" variant="primary" size="lg" block disabled={!can("submit") || viewModel.busy}>{viewModel.busy ? copy.sending : copy.sendResetLink}</Button>
            {can("back") ? <TextAction action="back" actions={actions}>{copy.backToSignIn}</TextAction> : null}
          </> : null}
        </form>
      </section>
    </WindowChrome>
  );
}
