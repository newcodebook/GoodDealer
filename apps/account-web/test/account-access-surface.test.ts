import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const html = readFileSync(join(packageRoot, "index.html"), "utf8");

/** Production sources only: tests and the mock design host never ship. */
function productionSources(directory: string): { readonly path: string; readonly text: string }[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return productionSources(path);
    if (!/\.tsx?$/u.test(name) || /\.test\.tsx?$/u.test(name)) return [];
    return [{ path: relative(packageRoot, path), text: readFileSync(path, "utf8") }];
  });
}

const sources = productionSources(join(packageRoot, "src"));

describe("Account Web production surface", () => {
  it("loads one module entry and no inline script", () => {
    expect(html.match(/<script\b/gu)).toHaveLength(1);
    expect(html).toContain('<script type="module" src="/src/main.tsx"></script>');
  });

  it("names no absolute origin, so every request and navigation stays same-origin", () => {
    for (const source of sources) expect(source.text, source.path).not.toMatch(/https?:\/\//u);
  });

  it("keeps passwords and verification codes out of browser persistence", () => {
    for (const source of sources) {
      expect(source.text, source.path).not.toMatch(/(?:localStorage|sessionStorage|storage)\.setItem\([^\n]*(?:password|code)/iu);
      expect(source.text, source.path).not.toContain("sessionStorage");
    }
  });

  it("issues network requests only through the injected host fetch", () => {
    const callers = sources.filter((source) => /\bfetch\(/u.test(source.text)).map((source) => source.path);
    expect(callers).toEqual([join("src", "main.tsx")]);
  });

  it("composes only routes with a Cloud contract", () => {
    const app = readFileSync(join(packageRoot, "src", "app", "account-app.tsx"), "utf8");
    expect(app).toContain("availableRouteIds={productionAccountRouteIds}");
    expect(app).not.toMatch(/features\/(?:devices|billing)\//u);
  });
});
