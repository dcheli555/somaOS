import type { Request, Response } from "express";
import { z } from "zod";
import { pool } from "../../db/pool";
import {
  buildAuditRequestFromExpress,
  insertAuditEvent,
} from "../../services/auditService";
import { toEtag } from "./etag";
import { sendMedicationApiError } from "./medicationApiError";
import type { MedicationRow } from "./putMedication";
import { serializeMedication } from "./putMedication";

const idParamSchema = z.string().uuid();

async function fetchMedicationRow(
  params: { medicationId: string; organizationId: string },
): Promise<MedicationRow | null> {
  const { rows } = await pool.query<MedicationRow>(
    `SELECT *
     FROM soma_os.medications
     WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
    [params.medicationId, params.organizationId],
  );
  return rows[0] ?? null;
}

export async function getMedicationHandler(req: Request, res: Response) {
  const idParsed = idParamSchema.safeParse(req.params.id);
  if (!idParsed.success) {
    sendMedicationApiError(
      res,
      400,
      "INVALID_ID",
      "Invalid medication id (expected UUID)",
      req.context.requestId,
    );
    return;
  }

  const organizationId = req.context.organizationId;
  if (!organizationId) {
    sendMedicationApiError(
      res,
      500,
      "INTERNAL_ERROR",
      "Organization context not initialized",
      req.context.requestId,
    );
    return;
  }

  if (!req.authContext?.userId) {
    sendMedicationApiError(
      res,
      401,
      "UNAUTHORIZED",
      "Unauthorized",
      req.context.requestId,
    );
    return;
  }

  try {
    const row = await fetchMedicationRow({
      medicationId: idParsed.data,
      organizationId,
    });

    if (!row) {
      sendMedicationApiError(
        res,
        404,
        "NOT_FOUND",
        "Medication not found",
        req.context.requestId,
      );
      return;
    }

    /*
     * Access / disclosure audit belongs in audit_log only: PHI was displayed to an actor who
     * was allowed to fetch it (auth + tenant middleware already succeeded). medication_history is
     * reserved for persisted clinical mutations (create/update/delete snapshots), not passive reads—
     * mixing reads there would inflate history and blur "what changed in the chart" semantics.
     */
    const auditClient = await pool.connect();
    try {
      await insertAuditEvent(auditClient, {
        request: buildAuditRequestFromExpress(req),
        event: {
          eventType: "medication.view",
          action: "view",
          outcome: "success",
          resourceType: "MedicationStatement",
          resourceId: row.id,
          patientId: row.patient_id,
          encounterId: row.encounter_id ?? null,
        },
        metadata: {
          domain: "medications.get",
          http: {
            method: req.method,
            path: req.originalUrl ?? req.url,
          },
          resource: { type: "MedicationStatement", id: row.id },
        },
      });
    } finally {
      auditClient.release();
    }

    res.setHeader("ETag", toEtag(row.version));
    res.json(serializeMedication(row));
  } catch (err) {
    console.error(err);
    sendMedicationApiError(
      res,
      500,
      "INTERNAL_ERROR",
      "Internal server error",
      req.context.requestId,
    );
  }
}
