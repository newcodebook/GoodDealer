import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  desktopAuthorizationGrantRoleRequestSchema,
  desktopAuthorizationGrantSchema,
  encodeDesktopAuthorizationGrantSignatureTranscript,
} from "../src/devices/index";

const corpus = JSON.parse(readFileSync(new URL("../test-vectors/desktop-authorization/grant-v4-corpus.json", import.meta.url), "utf8")) as {
  cases: { name: string; accepted: boolean; grant: unknown; transcriptSha256: string | null }[];
};

describe("Desktop commercial capability authority", () => {
  for (const entry of corpus.cases) {
    it(entry.name, () => {
      const result = desktopAuthorizationGrantSchema.safeParse(entry.grant);
      expect(result.success).toBe(entry.accepted);
      if (result.success) {
        expect(createHash("sha256").update(encodeDesktopAuthorizationGrantSignatureTranscript(result.data)).digest("hex"))
          .toBe(entry.transcriptSha256);
      }
    });
  }
  it("accepts only role request v5, without caller-selected capabilities", () => {
    expect(desktopAuthorizationGrantRoleRequestSchema.parse({ schemaVersion: 5 })).toEqual({ schemaVersion: 5 });
    for (const value of [{ schemaVersion: 4 }, { schemaVersion: 3 },
      { schemaVersion: 5, capabilities: ["afternic:marketplace:write"] }]) {
      expect(desktopAuthorizationGrantRoleRequestSchema.safeParse(value).success).toBe(false);
    }
  });
  it("accepts the exact request embedded by the Native authorization client", () => {
    const request: unknown = JSON.parse(readFileSync(new URL(
      "../test-vectors/device-identity/valid/desktop-authorization-request.json", import.meta.url,
    ), "utf8"));
    expect(desktopAuthorizationGrantRoleRequestSchema.parse(request)).toEqual({ schemaVersion: 5 });
  });
  it("signs the capability set so adding or removing a permission changes the transcript", () => {
    const digests = corpus.cases.filter((entry) => entry.accepted).map((entry) => entry.transcriptSha256);
    expect(digests).toHaveLength(10);
    expect(new Set(digests).size).toBe(digests.length);
  });
});
