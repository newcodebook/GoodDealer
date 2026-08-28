import { createPublicKey } from "node:crypto";
import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  BootstrapCapabilityVerifier,
  type BootstrapVerificationKeySource,
} from "../src/modules/devices/bootstrap-capability-verifier";
import { createProductionBootstrapCryptoBoundary } from "../src/modules/devices/index";
import { deviceControlMigration } from
  "../src/modules/devices/migrations/202608200004-device-control";
import { deviceCursorsMigration } from
  "../src/modules/workspace/cursors/migrations/202608200005-device-cursors";

const capability = {
  schemaVersion: 1,
  typ: "gd.bootstrap-capability.v1",
  iss: "https://accounts.gooddealer.com",
  aud: "gooddealer-desktop/bootstrap",
  kid: "bootstrap-key-1",
  accountId: "account-1",
  deviceId: "device-b",
  accountSecurityEpoch: 3,
  jti: "bootstrap-1",
  issuedAt: "2026-08-20T00:00:00Z",
  expiresAt: "2026-08-20T01:00:00Z",
  payload: { deviceSwitchRequestId: "switch-1" },
  signature: Buffer.alloc(64, 7).toString("base64url"),
} as const;

const expected = {
  accountId: capability.accountId,
  deviceId: capability.deviceId,
  accountSecurityEpoch: capability.accountSecurityEpoch,
  jti: capability.jti,
  deviceSwitchRequestId: capability.payload.deviceSwitchRequestId,
  issuedAt: capability.issuedAt,
  expiresAt: capability.expiresAt,
  evaluatedAt: "2026-08-20T00:30:00Z",
} as const;

describe("Bootstrap persistence production boundary", () => {
  it("hardwires no-argument Denying verification and Lease signing", async () => {
    const production = createProductionBootstrapCryptoBoundary();
    await expect(production.verifier.verify(capability, expected)).resolves.toEqual({
      accepted: false,
      code: "CAPABILITY_INVALID",
    });
    await expect(production.leaseSigner.sign()).resolves.toEqual({ signed: false });
  });

  it("rejects accessor and custom-prototype input before querying a verification key", async () => {
    let keyQueries = 0;
    const keys: BootstrapVerificationKeySource = {
      async findVerificationKey() {
        keyQueries += 1;
        return null;
      },
    };
    const verifier = new BootstrapCapabilityVerifier(keys);
    let getterCalls = 0;
    const hostile = { ...capability } as Record<string, unknown>;
    Object.defineProperty(hostile, "signature", {
      enumerable: true,
      get() { getterCalls += 1; return capability.signature; },
    });
    await expect(verifier.verify(hostile, expected)).resolves.toEqual({
      accepted: false,
      code: "CAPABILITY_INVALID",
    });
    await expect(verifier.verify(Object.assign(Object.create({ inherited: true }), capability), expected))
      .resolves.toEqual({ accepted: false, code: "CAPABILITY_INVALID" });
    expect({ getterCalls, keyQueries }).toEqual({ getterCalls: 0, keyQueries: 0 });
  });

  it("cryptographically admits only the fixed-purpose fixture presentation and binds its owner", async () => {
    const corpus = JSON.parse(await readFile(new URL(
      "../../../packages/protocol/test-vectors/bootstrap-crypto/ed25519-fixture.json",
      import.meta.url,
    ), "utf8")) as {
      publicKeySpkiDerBase64Url: string;
      bootstrap: { envelope: typeof capability };
    };
    const observed: unknown[] = [];
    const key = createPublicKey({
      key: Buffer.from(corpus.publicKeySpkiDerBase64Url, "base64url"),
      format: "der",
      type: "spki",
    });
    const verifier = new BootstrapCapabilityVerifier({
      async findVerificationKey(input) { observed.push(input); return key; },
    });
    const fixture = corpus.bootstrap.envelope;
    const fixtureExpected = {
      accountId: fixture.accountId,
      deviceId: fixture.deviceId,
      accountSecurityEpoch: fixture.accountSecurityEpoch,
      jti: fixture.jti,
      deviceSwitchRequestId: fixture.payload.deviceSwitchRequestId,
      issuedAt: fixture.issuedAt,
      expiresAt: fixture.expiresAt,
      evaluatedAt: "2026-08-20T00:15:00Z",
    };
    const admitted = await verifier.verify(fixture, fixtureExpected);
    expect(admitted.accepted).toBe(true);
    if (!admitted.accepted) throw new Error("fixture Bootstrap capability was not admitted");
    expect(verifier.owns(admitted.presentation)).toBe(true);
    expect(observed).toEqual([{
      purpose: "gooddealer.devices.bootstrap-capability.v1",
      kid: "bootstrap-fixture-key-1",
    }]);
    await expect(verifier.verify({ ...fixture, deviceId: "device-other" }, fixtureExpected))
      .resolves.toEqual({ accepted: false, code: "CAPABILITY_INVALID" });
  });

  it("keeps signed readiness all-or-none and cursor generations historical", () => {
    expect(deviceControlMigration.id).toBe("202608200004-device-control");
    expect(deviceControlMigration.sql).toContain("device_bootstrap_capabilities_signed_ready_check");
    expect(deviceControlMigration.sql).toContain("device_bootstrap_authorities");
    expect(deviceControlMigration.sql).toContain("device_bootstrap_step_nonces");
    expect(deviceControlMigration.sql).toContain("ENABLE ROW LEVEL SECURITY");
    expect(deviceControlMigration.sql).toContain("FORCE ROW LEVEL SECURITY");
    expect(deviceCursorsMigration.id).toBe("202608200005-device-cursors");
    expect(deviceCursorsMigration.sql).toContain("cursor_generation");
    expect(deviceCursorsMigration.sql).not.toContain("DELETE FROM workspace_device_cursors");
  });

  it("keeps one active device cursor per tenant workspace in the ordered cursor migration", () => {
    expect(deviceCursorsMigration.id).toBe("202608200005-device-cursors");
    expect(deviceCursorsMigration.sql).toContain(
      "CREATE UNIQUE INDEX workspace_device_cursors_one_active_per_workspace",
    );
    expect(deviceCursorsMigration.sql).toContain("ON workspace_device_cursors (account_id, workspace_id)");
    expect(deviceCursorsMigration.sql).toContain("WHERE status = 'active'");
  });

  it("does not import fixture key or signer support from production source", async () => {
    const sourceFiles = [
      "../src/modules/devices/index.ts",
      "../src/modules/devices/postgres-bootstrap-step-service.ts",
      "../src/modules/devices/postgres-bootstrap-activation.ts",
    ];
    for (const path of sourceFiles) {
      const source = await readFile(new URL(path, import.meta.url), "utf8");
      expect(source).not.toMatch(/test\/support|bootstrap-crypto\/private|FixtureActiveDeviceLeaseSigner/u);
    }
  });
});
