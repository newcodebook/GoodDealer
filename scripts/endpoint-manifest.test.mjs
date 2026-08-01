import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import {
  renderRust,
  renderTs,
  validateEndpointManifest,
} from "./generate-endpoint-registry.mjs";

const root = resolve(import.meta.dirname, "..");

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if ([".git", "node_modules", "target"].includes(entry.name)) return [];
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : [path];
  });
}

function validProfile(overrides = {}) {
  return {
    profileId: "fixture-api-v1",
    version: 1,
    credentialNamespace: "provider_api",
    slots: [{ slotId: "api-token", secretKind: "api_token" }],
    ...overrides,
  };
}

function validEndpoint(overrides = {}) {
  return {
    endpointId: "fixture.records.create",
    method: "POST",
    origin: "https://api.fixture.invalid",
    pathTemplate: "/v1/zones/{zoneId}/records",
    pathParameters: ["zoneId"],
    credentialProfileId: "fixture-api-v1",
    credentialProfileVersion: 1,
    credentialInjections: [{
      slotId: "api-token",
      target: "header",
      wireName: "authorization",
      valueEncoding: "bearer",
    }],
    idempotencyInjection: {
      target: "header",
      wireName: "idempotency-key",
    },
    queryParameters: [{
      fieldId: "dryRun",
      wireName: "dry_run",
      valueType: "boolean",
      required: true,
      maxLength: null,
      allowedValues: [],
    }],
    maxQueryBytes: 128,
    bodySchema: {
      encoding: "json",
      fields: [
        {
          fieldId: "recordType",
          wireName: "type",
          valueType: "string",
          required: true,
          maxLength: 8,
          allowedValues: ["TXT"],
        },
        {
          fieldId: "name",
          wireName: "name",
          valueType: "string",
          required: true,
          maxLength: 253,
          allowedValues: [],
        },
        {
          fieldId: "value",
          wireName: "value",
          valueType: "string",
          required: true,
          maxLength: 1024,
          allowedValues: [],
        },
      ],
    },
    maxBodyBytes: 2048,
    redirectPolicy: "deny",
    timeoutMs: 10000,
    maxResponseBytes: 1048576,
    retrySafety: "provider_idempotency_key",
    responseExtractor: "public_json",
    publicResponseSchema: {
      encoding: "json",
      fields: [{
        fieldId: "ok",
        wireName: "ok",
        valueType: "boolean",
        required: true,
        maxLength: null,
        allowedValues: [],
      }],
    },
    redactHeaders: ["authorization"],
    redactJsonPointers: [],
    ...overrides,
  };
}

function manifest(endpoint = validEndpoint(), profile = validProfile()) {
  return {
    schemaVersion: 1,
    provider: "fixture",
    credentialProfiles: [profile],
    endpoints: [endpoint],
  };
}

function clone(value) {
  return structuredClone(value);
}

test("accepts a fixed HTTPS capability with an exact credential profile", () => {
  assert.doesNotThrow(() => validateEndpointManifest(manifest(), "fixture"));
});

test("executes the checked-in JSON Schema before cross-field validation", () => {
  const value = manifest();
  value.endpoints[0].timeoutMs = "10000";
  assert.throws(
    () => validateEndpointManifest(value, "fixture"),
    /JSON Schema rejected Manifest/,
  );
});

for (const [name, overrides] of [
  ["HTTP origin", { origin: "http://api.fixture.invalid" }],
  ["userinfo", { origin: "https://user@api.fixture.invalid" }],
  ["custom port", { origin: "https://api.fixture.invalid:8443" }],
  ["explicit default port", { origin: "https://api.fixture.invalid:443" }],
  ["uppercase origin", { origin: "https://API.fixture.invalid" }],
  ["normalized origin path", { origin: "https://api.fixture.invalid/a/.." }],
  ["trailing origin slash", { origin: "https://api.fixture.invalid/" }],
  ["literal IP", { origin: "https://127.0.0.1" }],
  ["redirect", { redirectPolicy: "same_origin" }],
  ["path traversal", { pathTemplate: "/v1/{zoneId}/../secrets" }],
  ["path CRLF", { pathTemplate: "/v1/{zoneId}\r\nX-Test: injected" }],
  ["unbound placeholder", { pathTemplate: "/v1/{zoneId}/{recordId}" }],
]) {
  test(`rejects ${name}`, () => {
    assert.throws(() => validateEndpointManifest(manifest(validEndpoint(overrides)), "fixture"));
  });
}

test("rejects provider mismatch", () => {
  assert.throws(() => validateEndpointManifest(manifest(), "other"));
});

test("rejects unknown manifest, profile, endpoint, injection, field, and body fields", () => {
  const mutations = [
    (value) => { value.unknown = true; },
    (value) => { value.credentialProfiles[0].unknown = true; },
    (value) => { value.endpoints[0].unknown = true; },
    (value) => { value.endpoints[0].credentialInjections[0].unknown = true; },
    (value) => { value.endpoints[0].queryParameters[0].unknown = true; },
    (value) => { value.endpoints[0].bodySchema.unknown = true; },
  ];
  for (const mutate of mutations) {
    const value = manifest();
    mutate(value);
    assert.throws(() => validateEndpointManifest(value, "fixture"));
  }
});

test("rejects duplicate profile slots and endpoint injection slots", () => {
  const duplicateProfileSlot = manifest();
  duplicateProfileSlot.credentialProfiles[0].slots.push(
    clone(duplicateProfileSlot.credentialProfiles[0].slots[0]),
  );
  assert.throws(() => validateEndpointManifest(duplicateProfileSlot, "fixture"));

  const duplicateInjection = manifest();
  duplicateInjection.endpoints[0].credentialInjections.push(
    clone(duplicateInjection.endpoints[0].credentialInjections[0]),
  );
  assert.throws(() => validateEndpointManifest(duplicateInjection, "fixture"));
});

test("rejects unknown, missing, or incompletely injected credential profiles", () => {
  assert.throws(() => validateEndpointManifest(manifest(validEndpoint({ credentialProfileVersion: 2 })), "fixture"));
  assert.throws(() => validateEndpointManifest(manifest(validEndpoint({ credentialInjections: [] })), "fixture"));

  const profile = validProfile({
    slots: [
      { slotId: "api-token", secretKind: "api_token" },
      { slotId: "secondary-token", secretKind: "api_token" },
    ],
  });
  assert.throws(() => validateEndpointManifest(manifest(validEndpoint(), profile), "fixture"));
});

test("rejects profile versions and field lengths outside Rust u32 bounds", () => {
  assert.throws(() => validateEndpointManifest(manifest(validEndpoint(), validProfile({ version: 0x1_0000_0000 })), "fixture"));

  const value = manifest();
  value.endpoints[0].bodySchema.fields[0].maxLength = 0x1_0000_0000;
  assert.throws(() => validateEndpointManifest(value, "fixture"));
});

for (const [name, wireName] of [
  ["CRLF header injection", "authorization\r\nx-evil"],
  ["uppercase header name", "Authorization"],
  ["invalid header token", "authorization: bearer"],
]) {
  test(`rejects ${name}`, () => {
    const endpoint = validEndpoint();
    endpoint.credentialInjections[0].wireName = wireName;
    assert.throws(() => validateEndpointManifest(manifest(endpoint), "fixture"));
  });
}

test("rejects duplicate query and body field IDs or wire names", () => {
  const duplicateQuery = manifest();
  duplicateQuery.endpoints[0].queryParameters.push(
    clone(duplicateQuery.endpoints[0].queryParameters[0]),
  );
  assert.throws(() => validateEndpointManifest(duplicateQuery, "fixture"));

  const duplicateBodyWire = manifest();
  duplicateBodyWire.endpoints[0].bodySchema.fields[1].wireName = "type";
  assert.throws(() => validateEndpointManifest(duplicateBodyWire, "fixture"));
});

test("rejects allowedValues and maxLength combinations that contradict valueType", () => {
  const booleanAllowed = manifest();
  booleanAllowed.endpoints[0].queryParameters[0].allowedValues = ["true"];
  assert.throws(() => validateEndpointManifest(booleanAllowed, "fixture"));

  const integerMaxLength = manifest();
  integerMaxLength.endpoints[0].queryParameters[0].valueType = "integer";
  integerMaxLength.endpoints[0].queryParameters[0].maxLength = 10;
  assert.throws(() => validateEndpointManifest(integerMaxLength, "fixture"));

  const allowedTooLong = manifest();
  allowedTooLong.endpoints[0].bodySchema.fields[0].maxLength = 2;
  assert.throws(() => validateEndpointManifest(allowedTooLong, "fixture"));

  const utf8TooLong = manifest();
  utf8TooLong.endpoints[0].bodySchema.fields[0].maxLength = 3;
  utf8TooLong.endpoints[0].bodySchema.fields[0].allowedValues = ["😀"];
  assert.throws(() => validateEndpointManifest(utf8TooLong, "fixture"));

  const unboundedString = manifest();
  unboundedString.endpoints[0].bodySchema.fields[1].maxLength = null;
  assert.throws(() => validateEndpointManifest(unboundedString, "fixture"));
});

test("binds provider idempotency to one fixed non-reserved header", () => {
  assert.throws(() => validateEndpointManifest(manifest(validEndpoint({ idempotencyInjection: null })), "fixture"));
  assert.throws(() => validateEndpointManifest(manifest(validEndpoint({
    idempotencyInjection: { target: "header", wireName: "host" },
  })), "fixture"));
  assert.throws(() => validateEndpointManifest(manifest(validEndpoint({
    idempotencyInjection: { target: "header", wireName: "authorization" },
  })), "fixture"));
});

test("rejects reserved credential headers and incomplete redaction", () => {
  for (const wireName of ["host", "keep-alive", "proxy-connection", "http2-settings"]) {
    const reserved = validEndpoint();
    reserved.credentialInjections[0].wireName = wireName;
    reserved.redactHeaders = [wireName];
    assert.throws(() => validateEndpointManifest(manifest(reserved), "fixture"));
  }

  assert.throws(() => validateEndpointManifest(manifest(validEndpoint({ redactHeaders: [] })), "fixture"));
});

test("requires a closed public response schema instead of denylist cleanup", () => {
  assert.throws(() => validateEndpointManifest(manifest(validEndpoint({
    publicResponseSchema: { encoding: "json", fields: [] },
  })), "fixture"));
  assert.throws(() => validateEndpointManifest(manifest(validEndpoint({
    redactJsonPointers: ["/token"],
  })), "fixture"));
});

test("rejects body encoding none when fields are present", () => {
  const value = manifest();
  value.endpoints[0].bodySchema.encoding = "none";
  assert.throws(() => validateEndpointManifest(value, "fixture"));
});

test("requires the canonical none encoding for an endpoint without a body", () => {
  const value = manifest();
  value.endpoints[0].bodySchema = { encoding: "json", fields: [] };
  assert.throws(() => validateEndpointManifest(value, "fixture"));

  value.endpoints[0].bodySchema.encoding = "none";
  value.endpoints[0].maxBodyBytes = 0;
  assert.doesNotThrow(() => validateEndpointManifest(value, "fixture"));
  assert.match(renderTs(value.endpoints, "fixture-hash"), /body: null/);
});

test("rejects missing query or body schema", () => {
  const missingQuery = manifest();
  delete missingQuery.endpoints[0].queryParameters;
  assert.throws(() => validateEndpointManifest(missingQuery, "fixture"));

  const missingBody = manifest();
  delete missingBody.endpoints[0].bodySchema;
  assert.throws(() => validateEndpointManifest(missingBody, "fixture"));
});

test("generates Rust security metadata and TypeScript public request types", () => {
  const endpoint = {
    ...validEndpoint(),
    credentialInjections: validEndpoint().credentialInjections.map((injection) => ({
      ...injection,
      secretKind: "api_token",
    })),
    credentialNamespace: "provider_api",
  };
  const rust = renderRust([endpoint], "fixture-hash");
  const typescript = renderTs([endpoint], "fixture-hash");

  assert.match(rust, /credential_profile_id: "fixture-api-v1"/);
  assert.match(rust, /credential_profile_version: 1/);
  assert.match(rust, /slot_id: "api-token"/);
  assert.match(rust, /target: CredentialTarget::Header/);
  assert.match(rust, /wire_name: "authorization"/);
  assert.match(rust, /value_encoding: CredentialValueEncoding::Bearer/);
  assert.match(rust, /secret_kind: SecretKind::ApiToken/);
  assert.match(rust, /idempotency_header: Some\("idempotency-key"\)/);
  assert.match(rust, /field_id: "dryRun"/);
  assert.match(rust, /wire_name: "dry_run"/);
  assert.match(rust, /value_type: PublicValueType::Boolean/);
  assert.match(rust, /encoding: BodyEncoding::Json/);
  assert.match(rust, /allowed_values: &\["TXT"\]/);
  assert.match(typescript, /endpointId: "fixture\.records\.create"/);
  assert.match(typescript, /path: \{ "zoneId": string \}/);
  assert.match(typescript, /query: \{ "dryRun": boolean \}/);
  assert.match(typescript, /body: \{ "recordType": "TXT"; "name": string; "value": string \}/);
  assert.match(typescript, /idempotencyKey: string/);
  assert.match(typescript, /EndpointResponse = \{ endpointId: "fixture\.records\.create"; body: \{ "ok": boolean \} \}/);
  assert.doesNotMatch(typescript, /credentialNamespace|credentialInjections|origin|wireName/);
  assert.doesNotMatch(typescript, /endpointRegistry/);
});

test("keeps fixture capabilities unreachable from production composition", () => {
  for (const provider of ["afternic", "atom", "cloudflare", "spaceship"]) {
    const productionManifest = JSON.parse(readFileSync(
      resolve(root, `packages/connectors/${provider}/endpoint-manifest.json`),
      "utf8",
    ));
    assert.deepEqual(productionManifest.credentialProfiles, []);
    assert.deepEqual(productionManifest.endpoints, []);
  }

  const productionRegistry = readFileSync(
    resolve(root, "crates/secure-host-core/src/generated/endpoint_registry.rs"),
    "utf8",
  );
  assert.match(productionRegistry, /ENDPOINT_CAPABILITIES: &\[EndpointCapability\] = &\[\];/);
  assert.doesNotMatch(productionRegistry, /fixture/i);

  const generatedModules = readFileSync(
    resolve(root, "crates/secure-host-core/src/generated/mod.rs"),
    "utf8",
  );
  assert.match(generatedModules, /#\[cfg\(test\)\]\s+pub mod fixture_endpoint_registry;/);

  const secureHostRoot = readFileSync(
    resolve(root, "crates/secure-host-core/src/lib.rs"),
    "utf8",
  );
  assert.match(secureHostRoot, /#\[cfg\(test\)\]\s+mod http_executor;/);
  assert.doesNotMatch(secureHostRoot, /pub mod http_executor/);

  const cargoManifests = sourceFiles(root).filter((path) => path.endsWith("Cargo.toml"));
  for (const path of cargoManifests) {
    assert.doesNotMatch(readFileSync(path, "utf8"), /fixture_endpoint_registry|fake[-_ ]provider/i);
  }

  for (const path of sourceFiles(resolve(root, "apps/desktop"))) {
    assert.doesNotMatch(readFileSync(path, "utf8"), /fixture_endpoint_registry|api\.fixture\.invalid/i);
  }
});
