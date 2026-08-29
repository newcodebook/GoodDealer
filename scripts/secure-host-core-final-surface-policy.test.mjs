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

const expectedBaseSourceFiles = [
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
const expectedBasePublicExports = [
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
const localDatabaseKeySourceFile = "local_database_key.rs";
const expectedLocalDatabaseKeyExports = [
  "LocalDatabaseKeyError",
  "LocalDatabaseKeyMaterial",
  "generate_local_database_key",
  "load_local_database_key",
];
const expectedLocalDatabaseKeyPublicItems = [
  "LocalDatabaseKeyError",
  "LocalDatabaseKeyMaterial",
  "copy_for_sqlcipher",
  "generate_local_database_key",
  "load_local_database_key",
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
  const localDatabaseKeyIntegrated = observedFiles.includes(localDatabaseKeySourceFile);
  const expectedSourceFiles = [
    ...expectedBaseSourceFiles,
    ...(localDatabaseKeyIntegrated ? [localDatabaseKeySourceFile] : []),
  ].sort();
  if (!sameArray(observedFiles, expectedSourceFiles)) {
    errors.push(`secure-host-core source allowlist differs: ${observedFiles.join(", ")}`);
  }

  const libPath = resolve(sourceRoot, "lib.rs");
  if (pathState(libPath) !== "file") return errors;
  const libSource = readRegularFile(libPath, errors);
  if (libSource === null) return errors;
  const exportPattern = /^[\t ]*pub[\t ]+use[\t ]+(backup_operation|cloudflare_operation|local_database_key)::[\t ]*\{([\s\S]*?)\};/gmu;
  const exportMatches = [...libSource.matchAll(exportPattern)];
  const expectedExportModules = [
    "backup_operation",
    "cloudflare_operation",
    ...(localDatabaseKeyIntegrated ? ["local_database_key"] : []),
  ];
  if (!sameArray(exportMatches.map((match) => match[1]), expectedExportModules)) {
    errors.push("secure-host-core direct capability export blocks are missing, reordered, or duplicated");
    return errors;
  }
  const exported = exportMatches
    .flatMap((match) => match[2].split(","))
    .map((value) => value.trim())
    .filter(Boolean)
    .sort();
  const expectedPublicExports = [
    ...expectedBasePublicExports,
    ...(localDatabaseKeyIntegrated ? expectedLocalDatabaseKeyExports : []),
  ].sort();
  if (!sameArray(exported, expectedPublicExports)) {
    errors.push(`secure-host-core public exports differ: ${exported.join(", ")}`);
  }
  const remainingSource = libSource.replace(exportPattern, "");
  if (/\bpub(?:\s*\([^)]*\))?\s+(?:use|mod|struct|enum|trait|fn|type|const|static)\b/u.test(remainingSource)) {
    errors.push("secure-host-core exposes a public item outside the exact capability export blocks");
  }
  if (localDatabaseKeyIntegrated) {
    const keySource = readRegularFile(resolve(sourceRoot, localDatabaseKeySourceFile), errors);
    if (keySource !== null) validateLocalDatabaseKeySurface(keySource, errors);
  }
  return errors;
}

function validateLocalDatabaseKeySurface(source, errors) {
  const publicItems = [...source.matchAll(
    /\bpub(?:\s*\([^)]*\))?\s+(?:const|enum|fn|mod|static|struct|trait|type|use)\s+([A-Za-z_][A-Za-z0-9_]*)/gu,
  )]
    .map((match) => match[1])
    .sort();
  if (!sameArray(publicItems, expectedLocalDatabaseKeyPublicItems)) {
    errors.push(`local database key public items differ: ${publicItems.join(", ")}`);
  }
  if (!/pub enum LocalDatabaseKeyError\s*\{\s*Unavailable,\s*Rejected,\s*RandomUnavailable,?\s*\}/u.test(source)) {
    errors.push("local database key errors must remain an exact selector-free set");
  }
  if (!/pub struct LocalDatabaseKeyMaterial\(Zeroizing<\[u8; DATABASE_KEY_BYTES\]>\);/u.test(source)) {
    errors.push("local database key material must remain fixed-length and zeroizing");
  }
  if (!/pub fn copy_for_sqlcipher\(&self\) -> \[u8; DATABASE_KEY_BYTES\]/u.test(source)) {
    errors.push("local database key bytes may cross only the fixed SQLCipher composition method");
  }
  if (!/pub fn load_local_database_key\(\) -> Result<Option<LocalDatabaseKeyMaterial>, LocalDatabaseKeyError>/u.test(source)) {
    errors.push("local database key load operation must remain selector-free and fixed-purpose");
  }
  if (!/pub fn generate_local_database_key\(\) -> Result<LocalDatabaseKeyMaterial, LocalDatabaseKeyError>/u.test(source)) {
    errors.push("local database key generation must remain selector-free and fixed-purpose");
  }
  if (!/formatter\.write_str\("LocalDatabaseKeyMaterial\(\[REDACTED\]\)"\)/u.test(source)) {
    errors.push("local database key Debug output must remain redacted");
  }
  if (/\b(?:Deserialize|Serialize|tauri|workspace[_A-Z]?id|account[_A-Z]?id|tenant|connection[_A-Z]?id|provider|selector|secret)\b/iu.test(source)) {
    errors.push("local database key surface exposes serialization, IPC, tenant, Provider, or selector vocabulary");
  }
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

function writeFixture(root, { localDatabaseKey = true } = {}) {
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(
    join(root, "src/lib.rs"),
    `#![forbid(unsafe_code)]\n\nmod backup_operation;\nmod cloudflare_credential;\nmod cloudflare_operation;\nmod cloudflare_provider;\nmod cloudflare_transport;\n${localDatabaseKey ? "mod local_database_key;\n" : ""}mod sealed_credential;\nmod sealed_host_state;\nmod sealed_initialization;\nmod sealed_key;\nmod sealed_runtime;\nmod sealed_secure_http;\nmod sealed_session;\n\npub use backup_operation::{\n    ActiveBackupOperation, BackupArtifactAdmission, BackupExportOperation, BackupOperationError,\n    SealedBackupFrame, SecureHost,\n};\npub use cloudflare_operation::{\n    CloudflareContractError, CloudflareDnsRecord, CloudflareObservationError,\n    CloudflareObservationErrorCode, CloudflareObservationResult,\n    CloudflareObservationSubmitRequest, CloudflareRecordType, CloudflareUnavailableObservationCode,\n    CloudflareZoneMetadata, CloudflareZoneReadIntent, CloudflareZoneStatus,\n};\n${localDatabaseKey ? "pub use local_database_key::{\n    LocalDatabaseKeyError, LocalDatabaseKeyMaterial, generate_local_database_key,\n    load_local_database_key,\n};\n" : ""}`,
  );
  for (const path of expectedBaseSourceFiles.filter((path) => path !== "lib.rs")) {
    writeFileSync(join(root, "src", path), "// sealed module\n");
  }
  if (localDatabaseKey) {
    writeFileSync(
      join(root, "src", localDatabaseKeySourceFile),
      `use std::fmt::{Debug, Formatter};\nuse zeroize::Zeroizing;\nconst DATABASE_KEY_BYTES: usize = 32;\n#[derive(Debug, Clone, Copy, PartialEq, Eq)]\npub enum LocalDatabaseKeyError { Unavailable, Rejected, RandomUnavailable }\npub struct LocalDatabaseKeyMaterial(Zeroizing<[u8; DATABASE_KEY_BYTES]>);\nimpl LocalDatabaseKeyMaterial {\n    pub fn copy_for_sqlcipher(&self) -> [u8; DATABASE_KEY_BYTES] { *self.0 }\n}\nimpl Debug for LocalDatabaseKeyMaterial {\n    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {\n        formatter.write_str("LocalDatabaseKeyMaterial([REDACTED])")\n    }\n}\npub fn load_local_database_key() -> Result<Option<LocalDatabaseKeyMaterial>, LocalDatabaseKeyError> { todo!() }\npub fn generate_local_database_key() -> Result<LocalDatabaseKeyMaterial, LocalDatabaseKeyError> { todo!() }\n`,
    );
  }
}

function useFixture(t, options) {
  const root = mkdtempSync(join(tmpdir(), "gooddealer-secure-host-core-"));
  writeFixture(root, options);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test("the repository Core surface is the exact staged native capability allowlist", () => {
  assert.deepEqual(secureHostCoreFinalSurfaceErrors(), []);
});

test("accepts both the pre-integration surface and the exact local database key capability", (t) => {
  assert.deepEqual(secureHostCoreFinalSurfaceErrors({ coreRoot: useFixture(t) }), []);
  assert.deepEqual(
    secureHostCoreFinalSurfaceErrors({ coreRoot: useFixture(t, { localDatabaseKey: false }) }),
    [],
  );
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

test("rejects local database key surface broadening and sensitive selectors", (t) => {
  const extraExportFixture = useFixture(t);
  const extraExportPath = join(extraExportFixture, "src", "lib.rs");
  writeFileSync(
    extraExportPath,
    readFileSync(extraExportPath, "utf8").replace(
      "    load_local_database_key,\n};",
      "    load_local_database_key, export_local_database_key_secret,\n};",
    ),
  );
  assert.ok(secureHostCoreFinalSurfaceErrors({ coreRoot: extraExportFixture }).some(
    (error) => error.includes("public exports differ"),
  ));

  const extraItemFixture = useFixture(t);
  writeFileSync(
    join(extraItemFixture, "src", localDatabaseKeySourceFile),
    "\npub fn expose_key() -> Vec<u8> { vec![] }\n",
    { flag: "a" },
  );
  assert.ok(secureHostCoreFinalSurfaceErrors({ coreRoot: extraItemFixture }).some(
    (error) => error.includes("public items differ"),
  ));

  const selectorFixture = useFixture(t);
  const selectorPath = join(selectorFixture, "src", localDatabaseKeySourceFile);
  writeFileSync(
    selectorPath,
    readFileSync(selectorPath, "utf8").replace("RandomUnavailable }", "RandomUnavailable, WorkspaceSelector }"),
  );
  assert.ok(secureHostCoreFinalSurfaceErrors({ coreRoot: selectorFixture }).some(
    (error) => error.includes("selector"),
  ));

  const serializationFixture = useFixture(t);
  const serializationPath = join(serializationFixture, "src", localDatabaseKeySourceFile);
  writeFileSync(serializationPath, `${readFileSync(serializationPath, "utf8")}\nuse serde::Serialize;\n`);
  assert.ok(secureHostCoreFinalSurfaceErrors({ coreRoot: serializationFixture }).some(
    (error) => error.includes("serialization"),
  ));

  const disclosureFixture = useFixture(t);
  const disclosurePath = join(disclosureFixture, "src", localDatabaseKeySourceFile);
  writeFileSync(
    disclosurePath,
    readFileSync(disclosurePath, "utf8").replace(
      "LocalDatabaseKeyMaterial([REDACTED])",
      "LocalDatabaseKeyMaterial({:?})",
    ),
  );
  assert.ok(secureHostCoreFinalSurfaceErrors({ coreRoot: disclosureFixture }).some(
    (error) => error.includes("redacted"),
  ));
});
