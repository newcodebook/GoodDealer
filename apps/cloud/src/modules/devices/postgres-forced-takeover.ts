import { createHash, randomUUID } from "node:crypto";
import { forcedTakeoverPreviewRequestSchema, forcedTakeoverPreviewResponseSchema, forcedTakeoverRequestSchema,
  forcedTakeoverStatusRequestSchema, forcedTakeoverStatusResponseSchema, forcedTakeoverResolveRequestSchema,
  forcedTakeoverResolveResponseSchema, forcedTakeoverWorkflowSchema, deviceSwitchLookupRequestSchema,
  forcedTakeoverCancelIntentRequestSchema, forcedTakeoverCancelIntentResponseSchema, type ForcedTakeoverCancelIntentResponse,
  type ForcedTakeoverRequest, type ForcedTakeoverPreviewResponse, type ForcedTakeoverStatusResponse,
  type ForcedTakeoverResolveResponse, type ForcedTakeoverWorkflow, type DeviceSwitchResponse,
  type DeviceSwitchRejectionCode } from "@gooddealer/protocol/devices";
import type { AccountTransaction, TenantTransaction, IdentityCapabilityTransactionRunner } from "../../db/index";
import type { PublicPrincipal } from "../../entrypoints/ports/public-session";
import { PostgresForcedTakeoverReauthentication } from "../identity/index";
import type { LockedDefaultWorkspaceAuthorityPort } from "../workspace/default-workspace/index";
import { readBoundDesktopIdentity } from "./desktop-session-authority";
import { canonicalSecond, isPostgresAuthorizationFailure } from "./desktop-authorization-readers";
import { expireForcedWaitingLocked, forcedClaimableLocked, forcedInteger, forcedView, type ForcedWorkflowRow } from "./forced-takeover-persistence";

interface Context {
  account: AccountTransaction; tenant: TenantTransaction; deviceId: string; securityEpoch: number;
  keyId: string; keyVersion: string; consumedReauthUntil?: Date;
}
class AuthorityLost extends Error {}
const refused = (code: DeviceSwitchRejectionCode): DeviceSwitchResponse => ({ schemaVersion: 1, accepted: false, code });
const accepted = (row: ForcedWorkflowRow): DeviceSwitchResponse => ({ schemaVersion: 1, accepted: true, request: forcedView(row) });

/** Target-initiated takeover; only Identity can spend the current session's single-use window. */
export class PostgresForcedTakeover {
  private readonly reauthentication = new PostgresForcedTakeoverReauthentication();
  constructor(private readonly dependencies: {
    readonly transactions: Pick<IdentityCapabilityTransactionRunner, "withAccountCredential">;
    readonly workspaces: LockedDefaultWorkspaceAuthorityPort;
    readonly fault?: (point: string) => void;
  }) {}
  async preview(value: unknown, principal: PublicPrincipal): Promise<ForcedTakeoverPreviewResponse | null> {
    forcedTakeoverPreviewRequestSchema.parse(value);
    return this.withTarget(principal, async context => {
      const unavailable = (reason: "SOURCE_UNAVAILABLE" | "TARGET_NOT_STANDBY" | "SWITCH_IN_PROGRESS" | "REAUTH_REQUIRED") =>
        ({ schemaVersion: 1, available: false, reason } as const);
      if (await this.openWorkflow(context)) return unavailable("SWITCH_IN_PROGRESS");
      const source = await this.source(context);
      if (source === null) return unavailable("SOURCE_UNAVAILABLE");
      if (source.device_id === context.deviceId) return unavailable("TARGET_NOT_STANDBY");
      if (await this.reauthentication.checkLocked(context.account) === null) return unavailable("REAUTH_REQUIRED");
      const time = await this.time(context);
      return forcedTakeoverPreviewResponseSchema.parse({ schemaVersion: 1, available: true,
        sourceDeviceId: source.device_id, sourceLeaseEpoch: forcedInteger(source.lease_epoch), toDeviceId: context.deviceId,
        earliestTakeoverAt: canonicalSecond(new Date(Math.ceil(Math.max(time.getTime(),source.maximum.getTime())/1000)*1000)), evaluatedAt: canonicalSecond(time) });
    });
  }
  async request(value: unknown, principal: PublicPrincipal): Promise<DeviceSwitchResponse | null> {
    const request = forcedTakeoverRequestSchema.parse(value);
    return this.withTarget(principal, async context => {
      if (request.toDeviceId !== context.deviceId) return null;
      const digest = requestDigest(request);
      const cancelled = await this.cancelledIntent(context,request);
      if (cancelled === "match") return refused("FORCED_INTENT_CANCELLED");
      if (cancelled === "conflict") return refused("IDEMPOTENCY_CONFLICT");
      const prior = await context.account.query<ForcedWorkflowRow>(`SELECT * FROM device_switch_workflows
        WHERE account_id=$1 AND idempotency_key=$2 FOR UPDATE`,[principal.accountId,request.idempotencyKey]);
      const existing = prior.rows[0];
      if (existing !== undefined) return existing.mode === "forced" && existing.to_device_id === context.deviceId
        && existing.request_digest.equals(digest) ? accepted(existing) : refused("IDEMPOTENCY_CONFLICT");
      if (await this.openWorkflow(context)) return refused("SWITCH_IN_PROGRESS");
      const source = await this.source(context);
      if (source === null || forcedInteger(source.lease_epoch) !== request.expectedSourceLeaseEpoch) return refused("SOURCE_LEASE_CHANGED");
      if (source.device_id === context.deviceId) return refused("TARGET_IS_SOURCE");
      const until = await this.reauthentication.consumeLocked(context.account);
      if (until === null) return refused("REAUTH_REQUIRED");
      context.consumedReauthUntil=until;
      const now = await this.time(context);
      const earliest = new Date(Math.ceil(Math.max(now.getTime(),source.maximum.getTime())/1000)*1000);
      const inserted = await context.account.query<ForcedWorkflowRow>(`INSERT INTO device_switch_workflows
        (account_id,workspace_id,workflow_id,purpose,mode,request_digest,idempotency_key,status,workflow_revision,
         from_device_id,to_device_id,bound_key_id,bound_key_version,bound_account_security_epoch,
         state_deadline,source_lease_epoch,earliest_takeover_at,created_at,updated_at)
        VALUES($1,$2,$3,'device_switch','forced',$4,$5,'waiting_expiry',1,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14) RETURNING *`,
        [principal.accountId,context.tenant.scope.workspaceId,`switch-${randomUUID()}`,digest,request.idempotencyKey,
          source.device_id,context.deviceId,context.keyId,context.keyVersion,context.securityEpoch,
          new Date(earliest.getTime()+86_400_000),request.expectedSourceLeaseEpoch,earliest,now]);
      this.dependencies.fault?.("after_forced_request");
      if ((await this.time(context)).getTime() >= until.getTime()) throw new AuthorityLost();
      if (inserted.rows[0] === undefined) throw new TypeError("forced workflow insert missing");
      return accepted(inserted.rows[0]);
    });
  }
  async status(value: unknown, principal: PublicPrincipal): Promise<ForcedTakeoverStatusResponse | null> {
    const request = forcedTakeoverStatusRequestSchema.parse(value);
    return this.withTarget(principal, async context => {
      const row=await this.find(context,"workflow_id",request.requestId);
      return forcedTakeoverStatusResponseSchema.parse(row === null ? {schemaVersion:1,found:false}
        : {schemaVersion:1,found:true,workflow:await this.project(context,row)});
    });
  }
  async resolve(value: unknown, principal: PublicPrincipal): Promise<ForcedTakeoverResolveResponse | null> {
    const request=forcedTakeoverResolveRequestSchema.parse(value);
    return this.withTarget(principal, async context => {
      const row=await this.find(context,"idempotency_key",request.idempotencyKey);
      if(row===null)return {schemaVersion:1,found:false};
      const originalRequest=forcedTakeoverRequestSchema.parse({schemaVersion:2,mode:"forced",toDeviceId:row.to_device_id,
        expectedSourceLeaseEpoch:forcedInteger(row.source_lease_epoch),idempotencyKey:row.idempotency_key});
      if(!row.request_digest.equals(requestDigest(originalRequest)))throw new TypeError("forced request history is inconsistent");
      return forcedTakeoverResolveResponseSchema.parse({schemaVersion:1,found:true,idempotencyKey:request.idempotencyKey,
        originalRequest,workflow:await this.project(context,row)});
    });
  }
  async cancelIntent(value:unknown,principal:PublicPrincipal):Promise<ForcedTakeoverCancelIntentResponse|null>{
    const {originalRequest}=forcedTakeoverCancelIntentRequestSchema.parse(value);
    return this.withTarget(principal,async context=>{
      if(originalRequest.toDeviceId!==context.deviceId)return null;
      const digest=requestDigest(originalRequest);
      const cancelled=await this.cancelledIntent(context,originalRequest);
      if(cancelled==="conflict")return null;
      if(cancelled==="match")return forcedTakeoverCancelIntentResponseSchema.parse({schemaVersion:1,outcome:"cancelled_before_request",originalRequest});
      const found=await context.account.query<ForcedWorkflowRow>(`SELECT * FROM device_switch_workflows
        WHERE account_id=$1 AND idempotency_key=$2 FOR UPDATE`,[context.account.accountId,originalRequest.idempotencyKey]);
      let row=found.rows[0];
      if(row!==undefined){
        if(row.mode!=="forced"||row.to_device_id!==context.deviceId||!row.request_digest.equals(digest))return null;
        if(row.status==="waiting_expiry"){
          const updated=await context.account.query<ForcedWorkflowRow>(`UPDATE device_switch_workflows SET status='cancelled',
            workflow_revision=workflow_revision+1,updated_at=clock_timestamp() WHERE account_id=$1 AND workflow_id=$2 RETURNING *`,
            [context.account.accountId,row.workflow_id]);
          row=updated.rows[0];if(row===undefined)throw new TypeError("forced cancellation history missing");
        }
        return forcedTakeoverCancelIntentResponseSchema.parse({schemaVersion:1,outcome:"workflow",originalRequest,workflow:await this.project(context,row)});
      }
      await context.account.query(`INSERT INTO device_forced_intent_cancellations
        (account_id,workspace_id,target_device_id,idempotency_key,request_digest,source_lease_epoch,account_security_epoch,key_id,key_version)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[context.account.accountId,context.tenant.scope.workspaceId,context.deviceId,
        originalRequest.idempotencyKey,digest,originalRequest.expectedSourceLeaseEpoch,context.securityEpoch,context.keyId,context.keyVersion]);
      this.dependencies.fault?.("after_forced_intent_cancelled");
      return forcedTakeoverCancelIntentResponseSchema.parse({schemaVersion:1,outcome:"cancelled_before_request",originalRequest});
    });
  }
  private async cancelledIntent(context:Context,request:ForcedTakeoverRequest):Promise<"missing"|"match"|"conflict">{
    const result=await context.account.query<{request_digest:Buffer;target_device_id:string}>(`SELECT request_digest,target_device_id
      FROM device_forced_intent_cancellations WHERE account_id=$1 AND idempotency_key=$2`,[context.account.accountId,request.idempotencyKey]);
    const row=result.rows[0];
    return row===undefined?"missing":row.target_device_id===context.deviceId&&row.request_digest.equals(requestDigest(request))?"match":"conflict";
  }
  async cancelIfForced(value: unknown, principal: PublicPrincipal): Promise<DeviceSwitchResponse | null | undefined> {
    const request=deviceSwitchLookupRequestSchema.parse(value);
    return this.withTarget(principal, async context => {
      const result=await context.account.query<ForcedWorkflowRow>(`SELECT * FROM device_switch_workflows
        WHERE account_id=$1 AND workspace_id=$2 AND workflow_id=$3 FOR UPDATE`,[principal.accountId,context.tenant.scope.workspaceId,request.requestId]);
      const row=result.rows[0];
      if(row===undefined)return refused("SWITCH_NOT_FOUND");
      if(row.mode!=="forced")return undefined;
      if(row.to_device_id!==context.deviceId)return null;
      if(row.status==="cancelled")return accepted(row);
      if(row.status!=="waiting_expiry")return refused("SWITCH_NOT_CANCELLABLE");
      const updated=await context.account.query<ForcedWorkflowRow>(`UPDATE device_switch_workflows SET status='cancelled',
        workflow_revision=workflow_revision+1,updated_at=clock_timestamp() WHERE account_id=$1 AND workflow_id=$2 RETURNING *`,
        [principal.accountId,row.workflow_id]);
      if(updated.rows[0]===undefined)throw new TypeError("forced cancellation missing");
      return accepted(updated.rows[0]);
    });
  }
  private async project(context:Context,row:ForcedWorkflowRow):Promise<ForcedTakeoverWorkflow>{
    const evaluatedAt=await this.time(context);
    const claimable=await forcedClaimableLocked(context.tenant,row,evaluatedAt);
    return forcedTakeoverWorkflowSchema.parse({request:forcedView(row),workflowRevision:forcedInteger(row.workflow_revision),
      sourceLeaseEpoch:forcedInteger(row.source_lease_epoch),evaluatedAt:canonicalSecond(evaluatedAt),claimable});
  }
  private async find(context:Context,column:"workflow_id"|"idempotency_key",value:string):Promise<ForcedWorkflowRow|null>{
    const result=await context.account.query<ForcedWorkflowRow>(`SELECT * FROM device_switch_workflows
      WHERE account_id=$1 AND workspace_id=$2 AND to_device_id=$3 AND mode='forced' AND ${column}=$4
        AND source_lease_epoch IS NOT NULL AND earliest_takeover_at IS NOT NULL FOR UPDATE`,
      [context.account.accountId,context.tenant.scope.workspaceId,context.deviceId,value]);
    return result.rows[0]??null;
  }
  private async openWorkflow(context:Context):Promise<boolean>{
    const rows=await context.account.query(`SELECT workflow_id FROM device_switch_workflows WHERE account_id=$1
      AND status IN ('requested','draining','waiting_expiry','bootstrapping') FOR UPDATE`,[context.account.accountId]);
    const pending=await context.account.query(`SELECT lease_epoch FROM device_lease_epoch_allocations WHERE account_id=$1 AND status='pending'`,[context.account.accountId]);
    return rows.rows.length!==0||pending.rows.length!==0;
  }
  private async source(context:Context):Promise<{device_id:string;lease_epoch:string;maximum:Date}|null>{
    const result=await context.account.query<{device_id:string;lease_epoch:string;maximum:Date}>(`SELECT l.device_id,l.lease_epoch,
      greatest(l.max_issued_offline_execute_until,s.exclusive_execution_block_until) AS maximum
      FROM device_active_leases l JOIN device_account_states s USING(account_id)
      WHERE l.account_id=$1 AND l.released_at IS NULL AND l.lease_epoch=s.current_lease_epoch
        AND s.highest_allocated_lease_epoch=s.current_lease_epoch FOR UPDATE OF l`,[context.account.accountId]);
    if(result.rows.length!==1)return null;
    const row=result.rows[0]!;
    if(!(row.maximum instanceof Date)||!Number.isFinite(row.maximum.getTime()))throw new TypeError("invalid source execution bound");
    return row;
  }
  private async time(context:Context):Promise<Date>{
    const result=await context.account.query<{now:Date}>("SELECT clock_timestamp() AS now");
    const now=result.rows[0]?.now;
    if(!(now instanceof Date)||!Number.isFinite(now.getTime()))throw new TypeError("invalid authority clock");
    return now;
  }
  private async withTarget<T>(principal:PublicPrincipal,work:(context:Context)=>Promise<T>):Promise<T|null>{
    if(principal.clientKind!=="desktop"||principal.transactionCredential===undefined)return null;
    try{return await this.dependencies.transactions.withAccountCredential(principal.transactionCredential,"devices_account",async account=>{
      await account.query("SELECT 1 FROM identity_account_security_states WHERE account_id=$1 FOR UPDATE",[principal.accountId]);
      const workspace=await this.dependencies.workspaces.resolveLocked(account);
      if(workspace===null||workspace.accountId!==principal.accountId)return null;
      await account.query("SELECT 1 FROM device_account_states WHERE account_id=$1 FOR UPDATE",[principal.accountId]);
      await account.query("SELECT set_config('gooddealer.workspace_id',$1,true)",[workspace.workspaceId]);
      const identity=await readBoundDesktopIdentity(account,principal,workspace.workspaceId);
      if(identity===null)return null;
      const key=await account.query<{key_id:string;key_version:string}>(`SELECT k.key_id,k.key_version FROM device_bindings b
        JOIN device_signing_keys k USING(account_id,device_id) WHERE b.account_id=$1 AND b.device_id=$2
        AND b.status='bound' AND k.status='active' FOR UPDATE OF b,k`,[principal.accountId,identity.deviceId]);
      if(key.rows.length!==1)return null;
      await expireForcedWaitingLocked(account,principal.accountId);
      const context:Context={account,tenant:{scope:workspace,query:account.query.bind(account)},deviceId:identity.deviceId,
        securityEpoch:identity.accountSecurityEpoch,keyId:key.rows[0]!.key_id,keyVersion:key.rows[0]!.key_version};
      const result=await work(context);
      this.dependencies.fault?.("before_forced_commit");
      const after=await readBoundDesktopIdentity(account,principal,workspace.workspaceId);
      const live=await account.query<{device:string|null}>("SELECT identity_private.current_execution_context_device() AS device");
      if(after===null||after.deviceId!==identity.deviceId||after.accountSecurityEpoch!==identity.accountSecurityEpoch
        ||live.rows[0]?.device!==identity.deviceId)throw new AuthorityLost();
      if(context.consumedReauthUntil!==undefined && (await this.time(context)).getTime()>=context.consumedReauthUntil.getTime())throw new AuthorityLost();
      return result;
    });}catch(error){if(error instanceof AuthorityLost||isPostgresAuthorizationFailure(error))return null;throw error;}
  }
}
function requestDigest(request:ForcedTakeoverRequest):Buffer{
  return createHash("sha256").update("GOODDEALER-FORCED-TAKEOVER-REQUEST-V1\0").update(JSON.stringify(request)).digest();
}
