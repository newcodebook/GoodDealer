import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import * as devices from "../src/devices/index.ts";
import { computeWorkspaceCheckpointEntityDigests, encodeCheckpointEntityDigestsInput, encodeMutationPageDigestInput } from "../src/workspace/index.ts";
import { encodeDomainSeparatedWireValue } from "../src/wire/index.ts";

// Public deterministic fixture keys, shared with the existing bootstrap crypto corpus.
const crypto = JSON.parse(readFileSync(resolve("test-vectors/bootstrap-crypto/ed25519-fixture.json"),"utf8"));
const key=(value:string)=>createPrivateKey({format:"der",type:"pkcs8",key:Buffer.from(value,"base64url")});
const bootstrapKey=key(crypto.testPrivateKeyPkcs8DerBase64Url),leaseKey=key(crypto.activeLeaseTestPrivateKeyPkcs8DerBase64Url);
const hash=(bytes:Uint8Array)=>createHash("sha256").update(bytes).digest("base64url");
const sha=async(bytes:Uint8Array)=>createHash("sha256").update(bytes).digest();
const zero=Buffer.alloc(32).toString("base64url");
const nonce=(n:number)=>Buffer.alloc(32,n).toString("base64url");
const requestId="installation-workflow",workspaceId="installation-workspace";
const capability:any={schemaVersion:1,typ:"gd.bootstrap-capability.v1",iss:"https://accounts.gooddealer.com",aud:"gooddealer-desktop/bootstrap",kid:"bootstrap-fixture-key-1",accountId:"installation-account",deviceId:"installation-target",accountSecurityEpoch:1,jti:"installation-capability",issuedAt:"2030-01-01T00:00:00Z",expiresAt:"2030-01-01T01:00:00Z",payload:{deviceSwitchRequestId:requestId},signature:Buffer.alloc(64).toString("base64url")};
capability.signature=sign(null,devices.encodeBootstrapCapabilitySignatureTranscript(capability),bootstrapKey).toString("base64url");
const claim=devices.deviceBootstrapClaimSchema.parse({requestId,stepSchemaVersion:2,capability,pendingLeaseEpoch:2,workflowRevision:1,nextStep:{stepNumber:1,stepKind:"pin_checkpoint",stepNonce:nonce(1)}});
const state={assets:[{entityId:"kept.test",entityGeneration:2,note:"Restored after deletion",portfolioId:null,tags:["selected"],targetPrice:{currency:"USD",amount:"2500"}},{entityId:"removed.test",entityGeneration:1,note:null,portfolioId:null,tags:[],targetPrice:null}],tombstones:[{entityId:"deleted.test",entityGeneration:1,deletedServerRevision:4,deletedAt:"2029-12-31T23:55:00Z"}]};
const manifest=await computeWorkspaceCheckpointEntityDigests(state,sha);
const checkpoint={schemaVersion:3,workspaceId,workspaceSchemaVersion:1,checkpointId:"installation-checkpoint",throughServerRevision:5,checkpointDigest:hash(encodeCheckpointEntityDigestsInput(manifest))};
function request(kind:string,number:number,payload:unknown){const draft={schemaVersion:2,deviceSwitchRequestId:requestId,capabilityJti:capability.jti,stepNumber:number,stepNonce:nonce(number),expectedWorkflowRevision:number,stepKind:kind,stepPayload:payload,requestDigest:zero};return devices.bootstrapStepRequestSchema.parse({...draft,requestDigest:hash(devices.encodeBootstrapStepRequestDigestInput(draft))});}
function result(kind:string,number:number,payload:unknown){const draft={schemaVersion:2,workflowRevision:number+1,acceptedStepNumber:number,nextStepNonce:number===3?null:nonce(number+1),stepKind:kind,resultPayload:payload,resultDigest:zero};return devices.bootstrapStepResultSchema.parse({...draft,resultDigest:hash(devices.encodeBootstrapStepResultDigestInput(draft))});}
const mutationBase={schemaVersion:3,workspaceId,workspaceSchemaVersion:1,entityType:"domain_asset",sourceDeviceId:"installation-source",activeLeaseEpoch:1};
const mutations=[{...mutationBase,mutationId:"installed-edit",entityId:"kept.test",entityGeneration:2,operationKind:"upsert",baseServerRevision:5,serverRevision:6,deviceMutationSequence:6,changedFields:[{fieldPath:"note",value:"Edited on generation two"}]},{...mutationBase,mutationId:"installed-delete",entityId:"removed.test",entityGeneration:1,operationKind:"delete",deletedAt:"2029-12-31T23:59:00Z",baseServerRevision:6,serverRevision:7,deviceMutationSequence:7,changedFields:[]}];
const pageDraft={schemaVersion:3,workspaceId,fromServerRevisionExclusive:5,throughServerRevisionInclusive:7,mutations,returnedThroughServerRevision:7,nextCursor:null,pageDigest:zero};
const page={...pageDraft,pageDigest:hash(encodeMutationPageDigestInput(pageDraft))};
const finalState={assets:[{...state.assets[0]!,note:"Edited on generation two"}],tombstones:[...state.tombstones,{entityId:"removed.test",entityGeneration:1,deletedServerRevision:7,deletedAt:"2029-12-31T23:59:00Z"}]};
const finalDigests=await computeWorkspaceCheckpointEntityDigests(finalState,sha);
const verifiedDigest=hash(encodeCheckpointEntityDigestsInput(finalDigests));
const steps=[
  {request:request("pin_checkpoint",1,{}),result:result("pin_checkpoint",1,{checkpoint,pinExpiresAt:"2030-01-01T00:15:00Z",targetServerRevision:7,workspaceSchemaVersion:1,checkpointEntityDigests:manifest})},
  {request:request("fetch_mutations",2,{pinnedCheckpointId:checkpoint.checkpointId,pinnedCheckpointThroughServerRevision:5,pinnedCheckpointDigest:checkpoint.checkpointDigest,fromServerRevisionExclusive:5,throughServerRevisionInclusive:7,cursor:null,pageLimit:256}),result:result("fetch_mutations",2,{mutationPage:page})},
  {request:request("submit_rebuild_digest",3,{targetServerRevision:7,workspaceSchemaVersion:1,entityDigests:finalDigests}),result:result("submit_rebuild_digest",3,{verifiedRevision:7,workspaceSchemaVersion:1,verifiedDigest,accepted:true})},
];
const checkpointPages=[{entityType:"domain_asset",partitionId:"p0000",rows:state.assets},{entityType:"domain_asset_tombstone",partitionId:"t0000",rows:state.tombstones}].map(partition=>{
  const draft={requestId,checkpointId:checkpoint.checkpointId,checkpointDigest:checkpoint.checkpointDigest,...partition,offset:0,totalRows:partition.rows.length,nextOffset:null,pageDigest:zero};
  return devices.deviceBootstrapCheckpointPageSchema.parse({...draft,pageDigest:hash(devices.encodeBootstrapCheckpointPageDigestInput(draft))});
});
const activationDraft={schemaVersion:1,requestId,capability,activationId:"00000000-0000-4000-8000-000000000001",expectedWorkflowRevision:4,pendingLeaseEpoch:2,targetServerRevision:7,workspaceSchemaVersion:1,verifiedRebuildDigest:verifiedDigest,requestDigest:zero};
const capabilityDigest=hash(devices.encodeBootstrapCapabilitySignedEnvelope(capability));
const activationRequest=devices.deviceBootstrapActivationRequestSchema.parse({...activationDraft,requestDigest:hash(devices.encodeBootstrapActivationRequestDigestInput(activationDraft,capabilityDigest))});
const lease:any={schemaVersion:1,typ:"gd.active-device-lease.v1",iss:"https://accounts.gooddealer.com",aud:"gooddealer-desktop/active-device-lease",kid:"lease-fixture-key-1",accountId:capability.accountId,deviceId:capability.deviceId,accountSecurityEpoch:1,jti:"installed-lease",issuedAt:"2030-01-01T00:05:00Z",expiresAt:"2030-01-02T00:05:00Z",payload:{leaseEpoch:2,renewAfter:"2030-01-01T00:10:00Z",onlineExpiresAt:"2030-01-01T00:20:00Z",offlineExecuteUntil:"2030-01-02T00:05:00Z"},signature:Buffer.alloc(64).toString("base64url")};
lease.signature=sign(null,devices.encodeActiveDeviceLeaseSignatureTranscript(lease),leaseKey).toString("base64url");
const activationReceipt=devices.deviceBootstrapActivationReceiptSchema.parse({requestId,activationId:activationRequest.activationId,requestDigest:activationRequest.requestDigest,workflowRevision:5,status:"completed",pendingLeaseEpoch:2,targetServerRevision:7,workspaceSchemaVersion:1,verifiedRebuildDigest:verifiedDigest,cursorGeneration:1,lease});
const step=steps[0]!;
const receiptRequest=devices.deviceBootstrapReceiptRequestSchema.parse({schemaVersion:1,requestId,operation:{kind:"step",stepNumber:1,requestDigest:step.request.requestDigest,replayDigest:hash(devices.encodeBootstrapStepRequestReplayIdentity(step.request))}});
const receiptResponse=devices.deviceBootstrapReceiptResponseSchema.parse({schemaVersion:1,outcome:"committed",workflow:{requestId,status:"bootstrapping",workflowRevision:2},operation:{...receiptRequest.operation,result:step.result}});
const output={schemaVersion:1,generatedBy:"scripts/generate-target-installation-vectors.ts",fixtureOnly:true,
  publicKeys:{bootstrap:createPublicKey(bootstrapKey).export({format:"der",type:"spki"}).subarray(-32).toString("base64url"),lease:createPublicKey(leaseKey).export({format:"der",type:"spki"}).subarray(-32).toString("base64url")},
  claimRequest:{schemaVersion:1,requestId},claimResponse:{schemaVersion:1,accepted:true,claim},checkpointState:state,checkpointPages,steps:steps.map(s=>({...s,requestDigestInputHex:Buffer.from(devices.encodeBootstrapStepRequestDigestInput(s.request)).toString("hex"),requestReplayHex:Buffer.from(devices.encodeBootstrapStepRequestReplayIdentity(s.request)).toString("hex"),resultDigestInputHex:Buffer.from(devices.encodeBootstrapStepResultDigestInput(s.result)).toString("hex"),resultReplayHex:Buffer.from(devices.encodeBootstrapStepResultReplayIdentity(s.result)).toString("hex")})),
  finalState,finalDigests,verifiedDigest,activationRequest,activationResponse:{schemaVersion:1,accepted:true,receipt:activationReceipt},receiptRequest,receiptResponse,
  capabilityEnvelopeHex:Buffer.from(devices.encodeBootstrapCapabilitySignedEnvelope(capability)).toString("hex"),capabilitySignatureTranscriptHex:Buffer.from(devices.encodeBootstrapCapabilitySignatureTranscript(capability)).toString("hex"),capabilityDigest,
  activationRequestDigestInputHex:Buffer.from(devices.encodeBootstrapActivationRequestDigestInput(activationRequest,capabilityDigest)).toString("hex"),
  nonceDigestInputHex:Buffer.from(encodeDomainSeparatedWireValue("GOODDEALER-BOOTSTRAP-STEP-NONCE-V2",nonce(1))).toString("hex"),finalDigestInputHex:Buffer.from(encodeCheckpointEntityDigestsInput(finalDigests)).toString("hex"),
};
function write(path:string,value:unknown){mkdirSync(resolve(path,".."),{recursive:true});writeFileSync(resolve(path),JSON.stringify(value,null,2)+"\n");}
write("test-vectors/target-installation/valid.json",output);
for(const [index,name]of ["pin-checkpoint","fetch-mutations","submit-rebuild-digest"].entries()){write(`test-vectors/bootstrap-steps/valid/request-${name}.json`,steps[index]!.request);write(`test-vectors/bootstrap-steps/valid/result-${name}.json`,steps[index]!.result);}
const pin:any=steps[0]!.request,pinResult:any=steps[0]!.result,fetch:any=steps[1]!.request,fetchResult:any=steps[1]!.result,submit:any=steps[2]!.request,submitResult:any=steps[2]!.result;
const invalid:Record<string,unknown>={
 "request-unknown-field":{...pin,extra:true},"request-snake-case":{...pin,stepNumber:undefined,step_number:1},"request-payload-kind-mismatch":{...pin,stepPayload:{checkpointId:"caller-choice"}},
 "request-fetch-before-checkpoint":{...fetch,stepPayload:{...fetch.stepPayload,fromServerRevisionExclusive:4}},"request-fetch-inverted-range":{...fetch,stepPayload:{...fetch.stepPayload,fromServerRevisionExclusive:8}},"request-page-limit-too-large":{...fetch,stepPayload:{...fetch.stepPayload,pageLimit:257}},"request-unsorted-entity-digests":{...submit,stepPayload:{...submit.stepPayload,entityDigests:[...finalDigests].reverse()}},"request-unsafe-workflow-revision":{...pin,expectedWorkflowRevision:9007199254740992},"request-legacy-v1":{...pin,schemaVersion:1},
 "result-unknown-field":{...pinResult,extra:true},"result-payload-kind-mismatch":{...pinResult,resultPayload:{mutationPage:page}},"result-mutation-page-gap":{...fetchResult,resultPayload:{mutationPage:{...page,mutations:[{...mutations[0],serverRevision:7},mutations[1]]}}},"result-missing-next-step-nonce":{...pinResult,nextStepNonce:undefined},"result-nonterminal-null-next-step-nonce":{...pinResult,nextStepNonce:null},"result-terminal-nonnull-next-step-nonce":{...submitResult,nextStepNonce:nonce(4)},"result-invalid-next-step-nonce-encoding":{...pinResult,nextStepNonce:"bad+nonce"},
};
for(const [name,value]of Object.entries(invalid))write(`test-vectors/bootstrap-steps/invalid/${name}.json`,value);
