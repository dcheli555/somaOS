-- Align column name with API / domain: medication_display_name → medication_name.
-- Idempotent for DBs already created from updated 002 (which uses medication_name).

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'soma_os'
      AND table_name = 'medications'
      AND column_name = 'medication_display_name'
  ) THEN
    ALTER TABLE soma_os.medications
      RENAME COLUMN medication_display_name TO medication_name;
  END IF;
END $$;

COMMENT ON COLUMN soma_os.medications.medication_name IS
  'Human-readable medication name for the order or list entry (display / free text).';
