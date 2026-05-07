import type { Request, Response } from "express";
import { z } from "zod";
import { pool } from "../../db/pool";
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
