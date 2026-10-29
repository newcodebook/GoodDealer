import { projectActivationWizardViewModel, projectAuthGateViewModel } from "@gooddealer/client-core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ActivationWizard, SignIn } from "./index";

function auth(input: unknown) {
  const result = projectAuthGateViewModel(input);
  if (!result.ok) throw new Error("fixture");
  return result.value;
}

function wizard(input: unknown) {
  const result = projectActivationWizardViewModel(input);
  if (!result.ok) throw new Error("fixture");
  return result.value;
}

const frame = { platform: "windows", framed: false } as const;
const noop = () => undefined;

describe("Sign-in gate", () => {
  it("keeps secrets out of the view model and offers only admitted alternatives", () => {
    const view = auth({ kind: "sign_in", busy: false, errorKey: null, rememberDevice: true, entryRevealed: false, availableActions: ["submit", "create_account", "passkey"] });
    const html = renderToStaticMarkup(<SignIn locale="zh-CN" view={view} windowFrame={frame} onSubmit={noop} onAction={noop} />);

    expect(html).toContain('type="password"');
    expect(html).toContain("使用 Passkey 登录");
    expect(html).not.toContain("使用 Google 继续");
    expect(html).not.toContain("忘记密码");
  });

  it("maps Host error keys to copy without echoing any submitted value", () => {
    const view = auth({ kind: "register", busy: false, errorKey: "password_mismatch", termsAccepted: false, entryRevealed: false, availableActions: ["submit", "accept_terms", "sign_in"] });
    const html = renderToStaticMarkup(<SignIn locale="zh-CN" view={view} windowFrame={frame} onSubmit={noop} onAction={noop} />);

    expect(html).toContain("两次输入的密码不一致");
    expect(html).toContain("至少 10 位，含字母与数字");
  });

  it("shows the resend countdown instead of the resend action while it is unavailable", () => {
    const view = auth({
      kind: "verify_email", busy: false, errorKey: null, emailDisplay: "you@domain.com", oneTimeCodeLength: 6,
      resend: { kind: "unavailable", remainingLabel: "45" }, availableActions: ["submit", "back"],
    });
    const html = renderToStaticMarkup(<SignIn locale="zh-CN" view={view} windowFrame={frame} onSubmit={noop} onAction={noop} />);

    expect(html).toContain("45 秒后可重发");
    expect(html).not.toContain("重新发送验证码");
    expect(html.match(/inputmode="numeric"/giu)).toHaveLength(6);
  });
});

describe("Activation wizard", () => {
  it("cannot continue from the device gate before Cloud issues the lease", () => {
    const view = wizard({
      step: "device", deviceName: "MacBook Pro", activationState: "awaiting_cloud",
      deviceIdentity: { status: "bound", deviceId: "d1" }, activeLease: { status: "awaiting_cloud" }, availableActions: ["back"],
    });
    const html = renderToStaticMarkup(<ActivationWizard locale="zh-CN" view={view} onAction={noop} onSubmitDevice={noop} />);

    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>继续/u);
    expect(html).not.toContain("创建设备密钥并提交校验");
    expect(html).toContain("Cloud 在 Bootstrap 重建与摘要校验后签发 ActiveDeviceLease");
  });

  it("shows the issued lease epoch once the device is active", () => {
    const view = wizard({
      step: "device", deviceName: "MacBook Pro", activationState: "active",
      deviceIdentity: { status: "bound", deviceId: "d1" }, activeLease: { status: "issued", issuer: "gooddealer_cloud", deviceId: "d1", leaseEpoch: 1 },
      availableActions: ["back", "continue"],
    });
    const html = renderToStaticMarkup(<ActivationWizard locale="zh-CN" view={view} onAction={noop} />);

    expect(html).toContain("ACTIVE");
    expect(html).toContain("Epoch 1");
  });

  it("explains a pending Cloud validation instead of claiming completion", () => {
    const view = wizard({ step: "complete", deviceName: "MacBook Pro", importedDomains: 823, baselineServerRevision: 1, syncReady: false, availableActions: ["enter_workspace"] });
    const html = renderToStaticMarkup(<ActivationWizard locale="zh-CN" view={view} onAction={noop} />);

    expect(html).toContain("等待 Cloud 校验");
    expect(html).not.toContain("接入完成");
  });
});
