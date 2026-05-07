-- Migrate legacy audit_log (has `context`, `actor_ip`, `recorded_at`) to v2 shape.
-- Skips when `event_type` is already present (new installs from updated 004).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'soma_os'
      AND table_name = 'audit_log'
  ) THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'soma_os'
      AND table_name = 'audit_log'
      AND column_name = 'event_type'
  ) THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'soma_os'
      AND table_name = 'audit_log'
      AND column_name = 'context'
  ) THEN
    RETURN;
  END IF;

  DROP TRIGGER IF EXISTS trg_audit_log_prevent_update ON soma_os.audit_log;
  DROP TRIGGER IF EXISTS trg_audit_log_prevent_delete ON soma_os.audit_log;
  DROP TRIGGER IF EXISTS trg_audit_log_set_updated_at_on_insert ON soma_os.audit_log;

  DROP INDEX IF EXISTS soma_os.idx_audit_log_org_timestamp;
  DROP INDEX IF EXISTS soma_os.idx_audit_log_org_patient_timestamp;
  DROP INDEX IF EXISTS soma_os.idx_audit_log_org_resource;
  DROP INDEX IF EXISTS soma_os.idx_audit_log_org_actor_timestamp;
  DROP INDEX IF EXISTS soma_os.idx_audit_log_request_id;
  DROP INDEX IF EXISTS soma_os.idx_audit_log_recorded_at;

  ALTER TABLE soma_os.audit_log RENAME TO audit_log_legacy_v1;

  CREATE TABLE soma_os.audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    "timestamp" TIMESTAMPTZ NOT NULL DEFAULT now(),

    event_type TEXT NOT NULL,
    action TEXT NOT NULL,
    outcome TEXT NOT NULL,

    actor_user_id TEXT NULL,
    actor_role TEXT NULL,

    organization_id UUID NOT NULL,
    site_id UUID NULL,
    patient_id UUID NULL,
    encounter_id UUID NULL,

    resource_type TEXT NOT NULL,
    resource_id UUID NULL,

    reason TEXT NULL,

    request_id TEXT NOT NULL,
    session_id TEXT NULL,
    source_ip INET NULL,
    user_agent TEXT NULL,

    api_client_id TEXT NULL,
    scopes TEXT[] NULL,

    previous_value_hash TEXT NULL,
    new_value_hash TEXT NULL,

    metadata JSONB NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT audit_log_outcome_check
      CHECK (outcome IN ('success', 'failure', 'denied'))
  );

  INSERT INTO soma_os.audit_log (
    id,
    "timestamp",
    event_type,
    action,
    outcome,
    actor_user_id,
    actor_role,
    organization_id,
    site_id,
    patient_id,
    encounter_id,
    resource_type,
    resource_id,
    reason,
    request_id,
    session_id,
    source_ip,
    user_agent,
    api_client_id,
    scopes,
    previous_value_hash,
    new_value_hash,
    metadata,
    created_at
  )
  SELECT
    l.id,
    COALESCE(l."timestamp", l.created_at),
    lower(trim(l.resource_type)) || '.' || lower(trim(l.action)),
    l.action,
    'success'::text,
    l.actor_user_id,
    NULL::text,
    l.organization_id,
    NULL::uuid,
    l.patient_id,
    NULL::uuid,
    l.resource_type,
    l.resource_id,
    NULL::text,
    l.request_id,
    l.session_id,
    l.actor_ip,
    l.user_agent,
    NULL::text,
    NULL::text[],
    NULL::text,
    NULL::text,
    l.context,
    COALESCE(l.recorded_at, l.created_at)
  FROM soma_os.audit_log_legacy_v1 l;

  DROP TABLE soma_os.audit_log_legacy_v1;

  CREATE INDEX idx_audit_log_org_timestamp
    ON soma_os.audit_log (organization_id, "timestamp" DESC);

  CREATE INDEX idx_audit_log_org_patient_timestamp
    ON soma_os.audit_log (organization_id, patient_id, "timestamp" DESC)
    WHERE patient_id IS NOT NULL;

  CREATE INDEX idx_audit_log_org_resource
    ON soma_os.audit_log (organization_id, resource_type, resource_id);

  CREATE INDEX idx_audit_log_org_actor_timestamp
    ON soma_os.audit_log (organization_id, actor_user_id, "timestamp" DESC)
    WHERE actor_user_id IS NOT NULL;

  CREATE INDEX idx_audit_log_request_id
    ON soma_os.audit_log (request_id);

  CREATE INDEX idx_audit_log_created_at
    ON soma_os.audit_log (created_at DESC);

  CREATE TRIGGER trg_audit_log_prevent_update
    BEFORE UPDATE ON soma_os.audit_log
    FOR EACH ROW
    EXECUTE PROCEDURE soma_os.tg_prevent_audit_log_mutation();

  CREATE TRIGGER trg_audit_log_prevent_delete
    BEFORE DELETE ON soma_os.audit_log
    FOR EACH ROW
    EXECUTE PROCEDURE soma_os.tg_prevent_audit_log_mutation();
END $$;
