# GoodDealer Desktop

## Role

Customer Desktop application that composes the Renderer and native Host around the authoritative local workspace.

## Owns

- Renderer routing, shell, onboarding and business-page composition using Host projections.
- Narrow Tauri IPC adapters and native composition for authorization, local business, sync,
  projection, Provider coordination and device handoff.
- A separate `visual-fixtures/` design host outside the production graph; it grants no authority.

Current screen composition and remaining work are recorded in
[current implementation](../../docs/CURRENT_IMPLEMENTATION.md). The production roots are
`src/app.tsx`, `src/app/workspace-view.tsx` and `src-tauri/src/main.rs`.

## Touchpoints

- Uses `../../crates/local-storage` as the sole local business and backup aggregate owner.
- Uses `../../crates/secure-host-core` for native OAuth, device identity, authorization verification, Cloudflare observation, Afternic I/O, and safe OS power admission.
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

The production command inventory is owned by `src-tauri/src/main.rs`, `src-tauri/build.rs` and
`src-tauri/capabilities/local-app.json`. Command-policy tests require them to agree; this README
keeps no parallel list. Commands cover local business and repair, sync/conflicts, device switch,
backup workflow, authentication and Cloudflare connection/observation/retirement.

Renderer intents are bounded and strictly parsed. Commands expose no database path, database key,
SQL, account/workspace selector, Provider account, credential, OAuth URL, bearer token or Cloud
Repository. Native derives authority and resource identity before execution and publishes local
results only after the owning transaction commits.

Cloudflare activation and observation remain subject to the Host qualification register. Onboarding
composes connection creation/activation; settings composes rejected-custody retirement and stored-row
repair. Revocation and retirement reduce custody and do not require Provider execution qualification.
They do not revoke a token at Cloudflare; the user must delete or rotate that token at the Provider.
The separate Provider lane serializes these workflows and retains the durable prewrite/marker fences.

Device-switch commands drive the native side of ADR-0032. The switch identity comes from Cloud;
Lease, receipts, proof and signature stay Native. The device-management screen remains to be composed.
Backup commands do not make production recovery available while their native dependencies are absent;
replacement recovery requirements are being established in the product discovery record.

## WebView content security policy

`tauri.conf.json` sets a self-only CSP: scripts, styles, fonts, and images load only from the bundled
app (plus `data:` images), and `connect-src` admits only Tauri IPC. No remote origin, `unsafe-eval`, or
wildcard is allowed. Tauri's automatic nonce injection is disabled for `style-src` only, because a
nonce would void `'unsafe-inline'` for React style attributes. Verified by `src/app/native-policy.test.ts`.

## Native window

The window title bar is drawn by the Renderer's `DesktopShell` and differs per platform. Windows and
Linux run undecorated (`tauri.conf.json` `decorations: false`), so the shell draws minimize / maximize /
close and marks its title bar with `data-tauri-drag-region`; the capability admits only
`core:window:allow-start-dragging`, `-minimize`, `-toggle-maximize`, and `-close` for that. macOS merges
`tauri.macos.conf.json`, which keeps native traffic lights over an overlay title bar (`titleBarStyle:
Overlay`, `hiddenTitle`, `trafficLightPosition`); the shell reserves their inset and draws no controls.
The macOS patch may change only title-bar presentation, verified by `src/app/native-policy.test.ts`.
The traffic-light position and undecorated resizing still need checking on each target platform.

## Local storage repair

`local_storage_repair` repairs one category of the stored rows that the Settings integrity counts
report (ADR-0019). The Renderer sends only `{schemaVersion, expectedReadGeneration, repairKind}`, never
a row identity or value; the Host reselects the rows with the read's own predicate in one immediate
transaction, refuses a stale read generation, and answers with the category and a row count. It
quarantines observations and bindings, sets an unreplicated expiry to unknown, or marks an Outbox
commit time; it rewrites no synced history and uses no credential. Settings offers it per non-zero
category only on a writable surface, after a confirmation that names the count and the effect, and
re-reads the counts and republishes the workspace whether or not the call reported a result.

## Local Provider binding

`local_domain_asset_provider_bind` persists an immutable association for an existing asset from
committed Host-verified Cloudflare Zone evidence. It performs no Provider API write and exposes no
credential or resource selector. The concrete adapter implements the required narrow
`PortfolioProviderBindingPort` through its validating wrapper. The broad injected
`LocalBusinessPort` keeps the binding method optional, so read-only adapters need not supply write
capabilities. The DNS page offers "Bind Zone" on a row only when the Host's DNS health read reports
the row `bindable`, and only on a writable surface. The Host computes it with the bind's own
evidence query (`latest_bindable_zone`: a live asset, a committed available Zone of its own name,
seen through the connection's current active credential for that Zone) and the bind's identity rule
for an existing binding (none, or a detached one of the same connection, Zone and name), so a
revoked or invalid credential, a changed credential generation, a paused Zone or an archived asset
is never offered; the Renderer rejects a row that claims bindability over a live binding or without
its own Zone observed; a committed bind republishes the workspace at the receipt generation. A Zone is
observed only through a qualified Cloudflare connection, and connecting is unavailable until
qualification, so the action does not appear yet.
First commit advances Host generation once; replay may return the current generation after
intervening commits.

## Native storage identity

The native Host resolves one fixed `active-workspace/business.db` location beneath Tauri's
application-data directory. It rejects relative roots, symlinked storage roots, symlinked database
files, and non-file database targets; on Unix it restricts the Host-owned database directory to the
owner.

Before reading any Keychain item or opening SQLCipher, the first process acquires an OS-level exclusive
application-data lock. A second process cannot become a refresh or database authority; the
single-instance plugin hands a second launch to the established process. Browser sign-in no longer
arrives through process launches at all (ADR-0011), so there is no startup callback window to buffer.

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
and state remain in Native memory. Following RFC 8252 §7.3 (ADR-0011), each attempt binds a
short-lived HTTP listener on `127.0.0.1` with an OS-chosen port and sends
`http://127.0.0.1:{port}/oauth/callback` as the redirect URI; the browser returns over a plain HTTP
redirect, so no OS URL scheme or browser external-protocol prompt is involved. The listener accepts
only `GET /oauth/callback` with `Host: 127.0.0.1:{port}`, answers anything else with a static page,
ignores callbacks whose state does not match without consuming the attempt, sends the challenge leg on
to the next authorize URL in the same tab, exchanges the code inside the callback, and closes after a
static result page. A new sign-in supersedes a waiting one, and an attempt closes after ten minutes. The short-lived access token remains in
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

The Host strictly consumes the v4 role exchange. Active carries signed `DesktopAuthorizationGrant` v3 and the Host separately verifies its nested
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
fixed `{ "schemaVersion": 4 }` request to `/v1/devices/authorization-grant`, accepts at most 16 KiB
of JSON, parses the strict role envelope, verifies the role-specific signatures and enforces device/account
and monotonic security/Lease floors before installing authority in the same `DesktopLocalHost` aggregate.
Active has both Grant and Lease signatures; Standby has its independent read-only signature and never
activates execution. Production builds use the
embedded `https://api.gooddealer.com/` origin and must embed a strict `GOODDEALER_DESKTOP_AUTHORIZATION_KEYS_JSON` registry containing
one to eight globally purpose-separated keys for each of `grant_v3`, `active_device_lease_v1` and
`standby_grant_v1`. All three purpose rings are mandatory.
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
`../../docs/adr/0023-business-backup-and-recovery.md`.

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


### Device directory and self-name

Settings → Devices reads Cloud's bounded device directory through Native fixed routes. The Renderer
submits only a name; Native supplies the build platform, verifies the current-device identity and
credential-instance fence, and removes signing metadata before IPC. Cloud owns persistence; no local
business database copy is introduced. Unknown save outcomes require a directory read before another
save. Ordinary business replication preserves unsaved edits. The current Native admission still
requires Active authority; this does not enable Standby login, handoff or bootstrap.


Afternic create/update now uses the same private Service and serial Provider lane as inventory and
delist. The batch screen stores a bounded preview, approves its immutable hash once and reads durable
plan history. Only a single committed claim permits POST/PATCH; every uncertain response or restart
uses authenticated GET reconciliation. Matched fields remain separate from provider review and
ownership states. See [the current implementation](../../docs/CURRENT_IMPLEMENTATION.md) and
[the review](../../docs/reviews/2026-11-19-afternic-listing-write-review.md) for source evidence and
the outstanding real-account, verification/DNS and target-platform qualifications.
