import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { registerHooks } from "node:module";
import { dirname, extname, relative, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const defaultOutputPath = resolve(
  root,
  process.argv[2] ?? ".artifacts/wp4/cloud-boundary/cloud-boundary-report.json",
);

export const CLOUD_BOUNDARY_ARTIFACT_DIRECTORY = ".artifacts/wp4/cloud-boundary";
export const CLOUD_BOUNDARY_EVIDENCE_DEFAULTS = Object.freeze({
  ownerRole: "Cloud Platform Lead",
  owningModules: Object.freeze([
    "cloud-entrypoints-public",
    "cloud-entrypoints-admin",
    "cloud-entrypoints-jobs",
    "protocol-wire",
  ]),
  requiredReviewerRole: "Security Reviewer",
});

export const CLOUD_BOUNDARY_SCOPE =
  "Cloud entrypoint boundary only: two isolated Fastify composition roots with no business route, a framework-independent jobs composition with no registered periodic job, fixture session verifiers, and a single-process pre-auth request.ip rate-limit bucket. No production Endpoint Registry, no real credentials, no persistence, no external network, no Staff AuditEvent chain, no job runtime, no proxy-derived client-IP policy, no device/account bucket, and no cross-instance rate-limit consistency.";

const publicRouteTable = [
  "GET /v1/boundary/identity",
  "POST /v1/boundary/validate",
];
const adminRouteTable = [
  "GET /admin/v1/boundary/identity",
  "POST /admin/v1/boundary/validate",
];
const allowedAdminPaths = new Set([
  "/admin/v1/boundary/identity",
  "/admin/v1/boundary/validate",
]);
const sourceExtensions = [".ts", ".tsx", ".mts", ".cts", ".js", ".mjs"];
const ignoredDirectories = new Set([".artifacts", ".git", "dist", "node_modules", "target"]);

export const CLOUD_BOUNDARY_REQUIRED_INPUTS = Object.freeze([
  "scripts/collect-cloud-boundary-report.mjs",
  "scripts/cloud-boundary-evidence-policy.test.mjs",
  "scripts/collect-wp0-evidence.mjs",
  "scripts/boundary-policy.mjs",
  "scripts/boundary-policy.test.mjs",
  "scripts/check-boundaries.mjs",
  "package.json",
  ".github/workflows/wp4-cloud-boundary.yml",
  "apps/cloud/src/entrypoints/http.ts",
  "apps/cloud/src/entrypoints/admin-http.ts",
  "apps/cloud/src/entrypoints/jobs.ts",
  "apps/cloud/src/entrypoints/adapter/rate-limit.ts",
  "apps/cloud/src/entrypoints/adapter/schema.ts",
  "apps/cloud/src/entrypoints/adapter/surface.ts",
  "apps/cloud/src/entrypoints/ports/public-session.ts",
  "apps/cloud/src/entrypoints/ports/staff-session.ts",
  "apps/cloud/src/entrypoints/routes/public/boundary.ts",
  "apps/cloud/src/entrypoints/routes/admin/boundary.ts",
  "apps/cloud/test/entrypoints/error-identity-matrix.test.ts",
  "apps/cloud/test/entrypoints/jobs-composition.test.ts",
  "apps/cloud/test/entrypoints/rate-limit-boundary.test.ts",
  "apps/cloud/test/entrypoints/route-adapter-types.test.ts",
  "apps/cloud/test/entrypoints/schema-adapter.test.ts",
  "packages/protocol/src/wire/transport-error.ts",
]);

let hooksRegistered = false;
let runtimeModulesPromise;

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function withoutComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function importsOf(source) {
  const imports = [];
  const cleanSource = withoutComments(source);
  const patterns = [
    /(?:import|export)\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of cleanSource.matchAll(pattern)) {
      if (match[1] !== undefined) imports.push(match[1]);
    }
  }
  return imports;
}

function walkFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) return [];
    const child = resolve(directory, entry.name);
    return entry.isDirectory() ? walkFiles(child) : [child];
  });
}

function sourceFiles(directory) {
  return walkFiles(directory).filter((path) => sourceExtensions.includes(extname(path)));
}

function readSources(directory) {
  return sourceFiles(directory).map((path) => ({
    path: relative(root, path).replaceAll("\\", "/"),
    absolutePath: path,
    source: readFileSync(path, "utf8"),
  }));
}

export function sourceRegistersAdminBusinessRoute(source) {
  const cleanSource = withoutComments(source);
  const adminPaths = [
    ...cleanSource.matchAll(/(?:path\s*:\s*|\.(?:delete|get|patch|post|put)\s*\(\s*)["'](\/admin\/[^"']+)["']/g),
  ].map((match) => match[1]);
  return adminPaths.some((path) => path !== undefined && !allowedAdminPaths.has(path));
}

export function sourceSchedulesPeriodicJob(source) {
  const cleanSource = withoutComments(source);
  const invokesScheduler = /\.\s*schedulePeriodic\s*\(/.test(cleanSource);
  const nonEmptyRegistry = /\bperiodicJobs\s*(?::[^=]+)?=\s*\[\s*[^\]\s]/.test(cleanSource);
  const scheduledRegistry = /\b(?:cron|every)\s*:\s*["'][^"']+["']/.test(cleanSource);
  return invokesScheduler || nonEmptyRegistry || scheduledRegistry;
}

export function sourceCrossesSurfaceImport(localPath, source) {
  const specifiers = importsOf(source);
  const isPublic =
    localPath === "apps/cloud/src/entrypoints/http.ts"
    || localPath.startsWith("apps/cloud/src/entrypoints/routes/public/");
  const isAdmin =
    localPath === "apps/cloud/src/entrypoints/admin-http.ts"
    || localPath.startsWith("apps/cloud/src/entrypoints/routes/admin/");

  if (isPublic) {
    return specifiers.some((specifier) => /(?:admin|staff-session)/i.test(specifier));
  }
  if (isAdmin) {
    return specifiers.some((specifier) => /(?:routes\/public|public-session)/i.test(specifier));
  }
  return false;
}

export function sourceDeclaresHandWrittenJsonSchema(source) {
  const cleanSource = withoutComments(source);
  return /\{[\s\S]{0,400}?\btype\s*:\s*["']object["'][\s\S]{0,400}?\bproperties\s*:/.test(
    cleanSource,
  ) || /\{[\s\S]{0,400}?\bproperties\s*:[\s\S]{0,400}?\btype\s*:\s*["']object["']/.test(
    cleanSource,
  );
}

export function sourceUsesAddressOnlyPreAuthRateLimitBucket(source) {
  const cleanSource = withoutComments(source);
  const consumeCalls = [...cleanSource.matchAll(/\blimiter\s*\.\s*consume\s*\(/g)];
  return consumeCalls.length === 1
    && /\blimiter\s*\.\s*consume\s*\(\s*preAuthRateLimitIdentity\s*\(\s*request\.ip\s*\)\s*\)/.test(cleanSource)
    && !/identityHeaderNames\s*:\s*\[\s*[^\]\s]/.test(cleanSource);
}

export function sourceRegistersModuleRoute(source) {
  const cleanSource = withoutComments(source);
  return (
    /\bfrom\s+["']fastify["']|\brequire\s*\(\s*["']fastify["']\s*\)/.test(cleanSource)
    || /\b(?:fastify|fetch)\s*\(/.test(cleanSource)
    || /\b(?:app|server|fastify)\s*\.\s*(?:delete|get|head|listen|options|patch|post|put|register|route)\s*\(/.test(
      cleanSource,
    )
  );
}

function packageNameFromSpecifier(specifier) {
  if (specifier.startsWith("@")) return specifier.split("/").slice(0, 2).join("/");
  return specifier.split("/", 1)[0];
}

let workspacePackages;
function workspacePackageMap() {
  if (workspacePackages !== undefined) return workspacePackages;
  workspacePackages = new Map();
  for (const packagePath of walkFiles(root).filter((path) => path.endsWith("package.json"))) {
    try {
      const manifest = JSON.parse(readFileSync(packagePath, "utf8"));
      if (typeof manifest.name === "string") {
        workspacePackages.set(manifest.name, { directory: dirname(packagePath), manifest });
      }
    } catch {
      // Invalid package manifests are handled by the workspace checks, not this import walker.
    }
  }
  return workspacePackages;
}

function firstExistingFile(candidates) {
  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile()) ?? null;
}

function resolveSourceCandidate(candidate) {
  return firstExistingFile([
    candidate,
    ...sourceExtensions.map((extension) => `${candidate}${extension}`),
    ...sourceExtensions.map((extension) => resolve(candidate, `index${extension}`)),
  ]);
}

function resolveWorkspaceExport(specifier) {
  const packageName = packageNameFromSpecifier(specifier);
  const workspacePackage = workspacePackageMap().get(packageName);
  if (workspacePackage === undefined) return null;
  const subpath = specifier.slice(packageName.length);
  const exportKey = subpath === "" ? "." : `.${subpath}`;
  const declaredExport = workspacePackage.manifest.exports?.[exportKey];
  const exportTarget =
    typeof declaredExport === "string"
      ? declaredExport
      : typeof declaredExport?.import === "string"
        ? declaredExport.import
        : typeof declaredExport?.default === "string"
          ? declaredExport.default
          : null;
  if (exportTarget !== null) {
    return resolveSourceCandidate(resolve(workspacePackage.directory, exportTarget));
  }
  const fallback = subpath === "" ? "src/index" : `src${subpath}`;
  return resolveSourceCandidate(resolve(workspacePackage.directory, fallback));
}

function resolveGraphImport(fromPath, specifier) {
  if (specifier.startsWith(".")) return resolveSourceCandidate(resolve(dirname(fromPath), specifier));
  if (specifier.startsWith("@gooddealer/")) return resolveWorkspaceExport(specifier);
  return null;
}

export function jobsImportGraphReachesHttpFramework(entryPath) {
  const absoluteEntry = resolve(root, entryPath);
  const pending = [absoluteEntry];
  const visited = new Set();

  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined || visited.has(current)) continue;
    visited.add(current);
    const normalized = current.replaceAll("\\", "/");
    if (/\/entrypoints\/(?:adapter|routes)\//.test(normalized)) return true;
    if (!existsSync(current)) return true;
    const source = readFileSync(current, "utf8");
    for (const specifier of importsOf(source)) {
      if (specifier === "fastify" || specifier === "node:http" || specifier === "http") return true;
      const resolvedImport = resolveGraphImport(current, specifier);
      if (resolvedImport !== null && !visited.has(resolvedImport)) pending.push(resolvedImport);
    }
  }
  return false;
}

function registerTypeScriptHooks() {
  if (hooksRegistered) return;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (
        (specifier.startsWith("./") || specifier.startsWith("../"))
        && !/\.[a-z0-9]+$/i.test(specifier)
        && context.parentURL !== undefined
      ) {
        const candidate = new URL(`${specifier}.ts`, context.parentURL);
        if (existsSync(fileURLToPath(candidate))) return nextResolve(candidate.href, context);
      }
      return nextResolve(specifier, context);
    },
  });
  hooksRegistered = true;
}

async function loadRuntimeModules() {
  if (runtimeModulesPromise !== undefined) return runtimeModulesPromise;
  registerTypeScriptHooks();
  runtimeModulesPromise = Promise.all([
    import(pathToFileURL(resolve(root, "apps/cloud/src/entrypoints/http.ts"))),
    import(pathToFileURL(resolve(root, "apps/cloud/src/entrypoints/admin-http.ts"))),
    import(pathToFileURL(resolve(root, "apps/cloud/src/entrypoints/adapter/rate-limit.ts"))),
    import(pathToFileURL(resolve(root, "apps/cloud/src/entrypoints/adapter/schema.ts"))),
    import(pathToFileURL(resolve(root, "apps/cloud/src/entrypoints/adapter/surface.ts"))),
    import(pathToFileURL(resolve(root, "apps/cloud/src/entrypoints/ports/audit-sink.ts"))),
    import(pathToFileURL(resolve(root, "apps/cloud/src/entrypoints/ports/public-session.ts"))),
    import(pathToFileURL(resolve(root, "apps/cloud/src/entrypoints/ports/staff-session.ts"))),
    import(pathToFileURL(resolve(root, "apps/cloud/src/entrypoints/jobs.ts"))),
    import(pathToFileURL(resolve(root, "apps/cloud/src/entrypoints/routes/admin/boundary.ts"))),
  ]).then(([
    publicHttp,
    adminHttp,
    rateLimit,
    schema,
    surface,
    audit,
    publicSession,
    staffSession,
    jobs,
    adminBoundary,
  ]) => ({
    ...publicHttp,
    ...adminHttp,
    ...rateLimit,
    ...schema,
    ...surface,
    ...audit,
    ...publicSession,
    ...staffSession,
    ...jobs,
    ...adminBoundary,
  }));
  return runtimeModulesPromise;
}

function ids(prefix) {
  let value = 0;
  return () => `${prefix}-${++value}`;
}

function normalizeCorrelation(bodyText) {
  const body = JSON.parse(bodyText);
  return bodyText.replace(JSON.stringify(body.correlationId), JSON.stringify("<correlation>"));
}

function bodyMatches(actual, expected) {
  return Object.entries(expected).every(([key, value]) => actual[key] === value);
}

function exactErrorShape(body, accountRejection) {
  const expected = accountRejection
    ? ["code", "correlationId", "retryAfterSeconds", "retryable", "schemaVersion"]
    : ["code", "correlationId", "schemaVersion"];
  return JSON.stringify(Object.keys(body).sort()) === JSON.stringify(expected);
}

async function requestMatrixCase(matrixCase, context) {
  const beforeAudit = context.audit.records().length;
  const headers = {};
  if (matrixCase.cookie !== undefined) headers.cookie = matrixCase.cookie;
  if (matrixCase.body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(
    `${matrixCase.surface === "public" ? context.publicUrl : context.adminUrl}${matrixCase.path}`,
    {
      method: matrixCase.method ?? "GET",
      headers,
      ...(matrixCase.body === undefined ? {} : { body: matrixCase.body }),
    },
  );
  const rawBody = await response.text();
  const body = JSON.parse(rawBody);
  const addedAudit = context.audit.records().slice(beforeAudit);
  const auditMatched = matrixCase.audit === "none"
    ? addedAudit.length === 0
    : addedAudit.length === 1 && addedAudit[0]?.outcome === matrixCase.audit;
  const errorShapeMatched = response.status < 400
    ? true
    : exactErrorShape(body, matrixCase.id === "M13");
  const retryMatched = matrixCase.id !== "M13"
    || response.headers.get("retry-after") === String(body.retryAfterSeconds);
  const matched = response.status === matrixCase.expectedStatus
    && bodyMatches(body, matrixCase.expectedBody)
    && auditMatched
    && errorShapeMatched
    && retryMatched;
  return {
    id: matrixCase.id,
    status: response.status,
    code: typeof body.code === "string" ? body.code : null,
    audit: addedAudit[0]?.outcome ?? "none",
    matched,
    rawBody,
  };
}

async function observeRateLimit(publicUrl) {
  const request = (key) => fetch(`${publicUrl}/v1/boundary/identity`, {
    headers: key === null ? {} : { cookie: `gd_session=${key}` },
  });
  const allowed = [];
  for (let index = 0; index < 3; index += 1) allowed.push((await request("probe-session-a")).status);
  const limited = [];
  const retryPairings = [];
  for (let index = 0; index < 2; index += 1) {
    const response = await request("probe-session-a");
    const body = await response.json();
    limited.push(response.status);
    retryPairings.push(
      body.code === "RATE_LIMITED"
      && body.retryable === true
      && response.headers.get("retry-after") === String(body.retryAfterSeconds),
    );
  }
  const rotatedCookie = await request("probe-session-b");
  const missing = await request(null);
  await Promise.all([rotatedCookie.body?.cancel(), missing.body?.cancel()]);
  await delay(1_500);
  const reset = await request("probe-session-a");
  await reset.body?.cancel();
  return {
    allowedStatuses: allowed,
    limitedStatuses: limited,
    rotatingCookiesShareAddressBucketObserved: rotatedCookie.status === 429,
    resetObserved: reset.status === 200,
    limitedStatus: limited.every((status) => status === 429) ? 429 : limited[0] ?? null,
    absentCookieAfterExhaustionStatus: missing.status,
    retryAfterPairingObserved: retryPairings.every(Boolean),
    probeVerdict:
      allowed.every((status) => status === 200)
      && limited.every((status) => status === 429)
      && retryPairings.every(Boolean)
      && rotatedCookie.status === 429
      && missing.status === 429
      && reset.status === 200
        ? "pass"
        : "fail",
  };
}

const matrixCases = Object.freeze([
  { id: "M1", surface: "public", path: "/v1/boundary/identity", expectedStatus: 401, expectedBody: { schemaVersion: 1, code: "UNAUTHENTICATED" }, audit: "none" },
  { id: "M2", surface: "public", path: "/v1/boundary/identity", cookie: "gd_session=pub-session", expectedStatus: 200, expectedBody: { surface: "public", authenticated: true }, audit: "none" },
  { id: "M3", surface: "public", path: "/v1/boundary/identity", cookie: "gd_staff_session=staff-session", expectedStatus: 401, expectedBody: { schemaVersion: 1, code: "UNAUTHENTICATED" }, audit: "none" },
  { id: "M4", surface: "public", path: "/admin/v1/boundary/identity", cookie: "gd_session=pub-cross-session", expectedStatus: 404, expectedBody: { schemaVersion: 1, code: "NOT_FOUND" }, audit: "none" },
  { id: "M5", surface: "public", path: "/v1/nope", cookie: "gd_session=pub-nope-session", expectedStatus: 404, expectedBody: { schemaVersion: 1, code: "NOT_FOUND" }, audit: "none" },
  { id: "M6", surface: "admin", path: "/admin/v1/boundary/identity", expectedStatus: 404, expectedBody: { schemaVersion: 1, code: "NOT_FOUND" }, audit: "denial" },
  { id: "M7", surface: "admin", path: "/admin/v1/boundary/identity", cookie: "gd_session=pub-session", expectedStatus: 404, expectedBody: { schemaVersion: 1, code: "NOT_FOUND" }, audit: "denial" },
  { id: "M8", surface: "admin", path: "/admin/v1/boundary/identity", cookie: "gd_staff_session=staff-session", expectedStatus: 200, expectedBody: { surface: "admin" }, audit: "access" },
  { id: "M9", surface: "admin", path: "/admin/v1/boundary/identity", cookie: "gd_staff_session=staff-no-scope", expectedStatus: 404, expectedBody: { schemaVersion: 1, code: "NOT_FOUND" }, audit: "denial" },
  { id: "M10", surface: "admin", path: "/v1/boundary/identity", cookie: "gd_staff_session=staff-session", expectedStatus: 404, expectedBody: { schemaVersion: 1, code: "NOT_FOUND" }, audit: "denial" },
  { id: "M11", surface: "admin", path: "/admin/v1/boundary/identity", cookie: "gd_staff_session=staff-expired", expectedStatus: 404, expectedBody: { schemaVersion: 1, code: "NOT_FOUND" }, audit: "denial" },
  { id: "M12", surface: "public", method: "POST", path: "/v1/boundary/validate", cookie: "gd_session=pub-schema-session", body: JSON.stringify({ count: "x" }), expectedStatus: 400, expectedBody: { schemaVersion: 1, code: "SCHEMA_INVALID" }, audit: "none" },
  { id: "M13", surface: "public", path: "/v1/boundary/identity", cookie: "gd_session=matrix-rate-session", expectedStatus: 429, expectedBody: { schemaVersion: 1, code: "RATE_LIMITED", retryable: true }, audit: "none" },
  { id: "M14", surface: "public", method: "POST", path: "/v1/boundary/validate", cookie: "gd_session=pub-large-session", body: JSON.stringify({ count: 1, padding: "x".repeat(512) }), expectedStatus: 413, expectedBody: { schemaVersion: 1, code: "PAYLOAD_TOO_LARGE" }, audit: "none" },
  { id: "M15", surface: "admin", path: "/admin/v1/nope", cookie: "gd_staff_session=staff-session", expectedStatus: 404, expectedBody: { schemaVersion: 1, code: "NOT_FOUND" }, audit: "denial" },
  { id: "M16", surface: "public", method: "DELETE", path: "/v1/boundary/identity", cookie: "gd_session=pub-method-session", expectedStatus: 404, expectedBody: { schemaVersion: 1, code: "NOT_FOUND" }, audit: "none" },
]);

function staticBoundaryEvidence(runtime) {
  const entrypointSources = readSources(resolve(root, "apps/cloud/src/entrypoints"));
  const cloudSources = readSources(resolve(root, "apps/cloud/src"));
  const moduleSources = readSources(resolve(root, "apps/cloud/src/modules"));
  const publicRoot = entrypointSources.find(({ path }) => path.endsWith("/entrypoints/http.ts"));
  const adminRoot = entrypointSources.find(({ path }) => path.endsWith("/entrypoints/admin-http.ts"));
  return {
    adminBusinessRoutesRegistered:
      runtime.adminBusinessRoutes.length !== 0
      || entrypointSources.some(({ source }) => sourceRegistersAdminBusinessRoute(source)),
    periodicJobsRegistered:
      runtime.periodicJobs.length !== 0
      || entrypointSources.some(({ source }) => sourceSchedulesPeriodicJob(source)),
    publicRootImportsStaffSurface:
      publicRoot === undefined || sourceCrossesSurfaceImport(publicRoot.path, publicRoot.source),
    adminRootImportsPublicSurface:
      adminRoot === undefined || sourceCrossesSurfaceImport(adminRoot.path, adminRoot.source),
    jobsImportGraphReachesHttpFramework: jobsImportGraphReachesHttpFramework(
      "apps/cloud/src/entrypoints/jobs.ts",
    ),
    handWrittenJsonSchemaAbsent: cloudSources.every(
      ({ source }) => !sourceDeclaresHandWrittenJsonSchema(source),
    ),
    moduleSourceRegistersRoute: moduleSources.some(({ source }) => sourceRegistersModuleRoute(source)),
    preAuthRateLimitBucketSource:
      publicRoot !== undefined && sourceUsesAddressOnlyPreAuthRateLimitBucket(publicRoot.source)
        ? "request.ip"
        : "unverified",
    cookieNamesDisjoint:
      runtime.PUBLIC_SESSION_COOKIE === "gd_session"
      && runtime.STAFF_SESSION_COOKIE === "gd_staff_session"
      && runtime.PUBLIC_SESSION_COOKIE !== runtime.STAFF_SESSION_COOKIE,
  };
}

function inputEvidence() {
  return CLOUD_BOUNDARY_REQUIRED_INPUTS.filter((path) => existsSync(resolve(root, path))).map((path) => {
    const content = readFileSync(resolve(root, path));
    return { path, bytes: content.length, sha256: sha256(content) };
  });
}

function requirementMapping() {
  return {
    r0_09: [
      { requirement: "independent-public-admin-session-scope-route-composition-roots", fields: ["runtimeIsolation", "cookieNamesDisjoint", "routeTables"], produced: true },
      { requirement: "public-session-rejected-on-admin-route", fields: ["errorIdentityMatrix.M7", "errorIdentityMatrix.M8"], produced: true },
      { requirement: "admin-business-routes-and-periodic-jobs-unregistered", fields: ["adminBusinessRoutesRegistered", "periodicJobsRegistered"], produced: true },
      { requirement: "live-cloud-integration", fields: ["runtimeIsolation", "errorIdentityMatrix"], produced: true },
      { requirement: "audit-event-chain-and-head-cas", fields: [], produced: false, reason: "AuditSinkPort records are boundary observations, not an AuditEvent chain." },
      { requirement: "tenant-job-envelope-fan-out-and-replay-matrix", fields: [], produced: false, reason: "P0-31 job runtime is outside this slice." },
    ],
    r0_15: [
      { requirement: "composition-root-static-import-and-registration", fields: ["publicRootImportsStaffSurface", "adminRootImportsPublicSurface", "moduleSourceRegistersRoute"], produced: true },
      { requirement: "admin-http-positive-and-negative-boundary-fixtures", fields: ["inputs:scripts/boundary-policy.test.mjs"], produced: true },
      { requirement: "computed-dynamic-import-rejection", fields: ["validation:dependency-boundary-check"], produced: true },
    ],
    closesGate: false,
  };
}

export async function collectCloudBoundaryReport(options = {}) {
  const runtime = await loadRuntimeModules();
  const artifactDirectory = resolve(root, options.artifactDirectory ?? CLOUD_BOUNDARY_ARTIFACT_DIRECTORY);
  mkdirSync(artifactDirectory, { recursive: true });
  const audit = new runtime.InMemoryAuditSink();
  const publicSessions = [
    "pub-session",
    "pub-cross-session",
    "pub-nope-session",
    "pub-schema-session",
    "pub-large-session",
    "pub-method-session",
    "matrix-rate-session",
    "probe-session-a",
    "probe-session-b",
  ].map((sessionId, index) => ({ sessionId, accountId: `fixture-account-${index + 1}` }));
  const publicApp = runtime.createPublicHttp({
    sessions: new runtime.StaticPublicSessionVerifier(publicSessions),
    rateLimit: runtime.rateLimitPolicy(1_000, 8),
    now: () => new Date("2026-08-15T00:00:00.000Z"),
    correlationIds: ids("public-evidence-correlation"),
    ports: [],
  });
  const adminApp = runtime.createAdminHttp({
    staffSessions: new runtime.StaticStaffSessionVerifier([
      { sessionId: "staff-session", staffId: "owner", scopes: ["admin:boundary:read"] },
      { sessionId: "staff-no-scope", staffId: "owner", scopes: [] },
      { sessionId: "staff-expired", staffId: "owner", scopes: ["admin:boundary:read"], expiresAt: new Date("2026-08-14T00:00:00.000Z") },
    ]),
    audit,
    rateLimit: runtime.rateLimitPolicy(60_000, 100),
    now: () => new Date("2026-08-15T00:00:00.000Z"),
    correlationIds: ids("admin-evidence-correlation"),
  });
  const rateLimitApp = runtime.createPublicHttp({
    sessions: new runtime.StaticPublicSessionVerifier([
      { sessionId: "probe-session-a", accountId: "fixture-probe-account-a" },
      { sessionId: "probe-session-b", accountId: "fixture-probe-account-b" },
    ]),
    rateLimit: runtime.rateLimitPolicy(1_000, 3),
    now: () => new Date("2026-08-15T00:00:00.000Z"),
    correlationIds: ids("rate-limit-evidence-correlation"),
    ports: [],
  });

  let publicUrl;
  let adminUrl;
  let rateLimitUrl;
  try {
    [publicUrl, adminUrl, rateLimitUrl] = await Promise.all([
      publicApp.listen({ host: "127.0.0.1", port: 0 }),
      adminApp.listen({ host: "127.0.0.1", port: 0 }),
      rateLimitApp.listen({ host: "127.0.0.1", port: 0 }),
    ]);
    const observedCases = [];
    const context = { publicUrl, adminUrl, audit };
    const executionOrder = [
      ...matrixCases.filter(({ id }) => id !== "M13"),
      matrixCases.find(({ id }) => id === "M13"),
    ];
    for (const matrixCase of executionOrder) {
      if (matrixCase === undefined) throw new Error("M13 matrix case is required");
      observedCases.push(await requestMatrixCase(matrixCase, context));
    }
    observedCases.sort(
      (left, right) => matrixCases.findIndex(({ id }) => id === left.id)
        - matrixCases.findIndex(({ id }) => id === right.id),
    );
    const normalizedAdminPreAuth = observedCases
      .filter(({ id }) => ["M6", "M7", "M9", "M11", "M15"].includes(id))
      .map(({ rawBody }) => normalizeCorrelation(rawBody));
    const publicRoutes = runtime.registeredRoutesFor(publicApp).map(({ method, path }) => `${method} ${path}`);
    const adminRoutes = runtime.registeredRoutesFor(adminApp).map(({ method, path }) => `${method} ${path}`);
    const publicOpenApi = runtime.openApiDocumentFor(publicApp);
    const adminOpenApi = runtime.openApiDocumentFor(adminApp);
    const publicOpenApiContent = `${JSON.stringify(publicOpenApi, null, 2)}\n`;
    const adminOpenApiContent = `${JSON.stringify(adminOpenApi, null, 2)}\n`;
    writeFileSync(resolve(artifactDirectory, "openapi-public.json"), publicOpenApiContent);
    writeFileSync(resolve(artifactDirectory, "openapi-admin.json"), adminOpenApiContent);
    const publicOpenApiPaths = Object.keys(publicOpenApi.paths);
    const adminOpenApiPaths = Object.keys(adminOpenApi.paths);
    const sharedOpenApiPaths = publicOpenApiPaths.filter((path) => adminOpenApiPaths.includes(path));
    const rateLimitObservation = await observeRateLimit(rateLimitUrl);
    const inputs = inputEvidence();
    const staticEvidence = staticBoundaryEvidence(runtime);

    return {
      schemaVersion: 1,
      scope: CLOUD_BOUNDARY_SCOPE,
      fixtureOnly: true,
      ...staticEvidence,
      runtimeIsolation: {
        publicPort: "ephemeral",
        adminPort: "ephemeral",
        distinctInstances:
          publicApp !== adminApp && new URL(publicUrl).port !== new URL(adminUrl).port,
        sharedRoutePaths: publicRoutes.filter((route) => adminRoutes.includes(route)).length,
      },
      errorIdentityMatrix: {
        expectedCases: 16,
        observedCases: observedCases.length,
        allMatched: observedCases.every(({ matched }) => matched),
        adminPreAuthResponsesIdentical: new Set(normalizedAdminPreAuth).size === 1,
        cases: observedCases.map(({ rawBody: _rawBody, ...observed }) => observed),
      },
      routeTables: { public: publicRoutes, admin: adminRoutes },
      openapi: {
        public: { paths: publicOpenApiPaths.length, sha256: sha256(publicOpenApiContent) },
        admin: { paths: adminOpenApiPaths.length, sha256: sha256(adminOpenApiContent) },
        pathSetsDisjoint: sharedOpenApiPaths.length === 0,
        routePathSetsMatch:
          new Set(publicRoutes.map((route) => route.slice(route.indexOf(" ") + 1))).size === publicOpenApiPaths.length
          && publicOpenApiPaths.every((path) => publicRoutes.some((route) => route.endsWith(` ${path}`)))
          && new Set(adminRoutes.map((route) => route.slice(route.indexOf(" ") + 1))).size === adminOpenApiPaths.length
          && adminOpenApiPaths.every((path) => adminRoutes.some((route) => route.endsWith(` ${path}`))),
      },
      rateLimitBoundary: {
        windowMs: 1_000,
        burst: 3,
        allowedCount: 3,
        overLimitCount: 2,
        ...rateLimitObservation,
        productionStrategyDeferredTo: "P0-19",
      },
      requirementMapping: requirementMapping(),
      requiredInputsPresent: inputs.length === CLOUD_BOUNDARY_REQUIRED_INPUTS.length,
      inputs,
    };
  } finally {
    await Promise.allSettled([publicApp.close(), adminApp.close(), rateLimitApp.close()]);
  }
}

export function cloudBoundaryReportPassesPolicy(report) {
  const expectedCaseIds = matrixCases.map(({ id }) => id);
  const observedCaseIds = report.errorIdentityMatrix?.cases?.map(({ id }) => id) ?? [];
  const inputPaths = report.inputs?.map(({ path }) => path) ?? [];
  return Boolean(
    report.schemaVersion === 1
    && report.scope === CLOUD_BOUNDARY_SCOPE
    && report.fixtureOnly === true
    && report.adminBusinessRoutesRegistered === false
    && report.periodicJobsRegistered === false
    && report.publicRootImportsStaffSurface === false
    && report.adminRootImportsPublicSurface === false
    && report.jobsImportGraphReachesHttpFramework === false
    && report.handWrittenJsonSchemaAbsent === true
    && report.moduleSourceRegistersRoute === false
    && report.preAuthRateLimitBucketSource === "request.ip"
    && report.cookieNamesDisjoint === true
    && report.runtimeIsolation?.publicPort === "ephemeral"
    && report.runtimeIsolation?.adminPort === "ephemeral"
    && report.runtimeIsolation?.distinctInstances === true
    && report.runtimeIsolation?.sharedRoutePaths === 0
    && report.errorIdentityMatrix?.expectedCases === 16
    && report.errorIdentityMatrix?.observedCases === 16
    && report.errorIdentityMatrix?.allMatched === true
    && report.errorIdentityMatrix?.adminPreAuthResponsesIdentical === true
    && JSON.stringify(observedCaseIds) === JSON.stringify(expectedCaseIds)
    && report.errorIdentityMatrix.cases.every(({ matched }) => matched === true)
    && JSON.stringify(report.routeTables?.public) === JSON.stringify(publicRouteTable)
    && JSON.stringify(report.routeTables?.admin) === JSON.stringify(adminRouteTable)
    && report.openapi?.public?.paths === 2
    && /^[0-9a-f]{64}$/.test(report.openapi?.public?.sha256 ?? "")
    && report.openapi?.admin?.paths === 2
    && /^[0-9a-f]{64}$/.test(report.openapi?.admin?.sha256 ?? "")
    && report.openapi?.pathSetsDisjoint === true
    && report.openapi?.routePathSetsMatch === true
    && report.rateLimitBoundary?.windowMs === 1_000
    && report.rateLimitBoundary?.burst === 3
    && report.rateLimitBoundary?.allowedCount === 3
    && report.rateLimitBoundary?.overLimitCount === 2
    && report.rateLimitBoundary?.rotatingCookiesShareAddressBucketObserved === true
    && report.rateLimitBoundary?.resetObserved === true
    && report.rateLimitBoundary?.limitedStatus === 429
    && report.rateLimitBoundary?.absentCookieAfterExhaustionStatus === 429
    && report.rateLimitBoundary?.retryAfterPairingObserved === true
    && report.rateLimitBoundary?.productionStrategyDeferredTo === "P0-19"
    && report.rateLimitBoundary?.probeVerdict === "pass"
    && report.requirementMapping?.closesGate === false
    && report.requirementMapping?.r0_09?.length === 6
    && report.requirementMapping?.r0_15?.length === 3
    && report.requirementMapping.r0_09.filter(({ produced }) => produced === false).length === 2
    && report.requiredInputsPresent === true
    && JSON.stringify(inputPaths) === JSON.stringify(CLOUD_BOUNDARY_REQUIRED_INPUTS)
    && report.inputs.every(
      (input) => input.bytes > 0
        && /^[0-9a-f]{64}$/.test(input.sha256)
        && statSync(resolve(root, input.path)).isFile(),
    )
  );
}

export async function startCloudBoundaryProbeServer() {
  const runtime = await loadRuntimeModules();
  const primaryKey = "fixture-session-a";
  const alternateKey = "fixture-session-b";
  const app = runtime.createPublicHttp({
    sessions: new runtime.StaticPublicSessionVerifier([
      { sessionId: primaryKey, accountId: "fixture-account-a" },
      { sessionId: alternateKey, accountId: "fixture-account-b" },
    ]),
    rateLimit: runtime.rateLimitPolicy(1_000, 3),
    now: () => new Date("2026-08-15T00:00:00.000Z"),
    correlationIds: ids("privileged-probe-correlation"),
    ports: [],
  });
  const url = await app.listen({ host: "127.0.0.1", port: 0 });
  return {
    app,
    target: `${url}/v1/boundary/identity`,
    primaryKey,
    alternateKey,
  };
}

async function serveProbe() {
  const server = await startCloudBoundaryProbeServer();
  console.log(JSON.stringify({
    target: server.target,
    primaryKey: server.primaryKey,
    alternateKey: server.alternateKey,
  }));
  await new Promise((resolveShutdown) => {
    const shutdown = () => resolveShutdown();
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
  await server.app.close();
}

async function main() {
  if (process.argv.includes("--serve-probe")) {
    await serveProbe();
    return;
  }
  const report = await collectCloudBoundaryReport({ artifactDirectory: dirname(defaultOutputPath) });
  mkdirSync(dirname(defaultOutputPath), { recursive: true });
  writeFileSync(defaultOutputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = cloudBoundaryReportPassesPolicy(report) ? 0 : 1;
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
