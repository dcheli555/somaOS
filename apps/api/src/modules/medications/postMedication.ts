import type { Request, Response } from "express";
import { z } from "zod";
import type { DbClient } from "../../db/pool";
import { withTransaction } from "../../db/pool";
import {
  auditPayloadHash,
  buildAuditRequestFromExpress,
  insertAuditEvent,
} from "../../services/auditService";
import { toEtag } from "./etag";
import { appendMedicationHistory } from "./medicationHistory";
import {
  medicationRowToSnapshot,
  medicationUpdateBodySchema,
  serializeMedication,
  type MedicationRow,
} from "./putMedication";
import { sendMedicationApiError } from "./medicationApiError";

export const medicationCreateBodySchema = z
  .object({
    patient_id: z.string().uuid(),
    encounter_id: z.string().uuid().nullable().optional(),
    medication_name: z.string().min(1),
  })
  .merge(medicationUpdateBodySchema.omit({ medication_name: true }))
  .strict();

export type MedicationCreateBody = z.infer<typeof medicationCreateBodySchema>;

type ParsedCreate = z.infer<typeof medicationCreateBodySchema>;

export async function createMedicationForRequest(
  client: DbClient,
  params: {
    organizationId: string;
    actorUserId: string;
    requestId: string;
    body: ParsedCreate;
    req: Request;
  },
): Promise<MedicationRow> {
  const { organizationId, actorUserId, requestId, body, req } = params;

  const {
    rows: [clock],
  } = await client.query<{ t: Date }>("SELECT clock_timestamp() AS t");
  const eventTime = clock.t;

  const {
    rows: [row],
  } = await client.query<MedicationRow>(
    `INSERT INTO soma_ehr.medications (
       organization_id,
       patient_id,
       encounter_id,
       medication_name,
       rxnorm_cui,
       ndc_10,
       ndc_11,
       dose_text,
       route,
       form,
       strength,
       frequency_text,
       sig_text,
       status,
       start_at,
       end_at,
       metadata,
       created_by,
       updated_by
     ) VALUES (
       $1, $2, $3, $4,
       $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
       $15, $16, $17::jsonb,
       $18, $19
     )
     RETURNING *`,
    [
      organizationId,
      body.patient_id,
      body.encounter_id === undefined ? null : body.encounter_id ?? null,
      body.medication_name,
      body.rxnorm_cui ?? null,
      body.ndc_10 ?? null,
      body.ndc_11 ?? null,
      body.dose_text ?? null,
      body.route ?? null,
      body.form ?? null,
      body.strength ?? null,
      body.frequency_text ?? null,
      body.sig_text ?? null,
      body.status ?? "active",
      body.start_at === undefined
        ? null
        : body.start_at === null
          ? null
          : new Date(body.start_at),
      body.end_at === undefined
        ? null
        : body.end_at === null
          ? null
          : new Date(body.end_at),
      body.metadata ?? {},
      actorUserId,
      actorUserId,
    ],
  );

  if (!row) {
    const err = new Error("MEDICATION_CREATE_FAILED") as Error & {
      code: string;
    };
    err.code = "MEDICATION_CREATE_FAILED";
    throw err;
  }

  await appendMedicationHistory(client, {
    organizationId: row.organization_id,
    medicationId: row.id,
    priorVersion: null,
    changeType: "create",
    encounterId: row.encounter_id,
    snapshot: medicationRowToSnapshot(row),
    snapshotSchemaVersion: 1,
    correlationRequestId: requestId,
  });

  await insertAuditEvent(client, {
    request: buildAuditRequestFromExpress(req),
    event: {
      eventType: "medication.create",
      action: "create",
      outcome: "success",
      resourceType: "medication",
      resourceId: row.id,
      patientId: row.patient_id,
      encounterId: row.encounter_id ?? null,
      occurredAtIso: eventTime.toISOString(),
      newValueHash: auditPayloadHash(medicationRowToSnapshot(row)),
    },
    metadata: {
      schemaVersion: 1,
      domain: "medications.post",
      http: {
        method: req.method,
        path: req.originalUrl ?? req.url,
      },
      resource: { type: "medication", id: row.id },
    },
  });

  return row;
}

export async function postMedicationHandler(req: Request, res: Response) {
  const parsed = medicationCreateBodySchema.safeParse(req.body);
  if (!parsed.success) {
    sendMedicationApiError(
      res,
      400,
      "INVALID_BODY",
      "Invalid request body",
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

  try {
    const created = await withTransaction((client) =>
      createMedicationForRequest(client, {
        organizationId,
        actorUserId: userId,
        requestId: req.context.requestId,
        body: parsed.data,
        req,
      }),
    );

    res.setHeader("ETag", toEtag(created.version));
    res.setHeader("Location", `/api/medications/${created.id}`);
    res.status(201).json(serializeMedication(created));
  } catch (err) {
    const pgCode = (err as { code?: string }).code;
    if (pgCode === "23514") {
      sendMedicationApiError(
        res,
        400,
        "CONSTRAINT_VIOLATION",
        "Create violates data constraints (e.g. date range or status)",
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
