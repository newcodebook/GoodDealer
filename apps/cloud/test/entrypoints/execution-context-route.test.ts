import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { desktopExecutionContextResponseSchema } from "@gooddealer/protocol/devices";
import { createPublicHttp } from "../../src/entrypoints/http";
import { rateLimitPolicy } from "../../src/entrypoints/adapter/rate-limit";
import { DESKTOP_EXECUTION_CONTEXT_ROUTE } from "../../src/entrypoints/routes/public/boundary";
import { denyingPublicApplicationPorts, StaticPublicSessionVerifier } from "../support/public-session";
const vector = JSON.parse(readFileSync(new URL("../../../../packages/protocol/test-vectors/execution-context/valid.json", import.meta.url),"utf8"));
const response = desktopExecutionContextResponseSchema.parse(vector.response);
const apps: FastifyInstance[]=[];
afterEach(async()=>{await Promise.all(apps.splice(0).map(app=>app.close()));});
function create(active=true) {
  const issue=vi.fn(async()=>response);
  const authorize=vi.fn(async(_principal: unknown,role: string)=>active && role==="active");
  const app=createPublicHttp({ sessions:new StaticPublicSessionVerifier([]),desktopAccessTokens:{verifyAccessToken:async()=>({accountId:response.context.accountId,sessionId:"session-a",clientKind:"desktop"})},
    preAuthRateLimit:rateLimitPolicy(60000,100),sessionRateLimit:rateLimitPolicy(60000,100),now:()=>new Date(),correlationIds:()=>"context-test",
    ports:{...denyingPublicApplicationPorts,desktopRouteAuthority:{authorize},desktopExecutionContext:{issue}} });
  apps.push(app);return {app,issue,authorize};
}
describe("execution context fixed Active-only route",()=>{
  it("admits only strict nonce intent with the session principal",async()=>{
    const {app,issue,authorize}=create();const result=await app.inject({method:"POST",url:DESKTOP_EXECUTION_CONTEXT_ROUTE,headers:{authorization:"Bearer fixture"},payload:vector.request});
    expect(result.statusCode).toBe(200);expect(result.json()).toEqual(response);expect(authorize.mock.calls[0]?.[1]).toBe("active");expect(issue).toHaveBeenCalledWith(vector.request,expect.objectContaining({sessionId:"session-a"}));
  });
  it("rejects Standby before issuance",async()=>{
    const {app,issue}=create(false);const result=await app.inject({method:"POST",url:DESKTOP_EXECUTION_CONTEXT_ROUTE,headers:{authorization:"Bearer fixture"},payload:vector.request});expect(result.statusCode).toBe(404);expect(issue).not.toHaveBeenCalled();
  });
  it("rejects client authority, malformed nonce and oversized requests",async()=>{
    const {app,issue}=create();for(const payload of [{...vector.request,grant:response.grant},{...vector.request,nonce:"bad"},{...vector.request,nonce:"A".repeat(1100)}]){
      const result=await app.inject({method:"POST",url:DESKTOP_EXECUTION_CONTEXT_ROUTE,headers:{authorization:"Bearer fixture"},payload});expect([400,413]).toContain(result.statusCode);
    } expect(issue).not.toHaveBeenCalled();
  });
});
