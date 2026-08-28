export type CloudflareConnectionUnavailableCode =
  | "authentication"
  | "permission"
  | "rate-limited"
  | "temporarily-unavailable"
  | "invalid-observation";

export type CloudflareConnectionState =
  | { readonly state: "loading" }
  | { readonly state: "not-configured"; readonly manualGuidance: string }
  | { readonly state: "checking"; readonly connectionLabel: string }
  | {
      readonly state: "available";
      readonly connectionLabel: string;
      readonly zoneName: string;
      readonly observedAt: string;
      readonly version: number;
      readonly uncertainty: "confirmed";
    }
  | {
      readonly state: "stale";
      readonly connectionLabel: string;
      readonly zoneName: string;
      readonly observedAt: string;
      readonly version: number;
    }
  | {
      readonly state: "uncertain";
      readonly connectionLabel: string;
      readonly zoneName: string | null;
      readonly observedAt: string | null;
      readonly version: number | null;
    }
  | {
      readonly state: "unavailable";
      readonly code: CloudflareConnectionUnavailableCode;
      readonly retryAfterSeconds: number | null;
      readonly manualGuidance: string;
    }
  | {
      readonly state: "error";
      readonly code: "invalid-projection" | "read-failed";
      readonly manualGuidance: string;
    };
