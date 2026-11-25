import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { manualTaskDomainSampleLimit } from "@gooddealer/client-core";

const hostRead = fileURLToPath(new URL("../../../../crates/local-storage/src/active_workspace/manual_tasks.rs", import.meta.url));

describe("manual task domain sample", () => {
  it("is the same size on the Host and in the Renderer read contract", () => {
    // The contract rejects any other sample size, so a drift would fail every large task's read
    // at runtime; pin the two constants here instead.
    const declared = /^const DOMAIN_LIMIT: u32 = (\d+);$/mu.exec(readFileSync(hostRead, "utf8"))?.[1];
    expect(declared).toBeDefined();
    expect(Number(declared)).toBe(manualTaskDomainSampleLimit);
  });
});
