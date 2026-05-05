import type { ClerkClient } from "@clerk/express";

/** Default Clerk organization `public_metadata` key for internal Postgres tenant UUID (override via `CLERK_ORG_METADATA_TENANT_KEY`). */
export const DEFAULT_ORG_METADATA_TENANT_KEY = "tenant_uuid";

const PAGE_LIMIT = 100;

export function orgMetadataTenantKeyFromEnv(): string {
  const v = process.env.CLERK_ORG_METADATA_TENANT_KEY?.trim();
  return v && v.length > 0 ? v : DEFAULT_ORG_METADATA_TENANT_KEY;
}

/**
 * Reads a string tenant UUID (or opaque id) from Clerk organization `publicMetadata`.
 */
export function tenantUuidFromOrgPublicMetadata(
  publicMetadata: unknown,
  key: string,
): string | null {
  if (
    typeof publicMetadata !== "object" ||
    publicMetadata === null ||
    !key.trim()
  ) {
    return null;
  }
  const raw = (publicMetadata as Record<string, unknown>)[key];
  return typeof raw === "string" && raw.trim() !== "" ? raw.trim() : null;
}

function normalizeUuidTenantHeader(id: string): string {
  return id.trim().toLowerCase();
}

/**
 * Whether the authenticated Clerk user belongs to `organizationId`:
 * — `org_…`: membership on that Clerk organization via Backend API (optionally shortened by callers).
 * — UUID `X-Organization-Id`: any membership whose organization `publicMetadata[metadataKey]` matches.
 */
export async function userMembershipAllowsTenant(
  client: ClerkClient,
  params: {
    userId: string;
    tenantIdHeader: string;
    metadataKey: string;
  },
): Promise<boolean> {
  const { userId, tenantIdHeader, metadataKey } = params;

  if (tenantIdHeader.startsWith("org_")) {
    const { data } = await client.organizations.getOrganizationMembershipList({
      organizationId: tenantIdHeader,
      userId: [userId],
      limit: 1,
    });
    return data.length > 0;
  }

  const want = normalizeUuidTenantHeader(tenantIdHeader);

  let offset = 0;
  for (;;) {
    const { data, totalCount } = await client.users.getOrganizationMembershipList({
      userId,
      limit: PAGE_LIMIT,
      offset,
    });
    for (const m of data) {
      const mapped = tenantUuidFromOrgPublicMetadata(
        m.organization.publicMetadata,
        metadataKey,
      );
      if (
        mapped !== null &&
        normalizeUuidTenantHeader(mapped) === want
      ) {
        return true;
      }
    }
    offset += data.length;
    if (data.length === 0 || offset >= totalCount) {
      return false;
    }
  }
}
