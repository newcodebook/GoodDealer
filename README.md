# GoodDealer

## Purpose

GoodDealer is a local-first Desktop domain-asset product. Cloud owns account, subscription,
entitlement, device, and lease authorization; local SQLCipher owns all Desktop business data and
transactions. Cloud business persistence is a sanitized sync/recovery replica, never the normal
Desktop Repository. The repository is not yet a deployed product, qualified provider integration,
signed native release, or closed Gate.

The concise capability map and dependencies live in the [roadmap](docs/ROADMAP.md); detailed local
acceptance and external-evidence rules live in [verification](docs/VERIFICATION.md). Those documents
are linked rather than duplicated here.

## Principles

- MUST: Keep each business capability in its owning runtime and trust domain, and compose it at an explicit application boundary only after its **local implementation gates** are met.
- MUST: Validate untrusted data from `unknown`, derive tenant scope server-side, keep secrets out of ordinary application state, and fail closed at every authorization and external-effect boundary.
- MUST: Treat source, contracts, tests, configuration, and current documentation as one repository truth; fixtures, visual material, local reports, and tests do not establish external facts.
- MUST: Commit business rows and secret-free Sync Outbox entries atomically in local SQLCipher; Cloud availability and ACK cannot decide local business commits.
- MUST NOT: Sync third-party account identity, Provider Account ID, account labels, credential bindings, API keys, tokens, cookies, passwords, 2FA, or browser profiles.
- MUST NOT: Add browser, writes, marketplace/registrar behavior, team/multi-workspace behavior, credential migration, CSV import, external mutations, or any compatibility/transition/fallback route to v1.

## Boundaries

- Does NOT handle: Hosted PostgreSQL operation, production KMS/HSM signer custody, deployment, real Cloudflare execution, native signing/notarization, durable archival, independent review, release issuance, or Gate closure. (see: docs/VERIFICATION.md)
- Does NOT handle: Treating local source, fixtures, tests, visual evidence, generated reports, or a decision document as proof of an external qualification. (see: docs/VERIFICATION.md)
- Does NOT handle: Treating uncomposed feature or visual-fixture source as a supported product path. (see: docs/ENGINEERING_STRUCTURE.md)

## Adversarial Surfaces

- **Authority laundering**: A visual state, fixture, local callback, static report, or source-only contract cannot grant access, choose tenant scope, perform an external effect, or replace an owning trust-domain decision. Verified by: `scripts/check-boundaries.mjs`.
- **Qualification promotion**: Repository checks and local reports cannot be promoted to deployed, provider, native, release, or Gate evidence. Verified by: `scripts/gate-closure-policy.test.mjs`.

## Open Questions

- [ ] Which environment-specific provider, KMS/HSM, native-artifact, and release-record details will the accountable external owners record when qualification begins? (open since: 2026-08)

## Local implementation versus external qualification

Local Desktop and Cloud API work may proceed in parallel when the accepted scope, owning module,
strict public contract, server-side authorization/scope, negative controls, and named shared-surface
integrator are present. This permission does not authorize real external effects.

| Evidence class | What it permits | What it never proves |
| --- | --- | --- |
| Local implementation evidence | The specifically tested Desktop, Host, Cloud API, persistence, protocol, or UI boundary. | Deployment, hosted database operation, real provider behavior, native qualification, release, or Gate closure. |
| External qualification evidence | Only the observed environment, provider, final native artifact, release, or approval fact. | A different environment, unobserved provider behavior, or a broader future capability. |

Hosted PostgreSQL, production signer custody, KMS/HSM, deployment, real Cloudflare execution,
native signing/notarization, archival, independent review, release issuance, and Gate closure remain
external qualifications. They constrain only their matching external claims, not local implementation
within the accepted scope. See [verification](docs/VERIFICATION.md) for the exact evidence taxonomy.

## Current repository state

The current source does **not** support a customer-readiness claim:

- Desktop Tauri exposes exactly three narrow local-business commands: authorization-aware status,
  local Portfolio read, and local DomainAsset upsert. Renderer supplies no database path, key,
  workspace selector, Provider account, or Cloud Repository.
- `local-storage` owns the production SQLCipher active workspace, local business transaction,
  Provider-connection local-only storage, and secret-free Sync Outbox.
- `secure-host-core` contains a private Cloudflare Zone/DNS read Service with a credential fence,
  hardened fixed-authority transport, and GoodDealer-owned endpoint/wire definitions. It
  has no native secret provisioning, Tauri command, Cloud route, or customer-reachable composition.
- Cloud owns the literal M001–M014 migration catalog, including account/default-workspace and
  domain-asset sync-replica foundations. The connection-keyed Cloudflare observation migration was
  removed because third-party account bindings are local-only. Modules, contracts, UI primitives, i18n
  copy, migrations, and local tests do not by themselves establish a customer-operable API or
  provider observation.

Any future production composition must add an explicit capability allowlist and fresh reachability
evidence. Existing local modules and tests remain implementation evidence, not customer readiness.

## Runtime and design boundaries

- `brand/` is a visual reference only. It has no runtime, product, authorization, or external-result
  authority.
- Production shared UI consumes only public `@gooddealer/ui` exports, declared tokens/assets, and
  public `@gooddealer/i18n` exports. There is no `@gooddealer/ui-brand`, runtime `brand/` import,
  deep-import exception, alias, or fixture dependency path.
- A component, copy string, sample datum, visual fixture, disabled control, or callback cannot grant
  permission, choose tenant scope, prove an operation, or invent visual design authority.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Engineering structure](docs/ENGINEERING_STRUCTURE.md)
- [Orchestration](docs/ORCHESTRATION.md)
- [Verification](docs/VERIFICATION.md)
- [Sync semantics](docs/SYNC_SEMANTICS.md)
- [Database design](docs/DATABASE_SCHEMA.md)
- [Database naming conventions](docs/DATABASE_NAMING_CONVENTIONS.md)
- [Product requirements](docs/PRODUCT_REQUIREMENTS.md)
- [Roadmap](docs/ROADMAP.md)
- [Decision register](docs/OPEN_DECISIONS.md)
- [Production operations](docs/PRODUCTION_OPERATIONS.md)
- [Local development environment](docs/LOCAL_ENVIRONMENT.md)
- [Security model](docs/SECURITY.md)
- [Release identity](release/README.md)

## Repository checks

Run the root check after dependencies and disk space are available:

```sh
pnpm check
```

PostgreSQL integration tests use the repository-root `.env.local` contract described in
[local development environment](docs/LOCAL_ENVIRONMENT.md):

```sh
pnpm test:postgres
```

For a documentation or bounded-module change, also run the relevant module checks, validate links and
affected terminology/current-source assertions, and finish with `git diff --check`. Passing local
checks demonstrates only the checked repository properties; it does not promote any external
qualification to a completed state.
