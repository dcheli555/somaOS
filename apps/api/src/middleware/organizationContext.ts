import type { RequestHandler } from "express";
import { z } from "zod";

/** Tenant key: internal UUID (postgres) or Clerk organization id (`org_…`). */
const orgHeaderSchema = z.union([
  z.string().uuid(),
  z
    .string()
    .regex(
      /^org_[A-Za-z0-9]+$/,
      "must be a UUID or Clerk organization id (org_…)",
    ),
]);

/**
 * Requires `X-Organization-Id` (tenant) on the request and aligns `req.context.organizationId`.
 * Run after `requireAuthContext` on organization-scoped routes.
 */
export const requireOrganizationContext: RequestHandler = (req, res, next) => {
  const raw = req.get("x-organization-id");
  if (!raw?.trim()) {
    res.status(400).json({
      error: "Missing X-Organization-Id header",
    });
    return;
  }

  const parsed = orgHeaderSchema.safeParse(raw.trim());
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid X-Organization-Id (expected UUID or Clerk org id org_…)",
    });
    return;
  }

  req.context.organizationId = parsed.data;
  next();
};
