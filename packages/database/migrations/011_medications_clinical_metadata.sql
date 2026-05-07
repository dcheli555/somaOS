-- Standard clinical row metadata + soft delete on soma_os.medications (see snippets/clinical_row_standard.sql).
-- Idempotent for DBs upgraded from older migrations or created from an updated 002.

ALTER TABLE soma_os.medications
  ADD COLUMN IF NOT EXISTS encounter_id UUID NULL,
  ADD COLUMN IF NOT EXISTS created_by TEXT,
  ADD COLUMN IF NOT EXISTS updated_by TEXT,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS deleted_by TEXT NULL;

UPDATE soma_os.medications
SET
  created_by = COALESCE(created_by, '__legacy__'),
  updated_by = COALESCE(updated_by, '__legacy__')
WHERE created_by IS NULL OR updated_by IS NULL;

ALTER TABLE soma_os.medications
  ALTER COLUMN created_by SET NOT NULL,
  ALTER COLUMN updated_by SET NOT NULL;

COMMENT ON COLUMN soma_os.medications.encounter_id IS
  'Optional encounter context when the row was authored or captured during a visit.';

COMMENT ON COLUMN soma_os.medications.created_by IS
  'Clerk user id or service principal (TEXT) that created the row.';

COMMENT ON COLUMN soma_os.medications.updated_by IS
  'Clerk user id or service principal (TEXT) that last mutated the row (via API or trusted job).';

COMMENT ON COLUMN soma_os.medications.deleted_at IS
  'Soft delete timestamp; NULL means active. Queries should filter deleted_at IS NULL.';

COMMENT ON COLUMN soma_os.medications.deleted_by IS
  'Actor who performed the soft delete; NULL when the row is active.';

DROP INDEX IF EXISTS soma_os.idx_medications_org_patient;
DROP INDEX IF EXISTS soma_os.idx_medications_org_patient_active;
DROP INDEX IF EXISTS soma_os.idx_medications_org_updated;

CREATE INDEX idx_medications_org_patient
  ON soma_os.medications (organization_id, patient_id)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_medications_org_patient_active
  ON soma_os.medications (organization_id, patient_id)
  WHERE deleted_at IS NULL AND status = 'active';

CREATE INDEX idx_medications_org_updated
  ON soma_os.medications (organization_id, updated_at DESC)
  WHERE deleted_at IS NULL;
