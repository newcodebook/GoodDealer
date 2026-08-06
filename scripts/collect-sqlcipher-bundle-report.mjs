import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const outputPath = resolve(
  root,
  process.argv[2] ?? ".artifacts/wp5/sqlcipher-bundle/sqlcipher-bundle-report.json",
);
const runtimeReportPath = resolve(dirname(outputPath), "sqlcipher-bundle-runtime.json");
const bundleRoot = resolve(root, "target/release/bundle");
const releaseExecutable = resolve(
  root,
  process.platform === "win32"
    ? "target/release/gooddealer-desktop-tauri.exe"
    : "target/release/gooddealer-desktop-tauri",
);

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? walk(path) : [path];
    })
    .sort();
}

function describeFile(path) {
  const content = readFileSync(path);
  return {
    bytes: content.length,
    sha256: sha256(content),
  };
}

function describeDirectory(path) {
  const records = walk(path).map((file) => {
    const stat = lstatSync(file);
    const logicalPath = relative(path, file).replaceAll("\\", "/");
    if (stat.isSymbolicLink()) {
      const target = readlinkSync(file);
      return {
        path: logicalPath,
        kind: "symlink",
        bytes: Buffer.byteLength(target),
        sha256: sha256(target),
      };
    }
    const description = describeFile(file);
    return { path: logicalPath, kind: "file", ...description };
  });
  return {
    bytes: records.reduce((total, record) => total + record.bytes, 0),
    fileCount: records.length,
    sha256: sha256(JSON.stringify(records)),
  };
}

function findBundle() {
  if (process.platform === "darwin") {
    const applications = walk(bundleRoot)
      .filter((path) => path.includes(".app/"))
      .map((path) => `${path.split(".app/")[0]}.app`)
      .filter((path) => path.endsWith(".app"));
    const uniqueApplications = [...new Set(applications)];
    if (uniqueApplications.length !== 1) {
      throw new Error(`expected one macOS app bundle, found ${uniqueApplications.length}`);
    }
    return { kind: "app", path: uniqueApplications[0] };
  }
  if (process.platform === "win32") {
    const installers = walk(bundleRoot).filter((path) => path.toLowerCase().endsWith(".msi"));
    if (installers.length !== 1) {
      throw new Error(`expected one Windows MSI bundle, found ${installers.length}`);
    }
    return { kind: "msi", path: installers[0] };
  }
  throw new Error(`unsupported SQLCipher bundle evidence platform: ${process.platform}`);
}

function runProbe(candidates) {
  const attempts = [];
  for (const candidate of candidates) {
    rmSync(runtimeReportPath, { force: true });
    const result = spawnSync(
      candidate,
      ["--sqlcipher-bundle-spike-report", runtimeReportPath],
      {
        cwd: dirname(candidate),
        encoding: "utf8",
        timeout: 120_000,
        windowsHide: true,
      },
    );
    attempts.push({
      candidate: basename(candidate),
      exitCode: result.status,
      signal: result.signal,
      error: result.error?.message ?? null,
    });
    if (result.status === 0 && existsSync(runtimeReportPath)) {
      return { executable: candidate, attempts };
    }
  }
  throw new Error(`no bundled executable completed the SQLCipher probe: ${JSON.stringify(attempts)}`);
}

if (!existsSync(releaseExecutable)) {
  throw new Error(`release executable is missing: ${releaseExecutable}`);
}

const bundle = findBundle();
let extractionDirectory = null;
let probe;
try {
  if (bundle.kind === "app") {
    const executableDirectory = join(bundle.path, "Contents", "MacOS");
    const candidates = walk(executableDirectory).filter(
      (path) => statSync(path).isFile() && (statSync(path).mode & 0o111) !== 0,
    );
    probe = runProbe(candidates);
  } else {
    extractionDirectory = mkdtempSync(join(tmpdir(), "gooddealer-sqlcipher-msi-"));
    const extraction = spawnSync(
      "msiexec.exe",
      ["/a", bundle.path, "/qn", `TARGETDIR=${extractionDirectory}`],
      { encoding: "utf8", timeout: 120_000, windowsHide: true },
    );
    if (extraction.status !== 0) {
      throw new Error(
        `MSI administrative extraction failed with ${extraction.status}: ${extraction.stderr}`,
      );
    }
    const candidates = walk(extractionDirectory).filter((path) =>
      path.toLowerCase().endsWith(".exe"),
    );
    probe = runProbe(candidates);
  }

  const runtime = JSON.parse(readFileSync(runtimeReportPath, "utf8"));
  const releaseDescription = describeFile(releaseExecutable);
  const bundledDescription = describeFile(probe.executable);
  const bundleDescription =
    bundle.kind === "app" ? describeDirectory(bundle.path) : describeFile(bundle.path);
  const report = {
    schemaVersion: 1,
    scope:
      "disposable SQLCipher Tauri release bundle spike only; no production storage, key, IPC, signing identity, or user data",
    tauriReleaseBuild: true,
    bundleProduced: true,
    bundleKind: bundle.kind,
    bundledExecutableExecuted: true,
    sqlcipherVersion: runtime.sqlcipherVersion,
    sqliteVersion: runtime.sqliteVersion,
    databaseEncrypted: runtime.databaseEncrypted,
    correctKeyReadable: runtime.correctKeyReadable,
    wrongKeyRejected: runtime.wrongKeyRejected,
    temporaryDatabaseRemoved: runtime.temporaryDatabaseRemoved,
    releaseExecutable: {
      path: relative(root, releaseExecutable).replaceAll("\\", "/"),
      ...releaseDescription,
    },
    bundledExecutable: {
      source: bundle.kind === "app" ? "macos-app-bundle" : "msi-administrative-extraction",
      name: basename(probe.executable),
      ...bundledDescription,
    },
    bundledExecutableMatchesReleaseExecutable:
      bundledDescription.sha256 === releaseDescription.sha256,
    bundleArtifact: {
      path: relative(root, bundle.path).replaceAll("\\", "/"),
      kind: bundle.kind,
      fileCount: bundle.kind === "app" ? bundleDescription.fileCount : 1,
      ...bundleDescription,
    },
    probeAttempts: probe.attempts,
  };
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
} finally {
  rmSync(runtimeReportPath, { force: true });
  if (extractionDirectory !== null) {
    rmSync(extractionDirectory, { recursive: true, force: true });
  }
}
