import type { RequestHandler } from "express";
import { randomUUID } from "node:crypto";

export const CORRELATION_ID_HEADER = "x-correlation-id";
export const REQUEST_ID_HEADER = "x-request-id";

/**
 * Ensures each request has `req.context` (tracing + placeholder org keys)
 * and echoes correlation/request ids on the response.
 *
 * `organizationId` / `clerkOrganizationId` are filled by `resolveOrganizationContext`
 * on scoped routes once `X-Organization-Id` is resolved against `organizations`.
 */
export const requestContextMiddleware: RequestHandler = (req, res, next) => {
  const rawCorrelation = req.get(CORRELATION_ID_HEADER);
  const correlationId =
    typeof rawCorrelation === "string" && rawCorrelation.trim().length > 0
      ? rawCorrelation.trim()
      : randomUUID();
  const requestId = randomUUID();
  const timestamp = new Date().toISOString();

  req.context = {
    correlationId,
    requestId,
    timestamp,
    organizationId: null,
    clerkOrganizationId: null,
  };

  res.setHeader(CORRELATION_ID_HEADER, correlationId);
  res.setHeader(REQUEST_ID_HEADER, requestId);
  next();
};
