# @gooddealer/marketing-web

Public marketing site (top-of-funnel landing page), built with Astro as a fully static
site — every page prerenders to plain HTML; the only client JS is four small vanilla
`<script>` blocks (scroll reveal, workflow stepper, FAQ accordion, and the two JS-driven
showcase demos).

## Relationship to `brand/ui_kits/marketing-web`

This app is a 1:1 port of the brand kit's marketing-web reference (see that kit's README
for the design rationale). The mapping:

| Reference (kit) | Here |
| --- | --- |
| `index.html` / `zh/index.html` shells (meta/SEO/JSON-LD) | `src/layouts/Layout.astro` + per-locale `meta` in `src/data/{en,zh}.ts` |
| inline `<style>` block | `src/styles/marketing.css` (verbatim; kit-only `#root` rule dropped) |
| `data.en.js` / `data.zh.js` (`window.MK_DATA`) | `src/data/en.ts` / `src/data/zh.ts`, typed by `src/data/types.ts` |
| 11 `*.jsx` components (React UMD + in-browser Babel) | `src/components/**/*.astro`; React state machines (Workflow, FAQ, Aggregate/List demos) became vanilla scripts with identical timings |
| `../../styles.css` tokens / `../../assets/*` | `@gooddealer/ui/tokens.css` / `@gooddealer/ui/assets/*` imports |

Design changes flow brand-first: edit `brand/` (the design reference), then port here —
same rule as `packages/ui` (see `packages/ui/README.md`).

## Routes

- `/` — English (`src/pages/index.astro`, `src/data/en.ts`)
- `/zh/` — 中文 (`src/pages/zh/index.astro`, `src/data/zh.ts`)

New locale = new `src/data/<lang>.ts` + `src/pages/<lang>/index.astro` (copy the zh page,
swap the data import).

## CTAs

All conversion CTAs (sign-in, plan checkout, subscription) hand off to account-web at
`https://app.gooddealer.com` — `src/config.ts` holds the single `ACCOUNT_WEB_URL`
constant. Download links are `#` placeholders until installer URLs exist, as in the
reference.

## Deployment

Cloudflare Pages via its GitHub integration: the Pages project is connected to
`newcodebook/GoodDealer` and Cloudflare builds and deploys on every push to `main`
(production) and to other branches (preview deployments). No GitHub Actions workflow and
no wrangler involved. Project settings that make the pnpm monorepo build work:

| Setting | Value |
| --- | --- |
| Production branch | `main` |
| Root directory | `apps/marketing-web` |
| Build command | `pnpm build` |
| Build output directory | `dist` |
| Env var `NODE_VERSION` | `24.18.1` (matches `.node-version`; the repo-root file is outside the root directory, so Cloudflare needs the env var) |
| Env var `PNPM_VERSION` | `11.18.0` (matches the pinned pnpm / lockfile format) |
| Build watch paths (include) | `apps/marketing-web/*`, `packages/ui/*`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` |

`pnpm install` run inside `apps/marketing-web` resolves the workspace root above it, so
`@gooddealer/ui` (tokens/assets) installs normally. The build watch paths keep pushes
that don't touch the site or its inputs from triggering a Pages build.

## Commands

- `pnpm dev` / `pnpm build` / `pnpm preview`
- `pnpm typecheck` — runs `astro check`

`typescript` is pinned to 6.x in devDependencies: `astro check` relies on TypeScript's
programmatic API, which the native (7.x) compiler does not expose yet
(https://github.com/withastro/roadmap/discussions/1321). Lift the pin when Astro supports
TS 7.
