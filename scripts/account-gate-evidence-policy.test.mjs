import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import {
  ACCOUNT_GATE_REQUIRED_INPUTS,
  ACCOUNT_GATE_VECTOR_INPUTS,
  accountGateInputAdmissionErrors,
  accountGateReportPassesPolicy,
  collectAccountGateReport,
  drainProofSignatureCheckNamingCompliant,
  drainProofSignaturePortCannotSucceed,
  identityFixtureIsNonSellable,
  passwordHashCheckNamingCompliant,
  denyingPasswordHashPortCannotSucceed,
  portfolioQueryContractIsPortable,
  portfolioQuerySourceInputs,
  rawPasswordForbiddenSurfaceProof,
  sourceAcceptDrainReleasesLease,
  sourceAcceptsDrainProof,
  sourceDeclaresRawCredentialField,
  sourceIssuesActiveDeviceLease,
  sourceRegistersProductionRoute,
  sourceVerifiesSignature,
  sourceVerifiesSignatureInScope,
  workspaceSourceRequiresTenantScope,
} from "./collect-account-gate-report.mjs";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url)));
const collector = readFileSync(new URL("./collect-wp0-evidence.mjs", import.meta.url), "utf8");
const workflow = readFileSync(new URL("../.github/workflows/wp2-account-gate.yml", import.meta.url), "utf8");
const c0RuntimeSources = [
  "bootstrap-fixture.ts",
  "bootstrap-workflow.ts",
  "index.ts",
  "lease-lifecycle.ts",
  "ports.ts",
  "switch-workflow.ts",
].map((file) => [
  file,
  readFileSync(new URL(`../apps/cloud/src/modules/devices/${file}`, import.meta.url), "utf8"),
]);
const drainPortSource = readFileSync(
  new URL("../apps/cloud/src/modules/devices/ports.ts", import.meta.url),
  "utf8",
);
const devicesSource = readFileSync(
  new URL("../apps/cloud/src/modules/devices/index.ts", import.meta.url),
  "utf8",
);
const drainVerificationSource = readFileSync(
  new URL("../apps/cloud/src/modules/devices/drain-verification.ts", import.meta.url),
  "utf8",
);
const passwordHashPortSource = readFileSync(
  new URL("../apps/cloud/src/modules/identity/password-hash-port.ts", import.meta.url),
  "utf8",
);
const portfolioQuerySource = portfolioQuerySourceInputs
  .map((path) => `// ${path}\n${readFileSync(new URL(`../${path}`, import.meta.url), "utf8")}`)
  .join("\n");
const portfolioQueryTestSource = readFileSync(
  new URL("../packages/client-core/test/portfolio-query.test.ts", import.meta.url),
  "utf8",
);
const accountGateCollectorSource = readFileSync(
  new URL("./collect-account-gate-report.mjs", import.meta.url),
  "utf8",
).replaceAll("\r\n", "\n");
const physicalTemporaryDirectory = realpathSync(tmpdir());
const accountGateAdmittedInputPaths = Object.freeze([
  ...new Set([...ACCOUNT_GATE_REQUIRED_INPUTS, ...ACCOUNT_GATE_VECTOR_INPUTS]),
]);

function temporaryDirectory(prefix) {
  return mkdtempSync(join(physicalTemporaryDirectory, prefix));
}

function accountGateInputFixture(t, { repositoryRoot = temporaryDirectory("gooddealer-account-gate-inputs-") } = {}) {
  const fixtureRoot = repositoryRoot;
  t.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));
  for (const path of accountGateAdmittedInputPaths) {
    const destination = join(fixtureRoot, path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, path.endsWith(".json") ? "{}\n" : "input\n");
  }
  return fixtureRoot;
}

function replaceOnce(source, search, replacement) {
  assert.ok(source.includes(search), "disposable mutation source is missing expected text");
  return source.replace(search, replacement);
}

async function importDisposableCollector(t, fixtureRoot, transform = (source) => source) {
  const disposablePath = join(fixtureRoot, "scripts", "collect-account-gate-report.mjs");
  mkdirSync(dirname(disposablePath), { recursive: true });
  writeFileSync(disposablePath, transform(accountGateCollectorSource));
  return import(pathToFileURL(disposablePath).href);
}

function withPostAdmissionVectorSwap(source) {
  const fsImport = 'import { lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";';
  const swapImport = 'import { lstatSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";';
  const admittedSources = "  const inputSources = admittedRequiredInputSources();";
  return replaceOnce(
    replaceOnce(source, fsImport, swapImport),
    admittedSources,
    [
      admittedSources,
      '  const vectorPath = resolve(root, "packages/protocol/test-vectors/domain-asset-projection/valid/utf8-order.json");',
      "  rmSync(vectorPath);",
      '  symlinkSync(resolve(root, "external-post-admission-sentinel.json"), vectorPath);',
    ].join("\n"),
  );
}

function withTerminalOnlyRootAdmission(source) {
  const componentWalk = [
    "  const lexicalComponents = [];",
    "  for (let current = resolvedRoot; ; current = dirname(current)) {",
    "    lexicalComponents.unshift(current);",
    "    if (dirname(current) === current) break;",
    "  }",
  ].join("\n");
  return replaceOnce(source, componentWalk, "  const lexicalComponents = [resolvedRoot];");
}

function withRawVectorReread(source) {
  return replaceOnce(
    source,
    '      JSON.parse(content.toString("utf8"));',
    '      JSON.parse(readFileSync(resolve(root, path), "utf8"));',
  );
}

test("WP-2 account gate evidence is fixture-only and independently runnable", () => {
  assert.equal(
    packageJson.scripts["evidence:wp2"],
    "node scripts/collect-wp0-evidence.mjs --slice account-gate",
  );
  assert.match(collector, /resolvedProfile: "wp2-account-gate-cloud-fixture"/);
  assert.match(collector, /id: "account-gate-fixture-report"/);
  assert.match(workflow, /--profile quality --slice account-gate/);
  assert.match(workflow, /\.artifacts\/wp2\/account-gate/);
  assert.match(workflow, /EVIDENCE_OWNING_MODULES: .*protocol-workspace.*cloud-account-device-bootstrap-fixtures/);
  assert.doesNotMatch(workflow, /windows-2025|macos-15/);
});

test("account gate input admission accepts the live inventory and rejects external regular-file symlink paths", (t) => {
  assert.deepEqual(accountGateInputAdmissionErrors(), []);
  assert.equal(accountGateReportPassesPolicy(collectAccountGateReport()), true);

  const leafRoot = accountGateInputFixture(t);
  const externalLeafDirectory = temporaryDirectory("gooddealer-account-gate-external-leaf-");
  t.after(() => rmSync(externalLeafDirectory, { recursive: true, force: true }));
  const leafInput = ACCOUNT_GATE_REQUIRED_INPUTS[0];
  const externalLeaf = join(externalLeafDirectory, "account-gate.ts");
  writeFileSync(externalLeaf, "external regular-file target\n");
  rmSync(join(leafRoot, leafInput));
  symlinkSync(externalLeaf, join(leafRoot, leafInput));
  assert.ok(
    accountGateInputAdmissionErrors({ repositoryRoot: leafRoot }).some((error) =>
      error.includes(`symbolic link: ${leafInput}`),
    ),
  );

  const ancestorRoot = accountGateInputFixture(t);
  const externalProtocolRoot = temporaryDirectory("gooddealer-account-gate-external-parent-");
  t.after(() => rmSync(externalProtocolRoot, { recursive: true, force: true }));
  const externalParentTarget = join(externalProtocolRoot, "src", "account", "account-gate.ts");
  mkdirSync(dirname(externalParentTarget), { recursive: true });
  writeFileSync(externalParentTarget, "external regular-file target\n");
  rmSync(join(ancestorRoot, "packages", "protocol"), { recursive: true });
  symlinkSync(externalProtocolRoot, join(ancestorRoot, "packages", "protocol"));
  assert.ok(
    accountGateInputAdmissionErrors({ repositoryRoot: ancestorRoot }).some((error) =>
      error.includes(`symbolic link: ${leafInput}`),
    ),
  );
});

test("account gate input admission fails closed for missing and directory leaves", (t) => {
  const missingRoot = accountGateInputFixture(t);
  const missingInput = ACCOUNT_GATE_REQUIRED_INPUTS[1];
  rmSync(join(missingRoot, missingInput));
  assert.ok(
    accountGateInputAdmissionErrors({ repositoryRoot: missingRoot }).some((error) => error.includes("ENOENT")),
  );

  const directoryRoot = accountGateInputFixture(t);
  const directoryInput = ACCOUNT_GATE_REQUIRED_INPUTS[2];
  rmSync(join(directoryRoot, directoryInput));
  mkdirSync(join(directoryRoot, directoryInput));
  assert.ok(
    accountGateInputAdmissionErrors({ repositoryRoot: directoryRoot }).some((error) =>
      error.includes(`regular file: ${directoryInput}`),
    ),
  );
});

test("account gate input admission rejects a symlinked lexical repository-root ancestor", (t) => {
  const externalParent = temporaryDirectory("gooddealer-account-gate-external-root-parent-");
  t.after(() => rmSync(externalParent, { recursive: true, force: true }));
  accountGateInputFixture(t, {
    repositoryRoot: join(externalParent, "repository"),
  });
  const lexicalParent = temporaryDirectory("gooddealer-account-gate-lexical-root-parent-");
  t.after(() => rmSync(lexicalParent, { recursive: true, force: true }));
  const linkedParent = join(lexicalParent, "external-parent-link");
  symlinkSync(externalParent, linkedParent);

  const errors = accountGateInputAdmissionErrors({
    repositoryRoot: join(linkedParent, "repository"),
  });
  assert.equal(errors.length, accountGateAdmittedInputPaths.length);
  assert.equal(
    errors.every((error) => error.includes("repository root may not traverse a symbolic link")),
    true,
  );
});

test("account gate lexical-root regression kills a terminal-only root-admission mutation", async (t) => {
  const externalParent = temporaryDirectory("gooddealer-account-gate-mutant-root-parent-");
  t.after(() => rmSync(externalParent, { recursive: true, force: true }));
  const externalRepository = accountGateInputFixture(t, {
    repositoryRoot: join(externalParent, "repository"),
  });
  const lexicalParent = temporaryDirectory("gooddealer-account-gate-mutant-lexical-parent-");
  t.after(() => rmSync(lexicalParent, { recursive: true, force: true }));
  const linkedParent = join(lexicalParent, "external-parent-link");
  symlinkSync(externalParent, linkedParent);

  const mutant = await importDisposableCollector(
    t,
    externalRepository,
    withTerminalOnlyRootAdmission,
  );
  assert.deepEqual(
    mutant.accountGateInputAdmissionErrors({
      repositoryRoot: join(linkedParent, "repository"),
    }),
    [],
  );
});

test("account gate vector counts parse only admitted bytes after a post-admission swap", async (t) => {
  const vectorInput = "packages/protocol/test-vectors/domain-asset-projection/valid/utf8-order.json";
  assert.ok(ACCOUNT_GATE_VECTOR_INPUTS.includes(vectorInput));
  assert.doesNotMatch(accountGateCollectorSource, /\b(?:jsonFiles|readdirSync)\b/);

  const swappedRoot = accountGateInputFixture(t);
  writeFileSync(join(swappedRoot, "external-post-admission-sentinel.json"), "external post-admission sentinel\n");
  const swappedCollector = await importDisposableCollector(t, swappedRoot, withPostAdmissionVectorSwap);
  const swappedReport = swappedCollector.collectAccountGateReport();
  assert.deepEqual(swappedReport.domainAssetProjectionVectors, { valid: 1, invalid: 3 });

  const malformedRoot = accountGateInputFixture(t);
  writeFileSync(join(malformedRoot, vectorInput), "not JSON\n");
  const malformedCollector = await importDisposableCollector(t, malformedRoot);
  assert.throws(() => malformedCollector.collectAccountGateReport(), SyntaxError);

  const mutantRoot = accountGateInputFixture(t);
  writeFileSync(join(mutantRoot, "external-post-admission-sentinel.json"), "external post-admission sentinel\n");
  const rawRereadMutant = await importDisposableCollector(
    t,
    mutantRoot,
    (source) => withRawVectorReread(withPostAdmissionVectorSwap(source)),
  );
  assert.throws(() => rawRereadMutant.collectAccountGateReport(), SyntaxError);
});

test("WP-2 workflow pins the evidence upload action", () => {
  assert.match(workflow, /actions\/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7\.0\.1/);
});

test("account gate report carries the portable P0-23 query contract and fails closed on wiring drift", () => {
  assert.equal(portfolioQueryContractIsPortable(portfolioQuerySource, portfolioQueryTestSource), true);
  assert.equal(
    portfolioQueryContractIsPortable(
      `${portfolioQuerySource}\nimport { CloudTransport } from "@gooddealer/cloud-client";`,
      portfolioQueryTestSource,
    ),
    false,
  );
  assert.equal(
    portfolioQueryContractIsPortable(
      portfolioQuerySource.replace("listDomains(): Promise<PortfolioQueryResult>;", "mutate(): Promise<void>;"),
      portfolioQueryTestSource,
    ),
    false,
  );
  assert.equal(
    portfolioQueryContractIsPortable(
      portfolioQuerySource.replace("freshness.canEdit !== expectedCanEdit", "false"),
      portfolioQueryTestSource,
    ),
    false,
  );
});

test("account gate report rejects production route registration without confusing Map access", () => {
  assert.equal(sourceRegistersProductionRoute('import Fastify from "fastify";'), true);
  assert.equal(sourceRegistersProductionRoute('app.post("/login", handler);'), true);
  assert.equal(sourceRegistersProductionRoute("const session = sessions.get(sessionId);"), false);
});

test("account gate report bans password fields only in shared protocol and token fields Cloud-wide", () => {
  assert.equal(sourceDeclaresRawCredentialField("password?: string;", "packages/protocol/src/account/login.ts"), true);
  assert.equal(sourceDeclaresRawCredentialField("password?: string;", "apps/cloud/src/modules/identity/login.ts"), false);
  assert.equal(sourceDeclaresRawCredentialField("'refreshToken': string;", "apps/cloud/src/modules/identity/login.ts"), true);
  assert.equal(sourceDeclaresRawCredentialField("accessTokenExpiresAt: string;", "apps/cloud/src/modules/identity/login.ts"), false);
  assert.equal(
    sourceDeclaresRawCredentialField('method: z.enum(["password", "passkey"]);', "packages/protocol/src/account/auth.ts"),
    false,
  );
});

test("account gate raw credential policy does not misclassify committed C0 identifiers", () => {
  for (const [file, source] of c0RuntimeSources) {
    assert.equal(sourceDeclaresRawCredentialField(source, `apps/cloud/src/modules/devices/${file}`), false, file);
  }
  assert.equal(
    sourceDeclaresRawCredentialField(
      "credentialEpoch: number; boundAccountSecurityEpoch: number; expectedCredentialEpoch?: number;",
      "apps/cloud/src/modules/devices/index.ts",
    ),
    false,
  );
});

test("account gate report rejects ActiveDeviceLease issuance but accepts unsigned denied claims", () => {
  assert.equal(
    sourceIssuesActiveDeviceLease(`
      const envelope = {
        typ: "gd.active-device-lease.v1",
        aud: "gooddealer-desktop/active-device-lease",
        kid: signingKeyId,
        signature,
        payload: { leaseEpoch: 4 },
      };
    `),
    true,
  );
  assert.equal(
    sourceIssuesActiveDeviceLease(`
      async signActiveDeviceLease(claims) {
        return { issued: true, envelope: await sign(claims) };
      }
    `),
    true,
  );
  assert.equal(
    sourceIssuesActiveDeviceLease(`
      const claims = {
        typ: "gd.active-device-lease.v1",
        aud: "gooddealer-desktop/active-device-lease",
        payload: { leaseEpoch: pendingEpoch },
      };
      return { issued: false, reason: "lease_issuance_disabled", claims };
    `),
    false,
  );
  for (const [file, source] of c0RuntimeSources) {
    assert.equal(sourceIssuesActiveDeviceLease(source), false, file);
  }
});

test("account gate report rejects signature verification primitives without matching binding checks", () => {
  assert.equal(
    sourceVerifiesSignature('import { verify } from "node:crypto"; verify(null, bytes, key, signature);'),
    true,
  );
  assert.equal(sourceVerifiesSignature("await globalThis.crypto.subtle.verify(algorithm, key, signature, bytes);"), true);
  assert.equal(
    sourceVerifiesSignature("await capabilityVerifier.verifyBootstrapCapability(presented, expected);"),
    false,
  );
  for (const [file, source] of c0RuntimeSources) {
    assert.equal(sourceVerifiesSignature(source), false, file);
  }
});

test("signature verification ban is scoped to devices and drain sources", () => {
  const source = "await crypto.subtle.verify(algorithm, key, signature, bytes);";
  assert.equal(sourceVerifiesSignatureInScope("apps/cloud/src/modules/devices/drain-verification.ts", source), true);
  assert.equal(sourceVerifiesSignatureInScope("apps/cloud/src/modules/identity/login-command.ts", source), false);
});

test("account gate report fails closed when a positive drain-signature verdict is constructible", () => {
  assert.equal(
    sourceAcceptsDrainProof(`
      interface DrainProofSignaturePort {
        checkDrainProofSignature(): Promise<{ readonly verified: true }>;
      }
    `),
    true,
  );
  assert.equal(
    sourceAcceptsDrainProof(`
      async checkDrainProofSignature() {
        return { verified: true };
      }
    `),
    true,
  );
  assert.equal(sourceAcceptsDrainProof(drainPortSource), false);
  assert.equal(sourceAcceptsDrainProof(drainVerificationSource), false);
});

test("account gate report requires an unsuccessable DrainProofSignaturePort return type", () => {
  assert.equal(drainProofSignaturePortCannotSucceed(drainPortSource), true);
  assert.equal(
    drainProofSignaturePortCannotSucceed(`
      interface DrainProofSignaturePort {
        checkDrainProofSignature(): Promise<{
          readonly verified: boolean;
          readonly reason: "signature_verification_disabled";
        }>;
      }
    `),
    false,
  );
  assert.equal(
    drainProofSignaturePortCannotSucceed("interface DrainProofSignaturePort {}"),
    false,
  );
});

test("account gate report requires checkDrainProofSignature naming", () => {
  assert.equal(
    drainProofSignatureCheckNamingCompliant(`${drainPortSource}\n${drainVerificationSource}`),
    true,
  );
  assert.equal(
    drainProofSignatureCheckNamingCompliant(`
      interface DrainProofSignaturePort {
        verifyDrainProofSignature(): Promise<{ readonly verified: false }>;
      }
    `),
    false,
  );
  assert.equal(drainProofSignatureCheckNamingCompliant("const drain = true;"), false);
});

test("account gate report requires a Denying checkPasswordHash production default", () => {
  assert.equal(denyingPasswordHashPortCannotSucceed(passwordHashPortSource), true);
  assert.equal(passwordHashCheckNamingCompliant(passwordHashPortSource), true);
  assert.equal(
    denyingPasswordHashPortCannotSucceed(`
      interface PasswordHashPort {
        checkPasswordHash(): Promise<{ readonly verified: boolean }>;
      }
      class DenyingPasswordHashPort implements PasswordHashPort {
        async checkPasswordHash() { return { verified: true }; }
      }
    `),
    false,
  );
  assert.equal(
    passwordHashCheckNamingCompliant(`
      interface PasswordHashPort {
        verifyPasswordHash(): Promise<{ readonly verified: false }>;
      }
    `),
    false,
  );
});

test("account gate report records a structured auth negative matrix and fails closed per assertion", () => {
  const report = collectAccountGateReport();
  const matrix = report.authNegativeMatrix;
  assert.equal(matrix.present, true);
  assert.deepEqual(
    [...new Set(matrix.assertions.map(({ category }) => category))].sort(),
    ["family-revocation", "jti-uniqueness", "reauth", "reuse", "rotation"],
  );
  assert.deepEqual(
    matrix.assertions.map(({ id }) => id),
    [
      "current-jti-rotation-cas",
      "retired-jti-reuse",
      "unknown-and-cross-family-jti",
      "family-wide-jti-revocation-isolated",
      "global-jti-uniqueness-no-partial-write",
      "stale-list-revision-and-missing-reauth",
      "expired-and-epoch-stale-reauth",
    ],
  );
  for (const assertion of matrix.assertions) {
    assert.equal(assertion.present, true, assertion.id);
    assert.ok(assertion.evidenceChecks.length > 0, assertion.id);
    assert.equal(assertion.evidenceChecks.every(({ present }) => present), true, assertion.id);
    const mutated = {
      ...report,
      authNegativeMatrix: {
        ...matrix,
        assertions: matrix.assertions.map((candidate) =>
          candidate.id === assertion.id ? { ...candidate, present: false } : candidate
        ),
      },
    };
    assert.equal(accountGateReportPassesPolicy(mutated), false, assertion.id);
    assert.equal(
      accountGateReportPassesPolicy({
        ...report,
        authNegativeMatrix: {
          ...matrix,
          assertions: matrix.assertions.map((candidate) =>
            candidate.id === assertion.id
              ? {
                  ...candidate,
                  evidenceChecks: candidate.evidenceChecks.map((check, index) =>
                    index === 0 ? { ...check, present: false } : check
                  ),
                }
              : candidate
          ),
        },
      }),
      false,
      `${assertion.id}:evidence-check`,
    );
  }
  assert.equal(
    accountGateReportPassesPolicy({
      ...report,
      authNegativeMatrix: { ...matrix, assertions: matrix.assertions.slice(1) },
    }),
    false,
  );
});

test("account gate report proves all six raw-password forbidden surfaces absent and fails closed per surface", () => {
  const report = collectAccountGateReport();
  const proof = report.rawPasswordForbiddenSurfaceProof;
  assert.equal(report.rawPasswordSurfacesAbsent, true);
  assert.equal(proof.scope, "identity-real-password-path");
  assert.deepEqual(proof.scannedSources, [
    "apps/cloud/src/modules/identity/login-command.ts",
    "apps/cloud/src/modules/identity/password-hash-port.ts",
  ]);
  assert.deepEqual(
    proof.surfaces.map(({ id }) => id),
    ["dom-persistent-state", "ipc-history", "logs", "errors", "sqlite", "temp-files"],
  );
  for (const surface of proof.surfaces) {
    assert.equal(surface.absent, true, surface.id);
    const mutated = {
      ...report,
      rawPasswordForbiddenSurfaceProof: {
        ...proof,
        surfaces: proof.surfaces.map((candidate) =>
          candidate.id === surface.id ? { ...candidate, absent: false } : candidate
        ),
      },
    };
    assert.equal(accountGateReportPassesPolicy(mutated), false, surface.id);
  }

  const forbiddenSamples = new Map([
    ["dom-persistent-state", 'localStorage.setItem("password", candidate);'],
    ["ipc-history", "invoke(ACCOUNT_LOGIN_COMMAND, { secret });"],
    ["logs", "console.log(candidate);"],
    ["errors", "throw new Error(secret);"],
    ["sqlite", 'sqlite.prepare("INSERT INTO credentials VALUES (?)");'],
    ["temp-files", 'writeFile(tmpdir(), candidate);'],
  ]);
  for (const [surfaceId, source] of forbiddenSamples) {
    const injected = rawPasswordForbiddenSurfaceProof([
      { path: "apps/cloud/src/modules/identity/login-command.ts", source },
      {
        path: "apps/cloud/src/modules/identity/password-hash-port.ts",
        source: "const port = true;",
      },
    ]);
    assert.equal(injected.surfaces.find(({ id }) => id === surfaceId)?.absent, false, surfaceId);
    assert.equal(
      accountGateReportPassesPolicy({
        ...report,
        rawPasswordSurfacesAbsent: false,
        rawPasswordForbiddenSurfaceProof: injected,
      }),
      false,
      surfaceId,
    );
  }
});

test("account gate report carries the DenyingPasswordHashPort structural assertion", () => {
  const report = collectAccountGateReport();
  const assertion = report.denyingPasswordHashPortStructuralAssertion;
  assert.equal(assertion.present, true);
  assert.equal(assertion.source, "apps/cloud/src/modules/identity/password-hash-port.ts");
  assert.deepEqual(Object.keys(assertion.checks), [
    "interfaceSupportsClosedVerdict",
    "explicitVerifierOptInPresent",
    "denyingImplementationPresent",
    "denyingImplementationReturnsDisabled",
    "defaultCompositionUsesDenyingPort",
    "denyingCandidateZeroingTestPresent",
  ]);
  for (const field of Object.keys(assertion.checks)) {
    assert.equal(assertion.checks[field], true, field);
    assert.equal(
      accountGateReportPassesPolicy({
        ...report,
        denyingPasswordHashPortStructuralAssertion: {
          ...assertion,
          checks: { ...assertion.checks, [field]: false },
        },
      }),
      false,
      field,
    );
  }
});

test("account gate report honestly records the designed probe anchor as R1-R10 gated and not executed", () => {
  const report = collectAccountGateReport();
  assert.equal(report.probeExecuted, false);
  assert.deepEqual(report.probeAnchor, {
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
  });
  assert.equal(accountGateReportPassesPolicy({ ...report, probeExecuted: true }), false);
  assert.equal(
    accountGateReportPassesPolicy({
      ...report,
      probeAnchor: { ...report.probeAnchor, passClaimed: true, probeVerdict: "pass" },
    }),
    false,
  );
  assert.equal(
    accountGateReportPassesPolicy({
      ...report,
      probeAnchor: { ...report.probeAnchor, readinessCriteria: report.probeAnchor.readinessCriteria.slice(1) },
    }),
    false,
  );
});

test("account gate report rejects direct lease release from acceptDrain", () => {
  assert.equal(sourceAcceptDrainReleasesLease(devicesSource), false);
  assert.equal(
    sourceAcceptDrainReleasesLease(`
      class Devices {
        async acceptDrain() {
          this.#leaseLifecycle.completeHandoff();
        }

        claimTakeover() {}
      }
    `),
    true,
  );
  assert.equal(sourceAcceptDrainReleasesLease("class Devices {}"), true);
});

test("account gate report rejects production routes in drain modules", () => {
  assert.equal(sourceRegistersProductionRoute(drainVerificationSource), false);
  assert.equal(sourceRegistersProductionRoute('server.post("/drain", handler);'), true);
});

test("account gate report requires tenant scope on exported workspace data-plane methods", () => {
  assert.equal(workspaceSourceRequiresTenantScope(`
    export class Reader {
      async readPage(scope: WorkspaceTenantScope, request: unknown): Promise<void> {}
      snapshot(scope: WorkspaceTenantScope): readonly unknown[] { return []; }
    }
  `), true);
  assert.equal(workspaceSourceRequiresTenantScope(`
    export class Reader {
      async readPage(request: unknown): Promise<void> {}
    }
  `), false);
});

test("account gate report makes every fallback field a hard requirement", () => {
  const report = collectAccountGateReport();
  assert.equal(report.activeDeviceLeaseIssuanceAbsent, true);
  assert.equal(report.signatureVerificationAbsent, true);
  assert.equal(report.drainProofAcceptanceAbsent, true);
  assert.equal(report.drainProofSignatureSuccessUnrepresentable, true);
  assert.equal(report.productionPasswordVerificationDenying, true);
  assert.equal(report.passwordHashCheckNamingCompliant, true);
  assert.equal(report.rotationFamilyNegativeMatrixPresent, true);
  assert.equal(report.acceptDrainLeaseReleaseAbsent, true);
  assert.equal(report.drainProductionRoutesAbsent, true);
  assert.equal(report.drainProofSignatureCheckNamingCompliant, true);
  assert.equal(report.workspaceIngestProductionRoutesAbsent, true);
  assert.equal(report.workspaceTenantScopeRequired, true);
  assert.equal(report.portfolioQueryContractPortable, true);
  assert.equal(report.portfolioQueryProductionWiringAbsent, true);
  assert.equal(accountGateReportPassesPolicy(report), true);
  for (const field of [
    "activeDeviceLeaseIssuanceAbsent",
    "signatureVerificationAbsent",
    "drainProofAcceptanceAbsent",
    "drainProofSignatureSuccessUnrepresentable",
    "productionPasswordVerificationDenying",
    "passwordHashCheckNamingCompliant",
    "rotationFamilyNegativeMatrixPresent",
    "acceptDrainLeaseReleaseAbsent",
    "drainProductionRoutesAbsent",
    "drainProofSignatureCheckNamingCompliant",
    "workspaceIngestProductionRoutesAbsent",
    "workspaceTenantScopeRequired",
    "portfolioQueryContractPortable",
    "portfolioQueryProductionWiringAbsent",
  ]) {
    assert.equal(accountGateReportPassesPolicy({ ...report, [field]: false }), false, field);
  }
});

test("account gate report requires an explicitly non-sellable fixture", () => {
  assert.equal(identityFixtureIsNonSellable("readonly sellable = false;"), true);
  assert.equal(identityFixtureIsNonSellable("readonly sellable = false as const;"), true);
  assert.equal(identityFixtureIsNonSellable("readonly sellable = true;"), false);
});
