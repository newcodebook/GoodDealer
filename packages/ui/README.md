# @gooddealer/ui

## Purpose

Production component library for GoodDealer's three web/desktop surfaces (`apps/desktop`,
`apps/account-web`, `apps/admin-web`). Host-independent, presentational-only: no Tauri
imports, no network calls, no business state — every component is a pure function of its
props.

## Principles

- MUST: Treat `brand/` as the design reference and port changes deliberately.
- MUST: Resolve component colors through the exported design-token layer.
- MUST: Keep components typed, presentational, host-independent, and free of business authority.
- MUST: Export all supported components from the package root; consumers never deep-import source files.

## Boundaries

- Does NOT handle: Routing, state, authorization, network access, or Tauri integration. (see: ../../apps)
- Does NOT handle: Owning or mutating the design reference. (see: ../../brand/README.md)
- Does NOT handle: Undeclared deep-import surfaces for cross-package consumers. (see: src/index.ts)

## Open Questions

- [ ] Which host application will adopt the component set first and provide the first full browser-rendered visual regression baseline? (open since: 2026-08)
- [ ] Which interaction-heavy component will justify adding a DOM test environment beyond the current pure-render contract tests? (open since: 2026-08)

## Relationship to `brand/`

`brand/` is the read-only design reference and event source of truth (see its own
`brand/README.md` boundary declaration). It is **not** imported by this package at build
time or runtime — nothing here does `import ... from "../../brand/..."`. Instead:

- `src/tokens/*.css` is a production port of `brand/tokens/*.css`. The `--gd-*` / `--surface-*`
  / `--text-*` variable names and values are unchanged, so anything visually specified against
  `brand/tokens` still applies here. Seven tokens are new relative to `brand/tokens`:
  `--gd-on-accent` and six hover/active tokens (see below).
- `src/components/**` reimplements the eight components documented in
  `brand/components/{buttons,inputs,navigation}/*.jsx` (Button, IconButton, Input, Checkbox,
  Select, Switch, Tabs, StatusBar) as typed, statically-styled React components.
- `src/assets/**` is a verbatim copy of `brand/assets/**` (logo, graphics, icons), exported
  via the `./assets/*` subpath so apps can load them at runtime (see "Assets" below).

This package is the **production source of truth**: apps consume tokens, components, and
assets exclusively from `@gooddealer/ui` and never reach into `brand/`. When brand direction
changes, edit `brand/` first (it stays the design reference), then port the change here
deliberately — this package does not auto-follow brand/ edits, and a design change is not
complete until its production counterpart (token, component, or asset) lands here.

## Token-only styling

Every component stylesheet in `src/components/**/*.css` resolves colors exclusively through
`var(--gd-*)` / `var(--surface-*)` / `var(--text-*)` tokens — no hex, `rgb()`, or named color
literal appears in any `.tsx` or `.css` file under `src/components/**` (the token definitions
in `src/tokens/colors.css` are expected to be all hex — that file *is* the token layer). Two
deviations from the
`brand/components` reference were needed to hold that line:

- **Hover/active states** that the reference expressed as one-off hex literals (e.g. a
  lighter blue on primary-button hover, a lighter line color on input/select hover) are named
  tokens in `src/tokens/colors.css`, not `color-mix()` blends against a base token. Mixing a
  fixed percentage of pure white/black into near-black or saturated surfaces would drift well
  off the reference's actual hover/active color
  (e.g. `color-mix(in srgb, var(--gd-panel-raised) 80%, white)` lands at `#43454C` against the
  reference's `#1A1E28`) and collapse two hover borders the reference keeps
  distinct (button/select hover border `#343B4E` vs. checkbox hover border `#3A4256`) onto the
  same computed value. Six explicit tokens preserve those distinctions:
  - `--gd-blue-hover` (`#6098FF`) — primary button hover; literal match to
    `brand/components/buttons/Button.jsx` `.gd-btn--primary:hover`.
  - `--gd-panel-hover` (`#1A1E28`) — secondary button hover background; literal match to
    `Button.jsx` `.gd-btn--secondary:hover`.
  - `--gd-line-hover` (`#343B4E`) — secondary button hover border and select hover border;
    literal match to `Button.jsx` and `brand/components/inputs/Select.jsx`.
  - `--gd-check-hover-border` (`#3A4256`) — checkbox hover border; literal match to
    `brand/components/inputs/Checkbox.jsx`. Kept as its own token rather than reusing
    `--gd-line-hover` because the reference's value here is genuinely different.
  - `--gd-danger-hover` (`#DF523A`) and `--gd-danger-active` (`#B8351E`) — **not** literal
    matches; see the danger note below.

  `color-mix()` is still used for the `--gd-danger` disabled state and the gold variant, but
  only mixed against `transparent` (a scalar opacity change on a single hue, not a white/black
  blend) — that usage is position-exact against the reference and is unaffected by this note.
- **`--gd-on-accent` (`#ffffff`)** — a new token added to `src/tokens/colors.css`, not present
  in `brand/tokens/colors.css`. The reference components hardcoded a raw `#fff` for content
  drawn on a solid saturated fill (primary/danger button label, the checked checkbox tick, the
  checked switch knob). Naming it keeps that value out of component code. It's kept distinct
  from `--gd-text` (`#EAE8E1`, the warm off-white for body copy on dark surfaces) because it
  serves a different purpose — legible against a saturated accent fill, not against
  `--gd-ink`. This follows the precedent `brand/README.md` itself sets under "Intentional
  additions" for extending the token set with implementation-necessary values.

One additional normalization: the reference `Button.jsx` danger variant used a raw hex
(`#C9503C`) that didn't match the canonical `--gd-danger` (`#E5735F`) token already defined in
`brand/tokens/colors.css` and used everywhere else (input error border, error hint text). The
danger button here uses `--gd-danger`, so "danger" has one color across the package instead of
two. That normalization carries forward into `--gd-danger-hover` / `--gd-danger-active`: the
reference computed its own hover (`#D65A45`) and active (`#B04533`) off the rejected `#C9503C`
literal, so reusing those values would reintroduce the color this package already normalized
away. Instead both tokens hold `--gd-danger`'s hue and saturation (H 9°, S 72%) with lightness
stepped down from its L 63.5% — hover at L 55% (`#DF523A`), active at L 42% (`#B8351E`) — a
restrained, monotonic deepen in the same hue family, not a reference-literal match.

## Delivering styles to a host app

Import the token layer once, at the host app's entry point, before any component renders:

```ts
import "@gooddealer/ui/tokens.css";
```

Each component imports its own colocated stylesheet (e.g. `button.tsx` imports
`./button.css`) as a side effect, so importing a component from `@gooddealer/ui` pulls its
styles into the same module graph automatically — no separate per-component CSS import or
CSS-in-JS runtime is needed. This relies on the host app's bundler resolving `.css` imports
(every current GoodDealer app builds with Vite, which does this natively); `src/css.d.ts`
only satisfies `tsc --noEmit`, it has no runtime behavior.

This is a deliberate departure from the `brand/components` reference, which injects a
`<style>` tag into `document.head` at import time (`ensureGdCss`). That pattern exists so the
brand kit's `.jsx` files work as standalone specimens outside a bundler; it is not a
production pattern (duplicate injection across independently-loaded specimens, no
tree-shaking, a hidden import-order dependency). Static, bundler-resolved CSS is the
convention here instead.

One cross-component dependency the reference had implicitly (via shared runtime style
injection) is made explicit: `Input` and `Select` both use a `.gd-field` / `.gd-field-label`
wrapper. That pair now lives in `src/components/shared/field.css` and both components import
it directly, instead of `Select` depending on `Input`'s stylesheet having already loaded.

## Components

| Component | File | Notes |
|---|---|---|
| `Button` | `src/components/button/button.tsx` | `primary \| secondary \| ghost \| danger \| gold` variants, `sm \| md \| lg` sizes |
| `IconButton` | `src/components/icon-button/icon-button.tsx` | `ghost \| outline` variants, `sm \| md` sizes; `label` is required (renders as `title` + `aria-label`) |
| `Input` | `src/components/input/input.tsx` | label, prefix/suffix, mono (tabular numerals), error/hint |
| `Checkbox` | `src/components/checkbox/checkbox.tsx` | supports `indeterminate` (table header tri-state) |
| `Select` | `src/components/select/select.tsx` | native `<select>` chrome; accepts strings or `{value,label}` |
| `Switch` | `src/components/switch/switch.tsx` | boolean toggle |
| `Tabs` | `src/components/tabs/tabs.tsx` | underline tabs with an optional mono count pill |
| `StatusBar` | `src/components/status-bar/status-bar.tsx` | hairline-divided `left`/`right` segment ledger |

All eight are re-exported from `src/index.ts`, the only supported import path
(`import { Button } from "@gooddealer/ui"`) — do not deep-import
`@gooddealer/ui/src/components/...` from outside this package.

## Assets

Brand SVG assets (copied verbatim from `brand/assets/`, which remains the design reference)
are exported through the declared `./assets/*` subpath:

```ts
import markUrl from "@gooddealer/ui/assets/logo/mark.svg";
```

| Directory | Files | Use |
|---|---|---|
| `assets/logo/` | `mark.svg`, `mark-flat.svg`, `mark-16.svg`, `mark-ink.svg`, `app-icon.svg` | Coin Seal logo variants — size/background rules in `brand/guidelines/coin-seal-spec.html` |
| `assets/graphics/` | `seal.svg`, `sand-flow.svg`, `ascent.svg` | Badge seal, splash/underlay texture, marketing/empty-state graphic |
| `assets/icons/` | `keyhole.svg`, `active-lease.svg` | Brand scenario icons (security capability, Active/Standby lease) |

This subpath is a declared export, not a deep import — it is the supported way for apps to
load brand assets at runtime. Vite resolves the specifier through the package `exports` map
and applies its normal asset pipeline (hashed URL, or inlining below the asset-inline
threshold). Do not load these files from `brand/assets/` in app code.

## Testing approach

Every component has a colocated `*.test.tsx` in Vitest. This workspace does not have
`jsdom`, `happy-dom`, or `@testing-library/react` installed (checked against
`pnpm-lock.yaml` before choosing an approach), and the assignment that produced this package
forbids introducing new runtime dependencies. All eight components are pure, hook-free
functions (no `useState`/`useEffect`/context), so tests call the component directly as a
plain function — `Button({ variant: "primary", children: "Save" })` — and assert on the
returned React element tree (`.type`, `.props.className`, `.props.children`,
`.props.onClick`, …). This exercises the real prop-to-markup and prop-forwarding contract
with zero additional dependencies; it does not exercise CSS rendering or real DOM event
dispatch, which is consistent with these being presentational-only components with no
internal interaction logic to verify beyond prop forwarding.

## Typecheck

`pnpm --filter @gooddealer/ui typecheck` runs `tsc -p tsconfig.json` against the shared root
`tsconfig.base.json` (strict mode, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`).
