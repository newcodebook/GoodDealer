# @gooddealer/cloud-client

## Role

Strict client adapters for GoodDealer Cloud control-plane, synchronization, and sanitized recovery APIs.

## Owns

- Account activation, billing, Desktop authorization, workspace sync, and replica-recovery client contracts.
- Exact response parsing, request correlation, and secret-field rejection at Cloud client boundaries.

## Touchpoints

- Consumes public schemas from protocol packages and fixed-origin transport supplied by applications.
- Is composed by Account Web and native Desktop code for their purpose-specific Cloud interactions.
- Returns recovery input to local-storage without becoming a Desktop business repository.

## Change Guide

- Change a client only with its protocol and server route contract; retain strict correlation and unknown-key rejection.
- Keep URLs, headers, credentials, tenant selectors, and Provider identities outside public client state.
- Verify package typecheck/tests plus the matching protocol and Cloud route tests.

## Purpose

This package exposes strictly parsed Cloud control-plane and sync-recovery clients. It does not
provide a Desktop business Repository. Normal Desktop Query and Command paths use local SQLCipher.

## Principles

- MUST: Expose Cloud account/control, secret-free sync, and sanitized recovery transport only through strict contracts.
- MUST: Keep transport asynchronous to Desktop business commits and subordinate to local SQLCipher authority.
- MUST: Reject caller-selected tenant scope, arbitrary price IDs, and all third-party platform identity, credential, and secret fields; Billing accepts only the closed Provider selector and commercial offer identifiers, while the server-controlled catalog decides which Providers are enabled.
- MUST: Preserve truthful billing uncertainty: checkout creation unknown and Provider approval pending are recoverable only with the exact GoodDealer checkout/request identity; confirmed pending recovery obtains a fresh GoodDealer redirect handle for the same Provider resource and never creates another resource.
- MUST: Keep Provider URLs and resource/payment/customer identities out of public JSON and client state. Approval navigation uses only the relative GoodDealer `/billing/approval/:handle` endpoint.
- MUST: Persist and correlate exact GoodDealer request IDs for cancellation and fixed-term capture; cancellation pending or unknown never claims confirmed nonrenewal.
- MUST: Submit first-purchase refunds with only `{ requestId, purchaseId }`, correlate accepted results by GoodDealer purchase/refund identities, and recover by `refundRequestId`. Only `retry_wait` is retryable and carries a retry timestamp; every other accepted state has `retryable: false` and `retryAfter: null`. Accepted unknown and manual-resolution states remain read-only and never mean refunded.
- MUST: Billing status exposes the opaque GoodDealer `purchaseId` for settled refundable states so Account Web can initiate the refund without receiving Provider payment or customer identities.
- MUST: Treat an absent or empty replica response as no recovery input, never as deletion authority.

## Boundaries

- Does NOT handle: Caller-selected account or workspace scope; the authenticated Cloud session derives it. (see: `src/index.ts`)
- Does NOT handle: URL, header, credential, Provider, database, or authorization authority. (see: `src/index.ts`)
- Does NOT handle: Desktop business reads, writes, local commit authority, or lease signature verification. (see: `../client-core`)

## Adversarial Surfaces

- **Tenant or checkout-response substitution**: Client inputs cannot select account or workspace scope, and a checkout response must echo the exact request, Provider, and offer before Account Web can redirect. Verified by: `test/control-and-recovery-clients.test.ts`.
- **Replica-as-authority substitution**: Recovery input remains strict, sanitized, and invisible until merged into local SQLCipher. Verified by: `test/control-and-recovery-clients.test.ts`.
- **Provider handoff or secret injection**: Provider identities, approval URLs, payer/card data, credentials, connection IDs, headers, and secret-like fields are recursively rejected. Only a short-lived opaque GoodDealer approval handle is accepted. Verified by: `test/control-and-recovery-clients.test.ts` and the protocol negative corpus.

## Current API

- `AccountActivationClient.activate()` invokes the account control plane.
- `BillingClient` creates an allowlisted hosted checkout, reads the current commercial state, recovers
  `creation_unknown` and `approval_pending` with the exact same GoodDealer request and checkout identity,
  and derives only `/billing/approval/:handle` for same-origin navigation. A confirmed replay returns a
  fresh handle for the same bound resource; the client never receives or persists the Provider URL.
  Fixed-term capture and cancellation correlate exact GoodDealer request IDs. Cancellation may remain
  `cancellation_pending` or `cancellation_unknown`; only `cancel_at_period_end` means the Provider has
  confirmed nonrenewal. These states retain paid-through access and block a replacement purchase.
  First-purchase refund POST and status results are strict closed unions; deterministic eligibility
  rejection is separate from an accepted refund aggregate, and only `refunded` means completion.
  The client cannot submit an account id, Provider resource id, price, amount, or subscription id.
- `DesktopAuthorizationClient.issue()` fetches a strictly parsed personal-default-workspace grant.
  Host must still verify the outer Grant v3 signature, embedded ActiveDeviceLease signature and Host binding.
- `WorkspaceSyncClient.push()` sends tenant-neutral mutations and correlates every ACK.
- `WorkspaceSyncClient.pull()` and `.readCheckpoint()` consume cursor/checkpoint progress only.
- `DomainAssetReplicaRecoveryClient.read()` reads a sanitized Cloud replica only as recovery input.
  The caller must validate and merge that input into local SQLCipher before local Query can see it.

The Tauri Native runtime composes the authenticated fixed-origin control and sync transport. Renderer
state receives only sanitized status and local presentation models; it does not own access/refresh tokens,
Grant material, tenant scope, Cloud URLs, or a generic Cloud client.

There is intentionally no Cloud Portfolio query client and no Cloudflare observation submit/read
client. Provider execution and Provider-account identity stay on the local Secure Host; only
allowlisted, secret-free business mutations may reach the Cloud sync plane.

Operation ids, public schemas, Cloud/Desktop consumption points, rejection behavior, and prohibitions
are frozen in [the first-slice shared contract](../../docs/FIRST_SLICE_SHARED_CONTRACT.md).

## Verification

```sh
pnpm --filter @gooddealer/cloud-client typecheck
pnpm --filter @gooddealer/cloud-client test
```
