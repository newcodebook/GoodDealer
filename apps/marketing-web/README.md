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

Cloudflare Pages **Direct Upload** project `gooddealer-marketing` (no Git integration —
Cloudflare never builds the repo), deployed by `.github/workflows/marketing-web.yml`:
PRs touching the site run a build/typecheck `check` job; pushes to `main` additionally
build `dist/` and upload it with the app's own `wrangler` devDependency
(`pnpm exec wrangler pages deploy`, run from this directory — `cloudflare/wrangler-action`
is avoided because it self-installs at the pnpm workspace root and fails). The Pages
project is created idempotently on first deploy (`wrangler pages project create … || true`).

The workflow needs two repository secrets: `CLOUDFLARE_API_TOKEN` (Pages:Edit) and
`CLOUDFLARE_ACCOUNT_ID`. Until the token is set, the deploy step fails visibly — an
accepted bootstrap state.

## Commands

- `pnpm dev` / `pnpm build` / `pnpm preview`
- `pnpm typecheck` — runs `astro check`

`typescript` is pinned to 6.x in devDependencies: `astro check` relies on TypeScript's
programmatic API, which the native (7.x) compiler does not expose yet
(https://github.com/withastro/roadmap/discussions/1321). Lift the pin when Astro supports
TS 7.
