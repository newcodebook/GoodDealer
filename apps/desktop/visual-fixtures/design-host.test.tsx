import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DesignHost } from "./design-host";
import { designScreens } from "./design-screens";
import { plannedScreens } from "./screen-registry";

describe("mock design host", () => {
  it("labels itself as mock data and lists every planned Desktop screen", () => {
    const html = renderToStaticMarkup(<DesignHost />);

    expect(html).toContain("MOCK DATA · NOT PRODUCTION");
    for (const screen of plannedScreens()) expect(html).toContain(screen.title);
  });

  it("keeps screen identities unique and traceable to a brand UI kit source", () => {
    const screens = plannedScreens();
    expect(new Set(screens.map((screen) => screen.id)).size).toBe(screens.length);
    for (const screen of screens) {
      expect(() => readFileSync(fileURLToPath(new URL(`../../../brand/ui_kits/desktop/${screen.kitSource}`, import.meta.url)))).not.toThrow();
    }
  });

  it("renders every variant of every designed screen from contract-valid mock data", () => {
    for (const screen of designScreens()) {
      if (screen.render === undefined) continue;
      for (const variant of screen.variants ?? [{ id: "", label: "" }]) {
        expect(() => renderToStaticMarkup(<>{screen.render?.({ variant: variant.id, platform: "windows", navigate: () => undefined })}</>), `${screen.id}/${variant.id}`).not.toThrow();
      }
    }
  });

  it("is never reachable from the production Vite entry", () => {
    const productionConfig = readFileSync(fileURLToPath(new URL("../vite.config.ts", import.meta.url)), "utf8");
    expect(productionConfig).toMatch(/input: fileURLToPath\(new URL\("\.\/index\.html"/u);
    expect(productionConfig).not.toMatch(/visual-fixtures\//u);
  });
});
