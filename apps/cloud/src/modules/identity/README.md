# Cloud Identity

## Role

Cloud identity capability for GoodDealer credentials, verification challenges, sessions, and security epochs.

## Owns

- Account credential verification, email-verification state, and Account Web and Desktop session families.
- Security epochs, encrypted email custody, and transaction-capability issuance.

## Touchpoints

- Supplies verified principals and capability transactions to public Cloud business modules.
- Composes HTTP and email delivery only through `../../entrypoints` adapters.
- Creates the personal default workspace through the workspace ownership boundary.

## Change Guide

- Change credential and session policy inside this module without exporting secret-bearing wire types.
- Keep browser rendering, Cookie transport, and production email-provider composition outside the domain boundary.
- Verify account-access, PostgreSQL persistence, Identity HTTP, and email-delivery tests after changes.

## Purpose

Identity owns GoodDealer account credentials, email-verification challenges, Account Web and Desktop
session families, security epochs, and transaction-capability issuance. Public business modules consume
verified principals; they do not inspect passwords, verification codes, cookies, or credential tables.

## Principles

- MUST: Keep password and verification-code wire data inside the independent Identity ingress and out of shared protocol packages.
- MUST: Consume password candidates once and zero the owned byte copy. Unknown, unverified, malformed-hash, and wrong-password login paths all run the policy-matching Argon2id verifier and expose one rejection identity.
- MUST: Persist only a server-peppered digest, expiry, resend cooldown, attempt budget, and consumed timestamp for a verification challenge.
- MUST: Atomically create the personal default Workspace, default-owner binding, initial revision, and account/device security state before issuing a Web session.
- MUST: Persist durable email records only as AES-256-GCM envelopes. Only the Identity worker claim function may scan pending envelopes; development SMTP is loopback-only and production delivery remains unconfigured until qualified.
- MUST: Revalidate session expiry, family state, and Account Security Epoch on every Account Web request. Cookie possession cannot select another account.
- MUST: Derive the browser recovery-custody namespace from the verified account using a dedicated 256-bit server key and domain-separated HMAC; expose only that opaque namespace, never email or internal account identifiers.

## Boundaries

- Does NOT handle: Account Web rendering, browser storage, or Cookie transport composition. (see: `../../../../account-web` and `../../entrypoints/identity-http.ts`)
- Does NOT handle: Commercial checkout, Provider reconciliation, Entitlement projection, or payment credentials. (see: `../licensing`)
- Does NOT handle: Production transactional-email transport, public-registration qualification, password recovery, or Passkey enrollment. (see: `../../../../../docs/adr/0022-account-identity-and-email-delivery.md`)

## Adversarial Surfaces

- **Account enumeration and timing**: Login always performs one policy-matching Argon2id operation and returns a common rejection. Verified by: `../../../test/account-access.test.ts` and `../../../test/postgres/account-access.test.ts`.
- **Credential persistence and challenge replay**: Only password hashes, challenge digests, and encrypted outbox envelopes persist; challenges expire, cap attempts, and consume once. Verified by: `../../../test/account-access.test.ts` and `../../../test/postgres/account-access.test.ts`.
- **Login CSRF and session fixation**: Identity POST routes require the exact approved HTTPS Origin and successful authentication issues a fresh host-only secure Cookie. Verified by: `../../../test/entrypoints/identity-http.test.ts`.
- **SMTP exfiltration and header injection**: The development adapter rejects non-loopback hosts, invalid mailboxes, control characters, and oversized messages. Verified by: `../../../test/email-delivery.test.ts`.

## Contracts

- **IdentityAccountAccessRepository** (defined in: account-access.ts): Persists registration challenges, encrypted email custody, verification transitions, and fresh Web sessions. Consumers: `postgres-account-access.ts`.
- **EmailDeliveryPort** (defined in: email-delivery.ts): Delivers one validated Identity email without exposing transport choice to the domain service. Consumers: `account-access.ts`.
- **PasswordHashPort** (defined in: password-hash-port.ts): Performs fixed-policy credential checks over consume-once candidates. Consumers: `account-access.ts`, `login-command.ts`.

## Open Questions

- [ ] Which production transactional-email provider, verified sending domain, abuse budgets, and delivery monitoring will qualify public signup? (open since: 2026-09)
