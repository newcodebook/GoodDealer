import { z } from "zod";
import { readFileSync } from "node:fs";
import { describe,expect,it } from "vitest";
import { deviceAuditIngestRequestSchema,executionFactIngestRequestSchema,executionEvidenceIngestResponseSchema,executionEvidenceReceiptsRequestSchema,executionEvidenceReceiptsResponseSchema } from "../src/execution-events/index";
const v=JSON.parse(readFileSync(new URL("../test-vectors/afternic-execution-evidence/valid.json",import.meta.url),"utf8"));
const query={activeLeaseEpoch:7,sequence:1,eventId:v.fact.executionFactId,envelopeDigest:Buffer.alloc(32).toString("base64url")};
const receipt={schemaVersion:1,stream:"execution_fact",workspaceId:"workspace-local",sourceDeviceId:"device-01",...query,receivedAt:"2026-08-01T10:01:00Z",outcome:"accepted",classification:"current"};
describe("strict execution ingestion and exact receipts",()=>{
 it("generates draft7 HTTP schemas without unrepresentable safe-value fallbacks",()=>{
  for(const schema of [deviceAuditIngestRequestSchema,executionFactIngestRequestSchema])expect(()=>z.toJSONSchema(schema,{target:"draft-7"})).not.toThrow();
 });
 it("admits the frozen evidence forms and rejects private/unknown payload fields",()=>{
  for(const event of [v.approvalAudit,v.claimAudit,v.preflightAudit,v.reconciledAudit])expect(deviceAuditIngestRequestSchema.safeParse({schemaVersion:1,event}).success).toBe(true);
  expect(executionFactIngestRequestSchema.safeParse({schemaVersion:1,fact:v.fact}).success).toBe(true);
  for(const extra of [{cookie:"private"},{endpoint:"https://private"}])expect(executionFactIngestRequestSchema.safeParse({schemaVersion:1,fact:{...v.fact,payloadRedacted:{...v.fact.payloadRedacted,...extra}}}).success).toBe(false);
  expect(deviceAuditIngestRequestSchema.safeParse({schemaVersion:1,event:{...v.claimAudit,targetRef:"provider-id"}}).success).toBe(false);
 });
 it("keeps pending/quarantine distinct from accepted acknowledgment",()=>{
  expect(executionEvidenceIngestResponseSchema.safeParse({schemaVersion:1,outcome:"accepted",receipt}).success).toBe(true);
  expect(executionEvidenceIngestResponseSchema.safeParse({schemaVersion:1,outcome:"pending",code:"PAIRED_AUDIT_MISSING"}).success).toBe(true);
  expect(executionEvidenceIngestResponseSchema.safeParse({schemaVersion:1,outcome:"quarantined",receipt}).success).toBe(false);
  expect(executionEvidenceIngestResponseSchema.safeParse({schemaVersion:1,outcome:"pending",code:"PAIRED_AUDIT_MISSING",receipt}).success).toBe(false);
 });
 it("requires bounded unique lookup tuples and exact envelope identity",()=>{
  expect(executionEvidenceReceiptsRequestSchema.safeParse({schemaVersion:1,entries:[query]}).success).toBe(true);
  expect(executionEvidenceReceiptsRequestSchema.safeParse({schemaVersion:1,entries:[query,{...query}]}).success).toBe(false);
  expect(executionEvidenceReceiptsRequestSchema.safeParse({schemaVersion:1,entries:[],accountId:"caller"}).success).toBe(false);
  for(const change of [{sequence:2},{activeLeaseEpoch:8},{envelopeDigest:Buffer.alloc(32,1).toString("base64url")},{eventId:v.claimAudit.auditEventId}])expect(executionEvidenceReceiptsResponseSchema.safeParse({schemaVersion:1,results:[{query,receipt:{...receipt,...change}}]}).success).toBe(false);
  expect(executionEvidenceReceiptsResponseSchema.safeParse({schemaVersion:1,results:[{query,receipt:null}]}).success).toBe(true);
 });
});
