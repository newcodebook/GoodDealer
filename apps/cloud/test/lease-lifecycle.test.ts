import { activeDeviceLeaseEnvelopeSchema } from "@gooddealer/protocol/devices";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  ActiveDeviceLeaseLifecycle,
  DenyingLeaseSigner,
  type LeaseSignerPort,
} from "../src/modules/devices/index";

const clock = { now: () => "2026-08-14T08:00:00Z" };

describe("ActiveDeviceLeaseLifecycle", () => {
  it("P16-INV-3 burns failed pending epochs and never reuses them", () => {
    const lifecycle = new ActiveDeviceLeaseLifecycle({ trustedTime: clock });
    expect(lifecycle.beginBootstrap("account-1", "switch-1", null)).toBe(1);
    lifecycle.discardPending("account-1", "switch-1");
    expect(lifecycle.beginBootstrap("account-1", "switch-2", null)).toBe(2);
    expect(lifecycle.highestAllocatedEpoch("account-1")).toBe(2);
    expect(lifecycle.currentLeaseEpoch("account-1")).toBe(0);
  });

  it("P16-INV-19/20 computes the minimum deadline with strict lease ordering", () => {
    const lifecycle = new ActiveDeviceLeaseLifecycle({ trustedTime: clock });
    lifecycle.beginBootstrap("account-1", "switch-1", null);
    const claims = lifecycle.computeClaims({
      accountId: "account-1",
      deviceId: "device-b",
      accountSecurityEpoch: 3,
      workflowId: "switch-1",
      jti: "lease-jti-1",
      entitlement: {
        offlineGraceUntil: "2026-08-15T08:00:00Z",
        commercialExpiresAt: "2026-08-15T07:00:00Z",
      },
      accountSecurityDeadline: "2026-08-14T09:00:00Z",
    });
    expect(claims).toMatchObject({
      issuedAt: "2026-08-14T08:00:00Z",
      expiresAt: "2026-08-14T09:00:00Z",
      payload: {
        leaseEpoch: 1,
        renewAfter: "2026-08-14T08:05:00Z",
        onlineExpiresAt: "2026-08-14T08:15:00Z",
        offlineExecuteUntil: "2026-08-14T09:00:00Z",
      },
    });
    expect(activeDeviceLeaseEnvelopeSchema.safeParse(claims).success).toBe(false);
    expect(claims).not.toHaveProperty("signature");
    expect(claims).not.toHaveProperty("kid");
  });

  it("P16-INV-25 makes successful issuance structurally unrepresentable", async () => {
    type SignerResult = Awaited<ReturnType<LeaseSignerPort["signActiveDeviceLease"]>>;
    expectTypeOf<SignerResult>().toEqualTypeOf<{
      readonly issued: false;
      readonly reason: "lease_issuance_disabled";
    }>();
    expect(await new DenyingLeaseSigner().signActiveDeviceLease()).toEqual({
      issued: false,
      reason: "lease_issuance_disabled",
    });
  });

  it("P16-INV-21/22/23 keeps renewal on the same epoch and freezes it during forced waiting", async () => {
    const lifecycle = new ActiveDeviceLeaseLifecycle({
      trustedTime: clock,
      seed: {
        "account-1": {
          currentLeaseEpoch: 7,
          held: {
            deviceId: "device-a",
            leaseEpoch: 7,
            issuedAt: "2026-08-14T07:00:00Z",
            renewAfter: "2026-08-14T07:05:00Z",
            onlineExpiresAt: "2026-08-14T07:15:00Z",
            offlineExecuteUntil: "2026-08-15T07:00:00Z",
            releasedAt: null,
          },
        },
      },
    });
    const entitlement = {
      read: async () => ({
        active: true,
        offlineGraceUntil: "2026-08-15T08:00:00Z",
        commercialExpiresAt: "2026-08-15T07:00:00Z",
      }),
    };
    expect(await lifecycle.renew("account-1", "waiting_expiry", entitlement, 1)).toEqual({
      renewed: false,
      code: "ACTIVE_DEVICE_CONFLICT",
    });
    const requestedRenewal = await lifecycle.renew("account-1", "requested", entitlement, 1);
    expect(requestedRenewal).toMatchObject({ issued: false, code: "LEASE_ISSUANCE_DISABLED", claims: { payload: { leaseEpoch: 7 } } });
    expect(lifecycle.currentLeaseEpoch("account-1")).toBe(7);
  });

  it("P16-INV-11/24 releases only as part of removal or bootstrap entry", () => {
    const lifecycle = new ActiveDeviceLeaseLifecycle({
      trustedTime: clock,
      seed: {
        "account-1": {
          currentLeaseEpoch: 4,
          held: {
            deviceId: "device-a",
            leaseEpoch: 4,
            issuedAt: "2026-08-14T07:00:00Z",
            renewAfter: "2026-08-14T07:05:00Z",
            onlineExpiresAt: "2026-08-14T07:15:00Z",
            offlineExecuteUntil: "2026-08-15T07:00:00Z",
            releasedAt: null,
          },
        },
      },
    });
    expect(lifecycle.removeActiveDevice("account-1", "device-a")).toBe("2026-08-15T07:00:00Z");
    expect(lifecycle.getStatus("account-1")).toMatchObject({ held: false });
    expect("release" in lifecycle).toBe(false);
  });
});
