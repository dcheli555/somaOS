import type { ClerkClient } from "@clerk/express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_ORG_METADATA_TENANT_KEY,
  tenantUuidFromOrgPublicMetadata,
  userMembershipAllowsTenant,
} from "../src/clerk/verifyTenantMembership";

describe("tenantUuidFromOrgPublicMetadata", () => {
  it("reads string value by key", () => {
    expect(
      tenantUuidFromOrgPublicMetadata(
        { [DEFAULT_ORG_METADATA_TENANT_KEY]: " 11111111-1111-4111-8111-111111111111 " },
        DEFAULT_ORG_METADATA_TENANT_KEY,
      ),
    ).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("returns null for missing metadata or key", () => {
    expect(
      tenantUuidFromOrgPublicMetadata(null, DEFAULT_ORG_METADATA_TENANT_KEY),
    ).toBe(null);
    expect(tenantUuidFromOrgPublicMetadata({}, "other")).toBe(null);
  });
});

describe("userMembershipAllowsTenant", () => {
  const metaKey = DEFAULT_ORG_METADATA_TENANT_KEY;

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("delegates org_ header to organizations.getOrganizationMembershipList", async () => {
    const orgList = vi.fn().mockResolvedValue({ data: [{}] });

    const client = {
      organizations: { getOrganizationMembershipList: orgList },
      users: { getOrganizationMembershipList: vi.fn() },
    } as unknown as ClerkClient;

    await expect(
      userMembershipAllowsTenant(client, {
        userId: "user_abc",
        tenantIdHeader: "org_xyz",
        metadataKey: metaKey,
      }),
    ).resolves.toBe(true);

    expect(orgList).toHaveBeenCalledWith({
      organizationId: "org_xyz",
      userId: ["user_abc"],
      limit: 1,
    });
  });

  it("paginates user memberships until metadata matches UUID header (case-insensitive)", async () => {
    const userList = vi
      .fn()
      .mockResolvedValueOnce({
        data: [
          {
            organization: {
              publicMetadata: { [metaKey]: "22222222-2222-4222-8222-222222222222" },
            },
          },
        ],
        totalCount: 2,
      })
      .mockResolvedValueOnce({
        data: [
          {
            organization: {
              publicMetadata: {
                [metaKey]: "11111111-1111-4111-8111-111111111111",
              },
            },
          },
        ],
        totalCount: 2,
      });

    const client = {
      organizations: { getOrganizationMembershipList: vi.fn() },
      users: { getOrganizationMembershipList: userList },
    } as unknown as ClerkClient;

    await expect(
      userMembershipAllowsTenant(client, {
        userId: "user_abc",
        tenantIdHeader: "11111111-1111-4111-8111-111111111111",
        metadataKey: metaKey,
      }),
    ).resolves.toBe(true);

    expect(userList).toHaveBeenNthCalledWith(1, {
      userId: "user_abc",
      limit: 100,
      offset: 0,
    });
    expect(userList).toHaveBeenNthCalledWith(2, {
      userId: "user_abc",
      limit: 100,
      offset: 1,
    });
  });
});
