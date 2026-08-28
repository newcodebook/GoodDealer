import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

import { DesktopShell, type DesktopShellProps } from "./desktop-shell";
import {
  createDefaultShellRoutes,
  selectEligibleShellRoute,
  shellRouteIds,
  type ShellNavigationRouteId,
} from "./route-contract";

describe("DesktopShell route contract", () => {
  it("closes the shell to the four accepted routes and shows only three rail destinations", () => {
    expect(shellRouteIds).toEqual([
      "portfolio.list",
      "portfolio.detail",
      "dns.health",
      "settings",
    ]);
    expect(createDefaultShellRoutes("en-US", shellRouteIds).map(({ id }) => id)).toEqual([
      "portfolio.list",
      "dns.health",
      "settings",
    ]);
  });

  it("rejects hidden, ineligible, excluded, and malformed navigation values", () => {
    const onSelect = vi.fn<(routeId: ShellNavigationRouteId) => void>();
    const eligible = ["portfolio.list", "settings"] as const;

    expect(selectEligibleShellRoute("portfolio.list", eligible, onSelect)).toBe(true);
    expect(selectEligibleShellRoute("portfolio.detail", shellRouteIds, onSelect)).toBe(false);
    expect(selectEligibleShellRoute("dns.health", eligible, onSelect)).toBe(false);
    expect(selectEligibleShellRoute("marketplace.sales", shellRouteIds, onSelect)).toBe(false);
    expect(selectEligibleShellRoute({ id: "settings" }, eligible, onSelect)).toBe(false);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("portfolio.list");
  });

  it("renders only read destinations and escaped presentation text", () => {
    const html = renderToStaticMarkup(
      <DesktopShell
        locale="en-US"
        title={'<img src=x onerror="alert(1)">'}
        activeRouteId="portfolio.list"
        eligibleRouteIds={shellRouteIds}
        banner={{ tone: "warning", title: "Observation delayed", description: "Read data may be stale." }}
      >
        <section>read presentation</section>
      </DesktopShell>,
    );

    expect(html).toContain("Asset library");
    expect(html).toContain("DNS records");
    expect(html).toContain("Connections");
    expect(html).toContain("read presentation");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).not.toContain("marketplace.sales");
    expect(html).not.toContain("Batch operations");
    expect(html).not.toContain("verification");
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<input");
  });

  it("exposes a navigation-only callback with no mutation payload", () => {
    expectTypeOf<NonNullable<DesktopShellProps["onRouteSelect"]>>()
      .toEqualTypeOf<(routeId: ShellNavigationRouteId) => void>();
  });
});
