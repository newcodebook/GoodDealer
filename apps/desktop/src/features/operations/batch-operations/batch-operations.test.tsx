import { parseBatchOperationViewModel, type BatchOperationViewModel } from "@gooddealer/client-core";
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
      createdLabel: "今日 11:20", phase: "completed", progressPercent: 100, highRisk: false, plannedCounts: null,
      resultCounts: { succeeded: 512, waitingRemote: 0, retryable: 0, outcomeUnknown: 0, manual: 0, failedFinal: 0 },
    };
    const html = renderToStaticMarkup(<BatchList locale="zh-CN" jobs={[job]} />);

    expect(html).toContain("上架到 Atom");
    expect(html).toContain("已完成");
    expect(html).toContain("共 1 个批次");
  });
});
