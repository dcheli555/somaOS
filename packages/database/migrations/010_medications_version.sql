-- Optimistic concurrency for medications (HTTP If-Match / ETag pattern "v{N}").

ALTER TABLE soma_ehr.medications
  ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;

COMMENT ON COLUMN soma_ehr.medications."version" IS
  'Monotonic integer for optimistic locking; incremented on successful mutation.';
