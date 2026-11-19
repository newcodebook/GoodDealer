import { describe, expect, it } from "vitest";
import { afternicListingWritePreviewRequestSchema as preview, afternicListingWritePlanSchema as planSchema, afternicListingWriteStatusSchema as statusSchema, parseAfternicListingWritePlan } from "./afternic-listing-write";
const id="00000000-0000-4000-8000-000000000001";
const values={buynowPriceMicroUsd:0,floorPriceMicroUsd:0,minbidPriceMicroUsd:20_000_000,hidden:false};
const request={schemaVersion:1,connectionId:id,action:"create",items:[{domain:"wecin.com",values}]};
const observed={providerStatus:"ACTIVE",...values,observedAt:"2026-11-19T12:01:00Z"};
const item={domain:"wecin.com",before:null,changes:values,latest:observed,fieldsMatched:true,state:"applied",reason:null,retryAt:null};
const plan={schemaVersion:1,planRef:id,planHash:"a".repeat(64),action:"create",connectionLabel:"Afternic",createdAt:"2026-11-19T12:00:00Z",expiresAt:"2026-11-19T12:15:00Z",approvedAt:"2026-11-19T12:00:30Z",state:"completed",items:[item]};
describe("Afternic listing write bounded contracts",()=>{
  it("preserves explicit zero and false, and update omitted keys",()=>{
    expect(preview.parse(request)).toEqual(request);
    const update={...request,action:"update",items:[{domain:"wecin.com",patch:{hidden:false}}]};
    expect(preview.parse(update)).toEqual(update);
    expect(planSchema.parse(plan)).toEqual(plan);
  });
  it.each([{}, {hidden:null}, {hidden:undefined}, {secret:"x"}, {buynowPriceMicroUsd:0.1}, {floorPriceMicroUsd:-1}, {minbidPriceMicroUsd:19_000_000}, {buynowPriceMicroUsd:50_000_000_000_000}])("rejects invalid patch %o",patch=>{
    expect(preview.safeParse({...request,action:"update",items:[{domain:"wecin.com",patch}]}).success).toBe(false);
  });
  it("rejects omitted create values, duplicate targets, and caller authority",()=>{
    for(const changed of [{items:[{domain:"wecin.com",values:{hidden:false}}]}, {items:[...request.items,...request.items]}, {accountId:id}, {action:"remove"}, {items:[{domain:"WECIN.com",values}]}])
      expect(preview.safeParse({...request,...changed}).success).toBe(false);
  });
  it.each(["OWNERSHIP_REVIEW","OWNERSHIP_UNVERIFIED","PENDING","UNKNOWN","SOLD"])("does not equate matched fields with completion: %s",providerStatus=>{
    expect(planSchema.safeParse({...plan,items:[{...item,latest:{...observed,providerStatus}}]}).success).toBe(false);
  });
  it("keeps verification and provider waits executing with exact original selected fields",()=>{
    for(const [state,providerStatus] of [["pending_verification","OWNERSHIP_REVIEW"],["pending_provider","PENDING"],["pending_provider","ON_HOLD"]]) {
      const waiting={...plan,state:"executing",items:[{...item,state,latest:{...observed,providerStatus},retryAt:"2026-11-19T12:02:00Z"}]};
      expect(planSchema.safeParse(waiting).success).toBe(true);
      expect(planSchema.safeParse({...waiting,state:"completed"}).success).toBe(false);
    }
    expect(planSchema.safeParse({...plan,items:[{...item,latest:{...observed,hidden:true}}]}).success).toBe(false);
    expect(planSchema.safeParse({...plan,action:"update"}).success).toBe(false);
  });
  it("retains matched fields with contradictory marketplace visibility as pending",()=>{
    const pending={...plan,state:"executing",items:[{...item,state:"pending_provider",latest:{...observed,providerStatus:"HIDDEN"},retryAt:"2026-11-19T12:02:00Z"}]};
    expect(planSchema.safeParse(pending).success).toBe(true);
    expect(planSchema.safeParse({...pending,state:"completed",items:[{...pending.items[0],state:"applied",retryAt:null}]}).success).toBe(false);
    const update={...pending,action:"update",items:[{...pending.items[0],before:{...observed,observedAt:plan.createdAt},changes:{buynowPriceMicroUsd:0},latest:{...observed,providerStatus:"HIDDEN",hidden:null}}]};
    expect(planSchema.safeParse(update).success).toBe(true);
    expect(planSchema.safeParse({...update,state:"completed",items:[{...update.items[0],state:"applied",retryAt:null}]}).success).toBe(false);
  });
  it("rejects contradictory counts and secret result fields without leaking values",()=>{
    const summary={planRef:id,action:"create",connectionLabel:"Afternic",createdAt:plan.createdAt,state:"completed",total:1,applied:1,conflicts:0,pending:0,pendingProvider:0,pendingVerification:0};
    const status={schemaVersion:1,writeQualified:true,writeEntitled:true,executionAvailable:false,plans:[summary],detail:plan};
    expect(statusSchema.safeParse(status).success).toBe(true);
    expect(statusSchema.safeParse({...status,plans:[{...summary,pendingVerification:1}]}).success).toBe(false);
    expect(()=>parseAfternicListingWritePlan({...plan,cookie:"sensitive"})).toThrow("invalid Afternic listing write plan");
  });
});
