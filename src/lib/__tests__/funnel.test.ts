import { describe, expect, it, vi } from "vitest";

// These suites cover pure logic only; keep them runnable without a database.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import {
  buildAnonId,
  FUNNEL_EVENTS,
  FUNNEL_STEP_LABELS,
  isFunnelEvent,
} from "@/lib/funnel";

describe("funnel event vocabulary", () => {
  it("contains exactly the nine documented acquisition steps in order", () => {
    expect(FUNNEL_EVENTS).toEqual([
      "landing_view",
      "start_click",
      "mini_app_launch",
      "auth_success",
      "business_created",
      "service_created",
      "working_hours_configured",
      "booking_link_opened",
      "booking_created",
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
