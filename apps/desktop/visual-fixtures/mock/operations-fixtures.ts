import {
  parseManualTaskInboxViewModel,
  parseOperationHistoryViewModel,
  type ManualTaskInboxViewModel,
  type OperationHistoryViewModel,
} from "@gooddealer/client-core";

/** Mock Revision ledger adapted from brand/ui_kits/desktop/HistoryLog.jsx. */
export interface MockHistoryEntry {
  readonly revision: number;
  readonly at: string;
  readonly actor: string;
  readonly scope: "batch" | "single_domain" | "system" | "sync";
  readonly action: string;
  readonly platform: string;
  readonly count: number;
  readonly state: "applied" | "synced" | "rolled_back" | "cloud_pull" | "device_event" | "late_execution";
  readonly nameserver: boolean;
  readonly diffs: readonly (readonly [string, string, string | null, string | null])[];
}

export function initialMockHistory(): readonly MockHistoryEntry[] {
  return [
    { revision: 8241, at: "2026-08-20T06:02:00Z", actor: "MacBook Pro", scope: "batch", action: "批量改价 −8%", platform: "交易平台 · Atom", count: 799, state: "synced", nameserver: false, diffs: [["vault.io", "BIN", "3,000.00", "2,760.00"], ["oxide.dev", "BIN", "5,800.00", "5,336.00"], ["arc.exchange", "BIN", "12,000.00", "11,040.00"]] },
    { revision: 8240, at: "2026-08-20T06:02:00Z", actor: "MacBook Pro", scope: "batch", action: "变更 Nameserver", platform: "注册商 · Spaceship·Dynadot", count: 3, state: "synced", nameserver: true, diffs: [["goldrail.com", "NS", "ns.spaceship.com", "cloudflare.com"], ["quanta.trade", "NS", "ns.dynadot.com", "cloudflare.com"]] },
    { revision: 8239, at: "2026-08-20T06:01:00Z", actor: "MacBook Pro", scope: "batch", action: "新增 TXT 记录", platform: "DNS 提供商 · Cloudflare", count: 17, state: "synced", nameserver: false, diffs: [["crest.capital", "TXT", null, "_atom=8f2a…"], ["mint.money", "TXT", null, "_atom=1c90…"]] },
    { revision: 8238, at: "2026-08-20T05:58:00Z", actor: "MacBook Pro", scope: "batch", action: "上架 · Atom", platform: "交易平台 · Atom", count: 12, state: "synced", nameserver: false, diffs: [["north.capital", "Listing", "未上架", "Atom · $8,900"]] },
    { revision: 8237, at: "2026-08-19T10:22:00Z", actor: "MacBook Pro", scope: "single_domain", action: "手动改价", platform: "交易平台 · Atom", count: 1, state: "applied", nameserver: false, diffs: [["kanban.ai", "BIN", "45,000.00", "99,999.00"]] },
    { revision: 8233, at: "2026-08-19T08:40:00Z", actor: "Mac mini", scope: "single_domain", action: "改价 · 交权后到达", platform: "交易平台 · Atom", count: 1, state: "late_execution", nameserver: false, diffs: [["lantern.app", "BIN", "3,900.00", "4,100.00"]] },
    { revision: 8231, at: "2026-07-30T01:11:00Z", actor: "云端同步", scope: "sync", action: "拉取远端变更", platform: "GoodDealer Cloud", count: 41, state: "cloud_pull", nameserver: false, diffs: [] },
    { revision: 8220, at: "2026-07-28T03:03:00Z", actor: "MacBook Pro", scope: "batch", action: "下架", platform: "交易平台 · Afternic", count: 6, state: "synced", nameserver: false, diffs: [["legacy.io", "Listing", "Afternic", "已下架"]] },
    { revision: 8150, at: "2026-07-02T00:15:00Z", actor: "系统", scope: "system", action: "移交执行权 · Epoch 40→41", platform: "设备门禁", count: 1, state: "device_event", nameserver: false, diffs: [] },
    { revision: 8102, at: "2026-06-20T02:30:00Z", actor: "MacBook Pro", scope: "batch", action: "回滚 → rev 8,098", platform: "交易平台 · Atom", count: 23, state: "rolled_back", nameserver: false, diffs: [["misfire.co", "BIN", "900.00", "1,200.00"]] },
  ];
}

const readOnlyStates = new Set<MockHistoryEntry["state"]>(["rolled_back", "cloud_pull", "device_event", "late_execution"]);

export function mockOperationHistory(entries: readonly MockHistoryEntry[], selectedRevision: number | null, standby: boolean): OperationHistoryViewModel {
  const canCommand = !standby;
  return parseOperationHistoryViewModel({
    schemaVersion: 1,
    kind: "operation_history",
    source: standby ? "standby_cloud" : "active_local",
    commandAdmission: canCommand ? "proven" : "unavailable",
    selectedRevisionId: selectedRevision === null ? null : `rev-${selectedRevision}`,
    totalRevisions: entries[0]?.revision ?? 0,
    changesToday: entries.filter((entry) => entry.at.startsWith("2026-08-20")).reduce((sum, entry) => sum + entry.count, 0),
    pendingRevisionCount: entries.filter((entry) => entry.state === "applied").length,
    entries: entries.map((entry) => {
      const reversible = !readOnlyStates.has(entry.state);
      return {
        revisionId: `rev-${entry.revision}`,
        revisionLabel: entry.revision.toLocaleString("en-US"),
        occurredAt: entry.at,
        actorLabel: entry.actor,
        scope: entry.scope,
        actionLabel: entry.action,
        platformLabel: entry.platform,
        itemCount: entry.count,
        state: entry.state,
        risk: entry.nameserver ? "nameserver_high" : "standard",
        diffs: entry.diffs.map(([entityLabel, fieldLabel, oldValue, newValue]) => ({ entityLabel, fieldLabel, oldValue, newValue })),
        reversible,
        availableActions: reversible && canCommand ? ["plan_reversal"] : [],
        lateExecution: entry.state === "late_execution"
          ? { sourceDeviceLabel: entry.actor, leaseEpoch: 40, receivedAt: "2026-08-19T08:41:00Z", evidenceLevel: "provider_observed" }
          : null,
      };
    }),
  });
}

/** Mock manual tasks adapted from brand/ui_kits/desktop/TaskInbox.jsx, validated by the client-core parser. */
export type MockTaskStatus = "open" | "awaiting_user" | "verification_pending" | "confirmed_completed" | "cancelled" | "risk_accepted";

export interface MockTask {
  readonly id: string;
  readonly title: string;
  readonly priority: "high" | "normal" | "low";
  readonly status: MockTaskStatus;
  readonly platform: string;
  readonly account: string;
  readonly reason: string;
  readonly domains: readonly string[];
  readonly artifact: string | null;
  readonly completion: string;
  readonly riskPolicy: "forbidden" | "allowed" | "fresh_reauth_required";
  readonly browser: "running" | "paused" | null;
}

export function initialMockTasks(): readonly MockTask[] {
  return [
    { id: "task-afternic-csv", title: "上传 Afternic 价格 CSV", priority: "high", status: "awaiting_user", platform: "Afternic", account: "主账户", reason: "Afternic 不提供批量改价 API，需在后台上传 CSV", domains: ["vault.io", "goldrail.com", "kanban.ai", "oxide.dev"], artifact: "afternic-prices-0820.csv", completion: "平台价格与本地目标一致", riskPolicy: "allowed", browser: "running" },
    { id: "task-sellerhub-verify", title: "SellerHub 所有权确认", priority: "normal", status: "open", platform: "SellerHub", account: "主账户", reason: "平台要求在后台点击确认所有权", domains: ["lumen.dev"], artifact: null, completion: "平台显示所有权已验证", riskPolicy: "forbidden", browser: null },
    { id: "task-registrar-lock", title: "解除注册商转移锁", priority: "low", status: "verification_pending", platform: "Dynadot", account: "Dynadot 主账户", reason: "转移锁只能在注册商控制台关闭", domains: ["helio.systems"], artifact: null, completion: "注册商显示转移锁已关闭", riskPolicy: "fresh_reauth_required", browser: null },
    { id: "task-atom-listing", title: "Atom 上架复核", priority: "normal", status: "confirmed_completed", platform: "Atom", account: "主账户", reason: "新建 Listing 需人工复核描述", domains: ["north.capital"], artifact: null, completion: "Listing 状态为在售", riskPolicy: "forbidden", browser: null },
  ];
}

const digest = "e1".repeat(32);
const nonTerminal = new Set<MockTaskStatus>(["open", "awaiting_user", "verification_pending"]);

export function mockManualTasks(tasks: readonly MockTask[], selectedId: string | null, standby: boolean): ManualTaskInboxViewModel {
  const canCommand = !standby;
  return parseManualTaskInboxViewModel({
    schemaVersion: 1,
    kind: "manual_task_inbox",
    source: standby ? "standby_cloud" : "active_local",
    commandAdmission: canCommand ? "proven" : "unavailable",
    selectedTaskId: selectedId,
    tasks: tasks.map((task, index) => {
      const planId = `plan-${task.id}`;
      const grant = task.browser === null ? null : {
        schemaVersion: 1, grantRequestId: `grant-${task.id}`, providerConnectionId: "conn-afternic", browserSessionId: "session-2241",
        operationPlanId: planId, approvedPlanHash: digest, provider: task.platform, accountAlias: task.account, planItemCount: 12,
        planActionLabel: "上传价格 CSV", allowedActions: ["fill", "upload_csv", "read_result"], targetDomains: task.domains,
        allowedHosts: ["*.afternic.com"], issuedAt: "2026-08-20T06:00:00Z", expiresAt: "2026-08-20T07:00:00Z", requiresFinalConfirmation: true,
      };
      const browserTask = task.browser === null ? null : {
        schemaVersion: 1, taskId: `browser-${task.id}`, providerConnectionId: "conn-afternic", browserSessionId: "session-2241",
        provider: task.platform, accountAlias: task.account, allowedHosts: ["*.afternic.com"], operator: task.browser === "running" ? "software" : "user",
        state: task.browser, nextStepLabel: task.browser === "running" ? "填写价格表单 → 提交" : "等待用户完成登录", remainingItems: 3,
        controlAdmission: canCommand
          ? { status: "proven", controls: task.browser === "running" ? ["pause_and_take_over", "terminate"] : ["continue", "terminate"] }
          : { status: "unavailable", reason: "gate_unproven" },
      };
      const actions: string[] = [];
      if (nonTerminal.has(task.status) && canCommand) {
        actions.push("open_platform", "request_recheck", "cancel");
        if (task.status !== "verification_pending") actions.push("mark_user_operation_done");
        if (grant !== null) actions.push("request_automation_grant");
        if (task.riskPolicy !== "forbidden") actions.push("accept_residual_risk");
      }
      return {
        id: task.id,
        revision: index + 1,
        operationPlanId: planId,
        title: task.title,
        priority: task.priority,
        status: task.status,
        platform: task.platform,
        account: task.account,
        reason: task.reason,
        affectedDomains: task.domains,
        preparedArtifactLabel: task.artifact,
        completionCondition: task.completion,
        lastCheckedAt: "2026-08-20T05:50:00Z",
        checklist: [
          { id: `${task.id}-1`, label: "登录平台后台", state: task.status === "open" ? "pending" : "completed" },
          { id: `${task.id}-2`, label: task.artifact === null ? "完成平台要求的操作" : `上传 ${task.artifact}`, state: task.status === "confirmed_completed" ? "completed" : "pending" },
          { id: `${task.id}-3`, label: "等待系统读取平台状态核对", state: task.status === "confirmed_completed" ? "completed" : "pending" },
        ],
        riskAcceptancePolicy: task.riskPolicy,
        unresolvedImpactDigest: task.riskPolicy === "forbidden" ? null : digest,
        browserGrant: grant,
        browserTask,
        availableActions: actions,
      };
    }),
  });
}
