import type { VisualFixtureManifest } from "./manifest";
import type { PresentationFixtureRegistry } from "./presentation-registry";

export function findFixtureCase(manifest: VisualFixtureManifest, caseId: string) {
  for (const presentation of manifest.presentations) {
    const fixtureCase = presentation.cases.find((item) => item.id === caseId);
    if (fixtureCase !== undefined) return { presentation, fixtureCase };
  }
  return undefined;
}

export function FixtureSurface({ manifest, registry, caseId, onFixtureIntent }: { readonly manifest: VisualFixtureManifest; readonly registry: PresentationFixtureRegistry; readonly caseId: string; readonly onFixtureIntent: (intent: string) => void }) {
  const match = findFixtureCase(manifest, caseId);
  if (match === undefined) return <div className="gd-fixture-unavailable" role="alert">Unknown fixture case. No production presentation was rendered.</div>;
  return registry[match.presentation.presentation].render({ ...match, onFixtureIntent });
}
