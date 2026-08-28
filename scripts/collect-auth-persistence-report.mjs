import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

export const AUTH_PERSISTENCE_INPUT_PATHS = [
  "apps/cloud/src/db/index.ts",
  "apps/cloud/src/db/migrations.ts",
  "apps/cloud/src/modules/identity/login-command.ts",
  "apps/cloud/src/modules/identity/password-hash-port.ts",
  "apps/cloud/src/modules/identity/postgres-authentication-repository.ts",
  "apps/cloud/src/modules/identity/migrations/202608200003-identity-authentication.ts",
  "apps/cloud/test/password-hash-fallback.test.ts",
  "apps/cloud/test/postgres/identity-authentication.test.ts",
  ".github/workflows/wp2-auth-persistence.yml",
];

export const PORTABLE_AUTH_TEST_NAMES = [
  "freezes Argon2id v19 m=65536 t=3 p=1 salt16 hash32 and rejects parameter drift",
  "consumes and zeroes owned bytes on verifier failure while redacting serialization",
  "runs known, unknown, and malformed hashes through one policy-matching verification",
  "keeps the Denying implementation as the default and rejects invalid secret boundaries",
  "rejects inherited, accessor, missing-own, symbol, and custom-prototype fields before verification",
];

export const POSTGRES_AUTH_TEST_NAMES = [
  "separates exact pre-auth email selection from post-auth account RLS and clears pooled settings",
  "commits one of two prepared rotations and treats the loser as a non-revoking conflict",
  "revokes only a proven rotated JTI family and never harms another family",
  "advances the security epoch atomically, revokes all account identity state, and blocks stale commits",
];

const IDENTITY_TABLES = [
  "identity_account_security_states",
  "identity_accounts",
  "identity_auth_sessions",
  "identity_credential_jtis",
  "identity_refresh_families",
];

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.filename)) main();

function main() {
  const ownerUrl = requiredEnvironment("GOODDEALER_POSTGRES_OWNER_URL");
  requiredEnvironment("GOODDEALER_POSTGRES_APP_URL");
  if (process.env.GOODDEALER_UNQUALIFIED_POSTGRES_DIAGNOSTIC === "true") {
    throw new Error("unqualified diagnostic mode cannot produce evidence");
  }
  const serverVersion = psql(ownerUrl, "SHOW server_version");
  if (!/^18\.6(?:\D|$)/u.test(serverVersion)) {
    throw new Error(`PostgreSQL 18.6 required, received ${serverVersion}`);
  }

  const portableTests = observeVitest([
    "test/password-hash-fallback.test.ts",
  ]);
  const postgresTests = observeVitest([
    "--config", "vitest.postgres.config.ts", "test/postgres/identity-authentication.test.ts",
  ]);
  const sourceByPath = new Map(AUTH_PERSISTENCE_INPUT_PATHS.map((path) => [
    path,
    readFileSync(resolve(root, path), "utf8"),
  ]));
  const inputs = [...sourceByPath].map(([path, source]) => ({ path, sha256: sha256(source) }));
  const identitySource = [
    sourceByPath.get("apps/cloud/src/modules/identity/login-command.ts"),
    sourceByPath.get("apps/cloud/src/modules/identity/password-hash-port.ts"),
    sourceByPath.get("apps/cloud/src/modules/identity/postgres-authentication-repository.ts"),
  ].join("\n");
  const publicRoutes = read("apps/cloud/src/entrypoints/routes/public/boundary.ts");
  const adminRoutes = read("apps/cloud/src/entrypoints/routes/admin/boundary.ts");
  const jobs = read("apps/cloud/src/entrypoints/jobs.ts");
  const devicePorts = read("apps/cloud/src/modules/devices/ports.ts");
  const loginSource = sourceByPath.get("apps/cloud/src/modules/identity/login-command.ts") ?? "";
  const passwordSource = sourceByPath.get("apps/cloud/src/modules/identity/password-hash-port.ts") ?? "";
  const dbSource = sourceByPath.get("apps/cloud/src/db/index.ts") ?? "";
  const repositorySource = sourceByPath.get("apps/cloud/src/modules/identity/postgres-authentication-repository.ts") ?? "";

  const report = {
    schemaVersion: 1,
    slice: "auth-persistence",
    passed: true,
    closesGate: false,
    database: {
      serverVersion,
      roles: queryJson(ownerUrl, `
        SELECT coalesce(json_agg(row_to_json(role_row) ORDER BY name)::text, '[]')
        FROM (
          SELECT rolname AS name, rolsuper AS superuser, rolbypassrls AS "bypassRls"
          FROM pg_roles
          WHERE rolname IN ('gooddealer_cloud_app', 'gooddealer_cloud_owner')
        ) role_row
      `),
      rowLevelSecurity: queryJson(ownerUrl, `
        SELECT coalesce(json_agg(row_to_json(rls_row) ORDER BY "table")::text, '[]')
        FROM (
          SELECT relname AS "table", relrowsecurity AS enabled, relforcerowsecurity AS forced
          FROM pg_class
          WHERE relname IN (${IDENTITY_TABLES.map((table) => `'${table}'`).join(", ")})
        ) rls_row
      `),
      identityMigration: queryJson(ownerUrl, `
        SELECT coalesce(json_agg(row_to_json(migration_row) ORDER BY id)::text, '[]')
        FROM (
          SELECT id, owner_module AS owner, checksum
          FROM gooddealer_cloud_migrations
          WHERE id = '202608200003-identity-authentication'
        ) migration_row
      `),
    },
    tests: { portable: portableTests, postgres: postgresTests },
    argon2Policy: observeArgon2Policy(passwordSource),
    selectorAssertions: {
      separateTransactionSettings:
        /"gooddealer\.account_id"\s*\|\s*"gooddealer\.login_email"/u.test(dbSource),
      exactEmailPredicate:
        /WHERE email_normalized = \$1/u.test(repositorySource),
      ownDataPropertyParser:
        /Object\.getOwnPropertyDescriptors\(value\)/u.test(loginSource)
        && /Reflect\.ownKeys\(value\)/u.test(loginSource)
        && /\("value" in descriptor\)/u.test(loginSource),
    },
    productionSurfaces: {
      publicBusinessRoutes: /publicBusinessRoutes:\s*readonly\s*\[\]\s*=\s*\[\]/u.test(publicRoutes) ? 0 : -1,
      adminBusinessRoutes: /adminBusinessRoutes:\s*readonly\s*\[\]\s*=\s*\[\]/u.test(adminRoutes) ? 0 : -1,
      periodicJobs: /periodicJobs:\s*readonly\s*\[\]\s*=\s*\[\]/u.test(jobs) ? 0 : -1,
      passwordVerifier:
        /passwordHash:\s*PasswordHashPort\s*=\s*new DenyingPasswordHashPort\(\)/u.test(loginSource)
        && /class DenyingPasswordHashPort implements PasswordHashPort/u.test(passwordSource)
          ? "DenyingPasswordHashPort" : "unresolved",
      deviceEligibility:
        /class DenyingDeviceLoginEligibilityPort implements DeviceLoginEligibilityPort/u.test(devicePorts)
          ? "DenyingDeviceLoginEligibilityPort" : "unresolved",
      credentialIssuer: /\b(?:CredentialIssuer|issueSigned|signCredential|signEnvelope)\b/u.test(identitySource)
        ? "present" : "absent",
      activeDeviceLeaseIssuance: /\b(?:ActiveDeviceLease|issueLease|signLease)\b/u.test(identitySource),
    },
    limitations: {
      javascriptSourceStringZeroable: false,
      ownedPasswordBytesZeroed: hasPassedTest(portableTests, PORTABLE_AUTH_TEST_NAMES[1]),
      databaseWalHeapScanned: false,
    },
    gates: { "R0-03": "In Progress", "R0-06": "In Progress", "R0-09": "In Progress", "R0-16": "In Progress" },
    inputs,
    inputSetDigest: digestInputs(inputs),
  };
  if (!authPersistenceReportPassesPolicy(report)) throw new Error("auth persistence report failed policy");
  const output = resolve(root, ".artifacts/wp2/auth-persistence/auth-persistence-report.json");
  mkdirSync(resolve(output, ".."), { recursive: true });
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report));
}

export function authPersistenceReportPassesPolicy(value) {
  return value?.schemaVersion === 1
    && value.slice === "auth-persistence"
    && value.passed === true
    && value.closesGate === false
    && /^18\.6(?:\D|$)/u.test(value.database?.serverVersion)
    && exactJson(value.database?.roles, [
      { name: "gooddealer_cloud_app", superuser: false, bypassRls: false },
      { name: "gooddealer_cloud_owner", superuser: false, bypassRls: false },
    ])
    && exactJson(value.database?.rowLevelSecurity, IDENTITY_TABLES.map((table) => ({ table, enabled: true, forced: true })))
    && Array.isArray(value.database?.identityMigration)
    && value.database.identityMigration.length === 1
    && value.database.identityMigration[0]?.id === "202608200003-identity-authentication"
    && value.database.identityMigration[0]?.owner === "identity"
    && /^[0-9a-f]{64}$/u.test(value.database.identityMigration[0]?.checksum)
    && exactTestObservation(value.tests?.portable, "test/password-hash-fallback.test.ts", PORTABLE_AUTH_TEST_NAMES)
    && exactTestObservation(value.tests?.postgres, "test/postgres/identity-authentication.test.ts", POSTGRES_AUTH_TEST_NAMES)
    && exactJson(value.argon2Policy, {
      id: "argon2id-v1", algorithm: "argon2id", version: 19, memoryKiB: 65_536,
      iterations: 3, parallelism: 1, saltBytes: 16, hashBytes: 32,
    })
    && exactTrueObject(value.selectorAssertions, [
      "separateTransactionSettings", "exactEmailPredicate", "ownDataPropertyParser",
    ])
    && exactJson(value.productionSurfaces, {
      publicBusinessRoutes: 0,
      adminBusinessRoutes: 0,
      periodicJobs: 0,
      passwordVerifier: "DenyingPasswordHashPort",
      deviceEligibility: "DenyingDeviceLoginEligibilityPort",
      credentialIssuer: "absent",
      activeDeviceLeaseIssuance: false,
    })
    && exactJson(value.limitations, {
      javascriptSourceStringZeroable: false,
      ownedPasswordBytesZeroed: true,
      databaseWalHeapScanned: false,
    })
    && exactJson(value.gates, {
      "R0-03": "In Progress", "R0-06": "In Progress", "R0-09": "In Progress", "R0-16": "In Progress",
    })
    && exactInputs(value.inputs)
    && value.inputSetDigest === digestInputs(value.inputs);
}

export function digestInputs(inputs) {
  if (!Array.isArray(inputs)) return "";
  return sha256(inputs.map(({ path, sha256: digest }) => `${path}\0${digest}`).join("\0"));
}

function exactInputs(inputs) {
  return Array.isArray(inputs)
    && inputs.length === AUTH_PERSISTENCE_INPUT_PATHS.length
    && new Set(inputs.map(({ path }) => path)).size === inputs.length
    && inputs.every(({ path, sha256: digest }, index) =>
      path === AUTH_PERSISTENCE_INPUT_PATHS[index]
      && /^[0-9a-f]{64}$/u.test(digest)
      && digest === sha256(readFileSync(resolve(root, path))));
}

function exactTestObservation(observation, file, expectedNames) {
  return observation?.file === file
    && observation.success === true
    && observation.total === expectedNames.length
    && observation.passed === expectedNames.length
    && observation.failed === 0
    && Array.isArray(observation.names)
    && new Set(observation.names).size === expectedNames.length
    && exactJson(observation.names, [...expectedNames]);
}

function exactTrueObject(value, keys) {
  return value !== null && typeof value === "object"
    && exactJson(Object.keys(value), keys)
    && keys.every((key) => value[key] === true);
}

function exactJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function observeVitest(arguments_) {
  const result = JSON.parse(run("pnpm", ["--filter", "@gooddealer/cloud", "exec", "vitest", "run", ...arguments_, "--reporter=json"]));
  if (result.success !== true || result.testResults?.length !== 1) throw new Error("targeted Vitest evidence is incomplete");
  const testResult = result.testResults[0];
  return {
    file: String(testResult.name).split("/apps/cloud/").at(-1),
    success: result.success,
    total: result.numTotalTests,
    passed: result.numPassedTests,
    failed: result.numFailedTests,
    names: testResult.assertionResults.map(({ title }) => title),
  };
}

function hasPassedTest(observation, name) {
  return observation.success === true && observation.names.includes(name);
}

function observeArgon2Policy(source) {
  const number = (field) => Number(new RegExp(`${field}:\\s*([0-9_]+)`, "u").exec(source)?.[1]?.replaceAll("_", ""));
  return {
    id: /id:\s*"argon2id-v1"/u.test(source) ? "argon2id-v1" : "unresolved",
    algorithm: /\$argon2id\$v=19/u.test(source) ? "argon2id" : "unresolved",
    version: number("version"),
    memoryKiB: number("memoryKiB"),
    iterations: number("iterations"),
    parallelism: number("parallelism"),
    saltBytes: number("saltBytes"),
    hashBytes: number("hashBytes"),
  };
}

function queryJson(ownerUrl, sql) {
  const value = psql(ownerUrl, sql);
  return JSON.parse(value);
}

function psql(ownerUrl, sql) {
  return run("psql", [ownerUrl, "--no-psqlrc", "--set", "ON_ERROR_STOP=1", "--tuples-only", "--no-align", "--command", sql]).trim();
}

function read(path) {
  return readFileSync(resolve(root, path), "utf8");
}

function run(command, arguments_) {
  if (command !== "pnpm" && command !== "psql") throw new Error(`unapproved executable: ${command}`);
  const result = spawnSync(command, arguments_, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "inherit"],
  });
  if (result.error || result.signal || result.status !== 0) {
    throw new Error(`auth persistence subprocess failed: ${command}`);
  }
  return result.stdout ?? "";
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (value === undefined || value.length === 0) throw new Error(`${name} is required; PostgreSQL evidence never skips`);
  return value;
}
