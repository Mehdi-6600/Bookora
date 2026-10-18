import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  booking: null as null | { id: string; businessId: string; isTestBooking: boolean },
  updated: [] as Array<Record<string, unknown>>,
  countedWhere: null as any,
  funnelEvents: [] as Array<Record<string, any>>,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    booking: {
      findUnique: async () => mock.booking,
      count: async ({ where }: any) => { mock.countedWhere = where; return 1; },
    },
    outreachProspect: {
      findFirst: async () => ({ id: "prospect-1", status: "REGISTERED", campaignId: "campaign-1" }),
      findMany: async () => [{ convertedBusinessId: "business-1" }],
      update: async ({ data }: any) => { mock.updated.push(data); return data; },
      count: async () => 0,
    },
    botStart: { count: async () => 0 },
    funnelEvent: {
      create: async ({ data }: any) => {
        mock.funnelEvents.push(data);
        return data;
      },
    },
    user: { count: async () => 0 },
  },
}));
const { markFirstBooking, markPaidConversion, getConversionCounts } = await import("@/lib/outreach/attribution");
beforeEach(() => {
  mock.booking = null;
  mock.updated = [];
  mock.countedWhere = null;
  mock.funnelEvents = [];
});

describe("verified paid conversion attribution", () => {
  it("records a campaign-linked paid conversion without buyer identity", async () => {
    await markPaidConversion("user-1", "business-1");

    expect(mock.funnelEvents).toHaveLength(1);
    expect(mock.funnelEvents[0]).toMatchObject({
      event: "paid_conversion",
      campaignId: "campaign-1",
      locale: null,
      ref: null,
    });
    expect(mock.funnelEvents[0]).not.toHaveProperty("userId");
    expect(mock.funnelEvents[0]).not.toHaveProperty("telegramId");
  });
});

describe("genuine first booking attribution", () => {
  it("never activates a prospect from an authorized test booking or mismatched business", async () => {
    mock.booking = { id: "booking-1", businessId: "business-1", isTestBooking: true };
    await markFirstBooking("business-1", "booking-1");
    expect(mock.updated).toHaveLength(0);
    mock.booking.isTestBooking = false;
    await markFirstBooking("another-business", "booking-1");
    expect(mock.updated).toHaveLength(0);
  });
  it("preserves real booking activation and excludes tests from totals", async () => {
    mock.booking = { id: "booking-1", businessId: "business-1", isTestBooking: false };
    await markFirstBooking("business-1", "booking-1");
    expect(mock.updated).toMatchObject([{ status: "ACTIVATED" }]);
    await getConversionCounts(new Date(0));
    expect(mock.countedWhere.isTestBooking).toBe(false);
  });
});
