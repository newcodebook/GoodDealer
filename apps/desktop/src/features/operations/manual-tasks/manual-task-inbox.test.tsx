import { parseManualTaskInboxViewModel, type ManualTaskInboxViewModel } from "@gooddealer/client-core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ManualTaskInbox } from "./index";

function view(status: "awaiting_user" | "verification_pending" | "confirmed_completed", standby = false): ManualTaskInboxViewModel {
  const active = !standby && status !== "confirmed_completed";
  const actions = active
    ? ["open_platform", "request_recheck", "cancel", ...(status === "awaiting_user" ? ["mark_user_operation_done"] : []), "accept_residual_risk"]
    : [];
  return parseManualTaskInboxViewModel({
    schemaVersion: 1, kind: "manual_task_inbox",
    source: standby ? "standby_cloud" : "active_local", commandAdmission: standby ? "unavailable" : "proven",
    selectedTaskId: "t1",
    tasks: [{
      id: "t1", revision: 1, operationPlanId: "p1", title: "解除注册商转移锁", priority: "high", status,
      platform: "Dynadot", account: "主账户", reason: "转移锁只能在注册商控制台关闭", affectedDomains: ["vault.io", "kanban.ai"],
      preparedArtifactLabel: null, completionCondition: "注册商显示转移锁已关闭", lastCheckedAt: null,
      checklist: [{ id: "c1", label: "登录注册商控制台", state: "completed" }, { id: "c2", label: "关闭转移锁", state: "pending" }],
      riskAcceptancePolicy: "allowed", unresolvedImpactDigest: "d".repeat(64),
      availableActions: actions,
    }],
  });
}

describe("Manual task inbox", () => {
  it("shows the reason, checklist, and the Host-admitted actions for an open task", () => {
    const html = renderToStaticMarkup(<ManualTaskInbox locale="zh-CN" view={view("awaiting_user")} onAction={() => undefined} onAcceptRisk={() => undefined} />);

    expect(html).toContain("转移锁只能在注册商控制台关闭");
    expect(html).toContain("检查清单");
    expect(html).toContain(">我已完成<");
    expect(html).toContain("接受剩余风险");
    expect(html).toContain("2 域名");
  });

  it("stops offering 'mark done' once the Host is verifying completion", () => {
    const html = renderToStaticMarkup(<ManualTaskInbox locale="zh-CN" view={view("verification_pending")} onAction={() => undefined} />);

    expect(html).toContain("验证中");
    expect(html).not.toContain(">我已完成<");
  });

  it("hands off to the platform and never offers software execution (ADR-0017)", () => {
    const html = renderToStaticMarkup(<ManualTaskInbox locale="zh-CN" view={view("awaiting_user")} onAction={() => undefined} />);

    expect(html).toContain("打开平台并登录");
    expect(html).not.toContain("Remote Browser");
    expect(html).not.toContain("授权执行");
  });

  it("removes every task action from a Standby view", () => {
    const html = renderToStaticMarkup(<ManualTaskInbox locale="zh-CN" view={view("awaiting_user", true)} onAction={() => undefined} onAcceptRisk={() => undefined} />);

    expect(html).toContain("当前为只读视图");
    expect(html).not.toContain("打开平台并登录");
    expect(html).not.toContain("接受剩余风险");
  });
});
