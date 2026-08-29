# GoodDealer Desktop

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
- **Authorization bypass**: Local availability cannot mint or extend account, entitlement, Lease, or Epoch authority. Verified by: `LocalBusinessRuntime` authorization tests.

## Open Questions

- [ ] Which native Cloud transport and signing-key distribution implementation will satisfy the purpose-specific ActiveDeviceLease verifier port? Until it is qualified, production remains authorization-required. (open since: 2026-08)

## Native commands

The `local-app` WebView has exactly three reviewed commands:

- `local_business_status`
- `local_portfolio_read`
- `local_domain_asset_upsert`

No command accepts a database path, database key, SQL, account/workspace selector, Provider account,
credential, URL, or Cloud Repository. `LocalBusinessRuntime` starts authorization-required and may
only be activated by trusted native authorization composition.

DomainAsset upsert commits the local business row and a secret-free Sync Outbox entry in one
SQLCipher transaction. Portfolio reads return the local snapshot. Cloud transport is absent from
both command implementations and the regression suite proves local read/write without it.

## Native storage identity

The native Host resolves one fixed `active-workspace/business.db` location beneath Tauri's
application-data directory. It rejects relative roots, symlinked storage roots, symlinked database
files, and non-file database targets; on Unix it restricts the Host-owned database directory to the
owner.

On macOS, the Host reads the 32-byte SQLCipher key from the user's OS Keychain and generates it with
the operating system CSPRNG only when no database exists. If an existing database loses its
Keychain item, startup fails closed instead of creating a replacement key. Keychain failures,
malformed key material, and wrong SQLCipher keys expose only stable non-secret error codes. Other
platform keychain adapters remain fail-closed until their native implementations are qualified.

## Secret boundary

Third-party account identity, Provider Account ID, account labels, credential bindings, API keys,
tokens, cookies, passwords, 2FA, browser profiles, and database key material stay in the local Host
boundary. They never enter Renderer state, IPC requests, sync mutations, Cloud, logs, errors, or
ordinary audit payloads.

## Authorization

Account, subscription/entitlement, device binding, and ActiveDeviceLease/Epoch remain Cloud control
plane facts. Invalid authorization keeps the runtime locked. A valid cached grant may permit local
business work only for its defined offline window; Desktop cannot extend that window itself.

The Host strictly consumes the frozen `DesktopAuthorizationGrant` shape and requires a separate,
purpose-specific signature verifier before producing an `AuthorizedWorkspace`. It binds the grant
to the expected account, device, Account Security Epoch, Lease Epoch, personal default Workspace,
and exact read/mutate scopes. Parsing never proves the signature. Every status, Portfolio read, and
DomainAsset write rechecks the trusted Host clock against `offlineExecuteUntil`; equality is expired.
Workspace or authority substitution is rejected before the SQLCipher Repository is replaced.

## Verification

```sh
pnpm --filter @gooddealer/desktop typecheck
pnpm --filter @gooddealer/desktop test
cargo test -p gooddealer-desktop-tauri
node --test scripts/tauri-command-policy.test.mjs
```
