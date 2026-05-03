-- Clerk and many auth providers use opaque string subject ids (not RFC-4122 UUIDs).
ALTER TABLE soma_ehr.audit_log
  ALTER COLUMN actor_user_id TYPE TEXT USING actor_user_id::TEXT;

COMMENT ON COLUMN soma_ehr.audit_log.actor_user_id IS
  'Principal identifier from the identity provider (e.g. Clerk user id); not necessarily a UUID.';
