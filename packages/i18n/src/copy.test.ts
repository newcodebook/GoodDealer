import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  capabilityNamespaces,
  desktopPresentations,
  parseCapabilityNamespace,
  parseDesktopPresentation,
  parseLocale,
  type CapabilityNamespace,
  type DesktopPresentation,
  type Locale,
  type LocalizedCopy,
} from "./copy-types";
import {
  capabilityCopy,
  desktopCopy,
  getCapabilityCopy,
  getPresentationCopy,
} from "./copy";
import { resolvedCopyDecisions } from "./copy-decisions";
import { enUS, enUSCapabilityCopy } from "./locales/en-us";
import { zhCN, zhCNCapabilityCopy } from "./locales/zh-cn";
import {
  presentationCopyInventory,
  reconciledExactEnUSBrandCopyKeyCount,
  reconciledExactBrandCopyKeyCount,
  reconciledLocaleKeyCount,
  reconciledPresentationCount,
} from "./presentation-inventory";

const exactLatestPresentationSet = [
  "shell",
  "assetLibrary",
  "batchOperation",
  "conflictCenter",
  "manualTaskInbox",
  "settings",
  "operationHistory",
  "salesDesk",
  "activation",
  "dnsVerification",
  "renewalDesk",
  "domainDetail",
  "signIn",
] as const;

const deletedVisualIdentifiers = [
  ["backup", "Restore"].join(""),
  ["browser", "Handoff"].join(""),
  ["command", "Palette"].join(""),
  ["csv", "Import"].join(""),
  ["emergency", "Delisting"].join(""),
  ["forced", "Switch"].join(""),
  ["locked", "Entitlement"].join(""),
  ["network", "Status"].join(""),
  ["recovery", "Center"].join(""),
  ["recovery", "Scan"].join(""),
] as const;

const forbiddenSemanticCopy = [
  "本地密钥签发 ActiveDeviceLease",
  "生成本地密钥并激活",
  "已签发 ActiveDeviceLease",
  "一个账户最多绑定 2 台执行设备",
  "一个账户，最多绑定 2 台执行设备",
  "凭据经本地密钥加密，永不上云",
  "Up to 2 execution devices per account",
  "One account, up to 2 execution devices",
  "Credentials are encrypted by a local key. Never uploaded.",
  "Sunset · LocalContinuation 本地只读延续 · 无执行权",
] as const;

describe("desktop copy contract", () => {
  it("exposes exactly the latest 13 visual presentations in both locales", () => {
    expect(desktopPresentations).toEqual(exactLatestPresentationSet);
    expect(desktopPresentations).toHaveLength(reconciledPresentationCount);
    expect(Object.keys(desktopCopy["zh-CN"]).sort()).toEqual(
      [...desktopPresentations].sort(),
    );
    expect(Object.keys(desktopCopy["en-US"]).sort()).toEqual(
      [...desktopPresentations].sort(),
    );
    expect(Object.keys(presentationCopyInventory)).toEqual(desktopPresentations);

    const inventory = JSON.stringify(presentationCopyInventory);
    for (const deleted of deletedVisualIdentifiers) {
      expect(inventory).not.toContain(deleted);
      expect(desktopPresentations).not.toContain(deleted);
    }
  });

  it("keeps locale keys complete and reconciles character-exact brand copy", () => {
    let localeKeyCount = 0;
    let exactBrandCopyKeyCount = 0;
    let exactEnUSBrandCopyKeyCount = 0;

    for (const presentation of desktopPresentations) {
      const zhKeys = Object.keys(zhCN[presentation]);
      const enKeys = Object.keys(enUS[presentation]);
      const inventory = presentationCopyInventory[presentation];
      const source = readFileSync(
        resolve(import.meta.dirname, "../../../brand/ui_kits/desktop", inventory.source),
        "utf8",
      );
      const exactKeys = Object.values(zhCN[presentation]).filter((value) =>
        source.includes(value),
      );

      expect(enKeys, presentation).toEqual(zhKeys);
      expect(zhKeys.length, presentation).toBe(inventory.localeKeyCount);
      expect(exactKeys.length, presentation).toBe(inventory.exactBrandCopyKeys);
      localeKeyCount += zhKeys.length;
      exactBrandCopyKeyCount += exactKeys.length;

      if ("exactEnUSBrandCopyKeys" in inventory) {
        const exactEnglishKeys = Object.values(enUS[presentation]).filter((value) =>
          source.includes(value),
        );
        expect(exactEnglishKeys.length, presentation).toBe(
          inventory.exactEnUSBrandCopyKeys,
        );
        exactEnUSBrandCopyKeyCount += exactEnglishKeys.length;
      }
    }

    expect(localeKeyCount).toBe(reconciledLocaleKeyCount);
    expect(exactBrandCopyKeyCount).toBe(reconciledExactBrandCopyKeyCount);
    expect(exactEnUSBrandCopyKeyCount).toBe(reconciledExactEnUSBrandCopyKeyCount);
  });

  it("keeps hidden system copy under complete capability namespaces", () => {
    expect(Object.keys(capabilityCopy["zh-CN"])).toEqual(capabilityNamespaces);
    expect(Object.keys(capabilityCopy["en-US"])).toEqual(capabilityNamespaces);

    for (const namespace of capabilityNamespaces) {
      expect(Object.keys(enUSCapabilityCopy[namespace])).toEqual(
        Object.keys(zhCNCapabilityCopy[namespace]),
      );
    }

    expect(getCapabilityCopy("zh-CN", "recovery").frozenDescription).toContain(
      "只能检查平台状态",
    );
    expect(getCapabilityCopy("en-US", "browserAutomation").noSecretReadback).toContain(
      "never reads",
    );
  });

  it("rejects unknown locales, presentations, and capability namespaces", () => {
    expect(() => parseLocale("fr-FR")).toThrow("Unsupported locale");
    expect(() => parseLocale(null)).toThrow("Unsupported locale");
    expect(() => parseDesktopPresentation("not-a-page")).toThrow(
      "Unknown desktop presentation",
    );
    expect(() => parseCapabilityNamespace("settings")).toThrow(
      "Unknown capability namespace",
    );
  });

  it("makes docs-authoritative semantic overrides explicit", () => {
    expect(resolvedCopyDecisions.leaseSigner.status).toBe("resolved");
    expect(zhCN.activation.leaseSigner).toContain("Cloud");
    expect(zhCN.activation.cloudValidationPendingDescription).toContain("Cloud 必须先校验");
    expect(zhCN.signIn.deviceQuota).toContain("2 台设备");
    expect(zhCN.signIn.deviceQuota).toContain("1 台 Active");
    expect(zhCN.signIn.accountCredentialTrust).toContain("GoodDealer Cloud 身份服务");
    expect(zhCN.settings.cloudSyncRequired).toContain("强制启用");
    expect(zhCN.settings.cloudSyncRequired).toContain("先提交本地 SQLCipher");
    expect(enUS.settings.cloudSyncRequired).toContain("does not wait for Cloud transport");
    expect(zhCN.settings.offlineReadOnly).toContain("不会让 Desktop 变为只读");
    expect(enUS.settings.offlineReadOnly).toContain("does not make Desktop read-only");
    expect(zhCN.settings.syncCadence).toContain("计时器不清除未同步状态");
    expect(Object.values(zhCN.settings)).not.toContain("仅手动");
    expect(Object.values(enUS.settings)).not.toContain("Manual only");
    expect(zhCNCapabilityCopy.runtimeMode.localContinuationPlacement).toContain(
      "不显示在日常设备选择器中",
    );

    const serializedCopy = JSON.stringify({ desktopCopy, capabilityCopy });
    for (const canary of forbiddenSemanticCopy) {
      expect(serializedCopy).not.toContain(canary);
    }
  });

  it("returns typed namespaces without arbitrary string-key lookup", () => {
    expect(getPresentationCopy("zh-CN", "salesDesk").title).toBe("销售管理");
    expect(getPresentationCopy("en-US", "salesDesk").title).toBe("Sales");
  });
});

// Type-level negative controls run in the same compiler pass as consumers.
// @ts-expect-error unsupported locale is not assignable
const unsupportedLocale: Locale = "fr-FR";
// @ts-expect-error deleted visual identifier is not assignable
const deletedPresentation: DesktopPresentation = ["network", "Status"].join("");
// @ts-expect-error a visual presentation is not a capability namespace
const presentationAsCapability: CapabilityNamespace = "settings";
const invalidLeaf: LocalizedCopy<typeof zhCN> = {
  ...enUS,
  // @ts-expect-error a locale dictionary leaf cannot change type
  signIn: { ...enUS.signIn, signIn: 42 },
};
void unsupportedLocale;
void deletedPresentation;
void presentationAsCapability;
void invalidLeaf;
