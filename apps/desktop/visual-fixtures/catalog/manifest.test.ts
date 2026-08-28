import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import manifestJson from "../screenshots/manifest.json";
import { assertExactScreenshotFileSet, dUiV1Presentations, parseVisualFixtureManifest } from "./manifest";
import { presentationFixtureRegistry } from "./registry";

const manifest = parseVisualFixtureManifest(manifestJson as unknown);
const requiredStates = {
  shell: ["default", "unavailable", "uncertain"],
  activation: ["pending", "accepted", "rejected"],
  "asset-list": ["loading", "empty", "unavailable", "error", "ready", "stale", "uncertain"],
  "asset-detail": ["loading", "unavailable", "error", "ready", "stale", "uncertain"],
  "cloudflare-connection": ["loading", "not-configured", "checking", "available", "stale", "uncertain", "unavailable", "error"],
  "zone-dns-observation": ["loading", "empty", "available", "stale", "uncertain", "unavailable", "error"],
} as const;

describe("D-UI-V1 fixture manifest", () => {
  it("declares exactly the accepted production presentations and closed states", () => {
    expect(manifest.catalogIntent).toBe("synthetic-local-qa-only");
    expect(manifest.presentations.map(({ presentation }) => presentation)).toEqual(dUiV1Presentations);
    for (const presentation of manifest.presentations) {
      expect(presentation.cases.map(({ state }) => state)).toEqual(requiredStates[presentation.presentation]);
      expect(presentation.productionSource).toMatch(/^apps\/desktop\/src\//u);
      expect(presentation.cases.every(({ fixtureIntent }) => /Synthetic/u.test(fixtureIntent))).toBe(true);
    }
    expect(Object.keys(presentationFixtureRegistry)).toEqual(dUiV1Presentations);
  });

  it("contains no excluded registration, authority, secret, or mutation catalog vocabulary", () => {
    const catalog = JSON.stringify(manifest);
    expect(catalog).not.toMatch(/batch|commerce|marketplace|registrar-action|ownership|lease|pricing|listing|csv|device-switch|provider-write|browser|token|secret/i);
    const catalogDirectory = fileURLToPath(new URL("./", import.meta.url));
    const source = ["d-ui-v1-registrations.tsx", "registry.ts", "presentation-registry.tsx"].map((file) => readFileSync(`${catalogDirectory}/${file}`, "utf8")).join("\n");
    expect(source).not.toMatch(/@gooddealer\/client-core|brand\/ui_kits|operations-registrations|portfolio-commerce-registrations|runtime-registrations|settings-registration/);
    expect(source).not.toMatch(/fetch\s*\(|@tauri-apps|localStorage|sessionStorage|dangerouslySetInnerHTML/);
  });

  it("records an exact captured PNG set with matching dimensions and digests", () => {
    const directory = fileURLToPath(new URL("../screenshots/", import.meta.url));
    const pngs = readdirSync(directory).filter((file) => file.endsWith(".png"));
    assertExactScreenshotFileSet(manifest, pngs);
    for (const presentation of manifest.presentations) {
      for (const fixtureCase of presentation.cases) {
        expect(fixtureCase.screenshot.captureStatus).toBe("captured");
        const path = `${directory}/${fixtureCase.id}.png`;
        expect(existsSync(path), fixtureCase.id).toBe(true);
        const payload = readFileSync(path);
        expect({ width: payload.readUInt32BE(16), height: payload.readUInt32BE(20) }).toEqual(presentation.viewport);
        expect(createHash("sha256").update(payload).digest("hex")).toBe(fixtureCase.screenshot.sha256);
      }
    }
  });

  it("rejects unknown fields and undeclared or duplicate cases", () => {
    const unknown = structuredClone(manifestJson) as Record<string, unknown>;
    unknown["authority"] = true;
    expect(() => parseVisualFixtureManifest(unknown)).toThrow(/missing or unknown/u);
    const duplicate = structuredClone(manifestJson);
    duplicate.presentations[1]!.cases[0]!.id = duplicate.presentations[0]!.cases[0]!.id;
    duplicate.presentations[1]!.cases[0]!.screenshot.file = duplicate.presentations[0]!.cases[0]!.screenshot.file;
    expect(() => parseVisualFixtureManifest(duplicate)).toThrow(/globally unique/u);
  });
});
