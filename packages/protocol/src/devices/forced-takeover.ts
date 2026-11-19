import { z } from "zod";
import { canonicalUtcTimestamp, identifier, safePositiveInteger } from "../wire/index";
import { deviceSwitchRequestSchema, deviceSwitchRequestViewSchema } from "./device-management";

export const forcedTakeoverRequestSchema = deviceSwitchRequestSchema.options[1];
export const forcedTakeoverPreviewRequestSchema = z.object({ schemaVersion: z.literal(1) }).strict();
export const forcedTakeoverPreviewResponseSchema = z.discriminatedUnion("available", [
  z.object({ schemaVersion: z.literal(1), available: z.literal(false), reason: z.enum([
    "SOURCE_UNAVAILABLE", "SWITCH_IN_PROGRESS", "TARGET_NOT_STANDBY", "REAUTH_REQUIRED",
  ]) }).strict(),
  z.object({ schemaVersion: z.literal(1), available: z.literal(true), sourceDeviceId: identifier,
    sourceLeaseEpoch: safePositiveInteger, toDeviceId: identifier,
    earliestTakeoverAt: canonicalUtcTimestamp, evaluatedAt: canonicalUtcTimestamp }).strict(),
]).superRefine((value, context) => {
  if (value.available && (value.sourceDeviceId === value.toDeviceId || value.earliestTakeoverAt < value.evaluatedAt))
    context.addIssue({ code: "custom", message: "forced preview requires a distinct source and future boundary" });
});
export const forcedTakeoverWorkflowSchema = z.object({
  request: deviceSwitchRequestViewSchema, workflowRevision: safePositiveInteger,
  sourceLeaseEpoch: safePositiveInteger, evaluatedAt: canonicalUtcTimestamp, claimable: z.boolean(),
}).strict().superRefine((value, context) => {
  const request = value.request;
  if (request.mode !== "forced" || request.fromDeviceId === null || request.fromDeviceId === request.toDeviceId
    || request.earliestTakeoverAt === null || request.normalHandoffReceipt !== null
    || (value.claimable && (request.status !== "waiting_expiry" || value.evaluatedAt < request.earliestTakeoverAt
      || Date.parse(value.evaluatedAt) >= Date.parse(request.earliestTakeoverAt) + 86_400_000)))
    context.addIssue({ code: "custom", message: "forced status is inconsistent" });
});
export const forcedTakeoverStatusRequestSchema = z.object({ schemaVersion: z.literal(1), requestId: identifier }).strict();
export const forcedTakeoverStatusResponseSchema = z.discriminatedUnion("found", [
  z.object({ schemaVersion: z.literal(1), found: z.literal(false) }).strict(),
  z.object({ schemaVersion: z.literal(1), found: z.literal(true), workflow: forcedTakeoverWorkflowSchema }).strict(),
]);
export const forcedTakeoverResolveRequestSchema = z.object({ schemaVersion: z.literal(1), idempotencyKey: identifier }).strict();
export const forcedTakeoverResolveResponseSchema = z.discriminatedUnion("found", [
  z.object({ schemaVersion: z.literal(1), found: z.literal(false) }).strict(),
  z.object({ schemaVersion: z.literal(1), found: z.literal(true), idempotencyKey: identifier,
    originalRequest: forcedTakeoverRequestSchema, workflow: forcedTakeoverWorkflowSchema }).strict(),
]).superRefine((value, context) => {
  if (value.found && (value.originalRequest.idempotencyKey !== value.idempotencyKey
    || value.originalRequest.expectedSourceLeaseEpoch !== value.workflow.sourceLeaseEpoch
    || value.originalRequest.toDeviceId !== value.workflow.request.toDeviceId))
    context.addIssue({ code: "custom", message: "original forced request does not match its workflow" });
});
export type ForcedTakeoverRequest = z.infer<typeof forcedTakeoverRequestSchema>;
export type ForcedTakeoverPreviewResponse = z.infer<typeof forcedTakeoverPreviewResponseSchema>;
export type ForcedTakeoverWorkflow = z.infer<typeof forcedTakeoverWorkflowSchema>;
export type ForcedTakeoverStatusResponse = z.infer<typeof forcedTakeoverStatusResponseSchema>;
export type ForcedTakeoverResolveResponse = z.infer<typeof forcedTakeoverResolveResponseSchema>;

export const forcedTakeoverCancelIntentRequestSchema = z.object({
  schemaVersion: z.literal(1), originalRequest: forcedTakeoverRequestSchema,
}).strict();
export const forcedTakeoverCancelIntentResponseSchema = z.discriminatedUnion("outcome", [
  z.object({schemaVersion:z.literal(1),outcome:z.literal("cancelled_before_request"),originalRequest:forcedTakeoverRequestSchema}).strict(),
  z.object({schemaVersion:z.literal(1),outcome:z.literal("workflow"),originalRequest:forcedTakeoverRequestSchema,workflow:forcedTakeoverWorkflowSchema}).strict(),
]).superRefine((value,context)=>{
  if(value.outcome==="workflow" && (value.originalRequest.toDeviceId!==value.workflow.request.toDeviceId
    ||value.originalRequest.expectedSourceLeaseEpoch!==value.workflow.sourceLeaseEpoch))
    context.addIssue({code:"custom",message:"cancelled intent does not match original workflow"});
});
export type ForcedTakeoverCancelIntentResponse=z.infer<typeof forcedTakeoverCancelIntentResponseSchema>;
