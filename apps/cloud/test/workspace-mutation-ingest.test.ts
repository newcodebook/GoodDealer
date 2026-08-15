import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { DRAIN_STREAM_GENESIS_DIGEST, encodeDrainStreamEnvelope } from "@gooddealer/protocol/execution-events";
import type { SubmittedSyncMutation } from "@gooddealer/protocol/workspace";
import { describe, expect, it } from "vitest";

import { InMemoryCheckpointCatalog } from "../src/modules/workspace/checkpoints/index";
import { InMemoryReaderCursors } from "../src/modules/workspace/cursors/index";
import {
  InMemoryMutationDrainWatermarks,
  InMemoryWorkspaceLeaseRegistry,
  InMemoryWorkspaceMutationIngest,
  type MutationCommitFaultPoint,
} from "../src/modules/workspace/mutations/index";
import { InMemoryWorkspaceMutationReader } from "../src/modules/workspace/read/index";
import { InMemoryWorkspaceRevisions } from "../src/modules/workspace/revisions/index";
import { InMemoryDomainAssetPortfolio } from "../src/modules/workspace/state/portfolio/index";
import type { WorkspaceTenantScope } from "../src/modules/workspace/tenant-scope";

const scopeA = { accountId: "acct-a", workspaceId: "shared-workspace" } as const;
const scopeB = { accountId: "acct-b", workspaceId: "shared-workspace" } as const;
const sha256 = { digest: async (bytes: Uint8Array) => createHash("sha256").update(bytes).digest() };

function mutation(input: {
  sequence: number;
  mutationId?: string;
  baseRevision?: number;
  sourceDeviceId?: string;
  fieldPath?: "note" | "portfolioId" | "tags" | "targetPrice";
}): SubmittedSyncMutation {
  const fieldPath = input.fieldPath ?? "tags";
  const value = fieldPath === "tags"
    ? [{ fieldPath, value: [`tag-${String(input.sequence).padStart(4, "0")}`] }]
    : fieldPath === "note"
      ? [{ fieldPath, value: `note-${input.sequence}` }]
      : fieldPath === "portfolioId"
        ? [{ fieldPath, value: `portfolio-${input.sequence}` }]
        : [{ fieldPath, value: { currency: "USD", amount: String(input.sequence) } }];
  return {
    schemaVersion: 1,
    mutationId: input.mutationId ?? `mutation-${input.sequence}`,
    workspaceId: "shared-workspace",
    workspaceSchemaVersion: 1,
    entityType: "domain_asset",
    entityId: "shared-entity",
    baseRevision: input.baseRevision ?? input.sequence - 1,
    changedFields: value,
    sourceDeviceId: input.sourceDeviceId ?? "shared-device",
    activeLeaseEpoch: 7,
    mutationSequence: input.sequence,
  } as SubmittedSyncMutation;
}

function request(submitted: readonly SubmittedSyncMutation[]) {
  return {
    schemaVersion: 1,
    workspaceId: "shared-workspace",
    sourceDeviceId: submitted[0]?.sourceDeviceId ?? "shared-device",
    activeLeaseEpoch: 7,
    mutations: submitted,
  };
}

function harness(fault?: (point: MutationCommitFaultPoint) => void) {
  const revisions = new InMemoryWorkspaceRevisions();
  const portfolio = new InMemoryDomainAssetPortfolio();
  const leases = new InMemoryWorkspaceLeaseRegistry();
  const ledger = new InMemoryMutationDrainWatermarks();
  const ingest = new InMemoryWorkspaceMutationIngest({
    bindings: revisions,
    revisions,
    leases,
    portfolio,
    ledger,
    ...(fault === undefined ? {} : { fault }),
  });
  const reader = new InMemoryWorkspaceMutationReader({ bindings: revisions, mutations: ingest, sha256 });
  const checkpoints = new InMemoryCheckpointCatalog(revisions);
  const cursors = new InMemoryReaderCursors({ bindings: revisions, pages: reader });
  const bind = (scope: WorkspaceTenantScope) => {
    revisions.bindWorkspace(scope, 1);
    portfolio.seedDomainAsset(scope, { entityId: "shared-entity" });
    leases.bindDevice(scope, "shared-device", "active", 7);
    leases.bindDevice(scope, "standby-device", "standby", 7);
  };
  return { revisions, portfolio, leases, ledger, ingest, reader, checkpoints, cursors, bind };
}

describe("workspace SubmittedSyncMutation ingest", () => {
  it("P20-INV-13/14 enriches with one spread and appends the parsed submitted envelope", async () => {
    const subject = harness();
    subject.bind(scopeA);
    const submitted = mutation({ sequence: 1, baseRevision: 0 });
    const result = await subject.ingest.ingest(scopeA, request([submitted]));
    expect(result).toEqual({
      accepted: true,
      assignments: [{ mutationId: submitted.mutationId, mutationSequence: 1, serverRevision: 1, duplicate: false }],
      headRevision: 1,
    });
    const stored = subject.ingest.findByMutationId(scopeA, submitted.mutationId);
    expect(stored).toEqual({ ...submitted, serverRevision: 1 });
    expect(Object.keys(stored ?? {}).at(-1)).toBe("serverRevision");
    const landed = subject.ledger.readEnvelope(scopeA, {
      sourceDeviceId: submitted.sourceDeviceId,
      activeLeaseEpoch: submitted.activeLeaseEpoch,
    }, submitted.mutationSequence);
    expect(landed).toEqual(encodeDrainStreamEnvelope("mutation", submitted));
    expect(landed).toEqual(encodeDrainStreamEnvelope("mutation", stored!));
  });

  it("P20-INV-17/18/19 property: arbitrary acceptance, rejection, and replay never burns a revision", async () => {
    const subject = harness();
    subject.bind(scopeA);
    const accepted: SubmittedSyncMutation[] = [];
    for (let step = 0; step < 180; step += 1) {
      const headBefore = subject.revisions.readHead(scopeA).serverRevision;
      const stateBefore = subject.portfolio.snapshot(scopeA);
      const watermarkBefore = await subject.ledger.readWatermark(scopeA, {
        sourceDeviceId: "shared-device",
        activeLeaseEpoch: 7,
        stream: "mutation",
      });
      let result;
      if (step % 5 === 0 && accepted.length > 0) {
        result = await subject.ingest.ingest(scopeA, request([accepted[step % accepted.length]!]));
        expect(result).toMatchObject({ accepted: true, assignments: [{ duplicate: true }] });
      } else if (step % 5 === 1) {
        const rejected = mutation({ sequence: accepted.length + 1, baseRevision: headBefore + 1_000 });
        result = await subject.ingest.ingest(scopeA, request([rejected]));
        expect(result).toMatchObject({ accepted: false, code: "MUTATION_BASE_REVISION_AHEAD" });
      } else if (step % 5 === 2) {
        const rejected = { ...mutation({ sequence: accepted.length + 1, baseRevision: headBefore }), serverRevision: 999 };
        result = await subject.ingest.ingest(scopeA, request([rejected as SubmittedSyncMutation]));
        expect(result).toEqual({ accepted: false, code: "MUTATION_MALFORMED" });
      } else {
        const submitted = mutation({ sequence: accepted.length + 1, baseRevision: headBefore });
        result = await subject.ingest.ingest(scopeA, request([submitted]));
        expect(result).toMatchObject({ accepted: true, assignments: [{ duplicate: false }] });
        accepted.push(submitted);
      }

      const headAfter = subject.revisions.readHead(scopeA).serverRevision;
      expect(subject.revisions.assignedRevisions(scopeA)).toEqual(
        Array.from({ length: headAfter }, (_, index) => index + 1),
      );
      expect(subject.ingest.readCommitted(scopeA, 0, headAfter).map((record) => record.serverRevision)).toEqual(
        Array.from({ length: headAfter }, (_, index) => index + 1),
      );
      if (!result.accepted) {
        expect(headAfter).toBe(headBefore);
        expect(subject.portfolio.snapshot(scopeA)).toEqual(stateBefore);
        expect(await subject.ledger.readWatermark(scopeA, {
          sourceDeviceId: "shared-device",
          activeLeaseEpoch: 7,
          stream: "mutation",
        })).toEqual(watermarkBefore);
      }
    }
  });

  for (const point of [
    "after_ledger_append",
    "after_materialization",
    "after_log_insert",
    "before_revision_commit",
  ] as const) {
    it(`P20-INV-10/11/19 rolls back every staged effect at ${point}`, async () => {
      const subject = harness((actual) => { if (actual === point) throw new Error(`fault:${point}`); });
      subject.bind(scopeA);
      await expect(subject.ingest.ingest(scopeA, request([mutation({ sequence: 1, baseRevision: 0 })])))
        .rejects.toThrow(`fault:${point}`);
      expect(subject.revisions.readHead(scopeA).serverRevision).toBe(0);
      expect(subject.revisions.assignedRevisions(scopeA)).toEqual([]);
      expect(subject.ingest.readCommitted(scopeA, 0, 1)).toEqual([]);
      expect(subject.portfolio.inspectDomainAsset(scopeA, "shared-entity")).toMatchObject({
        tags: [],
        lastModifiedRevision: { tags: 0 },
      });
      expect(await subject.ledger.readWatermark(scopeA, {
        sourceDeviceId: "shared-device",
        activeLeaseEpoch: 7,
        stream: "mutation",
      })).toMatchObject({ contiguousReceivedThrough: 0, highestReceivedSequence: 0 });
    });
  }

  it("A7 executes N1-N8 with two tenants sharing every identifier literal", async () => {
    const subject = harness();
    subject.bind(scopeA);
    const first = mutation({ sequence: 1, mutationId: "shared-mutation", baseRevision: 0 });
    const second = mutation({ sequence: 2, mutationId: "a-second", baseRevision: 1, fieldPath: "note" });
    expect(await subject.ingest.ingest(scopeA, request([first]))).toMatchObject({ accepted: true, headRevision: 1 });
    expect(await subject.ingest.ingest(scopeA, request([second]))).toMatchObject({ accepted: true, headRevision: 2 });
    subject.checkpoints.publishFixtureCheckpoint(scopeA, {
      schemaVersion: 1,
      checkpointId: "shared-checkpoint",
      workspaceId: "shared-workspace",
      workspaceSchemaVersion: 1,
      throughRevision: 2,
      checkpointDigest: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    });
    const firstPage = await subject.reader.readPage(scopeA, {
      fromRevisionExclusive: 0,
      throughRevisionInclusive: 2,
      cursor: null,
      pageLimit: 1,
    });
    expect(firstPage).toMatchObject({ accepted: true });
    if (!firstPage.accepted) throw new TypeError("A tenant page unexpectedly rejected");

    // N1, N5, N8: absent, foreign, and structurally forged contexts fail before data access.
    expect(await subject.ingest.ingest(scopeB, request([first]))).toEqual({
      accepted: false,
      code: "WORKSPACE_TENANT_UNRESOLVED",
    });
    expect(await subject.cursors.openReaderCursor(scopeB, "shared-device", 0)).toEqual({
      accepted: false,
      code: "WORKSPACE_TENANT_UNRESOLVED",
    });
    expect(await subject.ingest.ingest(undefined as never, request([first]))).toEqual({
      accepted: false,
      code: "WORKSPACE_TENANT_UNRESOLVED",
    });
    expect(await subject.ingest.ingest({ ...scopeA, skipTenantFilter: true } as never, request([first]))).toEqual({
      accepted: false,
      code: "WORKSPACE_TENANT_UNRESOLVED",
    });

    // N7: the same drain-domain literals under B expose only the genesis projection.
    expect(await subject.ledger.readWatermark(scopeB, {
      sourceDeviceId: "shared-device",
      activeLeaseEpoch: 7,
      stream: "mutation",
    })).toEqual({
      contiguousReceivedThrough: 0,
      highestReceivedSequence: 0,
      missingRanges: [],
      rollingDigest: DRAIN_STREAM_GENESIS_DIGEST,
    });

    const aBefore = {
      head: subject.revisions.readHead(scopeA),
      state: subject.portfolio.snapshot(scopeA),
      digest: await subject.portfolio.computeBusinessDigest(scopeA, sha256.digest),
      watermark: await subject.ledger.readWatermark(scopeA, {
        sourceDeviceId: "shared-device",
        activeLeaseEpoch: 7,
        stream: "mutation",
      }),
    };

    subject.bind(scopeB);
    // N2/N3: mutationId and sequence uniqueness are tenant-prefixed, not globally shared.
    const bFirst = {
      ...first,
      changedFields: [{ fieldPath: "tags", value: ["tenant-b-tag"] }],
    } satisfies SubmittedSyncMutation;
    expect(await subject.ingest.ingest(scopeB, request([bFirst]))).toMatchObject({
      accepted: true,
      assignments: [{ mutationId: "shared-mutation", mutationSequence: 1, serverRevision: 1, duplicate: false }],
    });
    expect(subject.ingest.findByMutationId(scopeA, "shared-mutation")).toEqual({ ...first, serverRevision: 1 });
    expect(subject.ingest.findByMutationId(scopeB, "shared-mutation")).toEqual({ ...bFirst, serverRevision: 1 });

    // N4: A's opaque continuation is bound to accountId and rejected under B.
    expect(await subject.reader.readPage(scopeB, {
      fromRevisionExclusive: 1,
      throughRevisionInclusive: 2,
      cursor: firstPage.page.nextCursor,
      pageLimit: 1,
    })).toEqual({ accepted: false, code: "MUTATION_CURSOR_MISMATCH" });

    // N6: an identical checkpoint literal under B is neither selectable nor pinnable.
    expect(await subject.checkpoints.selectPublishedCheckpoint(scopeB, "shared-checkpoint")).toBeNull();
    expect(await subject.checkpoints.pinCheckpoint(scopeB, "shared-checkpoint", "2026-08-15T12:00:00Z")).toBe(false);
    expect(subject.checkpoints.pinCount(scopeA)).toBe(0);

    expect(subject.revisions.readHead(scopeA)).toEqual(aBefore.head);
    expect(subject.portfolio.snapshot(scopeA)).toEqual(aBefore.state);
    expect(await subject.portfolio.computeBusinessDigest(scopeA, sha256.digest)).toBe(aBefore.digest);
    expect(await subject.ledger.readWatermark(scopeA, {
      sourceDeviceId: "shared-device",
      activeLeaseEpoch: 7,
      stream: "mutation",
    })).toEqual(aBefore.watermark);
  });

  it("A8 rejects Standby ingest and ReaderCursor methods cannot mutate revision, ledger, or domain state", async () => {
    const subject = harness();
    subject.bind(scopeA);
    const standbyMutation = mutation({
      sequence: 1,
      baseRevision: 0,
      sourceDeviceId: "standby-device",
    });
    const before = {
      head: subject.revisions.readHead(scopeA),
      state: subject.portfolio.snapshot(scopeA),
      watermark: await subject.ledger.readWatermark(scopeA, {
        sourceDeviceId: "standby-device",
        activeLeaseEpoch: 7,
        stream: "mutation",
      }),
    };
    expect(await subject.ingest.ingest(scopeA, request([standbyMutation]))).toMatchObject({
      accepted: false,
      code: "MUTATION_DEVICE_NOT_ACTIVE",
    });
    expect(await subject.cursors.openReaderCursor(scopeA, "standby-device", 0)).toMatchObject({ accepted: true });
    expect(await subject.cursors.readAfter(scopeA, "standby-device", 0, 1)).toMatchObject({ accepted: true });
    expect(await subject.cursors.renewReaderCursor(scopeA, "standby-device")).toMatchObject({ accepted: true });
    await subject.cursors.retireReaderCursor(scopeA, "standby-device", "device_removed");
    expect(subject.cursors.snapshot(scopeA)).toMatchObject([{ status: "retired", retiredReason: "device_removed" }]);
    expect(subject.revisions.readHead(scopeA)).toEqual(before.head);
    expect(subject.portfolio.snapshot(scopeA)).toEqual(before.state);
    expect(await subject.ledger.readWatermark(scopeA, {
      sourceDeviceId: "standby-device",
      activeLeaseEpoch: 7,
      stream: "mutation",
    })).toEqual(before.watermark);
    const cursorSource = readFileSync(new URL("../src/modules/workspace/cursors/index.ts", import.meta.url), "utf8");
    expect(cursorSource).not.toMatch(/from ["']\.\.\/(mutations|revisions)/);
  });

  it("P20-INV-52/53/54 rejects beyond a tenant-scoped immutable seal without advancing head", async () => {
    const subject = harness();
    subject.bind(scopeA);
    const submitted = mutation({ sequence: 1, baseRevision: 0 });
    expect(await subject.ingest.ingest(scopeA, request([submitted]))).toMatchObject({ accepted: true });
    subject.ledger.installAcceptedDrainSeal(scopeA, {
      sourceDeviceId: "shared-device",
      activeLeaseEpoch: 7,
      stream: "mutation",
      lastAssignedSequence: 1,
    });
    expect(await subject.ingest.ingest(scopeA, request([submitted]))).toMatchObject({
      accepted: true,
      assignments: [{ duplicate: true, serverRevision: 1 }],
    });
    expect(await subject.ingest.ingest(scopeA, request([mutation({ sequence: 2, baseRevision: 1 })]))).toMatchObject({
      accepted: false,
      code: "MUTATION_DRAIN_SEALED",
    });
    expect(subject.revisions.readHead(scopeA).serverRevision).toBe(1);
    expect(subject.ledger.quarantined(scopeA)).toContainEqual({ sequence: 2, reason: "drain_seal_violation" });
    expect(() => subject.ledger.installAcceptedDrainSeal(scopeA, {
      sourceDeviceId: "shared-device",
      activeLeaseEpoch: 7,
      stream: "mutation",
      lastAssignedSequence: 2,
    })).toThrow("an accepted handoff proof is immutable");
  });
});
