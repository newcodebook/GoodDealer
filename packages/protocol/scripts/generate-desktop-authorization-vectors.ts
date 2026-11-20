import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  DESKTOP_AUTHORIZATION_GRANT_ROLE_EXCHANGE_SCHEMA_VERSION,
  DESKTOP_COMMERCIAL_CAPABILITIES,
  desktopAuthorizationGrantSchema,
  encodeDesktopAuthorizationGrantSignatureTranscript,
} from "../src/devices/index.ts";

// Generated cross-language authority cases: the versioned protocol schema is the sole oracle.
// Signatures are placeholders; Native tests sign these exact claims with their fixture keys.
const lease = JSON.parse(readFileSync(resolve("test-vectors/device-identity/valid/active-device-lease.json"), "utf8"));
const base = {
  schemaVersion: 4,
  typ: "gd.desktop-authorization-grant.v4",
  iss: "https://accounts.gooddealer.com",
  aud: "gooddealer-desktop/local-business",
  kid: "grant-key-1",
  issuedAt: lease.issuedAt,
  expiresAt: lease.expiresAt,
  workspace: { workspaceId: "workspace-local", kind: "personal_default" },
  activeDeviceLease: lease,
  scopes: ["workspace:mutate", "workspace:read"],
  commercialAuthority: { schemaVersion: 2, entitlementRevision: 9,
    entitlementProjectionDigest: "a".repeat(64), state: "active",
    commercialExpiresAt: lease.expiresAt, capabilities: ["cloudflare:dns:observe"] },
  signature: "fixture-grant-signature",
};
const capabilityCase = (name: string, capabilities: unknown) => ({
  name, grant: { ...base, commercialAuthority: { ...base.commercialAuthority, capabilities } },
});
const cases = [
  capabilityCase("local-only", []),
  capabilityCase("cloudflare-only", ["cloudflare:dns:observe"]),
  capabilityCase("afternic-observe", ["afternic:marketplace:observe"]),
  capabilityCase("afternic-observe-and-write", ["afternic:marketplace:observe", "afternic:marketplace:write"]),
  capabilityCase("both-observe", ["afternic:marketplace:observe", "cloudflare:dns:observe"]),
  capabilityCase("cloudflare-registrar-only", ["cloudflare:registrar:observe"]),
  capabilityCase("aliyun-registrar-only", ["aliyun:registrar:observe"]),
  capabilityCase("atom-marketplace-only", ["atom:marketplace:observe"]),
  capabilityCase("godaddy-registrar-only", ["godaddy:registrar:observe"]),
  capabilityCase("spaceship-registrar-only", ["spaceship:registrar:observe"]),
  capabilityCase("spaceship-marketplace-only", ["spaceship:marketplace:observe"]),
  capabilityCase("all-capabilities", DESKTOP_COMMERCIAL_CAPABILITIES),
  capabilityCase("unrecognized-spaceship-write", ["spaceship:registrar:write"]),
  capabilityCase("unrecognized-sellerhub-write", ["spaceship:marketplace:observe", "spaceship:marketplace:write"]),
  capabilityCase("unrecognized-atom-write", ["atom:marketplace:observe", "atom:marketplace:write"]),
  capabilityCase("write-without-observe", ["afternic:marketplace:write"]),
  capabilityCase("cloudflare-does-not-imply-afternic-observe", ["afternic:marketplace:write", "cloudflare:dns:observe"]),
  capabilityCase("duplicate", ["cloudflare:dns:observe", "cloudflare:dns:observe"]),
  capabilityCase("unordered", ["cloudflare:dns:observe", "afternic:marketplace:observe"]),
  capabilityCase("unknown-capability", ["afternic:marketplace:verify"]),
  capabilityCase("wildcard", ["afternic:*"]),
  capabilityCase("not-an-array", "cloudflare:dns:observe"),
  { name: "legacy-active-v3", grant: { ...base, schemaVersion: 3, typ: "gd.desktop-authorization-grant.v3" } },
  { name: "legacy-commercial-v1", grant: { ...base, commercialAuthority: { ...base.commercialAuthority, schemaVersion: 1 } } },
  { name: "legacy-capability-field", grant: { ...base, commercialAuthority: { ...base.commercialAuthority, capability: "cloudflare:dns:observe" } } },
  { name: "missing-capabilities", grant: { ...base, commercialAuthority: Object.fromEntries(Object.entries(base.commercialAuthority).filter(([key]) => key !== "capabilities")) } },
].map(({ name, grant }) => {
  const parsed = desktopAuthorizationGrantSchema.safeParse(grant);
  return { name, accepted: parsed.success, grant,
    transcriptSha256: parsed.success
      ? createHash("sha256").update(encodeDesktopAuthorizationGrantSignatureTranscript(grant)).digest("hex") : null };
});
const directory = resolve("test-vectors/desktop-authorization");
mkdirSync(directory, { recursive: true });
writeFileSync(resolve(directory, "grant-v4-corpus.json"), `${JSON.stringify({
  schemaVersion: 1,
  generatedBy: "scripts/generate-desktop-authorization-vectors.ts",
  roleExchangeSchemaVersion: DESKTOP_AUTHORIZATION_GRANT_ROLE_EXCHANGE_SCHEMA_VERSION,
  cases,
}, null, 2)}\n`);
