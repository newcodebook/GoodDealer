import {
  projectActivationWizardViewModel,
  projectDrainingViewModel,
  type ActivationWizardViewModel,
} from "@gooddealer/client-core";
import { defaultLocale, type Locale } from "@gooddealer/i18n";
import { useEffect, useState } from "react";

import { ActivationWizard, RuntimeStatusPage, SignIn, type BrowserSignInState, type RuntimeStatusKind } from "../../src/features/runtime-mode";
import type { DesignWindowPlatform } from "../screen-registry";

export const signInVariants = [
  { id: "signed_out", label: "未登录" },
  { id: "pending", label: "等待浏览器" },
  { id: "establishing", label: "建立授权" },
  { id: "authorization_failed", label: "授权失效" },
  { id: "authorization_retryable", label: "刷新失败" },
  { id: "host_unavailable", label: "宿主不可用" },
] as const;

/** Browser sign-in gate; "sign in" simulates Native opening the browser and the round trip back. */
export function SignInScreen({ variant, platform }: { readonly variant: string; readonly platform: DesignWindowPlatform }) {
  const [locale, setLocale] = useState<Locale>(defaultLocale);
  const [state, setState] = useState<BrowserSignInState>(variant as BrowserSignInState);
  useEffect(() => {
    if (state !== "pending" && state !== "establishing") return undefined;
    const timer = setTimeout(() => setState(state === "pending" ? "establishing" : "signed_out"), 2400);
    return () => clearTimeout(timer);
  }, [state]);

  return (
    <SignIn
      locale={locale}
      state={state}
      windowFrame={{ platform, framed: true }}
      onLocaleChange={setLocale}
      onBegin={() => setState("pending")}
      onRetry={() => setState("establishing")}
    />
  );
}

export const runtimeStatusVariants = [
  { id: "opening", label: "打开中" },
  { id: "host_unavailable", label: "宿主不可用" },
  { id: "security_locked", label: "安全锁定" },
  { id: "retryable_locked", label: "可重试锁定" },
  { id: "device_capacity", label: "设备上限" },
  { id: "activating", label: "安全激活" },
  { id: "draining", label: "排空中" },
  { id: "startup_recovery", label: "启动恢复" },
  { id: "local_continuation", label: "本地延续" },
] as const;

const mockDraining = projectDrainingViewModel({
  reason: "handoff", phase: "uploading_envelopes", canCancel: false, failureReference: null,
  streams: [
    { stream: "mutations", acknowledgedSequence: 38, pendingCount: 7, gapCount: 0 },
    { stream: "execution_facts", acknowledgedSequence: 12, pendingCount: 2, gapCount: 0 },
    { stream: "workspace_device_audit", acknowledgedSequence: 5, pendingCount: 0, gapCount: 0 },
  ],
});

/** Route-free runtime states; none of them admits business data or actions. */
export function RuntimeStatusScreen({ variant, platform }: { readonly variant: string; readonly platform: DesignWindowPlatform }) {
  if (!mockDraining.ok) throw new Error("mock draining state is invalid");
  return (
    <RuntimeStatusPage
      locale={defaultLocale}
      kind={variant as RuntimeStatusKind}
      windowFrame={{ platform, framed: true }}
      onRetry={() => undefined}
      onSignInAgain={() => undefined}
      draining={mockDraining.value}
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
