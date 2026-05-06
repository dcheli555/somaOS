import type { RequestHandler } from "express";
import { randomUUID } from "node:crypto";

export const CORRELATION_ID_HEADER = "x-correlation-id";
export const REQUEST_ID_HEADER = "x-request-id";

/**
 * Ensures each request has `req.context` (correlationId, requestId, timestamp, organizationId)
 * and echoes correlation and request identifiers on the response.
 *
 * Mount early in the Express stack (before auth and route handlers).
 */
export const requestContextMiddleware: RequestHandler = (req, res, next) => {
  const rawCorrelation = req.get(CORRELATION_ID_HEADER);
  const correlationId =
    typeof rawCorrelation === "string" && rawCorrelation.trim().length > 0
      ? rawCorrelation.trim()
      : randomUUID();
  const requestId = randomUUID();
  const timestamp = new Date().toISOString();
  const organizationId = null;

  req.context = {
    correlationId,
    requestId,
    timestamp,
    organizationId,
  };

  res.setHeader(CORRELATION_ID_HEADER, correlationId);
  res.setHeader(REQUEST_ID_HEADER, requestId);
  next();
};
