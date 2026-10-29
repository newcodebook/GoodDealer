import { parseConflictCenterViewModel, type ConflictCenterViewModel } from "@gooddealer/client-core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ConflictCenter } from "./index";

const hash = "c".repeat(64);

function view(source: "active_local" | "local_continuation", kind: "field_conflict" | "delete_conflict" = "field_conflict"): ConflictCenterViewModel {
  const active = source === "active_local";
  return parseConflictCenterViewModel({
    schemaVersion: 1, kind: "conflict_center", readGeneration: 2, candidateSetVersion: 1,
    freshness: { source, serverRevision: 9, observedAt: "2026-08-20T06:02:00Z" },
    conflicts: [{
      candidateId: "c1", candidateKind: kind, entityDisplay: "north.capital", fieldDisplay: "BIN", group: "price", risk: "normal",
      note: "远端修改", baseValue: "<b>8,900.00</b>", localValue: "8,200.00", remoteValue: "8,450.00",
      comparisonServerRevision: 9, currentValueHash: hash, status: "pending",
      resolutionAdmission: active
        ? { state: "available", candidateId: "c1", expectedRevision: 9, expectedCandidateVersion: 1, expectedCurrentValueHash: hash, choices: kind === "delete_conflict" ? ["accept_remote"] : ["keep_local", "accept_remote"] }
        : { state: "unavailable" },
    }],
  });
}

describe("Conflict center", () => {
  it("renders Base / Local / Remote and offers exactly the admitted single choices", () => {
    const html = renderToStaticMarkup(<ConflictCenter locale="zh-CN" view={view("active_local")} onResolve={() => undefined} />);

    expect(html).toContain("编辑基线 Base");
    expect(html).toContain("保留本地");
    expect(html).toContain("接受平台");
    expect(html).toContain("1 项待裁决");
    expect(html).not.toContain("全部保留本地");
  });

  it("renders hostile display values as text", () => {
    const html = renderToStaticMarkup(<ConflictCenter locale="zh-CN" view={view("active_local")} />);

    expect(html).toContain("&lt;b&gt;8,900.00&lt;/b&gt;");
  });

  it("limits delete conflicts to accepting the remote deletion", () => {
    const html = renderToStaticMarkup(<ConflictCenter locale="zh-CN" view={view("active_local", "delete_conflict")} onResolve={() => undefined} />);

    expect(html).not.toContain(">保留本地<");
    expect(html).toContain("只能接受平台删除");
  });

  it("explains instead of offering choices when the projection grants no resolution", () => {
    const html = renderToStaticMarkup(<ConflictCenter locale="zh-CN" view={view("local_continuation")} onResolve={() => undefined} />);

    expect(html).toContain("此设备当前不可裁决");
    expect(html).not.toContain(">接受平台<");
  });
});
