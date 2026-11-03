import assert from "node:assert/strict";
import test from "node:test";

import { brandAdherenceErrors, brandAdherenceSourceErrors } from "./brand-adherence-policy.mjs";

test("current presentation roots follow the brand adherence rules", () => {
  assert.deepEqual(brandAdherenceErrors(), []);
});

test("rejects remote fonts, stylesheets, and CDN assets", () => {
  for (const source of [
    '@import url("https://fonts.googleapis.com/css2?family=Inter");',
    "@font-face{src:url('https://cdn.fontshare.com/wf/a.woff2')}",
    '.a{background:url("//example.com/a.png")}',
  ]) {
    assert.equal(brandAdherenceSourceErrors("packages/ui/src/a.css", source).length, 1, source);
  }
  assert.equal(brandAdherenceSourceErrors("apps/desktop/src/a.tsx", 'const u = "https://unpkg.com/x";').length, 1);
});

test("keeps raw colors and font families inside the token layer", () => {
  assert.deepEqual(brandAdherenceSourceErrors("packages/ui/src/tokens/colors.css", ":root{--gd-ink:#0A0B0F}"), []);
  assert.equal(brandAdherenceSourceErrors("packages/ui/src/components/a.css", ".a{color:#D4A437}").length, 1);
  assert.equal(brandAdherenceSourceErrors("apps/desktop/src/a.tsx", 'const s = { color: "#fff" };').length, 1);
  assert.equal(brandAdherenceSourceErrors("packages/ui/src/components/a.css", ".a{font-family:Inter,sans-serif}").length, 1);
  assert.equal(brandAdherenceSourceErrors("apps/desktop/src/a.tsx", "const s = { fontFamily: 'Georgia' };").length, 1);
  assert.deepEqual(brandAdherenceSourceErrors("packages/ui/src/components/a.css", ".a{font-family: var(--font-mono)}"), []);
});

test("ignores colors and hosts that appear only in comments or non-color identifiers", () => {
  assert.deepEqual(brandAdherenceSourceErrors("packages/ui/src/components/a.css", "/* was #3A4256 */.a{color:var(--text-1)}"), []);
  assert.deepEqual(brandAdherenceSourceErrors("apps/desktop/src/a.ts", "// see https://fonts.googleapis.com\nclass A { #count = 0; }"), []);
  assert.deepEqual(brandAdherenceSourceErrors("apps/marketing-web/src/a.astro", '<a href="#pricing">Pricing</a>'), []);
});

test("rejects native dialogs in place of the brand risk confirmation", () => {
  for (const source of ['window.confirm("Delete?")', 'if (!confirm("Delete?")) return;', 'const v = prompt("Note");']) {
    assert.equal(brandAdherenceSourceErrors("apps/desktop/src/a.tsx", source).length, 1, source);
  }
  assert.deepEqual(brandAdherenceSourceErrors("apps/desktop/src/a.tsx", "journey.confirm(intent);"), []);
});

test("rejects hard-coded Desktop locales", () => {
  assert.equal(brandAdherenceSourceErrors("apps/desktop/src/a.tsx", '<AssetLibrary locale="en-US" />').length, 1);
  assert.deepEqual(brandAdherenceSourceErrors("packages/ui/src/a.tsx", 'const l = "zh-CN";'), []);
});
