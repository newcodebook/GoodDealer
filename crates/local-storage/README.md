# gooddealer-local-storage

## Role

Native Desktop Local Host aggregate for the authoritative encrypted workspace and its durable business state.

## Owns

- SQLCipher key use, workspace database schema, business reads and commits, Outbox, conflicts, and replication state.
- Provider-operation persistence plus the complete local backup, continuity, and guarded-restore trust boundary.

## Touchpoints

- Serves Desktop only through the `DesktopLocalHost` aggregate and purpose-specific plans and projections.
- Coordinates credential custody with `../secure-host-core` without transferring secrets or backup authority.
- Exchanges secret-free sync mutations and recovery inputs through protocol and Cloud-client boundaries.

## Change Guide

- Put local business, sync, schema, and backup invariants in this crate rather than Desktop adapters.
- Update migrations, exact parsers, transaction fences, and negative tests together for persistence changes.
- Verify Rust tests, public-surface checks, SQLCipher evidence, and affected Desktop integration tests.

## Purpose

Owns the SQLCipher key and Active Workspace that are authoritative for Desktop business entities, transactions, Provider observations, operations, history, replication state, and local backup catalogs. It is also the sole Desktop Local Host owner of backup authority continuity, strict GDBK/AEAD, installation Backup KEK and rollback-anchor capability, native file handles/journal, projection/candidate lifecycle, and guarded restore. Cloud availability is not a prerequisite for a local business commit inside an already authorized runtime window.

## Principles

- MUST: Keep one workspace identity per encrypted database and enable SQLite foreign keys.
- MUST: Commit business state, field versions, and Outbox rows atomically.
- MUST: Keep Provider account identity and every credential version local-only.
- MUST: Create the Cloudflare connection anchor and prepare its activation intent in one immediate transaction; immediately before Keychain entry, atomically commit `prewrite_inspection_started` and deny credential use. Only exact-base inspection may then commit the write marker and eventually burn/confirm a generation.
- MUST: Treat every orphaned prewrite inspection, failed exact-base marker, or unpersisted custody contradiction as sticky remediation; never restore active use from a later matching Keychain read.
- MUST: Separate user desired state, Provider observed state, and Cloud replica candidates.
- MUST: Preserve per-target Provider observation outcomes and reject observation/run capability mismatches.
- MUST: Use explicit tombstones; omission and an empty replica never delete local rows.
- MUST: Bound JSON, backup retention metadata, and append-heavy observation access paths in DDL.
- MUST: Build backup data only from the already-open Host-owned SQLCipher connection, project a deterministic complete set of allowlisted business roots, and restore old content as fresh current-database mutation history without importing authority or sync-control floors.
- MUST: Keep the design-stage schema in one reviewable migration snapshot; after the first production release, migration history becomes append-only and immutable.

## Boundaries

- Does NOT handle: GoodDealer identity, subscription, Entitlement, device, or Lease issuance. (see: `../../apps/cloud/src/modules/identity`)
- Does NOT handle: exposing paths, keys, SQL, Provider accounts, or credentials to the Renderer. (see: `../../apps/desktop/src-tauri`)
- Does NOT handle: using Cloud PostgreSQL as a Desktop Repository. (see: `../../docs/DATABASE_SCHEMA.md`)
- Does NOT handle: granting a Provider capability merely because an operation table can represent it. (see: `../../packages/client-core/src/connections`)
- Does NOT handle: Cloud identity, Provider execution, or Renderer/Tauri transport. Backup authority, GDBK/KEK, native handle/journal, projection/candidate, and current-database restore are owned here; passphrase, cross-device, Cloud-hosted backup, and old-database pointer replacement are intentionally absent. (see: `src/backup`)

## Adversarial Surfaces

- **sqlcipher-key-and-path-injection**: Only Host composition supplies the path, key, and workspace; IPC has no selectors. Verified by: `../../apps/desktop/src/app/native-policy.test.ts`.
- **cross-workspace-row-injection**: Root tables structurally reference the singleton workspace; rogue workspace rows fail at insertion and the manifest rejects schema drift. Verified by: `src/active_workspace/business/mod.rs` and `src/migrations/mod.rs` tests.
- **provider-secret-replication**: Provider identity and credentials exist only in local tables; DomainAsset Outbox payloads must parse the exact entity schema and recursively reject forbidden identity or credential keys. Verified by: `src/active_workspace/business/mod.rs` tests.
- **prewrite-custody-crash**: Ordinary `prepared` alone proves Keychain was never entered. Provision prewrite atomically sets `transition_pending`; mismatch cancellation discards staged evidence and sets `remediation_required` without ledger/head/root advance, while orphan recovery is always sticky remediation. Verified by: `src/active_workspace/business/cloudflare_credential.rs` tests.
- **non-atomic-local-commit**: Business state, field versions, tags, and Outbox use one immediate transaction. Verified by: `src/active_workspace/business/mod.rs` tests.
- **implicit-replica-deletion**: Empty replica input is a no-op and deletion requires a tombstone. Verified by: `src/active_workspace/business/mod.rs` tests.
- **backup-secret-or-floor-import**: The owner verifies strict GDBK/KEK binding and projects only allowlisted business roots; Provider identity/credentials, OAuth/session/authority and sync-control rows are excluded. Guarded restore creates fresh mutations/outbox in the current database and preserves all current floors. Product availability still waits for qualified native picker/handle/KEK custody, an independent monotonic anchor, true create-only rebootstrap slot custody, safe active-database move detection, and target-platform fault evidence. Verified by: `src/backup` tests and `../../docs/VERIFICATION.md`.

## Open Questions

- [x] No unresolved schema-ownership question remains for the current single-workspace Desktop database. (open since: 2026-08)

## SQLCipher Process Memory Policy

Production local-storage builds explicitly request SQLCipher memory security after keying every
ordinary database connection and before connection-local settings or schema validation. The request
is owned by one private process-policy module: callers cannot select or disable it, and the repository
never issues a memory-security OFF operation. Integration tests link the non-test library, so any
integration test that opens storage intentionally uses the production ON policy in its own process.

Library unit-test builds leave SQLCipher 4.17's process-global default OFF. This keeps ordinary,
fixture, and descriptor-bound read-only unit paths from irreversibly enabling the allocator's
lock/wipe/unlock work for the rest of the unit-test process. The SQLCipher fixture retains its
distinct deferred wrong-key validation; ordinary opens continue to validate the schema eagerly.
The release evidence example is a separate non-test process, requires policy state 1, and reports it
as `cipherMemorySecurityEnabled`.

Raw key hex and complete key-bearing PRAGMA or ATTACH SQL allocations in these paths use zeroizing
Rust strings. SQLCipher policy state 1 proves that the allocator policy was requested and is active;
it is not attestation that every operating-system `mlock` or `VirtualLock` call succeeded.

## Portfolio Read Contract

`BusinessDatabase::read_asset_library` and `read_domain_detail` bind every read to the opened
workspace, accept only a bounded window and canonical ASCII domain prefix, use fixed parameterized
SQL with binary entity ordering, and project only non-secret fields. The legacy whole-snapshot
reader is a test compatibility seam. These reads expose the safe `assetVersion` local commit
sequence and use wire schema version 3. Edit/delete mutations perform lookup-first idempotent
replay, CAS against that version, and atomically update desired state, field versions, tombstones,
projection, and secret-free outbox rows. These changes require no schema migration.
Pending outbox reads validate the recorded operation: edit/upsert payloads use the full asset
projection while delete payloads use the exact `{entityId, operation}` shape; delete also marks
`lifecycleStatus` pending in field versions in the same transaction.

Cloudflare credential activation resolves an existing workspace-owned Cloudflare/DNS connection; IPC
cannot create or select an incarnation. `DesktopLocalHost` derives H, explicit T=H+1, stable scope and
connection digests, staged observation identities/content, authority snapshot, trusted timestamp, and a
fresh random 256-bit public proof, then commits the stage and prepared intent atomically. It returns only
a non-Clone opaque handle plus a borrowed Keychain plan. Secure Host proves the exact retained base B
before the Host marker, so burned gaps with B<H remain valid without treating Keychain generation as H.
After the marker, Keychain write/read-back and immediate Host resolution drain under the same per-connection
lock. Credential bytes remain exclusively in Secure Host and the native Keychain.

Sync v2 pull materialization is Host-only. `BusinessDatabase::apply_sync_page_v2` strictly parses
the page, verifies its canonical digest and contiguous server revisions, then commits inbox rows,
conflict-safe domain projection updates, reader continuation/confirmation state, and
`applied_through_server_revision` in one immediate transaction. Exact page/token replay is a
no-op; gaps, digest conflicts, malformed fields, and non-active readers fail closed. A reader
marked `rebootstrap_required` retains local business and pending Outbox data and cannot apply
further pages until the isolated recovery workflow owns it.

The Local Host owns one linear `readGeneration` for every Renderer-visible business and sync
projection. A committed first Pull page (including an empty terminal page), Push ACK, deterministic
reject, conflict resolution, or first recovery transition advances it exactly once; exact replay and
retryable deferral do not. The database transaction reports whether visible state changed to the Host
commit fence, and generation advances only after that transaction commits. Conflict resolution requires
`current == expectedReadGeneration`; its first receipt is exactly `expected + 1`, while an identical
retry may replay only before any intervening generation change.

Sync v3 appends immutable conflict evidence, monotonic tombstone order/barriers, anti-rollback reader
floors, append-only resolution receipts, and a rebootstrap publication journal. Conflict candidates
are inserted in the same immediate transaction before inbox/cursor progress; capacity rejection rolls
back the whole page. `accept_remote` is local-only, while `keep_local` is unavailable for delete
conflicts and emits one fresh sequenced Outbox mutation for field conflicts. Ambiguous legacy conflict
or replicated-tombstone rows fail closed during migration; physical conflict and tombstone deletion
is not provided.

Sync v4 is an append-only repair migration. It records explicit replicated versus local-only root and
field provenance, marks omitted clean replicated checkpoint state stale without deleting it, and uses
an O(1) transactional count/byte ledger for open-conflict capacity. Rebootstrap checkpoint plus replay
pages, final recovery proof, opaque A/B-slot journal link, and Host commit fence can be installed by one
outer `IMMEDIATE` transaction. The SQL journal contains only opaque journal/slot identifiers, publication
sequence, manifest digest, and authority/floor/binding digests; it contains no key reference, manifest
token, path, or key material. Conflict resolution recomputes the live projection hash inside its
transaction and binds exact retries to the candidate set/version/revision/hash/choice receipt.

The complete rebootstrap publication lifecycle is private `cfg(test)` protocol evidence. Tests use a
true create-only fake to exercise `Prepared -> CandidateReserved -> Verified -> PublishIntent -> Published
-> ReopenedVerified -> RetiredOld`, one exchange, deterministic cancellation/recovery/quarantine, alias
cache repair, and old-slot retirement. Its journal remains schema v3 and requires the explicit old/candidate
slot-envelope origins plus `old_slot_created_by_operation`; recovery never defaults, infers, or upgrades those
fields. An older or incomplete v3 intermediate record parses as invalid and is only quarantined. Pre-exchange
recovery can cancel but cannot perform the exchange, including when `Prepared` has no candidate file or key to
clean up. Startup validates the bounded, complete, non-rotating journal chain from the first sequence-1
`Prepared`; it never trusts a last record in isolation. Before parsing, two bounded positional reads over the
retained no-follow descriptor must agree on size, EOF, digest and before/mid/after metadata while the fixed
path and directory identities remain stable. This proves only an observed stable snapshot, not a cryptographic,
monotonic, or same-UID-resistant journal anchor. `Quarantined` is an in-memory disposition rather
than a persisted phase. A quarantined Host retains only the process/directory exclusivity guard for its full
lifetime and owns no database descriptor, key, runtime, or capability.

`Cancelled` is cleanup-complete and is appended and synced last. An admitted pre-exchange executor removes and
directory-syncs the exact candidate file, exact-deletes and readbacks the candidate slot, repairs and readbacks
the old-key alias while authenticated old-slot evidence remains, deletes an operation-created old slot only
after that repair, and then appends `Cancelled`; no destructive cleanup follows it. Restart admits only the
exact ordered absence prefixes. A present candidate file with a missing candidate slot, a missing pre-existing
old slot, or any ambiguous topology quarantines. The alias is normally only a repairable cache; it becomes the
sole credential only after both candidate artifacts and an operation-created old slot are absent, where its
digest and immutable old-database/workspace proof must match before cancellation may continue. A valid
`Cancelled` or `RetiredOld` terminal may repair only the alias from an exact active slot after immutable proof;
it performs no database, slot, or journal mutation. Journal file/recovery digests remain strict historical
evidence through durable terminal, but later fresh-authority business writes legitimately change current
ciphertext, counters, and row digests. Terminal restart therefore proves the current selected key/envelope,
workspace/schema/manifest, descriptor-bound immutable database, and the exact verified publication-link row
for a published ancestry; full-chain folding makes `Cancelled` preserve the latest active `RetiredOld` link,
while each later `RetiredOld` replaces it. Initial ancestry containing only cancellations has no invented link.
Terminal proof does not compare mutable current bytes or counters to historical journal values.
This is not same-key/workspace rollback proof and does not replace an independent monotonic anchor.

The private checkpoint installer preserves local pending/conflicted facts while merging the remote checkpoint
and contiguous replay. It admits the checkpoint baseline only when it is at least every workspace-wide applied,
reader, pinned-target, checkpoint-through, and anti-rollback floor, then requires a non-regressing exact final
head. Rejection before plan admission is zero-write. After exact post-exchange topology and immutable descriptor
proof admit a one-shot plan, repairing the active alias is a legal idempotent durable prefix before the next
journal confirmation; restart re-proves topology and repeats that repair without exchange-back or authority.
Production does not compile that lifecycle: the runtime, complete custody/database protocol, journal parser,
phase/action/evidence types, executors, and recovery classifiers are all `cfg(test)`. The non-test plan facade
returns `Unavailable` before reading either input or acquiring protocol locks. Production startup retains only
a fixed-resource, read-only absence gate after the process/directory guards and before database/key side effects;
any journal bytes, candidate/sidecar, A/B slot record, or inspection uncertainty aborts Host construction without
parsing, cleanup, repair, or a live quarantine Host. The current official `security-framework` API cannot provide
the required create-only slot record with all custody attributes, and the pinned `rusqlite` exposes no safe
`SQLITE_FCNTL_HAS_MOVED` wrapper,
so retained-fd identity and ciphertext evidence must not be described as resistance to same-UID active-path
swap-and-swap-back side effects.

## Backup and Restore Contract

`DesktopLocalHost` is the only public backup facade. It owns the authoritative `BusinessDatabase`, private
signed-authority verification and continuity receipt protocol, transition-intent epoch,
operation/authority/writer lock order, strict GDBK v1 container, installation-scoped Backup KEK registry,
independent rollback-anchor capability,
native handle/publication journal, and projection/candidate/restore stages. Callers can provide only bounded
untrusted signed authorization wire or bounded backup request wire, and can receive only redacted status,
verified metadata, closed success, or closed error values. No backup bridge exists to `secure-host-core`, and
Desktop cannot supply a binding, authority snapshot, freshness callback, database borrow, path, key, handle,
candidate, ciphertext, or test adapter.

The private source borrows the already-open SQLCipher connection and produces deterministic complete-set
DomainAsset roots from a transactionally consistent encrypted snapshot. Provider account/credential data,
OAuth/session/Lease/Grant/Ticket/ApprovedOperation, authority/entitlement, sync delivery/cursor/Inbox,
conflict/receipt/rebootstrap journal and backup catalog rows are never projection input. Selection retains
only an admitted handle identity, authenticated digest, redacted metadata and exact CAS values; restore
rereads that handle, reauthenticates the entire artifact, reconstructs an ephemeral zeroizing candidate and
destroys it on every exit.

Guarded restore runs only against the current active database and exact-CASes current revision, positive
candidate-set version, artifact/dialog/operation identity and internal authority generation. One `IMMEDIATE`
transaction writes old content as fresh local mutations, field versions, explicit tombstones, business
history and secret-free Outbox rows while preserving workspace identity and every current server, sync,
delivery, catalog and authorization floor. It never swaps an old database pointer or inflates floors;
concurrent edits/conflicts roll back and exact replay is zero-write.

Private development tests compose real SQLCipher projection, GDBK AEAD, admitted file/journal stages,
authenticated reread, current-database restore, continuity receipts, and the test-only rebootstrap protocol.
Production uses the denying native composition until a qualified picker/stable-handle implementation, real
KEK custody, an independently qualified non-rollbackable monotonic anchor, true create-only slot-key custody,
safe active-database move detection or custody VFS, durable filesystem behavior, and target-platform fault
evidence exist. Ordinary Keychain storage is not monotonic evidence, and preflight followed by upsert is not
create-only. Therefore product backup, continuity, and rebootstrap remain
`unavailable`. See
`../../docs/adr/0023-installation-bound-gdbk-backup-and-honest-business-restore.md`.
