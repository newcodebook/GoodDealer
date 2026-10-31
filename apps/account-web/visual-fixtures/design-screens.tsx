import { AccessScreen, accessVariants } from "./screens/access-screen";
import { BillingScreen, billingVariants } from "./screens/billing-screen";
import { DevicesScreen, devicesVariants } from "./screens/devices-screen";
import { LicenseScreen, licenseVariants } from "./screens/license-screen";
import { ShellScreen, shellVariants } from "./screens/shell-screen";
import { plannedScreens, type DesignScreen } from "./screen-registry";

/** Planned screens with the designed ones in place; a designed screen must have a plan entry. */
export function designScreens(): readonly DesignScreen[] {
  const designed: readonly DesignScreen[] = [
    {
      id: "access",
      group: "门禁",
      title: "登录与注册",
      kitSource: "../desktop/SignIn.jsx",
      backing: "cloud",
      status: "designed",
      variants: accessVariants,
      render: ({ variant, locale }) => <AccessScreen variant={variant} locale={locale} />,
    },
    {
      id: "shell",
      group: "门禁",
      title: "账户壳层",
      kitSource: "AccountShell.jsx",
      backing: "cloud",
      status: "designed",
      variants: shellVariants,
      render: ({ variant, locale }) => <ShellScreen variant={variant} locale={locale} />,
    },
    {
      id: "license",
      group: "账户",
      title: "订阅与许可",
      kitSource: "License.jsx",
      backing: "cloud",
      status: "designed",
      variants: licenseVariants,
      render: ({ variant, locale }) => <LicenseScreen variant={variant} locale={locale} />,
    },
    {
      id: "devices",
      group: "账户",
      title: "设备",
      kitSource: "Devices.jsx",
      backing: "mock",
      status: "designed",
      variants: devicesVariants,
      render: ({ variant, locale }) => <DevicesScreen variant={variant} locale={locale} />,
    },
    {
      id: "billing",
      group: "账户",
      title: "账单与发票",
      kitSource: "Billing.jsx",
      backing: "mock",
      status: "designed",
      variants: billingVariants,
      render: ({ variant, locale }) => <BillingScreen variant={variant} locale={locale} />,
    },
  ];
  // The plan is the index: each designed screen takes its plan's position.
  const byId = new Map(designed.map((screen) => [screen.id, screen]));
  return plannedScreens().map((screen) => byId.get(screen.id) ?? screen);
}
