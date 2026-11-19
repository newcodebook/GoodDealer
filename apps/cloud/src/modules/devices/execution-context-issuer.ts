import { createHash, verify, type KeyObject } from "node:crypto";
import {
  desktopExecutionContextSchema,
  encodeDesktopExecutionContextSignatureTranscript,
  type DesktopExecutionContext,
} from "@gooddealer/protocol/devices";
export const DESKTOP_EXECUTION_CONTEXT_KEY_PURPOSE =
  "gooddealer.devices.desktop-execution-context.v1" as const;
export interface DesktopExecutionContextSigner {
  sign(input: {
    readonly purpose: typeof DESKTOP_EXECUTION_CONTEXT_KEY_PURPOSE;
    readonly claims: Omit<DesktopExecutionContext, "kid" | "signature">;
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
export class DesktopExecutionContextIssuer {
  constructor(private readonly signer: DesktopExecutionContextSigner) {}
  async issue(
    claims: Omit<DesktopExecutionContext, "kid" | "signature">,
  ): Promise<{ context: DesktopExecutionContext; receiptDigest: string; verificationKey: KeyObject } | null> {
    const result = await this.signer.sign({ purpose: DESKTOP_EXECUTION_CONTEXT_KEY_PURPOSE, claims });
    if (!result.signed) return null;
    const context = desktopExecutionContextSchema.parse(result.envelope);
    const expected = encodeDesktopExecutionContextSignatureTranscript({
      ...claims,
      kid: context.kid,
      signature: context.signature,
    });
    const actual = encodeDesktopExecutionContextSignatureTranscript(context);
    if (
      !Buffer.from(expected).equals(Buffer.from(actual)) ||
      result.verificationKey.type !== "public" ||
      result.verificationKey.asymmetricKeyType !== "ed25519" ||
      !verify(null, actual, result.verificationKey, Buffer.from(context.signature, "base64url"))
    ) {
      throw new TypeError("execution context signer returned invalid evidence");
    }
    return {
      context,
      verificationKey: result.verificationKey,
      receiptDigest: createHash("sha256").update(result.receipt).digest("hex"),
    };
  }
}
