import { createHash, createPublicKey, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  afternicListingWriteItemApprovalSchema, afternicListingWriteReconciledAuditPayloadSchema, afternicListingWritePreflightRefusedAuditPayloadSchema,
  encodeAfternicListingWriteItemApprovalEnvelope, encodeAfternicListingWriteItemApprovalSignatureTranscript, encodeAfternicListingWriteTargetSetDigestInput,
  encodeAfternicListingWriteItemApprovalJson, decodeAfternicListingWriteItemApprovalJson,
  encodeAfternicDelistItemApprovalSignatureTranscript, encodeAfternicDelistTargetSetDigestInput,
  encodeDeviceAuditEventHashInput, encodeDeviceAuditEventSignatureTranscript, encodeExecutionFactSignatureTranscript,
  encodeDrainStreamEnvelope, deviceAuditIngestRequestSchema, executionFactIngestRequestSchema,
} from "../src/execution-events/index";
const hash=(bytes:Uint8Array)=>createHash("sha256").update(bytes).digest("base64url");
const hex=(bytes:Uint8Array)=>Buffer.from(bytes).toString("hex");
describe.each(["create","update"])("Afternic %s evidence",action=>{
  const vector=JSON.parse(readFileSync(new URL(`../test-vectors/afternic-listing-write-evidence/${action}.json`,import.meta.url),"utf8"));
  const key=createPublicKey({format:"der",type:"spki",key:Buffer.concat([Buffer.from("302a300506032b6570032100","hex"),Buffer.from(vector.devicePublicKey,"base64url")])});
  it("pins cross-runtime bytes, signatures and real stream ingest contracts",()=>{
    expect(hex(encodeAfternicListingWriteItemApprovalSignatureTranscript(vector.approval))).toBe(vector.bytes.approvalTranscript);
    expect(hex(encodeAfternicListingWriteItemApprovalEnvelope(vector.approval))).toBe(vector.bytes.approvalEnvelope);
    expect(hex(encodeAfternicListingWriteTargetSetDigestInput(vector.targetSet))).toBe(vector.bytes.targetSet);
    expect(hash(encodeAfternicListingWriteItemApprovalEnvelope(vector.approval))).toBe(vector.approvalEnvelopeDigest);
    expect(verify(null,encodeAfternicListingWriteItemApprovalSignatureTranscript(vector.approval),key,Buffer.from(vector.approval.deviceSignature,"base64url"))).toBe(true);
    for(const event of [vector.approvalAudit,vector.claimAudit,vector.preflightAudit,vector.reconciledAudit]){
      expect(deviceAuditIngestRequestSchema.safeParse({schemaVersion:1,event}).success).toBe(true);
      expect(hash(encodeDeviceAuditEventHashInput(event))).toBe(event.eventHash);
      expect(verify(null,encodeDeviceAuditEventSignatureTranscript(event),key,Buffer.from(event.deviceSignature,"base64url"))).toBe(true);
    }
    expect(executionFactIngestRequestSchema.safeParse({schemaVersion:1,fact:vector.fact}).success).toBe(true);
    expect(hex(encodeDrainStreamEnvelope("execution_fact",vector.fact))).toBe(vector.bytes.executionFactEnvelope);
    expect(verify(null,encodeExecutionFactSignatureTranscript(vector.fact),key,Buffer.from(vector.fact.deviceSignature,"base64url"))).toBe(true);
  });
  it("rejects cross-action and legacy-purpose signatures even with unchanged request digest",()=>{
    const changed={...vector.approval,action:action==="create"?"update":"create"};
    expect(verify(null,encodeAfternicListingWriteItemApprovalSignatureTranscript(changed),key,Buffer.from(vector.approval.deviceSignature,"base64url"))).toBe(false);
    expect(verify(null,encodeAfternicDelistItemApprovalSignatureTranscript({...vector.approval,action:"remove",typ:"gd.afternic-delist-item-approval.v1"}),key,Buffer.from(vector.approval.deviceSignature,"base64url"))).toBe(false);
    const {action:_action,...legacyTarget}=vector.targetSet;
    expect(hash(encodeAfternicDelistTargetSetDigestInput(legacyTarget))).not.toBe(hash(encodeAfternicListingWriteTargetSetDigestInput(vector.targetSet)));
    expect(hash(encodeAfternicListingWriteTargetSetDigestInput({...vector.targetSet,action:changed.action}))).not.toBe(hash(encodeAfternicListingWriteTargetSetDigestInput(vector.targetSet)));
    expect(executionFactIngestRequestSchema.safeParse({schemaVersion:1,fact:{...vector.fact,eventType:"afternic_delist_dispatch_claimed"}}).success).toBe(false);
  });
  it("rejects unknown fields, targets and purposes",()=>{
    for(const change of [{domain:"wecin.com"},{price:100},{providerAccount:"private"},{action:"remove"},{typ:"gd.afternic-delist-item-approval.v1"},{targetCount:501}])
      expect(afternicListingWriteItemApprovalSchema.safeParse({...vector.approval,...change}).success).toBe(false);
    expect(()=>encodeAfternicListingWriteTargetSetDigestInput({...vector.targetSet,items:[...vector.targetSet.items,...vector.targetSet.items]})).toThrow();
    expect(()=>encodeAfternicListingWriteTargetSetDigestInput({...vector.targetSet,action:"remove"})).toThrow();
  });
  it("decodes bounded JSON and refuses duplicate keys or invalid UTF8",()=>{
    expect(decodeAfternicListingWriteItemApprovalJson(encodeAfternicListingWriteItemApprovalJson(vector.approval))).toEqual(vector.approval);
    expect(()=>decodeAfternicListingWriteItemApprovalJson(Buffer.from('{"action":"create",'+JSON.stringify(vector.approval).slice(1)))).toThrow("duplicate");
    expect(()=>decodeAfternicListingWriteItemApprovalJson(Buffer.from([255]))).toThrow();
    expect(()=>decodeAfternicListingWriteItemApprovalJson(Buffer.alloc(6145))).toThrow();
  });
  it("separates field observation from successful marketplace publication",()=>{
    const base=vector.reconciledAudit.payloadRedacted;
    for(const [outcome,reason] of [["matched",null],["absent","postcondition_pending"],["different","postcondition_pending"],["read_failed","read_failed"],["conflict","provider_state_blocked"]])
      expect(afternicListingWriteReconciledAuditPayloadSchema.safeParse({...base,outcome,reason}).success).toBe(true);
    for(const changed of [{outcome:"active"},{outcome:"absent"},{reason:"postcondition_pending"},{providerStatus:"ACTIVE"},{domain:"wecin.com"}])
      expect(afternicListingWriteReconciledAuditPayloadSchema.safeParse({...base,...changed}).success).toBe(false);
    expect(afternicListingWritePreflightRefusedAuditPayloadSchema.safeParse({...vector.preflightAudit.payloadRedacted,reason:"already_absent"}).success).toBe(false);
  });
});
