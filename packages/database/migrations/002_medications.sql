-- Clinical medication records (patient-scoped, tenant-isolated).
-- Base row shape follows `snippets/clinical_row_standard.sql`, then domain fields.
-- All timestamps are TIMESTAMPTZ (UTC-capable) for audit and interoperability.

CREATE TABLE soma_os.medications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  organization_id UUID NOT NULL,
  patient_id UUID NOT NULL,
  encounter_id UUID NULL,

  "version" INTEGER NOT NULL DEFAULT 1,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT NOT NULL,

  deleted_at TIMESTAMPTZ NULL,
  deleted_by TEXT NULL,

  -- Terminology (optional until coded); supports RxNorm / NDC alignment for CDS and billing.
  rxnorm_cui TEXT,
  ndc_11 TEXT,

  medication_name TEXT NOT NULL,

  dose_text TEXT,
  route TEXT,
  frequency_text TEXT,
  sig_text TEXT,

  status TEXT NOT NULL DEFAULT 'active'
    CONSTRAINT medications_status_valid CHECK (
      status IN (
        'active',
        'on_hold',
        'completed',
        'discontinued',
        'entered_in_error',
        'unknown'
      )
    ),

  start_at TIMESTAMPTZ,
  end_at TIMESTAMPTZ,

  -- Non-clinical extensions (provenance, integration payloads) without schema churn.
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  CONSTRAINT medications_end_after_start CHECK (
    end_at IS NULL OR start_at IS NULL OR end_at >= start_at
  )
);

COMMENT ON TABLE soma_os.medications IS
  'Patient medication list / order record; scoped by organization_id for multi-tenant isolation.';

COMMENT ON COLUMN soma_os.medications.organization_id IS
  'Tenant identifier; pair with patient_id for all clinical queries.';

COMMENT ON COLUMN soma_os.medications.encounter_id IS
  'Optional encounter context when the row was authored or captured during a visit.';

COMMENT ON COLUMN soma_os.medications.deleted_at IS
  'Soft delete timestamp; NULL means active. Queries should filter deleted_at IS NULL.';

COMMENT ON COLUMN soma_os.medications.deleted_by IS
  'Actor who performed the soft delete; NULL when the row is active.';

COMMENT ON COLUMN soma_os.medications.created_by IS
  'Clerk user id or service principal (TEXT) that created the row.';

COMMENT ON COLUMN soma_os.medications.updated_by IS
  'Clerk user id or service principal (TEXT) that last mutated the row (via API or trusted job).';

COMMENT ON COLUMN soma_os.medications.metadata IS
  'Opaque structured attributes (e.g. source system ids, formulary flags); must not replace regulated clinical fields.';

CREATE INDEX idx_medications_org_patient
  ON soma_os.medications (organization_id, patient_id)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_medications_org_patient_active
  ON soma_os.medications (organization_id, patient_id)
  WHERE deleted_at IS NULL AND status = 'active';

CREATE INDEX idx_medications_org_updated
  ON soma_os.medications (organization_id, updated_at DESC)
  WHERE deleted_at IS NULL;

-- Reusable trigger: maintain updated_at on mutable clinical tables.
CREATE OR REPLACE FUNCTION soma_os.tg_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_medications_set_updated_at
  BEFORE UPDATE ON soma_os.medications
  FOR EACH ROW
  EXECUTE PROCEDURE soma_os.tg_set_updated_at();
