import test from "node:test";
import assert from "node:assert/strict";

import {
  renderRust,
  renderTs,
  validateEndpointManifest,
} from "./generate-endpoint-registry.mjs";

function validEndpoint(overrides = {}) {
  return {
    endpointId: "fixture.records.read",
    method: "GET",
    origin: "https://api.fixture.invalid",
    pathTemplate: "/v1/zones/{zoneId}/records",
    pathParameters: ["zoneId"],
    credentialNamespace: "provider_api",
    credentialInjection: "bearer_header",
    redirectPolicy: "deny",
    timeoutMs: 10000,
    maxResponseBytes: 1048576,
    retrySafety: "safe",
    responseExtractor: "public_json",
    redactHeaders: ["authorization"],
    redactJsonPointers: ["/token"],
    ...overrides,
  };
}

function manifest(endpoint) {
  return { schemaVersion: 1, provider: "fixture", endpoints: [endpoint] };
}

test("accepts a fixed HTTPS capability", () => {
  assert.doesNotThrow(() => validateEndpointManifest(manifest(validEndpoint()), "fixture"));
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
  ["unbound placeholder", { pathTemplate: "/v1/{zoneId}/{recordId}" }],
]) {
  test(`rejects ${name}`, () => {
    assert.throws(() => validateEndpointManifest(manifest(validEndpoint(overrides)), "fixture"));
  });
}

test("rejects provider mismatch", () => {
  assert.throws(() => validateEndpointManifest(manifest(validEndpoint()), "other"));
});

test("generates the same capability metadata for Rust and TypeScript", () => {
  const endpoint = validEndpoint();
  const rust = renderRust([endpoint], "fixture-hash");
  const typescript = renderTs([endpoint], "fixture-hash");

  assert.match(rust, /credential_injection: CredentialInjection::BearerHeader/);
  assert.match(rust, /retry_safety: RetrySafety::Safe/);
  assert.match(rust, /redact_json_pointers: &\["\/token"\]/);
  assert.match(typescript, /"endpointId": "fixture\.records\.read"/);
  assert.match(typescript, /"zoneId": string/);
  assert.match(typescript, /idempotencyKey: string/);
  assert.match(typescript, /"responseExtractor": "public_json"/);
});
