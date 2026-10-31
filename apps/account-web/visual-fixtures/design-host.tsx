import { supportedLocales, type Locale } from "@gooddealer/i18n";
import { Badge, SegmentedControl } from "@gooddealer/ui";
import { useEffect, useState } from "react";

import { designScreens } from "./design-screens";
import { screenGroups } from "./screen-registry";

/** Design-review host: every Account Web screen, rendered from mock data, outside production. */
export function DesignHost({ initialScreenId }: { readonly initialScreenId?: string }) {
  const screens = designScreens();
  // `#screen/variant` keeps the reviewed screen across reloads and makes it linkable.
  const fromHash = typeof location === "undefined" ? [] : decodeURIComponent(location.hash.slice(1)).split("/");
  const [activeId, setActiveId] = useState(initialScreenId ?? (screens.some((screen) => screen.id === fromHash[0]) ? fromHash[0] ?? "" : screens[0]?.id ?? ""));
  const [variants, setVariants] = useState<Readonly<Record<string, string>>>(fromHash[1] === undefined || fromHash[0] === undefined ? {} : { [fromHash[0]]: fromHash[1] });
  const [locale, setLocale] = useState<Locale>("zh-CN");
  const active = screens.find((screen) => screen.id === activeId);
  const variant = active === undefined ? "" : variants[active.id] ?? active.variants?.[0]?.id ?? "";
  useEffect(() => {
    if (typeof history !== "undefined") history.replaceState(null, "", `#${activeId}${variant === "" ? "" : `/${variant}`}`);
  }, [activeId, variant]);
  const navigate = (screenId: string) => {
    if (screens.some((screen) => screen.id === screenId)) setActiveId(screenId);
  };

  return (
    <div className="design-host">
      <aside className="design-host-nav" aria-label="设计宿主界面目录">
        <header>
          <span className="design-host-eyebrow">MOCK DATA · NOT PRODUCTION</span>
          <h1 className="gd-t-section">GoodDealer Account 设计宿主</h1>
        </header>
        <nav>
          {screenGroups.map((group) => (
            <section key={group}>
              <h2 className="gd-t-label">{group}</h2>
              {screens.filter((screen) => screen.group === group).map((screen) => (
                <button
                  key={screen.id}
                  type="button"
                  aria-current={screen.id === activeId ? "page" : undefined}
                  onClick={() => setActiveId(screen.id)}
                >
                  <span>{screen.title}</span>
                  <span className="design-host-tags">
                    <Badge tone={screen.backing === "cloud" ? "sync" : "neutral"}>{screen.backing === "cloud" ? "CLOUD" : "MOCK"}</Badge>
                    {screen.status === "planned" ? <Badge tone="warning">PLANNED</Badge> : null}
                  </span>
                </button>
              ))}
            </section>
          ))}
        </nav>
      </aside>
      <main className="design-host-main" aria-label={active?.title}>
        <div className="design-host-variants">
          {active?.variants === undefined ? null : (
            <>
              <span className="gd-t-label">状态</span>
              <SegmentedControl
                label="界面状态"
                value={variant}
                items={active.variants.map((item) => ({ value: item.id, label: item.label }))}
                onChange={(value) => setVariants((current) => ({ ...current, [active.id]: value }))}
              />
            </>
          )}
          <span className="gd-t-label design-host-locale">语言</span>
          <SegmentedControl
            label="语言"
            value={locale}
            items={supportedLocales.map((value) => ({ value, label: value }))}
            onChange={(value) => setLocale(value as Locale)}
          />
        </div>
        <div className="design-host-stage">
          {active?.render === undefined
            ? <p className="gd-t-body-2 design-host-pending">{active?.title} 尚未设计。设计依据：brand/ui_kits/account-web/{active?.kitSource}</p>
            : <div key={`${active.id}:${variant}`} className="design-host-screen">{active.render({ variant, locale, navigate })}</div>}
        </div>
      </main>
    </div>
  );
}
