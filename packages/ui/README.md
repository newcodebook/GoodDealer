# @gooddealer/ui

## Purpose

This package owns host-independent React components, tokens, icons, and assets for GoodDealer
surfaces. Components receive typed data and callbacks; they do not own routing, authorization,
business state, network access, Tauri integration, or fixture authority.

## Principles

- MUST: Import and export supported components, icons, and public types through the package root.
- MUST: Resolve presentation colors through the exported token layer.
- MUST: Keep behavior generic, DOM-native, accessible, and independent of product authority.
- MUST: Port design-reference decisions deliberately without importing `brand/` at runtime.
- MUST: Keep gallery and fixture data outside production consumer graphs.

## Boundaries

- Does NOT handle: Business copy, account/tenant state, routes, ports, network calls, Host access, or external side effects. (see: src/index.ts)
- Does NOT handle: Authorization enforcement through disabled controls or visual state. (see: src/components/button/button.tsx)
- Does NOT handle: Production Desktop or Cloud composition. (see: ../../apps/desktop/README.md)

## Adversarial Surfaces

- **Action semantics**: Package-owned action buttons default to non-submit behavior, and Dialog focus remains contained. Verified by: `src/components/component-system.test.tsx`.
- **Presentation boundary**: UI source contains no business authority, Tauri, network, or fixture imports. Verified by: repository boundary checks.
- **Visual authority confusion**: A component state cannot prove an operation or authorization. Verified by: consuming feature/host boundary tests.

## Open Questions

- [ ] Which owning application will first compose a new primitive with its data, permissions, and side effects? (open since: 2026-08)

## Public API

Consumers import components, icons, and types only from `@gooddealer/ui`, tokens from
`@gooddealer/ui/tokens.css`, and static assets from `@gooddealer/ui/assets/*`. They must not import
component source, component CSS, internal tokens, or `brand/` directly.

The package provides generic primitives for buttons, input controls, navigation, overlays, status,
surfaces, tables, desktop presentation patterns, and accessible SVG icons. Those primitives can
support future product flows but do not supply their data or permissions.

## Verification

```sh
pnpm --filter @gooddealer/ui typecheck
pnpm --filter @gooddealer/ui test
pnpm --filter @gooddealer/ui gallery:build
```

Gallery output is presentation QA, not a production application or external qualification.
