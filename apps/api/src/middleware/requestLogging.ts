import type { Request, RequestHandler } from "express";

function requestPathWithoutQuery(req: Request): string {
  const raw =
    typeof req.originalUrl === "string" && req.originalUrl.length > 0
      ? req.originalUrl
      : req.url;
  const q = raw.indexOf("?");
  return q >= 0 ? raw.slice(0, q) : raw;
}

/**
 * Emits one JSON access line per HTTP request when the response is finished (`res.on("finish")`).
 * Uses `req.context` and optional `req.authContext` only — no bodies, query strings, or params.
 *
 * Must run after {@link requestContextMiddleware}.
 */
export const requestLoggingMiddleware: RequestHandler = (req, res, next) => {
  const startedAt = Date.now();

  res.on("finish", () => {
    const durationMs = Date.now() - startedAt;

    const record: Record<string, string | number> = {
      correlationId: req.context.correlationId,
      requestId: req.context.requestId,
      method: req.method,
      path: requestPathWithoutQuery(req),
      statusCode: res.statusCode,
      durationMs,
    };

    const organizationId = req.context.organizationId;
    if (organizationId) {
      record.organizationId = organizationId;
    }

    const userId = req.authContext?.userId;
    if (userId) {
      record.userId = userId;
    }

    console.log(JSON.stringify(record));
  });

  next();
};
