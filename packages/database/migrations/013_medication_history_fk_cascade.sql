-- Allow hard-deleting a medication row (tests, rare admin) to remove dependent history rows.
-- Application flow uses soft delete on medications; history remains append-only (no app DELETE on history).

ALTER TABLE soma_os.medication_history
  DROP CONSTRAINT IF EXISTS medication_history_medication_id_fkey;

ALTER TABLE soma_os.medication_history
  ADD CONSTRAINT medication_history_medication_id_fkey
  FOREIGN KEY (medication_id)
  REFERENCES soma_os.medications (id)
  ON DELETE CASCADE;
