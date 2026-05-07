-- prior_version: medications.version immediately before this event (NULL for create).
-- change_type: discriminates create / update / delete / restore.
-- encounter_id: encounter context copied from the medication row at event time.

ALTER TABLE soma_os.medication_history
  ADD COLUMN IF NOT EXISTS prior_version INTEGER NULL,
  ADD COLUMN IF NOT EXISTS change_type TEXT,
  ADD COLUMN IF NOT EXISTS encounter_id UUID NULL;

COMMENT ON COLUMN soma_os.medication_history.prior_version IS
  'Value of soma_os.medications.version immediately before this history row; NULL when the event is create (no prior version).';

COMMENT ON COLUMN soma_os.medication_history.change_type IS
  'create | update | delete | restore — which medication action produced this row.';

COMMENT ON COLUMN soma_os.medication_history.encounter_id IS
  'Encounter associated with the medication row at the time of this event.';

-- Append-only trigger blocks UPDATE; temporarily disable for backfill only.
ALTER TABLE soma_os.medication_history DISABLE TRIGGER trg_medication_history_prevent_update;

UPDATE soma_os.medication_history
SET prior_version = NULLIF(TRIM(snapshot ->> 'version'), '')::integer
WHERE prior_version IS NULL
  AND snapshot ? 'version'
  AND snapshot ->> 'version' IS NOT NULL
  AND snapshot ->> 'version' ~ '^[0-9]+$';

UPDATE soma_os.medication_history
SET encounter_id = NULLIF(TRIM(snapshot ->> 'encounter_id'), '')::uuid
WHERE encounter_id IS NULL
  AND snapshot ? 'encounter_id'
  AND snapshot ->> 'encounter_id' IS NOT NULL
  AND snapshot ->> 'encounter_id' != 'null';

UPDATE soma_os.medication_history
SET change_type = 'update'
WHERE change_type IS NULL;

ALTER TABLE soma_os.medication_history ENABLE TRIGGER trg_medication_history_prevent_update;

ALTER TABLE soma_os.medication_history
  ALTER COLUMN change_type SET NOT NULL;

ALTER TABLE soma_os.medication_history DROP CONSTRAINT IF EXISTS medication_history_change_type_valid;

ALTER TABLE soma_os.medication_history
  ADD CONSTRAINT medication_history_change_type_valid
  CHECK (
    change_type IN ('create', 'update', 'delete', 'restore')
  );
