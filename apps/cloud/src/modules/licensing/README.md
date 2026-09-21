# Cloud Licensing

## Role

Cloud commercial capability that reconciles provider payment facts into account-scoped commercial rights.

## Owns

- CommercialProviderSlot exclusivity, ProviderOperation lifecycle, and immutable payment evidence.
- CommercialAuthority, rights, entitlement projection, cancellation, refund, reconciliation, and release policy.

## Touchpoints

- Consumes provider execution and webhook evidence through narrow Cloud entrypoint adapters.
- Supplies commercial deadlines and authority to Devices and other authenticated Cloud capabilities.
- Exposes strict public billing behavior through protocol-owned schemas and Cloud routes.

## Change Guide

- Change commercial state machines and persistence together; retain exact slot, generation, revision, and resource fences.
- Keep Provider credentials, SDK transport, payer data, and approval URLs in server-only entrypoints.
- Verify lifecycle regression, persistence, provider, webhook, route, and protocol tests for every policy change.

## Purpose

Licensing owns provider-payment exclusivity and commercial rights for an account. It keeps those
decisions separate: `CommercialProviderSlot` prevents simultaneous or ambiguous provider
acquisitions, while `CommercialAuthority` is the sole switch that grants a `CommercialRight` and
advances the derived account Entitlement projection.

## Principles

- MUST: Keep exactly one account-scoped Provider slot; every acquisition, holder transfer, release decision, and current-operation change creates an immutable, monotonically increasing slot version.
- MUST: Allow a Provider network call or new result write only while the exact child `ProviderOperation` remains the slot's current operation at lease, permit issue, permit consume, and result recording; result recording additionally proves the consumed permit is the latest dispatch revision for that operation. Ownership and holder identity are locked and revalidated at each gate. An equal replay of the latest recorded permit is read-only, conflicting evidence for that permit quarantines its work, and a permit superseded by a newer dispatch cannot write or quarantine. Stable Provider idempotency identity belongs to the operation, not the permit, and no database transaction spans Provider I/O.
- MUST: Model PayPal Order creation and capture as distinct operations; capture planning resolves the exact immutable Order binding, creates O2, and advances the slot epoch before a capture permit can commit, making every O1 permit stale.
- MUST: Keep Provider event receipt global and account-blind; the first authenticated digest is immutable, conflicting reuse quarantines the identity, and account scope derives only from a server-created globally unique `ProviderBinding`.
- MUST: Put `account_id` in every account relationship composite key and allow runtime code to mutate `licensing_private` only through narrow `SECURITY DEFINER` capabilities that validate transaction scope and exact epoch, generation, and revision fences.
- MUST: Apply a trusted Provider fact atomically by inserting an immutable right, advancing the authority, deriving the public projection, inserting one outbox record, and completing the reconciliation generation; any stale generation, slot epoch, agreement, or authority revision changes none of them.
- MUST: Never release a renewable Provider slot merely because rights were revoked; exact current-resource termination or nonrenewal and protected paid-through policy are separate release predicates.
- MUST: Bind initial payment, refund, reversal, and dispute resources through an exact immutable Provider resource chain; a reversal receipt may reuse an existing exact payment or capture link without inventing a second role, while an independent refund resource receives its own evidence link. First-payment facts are immutable, while cumulative refund progress advances only in its monotonic head.
- MUST: Treat first paid purchase eligibility as an account-lifetime singleton; accepting an in-window refund atomically creates an irreversible non-granting fence for that Provider agreement before durable termination/refund work can reach a Provider. No later fact can restore that agreement, while a separately released and reacquired agreement may grant normally without creating another refund window.
- MUST: Open the one lifetime refund window for exactly 336 hours from the first settled acquisition; renewal evidence cannot replace its payment identity or move either boundary.
- MUST: Expose `refundEligibleUntil` only while the database clock is strictly before the stored window end; an expired eligibility row remains durable history, not a currently actionable public offer.
- MUST: Return refund acceptance or a closed business rejection from the same database-clock, row-locked command; serialize refund commands and Provider results with the same account-scoped transaction advisory lock before either path takes mutable row locks. Confirm Subscription termination before planning its exact initial-payment refund. Deterministic Provider rejection is non-retryable manual resolution, transient uncertainty has a bounded due retry, all accepted outcomes stay read-only, renewable release waits for protected paid-through, and fixed-term early release requires exact full settlement of the immutable `acquisition_initial` payment rather than a renewal or adjustment.
- MUST: Persist an agreement, payment, Provider, and trigger-resource-scoped refund evidence head for every authenticated pending, partial, dispute, fraud, or otherwise ambiguous refund/reversal fact. Any blocking head is non-granting; `none`, missing payment context, a different payment, and a different refund/dispute/reversal trigger lineage cannot clear it. Only an actionable `refund_failed` observation for the exact same payment and Provider trigger resolves that temporary block; exact full settlement for the same lineage is permanently non-granting.
- MUST: Converge every still-blocking refund evidence head through a fresh delayed reconciliation generation, never by replaying an applied generation; the child preserves the blocking head's original authenticated receipt context even when a newer unrelated receipt supersedes the resource cursor. Each child inherits parent lineage and the original bounded attempt/age budget, and exhaustion dead-letters the final node while retaining the head, slot, and non-granting Authority.
- MUST: Decide release from durable aggregate evidence under the account slot lock. Any blocking refund head, unfinished accepted refund request/current refund operation or work, or unresolved cancellation intent/current cancellation operation or work retains renewable and fixed-term slots across paid-through or expiry. `refund_succeeded` becomes durable acquisition settlement only when monotonic refunded progress equals gross; authenticated `full_reversal_settled` is distinct exact acquisition reversal evidence and does not require refund progress. A matching terminal renewal or adjustment resolves only its own lineage and cannot release the agreement. Fixed-term release reads these durable heads rather than the replaceable current observation, while renewable release still requires termination/nonrenewal and protected paid-through. Business-blocked release work uses a long retry wait without consuming execution-failure attempts; exact settlement, matching terminal evidence, or confirmed cancellation wakes it, and creates a fresh release job when only an old dead-letter remains.
- MUST: Normalize an exact-current leased operation from `permit_issued` or `dispatch_consumed` to durable `outcome_unknown` before retrying or dead-lettering worker failure, advancing its operation revision atomically under the account advisory and slot locks. A stale lease or token cannot advance operation state; due retry work and redriven dead-letter children obtain a fresh permit while retaining stable Provider idempotency identity.
- MUST: When refund termination or refund work is quarantined or exhausts into dead-letter, atomically expose the linked accepted refund request as non-retryable `manual_resolution` with no retry deadline; its accepted read-only fence and slot-release block remain intact, while a controlled dead-letter redrive may still converge the same operation.
- MUST: Read Provider truth before re-dispatching an `outcome_unknown` mutation. A recovery miss is not a terminal fact: obtain and consume a fresh database permit, then retry the same logical mutation with its unchanged Provider idempotency key so a request that never arrived can still converge without duplicating one that did.
- MUST: Persist the catalog-resolved gross amount and currency on every purchase attempt. Initial acquisition payment evidence must match those immutable values exactly, and resumed creation work must match the canonical checkout digest (including discount identity) before any Provider I/O.
- MUST: Before creating a PayPal Subscription, read and validate the exact active Plan against the catalog amount and offer frequency. Before exposing approval, validate the created Subscription's immutable Plan snapshot and GoodDealer correlation identity, rejecting trials, fees, shipping, quantity, taxes, and plan overrides; recovery applies the same snapshot gate.
- MUST: Keep refund execution and retry scheduling worker-owned. Fresh refund or termination work starts `ready` without an Account lease or token, and an account replay is read-only and cannot acquire or renew Provider work. A refund operation in `retry_wait` is leaseable only when both its work deadline and authoritative refund-request `retry_at` are due by the database transaction clock.
- MUST: Redrive dead-letter work only by creating a fresh leased child with an audit reason and parent lineage; quarantined and dead-letter parents are immutable. Release considers only unresolved leaf work in that lineage: an unredriven dead leaf remains blocking, while a successful child or grandchild supersedes its immutable ancestors for liveness without deleting their audit evidence.

## Boundaries

- Does NOT handle: Provider SDK authentication, HTTP transport, credentials, approval URLs, payer details, or payment methods. (see: `../../entrypoints/commercial-providers.ts`)
- Does NOT handle: Public billing wire schemas or client presentation. (see: `../../../../../packages/protocol/src/account/billing.ts`)
- Does NOT handle: Device Lease issuance or Desktop authorization. (see: `../devices`)
- Does NOT handle: Tax qualification or support refund approval. (see: `../../../../../docs/LICENSING.md`)

## Adversarial Surfaces

- **Tenant substitution**: Provider metadata and caller identifiers cannot select an account; only the immutable global Provider binding can establish scope. Verified by: `../../../test/postgres/licensing-persistence.test.ts`.
- **Stale Provider observation**: generation, binding, slot epoch, agreement, and authority revision fences prevent reverse-completion and superseded-resource application. Verified by: `../../../test/postgres/licensing-persistence.test.ts`.
- **Duplicate or conflicting webhook**: authenticated inbox identity and digest are immutable, byte-identical Provider retries are acknowledged without duplicate work, and conflicting reuse is quarantined before reconciliation. Stripe and PayPal production authenticators are exercised with provider-compatible local signatures and no Provider network. Verified by: `../../../test/payment-webhook-verifier-fixture.test.ts`, `../../../test/payment-webhook-service.test.ts`, and `../../../test/postgres/licensing-persistence.test.ts`.
- **Provider side-effect replay**: an exact current operation requires a fresh one-use permit while retaining stable Provider idempotency identity. Verified by: `../../../test/commercial-purchase-persistence.test.ts` and `../../../test/commercial-checkout-providers.test.ts`.
- **Superseded operation dispatch**: cancellation, refund termination, capture, and other operation replacement immediately fence older work and already-issued permits because consume rechecks the exact current slot operation. Verified by: `../../../test/postgres/licensing-lifecycle-regressions.test.ts`.
- **Refund/release substitution**: exact payment bindings, full same-currency facts, and purchase-kind-specific release predicates prevent partial or ambiguous reversal facts from vacating the slot. Verified by: `../../../test/postgres/licensing-lifecycle-regressions.test.ts`.
- **Payment amount substitution**: immutable attempt pricing and canonical checkout identity reject a changed amount, currency, or discount during initial payment observation or crash recovery. Verified by: `../../../test/provider-operation-recovery.test.ts` and `../../../test/postgres/licensing-lifecycle-regressions.test.ts`.
- **Refund completion laundering**: accepted termination/refund unknown, retry-wait, and manual-resolution states remain read-only and cannot become `refunded` without exact current Provider evidence. Verified by: `../../../test/postgres/licensing-lifecycle-regressions.test.ts`, `../../../test/entrypoints/billing-route.test.ts`, and `../../../../../packages/protocol/test/billing.test.ts`.
- **Late result after settlement**: a consumed permit and leased work keep release blocked until the exact-current result terminalizes; the late result cannot downgrade a `refunded` request, create a new Subscription refund child, or mutate a replacement slot. Verified by: `../../../test/postgres/licensing-lifecycle-regressions.test.ts`.
- **Pending fact abandonment**: pending/dispute/fraud observations schedule a new-generation exact-resource reread with full CAS and a shared retry budget; settled facts stop polling, while exhaustion is durable and does not release or regrant. Verified by: `../../../test/postgres/licensing-lifecycle-regressions.test.ts`.
- **Dead-letter mutation**: terminal parents reject updates and deletes; controlled redrive preserves logical operation identity in a fresh child capability. Verified by: `../../../test/postgres/licensing-lifecycle-regressions.test.ts`.
- **PayPal Order substitution**: fixed-term Order creation, recovery, approval redirect, and capture require the immutable purchase-attempt identity, exact USD amount, CAPTURE intent, one purchase unit, and no shipping/breakdown/override fields. Verified by: `../../../test/commercial-checkout-providers.test.ts`.

## Contracts

- **CommercialAggregateRepositoryPort** (defined in: commercial-domain.ts): Narrow operation, inbox, binding, reconciliation, authority, and billing-status persistence boundary. Consumers: `commercial-checkout.ts`, `payment-webhook-service.ts`, `postgres-commercial-repository.ts`.
- **CommercialEntitlementRepository** (defined in: postgres-repository.ts): Read adapter for the derived Entitlement projection used by device activation. Consumers: `../devices/postgres-bootstrap-activation.ts`, `../devices/postgres-desktop-login-lease.ts`.

## Open Questions

- [ ] Which Stripe production activation inputs, return origins, and tax-qualified sales regions will be approved before real customer payments are enabled? PayPal is optional and does not block launch. (open since: 2026-09)
- [ ] Which production hosts, failover topology, monitoring and workload credentials will qualify the self-managed scheduler and worker? (open since: 2026-09)
