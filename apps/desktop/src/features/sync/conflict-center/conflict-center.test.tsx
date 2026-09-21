import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { parseConflictCenterViewModel } from "@gooddealer/client-core";

import { ConflictCenter } from "./conflict-center";

describe("ConflictCenter", () => {
  it("renders hostile values as escaped text and delete conflicts without keep-local", () => {
    const value = parseConflictCenterViewModel({
      schemaVersion: 1, kind: "conflict_center", readGeneration: 1, candidateSetVersion: 1,
      freshness: { source: "active_local", serverRevision: 1, observedAt: "2026-09-15T00:00:00Z" },
      conflicts: [{ candidateId: "candidate-1", candidateKind: "delete_conflict",
        entityDisplay: "<img src=x onerror=alert(1)>", fieldDisplay: "Lifecycle", group: "sales_status",
        risk: "high", note: "Manual review", baseValue: "Active", localValue: "<script>alert(1)</script>",
        remoteValue: "Deleted", comparisonServerRevision: 1, currentValueHash: "a".repeat(64), status: "pending",
        resolutionAdmission: { state: "available", candidateId: "candidate-1", expectedRevision: 1,
          expectedCandidateVersion: 1, expectedCurrentValueHash: "a".repeat(64), choices: ["accept_remote"] } }],
    });
    const html = renderToStaticMarkup(<ConflictCenter value={value} resolve={vi.fn()} />);
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("Keep local");
  });
});
