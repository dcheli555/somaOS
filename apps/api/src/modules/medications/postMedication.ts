import type { Request, Response } from "express";
import { z } from "zod";
import type { DbClient } from "../../db/pool";
import { withTransaction } from "../../db/pool";
import {
  buildAuditRequestFromExpress,
  insertAuditEvent,
} from "../../services/auditService";
import { formatMedicationEtag } from "./etag";
import {
  medicationUpdateBodySchema,
  serializeMedication,
} from "./putMedication";
import type { MedicationRow } from "./putMedication";

export const medicationCreateBodySchema = z
  .object({
    patient_id: z.string().uuid(),
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
       metadata
     ) VALUES (
       $1, $2, $3,
       $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
       $14, $15, $16::jsonb
     )
     RETURNING *`,
    [
      organizationId,
      body.patient_id,
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
    ],
  );

  if (!row) {
    const err = new Error("MEDICATION_CREATE_FAILED") as Error & {
      code: string;
    };
    err.code = "MEDICATION_CREATE_FAILED";
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
      action: "create",
      patientId: row.patient_id,
      occurredAtIso: eventTime.toISOString(),
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
    res.status(400).json({
      error: "Invalid request body",
      details: parsed.error.flatten(),
    });
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

    res.setHeader("ETag", formatMedicationEtag(created.updated_at));
    res.setHeader("Location", `/api/medications/${created.id}`);
    res.status(201).json(serializeMedication(created));
  } catch (err) {
    const pgCode = (err as { code?: string }).code;
    if (pgCode === "23514") {
      res.status(400).json({
        error: "Create violates data constraints (e.g. date range or status)",
      });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
}
