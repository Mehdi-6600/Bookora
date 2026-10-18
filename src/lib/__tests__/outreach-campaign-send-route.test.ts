import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
  result: {} as
    | { ok: true; sent: number; delivered: number; failed: number; skipped: number; rateLimited: boolean }
    | { ok: false; error: string; rateLimited?: boolean },
  cooldownUntil: null as number | null,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    outreachCampaign: {
      findUnique: async () => ({ id: "cmp-1", status: "APPROVED", sendLimit: 5 }),
    },
  },
}));

vi.mock("@/lib/auth/admin-api", () => ({
  requireAdmin: async () => ({ ok: true, user: { id: "admin-1" } }),
}));

vi.mock("@/lib/rate-limit", () => ({
  isRateLimited: async () => false,
  triggerRateLimitCleanup: () => undefined,
}));

vi.mock("@/lib/outreach/campaigns", () => ({
  sendCampaignInvitations: async () => state.result,
}));

vi.mock("@/lib/outreach/settings", () => ({
  getOutreachSettings: async () => ({
    dailyInvitationLimit: 10,
    telegramCooldownUntil: state.cooldownUntil,
  }),
}));

import { POST } from "@/app/api/admin/outreach/campaigns/[id]/send/route";

function request() {
  return new NextRequest("https://bookora.test/api/admin/outreach/campaigns/cmp-1/send", {
    method: "POST",
  });
}

function params() {
  return { params: Promise.resolve({ id: "cmp-1" }) };
}

beforeEach(() => {
  state.result = { ok: true, sent: 0, delivered: 0, failed: 0, skipped: 0, rateLimited: false };
  state.cooldownUntil = null;
});

describe("campaign send endpoint rate-limit reporting", () => {
  it("returns HTTP 429 and Retry-After while the Telegram cooldown is active", async () => {
    state.cooldownUntil = Date.now() + 30_000;
    state.result = {
      ok: false,
      error: "Telegram rate-limit cooldown is active.",
      rateLimited: true,
    };

    const response = await POST(request(), params());
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(body).toMatchObject({ rateLimited: true, retryAfterSeconds: expect.any(Number) });
  });

  it("keeps unrelated campaign errors as ordinary client errors", async () => {
    state.result = { ok: false, error: "Campaign must be APPROVED before sending." };

    const response = await POST(request(), params());
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.rateLimited).toBeUndefined();
  });

  it("returns a successful 429-aware campaign result unchanged", async () => {
    state.result = { ok: true, sent: 0, delivered: 0, failed: 1, skipped: 2, rateLimited: true };

    const response = await POST(request(), params());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.rateLimited).toBe(true);
  });
});
