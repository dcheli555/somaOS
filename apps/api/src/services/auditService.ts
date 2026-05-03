import type { Request } from "express";
import { isIP } from "node:net";
import { z } from "zod";
import type { DbClient } from "../db/pool";

/**
 * HTTP / job identity for an auditable action. `requestId` is mandatory on every insert.
 */
export const auditRequestContextSchema = z.object({
  organizationId: z.string().uuid(),
  actorUserId: z.string().min(1),
  requestId: z.string().min(1),
  actorIp: z.string().nullable().optional(),
  userAgent: z.string().nullable().optional(),
  sessionId: z.string().nullable().optional(),
});

export type AuditRequestContext = z.infer<typeof auditRequestContextSchema>;

/**
 * Required metadata on every `context` JSON document stored in `audit_log`.
 * Use `domain` to namespace the emitting workflow (e.g. `medications.put`).
 * Additional keys are allowed for safe, non-PHI attributes.
 */
export const auditMetadataSchema = z
  .object({
    schemaVersion: z.literal(1),
    domain: z.string().min(1),
  })
  .passthrough();

export type AuditMetadata = z.infer<typeof auditMetadataSchema>;

const uuidOrNull = z.union([z.string().uuid(), z.null()]);

export const auditEventDetailsSchema = z.object({
  resourceType: z.string().min(1),
  resourceId: uuidOrNull,
  action: z.string().min(1),
  patientId: uuidOrNull,
  /**
   * When omitted, the event time is `new Date()` at write time, normalized to UTC ISO-8601.
   * When provided, must be a valid ISO-8601 instant with offset (stored in DB as timestamptz).
   */
  occurredAtIso: z.string().datetime({ offset: true }).optional(),
});

export type AuditEventDetails = z.infer<typeof auditEventDetailsSchema>;

/** Envelope stored in `audit_log.context`: required metadata + correlation + UTC time. */
const auditStoredContextSchema = z
  .object({
    schemaVersion: z.literal(1),
    domain: z.string().min(1),
    requestId: z.string().min(1),
    eventTimestampUtc: z.string().datetime({ offset: true }),
  })
  .passthrough();

export type AuditStoredContext = z.infer<typeof auditStoredContextSchema>;

function assertUtcIso8601(value: string): string {
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) {
    throw new TypeError(`AUDIT_BAD_ISO8601: ${value}`);
  }
  return new Date(ms).toISOString();
}

function resolveEventInstant(occurredAtIso?: string): {
  utcIso8601: string;
  forPg: Date;
} {
  const utcIso8601 = occurredAtIso
    ? assertUtcIso8601(occurredAtIso)
    : new Date().toISOString();
  return { utcIso8601, forPg: new Date(utcIso8601) };
}

/**
 * Derives transport-level audit fields from an Express request.
 * Does not set `patientId` — that belongs on {@link AuditEventDetails}.
 */
export function buildAuditRequestFromExpress(
  req: Request,
  identity: Pick<AuditRequestContext, "organizationId" | "actorUserId" | "requestId">,
): AuditRequestContext {
  const forwarded = req.get("x-forwarded-for");
  const rawIp =
    typeof forwarded === "string" && forwarded.length > 0
      ? forwarded.split(",")[0]!.trim()
      : req.socket.remoteAddress ?? null;
  const actorIp = rawIp && isIP(rawIp) ? rawIp : null;

  return auditRequestContextSchema.parse({
    ...identity,
    actorIp: actorIp ?? null,
    userAgent: req.get("user-agent") ?? null,
    sessionId: req.get("x-session-id") ?? null,
  });
}

/**
 * Inserts one row into `soma_ehr.audit_log` using the given client (call inside a transaction when needed).
 * - Always persists `request_id` from {@link AuditRequestContext.requestId}.
 * - Normalizes event time to UTC ISO-8601 in the JSON context as `eventTimestampUtc`.
 */
export async function insertAuditEvent(
  client: DbClient,
  input: {
    request: AuditRequestContext;
    event: AuditEventDetails;
    metadata: AuditMetadata;
  },
): Promise<void> {
  const request = auditRequestContextSchema.parse(input.request);
  const event = auditEventDetailsSchema.parse(input.event);
  const metadata = auditMetadataSchema.parse(input.metadata);

  const { utcIso8601, forPg } = resolveEventInstant(event.occurredAtIso);

  const contextPayload: Record<string, unknown> = {
    ...metadata,
    requestId: request.requestId,
    eventTimestampUtc: utcIso8601,
  };

  auditStoredContextSchema.parse(contextPayload);

  const inet =
    request.actorIp && isIP(request.actorIp) ? request.actorIp : null;

  await client.query(
    `INSERT INTO soma_ehr.audit_log (
       organization_id,
       patient_id,
       actor_user_id,
       resource_type,
       resource_id,
       action,
       request_id,
       "timestamp",
       actor_ip,
       user_agent,
       session_id,
       context
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9::inet, $10, $11, $12::jsonb
     )`,
    [
      request.organizationId,
      event.patientId,
      request.actorUserId,
      event.resourceType,
      event.resourceId,
      event.action,
      request.requestId,
      forPg,
      inet,
      request.userAgent ?? null,
      request.sessionId ?? null,
      contextPayload,
    ],
  );
}
