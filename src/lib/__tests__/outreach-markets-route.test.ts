import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  AUTO_APPROVED_INTERNATIONAL_CITY_CODES,
  DEFAULT_APPROVED_CITIES,
  INTERNATIONAL_TELEGRAM_CANDIDATE_CODES,
} from "@/lib/outreach/city-registry";
import { PUT as putMarketsRoute } from "@/app/api/admin/outreach/markets/route";

const mocks = vi.hoisted(() => {
  const state = {
    authMode: "admin" as "admin" | "anonymous" | "non-admin",
    settings: new Map<string, string>(),
    auditEvents: [] as Array<Record<string, unknown>>,
    auditFails: false,
    rateLimited: false,
  };

  const functions = {
    findMany: vi.fn(async ({ where }: { where?: { key?: { in?: string[] } } }) => {
      const keys = where?.key?.in;
      return [...state.settings.entries()]
        .filter(([key]) => !keys || keys.includes(key))
        .map(([key, value]) => ({ key, value }));
    }),
    upsert: vi.fn(async (args: {
      where: { key: string };
      update: { value: string };
      create: { key: string; value: string };
    }) => {
      const value = state.settings.has(args.where.key)
        ? args.update.value
        : args.create.value;
      state.settings.set(args.where.key, value);
      return { key: args.where.key, value };
    }),
    recordAuditEvent: vi.fn(async (event: Record<string, unknown>) => {
      if (state.auditFails) throw new Error("audit unavailable");
      state.auditEvents.push(event);
      return event;
    }),
    requireAdmin: vi.fn(async () => {
      if (state.authMode === "admin") {
        return { ok: true as const, user: { id: "admin-1" } };
      }
      const status = state.authMode === "non-admin" ? 403 : 401;
      return {
        ok: false as const,
        response: new Response(JSON.stringify({ error: "Unauthorized" }), { status }),
      };
    }),
    isRateLimited: vi.fn(async () => state.rateLimited),
    triggerRateLimitCleanup: vi.fn(),
    transaction: vi.fn(async (callback: (tx: any) => Promise<unknown>) => {
      const oldSettings = new Map(state.settings);
      const oldAuditEvents = [...state.auditEvents];
      const tx = { adminSetting: { upsert: functions.upsert } };
      try {
        return await callback(tx);
      } catch (error) {
        state.settings.clear();
        for (const [key, value] of oldSettings) state.settings.set(key, value);
        state.auditEvents.splice(0, state.auditEvents.length, ...oldAuditEvents);
        throw error;
      }
    }),
  };
  return { state, functions };
});

vi.mock("@/lib/auth/admin-api", () => ({
  requireAdmin: mocks.functions.requireAdmin,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    adminSetting: { findMany: mocks.functions.findMany },
    $transaction: mocks.functions.transaction,
  },
}));

vi.mock("@/lib/outreach/audit", () => ({
  AuditUnavailableError: class AuditUnavailableError extends Error {},
  recordAuditEvent: mocks.functions.recordAuditEvent,
}));

vi.mock("@/lib/rate-limit", () => ({
  isRateLimited: mocks.functions.isRateLimited,
  triggerRateLimitCleanup: mocks.functions.triggerRateLimitCleanup,
}));

function request(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/admin/outreach/markets", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mocks.state.authMode = "admin";
  mocks.state.settings.clear();
  mocks.state.auditEvents.length = 0;
  mocks.state.auditFails = false;
  mocks.state.rateLimited = false;
  vi.clearAllMocks();
});

describe("market approval API", () => {
  it.each(
    INTERNATIONAL_TELEGRAM_CANDIDATE_CODES.filter(
      (code) => !AUTO_APPROVED_INTERNATIONAL_CITY_CODES.includes(code)
    )
  )("keeps non-localized market %s dormant until its language is supported", async (code) => {
    const response = await putMarketsRoute(request({ code, approved: true }));
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.error).toBe("market_language_unsupported");
    expect(payload.city).toBe(code);
    expect(payload.requiredLanguages.length).toBeGreaterThan(0);
    expect(payload.supportedLanguages).toEqual(["en", "fa", "ar"]);
    expect(mocks.state.settings.size).toBe(0);
    expect(mocks.state.auditEvents).toHaveLength(0);
    expect(mocks.functions.transaction).not.toHaveBeenCalled();
  });

  it("normalizes a market code when pausing an auto-ready global city", async () => {
    const response = await putMarketsRoute(request({ code: "  dubai ", approved: false }));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.approved).not.toContain("DUBAI");
    expect(mocks.state.settings.get("outreach.cities_disabled")).toBe("DUBAI");
  });

  it("ignores stale or corrupt saved codes while preserving valid approvals", async () => {
    mocks.state.settings.set("outreach.cities_enabled", "ISTANBUL,ISFAHAN,NOT_A_REGISTERED_CITY");
    mocks.state.settings.set("outreach.cities_disabled", "UNKNOWN_DISABLED_CODE");

    const response = await putMarketsRoute(request({ code: "TEHRAN", approved: true }));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.approved).not.toContain("ISTANBUL");
    expect(payload.approved).toContain("ISFAHAN");
    expect(payload.approved).toContain("TABRIZ");
    expect(payload.approved).not.toContain("NOT_A_REGISTERED_CITY");
    expect(payload.approved).not.toContain("UNKNOWN_DISABLED_CODE");
    expect(mocks.state.settings.get("outreach.cities_enabled")).toBe("");
    expect(mocks.state.settings.get("outreach.cities_disabled")).toBe("");
  });

  it("keeps language-ready candidate markets active without an approval override", async () => {
    const response = await putMarketsRoute(request({ code: "TEHRAN", approved: true }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.approved).toEqual(DEFAULT_APPROVED_CITIES);
    expect(mocks.state.settings.get("outreach.cities_enabled")).toBe("");
    expect(mocks.state.settings.get("outreach.cities_disabled")).toBe("");
  });

  it("pauses one auto-ready global market without pausing the others", async () => {
    const response = await putMarketsRoute(request({ code: "DUBAI", approved: false }));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.approved).not.toContain("DUBAI");
    expect(payload.approved).toContain("CAIRO");
    expect(payload.approved).toContain("KARACHI");
    expect(mocks.state.settings.get("outreach.cities_enabled")).toBe("");
    expect(mocks.state.settings.get("outreach.cities_disabled")).toBe("DUBAI");
  });

  it("can disable and later restore a default launch market", async () => {
    const disabled = await putMarketsRoute(request({ code: "TEHRAN", approved: false }));
    expect(disabled.status).toBe(200);
    expect((await disabled.json()).approved).not.toContain("TEHRAN");
    expect(mocks.state.settings.get("outreach.cities_disabled")).toBe("TEHRAN");

    const restored = await putMarketsRoute(request({ code: "TEHRAN", approved: true }));
    expect(restored.status).toBe(200);
    expect((await restored.json()).approved).toContain("TEHRAN");
    expect(mocks.state.settings.get("outreach.cities_disabled")).toBe("");
  });

  it("rejects unknown codes and malformed payloads without writing settings or audit", async () => {
    const unknown = await putMarketsRoute(request({ code: "NOT_A_CITY", approved: true }));
    expect(unknown.status).toBe(400);

    const invalid = await putMarketsRoute(request({ code: "ISTANBUL", approved: "yes" }));
    expect(invalid.status).toBe(400);

    const missingCode = await putMarketsRoute(request({ approved: true }));
    expect(missingCode.status).toBe(400);

    expect(mocks.state.settings.size).toBe(0);
    expect(mocks.state.auditEvents).toHaveLength(0);
    expect(mocks.functions.transaction).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON without touching storage", async () => {
    const response = await putMarketsRoute(
      new NextRequest("http://localhost/api/admin/outreach/markets", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: "{",
      })
    );
    expect(response.status).toBe(400);
    expect(mocks.state.settings.size).toBe(0);
    expect(mocks.state.auditEvents).toHaveLength(0);
  });

  it.each([
    ["anonymous", 401],
    ["non-admin", 403],
  ] as const)("requires admin authorization (%s)", async (mode, expectedStatus) => {
    mocks.state.authMode = mode;
    const response = await putMarketsRoute(request({ code: "ISTANBUL", approved: true }));
    expect(response.status).toBe(expectedStatus);
    expect(mocks.functions.findMany).not.toHaveBeenCalled();
    expect(mocks.functions.transaction).not.toHaveBeenCalled();
    expect(mocks.state.settings.size).toBe(0);
  });

  it("does not write a successful approval when the audit write fails", async () => {
    mocks.state.auditFails = true;
    const response = await putMarketsRoute(request({ code: "ISFAHAN", approved: true }));
    expect(response.status).toBe(503);
    expect(mocks.state.settings.size).toBe(0);
    expect(mocks.state.auditEvents).toHaveLength(0);
  });

  it("enforces the rate limit before reading or changing approvals", async () => {
    mocks.state.rateLimited = true;
    const response = await putMarketsRoute(request({ code: "ISTANBUL", approved: true }));
    expect(response.status).toBe(429);
    expect(mocks.functions.findMany).not.toHaveBeenCalled();
    expect(mocks.functions.transaction).not.toHaveBeenCalled();
    expect(mocks.state.settings.size).toBe(0);
  });
});
