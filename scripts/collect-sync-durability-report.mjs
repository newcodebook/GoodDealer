/**
 * Live PostgreSQL durability evidence for workspace sync: capacity, a sustained soak and real
 * crash recovery. The crash is a server kill while twelve tenants write, followed by a restart;
 * the operator names both commands because only the environment that runs the server can do it
 * (CI kills its container; a local cluster uses `pg_ctl stop -m immediate`). Each is a JSON argv
 * array, run without a shell, and only `docker` or `pg_ctl` may be named.
 *
 * Only PostgreSQL 18.6 qualifies. The unqualified diagnostic mode runs everything but writes a
 * report that can never pass the policy, so it can not be mistaken for evidence.
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const outputDirectory = resolve(root, ".artifacts/wp2/workspace-sync-durability");

export const DURABILITY_TEST_FILE = "test/postgres/workspace-sync-durability.test.ts";
export const DURABILITY_TEST_NAMES = [
  "sustains concurrent multi-tenant ingest with dense heads, exact receipts, and forced RLS isolation",
  "keeps every invariant and a bounded connection count through a sustained mixed workload",
  "detects a torn tenant, so a passing invariant is evidence and not a tautology",
  "answers a resubmitted or concurrently doubled plan with exact duplicates and never applies an item twice",
];
export const CRASH_PLAN_LENGTH = 1_000;
export const CRASH_TENANTS = 12;
export const MINIMUM_CRASH_CYCLES = 3;
export const MINIMUM_SOAK_SECONDS = 600;
const CRASH_EXECUTABLES = new Set(["docker", "pg_ctl"]);
export const DURABLE_SETTINGS = { fsync: "on", synchronous_commit: "on", full_page_writes: "on" };
export const DURABILITY_INPUT_PATHS = [
  "apps/cloud/test/postgres/workspace-sync-durability.test.ts",
  "apps/cloud/test/postgres/support/workspace-sync-load.ts",
  "apps/cloud/test/postgres/support/crash-recovery.ts",
  "apps/cloud/src/modules/workspace/mutations/postgres-ingest-service.ts",
  "apps/cloud/src/modules/workspace/mutations/postgres-repository.ts",
  "apps/cloud/src/db/index.ts",
  "apps/cloud/src/db/migrations.ts",
  "scripts/collect-sync-durability-report.mjs",
  ".github/workflows/wp2-workspace-sync-durability.yml",
];

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.filename)) await main();

async function main() {
  const ownerUrl = requiredEnvironment("GOODDEALER_POSTGRES_OWNER_URL");
  const appUrl = requiredEnvironment("GOODDEALER_POSTGRES_APP_URL");
  const diagnostic = process.env.GOODDEALER_UNQUALIFIED_POSTGRES_DIAGNOSTIC === "true";
  const crash = parseArgv("GOODDEALER_POSTGRES_CRASH_ARGV");
  const restart = parseArgv("GOODDEALER_POSTGRES_RESTART_ARGV");
  const cycles = integerEnvironment("GOODDEALER_POSTGRES_CRASH_CYCLES", MINIMUM_CRASH_CYCLES, 1, 50);
  const soakSeconds = integerEnvironment("GOODDEALER_POSTGRES_SOAK_SECONDS", MINIMUM_SOAK_SECONDS, 1, 7_200);
  const serverVersion = psql(ownerUrl, "SHOW server_version");
  // A kill cannot lose an acknowledged commit only if commits wait for a flushed WAL; with any of
  // these off, a "durable" result would be luck, so the policy requires all three on. They are read
  // as the application role that writes, so a per-role or per-database override is seen too.
  const durabilitySettings = Object.fromEntries(["fsync", "synchronous_commit", "full_page_writes"]
    .map((name) => [name, psql(appUrl, `SHOW ${name}`)]));

  rmSync(outputDirectory, { recursive: true, force: true });
  mkdirSync(outputDirectory, { recursive: true });
  const metricsFile = resolve(outputDirectory, "metrics.jsonl");
  writeFileSync(metricsFile, "", "utf8");
  const tests = observeVitest(metricsFile, soakSeconds);
  const metrics = readFileSync(metricsFile, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));

  const crashCycles = [];
  for (let cycle = 0; cycle < cycles; cycle += 1) {
    crashCycles.push(await crashCycle(ownerUrl, crash, restart, 300 + Math.floor(Math.random() * 2_200)));
  }

  const inputs = DURABILITY_INPUT_PATHS.map((path) => ({ path, sha256: sha256(read(path)) }));
  const report = {
    schemaVersion: 1,
    slice: "workspace-sync-durability",
    qualified: !diagnostic && /^18\.6(?:\D|$)/u.test(serverVersion),
    closesGate: false,
    repository: { commit: run("git", ["rev-parse", "HEAD"]).trim(), dirty: run("git", ["status", "--porcelain"]).trim().length > 0 },
    database: { serverVersion, durabilitySettings },
    tests,
    metrics,
    soakSeconds,
    crash: { executable: crash[0], planLength: CRASH_PLAN_LENGTH, tenants: CRASH_TENANTS, cycles: crashCycles },
    inputs,
    inputSetDigest: digestInputs(inputs),
  };
  const passed = durabilityReportPassesPolicy(report);
  writeFileSync(resolve(outputDirectory, "workspace-sync-durability-report.json"), `${JSON.stringify({ ...report, passed }, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ ...report, passed }));
  if (diagnostic) {
    console.warn("UNQUALIFIED diagnostic report: never evidence");
    if (!diagnosticRunHeld(report)) process.exitCode = 1;
  } else if (!passed) {
    throw new Error("workspace sync durability report failed policy");
  }
}

/** One kill: load until writes flow, wait, kill the server, restart it, verify and resume. */
async function crashCycle(ownerUrl, crash, restart, delayMs) {
  const load = spawn("pnpm", ["--filter", "@gooddealer/cloud", "exec", "tsx", "test/postgres/support/crash-recovery.ts", "load"],
    { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  const exited = new Promise((resolveExit) => load.on("exit", (code, signal) => resolveExit({ code, signal })));
  await new Promise((resolveStarted, reject) => {
    load.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.includes("LOAD_STARTED")) resolveStarted();
    });
    load.stderr.resume();
    exited.then(() => reject(new Error(`load ended before writes flowed: ${stdout.slice(-400)}`)));
  });
  progress(`writes flowing; killing the server in ${delayMs} ms`);
  await new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs));
  runCrashCommand(crash);
  progress("server killed; waiting for the load to stop");
  const loadExit = await exited;
  progress(`load stopped (${loadExit.code ?? loadExit.signal}); restarting`);
  const acknowledgedLine = stdout.split("\n").find((candidate) => candidate.startsWith("ACKNOWLEDGED "));
  const acknowledged = acknowledgedLine === undefined ? null : JSON.parse(acknowledgedLine.slice("ACKNOWLEDGED ".length));
  runCrashCommand(restart);
  await waitForServer(ownerUrl);
  progress("server back; verifying");
  const verify = spawnSync("pnpm", ["--filter", "@gooddealer/cloud", "exec", "tsx", "test/postgres/support/crash-recovery.ts", "verify"],
    { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  const line = verify.stdout.trim().split("\n").reverse().find((candidate) => candidate.startsWith("{"));
  if (line === undefined) throw new Error("crash verification printed no result");
  const result = JSON.parse(line);
  progress(`verified (${verify.status})`);
  return {
    delayMs,
    loadCompleted: stdout.includes("LOAD_COMPLETED"),
    loadExitCode: loadExit.code,
    acknowledged,
    verifyExitCode: verify.status,
    committed: result.committed,
    final: result.final,
    duplicates: result.duplicates,
    violations: result.violations,
  };
}

export function durabilityReportPassesPolicy(value) {
  return value?.schemaVersion === 1 && value.slice === "workspace-sync-durability" && value.qualified === true
    && value.closesGate === false
    && /^[0-9a-f]{40}$/u.test(value.repository?.commit) && value.repository?.dirty === false
    && /^18\.6(?:\D|$)/u.test(value.database?.serverVersion)
    && JSON.stringify(value.database?.durabilitySettings) === JSON.stringify(DURABLE_SETTINGS)
    && exactTests(value.tests)
    && Number.isSafeInteger(value.soakSeconds) && value.soakSeconds >= MINIMUM_SOAK_SECONDS
    && exactMetrics(value.metrics, value.soakSeconds)
    && CRASH_EXECUTABLES.has(value.crash?.executable)
    && value.crash?.planLength === CRASH_PLAN_LENGTH && value.crash?.tenants === CRASH_TENANTS
    && Array.isArray(value.crash?.cycles) && value.crash.cycles.length >= MINIMUM_CRASH_CYCLES
    && value.crash.cycles.every(cyclePassed)
    && exactInputs(value.inputs) && value.inputSetDigest === digestInputs(value.inputs);
}

/**
 * A cycle counts only if the kill landed mid-run (the load did not finish and at least one
 * tenant was cut short), something had committed, every write the Cloud acknowledged before the
 * kill survived it, and verification found the committed prefix whole, resumed it with exactly
 * that many duplicates, and reached the full plan everywhere. Each tenant writes one item at a
 * time, so at most one item per tenant (sent, committed, unacknowledged) may sit above its last
 * acknowledgement.
 */
export function cyclePassed(cycle) {
  const committed = cycle?.committed;
  const final = cycle?.final;
  const acknowledged = cycle?.acknowledged;
  if (!Array.isArray(committed) || !Array.isArray(final) || !Array.isArray(acknowledged)) return false;
  if (committed.length !== CRASH_TENANTS || final.length !== CRASH_TENANTS || acknowledged.length !== CRASH_TENANTS) return false;
  if (!acknowledged.every((value, index) => Number.isSafeInteger(value)
    && committed[index] >= value && committed[index] <= value + 1)) return false;
  const total = committed.reduce((sum, value) => sum + value, 0);
  return cycle.loadCompleted === false && cycle.loadExitCode !== 0 && cycle.verifyExitCode === 0
    && committed.every((value) => Number.isSafeInteger(value) && value >= 0 && value <= CRASH_PLAN_LENGTH)
    && total > 0 && committed.some((value) => value < CRASH_PLAN_LENGTH)
    && final.every((value) => value === CRASH_PLAN_LENGTH)
    && cycle.duplicates === total
    && Array.isArray(cycle.violations) && cycle.violations.length === 0;
}

function diagnosticRunHeld(report) {
  return exactTests(report.tests) && report.crash.cycles.every(cyclePassed);
}

function exactTests(value) {
  return value?.file === DURABILITY_TEST_FILE && value.success === true && value.failed === 0
    && value.total === DURABILITY_TEST_NAMES.length && value.passed === DURABILITY_TEST_NAMES.length
    && JSON.stringify(value.names) === JSON.stringify(DURABILITY_TEST_NAMES);
}

function exactMetrics(value, soakSeconds) {
  if (!Array.isArray(value) || value.length !== 2) return false;
  const [capacity, soak] = value;
  return capacity?.kind === "capacity" && capacity.mutations > 0 && Number.isFinite(capacity.mutationsPerSecond)
    && soak?.kind === "soak" && soak.seconds === soakSeconds && soak.writes > 0 && soak.racedRetries > 0
    && soak.invariantSweeps > 0 && soak.maxAppConnections <= capacity.connections;
}

function exactInputs(value) {
  return Array.isArray(value) && value.length === DURABILITY_INPUT_PATHS.length
    && value.every(({ path, sha256: digest }, index) => path === DURABILITY_INPUT_PATHS[index]
      && /^[0-9a-f]{64}$/u.test(digest) && digest === sha256(read(path)));
}

export function digestInputs(inputs) {
  return Array.isArray(inputs) ? sha256(inputs.map(({ path, sha256: digest }) => `${path}\0${digest}`).join("\0")) : "";
}

function observeVitest(metricsFile, soakSeconds) {
  const jsonFile = resolve(outputDirectory, "vitest.json");
  const result = spawnSync("pnpm", ["--filter", "@gooddealer/cloud", "exec", "vitest", "run", "--config", "vitest.postgres.config.ts",
    DURABILITY_TEST_FILE, "--reporter=json", `--outputFile=${jsonFile}`], {
    cwd: root, encoding: "utf8", stdio: ["ignore", "inherit", "inherit"],
    env: { ...process.env, GOODDEALER_DURABILITY_METRICS_FILE: metricsFile, GOODDEALER_POSTGRES_SOAK_SECONDS: String(soakSeconds) },
  });
  if (result.error || result.signal) throw new Error("durability Vitest did not run");
  const parsed = JSON.parse(readFileSync(jsonFile, "utf8"));
  const file = parsed.testResults?.[0];
  return {
    file: String(file?.name ?? "").split("/apps/cloud/").at(-1),
    success: parsed.success === true && result.status === 0,
    total: parsed.numTotalTests,
    passed: parsed.numPassedTests,
    failed: parsed.numFailedTests,
    names: (file?.assertionResults ?? []).map(({ title }) => title),
  };
}

function progress(message) { console.error(`[durability] ${new Date().toISOString()} ${message}`); }

function parseArgv(name) {
  const raw = requiredEnvironment(name);
  let value;
  try { value = JSON.parse(raw); } catch { throw new Error(`${name} must be a JSON argv array`); }
  if (!Array.isArray(value) || value.length < 2 || !value.every((part) => typeof part === "string" && part.length > 0)
    || !CRASH_EXECUTABLES.has(value[0])) {
    throw new Error(`${name} must be a JSON argv array naming docker or pg_ctl`);
  }
  return value;
}

function runCrashCommand(argv) {
  const result = spawnSync(argv[0], argv.slice(1), { cwd: root, encoding: "utf8", stdio: ["ignore", "ignore", "inherit"] });
  if (result.error || result.signal || result.status !== 0) throw new Error(`crash command failed: ${argv[0]}`);
}

async function waitForServer(url) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const probe = spawnSync("psql", [url, "--no-psqlrc", "--tuples-only", "--no-align", "--command", "SELECT 1"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    if (probe.status === 0 && probe.stdout.trim() === "1") return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  throw new Error("PostgreSQL did not come back after the restart command");
}

function integerEnvironment(name, fallback, minimum, maximum) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  return value;
}

function psql(url, sql) { return run("psql", [url, "--no-psqlrc", "--set", "ON_ERROR_STOP=1", "--tuples-only", "--no-align", "--command", sql]).trim(); }
function read(path) {
  const absolutePath = resolve(root, path);
  const stat = lstatSync(absolutePath);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`required input is not a regular file: ${path}`);
  return readFileSync(absolutePath, "utf8");
}
function run(command, args) {
  if (!new Set(["git", "psql"]).has(command)) throw new Error(`unapproved executable: ${command}`);
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  if (result.error || result.signal || result.status !== 0) throw new Error(`subprocess failed: ${command}`);
  return result.stdout;
}
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required; PostgreSQL evidence never skips`);
  return value;
}
