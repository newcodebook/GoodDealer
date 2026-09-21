# Secure Host Core

## Role

Native non-storage security boundary for Desktop identity custody, authorization verification, and Provider observation.

## Owns

- Native OAuth, device identity, refresh-token custody, and purpose-specific Grant and Lease verification.
- Cloudflare credential custody, hardened read-only Provider transport, and sanitized Zone/DNS observation.

## Touchpoints

- Receives complete Host-issued plans from `../local-storage` without taking local database or backup ownership.
- Is composed only by native Desktop code under `../../apps/desktop/src-tauri`.
- Consumes fixed Cloud authorization and Cloudflare network boundaries without exposing secrets to Renderer code.

## Change Guide

- Keep credentials, provider wire types, and transport diagnostics private and zeroizing.
- Preserve purpose separation, exact tuple checks, bounded parsing, and before/after authority fences.
- Verify crate tests, public-surface tests, and affected Tauri orchestration tests after changes.

## Purpose

`gooddealer-secure-host-core` owns the non-storage native capabilities: native Desktop OAuth and device-identity custody, purpose-specific Desktop authorization signature verification, and read-only Cloudflare Zone/DNS observation. Their state, credentials, audiences, purposes, fences, and transports are intentionally disjoint. No capability can admit or convert authority held by another. The SQLCipher database key and every local backup capability belong to the `gooddealer-local-storage` Desktop Local Host aggregate.

## Principles

- MUST: Verify Desktop authorization only with an immutable, purpose-specific Ed25519 public-key registry; unknown, malformed, globally duplicate ID/material, or revoked-by-omission keys fail closed.
- MUST: Let the private Native Provider orchestrator forward only borrowed Host plans containing the complete public tuple; Zone and token values come only from native capture or the purpose-specific Keychain envelope and never cross IPC.
- MUST: Keep token bytes in private zeroizing Host state, borrow the Keychain envelope across Provider awaits without cloning token or Zone strings, and check Host authority before and after every asynchronous boundary.
- MUST: Keep Cloudflare credential envelopes crate-private and use schema v3 with the exact provider/capability/kind/incarnation/connection/generation/scope/zone/public-proof tuple. Publish only from a Host-issued non-Clone prewrite-inspection handle through a non-synchronizable Data Protection Keychain item protected by `AccessibleWhenUnlockedThisDeviceOnly` (Security.framework `pdmn=aku`) and the signed GoodDealer application access group. Serialize exact-base/explicit-target publication across processes with the fixed per-user `/private/tmp/app.gooddealer.desktop.cloudflare-dns-keychain-cas-v1-<uid>` lock directory. Under that lock, exact B alone may invoke the Host marker; mismatch/malformed/unreadable B invokes synchronous Host remediation with no OS write. After the marker, write/read-back/immediate resolution drains without cancellation while the same lock remains held. Reject owner, mode, link, item-data, synchronization, exact protection-domain, ACL, or tuple drift.
- MUST: Bound and strictly parse Provider data before publication; discard the whole observation after any request, page, decode, validation, or fence failure.
- MUST: Keep the GoodDealer-private Cloudflare Service as the only runtime owner of Zone/DNS endpoint, Provider wire, credentials, transport, errors, and domain mapping.
- MUST: Keep PKCE verifier/state and access tokens in Native memory, store only the validated refresh token plus its pending rotation request identity in one purpose-isolated OS credential record, and expose neither through Renderer IPC or diagnostics.
- MUST: Keep the stable device ID, Key ID and Ed25519 seed in a separate OS credential item; sign only the fixed Desktop login-proof transcript and never expose a generic signing primitive.
- MUST: Parse the build-pinned Grant/Lease public-key registry strictly and require both purposes; rotation uses an overlapping allowlist in a signed/notarized Desktop release before Cloud switches signing keys.

## Boundaries

- Does NOT handle: Caller-selected network authority; the sole Provider stack fixes HTTPS at `api.cloudflare.com`, exact GET-only Zone/DNS paths, four record types with at most nine pages per type and 37 total requests, no redirect, no environment proxy, explicitly disabled reqwest retries, platform hostname verification, and bounded time. (see: src/cloudflare_provider.rs)
- Does NOT handle: Unbounded Provider data; response bytes, requests, records, content, JSON nodes, and JSON depth all have fixed caps. (see: src/cloudflare_provider.rs)
- Does NOT handle: Production-selectable test authority or real-provider qualification; controlled transport scripts exist only under private `cfg(test)` code. (see: src/cloudflare_provider.rs)
- Does NOT handle: Reuse of OAuth session, credential, cookie-audience, or generic Host state as Cloudflare authority. Native capture and purpose-specific Keychain custody are the only credential sources. (see: src/cloudflare_capture.rs, src/cloudflare_keychain.rs)
- Does NOT handle: Generic Provider execution or private request/response/transport types crossing the Host boundary. (see: src/cloudflare_provider.rs)
- Does NOT handle: Any local backup authority, GDBK parsing/sealing, Backup KEK custody or rollback anchor, native backup handle/journal, backup projection/candidate, or current-database restore. These are private to `gooddealer-local-storage`; no backup dependency or bridge crosses between the sibling crates. (see: `../../docs/adr/0023-installation-bound-gdbk-backup-and-honest-business-restore.md`)

## Adversarial Surfaces

- **Authorization key and transcript substitution**: only registered Ed25519 keys verify the exact purpose-separated Grant or Lease transcript. Verified by: `src/desktop_authorization_verifier.rs` tests.
- **Secret and diagnostic disclosure**: Tokens, Authorization material, headers, bodies, and provider diagnostics cannot enter public errors or formatting. Verified by: `src/cloudflare_provider.rs` tests and `tests/public_surface.rs`.
- **Connection, incarnation, scope, Zone, proof, kind, or generation substitution**: strict v3 envelope inspection and stored-credential observation compare the complete Host tuple; Provider reads borrow only the admitted envelope. Verified by: `src/cloudflare_keychain.rs` and `src/cloudflare_provider.rs` tests.
- **Keychain CAS race, rollback, and ACL substitution**: the full read-check-write-readback transition is serialized across processes by a stable, owner-only kernel file lock; credential bytes and strict non-sync, ThisDeviceOnly, access-control, and designated-application attributes must read back exactly, while token-bearing envelopes and buffers remain private and zeroizing. Verified by: `src/cloudflare_keychain.rs` tests.
- **Prewrite contradiction loss**: Secure Host accepts only the opaque post-COMMIT inspection handle. Exact missing custody is allowed only when Host expected absence; all other mismatch/malformed/unreadable custody paths invoke remediation under the lock and cannot reach marker/write. Verified by: `src/cloudflare_keychain.rs` tests.
- **Origin, path, method, proxy, redirect, and retry confusion**: the private closed request enum and production client policy live in the single Provider module. Verified by: `src/cloudflare_provider.rs` tests.
- **Untrusted or exhausting provider data**: response, page, record, string, JSON node, and JSON depth bounds fail closed; IDs, types, timestamps, pagination, duplicates, and Zone bindings are validated. Verified by: `src/cloudflare_provider.rs` tests.
- **Partial observation publication**: every logical read and final fence check must succeed before an observation is constructed. Verified by: `src/cloudflare_provider.rs` tests.
- **Backup authority confusion**: Secure Host exports no backup type, dependency, parser, key, handle, candidate, or restore callback; backup code is confined to `gooddealer-local-storage` and Desktop only invokes its redacted aggregate facade. Verified by: `tests/public_surface.rs`, local-storage public-surface tests, and source scan of the sibling crates.
- **OAuth redirect, state, or credential substitution**: the Cloud origin, client, callback, S256 challenge, exact query fields, opaque token formats, and Keychain purpose are fixed and strictly checked; all secret-bearing debug output is redacted. Verified by: `src/desktop_oauth.rs` and `../../apps/desktop/src-tauri/src/oauth_runtime.rs` tests.
- **Refresh response loss**: the refresh token and one unpredictable logical-rotation request identity share an exact Keychain record, allowing restart to repeat the same outcome-unknown request without presenting a new identity or exposing either value. Verified by: `src/desktop_oauth.rs` tests.
- **Device proof substitution**: the challenge callback must match the pending state, local device and local key before the purpose-fixed Ed25519 transcript can be signed. Verified by: `src/desktop_device_identity.rs` and `src/desktop_oauth.rs` tests.
- **Authorization registry substitution**: build-pinned registry JSON rejects unknown fields, malformed/duplicate keys, missing purposes and oversized input; unknown or revoked-by-omission `kid` values fail closed. Verified by: `src/desktop_authorization_verifier.rs` tests.

## Contracts

- **DesktopOAuthAttempt** (defined in: src/desktop_oauth.rs): native-only PKCE verifier/state and exact callback admission. Consumers: `../../apps/desktop/src-tauri/src/oauth_runtime.rs`.
- **DesktopDeviceIdentity** (defined in: src/desktop_device_identity.rs): purpose-isolated Keychain identity that can sign only Desktop login-proof transcripts. Consumers: `src/desktop_oauth.rs`, `../../apps/desktop/src-tauri/src/oauth_runtime.rs`.
- **DesktopAccessToken** (defined in: src/desktop_oauth.rs): strictly validated zeroizing memory-only access credential. Consumers: `../../apps/desktop/src-tauri/src/oauth_runtime.rs`.
- **DesktopRefreshToken** (defined in: src/desktop_oauth.rs): strictly validated zeroizing refresh credential admitted to purpose-isolated OS custody. Consumers: `../../apps/desktop/src-tauri/src/oauth_runtime.rs`.
- **DesktopRefreshRequestId** (defined in: src/desktop_oauth.rs): unpredictable, redacted identity durably paired with the presented refresh token until one logical rotation reaches a known result. Consumers: `../../apps/desktop/src-tauri/src/oauth_runtime.rs`.
- **CloudflareCredentialProvisionPlan / CloudflareCredentialObservationPlan** (defined in: src/cloudflare_keychain.rs and src/cloudflare_provider.rs): Borrow-only interfaces through which the private Tauri orchestrator forwards Host-owned public tuples without constructing an owned all-fields DTO.
- **CloudflareEndpoint** (defined in: src/cloudflare_provider.rs): Private GoodDealer-owned Zone/DNS endpoint selector; the same module owns the sole hardened transport and Provider wire definitions.
- **CloudflareProviderClient** (defined in: src/cloudflare_provider.rs): Public closed Provider reader whose only production inputs are native-captured or complete-tuple-checked Keychain credentials; its request, response, method, and transport types remain crate-private. Consumer: `../../apps/desktop/src-tauri/src/provider_credential_orchestrator.rs`.
- **VerifiedLocalWorkspaceBindingParams** (defined in: src/local_workspace_binding.rs): Single validated constructor input for server-verified workspace authority, avoiding positional epoch, digest, and deadline confusion. Consumers: `../../apps/desktop/src-tauri/src/command_handlers.rs`, `../../apps/desktop/src-tauri/src/oauth_runtime.rs`.

## Open Questions

- [x] Native Cloudflare secret provisioning is composed through the private Tauri Provider credential orchestrator; customer availability still requires Renderer and external Provider/native qualification. (open since: 2026-08)

## Backup Separation

This crate has no backup implementation or backup dependency. It neither exposes nor consumes backup
authority, containers, keys, rollback anchors, file handles, journals, projections, candidates, or restore
operations. The complete backup boundary is documented by
`../local-storage/README.md` and
`../../docs/adr/0023-installation-bound-gdbk-backup-and-honest-business-restore.md`.
