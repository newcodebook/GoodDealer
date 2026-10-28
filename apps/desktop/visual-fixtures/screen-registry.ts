import type { ReactNode } from "react";

/**
 * `host` screens have a production Host port today and will later be composed by `src/app.tsx`;
 * `mock` screens exist only here until their capability is implemented. Neither label grants
 * authority: everything in this host renders typed mock data.
 */
export type ScreenBacking = "host" | "mock";
export type ScreenStatus = "planned" | "designed";

export interface DesignScreen {
  readonly id: string;
  readonly group: string;
  readonly title: string;
  /** The brand UI kit source this screen is designed from. */
  readonly kitSource: string;
  readonly backing: ScreenBacking;
  readonly status: ScreenStatus;
  readonly render?: () => ReactNode;
}

export const screenGroups = ["基础", "门禁", "资产", "DNS", "变现", "同步", "运营", "设置"] as const;

export function plannedScreens(): readonly DesignScreen[] {
  return [
    { id: "signin", group: "门禁", title: "登录", kitSource: "SignIn.jsx", backing: "host", status: "planned" },
    { id: "onboarding", group: "门禁", title: "接入向导", kitSource: "Onboarding.jsx", backing: "mock", status: "planned" },
    { id: "asset-library", group: "资产", title: "资产库", kitSource: "AssetLibrary.jsx", backing: "host", status: "planned" },
    { id: "domain-detail", group: "资产", title: "域名详情", kitSource: "DomainDetail.jsx", backing: "host", status: "planned" },
    { id: "batch-preview", group: "资产", title: "批量差异预览", kitSource: "BatchPreview.jsx", backing: "mock", status: "planned" },
    { id: "renew-desk", group: "资产", title: "续费", kitSource: "RenewDesk.jsx", backing: "mock", status: "planned" },
    { id: "dns-verify", group: "DNS", title: "DNS 与验证", kitSource: "DnsVerify.jsx", backing: "host", status: "planned" },
    { id: "sales-desk", group: "变现", title: "销售管理", kitSource: "SalesDesk.jsx", backing: "mock", status: "planned" },
    { id: "conflict-center", group: "同步", title: "冲突中心", kitSource: "ConflictCenter.jsx", backing: "host", status: "planned" },
    { id: "history-log", group: "同步", title: "操作历史", kitSource: "HistoryLog.jsx", backing: "mock", status: "planned" },
    { id: "task-inbox", group: "运营", title: "人工任务", kitSource: "TaskInbox.jsx", backing: "mock", status: "planned" },
    { id: "settings", group: "设置", title: "设置 · 设备与运行态", kitSource: "SettingsPanel.jsx", backing: "mock", status: "planned" },
  ];
}
