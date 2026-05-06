import type { Request } from "express";
import { describe, expect, it, vi } from "vitest";
import {
  fetchWithBackgroundJobTracing,
  fetchWithExpressTracing,
  outboundTracingHeadersFromBackgroundJob,
  outboundTracingHeadersFromExpressRequest,
} from "../src/http/outboundHttp";
import { CORRELATION_ID_HEADER, REQUEST_ID_HEADER } from "../src/middleware/requestContext";

describe("outboundHttp tracing headers", () => {
  it("forwards Express req.context ids", () => {
    const req = {
      context: {
        correlationId: "corr-1",
        requestId: "req-1",
        timestamp: "",
        organizationId: null,
      },
    } as unknown as Request;

    const h = outboundTracingHeadersFromExpressRequest(req);
    expect(h[CORRELATION_ID_HEADER]).toBe("corr-1");
    expect(h[REQUEST_ID_HEADER]).toBe("req-1");
  });

  it("job tracing preserves correlation and uses execution request id", () => {
    const h = outboundTracingHeadersFromBackgroundJob({
      correlationId: "corr-orig",
      executionRequestId: "job-exec-1",
    });
    expect(h[CORRELATION_ID_HEADER]).toBe("corr-orig");
    expect(h[REQUEST_ID_HEADER]).toBe("job-exec-1");
  });
});

describe("outboundHttp fetch wrappers", () => {
  it("fetchWithExpressTracing sets tracing headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const req = {
      context: {
        correlationId: "c",
        requestId: "r",
        timestamp: "",
        organizationId: null,
      },
    } as unknown as Request;

    await fetchWithExpressTracing(req, "https://example.test/x", {
      headers: { Authorization: "Bearer z" },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get(CORRELATION_ID_HEADER)).toBe("c");
    expect(headers.get(REQUEST_ID_HEADER)).toBe("r");
    expect(headers.get("authorization")).toBe("Bearer z");

    vi.unstubAllGlobals();
  });

  it("fetchWithBackgroundJobTracing sets tracing headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchWithBackgroundJobTracing(
      { correlationId: "c0", executionRequestId: "exec-9" },
      "https://example.test/y",
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get(CORRELATION_ID_HEADER)).toBe("c0");
    expect(headers.get(REQUEST_ID_HEADER)).toBe("exec-9");

    vi.unstubAllGlobals();
  });
});
