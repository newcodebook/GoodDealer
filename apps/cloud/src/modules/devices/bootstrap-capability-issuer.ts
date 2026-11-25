import { createHash, verify, type KeyObject } from "node:crypto";
import {
  bootstrapCapabilityEnvelopeSchema,
  encodeBootstrapCapabilitySignatureTranscript,
  type BootstrapCapabilityEnvelope,
} from "@gooddealer/protocol/devices";
import { BOOTSTRAP_CAPABILITY_KEY_PURPOSE } from "./bootstrap-capability-verifier";
export { BOOTSTRAP_CAPABILITY_KEY_PURPOSE };
export interface BootstrapCapabilitySigner {
  sign(input: {
    readonly purpose: typeof BOOTSTRAP_CAPABILITY_KEY_PURPOSE;
    readonly claims: Omit<BootstrapCapabilityEnvelope, "kid" | "signature">;
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
export class BootstrapCapabilityIssuer {
  constructor(private readonly signer: BootstrapCapabilitySigner) {}
  async issue(
    claims: Omit<BootstrapCapabilityEnvelope, "kid" | "signature">,
  ): Promise<{ capability: BootstrapCapabilityEnvelope; receiptDigest: string; verificationKey: KeyObject } | null> {
    const result = await this.signer.sign({ purpose: BOOTSTRAP_CAPABILITY_KEY_PURPOSE, claims });
    if (!result.signed) return null;
    const capability = bootstrapCapabilityEnvelopeSchema.parse(result.envelope);
    const expected = encodeBootstrapCapabilitySignatureTranscript({
      ...claims,
      kid: capability.kid,
      signature: capability.signature,
    });
    const actual = encodeBootstrapCapabilitySignatureTranscript(capability);
    if (
      !Buffer.from(expected).equals(Buffer.from(actual)) ||
      result.verificationKey.type !== "public" ||
      result.verificationKey.asymmetricKeyType !== "ed25519" ||
      !verify(null, actual, result.verificationKey, Buffer.from(capability.signature, "base64url"))
    ) {
      throw new TypeError("bootstrap capability signer returned invalid evidence");
    }
    return {
      capability,
      verificationKey: result.verificationKey,
      receiptDigest: createHash("sha256").update(result.receipt).digest("hex"),
    };
  }
}
