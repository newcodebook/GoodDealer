export type AccountAccessStep = "sign_in" | "register" | "verify" | "reset_request" | "reset" | "desktop_returning";

export interface AccessFields {
  readonly email: string;
  readonly password: string;
  readonly code: string;
  readonly newPassword: string;
}

export type AccessIntent =
  | { readonly kind: "sign_in"; readonly email: string; readonly password: string }
  | { readonly kind: "register"; readonly email: string; readonly password: string }
  | { readonly kind: "verify"; readonly email: string; readonly code: string }
  | { readonly kind: "request_reset"; readonly email: string }
  | { readonly kind: "complete_reset"; readonly email: string; readonly code: string; readonly newPassword: string };

/**
 * Turns a submitted step into the Identity request it asks for and the fields that remain. Every
 * secret goes out with exactly one intent and is cleared in the same transition, so a password or
 * code never outlives its request; only the email survives to prefill the next step.
 */
export function accessSubmission(step: AccountAccessStep, fields: AccessFields): { readonly intent: AccessIntent | null; readonly fields: AccessFields } {
  const cleared: AccessFields = { email: fields.email, password: "", code: "", newPassword: "" };
  switch (step) {
    case "sign_in": return { intent: { kind: "sign_in", email: fields.email, password: fields.password }, fields: cleared };
    case "register": return { intent: { kind: "register", email: fields.email, password: fields.password }, fields: cleared };
    case "verify": return { intent: { kind: "verify", email: fields.email, code: fields.code }, fields: cleared };
    case "reset_request": return { intent: { kind: "request_reset", email: fields.email }, fields: cleared };
    case "reset": return { intent: { kind: "complete_reset", email: fields.email, code: fields.code, newPassword: fields.newPassword }, fields: cleared };
    case "desktop_returning": return { intent: null, fields: cleared };
  }
}
