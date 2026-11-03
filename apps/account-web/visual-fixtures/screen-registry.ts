import type { Locale } from "@gooddealer/i18n";
import type { ReactNode } from "react";

/**
 * `cloud` screens have a production Cloud contract today and will be composed by the production
 * entry; `mock` screens exist only here until their capability is implemented. Neither label grants
 * authority: everything in this host renders typed mock data.
 */
export type ScreenBacking = "cloud" | "mock";
export type ScreenStatus = "planned" | "designed";

export interface ScreenRenderContext {
  readonly variant: string;
  readonly locale: Locale;
  readonly navigate: (screenId: string) => void;
}

export interface DesignScreen {
  readonly id: string;
  readonly group: string;
  readonly title: string;
  /** The brand UI kit source this screen is designed from, relative to brand/ui_kits/account-web. */
  readonly kitSource: string;
  readonly backing: ScreenBacking;
  readonly status: ScreenStatus;
  readonly variants?: readonly { readonly id: string; readonly label: string }[];
  readonly render?: (context: ScreenRenderContext) => ReactNode;
}

export const screenGroups = ["门禁", "账户", "安全与数据", "其他"] as const;

export function plannedScreens(): readonly DesignScreen[] {
  return [
    { id: "access", group: "门禁", title: "登录与注册", kitSource: "../desktop/SignIn.jsx", backing: "cloud", status: "planned" },
    { id: "shell", group: "门禁", title: "账户壳层", kitSource: "AccountShell.jsx", backing: "cloud", status: "planned" },
    { id: "license", group: "账户", title: "订阅与许可", kitSource: "License.jsx", backing: "cloud", status: "planned" },
    { id: "devices", group: "账户", title: "设备", kitSource: "Devices.jsx", backing: "mock", status: "planned" },
    { id: "billing", group: "账户", title: "账单与发票", kitSource: "Billing.jsx", backing: "mock", status: "planned" },
    { id: "security", group: "安全与数据", title: "安全", kitSource: "Security.jsx", backing: "mock", status: "planned" },
    { id: "cloud-data", group: "安全与数据", title: "云端数据", kitSource: "CloudData.jsx", backing: "mock", status: "planned" },
    { id: "settings", group: "其他", title: "账户设置", kitSource: "AccountSettings.jsx", backing: "mock", status: "planned" },
    { id: "download", group: "其他", title: "下载客户端", kitSource: "Download.jsx", backing: "mock", status: "planned" },
  ];
}
