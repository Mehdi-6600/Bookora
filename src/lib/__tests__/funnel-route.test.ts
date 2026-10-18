import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
  campaigns: new Map([["tehran-barbers", "cmp-1"]]),
  events: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    outreachCampaign: {
      findUnique: async ({ where }: any) => {
        const id = state.campaigns.get(where.code);
        return id ? { id } : null;
      },
    },
  },
}));

vi.mock("@/lib/funnel", () => ({
  isFunnelEvent: (value: unknown) =>
    [
      "landing_view",
      "campaign_view",
      "signup_cta_click",
      "signup_started",
      "registration_completed",
      "business_created",
      "service_created",
      "working_hours_configured",
      "booking_link_opened",
      "booking_created",
      "paid_conversion",
    ].includes(String(value)),
  recordFunnelEvent: async (event: Record<string, unknown>) => {
    state.events.push(event);
  },
}));

vi.mock("@/lib/get-client-ip", () => ({ getClientIp: () => "203.0.113.10" }));
vi.mock("@/lib/rate-limit", () => ({
  isRateLimited: async () => false,
  triggerRateLimitCleanup: () => undefined,
}));

import { POST } from "@/app/api/funnel/route";

function request(body: unknown) {
  return new NextRequest("https://bookora.test/api/funnel", {
    method: "POST",
    headers: { "Content-Type": "application/json", "user-agent": "test-agent" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  state.events.length = 0;
});

describe("campaign funnel attribution", () => {
  it("resolves a real campaign code to its internal id", async () => {
    const response = await POST(
      request({ event: "campaign_view", locale: "fa", ref: "tehran-barbers" })
    );

    expect(response.status).toBe(202);
    expect(state.events).toHaveLength(1);
    expect(state.events[0]).toMatchObject({
      event: "campaign_view",
      ref: "tehran-barbers",
      campaignId: "cmp-1",
    });
  });

  it("does not count an unknown code as a campaign view", async () => {
    const response = await POST(
      request({ event: "campaign_view", locale: "fa", ref: "not-a-campaign" })
    );

    expect(response.status).toBe(202);
    expect(state.events).toHaveLength(0);
  });

  it("keeps ordinary funnel events even when the ref is not a campaign", async () => {
    await POST(request({ event: "landing_view", locale: "fa", ref: "external-source" }));

    expect(state.events).toHaveLength(1);
    expect(state.events[0]).toMatchObject({
      event: "landing_view",
      campaignId: null,
      ref: "external-source",
    });
  });
});
