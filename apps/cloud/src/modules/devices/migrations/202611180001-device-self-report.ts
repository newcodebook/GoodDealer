import type { CloudMigration } from "../../../db/index";

/**
 * ADR-0032 S3a: a Desktop reports its own platform and display name so the device list and the
 * handoff confirmation can name devices. Cloud never infers either; both stay null until the
 * device reports. Last seen is kept in whole hours, so the list cannot reveal finer activity.
 */
export const deviceSelfReportMigration: CloudMigration = {
  id: "202611180001-device-self-report",
  owner: "devices",
  sql: `
    ALTER TABLE public.device_bindings
      ADD COLUMN platform text
        CHECK (platform IN ('windows', 'macos', 'linux', 'ios', 'android')),
      -- The same rule as the protocol's displayLabel, kept here as the last gate: no Unicode Cc or
      -- Cf character (the class lists both categories as of Unicode 17) and no leading or trailing
      -- whitespace as JavaScript's trim() defines it.
      ADD COLUMN display_name text
        CHECK (
          char_length(display_name) BETWEEN 1 AND 64
          AND display_name !~ '[\\u0000-\\u001F\\u007F-\\u009F\\u00AD\\u0600-\\u0605\\u061C\\u06DD\\u070F\\u0890-\\u0891\\u08E2\\u180E\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u2064\\u2066-\\u206F\\uFEFF\\uFFF9-\\uFFFB\\U000110BD\\U000110CD\\U00013430-\\U0001343F\\U0001BCA0-\\U0001BCA3\\U0001D173-\\U0001D17A\\U000E0001\\U000E0020-\\U000E007F]'
          AND display_name !~ '^[\\u0009-\\u000D\\u0020\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF]|[\\u0009-\\u000D\\u0020\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF]$'
        ),
      ADD COLUMN last_seen_at timestamptz
        CHECK (last_seen_at = date_trunc('hour', last_seen_at, 'UTC')),
      ADD CONSTRAINT device_bindings_reported_together
        CHECK ((platform IS NULL) = (display_name IS NULL));
  `,
};
