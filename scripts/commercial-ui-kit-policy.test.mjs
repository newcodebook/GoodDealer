import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import test from "node:test";
import vm from "node:vm";

const repositoryRoot = resolve(import.meta.dirname, "..");
const uiKitRoots = [
  "brand/ui_kits/account-web",
  "brand/ui_kits/admin-web",
];
const currentStateExtensions = new Set([".js", ".jsx"]);

function sourceFiles(root) {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && currentStateExtensions.has(extname(entry.name)))
    .map((entry) => join(entry.parentPath, entry.name));
}

const currentStateFiles = uiKitRoots.flatMap((path) => sourceFiles(join(repositoryRoot, path)));
const bundlePath = "brand/_ds_bundle.js";

function source(path) {
  return readFileSync(join(repositoryRoot, path), "utf8");
}

function currentStateSource() {
  return currentStateFiles
    .map((path) => `\n/* ${relative(repositoryRoot, path)} */\n${readFileSync(path, "utf8")}`)
    .join("");
}

test("tracked design-system bundle is reproducible from current sources", () => {
  const result = spawnSync(
    process.execPath,
    ["scripts/generate-brand-design-system-bundle.mjs", "--check"],
    { cwd: repositoryRoot, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const bundle = source(bundlePath);
  const window = {};
  const React = {
    Fragment: Symbol("Fragment"),
    createElement: (...args) => ({ args }),
  };
  vm.runInNewContext(bundle, { React, window }, { filename: bundlePath });
  assert.equal(window.GoodDealerDesignSystem_b5b0b6.__errors.length, 0);
});

test("every UI-kit page loads the generated bundle before its local sources", () => {
  const uiKitRoot = join(repositoryRoot, "brand/ui_kits");
  const pages = readdirSync(uiKitRoot, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".html"))
    .map((entry) => join(entry.parentPath, entry.name));
  assert.ok(pages.length > 0);

  for (const page of pages) {
    const html = readFileSync(page, "utf8");
    const bundleIndex = html.indexOf('../../_ds_bundle.js');
    assert.notEqual(bundleIndex, -1, `${relative(repositoryRoot, page)} must load _ds_bundle.js`);
    assert.equal(
      html.indexOf('../../_ds_bundle.js', bundleIndex + 1),
      -1,
      `${relative(repositoryRoot, page)} must load _ds_bundle.js exactly once`,
    );
    for (const match of html.matchAll(/<script\b[^>]*\bsrc="\.\/[^"]+\.(?:js|jsx)"[^>]*>/gu)) {
      assert.ok(
        match.index > bundleIndex,
        `${relative(repositoryRoot, page)} must load ${match[0]} after _ds_bundle.js`,
      );
    }
  }
});

test("commercial UI kits show the accepted single-tier prices and Stripe-hosted launch checkout", () => {
  const accountLicense = source("brand/ui_kits/account-web/License.jsx");
  const adminLicenses = source("brand/ui_kits/admin-web/Licenses.jsx");

  for (const acceptedTerm of ["月付", "年付", "10 年固定期"]) {
    assert.ok(accountLicense.includes(acceptedTerm), `account License must show ${acceptedTerm}`);
    assert.ok(adminLicenses.includes(acceptedTerm), `admin Licenses must show ${acceptedTerm}`);
  }
  for (const acceptedPrice of ["9.8", "98", "498"]) {
    assert.ok(accountLicense.includes(`price:${acceptedPrice}`), `account License must encode USD ${acceptedPrice}`);
  }
  assert.match(adminLicenses, /月付 · USD 9\.80/u);
  assert.match(adminLicenses, /年付 · USD 98/u);
  assert.match(adminLicenses, /10 年固定期 · USD 498/u);
  assert.match(accountLicense, /Stripe 托管结账/u);
  assert.doesNotMatch(accountLicense, /PayPal/u);
  assert.match(accountLicense, /优惠码（可选）/u);
});

test("account UI keeps payment credentials on hosted Provider pages", () => {
  const accountSource = [
    source("brand/ui_kits/account-web/License.jsx"),
    source("brand/ui_kits/account-web/Billing.jsx"),
    source("brand/ui_kits/account-web/data.js"),
  ].join("\n");

  assert.match(accountSource, /GoodDealer 不采集卡号或付款账户资料/u);
  assert.match(accountSource, /GoodDealer 不采集卡号、安全码或付款账户资料/u);
  assert.match(accountSource, /Stripe/u);
  assert.doesNotMatch(accountSource, /PayPal/u);
  assert.doesNotMatch(
    accountSource,
    /<(?:[A-Z]\w*Input|input)\b[^>]*(?:label|placeholder)=["'][^"']*(?:卡号|持卡人|有效期|CVC|CVV|card number|cardholder|expiry)/iu,
  );
  assert.doesNotMatch(accountSource, /(?:Visa|Mastercard|Amex|UnionPay)\s*[·*]?\s*\d{4}/iu);
});

test("current-state mocks exclude obsolete tiers, trial state, and permanent commercial terms", () => {
  const allSource = `${currentStateSource()}\n${source(bundlePath)}`;

  assert.doesNotMatch(allSource, /\b(?:Starter|Professional|Portfolio)\b/u);
  assert.doesNotMatch(allSource, /\btrial\b|试用中|试用转化|试用客户|默认试用/u);
  assert.doesNotMatch(allSource, /lifetime|永久买断|永久方案|终身许可|赠送（comp）/iu);
  assert.doesNotMatch(allSource, /(?:price|amount|mrr):(?:24\.9|74\.9|8\.3|199|299|599)\b/u);
});

test("generated bundle retains the accepted commercial checkout contract", () => {
  const bundle = source(bundlePath);

  assert.match(bundle, /月付[^\n]+price: 9\.8/u);
  assert.match(bundle, /年付[^\n]+price: 98/u);
  assert.match(bundle, /10 年固定期[^\n]+price: 498/u);
  assert.match(bundle, /Stripe 托管结账/u);
  assert.doesNotMatch(bundle, /PayPal/u);
  assert.match(bundle, /优惠码（可选）/u);
  assert.match(bundle, /首次付费购买可在付款后 14 天内全额退款，续费不重置窗口/u);
  assert.doesNotMatch(bundle, /amount:\s*299|price:\s*299|\$299/u);
});

test("launch-facing payment surfaces expose Stripe only", () => {
  const launchSource = [
    source("apps/account-web/public/index.html"),
    source("apps/account-web/src/browser.ts"),
    source("apps/marketing-web/src/data/en.ts"),
    source("apps/marketing-web/src/data/zh.ts"),
    currentStateSource(),
    source(bundlePath),
  ].join("\n");

  assert.match(launchSource, /Stripe/u);
  assert.doesNotMatch(launchSource, /PayPal/u);
});

test("refund eligibility is independent of license status and renewals do not reset it", () => {
  const adminData = source("brand/ui_kits/admin-web/data.js");
  const accountLicense = source("brand/ui_kits/account-web/License.jsx");
  const adminRevenue = source("brand/ui_kits/admin-web/Revenue.jsx");

  assert.match(adminData, /refundEligible:92/u);
  assert.match(adminData, /status:"active"[^\n]+refundUntil:/u);
  assert.doesNotMatch(adminData, /status:"trial"/u);
  assert.match(accountLicense, /首次付费购买可在付款后 14 天内全额退款，续费不重置窗口/u);
  assert.match(adminRevenue, /仅首次付费购买在购买后 14 天内享全额退款；续费不会重置该窗口/u);
});
