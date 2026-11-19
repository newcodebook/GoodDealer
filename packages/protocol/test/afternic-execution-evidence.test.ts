import { createHash, createPublicKey, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  afternicDelistItemApprovalSchema, afternicDelistApprovalAuditPayloadSchema, afternicDelistClaimAuditPayloadSchema,
  afternicDelistClaimPayloadSchema, afternicDelistReconciledAuditPayloadSchema, afternicDelistPreflightRefusedAuditPayloadSchema,
  encodeAfternicDelistItemApprovalEnvelope, encodeAfternicDelistItemApprovalSignatureTranscript, encodeAfternicDelistTargetSetDigestInput,
  encodeAfternicLocalDispatchKeyDigestInput, encodeDeviceAuditEventHashInput, encodeDeviceAuditEventSignatureTranscript,
  encodeExecutionFactSignatureTranscript, encodeDrainStreamEnvelope, encodeAfternicDelistItemApprovalJson, decodeAfternicDelistItemApprovalJson,
  DEVICE_AUDIT_CHAIN_GENESIS_DIGEST, DEVICE_AUDIT_CHAIN_GENESIS_INPUT,
} from "../src/execution-events/index";
const vector=JSON.parse(readFileSync(new URL("../test-vectors/afternic-execution-evidence/valid.json",import.meta.url),"utf8"));
const hash=(bytes:Uint8Array)=>createHash("sha256").update(bytes).digest("base64url");
const hex=(bytes:Uint8Array)=>Buffer.from(bytes).toString("hex");
const publicKey=createPublicKey({format:"der",type:"spki",key:Buffer.concat([Buffer.from("302a300506032b6570032100","hex"),Buffer.from(vector.devicePublicKey,"base64url")])});
describe("Afternic actual approval and claim evidence",()=>{
  it("pins every cross-runtime encoding, signature and separate audit genesis",()=>{
    expect(hex(encodeAfternicDelistItemApprovalSignatureTranscript(vector.approval))).toBe(vector.bytes.approvalTranscript);
    expect(hex(encodeAfternicDelistItemApprovalEnvelope(vector.approval))).toBe(vector.bytes.approvalEnvelope);
    expect(hex(encodeAfternicDelistTargetSetDigestInput(vector.targetSet))).toBe(vector.bytes.targetSet);
    expect(hex(encodeAfternicLocalDispatchKeyDigestInput(vector.dispatchKey))).toBe(vector.bytes.dispatchKey);
    expect(hash(encodeAfternicDelistItemApprovalEnvelope(vector.approval))).toBe(vector.approvalEnvelopeDigest);
    expect(hash(DEVICE_AUDIT_CHAIN_GENESIS_INPUT)).toBe(DEVICE_AUDIT_CHAIN_GENESIS_DIGEST);
    for(const audit of [vector.approvalAudit,vector.claimAudit,vector.preflightAudit,vector.reconciledAudit]) {
      expect(hash(encodeDeviceAuditEventHashInput(audit))).toBe(audit.eventHash);
      expect(verify(null,encodeDeviceAuditEventSignatureTranscript(audit),publicKey,Buffer.from(audit.deviceSignature,"base64url"))).toBe(true);
    }
    expect(hex(encodeDeviceAuditEventHashInput(vector.approvalAudit))).toBe(vector.bytes.approvalAuditHashInput);
    expect(hex(encodeDeviceAuditEventHashInput(vector.claimAudit))).toBe(vector.bytes.claimAuditHashInput);
    expect(hex(encodeDrainStreamEnvelope("device_audit",vector.claimAudit))).toBe(vector.bytes.claimAuditEnvelope);
    expect(hex(encodeDrainStreamEnvelope("execution_fact",vector.fact))).toBe(vector.bytes.executionFactEnvelope);
    expect(verify(null,encodeAfternicDelistItemApprovalSignatureTranscript(vector.approval),publicKey,Buffer.from(vector.approval.deviceSignature,"base64url"))).toBe(true);
    expect(verify(null,encodeExecutionFactSignatureTranscript(vector.fact),publicKey,Buffer.from(vector.fact.deviceSignature,"base64url"))).toBe(true);
    expect(verify(null,encodeDeviceAuditEventSignatureTranscript(vector.claimAudit),publicKey,Buffer.from(vector.fact.deviceSignature,"base64url"))).toBe(false);
  });
  it("rejects changed approval, unordered/duplicate targets and private payload fields",()=>{
    for(const change of [{providerAccount:"secret"},{targetCount:501},{action:"buy"},{signatureTranscriptVersion:2},{operationItemId:"provider-domain-id"}])expect(afternicDelistItemApprovalSchema.safeParse({...vector.approval,...change}).success).toBe(false);
    expect(()=>encodeAfternicDelistTargetSetDigestInput({...vector.targetSet,items:[...vector.targetSet.items,...vector.targetSet.items]})).toThrow();
    const second={...vector.targetSet.items[0],operationItemId:"ffffffff-ffff-4fff-8fff-ffffffffffff"};
    expect(()=>encodeAfternicDelistTargetSetDigestInput({...vector.targetSet,items:[second,...vector.targetSet.items]})).toThrow();
    for(const [schema,value] of [[afternicDelistApprovalAuditPayloadSchema,vector.approvalAudit.payloadRedacted],[afternicDelistClaimAuditPayloadSchema,vector.claimAudit.payloadRedacted],[afternicDelistClaimPayloadSchema,vector.fact.payloadRedacted]] as const) {
      expect(schema.safeParse(value).success).toBe(true);expect(schema.safeParse({...value,cookie:"secret"}).success).toBe(false);
    }
  });
  it("decodes bounded UTF8 item JSON without duplicate-key or serialization ambiguity",()=>{
    expect(decodeAfternicDelistItemApprovalJson(encodeAfternicDelistItemApprovalJson(vector.approval))).toEqual(vector.approval);
    const reversed=Object.fromEntries(Object.entries(vector.approval).reverse());
    expect(decodeAfternicDelistItemApprovalJson(Buffer.from(JSON.stringify(reversed)))).toEqual(vector.approval);
    expect(()=>decodeAfternicDelistItemApprovalJson(Buffer.from('{"action":"remove",'+JSON.stringify(vector.approval).slice(1)))).toThrow("duplicate");
    expect(()=>decodeAfternicDelistItemApprovalJson(Buffer.from([0xff]))).toThrow();
    expect(()=>decodeAfternicDelistItemApprovalJson(Buffer.alloc(6145,32))).toThrow();
  });
  it("keeps a new observation distinct from a preflight refusal and original claim",()=>{
    const payload={schemaVersion:1,provider:"afternic",action:"remove",stage:"reconciled",operationId:vector.fact.operationId,operationItemId:vector.fact.operationItemId,attemptId:vector.fact.attemptId,originalExecutionFactId:vector.fact.executionFactId,originalExecutionFactDigest:hash(encodeDrainStreamEnvelope("execution_fact",vector.fact)),outcome:"absent",reason:null};
    expect(afternicDelistReconciledAuditPayloadSchema.safeParse(payload).success).toBe(true);
    expect(afternicDelistReconciledAuditPayloadSchema.safeParse({...payload,outcome:"present"}).success).toBe(false);
    const {attemptNo:_attempt,...preflight}=vector.claimAudit.payloadRedacted;
    expect(afternicDelistPreflightRefusedAuditPayloadSchema.safeParse({...preflight,stage:"preflight_refused",reason:"connection_changed"}).success).toBe(true);
    expect(afternicDelistPreflightRefusedAuditPayloadSchema.safeParse({...preflight,stage:"preflight_refused",reason:"connection_changed",originalExecutionFactId:payload.originalExecutionFactId}).success).toBe(false);
  });
});
