import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";

const root = resolve(import.meta.dirname, "..");
const connectorsRoot = resolve(root, "packages/connectors");
const manifestSchema = resolve(root, "packages/connector-sdk/endpoint-manifest.schema.json");
const fixtureManifest = resolve(root, "packages/connector-sdk/fixtures/endpoint-manifest.fixture.json");
const generatedTs = resolve(root, "packages/connector-sdk/src/generated/endpoint-registry.ts");
const generatedRust = resolve(root, "crates/secure-host-core/src/generated/endpoint_registry.rs");
const generatedFixtureRust = resolve(root, "crates/secure-host-core/src/generated/fixture_endpoint_registry.rs");

const methods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const retrySafety = new Set(["safe", "provider_idempotency_key", "confirm_before_retry", "never"]);
const extractors = new Set(["public_json", "host_owned"]);
const valueTypes = new Set(["string", "integer", "boolean"]);
const valueEncodings = new Set(["raw", "bearer"]);
const secretKinds = new Set(["api_token"]);
const manifestKeys = new Set(["credentialProfiles", "endpoints", "provider", "schemaVersion"]);
const profileKeys = new Set(["credentialNamespace", "profileId", "slots", "version"]);
const slotKeys = new Set(["secretKind", "slotId"]);
const injectionKeys = new Set(["slotId", "target", "valueEncoding", "wireName"]);
const idempotencyInjectionKeys = new Set(["target", "wireName"]);
const publicFieldKeys = new Set(["allowedValues", "fieldId", "maxLength", "required", "valueType", "wireName"]);
const bodySchemaKeys = new Set(["encoding", "fields"]);
const endpointKeys = new Set([
  "bodySchema",
  "credentialInjections",
  "credentialProfileId",
  "credentialProfileVersion",
  "endpointId",
  "idempotencyInjection",
  "maxBodyBytes",
  "maxQueryBytes",
  "maxResponseBytes",
  "method",
  "origin",
  "pathParameters",
  "pathTemplate",
  "queryParameters",
  "redirectPolicy",
  "redactHeaders",
  "redactJsonPointers",
  "responseExtractor",
  "publicResponseSchema",
  "retrySafety",
  "timeoutMs",
]);
const providerIdPattern = /^[a-z][a-z0-9-]*$/;
const fieldIdPattern = /^[a-z][A-Za-z0-9]*$/;
const fieldWireNamePattern = /^[A-Za-z][A-Za-z0-9_-]*$/;
const headerTokenPattern = /^[a-z0-9!#$%&'*+.^_`|~-]+$/;
const reservedCredentialHeaders = new Set([
  "connection",
  "content-length",
  "content-type",
  "cookie",
  "host",
  "http2-settings",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "set-cookie",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);
const manifestSchemaDocument = JSON.parse(readFileSync(manifestSchema, "utf8"));
const validateManifestSchema = new Ajv2020({
  allErrors: true,
  strict: true,
  validateFormats: false,
}).compile(manifestSchemaDocument);

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function exactKeys(value, keys, context) {
  invariant(value && typeof value === "object" && !Array.isArray(value), `${context}: expected object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  invariant(JSON.stringify(actual) === JSON.stringify(expected), `${context}: fields must be exactly ${expected.join(", ")}`);
}

function validatePublicFields(fields, context) {
  invariant(Array.isArray(fields), `${context}: fields must be an array`);
  const fieldIds = new Set();
  const wireNames = new Set();
  for (const field of fields) {
    const fieldContext = `${context}/${String(field?.fieldId ?? "unknown")}`;
    exactKeys(field, publicFieldKeys, fieldContext);
    invariant(typeof field.fieldId === "string" && fieldIdPattern.test(field.fieldId), `${fieldContext}: invalid fieldId`);
    invariant(!fieldIds.has(field.fieldId), `${fieldContext}: duplicate fieldId`);
    fieldIds.add(field.fieldId);
    invariant(
      typeof field.wireName === "string" && !/[\r\n]/.test(field.wireName) && fieldWireNamePattern.test(field.wireName),
      `${fieldContext}: invalid wireName`,
    );
    invariant(!wireNames.has(field.wireName), `${fieldContext}: duplicate wireName`);
    wireNames.add(field.wireName);
    invariant(valueTypes.has(field.valueType), `${fieldContext}: invalid valueType`);
    invariant(typeof field.required === "boolean", `${fieldContext}: required must be boolean`);
    invariant(
      field.maxLength === null || (Number.isInteger(field.maxLength) && field.maxLength > 0 && field.maxLength <= 0xffff_ffff),
      `${fieldContext}: maxLength must be null or a positive u32 integer`,
    );
    invariant(Array.isArray(field.allowedValues), `${fieldContext}: allowedValues must be an array`);
    invariant(field.allowedValues.every((value) => typeof value === "string"), `${fieldContext}: allowedValues must contain strings`);
    invariant(new Set(field.allowedValues).size === field.allowedValues.length, `${fieldContext}: duplicate allowedValues`);
    if (field.valueType === "string") {
      invariant(
        field.maxLength !== null && field.maxLength <= 1_048_576,
        `${fieldContext}: string fields require a finite maxLength of at most 1048576 UTF-8 bytes`,
      );
      invariant(
        field.maxLength === null || field.allowedValues.every((value) => Buffer.byteLength(value, "utf8") <= field.maxLength),
        `${fieldContext}: allowedValues must respect maxLength`,
      );
    } else {
      invariant(field.maxLength === null, `${fieldContext}: maxLength only applies to string fields`);
      invariant(field.allowedValues.length === 0, `${fieldContext}: allowedValues only apply to string fields`);
    }
  }
}

export function validateEndpointManifest(manifest, expectedProvider) {
  invariant(
    validateManifestSchema(manifest),
    `${expectedProvider}: JSON Schema rejected Manifest: ${JSON.stringify(validateManifestSchema.errors)}`,
  );
  exactKeys(manifest, manifestKeys, expectedProvider);
  invariant(manifest.schemaVersion === 1, `${expectedProvider}: unsupported schemaVersion`);
  invariant(manifest.provider === expectedProvider, `${expectedProvider}: provider mismatch`);
  invariant(providerIdPattern.test(manifest.provider), `${expectedProvider}: invalid provider`);
  invariant(Array.isArray(manifest.credentialProfiles), `${expectedProvider}: credentialProfiles must be an array`);
  invariant(Array.isArray(manifest.endpoints), `${expectedProvider}: endpoints must be an array`);

  const profiles = new Map();
  for (const profile of manifest.credentialProfiles) {
    const context = `${expectedProvider}/profile/${String(profile?.profileId ?? "unknown")}@${String(profile?.version ?? "unknown")}`;
    exactKeys(profile, profileKeys, context);
    invariant(typeof profile.profileId === "string" && providerIdPattern.test(profile.profileId), `${context}: invalid profileId`);
    invariant(Number.isInteger(profile.version) && profile.version > 0 && profile.version <= 0xffff_ffff, `${context}: version must be a positive u32 integer`);
    invariant(profile.credentialNamespace === "provider_api", `${context}: invalid credentialNamespace`);
    invariant(Array.isArray(profile.slots) && profile.slots.length > 0, `${context}: slots must be a non-empty array`);
    const profileKey = `${profile.profileId}@${profile.version}`;
    invariant(!profiles.has(profileKey), `${context}: duplicate profile ID and version`);
    const slotIds = new Set();
    for (const slot of profile.slots) {
      const slotContext = `${context}/slot/${String(slot?.slotId ?? "unknown")}`;
      exactKeys(slot, slotKeys, slotContext);
      invariant(typeof slot.slotId === "string" && providerIdPattern.test(slot.slotId), `${slotContext}: invalid slotId`);
      invariant(!slotIds.has(slot.slotId), `${slotContext}: duplicate slotId`);
      slotIds.add(slot.slotId);
      invariant(secretKinds.has(slot.secretKind), `${slotContext}: invalid secretKind`);
    }
    profiles.set(profileKey, { profile, slotIds });
  }

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

    let origin;
    try {
      origin = new URL(endpoint.origin);
    } catch {
      throw new Error(`${context}: invalid origin`);
    }
    invariant(origin.protocol === "https:", `${context}: origin must use https`);
    invariant(endpoint.origin === origin.origin, `${context}: origin must be canonical and contain no path`);
    invariant(origin.username === "" && origin.password === "", `${context}: userinfo is forbidden`);
    invariant(origin.port === "", `${context}: custom port is forbidden`);
    invariant(origin.pathname === "/" && origin.search === "" && origin.hash === "", `${context}: origin cannot contain path/query/fragment`);
    invariant(origin.hostname === origin.hostname.toLowerCase(), `${context}: hostname must be lowercase`);
    invariant(!/^\d+(?:\.\d+){3}$/.test(origin.hostname) && !origin.hostname.includes(":"), `${context}: literal IP origin is forbidden`);

    invariant(typeof endpoint.pathTemplate === "string" && endpoint.pathTemplate.startsWith("/"), `${context}: pathTemplate must be absolute-path relative`);
    invariant(!/[\r\n]/.test(endpoint.pathTemplate), `${context}: pathTemplate cannot contain CRLF`);
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

    invariant(typeof endpoint.credentialProfileId === "string" && providerIdPattern.test(endpoint.credentialProfileId), `${context}: invalid credentialProfileId`);
    invariant(
      Number.isInteger(endpoint.credentialProfileVersion)
        && endpoint.credentialProfileVersion > 0
        && endpoint.credentialProfileVersion <= 0xffff_ffff,
      `${context}: invalid credentialProfileVersion`,
    );
    const profileKey = `${endpoint.credentialProfileId}@${endpoint.credentialProfileVersion}`;
    const profileEntry = profiles.get(profileKey);
    invariant(profileEntry, `${context}: unknown credential profile ID/version`);
    invariant(Array.isArray(endpoint.credentialInjections), `${context}: credentialInjections must be an array`);
    const injectionSlots = new Set();
    const injectionWireNames = new Set();
    for (const injection of endpoint.credentialInjections) {
      const injectionContext = `${context}/injection/${String(injection?.slotId ?? "unknown")}`;
      exactKeys(injection, injectionKeys, injectionContext);
      invariant(typeof injection.slotId === "string" && providerIdPattern.test(injection.slotId), `${injectionContext}: invalid slotId`);
      invariant(!injectionSlots.has(injection.slotId), `${injectionContext}: duplicate slotId`);
      injectionSlots.add(injection.slotId);
      invariant(injection.target === "header", `${injectionContext}: only header target is allowed in Phase 0`);
      invariant(
        typeof injection.wireName === "string"
          && !/[\r\n]/.test(injection.wireName)
          && injection.wireName === injection.wireName.toLowerCase()
          && headerTokenPattern.test(injection.wireName),
        `${injectionContext}: wireName must be a lowercase header token without CRLF`,
      );
      invariant(!injectionWireNames.has(injection.wireName), `${injectionContext}: duplicate header wireName`);
      injectionWireNames.add(injection.wireName);
      invariant(!reservedCredentialHeaders.has(injection.wireName), `${injectionContext}: reserved header is forbidden`);
      invariant(valueEncodings.has(injection.valueEncoding), `${injectionContext}: invalid valueEncoding`);
    }
    invariant(
      JSON.stringify([...injectionSlots].sort()) === JSON.stringify([...profileEntry.slotIds].sort()),
      `${context}: credentialInjections must exactly cover credential profile slots`,
    );

    validatePublicFields(endpoint.queryParameters, `${context}/queryParameters`);
    invariant(
      Number.isInteger(endpoint.maxQueryBytes)
        && endpoint.maxQueryBytes >= 0
        && endpoint.maxQueryBytes <= 1_048_576,
      `${context}: maxQueryBytes out of bounds`,
    );
    exactKeys(endpoint.bodySchema, bodySchemaKeys, `${context}/bodySchema`);
    invariant(endpoint.bodySchema.encoding === "none" || endpoint.bodySchema.encoding === "json", `${context}: invalid body encoding`);
    validatePublicFields(endpoint.bodySchema.fields, `${context}/bodySchema`);
    invariant(endpoint.bodySchema.encoding !== "none" || endpoint.bodySchema.fields.length === 0, `${context}: body encoding none requires empty fields`);
    invariant(endpoint.bodySchema.encoding !== "json" || endpoint.bodySchema.fields.length > 0, `${context}: empty body fields must use encoding none`);
    invariant(
      Number.isInteger(endpoint.maxBodyBytes)
        && endpoint.maxBodyBytes >= 0
        && endpoint.maxBodyBytes <= 1_048_576,
      `${context}: maxBodyBytes out of bounds`,
    );
    invariant(endpoint.bodySchema.encoding !== "none" || endpoint.maxBodyBytes === 0, `${context}: body encoding none requires maxBodyBytes 0`);

    if (endpoint.idempotencyInjection === null) {
      invariant(endpoint.retrySafety !== "provider_idempotency_key", `${context}: provider idempotency requires an injection`);
    } else {
      exactKeys(endpoint.idempotencyInjection, idempotencyInjectionKeys, `${context}/idempotencyInjection`);
      invariant(endpoint.retrySafety === "provider_idempotency_key", `${context}: idempotency injection requires provider_idempotency_key`);
      invariant(endpoint.idempotencyInjection.target === "header", `${context}: idempotency injection must target a header`);
      invariant(
        typeof endpoint.idempotencyInjection.wireName === "string"
          && endpoint.idempotencyInjection.wireName === endpoint.idempotencyInjection.wireName.toLowerCase()
          && headerTokenPattern.test(endpoint.idempotencyInjection.wireName),
        `${context}: invalid idempotency header`,
      );
      invariant(!reservedCredentialHeaders.has(endpoint.idempotencyInjection.wireName), `${context}: reserved idempotency header is forbidden`);
      invariant(!injectionWireNames.has(endpoint.idempotencyInjection.wireName), `${context}: idempotency and credential headers cannot collide`);
    }

    invariant(endpoint.redirectPolicy === "deny", `${context}: redirects must be denied in Phase 0`);
    invariant(Number.isInteger(endpoint.timeoutMs) && endpoint.timeoutMs >= 100 && endpoint.timeoutMs <= 30000, `${context}: timeout out of bounds`);
    invariant(Number.isInteger(endpoint.maxResponseBytes) && endpoint.maxResponseBytes >= 1 && endpoint.maxResponseBytes <= 4 * 1024 * 1024, `${context}: response limit out of bounds`);
    invariant(retrySafety.has(endpoint.retrySafety), `${context}: invalid retry safety`);
    invariant(extractors.has(endpoint.responseExtractor), `${context}: invalid response extractor`);
    invariant(Array.isArray(endpoint.redactHeaders) && new Set(endpoint.redactHeaders).size === endpoint.redactHeaders.length, `${context}: invalid redacted headers`);
    invariant(
      endpoint.redactHeaders.every((header) => typeof header === "string" && !/[\r\n]/.test(header) && header === header.toLowerCase() && headerTokenPattern.test(header)),
      `${context}: invalid redacted header name`,
    );
    invariant(
      JSON.stringify([...endpoint.redactHeaders].sort()) === JSON.stringify([...injectionWireNames].sort()),
      `${context}: redactHeaders must exactly cover credential injection headers`,
    );
    invariant(Array.isArray(endpoint.redactJsonPointers) && new Set(endpoint.redactJsonPointers).size === endpoint.redactJsonPointers.length, `${context}: invalid redacted JSON pointers`);
    invariant(endpoint.redactJsonPointers.every((pointer) => typeof pointer === "string" && pointer.startsWith("/") && !/[\r\n]/.test(pointer)), `${context}: invalid redacted JSON pointer`);
    exactKeys(endpoint.publicResponseSchema, bodySchemaKeys, `${context}/publicResponseSchema`);
    validatePublicFields(endpoint.publicResponseSchema.fields, `${context}/publicResponseSchema`);
    if (endpoint.responseExtractor === "public_json") {
      invariant(endpoint.publicResponseSchema.encoding === "json" && endpoint.publicResponseSchema.fields.length > 0, `${context}: public_json requires a non-empty response schema`);
      invariant(endpoint.redactJsonPointers.length === 0, `${context}: public_json cannot use denylist redaction`);
    } else {
      invariant(endpoint.publicResponseSchema.encoding === "none" && endpoint.publicResponseSchema.fields.length === 0, `${context}: host_owned response is defined by its Rust extractor`);
    }
  }
  return manifest;
}

function readProductionManifests() {
  return readdirSync(connectorsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((provider) => {
      const path = resolve(connectorsRoot, provider, "endpoint-manifest.json");
      return validateEndpointManifest(JSON.parse(readFileSync(path, "utf8")), provider);
    });
}

function readFixtureManifest() {
  return validateEndpointManifest(JSON.parse(readFileSync(fixtureManifest, "utf8")), "fixture");
}

function canonicalRegistry(manifests) {
  return manifests
    .flatMap((manifest) => manifest.endpoints.map((endpoint) => {
      const profile = manifest.credentialProfiles.find(
        (candidate) => candidate.profileId === endpoint.credentialProfileId
          && candidate.version === endpoint.credentialProfileVersion,
      );
      invariant(profile, `${endpoint.endpointId}: validated credential profile disappeared`);
      const credentialInjections = endpoint.credentialInjections.map((injection) => ({
        ...injection,
        secretKind: profile.slots.find((slot) => slot.slotId === injection.slotId).secretKind,
      }));
      return {
        ...endpoint,
        credentialInjections,
        credentialNamespace: profile.credentialNamespace,
        redactHeaders: credentialInjections.map((injection) => injection.wireName).sort(),
      };
    }))
    .sort((left, right) => left.endpointId.localeCompare(right.endpointId));
}

function tsFieldType(field) {
  if (field.valueType === "boolean") return "boolean";
  if (field.valueType === "integer") return "number";
  return field.allowedValues.length === 0
    ? "string"
    : field.allowedValues.map((value) => JSON.stringify(value)).join(" | ");
}

function tsObjectType(fields) {
  if (fields.length === 0) return "Record<string, never>";
  return `{ ${fields.map((field) => `${JSON.stringify(field.fieldId)}${field.required ? "" : "?"}: ${tsFieldType(field)}`).join("; ")} }`;
}

export function renderTs(registry, hash) {
  const ids = registry.length === 0 ? "never" : registry.map((endpoint) => JSON.stringify(endpoint.endpointId)).join(" | ");
  const requests = registry.length === 0
    ? "never"
    : registry.map((endpoint) => {
      const path = endpoint.pathParameters.length === 0
        ? "Record<string, never>"
        : `{ ${endpoint.pathParameters.map((parameter) => `${JSON.stringify(parameter)}: string`).join("; ")} }`;
      const query = tsObjectType(endpoint.queryParameters);
      const body = endpoint.bodySchema.encoding === "none"
        ? "null"
        : tsObjectType(endpoint.bodySchema.fields);
      return `{ providerConnectionId: string; endpointId: ${JSON.stringify(endpoint.endpointId)}; path: ${path}; query: ${query}; body: ${body}; idempotencyKey: string }`;
    }).join("\n  | ");
  const responses = registry.length === 0
    ? "never"
    : registry.map((endpoint) => `{ endpointId: ${JSON.stringify(endpoint.endpointId)}; body: ${tsObjectType(endpoint.publicResponseSchema.fields)} }`).join("\n  | ");
  return `// Generated by scripts/generate-endpoint-registry.mjs. Do not edit.\n\nexport const ENDPOINT_MANIFEST_SCHEMA_VERSION = 1 as const;\nexport const ENDPOINT_MANIFEST_SHA256 = ${JSON.stringify(hash)} as const;\nexport type EndpointId = ${ids};\nexport type EndpointRequest = ${requests};\nexport type EndpointResponse = ${responses};\n`;
}

function rustString(value) {
  return JSON.stringify(value);
}

function rustVariant(value) {
  return value.split("_").map((part) => `${part[0].toUpperCase()}${part.slice(1)}`).join("");
}

function rustInteger(value) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, "_");
}

function renderRustFields(fields, indent) {
  if (fields.length === 0) return "&[]";
  const entries = fields.map((field) => `${indent}    PublicFieldSchema {\n${indent}        field_id: ${rustString(field.fieldId)},\n${indent}        wire_name: ${rustString(field.wireName)},\n${indent}        value_type: PublicValueType::${rustVariant(field.valueType)},\n${indent}        required: ${field.required},\n${indent}        max_length: ${field.maxLength === null ? "None" : `Some(${field.maxLength})`},\n${indent}        allowed_values: &[${field.allowedValues.map(rustString).join(", ")}],\n${indent}    },`).join("\n");
  return `&[\n${entries}\n${indent}]`;
}

export function renderRust(registry, hash) {
  const entries = registry
    .map((endpoint) => {
      const injections = endpoint.credentialInjections.length === 0
        ? "&[]"
        : `&[\n${endpoint.credentialInjections.map((injection) => `            CredentialInjection {\n                slot_id: ${rustString(injection.slotId)},\n                secret_kind: SecretKind::${rustVariant(injection.secretKind)},\n                target: CredentialTarget::Header,\n                wire_name: ${rustString(injection.wireName)},\n                value_encoding: CredentialValueEncoding::${rustVariant(injection.valueEncoding)},\n            },`).join("\n")}\n        ]`;
      const idempotencyHeader = endpoint.idempotencyInjection === null
        ? "None"
        : `Some(${rustString(endpoint.idempotencyInjection.wireName)})`;
      return `    EndpointCapability {\n        endpoint_id: ${rustString(endpoint.endpointId)},\n        provider: ${rustString(endpoint.endpointId.split(".")[0])},\n        method: HttpMethod::${endpoint.method[0]}${endpoint.method.slice(1).toLowerCase()},\n        origin: ${rustString(endpoint.origin)},\n        path_template: ${rustString(endpoint.pathTemplate)},\n        path_parameters: &[${endpoint.pathParameters.map(rustString).join(", ")}],\n        credential_namespace: CredentialNamespace::ProviderApi,\n        credential_profile_id: ${rustString(endpoint.credentialProfileId)},\n        credential_profile_version: ${endpoint.credentialProfileVersion},\n        credential_injections: ${injections},\n        idempotency_header: ${idempotencyHeader},\n        query_parameters: ${renderRustFields(endpoint.queryParameters, "        ")},\n        max_query_bytes: ${endpoint.maxQueryBytes},\n        body_schema: BodySchema {\n            encoding: BodyEncoding::${rustVariant(endpoint.bodySchema.encoding)},\n            fields: ${renderRustFields(endpoint.bodySchema.fields, "            ")},\n        },\n        max_body_bytes: ${endpoint.maxBodyBytes},\n        redirect_policy: RedirectPolicy::Deny,\n        retry_safety: RetrySafety::${rustVariant(endpoint.retrySafety)},\n        response_extractor: ResponseExtractor::${rustVariant(endpoint.responseExtractor)},\n        public_response_schema: BodySchema {\n            encoding: BodyEncoding::${rustVariant(endpoint.publicResponseSchema.encoding)},\n            fields: ${renderRustFields(endpoint.publicResponseSchema.fields, "            ")},\n        },\n        redact_headers: &[${endpoint.redactHeaders.map(rustString).join(", ")}],\n        redact_json_pointers: &[${endpoint.redactJsonPointers.map(rustString).join(", ")}],\n        timeout_ms: ${endpoint.timeoutMs},\n        max_response_bytes: ${endpoint.maxResponseBytes},\n    }`;
    })
    .join(",\n");
  const imports = registry.length === 0
    ? "use crate::endpoint_capability::EndpointCapability;"
    : "use crate::endpoint_capability::{\n    BodyEncoding, BodySchema, CredentialInjection, CredentialNamespace, CredentialTarget,\n    CredentialValueEncoding, EndpointCapability, HttpMethod, PublicFieldSchema, PublicValueType,\n    RedirectPolicy, ResponseExtractor, RetrySafety, SecretKind,\n};";
  const registryValue = entries === "" ? "&[]" : `&[\n${entries},\n]`;
  const formattedRegistryValue = registryValue
    .replaceAll(/(?<=max_length: Some\()\d+(?=\))/g, (value) => rustInteger(Number(value)))
    .replaceAll(/(?<=max_query_bytes: )\d+/g, (value) => rustInteger(Number(value)))
    .replaceAll(/(?<=max_body_bytes: )\d+/g, (value) => rustInteger(Number(value)))
    .replaceAll(/(?<=timeout_ms: )\d+/g, (value) => rustInteger(Number(value)))
    .replaceAll(/(?<=max_response_bytes: )\d+/g, (value) => rustInteger(Number(value)));
  return `// Generated by scripts/generate-endpoint-registry.mjs. Do not edit.\n\n${imports}\n\npub const ENDPOINT_MANIFEST_SHA256: &str =\n    ${rustString(hash)};\n#[rustfmt::skip]\npub const ENDPOINT_CAPABILITIES: &[EndpointCapability] = ${formattedRegistryValue};\n`;
}

function registryHash(schema, manifests) {
  return createHash("sha256").update(JSON.stringify({ schema, manifests })).digest("hex");
}

function writeOrCheck(path, content, check) {
  if (check) {
    invariant(readFileSync(path, "utf8") === content, `${relative(root, path)} is stale; run pnpm generate:secure-host`);
  } else {
    writeFileSync(path, content);
  }
}

export function generateEndpointRegistry({ check = false } = {}) {
  const schema = JSON.parse(readFileSync(manifestSchema, "utf8"));
  const manifests = readProductionManifests();
  const fixture = readFixtureManifest();
  const registry = canonicalRegistry(manifests);
  const fixtureRegistry = canonicalRegistry([fixture]);
  const hash = registryHash(schema, manifests);
  const fixtureHash = registryHash(schema, [fixture]);
  writeOrCheck(generatedTs, renderTs(registry, hash), check);
  writeOrCheck(generatedRust, renderRust(registry, hash), check);
  writeOrCheck(generatedFixtureRust, renderRust(fixtureRegistry, fixtureHash), check);
  return { endpointCount: registry.length, fixtureEndpointCount: fixtureRegistry.length, hash, fixtureHash };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const check = process.argv.includes("--check");
  const result = generateEndpointRegistry({ check });
  console.log(`endpoint registries ${check ? "verified" : "generated"} (${result.endpointCount} production, ${result.fixtureEndpointCount} fixture endpoints; ${result.hash})`);
}
