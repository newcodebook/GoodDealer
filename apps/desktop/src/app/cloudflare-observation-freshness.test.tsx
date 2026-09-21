import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CloudflareObservationFreshness } from "../app";

const status = { schemaVersion: 1 as const, state: "ready" as const, connectionRef: "opaque", displayLabel: "Cloudflare", readGeneration: 1 };
const observation = { schemaVersion: 1 as const, readGeneration: 1, entityId: "example.com", observedAt: "2026-01-01T00:00:00Z", version: 1, availability: "available" as const, uncertainty: "stale" as const, zoneLabel: "example.com", zoneStatus: "active" as const, records: [] };

describe("CloudflareObservationFreshness", () => {
  it.each([
    ["stale", "stale and cannot be used as a fresh available result"],
    ["uncertain", "uncertain and cannot be used as an available result"],
  ] as const)("renders closed remediation for %s evidence", (state, text) => {
    const html = renderToStaticMarkup(<CloudflareObservationFreshness state={{ state, status, observation: { ...observation, uncertainty: state === "stale" ? "stale" : "unknown" } }} />);
    expect(html).toContain(text);
    expect(html).toContain('role="status"');
    expect(html).not.toMatch(/token|account|origin|provider error/iu);
  });
});
