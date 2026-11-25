import { createHash, createPublicKey, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { desktopExecutionContextRequestSchema, desktopExecutionContextResponseSchema, desktopExecutionContextSchema, encodeDesktopExecutionContextEnvelope, encodeDesktopExecutionContextSignatureTranscript, encodeDesktopExecutionAuthorizationDigestInput } from "../src/devices/index";
const vector = JSON.parse(readFileSync(new URL("../test-vectors/execution-context/valid.json", import.meta.url), "utf8"));
describe("execution context v1", () => {
  it("pins canonical bytes, complete Grant digest and purpose-separated signature", () => {
    const { grant, context } = desktopExecutionContextResponseSchema.parse(vector.response);
    expect(desktopExecutionContextRequestSchema.parse(vector.request).nonce).toBe(context.nonce);
    const transcript = encodeDesktopExecutionContextSignatureTranscript(context);
    expect(Buffer.from(transcript).toString("hex")).toBe(vector.signatureTranscriptHex);
    expect(Buffer.from(encodeDesktopExecutionAuthorizationDigestInput(grant)).toString("hex")).toBe(vector.authorizationDigestInputHex);
    expect(Buffer.from(encodeDesktopExecutionContextEnvelope(context)).toString("hex")).toBe(vector.contextEnvelopeHex);
    expect(createHash("sha256").update(encodeDesktopExecutionContextEnvelope(context)).digest("base64url")).toBe(vector.trustedTimeAnchorId);
    expect(createHash("sha256").update(encodeDesktopExecutionAuthorizationDigestInput(grant)).digest("base64url")).toBe(context.authorizationGrantDigest);
    for (const purpose of ["context", "grant", "lease"]) {
      const publicKey = createPublicKey({ format: "der", type: "spki", key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(vector.publicKeys[purpose], "base64url")]) });
      expect(verify(null, transcript, publicKey, Buffer.from(context.signature, "base64url"))).toBe(purpose === "context");
    }
  });
  it("rejects ambiguous encodings, selectors, short and noncanonical signatures", () => {
    for (const nonce of ["a", "A".repeat(42)+"B", "A".repeat(44), vector.request.nonce+"="]) expect(desktopExecutionContextRequestSchema.safeParse({ schemaVersion: 1, nonce }).success).toBe(false);
    for (const field of ["accountId", "deviceId", "workspaceId", "authorizationGrantDigest", "role"]) expect(desktopExecutionContextRequestSchema.safeParse({ ...vector.request, [field]: "injected" }).success).toBe(false);
    for (const signature of ["a", "A".repeat(85)+"B", vector.response.context.signature+"="]) expect(desktopExecutionContextSchema.safeParse({ ...vector.response.context, signature }).success).toBe(false);
  });
  it("rejects identity, epoch, issuance and exact deadline mismatches", () => {
    for (const update of [{ accountId: "other" }, { workspaceId: "other" }, { deviceId: "other" }, { accountSecurityEpoch: 99 }, { activeLeaseEpoch: 99 }, { serverObservedAt: "2000-01-01T00:00:00Z" }, { expiresAt: "2099-01-01T00:00:00Z" }, { expiresAt: vector.response.context.serverObservedAt }, { role: "active" }]) expect(desktopExecutionContextResponseSchema.safeParse({ ...vector.response, context: { ...vector.response.context, ...update } }).success).toBe(false);
  });
});
