import { generateKeyPairSync, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { desktopExecutionContextSchema, encodeDesktopExecutionContextSignatureTranscript } from "@gooddealer/protocol/devices";
import { encodeDomainSeparatedWireValue } from "@gooddealer/protocol/wire";
import { DesktopExecutionContextIssuer, DESKTOP_EXECUTION_CONTEXT_KEY_PURPOSE, type DesktopExecutionContextSigner } from "../src/modules/devices/execution-context-issuer";
const vector = JSON.parse(readFileSync(new URL("../../../packages/protocol/test-vectors/execution-context/valid.json", import.meta.url), "utf8"));
const { kid: _kid, signature: _signature, ...claims } = desktopExecutionContextSchema.parse(vector.response.context);
function signer(changes: Record<string,unknown> = {}, wrongPurpose = false): DesktopExecutionContextSigner {
  const pair = generateKeyPairSync("ed25519");
  return { async sign(input) {
    expect(input.purpose).toBe(DESKTOP_EXECUTION_CONTEXT_KEY_PURPOSE);
    const draft = { ...input.claims, ...changes, kid: "context-v1", signature: Buffer.alloc(64).toString("base64url") };
    const transcript = wrongPurpose ? encodeDomainSeparatedWireValue("GOODDEALER-ACTIVE-DEVICE-LEASE-V1", draft) : encodeDesktopExecutionContextSignatureTranscript(draft);
    return { signed: true, envelope: {...draft, signature: sign(null,transcript,pair.privateKey).toString("base64url")}, verificationKey: pair.publicKey, receipt: Buffer.from("fixture") };
  } };
}
describe("execution context issuer",()=>{
  it("publishes exact claims and independently verifies signing evidence", async()=>{ await expect(new DesktopExecutionContextIssuer(signer()).issue(claims)).resolves.toMatchObject({context:claims}); });
  it.each([{credentialEpoch:8},{accountId:"other"},{nonce:Buffer.alloc(32,1).toString("base64url")},{authorizationGrantDigest:Buffer.alloc(32,3).toString("base64url")},{serverObservedAt:"2026-08-14T18:00:01Z"}])("rejects substituted claims %j",async changes=>{ await expect(new DesktopExecutionContextIssuer(signer(changes)).issue(claims)).rejects.toThrow(); });
  it("rejects wrong purpose and unavailable signer",async()=>{
    await expect(new DesktopExecutionContextIssuer(signer({},true)).issue(claims)).rejects.toThrow("invalid evidence");
    await expect(new DesktopExecutionContextIssuer({sign:async()=>({signed:false})}).issue(claims)).resolves.toBeNull();
  });
});
