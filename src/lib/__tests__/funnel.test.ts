import { beforeEach, describe, expect, it, vi } from "vitest";

// These suites use a tiny in-memory delegate; no database is touched.
const state = vi.hoisted(() => ({ records: [] as Array<Record<string, any>> }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    funnelEvent: {
      create: async (args: any) => {
        state.records.push(args.data);
        return args.data;
      },
    },
  },
}));

import {
  buildAnonId,
  recordSystemPaidConversion,
  FUNNEL_EVENTS,
  FUNNEL_STEP_LABELS,
  isFunnelEvent,
} from "@/lib/funnel";

describe("funnel event vocabulary", () => {
  it("contains exactly the eleven documented activation milestones in order", () => {
    expect(FUNNEL_EVENTS).toEqual([
      "landing_view", // 1
      "campaign_view", // 2
      "signup_cta_click", // 3
      "signup_started", // 4
      "registration_completed", // 5
      "business_created", // 6
      "service_created", // 7
      "working_hours_configured", // 8
      "booking_link_opened", // 9
      "booking_created", // 10
      "paid_conversion", // 11
    ]);
  });

  it("has a label for every step", () => {
    for (const event of FUNNEL_EVENTS) {
      expect(FUNNEL_STEP_LABELS[event].en.length).toBeGreaterThan(0);
      expect(FUNNEL_STEP_LABELS[event].fa.length).toBeGreaterThan(0);
    }
  });

  it("rejects unknown events", () => {
    expect(isFunnelEvent("landing_view")).toBe(true);
    expect(isFunnelEvent("password_reset")).toBe(false);
    expect(isFunnelEvent("")).toBe(false);
    expect(isFunnelEvent(42)).toBe(false);
  });
});

describe("server-side paid conversion tracking", () => {
  beforeEach(() => {
    state.records.length = 0;
  });

  it("stores an un-linkable anonymous event and the resolved campaign id", async () => {
    const now = new Date("2026-10-18T12:00:00.000Z");
    await recordSystemPaidConversion({ campaignId: "campaign-1", now });

    expect(state.records).toHaveLength(1);
    expect(state.records[0]).toMatchObject({
      event: "paid_conversion",
      campaignId: "campaign-1",
      createdAt: now,
      locale: null,
      ref: null,
    });
    expect(state.records[0].anonId).toMatch(/^[0-9a-f]{32}$/);
    expect(state.records[0]).not.toHaveProperty("userId");
    expect(state.records[0]).not.toHaveProperty("telegramId");
  });
});

describe("anonymous visitor id", () => {
  it("is a hex digest that never contains the raw ip", () => {
    const anonId = buildAnonId({
      ip: "203.0.113.42",
      userAgent: "Mozilla/5.0",
      date: "2026-10-10",
    });

    expect(anonId).toMatch(/^[0-9a-f]{32}$/);
    expect(anonId).not.toContain("203.0.113.42");
  });

  it("is stable within a day and rotates across days", () => {
    const input = { ip: "203.0.113.42", userAgent: "Mozilla/5.0", date: "2026-10-10" };
    const nextDay = { ...input, date: "2026-10-11" };

    expect(buildAnonId(input)).toBe(buildAnonId(input));
    expect(buildAnonId(input)).not.toBe(buildAnonId(nextDay));
  });

  it("separates different visitors on the same day", () => {
    const a = buildAnonId({ ip: "203.0.113.42", userAgent: "A", date: "2026-10-10" });
    const b = buildAnonId({ ip: "198.51.100.7", userAgent: "A", date: "2026-10-10" });

    expect(a).not.toBe(b);
  });
});
