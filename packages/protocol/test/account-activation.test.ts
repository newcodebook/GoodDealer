import { describe, expect, it } from "vitest";

import {
  accountActivationRequestSchema,
  accountActivationResponseSchema,
} from "@gooddealer/protocol/account";

describe("account activation wire contract", () => {
  it("accepts only the tenant-neutral activation intent and active response", () => {
    expect(accountActivationRequestSchema.parse({ schemaVersion: 1 })).toEqual({ schemaVersion: 1 });
    expect(accountActivationResponseSchema.parse({ schemaVersion: 1, state: "active" })).toEqual({
      schemaVersion: 1,
      state: "active",
    });
  });

  it.each([
    { schemaVersion: 1, accountId: "account-01" },
    { schemaVersion: 1, workspaceId: "workspace-01" },
    { schemaVersion: 1, credentialRef: "secret-ref" },
    { schemaVersion: 999 },
  ])("rejects activation authority or malformed request %#", (value) => {
    expect(accountActivationRequestSchema.safeParse(value).success).toBe(false);
  });

  it.each([
    { schemaVersion: 1, state: "pending" },
    { schemaVersion: 1, state: "active", accountId: "account-01" },
    { schemaVersion: 1, state: "active", unknown: true },
  ])("rejects malformed or authority-bearing response %#", (value) => {
    expect(accountActivationResponseSchema.safeParse(value).success).toBe(false);
  });
});
