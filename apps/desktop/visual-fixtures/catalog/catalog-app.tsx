import { useMemo, useState } from "react";

import manifestJson from "../screenshots/manifest.json";
import { FixtureSurface, findFixtureCase } from "./fixture-surface";
import { parseVisualFixtureManifest } from "./manifest";
import { presentationFixtureRegistry } from "./registry";

const manifest = parseVisualFixtureManifest(manifestJson as unknown);

export function initialCaseId(requested: string | null): string {
  return requested ?? manifest.presentations[0]!.cases[0]!.id;
}

export function CatalogApp() {
  const [caseId, setCaseId] = useState(() => initialCaseId(new URLSearchParams(window.location.search).get("case")));
  const [lastIntent, setLastIntent] = useState<string>();
  const capture = new URLSearchParams(window.location.search).has("capture");
  const selected = useMemo(() => findFixtureCase(manifest, caseId), [caseId]);

  if (capture) {
    return <main className="gd-fixture-capture" data-fixture-case={caseId}><FixtureSurface manifest={manifest} registry={presentationFixtureRegistry} caseId={caseId} onFixtureIntent={setLastIntent} />{lastIntent ? <output className="gd-fixture-intent">{lastIntent}</output> : null}</main>;
  }

  const caseCount = manifest.presentations.reduce((count, presentation) => count + presentation.cases.length, 0);
  return (
    <main className="gd-fixture-catalog">
      <aside className="gd-fixture-catalog-nav">
        <header><span className="gd-fixture-eyebrow">D-UI-V1 · SYNTHETIC LOCAL QA ONLY</span><h1>Production visual fixtures</h1><p>{manifest.presentations.length} presentations · {caseCount} closed cases</p></header>
        <nav aria-label="D-UI-V1 fixture cases">
          {manifest.presentations.map((presentation) => <section key={presentation.presentation}><h2><span>{presentation.presentation}</span><i data-status="ready">production</i></h2>{presentation.cases.map((fixtureCase) => <button type="button" key={fixtureCase.id} aria-current={caseId === fixtureCase.id ? "page" : undefined} onClick={() => setCaseId(fixtureCase.id)}>{fixtureCase.state}<small>{fixtureCase.fixtureIntent}</small></button>)}</section>)}
        </nav>
      </aside>
      <section className="gd-fixture-catalog-stage">
        <header className="gd-fixture-catalog-meta"><div><span>Case</span><strong>{selected?.fixtureCase.id}</strong></div><div><span>Production source</span><strong>{selected?.presentation.productionSource}</strong></div><div><span>Viewport</span><strong>{selected ? `${selected.presentation.viewport.width}×${selected.presentation.viewport.height}` : "—"}</strong></div><div><span>Allowed fixture intents</span><strong>{selected?.fixtureCase.actions.join(", ") || "none"}</strong></div></header>
        <div className="gd-fixture-catalog-frame" style={selected ? { width: selected.presentation.viewport.width, height: selected.presentation.viewport.height } : undefined}><FixtureSurface manifest={manifest} registry={presentationFixtureRegistry} caseId={caseId} onFixtureIntent={setLastIntent} /></div>
        <footer>{lastIntent ?? "Synthetic local QA state; no production availability or authority is simulated."}</footer>
      </section>
    </main>
  );
}
