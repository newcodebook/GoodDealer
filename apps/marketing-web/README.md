# @gooddealer/marketing-web

## Role

Static public marketing site for presentation-only GoodDealer product and locale content.

## Owns

- Astro static-site composition and typed marketing locale content.
- Presentation-only navigation and calls-to-action whose destinations remain externally qualified.

## Touchpoints

- Imports supported tokens and assets through `../../packages/ui` exports.
- Uses repository release and verification evidence without owning deployment authority.
- Hands off account, payment, installer, and product actions only to approved external destinations.

## Change Guide

- Change static pages and locale content inside this application; keep business and account state out.
- Treat brand material as design reference and shared UI as the production presentation boundary.
- Verify package typecheck, static build, and marketing workflow policy checks after changes.

## Purpose

The marketing web package owns a static Astro site and its presentation-only locale content. It is
not an account application, a business API, or evidence that a public deployment is live.

## Principles

- MUST: Prerender the site as static output and keep client-side behavior presentation-only.
- MUST: Import shared UI tokens and assets through `@gooddealer/ui` exports.
- MUST: Keep locale data typed and separate from Astro presentation components.
- MUST: Treat account, installer, payment, and product calls to action as future external handoffs, not evidence that their destinations are available.
- MUST: Keep runtime imports from `brand/` out of production source.

## Boundaries

- Does NOT handle: Authentication, account sessions, payments, commercial authorization, or customer data. (see: src)
- Does NOT handle: Server-side business routes or dynamic application state. (see: astro.config.mjs)
- Does NOT handle: Deployment authority, provider credentials, release issuance, or Gate closure. (see: ../../docs/VERIFICATION.md)
- Does NOT handle: Generic UI ownership. (see: ../../packages/ui/README.md)

## Adversarial Surfaces

- **Static-origin boundary**: Production source has only declared static asset and handoff origins. Verified by: `../../scripts/marketing-web-workflow-policy.test.mjs`.
- **Design-reference isolation**: Brand material is a reference, not a production runtime import. Verified by: repository boundary checks.
- **Deployment claim laundering**: Workflow configuration cannot be treated as an observed external deployment. Verified by: review of workflow evidence and external provider records.

## Open Questions

- [ ] Which account, installer, payment, or product handoff destination is approved for the public site? (open since: 2026-08)

## Current surface

`astro.config.mjs` uses static output. The repository workflow describes a constrained build and
potential upload step for a main-branch event, but source configuration and a successful local
build do not establish external project identity, credentials, serving state, approval, or deployment.

The current site is therefore a static repository surface. Conversion and download destinations
must remain visibly unavailable or externally supplied until the corresponding product and release
decisions exist.

An observed public deployment would additionally require all of the following external conditions:

- GitHub protected-main/review rules
- environment protection/approval
- Cloudflare project identity
- artifact acceptance and serving
- rollback, monitoring, and incident response

None of those conditions is established by this repository or its workflow configuration.

## Verification

```sh
pnpm --filter @gooddealer/marketing-web typecheck
pnpm --filter @gooddealer/marketing-web build
```

Passing these commands verifies a static repository build only.
