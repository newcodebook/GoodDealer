#!/usr/bin/env node
// Records a frozen-candidate snapshot: one clean commit checked by root `pnpm check` under both
// umask 002 (common desktop default) and 022 (CI default). The record is local implementation
// evidence for that exact commit only; it never claims V1 acceptance, deployment or a Gate.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { repositoryMaterialDirty } from "./git-dirty-state.mjs";

export const candidateUmasks = Object.freeze(["002", "022"]);

/** Builds the committed record; rejects anything that would make the snapshot unattributable. */
export function candidateRecord({ commit, dirty, toolchain, runs, recordedAt }) {
  if (typeof commit !== "string" || !/^[0-9a-f]{40}$/u.test(commit)) {
    throw new TypeError("candidate commit must be a full lowercase SHA-1");
  }
  if (dirty !== false) throw new Error("candidate snapshots require a clean working tree");
  if (!Array.isArray(runs) || runs.map((run) => run.umask).join(",") !== candidateUmasks.join(",")) {
    throw new Error("candidate snapshots require one run per admitted umask, in order");
  }
  for (const run of runs) {
    if (!Number.isInteger(run.exitCode) || !/^[0-9a-f]{64}$/u.test(run.outputSha256)) {
      throw new TypeError("candidate runs require an integer exit code and an output digest");
    }
  }
  return {
    kind: "gooddealer-v1-candidate",
    claim: "local-implementation-evidence",
    closesGate: false,
    commit,
    recordedAt,
    command: "pnpm check",
    toolchain,
    runs: runs.map(({ umask, exitCode, durationSeconds, outputSha256 }) => ({
      umask,
      exitCode,
      durationSeconds,
      outputSha256,
    })),
    passed: runs.every((run) => run.exitCode === 0),
  };
}

function capture(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed`);
  return result.stdout.trim();
}

function runCheck(umask, logPath) {
  return new Promise((resolve) => {
    const started = Date.now();
    const chunks = [];
    // `umask` is a shell builtin; `exec` keeps the check as the only child of that shell.
    const child = spawn("sh", ["-c", `umask ${umask} && exec pnpm check`], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    for (const stream of [child.stdout, child.stderr]) {
      stream.on("data", (chunk) => {
        chunks.push(chunk);
        process.stderr.write(chunk);
      });
    }
    child.on("close", (code) => {
      const output = Buffer.concat(chunks);
      writeFileSync(logPath, output);
      resolve({
        umask,
        exitCode: code ?? 1,
        durationSeconds: Math.round((Date.now() - started) / 1000),
        outputSha256: createHash("sha256").update(output).digest("hex"),
      });
    });
  });
}

function workingTreeDirty() {
  return repositoryMaterialDirty({
    stagedDiff: capture("git", ["diff", "--cached", "--name-only"]),
    unstagedDiff: capture("git", ["diff", "--name-only"]),
    untrackedPaths: capture("git", ["ls-files", "--others", "--exclude-standard"]),
  });
}

async function main() {
  const outIndex = process.argv.indexOf("--out");
  const out = outIndex === -1 ? null : process.argv[outIndex + 1];
  const commit = capture("git", ["rev-parse", "HEAD"]);
  if (workingTreeDirty() !== false) throw new Error("candidate snapshots require a clean working tree");
  const toolchain = {
    node: process.version,
    pnpm: capture("pnpm", ["--version"]),
    rustc: capture("rustc", ["--version"]),
    cargo: capture("cargo", ["--version"]),
    platform: `${process.platform}-${process.arch}`,
  };
  const logDirectory = mkdtempSync(join(tmpdir(), "gooddealer-candidate-"));
  const runs = [];
  for (const umask of candidateUmasks) {
    runs.push(await runCheck(umask, join(logDirectory, `pnpm-check-umask-${umask}.log`)));
  }
  // The checks must not have moved HEAD or touched tracked/untracked material, or the record would
  // attribute their output to a commit that was not what actually ran.
  const dirty = capture("git", ["rev-parse", "HEAD"]) === commit ? workingTreeDirty() : true;
  const record = candidateRecord({ commit, dirty, toolchain, runs, recordedAt: new Date().toISOString() });
  const text = `${JSON.stringify(record, null, 2)}\n`;
  if (out === null) process.stdout.write(text);
  else writeFileSync(out, text);
  process.stderr.write(`candidate logs: ${logDirectory}\n`);
  process.exitCode = record.passed ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
