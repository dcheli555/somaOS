import type { RequestHandler } from "express";
import { z } from "zod";

const orgHeaderSchema = z.string().uuid();

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
      error: "Invalid X-Organization-Id (expected UUID)",
    });
    return;
  }

  req.context.organizationId = parsed.data;
  next();
};
