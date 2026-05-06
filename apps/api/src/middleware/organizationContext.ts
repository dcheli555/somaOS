import type { RequestHandler } from "express";
import { resolveOrganizationFromHeader } from "../organizations/resolveOrganizationFromHeader";

/**
 * Reads `X-Organization-Id` (UUID = internal `organizations.id`, or Clerk `org_*`),
 * resolves the canonical tenant row, and sets `req.context`:
 * — `organizationId`: internal UUID (all domain SQL uses this FK)
 * — `clerkOrganizationId`: external binding (membership verification with Clerk)
 *
 * Keeps Postgres vendor-neutral while still carrying Clerk identifiers for auth checks.
 */
export const resolveOrganizationContext: RequestHandler = async (
  req,
  res,
  next,
) => {
  const raw = req.get("x-organization-id");
  if (!raw?.trim()) {
    res.status(400).json({
      error: "Missing X-Organization-Id header",
    });
    return;
  }

  try {
    const resolved = await resolveOrganizationFromHeader(raw);
    if (!resolved) {
      res.status(403).json({
        error: {
          code: "ORGANIZATION_UNKNOWN",
          message:
            "Unknown organization. Ensure the tenant is registered or use a valid Clerk organization.",
        },
      });
      return;
    }

    req.context.organizationId = resolved.organizationId;
    req.context.clerkOrganizationId = resolved.clerkOrganizationId;
    next();
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: {
        code: "INTERNAL_ERROR",
        message: "Could not resolve organization.",
      },
    });
  }
};
