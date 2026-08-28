import { getPresentationCopy, type Locale } from "@gooddealer/i18n";
import type { CSSProperties, ReactNode } from "react";

export const settingsSectionIds = [
  "connections",
  "devices",
  "license",
  "sync",
  "about",
] as const;

export type SettingsSectionId = (typeof settingsSectionIds)[number];

export type SettingsRouteSections = Readonly<
  Partial<Record<SettingsSectionId, ReactNode>>
>;

export interface SettingsRouteProps {
  readonly locale: Locale;
  readonly activeSection: SettingsSectionId;
  /** Capability owners inject view-only presentations; this route owns only ordering and layout. */
  readonly sections: SettingsRouteSections;
  readonly onSectionSelect?: (section: SettingsSectionId) => void;
  readonly overlay?: ReactNode;
}

const rootStyle: CSSProperties = { display: "flex", height: "100%", minHeight: 0 };
const navigationStyle: CSSProperties = {
  display: "flex",
  width: 176,
  flex: "none",
  flexDirection: "column",
  gap: 2,
  padding: 8,
  borderRight: "1px solid var(--gd-line)",
  background: "var(--gd-panel)",
};
const contentStyle: CSSProperties = { minWidth: 0, flex: 1, overflow: "auto", padding: 16 };

export function SettingsRoute({ locale, activeSection, sections, onSectionSelect, overlay }: SettingsRouteProps) {
  const copy = getPresentationCopy(locale, "settings");
  const labels = {
    connections: copy.connections,
    devices: copy.devicesAndRuntime,
    license: copy.license,
    sync: copy.syncPreferences,
    about: copy.about,
  } as const satisfies Readonly<Record<SettingsSectionId, string>>;
  const visibleSections = settingsSectionIds.filter((sectionId) => sections[sectionId] !== undefined);

  return (
    <section aria-label={copy.title} data-screen-label={copy.title} style={rootStyle}>
      <aside aria-label={copy.title} style={navigationStyle}>
        {visibleSections.map((sectionId) => {
          const selected = sectionId === activeSection;
          return (
            <button
              key={sectionId}
              type="button"
              aria-current={selected ? "page" : undefined}
              onClick={onSectionSelect ? () => onSectionSelect(sectionId) : undefined}
              style={{
                height: 31,
                padding: "0 10px",
                border: 0,
                borderRadius: 5,
                background: selected ? "var(--gd-panel-raised)" : "transparent",
                color: selected ? "var(--text-1)" : "var(--text-2)",
                cursor: onSectionSelect ? "pointer" : "default",
                fontFamily: "var(--font-sans)",
                fontSize: 13,
                textAlign: "left",
              }}
            >
              {labels[sectionId]}
            </button>
          );
        })}
      </aside>
      <div style={contentStyle}>
        <div style={{ maxWidth: 760 }}>{sections[activeSection]}</div>
      </div>
      {overlay}
    </section>
  );
}
