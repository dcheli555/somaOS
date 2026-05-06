import { z } from "zod";
import type { DbClient } from "../db/pool";
import { pool } from "../db/pool";
import {
  findOrganizationByClerkId,
  findOrganizationByInternalId,
  provisionOrganizationForClerkId,
} from "./organizationRepository";

/**
 * Validates `X-Organization-Id`: internal tenant UUID (`organizations.id`) or Clerk `org_*`.
 * Routing does not imply trust; membership is checked later (see `requireTenantMembership`).
 */
export const organizationHeaderSchema = z.union([
  z.string().uuid(),
  z
    .string()
    .regex(
      /^org_[A-Za-z0-9]+$/,
      "must be internal organization UUID or Clerk organization id (org_…)",
    ),
]);

/** Internal UUID + external Clerk/org binding after DB resolution. */
export type ResolvedOrganization = {
  organizationId: string;
  clerkOrganizationId: string;
};

/**
 * When `SOMA_AUTO_PROVISION_ORGANIZATIONS=1`, missing Clerk org rows are inserted using a generated UUID.
 */
function autoProvisionEnabled(): boolean {
  return (
    typeof process.env.SOMA_AUTO_PROVISION_ORGANIZATIONS === "string" &&
    process.env.SOMA_AUTO_PROVISION_ORGANIZATIONS.trim() === "1"
  );
}

async function resolveClerkOrganizationIdHeader(
  client: DbClient,
  clerkOrganizationId: string,
): Promise<ResolvedOrganization | null> {
  let row = await findOrganizationByClerkId(client, clerkOrganizationId);
  if (!row && autoProvisionEnabled()) {
    try {
      row = await provisionOrganizationForClerkId(client, {
        clerkOrganizationId,
      });
    } catch (err: unknown) {
      const code = typeof err === "object" && err && "code" in err ? (err as { code?: string }).code : undefined;
      if (code === "23505") {
        row = await findOrganizationByClerkId(client, clerkOrganizationId);
      } else {
        throw err;
      }
    }
  }
  if (!row) return null;
  return {
    organizationId: row.id,
    clerkOrganizationId: row.clerkOrganizationId,
  };
}

async function resolveInternalOrganizationIdHeader(
  client: DbClient,
  organizationId: string,
): Promise<ResolvedOrganization | null> {
  const row = await findOrganizationByInternalId(client, organizationId);
  if (!row) return null;
  return {
    organizationId: row.id,
    clerkOrganizationId: row.clerkOrganizationId,
  };
}

/** Looks up ResolvedOrganization via pool; owns one pooled connection per call for provision races. */
export async function resolveOrganizationFromHeader(
  headerValue: string,
): Promise<ResolvedOrganization | null> {
  const parsed = organizationHeaderSchema.safeParse(headerValue.trim());
  if (!parsed.success) return null;

  const raw = parsed.data;
  const client = await pool.connect();
  try {
    if (raw.startsWith("org_")) {
      return await resolveClerkOrganizationIdHeader(client, raw);
    }
    return await resolveInternalOrganizationIdHeader(client, raw);
  } finally {
    client.release();
  }
}
