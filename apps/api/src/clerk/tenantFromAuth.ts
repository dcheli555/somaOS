/**
 * Derive the tenant identifier that the session is allowed to act as.
 *
 * - If `tenantClaimName` is set: read that key from `sessionClaims` (JWT custom claim).
 *   Matches internal tenant UUID (`soma_os.organizations.id`).
 * - Otherwise: use Clerk's active-organization id (`auth.orgId`).
 */
export function effectiveTenantIdFromClerkSession(
  auth: {
    orgId: string | null;
    sessionClaims: unknown;
  },
  tenantClaimName: string | null,
): string | null {
  const claim = tenantClaimName?.trim();
  if (claim) {
    const claims = auth.sessionClaims as
      | Record<string, unknown>
      | null
      | undefined;
    const raw = claims?.[claim];
    if (typeof raw === "string" && raw.trim() !== "") {
      return raw.trim();
    }
    return null;
  }
  const oid = auth.orgId;
  return oid && oid.trim() !== "" ? oid.trim() : null;
}
