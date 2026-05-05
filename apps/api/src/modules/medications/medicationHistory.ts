import type { DbClient } from "../../db/pool";

export type MedicationHistoryChangeType =
  | "create"
  | "update"
  | "delete"
  | "restore";

/**
 * Append-only row in `soma_ehr.medication_history`.
 * `priorVersion` is `soma_ehr.medications.version` immediately **before** this event (null for `create`).
 */
export async function appendMedicationHistory(
  client: DbClient,
  params: {
    organizationId: string;
    medicationId: string;
    priorVersion: number | null;
    changeType: MedicationHistoryChangeType;
    encounterId: string | null;
    snapshot: Record<string, unknown>;
    snapshotSchemaVersion?: number;
    correlationRequestId: string | null;
  },
): Promise<void> {
  const {
    organizationId,
    medicationId,
    priorVersion,
    changeType,
    encounterId,
    snapshot,
    snapshotSchemaVersion = 1,
    correlationRequestId,
  } = params;

  await client.query(
    `INSERT INTO soma_ehr.medication_history (
      organization_id,
      medication_id,
      prior_version,
      change_type,
      encounter_id,
      snapshot,
      snapshot_schema_version,
      correlation_request_id
    ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)`,
    [
      organizationId,
      medicationId,
      priorVersion,
      changeType,
      encounterId,
      snapshot,
      snapshotSchemaVersion,
      correlationRequestId,
    ],
  );
}
