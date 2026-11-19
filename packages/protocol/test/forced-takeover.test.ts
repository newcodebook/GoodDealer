import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { forcedTakeoverCancelIntentRequestSchema,forcedTakeoverCancelIntentResponseSchema,forcedTakeoverRequestSchema, forcedTakeoverPreviewRequestSchema, forcedTakeoverPreviewResponseSchema,
  forcedTakeoverStatusRequestSchema, forcedTakeoverStatusResponseSchema, forcedTakeoverResolveRequestSchema,
  forcedTakeoverResolveResponseSchema, deviceBootstrapClaimResponseSchema, deviceBootstrapReceiptResponseSchema,
  deviceBootstrapStepResponseSchema, deviceBootstrapCheckpointResponseSchema, deviceBootstrapActivationResponseSchema } from "../src/devices/index";
const corpus=JSON.parse(readFileSync(new URL("../test-vectors/forced-takeover/valid.json",import.meta.url),"utf8"));
describe("forced takeover strict target contracts",()=>{
  it("accepts generated request, preview, status, original resolution and claim receipts",()=>{
    for (const [schema,value] of [[forcedTakeoverCancelIntentRequestSchema,corpus.cancelIntentRequest],
      [forcedTakeoverCancelIntentResponseSchema,corpus.cancelledBeforeRequest],[forcedTakeoverCancelIntentResponseSchema,corpus.cancelledWorkflow],
      [forcedTakeoverRequestSchema,corpus.request],
      [forcedTakeoverPreviewRequestSchema,corpus.previewRequest],[forcedTakeoverPreviewResponseSchema,corpus.previewResponse],
      [forcedTakeoverStatusRequestSchema,corpus.statusRequest],[forcedTakeoverStatusResponseSchema,corpus.statusResponse],
      [forcedTakeoverStatusResponseSchema,corpus.claimableResponse],[forcedTakeoverResolveRequestSchema,corpus.resolveRequest],
      [forcedTakeoverResolveResponseSchema,corpus.resolveResponse]] as const)expect(schema.safeParse(value).success).toBe(true);
  });
  it.each(["reauthProofId","accountId","workspaceId","fromDeviceId","cookie","session","role"])("rejects caller authority field %s",field=>{
    expect(forcedTakeoverRequestSchema.safeParse({...corpus.request,[field]:"extra"}).success).toBe(false);
    expect(forcedTakeoverPreviewRequestSchema.safeParse({...corpus.previewRequest,[field]:"extra"}).success).toBe(false);
  });
  it.each([0,-1,1.2,Number.MAX_SAFE_INTEGER+1,"1",null])("rejects invalid source CAS %s",expectedSourceLeaseEpoch=>{
    expect(forcedTakeoverRequestSchema.safeParse({...corpus.request,expectedSourceLeaseEpoch}).success).toBe(false);
  });
  it("rejects unrelated original request and premature or terminal claimability",()=>{
    for(const changed of [{toDeviceId:"other"},{expectedSourceLeaseEpoch:2},{idempotencyKey:"other"}])
      expect(forcedTakeoverResolveResponseSchema.safeParse({...corpus.resolveResponse,originalRequest:{...corpus.request,...changed}}).success).toBe(false);
    const waiting=corpus.statusResponse.workflow;
    expect(forcedTakeoverStatusResponseSchema.safeParse({...corpus.statusResponse,workflow:{...waiting,claimable:true}}).success).toBe(false);
    expect(forcedTakeoverStatusResponseSchema.safeParse({...corpus.claimableResponse,workflow:{...corpus.claimableResponse.workflow,request:{...waiting.request,status:"cancelled"}}}).success).toBe(false);
  });
  it("admits waiting receipt only for claim with no next step",()=>{
    const waiting={schemaVersion:1,outcome:"uncommitted",workflow:{requestId:"forced-workflow",workflowRevision:1,status:"waiting_expiry"},operation:{kind:"claim"},nextStep:null};
    expect(deviceBootstrapReceiptResponseSchema.safeParse(waiting).success).toBe(true);
    expect(deviceBootstrapReceiptResponseSchema.safeParse({...waiting,nextStep:{stepNumber:1,stepKind:"pin_checkpoint"}}).success).toBe(false);
    expect(deviceBootstrapReceiptResponseSchema.safeParse({...waiting,operation:{kind:"step",stepNumber:1,requestDigest:"A".repeat(43),replayDigest:"A".repeat(43)}}).success).toBe(false);
    expect(deviceBootstrapClaimResponseSchema.safeParse({schemaVersion:1,accepted:false,code:"TAKEOVER_NOT_READY"}).success).toBe(true);
  });
  it("rejects takeover waiting as a capability-bearing operation response",()=>{
    const waiting={schemaVersion:1,accepted:false,code:"TAKEOVER_NOT_READY"};
    for(const schema of [deviceBootstrapStepResponseSchema,deviceBootstrapCheckpointResponseSchema,deviceBootstrapActivationResponseSchema])
      expect(schema.safeParse(waiting).success).toBe(false);
  });
});
