import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, expectTypeOf, it, vi } from "vitest";

import {
  bootstrapStepRequestSchema,
  encodeBootstrapStepRequestDigestInput,
  type BootstrapStepRequest,
} from "@gooddealer/protocol/devices";
import {
  encodeMutationPageDigestInput,
  encodeWorkspaceEntityDigestsInput,
  mutationPageSchema,
  type MutationPage,
  type SyncMutation,
  type WorkspaceEntityDigest,
} from "@gooddealer/protocol/workspace";

import {
  BootstrapRebuildAccumulator,
  BootstrapStepPlanner,
  type FetchInput,
  type PinInput,
  type Sha256Port,
  type SubmitInput,
} from "../src/index";

const ZERO_DIGEST = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

function digest(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(createHash("sha256").update(bytes).digest());
}

function digestText(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("base64url");
}

const sha256: Sha256Port = { digest: async (bytes) => digest(bytes) };

const common = {
  schemaVersion: 2,
  deviceSwitchRequestId: "switch-1",
  capabilityJti: "bootstrap-jti-1",
  stepNonce: "bm9uY2UtMQ",
} as const;

const entityDigests = [
  { entityType: "domain_asset", partitionId: null, digest: ZERO_DIGEST },
] as const satisfies readonly WorkspaceEntityDigest[];

const pinInput = {
  ...common,
  stepNumber: 1,
  expectedWorkflowRevision: 1,
  stepPayload: {
    checkpointId: "checkpoint-1",
    checkpointRevision: 2,
    checkpointDigest: ZERO_DIGEST,
  },
} as const satisfies PinInput;

const fetchInput = {
  ...common,
  stepNumber: 2,
  stepNonce: "bm9uY2UtMg",
  expectedWorkflowRevision: 2,
  stepPayload: {
    pinnedCheckpointId: "checkpoint-1",
    pinnedCheckpointRevision: 2,
    pinnedCheckpointDigest: ZERO_DIGEST,
    fromRevisionExclusive: 2,
    throughRevisionInclusive: 4,
    cursor: null,
    pageLimit: 1,
  },
} as const satisfies FetchInput;

const submitInput = {
  ...common,
  stepNumber: 4,
  stepNonce: "bm9uY2UtNA",
  expectedWorkflowRevision: 4,
  stepPayload: {
    targetRevision: 4,
    workspaceSchemaVersion: 1,
    entityDigests: [...entityDigests],
  },
} as const satisfies SubmitInput;

function mutation(serverRevision: number, workspaceId = "workspace-1"): SyncMutation {
  return {
    schemaVersion: 1,
    mutationId: `mutation-${serverRevision}`,
    workspaceId,
    workspaceSchemaVersion: 1,
    entityType: "domain_asset",
    entityId: `asset-${serverRevision}`,
    baseRevision: serverRevision - 1,
    changedFields: [{ fieldPath: "note", value: `revision ${serverRevision}` }],
    sourceDeviceId: "device-a",
    activeLeaseEpoch: 1,
    mutationSequence: serverRevision,
    serverRevision,
  };
}

function page(input: {
  workspaceId?: string;
  fromRevisionExclusive: number;
  throughRevisionInclusive: number;
  mutations: readonly SyncMutation[];
  nextCursor: string | null;
}): MutationPage {
  const withoutDigest = {
    schemaVersion: 1 as const,
    workspaceId: input.workspaceId ?? "workspace-1",
    fromRevisionExclusive: input.fromRevisionExclusive,
    throughRevisionInclusive: input.throughRevisionInclusive,
    mutations: [...input.mutations],
    returnedThroughRevision:
      input.mutations.length === 0
        ? input.fromRevisionExclusive
        : input.mutations[input.mutations.length - 1]!.serverRevision,
    nextCursor: input.nextCursor,
  };
  return mutationPageSchema.parse({
    ...withoutDigest,
    pageDigest: digestText(encodeMutationPageDigestInput({ ...withoutDigest, pageDigest: ZERO_DIGEST })),
  });
}

describe("BootstrapStepPlanner", () => {
  it("exposes the frozen digest-only port", () => {
    expectTypeOf<keyof Sha256Port>().toEqualTypeOf<"digest">();
    expectTypeOf<Sha256Port["digest"]>().parameter(0).toEqualTypeOf<Uint8Array>();
    expectTypeOf<Sha256Port["digest"]>().returns.resolves.toEqualTypeOf<Uint8Array>();
  });

  it.each([
    ["pin_checkpoint", "planPinCheckpoint", pinInput],
    ["fetch_mutations", "planFetchMutations", fetchInput],
    ["submit_rebuild_digest", "planSubmitRebuildDigest", submitInput],
  ] as const)("plans a canonical %s request with the injected digest port", async (stepKind, method, input) => {
    const digestSpy = vi.fn(async (bytes: Uint8Array) => digest(bytes));
    const planner = new BootstrapStepPlanner({ sha256: { digest: digestSpy } });

    const planned = await planner[method](input as never);

    expect(bootstrapStepRequestSchema.safeParse(planned).success).toBe(true);
    expect(planned.stepKind).toBe(stepKind);
    expect(planned.stepNonce).toBe(input.stepNonce);
    expect(planned.requestDigest).toBe(digestText(encodeBootstrapStepRequestDigestInput(planned)));
    expect(digestSpy).toHaveBeenCalledOnce();
    expect(digestSpy).toHaveBeenCalledWith(encodeBootstrapStepRequestDigestInput(planned));
    expectTypeOf(planned).toEqualTypeOf<BootstrapStepRequest>();
  });

  it("rejects a digest port that does not return a SHA-256 value", async () => {
    const planner = new BootstrapStepPlanner({ sha256: { digest: async () => new Uint8Array(31) } });

    await expect(planner.planPinCheckpoint(pinInput)).rejects.toThrow(/32 bytes/);
  });

  it("uses no ambient cryptography, clock, Tauri, or Cloud implementation", () => {
    const source = readFileSync(resolve(import.meta.dirname, "../src/sync/index.ts"), "utf8");

    expect(source).not.toMatch(/node:crypto|globalThis\.crypto|crypto\.subtle|\bDate\b|Date\.now/);
    expect(source).not.toMatch(/from\s+["'](?:@tauri-apps|apps\/cloud)/);
  });
});

describe("BootstrapRebuildAccumulator", () => {
  it("verifies and folds a contiguous page chain before finalizing the rebuild digest set", async () => {
    const accumulator = new BootstrapRebuildAccumulator({
      sha256,
      workspaceId: "workspace-1",
      fromRevisionExclusive: 2,
      throughRevisionInclusive: 4,
    });
    await accumulator.appendPage(page({
      fromRevisionExclusive: 2,
      throughRevisionInclusive: 4,
      mutations: [mutation(3)],
      nextCursor: "after-3",
    }));
    await accumulator.appendPage(page({
      fromRevisionExclusive: 3,
      throughRevisionInclusive: 4,
      mutations: [mutation(4)],
      nextCursor: null,
    }));

    expect(accumulator.snapshot()).toEqual({
      workspaceId: "workspace-1",
      fromRevisionExclusive: 2,
      throughRevisionInclusive: 4,
      returnedThroughRevision: 4,
      nextCursor: null,
      completed: true,
      mutations: [mutation(3), mutation(4)],
    });
    const finalized = await accumulator.finalize(entityDigests);
    expect(finalized).toEqual({
      targetRevision: 4,
      entityDigests,
      digest: digestText(encodeWorkspaceEntityDigestsInput(entityDigests)),
    });
  });

  it("rejects a page whose pageDigest does not match", async () => {
    const accumulator = new BootstrapRebuildAccumulator({
      sha256,
      workspaceId: "workspace-1",
      fromRevisionExclusive: 2,
      throughRevisionInclusive: 3,
    });
    const valid = page({
      fromRevisionExclusive: 2,
      throughRevisionInclusive: 3,
      mutations: [mutation(3)],
      nextCursor: null,
    });

    await expect(accumulator.appendPage({ ...valid, pageDigest: ZERO_DIGEST })).rejects.toThrow(/digest/i);
    expect(accumulator.snapshot().mutations).toEqual([]);
  });

  it("rejects non-contiguous pages without repairing the gap", async () => {
    const accumulator = new BootstrapRebuildAccumulator({
      sha256,
      workspaceId: "workspace-1",
      fromRevisionExclusive: 2,
      throughRevisionInclusive: 4,
    });
    const skipped = page({
      fromRevisionExclusive: 3,
      throughRevisionInclusive: 4,
      mutations: [mutation(4)],
      nextCursor: null,
    });

    await expect(accumulator.appendPage(skipped)).rejects.toThrow(/contiguous/i);
    expect(accumulator.snapshot().returnedThroughRevision).toBe(2);

    await accumulator.appendPage(page({
      fromRevisionExclusive: 2,
      throughRevisionInclusive: 4,
      mutations: [mutation(3)],
      nextCursor: "after-3",
    }));
    expect(accumulator.snapshot().returnedThroughRevision).toBe(3);
  });

  it("rejects pages from another workspace", async () => {
    const accumulator = new BootstrapRebuildAccumulator({
      sha256,
      workspaceId: "workspace-1",
      fromRevisionExclusive: 2,
      throughRevisionInclusive: 3,
    });
    const foreign = page({
      workspaceId: "workspace-2",
      fromRevisionExclusive: 2,
      throughRevisionInclusive: 3,
      mutations: [mutation(3, "workspace-2")],
      nextCursor: null,
    });

    await expect(accumulator.appendPage(foreign)).rejects.toThrow(/workspace/i);
    expect(accumulator.snapshot().mutations).toEqual([]);
  });

  it("rejects finalization before a terminal page and rejects pages after completion", async () => {
    const accumulator = new BootstrapRebuildAccumulator({
      sha256,
      workspaceId: "workspace-1",
      fromRevisionExclusive: 2,
      throughRevisionInclusive: 4,
    });
    const first = page({
      fromRevisionExclusive: 2,
      throughRevisionInclusive: 4,
      mutations: [mutation(3)],
      nextCursor: "after-3",
    });
    const terminal = page({
      fromRevisionExclusive: 3,
      throughRevisionInclusive: 4,
      mutations: [mutation(4)],
      nextCursor: null,
    });

    await accumulator.appendPage(first);
    await expect(accumulator.finalize(entityDigests)).rejects.toThrow(/terminal page/i);
    await accumulator.appendPage(terminal);
    await expect(accumulator.appendPage(terminal)).rejects.toThrow(/complete/i);
  });
});
