import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  KEYCHAIN_CANARY,
  KEYCHAIN_ENVELOPE_MARKER,
  KEYCHAIN_SURFACES,
  keychainCanaryReportIsHonestIgnore,
  keychainCanaryReportPassesPolicy,
  keychainSupportMatrix,
  scanKeychainSurface,
} from "./collect-keychain-canary-report.mjs";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url)));
const collector = readFileSync(new URL("./collect-wp0-evidence.mjs", import.meta.url), "utf8");
const workflow = readFileSync(
  new URL("../.github/workflows/wp1-keychain.yml", import.meta.url),
  "utf8",
);

function passingReport() {
  const report = {
    schemaVersion: 1,
    scope: "disposable test only",
    status: "passed",
    platform: "darwin",
    arch: "arm64",
    keychainBackend: "macos-keychain-services",
    signedBuild: false,
    probeExecuted: true,
    roundTripCommitted: true,
    namespaceIsolated: true,
    namespaceConfusionNegative: true,
    deleteIdempotent: true,
    credentialRefNeverReturned: true,
    scans: KEYCHAIN_SURFACES.map((surface) =>
      scanKeychainSurface({ surface, surfacePresent: surface === "logs", content: "" }),
    ),
  };
  report.supportMatrix = keychainSupportMatrix({
    actualPlatform: report.platform,
    actualArch: report.arch,
    probeExecuted: true,
    reportStatus: report.status,
  });
  assert.doesNotMatch(JSON.stringify(report), new RegExp(KEYCHAIN_CANARY));
  assert.doesNotMatch(JSON.stringify(report), new RegExp(KEYCHAIN_ENVELOPE_MARKER));
  return report;
}

test("WP-1 keychain evidence has a dedicated command and honest platform matrix", () => {
  assert.equal(
    packageJson.scripts["evidence:wp1"],
    "node scripts/collect-wp0-evidence.mjs --slice keychain",
  );
  assert.match(collector, /"keychain"/);
  assert.match(workflow, /windows-2025/);
  assert.match(workflow, /macos-15\r?\n/);
  assert.match(workflow, /macos-15-intel/);
  assert.match(workflow, /--profile native --slice keychain/);
  assert.doesNotMatch(workflow, /verified/i);
});

test("seven-surface policy accepts only complete fail-closed absence assertions", () => {
  const report = passingReport();
  assert.equal(keychainCanaryReportPassesPolicy(report), true);

  for (const field of [
    "roundTripCommitted",
    "namespaceIsolated",
    "namespaceConfusionNegative",
    "deleteIdempotent",
    "credentialRefNeverReturned",
  ]) {
    assert.equal(keychainCanaryReportPassesPolicy({ ...report, [field]: false }), false, field);
  }

  for (const surface of KEYCHAIN_SURFACES) {
    for (const field of ["canaryAbsent", "envelopeMarkerAbsent", "credentialRefAbsent"]) {
      const scans = structuredClone(report.scans);
      const scan = scans.find((candidate) => candidate.surface === surface);
      scan[field] = false;
      assert.equal(
        keychainCanaryReportPassesPolicy({ ...report, scans }),
        false,
        `${surface}.${field}`,
      );
    }
  }

  assert.equal(
    keychainCanaryReportPassesPolicy({ ...report, scans: report.scans.slice(1) }),
    false,
  );
  assert.equal(
    keychainCanaryReportPassesPolicy({
      ...report,
      scans: report.scans.map((scan) => ({ ...scan, surface: "logs" })),
    }),
    false,
  );
});

test("surface scanner detects Canary, envelope, and credential reference markers", () => {
  const canary = scanKeychainSurface({
    surface: "logs",
    surfacePresent: true,
    content: KEYCHAIN_CANARY,
  });
  assert.equal(canary.canaryAbsent, false);

  const envelope = scanKeychainSurface({
    surface: "ipc",
    surfacePresent: true,
    content: KEYCHAIN_ENVELOPE_MARKER,
  });
  assert.equal(envelope.envelopeMarkerAbsent, false);

  for (const marker of ["SecKeychainItemRef", "CFTypeRef", "CREDENTIALW", "PCREDENTIAL"] ) {
    const scan = scanKeychainSurface({
      surface: "crash",
      surfacePresent: true,
      content: marker,
    });
    assert.equal(scan.credentialRefAbsent, false, marker);
  }
});

test("ignored scans never fabricate absence or a Windows probe", () => {
  const macReport = passingReport();
  Object.assign(macReport, {
    status: "ignored",
    probeExecuted: false,
    ignoreReason: "disposable-keychain-unavailable",
    capabilityFailureStage: "create-disposable-keychain",
    roundTripCommitted: null,
    namespaceIsolated: null,
    namespaceConfusionNegative: null,
    deleteIdempotent: null,
    credentialRefNeverReturned: null,
    scans: [],
  });
  macReport.supportMatrix = keychainSupportMatrix({
    actualPlatform: macReport.platform,
    actualArch: macReport.arch,
    probeExecuted: false,
    reportStatus: macReport.status,
  });
  assert.equal(keychainCanaryReportIsHonestIgnore(macReport), true);
  assert.equal(keychainCanaryReportPassesPolicy(macReport), false);

  const windowsReport = {
    ...macReport,
    platform: "win32",
    arch: "x64",
    keychainBackend: "windows-credential-manager",
    ignoreReason: "pending-signed-build-e4",
  };
  windowsReport.supportMatrix = keychainSupportMatrix({
    actualPlatform: windowsReport.platform,
    actualArch: windowsReport.arch,
    probeExecuted: false,
    reportStatus: windowsReport.status,
  });
  assert.equal(keychainCanaryReportIsHonestIgnore(windowsReport), true);
  assert.equal(keychainCanaryReportPassesPolicy(windowsReport), false);

  const fabricatedWindows = {
    ...passingReport(),
    platform: "win32",
    arch: "x64",
    keychainBackend: "windows-credential-manager",
  };
  assert.equal(keychainCanaryReportPassesPolicy(fabricatedWindows), false);
});
