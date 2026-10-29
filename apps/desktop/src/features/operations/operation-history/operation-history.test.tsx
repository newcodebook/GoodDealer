import { parseOperationHistoryViewModel, type OperationHistoryViewModel } from "@gooddealer/client-core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { OperationHistory } from "./index";

type EntryInput = Record<string, unknown>;

function entry(id: string, overrides: EntryInput = {}): EntryInput {
  return {
    revisionId: id, revisionLabel: id.replace("rev-", ""), occurredAt: "2026-08-20T06:02:00Z", actorLabel: "MacBook Pro",
    scope: "batch", actionLabel: "批量改价", platformLabel: "Atom", itemCount: 3, state: "synced", risk: "standard",
    diffs: [{ entityLabel: "vault.io", fieldLabel: "BIN", oldValue: "3,000.00", newValue: "2,760.00" }],
    reversible: true, availableActions: ["plan_reversal"], lateExecution: null, ...overrides,
  };
}

function view(entries: readonly EntryInput[], selected: string, standby = false): OperationHistoryViewModel {
  return parseOperationHistoryViewModel({
    schemaVersion: 1, kind: "operation_history",
    source: standby ? "standby_cloud" : "active_local", commandAdmission: standby ? "unavailable" : "proven",
    selectedRevisionId: selected, totalRevisions: 3, changesToday: 3, pendingRevisionCount: 0,
    entries: standby ? entries.map((item) => ({ ...item, availableActions: [] })) : entries,
  });
}

describe("Operation history", () => {
  it("offers rollback for a reversible Revision and shows its field diffs", () => {
    const html = renderToStaticMarkup(<OperationHistory locale="zh-CN" view={view([entry("rev-8241")], "rev-8241")} onPlanReversal={() => undefined} />);

    expect(html).toContain("回滚此 Revision");
    expect(html).toContain("字段变更 · 示例 1 / 3");
    expect(html).toContain("vault.io");
  });

  it("never offers rollback for cloud pulls or late executions and explains late execution provenance", () => {
    const late = entry("rev-8233", {
      state: "late_execution", reversible: false, availableActions: [],
      lateExecution: { sourceDeviceLabel: "Mac mini", leaseEpoch: 40, receivedAt: "2026-08-19T08:41:00Z", evidenceLevel: "provider_observed" },
    });
    const html = renderToStaticMarkup(<OperationHistory locale="zh-CN" view={view([late], "rev-8233")} onPlanReversal={() => undefined} />);

    expect(html).not.toContain("回滚此 Revision");
    expect(html).toContain("Mac mini（Epoch 40）");
    expect(html).toContain("平台观测");
  });

  it("removes rollback from a Standby view", () => {
    const html = renderToStaticMarkup(<OperationHistory locale="zh-CN" view={view([entry("rev-8241")], "rev-8241", true)} onPlanReversal={() => undefined} />);

    expect(html).toContain("当前为只读视图");
    expect(html).not.toContain("回滚此 Revision");
  });
});
