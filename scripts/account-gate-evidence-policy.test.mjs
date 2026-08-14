import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  identityFixtureIsNonSellable,
  sourceDeclaresRawCredentialField,
  sourceRegistersProductionRoute,
} from "./collect-account-gate-report.mjs";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url)));
const collector = readFileSync(new URL("./collect-wp0-evidence.mjs", import.meta.url), "utf8");
const workflow = readFileSync(new URL("../.github/workflows/wp2-account-gate.yml", import.meta.url), "utf8");

test("WP-2 account gate evidence is fixture-only and independently runnable", () => {
  assert.equal(
    packageJson.scripts["evidence:wp2"],
    "node scripts/collect-wp0-evidence.mjs --slice account-gate",
  );
  assert.match(collector, /resolvedProfile: "wp2-account-gate-cloud-fixture"/);
  assert.match(collector, /id: "account-gate-fixture-report"/);
  assert.match(workflow, /--profile quality --slice account-gate/);
  assert.match(workflow, /\.artifacts\/wp2\/account-gate/);
  assert.doesNotMatch(workflow, /windows-2025|macos-15/);
});

test("WP-2 workflow pins the evidence upload action", () => {
  assert.match(workflow, /actions\/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7\.0\.1/);
});

test("account gate report rejects production route registration without confusing Map access", () => {
  assert.equal(sourceRegistersProductionRoute('import Fastify from "fastify";'), true);
  assert.equal(sourceRegistersProductionRoute('app.post("/login", handler);'), true);
  assert.equal(sourceRegistersProductionRoute("const session = sessions.get(sessionId);"), false);
});

test("account gate report rejects raw credential fields but accepts expiry metadata and auth methods", () => {
  assert.equal(sourceDeclaresRawCredentialField("password?: string;"), true);
  assert.equal(sourceDeclaresRawCredentialField("'refreshToken': string;"), true);
  assert.equal(sourceDeclaresRawCredentialField("accessTokenExpiresAt: string;"), false);
  assert.equal(sourceDeclaresRawCredentialField('method: z.enum(["password", "passkey"]);'), false);
});

test("account gate report requires an explicitly non-sellable fixture", () => {
  assert.equal(identityFixtureIsNonSellable("readonly sellable = false;"), true);
  assert.equal(identityFixtureIsNonSellable("readonly sellable = false as const;"), true);
  assert.equal(identityFixtureIsNonSellable("readonly sellable = true;"), false);
});
