# Devices

## Role

Cloud capability that governs device binding, switching, leases, bootstrap, and Desktop authorization grants.

## Owns

- Device authority, login-proof admission, ActiveDeviceLease lifecycle, and grant issuance rules.
- Purpose-specific signing ports and verification of returned Grant and Lease signatures.

## Touchpoints

- Consumes authenticated transaction capabilities from `../identity` and commercial deadlines from `../licensing`.
- Supplies Desktop authorization through Cloud entrypoints and purpose-specific OpenBao adapters.
- Resolves the account-owned personal workspace through `../workspace/default-workspace`.

## Change Guide

- Change device and lease rules in this module; keep signer transport and private-key custody in Cloud entrypoints.
- Preserve trusted account, workspace, device, epoch, and deadline derivation across every new flow.
- Verify signature, persistence, OAuth, and authorization-service tests for any authority change.

## Purpose

Own Cloud account/device authority, device switching, Bootstrap, ActiveDeviceLease and Desktop
authorization Grant rules. Private signing operations are supplied only through purpose-specific
ports; HTTP and OpenBao transport remain in Cloud entrypoints.

## Principles

- MUST: Derive account, workspace and device authority from authenticated server state and locked persistence, never from caller-selected identifiers.
- MUST: Keep Active Grant, Standby Grant and Lease transcripts, keys, key versions, policies and receipts purpose-separated.
- MUST: Verify every externally produced signature against exact canonical claims and a trusted Ed25519 public key before publishing or committing authority.
- MUST: Reverify every persisted Lease against the purpose-specific trusted key registry and its locked relational columns before reuse or Grant embedding.
- MUST: Allocate the first authenticated Desktop Lease from the account-wide monotonic epoch domain; repeated same-device login reuses or renews that epoch, while another eligible device receives a Standby session without a new Lease.
- MUST: Before login/refresh allocation, atomically terminate expired default-workspace bootstrap authority through `PostgresExpiredDeviceBootstrap`: burn its pending epoch, consume its capability/nonces, clear the next step, release the checkpoint pin through its owner port, and fail the workflow. Keep the epoch high-water mark and historical rows. Missing or inconsistent authority fails closed; the ordinary allocation guard remains mandatory.
- MUST: Recheck bootstrap capability/workflow/pin deadlines using the database current clock after signer or workspace I/O, before committing activation or a step.
- MUST: Never allocate a Lease at login or refresh while a switch workflow is unfinished, an epoch allocation is pending, or execution is blocked; the Lease step answers `standby` instead (ADR-0032 Standby S1), and the routine `device_lease_allocation_reserved` reads the workspace-scoped workflows for the caller's account alone.
- MUST: Bound each Lease by the Licensing-owned active commercial or grace deadline and the independent 24-hour execution maximum; Licensing projection-refresh scheduling metadata cannot shorten paid eligibility.
- MUST: Issue Desktop OAuth codes only after an account-scoped, short-lived challenge proves possession of the exact active device key; first binding additionally requires a recent password/passkey Account Web authentication, the same Web session across both browser legs, a self-signature by the proposed key, and an available device slot.
- MUST NOT: Put private keys, OpenBao tokens, AppRole SecretIDs or general key-management authority in this module, logs, errors or persistence.

## Boundaries

- Does NOT handle: OpenBao HTTP/authentication, key creation/rotation, production provisioning or deployment qualification. (see: `../../entrypoints/openbao-transit-signer.ts`)
- Does NOT handle: Treating the local OpenBao adapter as authority to enable production factories before device-session binding and external signer custody are explicitly composed and qualified. (see: `index.ts`)
- Does NOT handle: Operating the isolated development OpenBao instance. (see: `../../../../../docs/DEVELOPMENT_OPENBAO.md`)

## Adversarial Surfaces

- **Signer substitution**: Signer-returned claims, `kid`, signature and verification key cannot alter requested authority or bypass local Ed25519 verification. Verified by: `../../../test/authorization-grant-issuer.test.ts`.
- **OpenBao response and credential abuse**: Insecure origins, duplicate key names/IDs/material, unexpected token policies, wrong key versions, malformed signatures and oversized/invalid responses fail closed without credential diagnostics; non-success bodies are cancelled, and a 401/403 invalidates only the rejected cached AppRole token before retrying once after reauthentication. Verified by: `../../../test/openbao-transit-signer.test.ts` and `../../../test/openbao-approle-token-source.test.ts`.
- **Desktop device, Web session, or PKCE substitution**: the login proof transcript binds account, device, key, challenge, PKCE challenge, client, redirect, nonce digest and expiry; the persisted challenge also binds a digest of the initiating Account Web session, and first enrollment expires no later than the five-minute password/passkey reauthentication window. Only exact evidence can be atomically consumed with OAuth code issuance. Verified by: `../../../test/device-login-proof.test.ts`, `../../../test/desktop-oauth-pkce.test.ts`, and `../../../test/postgres/desktop-oauth.test.ts`.
- **Lease signing and active-device contention**: signer refusal, invalid returned signatures and stale security epochs fail closed. Inactive entitlement or another held device admits only Standby; repeated login cannot allocate conflicting Lease authority. Verified by: `../../../test/postgres/desktop-oauth.test.ts`.
- **Grant authority time crossing and substitution**: final Grant issuance consumes the authenticated Desktop credential through `IdentityCapabilityTransactionRunner` with the `devices_account` purpose, then resolves and locks the exact personal-default Workspace binding in that same account transaction as account security, session, refresh family, device binding, commercial authority and Lease authority. A missing/revoked credential fails closed before signing. After the external signer returns, a `clock_timestamp()` check revalidates the session deadline, online Lease deadline and every critical state before publication; concurrent revocation/binding/Lease changes therefore serialize on the documented lock order, and legacy unsigned Lease rows fail closed. Verified by: `../../../test/postgres-desktop-authorization-service.test.ts`, `../../../test/default-workspace-resolver.test.ts`, and `../../../test/postgres/desktop-oauth.test.ts`.

## Contracts

- **DesktopAuthorizationGrantSigner** (defined in: authorization-grant-issuer.ts): Purpose-specific signer port whose returned envelope is independently verified by the issuer. Consumers: `authorization-grant-issuer.ts`, `../../entrypoints/openbao-transit-signer.ts`.
- **ActiveDeviceLeaseSigner** (defined in: postgres-bootstrap-activation.ts): Purpose-specific Lease signer port whose returned envelope is verified before persistence. Consumers: `postgres-bootstrap-activation.ts`, `index.ts`, `../../entrypoints/openbao-transit-signer.ts`.
- **DeviceLoginProofPort** (defined in: ports.ts): Device-owned challenge, first-binding, proof-consumption, and exchange-time eligibility boundary. Consumers: `postgres-device-login-proof.ts`, `../identity/postgres-desktop-oauth.ts`.
- **DeviceSwitchApplicationPort** (defined in: switch-application.ts): Desktop normal switch request, status, cancel and drain-proof submission (the source device's Ed25519 drain proof, verified against its active key and admitted by the owner routine `device_record_drain_proof`, hands the switch to bootstrap); the caller is the session device holding the workspace's current Lease, never a body field, and forced takeover remains refused until its workflow and target bootstrap are composed (ADR-0032). Consumers: `../../entrypoints/routes/public/boundary.ts`, `../../entrypoints/http.ts`.
- **DesktopLoginLeasePort** (defined in: postgres-desktop-login-lease.ts): Device-owned first issuance and same-device renewal boundary invoked before Desktop session creation. Consumers: `postgres-desktop-login-lease.ts`, `../identity/postgres-desktop-oauth.ts`.
- **ActiveDeviceLeaseVerifier** (defined in: active-device-lease-verifier.ts): Purpose-specific trusted-key verification for every persisted or newly signed Lease. Consumers: `postgres-desktop-login-lease.ts`, `postgres-desktop-authorization.ts`, `../../entrypoints/http.ts`, `../../entrypoints/desktop-oauth-http.ts`, `../../entrypoints/development-server.ts`.

## Open Questions

- [ ] Which production OpenBao cluster identity, namespace, Transit mount, key versions, approved public keys, workload-auth method and seal backend will the accountable operators record during external qualification? (open since: 2026-09)


## Desktop device directory

`PostgresDeviceDirectory` owns list and self-report persistence. It derives the account/device from
an authenticated Desktop session, locks security/account state before session/family/binding/active
key, and refuses removed bindings or inactive signing keys. Names/platforms reuse the self-report
migration; reports advance the list revision only when metadata changes. Native supplies platform,
projects away signing metadata, and composes the settings list and self-name form. Directory roles
are descriptive and never authorize handoff. PostgreSQL evidence lives in
`../../../test/postgres/device-directory-persistence.test.ts`.

## Standby authorization exchange

The HTTP exchange accepts only `{schemaVersion:5}` and returns the strict `active`/`standby`
discriminated response. `DesktopStandbyGrantIssuer` independently verifies exact claims and the
Standby signature transcript; its OpenBao Transit keyring is required and distinct from both Active
Grant and Lease rings. Standby lasts at most 900 seconds and carries only `workspace:read`.

`readDesktopSessionAuthority` locks normal account security, the live Desktop session/refresh
family, the exact personal-default binding, account epoch state, bound device and active key, and
current Lease allocation. A current holder with an expired or stale Lease is denied instead of
reinterpreted as Standby. Eligible nonholders need no commercial entitlement. OAuth and refresh
preserve their normal proof, code-consumption and token-rotation guarantees for Standby sessions.

The Standby floor is the account's highest allocated epoch. The exact live bootstrap target alone
receives pending epoch minus one after matching its workflow, bound key version/security epoch,
active binding and unconsumed capability; malformed pending state fails closed. This reserves the
epoch already allocated for that target while every other device burns it as a floor.

Every Desktop route declares a role requirement and is independently gated. Standby can exchange
its grant, list devices, read switch status and pull/read checkpoints or a rebootstrap plan. Switch
request/cancel routes permit role admission, but their application still rejects unsupported
Standby operations. Sync push/receipts, observation, drain and self-report require Active; directory
list does not grant rename authority. Provider execution, target bootstrap, forced takeover and
new-machine restore are not implied by this read-only exchange.

Tests: `../../../test/standby-grant-issuer.test.ts`, `../../../test/desktop-session-authority.test.ts`,
`../../../test/postgres/desktop-oauth.test.ts` and the route/sync suites cover purpose substitution,
real second-device login/refresh, entitlement-independent Standby, pending floors and write denial.
Real OpenBao provisioning and Windows/macOS double-device qualification remain external evidence.

## Normal handoff receipt

The switch view is version 2; request, response wrapper and device-list versions remain 1. Every
view explicitly includes nullable `normalHandoffReceipt`. PostgreSQL derives a receipt in the same
snapshot from exactly one consumed/accepted handoff proof, its normal device-switch workflow,
matching source/epoch Lease released for `normal_handoff`, and the existing capability's exact
target and issuance time. All handoff timestamps must match; malformed or ambiguous history cannot
assert success. Later bootstrap completion/failure preserves the receipt. Workflow status alone and
in-memory fixtures never attest durable handoff. Forced workflows receive no normal receipt.

The historical receipt carries the source Lease epoch, proof ID/digest and release time. Native must
match it to its own persisted attempt and latest local Active epoch before deciding Inbox eligibility;
it grants no new Lease or mutation permission. The real OAuth `desktop_login` allocation is admitted
for a new normal switch only through the account's exact personal-default binding; it cannot choose
an arbitrary workspace. PostgreSQL coverage is beside switch request/drain persistence and OAuth.

Active authorization uses Grant v4 and commercialAuthority v2. Capabilities are the strict, sorted,
unique intersection of the locked Licensing featureEntitlements with the closed Provider set.
An empty set preserves local business scopes without Provider permission; Afternic write without
observe is rejected. The existing logical Grant signing purpose `.v3` and `grant_v3` key registry
remain stable; the v4 wire and transcript domain distinguish the payload, not a fourth key purpose.
