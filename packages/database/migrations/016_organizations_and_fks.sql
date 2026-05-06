-- Internal tenant registry: UUID primary keys for vendor-neutral multi-tenancy; Clerk `org_*` ids
-- live in `clerk_organization_id` only. Domain tables reference `organizations.id`, never Clerk strings.
--
-- Rationale: keeps Postgres joins and FKs stable if auth vendors change; external ids are explicit.

CREATE TABLE soma_ehr.organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Clerk organization id (`org_…`); unique external binding. Non-Clerk tenants may use other prefixes.
  clerk_organization_id TEXT NOT NULL,

  name TEXT NOT NULL DEFAULT '',

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT organizations_clerk_organization_id_unique UNIQUE (clerk_organization_id)
);

COMMENT ON TABLE soma_ehr.organizations IS
  'Canonical tenant row: internal UUID (id) for all domain FKs; clerk_organization_id holds vendor org id.';

COMMENT ON COLUMN soma_ehr.organizations.id IS
  'Internal tenant UUID used in medications, audit_log, and other domain tables.';

COMMENT ON COLUMN soma_ehr.organizations.clerk_organization_id IS
  'External Clerk organization id (org_…). Not used as a foreign key on clinical tables.';

CREATE TRIGGER trg_organizations_set_updated_at
  BEFORE UPDATE ON soma_ehr.organizations
  FOR EACH ROW
  EXECUTE PROCEDURE soma_ehr.tg_set_updated_at();

-- Backfill one row per distinct tenant UUID already stored on domain tables (pre-FK data).
INSERT INTO soma_ehr.organizations (id, clerk_organization_id, name)
SELECT DISTINCT
  x.organization_id,
  'legacy:' || x.organization_id::text,
  'Migrated organization'
FROM (
  SELECT organization_id FROM soma_ehr.medications
  UNION
  SELECT organization_id FROM soma_ehr.medication_history
  UNION
  SELECT organization_id FROM soma_ehr.audit_log
  WHERE organization_id IS NOT NULL
) x;

-- Well-known local / test tenant UUIDs (integration tests, smoke scripts).
INSERT INTO soma_ehr.organizations (id, clerk_organization_id, name)
VALUES
  (
    '00000000-0001-4000-8000-000000000001'::uuid,
    'legacy:00000000-0001-4000-8000-000000000001',
    'Dev tenant A'
  ),
  (
    '00000000-0010-4000-8000-000000000010'::uuid,
    'legacy:00000000-0010-4000-8000-000000000010',
    'Dev tenant B'
  )
ON CONFLICT (id) DO NOTHING;

ALTER TABLE soma_ehr.medications
  ADD CONSTRAINT fk_medications_organization
  FOREIGN KEY (organization_id) REFERENCES soma_ehr.organizations (id);

ALTER TABLE soma_ehr.medication_history
  ADD CONSTRAINT fk_medication_history_organization
  FOREIGN KEY (organization_id) REFERENCES soma_ehr.organizations (id);

ALTER TABLE soma_ehr.audit_log
  ADD CONSTRAINT fk_audit_log_organization
  FOREIGN KEY (organization_id) REFERENCES soma_ehr.organizations (id);

CREATE INDEX IF NOT EXISTS idx_organizations_clerk_organization_id
  ON soma_ehr.organizations (clerk_organization_id);
