import { parseBatchOperationViewModel, type BatchOperationViewModel } from "@gooddealer/client-core";

import type { BatchExecutionProgress, BatchJobSummary, BatchPhase } from "../../src/features/operations/batch-operations";

/** Mock batch jobs adapted from brand/ui_kits/desktop/data.js; each detail passes the client-core parser. */
export const mockBatchJobs: readonly BatchJobSummary[] = [
  { id: "b-draft", title: "批量改价", ruleLabel: "BIN −8% · 2 平台", targetCount: 823, platform: "Atom / Afternic", account: "主账户", createdLabel: "今日 14:02", phase: "awaiting_approval", progressPercent: 0, highRisk: true, plannedCounts: { automatic: 811, manual: 12, conflict: 6 }, resultCounts: null },
  { id: "b-run", title: "变更 Nameserver → Cloudflare", ruleLabel: "迁移 DNS · 3 注册商", targetCount: 146, platform: "注册商", account: "Spaceship · Dynadot", createdLabel: "今日 13:31", phase: "running", progressPercent: 62, highRisk: true, plannedCounts: null, resultCounts: { succeeded: 90, waitingRemote: 0, retryable: 0, outcomeUnknown: 0, manual: 0, failedFinal: 0 } },
  { id: "b-done", title: "上架到 Atom", ruleLabel: "新建 Listing · BIN", targetCount: 512, platform: "Atom", account: "主账户", createdLabel: "今日 11:20", phase: "completed", progressPercent: 100, highRisk: false, plannedCounts: null, resultCounts: { succeeded: 512, waitingRemote: 0, retryable: 0, outcomeUnknown: 0, manual: 0, failedFinal: 0 } },
  { id: "b-part", title: "DNS 记录同步", ruleLabel: "TXT 验证写入", targetCount: 88, platform: "Cloudflare / 注册商", account: "DNS 提供商", createdLabel: "昨日 18:44", phase: "partially_failed", progressPercent: 100, highRisk: false, plannedCounts: null, resultCounts: { succeeded: 79, waitingRemote: 0, retryable: 3, outcomeUnknown: 0, manual: 6, failedFinal: 0 } },
  { id: "b-rb", title: "批量改价", ruleLabel: "BIN −12% · 全库", targetCount: 240, platform: "Atom", account: "主账户", createdLabel: "昨日 09:12", phase: "rolled_back", progressPercent: 100, highRisk: false, plannedCounts: null, resultCounts: null },
];

const draftItems = [
  { domain: "vault.io", field: "BIN", oldValue: "14,000.00", newValue: "12,800.00", source: "批量规则 −8%", mode: "automatic", risk: "standard" },
  { domain: "goldrail.com", field: "BIN", oldValue: "3,900.00", newValue: "3,500.00", source: "批量规则 −8%", mode: "automatic", risk: "standard" },
  { domain: "kanban.ai", field: "BIN", oldValue: "48,000.00", newValue: "45,000.00", source: "手动", mode: "automatic", risk: "standard" },
  { domain: "lumen.dev", field: "BIN", oldValue: "1,200.00", newValue: "980.00", source: "批量规则 −8%", mode: "manual", risk: "standard" },
  { domain: "driftline.com", field: "BIN", oldValue: "2,600.00", newValue: "2,400.00", source: "批量规则 −8%", mode: "automatic", risk: "standard" },
  { domain: "marble.finance", field: "BIN", oldValue: "16,500.00", newValue: "15,000.00", source: "手动", mode: "automatic", risk: "standard" },
  { domain: "oxide.dev", field: "BIN", oldValue: "5,800.00", newValue: "5,200.00", source: "批量规则 −8%", mode: "manual", risk: "standard" },
  { domain: "goldrail.com", field: "Nameserver", oldValue: "ns.spaceship.com", newValue: "cloudflare.com", source: "迁移至 Cloudflare", mode: "automatic", risk: "high" },
  { domain: "quanta.trade", field: "Nameserver", oldValue: "ns.spaceship.com", newValue: "cloudflare.com", source: "迁移至 Cloudflare", mode: "automatic", risk: "high" },
  { domain: "helio.systems", field: "Nameserver", oldValue: "ns.dynadot.com", newValue: "cloudflare.com", source: "迁移至 Cloudflare", mode: "automatic", risk: "high" },
] as const;

const digest = "a3".repeat(32);

function actionsFor(phase: BatchPhase, retryable: number, unknown: number): string[] {
  if (phase === "awaiting_approval") return ["approve", "cancel"];
  if (phase === "planned" || phase === "queued" || phase === "running") return ["cancel"];
  if (phase === "partially_failed") return [...(retryable > 0 ? ["retry_failed"] : []), ...(unknown > 0 ? ["check_unknown"] : [])];
  return [];
}

/** Detail projection for a mock job, optionally with locally excluded draft items. */
export function mockBatchDetail(job: BatchJobSummary, excludedItemIds: readonly string[] = [], phase: BatchPhase = job.phase): BatchOperationViewModel {
  const retryable = phase === "partially_failed" ? job.resultCounts?.retryable ?? 0 : 0;
  const unknown = phase === "partially_failed" ? job.resultCounts?.outcomeUnknown ?? 0 : 0;
  const finished = phase === "completed" || phase === "rolled_back";
  const items = draftItems.map((item, index) => {
    const id = `${job.id}-item-${index + 1}`;
    const excluded = excludedItemIds.includes(id);
    return {
      id,
      domain: item.domain,
      platform: item.field === "Nameserver" ? "注册商" : "Atom",
      account: "主账户",
      fieldLabel: item.field,
      oldValue: item.oldValue,
      newValue: item.newValue,
      sourceLabel: item.source,
      risk: item.risk,
      executionMode: item.mode,
      result: excluded ? "excluded" : finished ? (phase === "rolled_back" ? "rolled_back" : "succeeded") : phase === "running" ? "running" : "planned",
      detail: null,
    };
  });
  const highRiskCount = items.filter((item) => item.risk === "high" && item.result !== "excluded").length;
  return parseBatchOperationViewModel({
    schemaVersion: 1,
    kind: "batch_operation",
    batchId: job.id,
    planId: `${job.id}-plan`,
    planHash: digest,
    title: job.title,
    createdAt: "2026-08-20T06:02:00Z",
    source: "active_local",
    commandAdmission: "proven",
    phase,
    summary: {
      targetDomainCount: job.targetCount,
      platformCount: 2,
      requestOrFileCount: job.targetCount,
      automaticCount: job.plannedCounts?.automatic ?? job.targetCount,
      manualCount: job.plannedCounts?.manual ?? job.resultCounts?.manual ?? 0,
      conflictCount: job.plannedCounts?.conflict ?? 0,
      unsupportedCount: 0,
      highRiskCount: job.highRisk ? highRiskCount : 0,
      retryableCount: retryable,
      outcomeUnknownCount: unknown,
      estimatedDurationLabel: "约 6 分钟",
    },
    groups: [
      { id: `${job.id}-g1`, platform: "Atom", account: "主账户", actionLabel: "修改价格", itemCount: 811, result: "planned" },
      { id: `${job.id}-g2`, platform: "Afternic", account: "主账户", actionLabel: "生成 CSV · 人工上传", itemCount: 12, result: "planned" },
      { id: `${job.id}-g3`, platform: "注册商", account: "Spaceship · Dynadot", actionLabel: "变更 Nameserver", itemCount: 3, result: "planned" },
    ],
    itemWindow: { totalItems: job.targetCount, startIndex: 0, items: phase === "completed" || phase === "rolled_back" ? items.filter((item) => item.result !== "excluded") : items },
    availableActions: actionsFor(phase, retryable, unknown),
  });
}

export function mockBatchProgress(job: BatchJobSummary, percent: number): BatchExecutionProgress {
  const succeeded = Math.round((job.resultCounts?.succeeded ?? job.targetCount) * Math.min(percent, 100) / 100);
  return {
    percent,
    counts: job.resultCounts === null
      ? { succeeded, waitingRemote: 0, retryable: 0, outcomeUnknown: 0, manual: 0, failedFinal: 0 }
      : { ...job.resultCounts, succeeded: percent >= 100 ? job.resultCounts.succeeded : succeeded },
    throughputLabel: percent < 100 ? `${job.platform} · API 限速 2 req/s · 预计剩余 ${Math.max(0, Math.round((100 - percent) * 0.24))} 秒 · 可随时暂停` : null,
    operationId: job.phase === "rolled_back" ? "OP-2026-0803-05" : "OP-2026-0804-11",
  };
}
