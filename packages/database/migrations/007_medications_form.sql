-- Dosage / presentation form (tablet, capsule, injection, etc.). Nullable free-text for flexibility.

ALTER TABLE soma_os.medications
  ADD COLUMN form TEXT;

COMMENT ON COLUMN soma_os.medications.form IS
  'Dosage form label (e.g. tablet, capsule); optional; align with coding strategy if normalized later.';
