import { describe, expect, it } from "vitest";
import { effectiveTenantIdFromClerkSession } from "../src/clerk/tenantFromAuth";

describe("effectiveTenantIdFromClerkSession", () => {
  it("uses orgId when no custom claim name", () => {
    expect(
      effectiveTenantIdFromClerkSession(
        { orgId: "org_abc", sessionClaims: {} },
        null,
      ),
    ).toBe("org_abc");
  });

  it("prefers session claim when claim name is set", () => {
    expect(
      effectiveTenantIdFromClerkSession(
        {
          orgId: "org_abc",
          sessionClaims: {
            tenant_id: "11111111-1111-4111-8111-111111111111",
          },
        },
        "tenant_id",
      ),
    ).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("returns null when claim missing", () => {
    expect(
      effectiveTenantIdFromClerkSession(
        { orgId: "org_abc", sessionClaims: {} },
        "tenant_id",
      ),
    ).toBe(null);
  });

  it("returns null when orgId missing and no claim path", () => {
    expect(
      effectiveTenantIdFromClerkSession(
        { orgId: null, sessionClaims: {} },
        null,
      ),
    ).toBe(null);
  });
});
