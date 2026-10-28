import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function readNativeSource(path: string): string {
  return readFileSync(fileURLToPath(new URL(`../../src-tauri/${path}`, import.meta.url)), "utf8");
}

describe("Desktop native policy", () => {
  it("registers only reviewed local-business, authentication, and Cloudflare IPC commands", () => {
    const main = readNativeSource("src/main.rs");
    const handlers = readNativeSource("src/command_handlers.rs");
    const oauth = readNativeSource("src/oauth_runtime.rs");
    const session = readNativeSource("src/native_cloud_session.rs");
    expect(main).toMatch(/invoke_handler|generate_handler/u);
    expect(handlers).toMatch(/fn local_business_status/u);
    expect(handlers).toMatch(/fn local_asset_library_read/u);
    expect(handlers).toMatch(/fn local_domain_detail_read/u);
    expect(main).not.toMatch(/local_portfolio_read/u);
    expect(handlers).toMatch(/fn local_domain_asset_edit/u);
    expect(handlers).toMatch(/fn local_domain_asset_delete/u);
    expect(handlers).toMatch(/fn local_domain_asset_provider_bind/u);
    expect(handlers).toMatch(/fn cloudflare_connection_activate/u);
    expect(handlers).toMatch(/fn cloudflare_connection_status/u);
    expect(handlers).toMatch(/fn cloudflare_observation_read/u);
    expect(handlers).toMatch(/fn cloudflare_zone_observe/u);
    expect(handlers).not.toMatch(/database_path|database_key|generic_sql|cloud_portfolio/u);
    expect(oauth).toMatch(/fn desktop_authentication_status/u);
    expect(oauth).toMatch(/fn desktop_authentication_begin/u);
    expect(oauth).toMatch(/fn desktop_authentication_refresh/u);
    expect(session).toMatch(/AuthorizationFailed/u);
    expect(session).toMatch(/AuthorizationRetryable/u);
    const initialGrant = session.indexOf("fetch_and_activate_authorization(&credentials.access.token)");
    const initialRefreshStore = /self\s*\.refresh_credentials\s*\.store\(&credentials\.refresh\)/u.exec(session);
    expect(initialGrant).toBeGreaterThanOrEqual(0);
    expect(initialRefreshStore).not.toBeNull();
    expect(initialGrant).toBeLessThan(initialRefreshStore?.index ?? -1);
  });

  it("grants only reviewed native permissions to the single local-app webview", () => {
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
      "core:window:allow-start-dragging",
      "core:window:allow-minimize",
      "core:window:allow-toggle-maximize",
      "core:window:allow-close",
      "allow-cloudflare-connection-activate",
      "allow-cloudflare-connection-status",
      "allow-cloudflare-observation-read",
      "allow-cloudflare-zone-observe",
      "allow-local-backup-restore-status",
      "allow-local-backup-export",
      "allow-local-backup-artifact-select",
      "allow-local-backup-restore-begin",
      "allow-local-business-status",
      "allow-local-asset-library-read",
      "allow-local-domain-detail-read",
      "allow-local-domain-asset-edit",
      "allow-local-domain-asset-delete",
      "allow-local-domain-asset-provider-bind",
      "allow-local-conflict-center-read",
      "allow-local-conflict-resolve",
      "allow-local-sync-status",
      "allow-desktop-authentication-status",
      "allow-desktop-authentication-begin",
      "allow-desktop-authentication-refresh",
    ]);
    expect(existsSync(fileURLToPath(new URL("../../src-tauri/capabilities/remote-browser.json", import.meta.url)))).toBe(false);
  });

  it("confines the WebView to bundled assets and Tauri IPC through a self-only CSP", () => {
    const configuration = JSON.parse(readNativeSource("tauri.conf.json")) as {
      readonly app: { readonly security: {
        readonly csp: Readonly<Record<string, string>>;
        readonly dangerousDisableAssetCspModification: readonly string[];
      } };
    };
    const { csp, dangerousDisableAssetCspModification } = configuration.app.security;

    expect(csp).toEqual({
      "default-src": "'self'",
      "script-src": "'self'",
      "style-src": "'self' 'unsafe-inline'",
      "font-src": "'self'",
      "img-src": "'self' data:",
      "connect-src": "ipc: http://ipc.localhost",
      "object-src": "'none'",
      "base-uri": "'none'",
      "form-action": "'none'",
      "frame-ancestors": "'none'",
    });
    // Tauri nonces would void 'unsafe-inline' for React style attributes; scripts keep its hashes.
    expect(dangerousDisableAssetCspModification).toEqual(["style-src"]);
    expect(Object.values(csp).join(" ")).not.toMatch(/https:|wss?:|\*|'unsafe-eval'/u);
  });

  it("draws its own title bar on Windows and Linux and overlays it under macOS traffic lights", () => {
    type WindowConfig = Readonly<Record<string, unknown>>;
    const base = JSON.parse(readNativeSource("tauri.conf.json")) as { readonly app: { readonly windows: readonly WindowConfig[] } };
    const macos = JSON.parse(readNativeSource("tauri.macos.conf.json")) as Readonly<Record<string, unknown>> & { readonly app: { readonly windows: readonly WindowConfig[] } };
    const [window] = base.app.windows;
    const [macWindow] = macos.app.windows;

    expect(window).toMatchObject({ label: "local-app", decorations: false, shadow: true });
    // The macOS patch may only change title-bar presentation; size, label, and resizing stay shared.
    expect(Object.keys(macos).sort()).toEqual(["$schema", "app"]);
    expect(Object.keys(macos.app)).toEqual(["windows"]);
    expect(macos.app.windows).toHaveLength(1);
    const { shadow: _shadow, decorations: _decorations, ...shared } = window ?? {};
    expect(macWindow).toEqual({
      ...shared,
      decorations: true,
      titleBarStyle: "Overlay",
      hiddenTitle: true,
      trafficLightPosition: { x: 14, y: 19 },
    });
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
      "allow-cloudflare-connection-activate",
      "allow-cloudflare-connection-status",
      "allow-cloudflare-observation-read",
      "allow-cloudflare-zone-observe",
      "allow-local-backup-restore-status",
      "allow-local-backup-export",
      "allow-local-backup-artifact-select",
      "allow-local-backup-restore-begin",
      "allow-local-business-status",
      "allow-local-asset-library-read",
      "allow-local-domain-detail-read",
      "allow-local-domain-asset-edit",
      "allow-local-domain-asset-delete",
      "allow-local-domain-asset-provider-bind",
      "allow-local-conflict-center-read",
      "allow-local-conflict-resolve",
      "allow-local-sync-status",
      "allow-desktop-authentication-status",
      "allow-desktop-authentication-begin",
      "allow-desktop-authentication-refresh",
    ]);
  });
});
