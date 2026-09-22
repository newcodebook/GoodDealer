import type { CloudMigration } from "../../../db/index";

/**
 * Identity is the sole authority that can turn possession of a live opaque session credential
 * into transaction-local account authority. The roles referenced here are infrastructure inputs:
 * migrations deliberately cannot create or weaken database roles.
 */
export const identityTransactionCapabilityMigration: CloudMigration = {
  id: "202608200019-transaction-capability",
  owner: "identity",
  sql: `
    DO $roles$
    DECLARE
      role_name text;
      role_row record;
    BEGIN
      FOREACH role_name IN ARRAY ARRAY[
        'gd_identity_owner',
        'gd_identity_definer',
        'gd_identity_capability_issuer',
        'gd_account_api',
        'gd_provider_ingress',
        'gd_provider_worker',
        'gd_licensing_owner',
        'gd_licensing_command_definer',
        'gd_licensing_worker_definer',
        'gd_licensing_ingress_definer'
      ] LOOP
        SELECT rolcanlogin, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolreplication
          INTO role_row
          FROM pg_catalog.pg_roles
         WHERE rolname = role_name;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'required externally provisioned role is missing: %', role_name;
        END IF;
        IF role_row.rolsuper OR role_row.rolbypassrls OR role_row.rolcreaterole
           OR role_row.rolcreatedb OR role_row.rolreplication THEN
          RAISE EXCEPTION 'identity capability role is over-privileged: %', role_name;
        END IF;
        IF role_name IN (
          'gd_identity_owner', 'gd_identity_definer',
          'gd_licensing_owner', 'gd_licensing_command_definer',
          'gd_licensing_worker_definer', 'gd_licensing_ingress_definer'
        ) AND role_row.rolcanlogin THEN
          RAISE EXCEPTION 'database owner or definer role must be NOLOGIN: %', role_name;
        END IF;
        IF role_name IN (
          'gd_identity_capability_issuer', 'gd_account_api',
          'gd_provider_ingress', 'gd_provider_worker'
        )
           AND NOT role_row.rolcanlogin THEN
          RAISE EXCEPTION 'runtime trust-domain role must be LOGIN-capable: %', role_name;
        END IF;
      END LOOP;
      IF NOT pg_catalog.pg_has_role(current_user, 'gd_identity_owner', 'MEMBER')
         OR NOT pg_catalog.pg_has_role(current_user, 'gd_identity_definer', 'MEMBER') THEN
        RAISE EXCEPTION 'migration role lacks required Identity ownership memberships';
      END IF;
      IF EXISTS (
        SELECT 1
          FROM pg_catalog.pg_auth_members AS membership
          JOIN pg_catalog.pg_roles AS granted_role ON granted_role.oid = membership.roleid
          JOIN pg_catalog.pg_roles AS member_role ON member_role.oid = membership.member
         WHERE member_role.rolname = current_user
           AND granted_role.rolname IN ('gd_identity_owner', 'gd_identity_definer')
           AND membership.inherit_option
      ) THEN
        RAISE EXCEPTION 'migration role must not inherit Identity owner privileges';
      END IF;
      IF EXISTS (
        SELECT 1
          FROM pg_catalog.pg_auth_members AS membership
          JOIN pg_catalog.pg_roles AS granted_role ON granted_role.oid = membership.roleid
          JOIN pg_catalog.pg_roles AS member_role ON member_role.oid = membership.member
         WHERE member_role.rolname IN (
           'gd_identity_capability_issuer', 'gd_account_api',
           'gd_provider_ingress', 'gd_provider_worker'
         )
           AND granted_role.rolname IN (
             'gd_identity_owner', 'gd_identity_definer', 'gd_licensing_command_definer',
             'gd_licensing_owner', 'gd_licensing_worker_definer',
             'gd_licensing_ingress_definer',
             'gd_identity_capability_issuer', 'gd_account_api',
             'gd_provider_ingress', 'gd_provider_worker'
           )
      ) THEN
        RAISE EXCEPTION 'runtime role crosses an Identity or provider trust boundary';
      END IF;
    END;
    $roles$;

    -- The ordinary migrator must own the schema while constructing its contents. Object owners
    -- are narrowed as they are created; the schema itself transfers only after construction so
    -- this migration does not depend on inherited CREATE through a group-role membership.
    CREATE SCHEMA identity_private;
    REVOKE ALL ON SCHEMA identity_private FROM PUBLIC;
    GRANT USAGE, CREATE ON SCHEMA identity_private TO gd_identity_owner, gd_identity_definer;
    GRANT USAGE ON SCHEMA identity_private
      TO gd_identity_capability_issuer, gd_account_api, gd_licensing_command_definer;
    GRANT USAGE ON SCHEMA public TO gd_identity_definer, gd_account_api;

    CREATE TYPE identity_private.transaction_capability_purpose AS ENUM (
      'identity_account',
      'devices_account',
      'workspace_tenant',
      'billing_read',
      'purchase_reserve',
      'cancellation_request',
      'refund_request',
      'fixed_term_capture',
      'billing_approval_redirect'
    );
    REVOKE ALL ON TYPE identity_private.transaction_capability_purpose FROM PUBLIC;
    GRANT USAGE ON TYPE identity_private.transaction_capability_purpose
      TO gd_identity_capability_issuer, gd_account_api, gd_licensing_command_definer;

    ALTER TABLE public.identity_auth_sessions
      ADD COLUMN session_credential_digest bytea;

    UPDATE public.identity_auth_sessions
       SET session_credential_digest = pg_catalog.sha256(
         pg_catalog.convert_to('GOODDEALER-ACCOUNT-SESSION-CREDENTIAL-V1', 'UTF8')
         || pg_catalog.decode('00', 'hex')
         || pg_catalog.convert_to(session_id, 'UTF8')
       );

    CREATE FUNCTION identity_private.set_session_credential_digest()
      RETURNS trigger
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = pg_catalog
      SET row_security = on
      AS $function$
    BEGIN
      NEW.session_credential_digest := pg_catalog.sha256(
        pg_catalog.convert_to('GOODDEALER-ACCOUNT-SESSION-CREDENTIAL-V1', 'UTF8')
        || pg_catalog.decode('00', 'hex')
        || pg_catalog.convert_to(NEW.session_id, 'UTF8')
      );
      RETURN NEW;
    END;
    $function$;
    REVOKE ALL ON FUNCTION identity_private.set_session_credential_digest() FROM PUBLIC;

    CREATE TRIGGER identity_auth_sessions_credential_digest
      BEFORE INSERT OR UPDATE OF session_id ON public.identity_auth_sessions
      FOR EACH ROW EXECUTE FUNCTION identity_private.set_session_credential_digest();
    ALTER TABLE public.identity_auth_sessions
      ALTER COLUMN session_credential_digest SET NOT NULL,
      ADD CONSTRAINT identity_auth_sessions_credential_digest_length
        CHECK (pg_catalog.octet_length(session_credential_digest) = 32),
      ADD CONSTRAINT identity_auth_sessions_credential_digest_unique
        UNIQUE (session_credential_digest);

    CREATE TABLE identity_private.account_transaction_capabilities (
      capability_id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
      token_digest bytea NOT NULL UNIQUE CHECK (pg_catalog.octet_length(token_digest) = 32),
      principal_id text NOT NULL,
      account_id text NOT NULL,
      identity_session_id text NOT NULL,
      credential_kind text NOT NULL CHECK (credential_kind IN ('account_session', 'access', 'refresh')),
      credential_digest bytea NOT NULL CHECK (pg_catalog.octet_length(credential_digest) = 32),
      issued_session_security_epoch bigint NOT NULL CHECK (issued_session_security_epoch >= 1),
      audience text NOT NULL CHECK (audience = 'account_api'),
      purpose identity_private.transaction_capability_purpose NOT NULL,
      target_backend_pid integer NOT NULL CHECK (target_backend_pid > 0),
      target_transaction_id xid8 NOT NULL,
      request_nonce_digest bytea NOT NULL CHECK (pg_catalog.octet_length(request_nonce_digest) = 32),
      issued_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
      expires_at timestamptz NOT NULL,
      state text NOT NULL DEFAULT 'issued' CHECK (state IN ('issued', 'consumed', 'revoked')),
      consumed_at timestamptz,
      FOREIGN KEY (account_id, identity_session_id)
        REFERENCES public.identity_auth_sessions(account_id, session_id) ON DELETE CASCADE,
      CHECK (issued_at < expires_at AND expires_at <= issued_at + interval '30 seconds'),
      CHECK ((state = 'consumed') = (consumed_at IS NOT NULL)),
      UNIQUE (target_backend_pid, target_transaction_id, audience)
    );
    ALTER TABLE identity_private.account_transaction_capabilities ENABLE ROW LEVEL SECURITY;
    ALTER TABLE identity_private.account_transaction_capabilities FORCE ROW LEVEL SECURITY;
    CREATE POLICY identity_capability_definer_only
      ON identity_private.account_transaction_capabilities
      TO gd_identity_definer USING (true) WITH CHECK (true);

    GRANT SELECT, INSERT ON identity_private.account_transaction_capabilities TO gd_identity_definer;
    GRANT UPDATE (state, consumed_at)
      ON identity_private.account_transaction_capabilities TO gd_identity_definer;
    GRANT SELECT (account_id, session_id, client_kind, epoch_at_issue, expires_at, revoked_at,
                  session_credential_digest)
      ON public.identity_auth_sessions TO gd_identity_definer;
    GRANT SELECT (account_id, account_security_epoch, status)
      ON public.identity_account_security_states TO gd_identity_definer;
    GRANT SELECT (account_id, family_id, session_id, current_refresh_jti, state)
      ON public.identity_refresh_families TO gd_identity_definer;
    GRANT SELECT (jti, account_id, family_id, session_id, kind, state, issued_epoch, expires_at)
      ON public.identity_credential_jtis TO gd_identity_definer;
    CREATE POLICY identity_sessions_capability_definer
      ON public.identity_auth_sessions FOR SELECT TO gd_identity_definer USING (true);
    CREATE POLICY identity_security_capability_definer
      ON public.identity_account_security_states FOR SELECT TO gd_identity_definer USING (true);
    CREATE POLICY identity_families_capability_definer
      ON public.identity_refresh_families FOR SELECT TO gd_identity_definer USING (true);
    CREATE POLICY identity_jtis_capability_definer
      ON public.identity_credential_jtis FOR SELECT TO gd_identity_definer USING (true);

    CREATE FUNCTION identity_private.issue_transaction_capability(
      p_session_credential bytea,
      p_target_backend_pid integer,
      p_target_transaction_id xid8,
      p_request_nonce_digest bytea,
      p_purpose identity_private.transaction_capability_purpose
    ) RETURNS bytea
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = pg_catalog
      SET row_security = on
      AS $function$
    DECLARE
      v_account_id text;
      v_session_id text;
      v_security_epoch bigint;
      v_credential_kind text;
      v_credential_digest bytea;
      v_match_count bigint;
      v_token bytea;
    BEGIN
      IF p_session_credential IS NULL
         OR pg_catalog.octet_length(p_session_credential) NOT BETWEEN 16 AND 4096
         OR p_target_backend_pid <= 0
         OR pg_catalog.octet_length(p_request_nonce_digest) <> 32 THEN
        RAISE EXCEPTION 'account authorization failed' USING ERRCODE = '42501';
      END IF;

      WITH credential_matches AS (
        SELECT session.account_id, session.session_id, security.account_security_epoch,
               'account_session'::text AS credential_kind,
               session.session_credential_digest AS credential_digest
          FROM public.identity_auth_sessions AS session
          JOIN public.identity_account_security_states AS security
            ON security.account_id = session.account_id
         WHERE session.session_credential_digest = pg_catalog.sha256(
                 pg_catalog.convert_to('GOODDEALER-ACCOUNT-SESSION-CREDENTIAL-V1', 'UTF8')
                 || pg_catalog.decode('00', 'hex')
                 || p_session_credential)
           AND session.revoked_at IS NULL
           AND (session.expires_at IS NULL OR session.expires_at > pg_catalog.transaction_timestamp())
           AND session.epoch_at_issue = security.account_security_epoch
           AND security.status = 'normal'
           AND EXISTS (
             SELECT 1 FROM public.identity_refresh_families AS family
              WHERE family.account_id = session.account_id
                AND family.session_id = session.session_id
                AND family.state = 'active'
           )
        UNION ALL
        SELECT credential.account_id, credential.session_id, security.account_security_epoch,
               credential.kind AS credential_kind,
               pg_catalog.sha256(p_session_credential) AS credential_digest
          FROM public.identity_credential_jtis AS credential
          JOIN public.identity_auth_sessions AS session
            ON session.account_id = credential.account_id AND session.session_id = credential.session_id
          JOIN public.identity_refresh_families AS family
            ON family.account_id = credential.account_id AND family.family_id = credential.family_id
          JOIN public.identity_account_security_states AS security
            ON security.account_id = credential.account_id
         WHERE credential.jti = pg_catalog.encode(pg_catalog.sha256(p_session_credential), 'hex')
           AND (
             (credential.kind = 'access' AND credential.state = 'active')
             OR
             (credential.kind = 'refresh' AND credential.state = 'current'
               AND family.current_refresh_jti = credential.jti)
           )
           AND credential.expires_at > pg_catalog.transaction_timestamp()
           AND credential.issued_epoch = security.account_security_epoch
           AND family.state = 'active'
           AND session.revoked_at IS NULL
           AND (session.expires_at IS NULL OR session.expires_at > pg_catalog.transaction_timestamp())
           AND session.epoch_at_issue = security.account_security_epoch
           AND security.status = 'normal'
      )
      SELECT pg_catalog.count(*), pg_catalog.min(account_id), pg_catalog.min(session_id),
             pg_catalog.min(account_security_epoch), pg_catalog.min(credential_kind),
             pg_catalog.decode(pg_catalog.min(pg_catalog.encode(credential_digest, 'hex')), 'hex')
        INTO v_match_count, v_account_id, v_session_id, v_security_epoch,
             v_credential_kind, v_credential_digest
        FROM credential_matches;

      IF v_match_count <> 1 THEN
        RAISE EXCEPTION 'account authorization failed' USING ERRCODE = '42501';
      END IF;

      v_token := pg_catalog.uuid_send(pg_catalog.gen_random_uuid())
                 || pg_catalog.uuid_send(pg_catalog.gen_random_uuid());
      INSERT INTO identity_private.account_transaction_capabilities (
        token_digest, principal_id, account_id, identity_session_id,
        credential_kind, credential_digest,
        issued_session_security_epoch, audience, purpose, target_backend_pid,
        target_transaction_id, request_nonce_digest, expires_at
      ) VALUES (
        pg_catalog.sha256(v_token), v_account_id, v_account_id, v_session_id,
        v_credential_kind, v_credential_digest,
        v_security_epoch, 'account_api', p_purpose, p_target_backend_pid,
        p_target_transaction_id, p_request_nonce_digest,
        pg_catalog.transaction_timestamp() + interval '30 seconds'
      );
      RETURN v_token;
    EXCEPTION
      WHEN unique_violation THEN
        RAISE EXCEPTION 'account authorization failed' USING ERRCODE = '42501';
    END;
    $function$;

    CREATE FUNCTION identity_private.current_transaction_account(
      p_purpose identity_private.transaction_capability_purpose
    ) RETURNS text
      LANGUAGE sql
      STABLE
      SECURITY DEFINER
      SET search_path = pg_catalog
      SET row_security = on
      RETURN (
        SELECT capability.account_id
          FROM identity_private.account_transaction_capabilities AS capability
          JOIN public.identity_auth_sessions AS session
            ON session.account_id = capability.account_id
           AND session.session_id = capability.identity_session_id
          JOIN public.identity_account_security_states AS security
            ON security.account_id = capability.account_id
         WHERE capability.state = 'consumed'
           AND capability.audience = 'account_api'
           AND capability.purpose = p_purpose
           AND capability.target_backend_pid = pg_catalog.pg_backend_pid()
           AND capability.target_transaction_id = pg_catalog.pg_current_xact_id()
           AND capability.expires_at > pg_catalog.transaction_timestamp()
           AND session.revoked_at IS NULL
           AND (session.expires_at IS NULL OR session.expires_at > pg_catalog.transaction_timestamp())
           AND session.epoch_at_issue = capability.issued_session_security_epoch
           AND security.account_security_epoch = capability.issued_session_security_epoch
           AND security.status = 'normal'
           AND EXISTS (
             SELECT 1 FROM public.identity_refresh_families AS family
              WHERE family.account_id = capability.account_id
                AND family.session_id = capability.identity_session_id
                AND family.state = 'active'
           )
           AND (
             (capability.credential_kind = 'account_session'
               AND session.session_credential_digest = capability.credential_digest)
             OR
             (capability.credential_kind IN ('access', 'refresh') AND EXISTS (
               SELECT 1 FROM public.identity_credential_jtis AS credential
                WHERE credential.account_id = capability.account_id
                  AND credential.session_id = capability.identity_session_id
                  AND credential.jti = pg_catalog.encode(capability.credential_digest, 'hex')
                  AND credential.kind = capability.credential_kind
                  AND (
                    (credential.kind = 'access' AND credential.state = 'active')
                    OR
                    (credential.kind = 'refresh' AND credential.state = 'current'
                      AND EXISTS (
                        SELECT 1 FROM public.identity_refresh_families AS current_family
                         WHERE current_family.account_id = credential.account_id
                           AND current_family.family_id = credential.family_id
                           AND current_family.session_id = credential.session_id
                           AND current_family.state = 'active'
                           AND current_family.current_refresh_jti = credential.jti
                      ))
                  )
                  AND credential.issued_epoch = capability.issued_session_security_epoch
                  AND credential.expires_at > pg_catalog.transaction_timestamp()
             ))
           )
      );

    CREATE FUNCTION identity_private.current_transaction_account()
      RETURNS text
      LANGUAGE plpgsql
      STABLE
      SECURITY DEFINER
      SET search_path = pg_catalog
      SET row_security = on
      AS $function$
    DECLARE
      v_purpose identity_private.transaction_capability_purpose;
      v_purpose_setting text;
    BEGIN
      v_purpose_setting := nullif(
        pg_catalog.current_setting('gooddealer.capability_purpose', true), ''
      );
      IF v_purpose_setting IS NULL THEN
        RETURN NULL;
      END IF;
      v_purpose := CASE v_purpose_setting
        WHEN 'identity_account' THEN 'identity_account'::identity_private.transaction_capability_purpose
        WHEN 'devices_account' THEN 'devices_account'::identity_private.transaction_capability_purpose
        WHEN 'workspace_tenant' THEN 'workspace_tenant'::identity_private.transaction_capability_purpose
        WHEN 'billing_read' THEN 'billing_read'::identity_private.transaction_capability_purpose
        WHEN 'purchase_reserve' THEN 'purchase_reserve'::identity_private.transaction_capability_purpose
        WHEN 'cancellation_request' THEN 'cancellation_request'::identity_private.transaction_capability_purpose
        WHEN 'refund_request' THEN 'refund_request'::identity_private.transaction_capability_purpose
        WHEN 'fixed_term_capture' THEN 'fixed_term_capture'::identity_private.transaction_capability_purpose
        WHEN 'billing_approval_redirect' THEN 'billing_approval_redirect'::identity_private.transaction_capability_purpose
        ELSE NULL
      END;
      IF v_purpose IS NULL THEN
        RETURN NULL;
      END IF;
      RETURN identity_private.current_transaction_account(v_purpose);
    END;
    $function$;

    CREATE FUNCTION identity_private.consume_transaction_capability(
      p_token bytea,
      p_request_nonce bytea,
      p_purpose identity_private.transaction_capability_purpose
    ) RETURNS void
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = pg_catalog
      SET row_security = on
      AS $function$
    DECLARE
      v_capability identity_private.account_transaction_capabilities%ROWTYPE;
      v_current_account text;
    BEGIN
      IF pg_catalog.octet_length(p_token) <> 32
         OR pg_catalog.octet_length(p_request_nonce) <> 32 THEN
        RAISE EXCEPTION 'account authorization failed' USING ERRCODE = '42501';
      END IF;
      SELECT * INTO v_capability
        FROM identity_private.account_transaction_capabilities
       WHERE token_digest = pg_catalog.sha256(p_token)
       FOR UPDATE;
      IF NOT FOUND
         OR v_capability.state <> 'issued'
         OR v_capability.audience <> 'account_api'
         OR v_capability.purpose <> p_purpose
         OR v_capability.expires_at <= pg_catalog.transaction_timestamp()
         OR v_capability.target_backend_pid <> pg_catalog.pg_backend_pid()
         OR v_capability.target_transaction_id <> pg_catalog.pg_current_xact_id()
         OR v_capability.request_nonce_digest <> pg_catalog.sha256(p_request_nonce) THEN
        RAISE EXCEPTION 'account authorization failed' USING ERRCODE = '42501';
      END IF;
      UPDATE identity_private.account_transaction_capabilities
         SET state = 'consumed', consumed_at = pg_catalog.transaction_timestamp()
       WHERE capability_id = v_capability.capability_id AND state = 'issued';
      v_current_account := identity_private.current_transaction_account(p_purpose);
      IF v_current_account IS NULL THEN
        RAISE EXCEPTION 'account authorization failed' USING ERRCODE = '42501';
      END IF;
      PERFORM pg_catalog.set_config('gooddealer.account_id', v_current_account, true);
      PERFORM pg_catalog.set_config('gooddealer.capability_purpose', p_purpose::text, true);
    END;
    $function$;

    REVOKE ALL ON FUNCTION identity_private.issue_transaction_capability(
      bytea, integer, xid8, bytea, identity_private.transaction_capability_purpose
    ) FROM PUBLIC;
    REVOKE ALL ON FUNCTION identity_private.consume_transaction_capability(
      bytea, bytea, identity_private.transaction_capability_purpose
    ) FROM PUBLIC;
    REVOKE ALL ON FUNCTION identity_private.current_transaction_account(
      identity_private.transaction_capability_purpose
    ) FROM PUBLIC;
    REVOKE ALL ON FUNCTION identity_private.current_transaction_account() FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION identity_private.issue_transaction_capability(
      bytea, integer, xid8, bytea, identity_private.transaction_capability_purpose
    ) TO gd_identity_capability_issuer;
    GRANT EXECUTE ON FUNCTION identity_private.consume_transaction_capability(
      bytea, bytea, identity_private.transaction_capability_purpose
    ) TO gd_account_api;
    GRANT EXECUTE ON FUNCTION identity_private.current_transaction_account(
      identity_private.transaction_capability_purpose
    ) TO gd_licensing_command_definer;
    GRANT EXECUTE ON FUNCTION identity_private.current_transaction_account() TO gd_account_api;

    -- Existing selectors remain useful query narrowing, but the authenticated account role must
    -- also present an exact consumed capability. Restrictive policies compose with each module's
    -- existing command-specific permissive policies without rewriting their business predicates.
    DO $policies$
    DECLARE
      protected_table record;
      privilege_row record;
      column_row record;
    BEGIN
      FOR protected_table IN
        SELECT class.relname
          FROM pg_catalog.pg_class AS class
          JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace
          JOIN pg_catalog.pg_attribute AS attribute
            ON attribute.attrelid = class.oid AND attribute.attname = 'account_id'
           AND attribute.attnum > 0 AND NOT attribute.attisdropped
         WHERE namespace.nspname = 'public'
           AND class.relkind IN ('r', 'p')
           AND class.relrowsecurity
           AND class.relname ~ '^(identity_|device_|workspace_|mutation_)'
      LOOP
        EXECUTE pg_catalog.format(
          'CREATE POLICY %I ON public.%I AS RESTRICTIVE TO gd_account_api USING (account_id = identity_private.current_transaction_account()) WITH CHECK (account_id = identity_private.current_transaction_account())',
          protected_table.relname || '_identity_capability',
          protected_table.relname
        );
      END LOOP;

      FOR privilege_row IN
        SELECT table_name, privilege_type
          FROM information_schema.table_privileges
         WHERE table_schema = 'public' AND grantee = 'gooddealer_cloud_app'
           AND table_name ~ '^(identity_|device_|workspace_|mutation_)'
      LOOP
        EXECUTE pg_catalog.format(
          'GRANT %s ON TABLE public.%I TO gd_account_api',
          privilege_row.privilege_type,
          privilege_row.table_name
        );
      END LOOP;
      FOR column_row IN
        SELECT table_name, column_name, privilege_type
          FROM information_schema.column_privileges
         WHERE table_schema = 'public' AND grantee = 'gooddealer_cloud_app'
           AND table_name ~ '^(identity_|device_|workspace_|mutation_)'
      LOOP
        EXECUTE pg_catalog.format(
          'GRANT %s (%I) ON TABLE public.%I TO gd_account_api',
          column_row.privilege_type,
          column_row.column_name,
          column_row.table_name
        );
      END LOOP;
    END;
    $policies$;

    SET LOCAL ROLE gd_identity_owner;
    ALTER DEFAULT PRIVILEGES IN SCHEMA identity_private REVOKE ALL ON TABLES FROM PUBLIC;
    ALTER DEFAULT PRIVILEGES IN SCHEMA identity_private REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
    RESET ROLE;
    SET LOCAL ROLE gd_identity_definer;
    ALTER DEFAULT PRIVILEGES IN SCHEMA identity_private REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
    RESET ROLE;

    -- Ownership transfers happen only after every policy, ACL and trigger is installed. With
    -- non-inherited memberships, the migrator cannot keep altering objects after this point.
    ALTER TYPE identity_private.transaction_capability_purpose OWNER TO gd_identity_owner;
    ALTER TABLE identity_private.account_transaction_capabilities OWNER TO gd_identity_owner;
    ALTER FUNCTION identity_private.set_session_credential_digest() OWNER TO gd_identity_definer;
    ALTER FUNCTION identity_private.issue_transaction_capability(
      bytea, integer, xid8, bytea, identity_private.transaction_capability_purpose
    ) OWNER TO gd_identity_definer;
    ALTER FUNCTION identity_private.current_transaction_account(
      identity_private.transaction_capability_purpose
    ) OWNER TO gd_identity_definer;
    ALTER FUNCTION identity_private.current_transaction_account() OWNER TO gd_identity_definer;
    ALTER FUNCTION identity_private.consume_transaction_capability(
      bytea, bytea, identity_private.transaction_capability_purpose
    ) OWNER TO gd_identity_definer;

    REVOKE CREATE ON SCHEMA identity_private FROM gd_identity_owner, gd_identity_definer;
    DO $database_grant$
    BEGIN
      EXECUTE pg_catalog.format(
        'GRANT CREATE ON DATABASE %I TO gd_identity_owner',
        pg_catalog.current_database()
      );
    END;
    $database_grant$;
    ALTER SCHEMA identity_private OWNER TO gd_identity_owner;
    -- Granted by the final private owner so ownership transfer cannot discard the maintenance ACL.
    -- The migrator receives no row read/write privilege and no runtime role receives TRUNCATE.
    SET LOCAL ROLE gd_identity_owner;
    GRANT USAGE ON SCHEMA identity_private TO gooddealer_cloud_owner;
    GRANT TRUNCATE ON identity_private.account_transaction_capabilities TO gooddealer_cloud_owner;
    RESET ROLE;
    DO $database_revoke$
    BEGIN
      EXECUTE pg_catalog.format(
        'REVOKE CREATE ON DATABASE %I FROM gd_identity_owner',
        pg_catalog.current_database()
      );
    END;
    $database_revoke$;
  `,
};
