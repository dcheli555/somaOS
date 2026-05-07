-- Optimistic concurrency for medications (HTTP If-Match / ETag pattern "v{N}").

ALTER TABLE soma_os.medications
  ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;

COMMENT ON COLUMN soma_os.medications."version" IS
  'Monotonic integer for optimistic locking; incremented on successful mutation.';
