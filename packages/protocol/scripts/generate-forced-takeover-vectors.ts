import { mkdirSync, writeFileSync } from "node:fs";
import { forcedTakeoverPreviewResponseSchema, forcedTakeoverRequestSchema, forcedTakeoverStatusResponseSchema,
  forcedTakeoverResolveResponseSchema, forcedTakeoverCancelIntentResponseSchema, deviceBootstrapReceiptResponseSchema } from "../src/devices/index";
const request = forcedTakeoverRequestSchema.parse({ schemaVersion: 2, mode: "forced", toDeviceId: "installation-target",
  expectedSourceLeaseEpoch: 1, idempotencyKey: "forced-original-intent" });
const view = { schemaVersion: 2, requestId: "installation-workflow", mode: "forced", status: "waiting_expiry",
  fromDeviceId: "installation-source", toDeviceId: request.toDeviceId, requestedAt: "2029-12-31T00:00:00Z",
  earliestTakeoverAt: "2030-01-01T00:00:00Z", bootstrapExpiresAt: null, normalHandoffReceipt: null };
const status = forcedTakeoverStatusResponseSchema.parse({ schemaVersion: 1, found: true, workflow: {
  request: view, workflowRevision: 1, sourceLeaseEpoch: 1, evaluatedAt: "2029-12-31T12:00:00Z", claimable: false,
} });
if (!status.found) throw new Error("fixture requires a workflow");
const corpus = { schemaVersion: 1, generatedBy: "scripts/generate-forced-takeover-vectors.ts", fixtureOnly: true,
  request,
  cancelIntentRequest: {schemaVersion:1,originalRequest:request},
  cancelledBeforeRequest: forcedTakeoverCancelIntentResponseSchema.parse({schemaVersion:1,outcome:"cancelled_before_request",originalRequest:request}),
  cancelledWorkflow: forcedTakeoverCancelIntentResponseSchema.parse({schemaVersion:1,outcome:"workflow",originalRequest:request,workflow:{...status.workflow,request:{...view,status:"cancelled"}}}),
  previewRequest: { schemaVersion: 1 },
  previewResponse: forcedTakeoverPreviewResponseSchema.parse({ schemaVersion: 1, available: true,
    sourceDeviceId: view.fromDeviceId, sourceLeaseEpoch: 1, toDeviceId: request.toDeviceId,
    earliestTakeoverAt: view.earliestTakeoverAt, evaluatedAt: "2029-12-31T00:00:00Z" }),
  requestResponse: { schemaVersion: 1, accepted: true, request: view },
  statusRequest: { schemaVersion: 1, requestId: view.requestId }, statusResponse: status,
  claimableResponse: forcedTakeoverStatusResponseSchema.parse({ ...status, workflow: {
    ...status.workflow, evaluatedAt: "2030-01-01T00:00:00Z", claimable: true,
  } }),
  resolveRequest: { schemaVersion: 1, idempotencyKey: request.idempotencyKey },
  resolveResponse: forcedTakeoverResolveResponseSchema.parse({ schemaVersion: 1, found: true,
    idempotencyKey: request.idempotencyKey, originalRequest: request, workflow: status.workflow }),
  cancelRequest: { schemaVersion: 1, requestId: view.requestId },
  cancelResponse: { schemaVersion: 1, accepted: true, request: { ...view, status: "cancelled" } },
  claimNotReady: { schemaVersion: 1, accepted: false, code: "TAKEOVER_NOT_READY" },
  waitingClaimReceipt: deviceBootstrapReceiptResponseSchema.parse({ schemaVersion: 1, outcome: "uncommitted",
    workflow: { requestId: view.requestId, workflowRevision: 1, status: "waiting_expiry" },
    operation: { kind: "claim" }, nextStep: null }),
  cancelledClaimReceipt: deviceBootstrapReceiptResponseSchema.parse({ schemaVersion: 1, outcome: "terminal",
    workflow: { requestId: view.requestId, workflowRevision: 2, status: "cancelled" }, operation: { kind: "claim" } }),
};
mkdirSync("test-vectors/forced-takeover", { recursive: true });
writeFileSync("test-vectors/forced-takeover/valid.json", JSON.stringify(corpus, null, 2) + "\n");
