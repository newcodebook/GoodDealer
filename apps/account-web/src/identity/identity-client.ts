import { parseAuthenticatedIdentitySession } from "../browser-storage";

export type IdentityFetch = (path: string, init: RequestInit) => Promise<Response>;

/** A refused Identity request; only the HTTP status crosses, never server text. */
export interface IdentityRejection {
  readonly ok: false;
  readonly httpStatus: number;
}

export type IdentityOutcome<Status extends string> = { readonly ok: true; readonly status: Status } | IdentityRejection;

export type IdentitySession =
  | { readonly kind: "authenticated"; readonly namespace: string }
  | { readonly kind: "unauthenticated"; readonly httpStatus: number }
  | { readonly kind: "invalid" };

export interface IdentityClient {
  readSession(): Promise<IdentitySession>;
  signIn(email: string, password: string): Promise<IdentityOutcome<"authenticated">>;
  register(email: string, password: string): Promise<IdentityOutcome<"accepted">>;
  verify(email: string, code: string): Promise<IdentityOutcome<"verified">>;
  resendVerification(email: string): Promise<IdentityOutcome<"accepted">>;
  requestPasswordReset(email: string): Promise<IdentityOutcome<"accepted">>;
  completePasswordReset(email: string, code: string, password: string): Promise<IdentityOutcome<"completed">>;
  signOut(): Promise<IdentityOutcome<"signed_out">>;
}

/**
 * Same-origin Identity ingress client. Passwords and codes travel only in the request body of the
 * one call that needs them and are never retained here. A successful status code alone is not an
 * authentication fact: every accepted reply must parse to exactly the expected `status`, otherwise
 * the call throws and the caller fails closed.
 */
export function createIdentityClient(fetcher: IdentityFetch): IdentityClient {
  async function post<const Status extends string>(
    path: string,
    body: Readonly<Record<string, string>>,
    accepted: Status,
  ): Promise<IdentityOutcome<Status>> {
    const response = await fetcher(path, {
      method: "POST",
      credentials: "same-origin",
      redirect: "error",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) return { ok: false, httpStatus: response.status };
    if (await readIdentityStatus(response, [accepted]) !== accepted) {
      throw new TypeError(`Identity response for ${path} is invalid`);
    }
    return { ok: true, status: accepted };
  }

  return {
    async readSession() {
      const response = await fetcher("/v1/identity/session", { credentials: "same-origin", redirect: "error" });
      if (!response.ok) return { kind: "unauthenticated", httpStatus: response.status };
      let value: unknown;
      try { value = await response.json() as unknown; } catch { return { kind: "invalid" }; }
      const session = parseAuthenticatedIdentitySession(value);
      return session === null ? { kind: "invalid" } : { kind: "authenticated", namespace: session.namespace };
    },
    signIn: (email, password) => post("/v1/identity/login", { email, password }, "authenticated"),
    register: (email, password) => post("/v1/identity/registration", { email, password }, "accepted"),
    verify: (email, code) => post("/v1/identity/registration/verify", { email, code }, "verified"),
    resendVerification: (email) => post("/v1/identity/registration/resend", { email }, "accepted"),
    requestPasswordReset: (email) => post("/v1/identity/password-reset", { email }, "accepted"),
    completePasswordReset: (email, code, password) => post("/v1/identity/password-reset/complete", { email, code, password }, "completed"),
    signOut: () => post("/v1/identity/logout", {}, "signed_out"),
  };
}

/** Accepts only a plain JSON object whose single own enumerable data property is an allowed `status`. */
export async function readIdentityStatus<const Status extends string>(
  response: Response,
  accepted: readonly Status[],
): Promise<Status | null> {
  let value: unknown;
  try { value = await response.json() as unknown; } catch { return null; }
  if (typeof value !== "object" || value === null || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) return null;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== 1 || keys[0] !== "status") return null;
  const descriptor = Object.getOwnPropertyDescriptor(value, "status");
  if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true
    || typeof descriptor.value !== "string" || !accepted.includes(descriptor.value as Status)) return null;
  return descriptor.value as Status;
}
