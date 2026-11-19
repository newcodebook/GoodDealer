import { PostgresBootstrapCheckpointPort } from "../src/modules/workspace/checkpoints/bootstrap-port";
import { PostgresCheckpointRepository } from "../src/modules/workspace/checkpoints/postgres-repository";
import { computeWorkspaceCheckpointEntityDigests, encodeCheckpointEntityDigestsInput, type WorkspaceCheckpointState } from "@gooddealer/protocol/workspace";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bootstrapCapabilityEnvelopeSchema, encodeBootstrapCapabilitySignatureTranscript, DEVICE_BOOTSTRAP_INSTALLATION_LIMITS } from "@gooddealer/protocol/devices";
import { BootstrapCapabilityIssuer } from "../src/modules/devices/bootstrap-capability-issuer";
import { TrustedBootstrapVerificationKeySource } from "../src/modules/devices/bootstrap-capability-verifier";
import { PostgresBootstrapMutationPagePort } from "../src/modules/workspace/mutations/bootstrap-port";
import { PostgresWorkspaceMutationRepository } from "../src/modules/workspace/mutations/postgres-repository";
import type { TenantTransaction } from "../src/db/index";
const corpus=JSON.parse(readFileSync(new URL("../../../packages/protocol/test-vectors/target-installation/valid.json",import.meta.url),"utf8"));

describe("target bootstrap production boundaries",()=>{
  it("rejects wrong-purpose transcripts and a signer changing an authority claim",async()=>{
    const key=generateKeyPairSync("ed25519");
    const envelope=bootstrapCapabilityEnvelopeSchema.parse(corpus.claimResponse.claim.capability);
    const {kid:_kid,signature:_signature,...claims}=envelope;
    for(const fault of ["purpose","subject"]){
      const issuer=new BootstrapCapabilityIssuer({async sign(){
        const draft={...claims,kid:"test-key",signature:"A".repeat(86),...(fault==="subject"?{deviceId:"other"}:{})};
        return {signed:true,envelope:{...draft,signature:sign(null,fault==="purpose"?Buffer.from("another-purpose"):encodeBootstrapCapabilitySignatureTranscript(draft),key.privateKey).toString("base64url")},verificationKey:key.publicKey,receipt:Buffer.from("fixture")};
      }});
      await expect(issuer.issue(claims)).rejects.toThrow("invalid evidence");
    }
  });
  it("admits only the fixed bootstrap purpose and rejects duplicate/non-public keys",async()=>{
    const key=generateKeyPairSync("ed25519");
    const registry=new TrustedBootstrapVerificationKeySource([{kid:"key",publicKey:key.publicKey}]);
    expect(await registry.findVerificationKey({purpose:"gooddealer.devices.bootstrap-capability.v1",kid:"key"})).toBe(key.publicKey);
    expect(await registry.findVerificationKey({purpose:"wrong" as never,kid:"key"})).toBeNull();
    expect(()=>new TrustedBootstrapVerificationKeySource([{kid:"key",publicKey:key.privateKey}])).toThrow();
    expect(()=>new TrustedBootstrapVerificationKeySource([{kid:"key",publicKey:key.publicKey},{kid:"key",publicKey:key.publicKey}])).toThrow();
  });
  it("pages a large mutation range as a byte-bounded dense prefix",async()=>{
    const template=corpus.steps[1].result.resultPayload.mutationPage.mutations[0];
    class FixtureMutationRepository extends PostgresWorkspaceMutationRepository {
      override async readRange(){return Array.from({length:256},(_,index)=>({...template,serverRevision:index+1,baseServerRevision:0,deviceMutationSequence:index+1,mutationId:`large-${index+1}`,changedFields:[{fieldPath:"note" as const,value:"界".repeat(10000)}]}));}
    }
    const transaction:TenantTransaction={scope:{accountId:"test",workspaceId:template.workspaceId},async query(){throw new Error("fixture repository needs no database");}};
    const page=await new PostgresBootstrapMutationPagePort(new FixtureMutationRepository()).readDensePage(transaction,{fromServerRevisionExclusive:0,throughServerRevisionInclusive:256,cursor:null,pageLimit:256});
    expect(page.mutations.length).toBeGreaterThan(1);expect(page.mutations.length).toBeLessThan(256);
    expect(Buffer.byteLength(JSON.stringify(page.mutations),"utf8")).toBeLessThanOrEqual(DEVICE_BOOTSTRAP_INSTALLATION_LIMITS.pageDataBytes);
    expect(page.returnedThroughServerRevision).toBe(page.mutations.length);expect(page.nextCursor).not.toBeNull();
    expect(Buffer.byteLength(JSON.stringify({schemaVersion:1,accepted:true,result:page}),"utf8")).toBeLessThan(1048576);
  });
  it("pages a large checkpoint partition without exceeding the byte budget or accepting a foreign partition",async()=>{
    const state:WorkspaceCheckpointState={assets:Array.from({length:512},(_,i)=>({entityId:`d${String(i).padStart(4,"0")}.test`,entityGeneration:1,note:"界".repeat(10000),portfolioId:null,tags:[],targetPrice:null})),tombstones:[]};
    const manifest=await computeWorkspaceCheckpointEntityDigests(state,async bytes=>createHash("sha256").update(bytes).digest());
    const digest=createHash("sha256").update(encodeCheckpointEntityDigestsInput(manifest)).digest("base64url");
    class FixtureCheckpointRepository extends PostgresCheckpointRepository {
      override async read(){return {descriptor:{schemaVersion:3 as const,checkpointId:"checkpoint",workspaceId:"workspace",workspaceSchemaVersion:1,throughServerRevision:0,checkpointDigest:digest},status:"available" as const,rowVersion:1};}
      override async readState(){return state;}
      override async readEntityDigests(){return manifest;}
    }
    const port=new PostgresBootstrapCheckpointPort(new FixtureCheckpointRepository());
    const transaction:TenantTransaction={scope:{accountId:"test",workspaceId:"workspace"},async query(){throw new Error("fixture repository needs no database");}};
    const request={schemaVersion:1 as const,requestId:"installation-workflow",capability:bootstrapCapabilityEnvelopeSchema.parse(corpus.claimResponse.claim.capability),checkpointId:"checkpoint",checkpointDigest:digest,entityType:"domain_asset" as const,partitionId:"p0000",offset:0,pageLimit:256};
    const page=await port.readBootstrapPageLocked(transaction,request);expect(page).not.toBeNull();if(page===null)throw new Error("page missing");
    expect(page.rows.length).toBeGreaterThan(0);expect(page.rows.length).toBeLessThan(256);expect(page.totalRows).toBe(512);
    expect(page.nextOffset).toBe(page.rows.length);expect(Buffer.byteLength(JSON.stringify(page.rows),"utf8")).toBeLessThan(DEVICE_BOOTSTRAP_INSTALLATION_LIMITS.pageDataBytes);
    expect(await port.readBootstrapPageLocked(transaction,{...request,partitionId:"p0001"})).toBeNull();
    expect(await port.readBootstrapPageLocked(transaction,{...request,offset:512})).toBeNull();
  });

});
