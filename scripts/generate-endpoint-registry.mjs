import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const connectorsRoot = resolve(root, "packages/connectors");
const manifestSchema = resolve(root, "packages/connector-sdk/endpoint-manifest.schema.json");
const generatedTs = resolve(root, "packages/connector-sdk/src/generated/endpoint-registry.ts");
const generatedRust = resolve(root, "crates/secure-host-core/src/generated/endpoint_registry.rs");

const methods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const injections = new Set(["bearer_header", "api_key_headers", "query_token"]);
const retrySafety = new Set(["safe", "provider_idempotency_key", "confirm_before_retry", "never"]);
const extractors = new Set(["public_json", "host_owned"]);
const endpointKeys = new Set([
  "credentialInjection",
  "credentialNamespace",
  "endpointId",
  "maxResponseBytes",
  "method",
  "origin",
  "pathParameters",
  "pathTemplate",
  "redirectPolicy",
  "redactHeaders",
  "redactJsonPointers",
  "responseExtractor",
  "retrySafety",
  "timeoutMs",
]);

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function exactKeys(value, keys, context) {
  invariant(value && typeof value === "object" && !Array.isArray(value), `${context}: expected object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  invariant(JSON.stringify(actual) === JSON.stringify(expected), `${context}: fields must be exactly ${expected.join(", ")}`);
}

export function validateEndpointManifest(manifest, expectedProvider) {
  exactKeys(manifest, new Set(["schemaVersion", "provider", "endpoints"]), expectedProvider);
  invariant(manifest.schemaVersion === 1, `${expectedProvider}: unsupported schemaVersion`);
  invariant(manifest.provider === expectedProvider, `${expectedProvider}: provider mismatch`);
  invariant(/^[a-z][a-z0-9-]*$/.test(manifest.provider), `${expectedProvider}: invalid provider`);
  invariant(Array.isArray(manifest.endpoints), `${expectedProvider}: endpoints must be an array`);

  const ids = new Set();
  for (const endpoint of manifest.endpoints) {
    const context = `${expectedProvider}/${String(endpoint?.endpointId ?? "unknown")}`;
    exactKeys(endpoint, endpointKeys, context);
    invariant(
      new RegExp(`^${expectedProvider.replaceAll("-", "\\-")}\\.[a-z][a-z0-9.-]*$`).test(endpoint.endpointId),
      `${context}: endpointId must be provider-prefixed`,
    );
    invariant(!ids.has(endpoint.endpointId), `${context}: duplicate endpointId`);
    ids.add(endpoint.endpointId);
    invariant(methods.has(endpoint.method), `${context}: invalid method`);

    const origin = new URL(endpoint.origin);
    invariant(origin.protocol === "https:", `${context}: origin must use https`);
    invariant(endpoint.origin === origin.origin, `${context}: origin must be canonical and contain no path`);
    invariant(origin.username === "" && origin.password === "", `${context}: userinfo is forbidden`);
    invariant(origin.port === "", `${context}: custom port is forbidden`);
    invariant(origin.pathname === "/" && origin.search === "" && origin.hash === "", `${context}: origin cannot contain path/query/fragment`);
    invariant(origin.hostname === origin.hostname.toLowerCase(), `${context}: hostname must be lowercase`);
    invariant(!/^\d+(?:\.\d+){3}$/.test(origin.hostname) && !origin.hostname.includes(":"), `${context}: literal IP origin is forbidden`);

    invariant(typeof endpoint.pathTemplate === "string" && endpoint.pathTemplate.startsWith("/"), `${context}: pathTemplate must be absolute-path relative`);
    invariant(!endpoint.pathTemplate.includes(".."), `${context}: path traversal is forbidden`);
    invariant(!/[?%#\\]/.test(endpoint.pathTemplate), `${context}: path controls are forbidden`);
    invariant(!/%(?:2f|2e|5c)/i.test(endpoint.pathTemplate), `${context}: encoded path controls are forbidden`);
    invariant(Array.isArray(endpoint.pathParameters), `${context}: pathParameters must be an array`);
    invariant(new Set(endpoint.pathParameters).size === endpoint.pathParameters.length, `${context}: duplicate path parameter`);
    for (const parameter of endpoint.pathParameters) {
      invariant(/^[A-Za-z][A-Za-z0-9]*$/.test(parameter), `${context}: invalid path parameter`);
      invariant(endpoint.pathTemplate.includes(`{${parameter}}`), `${context}: unused path parameter ${parameter}`);
    }
    const placeholders = [...endpoint.pathTemplate.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]).sort();
    invariant(JSON.stringify(placeholders) === JSON.stringify([...endpoint.pathParameters].sort()), `${context}: placeholder mismatch`);

    invariant(endpoint.credentialNamespace === "provider_api", `${context}: invalid credential namespace`);
    invariant(injections.has(endpoint.credentialInjection), `${context}: invalid credential injection`);
    invariant(endpoint.redirectPolicy === "deny", `${context}: redirects must be denied in Phase 0`);
    invariant(Number.isInteger(endpoint.timeoutMs) && endpoint.timeoutMs >= 100 && endpoint.timeoutMs <= 30000, `${context}: timeout out of bounds`);
    invariant(Number.isInteger(endpoint.maxResponseBytes) && endpoint.maxResponseBytes >= 1 && endpoint.maxResponseBytes <= 4 * 1024 * 1024, `${context}: response limit out of bounds`);
    invariant(retrySafety.has(endpoint.retrySafety), `${context}: invalid retry safety`);
    invariant(extractors.has(endpoint.responseExtractor), `${context}: invalid response extractor`);
    invariant(Array.isArray(endpoint.redactHeaders) && new Set(endpoint.redactHeaders).size === endpoint.redactHeaders.length, `${context}: invalid redacted headers`);
    invariant(endpoint.redactHeaders.every((header) => /^[A-Za-z0-9-]+$/.test(header)), `${context}: invalid redacted header name`);
    invariant(Array.isArray(endpoint.redactJsonPointers) && new Set(endpoint.redactJsonPointers).size === endpoint.redactJsonPointers.length, `${context}: invalid redacted JSON pointers`);
    invariant(endpoint.redactJsonPointers.every((pointer) => pointer.startsWith("/") && !/[\r\n]/.test(pointer)), `${context}: invalid redacted JSON pointer`);
  }
  return manifest;
}

function readManifests() {
  return readdirSync(connectorsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((provider) => {
      const path = resolve(connectorsRoot, provider, "endpoint-manifest.json");
      return validateEndpointManifest(JSON.parse(readFileSync(path, "utf8")), provider);
    });
}

function canonicalRegistry(manifests) {
  return manifests.flatMap((manifest) => manifest.endpoints).sort((left, right) => left.endpointId.localeCompare(right.endpointId));
}

export function renderTs(registry, hash) {
  const ids = registry.length === 0 ? "never" : registry.map((endpoint) => JSON.stringify(endpoint.endpointId)).join(" | ");
  const requests = registry.length === 0
    ? "never"
    : registry.map((endpoint) => {
      const path = endpoint.pathParameters.length === 0
        ? "Record<string, never>"
        : `{ ${endpoint.pathParameters.map((parameter) => `${JSON.stringify(parameter)}: string`).join("; ")} }`;
      return `{ providerConnectionId: string; endpointId: ${JSON.stringify(endpoint.endpointId)}; path: ${path}; idempotencyKey: string }`;
    }).join("\n  | ");
  return `// Generated by scripts/generate-endpoint-registry.mjs. Do not edit.\n\nexport const ENDPOINT_MANIFEST_SCHEMA_VERSION = 1 as const;\nexport const ENDPOINT_MANIFEST_SHA256 = ${JSON.stringify(hash)} as const;\nexport type EndpointId = ${ids};\nexport type EndpointRequest = ${requests};\nexport const endpointRegistry = ${JSON.stringify(registry, null, 2)} as const;\n`;
}

function rustString(value) {
  return JSON.stringify(value);
}

export function renderRust(registry, hash) {
  const rustVariant = (value) => value.split("_").map((part) => `${part[0].toUpperCase()}${part.slice(1)}`).join("");
  const entries = registry
    .map((endpoint) => `    EndpointCapability {\n        endpoint_id: ${rustString(endpoint.endpointId)},\n        provider: ${rustString(endpoint.endpointId.split(".")[0])},\n        method: HttpMethod::${endpoint.method[0]}${endpoint.method.slice(1).toLowerCase()},\n        origin: ${rustString(endpoint.origin)},\n        path_template: ${rustString(endpoint.pathTemplate)},\n        path_parameters: &[${endpoint.pathParameters.map(rustString).join(", ")}],\n        credential_namespace: CredentialNamespace::ProviderApi,\n        credential_injection: CredentialInjection::${rustVariant(endpoint.credentialInjection)},\n        redirect_policy: RedirectPolicy::Deny,\n        retry_safety: RetrySafety::${rustVariant(endpoint.retrySafety)},\n        response_extractor: ResponseExtractor::${rustVariant(endpoint.responseExtractor)},\n        redact_headers: &[${endpoint.redactHeaders.map(rustString).join(", ")}],\n        redact_json_pointers: &[${endpoint.redactJsonPointers.map(rustString).join(", ")}],\n        timeout_ms: ${endpoint.timeoutMs},\n        max_response_bytes: ${endpoint.maxResponseBytes},\n    },`)
    .join("\n");
  const imports = registry.length === 0
    ? "use crate::endpoint_capability::EndpointCapability;"
    : "use crate::endpoint_capability::{\n    CredentialInjection, CredentialNamespace, EndpointCapability, HttpMethod, RedirectPolicy,\n    ResponseExtractor, RetrySafety,\n};";
  const registryValue = entries === "" ? "&[]" : `&[\n${entries}\n]`;
  return `// Generated by scripts/generate-endpoint-registry.mjs. Do not edit.\n\n${imports}\n\npub const ENDPOINT_MANIFEST_SHA256: &str =\n    ${rustString(hash)};\npub const ENDPOINT_CAPABILITIES: &[EndpointCapability] = ${registryValue};\n`;
}

function writeOrCheck(path, content, check) {
  if (check) {
    invariant(readFileSync(path, "utf8") === content, `${relative(root, path)} is stale; run pnpm generate:secure-host`);
  } else {
    writeFileSync(path, content);
  }
}

export function generateEndpointRegistry({ check = false } = {}) {
  const manifests = readManifests();
  const registry = canonicalRegistry(manifests);
  const canonical = JSON.stringify({
    schema: JSON.parse(readFileSync(manifestSchema, "utf8")),
    manifests,
  });
  const hash = createHash("sha256").update(canonical).digest("hex");
  writeOrCheck(generatedTs, renderTs(registry, hash), check);
  writeOrCheck(generatedRust, renderRust(registry, hash), check);
  return { endpointCount: registry.length, hash };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const result = generateEndpointRegistry({ check: process.argv.includes("--check") });
  console.log(`endpoint registry ${process.argv.includes("--check") ? "verified" : "generated"} (${result.endpointCount} endpoints, ${result.hash})`);
}
