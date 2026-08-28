import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { SettingsRoute, settingsSectionIds } from "./settings-route";

describe("SettingsRoute", () => {
  it("renders direct production presentation inputs for each admitted section", () => {
    const sections = Object.fromEntries(
      settingsSectionIds.map((sectionId) => [sectionId, <p key={sectionId}>{sectionId} presentation</p>]),
    );

    for (const activeSection of settingsSectionIds) {
      const html = renderToStaticMarkup(
        <SettingsRoute locale="en-US" activeSection={activeSection} sections={sections} />,
      );
      expect(html).toContain("Settings");
      expect(html).toContain(`${activeSection} presentation`);
      expect(html).not.toContain("LocalContinuation");
    }
  });

  it("keeps unwired capabilities absent", () => {
    const markup = renderToStaticMarkup(
      <SettingsRoute
        locale="en-US"
        activeSection="connections"
        sections={{
          connections: <p>connections capability presentation</p>,
          license: <p>license capability presentation</p>,
          sync: <p>sync capability presentation</p>,
        }}
      />,
    );

    expect(markup).toContain("Connections");
    expect(markup).toContain("License");
    expect(markup).toContain("Sync preferences");
    expect(markup).not.toContain("Devices &amp; runtime");
    expect(markup).not.toContain("About");
    expect(markup).toContain("connections capability presentation");
    expect(markup).not.toContain("license capability presentation");
  });

  it("reports section selection as presentation intent without mutating route state", () => {
    const onSectionSelect = vi.fn();
    const view = SettingsRoute({
      locale: "zh-CN",
      activeSection: "connections",
      sections: { connections: <p>连接</p>, devices: <p>设备</p> },
      onSectionSelect,
    });
    const buttons = view.props.children[0].props.children as Array<{ props: { onClick?: () => void } }>;

    buttons[1]?.props.onClick?.();

    expect(onSectionSelect).toHaveBeenCalledOnce();
    expect(onSectionSelect).toHaveBeenCalledWith("devices");
  });

  it("renders an explicitly supplied overlay without granting it route authority", () => {
    const html = renderToStaticMarkup(
      <SettingsRoute
        locale="en-US"
        activeSection="about"
        sections={{ about: <p>read-only about presentation</p> }}
        overlay={<aside>controlled presentation overlay</aside>}
      />,
    );

    expect(html).toContain("read-only about presentation");
    expect(html).toContain("controlled presentation overlay");
    expect(html).not.toContain("accountId");
    expect(html).not.toContain("workspaceId");
  });
});
