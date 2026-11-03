import type { CloudMigration } from "../../../db/index";

/**
 * ADR-0026: authorization codes now record the exact per-attempt loopback redirect that the token
 * exchange must repeat. Custom-scheme codes are unredeemable short-lived history, so the
 * replacement constraint is NOT VALID and binds only new writes.
 */
export const desktopCodeLoopbackRedirectMigration: CloudMigration = {
  id: "202611020002-desktop-code-loopback-redirect",
  owner: "identity",
  sql: `
    ALTER TABLE identity_desktop_authorization_codes
      DROP CONSTRAINT identity_desktop_authorization_codes_redirect_uri_check;
    ALTER TABLE identity_desktop_authorization_codes
      ADD CONSTRAINT identity_desktop_authorization_codes_redirect_uri_check CHECK (
        redirect_uri ~ '^http://127\\.0\\.0\\.1:[1-9][0-9]{3,4}/oauth/callback$'
        AND substring(redirect_uri FROM ':([0-9]+)/')::integer BETWEEN 1024 AND 65535
      ) NOT VALID;
  `,
};
