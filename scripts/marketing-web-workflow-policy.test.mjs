import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const checkoutAction = "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1";
const setupNodeAction = "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020";
export const MARKETING_ALLOWED_EXTERNAL_ORIGINS = Object.freeze([
  "https://fonts.googleapis.com",
  "https://cdn.fontshare.com",
  "https://app.gooddealer.com",
]);
export const FIXED_MARKETING_DEPLOY_COMMAND = "pnpm exec wrangler pages deploy dist --project-name gooddealer-marketing --branch main";

const read = (path) => readFileSync(resolve(root, path), "utf8");
const count = (source, needle) => source.split(needle).length - 1;
const hasExactLines = (source, lines) => lines.every((line) => source.includes(line));
const endOfSource = "(?![\\s\\S])";

function jobBlock(source, name) {
  return source.match(new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [A-Za-z][\\w-]*:\\n|${endOfSource})`, "m"))?.[1] ?? "";
}

function namedStep(job, name) {
  return job.match(new RegExp(`^      - name: ${name}\\n([\\s\\S]*?)(?=^      - |${endOfSource})`, "m"))?.[0] ?? "";
}

function checkoutStep(job) {
  return job.match(new RegExp(`^      - uses: actions/checkout@[^\\n]+\\n[\\s\\S]*?(?=^      - |${endOfSource})`, "m"))?.[0] ?? "";
}

function runBlocks(source) {
  const lines = source.split(/\r?\n/u);
  const blocks = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = line.match(/^(\s*)run:\s*(.*)$/u);
    if (!match) continue;
    const [, indentation, tail] = match;
    if (!/^[|>][+-]?$/u.test(tail.trim())) {
      blocks.push(tail.trim());
      continue;
    }
    const body = [];
    const indent = indentation.length;
    for (index += 1; index < lines.length; index += 1) {
      const next = lines[index];
      if (next.trim() && next.match(/^\s*/u)[0].length <= indent) {
        index -= 1;
        break;
      }
      body.push(next);
    }
    blocks.push(body.join("\n").trim());
  }
  return blocks;
}

function exactSecretReferences(source) {
  return [...source.matchAll(/\bsecrets\.([A-Z0-9_]+)/gu)].map((match) => match[1]);
}

function externalOrigins(source) {
  const withoutJsonLd = source.replace(
    /<script\b(?=[^>]*\btype\s*=\s*["']application\/ld\+json["'])[^>]*>[\s\S]*?<\/script\s*>/giu,
    "",
  );
  const urls = [];
  for (const match of withoutJsonLd.matchAll(/\b(?:src|href)\s*=\s*(["'])(.*?)\1/giu)) urls.push(match[2]);
  for (const match of withoutJsonLd.matchAll(/\burl\(\s*(["']?)(https?:[^'"\s)]+)\1\s*\)/giu)) urls.push(match[2]);
  for (const match of withoutJsonLd.matchAll(/@import\s+(["'])(https?:[^'"\s]+)\1/giu)) urls.push(match[2]);
  return [...new Set(urls
    .filter((url) => /^https?:\/\//u.test(url))
    .map((url) => new URL(url).origin))].sort();
}

export function marketingDeployIsEligible(eventName, ref) {
  return eventName === "push" && ref === "refs/heads/main";
}

export function externalOriginsPassPolicy(origins, allowedOrigins = MARKETING_ALLOWED_EXTERNAL_ORIGINS) {
  const allowed = new Set(allowedOrigins);
  return allowed.size === MARKETING_ALLOWED_EXTERNAL_ORIGINS.length
    && MARKETING_ALLOWED_EXTERNAL_ORIGINS.every((origin) => allowed.has(origin))
    && origins.every((origin) => allowed.has(origin));
}

export function staticAssetClosurePassesPolicy(markup, knownLocalAssets = new Set()) {
  if (/data:\s*image\/svg(?:\+xml)?/iu.test(markup)) return false;
  for (const match of markup.matchAll(/\b(?:src|href)\s*=\s*(["'])(.*?)\1/giu)) {
    const reference = match[2];
    if (!reference || reference.startsWith("#") || /^(?:https?:|mailto:|tel:)/iu.test(reference)) continue;
    if (reference.startsWith("//") || reference.startsWith("data:")) return false;
    const path = reference.split(/[?#]/u, 1)[0];
    if (path.includes("../")) return false;
    if (path.startsWith("/") && knownLocalAssets.size > 0 && !knownLocalAssets.has(path)) return false;
  }
  return true;
}

export function marketingWorkflowPassesPolicy(workflow, readme) {
  const check = jobBlock(workflow, "check");
  const deploy = jobBlock(workflow, "deploy");
  const deployStep = namedStep(deploy, "Deploy to Cloudflare Pages");
  const checkCheckout = checkoutStep(check);
  const deployCheckout = checkoutStep(deploy);
  const secrets = exactSecretReferences(workflow);
  const runs = runBlocks(workflow);
  const deployRuns = runBlocks(deployStep);

  const topLevelPermissions = workflow.match(/^permissions:\n([\s\S]*?)(?=^[A-Za-z][\w-]*:|\Z)/m)?.[1] ?? "";
  const exactSecretEnvironment = /^        env:\n          CLOUDFLARE_API_TOKEN: \$\{\{ secrets\.CLOUDFLARE_API_TOKEN \}\}\n          CLOUDFLARE_ACCOUNT_ID: \$\{\{ secrets\.CLOUDFLARE_ACCOUNT_ID \}\}$/mu;
  const hasUnsafeRunContent = runs.some((run) => /\$\{\{|\b(?:github\.(?:event|ref|sha)|inputs\.)\b|\$\(|`|\$(?:\{)?[A-Za-z_][A-Za-z0-9_]*(?:\})?/u.test(run));
  const hasSecretDisclosure = runs.some((run) => /\b(?:echo|printf|printenv|env)\b[^\n]*(?:CLOUDFLARE_(?:API_TOKEN|ACCOUNT_ID)|secrets\.)/iu.test(run));
  const hasMaskedRunFailure = runs.some((run) => /\|\||\bset\s+\+e\b/iu.test(run));
  const unsupportedReadmeClaim = /idempotent(?:ly)?\s+(?:Pages\s+)?project\s+creat|Cloudflare never builds the repo|production[- ]ready|Cloudflare\s+(?:project|account|API|Pages|deployment)\b[^.\n]*(?:is|are|has|have|exists|available|configured|verified|bound|authorized|accepted|served|serving)\b|(?:rollback|monitoring|incident response)\b[^.\n]*(?:is|are|has|have|exists|available|configured|exercised|ready)\b/iu;

  return Boolean(check && deploy && deployStep)
    && /^  workflow_dispatch:\s*$/mu.test(workflow)
    && !/^    inputs:/mu.test(workflow)
    && !/\bpull_request_target\s*:/u.test(workflow)
    && /^  pull_request:/mu.test(workflow)
    && /^  push:/mu.test(workflow)
    && /^    branches: \[main\]$/mu.test(workflow)
    && !/^    tags:/mu.test(workflow)
    && count(workflow, "scripts/marketing-web-workflow-policy.test.mjs") === 3
    && hasExactLines(workflow, [checkoutAction, setupNodeAction])
    && count(check, "actions/checkout@") === 1
    && count(deploy, "actions/checkout@") === 1
    && checkCheckout.includes("persist-credentials: false")
    && deployCheckout.includes("persist-credentials: false")
    && checkCheckout.includes("ref: ${{ github.event.pull_request.head.sha || github.sha }}")
    && deployCheckout.includes("ref: ${{ github.sha }}")
    && topLevelPermissions.trim() === "contents: read"
    && !/^  permissions:/mu.test(workflow)
    && /^    needs: check$/mu.test(deploy)
    && /^    if: \$\{\{ github\.event_name == 'push' && github\.ref == 'refs\/heads\/main' \}\}$/mu.test(deploy)
    && count(deploy, "github.event_name") === 1
    && count(deploy, "github.ref") === 1
    && secrets.length === 2
    && secrets.includes("CLOUDFLARE_API_TOKEN")
    && secrets.includes("CLOUDFLARE_ACCOUNT_ID")
    && exactSecretEnvironment.test(deployStep)
    && deployRuns.length === 1
    && deployRuns[0] === FIXED_MARKETING_DEPLOY_COMMAND
    && deploy.indexOf("pnpm install --frozen-lockfile") < deploy.indexOf("pnpm --filter @gooddealer/marketing-web build")
    && deploy.indexOf("pnpm --filter @gooddealer/marketing-web build") < deploy.indexOf(FIXED_MARKETING_DEPLOY_COMMAND)
    && !/actions\/download-artifact|wrangler\s+pages\s+project\s+create|continue-on-error\s*:/iu.test(workflow)
    && !/github\.event\.inputs|\binputs\.[A-Za-z_]/u.test(workflow)
    && !hasUnsafeRunContent
    && !hasSecretDisclosure
    && !hasMaskedRunFailure
    && !unsupportedReadmeClaim.test(readme)
    && [
      "GitHub protected-main/review rules",
      "environment protection/approval",
      "Cloudflare project identity",
      "artifact acceptance and serving",
      "rollback, monitoring, and incident response",
    ].every((limitation) => readme.includes(limitation));
}

export function marketingStaticSurfacePassesPolicy({ aggregate, astroConfig, markup, knownLocalAssets }) {
  return !/innerHTML|outerHTML|insertAdjacentHTML|document\.write|data:\s*image\/svg(?:\+xml)?/iu.test(aggregate)
    && aggregate.includes("document.createElementNS")
    && aggregate.includes("textContent")
    && aggregate.includes("replaceChildren")
    && /assetsInlineLimit:\s*0/u.test(astroConfig)
    && staticAssetClosurePassesPolicy(markup, knownLocalAssets)
    && externalOriginsPassPolicy(externalOrigins(markup));
}

const workflow = read(".github/workflows/marketing-web.yml");
const readme = read("apps/marketing-web/README.md");
const aggregate = read("apps/marketing-web/src/components/showcase/AggregateAnim.astro");
const astroConfig = read("apps/marketing-web/astro.config.mjs");

test("marketing workflow permits only a main push to reach deployment", () => {
  assert.equal(marketingWorkflowPassesPolicy(workflow, readme), true);
  for (const [eventName, ref] of [
    ["workflow_dispatch", "refs/heads/main"],
    ["workflow_dispatch", "refs/heads/unreviewed"],
    ["pull_request", "refs/pull/1/merge"],
    ["push", "refs/heads/preview"],
    ["push", "refs/tags/v1.0.0"],
    ["push", "0123456789abcdef0123456789abcdef01234567"],
  ]) assert.equal(marketingDeployIsEligible(eventName, ref), false, `${eventName} ${ref}`);
  assert.equal(marketingDeployIsEligible("push", "refs/heads/main"), true);
});

test("workflow policy rejects provenance, deployment-target, secret, input, and failure-masking mutations", () => {
  const mutations = [
    ["manual deployment", (source) => source.replace("github.ref == 'refs/heads/main'", "github.ref == 'refs/heads/main' || github.event_name == 'workflow_dispatch'")],
    ["PR deployment", (source) => source.replace("github.event_name == 'push'", "github.event_name == 'pull_request'")],
    ["tag deployment", (source) => source.replace("github.ref == 'refs/heads/main'", "startsWith(github.ref, 'refs/tags/')")],
    ["non-main deployment", (source) => source.replace("github.ref == 'refs/heads/main'", "startsWith(github.ref, 'refs/heads/')")],
    ["dispatch inputs", (source) => source.replace("  workflow_dispatch:\n", "  workflow_dispatch:\n    inputs:\n      branch:\n        required: true\n")],
    ["missing deploy checkout ref", (source) => source.replace("          ref: ${{ github.sha }}\n", "")],
    ["branch deploy checkout", (source) => source.replace("ref: ${{ github.sha }}", "ref: refs/heads/main")],
    ["caller-controlled deploy checkout", (source) => source.replace("ref: ${{ github.sha }}", "ref: ${{ github.event.inputs.ref }}")],
    ["checkout credentials", (source) => source.replace("persist-credentials: false", "persist-credentials: true")],
    ["extra permissions", (source) => source.replace("permissions:\n  contents: read", "permissions:\n  contents: read\n  actions: write")],
    ["global secret", (source) => source.replace("env:\n  CI: true", "env:\n  CI: true\n  FORGED: ${{ secrets.CLOUDFLARE_API_TOKEN }}")],
    ["secret echo", (source) => source.replace(
      `run: ${FIXED_MARKETING_DEPLOY_COMMAND}`,
      `run: |\n          ${FIXED_MARKETING_DEPLOY_COMMAND}\n          echo \"$CLOUDFLARE_API_TOKEN\"`,
    )],
    ["run ref variable", (source) => source.replace(
      "run: pnpm --filter @gooddealer/marketing-web build",
      "run: >-\n          echo $GITHUB_REF\n          pnpm --filter @gooddealer/marketing-web build",
    )],
    ["input to shell", (source) => source.replace("--branch main", "--branch ${{ inputs.branch }}")],
    ["command substitution", (source) => source.replace("deploy dist", "deploy $(pwd)/dist")],
    ["target directory", (source) => source.replace("deploy dist", "deploy output")],
    ["target project", (source) => source.replace("--project-name gooddealer-marketing", "--project-name caller-selected")],
    ["target branch", (source) => source.replace("--branch main", "--branch preview")],
    ["project creation", (source) => source.replace(
      `run: ${FIXED_MARKETING_DEPLOY_COMMAND}`,
      `run: |\n          pnpm exec wrangler pages project create gooddealer-marketing\n          ${FIXED_MARKETING_DEPLOY_COMMAND}`,
    )],
    ["generic masking", (source) => source.replace(FIXED_MARKETING_DEPLOY_COMMAND, `${FIXED_MARKETING_DEPLOY_COMMAND} || true`)],
    ["shell error masking", (source) => source.replace(FIXED_MARKETING_DEPLOY_COMMAND, `set +e\n          ${FIXED_MARKETING_DEPLOY_COMMAND}`)],
    ["workflow error masking", (source) => source.replace("timeout-minutes: 15", "timeout-minutes: 15\n    continue-on-error: true")],
    ["artifact promotion", (source) => source.replace("      - name: Build @gooddealer/marketing-web\n        run: pnpm --filter @gooddealer/marketing-web build", "      - uses: actions/download-artifact@v7\n      - name: Build @gooddealer/marketing-web\n        run: pnpm --filter @gooddealer/marketing-web build")],
    ["missing check dependency", (source) => source.replace("    needs: check\n", "")],
  ];
  for (const [name, mutate] of mutations) assert.equal(marketingWorkflowPassesPolicy(mutate(workflow), readme), false, name);
});

test("README rejects unsupported provider, rollback, and monitoring claims", () => {
  for (const claim of [
    "\nCloudflare project is configured.\n",
    "\nRollback is available.\n",
    "\nMonitoring is configured.\n",
    "\nThe Pages project has idempotent project creation.\n",
  ]) assert.equal(marketingWorkflowPassesPolicy(workflow, `${readme}${claim}`), false, claim);
});

test("static surface allows exactly the declared origins and ignores JSON-LD metadata", () => {
  const markup = [
    '<script type="application/ld+json">{"@context":"https://schema.org","@type":"WebSite"}</script>',
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono">',
    "<style>@font-face{src:url('https://cdn.fontshare.com/font.woff2')}</style>",
    '<a href="https://app.gooddealer.com">Sign in</a>',
    '<img src="/_astro/mark.svg">',
  ].join("\n");
  const knownLocalAssets = new Set(["/_astro/mark.svg"]);
  assert.deepEqual(externalOrigins(markup), [...MARKETING_ALLOWED_EXTERNAL_ORIGINS].sort());
  assert.equal(marketingStaticSurfacePassesPolicy({ aggregate, astroConfig, markup, knownLocalAssets }), true);
  assert.equal(marketingStaticSurfacePassesPolicy({
    aggregate,
    astroConfig,
    markup: `${markup}<script src="https://fourth-origin.invalid/app.js"></script>`,
    knownLocalAssets,
  }), false);
  assert.equal(staticAssetClosurePassesPolicy('<img src="data:image/svg+xml;base64,PHN2Zy8+">'), false);
  assert.equal(staticAssetClosurePassesPolicy('<img src="/missing.svg">', knownLocalAssets), false);
});

test("static surface rejects DOM sink, data-SVG, and emitted-asset policy regressions", () => {
  const markup = '<img src="/_astro/mark.svg">';
  const knownLocalAssets = new Set(["/_astro/mark.svg"]);
  for (const sink of ["innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "data:image/svg+xml"]) {
    assert.equal(marketingStaticSurfacePassesPolicy({
      aggregate: `${aggregate}\n${sink}`,
      astroConfig,
      markup,
      knownLocalAssets,
    }), false, sink);
  }
  assert.equal(marketingStaticSurfacePassesPolicy({
    aggregate,
    astroConfig: astroConfig.replace("assetsInlineLimit: 0", "assetsInlineLimit: 4096"),
    markup,
    knownLocalAssets,
  }), false);
});
