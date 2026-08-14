import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { describe, expect, expectTypeOf, it, vi } from "vitest";

import {
  createJobsComposition,
  periodicJobs,
} from "../../src/entrypoints/jobs";
import {
  DenyingPeriodicScheduler,
  type JobSchedulerPort,
} from "../../src/entrypoints/ports/job-scheduler";

interface Token {
  readonly kind: "identifier" | "string" | "punctuation";
  readonly value: string;
}

function isIdentifierCharacter(code: number): boolean {
  return (code >= 48 && code <= 57)
    || (code >= 65 && code <= 90)
    || (code >= 97 && code <= 122)
    || code === 36
    || code === 95;
}

/** Small lexical scanner: comments and string escapes cannot create fake imports. */
function tokens(source: string): readonly Token[] {
  const result: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const character = source[index];
    const next = source[index + 1];
    if (character === "/" && next === "/") {
      index += 2;
      while (index < source.length && source[index] !== "\n") index += 1;
      continue;
    }
    if (character === "/" && next === "*") {
      index += 2;
      while (index + 1 < source.length && !(source[index] === "*" && source[index + 1] === "/")) index += 1;
      index += 2;
      continue;
    }
    if (character === "\"" || character === "'") {
      const quote = character;
      let value = "";
      index += 1;
      while (index < source.length && source[index] !== quote) {
        if (source[index] === "\\" && index + 1 < source.length) {
          index += 1;
        }
        value += source[index] ?? "";
        index += 1;
      }
      index += 1;
      result.push({ kind: "string", value });
      continue;
    }
    const code = source.charCodeAt(index);
    if (isIdentifierCharacter(code) && !(code >= 48 && code <= 57)) {
      let value = character ?? "";
      index += 1;
      while (index < source.length && isIdentifierCharacter(source.charCodeAt(index))) {
        value += source[index] ?? "";
        index += 1;
      }
      result.push({ kind: "identifier", value });
      continue;
    }
    if (character !== undefined && !" \t\r\n".includes(character)) {
      result.push({ kind: "punctuation", value: character });
    }
    index += 1;
  }
  return result;
}

function importSpecifiers(file: string): readonly string[] {
  const sourceTokens = tokens(readFileSync(file, "utf8"));
  const specifiers: string[] = [];
  for (let index = 0; index < sourceTokens.length; index += 1) {
    const token = sourceTokens[index];
    if (token?.kind !== "identifier" || (token.value !== "import" && token.value !== "export")) {
      continue;
    }
    let sawFrom = false;
    for (let cursor = index + 1; cursor < sourceTokens.length; cursor += 1) {
      const candidate = sourceTokens[cursor];
      if (candidate?.kind === "identifier" && candidate.value === "from") {
        sawFrom = true;
        continue;
      }
      const isSideEffectImport = token.value === "import" && cursor === index + 1;
      const isDynamicImport = token.value === "import"
        && sourceTokens[index + 1]?.value === "("
        && cursor === index + 2;
      if (candidate?.kind === "string" && (sawFrom || isSideEffectImport || isDynamicImport)) {
        specifiers.push(candidate.value);
        index = cursor;
        break;
      }
      if (candidate?.value === ";") {
        break;
      }
    }
  }
  return specifiers;
}

function resolveSource(fromFile: string, specifier: string): string | null {
  if (specifier.startsWith(".")) {
    const base = resolve(dirname(fromFile), specifier);
    for (const candidate of [base, `${base}.ts`, resolve(base, "index.ts")]) {
      if (existsSync(candidate)) {
        return candidate;
      }
    }
    throw new Error(`cannot resolve ${specifier} from ${fromFile}`);
  }
  if (specifier.startsWith("@gooddealer/")) {
    return createRequire(fromFile).resolve(specifier);
  }
  return null;
}

function transitiveImportGraph(entry: string): readonly { readonly file: string; readonly specifier: string }[] {
  const edges: { file: string; specifier: string }[] = [];
  const visited = new Set<string>();
  const visit = (file: string): void => {
    if (visited.has(file)) {
      return;
    }
    visited.add(file);
    for (const specifier of importSpecifiers(file)) {
      edges.push({ file, specifier });
      const target = resolveSource(file, specifier);
      if (target !== null && target.endsWith(".ts")) {
        visit(target);
      }
    }
  };
  visit(entry);
  return edges;
}

describe("framework-independent Jobs composition", () => {
  it("keeps the periodic registry empty and never calls the scheduler", async () => {
    const schedulePeriodic = vi.fn<JobSchedulerPort["schedulePeriodic"]>();
    const composition = createJobsComposition({
      ports: [],
      tenants: { create: (tenantId) => ({ tenantId }) },
      scheduler: { schedulePeriodic },
      now: () => new Date(),
    });
    await composition.start();
    await composition.stop();
    expectTypeOf(periodicJobs).toEqualTypeOf<readonly []>();
    expect(periodicJobs).toEqual([]);
    expect(composition).toMatchObject({
      transport: "framework-independent",
      periodicJobsRegistered: false,
    });
    expect(schedulePeriodic).not.toHaveBeenCalled();
  });

  it("uses a scheduler implementation whose result can only deny", async () => {
    await expect(new DenyingPeriodicScheduler().schedulePeriodic({
      jobName: "boundary-test",
      cron: "0 * * * *",
      targetModule: "none",
      payloadVersion: 1,
    })).resolves.toEqual({
      scheduled: false,
      reason: "periodic_jobs_not_registered",
    });
  });

  it("walks the real transitive import graph and reaches no HTTP framework", () => {
    const entry = resolve(import.meta.dirname, "../../src/entrypoints/jobs.ts");
    const edges = transitiveImportGraph(entry);
    expect(edges.length).toBeGreaterThan(0);
    expect(edges.some(({ specifier }) => specifier === "fastify" || specifier === "node:http")).toBe(false);
    expect(edges.some(({ file }) => file.includes("/entrypoints/adapter/") || file.includes("/entrypoints/routes/"))).toBe(false);
  });
});
