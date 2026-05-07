-- Optional 10-digit NDC (labeler + product + package without check digit) alongside existing ndc_11.
-- ndc_11 remains nullable (TEXT, no NOT NULL constraint on soma_os.medications).

ALTER TABLE soma_os.medications
  ADD COLUMN ndc_10 TEXT;

COMMENT ON COLUMN soma_os.medications.ndc_10 IS
  'Optional 10-character NDC segment (excluding 11-digit check digit form in ndc_11).';

COMMENT ON COLUMN soma_os.medications.ndc_11 IS
  'Optional normalized 11-digit NDC string when available.';
