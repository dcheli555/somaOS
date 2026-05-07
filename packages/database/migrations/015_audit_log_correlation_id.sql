-- Add distributed-tracing correlation id; allow audits before tenant resolution.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'soma_os'
      AND table_name = 'audit_log'
  ) THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'soma_os'
      AND table_name = 'audit_log'
      AND column_name = 'correlation_id'
  ) THEN
    ALTER TABLE soma_os.audit_log
      ADD COLUMN correlation_id TEXT;

    -- Append-only triggers block UPDATE; temporarily disable only for correlation backfill.
    ALTER TABLE soma_os.audit_log DISABLE TRIGGER trg_audit_log_prevent_update;
    ALTER TABLE soma_os.audit_log DISABLE TRIGGER trg_audit_log_prevent_delete;

    UPDATE soma_os.audit_log
    SET correlation_id = request_id
    WHERE correlation_id IS NULL;

    ALTER TABLE soma_os.audit_log
      ALTER COLUMN correlation_id SET NOT NULL;

    ALTER TABLE soma_os.audit_log ENABLE TRIGGER trg_audit_log_prevent_update;
    ALTER TABLE soma_os.audit_log ENABLE TRIGGER trg_audit_log_prevent_delete;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'soma_os'
      AND table_name = 'audit_log'
      AND column_name = 'organization_id'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE soma_os.audit_log
      ALTER COLUMN organization_id DROP NOT NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_audit_log_correlation_id
  ON soma_os.audit_log (correlation_id);

COMMENT ON COLUMN soma_os.audit_log.correlation_id IS
  'End-to-end correlation id (e.g. X-Correlation-Id); may span multiple API requests.';
