import { readFileSync } from "node:fs";
import { describe,it,expect } from "vitest";
import type { AccountTransaction } from "../src/db/index";
import { PostgresHistoricalExecutionContext, type HistoricalExecutionContextReference } from "../src/modules/devices/historical-execution-context";
const v=JSON.parse(readFileSync(new URL("../../../packages/protocol/test-vectors/execution-context/valid.json",import.meta.url),"utf8"));
const evidence=JSON.parse(readFileSync(new URL("../../../packages/protocol/test-vectors/afternic-execution-evidence/valid.json",import.meta.url),"utf8"));
const c=v.response.context;
const spki=(key:string)=>Buffer.concat([Buffer.from("302a300506032b6570032100","hex"),Buffer.from(key,"base64url")]);
const reference:HistoricalExecutionContextReference={requiredCapability:"afternic:marketplace:write",workspaceId:c.workspaceId,sourceDeviceId:c.deviceId,activeLeaseEpoch:c.activeLeaseEpoch,credentialEpoch:c.credentialEpoch,signingKeyId:c.signingKeyId,signingKeyVersion:c.signingKeyVersion,trustedTimeAnchorId:v.trustedTimeAnchorId,authorizationHash:c.authorizationGrantDigest,monotonicDeltaMs:1000,occurredAt:"2026-08-01T10:00:02Z"};
function record(){return {signed_context:structuredClone(c),signed_grant:structuredClone(v.response.grant),canonical_context_envelope:Buffer.from(v.contextEnvelopeHex,"hex"),canonical_grant_envelope:Buffer.from(v.authorizationDigestInputHex,"hex"),device_public_key:Buffer.from(evidence.devicePublicKey,"base64url"),context_digest:Buffer.from(v.trustedTimeAnchorId,"base64url"),authorization_grant_digest:Buffer.from(c.authorizationGrantDigest,"base64url"),lease_key_id:v.response.grant.activeDeviceLease.kid,lease_public_key:spki(v.publicKeys.lease),grant_key_id:v.response.grant.kid,grant_public_key:spki(v.publicKeys.grant),context_key_id:c.kid,context_public_key:spki(v.publicKeys.context),binding_status:"bound",removed_at:null as Date|null,key_status:"active",retired_at:null as Date|null,security_proven:true,security_ended_at:null as Date|null};}
async function read(row:unknown,input=reference){const tx={accountId:c.accountId,query:async()=>({rows:row===null?[]:[row]})} as unknown as AccountTransaction;return new PostgresHistoricalExecutionContext().read(tx,input);}
describe("historical execution authority snapshots",()=>{
 it("verifies all three signatures with immutable issuance keys and no current key configuration",async()=>{expect(await read(record())).toMatchObject({found:true,authorizationFailure:null});});
 it("does not grant SellerHub authority from the signed Afternic capability",async()=>{
  for (const requiredCapability of ["spaceship:marketplace:write", "spaceship:marketplace:observe"] as const) {
   expect(await read(record(),{...reference,requiredCapability})).toMatchObject({found:true,authorizationFailure:"authorization"});
  }
 });
 it.each(["context","grant","lease"])("rejects a wrong-purpose %s public key",async(purpose)=>{const r=record();if(purpose==="context")r.context_public_key=spki(v.publicKeys.lease);if(purpose==="grant")r.grant_public_key=spki(v.publicKeys.context);if(purpose==="lease")r.lease_public_key=spki(v.publicKeys.grant);expect(await read(r)).toEqual({found:false,reason:"authorization"});});
 it("fails closed on missing key history, tampered bytes and unknown stored fields",async()=>{
  expect(await read(null)).toEqual({found:false,reason:"epoch_unknown"});
  const r=record();r.canonical_context_envelope[10]=r.canonical_context_envelope[10]!^1;
  expect(await read(r)).toEqual({found:false,reason:"authorization"});
  expect(await read({...record(),extra:"unsafe"})).toEqual({found:false,reason:"authorization"});
 });
 it.each(["activeLeaseEpoch","credentialEpoch","signingKeyVersion"] as const)("rejects substituted %s while retaining the verified device key for semantic quarantine",async(field)=>{expect(await read(record(),{...reference,[field]:reference[field]+1})).toMatchObject({found:true,authorizationFailure:"authorization"});});
 it("uses conservative exact upper time and never receivedAt or current wall time",async()=>{
  expect(await read(record(),{...reference,monotonicDeltaMs:1001})).toMatchObject({found:true,authorizationFailure:"time_unprovable"});
  expect(await read(record(),{...reference,monotonicDeltaMs:Number.MAX_SAFE_INTEGER})).toMatchObject({found:true,authorizationFailure:"time_unprovable"});
  expect(await read(record(),{...reference,occurredAt:c.expiresAt,monotonicDeltaMs:86400000-1000})).toMatchObject({found:true,authorizationFailure:"time_unprovable"});
 });
 it("accepts strictly-before actual security end and rejects equality, missing proof, or revoked keys without a boundary",async()=>{
  const r=record();r.security_ended_at=new Date("2026-08-01T10:00:03Z");expect(await read(r)).toMatchObject({found:true,authorizationFailure:null});
  r.security_ended_at=new Date(reference.occurredAt);expect(await read(r)).toMatchObject({found:true,authorizationFailure:"authorization"});
  expect(await read({...record(),security_proven:false})).toMatchObject({found:true,authorizationFailure:"authorization"});
  expect(await read({...record(),key_status:"revoked"})).toMatchObject({found:true,authorizationFailure:"removal_boundary"});
  expect(await read({...record(),key_status:"rotated",retired_at:new Date("2026-08-01T10:00:03Z")})).toMatchObject({found:true,authorizationFailure:null});
  expect(await read({...record(),binding_status:"removed",removed_at:new Date(reference.occurredAt)})).toMatchObject({found:true,authorizationFailure:"removal_boundary"});
 });
});
