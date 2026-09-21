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
- MUST: Keep Grant and Lease transcripts, keys, key versions, policies and receipts purpose-separated.
- MUST: Verify every externally produced signature against exact canonical claims and a trusted Ed25519 public key before publishing or committing authority.
- MUST: Reverify every persisted Lease against the purpose-specific trusted key registry and its locked relational columns before reuse or Grant embedding.
- MUST: Allocate the first authenticated Desktop Lease from the account-wide monotonic epoch domain; repeated same-device login reuses or renews that epoch, while another held device fails closed.
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
- **Lease signing and active-device contention**: inactive entitlement, signer refusal, invalid returned signatures, stale security epochs, another held device, and repeated login cannot create a session with missing or conflicting Lease authority. Verified by: `../../../test/postgres/desktop-oauth.test.ts`.
- **Grant authority time crossing and substitution**: final Grant issuance consumes the authenticated Desktop credential through `IdentityCapabilityTransactionRunner` with the `devices_account` purpose, then resolves and locks the exact personal-default Workspace binding in that same account transaction as account security, session, refresh family, device binding, commercial authority and Lease authority. A missing/revoked credential fails closed before signing. After the external signer returns, a `clock_timestamp()` check revalidates the session deadline, online Lease deadline and every critical state before publication; concurrent revocation/binding/Lease changes therefore serialize on the documented lock order, and legacy unsigned Lease rows fail closed. Verified by: `../../../test/postgres-desktop-authorization-service.test.ts`, `../../../test/default-workspace-resolver.test.ts`, and `../../../test/postgres/desktop-oauth.test.ts`.

## Contracts

- **DesktopAuthorizationGrantSigner** (defined in: authorization-grant-issuer.ts): Purpose-specific signer port whose returned envelope is independently verified by the issuer. Consumers: `authorization-grant-issuer.ts`, `../../entrypoints/openbao-transit-signer.ts`.
- **ActiveDeviceLeaseSigner** (defined in: postgres-bootstrap-activation.ts): Purpose-specific Lease signer port whose returned envelope is verified before persistence. Consumers: `postgres-bootstrap-activation.ts`, `index.ts`, `../../entrypoints/openbao-transit-signer.ts`.
- **DeviceLoginProofPort** (defined in: ports.ts): Device-owned challenge, first-binding, proof-consumption, and exchange-time eligibility boundary. Consumers: `postgres-device-login-proof.ts`, `../identity/postgres-desktop-oauth.ts`.
- **DesktopLoginLeasePort** (defined in: postgres-desktop-login-lease.ts): Device-owned first issuance and same-device renewal boundary invoked before Desktop session creation. Consumers: `postgres-desktop-login-lease.ts`, `../identity/postgres-desktop-oauth.ts`.
- **ActiveDeviceLeaseVerifier** (defined in: active-device-lease-verifier.ts): Purpose-specific trusted-key verification for every persisted or newly signed Lease. Consumers: `postgres-desktop-login-lease.ts`, `postgres-desktop-authorization.ts`, `../../entrypoints/http.ts`, `../../entrypoints/desktop-oauth-http.ts`, `../../entrypoints/development-server.ts`.

## Open Questions

- [ ] Which production OpenBao cluster identity, namespace, Transit mount, key versions, approved public keys, workload-auth method and seal backend will the accountable operators record during external qualification? (open since: 2026-09)
