import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { App, desktopStartupState } from "../app";

function readSource(path: string): string {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
}

function readProductionSources(directory: URL): string {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const entryUrl = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
      if (entry.isDirectory()) return [readProductionSources(entryUrl)];
      if (!/\.(?:ts|tsx)$/u.test(entry.name) || /\.test\.(?:ts|tsx)$/u.test(entry.name)) return [];
      return [readFileSync(fileURLToPath(entryUrl), "utf8")];
    })
    .join("\n");
}

describe("Desktop production entrypoint boundary", () => {
  it("composes only the thin native adapters and the extracted coordination modules", () => {
    const main = readSource("../main.tsx");
    const app = readSource("../app.tsx");

    expect(main).toContain('from "./app"');
    expect(main).not.toMatch(/app-shell|features|composition-root|connector-/u);
    expect(app).toMatch(/\.\/adapters\/tauri/u);
    expect(app).toMatch(/\.\/app\/workspace-publication/u);
    expect(app).toMatch(/\.\/app\/authentication-coordinator/u);
    expect(app).not.toMatch(/composition-root|connector-|marketplace|registration|pricing|batch|listing|cloud-client/u);
    expect(app).not.toMatch(/window\.(?:prompt|confirm|alert)/u);
  });

  it("starts by opening the Host-owned local database and fabricates no authorization", () => {
    const html = renderToStaticMarkup(createElement(App));

    expect(html).toContain('data-desktop-state="opening"');
    expect(html).not.toMatch(/authorityEvidence|kind=.active|data-desktop-state="workspace"/u);
  });

  it("maps only Host-reported workspace states to the startup surface", () => {
    expect(desktopStartupState(true, null)).toBe("host_unavailable");
    expect(desktopStartupState(false, null)).toBe("opening");
  });

  it("uses only public UI and i18n package exports outside isolated visual fixtures", () => {
    const productionSources = readProductionSources(new URL("../", import.meta.url));
    const packageImports = [...productionSources.matchAll(/["'](@gooddealer\/(?:ui|i18n)(?:\/[^"']+)*)["']/gu)]
      .map((match) => match[1]);

    expect(productionSources).not.toMatch(/@gooddealer\/ui-brand|@gooddealer\/(?:ui|i18n)\/src|visual-fixtures|brand\/ui_kits/u);
    for (const packageImport of packageImports) {
      expect(
        packageImport === "@gooddealer/ui" ||
        packageImport === "@gooddealer/ui/tokens.css" ||
        packageImport?.startsWith("@gooddealer/ui/assets/") ||
        packageImport === "@gooddealer/i18n",
        `private package import: ${packageImport}`,
      ).toBe(true);
    }
  });

  it("does not treat stale shared app-shell route text as production reachability", () => {
    const entrypointFiles = ["../main.tsx", "../app.tsx", "./desktop-router.tsx", "./route-registry.ts"];
    const entrypoint = entrypointFiles.map((path) => readSource(path)).join("\n");

    expect(entrypoint).not.toMatch(/marketplace\.sales|operations\.(batch|manualTasks|history)/u);
  });
});
