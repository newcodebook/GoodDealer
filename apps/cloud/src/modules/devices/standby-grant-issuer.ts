import { createHash, type KeyObject, verify } from "node:crypto";
import {
  desktopStandbyGrantSchema,
  encodeDesktopStandbyGrantSignatureTranscript,
  type DesktopStandbyGrant,
} from "@gooddealer/protocol/devices";
import { encodeDomainSeparatedWireValue } from "@gooddealer/protocol/wire";

export const DESKTOP_STANDBY_GRANT_KEY_PURPOSE = "gooddealer.devices.desktop-standby-grant.v1" as const;
type Claims = Omit<DesktopStandbyGrant, "kid" | "signature">;
export interface DesktopStandbyGrantSigner {
  sign(input: { readonly purpose: typeof DESKTOP_STANDBY_GRANT_KEY_PURPOSE; readonly claims: Claims }): Promise<
    | { readonly signed: false }
    | { readonly signed: true; readonly envelope: unknown; readonly verificationKey: KeyObject; readonly receipt: Uint8Array }
  >;
}

/** Independent purpose and exact claims verification: no Lease or commercial authority can enter this envelope. */
export class DesktopStandbyGrantIssuer {
  constructor(private readonly signer: DesktopStandbyGrantSigner) {}
  async issue(claims: Claims): Promise<DesktopStandbyGrant | null> {
    const expected = desktopStandbyGrantSchema.parse({ ...claims, kid: "validation", signature: "AA" });
    const { kid: _kid, signature: _signature, ...validated } = expected;
    const signed = await this.signer.sign({ purpose: DESKTOP_STANDBY_GRANT_KEY_PURPOSE, claims: validated });
    if (!signed.signed) return null;
    const grant = desktopStandbyGrantSchema.parse(signed.envelope);
    const { kid: _returnedKid, signature: _returnedSignature, ...returned } = grant;
    if (!claimsDigest(validated).equals(claimsDigest(returned))
      || signed.verificationKey.type !== "public" || signed.verificationKey.asymmetricKeyType !== "ed25519"
      || !verify(null, encodeDesktopStandbyGrantSignatureTranscript(grant), signed.verificationKey,
        Buffer.from(grant.signature, "base64url"))) throw new TypeError("Standby signer returned invalid authority");
    return grant;
  }
}
function claimsDigest(claims: Claims): Buffer {
  return createHash("sha256").update(encodeDomainSeparatedWireValue("GOODDEALER-STANDBY-CLAIMS-V1", claims)).digest();
}
