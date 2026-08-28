import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function readNativeSource(path: string): string {
  return readFileSync(fileURLToPath(new URL(`../../src-tauri/${path}`, import.meta.url)), "utf8");
}

describe("Desktop native policy", () => {
  it("registers only narrow local-business IPC commands", () => {
    const main = readNativeSource("src/main.rs");
    const handlers = readNativeSource("src/command_handlers.rs");
    expect(main).toMatch(/invoke_handler|generate_handler/u);
    expect(handlers).toMatch(/fn local_business_status/u);
    expect(handlers).toMatch(/fn local_portfolio_read/u);
    expect(handlers).toMatch(/fn local_domain_asset_upsert/u);
    expect(handlers).not.toMatch(/database_path|database_key|generic_sql|cloud_portfolio/u);
  });

  it("grants only reviewed local-business permissions to the single local-app webview", () => {
    const configuration = JSON.parse(readNativeSource("tauri.conf.json")) as {
      readonly app: { readonly security: { readonly capabilities: readonly string[] } };
    };
    const capability = JSON.parse(readNativeSource("capabilities/local-app.json")) as {
      readonly identifier: string;
      readonly webviews: readonly string[];
      readonly permissions: readonly string[];
    };

    expect(configuration.app.security.capabilities).toEqual(["local-app"]);
    expect(capability.identifier).toBe("local-app");
    expect(capability.webviews).toEqual(["local-app"]);
    expect(capability.permissions).toEqual([
      "core:default",
      "allow-local-business-status",
      "allow-local-portfolio-read",
      "allow-local-domain-asset-upsert",
    ]);
    expect(existsSync(fileURLToPath(new URL("../../src-tauri/capabilities/remote-browser.json", import.meta.url)))).toBe(false);
  });

  it("has local storage but no browser dependency", () => {
    const manifest = readNativeSource("Cargo.toml");
    expect(manifest).toMatch(/gooddealer-local-storage/u);
    expect(manifest).not.toMatch(/automation-host|browser/u);
  });

  it("keeps generated capabilities synchronized with the owning source", () => {
    const generated = JSON.parse(readNativeSource("gen/schemas/capabilities.json")) as Record<
      string,
      { readonly webviews: readonly string[]; readonly permissions: readonly string[] }
    >;
    expect(Object.keys(generated)).toEqual(["local-app"]);
    expect(generated["local-app"]?.webviews).toEqual(["local-app"]);
    expect(generated["local-app"]?.permissions).toEqual([
      "core:default",
      "allow-local-business-status",
      "allow-local-portfolio-read",
      "allow-local-domain-asset-upsert",
    ]);
  });
});
