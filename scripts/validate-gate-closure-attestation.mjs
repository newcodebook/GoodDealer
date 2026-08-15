import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { validateGateClosureAttestation } from "./gate-closure-policy.mjs";

const argumentsAfterSeparator = process.argv.slice(2);
if (argumentsAfterSeparator[0] === "--") argumentsAfterSeparator.shift();
const [inputPath, ...extraArguments] = argumentsAfterSeparator;
if (inputPath === undefined || extraArguments.length > 0) {
  console.error("Usage: pnpm gate:validate -- <r0-11-attestation.json>");
  process.exit(2);
}

let value;
try {
  value = JSON.parse(readFileSync(resolve(inputPath), "utf8"));
} catch (error) {
  console.error(`Cannot read GateClosureAttestation: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}

const result = validateGateClosureAttestation(value);
console.log(JSON.stringify(result, null, 2));
if (!result.valid) process.exitCode = 1;
