import type { Request, Response } from "express";
import { z } from "zod";
import type { DbClient } from "../../db/pool";
import { withTransaction } from "../../db/pool";
import {
  auditPayloadHash,
  buildAuditRequestFromExpress,
  insertAuditEvent,
} from "../../services/auditService";
import { parseIfMatch, toEtag } from "./etag";
import { appendMedicationHistory } from "./medicationHistory";
import { medicationRowToSnapshot } from "./putMedication";
import { sendMedicationApiError } from "./medicationApiError";
import type { MedicationRow } from "./putMedication";

const idParamSchema = z.string().uuid();

export async function deleteMedicationForRequest(
  client: DbClient,
  params: {
    medicationId: string;
    organizationId: string;
    actorUserId: string;
    requestId: string;
    expectedVersion: number;
    req: Request;
  },
): Promise<MedicationRow> {
  const {
    medicationId,
    organizationId,
    actorUserId,
    requestId,
    expectedVersion,
    req,
  } = params;

  const {
    rows: [clock],
  } = await client.query<{ t: Date }>("SELECT clock_timestamp() AS t");
  const eventTime = clock.t;

  const lock = await client.query<MedicationRow>(
    `SELECT *
     FROM soma_ehr.medications
     WHERE id = $1 AND deleted_at IS NULL
     FOR UPDATE`,
    [medicationId],
  );

  const row = lock.rows[0];
  if (!row) {
    const err = new Error("MEDICATION_NOT_FOUND") as Error & {
      code: string;
    };
    err.code = "MEDICATION_NOT_FOUND";
    throw err;
  }

  if (row.organization_id !== organizationId) {
    const err = new Error("ORGANIZATION_FORBIDDEN") as Error & {
      code: string;
    };
    err.code = "ORGANIZATION_FORBIDDEN";
    throw err;
  }

  if (row.version !== expectedVersion) {
    const err = new Error("PRECONDITION_FAILED") as Error & { code: string };
    err.code = "PRECONDITION_FAILED";
    throw err;
  }

  await appendMedicationHistory(client, {
    organizationId: row.organization_id,
    medicationId: row.id,
    priorVersion: row.version,
    changeType: "delete",
    encounterId: row.encounter_id,
    snapshot: medicationRowToSnapshot(row),
    snapshotSchemaVersion: 1,
    correlationRequestId: requestId,
  });

  const del = await client.query<MedicationRow>(
    `UPDATE soma_ehr.medications
     SET
       deleted_at = clock_timestamp(),
       deleted_by = $4,
       updated_by = $4,
       "version" = "version" + 1
     WHERE id = $1 AND organization_id = $2 AND "version" = $3 AND deleted_at IS NULL
     RETURNING *`,
    [medicationId, organizationId, expectedVersion, actorUserId],
  );

  const deleted = del.rows[0];
  if (!deleted) {
    const err = new Error("PRECONDITION_FAILED") as Error & { code: string };
    err.code = "PRECONDITION_FAILED";
    throw err;
  }

  await insertAuditEvent(client, {
    request: buildAuditRequestFromExpress(req, {
      organizationId,
      actorUserId,
      requestId,
    }),
    event: {
      eventType: "medication.delete",
      action: "delete",
      outcome: "success",
      resourceType: "medication",
      resourceId: deleted.id,
      patientId: deleted.patient_id,
      encounterId: row.encounter_id ?? null,
      occurredAtIso: eventTime.toISOString(),
      previousValueHash: auditPayloadHash(medicationRowToSnapshot(row)),
      newValueHash: auditPayloadHash(medicationRowToSnapshot(deleted)),
    },
    metadata: {
      schemaVersion: 1,
      domain: "medications.delete",
      http: {
        method: req.method,
        path: req.originalUrl ?? req.url,
      },
      resource: { type: "medication", id: medicationId },
    },
  });

  return deleted;
}

export async function deleteMedicationHandler(req: Request, res: Response) {
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

  const userId = req.authContext?.userId;
  if (!userId) {
    sendMedicationApiError(
      res,
      401,
      "UNAUTHORIZED",
      "Unauthorized",
      req.context.requestId,
    );
    return;
  }

  const rawIfMatch = req.get("if-match");
  if (rawIfMatch === undefined || rawIfMatch.trim() === "") {
    sendMedicationApiError(
      res,
      428,
      "PRECONDITION_REQUIRED",
      "Missing If-Match header for this operation.",
      req.context.requestId,
    );
    return;
  }

  const expectedVersion = parseIfMatch(rawIfMatch);
  if (expectedVersion === null) {
    sendMedicationApiError(
      res,
      400,
      "IF_MATCH_INVALID",
      "Invalid If-Match header (expected a quoted tag like \"v1\").",
      req.context.requestId,
    );
    return;
  }

  try {
    const deleted = await withTransaction((client) =>
      deleteMedicationForRequest(client, {
        medicationId: idParsed.data,
        organizationId,
        actorUserId: userId,
        requestId: req.context.requestId,
        expectedVersion,
        req,
      }),
    );

    res.setHeader("ETag", toEtag(deleted.version));
    res.status(204).end();
  } catch (err) {
    const e = err as { code?: string } & Error;

    if (e.code === "MEDICATION_NOT_FOUND") {
      sendMedicationApiError(
        res,
        404,
        "NOT_FOUND",
        "Medication not found",
        req.context.requestId,
      );
      return;
    }
    if (e.code === "ORGANIZATION_FORBIDDEN") {
      sendMedicationApiError(
        res,
        403,
        "FORBIDDEN",
        "Forbidden for this organization",
        req.context.requestId,
      );
      return;
    }
    if (e.code === "PRECONDITION_FAILED") {
      sendMedicationApiError(
        res,
        412,
        "PRECONDITION_FAILED",
        "The resource has been modified. Refresh and try again.",
        req.context.requestId,
      );
      return;
    }

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
