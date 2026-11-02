import type { CloudMigration } from "../../../db/index";

/**
 * ADR-0026 moves the Desktop OAuth callback from the custom scheme to an RFC 8252 loopback
 * redirect whose port Desktop binds per attempt. Challenge rows written under the custom scheme
 * cannot satisfy the new form and are only short-lived history, so the replacement constraint is
 * NOT VALID: legacy rows stay readable until they expire, and every new write must be loopback.
 */
export const desktopLoginLoopbackRedirectMigration: CloudMigration = {
  id: "202611020001-desktop-login-loopback-redirect",
  owner: "devices",
  sql: `
    ALTER TABLE device_login_challenges
      DROP CONSTRAINT device_login_challenges_redirect_uri_check;
    ALTER TABLE device_login_challenges
      ADD CONSTRAINT device_login_challenges_redirect_uri_check CHECK (
        redirect_uri ~ '^http://127\\.0\\.0\\.1:[1-9][0-9]{3,4}/oauth/callback$'
        AND substring(redirect_uri FROM ':([0-9]+)/')::integer BETWEEN 1024 AND 65535
      ) NOT VALID;
  `,
};
