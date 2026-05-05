import type { Request, Response } from "express";
import { z } from "zod";
import type { DbClient } from "../../db/pool";
import { withTransaction } from "../../db/pool";
import {
  buildAuditRequestFromExpress,
  insertAuditEvent,
} from "../../services/auditService";
import { assertIfMatchIfPresent } from "./etag";
import type { MedicationRow } from "./putMedication";

const idParamSchema = z.string().uuid();

export async function deleteMedicationForRequest(
  client: DbClient,
  params: {
    medicationId: string;
    organizationId: string;
    actorUserId: string;
    requestId: string;
    ifMatch: string | undefined;
    req: Request;
  },
): Promise<MedicationRow> {
  const { medicationId, organizationId, actorUserId, requestId, ifMatch, req } =
    params;

  const {
    rows: [clock],
  } = await client.query<{ t: Date }>("SELECT clock_timestamp() AS t");
  const eventTime = clock.t;

  const lock = await client.query<MedicationRow>(
    `SELECT *
     FROM soma_ehr.medications
     WHERE id = $1
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

  assertIfMatchIfPresent(ifMatch, row.updated_at);

  const {
    rows: [{ exists }],
  } = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM soma_ehr.medication_history
       WHERE medication_id = $1
     ) AS exists`,
    [medicationId],
  );

  if (exists) {
    const err = new Error("MEDICATION_HAS_HISTORY") as Error & {
      code: string;
    };
    err.code = "MEDICATION_HAS_HISTORY";
    throw err;
  }

  await insertAuditEvent(client, {
    request: buildAuditRequestFromExpress(req, {
      organizationId,
      actorUserId,
      requestId,
    }),
    event: {
      resourceType: "medication",
      resourceId: row.id,
      action: "delete",
      patientId: row.patient_id,
      occurredAtIso: eventTime.toISOString(),
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

  const del = await client.query<MedicationRow>(
    `DELETE FROM soma_ehr.medications
     WHERE id = $1 AND organization_id = $2
     RETURNING *`,
    [medicationId, organizationId],
  );

  const deleted = del.rows[0];
  if (!deleted) {
    const err = new Error("MEDICATION_DELETE_FAILED") as Error & {
      code: string;
    };
    err.code = "MEDICATION_DELETE_FAILED";
    throw err;
  }

  return deleted;
}

export async function deleteMedicationHandler(req: Request, res: Response) {
  const idParsed = idParamSchema.safeParse(req.params.id);
  if (!idParsed.success) {
    res.status(400).json({ error: "Invalid medication id (expected UUID)" });
    return;
  }

  const organizationId = req.context.organizationId;
  if (!organizationId) {
    res.status(500).json({ error: "Organization context not initialized" });
    return;
  }

  const userId = req.authContext?.userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const ifMatch = req.get("if-match");

  try {
    await withTransaction((client) =>
      deleteMedicationForRequest(client, {
        medicationId: idParsed.data,
        organizationId,
        actorUserId: userId,
        requestId: req.context.requestId,
        ifMatch,
        req,
      }),
    );

    res.status(204).end();
  } catch (err) {
    const e = err as { code?: string } & Error;

    if (e.code === "MEDICATION_NOT_FOUND") {
      res.status(404).json({ error: "Medication not found" });
      return;
    }
    if (e.code === "ORGANIZATION_FORBIDDEN") {
      res.status(403).json({ error: "Forbidden for this organization" });
      return;
    }
    if (e.code === "IF_MATCH_FAILED") {
      res.status(412).json({ error: "Precondition failed (If-Match does not match resource)" });
      return;
    }
    if (e.code === "MEDICATION_HAS_HISTORY") {
      res.status(409).json({
        error:
          "Medication cannot be deleted: revision history exists (append-only retention)",
      });
      return;
    }

    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
}
