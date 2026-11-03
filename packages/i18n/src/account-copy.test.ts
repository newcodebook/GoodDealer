import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { accountPresentations } from "./account-copy-types";
import { getAccountCopy } from "./account-copy";
import {
  accountPresentationCopyInventory,
  reconciledAccountExactBrandCopyKeyCount,
  reconciledAccountLocaleKeyCount,
  reconciledAccountPresentationCount,
} from "./account-presentation-inventory";
import { enUSAccount } from "./locales/account-en-us";
import { zhCNAccount } from "./locales/account-zh-cn";

describe("Account Web copy", () => {
  it("keeps locale keys complete and reconciles character-exact brand copy", () => {
    let localeKeyCount = 0;
    let exactBrandCopyKeyCount = 0;
    expect(accountPresentations.length).toBe(reconciledAccountPresentationCount);
    for (const presentation of accountPresentations) {
      const zhKeys = Object.keys(zhCNAccount[presentation]);
      const inventory = accountPresentationCopyInventory[presentation];
      const source = readFileSync(
        resolve(import.meta.dirname, "../../../brand/ui_kits/account-web", inventory.source),
        "utf8",
      );
      // Values under three characters ("中", "取消") match kit source by accident, so they never count.
      const exactKeys = Object.values(zhCNAccount[presentation]).filter((value) => value.length >= 3 && source.includes(value));
      expect(Object.keys(enUSAccount[presentation]), presentation).toEqual(zhKeys);
      expect(zhKeys.length, presentation).toBe(inventory.localeKeyCount);
      expect(exactKeys.length, presentation).toBe(inventory.exactBrandCopyKeys);
      localeKeyCount += zhKeys.length;
      exactBrandCopyKeyCount += exactKeys.length;
    }
    expect(localeKeyCount).toBe(reconciledAccountLocaleKeyCount);
    expect(exactBrandCopyKeyCount).toBe(reconciledAccountExactBrandCopyKeyCount);
  });

  it("rejects unknown presentations and locales", () => {
    expect(() => getAccountCopy("zh-CN", "signIn" as never)).toThrow(TypeError);
    expect(() => getAccountCopy("fr-FR" as never, "accountAccess")).toThrow();
  });

  it("states Identity's anti-enumeration and password custody semantics", () => {
    const zh = getAccountCopy("zh-CN", "accountAccess");
    const en = getAccountCopy("en-US", "accountAccess");
    // Responses must not reveal whether an email is registered.
    expect(zh.verificationSent).toContain("如果该邮箱");
    expect(zh.resetSent).toContain("如果该邮箱");
    expect(en.resetSent).toContain("If this email");
    expect(zh.passwordTrust).toContain("不保存在浏览器");
    expect(en.passwordTrust).toContain("never stored in the browser");
  });

  it("states the commercial terms the License and Billing pages promise", () => {
    const license = getAccountCopy("zh-CN", "accountLicense");
    const licenseEn = getAccountCopy("en-US", "accountLicense");
    // The 10-year term is prepaid and never perpetual; refunds are one-time and switch to read-only.
    expect(license.tenYearNote).toContain("非永久");
    expect(licenseEn.tenYearNote).toContain("not perpetual");
    expect(license.checkoutTerms).toContain("14 天");
    expect(license.refundBody).toContain("只读");
    // Payment custody is stated where payment happens (Billing), not on the sign-in page.
    expect(getAccountCopy("zh-CN", "accountBilling").custodyCardsValue).toContain("不经过 GoodDealer");
    expect(getAccountCopy("en-US", "accountBilling").custodyCardsValue).toContain("Never pass through GoodDealer");
    // Kit content without a product capability must not reappear as copy.
    const all = JSON.stringify([license, getAccountCopy("zh-CN", "accountDevices"), getAccountCopy("zh-CN", "accountBilling")]);
    for (const absent of ["LocalContinuation", "配对码", "轮换密钥", "下载证书", "本地密钥签发"]) expect(all).not.toContain(absent);
  });
});
