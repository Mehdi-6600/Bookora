import { describe, expect, it, vi } from "vitest";
import {
  activePaidSubscriptionWhere,
  nextSubscriptionPeriod,
} from "@/lib/subscription/entitlement";

describe("business-scoped subscription entitlement", () => {
  const now = new Date("2026-10-13T12:00:00.000Z");

  it("looks up active entitlements for only the requested business", () => {
    const where = activePaidSubscriptionWhere("owner-1", now, "business-1");

    expect(where).toMatchObject({
      userId: "owner-1",
      businessId: "business-1",
      plan: { in: ["PRO_MONTHLY", "PRO_YEARLY"] },
      status: "ACTIVE",
    });
  });

  it("extends a subscription period using only that business's prior payments", async () => {
    const expiresAt = new Date("2026-11-01T12:00:00.000Z");
    const findMany = vi.fn().mockResolvedValue([{ expiresAt }]);
    const tx = { subscription: { findMany } } as never;

    const period = await nextSubscriptionPeriod(
      tx,
      "owner-1",
      30,
      now,
      "business-1"
    );

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: "owner-1",
          businessId: "business-1",
          status: "ACTIVE",
        }),
      })
    );
    expect(period.startedAt).toEqual(expiresAt);
    expect(period.expiresAt).toEqual(
      new Date("2026-12-01T12:00:00.000Z")
    );
  });
});
