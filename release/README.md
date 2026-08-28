# Release identity

## Purpose

The `release` module defines a fail-closed identity boundary for a future release while the checked
in request remains unissued and ineligible. It validates strict request and canonical-manifest data;
it does not build, issue, sign, notarize, archive, deploy, or close a Gate.

## Principles

- MUST: Accept the current request only when it is exactly `unissued`, without a version, channel, or approval field.
- MUST: Validate requests, manifests, paths, artifacts, and external-evidence claims as untrusted data.
- MUST: Bind a future canonical identity to one clean, stable checkout and a complete declared regular-artifact set.
- MUST: Keep signing, notarization, durable archive, independent review, provider qualification, governance, and Gate closure pending until external evidence exists.

## Boundaries

- Does NOT handle: Product version/channel selection, product approval, release builds, publication, signing, notarization, archival, provider operations, or deployment. (see: release-request.json)
- Does NOT handle: Fixture, test-vector, visual-fixture, or generated-test-only data as release inputs. (see: ../scripts/collect-release-identity.mjs)
- Does NOT handle: Converting repository topology or a successful validation into issuance authorization. (see: ../scripts/release-identity-policy.test.mjs)

## Adversarial Surfaces

- **Unissued identity forgery**: Added fields, aliases, coercion, duplicate keys, and missing approvals cannot turn the current request into issuance. Verified by: `../scripts/release-identity-policy.test.mjs`.
- **Source and artifact substitution**: Dirty, drifting, fixture, or substituted inputs fail before canonical finalization. Verified by: `../scripts/release-identity-policy.test.mjs`.
- **Command argument injection**: Artifact paths are strictly checked before process execution. Verified by: `release-identity-command-boundary.test.mjs`.

## Open Questions

- [ ] If future authorization occurs, which accountable owners will attach immutable build and external-evidence records? (open since: 2026-08)

## Accepted release policy

The first public customer release is `1.0.0` on the `stable` channel, as defined by
[`ADR-0018`](../docs/adr/0018-production-operations-and-stable-release.md). It can be requested
only after the complete v1 product scope, declared artifacts, signing/notarization, durable
archive, Cloudflare qualification, independent review, and Product/Security/Data Governance/
Platform Operations approvals exist. This module still does not select or create any of them.

## Current operation

`release/release-request.json` contains only the unissued request state. Running
`node scripts/collect-release-identity.mjs --foundation` validates that state and emits an
ineligible result; it creates no release artifact or external action.

The future-only `--issue --manifest <relative-path>` path rejects the current request before a
build boundary. A later approved request would still need a selected semantic version, channel,
target, declared artifact set, clean source, and all separately required external evidence.

## External evidence state

| Evidence | Current status |
| --- | --- |
| Signing | pending |
| Notarization | pending |
| Durable archive | pending |
| Independent review | pending |
| Provider qualification | pending |
| Governance | pending |
| Gate closure | pending |

No local report, repository check, source hash, or canonical identity validation changes these
pending states.

## Verification

```sh
pnpm release:foundation
pnpm release:issue -- <relative-manifest>
```

The second command is intentionally rejected for the checked-in unissued request.
