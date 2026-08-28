import assert from "node:assert/strict";
import {
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import test from "node:test";

const expectedSourceFiles = [
  "backup_operation.rs",
  "cloudflare_credential.rs",
  "cloudflare_operation.rs",
  "cloudflare_provider.rs",
  "cloudflare_transport.rs",
  "lib.rs",
  "sealed_credential.rs",
  "sealed_host_state.rs",
  "sealed_initialization.rs",
  "sealed_key.rs",
  "sealed_runtime.rs",
  "sealed_secure_http.rs",
  "sealed_session.rs",
];
const expectedPublicExports = [
  "ActiveBackupOperation",
  "BackupArtifactAdmission",
  "BackupExportOperation",
  "BackupOperationError",
  "CloudflareContractError",
  "CloudflareDnsRecord",
  "CloudflareObservationError",
  "CloudflareObservationErrorCode",
  "CloudflareObservationResult",
  "CloudflareObservationSubmitRequest",
  "CloudflareRecordType",
  "CloudflareUnavailableObservationCode",
  "CloudflareZoneMetadata",
  "CloudflareZoneReadIntent",
  "CloudflareZoneStatus",
  "SealedBackupFrame",
  "SecureHost",
];
const repositoryCoreRoot = resolve(import.meta.dirname, "../crates/secure-host-core");

export function secureHostCoreFinalSurfaceErrors({ coreRoot = repositoryCoreRoot } = {}) {
  const errors = [];
  const sourceRoot = resolve(coreRoot, "src");
  const generatedRoot = resolve(sourceRoot, "generated");
  const generatedState = pathState(generatedRoot);
  if (generatedState !== "missing") {
    errors.push(`secure-host-core source generated root must be absent, found ${generatedState}`);
  }

  const sourceState = pathState(sourceRoot);
  if (sourceState !== "directory") {
    errors.push(`secure-host-core source root must be a real directory, found ${sourceState}`);
    return errors;
  }

  const observedFiles = listRegularFiles(sourceRoot, errors).sort();
  if (!sameArray(observedFiles, expectedSourceFiles)) {
    errors.push(`secure-host-core source allowlist differs: ${observedFiles.join(", ")}`);
  }

  const libPath = resolve(sourceRoot, "lib.rs");
  if (pathState(libPath) !== "file") return errors;
  const libSource = readRegularFile(libPath, errors);
  if (libSource === null) return errors;
  const exportPattern = /^[\t ]*pub[\t ]+use[\t ]+(?:backup_operation|cloudflare_operation)::[\t ]*\{([\s\S]*?)\};/gmu;
  const exportMatches = [...libSource.matchAll(exportPattern)];
  if (exportMatches.length !== 2) {
    errors.push("secure-host-core direct backup and Cloudflare export blocks are missing or duplicated");
    return errors;
  }
  const exported = exportMatches
    .flatMap((match) => match[1].split(","))
    .map((value) => value.trim())
    .filter(Boolean)
    .sort();
  if (!sameArray(exported, expectedPublicExports)) {
    errors.push(`secure-host-core public exports differ: ${exported.join(", ")}`);
  }
  const remainingSource = libSource.replace(exportPattern, "");
  if (/\bpub(?:\s*\([^)]*\))?\s+(?:use|mod|struct|enum|trait|fn|type|const|static)\b/u.test(remainingSource)) {
    errors.push("secure-host-core exposes a public item outside the backup and Cloudflare export blocks");
  }
  return errors;
}

function pathState(path) {
  try {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) return "symlink";
    if (stat.isDirectory()) return "directory";
    if (stat.isFile()) return "file";
    return "other";
  } catch (error) {
    if (error?.code === "ENOENT") return "missing";
    return "unreadable";
  }
}

function listRegularFiles(root, errors) {
  const files = [];
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      const state = pathState(path);
      if (state === "directory") {
        visit(path);
      } else if (state === "file") {
        files.push(relative(root, path).replaceAll("\\", "/"));
      } else {
        errors.push(`secure-host-core source entry must be a regular file or directory: ${relative(root, path)}`);
      }
    }
  }
  visit(root);
  return files;
}

function readRegularFile(path, errors) {
  try {
    return lstatSync(path).isFile() ? readFileSync(path, "utf8") : null;
  } catch (error) {
    errors.push(`secure-host-core source file is unreadable: ${relative(repositoryCoreRoot, path)}`);
    return null;
  }
}

function sameArray(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function writeFixture(root) {
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(
    join(root, "src/lib.rs"),
    `#![forbid(unsafe_code)]\n\nmod backup_operation;\nmod cloudflare_credential;\nmod cloudflare_operation;\nmod cloudflare_provider;\nmod cloudflare_transport;\nmod sealed_credential;\nmod sealed_host_state;\nmod sealed_initialization;\nmod sealed_key;\nmod sealed_runtime;\nmod sealed_secure_http;\nmod sealed_session;\n\npub use backup_operation::{\n    ActiveBackupOperation, BackupArtifactAdmission, BackupExportOperation, BackupOperationError,\n    SealedBackupFrame, SecureHost,\n};\npub use cloudflare_operation::{\n    CloudflareContractError, CloudflareDnsRecord, CloudflareObservationError,\n    CloudflareObservationErrorCode, CloudflareRecordType, CloudflareZoneMetadata,\n    CloudflareZoneObservation, CloudflareZoneReadIntent, CloudflareZoneStatus,\n};\n`,
  );
  for (const path of expectedSourceFiles.filter((path) => path !== "lib.rs")) {
    writeFileSync(join(root, "src", path), "// sealed module\n");
  }
}

function useFixture(t) {
  const root = mkdtempSync(join(tmpdir(), "gooddealer-secure-host-core-"));
  writeFixture(root);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test("the repository Core surface is the sealed backup and private Cloudflare allowlist", () => {
  assert.deepEqual(secureHostCoreFinalSurfaceErrors(), []);
});

test("rejects a recreated generated directory or dangling symbolic link", (t) => {
  const directoryFixture = useFixture(t);
  mkdirSync(join(directoryFixture, "src", "generated"));
  assert.ok(secureHostCoreFinalSurfaceErrors({ coreRoot: directoryFixture }).some((error) => error.includes("must be absent")));

  const linkFixture = useFixture(t);
  symlinkSync("missing-target", join(linkFixture, "src", "generated"));
  assert.ok(secureHostCoreFinalSurfaceErrors({ coreRoot: linkFixture }).some((error) => error.includes("symlink")));
});

test("rejects extra source files and public exports", (t) => {
  const extraFileFixture = useFixture(t);
  writeFileSync(join(extraFileFixture, "src", "unreviewed.rs"), "// unexpected\n");
  assert.ok(secureHostCoreFinalSurfaceErrors({ coreRoot: extraFileFixture }).some((error) => error.includes("allowlist")));

  const exportFixture = useFixture(t);
  writeFileSync(join(exportFixture, "src", "lib.rs"), "\npub fn unreviewed() {}\n", { flag: "a" });
  assert.ok(secureHostCoreFinalSurfaceErrors({ coreRoot: exportFixture }).some((error) => error.includes("outside")));
});
