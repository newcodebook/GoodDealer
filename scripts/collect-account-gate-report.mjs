import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(import.meta.dirname, "..");
const outputPath = resolve(root, process.argv[2] ?? ".artifacts/wp2/account-gate/account-gate-report.json");
const requiredInputs = [
  "packages/protocol/src/account/account-gate.ts",
  "packages/protocol/src/account/auth-session.ts",
  "packages/protocol/src/account/entitlement-projection.ts",
  "packages/protocol/src/devices/device-management.ts",
  "packages/protocol/src/devices/bootstrap-steps.ts",
  "packages/protocol/src/wire/canonical-codec.ts",
  "packages/protocol/src/workspace/sync-mutation.ts",
  "packages/client-core/src/runtime-mode/index.ts",
  "apps/cloud/src/modules/identity/index.ts",
  "apps/cloud/src/modules/licensing/index.ts",
  "apps/cloud/src/modules/devices/index.ts",
  "apps/cloud/src/modules/devices/bootstrap-fixture.ts",
  "packages/protocol/test/account-auth.test.ts",
  "packages/protocol/test/account-gate.test.ts",
  "packages/protocol/test/device-management.test.ts",
  "packages/protocol/test/bootstrap-steps.test.ts",
  "packages/protocol/test/workspace-sync.test.ts",
  "packages/client-core/test/runtime-mode.test.ts",
  "apps/cloud/test/identity-fixture.test.ts",
  "apps/cloud/test/licensing-fixture.test.ts",
  "apps/cloud/test/devices-fixture.test.ts",
  "apps/cloud/test/bootstrap-fixture.test.ts",
];

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function jsonFiles(path) {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = resolve(path, entry.name);
    return entry.isDirectory() ? jsonFiles(child) : entry.name.endsWith(".json") ? [child] : [];
  });
}

function vectorCounts(basePath) {
  const count = (kind) => {
    const directory = resolve(root, basePath, kind);
    const files = jsonFiles(directory);
    for (const path of files) JSON.parse(readFileSync(path, "utf8"));
    return files.length;
  };
  return { valid: count("valid"), invalid: count("invalid") };
}

export function sourceRegistersProductionRoute(source) {
  const importsProductionServer = /\bfrom\s+["']fastify["']|\brequire\s*\(\s*["']fastify["']\s*\)/.test(source);
  const invokesNetworkPrimitive = /\b(?:fastify|fetch)\s*\(/.test(source);
  const registersRoute =
    /\b(?:app|server|fastify)\s*\.\s*(?:delete|get|head|listen|options|patch|post|put|register|route)\s*\(/.test(
      source,
    );
  return importsProductionServer || invokesNetworkPrimitive || registersRoute;
}

export function sourceDeclaresRawCredentialField(source) {
  return /(?:\b(?:accessToken|apiKey|clientSecret|credential|password|refreshToken)\b|["'](?:accessToken|apiKey|clientSecret|credential|password|refreshToken)["'])\s*[?!]?\s*:/.test(
    source,
  );
}

export function identityFixtureIsNonSellable(source) {
  return /\breadonly\s+sellable\s*=\s*false(?:\s+as\s+const)?\s*;/.test(source);
}

export function collectAccountGateReport() {
  const inputs = requiredInputs.filter((path) => existsSync(resolve(root, path))).map((path) => {
    const content = readFileSync(resolve(root, path));
    return { path, bytes: content.length, sha256: sha256(content) };
  });
  const runtimeSource = requiredInputs
    .filter((path) => path.includes("/src/"))
    .map((path) => readFileSync(resolve(root, path), "utf8"))
    .join("\n");
  const identitySource = readFileSync(resolve(root, "apps/cloud/src/modules/identity/index.ts"), "utf8");

  return {
    schemaVersion: 1,
    scope:
      "Internal non-sellable account/device/bootstrap/workspace Cloud fixtures and read-only client projection only; no production route, lease signing, raw credential, native keychain, external network, or user data.",
    fixtureOnly: true,
    productionRoutesRegistered: sourceRegistersProductionRoute(runtimeSource),
    rawCredentialFieldsAbsent: !sourceDeclaresRawCredentialField(runtimeSource),
    internalAccountSellable: !identityFixtureIsNonSellable(identitySource),
    requiredInputsPresent: inputs.length === requiredInputs.length,
    accountVectors: vectorCounts("packages/protocol/test-vectors/account"),
    deviceVectors: vectorCounts("packages/protocol/test-vectors/device-management"),
    bootstrapVectors: vectorCounts("packages/protocol/test-vectors/bootstrap-steps"),
    workspaceVectors: vectorCounts("packages/protocol/test-vectors/workspace-sync"),
    inputs,
  };
}

function main() {
  const report = collectAccountGateReport();
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);

  const valid =
    report.productionRoutesRegistered === false &&
    report.rawCredentialFieldsAbsent &&
    report.internalAccountSellable === false &&
    report.requiredInputsPresent &&
    report.accountVectors.valid > 0 &&
    report.accountVectors.invalid > 0 &&
    report.deviceVectors.valid > 0 &&
    report.deviceVectors.invalid > 0 &&
    report.bootstrapVectors.valid > 0 &&
    report.bootstrapVectors.invalid > 0 &&
    report.workspaceVectors.valid > 0 &&
    report.workspaceVectors.invalid > 0 &&
    report.inputs.every((input) => statSync(resolve(root, input.path)).isFile());

  console.log(JSON.stringify(report, null, 2));
  process.exitCode = valid ? 0 : 1;
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) main();
