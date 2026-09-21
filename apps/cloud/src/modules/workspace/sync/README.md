# Workspace Sync and Cloudflare Observation Ingress

## Role

Cloud workspace data-plane capability for authenticated synchronization and Cloudflare observation ingress.

## Owns

- Workspace Push, Pull, and Checkpoint application adapters.
- Immutable Cloudflare observation receipts, sequence allocation, and latest secret-free projections.

## Touchpoints

- Derives tenant, device, lease, and commercial authority from Identity, Devices, Licensing, and workspace ownership ports.
- Consumes protocol-owned sync and observation schemas through public Cloud route boundaries.
- Persists portfolio replica changes through sibling workspace-state capabilities.

## Change Guide

- Change data-plane services and persistence here while keeping HTTP transport and Provider calls outside the module.
- Preserve receipt-first idempotency, forced dual-key RLS, and caller-neutral tenant scope.
- Verify workspace sync, observation, route, migration, and live PostgreSQL boundary tests as applicable.

## Purpose

This module owns Cloud's authenticated workspace data-plane adapters and the Cloudflare DNS
observation ingress. Workspace mutation Push/Pull/Checkpoint remains separate from the
Cloudflare observation projection path.

## Principles

- MUST: Derive the account, personal-default workspace, authenticated device and active Lease from Identity and Devices state inside one `IdentityCapabilityTransactionRunner` transaction; caller-supplied selectors cannot choose tenant or device scope.
- MUST: Accept only the protocol-owned Cloudflare count/status projection at `POST /v1/workspace-observations/cloudflare-dns`; full DNS records, Provider credentials and Provider account identity never enter Cloud.
- MUST: Resolve an existing receipt before current Lease, commercial entitlement, clock-skew or latest-head checks so a lost response can replay the exact immutable acknowledgement from an earlier Lease epoch.
- MUST: Serialize new observations with an observation-ID advisory lock, then lock the workspace parent, entity and latest head before allocating the tenant observation sequence and appending the receipt.
- MUST: Start each Lease epoch at source sequence `1`, reject a new epoch with any other sequence, and cap same-epoch forward movement at `4096`; stale observations are recorded without replacing the latest head.
- MUST: Keep the receipt-first ledger immutable and the latest projection mutable; receipt and projection rows use composite tenant/entity foreign keys and forced dual-key RLS.
- MUST: Parse every untrusted database row with its exact shape and protocol constraints, failing closed on malformed, extra, unsafe or noncanonical values.
- MUST NOT: Expose a Cloud read route, provide DNS write authority, or persist/log Provider secrets or complete DNS observations.

## Boundaries

- Does NOT handle: Cloudflare API calls, Provider credential custody, DNS writes, or full-record collection. (see: `../../../../../../packages/connectors/cloudflare`)
- Does NOT handle: Cloudflare wire-schema ownership or digest canonicalization. (see: `../../../../../../packages/protocol/src/workspace-observations/cloudflare-dns.ts`)
- Does NOT handle: Identity session verification, device binding, Lease issuance, commercial entitlement calculation, or default-workspace ownership; it consumes their narrow ports and locked state. (see: `../../identity`, `../../devices`, `../../licensing`, and `../default-workspace`)
- Does NOT handle: Public HTTP transport, bearer verification, body limits, or route registration. (see: `../../../entrypoints/routes/public/boundary.ts`)
- Does NOT handle: Global migration ordering or checksum policy. (see: `../../../db/migrations.ts`)

## Adversarial Surfaces

- **tenant-or-device substitution**: The route accepts only a verified Desktop principal; account, workspace and device values come from the capability transaction and locked server rows. Verified by: `../../../../test/workspace-cloudflare-observation.test.ts` and `../../../../test/entrypoints/cloudflare-observation-route.test.ts`.
- **receipt replay or conflicting reuse**: Replay is allowed only for the exact authenticated device, observation ID, entity, Lease epoch, source sequence and canonical digest; conflicting reuse is rejected without consulting mutable authority. Verified by: `../../../../test/workspace-cloudflare-observation.test.ts`.
- **out-of-order or unbounded source clock**: Epoch reset, stale disposition, same-clock digest conflict and the maximum forward jump are enforced before the receipt is committed. Verified by: `../../../../test/workspace-cloudflare-observation.test.ts`.
- **same-ID concurrent submission**: The observation-ID transaction advisory lock and unique-retry path serialize duplicate submissions while preserving one immutable receipt and one sequence allocation. Verified by: `../../../../test/workspace-cloudflare-observation.test.ts`; live PostgreSQL race qualification remains open.
- **untrusted database rows**: Extra columns, malformed identifiers, unsafe integers, invalid digests, invalid timestamps and invalid authority/Lease states fail closed. Verified by: `../../../../test/workspace-cloudflare-observation.test.ts`.
- **cross-tenant persistence or role escalation**: All three tables use forced dual-key RLS, composite tenant/entity foreign keys, owner-only schema control, restrictive identity policies and no application DELETE grant. Verified by: `../../../../test/cloudflare-observation-migration.test.ts`; live PostgreSQL RLS qualification remains open.

## Contracts

- **CloudflareDnsObservationIngressPort** (defined in: cloudflare-observation.ts): Accepts an unknown request plus a verified `PublicPrincipal` and returns the frozen protocol acknowledgement or a closed rejection. Consumers: `../../../entrypoints/routes/public/boundary.ts`.
- **LockedDefaultWorkspaceAuthorityPort** (defined in: ../default-workspace/index.ts): Resolves and locks the account-owned personal-default workspace within the capability transaction. Consumers: `cloudflare-observation.ts`.
- **cloudflareDnsObservationMigration** (defined in: migrations/202609150002-cloudflare-dns-observation.ts): Creates the receipt ledger, latest head and tenant observation sequence with immutable receipt enforcement and forced RLS. Consumers: `../../../db/migrations.ts`.

## Open Questions

- [ ] Which observation-specific live PostgreSQL test will exercise concurrent same-observation-ID submissions and cross-tenant denial through the runtime application role? (open since: 2026-09)
