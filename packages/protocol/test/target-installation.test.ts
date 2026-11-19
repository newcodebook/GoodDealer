import { createHash, createPublicKey, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  bootstrapStepRequestSchema, bootstrapStepResultSchema,
  deviceBootstrapClaimResponseSchema, deviceBootstrapCheckpointPageSchema,
  deviceBootstrapActivationRequestSchema, deviceBootstrapActivationResponseSchema,
  deviceBootstrapReceiptRequestSchema, deviceBootstrapReceiptResponseSchema,
  encodeBootstrapActivationRequestDigestInput, encodeBootstrapCheckpointPageDigestInput,
  encodeBootstrapCapabilitySignatureTranscript, encodeBootstrapCapabilitySignedEnvelope,
  encodeBootstrapStepRequestDigestInput, encodeBootstrapStepReplayRequest,
  encodeBootstrapStepResultDigestInput,
} from "../src/devices/index";
import { computeWorkspaceCheckpointEntityDigests } from "../src/workspace/index";
const corpus=JSON.parse(readFileSync(new URL("../test-vectors/target-installation/valid.json",import.meta.url),"utf8"));
const hash=(bytes:Uint8Array)=>createHash("sha256").update(bytes).digest("base64url");

describe("target installation shared signed wire corpus",()=>{
  it("binds the actual capability signature, activation and step v2 transcripts",()=>{
    const claim=deviceBootstrapClaimResponseSchema.parse(corpus.claimResponse);if(!claim.accepted)throw new Error("fixture claim refused");
    const publicKey=createPublicKey({key:Buffer.concat([Buffer.from("302a300506032b6570032100","hex"),Buffer.from(corpus.publicKeys.bootstrap,"base64url")]),format:"der",type:"spki"});
    expect(verify(null,encodeBootstrapCapabilitySignatureTranscript(claim.claim.capability),publicKey,Buffer.from(claim.claim.capability.signature,"base64url"))).toBe(true);
    const activation=deviceBootstrapActivationRequestSchema.parse(corpus.activationRequest);
    expect(hash(encodeBootstrapActivationRequestDigestInput(activation,hash(encodeBootstrapCapabilitySignedEnvelope(activation.capability))))).toBe(activation.requestDigest);
    deviceBootstrapActivationResponseSchema.parse(corpus.activationResponse);
    for(const step of corpus.steps){
      const request=bootstrapStepRequestSchema.parse(step.request),result=bootstrapStepResultSchema.parse(step.result);
      expect(request.schemaVersion).toBe(2);expect(result.schemaVersion).toBe(2);
      expect(hash(encodeBootstrapStepRequestDigestInput(request))).toBe(request.requestDigest);
      expect(hash(encodeBootstrapStepResultDigestInput(result))).toBe(result.resultDigest);
      expect(Buffer.from(encodeBootstrapStepReplayRequest(request)).toString("hex")).toBe(step.requestReplayHex);
    }
  });
  it("recomputes page and final generation/tombstone manifests",async()=>{
    for(const value of corpus.checkpointPages){const page=deviceBootstrapCheckpointPageSchema.parse(value);expect(hash(encodeBootstrapCheckpointPageDigestInput(page))).toBe(page.pageDigest);}
    expect(await computeWorkspaceCheckpointEntityDigests(corpus.finalState,async bytes=>createHash("sha256").update(bytes).digest())).toEqual(corpus.finalDigests);
    expect(corpus.finalState.assets[0].entityGeneration).toBe(2);expect(corpus.finalState.tombstones).toHaveLength(2);
  });
  it.each(["deviceId","session","path","cookie","csrf"])("rejects untrusted extra %s fields",(field)=>{
    expect(deviceBootstrapActivationRequestSchema.safeParse({...corpus.activationRequest,[field]:"untrusted"}).success).toBe(false);
  });
  it("rejects client-selected checkpoints, old v1, missing nonce and malformed page ranges",()=>{
    const request=corpus.steps[0].request;
    expect(bootstrapStepRequestSchema.safeParse({...request,schemaVersion:1}).success).toBe(false);
    expect(bootstrapStepRequestSchema.safeParse({...request,stepPayload:{checkpointId:"caller-chosen"}}).success).toBe(false);
    expect(bootstrapStepRequestSchema.safeParse({...request,stepNonce:"A".repeat(42)+"B"}).success).toBe(false);
    const page=corpus.checkpointPages[0];
    for(const patch of [{nextOffset:0},{totalRows:513},{offset:1},{rows:[...page.rows].reverse()},{rows:[page.rows[0],page.rows[0]]}])expect(deviceBootstrapCheckpointPageSchema.safeParse({...page,...patch}).success).toBe(false);
  });
  it("rejects a receipt rebound to a different workflow or activation identity",()=>{
    deviceBootstrapReceiptRequestSchema.parse(corpus.receiptRequest);
    const response=deviceBootstrapReceiptResponseSchema.parse(corpus.receiptResponse);
    expect(response.outcome).toBe("committed");
    if(response.outcome!=="committed")throw new Error("wrong receipt fixture");
    expect(deviceBootstrapReceiptResponseSchema.safeParse({...response,operation:{...response.operation,stepNumber:99}}).success).toBe(false);
    expect(deviceBootstrapReceiptResponseSchema.safeParse({...response,workflow:{...response.workflow,requestId:"other"},operation:{kind:"claim",claim:corpus.claimResponse.claim}}).success).toBe(false);
  });
});
