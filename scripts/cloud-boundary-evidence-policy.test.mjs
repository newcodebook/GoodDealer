import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import {
  CLOUD_BOUNDARY_ARTIFACT_DIRECTORY,
  CLOUD_BOUNDARY_EVIDENCE_DEFAULTS,
  cloudBoundaryReportPassesPolicy,
  collectCloudBoundaryReport,
  jobsImportGraphReachesHttpFramework,
  sourceCrossesSurfaceImport,
  sourceDeclaresHandWrittenJsonSchema,
  sourceRegistersAdminBusinessRoute,
  sourceRegistersModuleRoute,
  sourceSchedulesPeriodicJob,
  sourceUsesLayeredPublicRateLimitBuckets,
} from "./collect-cloud-boundary-report.mjs";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url)));
const collector = readFileSync(new URL("./collect-wp0-evidence.mjs", import.meta.url), "utf8");
const workflow = readFileSync(
  new URL("../.github/workflows/wp4-cloud-boundary.yml", import.meta.url),
  "utf8",
);

test("WP-4 cloud-boundary evidence is independently runnable", () => {
  assert.equal(
    packageJson.scripts["evidence:wp4"],
    "node scripts/collect-wp0-evidence.mjs --slice cloud-boundary",
  );
  assert.match(collector, /resolvedProfile: "wp4-cloud-boundary"/);
  assert.match(collector, /id: "cloud-boundary-report"/);
  assert.match(workflow, /--profile quality --slice cloud-boundary/);
  assert.match(workflow, new RegExp(CLOUD_BOUNDARY_ARTIFACT_DIRECTORY.replaceAll("/", "\\/")));
  assert.doesNotMatch(workflow, /windows-2025|macos-15/);
});

test("WP-4 workflow defaults cannot drift from the collector defaults", () => {
  assert.match(workflow, new RegExp(`EVIDENCE_OWNER_ROLE: ${CLOUD_BOUNDARY_EVIDENCE_DEFAULTS.ownerRole}`));
  assert.match(
    workflow,
    new RegExp(`EVIDENCE_OWNING_MODULES: ${CLOUD_BOUNDARY_EVIDENCE_DEFAULTS.owningModules.join(",")}`),
  );
  assert.match(
    workflow,
    new RegExp(`EVIDENCE_REQUIRED_REVIEWER_ROLE: ${CLOUD_BOUNDARY_EVIDENCE_DEFAULTS.requiredReviewerRole}`),
  );
  assert.match(workflow, /actions\/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7\.0\.1/);
});

test("admin business-route policy accepts only the frozen boundary allowlist", () => {
  assert.equal(sourceRegistersAdminBusinessRoute('path: "/admin/v1/boundary/identity"'), false);
  assert.equal(sourceRegistersAdminBusinessRoute('path: "/admin/v1/boundary/validate"'), false);
  assert.equal(sourceRegistersAdminBusinessRoute('path: "/admin/v1/accounts"'), true);
});

test("periodic-job policy accepts the empty tuple and rejects registration", () => {
  assert.equal(sourceSchedulesPeriodicJob("export const periodicJobs: readonly [] = [];"), false);
  assert.equal(sourceSchedulesPeriodicJob("scheduler.schedulePeriodic(spec);"), true);
  assert.equal(sourceSchedulesPeriodicJob('const periodicJobs = [{ cron: "0 * * * *" }];'), true);
});

test("cross-surface import policy has positive and negative controls", () => {
  assert.equal(
    sourceCrossesSurfaceImport(
      "apps/cloud/src/entrypoints/http.ts",
      'import { CloudPublicSessionVerifier } from "./ports/public-session";',
    ),
    false,
  );
  assert.equal(
    sourceCrossesSurfaceImport(
      "apps/cloud/src/entrypoints/http.ts",
      'import { StaticStaffSessionVerifier } from "./ports/staff-session";',
    ),
    true,
  );
  assert.equal(
    sourceCrossesSurfaceImport(
      "apps/cloud/src/entrypoints/admin-http.ts",
      'import { publicBoundaryRoutes } from "./routes/public/boundary";',
    ),
    true,
  );
});

test("hand-written JSON Schema policy distinguishes Zod conversion from object schemas", () => {
  assert.equal(sourceDeclaresHandWrittenJsonSchema("schema.toJSONSchema({ target: 'draft-7' });"), false);
  assert.equal(
    sourceDeclaresHandWrittenJsonSchema('const schema = { type: "object", properties: { id: {} } };'),
    true,
  );
});

test("public rate-limit policy layers the request address with the verified session", () => {
  const verifiedSessionCall =
    "const sessionDecision = sessionLimiter.consume(sessionRateLimitIdentity(principal.sessionId));";
  assert.equal(
    sourceUsesLayeredPublicRateLimitBuckets(
      `const addressDecision = preAuthLimiter.consume(preAuthRateLimitIdentity(request.ip)); ${verifiedSessionCall}`,
    ),
    true,
  );
  assert.equal(
    sourceUsesLayeredPublicRateLimitBuckets(
      "const addressDecision = preAuthLimiter.consume(preAuthRateLimitIdentity(request.ip)); const sessionDecision = sessionLimiter.consume(sessionRateLimitIdentity(cookieValue(request.headers.cookie, 'gd_session')));",
    ),
    false,
  );
  assert.equal(
    sourceUsesLayeredPublicRateLimitBuckets(
      `const addressDecision = preAuthLimiter.consume(preAuthRateLimitIdentity(request.headers['x-forwarded-for'])); ${verifiedSessionCall}`,
    ),
    false,
  );
  assert.equal(
    sourceUsesLayeredPublicRateLimitBuckets(
      `identityHeaderNames: ['x-account-id']; const addressDecision = preAuthLimiter.consume(preAuthRateLimitIdentity(request.ip)); ${verifiedSessionCall}`,
    ),
    false,
  );
});

test("module route policy rejects framework, route, and network primitives", () => {
  assert.equal(sourceRegistersModuleRoute("export function project(value) { return value; }"), false);
  assert.equal(sourceRegistersModuleRoute('import Fastify from "fastify";'), true);
  assert.equal(sourceRegistersModuleRoute('app.get("/v1/accounts", handler);'), true);
  assert.equal(sourceRegistersModuleRoute('await fetch("https://example.invalid");'), true);
});

test("jobs import graph walker follows transitive relative imports", () => {
  const fixture = mkdtempSync(resolve(tmpdir(), "gooddealer-jobs-graph-"));
  try {
    const safeEntry = resolve(fixture, "safe-entry.ts");
    const safePort = resolve(fixture, "safe-port.ts");
    const unsafeEntry = resolve(fixture, "unsafe-entry.ts");
    const unsafePort = resolve(fixture, "unsafe-port.ts");
    writeFileSync(safeEntry, 'import type { Port } from "./safe-port"; export type Use = Port;\n');
    writeFileSync(safePort, "export interface Port { readonly safe: true }\n");
    writeFileSync(unsafeEntry, 'import "./unsafe-port";\n');
    writeFileSync(unsafePort, 'import Fastify from "fastify"; export default Fastify;\n');
    assert.equal(jobsImportGraphReachesHttpFramework(safeEntry), false);
    assert.equal(jobsImportGraphReachesHttpFramework(unsafeEntry), true);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("cloud boundary report observes real roots and fails closed on policy mutations", async () => {
  const fixture = mkdtempSync(resolve(tmpdir(), "gooddealer-cloud-boundary-"));
  try {
    const report = await collectCloudBoundaryReport({ artifactDirectory: fixture });
    assert.equal(cloudBoundaryReportPassesPolicy(report), true);
    assert.equal(report.errorIdentityMatrix.cases.find(({ id }) => id === "M7")?.status, 404);
    assert.equal(report.errorIdentityMatrix.cases.find(({ id }) => id === "M8")?.status, 200);
    assert.equal(report.errorIdentityMatrix.cases.find(({ id }) => id === "M16")?.status, 404);
    assert.equal(report.requirementMapping.closesGate, false);
    assert.equal(report.requirementMapping.r0_09.filter(({ produced }) => !produced).length, 2);
    assert.equal(readFileSync(resolve(fixture, "openapi-public.json"), "utf8").length > 0, true);
    assert.equal(readFileSync(resolve(fixture, "openapi-admin.json"), "utf8").length > 0, true);

    const mutations = [
      { ...report, fixtureOnly: false },
      { ...report, adminBusinessRoutesRegistered: true },
      { ...report, periodicJobsRegistered: true },
      { ...report, publicRootImportsStaffSurface: true },
      { ...report, adminRootImportsPublicSurface: true },
      { ...report, jobsImportGraphReachesHttpFramework: true },
      { ...report, handWrittenJsonSchemaAbsent: false },
      { ...report, moduleSourceRegistersRoute: true },
      { ...report, preAuthRateLimitBucketSource: "unverified" },
      { ...report, authenticatedRateLimitBucketSource: "unverified" },
      { ...report, cookieNamesDisjoint: false },
      { ...report, runtimeIsolation: { ...report.runtimeIsolation, distinctInstances: false } },
      { ...report, errorIdentityMatrix: { ...report.errorIdentityMatrix, allMatched: false } },
      { ...report, routeTables: { ...report.routeTables, admin: [...report.routeTables.admin, "GET /admin/v1/accounts"] } },
      { ...report, openapi: { ...report.openapi, pathSetsDisjoint: false } },
      { ...report, rateLimitBoundary: { ...report.rateLimitBoundary, observationVerdict: "fail" } },
      { ...report, rateLimitBoundary: { ...report.rateLimitBoundary, rotatingUnverifiedCookiesShareAddressBucketObserved: false } },
      { ...report, rateLimitBoundary: { ...report.rateLimitBoundary, perIdentityScopingObserved: false } },
      { ...report, rateLimitBoundary: { ...report.rateLimitBoundary, probeCriterion: null } },
      { ...report, rateLimitBoundary: { ...report.rateLimitBoundary, productionStrategyDeferredTo: null } },
      { ...report, requirementMapping: { ...report.requirementMapping, closesGate: true } },
      { ...report, requiredInputsPresent: false },
    ];
    for (const mutation of mutations) assert.equal(cloudBoundaryReportPassesPolicy(mutation), false);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
