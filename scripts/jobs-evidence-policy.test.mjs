import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url)));
const evidenceCollector = readFileSync(
  new URL("../scripts/collect-wp0-evidence.mjs", import.meta.url),
  "utf8",
);
const jobsReport = readFileSync(
  new URL("../scripts/collect-jobs-report.mjs", import.meta.url),
  "utf8",
);

test("WP-4 jobs evidence has a dedicated command and slice", () => {
  assert.equal(
    packageJson.scripts["evidence:wp4:jobs"],
    "node scripts/collect-wp0-evidence.mjs --slice jobs",
  );
  assert.match(evidenceCollector, /supportedSlices.*"jobs"/s);
  assert.match(evidenceCollector, /if \(slice === "jobs"\)/);
  assert.match(evidenceCollector, /jobs-report/);
  assert.match(evidenceCollector, /collect-jobs-report\.mjs/);
});

test("jobs slice evidence validates all required segments", () => {
  assert.match(evidenceCollector, /sliceEvidence\.slice === "jobs"/);
  assert.match(evidenceCollector, /periodicJobsRegistered === false/);
  assert.match(evidenceCollector, /crossTenant\?\.passed === true/);
  assert.match(evidenceCollector, /replay\?\.passed === true/);
  assert.match(evidenceCollector, /idempotency\?\.passed === true/);
  assert.match(evidenceCollector, /leaseContention\?\.passed === true/);
});

test("jobs slice routes to wp4 work package", () => {
  assert.match(evidenceCollector, /slice === "jobs"[\s\S]*?\?\s*"wp4"/s);
});

test("jobs evidence producer asserts periodicJobsRegistered === false", () => {
  assert.match(jobsReport, /periodicJobsRegistered/);
  assert.match(jobsReport, /periodicJobs\.length/);
});

test("jobs evidence producer has four matrix segments", () => {
  assert.match(jobsReport, /crossTenant/);
  assert.match(jobsReport, /replay/);
  assert.match(jobsReport, /idempotency/);
  assert.match(jobsReport, /leaseContention/);
});

test("jobs evidence slice is disjoint from cloud-boundary slice", () => {
  // The jobs profile definition must NOT include cloud-boundary commands
  const jobsSlice = evidenceCollector.slice(
    evidenceCollector.indexOf('if (slice === "jobs")'),
    evidenceCollector.indexOf('if (slice === "account-gate")'),
  );
  assert.ok(!jobsSlice.includes("cloud-boundary-report"), "jobs slice must not run cloud-boundary-report");
  assert.ok(!jobsSlice.includes("openapi"), "jobs slice must not include openapi commands");
  assert.ok(jobsSlice.includes("collect-jobs-report"), "jobs slice must run collect-jobs-report");
});

test("jobs evidence slice is disjoint from backup slice", () => {
  const jobsSlice = evidenceCollector.slice(
    evidenceCollector.indexOf('if (slice === "jobs")'),
    evidenceCollector.indexOf('if (slice === "account-gate")'),
  );
  assert.ok(!jobsSlice.includes("backup_evidence"), "jobs slice must not run backup_evidence");
  assert.ok(!jobsSlice.includes("backup-seal"), "jobs slice must not include backup-seal commands");
});
