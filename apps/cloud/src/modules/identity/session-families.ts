export type CredentialJtiState = "current" | "rotated" | "revoked";

interface CredentialJtiRecord {
  readonly jti: string;
  readonly familyId: string;
  readonly kind: "access" | "refresh";
  state: CredentialJtiState;
}

interface RotationFamilyRecord {
  readonly familyId: string;
  currentRefreshJti: string;
  rotationGeneration: number;
  state: "active" | "revoked";
}

export interface PreparedRefreshRotation {
  readonly familyId: string;
  readonly presentedRefreshJti: string;
  readonly expectedRotationGeneration: number;
}

export type RotationInspection =
  | { readonly status: "ready"; readonly preparation: PreparedRefreshRotation }
  | { readonly status: "invalid_credentials" }
  | { readonly status: "refresh_reuse_detected" }
  | { readonly status: "session_revoked" };

export type RotationCommit =
  | { readonly status: "rotated"; readonly rotationGeneration: number }
  | { readonly status: "refresh_rotation_conflict" }
  | { readonly status: "credential_jti_conflict" }
  | { readonly status: "session_revoked" };

/** In-memory transaction model for refresh families and the globally unique JTI register. */
export class SessionFamilyStore {
  readonly #credentials = new Map<string, CredentialJtiRecord>();
  readonly #families = new Map<string, RotationFamilyRecord>();

  createFamily(input: {
    readonly familyId: string;
    readonly refreshJti: string;
    readonly accessJti: string;
  }): { readonly created: true } | { readonly created: false; readonly reason: "credential_jti_conflict" } {
    if (
      input.refreshJti === input.accessJti ||
      this.#credentials.has(input.refreshJti) ||
      this.#credentials.has(input.accessJti) ||
      this.#families.has(input.familyId)
    ) {
      return { created: false, reason: "credential_jti_conflict" };
    }

    // All uniqueness checks precede every write: a failed issuance cannot partially
    // register one JTI or create an authority-bearing family.
    this.#credentials.set(input.refreshJti, {
      jti: input.refreshJti,
      familyId: input.familyId,
      kind: "refresh",
      state: "current",
    });
    this.#credentials.set(input.accessJti, {
      jti: input.accessJti,
      familyId: input.familyId,
      kind: "access",
      state: "current",
    });
    this.#families.set(input.familyId, {
      familyId: input.familyId,
      currentRefreshJti: input.refreshJti,
      rotationGeneration: 0,
      state: "active",
    });
    return { created: true };
  }

  inspectRotation(familyId: string, presentedRefreshJti: string): RotationInspection {
    const credential = this.#credentials.get(presentedRefreshJti);
    if (credential === undefined || credential.kind !== "refresh" || credential.familyId !== familyId) {
      return { status: "invalid_credentials" };
    }
    const family = this.#families.get(familyId);
    if (family === undefined || family.state === "revoked") return { status: "session_revoked" };
    if (credential.state !== "current") return { status: "refresh_reuse_detected" };
    return {
      status: "ready",
      preparation: {
        familyId,
        presentedRefreshJti,
        expectedRotationGeneration: family.rotationGeneration,
      },
    };
  }

  commitRotation(
    preparation: PreparedRefreshRotation,
    next: { readonly refreshJti: string; readonly accessJti: string },
  ): RotationCommit {
    const family = this.#families.get(preparation.familyId);
    if (family === undefined || family.state === "revoked") return { status: "session_revoked" };
    if (
      family.rotationGeneration !== preparation.expectedRotationGeneration ||
      family.currentRefreshJti !== preparation.presentedRefreshJti
    ) {
      return { status: "refresh_rotation_conflict" };
    }
    if (
      next.refreshJti === next.accessJti ||
      this.#credentials.has(next.refreshJti) ||
      this.#credentials.has(next.accessJti)
    ) {
      return { status: "credential_jti_conflict" };
    }

    const presented = this.#credentials.get(preparation.presentedRefreshJti);
    if (presented === undefined || presented.state !== "current") {
      return { status: "refresh_rotation_conflict" };
    }

    // This synchronous commit is the fixture's transaction boundary. The next two JTI
    // inserts and the current-JTI CAS become visible together.
    presented.state = "rotated";
    this.#credentials.set(next.refreshJti, {
      jti: next.refreshJti,
      familyId: family.familyId,
      kind: "refresh",
      state: "current",
    });
    this.#credentials.set(next.accessJti, {
      jti: next.accessJti,
      familyId: family.familyId,
      kind: "access",
      state: "current",
    });
    family.currentRefreshJti = next.refreshJti;
    family.rotationGeneration += 1;
    return { status: "rotated", rotationGeneration: family.rotationGeneration };
  }

  revokeFamily(familyId: string): boolean {
    const family = this.#families.get(familyId);
    if (family === undefined || family.state === "revoked") return false;
    family.state = "revoked";
    for (const credential of this.#credentials.values()) {
      if (credential.familyId === familyId) credential.state = "revoked";
    }
    return true;
  }

  currentRefreshJti(familyId: string): string | null {
    const family = this.#families.get(familyId);
    return family?.state === "active" ? family.currentRefreshJti : null;
  }

  rotationGeneration(familyId: string): number | null {
    return this.#families.get(familyId)?.rotationGeneration ?? null;
  }

  credentialState(jti: string): CredentialJtiState | null {
    return this.#credentials.get(jti)?.state ?? null;
  }

  hasFamily(familyId: string): boolean {
    return this.#families.has(familyId);
  }
}
