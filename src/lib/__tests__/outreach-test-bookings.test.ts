import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Critical fix G — test bookings are not conversions.
 *
 * A test booking must never activate an outreach prospect, never count as a
 * pilot conversion, and never be createdmerely because an unauthenticated
 * client asked for one. A genuine customer booking must behave exactly as
 * before.
 */

const state = vi.hoisted(() => ({
  tables: {} as Record<string, Array<Record<string, any>>>,
  admin: false,
  notified: [] as Array<{ telegramId: string | null; text: string }>,
  funnel: [] as Array<{ event: string }>,
  attributionCalls: [] as Array<{ businessId: string; bookingId: string }>,
  txQueries: [] as string[],
  slotTime: 0,
  seq: 0,
}));

vi.mock("@prisma/client", () => import("./helpers/prisma-client-stub"));

vi.mock("@/lib/prisma", async () => {
  const { createPrismaDouble } = await import("./helpers/prisma-double");
  return { prisma: createPrismaDouble(state) };
});

vi.mock("@/lib/auth/session", () => ({
  getCurrentUser: async () => (state.admin ? { id: "admin-1", isAdmin: true } : null),
  requireAdmin: async () => ({ id: "admin-1", isAdmin: true }),
  requirePlatformAdmin: async () => ({ id: "admin-1", isAdmin: true }),
}));

vi.mock("@/lib/telegram/notify", () => ({
  notifyUser: async (telegramId: string | null, text: string) => {
    state.notified.push({ telegramId, text });
  },
  deliverTelegramMessage: async () => ({ ok: true as const, messageId: 1 }),
}));

vi.mock("@/lib/funnel", () => ({
  recordFunnelEvent: async (event: { event: string }) => {
    state.funnel.push({ event: event.event });
  },
}));

vi.mock("@/lib/outreach/attribution", () => ({
  markFirstBooking: async (businessId: string, bookingId: string) => {
    state.attributionCalls.push({ businessId, bookingId });
  },
  getConversionCounts: async () => ({
    botStarts: 0,
    registrations: 0,
    activations: 0,
    firstBookings: 0,
  }),
}));

vi.mock("@/lib/rate-limit", () => ({
  isRateLimited: async () => false,
  triggerRateLimitCleanup: () => undefined,
}));

vi.mock("@/lib/get-client-ip", () => ({ getClientIp: () => "203.0.113.1" }));

vi.mock("@/lib/booking/schedule", () => ({
  // A real `SELECT … FOR UPDATE` against the business row. The double has no
  // row locking, so record the call to prove the schedule is still locked.
  lockBusinessSchedule: async (_tx: any, businessId: string) => {
    state.txQueries.push(`lock:${businessId}`);
  },
  expireStalePendingBookings: async () => {
    state.txQueries.push("expire");
  },
  activeBookingOverlapWhere: (now: Date) => ({
    OR: [
      { status: "CONFIRMED" },
      { status: "PENDING_PAYMENT", createdAt: { gte: new Date(now.getTime() - 15 * 60_000) } },
    ],
  }),
  pendingBookingCutoff: (now: Date) => new Date(now.getTime() - 15 * 60_000),
}));

vi.mock("@/lib/availability", () => ({
  // The slot is computed from the real working hours; here the single valid
  // slot is exactly the one the test asks for.
  computeAvailableSlots: () => [new Date(state.slotTime)],
}));

vi.mock("@/lib/booking/time", () => ({
  getBusinessDate: () => "2026-10-12",
  getBusinessDayOfWeek: () => 1,
  getBusinessDayBounds: () => ({
    start: new Date(Date.now() - 3_600_000),
    endExclusive: new Date(Date.now() + 86_400_000),
  }),
  isWithinBookingWindow: () => true,
}));

const { POST } = await import("@/app/api/public/business/[slug]/bookings/route");

function table(name: string): Array<Record<string, any>> {
  if (!state.tables[name]) state.tables[name] = [];
  return state.tables[name];
}

const START_AT = new Date(Date.now() + 3_600_000).toISOString();

function bookingRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("https://bookora.test/api/public/business/sample-barber/bookings", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.1" },
    body: JSON.stringify(body),
  });
}

function baseBody(overrides: Record<string, unknown> = {}) {
  return {
    serviceId: "svc-1",
    startAt: START_AT,
    customerName: "Real Customer",
    customerPhone: "+1 555 0100",
    ...overrides,
  };
}

beforeEach(() => {
  for (const key of Object.keys(state.tables)) delete state.tables[key];
  state.admin = false;
  state.notified = [];
  state.funnel = [];
  state.attributionCalls = [];
  state.txQueries = [];
  state.slotTime = new Date(START_AT).getTime();

  table("business").push({
    id: "biz-1",
    slug: "sample-barber",
    name: "Sample Barber",
    status: "ACTIVE",
    currency: "USD",
    timezone: "Asia/Tehran",
    ownerId: "owner-1",
    owner: { telegramId: "999" },
  });
  table("service").push({
    id: "svc-1",
    businessId: "biz-1",
    name: "Haircut",
    active: true,
    durationMinutes: 30,
    slotIntervalMinutes: 30,
    price: "25.00",
    depositType: "NONE",
    depositValue: "0",
  });
  table("workingHour").push({
    id: "wh-1",
    businessId: "biz-1",
    dayOfWeek: 1,
    enabled: true,
    openTime: "09:00",
    closeTime: "19:00",
    breakStart: null,
    breakEnd: null,
  });
  table("outreachProspect").push({
    id: "p-1",
    dedupeKey: "name:sample",
    status: "REGISTERED",
    convertedBusinessId: "biz-1",
    verificationStatus: "VERIFIED",
    optedOutAt: null,
  });
});

describe("an unauthenticated caller", () => {
  it("cannot create a test booking by asking for one", async () => {
    const response = await POST(
      bookingRequest(baseBody({ isTestBooking: true })),
      { params: Promise.resolve({ slug: "sample-barber" }) }
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: expect.stringMatching(/administrator/i),
    });
    expect(table("booking")).toHaveLength(0);
    expect(state.attributionCalls).toHaveLength(0);
    expect(state.funnel).toHaveLength(0);
  });

  it("still books normally, which is a genuine conversion", async () => {
    const response = await POST(bookingRequest(baseBody()), {
      params: Promise.resolve({ slug: "sample-barber" }),
    });

    expect(response.status).toBe(201);
    const [booking] = table("booking");
    expect(booking.isTestBooking).toBe(false);
    expect(booking.status).toBe("CONFIRMED");
    // Genuine behaviour is unchanged: attribution, funnel and owner notice.
    expect(state.attributionCalls).toEqual([{ businessId: "biz-1", bookingId: booking.id }]);
    expect(state.funnel).toEqual([{ event: "booking_created" }]);
    expect(state.notified).toHaveLength(1);
    expect(state.notified[0].text).toMatch(/رزرو جدید/);
    // The schedule is still locked before any slot check.
    expect(state.txQueries).toContain("lock:biz-1");
  });
});

describe("an administrator", () => {
  beforeEach(() => {
    state.admin = true;
  });

  it("can create a test booking, and it activates nothing and counts nowhere", async () => {
    const response = await POST(
      bookingRequest(baseBody({ isTestBooking: true })),
      { params: Promise.resolve({ slug: "sample-barber" }) }
    );

    expect(response.status).toBe(201);
    const [booking] = table("booking");
    expect(booking.isTestBooking).toBe(true);
    // The pilot conversion path is untouched.
    expect(state.attributionCalls).toHaveLength(0);
    expect(state.funnel).toHaveLength(0);
    expect(table("outreachProspect")[0].status).toBe("REGISTERED");
    expect(table("outreachProspect")[0].activatedAt).toBeUndefined();
    // The owner is not told a test booking is a new customer booking.
    expect(state.notified).toHaveLength(1);
    expect(state.notified[0].text).toMatch(/TEST|آزمایشی/);
  });

  it("still creates genuine bookings when the flag is not set", async () => {
    const response = await POST(bookingRequest(baseBody()), {
      params: Promise.resolve({ slug: "sample-barber" }),
    });

    expect(response.status).toBe(201);
    const [booking] = table("booking");
    expect(booking.isTestBooking).toBe(false);
    expect(state.attributionCalls).toEqual([{ businessId: "biz-1", bookingId: booking.id }]);
    expect(state.funnel).toEqual([{ event: "booking_created" }]);
  });
});

describe("conversion counting", () => {
  it("ignores test bookings when counting a business's first bookings", async () => {
    // The real attribution module, not the spy used elsewhere in this file.
    vi.doUnmock("@/lib/outreach/attribution");
    vi.resetModules();
    const real = await import("@/lib/outreach/attribution");

    table("outreachProspect").length = 0;
    table("outreachProspect").push({
      id: "p-2",
      dedupeKey: "name:sample2",
      status: "ACTIVATED",
      convertedBusinessId: "biz-1",
      activatedAt: new Date(),
      verificationStatus: "VERIFIED",
      optedOutAt: null,
    });
    table("booking").push(
      {
        id: "b-real",
        businessId: "biz-1",
        isTestBooking: false,
        createdAt: new Date(),
        startAt: new Date(),
        endAt: new Date(),
        status: "CONFIRMED",
        customerName: "Real",
        customerPhone: "1",
        servicePrice: "1",
        finalPrice: "1",
        depositDue: "0",
        remainingAmount: "0",
        currency: "USD",
        paymentStatus: "NOT_REQUIRED",
        serviceId: "svc-1",
        timezone: "Asia/Tehran",
        depositType: "NONE",
        depositValue: "0",
      },
      {
        id: "b-test",
        businessId: "biz-1",
        isTestBooking: true,
        createdAt: new Date(),
        startAt: new Date(),
        endAt: new Date(),
        status: "CONFIRMED",
        customerName: "Test",
        customerPhone: "1",
        servicePrice: "1",
        finalPrice: "1",
        depositDue: "0",
        remainingAmount: "0",
        currency: "USD",
        paymentStatus: "NOT_REQUIRED",
        serviceId: "svc-1",
        timezone: "Asia/Tehran",
        depositType: "NONE",
        depositValue: "0",
      }
    );

    const counts = await real.getConversionCounts(new Date(Date.now() - 86_400_000));

    expect(counts.firstBookings).toBe(1);
  });
});
