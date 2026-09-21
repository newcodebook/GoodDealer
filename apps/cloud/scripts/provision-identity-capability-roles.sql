-- Run once as a PostgreSQL role administrator before M019. This script is idempotent and does
-- not assign passwords: production login authentication belongs to infrastructure secret/IAM
-- configuration, never repository SQL. Inspect the roles after running and configure separate
-- GOODDEALER_POSTGRES_ACCOUNT_API_URL (gd_account_api) and
-- GOODDEALER_POSTGRES_IDENTITY_ISSUER_URL (gd_identity_capability_issuer),
-- GOODDEALER_POSTGRES_PROVIDER_INGRESS_URL (gd_provider_ingress), and
-- GOODDEALER_POSTGRES_PROVIDER_WORKER_URL (gd_provider_worker) credentials.

DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'gd_identity_owner') THEN
    CREATE ROLE gd_identity_owner NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'gd_identity_definer') THEN
    CREATE ROLE gd_identity_definer NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'gd_identity_capability_issuer') THEN
    CREATE ROLE gd_identity_capability_issuer LOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'gd_account_api') THEN
    CREATE ROLE gd_account_api LOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'gd_provider_ingress') THEN
    CREATE ROLE gd_provider_ingress LOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'gd_provider_worker') THEN
    CREATE ROLE gd_provider_worker LOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'gd_licensing_owner') THEN
    CREATE ROLE gd_licensing_owner NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'gd_licensing_command_definer') THEN
    CREATE ROLE gd_licensing_command_definer NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'gd_licensing_worker_definer') THEN
    CREATE ROLE gd_licensing_worker_definer NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'gd_licensing_ingress_definer') THEN
    CREATE ROLE gd_licensing_ingress_definer NOLOGIN;
  END IF;
END;
$roles$;

ALTER ROLE gd_identity_owner NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION;
ALTER ROLE gd_identity_definer NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION;
ALTER ROLE gd_identity_capability_issuer LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION;
ALTER ROLE gd_account_api LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION;
ALTER ROLE gd_provider_ingress LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION;
ALTER ROLE gd_provider_worker LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION;
ALTER ROLE gd_licensing_owner NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION;
ALTER ROLE gd_licensing_command_definer NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION;
ALTER ROLE gd_licensing_worker_definer NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION;
ALTER ROLE gd_licensing_ingress_definer NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION;

-- The migrator may deliberately SET ROLE for ownership operations, but must not inherit owner or
-- definer privileges during ordinary migration statements.
GRANT gd_identity_owner, gd_identity_definer,
      gd_licensing_owner, gd_licensing_command_definer,
      gd_licensing_worker_definer, gd_licensing_ingress_definer
  TO gooddealer_cloud_owner
  WITH INHERIT FALSE, SET TRUE;
REVOKE gd_identity_capability_issuer, gd_account_api, gd_provider_ingress, gd_provider_worker
  FROM gooddealer_cloud_owner;
REVOKE gd_identity_capability_issuer, gd_account_api, gd_provider_ingress, gd_provider_worker
  FROM gd_identity_owner, gd_identity_definer,
       gd_licensing_owner, gd_licensing_command_definer,
       gd_licensing_worker_definer, gd_licensing_ingress_definer;
REVOKE gd_identity_owner, gd_identity_definer, gd_identity_capability_issuer,
       gd_provider_ingress, gd_provider_worker,
       gd_licensing_owner, gd_licensing_command_definer,
       gd_licensing_worker_definer, gd_licensing_ingress_definer
  FROM gd_account_api;
REVOKE gd_identity_owner, gd_identity_definer, gd_account_api,
       gd_provider_ingress, gd_provider_worker,
       gd_licensing_owner, gd_licensing_command_definer,
       gd_licensing_worker_definer, gd_licensing_ingress_definer
  FROM gd_identity_capability_issuer;
REVOKE gd_identity_owner, gd_identity_definer, gd_identity_capability_issuer,
       gd_account_api, gd_provider_worker,
       gd_licensing_owner, gd_licensing_command_definer,
       gd_licensing_worker_definer, gd_licensing_ingress_definer
  FROM gd_provider_ingress;
REVOKE gd_identity_owner, gd_identity_definer, gd_identity_capability_issuer,
       gd_account_api, gd_provider_ingress,
       gd_licensing_owner, gd_licensing_command_definer,
       gd_licensing_worker_definer, gd_licensing_ingress_definer
  FROM gd_provider_worker;

GRANT USAGE ON SCHEMA public
  TO gd_identity_capability_issuer, gd_account_api, gd_provider_ingress, gd_provider_worker;
