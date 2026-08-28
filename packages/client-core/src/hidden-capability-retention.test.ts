import { describe, expect, it } from "vitest";

import {
  parseAssetProtectionIncidentViewModel,
  parseBackupRestoreViewModel,
  parseBrowserHandoffViewModel,
  parseRecoveryCenterViewModel,
  parseStartupRecoveryViewModel,
  projectForcedSwitchViewModel,
  projectLockedAccountViewModel,
} from "./index";

describe("hidden capability retention", () => {
  it("keeps deleted visual capabilities exported as strict fail-closed contracts", () => {
    for (const parse of [
      parseAssetProtectionIncidentViewModel,
      parseBackupRestoreViewModel,
      parseBrowserHandoffViewModel,
      parseRecoveryCenterViewModel,
      parseStartupRecoveryViewModel,
    ]) {
      expect(() => parse({ visualFixtureGranted: true })).toThrow();
    }

    expect(projectForcedSwitchViewModel({ acknowledged: true, requestSwitch: true })).toEqual({
      ok: false,
      issue: "invalid_state",
    });
    expect(projectLockedAccountViewModel({ reason: "unknown", availableActions: ["enter"] })).toEqual({
      ok: false,
      issue: "invalid_state",
    });
  });
});
