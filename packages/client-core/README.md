# @gooddealer/client-core

## Role

Host-independent client domain contracts, validation, and application ports for GoodDealer user interfaces.

## Owns

- Strict portfolio, conflict, sync-presentation, connection, and backup presentation contracts.
- Validation that rebuilds untrusted Native and Cloud data before application code consumes it.

## Touchpoints

- Supplies contracts and use-case ports to Desktop Renderer composition.
- Receives sanitized data through application-owned adapters rather than opening Tauri, databases, or networks.
- Shares wire ownership with protocol packages while leaving authority and execution in native or Cloud hosts.

## Change Guide

- Add client behavior to the narrow owning domain module and export it only through the package root.
- Treat every external value as `unknown`; preserve Host generations and never manufacture authority.
- Verify the owning contract tests, query/use-case tests, and affected Desktop adapter tests.

## Purpose

Owns host-independent application contracts and strict validation for data entering a client.

## Principles

- MUST: Treat every Native, Cloud, import, and integration response as untrusted `unknown` data.
- MUST: Reject unknown keys, invalid provenance, inconsistent editability, and non-canonical identifiers.
- MUST: Keep business contracts host-independent and expose only purpose-specific ports.
- MUST: Preserve Host-owned read generations without treating them as Renderer request generations.
- MUST: Model backup UI with strict redacted view/intent contracts; only `active` and `verified_local_continuation` may export or inspect, while restore admission and intent exist only for `active`.

## Boundaries

- Does NOT handle: opening Tauri IPC or a local database. (see: `../../apps/desktop/src/adapters/tauri`)
- Does NOT handle: granting local read or mutation authority. (see: `../../apps/desktop/src-tauri`)
- Does NOT handle: using Cloud or visual fixtures as Desktop business authority. (see: `../../docs/ARCHITECTURE.md`)
- Does NOT handle: paths, GDBK parsing, encryption/keys, artifact authentication, authorization, file handles, restore execution, Provider/OAuth/session data, or Cloud backup hosting. Backup execution and authority remain private to `../../crates/local-storage`; `secure-host-core` has no backup dependency. (see: `../../crates/local-storage/src/backup`)

## Adversarial Surfaces

- **hostile-portfolio-wire-data**: Descriptor-safe copying and strict v3 schemas reject accessor, prototype, sparse, oversized, control-character, and secret-bearing shapes. Verified by: `src/portfolio/portfolio-contracts.test.ts`.
- **renderer-authority-confusion**: Freshness preserves Host `readGeneration`, `active_local`, and the `readOnlyReason`/`canEdit` invariant without upgrading access. Verified by: `test/portfolio-query.test.ts`.
- **backup-restore-authority-laundering**: Strict backup view and constructor checks keep `verified_local_continuation` read/export/inspection-only, bind active restore to exact artifact/dialog/revision/candidate values, and reject platform-credential inclusion. Verified by: `src/backup/backup-restore.test.ts`.

## Open Questions

- [x] No unresolved ownership question remains for the purpose-specific Portfolio v3 read and mutation contracts. (open since: 2026-09)

## Portfolio Contracts

The portfolio module is the sole TypeScript owner of the Asset Library and Domain Detail v3
contracts. Production Desktop data has `source: active_local`, a Host-owned `readGeneration`, and a
`readOnlyReason` whose nullability exactly determines `canEdit`. Requests accept only a 1..200 row
window, a bounded canonical ASCII domain prefix, canonical lowercase DNS detail identities, and
strict edit/delete requests with expected read and asset versions. Mutation receipts are durable
and replay-safe; no create or restore capability is exposed.

Every Native response is copied from `unknown` without invoking accessors and rejects prototypes,
symbols, sparse arrays, cycles, unknown keys, forbidden controls, and oversized values before it can
reach React. This package neither opens Tauri IPC nor supplies Cloud, fixture, or authorization
authority.

The Sync Conflict Center exposes only one-candidate manual resolution intents. It intentionally has
no group, bulk, automatic, or "low-risk" resolution helper; each intent remains bound to the exact
candidate version, revision, current-value hash, Host-derived workspace binding, and user-selected choice;
the Renderer supplies no `workspaceId` or other authority selector.

The customer sync presentation is the durable `SyncSnapshot` contract, not an internal replication
diagnostic status. Its validated fields are the durable pending/open-conflict/rejected mutation counts,
`recoveryRequired`, applied server revision, replication activity timestamps, and Native transport state.
Transport is closed to `checking`, `reachable`, `offline`, and `blocked`; startup and restart must begin at
`checking`. There is no manual-sync command and browser `navigator.onLine` is not a source of authority.
Commercial read-only and Standby may render the conflict projection but cannot receive a resolution admission;
locked, retryable, security, and recovery surfaces are route-free. A resolution receipt fences the local
transaction and Outbox enqueue/replay only; it never means Cloud acknowledged the mutation. The resolution
intent carries the exact projection `readGeneration`; a first successful receipt is accepted only at
`expectedReadGeneration + 1`, and only a fully identical replay may return the same receipt.

## Backup Contracts

The backup module owns only strict, host-independent redacted presentation and intent contracts.
`active` and `verified_local_continuation` may request export and artifact inspection;
`verified_local_continuation` can never receive restore admission, bind confirmation, or create a restore intent.
Restore is `active`-only and binds opaque operation/dialog identity, redacted artifact identity, exact
current revision, candidate set/version, and the exact `RESTORE LOCAL BACKUP` confirmation. Requests to include platform
credentials are rejected as `BACKUP_CREDENTIALS_NOT_ALLOWED`.

No path, key, plaintext, raw account/workspace/device identity, manifest, Provider/Cloud/OAuth/session/
authority identifier/token/material, or parser diagnostic belongs in these contracts. Their presence does not make Desktop
backup available. The contracts participate in the injected Host/local-storage/Desktop end-to-end tests;
production native picker/stable-handle/KEK custody, independently monotonic continuity, true create-only
rebootstrap slot custody, safe active-database move detection and target-platform qualification remain
required. No client contract can upgrade the private test-only rebootstrap protocol into product availability.
