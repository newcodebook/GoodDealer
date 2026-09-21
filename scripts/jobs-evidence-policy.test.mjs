import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url)));
const evidenceCollector = readFileSync(new URL("./collect-wp0-evidence.mjs", import.meta.url), "utf8");
const jobsReport = readFileSync(new URL("./collect-jobs-report.mjs", import.meta.url), "utf8");

test("WP-4 jobs evidence has a dedicated command and slice", () => {
  assert.equal(packageJson.scripts["evidence:wp4:jobs"], "node scripts/collect-wp0-evidence.mjs --slice jobs");
  assert.match(evidenceCollector, /supportedSlices.*"jobs"/s);
  assert.match(evidenceCollector, /if \(slice === "jobs"\)/);
  assert.match(evidenceCollector, /collect-jobs-report\.mjs/);
});

test("jobs slice validates current durable provider-job evidence", () => {
  assert.match(evidenceCollector, /sliceEvidence\.slice === "jobs"/);
  assert.match(evidenceCollector, /hostedSchedulerObserved === false/);
  assert.match(evidenceCollector, /liveProviderObserved === false/);
  assert.match(evidenceCollector, /registration\?\.passed === true/);
  assert.match(evidenceCollector, /dispatch\?\.passed === true/);
  assert.match(evidenceCollector, /failClosed\?\.passed === true/);
  assert.match(evidenceCollector, /durability\?\.passed === true/);
});

test("jobs evidence producer probes all approved Licensing jobs", () => {
  assert.match(jobsReport, /commercial-provider-operation/);
  assert.match(jobsReport, /commercial-provider-inbox/);
  assert.match(jobsReport, /commercial-provider-reconciliation/);
  assert.match(jobsReport, /commercial-due-authority/);
  assert.match(jobsReport, /commercial-provider-release/);
  assert.match(jobsReport, /processNextOperation/);
  assert.match(jobsReport, /processNextInbox/);
  assert.match(jobsReport, /processNextReconciliation/);
  assert.match(jobsReport, /processNextDueAuthority/);
  assert.match(jobsReport, /processNextRelease/);
  assert.match(jobsReport, /overlap-leasing-skip-locked/);
  assert.match(jobsReport, /failed-provider-read-reschedules/);
  assert.match(jobsReport, /provider-side-effect-idempotency-is-operation-owned/);
});

test("jobs evidence explicitly excludes external qualification claims", () => {
  assert.match(jobsReport, /hostedSchedulerObserved: false/);
  assert.match(jobsReport, /liveProviderObserved: false/);
  assert.match(jobsReport, /productionDeploymentObserved: false/);
});

test("jobs evidence slice remains disjoint from cloud-boundary and backup reports", () => {
  const jobsSlice = evidenceCollector.slice(
    evidenceCollector.indexOf('if (slice === "jobs")'),
    evidenceCollector.indexOf('if (slice === "account-gate")'),
  );
  assert.ok(!jobsSlice.includes("cloud-boundary-report"));
  assert.ok(!jobsSlice.includes("backup_evidence"));
  assert.ok(jobsSlice.includes("collect-jobs-report"));
});
