import {
  projectActivationWizardViewModel,
  projectAuthGateViewModel,
  type ActivationWizardViewModel,
  type AuthGateViewModel,
} from "@gooddealer/client-core";
import { defaultLocale, type Locale } from "@gooddealer/i18n";
import { useEffect, useState } from "react";

import { ActivationWizard, SignIn } from "../../src/features/runtime-mode";
import type { DesignWindowPlatform } from "../screen-registry";

export const signInVariants = [
  { id: "sign_in", label: "登录" },
  { id: "register", label: "注册" },
  { id: "verify_email", label: "邮箱验证" },
  { id: "account_recovery", label: "找回密码" },
] as const;

type AuthKind = AuthGateViewModel["kind"];

function authView(kind: AuthKind, state: { busy: boolean; errorKey: AuthGateViewModel["errorKey"]; remember: boolean; revealed: boolean; terms: boolean; sent: boolean; cooldown: number }): AuthGateViewModel {
  const common = { busy: state.busy, errorKey: state.errorKey };
  const input = kind === "sign_in"
    ? { ...common, kind, rememberDevice: state.remember, entryRevealed: state.revealed, availableActions: ["submit", "toggle_entry_visibility", "start_account_recovery", "create_account", "oauth_google", "oauth_github", "passkey", "toggle_remember_device"] }
    : kind === "register"
      ? { ...common, kind, termsAccepted: state.terms, entryRevealed: state.revealed, availableActions: ["submit", "toggle_entry_visibility", "accept_terms", "open_terms", "open_privacy", "sign_in"] }
      : kind === "verify_email"
        ? {
          ...common, kind, emailDisplay: "you@domain.com", oneTimeCodeLength: 6,
          resend: state.cooldown > 0 ? { kind: "unavailable", remainingLabel: String(state.cooldown) } : { kind: "available" },
          availableActions: state.cooldown > 0 ? ["submit", "back"] : ["submit", "back", "resend_code"],
        }
        : { ...common, kind, resetLinkSent: state.sent, availableActions: ["submit", "back"] };
  const result = projectAuthGateViewModel(input);
  if (!result.ok) throw new Error("mock auth gate state is invalid");
  return result.value;
}

/** Account gate driven through every AuthGate state; submissions only simulate the Host round trip. */
export function SignInScreen({ variant, platform }: { readonly variant: string; readonly platform: DesignWindowPlatform }) {
  const [locale, setLocale] = useState<Locale>(defaultLocale);
  const [kind, setKind] = useState<AuthKind>(variant as AuthKind);
  const [state, setState] = useState({ busy: false, errorKey: null as AuthGateViewModel["errorKey"], remember: true, revealed: false, terms: false, sent: false, cooldown: 0 });
  useEffect(() => {
    if (state.cooldown <= 0) return undefined;
    const timer = setTimeout(() => setState((current) => ({ ...current, cooldown: current.cooldown - 1 })), 1000);
    return () => clearTimeout(timer);
  }, [state.cooldown]);
  const go = (next: AuthKind) => { setKind(next); setState((current) => ({ ...current, busy: false, errorKey: null, sent: false })); };

  return (
    <SignIn
      locale={locale}
      view={authView(kind, state)}
      windowFrame={{ platform, framed: true }}
      onLocaleChange={setLocale}
      onSubmit={(submission) => {
        if (kind === "register" && submission.password !== submission.confirmPassword) { setState((current) => ({ ...current, errorKey: "password_mismatch" })); return; }
        if (kind === "register" && !state.terms) { setState((current) => ({ ...current, errorKey: "must_agree" })); return; }
        if (kind === "verify_email" && submission.code !== "123456") { setState((current) => ({ ...current, errorKey: "invalid_code" })); return; }
        setState((current) => ({ ...current, busy: true, errorKey: null }));
        setTimeout(() => {
          if (kind === "register") { go("verify_email"); setState((current) => ({ ...current, cooldown: 45 })); return; }
          if (kind === "account_recovery") { setState((current) => ({ ...current, busy: false, sent: true })); return; }
          setState((current) => ({ ...current, busy: false }));
        }, 900);
      }}
      onAction={(action) => {
        if (action === "create_account") go("register");
        else if (action === "sign_in" || action === "back") go(kind === "verify_email" ? "register" : "sign_in");
        else if (action === "start_account_recovery") go("account_recovery");
        else if (action === "toggle_entry_visibility") setState((current) => ({ ...current, revealed: !current.revealed }));
        else if (action === "toggle_remember_device") setState((current) => ({ ...current, remember: !current.remember }));
        else if (action === "accept_terms") setState((current) => ({ ...current, terms: !current.terms }));
        else if (action === "resend_code") setState((current) => ({ ...current, cooldown: 45 }));
      }}
    />
  );
}

export const activationVariants = [
  { id: "welcome", label: "欢迎" },
  { id: "device", label: "设备门禁" },
  { id: "connections", label: "连接账户" },
  { id: "initial_import", label: "首次导入" },
  { id: "complete", label: "完成" },
] as const;

type Step = ActivationWizardViewModel["step"];
const order: readonly Step[] = ["welcome", "device", "connections", "initial_import", "complete"];

interface WizardState {
  readonly step: Step;
  readonly device: "ready" | "activating" | "awaiting_cloud" | "active";
  readonly deviceName: string;
  readonly providers: Readonly<Record<string, "disconnected" | "connecting" | "connected">>;
  readonly importState: "ready" | "in_progress" | "completed";
  readonly progress: number;
}

const providerCatalog = [
  { providerId: "spaceship", displayName: "Spaceship", metadata: "主注册商 · OAuth", category: "registrar" },
  { providerId: "namecheap", displayName: "Namecheap", metadata: "OAuth", category: "registrar" },
  { providerId: "dynadot", displayName: "Dynadot", metadata: "API Key", category: "registrar" },
  { providerId: "cloudflare", displayName: "Cloudflare", metadata: "API Token", category: "dns" },
  { providerId: "atom", displayName: "Atom", metadata: "OAuth · API", category: "marketplace" },
  { providerId: "afternic", displayName: "Afternic", metadata: "CSV · 人工", category: "marketplace" },
] as const;

function wizardView(state: WizardState): ActivationWizardViewModel {
  const connected = Object.values(state.providers).filter((value) => value === "connected").length;
  const input = state.step === "welcome" ? { step: "welcome", availableActions: ["skip", "continue"] }
    : state.step === "device" ? {
      step: "device", deviceName: state.deviceName, activationState: state.device,
      deviceIdentity: state.device === "ready" ? { status: "not_started" } : state.device === "activating" ? { status: "creating" } : { status: "bound", deviceId: "dev-macbook" },
      activeLease: state.device === "active" ? { status: "issued", issuer: "gooddealer_cloud", deviceId: "dev-macbook", leaseEpoch: 1 } : state.device === "awaiting_cloud" ? { status: "awaiting_cloud" } : { status: "not_requested" },
      availableActions: state.device === "ready" ? ["back", "submit_device"] : state.device === "active" ? ["back", "continue"] : ["back"],
    }
      : state.step === "connections" ? {
        step: "connections", connectedCount: connected,
        providers: providerCatalog.map((provider) => ({ ...provider, connectionState: state.providers[provider.providerId] ?? "disconnected" })),
        availableActions: ["back", "connect_provider", "disconnect_provider", ...(connected > 0 ? ["continue"] : [])],
      }
        : state.step === "initial_import" ? {
          step: "initial_import", connectedCount: connected, importState: state.importState, progress: state.progress,
          importedDomains: state.importState === "completed" ? 823 : null, importedListings: state.importState === "completed" ? 692 : null,
          conflicts: state.importState === "completed" ? 6 : null, baselineServerRevision: state.importState === "completed" ? 1 : null,
          availableActions: state.importState === "ready" ? ["back", "start_import"] : state.importState === "completed" ? ["back", "continue"] : ["back"],
        }
          : { step: "complete", deviceName: state.deviceName, importedDomains: 823, baselineServerRevision: 1, syncReady: true, availableActions: ["enter_workspace"] };
  const result = projectActivationWizardViewModel(input);
  if (!result.ok) throw new Error(`mock activation state is invalid: ${state.step}`);
  return result.value;
}

/** First-run activation walked through every step with simulated Host and Cloud progress. */
export function ActivationScreen({ variant, onNavigateScreen }: { readonly variant: string; readonly onNavigateScreen: (id: string) => void }) {
  const locale = defaultLocale;
  const [state, setState] = useState<WizardState>({
    step: variant as Step,
    device: variant === "device" ? "ready" : "active",
    deviceName: "MacBook Pro",
    providers: variant === "initial_import" || variant === "complete" ? { spaceship: "connected", cloudflare: "connected" } : {},
    importState: variant === "complete" ? "completed" : "ready",
    progress: 0,
  });
  const move = (delta: number) => setState((current) => ({ ...current, step: order[Math.max(0, Math.min(order.length - 1, order.indexOf(current.step) + delta))] ?? current.step }));

  useEffect(() => {
    if (state.device === "activating") { const timer = setTimeout(() => setState((current) => ({ ...current, device: "awaiting_cloud" })), 700); return () => clearTimeout(timer); }
    if (state.device === "awaiting_cloud") { const timer = setTimeout(() => setState((current) => ({ ...current, device: "active" })), 900); return () => clearTimeout(timer); }
    return undefined;
  }, [state.device]);
  useEffect(() => {
    if (state.importState !== "in_progress") return undefined;
    const timer = setTimeout(() => setState((current) => current.progress >= 96
      ? { ...current, importState: "completed", progress: 100 }
      : { ...current, progress: current.progress + 4 }), 40);
    return () => clearTimeout(timer);
  }, [state.importState, state.progress]);

  return (
    <div className="design-host-center">
      <ActivationWizard
        locale={locale}
        view={wizardView(state)}
        onAction={(action) => {
          if (action === "continue") move(1);
          else if (action === "back") move(-1);
          else if (action === "skip" || action === "enter_workspace") onNavigateScreen("asset-library");
          else if (action === "start_import") setState((current) => ({ ...current, importState: "in_progress", progress: 0 }));
        }}
        onSubmitDevice={(deviceName) => setState((current) => ({ ...current, deviceName, device: "activating" }))}
        onToggleProvider={(providerId, connect) => {
          setState((current) => ({ ...current, providers: { ...current.providers, [providerId]: connect ? "connecting" : "disconnected" } }));
          if (connect) setTimeout(() => setState((current) => ({ ...current, providers: { ...current.providers, [providerId]: "connected" } })), 700);
        }}
      />
    </div>
  );
}
