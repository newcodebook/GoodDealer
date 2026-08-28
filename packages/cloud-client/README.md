# @gooddealer/cloud-client

## Purpose

This package exposes strictly parsed Cloud control-plane and sync-recovery clients. It does not
provide a Desktop business Repository. Normal Desktop Query and Command paths use local SQLCipher.

## Principles

- MUST: Expose Cloud account/control and sanitized replica-recovery transport only through strict contracts.
- MUST: Keep transport asynchronous to Desktop business commits and subordinate to local SQLCipher authority.
- MUST: Reject caller-selected tenant scope and all Provider identity, credential, and secret fields.
- MUST: Treat an absent or empty replica response as no recovery input, never as deletion authority.

## Boundaries

- Does NOT handle: Caller-selected account or workspace scope; the authenticated Cloud session derives it. (see: `src/index.ts`)
- Does NOT handle: URL, header, credential, Provider, database, or authorization authority. (see: `src/index.ts`)
- Does NOT handle: Desktop business reads, writes, or local commit acknowledgement. (see: `../client-core`)

## Adversarial Surfaces

- **Tenant substitution**: Client inputs cannot select account or workspace scope. Verified by: `test/control-and-recovery-clients.test.ts`.
- **Replica-as-authority substitution**: Recovery input remains strict, sanitized, and invisible until merged into local SQLCipher. Verified by: client contract tests.
- **Secret transport injection**: Provider identities, credentials, connection IDs, URLs, and headers are rejected. Verified by: `test/control-and-recovery-clients.test.ts`.

## Open Questions

- [ ] Which application composition will own production transport, retry, and authenticated-session wiring for these clients? (open since: 2026-08)

## Current API

- `AccountActivationClient.activate()` invokes the account control plane.
- `DomainAssetReplicaRecoveryClient.read()` reads a sanitized Cloud replica only as recovery input.
  The caller must validate and merge that input into local SQLCipher before local Query can see it.

There is intentionally no Cloud Portfolio query client and no Cloudflare observation submit/read
client. Provider execution and Provider-account identity stay on the local Secure Host; only
allowlisted, secret-free business mutations may reach the Cloud sync plane.

## Verification

```sh
pnpm --filter @gooddealer/cloud-client typecheck
pnpm --filter @gooddealer/cloud-client test
```
