import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import * as productionExports from "../src/index";

describe("Cloudflare public and source closure", () => {
  it("has the exact runtime export allowlist", () => {
    expect(Object.keys(productionExports).sort()).toEqual([
      "CloudflareContractError",
      "parseCloudflareObservationError",
      "parseCloudflareObservationSubmitRequest",
      "parseCloudflareZoneReadIntent",
    ]);
  });

  it("has the exact declared type export allowlist", async () => {
    const barrel = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");
    expect(barrel).toContain("CloudflareObservationSubmitRequest");
    expect(barrel).toContain("CloudflareObservationResult");
    expect(barrel).toContain("CloudflareZoneReadIntent");
    expect(barrel).toContain("CloudflareObservationErrorCode");
    expect(barrel).not.toMatch(/export\s+\*/);
  });

  it("contains no obsolete, network, registration, generic connector, or protocol surface", async () => {
    const sources = await Promise.all(["cloudflare-contracts.ts", "index.ts"].map((name) => readFile(new URL(`../src/${name}`, import.meta.url), "utf8")));
    const source = sources.join("\n");
    for (const forbidden of [
      /DnsWrite/, /DnsRrsetSnapshot/, /cloudflareConnector/, /CapabilityDescriptor/, /ConnectorRegistration/,
      /\bfetch\s*\(/, /XMLHttpRequest/, /node:https?/,
      /Authorization\s*:/, /Bearer\s+/, /createTransport/, /registerConnector/, /FakeCloudflare/,
    ]) expect(source).not.toMatch(forbidden);
  });
});
