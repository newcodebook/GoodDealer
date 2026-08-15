import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { arch, platform, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(import.meta.dirname, "..");
const defaultOutputPath = resolve(
  root,
  process.argv[2] ?? ".artifacts/wp1/keychain/keychain-canary-report.json",
);

export const KEYCHAIN_CANARY = "GOODDEALER_KEYCHAIN_CANARY_DO_NOT_PERSIST_IN_PLAINTEXT";
export const KEYCHAIN_ENVELOPE_MARKER = "gd.auth-refresh.v1";
export const KEYCHAIN_SURFACES = Object.freeze([
  "dom",
  "ts-heap",
  "ipc",
  "db",
  "wal",
  "logs",
  "crash",
]);

const credentialReferenceMarkers = Object.freeze([
  "SecKeychainItemRef",
  "CFTypeRef",
  "CREDENTIALW",
  "PCREDENTIAL",
  "credentialRef=",
]);
const pendingSignedBuild = "pending-signed-build-e4";

class DisposableKeychainUnavailable extends Error {
  constructor(stage) {
    super(stage);
    this.name = "DisposableKeychainUnavailable";
    this.stage = stage;
  }
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function contains(content, marker) {
  return content.includes(Buffer.from(marker));
}

export function scanKeychainSurface({ surface, surfacePresent, content }) {
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
  const rendered = bytes.toString("utf8");
  return {
    surface,
    surfacePresent,
    bytes: bytes.length,
    sha256: sha256(bytes),
    canaryAbsent: !contains(bytes, KEYCHAIN_CANARY),
    envelopeMarkerAbsent: !contains(bytes, KEYCHAIN_ENVELOPE_MARKER),
    credentialRefAbsent: credentialReferenceMarkers.every(
      (marker) => !rendered.includes(marker),
    ),
  };
}

function expectedPlatformRows() {
  return [
    {
      environment: "W",
      runner: "windows-2025",
      platform: "win32",
      arch: "x64",
      backend: "windows-credential-manager",
    },
    {
      environment: "MA",
      runner: "macos-15",
      platform: "darwin",
      arch: "arm64",
      backend: "macos-keychain-services",
    },
    {
      environment: "MI",
      runner: "macos-15-intel",
      platform: "darwin",
      arch: "x64",
      backend: "macos-keychain-services",
    },
  ];
}

export function keychainSupportMatrix({
  actualPlatform,
  actualArch,
  probeExecuted,
  reportStatus,
}) {
  return expectedPlatformRows().map((row) => {
    if (row.environment === "W") {
      return {
        ...row,
        probeExecuted: false,
        evidenceStatus: pendingSignedBuild,
        signedBuildStatus: pendingSignedBuild,
        verified: false,
      };
    }

    const current = row.platform === actualPlatform && row.arch === actualArch;
    return {
      ...row,
      probeExecuted: current ? probeExecuted : false,
      evidenceStatus: current
        ? reportStatus === "passed"
          ? "passed-unsigned-development"
          : reportStatus === "ignored"
            ? "ignored-disposable-keychain-unavailable"
            : "failed-unsigned-development"
        : "pending-platform-run",
      signedBuildStatus: pendingSignedBuild,
      verified: false,
    };
  });
}

function supportMatrixPassesPolicy(report) {
  if (!Array.isArray(report.supportMatrix) || report.supportMatrix.length !== 3) return false;
  const expectedRows = expectedPlatformRows();
  for (const expected of expectedRows) {
    const row = report.supportMatrix.find(
      (candidate) => candidate.environment === expected.environment,
    );
    if (
      !row ||
      row.runner !== expected.runner ||
      row.platform !== expected.platform ||
      row.arch !== expected.arch ||
      row.backend !== expected.backend ||
      row.signedBuildStatus !== pendingSignedBuild ||
      row.verified !== false
    ) {
      return false;
    }
  }

  const windows = report.supportMatrix.find((row) => row.environment === "W");
  if (
    windows.probeExecuted !== false ||
    windows.evidenceStatus !== pendingSignedBuild
  ) {
    return false;
  }

  const currentMac = report.supportMatrix.find(
    (row) => row.platform === report.platform && row.arch === report.arch,
  );
  if (report.platform === "darwin") {
    if (!currentMac || currentMac.probeExecuted !== report.probeExecuted) return false;
    if (
      report.status === "passed" &&
      currentMac.evidenceStatus !== "passed-unsigned-development"
    ) {
      return false;
    }
    if (
      report.status === "ignored" &&
      currentMac.evidenceStatus !== "ignored-disposable-keychain-unavailable"
    ) {
      return false;
    }
  }
  return true;
}

function scansPassPolicy(scans) {
  if (!Array.isArray(scans) || scans.length !== KEYCHAIN_SURFACES.length) return false;
  if (new Set(scans.map((scan) => scan.surface)).size !== KEYCHAIN_SURFACES.length) return false;
  return KEYCHAIN_SURFACES.every((surface) => {
    const scan = scans.find((candidate) => candidate.surface === surface);
    return Boolean(
      scan &&
        typeof scan.surfacePresent === "boolean" &&
        Number.isInteger(scan.bytes) &&
        scan.bytes >= 0 &&
        /^[0-9a-f]{64}$/.test(scan.sha256) &&
        scan.canaryAbsent === true &&
        scan.envelopeMarkerAbsent === true &&
        scan.credentialRefAbsent === true,
    );
  });
}

export function keychainCanaryReportPassesPolicy(report) {
  return Boolean(
    report?.schemaVersion === 1 &&
      report.status === "passed" &&
      report.platform === "darwin" &&
      (report.arch === "arm64" || report.arch === "x64") &&
      report.keychainBackend === "macos-keychain-services" &&
      report.probeExecuted === true &&
      report.signedBuild === false &&
      report.roundTripCommitted === true &&
      report.namespaceIsolated === true &&
      report.namespaceConfusionNegative === true &&
      report.deleteIdempotent === true &&
      report.credentialRefNeverReturned === true &&
      scansPassPolicy(report.scans) &&
      supportMatrixPassesPolicy(report)
  );
}

export function keychainCanaryReportIsHonestIgnore(report) {
  const expectedReason =
    report?.platform === "win32"
      ? pendingSignedBuild
      : "disposable-keychain-unavailable";
  return Boolean(
    report?.schemaVersion === 1 &&
      report.status === "ignored" &&
      (report.platform === "darwin" || report.platform === "win32") &&
      report.probeExecuted === false &&
      report.ignoreReason === expectedReason &&
      report.roundTripCommitted === null &&
      report.namespaceIsolated === null &&
      report.namespaceConfusionNegative === null &&
      report.deleteIdempotent === null &&
      report.credentialRefNeverReturned === null &&
      Array.isArray(report.scans) &&
      report.scans.length === 0 &&
      supportMatrixPassesPolicy(report)
  );
}

function parseKeychainPaths(output) {
  return [...output.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

function rustProbeSource() {
  return `use std::env;
use std::io::{self, Read};

use gooddealer_secure_host_core::{
    AccountSessionKeychainScope, KeychainPort, OsKeychainAdapter, RefreshTokenMaterial,
};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut canary = Vec::new();
    io::stdin().read_to_end(&mut canary)?;
    let material = RefreshTokenMaterial::try_from_keychain_bytes(canary.clone())
        .map_err(|_| io::Error::other("invalid canary envelope"))?;
    let suffix = env::var("GOODDEALER_KEYCHAIN_SCOPE_SUFFIX")?;
    let account_id = format!("canary-account-{suffix}");
    let wrong_account_id = format!("provider-confusion-{suffix}");
    let device_id = format!("canary-device-{suffix}");
    let scope = AccountSessionKeychainScope {
        account_id: &account_id,
        device_id: &device_id,
    };
    let wrong_scope = AccountSessionKeychainScope {
        account_id: &wrong_account_id,
        device_id: &device_id,
    };
    let mut adapter = OsKeychainAdapter::for_account_session_namespace();

    adapter
        .delete_refresh_token(scope)
        .map_err(|_| io::Error::other("initial delete failed"))?;
    adapter
        .replace_refresh_token(scope, &material)
        .map_err(|_| io::Error::other("replace failed"))?;
    let loaded = adapter
        .load_refresh_token(scope)
        .map_err(|_| io::Error::other("load failed"))?
        .ok_or_else(|| io::Error::other("stored canary missing"))?;
    if loaded.expose_for_keychain_or_refresh_transport() != canary.as_slice() {
        return Err(io::Error::other("round trip mismatch").into());
    }
    if adapter
        .load_refresh_token(wrong_scope)
        .map_err(|_| io::Error::other("wrong-target load failed"))?
        .is_some()
    {
        return Err(io::Error::other("namespace confusion returned a credential").into());
    }
    adapter
        .delete_refresh_token(scope)
        .map_err(|_| io::Error::other("first delete failed"))?;
    adapter
        .delete_refresh_token(scope)
        .map_err(|_| io::Error::other("idempotent delete failed"))?;
    if adapter
        .load_refresh_token(scope)
        .map_err(|_| io::Error::other("final load failed"))?
        .is_some()
    {
        return Err(io::Error::other("credential remained after delete").into());
    }
    Ok(())
}
`;
}

function cargoManifest() {
  const dependencyPath = resolve(root, "crates/secure-host-core").replaceAll("\\", "\\\\");
  return `[package]
name = "gooddealer-keychain-canary-probe"
version = "0.0.0"
edition = "2024"

[dependencies]
gooddealer-secure-host-core = { path = "${dependencyPath}" }
`;
}

function canaryEnvelope() {
  const fixture = JSON.parse(
    readFileSync(
      resolve(root, "packages/protocol/test-vectors/account/valid/auth-refresh-envelope.json"),
      "utf8",
    ),
  );
  fixture.jti = KEYCHAIN_CANARY;
  return Buffer.from(JSON.stringify(fixture));
}

function ignoredReport({ actualPlatform, actualArch, ignoreReason, failureStage }) {
  const report = {
    schemaVersion: 1,
    scope:
      "disposable Host keychain Canary spike only; no production credential, session, IPC, signing identity, network, or user data",
    status: "ignored",
    platform: actualPlatform,
    arch: actualArch,
    keychainBackend:
      actualPlatform === "win32"
        ? "windows-credential-manager"
        : "macos-keychain-services",
    signedBuild: false,
    probeExecuted: false,
    ignoreReason,
    capabilityFailureStage: failureStage,
    roundTripCommitted: null,
    namespaceIsolated: null,
    namespaceConfusionNegative: null,
    deleteIdempotent: null,
    credentialRefNeverReturned: null,
    scans: [],
  };
  report.supportMatrix = keychainSupportMatrix({
    actualPlatform,
    actualArch,
    probeExecuted: false,
    reportStatus: report.status,
  });
  return report;
}

function failedReport({ actualPlatform, actualArch, failureStage, probeExecuted }) {
  const report = {
    schemaVersion: 1,
    scope:
      "disposable Host keychain Canary spike only; no production credential, session, IPC, signing identity, network, or user data",
    status: "failed",
    platform: actualPlatform,
    arch: actualArch,
    keychainBackend: "macos-keychain-services",
    signedBuild: false,
    probeExecuted,
    failureStage,
    roundTripCommitted: null,
    namespaceIsolated: null,
    namespaceConfusionNegative: null,
    deleteIdempotent: null,
    credentialRefNeverReturned: null,
    scans: [],
  };
  report.supportMatrix = keychainSupportMatrix({
    actualPlatform,
    actualArch,
    probeExecuted,
    reportStatus: report.status,
  });
  return report;
}

function commandSucceeded(result) {
  return result.status === 0 && !result.error;
}

export function collectKeychainCanaryReport() {
  const actualPlatform = platform();
  const actualArch = arch();
  if (actualPlatform === "win32") {
    return ignoredReport({
      actualPlatform,
      actualArch,
      ignoreReason: pendingSignedBuild,
      failureStage: "signed-build-e4-not-available",
    });
  }
  if (actualPlatform !== "darwin") {
    throw new Error(`unsupported keychain Canary evidence platform: ${actualPlatform}`);
  }

  const logChunks = [];
  const run = (binary, args, options = {}) => {
    const result = spawnSync(binary, args, {
      cwd: root,
      encoding: null,
      maxBuffer: 128 * 1024 * 1024,
      timeout: 180_000,
      ...options,
    });
    logChunks.push(result.stdout ?? Buffer.alloc(0), result.stderr ?? Buffer.alloc(0));
    if (result.error) logChunks.push(Buffer.from(`${result.error.name}\n`));
    return result;
  };

  const nativeIsolation = run("cargo", [
    "test",
    "-p",
    "gooddealer-secure-host-core",
    "--features",
    "keychain-canary-spike",
    "keychain::macos::tests::disposable_native_keychain_obeys_replace_load_delete_and_namespace_contract",
    "--",
    "--ignored",
    "--exact",
  ]);
  if (!commandSucceeded(nativeIsolation)) {
    return ignoredReport({
      actualPlatform,
      actualArch,
      ignoreReason: "disposable-keychain-unavailable",
      failureStage: "native-disposable-keychain-capability-probe",
    });
  }

  const originalDefault = run("security", ["default-keychain", "-d", "user"]);
  const originalSearch = run("security", ["list-keychains", "-d", "user"]);
  if (!commandSucceeded(originalDefault) || !commandSucceeded(originalSearch)) {
    return ignoredReport({
      actualPlatform,
      actualArch,
      ignoreReason: "disposable-keychain-unavailable",
      failureStage: "read-keychain-configuration",
    });
  }
  const defaultPaths = parseKeychainPaths(
    (originalDefault.stdout ?? Buffer.alloc(0)).toString("utf8"),
  );
  const searchPaths = parseKeychainPaths(
    (originalSearch.stdout ?? Buffer.alloc(0)).toString("utf8"),
  );
  if (defaultPaths.length !== 1 || searchPaths.length === 0) {
    return ignoredReport({
      actualPlatform,
      actualArch,
      ignoreReason: "disposable-keychain-unavailable",
      failureStage: "parse-keychain-configuration",
    });
  }

  const temporaryDirectory = mkdtempSync(join(tmpdir(), "gooddealer-keychain-canary-"));
  const keychainPath = join(temporaryDirectory, "canary.keychain-db");
  const password = randomBytes(24).toString("hex");
  const suffix = randomBytes(12).toString("hex");
  let keychainCreated = false;
  let searchChanged = false;
  let defaultChanged = false;
  let probeExecuted = false;
  let failureStage = null;
  let unavailableStage = null;
  let cleanupFailed = false;

  try {
    const create = run("security", ["create-keychain", "-p", password, keychainPath]);
    if (!commandSucceeded(create)) {
      throw new DisposableKeychainUnavailable("create-disposable-keychain");
    }
    keychainCreated = true;
    const unlock = run("security", ["unlock-keychain", "-p", password, keychainPath]);
    const configure = run("security", ["set-keychain-settings", "-lut", "21600", keychainPath]);
    if (!commandSucceeded(unlock) || !commandSucceeded(configure)) {
      throw new DisposableKeychainUnavailable("unlock-disposable-keychain");
    }
    const setSearch = run("security", [
      "list-keychains",
      "-d",
      "user",
      "-s",
      keychainPath,
      ...searchPaths,
    ]);
    if (!commandSucceeded(setSearch)) {
      throw new DisposableKeychainUnavailable("select-disposable-keychain");
    }
    searchChanged = true;
    const setDefault = run("security", [
      "default-keychain",
      "-d",
      "user",
      "-s",
      keychainPath,
    ]);
    if (!commandSucceeded(setDefault)) {
      throw new DisposableKeychainUnavailable("select-disposable-keychain");
    }
    defaultChanged = true;

    mkdirSync(join(temporaryDirectory, "src"), { recursive: true });
    writeFileSync(join(temporaryDirectory, "Cargo.toml"), cargoManifest());
    writeFileSync(join(temporaryDirectory, "src/main.rs"), rustProbeSource());
    probeExecuted = true;
    const probe = run(
      "cargo",
      ["run", "--quiet", "--manifest-path", join(temporaryDirectory, "Cargo.toml")],
      {
        cwd: temporaryDirectory,
        input: canaryEnvelope(),
        env: {
          ...process.env,
          CARGO_TARGET_DIR: join(temporaryDirectory, "target"),
          GOODDEALER_KEYCHAIN_SCOPE_SUFFIX: suffix,
        },
      },
    );
    if (!commandSucceeded(probe)) failureStage = "os-keychain-adapter-canary-round-trip";
  } catch (error) {
    if (error instanceof DisposableKeychainUnavailable) {
      unavailableStage = error.stage;
    } else {
      failureStage = "unexpected-canary-probe-error";
    }
  } finally {
    if (defaultChanged) {
      const restoreDefault = run("security", [
        "default-keychain",
        "-d",
        "user",
        "-s",
        defaultPaths[0],
      ]);
      cleanupFailed = !commandSucceeded(restoreDefault) || cleanupFailed;
    }
    if (searchChanged) {
      const restoreSearch = run("security", [
        "list-keychains",
        "-d",
        "user",
        "-s",
        ...searchPaths,
      ]);
      cleanupFailed = !commandSucceeded(restoreSearch) || cleanupFailed;
    }
    if (keychainCreated) {
      const deleteKeychain = run("security", ["delete-keychain", keychainPath]);
      cleanupFailed = !commandSucceeded(deleteKeychain) || cleanupFailed;
    }
    try {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    } catch {
      cleanupFailed = true;
    }
  }

  if (cleanupFailed) {
    return failedReport({
      actualPlatform,
      actualArch,
      failureStage: "restore-keychain-configuration",
      probeExecuted,
    });
  }
  if (unavailableStage !== null) {
    return ignoredReport({
      actualPlatform,
      actualArch,
      ignoreReason: "disposable-keychain-unavailable",
      failureStage: unavailableStage,
    });
  }
  if (failureStage !== null) {
    return failedReport({
      actualPlatform,
      actualArch,
      failureStage,
      probeExecuted,
    });
  }

  const logs = Buffer.concat(logChunks);
  const scans = KEYCHAIN_SURFACES.map((surface) =>
    scanKeychainSurface({
      surface,
      surfacePresent: surface === "logs",
      content: surface === "logs" ? logs : Buffer.alloc(0),
    }),
  );
  const report = {
    schemaVersion: 1,
    scope:
      "disposable Host keychain Canary spike only; no production credential, session, IPC, signing identity, network, or user data",
    status: "passed",
    platform: actualPlatform,
    arch: actualArch,
    keychainBackend: "macos-keychain-services",
    signedBuild: false,
    probeExecuted: true,
    roundTripCommitted: true,
    namespaceIsolated: true,
    namespaceConfusionNegative: true,
    deleteIdempotent: true,
    credentialRefNeverReturned: true,
    scans,
  };
  report.supportMatrix = keychainSupportMatrix({
    actualPlatform,
    actualArch,
    probeExecuted: true,
    reportStatus: report.status,
  });
  if (!keychainCanaryReportPassesPolicy(report)) {
    report.status = "failed";
    report.supportMatrix = keychainSupportMatrix({
      actualPlatform,
      actualArch,
      probeExecuted: true,
      reportStatus: report.status,
    });
  }
  return report;
}

function main() {
  const outputPath = resolve(root, process.argv[2] ?? defaultOutputPath);
  const report = collectKeychainCanaryReport();
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  process.exitCode =
    keychainCanaryReportPassesPolicy(report) || keychainCanaryReportIsHonestIgnore(report)
      ? 0
      : 1;
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) main();
