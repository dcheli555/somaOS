-- Enterprise / HIPAA-oriented audit trail: non-repudiation-oriented, query-optimized, append-only.
-- Captures who did what to which clinical entity, under which tenant and request correlation.

CREATE TABLE soma_ehr.audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  organization_id UUID NOT NULL,
  patient_id UUID,

  actor_user_id UUID NOT NULL,

  resource_type TEXT NOT NULL,
  resource_id UUID,

  action TEXT NOT NULL,

  request_id TEXT NOT NULL,

  -- Required semantic event time (business / application clock for the audited action).
  "timestamp" TIMESTAMPTZ NOT NULL,

  -- Server ingest time (when the audit row was persisted). Immutable once written.
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Additional non-PHI context (e.g. API path, safe reason codes). Avoid raw PHI in payloads.
  context JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Optional client / session forensics (storage policy-dependent).
  actor_ip INET,
  user_agent TEXT,
  session_id TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT audit_log_resource_type_non_empty
    CHECK (length(trim(resource_type)) > 0),

  CONSTRAINT audit_log_action_non_empty
    CHECK (length(trim(action)) > 0),

  CONSTRAINT audit_log_request_id_non_empty
    CHECK (length(trim(request_id)) > 0),

  CONSTRAINT audit_log_context_is_object
    CHECK (jsonb_typeof(context) = 'object')
);

COMMENT ON TABLE soma_ehr.audit_log IS
  'Organization-scoped security and clinical audit log; append-only. patient_id nullable for non-patient-scoped events.';

COMMENT ON COLUMN soma_ehr.audit_log."timestamp" IS
  'When the audited action occurred in application time (distinct from recorded_at / row persistence).';

COMMENT ON COLUMN soma_ehr.audit_log.recorded_at IS
  'Database ingest timestamp for this audit row (WORM semantics).';

COMMENT ON COLUMN soma_ehr.audit_log.resource_type IS
  'Logical type of target resource (e.g. medication, encounter, document).';

COMMENT ON COLUMN soma_ehr.audit_log.resource_id IS
  'Identifier of the target resource instance, when applicable.';

COMMENT ON COLUMN soma_ehr.audit_log.request_id IS
  'End-to-end request correlation id (e.g. x-request-id) tying the event to middleware / API logs.';

COMMENT ON COLUMN soma_ehr.audit_log.actor_user_id IS
  'Authenticated principal that performed the action (or delegated service account id).';

CREATE INDEX idx_audit_log_org_timestamp
  ON soma_ehr.audit_log (organization_id, "timestamp" DESC);

CREATE INDEX idx_audit_log_org_patient_timestamp
  ON soma_ehr.audit_log (organization_id, patient_id, "timestamp" DESC)
  WHERE patient_id IS NOT NULL;

CREATE INDEX idx_audit_log_org_resource
  ON soma_ehr.audit_log (organization_id, resource_type, resource_id);

CREATE INDEX idx_audit_log_org_actor_timestamp
  ON soma_ehr.audit_log (organization_id, actor_user_id, "timestamp" DESC);

CREATE INDEX idx_audit_log_request_id
  ON soma_ehr.audit_log (request_id);

CREATE INDEX idx_audit_log_recorded_at
  ON soma_ehr.audit_log (recorded_at DESC);

-- Immutable audit store: updates and deletes break compliance expectations.
CREATE OR REPLACE FUNCTION soma_ehr.tg_prevent_audit_log_mutation()
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
  BEFORE UPDATE ON soma_ehr.audit_log
  FOR EACH ROW
  EXECUTE PROCEDURE soma_ehr.tg_prevent_audit_log_mutation();

CREATE TRIGGER trg_audit_log_prevent_delete
  BEFORE DELETE ON soma_ehr.audit_log
  FOR EACH ROW
  EXECUTE PROCEDURE soma_ehr.tg_prevent_audit_log_mutation();

-- updated_at is required by schema; on insert align with server clock.
CREATE TRIGGER trg_audit_log_set_updated_at_on_insert
  BEFORE INSERT ON soma_ehr.audit_log
  FOR EACH ROW
  EXECUTE PROCEDURE soma_ehr.tg_set_updated_at();
