import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { rootPackageScriptErrors } from "./root-package-policy.mjs";

const packageManifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const cloudPackageManifest = JSON.parse(
  readFileSync(new URL("../apps/cloud/package.json", import.meta.url), "utf8"),
);

test("root scripts are an exact, meaningful final-state set", () => {
  assert.deepEqual(rootPackageScriptErrors(packageManifest), []);
});

test("PostgreSQL integration uses the root local environment contract", () => {
  assert.equal(packageManifest.scripts["test:postgres"], "pnpm --filter @gooddealer/cloud test:postgres");
  assert.equal(
    cloudPackageManifest.scripts["test:postgres"],
    "node --env-file-if-exists=../../.env.local ../../node_modules/vitest/vitest.mjs run --config vitest.postgres.config.ts",
  );
});

test("rejects added selectors and removed check stages", () => {
  const selectorMutation = structuredClone(packageManifest);
  selectorMutation.scripts["historical-selector"] = "node scripts/not-admitted.mjs";
  assert.ok(rootPackageScriptErrors(selectorMutation).some((error) => error.includes("not admitted")));

  const stageMutation = structuredClone(packageManifest);
  stageMutation.scripts.check = "pnpm typecheck";
  assert.ok(rootPackageScriptErrors(stageMutation).some((error) => error.includes("check")));
});

test("rejects restoration of the removed connector evidence selector", () => {
  const mutation = structuredClone(packageManifest);
  const removedSelector = ["evidence", "wp6", "contracts"].join(":");
  mutation.scripts[removedSelector] = [
    "node",
    ["scripts/collect", "connector", "contract", "report.mjs"].join("-"),
  ].join(" ");
  assert.ok(rootPackageScriptErrors(mutation).some((error) => error.includes("not admitted")));
});
