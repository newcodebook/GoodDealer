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
      id: "t1", revision: 1, operationPlanId: "p1", title: "上传 Afternic 价格 CSV", priority: "high", status,
      platform: "Afternic", account: "主账户", reason: "无批量改价 API", affectedDomains: ["vault.io", "kanban.ai"],
      preparedArtifactLabel: "prices.csv", completionCondition: "平台价格一致", lastCheckedAt: null,
      checklist: [{ id: "c1", label: "登录平台后台", state: "completed" }, { id: "c2", label: "上传 prices.csv", state: "pending" }],
      riskAcceptancePolicy: "allowed", unresolvedImpactDigest: "d".repeat(64), browserGrant: null, browserTask: null,
      availableActions: actions,
    }],
  });
}

describe("Manual task inbox", () => {
  it("shows the reason, checklist, and the Host-admitted actions for an open task", () => {
    const html = renderToStaticMarkup(<ManualTaskInbox locale="zh-CN" view={view("awaiting_user")} onAction={() => undefined} onAcceptRisk={() => undefined} />);

    expect(html).toContain("无批量改价 API");
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

  it("hides the browser handoff panel when the Host supplies no browser task", () => {
    expect(renderToStaticMarkup(<ManualTaskInbox locale="zh-CN" view={view("awaiting_user")} />)).not.toContain("Remote Browser");
  });

  it("removes every task action from a Standby view", () => {
    const html = renderToStaticMarkup(<ManualTaskInbox locale="zh-CN" view={view("awaiting_user", true)} onAction={() => undefined} onAcceptRisk={() => undefined} />);

    expect(html).toContain("当前为只读视图");
    expect(html).not.toContain("打开平台并登录");
    expect(html).not.toContain("接受剩余风险");
  });
});
