# Secure Host Core

## Purpose

`gooddealer-secure-host-core` owns three separate Host capabilities: the Desktop SQLCipher key lifecycle, sealed local backup export, and read-only Cloudflare Zone/DNS observation. Their state, credentials, audiences, purposes, fences, and transports are intentionally disjoint. No capability can admit or convert authority held by another.

## Principles

- MUST: Let public Cloudflare callers provide only a validated non-secret `connectionId` and one exact 32-character lowercase hexadecimal `zoneId`; emit the Protocol-owned Host-local observation envelope with rebuilt Zone/DNS data or one of its five public unavailable codes, while local policy denial never becomes wire data and the envelope never becomes Cloud/Sync input directly.
- MUST: Keep token bytes in private zeroizing Host state and check the complete connection, Zone, purpose, permission, generation, and token-replacement fence around every asynchronous boundary.
- MUST: Bound and strictly parse Provider data before publication; discard the whole observation after any request, page, decode, validation, or fence failure.
- MUST: Keep the GoodDealer-private Cloudflare Service as the only runtime owner of Zone/DNS endpoint, Provider wire, credentials, transport, errors, and domain mapping.
- MUST: Keep the fixed-purpose Desktop SQLCipher key in the OS credential store and zeroize Host key material when it leaves scope.

## Boundaries

- Does NOT handle: Caller-selected network authority; Cloudflare transport fixes HTTPS at `api.cloudflare.com:443`, the selected Zone metadata path, four record types with at most nine pages per type and 12 DNS GET requests total plus one Zone GET, an empty body, no redirect, no environment proxy, explicitly disabled reqwest retries, platform hostname verification, and bounded time. (see: src/cloudflare_transport.rs)
- Does NOT handle: Unbounded Provider data; responses, aggregate bytes, requests, records, content, JSON nodes, and JSON depth all have fixed caps. (see: src/cloudflare_operation.rs)
- Does NOT handle: Production-selectable test authority or real-provider qualification; controlled credential and transport scripts exist only under private `cfg(test)` code. (see: src/cloudflare_operation.rs)
- Does NOT handle: Reuse of sealed backup HTTP, session, credential, cookie-audience, or Host state, or native Cloudflare secret provisioning. (see: src/cloudflare_credential.rs)
- Does NOT handle: Generic Provider execution or private Provider types crossing the Host boundary; Provider protocol code remains private and is rebuilt into the public contracts below. (see: src/cloudflare_provider.rs)

## Adversarial Surfaces

- **Secret and diagnostic disclosure**: Tokens, Authorization material, URLs, headers, bodies, identifiers, and provider diagnostics cannot enter public errors or formatting. Verified by: `src/cloudflare_operation.rs` tests and `tests/public_surface.rs`.
- **Connection, Zone, purpose, permission, or generation substitution**: The complete private credential fence is checked before every request and after every await/decode. Verified by: `src/cloudflare_operation.rs` tests.
- **Origin, path, method, proxy, redirect, and retry confusion**: A private closed request enum and production client policy fix all network authority. Verified by: `src/cloudflare_transport.rs` policy tests.
- **Untrusted or exhausting provider data**: Response, aggregate, request, page, record, string, JSON node, and JSON depth bounds fail closed; IDs, types, timestamps, pagination, duplicates, and Zone bindings are validated. Verified by: `src/cloudflare_operation.rs` tests.
- **Partial observation publication**: Every logical read and final fence check must succeed before an observation is constructed. Verified by: `src/cloudflare_operation.rs` tests.
- **Backup, session, and cookie authority confusion**: Cloudflare production modules do not import or accept sealed backup/session/credential/Host-state types. Verified by: source review of `src/cloudflare_credential.rs`, `src/cloudflare_operation.rs`, and `src/cloudflare_transport.rs`; the sole `backup_operation::SecureHost` reference is the owning public Host type, not backup authority admission.
- **Local database key disclosure or replacement**: SQLCipher key material is redacted, length-checked, purpose-isolated in the OS credential store, and generated only through the native CSPRNG. Existing database detection and missing-key rejection remain the Desktop Host's responsibility. Verified by: `src/local_database_key.rs` and `../../apps/desktop/src-tauri/src/host_storage.rs` tests.

## Contracts

- **CloudflareObservationSubmitRequest** (defined in: src/cloudflare_operation.rs): Rust binding of the Protocol-owned exact schema-version-1 Host-local submission envelope; its connection identity remains local and parity consumes the Protocol golden corpus. Consumers: tests/public_surface.rs.
- **CloudflareZoneReadIntent** (defined in: src/cloudflare_operation.rs): Public non-secret Host-local selection for one Zone/DNS observation. Consumers: tests/public_surface.rs.
- **CloudflareCredentialFence** (defined in: src/cloudflare_credential.rs): Private exact connection, single-Zone, purpose, permission, generation, and zeroizing-token admission. Consumers: src/cloudflare_operation.rs.
- **CloudflareEndpoint** (defined in: src/cloudflare_provider.rs): Private GoodDealer-owned Zone/DNS endpoint selector; the same module owns the Provider wire definitions consumed only by the operation and hardened transport. Consumers: src/cloudflare_operation.rs, src/cloudflare_transport.rs.

## Open Questions

- [ ] Which downstream C2 owner will compose native Cloudflare secret provisioning after this boundary is frozen? (open since: 2026-08)
