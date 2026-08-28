import { dUiV1Presentations } from "./manifest";
import { dUiV1Registrations } from "./d-ui-v1-registrations";
import { createPresentationFixtureRegistry } from "./presentation-registry";

/** One-way graph: isolated fixtures import current production feature entries only. */
export const presentationFixtureRegistry = createPresentationFixtureRegistry(dUiV1Registrations);

if (Object.keys(presentationFixtureRegistry).some((key, index) => key !== dUiV1Presentations[index])) {
  throw new TypeError("D-UI-V1 fixture registry does not match the closed manifest order");
}
