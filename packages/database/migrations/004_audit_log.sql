-- Security / clinical audit trail: append-only, query-optimized.

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

COMMENT ON TABLE soma_os.audit_log IS
  'Append-only audit log; outcome records success vs authorization / technical failure.';

COMMENT ON COLUMN soma_os.audit_log."timestamp" IS
  'When the audited event occurred in application time.';

COMMENT ON COLUMN soma_os.audit_log.event_type IS
  'Stable category for filtering (e.g. medication.create, medication.update).';

COMMENT ON COLUMN soma_os.audit_log.metadata IS
  'Optional structured context (paths, semantic version tags); avoid raw PHI.';

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

CREATE OR REPLACE FUNCTION soma_os.tg_prevent_audit_log_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    USING
      ERRCODE = 'integrity_constraint_violation',
      MESSAGE = 'audit_log is append-only: UPDATE and DELETE are not permitted';
END;
$$;

CREATE TRIGGER trg_audit_log_prevent_update
  BEFORE UPDATE ON soma_os.audit_log
  FOR EACH ROW
  EXECUTE PROCEDURE soma_os.tg_prevent_audit_log_mutation();

CREATE TRIGGER trg_audit_log_prevent_delete
  BEFORE DELETE ON soma_os.audit_log
  FOR EACH ROW
  EXECUTE PROCEDURE soma_os.tg_prevent_audit_log_mutation();
