import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { arch, platform, release } from "node:os";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const outputDirectory = resolve(root, ".artifacts/wp0");

function command(binary, args) {
  try {
    return execFileSync(binary, args, { cwd: root, encoding: "utf8" }).trim();
  } catch {
    return "unavailable";
  }
}

const evidence = {
  schemaVersion: 1,
  commit: command("git", ["rev-parse", "HEAD"]),
  generatedAt: new Date().toISOString(),
  os: { platform: platform(), release: release(), arch: arch() },
  tools: {
    node: process.version,
    pnpm: command("pnpm", ["--version"]),
    rustc: command("rustc", ["--version"]),
    cargo: command("cargo", ["--version"]),
  },
};

mkdirSync(outputDirectory, { recursive: true });
writeFileSync(resolve(outputDirectory, "environment.json"), `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify(evidence, null, 2));
