# Cloudflare connector contracts

## Purpose

This package defines the non-secret, read-only Host intent and local-error boundary for observing one selected Cloudflare Zone and its A, AAAA, CNAME, and TXT DNS records. It performs no provider I/O. The public observation envelope and its parser are owned by `@gooddealer/protocol` and are only re-exported here.

The private Rust Cloudflare Service owns and maintains its Zone/DNS endpoint and Provider wire implementations. Those private Provider types are not dependencies or exports of this TypeScript package and never cross the Host boundary.

## Principles

- MUST: Own only validated `CloudflareZoneReadIntent` and Host-local observation errors; consume and re-export the Protocol-owned Host-local observation contract.
- MUST: Keep `connectionId` and the complete observation envelope in the local Host/data plane; Cloud receives only allowlisted business fields rebuilt through the local Sync Outbox.
- MUST: Parse from `unknown`, accept only exact own enumerable data fields, apply descriptor-safe bounded traversal, and rebuild each result.
- MUST: Apply the Protocol-owned hostile-input parser before exposing an observation envelope.

## Boundaries

- Does NOT handle: Runtime registration, provider adapters, network methods, credential or token references, or arbitrary request fields. (see: `src/index.ts`)
- Does NOT handle: Writes, browser fallback, backup authority, sessions, or cookies. (see: `src/cloudflare-contracts.ts`)
- Does NOT handle: Cloud submission, Cloud persistence, or Sync Outbox projection. (see: `../../cloud-client/README.md`)
- Does NOT handle: Additive provider passthrough; a record type, status, error code, field, bound, or authority requires a coordinated contract change. (see: `src/cloudflare-contracts.ts`)

## Adversarial Surfaces

- **Secret and execution authority injection**: Caller-supplied credential, request, adapter, provider, proxy, redirect, browser, write, backup, session, and cookie fields are rejected at any depth. Verified by: `test/cloudflare-contracts.test.ts`.
- **Malformed object traversal**: Accessors, custom prototypes, symbols, cycles, sparse arrays, excessive depth/nodes/bytes, and unknown fields fail closed without evaluating attacker-controlled getters. Verified by: `test/cloudflare-contracts.test.ts`.
- **Provider data confusion**: Invalid identifiers, enums, FQDNs, addresses, TXT content, timestamps, TTLs, duplicates, and noncanonical record ordering are rejected. Verified by: `test/cloudflare-contracts.test.ts`.
- **Authority surface regression**: The package export and source dependency closures exclude obsolete write, fixture registration, generic connector, protocol, network, and secret APIs. Verified by: `test/public-surface.test.ts`.

## Contracts

- **CloudflareZoneReadIntent** (defined in: src/cloudflare-contracts.ts): Identifies one Host-owned connection and one exact 32-character lowercase hexadecimal Zone without carrying credential or transport authority. Consumers: src/index.ts, test/cloudflare-contracts.test.ts.
- **CloudflareObservationSubmitRequest** (defined in: ../../protocol/src/connectors/index.ts): Host-local Zone/DNS observation envelope, imported and re-exported without reinterpretation; its `connectionId` is never a Sync/Cloud field. Consumers: src/cloudflare-contracts.ts, src/index.ts.
- **CloudflareObservationError** (defined in: src/cloudflare-contracts.ts): Carries only Host-local denied/provider diagnostic classifications and a tightly constrained retry delay; it is not a Cloud protocol vocabulary. Consumers: src/index.ts, test/cloudflare-contracts.test.ts.

## Open Questions

- [ ] Which downstream local-storage/Desktop owner will first compose this frozen Host-local contract after its separate gates are satisfied? (open since: 2026-08)
