import type { Locale } from "@gooddealer/i18n";
import { useState } from "react";

import { AccountAccess, type AccountAccessNotice, type AccountAccessStep } from "../../src/features/access/account-access";

export const accessVariants = [
  { id: "sign-in", label: "登录" },
  { id: "desktop-handoff", label: "Desktop 授权" },
  { id: "desktop-returning", label: "返回 Desktop" },
  { id: "register", label: "注册" },
  { id: "verify", label: "验证邮箱" },
  { id: "reset-request", label: "找回密码" },
  { id: "reset", label: "重置密码" },
  { id: "rejected", label: "登录失败" },
  { id: "signed-out", label: "已退出" },
] as const;

type AccessVariant = (typeof accessVariants)[number]["id"];

const initial: Record<AccessVariant, { step: AccountAccessStep; notice: AccountAccessNotice | null; handoff: boolean }> = {
  "sign-in": { step: "sign_in", notice: null, handoff: false },
  "desktop-handoff": { step: "sign_in", notice: null, handoff: true },
  "desktop-returning": { step: "desktop_returning", notice: null, handoff: true },
  register: { step: "register", notice: null, handoff: false },
  verify: { step: "verify", notice: { key: "verificationSent", tone: "info" }, handoff: false },
  "reset-request": { step: "reset_request", notice: null, handoff: false },
  reset: { step: "reset", notice: { key: "resetSent", tone: "info" }, handoff: false },
  rejected: { step: "sign_in", notice: { key: "invalidCredentials", tone: "error" }, handoff: false },
  "signed-out": { step: "sign_in", notice: { key: "signedOut", tone: "success" }, handoff: false },
};

/**
 * Mock access flow. It simulates Identity outcomes with fixed delays and never sends or keeps what
 * is typed; production composes the same component with the real same-origin Identity client.
 */
export function AccessScreen({ variant, locale: hostLocale }: { readonly variant: string; readonly locale: Locale }) {
  const start = initial[(variant in initial ? variant : "sign-in") as AccessVariant];
  const [step, setStep] = useState<AccountAccessStep>(start.step);
  const [notice, setNotice] = useState<AccountAccessNotice | null>(start.notice);
  const [busy, setBusy] = useState(false);
  const [locale, setLocale] = useState<Locale>(hostLocale);
  const settle = (next: () => void) => {
    setBusy(true);
    setTimeout(() => { setBusy(false); next(); }, 700);
  };

  return (
    <AccountAccess
      locale={locale}
      step={step}
      notice={notice}
      busy={busy}
      desktopHandoff={start.handoff}
      onLocaleChange={setLocale}
      onStepChange={(next) => { setStep(next); setNotice(null); }}
      onSignIn={() => settle(() => {
        if (start.handoff) { setStep("desktop_returning"); setNotice(null); } else setNotice({ key: "invalidCredentials", tone: "error" });
      })}
      onRegister={() => settle(() => { setStep("verify"); setNotice({ key: "verificationSent", tone: "info" }); })}
      onVerify={() => settle(() => { setStep("sign_in"); setNotice({ key: "verified", tone: "success" }); })}
      onResendVerification={() => settle(() => setNotice({ key: "verificationResent", tone: "info" }))}
      onRequestReset={() => settle(() => { setStep("reset"); setNotice({ key: "resetSent", tone: "info" }); })}
      onCompleteReset={() => settle(() => { setStep("sign_in"); setNotice({ key: "resetCompleted", tone: "success" }); })}
    />
  );
}
