# Account Web

## Role

Authenticated browser application for GoodDealer account access and commercial-management presentation.

## Owns

- Account Web browser composition, registration verification, password recovery, session-aware presentation, and secret-free billing recovery controllers.
- Same-origin account, checkout, cancellation, and refund interaction state.

## Touchpoints

- Consumes strict Cloud control-plane clients from `../../packages/cloud-client`.
- Delegates identity and commercial authority to `../cloud/src/modules/identity` and `../cloud/src/modules/licensing`.
- Uses shared presentation contracts from `../../packages/ui` and `../../packages/i18n`.

## Change Guide

- Change browser composition and recovery controllers under `src`; keep payment and identity facts server-owned.
- Update strict client contracts and negative tests with any browser-visible wire-shape change.
- Verify with this package's typecheck and test commands plus the relevant Cloud route tests.

## Purpose

Account Web is the authenticated browser owner of account and commercial-management presentation.
It consumes strict Cloud clients and never owns payment facts, card data, Entitlement projection,
Desktop business data, or local Provider credentials.

`src/index.ts` exports the strictly parsed `BillingClient` and storage-neutral recovery controllers.
`src/browser.ts` composes the deployed billing page with same-origin Cookie transport and browser-local,
secret-free request recovery. The static build is deployed at `https://account.gooddealer.com`; its `/v1/*`
and `/billing/approval/*` paths are reverse-proxied to the GoodDealer Cloud on the same VPS. Stripe test-mode
catalog objects, return origins and webhook verification are configured in the shared development environment.
The source shell composes same-origin registration, email verification and resend, password login and reset,
session discovery, and server-revoking logout through the independent Identity ingress. Every successful
Identity response is strictly parsed before presentation. The staging deployment uses the fail-closed Resend
adapter with `account@gooddealer.com`; a test user without database or development-tool access completed the
real registration, email verification, login, refresh recovery, and logout journey. Production email delivery
and public-signup qualification remain separate.
Launch exposes Stripe only; the optional PayPal adapter is not a launch or
production-qualification dependency. Live-mode merchants, tax-qualified sales regions and production
qualification remain unavailable.

## Principles

- MUST: Derive the GoodDealer account from the authenticated server session; browser requests cannot submit an account id.
- MUST: Send passwords and verification codes only to the same-origin Identity ingress; never persist them in browser storage or include them in shared protocol types.
- MUST: Treat verification as account activation, then require an explicit password login; logout must revoke the server session before the UI claims completion and must clear browser-side account authority.
- MUST: Strictly parse every successful Identity response; status codes or optimistic UI state cannot create authentication facts.
- MUST: Display only Providers present in the server-controlled launch catalog; launch exposes Stripe only, while the optional PayPal adapter remains hidden and fail-closed when unconfigured. One account has one `CommercialProviderSlot`, which remains occupied through pending, outcome-unknown, paid-through, and provider-termination-unknown states even when commercial rights are read-only.
- MUST: Offer the same features through USD 9.80 monthly, USD 98 annual, and USD 498 prepaid 10-year terms.
- MUST: Navigate only to the same-origin GoodDealer `/billing/approval/:handle` endpoint. Account Web never receives, logs, or persists a Provider URL; the server-only redirect responder resolves the Provider destination.
- MUST: Persist the secret-free checkout request identity before Provider creation, recover a pending checkout only with the same GoodDealer checkout/request identity whether creation is outcome-unknown or Provider approval is pending, and require a new request ID only after the exact non-retryable `COMMERCIAL_CHECKOUT_REJECTED` protocol result.
- MUST: Partition checkout and refund browser custody by the server-returned opaque account namespace; never read or write recovery custody before an authenticated namespace is established, and retain each account's namespace across session replacement.
- MUST: Persist the exact GoodDealer cancellation request ID before cancellation dispatch and replay only that identity across timeout or refresh. Fixed-term capture also carries an independently correlated GoodDealer request ID.
- MUST: Render cancellation pending and outcome-unknown separately from Provider-confirmed `cancel_at_period_end`; every such state retains paid-through access and occupies the account's payment slot.
- MUST: Show no free-trial claim; the account-lifetime first settled acquisition has one 336-hour full-refund window, and renewal never moves or recreates it.
- MUST: Use the server-returned opaque `purchaseId` only to correlate the first-purchase refund request; it is not a Provider payment identity and never authorizes a direct Provider call from the browser.
- MUST: Persist exact refund `{ requestId, purchaseId }` custody before submission, retain the GoodDealer `refundRequestId` after acceptance, and recover by that identity. Every accepted state is immediately read-only; only `retry_wait` may render retryability and a retry time, while all other accepted states expose `retryable: false` and no retry schedule. Unknown, retry-wait, and manual-resolution states must never be rendered as refunded. Only deterministic rejection permits a new request ID.
- MUST: Keep every checkout action disabled until one authoritative recovery read proves the account has no purchase, hide an elapsed refund window using the browser's current time, and fence overlapping initialization runs so an older response cannot overwrite a newer authenticated session.
- MUST: Retry due `retry_wait` with the exact stored refund request identity only after the server-returned `retryAfter` is due, and poll accepted or temporarily unreadable refund status for at most 120 seconds at three-second intervals; an early action remains disabled, terminal completion, manual resolution, or custody cleared by another same-origin tab stops polling and refreshes authoritative billing state. Only the worker owns retry scheduling.

## Boundaries

- Does NOT handle: Payment capture, Subscription or Order reconciliation, Entitlement projection, refund execution, or provider webhook processing. (see: `../cloud/src/modules/licensing`)
- Does NOT handle: Card, payer, provider credential, Webhook secret, or OpenBao secret custody. (see: `../cloud/src/entrypoints/commercial-providers.ts`)
- Does NOT handle: Tax registration, tax calculation policy, or qualification of countries where checkout may be enabled. (see: `../cloud/src/modules/licensing/README.md`)

## Adversarial Surfaces

- **Account or price substitution**: the browser contract can select only provider, offer, request id, and campaign code. Verified by: `../cloud/test/entrypoints/billing-route.test.ts`.
- **Malformed Cloud response**: every billing response is parsed before Account Web can render it. Verified by: `../../packages/cloud-client/test/control-and-recovery-clients.test.ts`.
- **Lost checkout response or page refresh**: the recovery controller correlates purpose-specific browser custody with authoritative pending status before replaying the same idempotent request. Verified by: `test/billing-recovery-controller.test.ts`.
- **Approval capability leakage**: checkout responses and browser storage contain only a short-lived GoodDealer handle; navigation is constrained to the derived same-origin path. Provider URL/resource/payment/customer fields fail strict parsing. Verified by: `test/billing-recovery-controller.test.ts` and `../../packages/protocol/test/billing.test.ts`.
- **Cancellation replay substitution**: cancellation request identity is persisted before transport, compared with authoritative status, and retained through pending/unknown outcomes. Verified by: `test/billing-recovery-controller.test.ts`.
- **Refund replay or completion substitution**: refund request and purchase identity remain in browser custody, status must correlate both GoodDealer refund and purchase IDs, and custody clears only after a strictly parsed `refunded` completion. Verified by: `test/billing-recovery-controller.test.ts`.
- **Login CSRF and session fixation**: Identity POST routes require the exact approved HTTPS Origin; successful login revokes a valid presented session before issuing a fresh secure, HttpOnly, host-only session. Verified by: `../cloud/test/entrypoints/identity-http.test.ts` and `../cloud/test/postgres/account-access.test.ts`.
- **Logout and recovery replay**: logout is server-revoking and idempotent; registration and reset challenges have separate digests, expiry, attempt budgets, resend cooldowns, and single-use CAS. Verified by: `test/account-access-surface.test.ts` and `../cloud/test/postgres/account-access.test.ts`.
- **Credential persistence**: Account Web never writes passwords or verification codes to browser storage. Verified by: `src/browser.ts` and `../cloud/test/account-access.test.ts`.

## Open Questions

- [ ] Which Stripe production activation inputs and tax-qualified sales regions will be approved before Account checkout accepts real customer payments? (open since: 2026-09)
- [ ] Which production transactional-email provider, verified sending domain, abuse budgets, and delivery monitoring will qualify public signup? (open since: 2026-09)
