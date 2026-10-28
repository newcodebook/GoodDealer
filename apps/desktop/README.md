# GoodDealer Desktop

## Role

Customer Desktop application that composes the Renderer and native Host around the authoritative local workspace.

## Owns

- Desktop Renderer routing, shell composition, and sanitized Tauri IPC adapters. The presentation
  layer is being rebuilt from `brand/`; until it lands, `src/app.tsx` renders only an unstyled
  startup state while `src/app/*` keeps the workspace, authentication, and Portfolio fences.
- Native application composition for authorization, local business commands, sync, projection, and Provider lanes.

## Touchpoints

- Uses `../../crates/local-storage` as the sole local business and backup aggregate owner.
- Uses `../../crates/secure-host-core` for native OAuth, device identity, authorization verification, and Cloudflare observation.
- Consumes host-independent contracts from `../../packages/client-core`, `../../packages/cloud-client`, `../../packages/ui`, and `../../packages/i18n`.

## Change Guide

- Keep command handlers and composition roots thin; place business rules in their owning crate or package.
- Preserve strict IPC decoding, secret confinement, authorization fences, and atomic authoritative refresh behavior.
- Verify Desktop typecheck/tests, Tauri Rust tests, and command-policy checks after composition changes.

## Purpose

Desktop is the customer business runtime. After Cloud account/subscription/device authorization,
it reads and writes the Host-owned local SQLCipher database. Cloud sync is asynchronous and cannot
replace this Repository.

## Principles

- MUST: Treat local SQLCipher as the sole authority for Desktop business reads and writes.
- MUST: Commit business state and its secret-free Sync Outbox mutation atomically before transport.
- MUST: Keep Cloud authorization authority separate from local business-data authority.
- MUST: Continue authorized local business work without Cloud transport for the verified offline window.
- MUST: Keep Provider identities, credentials, Browser Profiles, and database keys inside the local Host.

## Boundaries

- Does NOT handle: Cloud account, subscription, device, Lease, or Epoch issuance. (see: `../cloud`)
- Does NOT handle: Cloud replica persistence or server-side synchronization adjudication. (see: `../cloud`)
- Does NOT handle: A Cloud-backed Desktop business Repository or transport-gated local commit path. (see: `src-tauri/src/command_handlers.rs`)

## Adversarial Surfaces

- **Cloud authority substitution**: Cloud transport or replica state cannot replace local SQLCipher Query/Command authority. Verified by: Desktop local-business command tests.
- **Secret projection leakage**: Provider identity and secret-bearing fields cannot cross IPC, Outbox, or Cloud boundaries. Verified by: Tauri command and local-storage policy tests.
- **Authorization bypass**: Local availability cannot mint or extend account, entitlement, Lease, or Epoch authority. Verified by: `DesktopLocalHost` authorization-transition and business-write tests.

## Open Questions

- [ ] Which OpenBao Grant/Lease `kid` values and public keys will the release owner pin into the signed/notarized Desktop artifact after external qualification? The Desktop Cloud origin is fixed to `https://api.gooddealer.com/`; customer-production qualification remains open. (open since: 2026-09)

## Native commands

The `local-app` WebView capability admits only the reviewed local-business, sanitized authentication,
and Host-owned Cloudflare command names listed below. The Cloudflare handlers accept only bounded raw
JSON connection/entity lookup hints, reject duplicate and unknown fields before enqueue, and submit to
the isolated user-triggered Provider lane. Native composition captures the credential, observes the fixed
Zone/DNS endpoint set, asks `DesktopLocalHost` to derive the complete durable operation, publishes the
Secure Host envelope under exact-base Keychain CAS, and commits observations locally before waking the
projection lane. The Renderer-side journey coordinator (`src/features/connections`) covers activation, bounded status,
observation enqueue, and committed local observation reads; it is not composed into the production
root until the rebuilt Desktop screens land. Production-provider qualification remains separate, so this source
composition is not a customer-availability claim. Revoke/deactivate remains intentionally unavailable until
a Host-owned atomic custody and fencing capability is delivered.

- `cloudflare_connection_activate`
- `cloudflare_connection_status`
- `cloudflare_observation_read`
- `cloudflare_zone_observe`
- `local_business_status`
- `local_asset_library_read`
- `local_domain_detail_read`
- `local_domain_asset_edit`
- `local_domain_asset_delete`
- `local_domain_asset_provider_bind`
- `local_sync_status`
- `local_conflict_center_read`
- `local_conflict_resolve`
- `local_backup_restore_status`
- `local_backup_export`
- `local_backup_artifact_select`
- `local_backup_restore_begin`
- `desktop_authentication_status`
- `desktop_authentication_begin`
- `desktop_authentication_refresh`

No command accepts or returns a database path, database key, SQL, account/workspace selector,
Provider account, credential, OAuth URL, bearer token, or Cloud Repository. Authentication IPC exposes
only `unavailable`, `signed_out`, `pending`, `authorization_failed`, `authorization_retryable`, or
`authenticated`; the last state means the signed Grant has been verified and the local runtime activated.
`authorization_failed` blocks refresh and clears refresh custody before a new sign-in, while
`authorization_retryable` means Native retained the newest rotated refresh credential plus its still-valid
memory-only access token and may retry without exposing either. Its durable binding state remains distinct
from security revocation, so restart resumes the safe refresh path while local data stays locked. `DesktopLocalHost` starts
activation-required unless the
Host loads an OS-protected, previously verified workspace binding. That binding can reopen only the
same local database for read-only use; only trusted native authorization composition can restore
mutation authority.

DomainAsset edit/delete commits the local business row, field versions, tombstone (for delete), and a secret-free Sync Outbox entry in one
SQLCipher transaction. Asset Library and Domain Detail reads return bounded projections from the
Host-bound local database. The legacy whole-snapshot command is test-only and absent from the
production invoke closure. Cloud transport is absent from these local-business command implementations and the
regression suite proves local read/write without it.
Renderer mutation completions are independently fenced by mounted state, route/entity identity,
and a fresh Active Host status before any generation acceptance, refresh, or navigation effect.

Conflict Center responses contain bounded display text, hashes, revisions, and manual choices only.
The Host derives workspace, device, lease, current time, and the deterministic resolution identity;
the Renderer supplies no authority selector. Delete conflicts expose `accept_remote` only. The current production
composition always reports rebootstrap as `recovery_unavailable`; no platform is qualified yet.
Conflict resolution is always one explicit candidate and one explicit choice; no bulk or automatic
"low-risk" resolution API exists. Hostile display values are bounded before they reach React and
are rendered only as text children.

`sync.conflicts` is an independent workspace route. Active may receive a resolution admission for one
candidate; commercial read-only and Standby may read the Conflict Center projection but receive no resolution
admission. Locked, retryable, security, and recovery surfaces are route-free, so they cannot reach this route
through navigation or fallback routing.

The customer sync command returns a durable `SyncSnapshot` with pending, open-conflict, and rejected mutation
counts, `recoveryRequired`, the applied server revision, last replication activity, and Native transport
observation. Native transport is exactly `checking`, `reachable`, `offline`, or `blocked`; startup and restart
begin at `checking` and never reuse the previous successful observation. Sync is mandatory asynchronous
replication with no manual-sync action and no `navigator.onLine` authority. A conflict resolution receipt only
fences the local commit (and any Outbox enqueue or idempotent replay); it is not a Cloud ACK. First-time conflict
resolution requires the exact current Host `readGeneration` and returns exactly `expectedReadGeneration + 1`;
only an identical replay may reuse that receipt. After success, Renderer reads business status, Asset Library,
Conflict Center, and `SyncSnapshot` between matching Host status generations and publishes the complete bundle
in one state update; a torn read is retried and never partially published.

## Local Provider binding

`local_domain_asset_provider_bind` persists an immutable association for an existing asset from
committed Host-verified Cloudflare Zone evidence. It performs no Provider API write and exposes no
credential or resource selector. The concrete adapter implements the required narrow
`PortfolioProviderBindingPort` through its validating wrapper. The broad injected
`LocalBusinessPort` retains an optional binding method until the asset-detail UI exposes a bind
action; read-only adapters need not supply write capabilities. No bind action is currently exposed.
First commit advances Host generation once; replay may return the current generation after
intervening commits.

## Native storage identity

The native Host resolves one fixed `active-workspace/business.db` location beneath Tauri's
application-data directory. It rejects relative roots, symlinked storage roots, symlinked database
files, and non-file database targets; on Unix it restricts the Host-owned database directory to the
owner.

Before reading any Keychain item or opening SQLCipher, the first process acquires an OS-level exclusive
application-data lock. A second process cannot become a refresh or database authority; single-instance
delivery forwards a custom-scheme launch to the established process. Exact bounded OAuth callbacks
that arrive during Native setup are buffered before managed OAuth state exists and atomically drained
after that state is installed, preserving the one-time callback across the startup window.

On macOS, the Host reads the 32-byte SQLCipher key from the user's OS Keychain and generates it with
the operating system CSPRNG only when no database exists. If an existing database loses its
Keychain item, startup fails closed instead of creating a replacement key. Keychain failures,
malformed key material, and wrong SQLCipher keys expose only stable non-secret error codes. Other
platform keychain adapters remain fail-closed until their native implementations are qualified.

## Secret boundary

Third-party account identity, Provider Account ID, account labels, credential bindings, API keys,
Provider tokens, cookies, passwords, 2FA, browser profiles, and database key material stay in the local Host
boundary. They never enter Renderer state, IPC requests, sync mutations, Cloud, logs, errors, or
ordinary audit payloads.

GoodDealer Desktop login uses the system browser with Authorization Code + PKCE S256. PKCE verifier
and state remain in Native memory. The one-time callback is accepted only at
`gooddealer://oauth/callback` with an exact matching state. The short-lived access token remains in
Native memory; the rotating refresh token is stored only in the purpose-isolated macOS Keychain item.
Before Cloud issues a code, it returns an account-scoped two-minute challenge. Native signs the exact
account/device/key/PKCE/client/redirect/nonce/expiry transcript with its separate Keychain-held
Ed25519 device identity, then resumes the browser flow. A fresh installation uses the same proof to
create the first binding only when the Account Web session came from password/passkey authentication
within five minutes, both browser legs use that same session, and an account slot is available; an
existing binding must match its active key exactly.
The Native token client fixes the configured HTTPS Cloud origin, disables redirects and retries,
applies bounded timeouts, and reads at most 4 KiB of a strict response. Other platforms remain
fail-closed until their credential-store implementation is qualified.

## Authorization

Account, subscription/entitlement, device binding, and ActiveDeviceLease/Epoch remain Cloud control
plane facts. Invalid authorization keeps the runtime locked. A valid cached grant may permit local
business work only for its defined offline window; Desktop cannot extend that window itself.

The Host strictly consumes signed `DesktopAuthorizationGrant` v3 and separately verifies its nested
ActiveDeviceLease. The outer purpose-specific signature covers Workspace, exact read/mutate scopes,
window and the complete signed Lease; the nested signature covers account, device, Account Security
Epoch and Lease Epoch. Parsing never proves either signature. DomainAsset writes recheck the trusted
Host clock against `offlineExecuteUntil`; equality removes mutation authority. Activation also fixes a
process-monotonic deadline, and every admitted mutation advances an OS-protected time floor. Wall-clock
rollback blocks mutation immediately and remains fail-closed after restart. Portfolio reads remain
available through the OS-protected verified workspace binding after ordinary Lease or commercial
expiry. An observed device/account security revocation stores a security-locked binding before closing
the database, so restart cannot reinterpret the same binding as commercial read-only.
An fsynced, non-secret fail-closed runtime marker is an independent durable barrier even when the
Keychain binding is missing. Security state from either barrier always outranks retryable state. Marker
replacement writes a same-directory owner-only temporary file, fsyncs it, atomically renames it, and
fsyncs the directory, so a crash preserves either the complete old marker or the complete new marker.
Successful verified activation clears both barriers in order.

After each code exchange or refresh, Native uses the memory-only Bearer access token to POST the
fixed `{ "schemaVersion": 3 }` request to `/v1/devices/authorization-grant`, accepts at most 16 KiB
of JSON, verifies both signatures, enforces device/account and monotonic Epoch floors, persists the
verified binding, and only then activates the same `DesktopLocalHost` aggregate. Production builds use the
embedded `https://api.gooddealer.com/` origin and must embed a strict `GOODDEALER_DESKTOP_AUTHORIZATION_KEYS_JSON` registry containing
one to eight globally purpose-separated keys for both `grant_v3` and `active_device_lease_v1`.
Duplicate key IDs or public material fail closed. Rotation publishes an overlapping registry
in a signed/notarized Desktop release before Cloud changes the OpenBao signing version; removal from
the registry is revocation by omission.

The Tauri production graph composes three isolated Native lanes. `SyncLane` owns fixed-origin Push/Pull/
Checkpoint cycles, `ProjectionLane` owns durable Cloudflare projection delivery, and the user-triggered
`ProviderLane` owns activation and observation with process concurrency one and no timer retry. Every HTTP
operation begins with a fresh `DesktopLocalHost` admission; successful local Provider work only wakes the
projection lane. Cancellation and shutdown drain admitted work independently, while Renderer IPC exposes no
sync command, envelopes, selectors, cursors, confirmation tokens, credentials, or Bearer tokens. Each cycle
aggregates Push, Pull, and Checkpoint outcomes in the fixed fail-closed order `RecoveryRequired >
SecurityBlocked > AuthorizationBlocked > Retryable > Valid > NotAttempted`; a successful stage cannot mask
a stronger outcome from another stage. Cancellation fences publication before draining admitted work, so a
late success cannot overwrite the retained transport observation or start another cycle.

Cloudflare activation crosses a durable prewrite fence before Secure Host enters Keychain. The Host atomically
changes `prepared` to `prewrite_inspection_started` and denies credential use; after that commit cancellation
cannot interrupt Keychain lock/read, exact-base marker, write/read-back, or immediate resolution. Only exact B
may commit `keychain_write_started`. A non-exact, malformed, or unreadable B performs no write or generation
burn and atomically discards the stage into `remediation_required`; failed persistence or an orphaned prewrite
remains denied and startup conservatively remediates it rather than restoring active use.

When the reader cursor requires rebootstrap, the private Local Host test composition validates the
bounded typed plan and exercises checkpoint/replay materialization plus the type-ordered
`Prepared -> CandidateReserved -> Verified -> PublishIntent -> Published -> ReopenedVerified ->
RetiredOld` protocol. That is protocol and fault-recovery evidence only. The current production
composition has neither a qualified true create-only rebootstrap slot-key adapter nor a safe
`SQLITE_FCNTL_HAS_MOVED`/custody-VFS binding. The complete runtime/custody/database recovery graph compiles only
under `cfg(test)`; production has no dormant phase/action/status shell. Its plan facade returns `Unavailable`
before reading wire or acquiring protocol locks. Startup only checks fixed journal/candidate/sidecar and A/B-slot
presence after acquiring process/directory guards and before database/key side effects. Any residue or uncertain
inspection terminates Host construction with no parsing, repair, cleanup, or live quarantine Host; a pristine
topology continues into ordinary activation and local business startup. Retained descriptors and identity/digest
checks in the private test protocol can reject
the wrong published inode, but they do not prevent a same-UID process from swapping an active path,
causing SQLite side effects, and swapping it back. Rebootstrap and continuity remain unqualified and
unavailable, while normal activation and local business operation remain independent of this gate.

User backup restore is separate from rebootstrap. The complete backup trust boundary lives inside the
`gooddealer-local-storage` `DesktopLocalHost` aggregate beside the authoritative SQLCipher writer. Desktop
owns no backup authority snapshot, database borrow, picker or file handle, binding, key, ciphertext,
projection, candidate, currentness callback, or test port, and has no backup dependency on
`secure-host-core`. Desktop is only the thin Tauri adapter: it admits bounded raw bytes, calls one
`spawn_blocking` aggregate operation, and maps redacted results/errors.

The status command is the argument-free query exception. Export, selection, and restore accept only a Tauri
raw body of 1 through 4096 bytes: the borrowed body is length-checked before the sole application copy, JSON
bodies are rejected, and one owned bounded buffer enters one `spawn_blocking` aggregate call. No request,
Tauri state, lock, database borrow, native handle, key, ciphertext, candidate, or plaintext crosses `.await`.

The private owner tests compose the real SQLCipher source, strict GDBK v1, admitted file/journal stages,
authenticated reread, ephemeral isolated candidate, guarded current-database restore, and a test-only
create-only rebootstrap state machine end to end. Restore
writes fresh mutation, field-version, tombstone, history, and secret-free Outbox rows into the current active
database; it never swaps in an old database or imports old authority/sync floors. Production uses the closed
unavailable native composition until picker-backed stable handles, independently qualified monotonic continuity,
true create-only slot-key custody, safe active-database move detection or a custody-controlled VFS, durable
platform filesystem behavior, and target-platform fault evidence are qualified. The repository uses the official
`security-framework` 3.7.0 dependency and has no production fake, feature, environment selector, fork, or
preflight-plus-upsert fallback. There is no passphrase, cross-device,
or Cloud-hosted fallback. See
`../../docs/adr/0023-installation-bound-gdbk-backup-and-honest-business-restore.md`.

For an authorization-code exchange, access and refresh credentials remain transient until Grant
verification, binding persistence, and runtime activation succeed; only then does Native persist the
refresh token and report `authenticated`. During refresh, Native first persists an unpredictable
`request_id` with the presented refresh token in one Keychain record. A response-lost retry reuses that
exact pair and Cloud returns the same rotation result; success requires a positive `rotation_generation`.
Native then atomically replaces the record with the newest refresh token and no pending request, but does not commit access or report
`authenticated` until the new Grant succeeds. A code-exchange Grant failure or any deterministic Grant or
activation rejection clears memory access, security-locks the runtime, and reports `authorization_failed`
with only a new sign-in action. Native clears refresh custody for this state, blocks background refresh, and
reconstructs the same block after restart from the durable marker or security-locked binding. A transient refresh Grant
failure reports `authorization_retryable`: Native keeps the newest refresh token in Keychain and the matching
uncommitted access token in memory, then retries the Grant with that access token before performing another
refresh rotation. Retry and re-login actions are both available; an expired retry access token falls back to
one normal refresh rotation. Choosing re-login acquires the same Native concurrency gate as refresh/callback,
clears both retained credentials, and only then creates the new pending browser attempt.

The native Host performs a silent Keychain-backed refresh on startup and schedules later refreshes
before access-token expiry. Network failures, HTTP 408/425/429, and Cloud/OpenBao 5xx responses use bounded
backoff without deleting the refresh token. Every other Grant status, plus malformed, empty, or over-limit
Grant protocol data, is a deterministic rejection that requires authorization recovery.
Only an exact `invalid_grant` response clears it. `temporarily_unavailable` and outcome-unknown responses
retain the presented token and pending request identity. Only sanitized authentication status events cross
into the Renderer, and concurrent manual/background refresh is rejected so rotation cannot be mistaken for
replay. Runtime-lock events clear any rendered Portfolio before re-reading the authoritative business state.

## Verification

macOS signing and notarization are deferred until an Apple Developer account exists. Local feature
development and verification continue with developer builds; Homebrew or user-downloaded unsigned
packages are only development distribution paths and require explicit Gatekeeper/user-allowance
testing before they can be documented as supported installation flows.

```sh
pnpm --filter @gooddealer/desktop typecheck
pnpm --filter @gooddealer/desktop test
cargo test -p gooddealer-desktop-tauri
node --test scripts/tauri-command-policy.test.mjs
```
