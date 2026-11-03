import { projectActivationWizardViewModel, projectDrainingViewModel } from "@gooddealer/client-core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ActivationWizard, RuntimeStatusPage, SignIn } from "./index";

function wizard(input: unknown) {
  const result = projectActivationWizardViewModel(input);
  if (!result.ok) throw new Error("fixture");
  return result.value;
}

const frame = { platform: "windows", framed: false } as const;
const noop = () => undefined;

describe("Browser sign-in gate", () => {
  it("never renders a credential field; it only starts browser sign-in", () => {
    const html = renderToStaticMarkup(<SignIn locale="zh-CN" state="signed_out" windowFrame={frame} onBegin={noop} />);

    expect(html).not.toContain("<input");
    expect(html).toContain("在浏览器中登录");
    expect(html).toContain("不接触密码或令牌");
  });

  it("waits for the browser and offers to reopen it, but not while establishing authorization", () => {
    const pending = renderToStaticMarkup(<SignIn locale="zh-CN" state="pending" windowFrame={frame} onBegin={noop} />);
    expect(pending).toContain("等待浏览器完成登录");
    expect(pending).toContain("重新打开浏览器");

    const establishing = renderToStaticMarkup(<SignIn locale="zh-CN" state="establishing" windowFrame={frame} onBegin={noop} />);
    expect(establishing).toContain("正在建立本机授权");
    expect(establishing).not.toContain("gd-btn");
  });

  it("offers retry only for a retryable refresh and no action when the host is unavailable", () => {
    const retryable = renderToStaticMarkup(<SignIn locale="zh-CN" state="authorization_retryable" windowFrame={frame} onBegin={noop} onRetry={noop} />);
    expect(retryable).toContain(">重试<");
    expect(retryable).toContain("重新登录");

    const failed = renderToStaticMarkup(<SignIn locale="zh-CN" state="authorization_failed" windowFrame={frame} onBegin={noop} onRetry={noop} />);
    expect(failed).not.toContain(">重试<");

    const unavailable = renderToStaticMarkup(<SignIn locale="zh-CN" state="host_unavailable" windowFrame={frame} onBegin={noop} />);
    expect(unavailable).toContain("安全宿主暂不可用");
    expect(unavailable).not.toContain("gd-btn");
  });
});

describe("Runtime status page", () => {
  it("offers sign-in again only for a security lock", () => {
    const html = renderToStaticMarkup(<RuntimeStatusPage locale="zh-CN" kind="security_locked" windowFrame={frame} onSignInAgain={noop} onRetry={noop} />);
    expect(html).toContain("重新登录");
    expect(html).not.toContain(">重试<");
    expect(html).toContain("本地数据不会因锁定删除");
  });

  it("shows no action while a transition is in progress", () => {
    for (const kind of ["opening", "activating", "startup_recovery"] as const) {
      expect(renderToStaticMarkup(<RuntimeStatusPage locale="zh-CN" kind={kind} windowFrame={frame} onRetry={noop} onSignInAgain={noop} />)).not.toContain("gd-btn");
    }
  });

  it("reports how much remains while draining", () => {
    const draining = projectDrainingViewModel({
      reason: "handoff", phase: "uploading_envelopes", canCancel: false, failureReference: null,
      streams: [
        { stream: "mutations", acknowledgedSequence: 9, pendingCount: 3, gapCount: 0 },
        { stream: "execution_facts", acknowledgedSequence: 4, pendingCount: 1, gapCount: 0 },
        { stream: "workspace_device_audit", acknowledgedSequence: 2, pendingCount: 0, gapCount: 0 },
      ],
    });
    if (!draining.ok) throw new Error("fixture");
    expect(renderToStaticMarkup(<RuntimeStatusPage locale="zh-CN" kind="draining" windowFrame={frame} draining={draining.value} />)).toContain("剩余 4 项待提交");
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
