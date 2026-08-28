# @gooddealer/i18n

## Purpose

This package owns typed `zh-CN` and `en-US` copy plus deterministic `Intl` date, number, and money
formatting. It is presentation infrastructure: copy can describe future product states, but it
cannot make those states available or authoritative.

## Principles

- MUST: Keep supported locale dictionaries structurally aligned and expose only the package root.
- MUST: Keep formatting deterministic: dates default to UTC, money requires an explicit ISO currency, and invalid values fail closed.
- MUST: Keep copy separate from rendering, routing, authorization, network access, secrets, and business state.
- MUST: Treat brand references as design input only; production source does not import `brand/`.
- MUST: Not make a copy key, fixture phrase, or presentation name evidence of product composition.

## Boundaries

- Does NOT handle: React rendering, Tauri, Cloud transport, storage, authorization, or feature execution. (see: src/index.ts)
- Does NOT handle: Commercial decisions, provider status, customer data, or secret values. (see: src/index.ts)
- Does NOT handle: Browser automation, backup recovery, or account composition; it may only carry non-authoritative text for future presentation models. (see: src/copy.ts)

## Adversarial Surfaces

- **Availability laundering**: A localized phrase or copy key cannot assert that a capability, provider, account state, or external result is available. Verified by: `src/copy.test.ts`.
- **Fallback ambiguity**: Unknown locale and formatting inputs are rejected rather than silently selecting unrelated text or presentation. Verified by: `src/formatters.test.ts`.

## Contracts

- **Locale** (defined in: src/copy-types.ts): closed `zh-CN | en-US` locale set. Consumers: src/copy.ts, src/formatters.ts.
- **DesktopCopy** (defined in: src/copy.ts): localized visual-copy contract. Consumers: src/index.ts, src/copy.test.ts.
- **CapabilityCopy** (defined in: src/copy.ts): non-authoritative copy grouped by future capability context. Consumers: src/index.ts, src/copy.test.ts.

## Open Questions

- [ ] Which owning product and application modules will compose any future capability whose availability wording is carried here? (open since: 2026-08)

## Current API

Consumers import copy accessors, parsers, locale types, and formatters from `@gooddealer/i18n`.
Supported locale and presentation values are closed; unknown values are rejected instead of falling
back to unrelated text.

## Verification

```sh
pnpm --filter @gooddealer/i18n typecheck
pnpm --filter @gooddealer/i18n test
```
