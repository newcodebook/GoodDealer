import { Badge } from "@gooddealer/ui";
import { useState } from "react";

import { plannedScreens, screenGroups, type DesignScreen } from "./screen-registry";
import { FoundationScreen } from "./screens/foundation-screen";

const screens: readonly DesignScreen[] = [
  { id: "foundation", group: "基础", title: "设计基础", kitSource: "brand/README.md", backing: "host", status: "designed", render: () => <FoundationScreen /> },
  ...plannedScreens(),
];

/** Design-review host: every Desktop screen, rendered from mock data, outside the production graph. */
export function DesignHost() {
  const [activeId, setActiveId] = useState(screens[0]?.id ?? "");
  const active = screens.find((screen) => screen.id === activeId);
  return (
    <div className="design-host">
      <aside className="design-host-nav" aria-label="设计宿主界面目录">
        <header>
          <span className="design-host-eyebrow">MOCK DATA · NOT PRODUCTION</span>
          <h1 className="gd-t-section">GoodDealer 设计宿主</h1>
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
                    <Badge tone={screen.backing === "host" ? "sync" : "neutral"}>{screen.backing === "host" ? "HOST" : "MOCK"}</Badge>
                    {screen.status === "planned" ? <Badge tone="warning">PLANNED</Badge> : null}
                  </span>
                </button>
              ))}
            </section>
          ))}
        </nav>
      </aside>
      <main className="design-host-stage" aria-label={active?.title}>
        {active?.render === undefined
          ? <p className="gd-t-body-2">{active?.title} 尚未设计。设计依据：brand/ui_kits/desktop/{active?.kitSource}</p>
          : active.render()}
      </main>
    </div>
  );
}
