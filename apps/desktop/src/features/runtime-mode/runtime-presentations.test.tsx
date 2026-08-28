import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { AuthGateViewModel } from "@gooddealer/client-core";
import { getPresentationCopy } from "@gooddealer/i18n";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ActivationWizard, type ActivationPresentation } from "./activation";
import { SignInPage } from "./sign-in";

const authActions = { submitForm: vi.fn(), invoke: vi.fn(), changeLocale: vi.fn(), close: vi.fn() };
const authBase = { busy: false, errorKey: null } as const;

describe("runtime presentations", () => {
  it("renders direct sign-in presentation inputs without a fixture registry", () => {
    const states: readonly AuthGateViewModel[] = [
      { ...authBase, kind: "sign_in", rememberDevice: true, entryRevealed: false, availableActions: ["submit", "toggle_entry_visibility", "toggle_remember_device", "start_account_recovery", "create_account", "oauth_google", "oauth_github", "passkey"] },
      { ...authBase, kind: "sign_in", rememberDevice: false, entryRevealed: true, availableActions: ["submit"] },
      { ...authBase, kind: "register", termsAccepted: false, entryRevealed: false, availableActions: ["submit", "toggle_entry_visibility", "accept_terms", "sign_in", "open_terms", "open_privacy"] },
      { ...authBase, kind: "verify_email", emailDisplay: "you@example.test", oneTimeCodeLength: 6, resend: { kind: "unavailable", remainingLabel: "45" }, availableActions: ["submit", "back"] },
      { ...authBase, kind: "account_recovery", resetLinkSent: false, availableActions: ["submit", "back"] },
      { ...authBase, kind: "account_recovery", resetLinkSent: true, availableActions: ["back"] },
    ];
    const locales = ["zh-CN", "en-US", "zh-CN", "zh-CN", "zh-CN", "zh-CN"] as const;

    states.forEach((viewModel, index) => {
      const locale = locales[index]!;
      const html = renderToStaticMarkup(
        <SignInPage locale={locale} viewModel={viewModel} actions={authActions} />,
      );
      const copy = getPresentationCopy(locale, "signIn");
      expect(html).toContain("GoodDealer");
      expect(html).toContain(copy.accountCredentialTrust);
      expect(html).not.toMatch(/setTimeout|fake.?success|fixture-account/i);
    });
  });

  it("renders only the three explicit account-activation outcomes", () => {
    const presentations: readonly ActivationPresentation[] = [
      { state: "pending", submitted: true },
      { state: "accepted", workspace: { kind: "personal-default", label: "Personal workspace" } },
      { state: "rejected", code: "temporarily-unavailable", retryable: true },
    ];

    const markup = presentations.map((presentation) => renderToStaticMarkup(
      <ActivationWizard
        locale="en-US"
        presentation={presentation}
        actions={{ onRetry: vi.fn(), onContinue: vi.fn() }}
      />,
    ));

    expect(markup[0]).toContain('data-activation-state="pending"');
    expect(markup[1]).toContain('data-activation-state="accepted"');
    expect(markup[2]).toContain('data-activation-state="rejected"');
    expect(markup.join("\n")).not.toMatch(/provider import|marketplace|accountId|workspaceId/i);
  });

  it("contains no timer, storage, network, Tauri, or visual-fixture authority", () => {
    const source = [
      "activation/activation-wizard.tsx",
      "sign-in/sign-in-page.tsx",
    ].map((path) => readFileSync(resolve(import.meta.dirname, path), "utf8")).join("\n");

    expect(source).not.toMatch(/setTimeout|setInterval|@tauri-apps|fetch\s*\(|localStorage|sessionStorage|visual-fixtures|brand\/ui_kits/i);
  });

  it("keeps runtime presentations unreachable from production composition", () => {
    const appSource = readFileSync(resolve(import.meta.dirname, "../../app.tsx"), "utf8");
    expect(appSource).not.toMatch(/SignInPage|ActivationWizard/);
  });
});
