import type { CloudMigration } from "../../../db/index";

/**
 * Catalog-integrated M013 audit repository foundation. The app role is
 * deliberately granted neither table DML nor append execution: the production Audit Service
 * signer remains denying until a custodian-backed KMS/HSM and rotation authority exist.
 */
export const serverAuditSubstrateMigration: CloudMigration = {
  id: "202608200013-server-audit-substrate",
  owner: "audit",
  sql: `
    REVOKE CREATE ON SCHEMA public FROM PUBLIC, gooddealer_cloud_app;
    GRANT USAGE ON SCHEMA public TO gooddealer_cloud_owner, gooddealer_cloud_app;

    CREATE TABLE public.server_audit_entries (
      audit_event_id text PRIMARY KEY CHECK (audit_event_id ~ '^[!-~]{1,160}$'),
      audit_event_kind text NOT NULL CHECK (audit_event_kind IN ('user', 'staff', 'service')),
      event_type text NOT NULL CHECK (event_type ~ '^[a-z_]{1,80}$'),
      target_type text NOT NULL CHECK (target_type ~ '^[!-~]{1,160}$'),
      target_ref text NOT NULL CHECK (target_ref ~ '^[!-~]{1,160}$'),
      actor_id text NOT NULL CHECK (actor_id ~ '^[!-~]{1,160}$'),
      tenant_scope text NOT NULL CHECK (tenant_scope IN ('global', 'account', 'workspace')),
      account_id text,
      workspace_id text,
      chain_id bytea NOT NULL CHECK (pg_catalog.octet_length(chain_id) = 32),
      audit_sequence bigint NOT NULL CHECK (audit_sequence BETWEEN 1 AND 9007199254740991),
      previous_hash bytea NOT NULL CHECK (pg_catalog.octet_length(previous_hash) = 32),
      event_hash bytea NOT NULL CHECK (pg_catalog.octet_length(event_hash) = 32),
      occurred_at timestamptz NOT NULL,
      authorization_context_hash bytea NOT NULL CHECK (pg_catalog.octet_length(authorization_context_hash) = 32),
      cryptographic_signer_kind text NOT NULL CHECK (cryptographic_signer_kind = 'gooddealer_audit_service'),
      cryptographic_signer_id text NOT NULL CHECK (cryptographic_signer_id ~ '^[!-~]{1,160}$'),
      signing_key_id text NOT NULL CHECK (signing_key_id ~ '^[!-~]{1,160}$'),
      signing_key_version bigint NOT NULL CHECK (signing_key_version BETWEEN 1 AND 9007199254740991),
      signature_transcript_version bigint NOT NULL CHECK (signature_transcript_version BETWEEN 1 AND 9007199254740991),
      server_signature bytea NOT NULL CHECK (pg_catalog.octet_length(server_signature) BETWEEN 1 AND 1024),
      signing_key_transition_id text REFERENCES public.server_audit_entries(audit_event_id),
      actor_kind text NOT NULL CHECK (actor_kind IN ('user', 'staff', 'service')),
      authorization_source text NOT NULL CHECK (authorization_source IN (
        'user_session', 'admin_read_authorization', 'admin_action_authorization',
        'service_identity', 'tenant_job_context'
      )),
      signing_key_purpose text NOT NULL CHECK (signing_key_purpose IN ('user_audit', 'staff_audit', 'service_audit')),
      payload_redacted jsonb NOT NULL CHECK (pg_catalog.jsonb_typeof(payload_redacted) = 'object'),
      canonical_evidence bytea NOT NULL CHECK (pg_catalog.octet_length(canonical_evidence) BETWEEN 1 AND 131072),
      canonical_evidence_digest bytea NOT NULL CHECK (pg_catalog.octet_length(canonical_evidence_digest) = 32),
      committed_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
      CHECK (
        (tenant_scope = 'global' AND account_id IS NULL AND workspace_id IS NULL)
        OR (tenant_scope = 'account' AND account_id ~ '^[!-~]{1,160}$' AND workspace_id IS NULL)
        OR (tenant_scope = 'workspace' AND account_id ~ '^[!-~]{1,160}$' AND workspace_id ~ '^[!-~]{1,160}$')
      ),
      CHECK (
        (audit_event_kind = 'user' AND actor_kind = 'user' AND authorization_source = 'user_session'
          AND signing_key_purpose = 'user_audit')
        OR (audit_event_kind = 'staff' AND actor_kind = 'staff'
          AND authorization_source IN ('admin_read_authorization', 'admin_action_authorization')
          AND signing_key_purpose = 'staff_audit')
        OR (audit_event_kind = 'service' AND actor_kind = 'service'
          AND authorization_source IN ('service_identity', 'tenant_job_context')
          AND signing_key_purpose = 'service_audit')
      ),
      UNIQUE (chain_id, audit_sequence)
    );

    CREATE TABLE public.server_audit_heads (
      chain_id bytea PRIMARY KEY CHECK (pg_catalog.octet_length(chain_id) = 32),
      tenant_scope text NOT NULL CHECK (tenant_scope IN ('global', 'account', 'workspace')),
      account_id text,
      workspace_id text,
      actor_id text NOT NULL CHECK (actor_id ~ '^[!-~]{1,160}$'),
      audit_event_kind text NOT NULL CHECK (audit_event_kind IN ('user', 'staff', 'service')),
      audit_sequence bigint NOT NULL CHECK (audit_sequence BETWEEN 1 AND 9007199254740991),
      event_hash bytea NOT NULL CHECK (pg_catalog.octet_length(event_hash) = 32),
      CHECK (
        (tenant_scope = 'global' AND account_id IS NULL AND workspace_id IS NULL)
        OR (tenant_scope = 'account' AND account_id ~ '^[!-~]{1,160}$' AND workspace_id IS NULL)
        OR (tenant_scope = 'workspace' AND account_id ~ '^[!-~]{1,160}$' AND workspace_id ~ '^[!-~]{1,160}$')
      )
    );

    /* Rejection evidence is intentionally digest-only. It cannot become a side channel for raw
       requests, payloads, keys, credentials, headers, or a generic event-body archive. */
    CREATE TABLE public.server_audit_quarantines (
      tenant_scope text NOT NULL CHECK (tenant_scope = 'workspace'),
      account_id text NOT NULL CHECK (account_id ~ '^[!-~]{1,160}$'),
      workspace_id text NOT NULL CHECK (workspace_id ~ '^[!-~]{1,160}$'),
      candidate_digest bytea NOT NULL CHECK (pg_catalog.octet_length(candidate_digest) = 32),
      rejection_code text NOT NULL CHECK (rejection_code IN (
        'context_untrusted', 'schema_invalid', 'canonical_conflict', 'transition_invalid',
        'signer_invalid', 'append_conflict'
      )),
      rejected_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
      PRIMARY KEY (account_id, workspace_id, candidate_digest, rejection_code)
    );

    /* Auxiliary transition facts are not a fifth event class or a key registry. They index only
       immutable Service transition records so the first ordinary incoming record can resolve an
       exact signed cross-chain edge without raw key material. */
    CREATE TABLE public.server_audit_transition_edges (
      transition_audit_event_id text PRIMARY KEY
        REFERENCES public.server_audit_entries(audit_event_id) ON DELETE RESTRICT,
      affected_signing_key_purpose text NOT NULL CHECK (affected_signing_key_purpose IN (
        'user_audit', 'staff_audit', 'service_audit'
      )),
      affected_outgoing_public_key_id text NOT NULL CHECK (affected_outgoing_public_key_id ~ '^[!-~]{1,160}$'),
      affected_outgoing_public_key_version bigint NOT NULL CHECK (affected_outgoing_public_key_version BETWEEN 1 AND 9007199254740991),
      affected_incoming_public_key_id text NOT NULL CHECK (affected_incoming_public_key_id ~ '^[!-~]{1,160}$'),
      affected_incoming_public_key_version bigint NOT NULL CHECK (affected_incoming_public_key_version BETWEEN 1 AND 9007199254740991),
      transition_chain_id bytea NOT NULL CHECK (pg_catalog.octet_length(transition_chain_id) = 32),
      transition_audit_sequence bigint NOT NULL CHECK (transition_audit_sequence BETWEEN 1 AND 9007199254740991),
      not_before_occurred_at timestamptz NOT NULL,
      custody_approval_digest bytea NOT NULL CHECK (pg_catalog.octet_length(custody_approval_digest) = 32),
      CHECK (
        affected_outgoing_public_key_id <> affected_incoming_public_key_id
        OR affected_outgoing_public_key_version <> affected_incoming_public_key_version
      )
    );

    CREATE UNIQUE INDEX server_audit_first_incoming_link_once
      ON public.server_audit_entries (chain_id, signing_key_purpose, signing_key_id, signing_key_version)
      WHERE signing_key_transition_id IS NOT NULL;

    ALTER TABLE public.server_audit_entries ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.server_audit_entries FORCE ROW LEVEL SECURITY;
    ALTER TABLE public.server_audit_heads ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.server_audit_heads FORCE ROW LEVEL SECURITY;
    ALTER TABLE public.server_audit_quarantines ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.server_audit_quarantines FORCE ROW LEVEL SECURITY;
    ALTER TABLE public.server_audit_transition_edges ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.server_audit_transition_edges FORCE ROW LEVEL SECURITY;
    ALTER TABLE public.server_audit_entries OWNER TO gooddealer_cloud_owner;
    ALTER TABLE public.server_audit_heads OWNER TO gooddealer_cloud_owner;
    ALTER TABLE public.server_audit_quarantines OWNER TO gooddealer_cloud_owner;
    ALTER TABLE public.server_audit_transition_edges OWNER TO gooddealer_cloud_owner;

    CREATE POLICY server_audit_entries_tenant_scope ON public.server_audit_entries
      USING (
        (tenant_scope = 'workspace'
          AND account_id = pg_catalog.current_setting('gooddealer.account_id', true)
          AND workspace_id = pg_catalog.current_setting('gooddealer.workspace_id', true))
        OR (tenant_scope = 'account'
          AND account_id = pg_catalog.current_setting('gooddealer.account_id', true)
          AND workspace_id IS NULL)
        OR (tenant_scope = 'global' AND CURRENT_USER = 'gooddealer_cloud_owner')
      )
      WITH CHECK (
        (tenant_scope = 'workspace'
          AND account_id = pg_catalog.current_setting('gooddealer.account_id', true)
          AND workspace_id = pg_catalog.current_setting('gooddealer.workspace_id', true))
        OR (tenant_scope = 'account'
          AND account_id = pg_catalog.current_setting('gooddealer.account_id', true)
          AND workspace_id IS NULL)
        OR (tenant_scope = 'global' AND CURRENT_USER = 'gooddealer_cloud_owner')
      );
    CREATE POLICY server_audit_heads_tenant_scope ON public.server_audit_heads
      USING (
        (tenant_scope = 'workspace'
          AND account_id = pg_catalog.current_setting('gooddealer.account_id', true)
          AND workspace_id = pg_catalog.current_setting('gooddealer.workspace_id', true))
        OR (tenant_scope = 'account'
          AND account_id = pg_catalog.current_setting('gooddealer.account_id', true)
          AND workspace_id IS NULL)
        OR (tenant_scope = 'global' AND CURRENT_USER = 'gooddealer_cloud_owner')
      )
      WITH CHECK (
        (tenant_scope = 'workspace'
          AND account_id = pg_catalog.current_setting('gooddealer.account_id', true)
          AND workspace_id = pg_catalog.current_setting('gooddealer.workspace_id', true))
        OR (tenant_scope = 'account'
          AND account_id = pg_catalog.current_setting('gooddealer.account_id', true)
          AND workspace_id IS NULL)
        OR (tenant_scope = 'global' AND CURRENT_USER = 'gooddealer_cloud_owner')
      );
    CREATE POLICY server_audit_quarantines_tenant_scope ON public.server_audit_quarantines
      USING (
        account_id = pg_catalog.current_setting('gooddealer.account_id', true)
        AND workspace_id = pg_catalog.current_setting('gooddealer.workspace_id', true)
      )
      WITH CHECK (
        account_id = pg_catalog.current_setting('gooddealer.account_id', true)
        AND workspace_id = pg_catalog.current_setting('gooddealer.workspace_id', true)
      );
    CREATE POLICY server_audit_transition_edges_tenant_scope ON public.server_audit_transition_edges
      USING (EXISTS (
        SELECT 1 FROM public.server_audit_entries AS entry
        WHERE entry.audit_event_id = transition_audit_event_id
      ));

    REVOKE ALL PRIVILEGES ON TABLE public.server_audit_entries,
      public.server_audit_heads, public.server_audit_quarantines, public.server_audit_transition_edges
      FROM PUBLIC, gooddealer_cloud_app;

    CREATE FUNCTION public.audit_reject_server_audit_mutation()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $function$
    BEGIN
      RAISE EXCEPTION 'server audit evidence is append-only' USING ERRCODE = '55000';
    END;
    $function$;
    ALTER FUNCTION public.audit_reject_server_audit_mutation() OWNER TO gooddealer_cloud_owner;
    CREATE TRIGGER server_audit_entries_immutable
      BEFORE UPDATE OR DELETE ON public.server_audit_entries
      FOR EACH ROW EXECUTE FUNCTION public.audit_reject_server_audit_mutation();
    CREATE TRIGGER server_audit_transition_edges_immutable
      BEFORE UPDATE OR DELETE ON public.server_audit_transition_edges
      FOR EACH ROW EXECUTE FUNCTION public.audit_reject_server_audit_mutation();
    CREATE TRIGGER server_audit_quarantines_immutable
      BEFORE UPDATE OR DELETE ON public.server_audit_quarantines
      FOR EACH ROW EXECUTE FUNCTION public.audit_reject_server_audit_mutation();

    CREATE FUNCTION public.audit_server_decode_digest(p_value text)
    RETURNS bytea
    LANGUAGE plpgsql
    IMMUTABLE
    STRICT
    SET search_path = pg_catalog
    AS $function$
    DECLARE
      v_result bytea;
    BEGIN
      IF p_value !~ '^[A-Za-z0-9_-]{43}$' THEN RETURN NULL; END IF;
      BEGIN
        v_result := pg_catalog.decode(
          pg_catalog.translate(p_value, '-_', '+/') || '=',
          'base64'
        );
      EXCEPTION WHEN OTHERS THEN
        RETURN NULL;
      END;
      IF pg_catalog.octet_length(v_result) <> 32 THEN RETURN NULL; END IF;
      RETURN v_result;
    END;
    $function$;
    ALTER FUNCTION public.audit_server_decode_digest(text) OWNER TO gooddealer_cloud_owner;

    CREATE FUNCTION public.audit_quarantine_server_entry(
      p_candidate_digest bytea,
      p_rejection_code text
    )
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $function$
    DECLARE
      v_account_id text;
      v_workspace_id text;
    BEGIN
      v_account_id := pg_catalog.current_setting('gooddealer.account_id', true);
      v_workspace_id := pg_catalog.current_setting('gooddealer.workspace_id', true);
      IF v_account_id IS NULL OR v_workspace_id IS NULL
        OR v_account_id !~ '^[!-~]{1,160}$' OR v_workspace_id !~ '^[!-~]{1,160}$'
        OR p_candidate_digest IS NULL OR pg_catalog.octet_length(p_candidate_digest) <> 32
        OR p_rejection_code NOT IN (
          'context_untrusted', 'schema_invalid', 'canonical_conflict', 'transition_invalid',
          'signer_invalid', 'append_conflict'
        ) THEN
        RAISE EXCEPTION 'server audit quarantine input is invalid' USING ERRCODE = '22000';
      END IF;
      PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
        v_account_id || ' ' || v_workspace_id || ' ' || pg_catalog.encode(p_candidate_digest, 'hex')
          || ' ' || p_rejection_code,
        0
      ));
      PERFORM 1
      FROM public.server_audit_quarantines
      WHERE account_id = v_account_id AND workspace_id = v_workspace_id
        AND candidate_digest = p_candidate_digest AND rejection_code = p_rejection_code
      FOR KEY SHARE;
      IF FOUND THEN RETURN false; END IF;
      INSERT INTO public.server_audit_quarantines (
        tenant_scope, account_id, workspace_id, candidate_digest, rejection_code
      ) VALUES ('workspace', v_account_id, v_workspace_id, p_candidate_digest, p_rejection_code);
      RETURN true;
    END;
    $function$;
    ALTER FUNCTION public.audit_quarantine_server_entry(bytea, text) OWNER TO gooddealer_cloud_owner;

    CREATE FUNCTION public.audit_prepare_server_audit_append(p_chain_id bytea)
    RETURNS TABLE (
      chain_id bytea,
      audit_sequence bigint,
      previous_hash bytea,
      occurred_at timestamptz
    )
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $function$
    DECLARE
      v_account_id text;
      v_workspace_id text;
      v_head_sequence bigint;
      v_head_hash bytea;
      v_genesis_hash bytea;
    BEGIN
      v_account_id := pg_catalog.current_setting('gooddealer.account_id', true);
      v_workspace_id := pg_catalog.current_setting('gooddealer.workspace_id', true);
      IF v_account_id IS NULL OR v_workspace_id IS NULL
        OR v_account_id !~ '^[!-~]{1,160}$' OR v_workspace_id !~ '^[!-~]{1,160}$'
        OR p_chain_id IS NULL OR pg_catalog.octet_length(p_chain_id) <> 32 THEN
        RAISE EXCEPTION 'server audit append preparation is invalid' USING ERRCODE = '22000';
      END IF;
      PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
        pg_catalog.encode(p_chain_id, 'hex'), 0
      ));
      SELECT head.audit_sequence, head.event_hash INTO v_head_sequence, v_head_hash
      FROM public.server_audit_heads AS head
      WHERE head.chain_id = p_chain_id
      FOR UPDATE;
      IF FOUND THEN
        RETURN QUERY SELECT p_chain_id, v_head_sequence + 1, v_head_hash,
          pg_catalog.date_trunc('second', pg_catalog.transaction_timestamp());
        RETURN;
      END IF;
      v_genesis_hash := pg_catalog.sha256(pg_catalog.convert_to(
        'GOODDEALER-SERVER-AUDIT-CHAIN-GENESIS-V1', 'UTF8'
      ));
      RETURN QUERY SELECT p_chain_id, 1::bigint, v_genesis_hash,
        pg_catalog.date_trunc('second', pg_catalog.transaction_timestamp());
    END;
    $function$;
    ALTER FUNCTION public.audit_prepare_server_audit_append(bytea) OWNER TO gooddealer_cloud_owner;

    CREATE FUNCTION public.audit_append_server_entry_verified(
      p_expected_kind text,
      p_entry jsonb,
      p_canonical_evidence bytea,
      p_expected_sequence bigint,
      p_expected_hash bytea
    )
    RETURNS text
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $function$
    DECLARE
      v_account_id text;
      v_workspace_id text;
      v_event_id text;
      v_event_type text;
      v_chain_id bytea;
      v_sequence bigint;
      v_previous_hash bytea;
      v_event_hash bytea;
      v_authorization_hash bytea;
      v_signature bytea;
      v_signing_key_version bigint;
      v_transcript_version bigint;
      v_occurred_at timestamptz;
      v_occurred_at_canonical text;
      v_existing_evidence bytea;
      v_head_sequence bigint;
      v_head_hash bytea;
      v_head_tenant_scope text;
      v_head_account_id text;
      v_head_workspace_id text;
      v_head_actor_id text;
      v_head_audit_event_kind text;
      v_genesis_hash bytea;
      v_transition_id text;
      v_has_prior_incoming_use boolean;
      v_head_exists boolean;
      v_payload jsonb;
      v_edge record;
      v_expected_keys constant text[] := ARRAY[
        'schemaVersion', 'auditEventId', 'auditEventKind', 'eventType', 'targetType', 'targetRef',
        'actorId', 'chainId', 'auditSequence', 'previousHash', 'eventHash', 'occurredAt',
        'authorizationContextHash', 'cryptographicSignerKind', 'cryptographicSignerId',
        'signingKeyId', 'signingKeyVersion', 'signatureTranscriptVersion', 'serverSignature',
        'signing_key_transition_id', 'actorKind', 'authorizationSource', 'signingKeyPurpose',
        'payloadRedacted', 'tenantScope', 'accountId', 'workspaceId'
      ];
    BEGIN
      v_account_id := pg_catalog.current_setting('gooddealer.account_id', true);
      v_workspace_id := pg_catalog.current_setting('gooddealer.workspace_id', true);
      IF v_account_id IS NULL OR v_workspace_id IS NULL
        OR v_account_id !~ '^[!-~]{1,160}$' OR v_workspace_id !~ '^[!-~]{1,160}$' THEN
        RAISE EXCEPTION 'server audit tenant selectors are unresolved' USING ERRCODE = '42501';
      END IF;
      v_occurred_at := pg_catalog.date_trunc('second', pg_catalog.transaction_timestamp());
      v_occurred_at_canonical := pg_catalog.to_char(
        v_occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'
      );
      IF p_expected_kind NOT IN ('user', 'staff', 'service')
        OR p_entry IS NULL OR pg_catalog.jsonb_typeof(p_entry) <> 'object'
        OR p_canonical_evidence IS NULL OR pg_catalog.octet_length(p_canonical_evidence) NOT BETWEEN 1 AND 131072
        OR p_expected_sequence IS NULL OR p_expected_sequence < 0 OR p_expected_sequence > 9007199254740991
        OR (p_expected_hash IS NOT NULL AND pg_catalog.octet_length(p_expected_hash) <> 32)
        OR (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_entry)) <> 27
        OR EXISTS (
          SELECT 1 FROM pg_catalog.jsonb_object_keys(p_entry) AS key_name
          WHERE key_name <> ALL(v_expected_keys)
        ) THEN
        RAISE EXCEPTION 'server audit append input is invalid' USING ERRCODE = '22000';
      END IF;
      IF p_entry ?| ARRAY[
        'deviceId', 'sourceDeviceId', 'activeLeaseEpoch', 'credentialEpoch', 'approvedOperation',
        'deviceSignature', 'drain', 'sunset', 'securityAuditEvent', 'publicKey', 'privateKey',
        'kmsLocator', 'hsmLocator', 'password', 'token', 'cookie', 'authorizationHeader'
      ] THEN
        RAISE EXCEPTION 'server audit append crosses a forbidden trust boundary' USING ERRCODE = '22000';
      END IF;
      IF p_entry->>'schemaVersion' <> '1'
        OR p_entry->>'auditEventKind' <> p_expected_kind
        OR p_entry->>'tenantScope' <> 'workspace'
        OR p_entry->>'accountId' IS DISTINCT FROM v_account_id
        OR p_entry->>'workspaceId' IS DISTINCT FROM v_workspace_id
        OR p_entry->>'cryptographicSignerKind' <> 'gooddealer_audit_service'
        OR p_entry->>'actorKind' <> p_expected_kind
        OR p_entry->>'targetType' !~ '^[!-~]{1,160}$'
        OR p_entry->>'targetRef' !~ '^[!-~]{1,160}$'
        OR p_entry->>'actorId' !~ '^[!-~]{1,160}$'
        OR p_entry->>'cryptographicSignerId' !~ '^[!-~]{1,160}$'
        OR p_entry->>'signingKeyId' !~ '^[!-~]{1,160}$'
        OR pg_catalog.jsonb_typeof(p_entry->'payloadRedacted') <> 'object' THEN
        RAISE EXCEPTION 'server audit record fields are invalid' USING ERRCODE = '22000';
      END IF;
      IF (p_expected_kind = 'user' AND (
          p_entry->>'authorizationSource' <> 'user_session' OR p_entry->>'signingKeyPurpose' <> 'user_audit'
        )) OR (p_expected_kind = 'staff' AND (
          p_entry->>'authorizationSource' NOT IN ('admin_read_authorization', 'admin_action_authorization')
          OR p_entry->>'signingKeyPurpose' <> 'staff_audit'
        )) OR (p_expected_kind = 'service' AND (
          p_entry->>'authorizationSource' NOT IN ('service_identity', 'tenant_job_context')
          OR p_entry->>'signingKeyPurpose' <> 'service_audit'
        )) THEN
        RAISE EXCEPTION 'server audit kind bindings are invalid' USING ERRCODE = '22000';
      END IF;

      v_event_id := p_entry->>'auditEventId';
      v_event_type := p_entry->>'eventType';
      v_chain_id := public.audit_server_decode_digest(p_entry->>'chainId');
      v_previous_hash := public.audit_server_decode_digest(p_entry->>'previousHash');
      v_event_hash := public.audit_server_decode_digest(p_entry->>'eventHash');
      v_authorization_hash := public.audit_server_decode_digest(p_entry->>'authorizationContextHash');
      v_signing_key_version := (p_entry->>'signingKeyVersion')::bigint;
      v_transcript_version := (p_entry->>'signatureTranscriptVersion')::bigint;
      v_sequence := (p_entry->>'auditSequence')::bigint;
      BEGIN
        v_signature := pg_catalog.decode(
          pg_catalog.translate(p_entry->>'serverSignature', '-_', '+/')
          || pg_catalog.repeat('=', (4 - pg_catalog.length(p_entry->>'serverSignature') % 4) % 4),
          'base64'
        );
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'server audit signature is invalid' USING ERRCODE = '22000';
      END;
      IF v_event_id !~ '^[!-~]{1,160}$' OR v_event_type !~ '^[a-z_]{1,80}$'
        OR v_chain_id IS NULL OR v_previous_hash IS NULL OR v_event_hash IS NULL OR v_authorization_hash IS NULL
        OR v_sequence IS NULL OR v_sequence < 1 OR v_sequence > 9007199254740991
        OR v_signing_key_version IS NULL OR v_signing_key_version < 1 OR v_signing_key_version > 9007199254740991
        OR v_transcript_version IS NULL OR v_transcript_version < 1 OR v_transcript_version > 9007199254740991
        OR p_entry->>'occurredAt' IS DISTINCT FROM v_occurred_at_canonical
        OR p_entry->>'serverSignature' !~ '^[A-Za-z0-9_-]+$'
        OR pg_catalog.octet_length(v_signature) NOT BETWEEN 1 AND 1024 THEN
        RAISE EXCEPTION 'server audit canonical fields are invalid' USING ERRCODE = '22000';
      END IF;
      v_payload := p_entry->'payloadRedacted';
      IF v_event_type <> 'audit_signing_key_transition'
        AND v_payload->>'action' IS DISTINCT FROM v_event_type THEN
        RAISE EXCEPTION 'server audit redacted action does not match event type' USING ERRCODE = '22000';
      END IF;
      IF p_expected_kind = 'user' AND v_event_type NOT IN ('account_session', 'account_security', 'device_binding', 'data_rights') THEN
        RAISE EXCEPTION 'user audit event type is invalid' USING ERRCODE = '22000';
      ELSIF p_expected_kind = 'staff' AND v_event_type NOT IN (
        'admin_read', 'repair_command', 'control', 'security_incident_staff_action'
      ) THEN
        RAISE EXCEPTION 'staff audit event type is invalid' USING ERRCODE = '22000';
      ELSIF p_expected_kind = 'service' AND v_event_type NOT IN (
        'identity_defense', 'device_admission', 'security_incident', 'compliance', 'job', 'notification',
        'audit_signing_key_transition'
      ) THEN
        RAISE EXCEPTION 'service audit event type is invalid' USING ERRCODE = '22000';
      END IF;

      SELECT canonical_evidence INTO v_existing_evidence
      FROM public.server_audit_entries
      WHERE audit_event_id = v_event_id
      FOR KEY SHARE;
      IF FOUND THEN
        IF v_existing_evidence = p_canonical_evidence THEN RETURN 'exact'; END IF;
        RAISE EXCEPTION 'server audit event identity conflicts with immutable evidence' USING ERRCODE = '23505';
      END IF;

      PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
        pg_catalog.encode(v_chain_id, 'hex'), 0
      ));
      SELECT audit_sequence, event_hash, tenant_scope, account_id, workspace_id, actor_id, audit_event_kind
      INTO v_head_sequence, v_head_hash, v_head_tenant_scope, v_head_account_id, v_head_workspace_id,
        v_head_actor_id, v_head_audit_event_kind
      FROM public.server_audit_heads
      WHERE chain_id = v_chain_id
      FOR UPDATE;
      v_head_exists := FOUND;
      IF v_head_exists THEN
        IF v_head_tenant_scope IS DISTINCT FROM p_entry->>'tenantScope'
          OR v_head_account_id IS DISTINCT FROM p_entry->>'accountId'
          OR v_head_workspace_id IS DISTINCT FROM p_entry->>'workspaceId'
          OR v_head_actor_id IS DISTINCT FROM p_entry->>'actorId'
          OR v_head_audit_event_kind IS DISTINCT FROM p_entry->>'auditEventKind'
          OR v_head_sequence <> p_expected_sequence OR v_head_hash IS DISTINCT FROM p_expected_hash
          OR v_sequence <> v_head_sequence + 1 OR v_previous_hash IS DISTINCT FROM v_head_hash THEN
          RAISE EXCEPTION 'server audit head domain or compare-and-set conflict' USING ERRCODE = '40001';
        END IF;
      ELSE
        v_genesis_hash := pg_catalog.sha256(pg_catalog.convert_to(
          'GOODDEALER-SERVER-AUDIT-CHAIN-GENESIS-V1', 'UTF8'
        ));
        IF p_expected_sequence <> 0 OR p_expected_hash IS NOT NULL
          OR v_sequence <> 1 OR v_previous_hash IS DISTINCT FROM v_genesis_hash THEN
          RAISE EXCEPTION 'server audit genesis compare-and-set conflict' USING ERRCODE = '40001';
        END IF;
      END IF;

      v_transition_id := p_entry->>'signing_key_transition_id';
      IF v_event_type = 'audit_signing_key_transition' THEN
        IF p_expected_kind <> 'service' OR p_entry->>'authorizationSource' <> 'service_identity'
          OR v_transition_id IS NOT NULL
          OR v_payload->>'affectedSigningKeyPurpose' NOT IN ('user_audit', 'staff_audit', 'service_audit')
          OR v_payload->>'affectedOutgoingPublicKeyId' !~ '^[!-~]{1,160}$'
          OR v_payload->>'affectedIncomingPublicKeyId' !~ '^[!-~]{1,160}$'
          OR (v_payload->>'affectedOutgoingPublicKeyVersion') !~ '^[1-9][0-9]{0,15}$'
          OR (v_payload->>'affectedIncomingPublicKeyVersion') !~ '^[1-9][0-9]{0,15}$'
          OR public.audit_server_decode_digest(v_payload->>'custodyApprovalDigest') IS NULL
          OR v_payload #>> '{effectiveBoundary,rule}' <> 'after_transition_commit'
          OR public.audit_server_decode_digest(v_payload #>> '{effectiveBoundary,transitionChainId}') IS DISTINCT FROM v_chain_id
          OR (v_payload #>> '{effectiveBoundary,transitionAuditSequence}')::bigint IS DISTINCT FROM v_sequence
          OR (v_payload #>> '{effectiveBoundary,notBeforeOccurredAt}') IS DISTINCT FROM p_entry->>'occurredAt' THEN
          RAISE EXCEPTION 'server audit transition is invalid' USING ERRCODE = '22000';
        END IF;
        IF (v_payload->>'affectedOutgoingPublicKeyId' = v_payload->>'affectedIncomingPublicKeyId'
          AND (v_payload->>'affectedOutgoingPublicKeyVersion')::bigint = (v_payload->>'affectedIncomingPublicKeyVersion')::bigint) THEN
          RAISE EXCEPTION 'server audit transition key pair must be distinct' USING ERRCODE = '22000';
        END IF;
        IF v_payload->>'affectedSigningKeyPurpose' = 'service_audit' AND (
          v_payload->>'affectedOutgoingPublicKeyId' IS DISTINCT FROM p_entry->>'signingKeyId'
          OR (v_payload->>'affectedOutgoingPublicKeyVersion')::bigint IS DISTINCT FROM v_signing_key_version
        ) THEN
          RAISE EXCEPTION 'service transition must use its outgoing service signer' USING ERRCODE = '22000';
        ELSIF v_payload->>'affectedSigningKeyPurpose' IN ('user_audit', 'staff_audit') AND (
          v_payload->>'affectedOutgoingPublicKeyId' = p_entry->>'signingKeyId'
          AND (v_payload->>'affectedOutgoingPublicKeyVersion')::bigint = v_signing_key_version
        ) THEN
          RAISE EXCEPTION 'user or staff transition cannot reuse the service signer as a shortcut' USING ERRCODE = '22000';
        END IF;
      ELSIF v_transition_id IS NOT NULL THEN
        SELECT edge.*, transition.audit_event_kind, transition.event_type, transition.signing_key_purpose,
               transition.tenant_scope, transition.account_id, transition.workspace_id
        INTO v_edge
        FROM public.server_audit_transition_edges AS edge
        JOIN public.server_audit_entries AS transition
          ON transition.audit_event_id = edge.transition_audit_event_id
        WHERE edge.transition_audit_event_id = v_transition_id
        FOR KEY SHARE OF edge, transition;
        IF NOT FOUND OR v_edge.audit_event_kind <> 'service' OR v_edge.event_type <> 'audit_signing_key_transition'
          OR v_edge.signing_key_purpose <> 'service_audit'
          OR v_edge.affected_signing_key_purpose IS DISTINCT FROM p_entry->>'signingKeyPurpose'
          OR v_edge.affected_incoming_public_key_id IS DISTINCT FROM p_entry->>'signingKeyId'
          OR v_edge.affected_incoming_public_key_version IS DISTINCT FROM v_signing_key_version
          OR v_occurred_at <= v_edge.not_before_occurred_at
          OR (v_edge.tenant_scope = 'workspace' AND (
            v_edge.account_id IS DISTINCT FROM v_account_id OR v_edge.workspace_id IS DISTINCT FROM v_workspace_id
          )) OR (v_edge.tenant_scope = 'account' AND v_edge.account_id IS DISTINCT FROM v_account_id) THEN
          RAISE EXCEPTION 'server audit transition link is invalid' USING ERRCODE = '22000';
        END IF;
        SELECT EXISTS(
          SELECT 1 FROM public.server_audit_entries AS prior
          WHERE prior.chain_id = v_chain_id
            AND prior.signing_key_purpose = p_entry->>'signingKeyPurpose'
            AND prior.signing_key_id = p_entry->>'signingKeyId'
            AND prior.signing_key_version = v_signing_key_version
        ) INTO v_has_prior_incoming_use;
        IF v_has_prior_incoming_use THEN
          RAISE EXCEPTION 'server audit transition link is not the first incoming key record' USING ERRCODE = '23505';
        END IF;
      END IF;

      INSERT INTO public.server_audit_entries (
        audit_event_id, audit_event_kind, event_type, target_type, target_ref, actor_id,
        tenant_scope, account_id, workspace_id, chain_id, audit_sequence, previous_hash, event_hash,
        occurred_at, authorization_context_hash, cryptographic_signer_kind, cryptographic_signer_id,
        signing_key_id, signing_key_version, signature_transcript_version, server_signature,
        signing_key_transition_id, actor_kind, authorization_source, signing_key_purpose,
        payload_redacted, canonical_evidence, canonical_evidence_digest
      ) VALUES (
        v_event_id, p_expected_kind, v_event_type, p_entry->>'targetType', p_entry->>'targetRef', p_entry->>'actorId',
        'workspace', v_account_id, v_workspace_id, v_chain_id, v_sequence, v_previous_hash, v_event_hash,
        v_occurred_at, v_authorization_hash, 'gooddealer_audit_service', p_entry->>'cryptographicSignerId',
        p_entry->>'signingKeyId', v_signing_key_version, v_transcript_version, v_signature,
        v_transition_id, p_expected_kind, p_entry->>'authorizationSource', p_entry->>'signingKeyPurpose',
        v_payload, p_canonical_evidence, pg_catalog.sha256(p_canonical_evidence)
      );
      IF v_event_type = 'audit_signing_key_transition' THEN
        INSERT INTO public.server_audit_transition_edges (
          transition_audit_event_id, affected_signing_key_purpose,
          affected_outgoing_public_key_id, affected_outgoing_public_key_version,
          affected_incoming_public_key_id, affected_incoming_public_key_version,
          transition_chain_id, transition_audit_sequence, not_before_occurred_at, custody_approval_digest
        ) VALUES (
          v_event_id, v_payload->>'affectedSigningKeyPurpose',
          v_payload->>'affectedOutgoingPublicKeyId', (v_payload->>'affectedOutgoingPublicKeyVersion')::bigint,
          v_payload->>'affectedIncomingPublicKeyId', (v_payload->>'affectedIncomingPublicKeyVersion')::bigint,
          v_chain_id, v_sequence, v_occurred_at,
          public.audit_server_decode_digest(v_payload->>'custodyApprovalDigest')
        );
      END IF;
      IF v_head_exists THEN
        UPDATE public.server_audit_heads
        SET audit_sequence = v_sequence, event_hash = v_event_hash
        WHERE chain_id = v_chain_id
          AND audit_sequence = p_expected_sequence
          AND event_hash IS NOT DISTINCT FROM p_expected_hash;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'server audit head compare-and-set lost' USING ERRCODE = '40001';
        END IF;
      ELSE
        INSERT INTO public.server_audit_heads (
          chain_id, tenant_scope, account_id, workspace_id, actor_id, audit_event_kind, audit_sequence, event_hash
        ) VALUES (
          v_chain_id, 'workspace', v_account_id, v_workspace_id, p_entry->>'actorId', p_expected_kind,
          v_sequence, v_event_hash
        );
      END IF;
      RETURN 'appended';
    END;
    $function$;
    ALTER FUNCTION public.audit_append_server_entry_verified(text, jsonb, bytea, bigint, bytea)
      OWNER TO gooddealer_cloud_owner;

    CREATE FUNCTION public.audit_append_server_user_entry(
      p_entry jsonb, p_canonical_evidence bytea, p_expected_sequence bigint, p_expected_hash bytea
    ) RETURNS text
    LANGUAGE sql
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $function$
      SELECT public.audit_append_server_entry_verified('user', p_entry, p_canonical_evidence, p_expected_sequence, p_expected_hash)
    $function$;
    CREATE FUNCTION public.audit_append_server_staff_entry(
      p_entry jsonb, p_canonical_evidence bytea, p_expected_sequence bigint, p_expected_hash bytea
    ) RETURNS text
    LANGUAGE sql
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $function$
      SELECT public.audit_append_server_entry_verified('staff', p_entry, p_canonical_evidence, p_expected_sequence, p_expected_hash)
    $function$;
    CREATE FUNCTION public.audit_append_server_service_entry(
      p_entry jsonb, p_canonical_evidence bytea, p_expected_sequence bigint, p_expected_hash bytea
    ) RETURNS text
    LANGUAGE sql
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $function$
      SELECT public.audit_append_server_entry_verified('service', p_entry, p_canonical_evidence, p_expected_sequence, p_expected_hash)
    $function$;
    ALTER FUNCTION public.audit_append_server_user_entry(jsonb, bytea, bigint, bytea) OWNER TO gooddealer_cloud_owner;
    ALTER FUNCTION public.audit_append_server_staff_entry(jsonb, bytea, bigint, bytea) OWNER TO gooddealer_cloud_owner;
    ALTER FUNCTION public.audit_append_server_service_entry(jsonb, bytea, bigint, bytea) OWNER TO gooddealer_cloud_owner;

    REVOKE ALL ON FUNCTION public.audit_reject_server_audit_mutation() FROM PUBLIC, gooddealer_cloud_app;
    REVOKE ALL ON FUNCTION public.audit_server_decode_digest(text) FROM PUBLIC, gooddealer_cloud_app;
    REVOKE ALL ON FUNCTION public.audit_quarantine_server_entry(bytea, text) FROM PUBLIC, gooddealer_cloud_app;
    REVOKE ALL ON FUNCTION public.audit_prepare_server_audit_append(bytea) FROM PUBLIC, gooddealer_cloud_app;
    REVOKE ALL ON FUNCTION public.audit_append_server_entry_verified(text, jsonb, bytea, bigint, bytea)
      FROM PUBLIC, gooddealer_cloud_app;
    REVOKE ALL ON FUNCTION public.audit_append_server_user_entry(jsonb, bytea, bigint, bytea)
      FROM PUBLIC, gooddealer_cloud_app;
    REVOKE ALL ON FUNCTION public.audit_append_server_staff_entry(jsonb, bytea, bigint, bytea)
      FROM PUBLIC, gooddealer_cloud_app;
    REVOKE ALL ON FUNCTION public.audit_append_server_service_entry(jsonb, bytea, bigint, bytea)
      FROM PUBLIC, gooddealer_cloud_app;
  `,
};
