import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const ownerUrl = requiredEnvironment("GOODDEALER_POSTGRES_OWNER_URL");
requiredEnvironment("GOODDEALER_POSTGRES_APP_URL");

const serverVersion = run("psql", [ownerUrl, "--no-psqlrc", "--tuples-only", "--no-align", "--command", "SHOW server_version"]).trim();
if (!/^18\.6(?:\D|$)/u.test(serverVersion)) {
  throw new Error(`PostgreSQL 18.6 required, received ${serverVersion}`);
}

run("pnpm", ["--filter", "@gooddealer/cloud", "test:postgres"]);
const migrations = JSON.parse(run("psql", [
  ownerUrl,
  "--no-psqlrc",
  "--tuples-only",
  "--no-align",
  "--command",
  "SELECT coalesce(json_agg(row_to_json(m) ORDER BY id)::text, '[]') FROM (SELECT id, owner_module AS owner, checksum FROM gooddealer_cloud_migrations) m",
]).trim());

const report = {
  schemaVersion: 1,
  slice: "cloud-persistence",
  passed: true,
  closesGate: false,
  serverVersion,
  applicationRole: { superuser: false, bypassRls: false },
  migrations,
  verifiedCases: [
    "migration-idempotence-and-checksums",
    "same-literal-id-tenant-isolation",
    "pool-reuse-after-commit-and-rollback",
    "forced-rls-cross-tenant-write-rejection",
    "atomic-cas-and-portfolio-materialization",
    "one-concurrent-writer-wins",
  ],
  productionSurfaces: {
    publicBusinessRoutes: 0,
    adminBusinessRoutes: 0,
    periodicJobs: 0,
    networkComposition: false,
  },
  gates: { "R0-04": "In Progress", "R0-09": "In Progress", "R0-15": "In Progress" },
};
const output = resolve(root, ".artifacts/wp4/cloud-persistence/cloud-persistence-report.json");
mkdirSync(resolve(output, ".."), { recursive: true });
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report));

function run(command, args) {
  if (command !== "pnpm" && command !== "psql") throw new Error(`unapproved executable: ${command}`);
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "inherit"],
  });
  if (result.error || result.signal || result.status !== 0) {
    throw new Error(`cloud persistence subprocess failed: ${command}`);
  }
  return result.stdout ?? "";
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required; PostgreSQL persistence evidence never skips`);
  }
  return value;
}
