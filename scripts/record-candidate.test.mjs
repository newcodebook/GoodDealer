import assert from "node:assert/strict";
import test from "node:test";

import { candidateRecord } from "./record-candidate.mjs";

const digest = "a".repeat(64);
const base = {
  commit: "0123456789abcdef0123456789abcdef01234567",
  dirty: false,
  toolchain: { node: "v26.12.1" },
  recordedAt: "2026-11-03T00:00:00.000Z",
  runs: [
    { umask: "002", exitCode: 0, durationSeconds: 1, outputSha256: digest },
    { umask: "022", exitCode: 0, durationSeconds: 1, outputSha256: digest },
  ],
};

test("a candidate record is local evidence for one exact commit and never closes a gate", () => {
  const record = candidateRecord(base);
  assert.equal(record.claim, "local-implementation-evidence");
  assert.equal(record.closesGate, false);
  assert.equal(record.passed, true);
  assert.deepEqual(record.runs.map((run) => run.umask), ["002", "022"]);
});

test("a failing umask run makes the whole candidate fail", () => {
  const runs = [base.runs[0], { ...base.runs[1], exitCode: 1 }];
  assert.equal(candidateRecord({ ...base, runs }).passed, false);
});

test("unattributable or partial candidates are rejected", () => {
  assert.throws(() => candidateRecord({ ...base, dirty: true }));
  assert.throws(() => candidateRecord({ ...base, dirty: null }));
  assert.throws(() => candidateRecord({ ...base, commit: "HEAD" }));
  assert.throws(() => candidateRecord({ ...base, runs: [base.runs[0]] }));
  assert.throws(() => candidateRecord({ ...base, runs: [base.runs[1], base.runs[0]] }));
  assert.throws(() => candidateRecord({ ...base, runs: [base.runs[0], { ...base.runs[1], outputSha256: "x" }] }));
});
