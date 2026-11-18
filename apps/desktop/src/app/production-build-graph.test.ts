import { fileURLToPath, URL } from "node:url";
import { build, type Plugin } from "vite";
import { describe, expect, it } from "vitest";

const desktopRoot = fileURLToPath(new URL("../../", import.meta.url));

/** Builds the production entry in memory and returns every module the bundle contains. */
async function productionModules(): Promise<readonly string[]> {
  const modules = new Set<string>();
  const collect: Plugin = {
    name: "collect-production-modules",
    generateBundle(_options, bundle) {
      for (const output of Object.values(bundle)) {
        if (output.type === "chunk") for (const id of Object.keys(output.modules)) modules.add(id.replaceAll("\\", "/"));
      }
    },
  };
  await build({
    root: desktopRoot,
    configFile: fileURLToPath(new URL("../../vite.config.ts", import.meta.url)),
    logLevel: "silent",
    plugins: [collect],
    build: { write: false, minify: false },
  });
  return [...modules];
}

describe("Desktop production build graph", () => {
  it("ships every composed page from the real artifact and nothing from the design host or brand kit", async () => {
    const modules = await productionModules();

    expect(modules.filter((id) => /\/visual-fixtures\/|\/brand\/|\/ui-brand\//u.test(id))).toEqual([]);
    // Each production route's presentation is reachable from the Tauri entry, not only from fixtures.
    for (const feature of [
      "features/portfolio/asset-library/asset-library.tsx",
      "features/portfolio/domain-detail/domain-detail.tsx",
      "features/registration/renewal-desk/renewal-desk.tsx",
      "features/marketplace/sales-desk/sales-desk.tsx",
      "features/dns/dns-verification/dns-verification.tsx",
      "features/operations/batch-operations/batch-list.tsx",
      "features/operations/manual-tasks/manual-task-inbox.tsx",
      "features/operations/operation-history/operation-history.tsx",
      "features/sync/conflict-center/conflict-center.tsx",
      "features/settings/settings-panel/settings-panel.tsx",
    ]) {
      expect(modules.some((id) => id.endsWith(`/apps/desktop/src/${feature}`)), feature).toBe(true);
    }
  }, 120_000);
});
