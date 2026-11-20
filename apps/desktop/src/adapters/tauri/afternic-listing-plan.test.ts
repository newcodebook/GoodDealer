import { beforeEach, expect, it, vi } from "vitest";
import { afternicListingPlanPreviewRequestSchema, parseAfternicListingPlan, parseAfternicListingPlanStatus } from "@gooddealer/client-core";
import { createAfternicListingPlanPort } from "./afternic-listing-plan";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

const planRef = "a0000000-0000-4000-8000-000000000001";
const planHash = "a".repeat(64);
const createdAt = "2026-11-19T00:00:00Z";
const observedAt = "2026-11-19T00:02:00Z";
const review = { state: "preview", reason: null, claimedAt: null, retryAt: null, retryNotBefore: null, latest: null };
const intent = { schemaVersion: 2, connectionId: planRef, action: "reactivate_ownership_review", items: [{ domain: "wecin.com" }] } as const;
const draft = { schemaVersion: 2, planRef, planHash, action: intent.action, connectionLabel: "My market", createdAt,
  expiresAt: "2026-11-19T00:15:00Z", approvedAt: null, state: "awaiting_approval",
  items: [{ domain: "wecin.com", listingWrite: null, ownershipReview: review }] };
const status = { schemaVersion: 2, writeQualified: true, writeEntitled: true, executionAvailable: true,
  ownershipReviewQualified: true, ownershipReviewExecutionAvailable: true, controlledAcceptance: null, plans: [], detail: draft };

beforeEach(() => invoke.mockReset());

it("accepts only fixed review intents and rejects an alternate domain or extra data in the preview", async () => {
  for (const input of [
    { ...intent, items: [{ domain: "wecin.com", providerStatus: "OWNERSHIP_REVIEW" }] },
    { ...intent, items: [{ domain: "wecin.com", apiSecret: "secret" }] },
    { ...intent, items: [{ domain: "wecin.com" }, { domain: "wecin.com" }] },
    { ...intent, action: "update", items: [{ domain: "wecin.com", patch: { hidden: true }, ownershipReview: null }] },
    { ...intent, action: "update", items: [{ domain: "wecin.com", patch: { hidden: true }, ownershipReview: { mode: "anytime" } }] },
  ]) expect(afternicListingPlanPreviewRequestSchema.safeParse(input).success).toBe(false);
  const request = afternicListingPlanPreviewRequestSchema.parse(intent);
  invoke.mockResolvedValue(draft);
  expect(await createAfternicListingPlanPort().preview(request)).toEqual(draft);
  const [command, body] = invoke.mock.calls[0]!;
  expect(command).toBe("afternic_listing_plan_preview");
  expect(JSON.parse(new TextDecoder().decode(body))).toEqual(intent);
  invoke.mockResolvedValue({ ...draft, items: [{ ...draft.items[0], domain: "other.com" }] });
  await expect(createAfternicListingPlanPort().preview(request)).rejects.toThrow("does not match request");
});

it("requires a claim and a later authenticated observation to display confirmed", () => {
  const latest = { observedAt, providerStatus: "ACTIVE" };
  const completed = (facts: Record<string, unknown>) => ({ ...draft, approvedAt: createdAt, state: "completed",
    items: [{ ...draft.items[0], ownershipReview: { ...review, ...facts } }] });
  expect(parseAfternicListingPlan(completed({ state: "not_required", latest })).items[0]?.ownershipReview?.state).toBe("not_required");
  expect(parseAfternicListingPlan(completed({ state: "confirmed", latest, claimedAt: createdAt })).items[0]?.ownershipReview?.state).toBe("confirmed");
  for (const facts of [
    { state: "confirmed", latest }, { state: "confirmed", claimedAt: createdAt },
    { state: "confirmed", latest: { ...latest, providerStatus: "OWNERSHIP_REVIEW" }, claimedAt: createdAt },
    { state: "confirmed", latest, claimedAt: "2026-11-19T00:03:00Z" },
    { state: "not_required", latest, claimedAt: createdAt }, { state: "not_required", latest, requestSent: true },
  ]) expect(() => parseAfternicListingPlan(completed(facts))).toThrow("invalid Afternic listing plan");
});

it("retains legacy plan summaries and validates review counts against the selected plan", () => {
  const history = { planRef, connectionLabel: draft.connectionLabel, createdAt, state: draft.state, total: 1,
    applied: 0, conflicts: 0, pending: 1, pendingProvider: 0, pendingVerification: 0 };
  const legacy = { ...history, planRef: "a0000000-0000-4000-8000-000000000002", schemaVersion: 1, action: "create" };
  const current = { ...history, schemaVersion: 2, action: draft.action, ownershipReviewTotal: 1, ownershipReviewPending: 1,
    ownershipReviewConfirmed: 0, ownershipReviewNotRequired: 0, ownershipReviewConflicts: 0 };
  expect(parseAfternicListingPlanStatus({ ...status, plans: [legacy, current] }).plans.map(plan => plan.schemaVersion)).toEqual([1, 2]);
  expect(() => parseAfternicListingPlanStatus({ ...status, plans: [current, legacy] })).toThrow("invalid Afternic listing plan status");
  expect(() => parseAfternicListingPlanStatus({ ...status, plans: [legacy, { ...current, ownershipReviewPending: 0,
    ownershipReviewNotRequired: 1 }] })).toThrow("invalid Afternic listing plan status");
});

it("rejects mismatched approval and detail replies and a review qualification with controlled scope", async () => {
  const port = createAfternicListingPlanPort();
  invoke.mockResolvedValue(draft);
  await expect(port.approve({ schemaVersion: 2, planRef, planHash })).rejects.toThrow("does not match request");
  invoke.mockResolvedValue(status);
  await expect(port.status({ schemaVersion: 2, planRef: null })).rejects.toThrow("does not match request");
  await expect(port.status({ schemaVersion: 2, planRef })).resolves.toEqual(status);
  expect(() => parseAfternicListingPlanStatus({ ...status, writeEntitled: false })).toThrow("invalid Afternic listing plan status");
  expect(() => parseAfternicListingPlanStatus({ ...status, writeQualified: false,
    controlledAcceptance: { runId: "afternic-wecin-linux-20261119", domain: "wecin.com", connectionId: planRef, expiresAt: "2026-11-26T23:59:59Z" },
  })).toThrow("invalid Afternic listing plan status");
});
