import { renewalDeskViewModelSchema, type RenewalTermYears } from "@gooddealer/client-core";

import type { RenewalListView, RenewalPlanView, RenewalQuote } from "../../src/features/registration/renewal-desk";
import { mockReferenceDate } from "./workspace-fixtures";

/** Mock renewal rows adapted from brand/ui_kits/desktop/RenewDesk.jsx, dated relative to the mock "today". */
export interface MockRenewalRow {
  readonly id: string;
  readonly domain: string;
  readonly registrar: string;
  readonly daysRemaining: number;
  readonly autoRenewEnabled: boolean;
  readonly termYears: RenewalTermYears;
  readonly selected: boolean;
  readonly status: "due" | "planned";
}

const tldPrice: Readonly<Record<string, number>> = { io: 32, com: 11, ai: 75, dev: 14, money: 33, trade: 28, systems: 30, capital: 30, exchange: 42 };

function annualPrice(domain: string): number {
  return tldPrice[domain.split(".").pop() ?? ""] ?? 20;
}

export const mockRenewalBudget = 312;

export function initialMockRenewals(): readonly MockRenewalRow[] {
  const rows: readonly [string, string, number, boolean][] = [
    ["vault.io", "Spaceship", 7, false],
    ["arc.exchange", "Spaceship", 11, false],
    ["kanban.ai", "Namecheap", 16, false],
    ["quanta.trade", "Dynadot", 22, true],
    ["helio.systems", "Dynadot", 29, false],
    ["crest.capital", "Spaceship", 33, false],
    ["mint.money", "Spaceship", 40, true],
    ["north.capital", "Spaceship", 46, false],
    ["forge.dev", "Namecheap", 50, false],
    ["spark.trade", "Dynadot", 56, false],
    ["oxide.dev", "Namecheap", 58, true],
    ["goldrail.com", "Spaceship", 59, false],
  ];
  return rows.map(([domain, registrar, daysRemaining, autoRenewEnabled]) => ({
    id: domain, domain, registrar, daysRemaining, autoRenewEnabled, termYears: 1, selected: false, status: "due",
  }));
}

function expiresOn(daysRemaining: number): string {
  return new Date(Date.parse(`${mockReferenceDate}T00:00:00Z`) + daysRemaining * 86_400_000).toISOString().slice(0, 10);
}

function amount(value: number): string {
  return String(Math.round(value * 100) / 100);
}

const freshness = {
  source: "active_local" as const,
  serverRevision: 8241,
  lastReplicationActivityAt: "2026-08-20T06:02:00Z",
  lastSuccessfulProviderObservationAt: "2026-08-20T05:48:00Z",
  canEdit: true,
};

export function projectMockRenewals(rows: readonly MockRenewalRow[]): RenewalListView {
  const selected = rows.filter((row) => row.selected && row.status === "due");
  const view = renewalDeskViewModelSchema.parse({
    schemaVersion: 1,
    kind: "renewal_desk",
    state: "list",
    freshness,
    budget: { currency: "USD", amount: String(mockRenewalBudget) },
    items: rows.map((row) => ({
      id: row.id,
      domain: row.domain,
      registrar: row.registrar,
      expiresOn: expiresOn(row.daysRemaining),
      daysRemaining: row.daysRemaining,
      autoRenewEnabled: row.autoRenewEnabled,
      termYears: row.termYears,
      annualPrice: { currency: "USD", amount: amount(annualPrice(row.domain)) },
      selected: row.selected,
      status: row.status,
    })),
    selectedCount: selected.length,
    selectedTotal: { currency: "USD", amount: amount(selected.reduce((sum, row) => sum + annualPrice(row.domain) * row.termYears, 0)) },
  });
  if (view.state !== "list") throw new Error("mock renewal list projection is not a list");
  return view;
}

export function projectMockRenewalPlan(rows: readonly MockRenewalRow[]): RenewalPlanView {
  const selected = rows.filter((row) => row.selected && row.status === "due");
  const total = selected.reduce((sum, row) => sum + annualPrice(row.domain) * row.termYears, 0);
  const over = total > mockRenewalBudget;
  const view = renewalDeskViewModelSchema.parse({
    schemaVersion: 1,
    kind: "renewal_desk",
    state: "confirm",
    freshness,
    budget: { currency: "USD", amount: String(mockRenewalBudget) },
    items: selected.map((row) => ({ id: row.id, domain: row.domain, registrar: row.registrar, termYears: row.termYears, annualPrice: { currency: "USD", amount: amount(annualPrice(row.domain)) } })),
    confirmationCount: selected.length,
    total: { currency: "USD", amount: amount(total) },
    overBudgetBy: over ? { currency: "USD", amount: amount(total - mockRenewalBudget) } : null,
    budgetRemaining: over ? null : { currency: "USD", amount: amount(mockRenewalBudget - total) },
  });
  if (view.state !== "confirm") throw new Error("mock renewal plan projection is not a confirmation");
  return view;
}

export function mockRenewalQuotes(rows: readonly MockRenewalRow[]): readonly RenewalQuote[] {
  return rows.filter((row) => row.selected && row.status === "due").map((row) => ({
    itemId: row.id,
    domain: row.domain,
    registrar: row.registrar,
    termYears: row.termYears,
    amount: { currency: "USD", amount: amount(annualPrice(row.domain) * row.termYears) },
    validUntilLabel: "今日 14:32",
    state: "pending",
  }));
}
