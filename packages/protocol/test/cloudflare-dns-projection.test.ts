import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  cloudflareDnsProjectionDigestInput,
  parseCloudflareDnsProjectionAck,
  parseCloudflareDnsProjectionRequest,
} from "../src/workspace-observations/cloudflare-dns";

const corpus = JSON.parse(readFileSync(new URL("../test-vectors/cloudflare-dns-projection/wire-corpus.json", import.meta.url), "utf8")) as {
  validRequests: unknown[];
  invalidRequests: unknown[];
  validAcks: unknown[];
};

describe("Cloudflare DNS projection-only protocol", () => {
  it("accepts the golden request and ACK corpus", () => {
    for (const value of corpus.validRequests) expect(parseCloudflareDnsProjectionRequest(value)).toEqual(value);
    for (const value of corpus.validAcks) expect(parseCloudflareDnsProjectionAck(value)).toEqual(value);
  });

  it("rejects Host envelope fields and mixed availability", () => {
    for (const value of corpus.invalidRequests) expect(() => parseCloudflareDnsProjectionRequest(value)).toThrow();
  });

  it("rejects accessors, symbols and non-plain objects without invoking getters", () => {
    let invoked = false;
    const accessor = Object.defineProperty({}, "schemaVersion", { enumerable: true, get: () => { invoked = true; return 1; } });
    expect(() => parseCloudflareDnsProjectionRequest(accessor)).toThrow();
    expect(invoked).toBe(false);
    expect(() => parseCloudflareDnsProjectionRequest({ ...corpus.validRequests[0] as object, [Symbol("secret")]: true })).toThrow();
    expect(() => parseCloudflareDnsProjectionRequest(Object.assign(Object.create({ inherited: true }), corpus.validRequests[0]))).toThrow();
  });

  it("binds lease epoch and source sequence in canonical digest input", () => {
    const first = parseCloudflareDnsProjectionRequest(corpus.validRequests[0]);
    const second = parseCloudflareDnsProjectionRequest({ ...first, leaseEpoch: first.leaseEpoch + 1 });
    expect(Array.from(cloudflareDnsProjectionDigestInput(first))).not.toEqual(Array.from(cloudflareDnsProjectionDigestInput(second)));
    expect(createHash("sha256").update(cloudflareDnsProjectionDigestInput(first)).digest("hex"))
      .toBe("5600723db76bdce097579641d89e0aaa517b28edd557fc41dd5346710c93ca55");
  });
});
