import type { DbClient } from "../db/pool";
import { pool } from "../db/pool";

/**
 * Persisted tenant: internal UUID (`id`) for FKs; `clerk_organization_id` is the Clerk `org_*` string
 * (or a synthetic `legacy:*` marker for rows migrated before this table existed).
 */
export interface OrganizationRecord {
  id: string;
  clerkOrganizationId: string;
  name: string;
}

function mapRow(row: {
  id: string;
  clerk_organization_id: string;
  name: string;
}): OrganizationRecord {
  return {
    id: row.id,
    clerkOrganizationId: row.clerk_organization_id,
    name: row.name,
  };
}

export async function findOrganizationByInternalId(
  client: DbClient,
  organizationId: string,
): Promise<OrganizationRecord | null> {
  const { rows } = await client.query<{
    id: string;
    clerk_organization_id: string;
    name: string;
  }>(
    `SELECT id, clerk_organization_id, name
     FROM soma_os.organizations
     WHERE id = $1::uuid`,
    [organizationId],
  );
  const row = rows[0];
  return row ? mapRow(row) : null;
}

export async function findOrganizationByInternalIdViaPool(
  organizationId: string,
): Promise<OrganizationRecord | null> {
  const client = await pool.connect();
  try {
    return await findOrganizationByInternalId(client, organizationId);
  } finally {
    client.release();
  }
}

export async function findOrganizationByClerkId(
  client: DbClient,
  clerkOrganizationId: string,
): Promise<OrganizationRecord | null> {
  const { rows } = await client.query<{
    id: string;
    clerk_organization_id: string;
    name: string;
  }>(
    `SELECT id, clerk_organization_id, name
     FROM soma_os.organizations
     WHERE clerk_organization_id = $1`,
    [clerkOrganizationId],
  );
  const row = rows[0];
  return row ? mapRow(row) : null;
}

export async function findOrganizationByClerkIdViaPool(
  clerkOrganizationId: string,
): Promise<OrganizationRecord | null> {
  const client = await pool.connect();
  try {
    return await findOrganizationByClerkId(client, clerkOrganizationId);
  } finally {
    client.release();
  }
}

/** Inserts a new tenant row keyed by Clerk’s org id; internal UUID is generated. */
export async function provisionOrganizationForClerkId(
  client: DbClient,
  params: {
    clerkOrganizationId: string;
    name?: string;
  },
): Promise<OrganizationRecord> {
  const { rows } = await client.query<{
    id: string;
    clerk_organization_id: string;
    name: string;
  }>(
    `INSERT INTO soma_os.organizations (clerk_organization_id, name)
     VALUES ($1, $2)
     RETURNING id, clerk_organization_id, name`,
    [params.clerkOrganizationId, params.name?.trim() || ""],
  );
  const row = rows[0];
  if (!row) {
    throw new Error("ORGANIZATION_PROVISION_FAILED");
  }
  return mapRow(row);
}
