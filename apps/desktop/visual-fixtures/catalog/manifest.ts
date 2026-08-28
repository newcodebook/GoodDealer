export const visualFixtureCanary = "GD_D_UI_V1_VISUAL_FIXTURES";

export const dUiV1Presentations = [
  "shell",
  "activation",
  "asset-list",
  "asset-detail",
  "cloudflare-connection",
  "zone-dns-observation",
] as const;

export type DUiV1Presentation = (typeof dUiV1Presentations)[number];
export type FixtureCaptureStatus = "pending" | "captured" | "verified";

export interface VisualFixtureCase {
  readonly id: string;
  readonly state: string;
  readonly locale: "en-US" | "zh-CN";
  readonly fixtureIntent: string;
  readonly actions: readonly string[];
  readonly screenshot: { readonly file: string; readonly captureStatus: FixtureCaptureStatus; readonly sha256: string | null };
}

export interface VisualFixturePresentation {
  readonly presentation: DUiV1Presentation;
  readonly productionSource: string;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly cases: readonly VisualFixtureCase[];
}

export interface VisualFixtureManifest {
  readonly schemaVersion: 1;
  readonly canary: typeof visualFixtureCanary;
  readonly catalogIntent: "synthetic-local-qa-only";
  readonly presentations: readonly VisualFixturePresentation[];
}

function record(value: unknown, path: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError(`${path} must be an object`);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], path: string): void {
  const expected = new Set(keys);
  if (Object.keys(value).some((key) => !expected.has(key)) || keys.some((key) => !(key in value))) {
    throw new TypeError(`${path} has missing or unknown fields`);
  }
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) throw new TypeError(`${path} must be a bounded non-empty string`);
  if (/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(value)) throw new TypeError(`${path} contains unsafe controls`);
  return value;
}

function parseCase(value: unknown, path: string): VisualFixtureCase {
  record(value, path);
  exactKeys(value, ["id", "state", "locale", "fixtureIntent", "actions", "screenshot"], path);
  const id = text(value["id"], `${path}.id`);
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(id)) throw new TypeError(`${path}.id is invalid`);
  const locale = value["locale"];
  if (locale !== "en-US" && locale !== "zh-CN") throw new TypeError(`${path}.locale is invalid`);
  if (!Array.isArray(value["actions"]) || value["actions"].some((action) => typeof action !== "string")) throw new TypeError(`${path}.actions is invalid`);
  record(value["screenshot"], `${path}.screenshot`);
  exactKeys(value["screenshot"], ["file", "captureStatus", "sha256"], `${path}.screenshot`);
  const file = text(value["screenshot"]["file"], `${path}.screenshot.file`);
  if (file !== `screenshots/${id}.png`) throw new TypeError(`${path}.screenshot.file must derive from id`);
  const captureStatus = value["screenshot"]["captureStatus"];
  if (captureStatus !== "pending" && captureStatus !== "captured" && captureStatus !== "verified") throw new TypeError(`${path}.screenshot.captureStatus is invalid`);
  const sha256 = value["screenshot"]["sha256"];
  if (sha256 !== null && (typeof sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(sha256))) throw new TypeError(`${path}.screenshot.sha256 is invalid`);
  if ((captureStatus === "pending") !== (sha256 === null)) throw new TypeError(`${path}.screenshot evidence is inconsistent`);
  return { id, state: text(value["state"], `${path}.state`), locale, fixtureIntent: text(value["fixtureIntent"], `${path}.fixtureIntent`), actions: value["actions"] as readonly string[], screenshot: { file, captureStatus, sha256 } };
}

export function parseVisualFixtureManifest(value: unknown): VisualFixtureManifest {
  record(value, "manifest");
  exactKeys(value, ["schemaVersion", "canary", "catalogIntent", "presentations"], "manifest");
  if (value["schemaVersion"] !== 1 || value["canary"] !== visualFixtureCanary) throw new TypeError("manifest version/canary is invalid");
  if (value["catalogIntent"] !== "synthetic-local-qa-only") throw new TypeError("manifest intent is invalid");
  if (!Array.isArray(value["presentations"]) || value["presentations"].length !== dUiV1Presentations.length) throw new TypeError("manifest must contain the exact D-UI-V1 presentation set");
  const presentations = value["presentations"].map((item, index): VisualFixturePresentation => {
    const path = `manifest.presentations[${index}]`;
    record(item, path);
    exactKeys(item, ["presentation", "productionSource", "viewport", "cases"], path);
    if (!dUiV1Presentations.includes(item["presentation"] as DUiV1Presentation)) throw new TypeError(`${path}.presentation is invalid`);
    const productionSource = text(item["productionSource"], `${path}.productionSource`);
    if (!productionSource.startsWith("apps/desktop/src/") || productionSource.includes("visual-fixtures")) throw new TypeError(`${path}.productionSource is invalid`);
    record(item["viewport"], `${path}.viewport`);
    exactKeys(item["viewport"], ["width", "height"], `${path}.viewport`);
    const width = item["viewport"]["width"];
    const height = item["viewport"]["height"];
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)) throw new TypeError(`${path}.viewport is invalid`);
    if (!Array.isArray(item["cases"]) || item["cases"].length === 0) throw new TypeError(`${path}.cases is invalid`);
    return { presentation: item["presentation"] as DUiV1Presentation, productionSource, viewport: { width: width as number, height: height as number }, cases: item["cases"].map((fixtureCase, caseIndex) => parseCase(fixtureCase, `${path}.cases[${caseIndex}]`)) };
  });
  if (presentations.some((item, index) => item.presentation !== dUiV1Presentations[index])) throw new TypeError("manifest presentation order is invalid");
  const ids = presentations.flatMap(({ cases }) => cases.map(({ id }) => id));
  if (new Set(ids).size !== ids.length) throw new TypeError("manifest case ids are not globally unique");
  return { schemaVersion: 1, canary: visualFixtureCanary, catalogIntent: "synthetic-local-qa-only", presentations };
}

export function assertExactScreenshotFileSet(manifest: VisualFixtureManifest, actualFiles: readonly string[]): void {
  const expected = manifest.presentations.flatMap(({ cases }) => cases.map(({ id }) => `${id}.png`)).sort();
  const actual = [...actualFiles].sort();
  if (expected.length !== actual.length || expected.some((file, index) => file !== actual[index])) throw new TypeError("screenshot directory must contain exactly the declared PNG set");
}
