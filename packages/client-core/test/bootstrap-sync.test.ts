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
  schemaVersion: 1,
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
    checkpointThroughServerRevision: 2,
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
    pinnedCheckpointThroughServerRevision: 2,
    pinnedCheckpointDigest: ZERO_DIGEST,
    fromServerRevisionExclusive: 2,
    throughServerRevisionInclusive: 4,
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
    targetServerRevision: 4,
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
    entityId: `asset-${serverRevision}.test`,
    baseServerRevision: serverRevision - 1,
    changedFields: [{ fieldPath: "note", value: `revision ${serverRevision}` }],
    sourceDeviceId: "device-a",
    activeLeaseEpoch: 1,
    deviceMutationSequence: serverRevision,
    serverRevision,
  };
}

function page(input: {
  workspaceId?: string;
  fromServerRevisionExclusive: number;
  throughServerRevisionInclusive: number;
  mutations: readonly SyncMutation[];
  nextCursor: string | null;
}): MutationPage {
  const withoutDigest = {
    schemaVersion: 1 as const,
    workspaceId: input.workspaceId ?? "workspace-1",
    fromServerRevisionExclusive: input.fromServerRevisionExclusive,
    throughServerRevisionInclusive: input.throughServerRevisionInclusive,
    mutations: [...input.mutations],
    returnedThroughServerRevision:
      input.mutations.length === 0
        ? input.fromServerRevisionExclusive
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
  const corpus = JSON.parse(readFileSync(resolve(
    import.meta.dirname,
    "../../protocol/test-vectors/bootstrap-rebuild/domain-asset-v1.json",
  ), "utf8")) as {
    workspaceId: string;
    workspaceSchemaVersion: number;
    targetServerRevision: number;
    checkpointDescriptor: unknown;
    checkpointSnapshot: unknown;
    pages: { cursor: string | null; page: unknown }[];
    expected: { projection: unknown; entityDigests: unknown; digest: string };
  };

  const clone = <Value>(value: Value): Value => JSON.parse(JSON.stringify(value)) as Value;
  const start = (overrides: Partial<{
    workspaceId: string;
    workspaceSchemaVersion: number;
    targetServerRevision: number;
    checkpointDescriptor: unknown;
    checkpointSnapshot: unknown;
  }> = {}) => BootstrapRebuildAccumulator.start({
    sha256,
    workspaceId: corpus.workspaceId,
    workspaceSchemaVersion: corpus.workspaceSchemaVersion,
    targetServerRevision: corpus.targetServerRevision,
    checkpointDescriptor: clone(corpus.checkpointDescriptor),
    checkpointSnapshot: clone(corpus.checkpointSnapshot),
    ...overrides,
  });

  it("derives the shared final projection and digests from checkpoint plus two dense pages", async () => {
    const accumulator = await start();
    await accumulator.appendPage(clone(corpus.pages[0]!));
    await accumulator.appendPage(clone(corpus.pages[1]!));

    expect(await accumulator.finalize()).toEqual({
      targetServerRevision: corpus.targetServerRevision,
      projection: corpus.expected.projection,
      entityDigests: corpus.expected.entityDigests,
      digest: corpus.expected.digest,
    });
    expectTypeOf<Parameters<BootstrapRebuildAccumulator["finalize"]>>().toEqualTypeOf<[]>();
  });

  it("rejects corrupted, secret-bearing, cross-workspace, and schema-drifted checkpoints", async () => {
    const corrupted = clone(corpus.checkpointSnapshot) as { rows: { note: string | null }[] };
    corrupted.rows[0]!.note = "tampered";
    await expect(start({ checkpointSnapshot: corrupted })).rejects.toThrow(/digest/i);

    const secret = clone(corpus.checkpointSnapshot) as { rows: Record<string, unknown>[] };
    secret.rows[0]!["DEVICE_SECRET"] = "must-not-cross-boundary";
    await expect(start({ checkpointSnapshot: secret })).rejects.toThrow();

    const foreign = clone(corpus.checkpointSnapshot) as { workspaceId: string };
    foreign.workspaceId = "workspace-foreign";
    await expect(start({ checkpointSnapshot: foreign })).rejects.toThrow(/binding/i);
    await expect(start({ workspaceSchemaVersion: 999 })).rejects.toThrow(/binding/i);
  });

  it("rejects accessors before invoking them", async () => {
    let getterCalls = 0;
    const snapshot = clone(corpus.checkpointSnapshot) as Record<string, unknown>;
    Object.defineProperty(snapshot, "rows", {
      enumerable: true,
      get() { getterCalls += 1; return []; },
    });
    await expect(start({ checkpointSnapshot: snapshot })).rejects.toThrow(/accessor/i);
    expect(getterCalls).toBe(0);
  });

  it("rejects page digest, cursor, target, workspace, schema, and unknown-entity drift atomically", async () => {
    const cases: {
      mutate(value: { cursor: string | null; page: Record<string, unknown> }): void;
      pattern?: RegExp;
      refreshDigest?: boolean;
    }[] = [
      { mutate: (value) => { value.page["pageDigest"] = ZERO_DIGEST; }, pattern: /digest/i },
      { mutate: (value) => { value.cursor = "wrong-cursor"; }, pattern: /cursor/i },
      { mutate: (value) => { value.page["throughServerRevisionInclusive"] = 5; }, pattern: /target/i },
      { mutate: (value) => { value.page["workspaceId"] = "workspace-foreign"; }, pattern: /workspace/i },
      { mutate: (value) => {
        const mutations = value.page["mutations"] as Record<string, unknown>[];
        mutations[0]!["workspaceSchemaVersion"] = 999;
      } },
      { mutate: (value) => {
        const mutations = value.page["mutations"] as Record<string, unknown>[];
        mutations[0]!["entityId"] = "missing-asset.test";
      }, pattern: /unknown entity/i, refreshDigest: true },
    ];
    for (const testCase of cases) {
      const accumulator = await start();
      const changed = clone(corpus.pages[0]!) as { cursor: string | null; page: Record<string, unknown> };
      testCase.mutate(changed);
      if (testCase.refreshDigest) {
        changed.page["pageDigest"] = digestText(encodeMutationPageDigestInput(changed.page));
      }
      await expect(accumulator.appendPage(changed)).rejects.toThrow(testCase.pattern);
      expect(accumulator.snapshot().returnedThroughServerRevision).toBe(2);
      expect(accumulator.snapshot().projection).toEqual(
        (corpus.checkpointSnapshot as { rows: unknown }).rows,
      );
    }
  });

  it("rejects missing, duplicate, and reordered revisions without partial advancement", async () => {
    for (const revisions of [[4], [3, 3], [4, 3]]) {
      const accumulator = await start();
      const changed = clone(corpus.pages[0]!) as {
        cursor: string | null;
        page: { mutations: Record<string, unknown>[]; returnedThroughServerRevision: number };
      };
      const first = changed.page.mutations[0]!;
      changed.page.mutations = revisions.map((revision) => ({
        ...first,
        mutationId: `mutation-${revision}`,
        serverRevision: revision,
      }));
      changed.page.returnedThroughServerRevision = revisions.at(-1)!;
      await expect(accumulator.appendPage(changed)).rejects.toThrow();
      expect(accumulator.snapshot().returnedThroughServerRevision).toBe(2);
    }
  });

  it("rejects a repeated mutation identity across otherwise dense pages", async () => {
    const accumulator = await start();
    await accumulator.appendPage(clone(corpus.pages[0]!));
    const duplicate = clone(corpus.pages[1]!) as {
      cursor: string | null;
      page: { mutations: Record<string, unknown>[]; pageDigest: string };
    };
    duplicate.page.mutations[0]!["mutationId"] = "mutation-3";
    duplicate.page.pageDigest = digestText(encodeMutationPageDigestInput(duplicate.page));
    await expect(accumulator.appendPage(duplicate)).rejects.toThrow(/duplicated/i);
    expect(accumulator.snapshot().returnedThroughServerRevision).toBe(3);
  });

  it("requires a terminal page and refuses every post-terminal append", async () => {
    const accumulator = await start();
    await accumulator.appendPage(clone(corpus.pages[0]!));
    await expect(accumulator.finalize()).rejects.toThrow(/terminal page/i);
    await accumulator.appendPage(clone(corpus.pages[1]!));
    await expect(accumulator.appendPage(clone(corpus.pages[1]!))).rejects.toThrow(/complete/i);
  });
});
