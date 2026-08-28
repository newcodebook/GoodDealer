import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  ReleaseIdentityPolicyError,
  collectFutureReleaseIdentity,
  validateReleaseRequest,
} from "./release-identity-policy.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");

function approvedRequest() {
  return {
    schemaVersion: 1,
    state: "approved",
    version: "8.7.6",
    channel: "validation",
    productApproval: { kind: "product-owner-decision", decisionRef: "release-decision-validation" },
    target: { platform: "validation-platform", architecture: "validation-architecture" },
    artifactRoot: ".artifacts/release-artifacts",
    artifacts: [{ path: "bundle/application.bin" }],
  };
}

test("release command boundary rejects shell metacharacters in artifact paths before process execution", (t) => {
  const sentinel = join(tmpdir(), `gooddealer-release-artifact-sentinel-${process.pid}-${Date.now()}`);
  t.after(() => rmSync(sentinel, { force: true }));
  for (const value of [
    ".artifacts/release;touch-unreachable",
    ".artifacts/release|touch-unreachable",
    `.artifacts/release$(touch ${sentinel})`,
    ".artifacts/release`touch-unreachable`",
    ".artifacts/release&touch-unreachable",
  ]) {
    const request = approvedRequest();
    request.artifactRoot = value;
    assert.throws(
      () => validateReleaseRequest(request),
      (error) => error instanceof ReleaseIdentityPolicyError,
      value,
    );
    assert.equal(existsSync(sentinel), false, `${value} unexpectedly created a sentinel`);
  }
});

test("release policy keeps Git on a fixed executable with separated arguments and no shell fallback", () => {
  const policy = readFileSync(join(repositoryRoot, "release/release-identity-policy.mjs"), "utf8");
  assert.match(policy, /spawnSync\("git", \["-C", repositoryRoot, \.\.\.args\], \{/u);
  assert.doesNotMatch(policy, /\b(?:execSync|execFile|execFileSync)\s*\(/u);
  assert.doesNotMatch(policy, /(?<!\.)\bexec\s*\(/u);
  assert.doesNotMatch(
    policy,
    /import\s*\{[^}]*\b(?:exec|execSync|execFile|execFileSync)\b[^}]*\}\s*from\s*["']node:child_process["']/u,
  );
  assert.doesNotMatch(policy, /\bshell\s*:/u);
});

test("Git inspection of a repository path containing shell metacharacters cannot create a sentinel", (t) => {
  const sentinelName = `gooddealer-release-git-sentinel-${process.pid}-${Date.now()}`;
  const root = join(tmpdir(), `gooddealer-release-git-boundary-${process.pid};touch ${sentinelName} #`);
  const localSentinel = join(root, sentinelName);
  const workingDirectorySentinel = join(process.cwd(), sentinelName);
  t.after(() => {
    rmSync(workingDirectorySentinel, { force: true });
    rmSync(root, { recursive: true, force: true });
  });

  mkdirSync(join(root, "release"), { recursive: true });
  writeFileSync(
    join(root, "release/release-request.json"),
    `${JSON.stringify(approvedRequest())}\n`,
    "utf8",
  );
  const initialized = spawnSync("git", ["init", "--quiet", root], { encoding: "utf8" });
  assert.equal(initialized.status, 0, initialized.stderr);

  assert.throws(
    () => collectFutureReleaseIdentity({ repositoryRoot: root }),
    (error) => error instanceof ReleaseIdentityPolicyError,
    "the intentionally incomplete fixture must fail through policy validation, after safe Git inspection",
  );
  assert.equal(existsSync(localSentinel), false, "Git inspection expanded a metacharacter repository path");
  assert.equal(existsSync(workingDirectorySentinel), false, "Git inspection expanded into the process working directory");
});
