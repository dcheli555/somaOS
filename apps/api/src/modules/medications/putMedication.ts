import type { Request, Response } from "express";
import { z } from "zod";
import type { DbClient } from "../../db/pool";
import { withTransaction } from "../../db/pool";
import {
  buildAuditRequestFromExpress,
  insertAuditEvent,
} from "../../services/auditService";
import { assertIfMatchIfPresent, formatMedicationEtag } from "./etag";
const idParamSchema = z.string().uuid();

export const medicationUpdateBodySchema = z
  .object({
    medication_name: z.string().min(1).optional(),
    rxnorm_cui: z.string().nullable().optional(),
    ndc_10: z.string().nullable().optional(),
    ndc_11: z.string().nullable().optional(),
    dose_text: z.string().nullable().optional(),
    route: z.string().nullable().optional(),
    form: z.string().nullable().optional(),
    strength: z.string().nullable().optional(),
    frequency_text: z.string().nullable().optional(),
    sig_text: z.string().nullable().optional(),
    status: z
      .enum([
        "active",
        "on_hold",
        "completed",
        "discontinued",
        "entered_in_error",
        "unknown",
      ])
      .optional(),
    start_at: z.string().datetime({ offset: true }).nullable().optional(),
    end_at: z.string().datetime({ offset: true }).nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type MedicationUpdateBody = z.infer<typeof medicationUpdateBodySchema>;

export interface MedicationRow {
  id: string;
  organization_id: string;
  patient_id: string;
  rxnorm_cui: string | null;
  ndc_10: string | null;
  ndc_11: string | null;
  medication_name: string;
  dose_text: string | null;
  route: string | null;
  form: string | null;
  strength: string | null;
  frequency_text: string | null;
  sig_text: string | null;
  status: string;
  start_at: Date | null;
  end_at: Date | null;
  metadata: unknown;
  created_at: Date;
  updated_at: Date;
}

const bodyFieldToColumn: Record<
  keyof MedicationUpdateBody,
  keyof MedicationRow | "metadata"
> = {
  medication_name: "medication_name",
  rxnorm_cui: "rxnorm_cui",
  ndc_10: "ndc_10",
  ndc_11: "ndc_11",
  dose_text: "dose_text",
  route: "route",
  form: "form",
  strength: "strength",
  frequency_text: "frequency_text",
  sig_text: "sig_text",
  status: "status",
  start_at: "start_at",
  end_at: "end_at",
  metadata: "metadata",
};

function rowToHistorySnapshot(row: MedicationRow): Record<string, unknown> {
  return {
    id: row.id,
    organization_id: row.organization_id,
    patient_id: row.patient_id,
    rxnorm_cui: row.rxnorm_cui,
    ndc_10: row.ndc_10,
    ndc_11: row.ndc_11,
    medication_name: row.medication_name,
    dose_text: row.dose_text,
    route: row.route,
    form: row.form,
    strength: row.strength,
    frequency_text: row.frequency_text,
    sig_text: row.sig_text,
    status: row.status,
    start_at: row.start_at?.toISOString() ?? null,
    end_at: row.end_at?.toISOString() ?? null,
    metadata: row.metadata,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

export function serializeMedication(row: MedicationRow) {
  return {
    id: row.id,
    organization_id: row.organization_id,
    patient_id: row.patient_id,
    rxnorm_cui: row.rxnorm_cui,
    ndc_10: row.ndc_10,
    ndc_11: row.ndc_11,
    medication_name: row.medication_name,
    dose_text: row.dose_text,
    route: row.route,
    form: row.form,
    strength: row.strength,
    frequency_text: row.frequency_text,
    sig_text: row.sig_text,
    status: row.status,
    start_at: row.start_at?.toISOString() ?? null,
    end_at: row.end_at?.toISOString() ?? null,
    metadata: row.metadata,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

type ParsedPatch = z.infer<typeof medicationUpdateBodySchema>;

function buildUpdate(
  patch: ParsedPatch,
): { fragments: string[]; values: unknown[] } {
  const entries = Object.entries(patch).filter(([, v]) => v !== undefined) as [
    keyof ParsedPatch,
    ParsedPatch[keyof ParsedPatch],
  ][];

  const fragments: string[] = [];
  const values: unknown[] = [];
  let i = 1;

  for (const [key, value] of entries) {
    const column = bodyFieldToColumn[key];
    if (column === "start_at" || column === "end_at") {
      fragments.push(`"${column}" = $${i++}`);
      values.push(value === null ? null : new Date(value as string));
      continue;
    }
    if (column === "metadata") {
      fragments.push(`"${column}" = $${i++}::jsonb`);
      values.push(value);
      continue;
    }
    fragments.push(`"${column}" = $${i++}`);
    values.push(value);
  }

  return { fragments, values };
}

export async function updateMedicationForRequest(
  client: DbClient,
  params: {
    medicationId: string;
    organizationId: string;
    actorUserId: string;
    requestId: string;
    ifMatch: string | undefined;
    patch: ParsedPatch;
    req: Request;
  },
): Promise<MedicationRow> {
  const {
    medicationId,
    organizationId,
    actorUserId,
    requestId,
    ifMatch,
    patch,
    req,
  } = params;

  const {
    rows: [clock],
  } = await client.query<{ t: Date }>(
    "SELECT clock_timestamp() AS t",
  );
  const eventTime = clock.t;

  const lock = await client.query<MedicationRow>(
    `SELECT *
     FROM soma_ehr.medications
     WHERE id = $1
     FOR UPDATE`,
    [medicationId],
  );

  const current = lock.rows[0];
  if (!current) {
    const err = new Error("MEDICATION_NOT_FOUND") as Error & {
      code: string;
    };
    err.code = "MEDICATION_NOT_FOUND";
    throw err;
  }

  if (current.organization_id !== organizationId) {
    const err = new Error("ORGANIZATION_FORBIDDEN") as Error & {
      code: string;
    };
    err.code = "ORGANIZATION_FORBIDDEN";
    throw err;
  }

  assertIfMatchIfPresent(ifMatch, current.updated_at);

  const { fragments, values } = buildUpdate(patch);
  if (fragments.length === 0) {
    const err = new Error("EMPTY_PATCH") as Error & { code: string };
    err.code = "EMPTY_PATCH";
    throw err;
  }

  const snapshot = rowToHistorySnapshot(current);

  await client.query(
    `INSERT INTO soma_ehr.medication_history (
       organization_id,
       medication_id,
       snapshot,
       snapshot_schema_version,
       correlation_request_id
     ) VALUES ($1, $2, $3::jsonb, $4, $5)`,
    [
      current.organization_id,
      current.id,
      snapshot,
      1,
      requestId,
    ],
  );

  const idParam = values.length + 1;
  const orgParam = values.length + 2;
  const updateSql = `
    UPDATE soma_ehr.medications
    SET ${fragments.join(", ")}
    WHERE id = $${idParam} AND organization_id = $${orgParam}
    RETURNING *
  `;

  const update = await client.query<MedicationRow>(updateSql, [
    ...values,
    medicationId,
    organizationId,
  ]);

  const updated = update.rows[0];
  if (!updated) {
    const err = new Error("MEDICATION_UPDATE_FAILED") as Error & {
      code: string;
    };
    err.code = "MEDICATION_UPDATE_FAILED";
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
      resourceId: updated.id,
      action: "update",
      patientId: updated.patient_id,
      occurredAtIso: eventTime.toISOString(),
    },
    metadata: {
      schemaVersion: 1,
      domain: "medications.put",
      http: {
        method: req.method,
        path: req.originalUrl ?? req.url,
      },
      resource: { type: "medication", id: medicationId },
    },
  });

  return updated;
}

export async function putMedicationHandler(req: Request, res: Response) {
  const idParsed = idParamSchema.safeParse(req.params.id);
  if (!idParsed.success) {
    res.status(400).json({ error: "Invalid medication id (expected UUID)" });
    return;
  }

  const bodyParsed = medicationUpdateBodySchema.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({
      error: "Invalid request body",
      details: bodyParsed.error.flatten(),
    });
    return;
  }

  if (Object.keys(bodyParsed.data).length === 0) {
    res.status(400).json({ error: "No updatable fields provided" });
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
    const updated = await withTransaction((client) =>
      updateMedicationForRequest(client, {
        medicationId: idParsed.data,
        organizationId,
        actorUserId: userId,
        requestId: req.context.requestId,
        ifMatch: req.get("if-match"),
        patch: bodyParsed.data,
        req,
      }),
    );

    res.setHeader("ETag", formatMedicationEtag(updated.updated_at));
    res.json(serializeMedication(updated));
  } catch (err) {
    const e = err as { code?: string; message?: string } & Error;

    if (e.code === "MEDICATION_NOT_FOUND") {
      res.status(404).json({ error: "Medication not found" });
      return;
    }
    if (e.code === "ORGANIZATION_FORBIDDEN") {
      res.status(403).json({ error: "Forbidden for this organization" });
      return;
    }
    if (e.code === "IF_MATCH_FAILED") {
      res.status(412).json({
        error: "Precondition failed (If-Match does not match resource)",
      });
      return;
    }
    if (e.code === "EMPTY_PATCH") {
      res
        .status(400)
        .json({ error: "No updatable fields provided" });
      return;
    }

    const pgCode = (err as { code?: string }).code;
    if (pgCode === "23514") {
      res.status(400).json({
        error: "Update violates data constraints (e.g. date range or status)",
      });
      return;
    }

    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
}
