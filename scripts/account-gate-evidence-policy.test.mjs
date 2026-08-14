import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  accountGateReportPassesPolicy,
  collectAccountGateReport,
  drainProofSignatureCheckNamingCompliant,
  drainProofSignaturePortCannotSucceed,
  identityFixtureIsNonSellable,
  sourceAcceptDrainReleasesLease,
  sourceAcceptsDrainProof,
  sourceDeclaresRawCredentialField,
  sourceIssuesActiveDeviceLease,
  sourceRegistersProductionRoute,
  sourceVerifiesSignature,
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

test("WP-2 account gate evidence is fixture-only and independently runnable", () => {
  assert.equal(
    packageJson.scripts["evidence:wp2"],
    "node scripts/collect-wp0-evidence.mjs --slice account-gate",
  );
  assert.match(collector, /resolvedProfile: "wp2-account-gate-cloud-fixture"/);
  assert.match(collector, /id: "account-gate-fixture-report"/);
  assert.match(workflow, /--profile quality --slice account-gate/);
  assert.match(workflow, /\.artifacts\/wp2\/account-gate/);
  assert.doesNotMatch(workflow, /windows-2025|macos-15/);
});

test("WP-2 workflow pins the evidence upload action", () => {
  assert.match(workflow, /actions\/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7\.0\.1/);
});

test("account gate report rejects production route registration without confusing Map access", () => {
  assert.equal(sourceRegistersProductionRoute('import Fastify from "fastify";'), true);
  assert.equal(sourceRegistersProductionRoute('app.post("/login", handler);'), true);
  assert.equal(sourceRegistersProductionRoute("const session = sessions.get(sessionId);"), false);
});

test("account gate report rejects raw credential fields but accepts expiry metadata and auth methods", () => {
  assert.equal(sourceDeclaresRawCredentialField("password?: string;"), true);
  assert.equal(sourceDeclaresRawCredentialField("'refreshToken': string;"), true);
  assert.equal(sourceDeclaresRawCredentialField("accessTokenExpiresAt: string;"), false);
  assert.equal(sourceDeclaresRawCredentialField('method: z.enum(["password", "passkey"]);'), false);
});

test("account gate raw credential policy does not misclassify committed C0 identifiers", () => {
  for (const [file, source] of c0RuntimeSources) {
    assert.equal(sourceDeclaresRawCredentialField(source), false, file);
  }
  assert.equal(
    sourceDeclaresRawCredentialField(
      "credentialEpoch: number; boundAccountSecurityEpoch: number; expectedCredentialEpoch?: number;",
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

test("account gate report makes every fallback field a hard requirement", () => {
  const report = collectAccountGateReport();
  assert.equal(report.activeDeviceLeaseIssuanceAbsent, true);
  assert.equal(report.signatureVerificationAbsent, true);
  assert.equal(report.drainProofAcceptanceAbsent, true);
  assert.equal(report.drainProofSignatureSuccessUnrepresentable, true);
  assert.equal(report.acceptDrainLeaseReleaseAbsent, true);
  assert.equal(report.drainProductionRoutesAbsent, true);
  assert.equal(report.drainProofSignatureCheckNamingCompliant, true);
  assert.equal(accountGateReportPassesPolicy(report), true);
  for (const field of [
    "activeDeviceLeaseIssuanceAbsent",
    "signatureVerificationAbsent",
    "drainProofAcceptanceAbsent",
    "drainProofSignatureSuccessUnrepresentable",
    "acceptDrainLeaseReleaseAbsent",
    "drainProductionRoutesAbsent",
    "drainProofSignatureCheckNamingCompliant",
  ]) {
    assert.equal(accountGateReportPassesPolicy({ ...report, [field]: false }), false, field);
  }
});

test("account gate report requires an explicitly non-sellable fixture", () => {
  assert.equal(identityFixtureIsNonSellable("readonly sellable = false;"), true);
  assert.equal(identityFixtureIsNonSellable("readonly sellable = false as const;"), true);
  assert.equal(identityFixtureIsNonSellable("readonly sellable = true;"), false);
});
