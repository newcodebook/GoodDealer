import { parseBatchOperationViewModel, projectBatchOperationList, type BatchOperationViewModel } from "@gooddealer/client-core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BatchDetail, BatchList, batchDetailMode, type BatchJobSummary } from "./index";

function batch(phase: BatchOperationViewModel["phase"], highRisk: boolean): BatchOperationViewModel {
  const actions = phase === "awaiting_approval" ? ["approve", "cancel"] : phase === "running" ? ["cancel"] : phase === "partially_failed" ? ["retry_failed"] : [];
  return parseBatchOperationViewModel({
    schemaVersion: 1,
    kind: "batch_operation",
    batchId: "b-1",
    planId: "p-1",
    planHash: "0".repeat(64),
    title: "批量改价",
    createdAt: "2026-08-20T06:02:00Z",
    source: "active_local",
    commandAdmission: "proven",
    phase,
    summary: {
      targetDomainCount: 3, platformCount: 1, requestOrFileCount: 3, automaticCount: 3, manualCount: 0,
      conflictCount: 0, unsupportedCount: 0, highRiskCount: highRisk ? 1 : 0,
      retryableCount: phase === "partially_failed" ? 1 : 0, outcomeUnknownCount: 0, estimatedDurationLabel: "约 1 分钟",
    },
    groups: [{ id: "g-1", platform: "Atom", account: "主账户", actionLabel: "修改价格", itemCount: 3, result: "planned" }],
    itemWindow: {
      totalItems: 3,
      startIndex: 0,
      items: [{
        id: "i-1", domain: "goldrail.com", platform: "注册商", account: "主账户", fieldLabel: "Nameserver",
        oldValue: "ns.spaceship.com", newValue: "cloudflare.com", sourceLabel: "迁移", risk: highRisk ? "high" : "standard",
        executionMode: "automatic", result: phase === "completed" ? "succeeded" : "planned", detail: null,
      }],
    },
    availableActions: actions,
  });
}

describe("Batch operations presentation", () => {
  it("maps every phase to exactly one detail mode", () => {
    expect(batchDetailMode("awaiting_approval")).toBe("plan");
    expect(batchDetailMode("running")).toBe("run");
    expect(batchDetailMode("partially_failed")).toBe("result");
    expect(batchDetailMode("rolled_back")).toBe("result");
  });

  it("offers approval with exact counts only for an approvable plan", () => {
    const plan = renderToStaticMarkup(<BatchDetail locale="zh-CN" batch={batch("awaiting_approval", true)} onBack={() => undefined} onApprove={() => undefined} />);
    const running = renderToStaticMarkup(<BatchDetail locale="zh-CN" batch={batch("running", true)} onBack={() => undefined} onApprove={() => undefined} />);

    expect(plan).toContain("确认并开始执行");
    expect(plan).toContain("将提交");
    expect(plan).toContain("项高风险");
    expect(running).not.toContain("确认并开始执行");
    expect(running).toContain("RUNNING");
  });

  it("offers retry only when the Host admits it for a partial failure", () => {
    const partial = renderToStaticMarkup(<BatchDetail locale="zh-CN" batch={batch("partially_failed", false)} onBack={() => undefined} onRetryFailed={() => undefined} />);
    const done = renderToStaticMarkup(<BatchDetail locale="zh-CN" batch={batch("completed", false)} onBack={() => undefined} onRetryFailed={() => undefined} />);

    expect(partial).toContain("重试失败项");
    expect(done).not.toContain("重试失败项");
  });

  it("lists jobs with their phase and footer count", () => {
    const job: BatchJobSummary = {
      id: "b-1", title: "上架到 Atom", ruleLabel: "新建 Listing", targetCount: 512, platform: "Atom", account: "主账户",
      createdLabel: "今日 11:20", completedOn: "2026-08-20", phase: "completed", progressPercent: 100, highRisk: false, plannedCounts: null,
      resultCounts: { succeeded: 512, waitingRemote: 0, retryable: 0, outcomeUnknown: 0, manual: 0, failedFinal: 0 },
    };
    const html = renderToStaticMarkup(<BatchList locale="zh-CN" jobs={[job]} />);

    expect(html).toContain("上架到 Atom");
    expect(html).toContain("已完成");
    expect(html).toContain("共 1 个批次");
  });

  it("renders a Host projection with creation unavailable and no invented labels or detail affordance", () => {
    const view = projectBatchOperationList([{
      schemaVersion: 1, kind: "batch_operations", readGeneration: 1,
      freshness: { source: "active_local", readOnlyReason: null, serverRevision: 1, lastReplicationActivityAt: null, lastSuccessfulProviderObservationAt: null, canEdit: true },
      totalRows: 1,
      window: { startIndex: 0, size: 200, rows: [{
        title: "Nameserver change", operationKind: "dns_change", planPhase: "approved", operationPhase: "completed",
        riskLevel: "standard", itemCount: 1, targetCount: 1, createdAt: "2026-08-19T10:00:00Z", completedAt: "2026-08-20T10:00:00Z",
        providerKinds: [], planned: { automatic: 1, manual: 0, unsupported: 0, conflict: 0, excluded: 0, highRisk: 0 },
        results: { queued: 0, running: 0, succeeded: 1, waitingRemote: 0, manualActionRequired: 0, failedRetryable: 0, outcomeUnknown: 0, failedFinal: 0, cancelled: 0, rolledBack: 0 },
      }] },
    }]);
    const html = renderToStaticMarkup(
      <BatchList locale="zh-CN" jobs={view.items} creationAvailability={view.creationAvailability} today="2026-08-20" onCreateFromLibrary={() => undefined} />,
    );

    expect(html).toContain("暂不能新建批量任务");
    expect(html).not.toContain("去资产库新建");
    expect(html).toContain("Nameserver change");
    const openable = renderToStaticMarkup(<BatchList locale="zh-CN" jobs={view.items} today="2026-08-20" onOpen={() => undefined} />);
    expect(openable.match(/<svg/gu)?.length ?? 0).toBeGreaterThan(html.match(/<svg/gu)?.length ?? 0);
    expect(renderToStaticMarkup(<BatchList locale="zh-CN" jobs={view.items} today="2026-08-21" />)).toMatch(/今日完成[^]*?>0</u);
  });
});
