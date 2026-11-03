import { renewalDeskViewModelSchema } from "@gooddealer/client-core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { RenewalDesk, renewalUrgency, type RenewalListView, type RenewalPlanView, type RenewalQuote } from "./index";

const freshness = (canEdit: boolean) => ({
  source: canEdit ? "active_local" : "standby_cloud",
  ...(canEdit ? {} : { readOnlyReason: "standby" }),
  serverRevision: 1,
  lastReplicationActivityAt: null,
  lastSuccessfulProviderObservationAt: null,
  canEdit,
});

function list(canEdit = true): RenewalListView {
  const view = renewalDeskViewModelSchema.parse({
    schemaVersion: 1, kind: "renewal_desk", state: "list", freshness: freshness(canEdit),
    budget: { currency: "USD", amount: "100" },
    items: [
      { id: "vault.io", domain: "vault.io", registrar: "Spaceship", expiresOn: "2026-08-27", daysRemaining: 7, autoRenewEnabled: false, termYears: 2, annualPrice: { currency: "USD", amount: "32" }, selected: true, status: "due" },
      { id: "kanban.ai", domain: "kanban.ai", registrar: "Namecheap", expiresOn: "2026-09-05", daysRemaining: 16, autoRenewEnabled: true, termYears: 1, annualPrice: { currency: "USD", amount: "75" }, selected: false, status: "planned" },
    ],
    selectedCount: 1,
    selectedTotal: { currency: "USD", amount: "64" },
  });
  if (view.state !== "list") throw new Error("fixture");
  return view;
}

const plan = renewalDeskViewModelSchema.parse({
  schemaVersion: 1, kind: "renewal_desk", state: "confirm", freshness: freshness(true),
  budget: { currency: "USD", amount: "50" },
  items: [{ id: "vault.io", domain: "vault.io", registrar: "Spaceship", termYears: 2, annualPrice: { currency: "USD", amount: "32" } }],
  confirmationCount: 1,
  total: { currency: "USD", amount: "64" },
  overBudgetBy: { currency: "USD", amount: "14" },
  budgetRemaining: null,
}) as RenewalPlanView;

const quote = (state: RenewalQuote["state"]): RenewalQuote => ({
  itemId: "vault.io", domain: "vault.io", registrar: "Spaceship", termYears: 2,
  amount: { currency: "USD", amount: "64" }, validUntilLabel: "14:32", state,
});

describe("Renewal desk", () => {
  it("shows planned rows as planned and computes the budget remainder from the Host total", () => {
    const html = renderToStaticMarkup(<RenewalDesk locale="zh-CN" view={list()} onReviewPlan={() => undefined} />);

    expect(html).toContain("已计划");
    expect(html).toContain("$36.00");
    expect(html).toContain("续费所选 · 1");
  });

  it("states that creating a plan charges nothing and flags an over-budget plan", () => {
    const html = renderToStaticMarkup(<RenewalDesk locale="zh-CN" view={list()} plan={plan} />);

    expect(html).toContain("生成计划不会扣费");
    expect(html).toContain("超出续费预算 $14.00");
  });

  it("confirms one renewal at a time with its currency, term, and quote validity", () => {
    const html = renderToStaticMarkup(<RenewalDesk locale="zh-CN" view={list()} quotes={[quote("pending")]} />);

    expect(html).toContain("第 1 / 1 项");
    expect(html).toContain("确认续费 · $64.00");
    expect(html).toContain("2 年");
    expect(html).toContain("14:32");
    expect(renderToStaticMarkup(<RenewalDesk locale="zh-CN" view={list()} quotes={[quote("confirmed")]} />)).toContain("全部处理完毕");
  });

  it("removes selection and term editing from a read-only view", () => {
    const html = renderToStaticMarkup(<RenewalDesk locale="zh-CN" view={list(false)} onSelectionChange={() => undefined} onTermChange={() => undefined} onReviewPlan={() => undefined} />);

    expect(html).toContain("当前为只读视图");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>续费所选/u);
  });

  it("escalates urgency under 30 and 14 days", () => {
    expect(renewalUrgency(7)).toBe("danger");
    expect(renewalUrgency(20)).toBe("warning");
    expect(renewalUrgency(45)).toBeNull();
  });
});
