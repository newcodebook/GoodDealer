import { describe, expect, expectTypeOf, it } from "vitest";

import {
  ValidatingRenewalDeskQueryPort,
  ValidatingRenewalPlanPort,
  renewalDeskViewModelSchema,
  renewalPlanRequestSchema,
  type RenewalPlanPort,
} from "./index";

const timestamp = "2026-08-17T05:00:00Z";

function freshness(source: "active_local" | "standby_cloud") {
  return {
    source,
    serverRevision: 12,
    lastReplicationActivityAt: timestamp,
    lastSuccessfulProviderObservationAt: timestamp,
    canEdit: source === "active_local",
  } as const;
}

function item(id: string, selected: boolean, termYears: 1 | 2 | 3 = 1) {
  return {
    id,
    domain: `${id}.com`,
    registrar: "Spaceship",
    expiresOn: "2026-09-01",
    daysRemaining: 15,
    autoRenewEnabled: false,
    termYears,
    annualPrice: { currency: "USD", amount: "11" },
    selected,
    status: "due" as const,
  };
}

function list(source: "active_local" | "standby_cloud" = "active_local") {
  return {
    schemaVersion: 1,
    kind: "renewal_desk",
    state: "list",
    freshness: freshness(source),
    budget: { currency: "USD", amount: "312" },
    items: [item("vault", true), item("kanban", false)],
    selectedCount: 1,
    selectedTotal: { currency: "USD", amount: "11" },
  } as const;
}

function confirmation() {
  return {
    schemaVersion: 1,
    kind: "renewal_desk",
    state: "confirm",
    freshness: freshness("active_local"),
    budget: { currency: "USD", amount: "20" },
    items: [
      { id: "vault", domain: "vault.com", registrar: "Spaceship", termYears: 2, annualPrice: { currency: "USD", amount: "11" } },
      { id: "kanban", domain: "kanban.com", registrar: "Namecheap", termYears: 1, annualPrice: { currency: "USD", amount: "3.5" } },
    ],
    confirmationCount: 2,
    total: { currency: "USD", amount: "25.5" },
    overBudgetBy: { currency: "USD", amount: "5.5" },
    budgetRemaining: null,
  } as const;
}

describe("RenewalDesk contracts", () => {
  it("accepts list and budget states in Active and Standby", () => {
    expect(renewalDeskViewModelSchema.safeParse(list("active_local")).success).toBe(true);
    expect(renewalDeskViewModelSchema.safeParse(list("standby_cloud")).success).toBe(true);
    expect(renewalDeskViewModelSchema.safeParse({ ...list(), selectedCount: 2 }).success).toBe(false);
    expect(renewalDeskViewModelSchema.safeParse({ ...list(), selectedTotal: { currency: "USD", amount: "10.999" } }).success).toBe(false);
  });

  it("reconciles confirmation count, exact canonical money, and over-budget warning", () => {
    expect(renewalDeskViewModelSchema.safeParse(confirmation()).success).toBe(true);
    expect(renewalDeskViewModelSchema.safeParse({ ...confirmation(), confirmationCount: 1 }).success).toBe(false);
    expect(renewalDeskViewModelSchema.safeParse({ ...confirmation(), total: { currency: "USD", amount: "25.50000001" } }).success).toBe(false);
    expect(renewalDeskViewModelSchema.safeParse({ ...confirmation(), overBudgetBy: { currency: "USD", amount: "5.4" } }).success).toBe(false);
    expect(renewalPlanRequestSchema.safeParse({
      confirmationCount: confirmation().confirmationCount,
      items: confirmation().items,
      total: confirmation().total,
    }).success).toBe(true);
  });

  it("rejects unknown boundary fields and Standby editability claims", async () => {
    const active = list();
    await expect(new ValidatingRenewalDeskQueryPort({ loadRenewalDesk: async () => active }).loadRenewalDesk())
      .resolves.toEqual(active);
    await expect(new ValidatingRenewalDeskQueryPort({
      loadRenewalDesk: async () => ({ ...active, paymentToken: "must-not-cross" }),
    }).loadRenewalDesk()).rejects.toThrow();
    expect(renewalDeskViewModelSchema.safeParse({
      ...list("standby_cloud"),
      freshness: { ...freshness("standby_cloud"), canEdit: true },
    }).success).toBe(false);
  });

  it("can create only a plan and has no auto-renew or charge operation", () => {
    expectTypeOf<keyof RenewalPlanPort>().toEqualTypeOf<"createRenewalPlan">();
  });

  it("validates planning receipt count and money against the reviewed confirmation", async () => {
    const request = {
      confirmationCount: confirmation().confirmationCount,
      items: [...confirmation().items],
      total: confirmation().total,
    };
    await expect(new ValidatingRenewalPlanPort({
      createRenewalPlan: async () => ({ planId: "renewal-1", status: "planned", itemCount: 2, total: { currency: "USD", amount: "25.5" } }),
    }).createRenewalPlan(request)).resolves.toMatchObject({ status: "planned" });
    await expect(new ValidatingRenewalPlanPort({
      createRenewalPlan: async () => ({ planId: "renewal-1", status: "planned", itemCount: 1, total: { currency: "USD", amount: "25.5" } }),
    }).createRenewalPlan(request)).rejects.toThrow("does not match");
    await expect(new ValidatingRenewalPlanPort({
      createRenewalPlan: async () => ({ planId: "renewal-1", status: "planned", itemCount: 2, total: { currency: "USD", amount: "25.5" }, charged: true }),
    }).createRenewalPlan(request)).rejects.toThrow();
  });
});
