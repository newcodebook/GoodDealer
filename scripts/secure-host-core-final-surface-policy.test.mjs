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
  "cloudflare_capture.rs",
  "cloudflare_keychain.rs",
  "cloudflare_provider.rs",
  "desktop_authorization_verifier.rs",
  "desktop_device_identity.rs",
  "desktop_oauth.rs",
  "lib.rs",
  "local_workspace_binding.rs",
];
const expectedCloudflareCaptureExports = [
  "CloudflareCandidate",
  "CloudflareCapture",
  "CloudflareCaptureError",
];
const expectedCloudflareKeychainExports = [
  "CloudflareCredentialProvisionPlan",
  "CloudflareCredentialPublicKind",
  "CloudflareCredentialRecoveryPlan",
  "CloudflareCustodyComparison",
  "CloudflareKeychainError",
  "CloudflareKeychainGuard",
  "CloudflarePrewriteFailure",
  "CloudflarePrewriteInspection",
  "inspect_cloudflare_recovery_guarded",
  "publish_cloudflare_candidate_guarded",
];
const expectedCloudflareProviderExports = [
  "CloudflareCredentialObservationPlan",
  "CloudflareProviderClient",
  "CloudflareProviderError",
  "CloudflareProviderGuard",
  "CloudflareProviderObservation",
  "CloudflareProviderRecord",
  "CloudflareProviderZone",
  "CloudflareProviderZoneStatus",
  "CloudflareRecordType",
];
const desktopAuthorizationSourceFile = "desktop_authorization_verifier.rs";
const desktopDeviceIdentitySourceFile = "desktop_device_identity.rs";
const desktopOAuthSourceFile = "desktop_oauth.rs";
const localWorkspaceBindingSourceFile = "local_workspace_binding.rs";
const expectedDesktopAuthorizationExports = [
  "AuthorizationVerificationKeyError",
  "DesktopAuthorizationCredentialPurpose",
  "DesktopAuthorizationVerificationKey",
  "DesktopAuthorizationVerifier",
  "parse_desktop_authorization_verifier_registry",
];
const expectedDesktopAuthorizationPublicItems = [
  "AuthorizationVerificationKeyError",
  "DesktopAuthorizationCredentialPurpose",
  "DesktopAuthorizationVerificationKey",
  "DesktopAuthorizationVerifier",
  "new",
  "new",
  "parse_desktop_authorization_verifier_registry",
  "verify",
];
const expectedDesktopDeviceIdentityExports = [
  "DESKTOP_DEVICE_PROOF_DOMAIN",
  "DesktopDeviceIdentity",
  "DesktopDeviceIdentityError",
  "DesktopDeviceProofTranscript",
  "load_or_create_desktop_device_identity",
];
const expectedDesktopDeviceIdentityPublicItems = [
  "DESKTOP_DEVICE_PROOF_DOMAIN",
  "DesktopDeviceIdentity",
  "DesktopDeviceIdentityError",
  "DesktopDeviceProofTranscript",
  "device_id",
  "from_test_material",
  "key_id",
  "load_or_create_desktop_device_identity",
  "public_key_base64url",
  "sign_login_proof",
];
const expectedDesktopOAuthExports = [
  "DesktopAccessToken",
  "DesktopAuthorizationCodeExchange",
  "DesktopOAuthAttempt",
  "DesktopOAuthContinuation",
  "DesktopOAuthError",
  "DesktopRefreshRequestId",
  "DesktopRefreshToken",
  "clear_desktop_refresh_request_id",
  "clear_desktop_refresh_token",
  "load_desktop_refresh_request_id",
  "load_desktop_refresh_token",
  "store_desktop_refresh_request_id",
  "store_desktop_refresh_token",
];
const expectedDesktopOAuthPublicItems = [
  "DesktopAccessToken",
  "DesktopAuthorizationCodeExchange",
  "DesktopOAuthAttempt",
  "DesktopOAuthContinuation",
  "DesktopOAuthError",
  "DesktopRefreshRequestId",
  "DesktopRefreshToken",
  "authorization_url",
  "begin",
  "clear_desktop_refresh_request_id",
  "clear_desktop_refresh_token",
  "advance",
  "expose",
  "expose",
  "expose",
  "expose",
  "generate",
  "load_desktop_refresh_request_id",
  "load_desktop_refresh_token",
  "new",
  "new",
  "store_desktop_refresh_request_id",
  "store_desktop_refresh_token",
];
const expectedLocalWorkspaceBindingExports = [
  "LocalWorkspaceBindingError",
  "VerifiedLocalWorkspaceBinding",
  "VerifiedLocalWorkspaceBindingParams",
  "clear_verified_local_workspace_binding",
  "load_verified_local_workspace_binding",
  "store_verified_local_workspace_binding",
];
const expectedLocalWorkspaceBindingPublicItems = [
  "LocalWorkspaceBindingError",
  "VerifiedLocalWorkspaceBinding",
  "account_id",
  "account_security_epoch",
  "allows_local_read",
  "allows_refresh_retry",
  "capability",
  "clear_verified_local_workspace_binding",
  "device_id",
  "entitlement_projection_digest",
  "entitlement_revision",
  "commercial_expires_at",
  "lease_epoch",
  "load_verified_local_workspace_binding",
  "new",
  "retryable_locked",
  "security_locked",
  "store_verified_local_workspace_binding",
  "trusted_time_floor",
  "with_trusted_time_floor",
  "workspace_id",
  "VerifiedLocalWorkspaceBindingParams",
];
const repositoryCoreRoot = resolve(import.meta.dirname, "../crates/secure-host-core");
const repositoryLocalStorageRoot = resolve(import.meta.dirname, "../crates/local-storage");
const expectedLocalStorageExportModules = [
  "active_workspace::business",
  "active_workspace::business",
  "portfolio_projection",
  "application_root",
  "backup",
  "backup",
  "desktop_business_runtime",
  "desktop_native_cloud",
  "desktop_sync_runtime",
];
const expectedLocalStoragePublicExports = [
  "AssetLibraryReadSnapshot",
  "AssetLibraryRow",
  "AssetLibraryWindow",
  "CloudflareDnsRecordWrite",
  "DesktopApplicationRoot",
  "DesktopApplicationRootError",
  "DesktopAssetLibraryReadRequest",
  "DesktopBackupError",
  "DesktopBackupExportStatus",
  "DesktopBackupRestoreStatus",
  "DesktopCheckpointExchange",
  "DesktopCloudflareActivationAdmission",
  "DesktopCloudflareCheckedObservation",
  "DesktopCloudflareConnectionRead",
  "DesktopCloudflareCustodyComparison",
  "DesktopCloudflareEnvelopeKind",
  "DesktopCloudflareKeychainPlan",
  "DesktopCloudflarePrewriteFailure",
  "DesktopCloudflareObservationRead",
  "DesktopCloudflareObservationReadRequest",
  "DesktopCloudflareObservationRecord",
  "DesktopCloudflareProjectionClaim",
  "DesktopCloudflareProjectionDisposition",
  "DesktopCloudflareProjectionWork",
  "DesktopCloudflareRecoveryHandle",
  "DesktopCloudflareRecoveryPlan",
  "DesktopCloudflareRecoveryScan",
  "DesktopCloudflareResolution",
  "DesktopConflict",
  "DesktopConflictCenterView",
  "DesktopConflictFreshness",
  "DesktopConflictResolutionReceipt",
  "DesktopConflictResolveRequest",
  "DesktopDomainAssetDeleteRequest",
  "DesktopDomainAssetEditRequest",
  "DesktopDomainAssetProviderBindingReceipt",
  "DesktopDomainAssetProviderBindingRequest",
  "DesktopDomainAssetWrite",
  "DesktopDomainDetailReadRequest",
  "DesktopHostAuthorizationStatus",
  "DesktopLocalBusinessState",
  "DesktopLocalBusinessStatus",
  "DesktopLocalHost",
  "DesktopLocalHostError",
  "DesktopVerifiedBackupArtifact",
  "DesktopNativeCloudAdmission",
  "DesktopSyncCheckpointDisposition",
  "DesktopSyncPullDisposition",
  "DesktopSyncPullExchange",
  "DesktopSyncPushClaim",
  "DesktopSyncPushDisposition",
  "DesktopSyncPushWork",
  "DesktopSyncSnapshotView",
  "DesktopSyncTransportState",
  "DomainAssetMutationReceipt",
  "DomainDetailAsset",
  "DomainDetailReadSnapshot",
  "Money",
  "PortfolioReadFreshness",
  "InspectingCloudflareProvision",
  "MarkedCloudflareProvision",
  "PreparedCloudflareObservation",
  "PreparedCloudflareProvision",
].sort();

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
  if (!sameArray(observedFiles, [...expectedSourceFiles].sort())) {
    errors.push(`secure-host-core source allowlist differs: ${observedFiles.join(", ")}`);
  }

  const libPath = resolve(sourceRoot, "lib.rs");
  if (pathState(libPath) !== "file") return errors;
  const libSource = readRegularFile(libPath, errors);
  if (libSource === null) return errors;
  const exportPattern = /^[\t ]*pub[\t ]+use[\t ]+(cloudflare_capture|cloudflare_keychain|cloudflare_provider|desktop_authorization_verifier|desktop_device_identity|desktop_oauth|local_workspace_binding)::[\t ]*(?:\{([\s\S]*?)\}|([A-Za-z_][A-Za-z0-9_]*))[\t ]*;/gmu;
  const exportMatches = [...libSource.matchAll(exportPattern)];
  const expectedExportModules = [
    "cloudflare_capture",
    "cloudflare_keychain",
    "cloudflare_provider",
    "desktop_authorization_verifier",
    "desktop_device_identity",
    "desktop_oauth",
    "local_workspace_binding",
  ];
  if (!sameArray(exportMatches.map((match) => match[1]), expectedExportModules)) {
    errors.push("secure-host-core direct capability export blocks are missing, reordered, or duplicated");
    return errors;
  }
  const exported = exportMatches
    .flatMap((match) => (match[2] ?? match[3]).split(","))
    .map((value) => value.trim())
    .filter(Boolean)
    .sort();
  const expectedPublicExports = [
    ...expectedCloudflareCaptureExports,
    ...expectedCloudflareKeychainExports,
    ...expectedCloudflareProviderExports,
    ...expectedDesktopAuthorizationExports,
    ...expectedDesktopDeviceIdentityExports,
    ...expectedDesktopOAuthExports,
    ...expectedLocalWorkspaceBindingExports,
  ].sort();
  if (!sameArray(exported, expectedPublicExports)) {
    errors.push(`secure-host-core public exports differ: ${exported.join(", ")}`);
  }
  const remainingSource = libSource.replace(exportPattern, "");
  if (/\bpub\s+(?:use|mod|struct|enum|trait|fn|type|const|static)\b/u.test(remainingSource)) {
    errors.push("secure-host-core exposes a public item outside the exact capability export blocks");
  }
  const exactPublicItemSurfaces = [
    [desktopAuthorizationSourceFile, expectedDesktopAuthorizationPublicItems, "desktop authorization"],
    [desktopOAuthSourceFile, expectedDesktopOAuthPublicItems, "desktop OAuth"],
    [desktopDeviceIdentitySourceFile, expectedDesktopDeviceIdentityPublicItems, "desktop device identity"],
    [localWorkspaceBindingSourceFile, expectedLocalWorkspaceBindingPublicItems, "local workspace binding"],
  ];
  for (const [path, expected, label] of exactPublicItemSurfaces) {
    const source = readRegularFile(resolve(sourceRoot, path), errors);
    if (source !== null) validateExactPublicItems(source, expected, label, errors);
  }
  return errors;
}

export function localStorageFinalSurfaceErrors({ storageRoot = repositoryLocalStorageRoot } = {}) {
  const errors = [];
  const libPath = resolve(storageRoot, "src/lib.rs");
  if (pathState(libPath) !== "file") {
    errors.push("local-storage public surface source must be a regular file");
    return errors;
  }
  const libSource = readRegularFile(libPath, errors, storageRoot);
  if (libSource === null) return errors;
  const bracedExportPattern = /^[\t ]*pub[\t ]+use[\t ]+([A-Za-z_][A-Za-z0-9_:]*)::[\t ]*\{([\s\S]*?)\};/gmu;
  const singleExportPattern = /^[\t ]*pub[\t ]+use[\t ]+([A-Za-z_][A-Za-z0-9_:]*)::([A-Za-z_][A-Za-z0-9_]*)[\t ]*;/gmu;
  const exportMatches = [
    ...[...libSource.matchAll(bracedExportPattern)].map((match) => ({
      index: match.index,
      module: match[1],
      exports: match[2].split(","),
    })),
    ...[...libSource.matchAll(singleExportPattern)].map((match) => ({
      index: match.index,
      module: match[1],
      exports: [match[2]],
    })),
  ].sort((left, right) => left.index - right.index);
  if (!sameArray(exportMatches.map(({ module }) => module), expectedLocalStorageExportModules)) {
    errors.push("local-storage direct public export blocks are missing, reordered, or duplicated");
    return errors;
  }
  const exported = exportMatches
    .flatMap(({ exports }) => exports)
    .map((value) => value.trim())
    .filter(Boolean)
    .sort();
  if (!sameArray(exported, expectedLocalStoragePublicExports)) {
    errors.push(`local-storage public exports differ: ${exported.join(", ")}`);
  }
  const remainingSource = libSource
    .replace(bracedExportPattern, "")
    .replace(singleExportPattern, "");
  if (/\bpub\s+(?:use|mod|struct|enum|trait|fn|type|const|static)\b/u.test(remainingSource)) {
    errors.push("local-storage exposes a public item outside the exact aggregate export blocks");
  }
  return errors;
}

function validateExactPublicItems(source, expected, label, errors) {
  const publicItems = [...source.matchAll(
    /\bpub(?:\s*\([^)]*\))?\s+(?:(?:const\s+)?fn|const|enum|mod|static|struct|trait|type|use)\s+([A-Za-z_][A-Za-z0-9_]*)/gu,
  )].map((match) => match[1]).sort();
  if (!sameArray(publicItems, [...expected].sort())) {
    errors.push(`${label} public items differ: ${publicItems.join(", ")}`);
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

function readRegularFile(path, errors, ownerRoot = repositoryCoreRoot) {
  try {
    return lstatSync(path).isFile() ? readFileSync(path, "utf8") : null;
  } catch (error) {
    errors.push(`surface source file is unreadable: ${relative(ownerRoot, path)}`);
    return null;
  }
}

function sameArray(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function writeFixture(root) {
  mkdirSync(join(root, "src"), { recursive: true });
  for (const path of expectedSourceFiles) {
    writeFileSync(
      join(root, "src", path),
      readFileSync(resolve(repositoryCoreRoot, "src", path), "utf8"),
    );
  }
}

function useFixture(t) {
  const root = mkdtempSync(join(tmpdir(), "gooddealer-secure-host-core-"));
  writeFixture(root);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function useLocalStorageFixture(t) {
  const root = mkdtempSync(join(tmpdir(), "gooddealer-local-storage-surface-"));
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(
    join(root, "src/lib.rs"),
    readFileSync(resolve(repositoryLocalStorageRoot, "src/lib.rs"), "utf8"),
  );
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test("the repository Core surface is the exact staged native capability allowlist", () => {
  assert.deepEqual(secureHostCoreFinalSurfaceErrors(), []);
  assert.deepEqual(localStorageFinalSurfaceErrors(), []);
});

test("accepts the exact staged native capability surface", (t) => {
  assert.deepEqual(secureHostCoreFinalSurfaceErrors({ coreRoot: useFixture(t) }), []);
  assert.deepEqual(localStorageFinalSurfaceErrors({ storageRoot: useLocalStorageFixture(t) }), []);
  const missingFileFixture = useFixture(t);
  rmSync(join(missingFileFixture, "src", "cloudflare_capture.rs"));
  assert.ok(secureHostCoreFinalSurfaceErrors({ coreRoot: missingFileFixture }).some(
    (error) => error.includes("allowlist"),
  ));
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

  const rawProviderExportFixture = useFixture(t);
  const rawProviderExportPath = join(rawProviderExportFixture, "src", "lib.rs");
  writeFileSync(
    rawProviderExportPath,
    readFileSync(rawProviderExportPath, "utf8").replace(
      "    CloudflareProviderZone, CloudflareProviderZoneStatus, CloudflareRecordType,\n};",
      "    CloudflareProviderZone, CloudflareProviderZoneStatus, CloudflareRecordType, CloudflareProviderTransport,\n};",
    ),
  );
  assert.ok(secureHostCoreFinalSurfaceErrors({ coreRoot: rawProviderExportFixture }).some(
    (error) => error.includes("public exports differ"),
  ));

  const missingStorageExportFixture = useLocalStorageFixture(t);
  const missingStorageExportPath = join(missingStorageExportFixture, "src/lib.rs");
  writeFileSync(
    missingStorageExportPath,
    readFileSync(missingStorageExportPath, "utf8").replace(
      "    DesktopCloudflareObservationRead, DesktopCloudflareObservationReadRequest,\n",
      "    DesktopCloudflareObservationReadRequest,\n",
    ),
  );
  assert.ok(localStorageFinalSurfaceErrors({ storageRoot: missingStorageExportFixture }).some(
    (error) => error.includes("public exports differ"),
  ));
});

test("rejects recreated database-key capability source or export", (t) => {
  const extraFileFixture = useFixture(t);
  writeFileSync(join(extraFileFixture, "src", "local_database_key.rs"), "// forbidden\n");
  assert.ok(secureHostCoreFinalSurfaceErrors({ coreRoot: extraFileFixture }).some(
    (error) => error.includes("allowlist"),
  ));

  const extraExportFixture = useFixture(t);
  writeFileSync(
    join(extraExportFixture, "src", "lib.rs"),
    "\npub use cloudflare_provider::LocalDatabaseKeyMaterial;\n",
    { flag: "a" },
  );
  assert.ok(secureHostCoreFinalSurfaceErrors({ coreRoot: extraExportFixture }).some(
    (error) => error.includes("outside")
      || error.includes("public exports differ")
      || error.includes("export blocks"),
  ));

  const rawStorageExportFixture = useLocalStorageFixture(t);
  const rawStorageExportPath = join(rawStorageExportFixture, "src/lib.rs");
  writeFileSync(
    rawStorageExportPath,
    `${readFileSync(rawStorageExportPath, "utf8")}\npub use active_workspace::business::BusinessDatabase;\n`,
  );
  assert.ok(localStorageFinalSurfaceErrors({ storageRoot: rawStorageExportFixture }).some(
    (error) => error.includes("export blocks"),
  ));

  const publicBackupModuleFixture = useLocalStorageFixture(t);
  const publicBackupModulePath = join(publicBackupModuleFixture, "src/lib.rs");
  writeFileSync(
    publicBackupModulePath,
    `${readFileSync(publicBackupModulePath, "utf8")}\npub mod public_backup_capability;\n`,
  );
  assert.ok(localStorageFinalSurfaceErrors({ storageRoot: publicBackupModuleFixture }).some(
    (error) => error.includes("outside"),
  ));
});
