# gooddealer-local-storage

## Purpose

Owns the SQLCipher Active Workspace that is authoritative for Desktop business entities, transactions, Provider observations, operations, history, replication state, and local backup catalogs. Cloud availability is not a prerequisite for a local business commit inside an already authorized runtime window.

## Principles

- MUST: Keep one workspace identity per encrypted database and enable SQLite foreign keys.
- MUST: Commit business state, field versions, and Outbox rows atomically.
- MUST: Keep Provider account identity and every credential version local-only.
- MUST: Separate user desired state, Provider observed state, and Cloud replica candidates.
- MUST: Preserve per-target Provider observation outcomes and reject observation/run capability mismatches.
- MUST: Use explicit tombstones; omission and an empty replica never delete local rows.
- MUST: Bound JSON, backup retention metadata, and append-heavy observation access paths in DDL.
- MUST: Keep the design-stage schema in one reviewable migration snapshot; after the first production release, migration history becomes append-only and immutable.

## Boundaries

- Does NOT handle: GoodDealer identity, subscription, Entitlement, device, or Lease issuance. (see: `../../apps/cloud/src/modules/identity`)
- Does NOT handle: exposing paths, keys, SQL, Provider accounts, or credentials to the Renderer. (see: `../../apps/desktop/src-tauri`)
- Does NOT handle: using Cloud PostgreSQL as a Desktop Repository. (see: `../../docs/DATABASE_SCHEMA.md`)
- Does NOT handle: granting a Provider capability merely because an operation table can represent it. (see: `../../packages/client-core/src/connections`)

## Adversarial Surfaces

- **sqlcipher-key-and-path-injection**: Only Host composition supplies the path, key, and workspace; IPC has no selectors. Verified by: `../../apps/desktop/src/app/native-policy.test.ts`.
- **cross-workspace-row-injection**: Root tables structurally reference the singleton workspace; rogue workspace rows fail at insertion and the manifest rejects schema drift. Verified by: `src/active_workspace/business/mod.rs` and `src/migrations/mod.rs` tests.
- **provider-secret-replication**: Provider identity and credentials exist only in local tables; DomainAsset Outbox payloads must parse the exact entity schema and recursively reject forbidden identity or credential keys. Verified by: `src/active_workspace/business/mod.rs` tests.
- **non-atomic-local-commit**: Business state, field versions, tags, and Outbox use one immediate transaction. Verified by: `src/active_workspace/business/mod.rs` tests.
- **implicit-replica-deletion**: Empty replica input is a no-op and deletion requires a tombstone. Verified by: `src/active_workspace/business/mod.rs` tests.

## Open Questions

- [x] No unresolved schema-ownership question remains for the current single-workspace Desktop database. (open since: 2026-08)
