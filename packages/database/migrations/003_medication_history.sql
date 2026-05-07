-- Immutable history of medication state transitions / versions.
-- snapshot MUST capture a self-contained JSON view of the medication at that point in time
-- (healthcare-grade reconstruction for med reconciliation and investigations).

CREATE TABLE soma_os.medication_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  organization_id UUID NOT NULL,
  medication_id UUID NOT NULL
    REFERENCES soma_os.medications (id)
    ON DELETE CASCADE,

  prior_version INTEGER NULL,
  change_type TEXT NOT NULL
    CONSTRAINT medication_history_change_type_valid CHECK (
      change_type IN ('create', 'update', 'delete', 'restore')
    ),
  encounter_id UUID NULL,

  -- Full-fidelity JSON document of medication state at this revision (versioned contract).
  snapshot JSONB NOT NULL,
  snapshot_schema_version SMALLINT NOT NULL DEFAULT 1,

  -- Optional narrative or coded reason (e.g. discontinue reason); keep PHI out unless policy allows.
  change_reason TEXT,
  correlation_request_id TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT medication_history_snapshot_is_object
    CHECK (jsonb_typeof(snapshot) = 'object'),

  CONSTRAINT medication_history_snapshot_schema_version_positive
    CHECK (snapshot_schema_version > 0)
);

COMMENT ON TABLE soma_os.medication_history IS
  'Append-only medication revision log; each row is an auditable point-in-time snapshot.';

COMMENT ON COLUMN soma_os.medication_history.prior_version IS
  'Value of soma_os.medications.version immediately before this history row; NULL when the event is create.';

COMMENT ON COLUMN soma_os.medication_history.change_type IS
  'create | update | delete | restore — which medication action produced this row.';

COMMENT ON COLUMN soma_os.medication_history.encounter_id IS
  'Encounter associated with the medication row at the time of this event.';

COMMENT ON COLUMN soma_os.medication_history.snapshot IS
  'Structured JSON snapshot of the medication record at this revision; schema_version denotes interpretation.';

COMMENT ON COLUMN soma_os.medication_history.correlation_request_id IS
  'Correlates this history entry to an originating HTTP/API request where applicable.';

CREATE INDEX idx_medication_history_org_med_created
  ON soma_os.medication_history (organization_id, medication_id, created_at DESC);

CREATE INDEX idx_medication_history_med_created
  ON soma_os.medication_history (medication_id, created_at DESC);

-- Append-only: no updates or deletes (tamper-evident lineage).
CREATE OR REPLACE FUNCTION soma_os.tg_prevent_medication_history_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    USING
      ERRCODE = 'integrity_constraint_violation',
      MESSAGE = 'medication_history is append-only: UPDATE and DELETE are not permitted';
END;
$$;

CREATE TRIGGER trg_medication_history_prevent_update
  BEFORE UPDATE ON soma_os.medication_history
  FOR EACH ROW
  EXECUTE PROCEDURE soma_os.tg_prevent_medication_history_mutation();

CREATE TRIGGER trg_medication_history_prevent_delete
  BEFORE DELETE ON soma_os.medication_history
  FOR EACH ROW
  EXECUTE PROCEDURE soma_os.tg_prevent_medication_history_mutation();

-- Align updated_at on insert with server clock (matches medications treatment).
CREATE TRIGGER trg_medication_history_set_updated_at_on_insert
  BEFORE INSERT ON soma_os.medication_history
  FOR EACH ROW
  EXECUTE PROCEDURE soma_os.tg_set_updated_at();
