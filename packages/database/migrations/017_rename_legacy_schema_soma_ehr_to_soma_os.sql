-- Databases migrated before schema rename: PostgreSQL moves all objects when the schema is renamed.
-- Fresh installs use `soma_os` from `001_init`; this is a no-op when `soma_ehr` does not exist.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'soma_ehr')
     AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'soma_os') THEN
    EXECUTE 'ALTER SCHEMA soma_ehr RENAME TO soma_os';
  END IF;
END
$$;
