-- Product strength as free text (e.g. "500 mg", "10 mg/5 mL"); optional.

ALTER TABLE soma_os.medications
  ADD COLUMN strength TEXT;

COMMENT ON COLUMN soma_os.medications.strength IS
  'Strength or concentration label; optional; separate from patient-specific dose_text when applicable.';
