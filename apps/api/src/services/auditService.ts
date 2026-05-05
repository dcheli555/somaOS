import type { Request } from "express";
import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { z } from "zod";
import type { DbClient } from "../db/pool";

export const auditOutcomeSchema = z.enum(["success", "failure", "denied"]);
export type AuditOutcome = z.infer<typeof auditOutcomeSchema>;

/**
 * HTTP / job identity for an auditable action. `requestId` is mandatory on every insert.
 */
export const auditRequestContextSchema = z.object({
  organizationId: z.string().uuid(),
  actorUserId: z.union([z.string().min(1), z.null()]).optional(),
  requestId: z.string().min(1),
  actorIp: z.string().nullable().optional(),
  userAgent: z.string().nullable().optional(),
  sessionId: z.string().nullable().optional(),
  actorRole: z.string().nullable().optional(),
  siteId: z.string().uuid().nullable().optional(),
  apiClientId: z.string().nullable().optional(),
  scopes: z.array(z.string()).nullable().optional(),
});

export type AuditRequestContext = z.infer<typeof auditRequestContextSchema>;

export const auditEventDetailsSchema = z.object({
  eventType: z.string().min(1),
  action: z.string().min(1),
  outcome: auditOutcomeSchema,
  resourceType: z.string().min(1),
  resourceId: z.union([z.string().uuid(), z.null()]),
  patientId: z.union([z.string().uuid(), z.null()]),
  encounterId: z.union([z.string().uuid(), z.null()]).optional(),
  occurredAtIso: z.string().datetime({ offset: true }).optional(),
  reason: z.string().nullable().optional(),
  previousValueHash: z.string().nullable().optional(),
  newValueHash: z.string().nullable().optional(),
});

export type AuditEventDetails = z.infer<typeof auditEventDetailsSchema>;

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

  const rawSite = req.get("x-site-id");
  const siteId =
    typeof rawSite === "string" && z.string().uuid().safeParse(rawSite.trim()).success
      ? rawSite.trim()
      : undefined;

  return auditRequestContextSchema.parse({
    ...identity,
    actorIp: actorIp ?? null,
    userAgent: req.get("user-agent") ?? null,
    sessionId: req.get("x-session-id") ?? null,
    actorRole: req.get("x-actor-role") ?? null,
    siteId: siteId ?? null,
    apiClientId: req.get("x-api-client-id") ?? null,
    scopes: undefined,
  });
}

/** Deterministic short hash for optional before/after fingerprints (not cryptographic proof). */
export function auditPayloadHash(payload: unknown): string {
  const json = JSON.stringify(payload);
  return createHash("sha256").update(json, "utf8").digest("hex").slice(0, 64);
}

/**
 * Inserts one row into `soma_ehr.audit_log` using the given client (call inside a transaction when needed).
 */
export async function insertAuditEvent(
  client: DbClient,
  input: {
    request: AuditRequestContext;
    event: AuditEventDetails;
    metadata?: Record<string, unknown> | null;
  },
): Promise<void> {
  const request = auditRequestContextSchema.parse(input.request);
  const event = auditEventDetailsSchema.parse(input.event);

  const { forPg } = resolveEventInstant(event.occurredAtIso);

  const inet =
    request.actorIp && isIP(request.actorIp) ? request.actorIp : null;

  await client.query(
    `INSERT INTO soma_ehr.audit_log (
       "timestamp",
       event_type,
       action,
       outcome,
       actor_user_id,
       actor_role,
       organization_id,
       site_id,
       patient_id,
       encounter_id,
       resource_type,
       resource_id,
       reason,
       request_id,
       session_id,
       source_ip,
       user_agent,
       api_client_id,
       scopes,
       previous_value_hash,
       new_value_hash,
       metadata
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::inet, $17, $18, $19::text[], $20, $21, $22::jsonb
     )`,
    [
      forPg,
      event.eventType,
      event.action,
      event.outcome,
      request.actorUserId ?? null,
      request.actorRole ?? null,
      request.organizationId,
      request.siteId ?? null,
      event.patientId,
      event.encounterId ?? null,
      event.resourceType,
      event.resourceId,
      event.reason ?? null,
      request.requestId,
      request.sessionId ?? null,
      inet,
      request.userAgent ?? null,
      request.apiClientId ?? null,
      request.scopes ?? null,
      event.previousValueHash ?? null,
      event.newValueHash ?? null,
      input.metadata === undefined ? null : input.metadata,
    ],
  );
}
