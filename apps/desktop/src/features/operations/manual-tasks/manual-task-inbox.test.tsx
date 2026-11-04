import { parseManualTaskInboxViewModel, projectManualTaskInbox, type ManualTaskInboxViewModel, type ManualTasksRead } from "@gooddealer/client-core";
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
      platform: "Dynadot", account: "主账户", reason: "转移锁只能在注册商控制台关闭", affectedDomains: ["vault.io", "kanban.ai"], affectedDomainCount: 2,
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

  it("renders Host tasks read-only, pointing to the platform console without any action or browser control", () => {
    const read: ManualTasksRead = {
      schemaVersion: 1, kind: "manual_tasks", readGeneration: 1,
      freshness: { source: "active_local", readOnlyReason: null, serverRevision: 1, lastReplicationActivityAt: null, lastSuccessfulProviderObservationAt: null, canEdit: true },
      totalRows: 2,
      window: { startIndex: 0, size: 200, rows: [
        { title: "转移锁", operationKind: "transfer_unlock", capability: "registrar_lock", providerKind: "dynadot", connectionLabel: "主账户",
          highRisk: true, itemCount: 5, waitingSince: "2026-08-19T10:00:00Z", lastObservedAt: null, domainCount: 5,
          domains: ["a.test", "b.test", "c.test", "d.test", "e.test"] },
        { title: "账户步骤", operationKind: "account_check", capability: "account_verify", providerKind: null, connectionLabel: null,
          highRisk: false, itemCount: 1, waitingSince: "2026-08-20T10:00:00Z", lastObservedAt: null, domainCount: 0, domains: [] },
      ] },
    };
    const projected = projectManualTaskInbox([read], { reason: (platform, capability) => `${platform ?? "none"}:${capability}`, completionCondition: "观察后完成", noPlatform: "未绑定平台", noAccount: "—" }, null);
    const html = renderToStaticMarkup(<ManualTaskInbox locale="zh-CN" view={projected} onSelect={() => undefined} />);

    expect(html).toContain("Dynadot:registrar_lock");
    expect(html).toContain("a.test · b.test · c.test +2");
    expect(html).toContain("在对应能力资格认证前不可用");
    for (const absent of ["打开平台并登录", "我已完成", "重新检查</", "接受剩余风险", "检查清单", "授权执行", "Remote Browser"]) {
      expect(html, absent).not.toContain(absent);
    }
    const unbound = renderToStaticMarkup(<ManualTaskInbox locale="zh-CN" view={{ ...projected, selectedTaskId: "task-1" }} />);
    expect(unbound).toContain("未绑定平台 · —");
  });
});
