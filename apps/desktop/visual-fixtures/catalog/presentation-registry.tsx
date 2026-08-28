import type { ReactElement } from "react";
import type { DUiV1Presentation, VisualFixtureCase, VisualFixturePresentation } from "./manifest";

export interface FixtureRenderContext {
  readonly presentation: VisualFixturePresentation;
  readonly fixtureCase: VisualFixtureCase;
  /** Records local QA intent only; it never synthesizes production authority or availability. */
  readonly onFixtureIntent: (intent: string) => void;
}

export interface PresentationFixtureRegistration {
  readonly presentation: DUiV1Presentation;
  readonly render: (context: FixtureRenderContext) => ReactElement;
}

export type PresentationFixtureRegistry = Readonly<Record<DUiV1Presentation, PresentationFixtureRegistration>>;

export function createPresentationFixtureRegistry(registrations: readonly PresentationFixtureRegistration[]): PresentationFixtureRegistry {
  const registry = Object.fromEntries(registrations.map((registration) => [registration.presentation, registration]));
  if (Object.keys(registry).length !== registrations.length) throw new TypeError("Duplicate fixture registration");
  return Object.freeze(registry) as PresentationFixtureRegistry;
}
