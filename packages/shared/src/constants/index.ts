/** Common HTTP header names for correlation and tracing. */
export const HTTP_HEADERS = {
  CORRELATION_ID: "x-correlation-id",
  REQUEST_ID: "x-request-id",
  TRACE_ID: "x-trace-id",
} as const;
