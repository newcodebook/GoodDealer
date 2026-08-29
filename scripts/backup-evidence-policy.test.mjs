import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import vm from "node:vm";

import {
  BACKUP_EVIDENCE_INPUT_PATHS,
  backupInputAdmissionErrors,
  backupReportPassesPolicy,
} from "./collect-wp0-evidence.mjs";

const expectedPlatforms = [
  "windows-11-24h2-x64",
  "macos-15-arm64",
  "macos-15-x64",
];
const expectedBackupEvidenceInputPaths = [
  "Cargo.lock",
  "Cargo.toml",
  "pnpm-lock.yaml",
  "rust-toolchain.toml",
  "crates/local-storage/Cargo.toml",
  "crates/local-storage/src/lib.rs",
  "crates/local-storage/src/backup/mod.rs",
  "crates/local-storage/src/backup/evidence.rs",
  "crates/local-storage/src/sqlcipher_fixture.rs",
  "crates/local-storage/examples/backup_evidence.rs",
  "scripts/collect-wp0-evidence.mjs",
  "scripts/backup-evidence-policy.test.mjs",
];

test("backup workflow provides a closed GitHub evidence context", () => {
  const workflow = readFileSync(
    new URL("../.github/workflows/wp5-backup-foundation.yml", import.meta.url),
    "utf8",
  );
  assert.match(workflow, /EVIDENCE_CI_JOB_NAME: wp5-backup-foundation-postgresql-18\.6/u);
  assert.match(workflow, /EVIDENCE_EXPECTED_PLATFORM: linux/u);
  assert.match(workflow, /EVIDENCE_EXPECTED_ARCH: x64/u);
  assert.match(workflow, /EVIDENCE_GITHUB_TOKEN: \$\{\{ github\.token \}\}/u);
  assert.doesNotMatch(workflow, /dtolnay\/rust-toolchain/u);
});

test("backup evidence input inventory is literal, complete, and closed", () => {
  assertCompleteBackupEvidenceInputInventory(BACKUP_EVIDENCE_INPUT_PATHS);

  for (const requiredPath of [
    "crates/local-storage/src/backup/mod.rs",
    "crates/local-storage/src/sqlcipher_fixture.rs",
  ]) {
    const omission = expectedBackupEvidenceInputPaths.filter((path) => path !== requiredPath);
    assert.throws(
      () => assertCompleteBackupEvidenceInputInventory(omission),
      assert.AssertionError,
      `omitting ${requiredPath} must fail the literal inventory assertion`,
    );
  }
});

test("accepts only the frozen unavailable backup report", () => {
  assert.equal(backupReportPassesPolicy(validBackupReport()), true);
});

test("rejects malformed, inherited, accessor, symbol, and non-enumerable data", () => {
  for (const value of [null, undefined, true, 0, "report", []]) {
    assert.equal(backupReportPassesPolicy(value), false);
  }

  for (const key of Object.keys(validBackupReport())) {
    const report = validBackupReport();
    delete report[key];
    assert.equal(backupReportPassesPolicy(report), false, key);
  }

  const inherited = Object.create(validBackupReport());
  assert.equal(backupReportPassesPolicy(inherited), false);

  assert.equal(backupReportPassesPolicy(Object.create(null)), false);

  const nestedNull = validBackupReport();
  nestedNull.resourceWork = null;
  assert.equal(backupReportPassesPolicy(nestedNull), false);

  const qualificationNull = validBackupReport();
  qualificationNull.signedNativeQualification = null;
  assert.equal(backupReportPassesPolicy(qualificationNull), false);

  const accessor = validBackupReport();
  let topLevelReads = 0;
  Object.defineProperty(accessor, "status", {
    enumerable: true,
    get: () => {
      topLevelReads += 1;
      return "unavailable";
    },
  });
  assert.equal(backupReportPassesPolicy(accessor), false);
  assert.equal(topLevelReads, 0);

  const nestedAccessor = validBackupReport();
  Object.defineProperty(nestedAccessor.resourceWork, "filesystem", {
    enumerable: true,
    get: () => false,
  });
  assert.equal(backupReportPassesPolicy(nestedAccessor), false);

  const indexedAccessor = validBackupReport();
  let reads = 0;
  Object.defineProperty(indexedAccessor.signedNativeQualification.platforms, "0", {
    enumerable: true,
    get: () => {
      reads += 1;
      return null;
    },
  });
  assert.equal(backupReportPassesPolicy(indexedAccessor), false);
  assert.equal(reads, 0);

  const symbol = validBackupReport();
  symbol[Symbol("foreign")] = null;
  assert.equal(backupReportPassesPolicy(symbol), false);

  const arraySymbol = validBackupReport();
  arraySymbol.signedNativeQualification.platforms[Symbol("foreign")] = null;
  assert.equal(backupReportPassesPolicy(arraySymbol), false);

  const hidden = validBackupReport();
  Object.defineProperty(hidden, "foreign", { value: null });
  assert.equal(backupReportPassesPolicy(hidden), false);

  const arrayHidden = validBackupReport();
  Object.defineProperty(arrayHidden.signedNativeQualification.platforms, "foreign", {
    value: null,
  });
  assert.equal(backupReportPassesPolicy(arrayHidden), false);

  const foreignArray = validBackupReport();
  foreignArray.signedNativeQualification.platforms = vm.runInNewContext("[]");
  assert.equal(backupReportPassesPolicy(foreignArray), false);
});

test("rejects every missing or foreign nested data boundary", () => {
  for (const key of Object.keys(validBackupReport().resourceWork)) {
    rejectMutation((report) => {
      delete report.resourceWork[key];
    }, key);
  }
  for (const key of Object.keys(validBackupReport().signedNativeQualification)) {
    rejectMutation((report) => {
      delete report.signedNativeQualification[key];
    }, key);
  }
  for (const key of Object.keys(validBackupReport().signedNativeQualification.platforms[0])) {
    rejectMutation((report) => {
      delete report.signedNativeQualification.platforms[0][key];
    }, key);
  }

  rejectMutation((report) => {
    report.foreign = null;
  });
  rejectMutation((report) => {
    report.resourceWork.foreign = false;
  });
  rejectMutation((report) => {
    report.signedNativeQualification.foreign = null;
  });
  rejectMutation((report) => {
    report.signedNativeQualification.platforms[0].foreign = null;
  });
});

test("rejects success, work, recovery, production, native, signed, and Gate promotion", () => {
  for (const [key, value] of [
    ["schemaVersion", 999],
    ["scope", "other"],
    ["status", "available"],
    ["reason", "other"],
    ["artifactExported", true],
    ["recoveryOpenAvailable", true],
    ["productionComposition", true],
    ["signedApplication", true],
    ["nativeEvidenceClaimed", true],
    ["closesGate", true],
  ]) {
    rejectMutation((report) => {
      report[key] = value;
    }, key);
  }

  rejectMutation((report) => {
    report.schemaVersion = "1";
  });

  for (const key of Object.keys(validBackupReport().resourceWork)) {
    for (const value of [true, null, "false"]) {
      rejectMutation((report) => {
        report.resourceWork[key] = value;
      }, `${key}:${String(value)}`);
    }
  }

  rejectMutation((report) => {
    report.status = "success";
  });
  rejectMutation((report) => {
    report.provenance = { source: "forged" };
  });
  rejectMutation((report) => {
    report.release = null;
  });
  rejectMutation((report) => {
    report.verified = false;
  });
  rejectMutation((report) => {
    report.slice = "retired-proof";
  });
});

test("rejects qualification row drift, duplicates, and claimed artifacts", () => {
  const mutations = [
    (report) => {
      report.signedNativeQualification.status = "qualified";
    },
    (report) => {
      report.signedNativeQualification.platforms.pop();
    },
    (report) => {
      report.signedNativeQualification.platforms.push({
        platform: "linux-x64",
        status: "pending",
        signedArtifact: null,
        report: null,
      });
    },
    (report) => {
      report.signedNativeQualification.platforms[1] = {
        ...report.signedNativeQualification.platforms[0],
      };
    },
    (report) => {
      report.signedNativeQualification.platforms.reverse();
    },
    (report) => {
      delete report.signedNativeQualification.platforms[1];
    },
    (report) => {
      report.signedNativeQualification.platforms[0].platform = "other";
    },
    (report) => {
      report.signedNativeQualification.platforms[0].status = "qualified";
    },
    (report) => {
      report.signedNativeQualification.platforms[0].signedArtifact = "forged";
    },
    (report) => {
      report.signedNativeQualification.platforms[0].report = {};
    },
    (report) => {
      report.signedNativeQualification.platforms[0].provenance = null;
    },
  ];

  for (const mutate of mutations) {
    rejectMutation(mutate);
  }
});

test("admission requires the closed normalized regular-file inventory", (t) => {
  const root = mkdtempSync(join(tmpdir(), "gooddealer-backup-inputs-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const path of BACKUP_EVIDENCE_INPUT_PATHS) {
    const destination = join(root, path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, "input\n");
  }
  assert.deepEqual(backupInputAdmissionErrors({ repositoryRoot: root }), []);

  const missingRoot = `${root}-missing`;
  mkdirSync(missingRoot, { recursive: true });
  t.after(() => rmSync(missingRoot, { recursive: true, force: true }));
  for (const path of BACKUP_EVIDENCE_INPUT_PATHS) {
    const destination = join(missingRoot, path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, "input\n");
  }
  rmSync(join(missingRoot, BACKUP_EVIDENCE_INPUT_PATHS[0]));
  assert.ok(backupInputAdmissionErrors({ repositoryRoot: missingRoot }).some((error) => error.includes("missing")));

  const symlinkRoot = `${root}-symlink`;
  mkdirSync(symlinkRoot, { recursive: true });
  t.after(() => rmSync(symlinkRoot, { recursive: true, force: true }));
  for (const path of BACKUP_EVIDENCE_INPUT_PATHS) {
    const destination = join(symlinkRoot, path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, "input\n");
  }
  rmSync(join(symlinkRoot, BACKUP_EVIDENCE_INPUT_PATHS[1]));
  symlinkSync("missing-target", join(symlinkRoot, BACKUP_EVIDENCE_INPUT_PATHS[1]));
  assert.ok(backupInputAdmissionErrors({ repositoryRoot: symlinkRoot }).some((error) => error.includes("regular")));

  const directoryRoot = `${root}-directory`;
  mkdirSync(directoryRoot, { recursive: true });
  t.after(() => rmSync(directoryRoot, { recursive: true, force: true }));
  for (const path of BACKUP_EVIDENCE_INPUT_PATHS) {
    const destination = join(directoryRoot, path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, "input\n");
  }
  rmSync(join(directoryRoot, BACKUP_EVIDENCE_INPUT_PATHS[2]));
  mkdirSync(join(directoryRoot, BACKUP_EVIDENCE_INPUT_PATHS[2]));
  assert.ok(backupInputAdmissionErrors({ repositoryRoot: directoryRoot }).some((error) => error.includes("regular")));
});

test("admission rejects absolute and parent-traversal input values", () => {
  const absolute = [...BACKUP_EVIDENCE_INPUT_PATHS];
  absolute[0] = "/tmp/foreign-input";
  assert.ok(backupInputAdmissionErrors({ inputPaths: absolute }).some((error) => error.includes("normalized")));

  const traversal = [...BACKUP_EVIDENCE_INPUT_PATHS];
  traversal[0] = "../foreign-input";
  assert.ok(backupInputAdmissionErrors({ inputPaths: traversal }).some((error) => error.includes("normalized")));
});

function assertCompleteBackupEvidenceInputInventory(inputPaths) {
  assert.deepEqual(inputPaths, expectedBackupEvidenceInputPaths);
}

function rejectMutation(mutate, message) {
  const report = validBackupReport();
  mutate(report);
  assert.equal(backupReportPassesPolicy(report), false, message);
}

function validBackupReport() {
  return {
    schemaVersion: 1,
    scope: "p0-25-backup-foundation",
    status: "unavailable",
    reason: "sealed Host backup admission and reviewed safe SQLite handle/VFS identity are not composed",
    artifactExported: false,
    recoveryOpenAvailable: false,
    resourceWork: {
      filesystem: false,
      database: false,
      transaction: false,
      crypto: false,
    },
    productionComposition: false,
    signedApplication: false,
    nativeEvidenceClaimed: false,
    closesGate: false,
    signedNativeQualification: {
      status: "pending",
      platforms: expectedPlatforms.map((platform) => ({
        platform,
        status: "pending",
        signedArtifact: null,
        report: null,
      })),
    },
  };
}
