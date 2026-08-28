import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

import {
  ActivationWizard,
  type ActivationActions,
  type ActivationPresentation,
} from "./activation-wizard";

describe("ActivationWizard", () => {
  it("renders pending as a non-actionable state", () => {
    const html = renderToStaticMarkup(
      <ActivationWizard
        locale="en-US"
        presentation={{ state: "pending", submitted: true }}
        actions={{ onRetry: vi.fn(), onContinue: vi.fn() }}
      />,
    );

    expect(html).toContain('data-activation-state="pending"');
    expect(html).toContain("Activating securely");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<input");
  });

  it("renders the accepted personal default outcome without exposing identifiers", () => {
    const presentation = {
      state: "accepted",
      workspace: { kind: "personal-default", label: '<img src=x onerror="alert(1)">' },
    } as const satisfies ActivationPresentation;
    const html = renderToStaticMarkup(
      <ActivationWizard locale="en-US" presentation={presentation} actions={{ onContinue: vi.fn() }} />,
    );

    expect(html).toContain('data-activation-state="accepted"');
    expect(html).toContain("Setup complete");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).toContain("Enter GoodDealer");
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("accountId");
    expect(html).not.toContain("workspaceId");
    expect(html).not.toContain("<select");
  });

  it.each([
    ["unauthenticated", false],
    ["invalid-request", true],
    ["already-active", false],
    ["temporarily-unavailable", true],
  ] as const)("renders rejected code %s and gates retry to retryable states", (code, retryable) => {
    const html = renderToStaticMarkup(
      <ActivationWizard
        locale="en-US"
        presentation={{ state: "rejected", code, retryable }}
        actions={{ onRetry: vi.fn(), onContinue: vi.fn() }}
      />,
    );

    expect(html).toContain('data-activation-state="rejected"');
    expect(html).toContain("Partially failed");
    expect(html.includes("<button")).toBe(retryable);
    expect(html).not.toContain("Enter GoodDealer");
    expect(html).not.toMatch(/device|provider|import|marketplace/i);
  });

  it("has payload-free retry and continue callbacks", () => {
    expectTypeOf<NonNullable<ActivationActions["onRetry"]>>().toEqualTypeOf<() => void>();
    expectTypeOf<NonNullable<ActivationActions["onContinue"]>>().toEqualTypeOf<() => void>();
  });
});
