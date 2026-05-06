import type { Request } from "express";
import { CORRELATION_ID_HEADER, REQUEST_ID_HEADER } from "../middleware/requestContext";

export type OutboundTracingHeaders = Readonly<{
  [CORRELATION_ID_HEADER]: string;
  [REQUEST_ID_HEADER]: string;
}>;

function asHeaderRecord(
  correlationId: string,
  requestId: string,
): OutboundTracingHeaders {
  return {
    [CORRELATION_ID_HEADER]: correlationId,
    [REQUEST_ID_HEADER]: requestId,
  };
}

/**
 * Tracing headers for outbound HTTP calls made while handling the current Express request.
 * Forwards the incoming API’s correlation and request ids (`X-Correlation-Id`, `X-Request-Id`).
 */
export function outboundTracingHeadersFromExpressRequest(
  req: Request,
): OutboundTracingHeaders {
  return asHeaderRecord(req.context.correlationId, req.context.requestId);
}

/**
 * Tracing headers for outbound calls from a background worker.
 * Preserves the originating HTTP correlation id; uses a new execution id as `X-Request-Id`.
 */
export function outboundTracingHeadersFromBackgroundJob(params: {
  correlationId: string;
  /** Per job run / worker execution (sent as `X-Request-Id`). */
  executionRequestId: string;
}): OutboundTracingHeaders {
  return asHeaderRecord(params.correlationId, params.executionRequestId);
}

function mergeTracingIntoHeaders(
  base: HeadersInit | undefined,
  tracing: OutboundTracingHeaders,
): Headers {
  const headers = new Headers(base ?? undefined);
  headers.set(CORRELATION_ID_HEADER, tracing[CORRELATION_ID_HEADER]);
  headers.set(REQUEST_ID_HEADER, tracing[REQUEST_ID_HEADER]);
  return headers;
}

/**
 * `fetch` wrapper: merges {@link outboundTracingHeadersFromExpressRequest} into `init.headers`.
 */
export function fetchWithExpressTracing(
  req: Request,
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const headers = mergeTracingIntoHeaders(
    init?.headers,
    outboundTracingHeadersFromExpressRequest(req),
  );
  return fetch(input, { ...init, headers });
}

/**
 * `fetch` wrapper: merges {@link outboundTracingHeadersFromBackgroundJob} into `init.headers`.
 */
export function fetchWithBackgroundJobTracing(
  job: { correlationId: string; executionRequestId: string },
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const headers = mergeTracingIntoHeaders(
    init?.headers,
    outboundTracingHeadersFromBackgroundJob(job),
  );
  return fetch(input, { ...init, headers });
}
