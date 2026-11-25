import { generateKeyPairSync, sign } from "node:crypto";
import { encodeDesktopStandbyGrantSignatureTranscript } from "@gooddealer/protocol/devices";
import type { DesktopStandbyGrantSigner } from "../../src/modules/devices/standby-grant-issuer";

const pair = generateKeyPairSync("ed25519");
export const standbyGrantSigner: DesktopStandbyGrantSigner = {
  async sign({ claims }) {
    const draft = { ...claims, kid: "test-standby-v1", signature: "AA" };
    return { signed: true, envelope: { ...draft,
      signature: sign(null, encodeDesktopStandbyGrantSignatureTranscript(draft), pair.privateKey).toString("base64url") },
    verificationKey: pair.publicKey, receipt: Buffer.from("test-standby-receipt") };
  },
};
