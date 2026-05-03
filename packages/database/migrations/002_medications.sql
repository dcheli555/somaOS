-- Clinical medication records (patient-scoped, tenant-isolated).
-- All timestamps are TIMESTAMPTZ (UTC-capable) for audit and interoperability.

CREATE TABLE soma_ehr.medications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  organization_id UUID NOT NULL,
  patient_id UUID NOT NULL,

  -- Terminology (optional until coded); supports RxNorm / NDC alignment for CDS and billing.
  rxnorm_cui TEXT,
  ndc_11 TEXT,

  medication_display_name TEXT NOT NULL,

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

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT medications_end_after_start CHECK (
    end_at IS NULL OR start_at IS NULL OR end_at >= start_at
  )
);

COMMENT ON TABLE soma_ehr.medications IS
  'Patient medication list / order record; scoped by organization_id for multi-tenant isolation.';

COMMENT ON COLUMN soma_ehr.medications.organization_id IS
  'Tenant identifier; pair with patient_id for all clinical queries.';

COMMENT ON COLUMN soma_ehr.medications.metadata IS
  'Opaque structured attributes (e.g. source system ids, formulary flags); must not replace regulated clinical fields.';

CREATE INDEX idx_medications_org_patient
  ON soma_ehr.medications (organization_id, patient_id);

CREATE INDEX idx_medications_org_patient_active
  ON soma_ehr.medications (organization_id, patient_id)
  WHERE status = 'active';

CREATE INDEX idx_medications_org_updated
  ON soma_ehr.medications (organization_id, updated_at DESC);

-- Reusable trigger: maintain updated_at on mutable clinical tables.
CREATE OR REPLACE FUNCTION soma_ehr.tg_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_medications_set_updated_at
  BEFORE UPDATE ON soma_ehr.medications
  FOR EACH ROW
  EXECUTE PROCEDURE soma_ehr.tg_set_updated_at();
