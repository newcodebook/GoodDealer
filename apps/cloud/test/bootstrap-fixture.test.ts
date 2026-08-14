import { describe, expect, it } from "vitest";

import {
  bootstrapStepRequestSchema,
  encodeBootstrapStepRequestDigestInput,
  type BootstrapStepRequest,
  type BootstrapStepResult,
} from "@gooddealer/protocol/devices";
import type { CheckpointDescriptor, SyncMutation } from "@gooddealer/protocol/workspace";

import { BootstrapFixtureService, type BootstrapFixtureRejection } from "../src/modules/devices/index";
import { createHash } from "node:crypto";

const ZERO_DIGEST = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const ENTITY_DIGEST = "DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD";

const checkpoint: CheckpointDescriptor = {
  schemaVersion: 1,
  checkpointId: "checkpoint-4",
  workspaceId: "workspace-a",
  workspaceSchemaVersion: 1,
  throughRevision: 4,
  checkpointDigest: ZERO_DIGEST,
};

function mutation(serverRevision: number, mutationSequence: number): SyncMutation {
  return {
    schemaVersion: 1,
    mutationId: `mutation-${serverRevision}`,
    workspaceId: "workspace-a",
    workspaceSchemaVersion: 1,
    entityType: "domain_asset",
    entityId: "domain-example-com",
    baseRevision: serverRevision - 1,
    changedFields: [{ fieldPath: "tags", value: [`tag-${serverRevision}`] }],
    sourceDeviceId: "device-a",
    activeLeaseEpoch: 2,
    mutationSequence,
    serverRevision,
  };
}

function service(
  mutations: readonly SyncMutation[] = [mutation(5, 9), mutation(6, 10)],
  initialWorkflowRevision = 0,
): BootstrapFixtureService {
  return new BootstrapFixtureService({
    deviceSwitchRequestId: "switch-1",
    capabilityJti: "bootstrap-jti-1",
    checkpoint,
    mutations,
    expectedEntityDigests: [{ entityType: "domain_asset", partitionId: null, digest: ENTITY_DIGEST }],
    stepNonceFor: (stepNumber) => `nonce-${stepNumber}`,
    now: () => new Date("2026-08-14T08:00:00Z"),
    initialWorkflowRevision,
  });
}

function signedRequest(value: Omit<BootstrapStepRequest, "requestDigest">): BootstrapStepRequest {
  const candidate = bootstrapStepRequestSchema.parse({ ...value, requestDigest: ZERO_DIGEST });
  const requestDigest = createHash("sha256")
    .update(encodeBootstrapStepRequestDigestInput(candidate))
    .digest("base64url");
  return bootstrapStepRequestSchema.parse({ ...candidate, requestDigest });
}

function pinRequest(overrides: Partial<Omit<BootstrapStepRequest, "requestDigest">> = {}): BootstrapStepRequest {
  return signedRequest({
    schemaVersion: 2,
    deviceSwitchRequestId: "switch-1",
    capabilityJti: "bootstrap-jti-1",
    stepNumber: 1,
    stepNonce: "nonce-1",
    expectedWorkflowRevision: 0,
    stepKind: "pin_checkpoint",
    stepPayload: {
      checkpointId: checkpoint.checkpointId,
      checkpointRevision: checkpoint.throughRevision,
      checkpointDigest: checkpoint.checkpointDigest,
    },
    ...overrides,
  } as Omit<BootstrapStepRequest, "requestDigest">);
}

function fetchRequest(
  stepNumber: number,
  expectedWorkflowRevision: number,
  fromRevisionExclusive: number,
  cursor: string | null,
  pageLimit = 1,
): BootstrapStepRequest {
  return signedRequest({
    schemaVersion: 2,
    deviceSwitchRequestId: "switch-1",
    capabilityJti: "bootstrap-jti-1",
    stepNumber,
    stepNonce: `nonce-${stepNumber}`,
    expectedWorkflowRevision,
    stepKind: "fetch_mutations",
    stepPayload: {
      pinnedCheckpointId: checkpoint.checkpointId,
      pinnedCheckpointRevision: checkpoint.throughRevision,
      pinnedCheckpointDigest: checkpoint.checkpointDigest,
      fromRevisionExclusive,
      throughRevisionInclusive: 6,
      cursor,
      pageLimit,
    },
  });
}

function submitRequest(digest = ENTITY_DIGEST): BootstrapStepRequest {
  return signedRequest({
    schemaVersion: 2,
    deviceSwitchRequestId: "switch-1",
    capabilityJti: "bootstrap-jti-1",
    stepNumber: 4,
    stepNonce: "nonce-4",
    expectedWorkflowRevision: 3,
    stepKind: "submit_rebuild_digest",
    stepPayload: {
      targetRevision: 6,
      workspaceSchemaVersion: 1,
      entityDigests: [{ entityType: "domain_asset", partitionId: null, digest }],
    },
  });
}

function rejection(value: BootstrapStepResult | BootstrapFixtureRejection): BootstrapFixtureRejection {
  expect("accepted" in value && value.accepted === false).toBe(true);
  return value as BootstrapFixtureRejection;
}

describe("BootstrapFixtureService", () => {
  it("pins, pages a contiguous mutation chain, verifies the rebuild, and never returns a lease", () => {
    const fixture = service();
    const pin = fixture.execute(pinRequest());
    expect("stepKind" in pin && pin.stepKind).toBe("pin_checkpoint");
    expect("nextStepNonce" in pin && pin.nextStepNonce).toBe("nonce-2");
    expect(JSON.stringify(fixture.execute(pinRequest()))).toBe(JSON.stringify(pin));

    const firstPage = fixture.execute(fetchRequest(2, 1, 4, null));
    expect("stepKind" in firstPage && firstPage.stepKind === "fetch_mutations" && firstPage.resultPayload.mutationPage)
      .toMatchObject({ returnedThroughRevision: 5, nextCursor: "bootstrap-after-5" });

    const secondPage = fixture.execute(fetchRequest(3, 2, 5, "bootstrap-after-5"));
    expect("stepKind" in secondPage && secondPage.stepKind === "fetch_mutations" && secondPage.resultPayload.mutationPage)
      .toMatchObject({ returnedThroughRevision: 6, nextCursor: null });

    const completed = fixture.execute(submitRequest());
    expect("stepKind" in completed && completed.stepKind).toBe("submit_rebuild_digest");
    expect("nextStepNonce" in completed && completed.nextStepNonce).toBeNull();
    expect(JSON.stringify(fixture.execute(submitRequest()))).toBe(JSON.stringify(completed));
    expect(JSON.stringify(completed)).not.toContain("activeDeviceLease");
  });

  it("fails closed on binding, digest, nonce, step, revision, and replay mismatches", () => {
    const bindingFixture = service();
    expect(rejection(bindingFixture.execute(pinRequest({ capabilityJti: "other-jti" }))).code).toBe("BINDING_MISMATCH");

    const digestFixture = service();
    expect(rejection(digestFixture.execute({ ...pinRequest(), requestDigest: ZERO_DIGEST })).code).toBe("DIGEST_MISMATCH");

    const nonceFixture = service();
    expect(rejection(nonceFixture.execute(pinRequest({ stepNonce: "wrong-nonce" }))).code).toBe("NONCE_MISMATCH");

    const stepFixture = service();
    expect(rejection(stepFixture.execute(fetchRequest(2, 1, 4, null))).code).toBe("STEP_OUT_OF_ORDER");

    const revisionFixture = service();
    expect(rejection(revisionFixture.execute(pinRequest({ expectedWorkflowRevision: 1 }))).code).toBe("WORKFLOW_REVISION_STALE");

    const replayFixture = service();
    replayFixture.execute(pinRequest());
    expect(rejection(replayFixture.execute(pinRequest({ stepNonce: "other-nonce" }))).code).toBe("STEP_REPLAY_CONFLICT");
  });

  it("rejects cursor changes and a rebuild digest that does not match the pinned chain", () => {
    const fixture = service();
    fixture.execute(pinRequest());
    expect(rejection(fixture.execute(fetchRequest(2, 1, 5, null))).code).toBe("MUTATION_CURSOR_MISMATCH");
    fixture.execute(fetchRequest(2, 1, 4, null));
    expect(rejection(fixture.execute(fetchRequest(3, 2, 5, "wrong-cursor"))).code).toBe("MUTATION_CURSOR_MISMATCH");
    fixture.execute(fetchRequest(3, 2, 5, "bootstrap-after-5"));
    expect(rejection(fixture.execute(submitRequest("FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF"))).code).toBe(
      "REBUILD_DIGEST_MISMATCH",
    );
  });

  it("rejects a fixture chain that crosses a workspace boundary", () => {
    expect(
      () =>
        service([
          mutation(5, 9),
          { ...mutation(6, 10), workspaceId: "workspace-b" },
        ]),
    ).toThrow("contiguous checkpoint-bound workspace chain");
  });

  it("P16-INV-2 seeds the strict-step CAS from the control-plane workflow revision", () => {
    const fixture = service([mutation(5, 9), mutation(6, 10)], 4);
    const result = fixture.execute(pinRequest({ expectedWorkflowRevision: 4 }));
    expect(result).toMatchObject({
      workflowRevision: 5,
      acceptedStepNumber: 1,
      nextStepNonce: "nonce-2",
    });
  });
});
