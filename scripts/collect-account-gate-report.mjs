import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(import.meta.dirname, "..");
const outputPath = resolve(root, process.argv[2] ?? ".artifacts/wp2/account-gate/account-gate-report.json");
export const portfolioQuerySourceInputs = [
  "packages/client-core/src/portfolio/index.ts",
  "packages/client-core/src/portfolio/data-freshness.ts",
];

function vectorPaths(basePath, valid, invalid) {
  return [
    ...valid.map((path) => `${basePath}/valid/${path}`),
    ...invalid.map((path) => `${basePath}/invalid/${path}`),
  ];
}

export const ACCOUNT_GATE_VECTOR_INPUTS = Object.freeze([
  ...vectorPaths(
    "packages/protocol/test-vectors/account",
    [
      "auth-access-envelope.json",
      "auth-refresh-envelope.json",
      "auth-session-authenticated.json",
      "auth-session-refresh-required.json",
      "auth-session-revoked.json",
      "auth-session-signed-out.json",
      "entitlement-projection-lifetime.json",
      "entitlement-projection-subscription-active.json",
      "entitlement-projection-subscription-grace.json",
      "gate-active-eligible.json",
      "gate-locked.json",
      "gate-standby-eligible.json",
      "login-request.json",
      "reauth-proof-ref.json",
      "refresh-request.json",
      "rejection-device-removed.json",
      "rejection-rate-limited.json",
      "session-list.json",
      "session-revoke-all-other.json",
      "session-revoke-single.json",
      "sign-out-all-devices.json",
      "sign-out-this-device.json",
    ],
    [
      "auth-access-cross-typ-as-refresh.json",
      "auth-access-with-mutate-scope.json",
      "auth-access-with-platform-scope.json",
      "auth-access-wrong-key-purpose.json",
      "auth-refresh-cross-typ-as-access.json",
      "auth-refresh-snake-case-wire.json",
      "auth-refresh-unsafe-generation.json",
      "auth-refresh-wrong-audience.json",
      "auth-session-authenticated-missing-epoch.json",
      "auth-session-authenticated-without-expiry.json",
      "auth-session-revocation-reason-without-revoked.json",
      "auth-session-signed-out-with-account.json",
      "auth-session-snake-case-wire.json",
      "auth-session-unknown-field.json",
      "auth-session-unknown-version.json",
      "auth-session-unsafe-epoch.json",
      "entitlement-projection-expiry-after-grace.json",
      "entitlement-projection-lifetime-with-expiry.json",
      "entitlement-projection-refresh-after-grace.json",
      "entitlement-projection-subscription-all-major-versions.json",
      "entitlement-projection-unsorted-features.json",
      "entitlement-projection-with-payment-watermark.json",
      "gate-active-with-failed-check.json",
      "gate-locked-all-checks-pass.json",
      "gate-locked-without-reason.json",
      "gate-reason-without-locked.json",
      "gate-standby-with-active-lease-pass.json",
      "reauth-proof-inverted-window.json",
      "rejection-non-retryable-marked-retryable.json",
      "rejection-retry-after-on-non-rate-limited.json",
      "rejection-with-message-field.json",
      "session-display-name-control-character.json",
      "session-list-duplicate-session-id.json",
      "session-list-two-current.json",
      "session-summary-desktop-without-device-id.json",
      "session-summary-revoked-current.json",
      "session-summary-revoked-without-timestamp.json",
      "session-summary-web-with-device-id.json",
      "sign-out-all-devices-missing-reauth-proof.json",
      "sign-out-this-device-with-reauth-proof.json",
    ],
  ),
  ...vectorPaths(
    "packages/protocol/test-vectors/device-management",
    [
      "authority-active.json",
      "authority-none.json",
      "authority-standby-with-ingest.json",
      "authority-standby.json",
      "binding-active.json",
      "binding-list-two-bound.json",
      "binding-removed.json",
      "binding-standby.json",
      "lease-status-held-fresh.json",
      "lease-status-held-offline-grace.json",
      "lease-status-held-renewal-window.json",
      "lease-status-not-held.json",
      "removal-request.json",
      "switch-request-forced.json",
      "switch-request-normal.json",
      "switch-view-bootstrapping.json",
      "switch-view-completed.json",
      "switch-view-waiting-expiry.json",
    ],
    [
      "authority-duplicate-scopes.json",
      "authority-none-with-scopes.json",
      "authority-standby-with-mutate.json",
      "authority-standby-with-platform-write.json",
      "authority-unsorted-scopes.json",
      "binding-last-seen-before-bound.json",
      "binding-list-duplicate-device-id.json",
      "binding-list-three-bound.json",
      "binding-list-two-active.json",
      "binding-list-two-current-device.json",
      "binding-public-key-field.json",
      "binding-removed-current-device.json",
      "binding-removed-with-role.json",
      "binding-removed-without-timestamp.json",
      "binding-revoked-key-with-role.json",
      "binding-role-on-removed-status.json",
      "binding-snake-case-wire.json",
      "binding-unknown-field.json",
      "binding-unknown-version.json",
      "binding-unsafe-credential-epoch.json",
      "lease-status-held-missing-epoch.json",
      "lease-status-inverted-window.json",
      "lease-status-not-held-with-epoch.json",
      "lease-status-not-held-wrong-renewal-state.json",
      "lease-status-offline-window-too-long.json",
      "lease-status-renewal-state-mismatch.json",
      "lease-status-window-inverted-only.json",
      "lease-status-with-signature.json",
      "switch-bootstrapping-without-expiry.json",
      "switch-completed-with-bootstrap-expiry.json",
      "switch-earliest-takeover-before-request.json",
      "switch-forced-without-earliest-takeover.json",
      "switch-forced-without-reauth-proof.json",
      "switch-normal-with-reauth-proof.json",
    ],
  ),
  ...vectorPaths(
    "packages/protocol/test-vectors/bootstrap-steps",
    [
      "request-fetch-mutations.json",
      "request-pin-checkpoint.json",
      "request-submit-rebuild-digest.json",
      "result-fetch-mutations.json",
      "result-pin-checkpoint.json",
      "result-submit-rebuild-digest.json",
    ],
    [
      "request-fetch-before-checkpoint.json",
      "request-fetch-inverted-range.json",
      "request-page-limit-too-large.json",
      "request-payload-kind-mismatch.json",
      "request-snake-case.json",
      "request-unknown-field.json",
      "request-unsafe-workflow-revision.json",
      "request-unsorted-entity-digests.json",
      "result-invalid-next-step-nonce-encoding.json",
      "result-missing-next-step-nonce.json",
      "result-mutation-page-gap.json",
      "result-nonterminal-null-next-step-nonce.json",
      "result-payload-kind-mismatch.json",
      "result-terminal-nonnull-next-step-nonce.json",
      "result-unknown-field.json",
    ],
  ),
  ...vectorPaths(
    "packages/protocol/test-vectors/workspace-sync",
    ["checkpoint.json", "mutation-page.json", "mutation.json"],
    [
      "mutation-base-not-before-server.json",
      "mutation-device-secret.json",
      "mutation-duplicate-field.json",
      "mutation-noncanonical-money.json",
      "mutation-note-control-character.json",
      "mutation-unknown-field.json",
      "mutation-unsafe-revision.json",
      "mutation-unsorted-fields.json",
      "mutation-unsorted-tags.json",
      "page-cross-workspace.json",
      "page-cursor-at-target.json",
      "page-returned-revision-mismatch.json",
      "page-revision-gap.json",
      "page-terminal-before-target.json",
    ],
  ),
  ...vectorPaths(
    "packages/protocol/test-vectors/domain-asset-projection",
    ["utf8-order.json"],
    ["locale-order.json", "revision-metadata.json", "secret-field.json"],
  ),
]);

export const ACCOUNT_GATE_REQUIRED_INPUTS = Object.freeze([
  "packages/protocol/src/account/account-gate.ts",
  "packages/protocol/src/account/auth-session.ts",
  "packages/protocol/src/account/entitlement-projection.ts",
  "packages/protocol/src/devices/device-management.ts",
  "packages/protocol/src/devices/bootstrap-steps.ts",
  "packages/protocol/src/wire/canonical-codec.ts",
  "packages/protocol/src/workspace/sync-mutation.ts",
  "packages/protocol/src/workspace/domain-asset-fields.ts",
  "packages/protocol/src/workspace/domain-asset-projection.ts",
  "packages/client-core/src/runtime-mode/index.ts",
  ...portfolioQuerySourceInputs,
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
  "packages/client-core/test/portfolio-query.test.ts",
  "packages/protocol/test-vectors/domain-asset-projection/valid/utf8-order.json",
  "packages/protocol/test-vectors/domain-asset-projection/invalid/locale-order.json",
  "packages/protocol/test-vectors/domain-asset-projection/invalid/revision-metadata.json",
  "packages/protocol/test-vectors/domain-asset-projection/invalid/secret-field.json",
  "apps/cloud/test/identity-fixture.test.ts",
  "apps/cloud/test/support/identity-fixture.ts",
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
]);
const requiredInputs = ACCOUNT_GATE_REQUIRED_INPUTS;
const admittedInputPaths = Object.freeze([
  ...requiredInputs,
  ...ACCOUNT_GATE_VECTOR_INPUTS.filter((path) => !requiredInputs.includes(path)),
]);

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

function normalizedRepositoryPath(path) {
  if (typeof path !== "string" || path.length === 0 || isAbsolute(path) || /^[A-Za-z]:[\\/]/u.test(path)) {
    return null;
  }
  const normalized = path.replaceAll("\\", "/");
  if (normalized !== path || normalized.split("/").some((part) => part === "" || part === "." || part === "..")) {
    return null;
  }
  return normalized;
}

function admittedRepositoryRoot(repositoryRoot) {
  const resolvedRoot = resolve(repositoryRoot);
  const lexicalComponents = [];
  for (let current = resolvedRoot; ; current = dirname(current)) {
    lexicalComponents.unshift(current);
    if (dirname(current) === current) break;
  }
  for (const current of lexicalComponents) {
    const stat = lstatSync(current);
    const terminalComponent = current === resolvedRoot;
    if (stat.isSymbolicLink()) {
      if (terminalComponent) throw new Error("account gate repository root may not be a symbolic link");
      throw new Error(`account gate repository root may not traverse a symbolic link: ${current}`);
    }
    if (!stat.isDirectory()) {
      if (terminalComponent) throw new Error("account gate repository root must be a directory");
      throw new Error(`account gate repository root has a non-directory ancestor: ${current}`);
    }
  }
  return resolvedRoot;
}

function regularRequiredInputPath(repositoryRoot, path) {
  const normalized = normalizedRepositoryPath(path);
  if (normalized === null) throw new Error(`account gate input is not normalized: ${String(path)}`);

  const resolvedRoot = admittedRepositoryRoot(repositoryRoot);
  const parts = normalized.split("/");
  const terminalPath = resolve(resolvedRoot, ...parts);
  const rootRelativePath = relative(resolvedRoot, terminalPath);
  if (rootRelativePath === "" || /^\.\.(?:[\\/]|$)/u.test(rootRelativePath) || isAbsolute(rootRelativePath)) {
    throw new Error(`account gate input is outside the repository root: ${normalized}`);
  }

  let current = resolvedRoot;
  for (const [index, part] of parts.entries()) {
    current = resolve(current, part);
    const stat = lstatSync(current);
    if (stat.isSymbolicLink()) {
      throw new Error(`account gate input may not traverse a symbolic link: ${normalized}`);
    }
    const finalPart = index === parts.length - 1;
    if (finalPart && !stat.isFile()) {
      throw new Error(`account gate input must be a regular file: ${normalized}`);
    }
    if (!finalPart && !stat.isDirectory()) {
      throw new Error(`account gate input has a non-directory parent: ${normalized}`);
    }
  }
  return terminalPath;
}

export function accountGateInputAdmissionErrors({ repositoryRoot = root } = {}) {
  const errors = [];
  for (const path of admittedInputPaths) {
    try {
      regularRequiredInputPath(repositoryRoot, path);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : `account gate input is unreadable: ${path}`);
    }
  }
  return errors;
}

function readAdmittedInput(path) {
  if (!admittedInputPaths.includes(path)) throw new Error(`account gate input is not admitted: ${path}`);
  return readFileSync(regularRequiredInputPath(root, path));
}

function admittedRequiredInputSources() {
  const errors = accountGateInputAdmissionErrors();
  if (errors.length > 0) throw new Error(errors.join("\n"));
  return new Map(admittedInputPaths.map((path) => [path, readAdmittedInput(path)]));
}

function vectorCounts(basePath, inputSources) {
  const count = (kind) => {
    const prefix = `${basePath}/${kind}/`;
    const files = ACCOUNT_GATE_VECTOR_INPUTS.filter((path) => path.startsWith(prefix));
    for (const path of files) {
      const content = inputSources.get(path);
      if (content === undefined) throw new Error(`account gate vector is not admitted: ${path}`);
      JSON.parse(content.toString("utf8"));
    }
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

export function denyingPasswordHashPortCannotSucceed(source) {
  const start = source.search(/\bclass\s+DenyingPasswordHashPort\b/);
  if (start < 0) return false;
  const window = source.slice(start, start + 900);
  return (
    /\bimplements\s+PasswordHashPort\b/.test(window) &&
    /\breturn\s*{\s*verified\s*:\s*false\s*,\s*reason\s*:\s*["']password_verification_disabled["']\s*}/.test(window) &&
    !/\breturn\s*{[^}]*\bverified\s*:\s*true\b/s.test(window)
  );
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
    interfaceSupportsClosedVerdict:
      /\btype\s+PasswordHashResult\b[\s\S]*?verified:\s*true[\s\S]*?verified:\s*false/.test(portSource),
    explicitVerifierOptInPresent:
      /\bclass\s+Argon2idPasswordHashVerifier\s+implements\s+PasswordHashPort\b/.test(portSource),
    denyingImplementationPresent:
      /\bclass\s+DenyingPasswordHashPort\s+implements\s+PasswordHashPort\b/.test(portSource),
    denyingImplementationReturnsDisabled:
      /\breturn\s*{\s*verified\s*:\s*false\s*,\s*reason\s*:\s*["']password_verification_disabled["']\s*}\s*;/.test(
        denyingClassSource,
      ),
    defaultCompositionUsesDenyingPort:
      /passwordHash\s*:\s*PasswordHashPort\s*=\s*new\s+DenyingPasswordHashPort\s*\(\s*\)/.test(
        loginCommandSource,
      ),
    denyingCandidateZeroingTestPresent:
      /keeps the Denying implementation as the default/.test(fallbackTestSource) &&
      /candidate\.consumedBytesAreZeroed\(\)\)\.toBe\(true\)/.test(fallbackTestSource),
  };
  return {
    source: "apps/cloud/src/modules/identity/password-hash-port.ts",
    checks,
    present: Object.values(checks).every(Boolean),
  };
}

function denyingPasswordHashPortStructuralAssertionPassesPolicy(assertion) {
  const expectedChecks = [
    "interfaceSupportsClosedVerdict",
    "explicitVerifierOptInPresent",
    "denyingImplementationPresent",
    "denyingImplementationReturnsDisabled",
    "defaultCompositionUsesDenyingPort",
    "denyingCandidateZeroingTestPresent",
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

export function portfolioQueryContractIsPortable(source, testSource) {
  const readOnlyPort = /interface\s+PortfolioQueryPort\s*{\s*listDomains\(\):\s*Promise<PortfolioQueryResult>;\s*}/s.test(source);
  const bothAdapters = /class\s+ActiveLocalPortfolioAdapter\b/.test(source) &&
    /class\s+StandbyCloudPortfolioAdapter\b/.test(source);
  const provenanceInvariant = /active_local/.test(source) && /standby_cloud/.test(source) &&
    /freshness\.canEdit\s*!==\s*expectedCanEdit/.test(source);
  const productionWiringAbsent = !/\bfrom\s+["'](?:@tauri-apps|@gooddealer\/cloud-client|gooddealer-local-storage|apps\/cloud)/.test(source);
  const contractEvidence = testSource.includes("exposes one read-only port shape") &&
    testSource.includes("produces byte-identical business digests through Active and Standby") &&
    testSource.includes("rejects unknown fields, unsafe revisions, and non-canonical entity order");
  return readOnlyPort && bothAdapters && provenanceInvariant && productionWiringAbsent && contractEvidence;
}

export function collectAccountGateReport() {
  const inputSources = admittedRequiredInputSources();
  const sourceFor = (path) => {
    const content = inputSources.get(path);
    if (content === undefined) throw new Error(`account gate input is not admitted: ${path}`);
    return content.toString("utf8");
  };
  const inputs = requiredInputs.map((path) => {
    const content = inputSources.get(path);
    if (content === undefined) throw new Error(`account gate input is not admitted: ${path}`);
    return { path, bytes: content.length, sha256: sha256(content) };
  });
  const runtimeSources = requiredInputs
    .filter((path) => path.includes("/src/"))
    .map((path) => ({ path, source: sourceFor(path) }));
  const runtimeSource = runtimeSources.map(({ source }) => source).join("\n");
  const cloudRuntimeSources = runtimeSources.filter(({ path }) => path.startsWith("apps/cloud/src/"));
  const workspaceRuntimeSources = cloudRuntimeSources.filter(({ path }) =>
    path.startsWith("apps/cloud/src/modules/workspace/")
  );
  const drainRuntimeSources = cloudRuntimeSources.filter(({ path }) => signatureVerificationBannedInputs.has(path));
  const identityFixtureSource = sourceFor("apps/cloud/test/support/identity-fixture.ts");
  const devicesSource = sourceFor("apps/cloud/src/modules/devices/index.ts");
  const drainPortSource = sourceFor("apps/cloud/src/modules/devices/ports.ts");
  const passwordHashPortSource = sourceFor("apps/cloud/src/modules/identity/password-hash-port.ts");
  const loginCommandSource = sourceFor("apps/cloud/src/modules/identity/login-command.ts");
  const passwordHashFallbackTestSource = sourceFor("apps/cloud/test/password-hash-fallback.test.ts");
  const authNegativeMatrixSources = new Map([
    "apps/cloud/test/identity-fixture.test.ts",
    "apps/cloud/test/session-families.test.ts",
  ].map((path) => [path, sourceFor(path)]));
  const authNegativeMatrix = collectAuthNegativeMatrix(authNegativeMatrixSources);
  const rawPasswordForbiddenSurfaceProofReport = rawPasswordForbiddenSurfaceProof(
    identityPasswordPathInputs.map((path) => ({
      path,
      source: sourceFor(path),
    })),
  );
  const denyingPasswordHashPortAssertion = denyingPasswordHashPortStructuralAssertion(
    passwordHashPortSource,
    loginCommandSource,
    passwordHashFallbackTestSource,
  );
  const drainRuntimeSource = drainRuntimeSources.map(({ source }) => source).join("\n");
  const portfolioQuerySource = portfolioQuerySourceInputs
    .map((path) => `// ${path}\n${sourceFor(path)}`)
    .join("\n");
  const portfolioQueryTestSource = sourceFor("packages/client-core/test/portfolio-query.test.ts");

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
    productionPasswordVerificationDenying: denyingPasswordHashPortAssertion.present,
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
    portfolioQueryContractPortable: portfolioQueryContractIsPortable(
      portfolioQuerySource,
      portfolioQueryTestSource,
    ),
    portfolioQueryProductionWiringAbsent: !/\bfrom\s+["'](?:@tauri-apps|@gooddealer\/cloud-client|gooddealer-local-storage|apps\/cloud)/.test(
      portfolioQuerySource,
    ),
    internalAccountSellable: !identityFixtureIsNonSellable(identityFixtureSource),
    requiredInputsPresent: inputs.length === requiredInputs.length,
    accountVectors: vectorCounts("packages/protocol/test-vectors/account", inputSources),
    deviceVectors: vectorCounts("packages/protocol/test-vectors/device-management", inputSources),
    bootstrapVectors: vectorCounts("packages/protocol/test-vectors/bootstrap-steps", inputSources),
    workspaceVectors: vectorCounts("packages/protocol/test-vectors/workspace-sync", inputSources),
    domainAssetProjectionVectors: vectorCounts("packages/protocol/test-vectors/domain-asset-projection", inputSources),
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
    report.productionPasswordVerificationDenying &&
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
    report.portfolioQueryContractPortable &&
    report.portfolioQueryProductionWiringAbsent &&
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
    report.domainAssetProjectionVectors.valid > 0 &&
    report.domainAssetProjectionVectors.invalid > 0 &&
    accountGateInputAdmissionErrors().length === 0 &&
    report.inputs.every((input) => {
      try {
        regularRequiredInputPath(root, input.path);
        return true;
      } catch {
        return false;
      }
    })
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
