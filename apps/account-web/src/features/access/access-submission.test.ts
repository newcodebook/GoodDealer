import { describe, expect, it } from "vitest";

import { accessSubmission, type AccountAccessStep } from "./access-submission";

const filled = { email: "user@example.com", password: "correct horse battery", code: "123456", newPassword: "another long secret" };

describe("accessSubmission", () => {
  it("clears every secret on every step and keeps only the email", () => {
    const steps: readonly AccountAccessStep[] = ["sign_in", "register", "verify", "reset_request", "reset", "desktop_returning"];
    for (const step of steps) {
      expect(accessSubmission(step, filled).fields, step).toEqual({ email: "user@example.com", password: "", code: "", newPassword: "" });
    }
  });

  it("sends each secret only with the intent that needs it", () => {
    expect(accessSubmission("sign_in", filled).intent).toEqual({ kind: "sign_in", email: filled.email, password: filled.password });
    expect(accessSubmission("verify", filled).intent).toEqual({ kind: "verify", email: filled.email, code: filled.code });
    expect(accessSubmission("reset_request", filled).intent).toEqual({ kind: "request_reset", email: filled.email });
    expect(accessSubmission("reset", filled).intent).toEqual({
      kind: "complete_reset", email: filled.email, code: filled.code, newPassword: filled.newPassword,
    });
    expect(accessSubmission("desktop_returning", filled).intent).toBeNull();
  });
});
