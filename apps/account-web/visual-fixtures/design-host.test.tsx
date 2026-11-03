import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DesignHost } from "./design-host";
import { designScreens } from "./design-screens";

describe("Account Web design host", () => {
  it("lists every kit screen once and labels mock data", () => {
    const ids = designScreens().map((screen) => screen.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ["access", "shell", "license", "devices", "billing", "security", "cloud-data", "settings", "download"]) {
      expect(ids).toContain(id);
    }
    expect(renderToStaticMarkup(<DesignHost initialScreenId="access" />)).toContain("MOCK DATA · NOT PRODUCTION");
  });

  it("renders every variant of every designed screen", () => {
    for (const screen of designScreens()) {
      if (screen.render === undefined) continue;
      for (const variant of screen.variants ?? [{ id: "default", label: "default" }]) {
        const markup = renderToStaticMarkup(<>{screen.render({ variant: variant.id, locale: "zh-CN", navigate: () => undefined })}</>);
        expect(markup.length, `${screen.id}/${variant.id}`).toBeGreaterThan(0);
        expect(renderToStaticMarkup(<>{screen.render({ variant: variant.id, locale: "en-US", navigate: () => undefined })}</>)).not.toContain("undefined");
      }
    }
  });

  it("never offers checkout while a provider slot is held", () => {
    const license = designScreens().find((screen) => screen.id === "license");
    const render = (variant: string) => renderToStaticMarkup(<>{license?.render?.({ variant, locale: "zh-CN", navigate: () => undefined })}</>);
    expect(render("none")).toContain("选择年付");
    for (const variant of ["active", "checkout-pending", "cancelling", "ending", "read-only"]) {
      expect(render(variant), variant).not.toContain("选择年付");
    }
    expect(render("ten-year")).not.toContain(">取消续订</button>");
    expect(render("active")).toContain(">取消续订</button>");
  });

  it("renders the sign-in page without any prefilled secret", () => {
    const markup = renderToStaticMarkup(<DesignHost initialScreenId="access" />);
    expect(markup).toContain('type="password"');
    expect(markup).toContain('autoComplete="current-password"');
    expect(markup).not.toMatch(/type="password"[^>]*value="[^"]+"/u);
  });
});
