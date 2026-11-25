import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { desktopExecutionContextResponseSchema, encodeDesktopExecutionAuthorizationDigestInput, encodeDesktopExecutionContextEnvelope, encodeDesktopExecutionContextSignatureTranscript, encodeDesktopAuthorizationGrantSignatureTranscript, encodeActiveDeviceLeaseSignatureTranscript } from "../src/devices/index.ts";
// Public deterministic fixture keys only. These are never deployment trust roots.
function key(seed: number) { return createPrivateKey({ format: "der", type: "pkcs8", key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.alloc(32, seed)]) }); }
const keys = { lease: key(81), grant: key(82), context: key(83) };
const corpus = JSON.parse(readFileSync(resolve("test-vectors/desktop-authorization/grant-v4-corpus.json"), "utf8"));
const grant = structuredClone(corpus.cases.find((c: { name: string }) => c.name === "afternic-observe-and-write").grant);
grant.signature = Buffer.alloc(64).toString("base64url");
grant.activeDeviceLease.signature = sign(null, encodeActiveDeviceLeaseSignatureTranscript(grant.activeDeviceLease), keys.lease).toString("base64url");
grant.signature = sign(null, encodeDesktopAuthorizationGrantSignatureTranscript(grant), keys.grant).toString("base64url");
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("base64url");
const context = { schemaVersion: 1, typ: "gd.desktop-execution-context.v1", iss: "https://accounts.gooddealer.com", aud: "gooddealer-desktop/execution-evidence", kid: "context-fixture-v1", nonce: Buffer.alloc(32, 84).toString("base64url"), accountId: grant.activeDeviceLease.accountId, workspaceId: grant.workspace.workspaceId, deviceId: grant.activeDeviceLease.deviceId, accountSecurityEpoch: grant.activeDeviceLease.accountSecurityEpoch, activeLeaseEpoch: grant.activeDeviceLease.payload.leaseEpoch, credentialEpoch: 7, signingKeyId: "fixture-device-key", signingKeyVersion: 2, authorizationGrantDigest: hash(encodeDesktopExecutionAuthorizationDigestInput(grant)), serverObservedAt: grant.issuedAt, expiresAt: grant.expiresAt, signature: Buffer.alloc(64).toString("base64url") };
context.signature = sign(null, encodeDesktopExecutionContextSignatureTranscript(context), keys.context).toString("base64url");
const response = desktopExecutionContextResponseSchema.parse({ schemaVersion: 1, grant, context });
const output = { schemaVersion: 1, generatedBy: "scripts/generate-execution-context-vectors.ts", publicKeys: Object.fromEntries(Object.entries(keys).map(([name, k]) => [name, createPublicKey(k).export({ format: "der", type: "spki" }).subarray(-32).toString("base64url")])), request: { schemaVersion: 1, nonce: context.nonce }, response, signatureTranscriptHex: Buffer.from(encodeDesktopExecutionContextSignatureTranscript(context)).toString("hex"), authorizationDigestInputHex: Buffer.from(encodeDesktopExecutionAuthorizationDigestInput(grant)).toString("hex"), contextEnvelopeHex: Buffer.from(encodeDesktopExecutionContextEnvelope(context)).toString("hex"), trustedTimeAnchorId: hash(encodeDesktopExecutionContextEnvelope(context)) };
mkdirSync(resolve("test-vectors/execution-context"), { recursive: true });
writeFileSync(resolve("test-vectors/execution-context/valid.json"), JSON.stringify(output, null, 2) + "\n");
