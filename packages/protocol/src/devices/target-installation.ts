import { z } from "zod";
import { encodeDomainSeparatedWireValue, identifier, safePositiveInteger, safeUnsignedInteger } from "../wire/index";
import { compareUtf8, checkpointDomainAssetSchema, checkpointDomainAssetTombstoneSchema, sha256DigestSchema } from "../workspace/index";
import { activeDeviceLeaseEnvelopeSchema, bootstrapCapabilityEnvelopeSchema } from "./device-identity";
import { bootstrapStepNonceSchema, bootstrapStepRequestSchema, bootstrapStepResultSchema } from "./bootstrap-steps";

export const DEVICE_BOOTSTRAP_INSTALLATION_LIMITS = Object.freeze({
  claimRequestBytes: 2 * 1024, claimResponseBytes: 16 * 1024,
  stepRequestBytes: 1024 * 1024, stepResponseBytes: 1024 * 1024,
  checkpointRequestBytes: 16 * 1024, checkpointResponseBytes: 1024 * 1024,
  activationRequestBytes: 16 * 1024, activationResponseBytes: 16 * 1024,
  receiptRequestBytes: 16 * 1024, receiptResponseBytes: 1024 * 1024,
  pageDataBytes: 896 * 1024, pageRows: 256, partitionRows: 512,
} as const);
export const deviceBootstrapRejectionSchema = z.object({
  schemaVersion: z.literal(1), accepted: z.literal(false),
  code: z.enum(["CAPABILITY_INVALID", "BOOTSTRAP_CONFLICT", "BOOTSTRAP_EXPIRED", "CHECKPOINT_UNAVAILABLE", "ENTITLEMENT_INACTIVE", "SIGNING_UNAVAILABLE"]),
}).strict();
const lookup = { schemaVersion: z.literal(1), requestId: identifier };
const stepKindSchema = z.enum(["pin_checkpoint", "fetch_mutations", "submit_rebuild_digest"]);
export const deviceBootstrapClaimRequestSchema = z.object(lookup).strict();
export const deviceBootstrapClaimSchema = z.object({
  requestId: identifier, stepSchemaVersion: z.literal(2), capability: bootstrapCapabilityEnvelopeSchema,
  pendingLeaseEpoch: safePositiveInteger, workflowRevision: safePositiveInteger,
  nextStep: z.object({ stepNumber: z.literal(1), stepKind: z.literal("pin_checkpoint"), stepNonce: bootstrapStepNonceSchema }).strict(),
}).strict().superRefine((claim, context) => {
  if (claim.requestId !== claim.capability.payload.deviceSwitchRequestId) context.addIssue({code:"custom",message:"claim capability must name the same workflow"});
});
export const deviceBootstrapClaimResponseSchema = z.discriminatedUnion("accepted", [
  z.object({schemaVersion:z.literal(1),accepted:z.literal(true),claim:deviceBootstrapClaimSchema}).strict(), deviceBootstrapRejectionSchema,
]);
export const deviceBootstrapStepRequestSchema = z.object({schemaVersion:z.literal(1),capability:bootstrapCapabilityEnvelopeSchema,step:bootstrapStepRequestSchema}).strict().superRefine((value,context)=>{
  if(value.capability.jti!==value.step.capabilityJti||value.capability.payload.deviceSwitchRequestId!==value.step.deviceSwitchRequestId)context.addIssue({code:"custom",message:"step capability binding is inconsistent"});
});
export const deviceBootstrapStepResponseSchema = z.discriminatedUnion("accepted",[
  z.object({schemaVersion:z.literal(1),accepted:z.literal(true),result:bootstrapStepResultSchema}).strict(),deviceBootstrapRejectionSchema,
]);
const checkpointSelector = {checkpointId:identifier,checkpointDigest:sha256DigestSchema,partitionId:z.string().regex(/^(?:p[0-9]{4}|t[0-9]{4}|empty)$/u)};
export const deviceBootstrapCheckpointRequestSchema = z.object({
  ...lookup,capability:bootstrapCapabilityEnvelopeSchema,...checkpointSelector,
  entityType:z.enum(["domain_asset","domain_asset_tombstone"]),offset:safeUnsignedInteger.max(512),pageLimit:safePositiveInteger.max(256),
}).strict().superRefine((value,context)=>{
  if(value.requestId!==value.capability.payload.deviceSwitchRequestId||!partitionMatches(value.entityType,value.partitionId))context.addIssue({code:"custom",message:"checkpoint binding is inconsistent"});
});
const pageFields={requestId:identifier,...checkpointSelector,offset:safeUnsignedInteger.max(512),totalRows:safeUnsignedInteger.max(512),nextOffset:safeUnsignedInteger.max(512).nullable(),pageDigest:sha256DigestSchema};
export const deviceBootstrapCheckpointPageSchema=z.discriminatedUnion("entityType",[
  z.object({...pageFields,entityType:z.literal("domain_asset"),rows:z.array(checkpointDomainAssetSchema).max(256)}).strict(),
  z.object({...pageFields,entityType:z.literal("domain_asset_tombstone"),rows:z.array(checkpointDomainAssetTombstoneSchema).max(256)}).strict(),
]).superRefine((page,context)=>{
  const end=page.offset+page.rows.length;
  if(!partitionMatches(page.entityType,page.partitionId)||end>page.totalRows||
    page.nextOffset!==(end===page.totalRows?null:end)||
    (page.rows.length===0&&(page.partitionId!=="empty"||page.offset!==0||page.totalRows!==0))||
    (page.partitionId==="empty"&&(page.rows.length!==0||page.totalRows!==0))){
    context.addIssue({code:"custom",message:"checkpoint page range is incomplete or inconsistent"});
  }
  for(let index=1;index<page.rows.length;index++)if(compareUtf8(page.rows[index-1]!.entityId,page.rows[index]!.entityId)>=0)context.addIssue({code:"custom",message:"checkpoint rows must be strictly ordered"});
});
export const deviceBootstrapCheckpointResponseSchema=z.discriminatedUnion("accepted",[
  z.object({schemaVersion:z.literal(1),accepted:z.literal(true),page:deviceBootstrapCheckpointPageSchema}).strict(),deviceBootstrapRejectionSchema,
]);
export function encodeBootstrapCheckpointPageDigestInput(value:unknown):Uint8Array{
  const {pageDigest:_digest,...page}=deviceBootstrapCheckpointPageSchema.parse(value);
  return encodeDomainSeparatedWireValue("GOODDEALER-BOOTSTRAP-CHECKPOINT-PAGE-V1",page);
}
const activationIdSchema=z.string().uuid();
export const deviceBootstrapActivationRequestSchema=z.object({
  ...lookup,capability:bootstrapCapabilityEnvelopeSchema,activationId:activationIdSchema,
  expectedWorkflowRevision:safePositiveInteger,pendingLeaseEpoch:safePositiveInteger,
  targetServerRevision:safeUnsignedInteger,workspaceSchemaVersion:safePositiveInteger,
  verifiedRebuildDigest:sha256DigestSchema,requestDigest:sha256DigestSchema,
}).strict().superRefine((value,context)=>{
  if(value.requestId!==value.capability.payload.deviceSwitchRequestId)context.addIssue({code:"custom",message:"activation capability binding is inconsistent"});
});
export function encodeBootstrapActivationRequestDigestInput(value:unknown,capabilityDigest:unknown):Uint8Array{
  const {requestDigest:_digest,capability:_capability,...request}=deviceBootstrapActivationRequestSchema.parse(value);
  return encodeDomainSeparatedWireValue("GOODDEALER-BOOTSTRAP-ACTIVATION-REQUEST-V1",{...request,capabilityDigest:sha256DigestSchema.parse(capabilityDigest)});
}
export const deviceBootstrapActivationReceiptSchema=z.object({
  requestId:identifier,activationId:activationIdSchema,requestDigest:sha256DigestSchema,
  workflowRevision:safePositiveInteger,status:z.literal("completed"),pendingLeaseEpoch:safePositiveInteger,
  targetServerRevision:safeUnsignedInteger,workspaceSchemaVersion:safePositiveInteger,
  verifiedRebuildDigest:sha256DigestSchema,cursorGeneration:safePositiveInteger,lease:activeDeviceLeaseEnvelopeSchema,
}).strict().superRefine((value,context)=>{
  if(value.pendingLeaseEpoch!==value.lease.payload.leaseEpoch)context.addIssue({code:"custom",message:"activated Lease must use the reserved epoch"});
});
export const deviceBootstrapActivationResponseSchema=z.discriminatedUnion("accepted",[
  z.object({schemaVersion:z.literal(1),accepted:z.literal(true),receipt:deviceBootstrapActivationReceiptSchema}).strict(),deviceBootstrapRejectionSchema,
]);
const claimSelector=z.object({kind:z.literal("claim")}).strict();
const stepSelectorFields={kind:z.literal("step"),stepNumber:safePositiveInteger,requestDigest:sha256DigestSchema,replayDigest:sha256DigestSchema};
const activationSelectorFields={kind:z.literal("activate"),activationId:activationIdSchema,requestDigest:sha256DigestSchema};
export const deviceBootstrapReceiptOperationSchema=z.discriminatedUnion("kind",[
  claimSelector,z.object(stepSelectorFields).strict(),z.object(activationSelectorFields).strict(),
]);
export const deviceBootstrapReceiptRequestSchema=z.object({...lookup,operation:deviceBootstrapReceiptOperationSchema}).strict();
const workflowFields={requestId:identifier,workflowRevision:safePositiveInteger};
const workflowSchema=z.object({...workflowFields,status:z.enum(["bootstrapping","completed","cancelled","failed"])}).strict();
const committedOperationSchema=z.discriminatedUnion("kind",[
  z.object({kind:z.literal("claim"),claim:deviceBootstrapClaimSchema}).strict(),
  z.object({...stepSelectorFields,result:bootstrapStepResultSchema}).strict(),
  z.object({...activationSelectorFields,receipt:deviceBootstrapActivationReceiptSchema}).strict(),
]);
export const deviceBootstrapReceiptResponseSchema=z.discriminatedUnion("outcome",[
  z.object({schemaVersion:z.literal(1),outcome:z.literal("not_found")}).strict(),
  z.object({schemaVersion:z.literal(1),outcome:z.literal("conflict")}).strict(),
  z.object({schemaVersion:z.literal(1),outcome:z.literal("committed"),workflow:workflowSchema,operation:committedOperationSchema}).strict(),
  z.object({schemaVersion:z.literal(1),outcome:z.literal("uncommitted"),workflow:z.object({...workflowFields,status:z.literal("bootstrapping")}).strict(),operation:deviceBootstrapReceiptOperationSchema,nextStep:z.object({stepNumber:safePositiveInteger,stepKind:stepKindSchema}).strict().nullable()}).strict(),
  z.object({schemaVersion:z.literal(1),outcome:z.literal("terminal"),workflow:z.object({...workflowFields,status:z.enum(["completed","cancelled","failed"])}).strict(),operation:deviceBootstrapReceiptOperationSchema}).strict(),
]).superRefine((value,context)=>{
  if(value.outcome!=="committed")return;
  const operation=value.operation;
  const consistent=operation.kind==="claim" ? operation.claim.requestId===value.workflow.requestId && operation.claim.workflowRevision<=value.workflow.workflowRevision :
    operation.kind==="step" ? operation.stepNumber===operation.result.acceptedStepNumber && operation.result.workflowRevision<=value.workflow.workflowRevision :
    operation.receipt.requestId===value.workflow.requestId && operation.receipt.activationId===operation.activationId &&
      operation.receipt.requestDigest===operation.requestDigest && operation.receipt.workflowRevision<=value.workflow.workflowRevision && value.workflow.status==="completed";
  if(!consistent)context.addIssue({code:"custom",message:"receipt operation identity conflicts with its workflow"});
});
function partitionMatches(type:"domain_asset"|"domain_asset_tombstone",id:string):boolean{
  return type==="domain_asset"?/^(?:p[0-9]{4}|empty)$/u.test(id):/^t[0-9]{4}$/u.test(id);
}
export type DeviceBootstrapClaimRequest=z.infer<typeof deviceBootstrapClaimRequestSchema>;
export type DeviceBootstrapClaim=z.infer<typeof deviceBootstrapClaimSchema>;
export type DeviceBootstrapClaimResponse=z.infer<typeof deviceBootstrapClaimResponseSchema>;
export type DeviceBootstrapStepRequest=z.infer<typeof deviceBootstrapStepRequestSchema>;
export type DeviceBootstrapStepResponse=z.infer<typeof deviceBootstrapStepResponseSchema>;
export type DeviceBootstrapCheckpointRequest=z.infer<typeof deviceBootstrapCheckpointRequestSchema>;
export type DeviceBootstrapCheckpointPage=z.infer<typeof deviceBootstrapCheckpointPageSchema>;
export type DeviceBootstrapCheckpointResponse=z.infer<typeof deviceBootstrapCheckpointResponseSchema>;
export type DeviceBootstrapActivationRequest=z.infer<typeof deviceBootstrapActivationRequestSchema>;
export type DeviceBootstrapActivationReceipt=z.infer<typeof deviceBootstrapActivationReceiptSchema>;
export type DeviceBootstrapActivationResponse=z.infer<typeof deviceBootstrapActivationResponseSchema>;
export type DeviceBootstrapReceiptRequest=z.infer<typeof deviceBootstrapReceiptRequestSchema>;
export type DeviceBootstrapReceiptResponse=z.infer<typeof deviceBootstrapReceiptResponseSchema>;
