import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  AUTHORITATIVE_ENTITLEMENT_SNAPSHOT_DIGEST_DOMAIN,
  authoritativeEntitlementSnapshotDigest,
  authoritativeEntitlementSnapshotSchema,
  encodeAuthoritativeEntitlementSnapshotDigestInput,
} from "../src/account/index";

const vector = JSON.parse(readFileSync(resolve(
  import.meta.dirname,
  "../test-vectors/account/commercial-authority-snapshot-digest-v1.json",
), "utf8")) as { readonly snapshot: unknown; readonly sha256Hex: string };

const sha256 = (bytes: Uint8Array): Uint8Array => createHash("sha256").update(bytes).digest();

describe("commercial authority snapshot digest", () => {
  it("freezes one strict domain-separated authoritative snapshot vector", () => {
    const snapshot = authoritativeEntitlementSnapshotSchema.parse(vector.snapshot);
    const input = encodeAuthoritativeEntitlementSnapshotDigestInput(snapshot);
    expect(new TextDecoder().decode(input)).toContain(
      `d${AUTHORITATIVE_ENTITLEMENT_SNAPSHOT_DIGEST_DOMAIN.length}:${AUTHORITATIVE_ENTITLEMENT_SNAPSHOT_DIGEST_DOMAIN}`,
    );
    expect(authoritativeEntitlementSnapshotDigest(snapshot, sha256)).toBe(vector.sha256Hex);
  });

  it("rejects unknown snapshot fields and non-SHA-256 hash primitives", () => {
    expect(() => encodeAuthoritativeEntitlementSnapshotDigestInput({
      ...(vector.snapshot as Record<string, unknown>),
      accountId: "account-a",
    } as never)).toThrow();
    const snapshot = authoritativeEntitlementSnapshotSchema.parse(vector.snapshot);
    expect(() => authoritativeEntitlementSnapshotDigest(snapshot, () => new Uint8Array(31)))
      .toThrow(/32 bytes/u);
  });
});
