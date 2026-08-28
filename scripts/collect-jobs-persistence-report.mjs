import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { tauriCommandPolicyErrors } from "./tauri-command-policy.mjs";

const root = resolve(import.meta.dirname, "..");

export const POSTGRES_JOBS_TEST_NAMES = [
  "observes five FORCE RLS tables, compound tenant keys, non-privileged roles, and isolated same literal ids",
  "deduplicates equal concurrent enqueue and quarantines only the digest of unequal same-key content",
  "uses SKIP LOCKED with one partition winner while unrelated partitions and tenants progress",
  "keeps leased handles opaque, immutable, unforgeable, and consume-once",
  "makes every consumer stale with zero target access for every persisted fence mismatch",
  "reclaims expired work with a higher epoch and gives the late worker zero authorization or handler access",
  "rejects forged revoked and wrong-runtime replay capabilities before replay target access",
  "rolls back a fault after partition release and prevents terminal handler re-execution",
  "rolls back injected failures after every enqueue, claim, retry, completion, quarantine, and replay write boundary",
  "uses persisted retry policy, unique attempts, database time, and max-attempt quarantine",
  "manual replay has one CAS winner and preserves frozen bytes, digests, idempotency, tenant, and authorization",
  "clears tenant selectors after pooled commit and rollback and rejects malformed scope before acquisition",
  "leaves one observed replay audit after concurrent CAS and byte-preserving requeue",
];
export const JOB_RUNTIME_TABLES = [
  "job_runtime_attempts", "job_runtime_jobs", "job_runtime_partition_leases",
  "job_runtime_quarantine_events", "job_runtime_replay_events",
];
export const JOBS_PERSISTENCE_INPUT_PATHS = [
  "packages/protocol/src/jobs/persistent-create.ts",
  "packages/protocol/src/jobs/tenant-scope.ts",
  "packages/protocol/src/jobs/index.ts",
  "apps/cloud/src/modules/job-runtime/migrations/202608200012-job-runtime.ts",
  "apps/cloud/src/modules/job-runtime/postgres-job-runtime.ts",
  "apps/cloud/src/modules/job-runtime/index.ts",
  "apps/cloud/src/db/migrations.ts",
  "apps/cloud/src/entrypoints/jobs.ts",
  "apps/cloud/src/entrypoints/ports/job-scheduler.ts",
  "apps/cloud/test/postgres/job-runtime-persistence.test.ts",
  "apps/cloud/test/job-runtime-persistence-boundary.test.ts",
  "packages/protocol/test/persistent-job-create.test.ts",
  "scripts/collect-jobs-persistence-report.mjs",
  "scripts/jobs-persistence-evidence-policy.test.mjs",
  ".github/workflows/wp4-jobs-persistence.yml",
];

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.filename)) main();

function main() {
  const ownerUrl = requiredEnvironment("GOODDEALER_POSTGRES_OWNER_URL");
  const appUrl = requiredEnvironment("GOODDEALER_POSTGRES_APP_URL");
  if (process.env.GOODDEALER_UNQUALIFIED_POSTGRES_DIAGNOSTIC === "true") {
    throw new Error("unqualified diagnostic mode cannot produce jobs persistence evidence");
  }
  const serverVersion = psql(ownerUrl, "SHOW server_version");
  if (!/^18\.6(?:\D|$)/u.test(serverVersion)) throw new Error(`PostgreSQL 18.6 required, received ${serverVersion}`);
  const tests = observeVitest();
  const inputs = JOBS_PERSISTENCE_INPUT_PATHS.map((path) => ({ path, sha256: sha256(read(path)) }));
  const jobs = read("apps/cloud/src/entrypoints/jobs.ts");
  const scheduler = read("apps/cloud/src/entrypoints/ports/job-scheduler.ts");
  const runtime = read("apps/cloud/src/modules/job-runtime/postgres-job-runtime.ts");
  const publicRoutes = read("apps/cloud/src/entrypoints/routes/public/boundary.ts");
  const adminRoutes = read("apps/cloud/src/entrypoints/routes/admin/boundary.ts");
  const tauriErrors = tauriCommandPolicyErrors({ root });
  if (tauriErrors.length > 0) throw new Error(tauriErrors.join("\n"));
  const report = {
    schemaVersion: 1, slice: "jobs-persistence", passed: true, closesGate: false,
    repository: { commit: run("git", ["rev-parse", "HEAD"]).trim(), dirty: run("git", ["status", "--porcelain"]).trim().length > 0 },
    database: {
      serverVersion,
      roles: queryJson(ownerUrl, `SELECT coalesce(json_agg(row_to_json(r) ORDER BY name)::text,'[]') FROM (
        SELECT rolname AS name,rolsuper AS superuser,rolbypassrls AS "bypassRls" FROM pg_roles
        WHERE rolname IN ('gooddealer_cloud_app','gooddealer_cloud_owner')) r`),
      rowLevelSecurity: queryJson(ownerUrl, `SELECT coalesce(json_agg(row_to_json(r) ORDER BY "table")::text,'[]') FROM (
        SELECT relname AS "table",relrowsecurity AS enabled,relforcerowsecurity AS forced FROM pg_class
        WHERE relname IN (${JOB_RUNTIME_TABLES.map((table) => `'${table}'`).join(",")})) r`),
      migration: queryJson(ownerUrl, `SELECT coalesce(json_agg(row_to_json(r) ORDER BY id)::text,'[]') FROM (
        SELECT id,owner_module AS owner,checksum FROM gooddealer_cloud_migrations WHERE id='202608200012-job-runtime') r`),
      structuralConstraints: queryJson(ownerUrl, `SELECT coalesce(json_agg(row_to_json(r) ORDER BY "table")::text,'[]') FROM (
        SELECT c.relname AS "table",count(*) FILTER (WHERE x.contype='p')::integer AS primary_keys,
          count(*) FILTER (WHERE x.contype='u')::integer AS unique_constraints,
          count(*) FILTER (WHERE x.contype='f')::integer AS foreign_keys
        FROM pg_class c JOIN pg_constraint x ON x.conrelid=c.oid
        WHERE c.relname IN (${JOB_RUNTIME_TABLES.map((table) => `'${table}'`).join(",")}) GROUP BY c.relname) r`),
      replayAudit: queryTenantJson(appUrl, "job-account-a", "same-workspace", `SELECT coalesce(json_agg(row_to_json(r) ORDER BY "requestedAt")::text,'[]') FROM (
        SELECT outcome,replay_authorization_kind AS "authorizationKind",
          replay_generation::integer AS generation,
          octet_length(replay_authorization_digest)::integer AS "authorizationDigestBytes",
          requested_at AS "requestedAt",decided_at AS "decidedAt"
        FROM job_runtime_replay_events) r`),
    },
    tests: { postgres: tests },
    productionSurfaces: {
      publicBusinessRoutes: /publicBusinessRoutes:\s*readonly\s*\[\]\s*=\s*\[\]/u.test(publicRoutes) ? 0 : -1,
      adminBusinessRoutes: /adminBusinessRoutes:\s*readonly\s*\[\]\s*=\s*\[\]/u.test(adminRoutes) ? 0 : -1,
      periodicJobs: /periodicJobs:\s*readonly\s*\[\]\s*=\s*\[\]/u.test(jobs) ? 0 : -1,
      jobApplicationPorts: /type JobApplicationPorts = readonly \[\]/u.test(scheduler) ? 0 : -1,
      productionJobKinds: /productionJobKindDefinitions:\s*readonly\s*\[\]\s*=\s*\[\]/u.test(runtime) ? 0 : -1,
      scheduler: /class DenyingPeriodicScheduler implements JobSchedulerPort/u.test(scheduler) ? "DenyingPeriodicScheduler" : "unresolved",
      schedulerCalls: [...jobs.matchAll(/\.schedulePeriodic\s*\(/gu)].length,
      entrypointRuntimeImports: /from\s+["'][^"']*job-runtime/u.test(jobs) ? 1 : 0,
      tauriCommands: [],
    },
    gates: { "R0-09": "In Progress" }, inputs, inputSetDigest: digestInputs(inputs),
  };
  if (!jobsPersistenceReportPassesPolicy(report)) throw new Error("jobs persistence report failed policy");
  const output = resolve(root, ".artifacts/wp4/jobs-persistence/jobs-persistence-report.json");
  mkdirSync(resolve(output, ".."), { recursive: true });
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report));
}

export function jobsPersistenceReportPassesPolicy(value) {
  return value?.schemaVersion === 1 && value.slice === "jobs-persistence" && value.passed === true && value.closesGate === false
    && /^[0-9a-f]{40}$/u.test(value.repository?.commit) && value.repository?.dirty === false
    && /^18\.6(?:\D|$)/u.test(value.database?.serverVersion)
    && exactJson(value.database?.roles, [
      { name: "gooddealer_cloud_app", superuser: false, bypassRls: false },
      { name: "gooddealer_cloud_owner", superuser: false, bypassRls: false },
    ])
    && exactJson(value.database?.rowLevelSecurity, JOB_RUNTIME_TABLES.map((table) => ({ table, enabled: true, forced: true })))
    && Array.isArray(value.database?.migration) && value.database.migration.length === 1
    && value.database.migration[0]?.id === "202608200012-job-runtime" && value.database.migration[0]?.owner === "job-runtime"
    && /^[0-9a-f]{64}$/u.test(value.database.migration[0]?.checksum)
    && exactJson(value.database?.structuralConstraints, [
      { table: "job_runtime_attempts", primary_keys: 1, unique_constraints: 1, foreign_keys: 1 },
      { table: "job_runtime_jobs", primary_keys: 1, unique_constraints: 1, foreign_keys: 0 },
      { table: "job_runtime_partition_leases", primary_keys: 1, unique_constraints: 0, foreign_keys: 1 },
      { table: "job_runtime_quarantine_events", primary_keys: 1, unique_constraints: 1, foreign_keys: 1 },
      { table: "job_runtime_replay_events", primary_keys: 1, unique_constraints: 0, foreign_keys: 1 },
    ])
    && exactReplayAudit(value.database?.replayAudit)
    && exactTestObservation(value.tests?.postgres)
    && exactJson(value.productionSurfaces, {
      publicBusinessRoutes: 0, adminBusinessRoutes: 0, periodicJobs: 0, jobApplicationPorts: 0,
      productionJobKinds: 0, scheduler: "DenyingPeriodicScheduler", schedulerCalls: 0,
      entrypointRuntimeImports: 0, tauriCommands: [],
    })
    && exactJson(value.gates, { "R0-09": "In Progress" })
    && exactInputs(value.inputs) && value.inputSetDigest === digestInputs(value.inputs);
}
export function digestInputs(inputs) { return Array.isArray(inputs) ? sha256(inputs.map(({ path, sha256: digest }) => `${path}\0${digest}`).join("\0")) : ""; }
function exactTestObservation(value) { return value?.file === "test/postgres/job-runtime-persistence.test.ts" && value.success === true
  && value.total === POSTGRES_JOBS_TEST_NAMES.length && value.passed === POSTGRES_JOBS_TEST_NAMES.length && value.failed === 0
  && exactJson(value.names, POSTGRES_JOBS_TEST_NAMES) && new Set(value.names).size === POSTGRES_JOBS_TEST_NAMES.length; }
function exactReplayAudit(value) {
  if (!Array.isArray(value) || value.length !== 1) return false;
  const event = value[0];
  if (!exactJson(Object.keys(event ?? {}), ["outcome", "authorizationKind", "generation", "authorizationDigestBytes", "requestedAt", "decidedAt"])) return false;
  if (typeof event.requestedAt !== "string" || typeof event.decidedAt !== "string") return false;
  const requestedAt = Date.parse(event.requestedAt);
  const decidedAt = Date.parse(event.decidedAt);
  return event.outcome === "requeued" && event.authorizationKind === "admin_action"
    && event.generation === 1 && event.authorizationDigestBytes === 32
    && Number.isFinite(requestedAt) && Number.isFinite(decidedAt) && requestedAt <= decidedAt;
}
function exactInputs(value) { return Array.isArray(value) && value.length === JOBS_PERSISTENCE_INPUT_PATHS.length
  && new Set(value.map(({ path }) => path)).size === value.length
  && value.every(({ path, sha256: digest }, index) => path === JOBS_PERSISTENCE_INPUT_PATHS[index] && /^[0-9a-f]{64}$/u.test(digest) && digest === sha256(read(path))); }
function observeVitest() { const result = JSON.parse(run("pnpm", ["--filter","@gooddealer/cloud","exec","vitest","run","--config","vitest.postgres.config.ts","test/postgres/job-runtime-persistence.test.ts","--reporter=json"]));
  if (result.success !== true || result.testResults?.length !== 1) throw new Error("targeted jobs Vitest evidence is incomplete"); const testResult=result.testResults[0];
  return { file:String(testResult.name).split("/apps/cloud/").at(-1),success:result.success,total:result.numTotalTests,passed:result.numPassedTests,failed:result.numFailedTests,names:testResult.assertionResults.map(({title})=>title) }; }
function queryJson(url,sql){return JSON.parse(psql(url,sql));}
function queryTenantJson(url,accountId,workspaceId,sql){
  const scoped=`BEGIN; SET LOCAL gooddealer.account_id=${sqlLiteral(accountId)}; SET LOCAL gooddealer.workspace_id=${sqlLiteral(workspaceId)}; ${sql}; ROLLBACK;`;
  return JSON.parse(run("psql",[url,"--no-psqlrc","--quiet","--set","ON_ERROR_STOP=1","--tuples-only","--no-align","--command",scoped]).trim());
}
function psql(url,sql){return run("psql",[url,"--no-psqlrc","--set","ON_ERROR_STOP=1","--tuples-only","--no-align","--command",sql]).trim();}
function sqlLiteral(value){return `'${String(value).replaceAll("'","''")}'`;}
function read(path){const absolutePath=resolve(root,path);const stat=lstatSync(absolutePath);if(stat.isSymbolicLink()||!stat.isFile())throw new Error(`required input is not a regular file: ${path}`);return readFileSync(absolutePath,"utf8");}
function run(command,args){if(!new Set(["git","pnpm","psql"]).has(command))throw new Error(`unapproved executable: ${command}`);const result=spawnSync(command,args,{cwd:root,encoding:"utf8",stdio:["ignore","pipe","inherit"]});if(result.error||result.signal||result.status!==0)throw new Error(`subprocess failed: ${command}`);return result.stdout;}
function sha256(value){return createHash("sha256").update(value).digest("hex");} function exactJson(a,b){return JSON.stringify(a)===JSON.stringify(b);}
function requiredEnvironment(name){const value=process.env[name];if(!value)throw new Error(`${name} is required; PostgreSQL evidence never skips`);return value;}
