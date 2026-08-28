import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { DesktopRouter } from "./desktop-router";
import {
  type DesktopSurface,
  type WorkspaceDesktopSurface,
} from "./desktop-surface";

describe("DesktopRouter", () => {
  it("renders only a route admitted by both the workspace surface and the renderer registry", () => {
    const surface: WorkspaceDesktopSurface<"standby"> = {
      kind: "standby",
      authorityEvidence: "complete",
      availableRouteIds: ["portfolio.list"],
      defaultRouteId: "portfolio.list",
    };
    const markup = renderToStaticMarkup(
      <DesktopRouter
        surface={surface}
        requestedRoute={{ id: "settings" }}
        routeRenderers={{ "portfolio.list": () => <p>admitted read route</p> }}
        renderUnavailable={() => <p>unavailable</p>}
      />,
    );

    expect(markup).toContain("admitted read route");
    expect(markup).not.toContain("unavailable");
  });

  it("never invokes a business renderer for LocalContinuation", () => {
    const renderPortfolio = vi.fn(() => <p>portfolio secret canary</p>);
    const localContinuationSurface: DesktopSurface = {
      kind: "local_continuation",
      authorityEvidence: "complete",
    };
    const markup = renderToStaticMarkup(
      <DesktopRouter
        surface={localContinuationSurface}
        requestedRoute={{ id: "portfolio.list" }}
        routeRenderers={{ "portfolio.list": renderPortfolio }}
        renderUnavailable={() => <p>sunset authority unavailable</p>}
      />,
    );

    expect(markup).toContain("sunset authority unavailable");
    expect(markup).not.toContain("portfolio secret canary");
    expect(renderPortfolio).not.toHaveBeenCalled();
  });

  it.each([
    null,
    { kind: "future_surface", authorityEvidence: "complete" },
    { kind: "active", authorityEvidence: "complete", availableRouteIds: [], defaultRouteId: "portfolio.list" },
    { kind: "active", authorityEvidence: "complete", availableRouteIds: ["portfolio.list", "portfolio.list"], defaultRouteId: "portfolio.list" },
    { kind: "active", authorityEvidence: "complete", availableRouteIds: ["portfolio.list"], defaultRouteId: "settings" },
    { kind: "active", authorityEvidence: "complete", availableRouteIds: ["portfolio.list"], defaultRouteId: "portfolio.list", accountId: "attacker" },
  ])("fails closed for unavailable, unknown, or inconsistent surface input %#", (surface) => {
    const renderPortfolio = vi.fn(() => <p>portfolio secret canary</p>);
    const markup = renderToStaticMarkup(
      <DesktopRouter
        surface={surface}
        requestedRoute={{ id: "portfolio.list" }}
        routeRenderers={{ "portfolio.list": renderPortfolio }}
        renderUnavailable={() => <p>no authority available</p>}
      />,
    );

    expect(markup).toContain("no authority available");
    expect(renderPortfolio).not.toHaveBeenCalled();
  });

  it("rejects accessor-bearing input without evaluating the accessor", () => {
    const kindAccessor = vi.fn(() => "active");
    const surface = Object.defineProperty(
      {
        authorityEvidence: "complete",
        availableRouteIds: ["portfolio.list"],
        defaultRouteId: "portfolio.list",
      },
      "kind",
      { enumerable: true, get: kindAccessor },
    );
    const renderPortfolio = vi.fn(() => <p>portfolio secret canary</p>);

    const markup = renderToStaticMarkup(
      <DesktopRouter
        surface={surface}
        requestedRoute={{ id: "portfolio.list" }}
        routeRenderers={{ "portfolio.list": renderPortfolio }}
        renderUnavailable={() => <p>no authority available</p>}
      />,
    );

    expect(markup).toContain("no authority available");
    expect(kindAccessor).not.toHaveBeenCalled();
    expect(renderPortfolio).not.toHaveBeenCalled();
  });

  it("ignores malformed requested routes and renders only the validated default route", () => {
    const renderDetail = vi.fn(() => <p>detail secret canary</p>);
    const markup = renderToStaticMarkup(
      <DesktopRouter
        surface={{
          kind: "standby",
          authorityEvidence: "complete",
          availableRouteIds: ["portfolio.list", "portfolio.detail"],
          defaultRouteId: "portfolio.list",
        }}
        requestedRoute={{ id: "portfolio.detail", domainId: "domain-1", workspaceId: "attacker" }}
        routeRenderers={{
          "portfolio.list": () => <p>validated default route</p>,
          "portfolio.detail": renderDetail,
        }}
        renderUnavailable={() => <p>no authority available</p>}
      />,
    );

    expect(markup).toContain("validated default route");
    expect(markup).not.toContain("detail secret canary");
    expect(renderDetail).not.toHaveBeenCalled();
  });
});
