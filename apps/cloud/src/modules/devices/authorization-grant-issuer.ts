import { createHash, type KeyObject, verify } from "node:crypto";

import {
  authoritativeEntitlementSnapshotDigest,
  authoritativeEntitlementSnapshotSchema,
  type AuthoritativeEntitlementSnapshot,
} from "@gooddealer/protocol/account";
import {
  DESKTOP_AUTHORIZATION_GRANT_SCHEMA_VERSION,
  desktopAuthorizationGrantSchema,
  encodeDesktopAuthorizationGrantSignatureTranscript,
  activeDeviceLeaseEnvelopeSchema,
  type DesktopAuthorizationGrant,
} from "@gooddealer/protocol/devices";
import {
  canonicalUtcTimestamp,
  encodeDomainSeparatedWireValue,
  identifier,
} from "@gooddealer/protocol/wire";

export const DESKTOP_AUTHORIZATION_GRANT_KEY_PURPOSE =
  "gooddealer.devices.desktop-authorization-grant.v3" as const;

type UnsignedDesktopAuthorizationGrant = Omit<DesktopAuthorizationGrant, "kid" | "signature">;

export interface DesktopAuthorizationGrantSigner {
  sign(input: {
    readonly purpose: typeof DESKTOP_AUTHORIZATION_GRANT_KEY_PURPOSE;
    readonly claims: UnsignedDesktopAuthorizationGrant;
  }): Promise<
    | { readonly signed: false }
    | {
      readonly signed: true;
      readonly envelope: unknown;
      readonly verificationKey: KeyObject;
      readonly receipt: Uint8Array;
    }
  >;
}

export class DenyingDesktopAuthorizationGrantSigner implements DesktopAuthorizationGrantSigner {
  async sign(): Promise<{ readonly signed: false }> {
    return { signed: false };
  }
}

export type DesktopAuthorizationGrantIssueResult =
  | { readonly issued: false; readonly code: "GRANT_SIGNING_DISABLED" }
  | { readonly issued: true; readonly grant: DesktopAuthorizationGrant; readonly receiptDigest: string };

/**
 * Builds only the personal-default V1 runtime authority. The signer owns key selection and private
 * custody; this service independently verifies its returned envelope before publication.
 */
export class DesktopAuthorizationGrantIssuer {
  constructor(private readonly signer: DesktopAuthorizationGrantSigner) {}

  async issue(input: {
    readonly accountId: string;
    readonly deviceId: string;
    readonly workspaceId: string;
    readonly activeDeviceLease: unknown;
    readonly authoritativeEntitlementSnapshot: unknown;
    readonly trustedNow: string;
  }): Promise<DesktopAuthorizationGrantIssueResult> {
    const accountId = identifier.parse(input.accountId);
    const deviceId = identifier.parse(input.deviceId);
    const workspaceId = identifier.parse(input.workspaceId);
    const lease = activeDeviceLeaseEnvelopeSchema.parse(input.activeDeviceLease);
    const trustedNow = canonicalUtcTimestamp.parse(input.trustedNow);
    const snapshot = authoritativeEntitlementSnapshotSchema.parse(
      input.authoritativeEntitlementSnapshot,
    );
    if (lease.accountId !== accountId || lease.deviceId !== deviceId) {
      throw new TypeError("active Lease does not match the authenticated Grant subject");
    }
    if (
      snapshot.state !== "active"
      || snapshot.commercialExpiresAt === null
      || snapshot.commercialExpiresAt <= trustedNow
      || !snapshot.featureEntitlements.includes("cloudflare:dns:observe")
    ) {
      throw new TypeError("commercial authority does not authorize Cloudflare observation");
    }
    const entitlementProjectionDigest = authoritativeEntitlementSnapshotDigest(
      snapshot,
      sha256,
    );
    const claims: UnsignedDesktopAuthorizationGrant = {
      schemaVersion: DESKTOP_AUTHORIZATION_GRANT_SCHEMA_VERSION,
      typ: "gd.desktop-authorization-grant.v3",
      iss: "https://accounts.gooddealer.com",
      aud: "gooddealer-desktop/local-business",
      issuedAt: lease.issuedAt,
      expiresAt: lease.expiresAt,
      workspace: { workspaceId, kind: "personal_default" },
      activeDeviceLease: lease,
      scopes: ["workspace:mutate", "workspace:read"],
      commercialAuthority: {
        schemaVersion: 1,
        entitlementRevision: snapshot.sourceRevision,
        entitlementProjectionDigest,
        state: "active",
        commercialExpiresAt: snapshot.commercialExpiresAt,
        capability: "cloudflare:dns:observe",
      },
    };
    const signed = await this.signer.sign({
      purpose: DESKTOP_AUTHORIZATION_GRANT_KEY_PURPOSE,
      claims,
    });
    if (!signed.signed) return { issued: false, code: "GRANT_SIGNING_DISABLED" };
    const grant = desktopAuthorizationGrantSchema.parse(signed.envelope);
    const { kid: _kid, signature: _signature, ...returnedClaims } = grant;
    if (!sameCanonicalValue(returnedClaims, claims) ||
      signed.verificationKey.type !== "public" ||
      signed.verificationKey.asymmetricKeyType !== "ed25519" ||
      !verify(
        null,
        encodeDesktopAuthorizationGrantSignatureTranscript(grant),
        signed.verificationKey,
        Buffer.from(grant.signature, "base64url"),
      )) {
      throw new TypeError("authorization Grant signer returned invalid authority");
    }
    return {
      issued: true,
      grant,
      receiptDigest: createHash("sha256").update(signed.receipt).digest("hex"),
    };
  }
}

function sha256(bytes: Uint8Array): Uint8Array {
  return createHash("sha256").update(bytes).digest();
}

export function parseAuthoritativeEntitlementSnapshot(
  input: unknown,
): AuthoritativeEntitlementSnapshot {
  return authoritativeEntitlementSnapshotSchema.parse(input);
}

function sameCanonicalValue(left: unknown, right: unknown): boolean {
  return Buffer.from(encodeDomainSeparatedWireValue("GOODDEALER-GRANT-CLAIMS-COMPARISON-V1", left))
    .equals(Buffer.from(encodeDomainSeparatedWireValue("GOODDEALER-GRANT-CLAIMS-COMPARISON-V1", right)));
}
