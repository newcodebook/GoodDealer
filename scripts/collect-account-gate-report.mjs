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
  "apps/cloud/src/modules/identity/login-command.ts",
  "apps/cloud/src/modules/identity/password-hash-port.ts",
  "apps/cloud/src/modules/identity/session-families.ts",
  "apps/cloud/src/modules/licensing/index.ts",
  "apps/cloud/src/modules/devices/index.ts",
  "apps/cloud/src/modules/devices/bootstrap-fixture.ts",
  "apps/cloud/src/modules/devices/bootstrap-workflow.ts",
  "apps/cloud/src/modules/devices/drain-verification.ts",
  "apps/cloud/src/modules/devices/lease-lifecycle.ts",
  "apps/cloud/src/modules/devices/ports.ts",
  "apps/cloud/src/modules/devices/switch-workflow.ts",
  "apps/cloud/src/modules/workspace/tenant-scope.ts",
  "apps/cloud/src/modules/workspace/revisions/index.ts",
  "apps/cloud/src/modules/workspace/mutations/index.ts",
  "apps/cloud/src/modules/workspace/state/portfolio/index.ts",
  "apps/cloud/src/modules/workspace/read/index.ts",
  "apps/cloud/src/modules/workspace/cursors/index.ts",
  "apps/cloud/src/modules/workspace/checkpoints/index.ts",
  "apps/cloud/src/modules/execution-ledger/index.ts",
  "apps/cloud/src/modules/audit/index.ts",
  "packages/protocol/test/account-auth.test.ts",
  "packages/protocol/test/account-gate.test.ts",
  "packages/protocol/test/device-management.test.ts",
  "packages/protocol/test/bootstrap-steps.test.ts",
  "packages/protocol/test/workspace-sync.test.ts",
  "packages/client-core/test/runtime-mode.test.ts",
  "apps/cloud/test/identity-fixture.test.ts",
  "apps/cloud/test/password-hash-fallback.test.ts",
  "apps/cloud/test/session-families.test.ts",
  "apps/cloud/test/licensing-fixture.test.ts",
  "apps/cloud/test/devices-fixture.test.ts",
  "apps/cloud/test/bootstrap-fixture.test.ts",
  "apps/cloud/test/bootstrap-workflow.test.ts",
  "apps/cloud/test/drain-handoff.test.ts",
  "apps/cloud/test/drain-ledgers.test.ts",
  "apps/cloud/test/drain-transaction.test.ts",
  "apps/cloud/test/drain-verification.test.ts",
  "apps/cloud/test/lease-lifecycle.test.ts",
  "apps/cloud/test/switch-workflow.test.ts",
  "apps/cloud/test/workspace-mutation-ingest.test.ts",
  "apps/cloud/test/workspace-checkpoint-cursor.test.ts",
];

const identityPasswordPathInputs = [
  "apps/cloud/src/modules/identity/login-command.ts",
  "apps/cloud/src/modules/identity/password-hash-port.ts",
];

const authNegativeMatrixSpecifications = [
  {
    id: "current-jti-rotation-cas",
    category: "rotation",
    source: "apps/cloud/test/session-families.test.ts",
    testName: "lets exactly one prepared concurrent rotation win the current-JTI CAS",
    evidence: [
      { id: "rotation-advances", literal: 'status: "rotated", rotationGeneration: 1' },
      { id: "loser-conflicts", literal: 'status: "refresh_rotation_conflict"' },
      { id: "loser-does-not-register-jti", literal: 'credentialState("refresh-a2")).toBeNull()' },
      { id: "winner-remains-current", literal: 'currentRefreshJti("family-a")).toBe("refresh-a1")' },
    ],
  },
  {
    id: "retired-jti-reuse",
    category: "reuse",
    source: "apps/cloud/test/identity-fixture.test.ts",
    testName: "rotates by JTI, detects retired-JTI reuse, revokes only that family, and preserves the security epoch",
    evidence: [
      { id: "reuse-rejected", literal: '"REFRESH_REUSE_DETECTED"' },
      { id: "epoch-unchanged", literal: "readAccountSecurityEpoch()).toBe(epochBeforeReuse)" },
      { id: "other-family-remains-active", literal: "listSessions(other.sessionId!)" },
      { id: "revoked-family-cannot-refresh", literal: '"SESSION_REVOKED"' },
    ],
  },
  {
    id: "unknown-and-cross-family-jti",
    category: "reuse",
    source: "apps/cloud/test/identity-fixture.test.ts",
    testName: "fails closed for unknown and cross-family JTIs and unbound devices",
    evidence: [
      { id: "unknown-jti-presented", literal: 'presentedRefreshJti: "unknown-refresh-jti"' },
      { id: "cross-family-jti-presented", literal: "currentRefreshJti(service, other.sessionId!)" },
      { id: "both-fail-invalid-credentials", literal: '"INVALID_CREDENTIALS"', minimumOccurrences: 2 },
    ],
  },
  {
    id: "family-wide-jti-revocation-isolated",
    category: "family-revocation",
    source: "apps/cloud/test/session-families.test.ts",
    testName: "revokes every JTI in a family without touching another family",
    evidence: [
      { id: "family-revoked", literal: 'revokeFamily("family-a")).toBe(true)' },
      { id: "refresh-jti-revoked", literal: 'credentialState("refresh-a")).toBe("revoked")' },
      { id: "access-jti-revoked", literal: 'credentialState("access-a")).toBe("revoked")' },
      { id: "other-refresh-current", literal: 'credentialState("refresh-b")).toBe("current")' },
      { id: "other-access-current", literal: 'credentialState("access-b")).toBe("current")' },
    ],
  },
  {
    id: "global-jti-uniqueness-no-partial-write",
    category: "jti-uniqueness",
    source: "apps/cloud/test/session-families.test.ts",
    testName: "registers credential JTIs globally and aborts duplicate issuance without partial writes",
    evidence: [
      { id: "duplicate-jti-conflicts", literal: 'reason: "credential_jti_conflict"' },
      { id: "family-not-created", literal: 'hasFamily("family-b")).toBe(false)' },
      { id: "other-jti-not-written", literal: 'credentialState("refresh-b")).toBeNull()' },
    ],
  },
  {
    id: "stale-list-revision-and-missing-reauth",
    category: "reauth",
    source: "apps/cloud/test/identity-fixture.test.ts",
    testName: "rejects stale session-list CAS and requires reauth for all-other revocation",
    evidence: [
      { id: "stale-list-rejected", literal: '"LIST_REVISION_STALE"' },
      { id: "session-remains-active", literal: 'status: "active"' },
      { id: "missing-reauth-rejected", literal: '"REAUTHENTICATION_REQUIRED"' },
    ],
  },
  {
    id: "expired-and-epoch-stale-reauth",
    category: "reauth",
    source: "apps/cloud/test/identity-fixture.test.ts",
    testName: "expires reauth proofs and invalidates them when the account security epoch advances",
    evidence: [
      { id: "expired-proof-rejected", literal: '"REAUTH_PROOF_EXPIRED"', minimumOccurrences: 2 },
      { id: "epoch-stale-proof-rejected", literal: '"ACCOUNT_SECURITY_EPOCH_STALE"', minimumOccurrences: 2 },
    ],
  },
];

const rawPasswordSurfaceSpecifications = [
  {
    id: "dom-persistent-state",
    surface: "DOM persistent state",
    pattern: /\b(?:localStorage|sessionStorage|indexedDB|caches)\b|\bdocument\s*\.\s*cookie\b|\b(?:useState|useReducer|createContext)\s*\(/g,
  },
  {
    id: "ipc-history",
    surface: "IPC history or retry storage",
    pattern: /\b(?:invoke|emit|listen)\s*\(|@tauri-apps\/api|\b(?:ipcHistory|retryQueue|memoize)\b/g,
  },
  {
    id: "logs",
    surface: "logs and tracing",
    pattern: /\bconsole\s*\.|\b(?:logger|telemetry|tracer)\s*\.|\b(?:log|trace|debug|info|warn|error)\s*\(/g,
  },
  {
    id: "errors",
    surface: "error capture or reflection",
    pattern: /\bthrow\b|\bnew\s+Error\s*\(|\bJSON\s*\.\s*stringify\s*\(\s*(?:input|command|candidate|secret)\b|\b(?:message|detail|cause)\s*:\s*(?:input|command|candidate|secret)\b|\$\{\s*(?:input|command|candidate|secret)\b/g,
  },
  {
    id: "sqlite",
    surface: "SQLite or database persistence",
    pattern: /\b(?:sqlite|better-sqlite3|PrismaClient|drizzle)\b|\b(?:INSERT|UPDATE|UPSERT)\s+INTO\b/g,
  },
  {
    id: "temp-files",
    surface: "temporary files or clipboard",
    pattern: /\b(?:writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream|mkdtemp|tmpdir)\s*\(|\b(?:navigator\s*\.\s*clipboard|clipboard\s*\.)|\bfrom\s+["']node:fs["']/g,
  },
];

const deferredProbeAnchor = {
  criterionId: "crit_e26e01ef006a",
  decisionTraceId: "trace_2b4364324c868154",
  method: "GET",
  path: "/v1/account/session",
  readinessGate: "R1-R10",
  readinessCriteria: ["R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8", "R9", "R10"],
  gateDisposition: "cross_gate_future_work",
  state: "designed_gated_not_executed",
  criterionStatus: "skipped",
  probeVerdict: "not_executed",
  passClaimed: false,
};

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

export function workspaceSourceRequiresTenantScope(source) {
  const contextFreePortMethods = new Set(["digest", "now"]);
  const lines = source.split("\n");
  const containers = [];
  for (let index = 0; index < lines.length; index += 1) {
    const declaration = /^(\s*)export\s+(?:abstract\s+)?(?:class|interface)\b/.exec(lines[index]);
    if (declaration === null) continue;
    const indentation = declaration[1].length;
    const collected = [];
    let depth = 0;
    let opened = false;
    for (; index < lines.length; index += 1) {
      const line = lines[index];
      collected.push(line.slice(Math.min(indentation, line.length)));
      const delta = braceDelta(line);
      if (delta.open > 0) opened = true;
      depth += delta.open - delta.close;
      if (opened && depth === 0) break;
    }
    containers.push(collected.join("\n"));
  }
  return containers.every((container) => {
    const methods = [...container.matchAll(
      /^[ \t]{2}(?:async[ \t]+)?([A-Za-z][A-Za-z0-9]*)[ \t]*\([ \t\r\n]*([\s\S]*?)\)[ \t]*(?::[^;{\n]+)?[;{]/gm,
    )].filter(([, name]) => name !== "constructor" && !contextFreePortMethods.has(name));
    return methods.every(([, , parameters]) =>
      /^scope[ \t\r\n]*:[ \t\r\n]*WorkspaceTenantScope\b/.test(parameters)
    );
  });
}

function braceDelta(line) {
  const structural = line
    .replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g, "")
    .replace(/\/\/.*$/, "");
  return {
    open: (structural.match(/{/g) ?? []).length,
    close: (structural.match(/}/g) ?? []).length,
  };
}

export function sourceDeclaresRawCredentialField(source, path) {
  const declaresCloudCredential = /(?:\b(?:accessToken|apiKey|clientSecret|credentialRef|refreshToken)\b|["'](?:accessToken|apiKey|clientSecret|credentialRef|refreshToken)["'])\s*[?!]?\s*:/.test(
    source,
  );
  const declaresSharedPassword =
    path.startsWith("packages/protocol/") &&
    /(?:\bpassword\b|["']password["'])\s*[?!]?\s*:/.test(source);
  return declaresCloudCredential || declaresSharedPassword;
}

export function sourceIssuesActiveDeviceLease(source) {
  const constructsWithEnvelopeSchema =
    /\bactiveDeviceLeaseEnvelopeSchema\s*\.\s*parse\s*\(\s*{/.test(source);
  const declaresActiveLeaseType =
    /(?:\btyp\b|["']typ["'])\s*:\s*["']gd\.active-device-lease\.v1["']/.test(source);
  const declaresActiveLeaseAudience =
    /(?:\baud\b|["']aud["'])\s*:\s*["']gooddealer-desktop\/active-device-lease["']/.test(source);
  const declaresKeyId = /(?:\bkid\b|["']kid["'])\s*(?::|,|})/.test(source);
  const declaresSignature = /(?:\bsignature\b|["']signature["'])\s*(?::|,|})/.test(source);
  const signerStart = source.search(/\bsignActiveDeviceLease\s*\(/);
  const successfulSigner =
    signerStart >= 0 && /(?:\bissued\b|["']issued["'])\s*:\s*true\b/.test(source.slice(signerStart));

  return (
    constructsWithEnvelopeSchema ||
    successfulSigner ||
    (declaresActiveLeaseType && declaresActiveLeaseAudience && declaresKeyId && declaresSignature)
  );
}

export function sourceVerifiesSignature(source) {
  const importsNodeVerify =
    /\bimport\s*{[^}]*\b(?:createVerify|verify)\b[^}]*}\s*from\s*["'](?:node:)?crypto["']/.test(source);
  const requiresNodeVerify =
    /\b(?:createVerify|verify)\b\s*}\s*=\s*require\s*\(\s*["'](?:node:)?crypto["']\s*\)/.test(source);
  const invokesVerificationPrimitive =
    /\bcreateVerify\s*\(|\b(?:globalThis\s*\.\s*)?crypto\s*\.\s*subtle\s*\.\s*verify\s*\(|\bsubtle\s*\.\s*verify\s*\(|\bnacl\s*\.\s*sign\s*\.\s*detached\s*\.\s*verify\s*\(|\bcrypto_sign_verify_detached\s*\(|\.\s*verify\s*\(/.test(
      source,
    );
  return importsNodeVerify || requiresNodeVerify || invokesVerificationPrimitive;
}

const signatureVerificationBannedInputs = new Set([
  "apps/cloud/src/modules/devices/index.ts",
  "apps/cloud/src/modules/devices/ports.ts",
  "apps/cloud/src/modules/devices/drain-verification.ts",
  "apps/cloud/src/modules/workspace/mutations/index.ts",
  "apps/cloud/src/modules/execution-ledger/index.ts",
  "apps/cloud/src/modules/audit/index.ts",
]);

export function sourceVerifiesSignatureInScope(path, source) {
  return signatureVerificationBannedInputs.has(path) && sourceVerifiesSignature(source);
}

function drainSignatureWindows(source) {
  return [...source.matchAll(/\bcheckDrainProofSignature\b/g)].map(({ index = 0 }) =>
    source.slice(index, index + 600)
  );
}

export function sourceAcceptsDrainProof(source) {
  return drainSignatureWindows(source).some((window) =>
    /\b(?:accepted|verified)\b\s*(?:\?|readonly\s+)?\s*:\s*(?:boolean|true)\b/.test(window) ||
    /\breturn\s*{[^}]*\b(?:accepted|verified)\s*:\s*true\b/s.test(window)
  );
}

export function drainProofSignaturePortCannotSucceed(source) {
  const refusingReturn = /\binterface\s+DrainProofSignaturePort\b[\s\S]*?\bcheckDrainProofSignature\s*\([\s\S]*?\)\s*:\s*Promise\s*<\s*{\s*readonly\s+verified\s*:\s*false\s*;\s*readonly\s+reason\s*:\s*["']signature_verification_disabled["']\s*;?\s*}\s*>\s*;/.test(
    source,
  );
  return refusingReturn && !sourceAcceptsDrainProof(source);
}

export function drainProofSignatureCheckNamingCompliant(source) {
  const declaresCanonicalPortMethod = /\binterface\s+DrainProofSignaturePort\b[\s\S]*?\bcheckDrainProofSignature\s*\(/.test(
    source,
  );
  const usesForbiddenSignatureMethod = /\b(?:verifyDrainProofSignature|verifyDrainSignature|verifyHandoffSignature)\s*\(/.test(
    source,
  );
  return declaresCanonicalPortMethod && !usesForbiddenSignatureMethod;
}

function passwordHashWindows(source) {
  return [...source.matchAll(/\bcheckPasswordHash\b/g)].map(({ index = 0 }) => source.slice(index, index + 500));
}

export function passwordHashPortCannotSucceed(source) {
  const refusingReturn = /\binterface\s+PasswordHashPort\b[\s\S]*?\bcheckPasswordHash\s*\([\s\S]*?\)\s*:\s*Promise\s*<\s*{\s*readonly\s+verified\s*:\s*false\s*;\s*readonly\s+reason\s*:\s*["']password_verification_disabled["']\s*;?\s*}\s*>\s*;/.test(
    source,
  );
  const successConstructible = passwordHashWindows(source).some((window) =>
    /\bverified\b\s*(?:\?|readonly\s+)?\s*:\s*(?:boolean|true)\b/.test(window) ||
    /\breturn\s*{[^}]*\bverified\s*:\s*true\b/s.test(window)
  );
  return refusingReturn && !successConstructible;
}

export function passwordHashCheckNamingCompliant(source) {
  return (
    /\binterface\s+PasswordHashPort\b[\s\S]*?\bcheckPasswordHash\s*\(/.test(source) &&
    !/\b(?:verifyPassword|verifyPasswordHash)\s*\(/.test(source)
  );
}

function normalizedSource(source) {
  return source.replace(/\s+/g, " ").trim();
}

function namedTestSource(source, testName) {
  const marker = `it(${JSON.stringify(testName)},`;
  const start = source.indexOf(marker);
  if (start < 0) return null;
  const followingTest = source.slice(start + marker.length).search(/\n\s{2}it\s*\(/);
  const end = followingTest < 0 ? source.length : start + marker.length + followingTest;
  return source.slice(start, end);
}

function occurrences(source, literal) {
  let count = 0;
  let cursor = 0;
  while ((cursor = source.indexOf(literal, cursor)) >= 0) {
    count += 1;
    cursor += literal.length;
  }
  return count;
}

function collectAuthNegativeMatrix(sourcesByPath) {
  const assertions = authNegativeMatrixSpecifications.map((specification) => {
    const source = sourcesByPath.get(specification.source);
    const testSource = source === undefined ? null : namedTestSource(source, specification.testName);
    const normalizedTestSource = testSource === null ? "" : normalizedSource(testSource);
    const evidenceChecks = specification.evidence.map(({ id, literal, minimumOccurrences = 1 }) => ({
      id,
      present: occurrences(normalizedTestSource, normalizedSource(literal)) >= minimumOccurrences,
    }));
    const testPresent = testSource !== null;
    return {
      id: specification.id,
      category: specification.category,
      source: specification.source,
      testName: specification.testName,
      testPresent,
      evidenceChecks,
      present: testPresent && evidenceChecks.every(({ present }) => present),
    };
  });
  return {
    present: assertions.every(({ present }) => present),
    assertions,
  };
}

function authNegativeMatrixPassesPolicy(matrix) {
  if (matrix?.present !== true || !Array.isArray(matrix.assertions)) return false;
  return authNegativeMatrixSpecifications.every((specification, index) => {
    const assertion = matrix.assertions[index];
    return (
      assertion?.id === specification.id &&
      assertion.category === specification.category &&
      assertion.source === specification.source &&
      assertion.testName === specification.testName &&
      assertion.testPresent === true &&
      assertion.present === true &&
      Array.isArray(assertion.evidenceChecks) &&
      assertion.evidenceChecks.length === specification.evidence.length &&
      specification.evidence.every(
        ({ id }, evidenceIndex) =>
          assertion.evidenceChecks[evidenceIndex]?.id === id &&
          assertion.evidenceChecks[evidenceIndex]?.present === true,
      )
    );
  }) && matrix.assertions.length === authNegativeMatrixSpecifications.length;
}

export function rawPasswordForbiddenSurfaceProof(sources) {
  const combinedSource = sources.map(({ source }) => source).join("\n");
  const surfaces = rawPasswordSurfaceSpecifications.map(({ id, surface, pattern }) => {
    pattern.lastIndex = 0;
    const matchCount = [...combinedSource.matchAll(pattern)].length;
    return { id, surface, matchCount, absent: matchCount === 0 };
  });
  return {
    scope: "identity-real-password-path",
    scannedSources: sources.map(({ path }) => path),
    surfaces,
  };
}

function rawPasswordForbiddenSurfaceProofPassesPolicy(proof) {
  if (
    proof?.scope !== "identity-real-password-path" ||
    !Array.isArray(proof.scannedSources) ||
    proof.scannedSources.length !== identityPasswordPathInputs.length ||
    !identityPasswordPathInputs.every((path, index) => proof.scannedSources[index] === path) ||
    !Array.isArray(proof.surfaces) ||
    proof.surfaces.length !== rawPasswordSurfaceSpecifications.length
  ) {
    return false;
  }
  return rawPasswordSurfaceSpecifications.every(
    ({ id, surface }, index) =>
      proof.surfaces[index]?.id === id &&
      proof.surfaces[index]?.surface === surface &&
      proof.surfaces[index]?.matchCount === 0 &&
      proof.surfaces[index]?.absent === true,
  );
}

function denyingPasswordHashPortStructuralAssertion(portSource, loginCommandSource, fallbackTestSource) {
  const denyingClassStart = portSource.search(/\bclass\s+DenyingPasswordHashPort\b/);
  const denyingClassSource = denyingClassStart < 0 ? "" : portSource.slice(denyingClassStart);
  const checks = {
    interfaceReturnTypeCannotExpressSuccess: passwordHashPortCannotSucceed(portSource),
    denyingImplementationPresent:
      /\bclass\s+DenyingPasswordHashPort\s+implements\s+PasswordHashPort\b/.test(portSource),
    denyingImplementationReturnsDisabled:
      /\breadonly\s+verified\s*:\s*false\b/.test(denyingClassSource) &&
      /\breturn\s*{\s*verified\s*:\s*false\s*,\s*reason\s*:\s*["']password_verification_disabled["']\s*}\s*;/.test(
        denyingClassSource,
      ),
    defaultCompositionUsesDenyingPort:
      /passwordHash\s*:\s*PasswordHashPort\s*=\s*new\s+DenyingPasswordHashPort\s*\(\s*\)/.test(
        loginCommandSource,
      ),
    typeLevelNegativeAssertionPresent:
      /Extract\s*<\s*PasswordHashResult\s*,\s*{\s*readonly\s+verified\s*:\s*true\s*}\s*>\s+extends\s+never/.test(
        fallbackTestSource,
      ) &&
      /passwordSuccessIsUnrepresentable\s*:\s*PasswordSuccessIsUnrepresentable\s*=\s*true/.test(
        fallbackTestSource,
      ),
  };
  return {
    source: "apps/cloud/src/modules/identity/password-hash-port.ts",
    checks,
    present: Object.values(checks).every(Boolean),
  };
}

function denyingPasswordHashPortStructuralAssertionPassesPolicy(assertion) {
  const expectedChecks = [
    "interfaceReturnTypeCannotExpressSuccess",
    "denyingImplementationPresent",
    "denyingImplementationReturnsDisabled",
    "defaultCompositionUsesDenyingPort",
    "typeLevelNegativeAssertionPresent",
  ];
  return (
    assertion?.source === "apps/cloud/src/modules/identity/password-hash-port.ts" &&
    assertion.present === true &&
    assertion.checks !== null &&
    typeof assertion.checks === "object" &&
    Object.keys(assertion.checks).length === expectedChecks.length &&
    expectedChecks.every((field) => assertion.checks[field] === true)
  );
}

function deferredProbeAnchorPassesPolicy(report) {
  const anchor = report.probeAnchor;
  return (
    report.probeExecuted === false &&
    anchor?.criterionId === deferredProbeAnchor.criterionId &&
    anchor.decisionTraceId === deferredProbeAnchor.decisionTraceId &&
    anchor.method === deferredProbeAnchor.method &&
    anchor.path === deferredProbeAnchor.path &&
    anchor.readinessGate === deferredProbeAnchor.readinessGate &&
    Array.isArray(anchor.readinessCriteria) &&
    anchor.readinessCriteria.length === deferredProbeAnchor.readinessCriteria.length &&
    deferredProbeAnchor.readinessCriteria.every(
      (criterion, index) => anchor.readinessCriteria[index] === criterion,
    ) &&
    anchor.gateDisposition === deferredProbeAnchor.gateDisposition &&
    anchor.state === deferredProbeAnchor.state &&
    anchor.criterionStatus === deferredProbeAnchor.criterionStatus &&
    anchor.probeVerdict === deferredProbeAnchor.probeVerdict &&
    anchor.passClaimed === false
  );
}

export function sourceAcceptDrainReleasesLease(source) {
  const acceptDrainStart = source.search(/\basync\s+acceptDrain\s*\(/);
  if (acceptDrainStart < 0) return true;
  const remainder = source.slice(acceptDrainStart);
  const nextMethod = remainder.search(/\n\s{2}(?:async\s+)?claimTakeover\s*\(/);
  if (nextMethod < 0) return true;
  const acceptDrainSource = remainder.slice(0, nextMethod);
  const mutatesLeaseLifecycle = /\b(?:this\s*\.\s*)?#?leaseLifecycle\s*\.\s*(?!readHeldLease\b)\w+\s*\(/.test(
    acceptDrainSource,
  );
  const mutatesLeaseState = /\b(?:beginBootstrap|releaseActiveDeviceLease|releaseHeldLease|releaseLease)\s*\(|\breleasedAt\s*(?::|=)|#activeLease\s*=\s*null\b/.test(
    acceptDrainSource,
  );
  return mutatesLeaseLifecycle || mutatesLeaseState;
}

export function identityFixtureIsNonSellable(source) {
  return /\breadonly\s+sellable\s*=\s*false(?:\s+as\s+const)?\s*;/.test(source);
}

export function collectAccountGateReport() {
  const inputs = requiredInputs.filter((path) => existsSync(resolve(root, path))).map((path) => {
    const content = readFileSync(resolve(root, path));
    return { path, bytes: content.length, sha256: sha256(content) };
  });
  const runtimeSources = requiredInputs
    .filter((path) => path.includes("/src/"))
    .map((path) => ({ path, source: readFileSync(resolve(root, path), "utf8") }));
  const runtimeSource = runtimeSources.map(({ source }) => source).join("\n");
  const cloudRuntimeSources = runtimeSources.filter(({ path }) => path.startsWith("apps/cloud/src/"));
  const workspaceRuntimeSources = cloudRuntimeSources.filter(({ path }) =>
    path.startsWith("apps/cloud/src/modules/workspace/")
  );
  const drainRuntimeSources = cloudRuntimeSources.filter(({ path }) => signatureVerificationBannedInputs.has(path));
  const identitySource = readFileSync(resolve(root, "apps/cloud/src/modules/identity/index.ts"), "utf8");
  const devicesSource = readFileSync(resolve(root, "apps/cloud/src/modules/devices/index.ts"), "utf8");
  const drainPortSource = readFileSync(resolve(root, "apps/cloud/src/modules/devices/ports.ts"), "utf8");
  const passwordHashPortSource = readFileSync(
    resolve(root, "apps/cloud/src/modules/identity/password-hash-port.ts"),
    "utf8",
  );
  const loginCommandSource = readFileSync(
    resolve(root, "apps/cloud/src/modules/identity/login-command.ts"),
    "utf8",
  );
  const passwordHashFallbackTestSource = readFileSync(
    resolve(root, "apps/cloud/test/password-hash-fallback.test.ts"),
    "utf8",
  );
  const authNegativeMatrixSources = new Map([
    "apps/cloud/test/identity-fixture.test.ts",
    "apps/cloud/test/session-families.test.ts",
  ].map((path) => [path, readFileSync(resolve(root, path), "utf8")]));
  const authNegativeMatrix = collectAuthNegativeMatrix(authNegativeMatrixSources);
  const rawPasswordForbiddenSurfaceProofReport = rawPasswordForbiddenSurfaceProof(
    identityPasswordPathInputs.map((path) => ({
      path,
      source: readFileSync(resolve(root, path), "utf8"),
    })),
  );
  const denyingPasswordHashPortAssertion = denyingPasswordHashPortStructuralAssertion(
    passwordHashPortSource,
    loginCommandSource,
    passwordHashFallbackTestSource,
  );
  const drainRuntimeSource = drainRuntimeSources.map(({ source }) => source).join("\n");

  return {
    schemaVersion: 1,
    scope:
      "Internal non-sellable Cloud fixtures with a structurally denying password path; no production route, lease signing, shared-protocol password field, token-bearing Cloud field, native keychain, external network, or user data.",
    fixtureOnly: true,
    productionRoutesRegistered: sourceRegistersProductionRoute(runtimeSource),
    rawCredentialFieldsAbsent: runtimeSources.every(
      ({ path, source }) => !sourceDeclaresRawCredentialField(source, path),
    ),
    activeDeviceLeaseIssuanceAbsent: cloudRuntimeSources.every(
      ({ source }) => !sourceIssuesActiveDeviceLease(source),
    ),
    signatureVerificationAbsent: runtimeSources.every(
      ({ path, source }) => !sourceVerifiesSignatureInScope(path, source),
    ),
    drainProofAcceptanceAbsent: cloudRuntimeSources.every(
      ({ source }) => !sourceAcceptsDrainProof(source),
    ),
    drainProofSignatureSuccessUnrepresentable: drainProofSignaturePortCannotSucceed(drainPortSource),
    passwordVerificationSuccessUnrepresentable: denyingPasswordHashPortAssertion.present,
    denyingPasswordHashPortStructuralAssertion: denyingPasswordHashPortAssertion,
    passwordHashCheckNamingCompliant: passwordHashCheckNamingCompliant(passwordHashPortSource),
    authNegativeMatrix,
    rotationFamilyNegativeMatrixPresent: authNegativeMatrix.present,
    rawPasswordForbiddenSurfaceProof: rawPasswordForbiddenSurfaceProofReport,
    rawPasswordSurfacesAbsent: rawPasswordForbiddenSurfaceProofReport.surfaces.every(
      ({ absent }) => absent,
    ),
    probeExecuted: false,
    probeAnchor: deferredProbeAnchor,
    acceptDrainLeaseReleaseAbsent: !sourceAcceptDrainReleasesLease(devicesSource),
    drainProductionRoutesAbsent: drainRuntimeSources.every(
      ({ source }) => !sourceRegistersProductionRoute(source),
    ),
    drainProofSignatureCheckNamingCompliant: drainProofSignatureCheckNamingCompliant(drainRuntimeSource),
    workspaceIngestProductionRoutesAbsent: workspaceRuntimeSources.every(
      ({ source }) => !sourceRegistersProductionRoute(source),
    ),
    workspaceTenantScopeRequired: workspaceRuntimeSources.every(
      ({ source }) => workspaceSourceRequiresTenantScope(source),
    ),
    internalAccountSellable: !identityFixtureIsNonSellable(identitySource),
    requiredInputsPresent: inputs.length === requiredInputs.length,
    accountVectors: vectorCounts("packages/protocol/test-vectors/account"),
    deviceVectors: vectorCounts("packages/protocol/test-vectors/device-management"),
    bootstrapVectors: vectorCounts("packages/protocol/test-vectors/bootstrap-steps"),
    workspaceVectors: vectorCounts("packages/protocol/test-vectors/workspace-sync"),
    inputs,
  };
}

export function accountGateReportPassesPolicy(report) {
  return (
    report.productionRoutesRegistered === false &&
    report.rawCredentialFieldsAbsent &&
    report.activeDeviceLeaseIssuanceAbsent &&
    report.signatureVerificationAbsent &&
    report.drainProofAcceptanceAbsent &&
    report.drainProofSignatureSuccessUnrepresentable &&
    report.passwordVerificationSuccessUnrepresentable &&
    denyingPasswordHashPortStructuralAssertionPassesPolicy(
      report.denyingPasswordHashPortStructuralAssertion,
    ) &&
    report.passwordHashCheckNamingCompliant &&
    report.rotationFamilyNegativeMatrixPresent &&
    authNegativeMatrixPassesPolicy(report.authNegativeMatrix) &&
    report.rawPasswordSurfacesAbsent &&
    rawPasswordForbiddenSurfaceProofPassesPolicy(report.rawPasswordForbiddenSurfaceProof) &&
    deferredProbeAnchorPassesPolicy(report) &&
    report.acceptDrainLeaseReleaseAbsent &&
    report.drainProductionRoutesAbsent &&
    report.drainProofSignatureCheckNamingCompliant &&
    report.workspaceIngestProductionRoutesAbsent &&
    report.workspaceTenantScopeRequired &&
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
    report.inputs.every((input) => statSync(resolve(root, input.path)).isFile())
  );
}

function main() {
  const report = collectAccountGateReport();
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);

  console.log(JSON.stringify(report, null, 2));
  process.exitCode = accountGateReportPassesPolicy(report) ? 0 : 1;
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) main();
