import { describe, expect, it } from "vitest";

import { SessionFamilyStore } from "../src/modules/identity/session-families";

describe("SessionFamilyStore", () => {
  it("registers credential JTIs globally and aborts duplicate issuance without partial writes", () => {
    const store = new SessionFamilyStore();
    expect(
      store.createFamily({ familyId: "family-a", refreshJti: "refresh-a", accessJti: "access-a" }),
    ).toEqual({ created: true });

    expect(
      store.createFamily({ familyId: "family-b", refreshJti: "refresh-b", accessJti: "access-a" }),
    ).toEqual({ created: false, reason: "credential_jti_conflict" });
    expect(store.hasFamily("family-b")).toBe(false);
    expect(store.credentialState("refresh-b")).toBeNull();
  });

  it("lets exactly one prepared concurrent rotation win the current-JTI CAS", () => {
    const store = new SessionFamilyStore();
    store.createFamily({ familyId: "family-a", refreshJti: "refresh-a0", accessJti: "access-a0" });
    const first = store.inspectRotation("family-a", "refresh-a0");
    const second = store.inspectRotation("family-a", "refresh-a0");
    expect(first.status).toBe("ready");
    expect(second.status).toBe("ready");
    if (first.status !== "ready" || second.status !== "ready") throw new Error("expected prepared rotations");

    expect(store.commitRotation(first.preparation, { refreshJti: "refresh-a1", accessJti: "access-a1" })).toEqual({
      status: "rotated",
      rotationGeneration: 1,
    });
    expect(store.commitRotation(second.preparation, { refreshJti: "refresh-a2", accessJti: "access-a2" })).toEqual({
      status: "refresh_rotation_conflict",
    });
    expect(store.credentialState("refresh-a2")).toBeNull();
    expect(store.currentRefreshJti("family-a")).toBe("refresh-a1");
  });

  it("distinguishes retired-JTI reuse from cross-family and unknown presentations", () => {
    const store = new SessionFamilyStore();
    store.createFamily({ familyId: "family-a", refreshJti: "refresh-a0", accessJti: "access-a0" });
    store.createFamily({ familyId: "family-b", refreshJti: "refresh-b0", accessJti: "access-b0" });
    const prepared = store.inspectRotation("family-a", "refresh-a0");
    if (prepared.status !== "ready") throw new Error("expected prepared rotation");
    store.commitRotation(prepared.preparation, { refreshJti: "refresh-a1", accessJti: "access-a1" });

    expect(store.inspectRotation("family-a", "refresh-a0")).toEqual({ status: "refresh_reuse_detected" });
    expect(store.inspectRotation("family-a", "refresh-b0")).toEqual({ status: "invalid_credentials" });
    expect(store.inspectRotation("family-a", "unknown-refresh")).toEqual({ status: "invalid_credentials" });
  });

  it("revokes every JTI in a family without touching another family", () => {
    const store = new SessionFamilyStore();
    store.createFamily({ familyId: "family-a", refreshJti: "refresh-a", accessJti: "access-a" });
    store.createFamily({ familyId: "family-b", refreshJti: "refresh-b", accessJti: "access-b" });

    expect(store.revokeFamily("family-a")).toBe(true);
    expect(store.credentialState("refresh-a")).toBe("revoked");
    expect(store.credentialState("access-a")).toBe("revoked");
    expect(store.credentialState("refresh-b")).toBe("current");
    expect(store.credentialState("access-b")).toBe("current");
  });
});
