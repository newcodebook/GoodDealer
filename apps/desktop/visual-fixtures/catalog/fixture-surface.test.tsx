import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import manifestJson from "../screenshots/manifest.json";
import { FixtureSurface } from "./fixture-surface";
import { parseVisualFixtureManifest } from "./manifest";
import { presentationFixtureRegistry } from "./registry";

const manifest = parseVisualFixtureManifest(manifestJson as unknown);

function render(caseId: string): string {
  return renderToStaticMarkup(<FixtureSurface manifest={manifest} registry={presentationFixtureRegistry} caseId={caseId} onFixtureIntent={vi.fn()} />);
}

describe("D-UI-V1 fixture rendering", () => {
  it("renders every declared case through a production presentation", () => {
    for (const fixtureCase of manifest.presentations.flatMap(({ cases }) => cases)) {
      const html = render(fixtureCase.id);
      expect(html, fixtureCase.id).not.toContain("gd-fixture-unavailable");
      expect(html, fixtureCase.id).not.toContain("dangerouslySetInnerHTML");
    }
  });

  it("shows only accepted shell routes and representative banners", () => {
    const defaultShell = render("shell-default");
    expect(defaultShell).toContain("Asset library");
    expect(defaultShell).toContain("DNS records");
    expect(defaultShell).toContain("Connections");
    expect(defaultShell).not.toMatch(/batch|sales|renewal|device|provider refresh/i);
    expect(render("shell-unavailable")).toContain("No product availability is implied");
    expect(render("shell-uncertain")).toContain("local QA state");
  });

  it("renders sanitized TXT as read data with no ownership or link sink", () => {
    const html = render("dns-available");
    expect(html).toContain("TXT");
    expect(html).toContain("[sanitized TXT fixture value]");
    expect(html).toMatch(/redacted/i);
    expect(html).not.toMatch(/ownership|challenge|verify ownership|href=/i);
  });

  it("fails closed for an unknown case", () => {
    expect(render("not-declared")).toContain("Unknown fixture case");
  });

  it("keeps the capture root centered at declared viewport geometry", () => {
    const css = readFileSync(fileURLToPath(new URL("../visual-fixtures.css", import.meta.url)), "utf8");
    const rule = css.match(/\.gd-fixture-capture\s*\{(?<body>[^}]*)\}/u)?.groups?.["body"];
    expect(rule).toMatch(/display:\s*flex/u);
    expect(rule).toMatch(/align-items:\s*center/u);
    expect(rule).toMatch(/justify-content:\s*center/u);
  });
});
