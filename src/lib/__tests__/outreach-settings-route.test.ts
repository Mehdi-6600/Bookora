import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  GET as getOutreachSettingsRoute,
  PUT as putOutreachSettingsRoute,
} from "@/app/api/admin/outreach/settings/route";

const mocks = vi.hoisted(() => {
  const state = {
    authMode: "admin" as "admin" | "anonymous" | "non-admin",
    settings: new Map<string, string>(),
    auditEvents: [] as Array<Record<string, unknown>>,
  };

  const functions = {
    requireAdmin: vi.fn(async () => {
      if (state.authMode === "admin") {
        return { ok: true as const, user: { id: "admin-1" } };
      }

      const status = state.authMode === "non-admin" ? 403 : 401;
      return {
        ok: false as const,
        response: new Response(
          JSON.stringify({ error: status === 401 ? "Unauthorized" : "Forbidden" }),
          { status, headers: { "content-type": "application/json" } }
        ),
      };
    }),
    findMany: vi.fn(async ({ where }: { where?: { key?: { in?: string[] } } }) => {
      const keys = where?.key?.in;
      return [...state.settings.entries()]
        .filter(([key]) => !keys || keys.includes(key))
        .map(([key, value]) => ({ key, value }));
    }),
    upsert: vi.fn(
      async (args: {
        where: { key: string };
        update: { value: string };
        create: { key: string; value: string };
      }) => {
        const value = state.settings.has(args.where.key)
          ? args.update.value
          : args.create.value;
        state.settings.set(args.where.key, value);
        return { key: args.where.key, value };
      }
    ),
    createAuditEvent: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      state.auditEvents.push(data);
      return data;
    }),
    isRateLimited: vi.fn(async () => false),
    triggerRateLimitCleanup: vi.fn(),
  };

  return { state, functions };
});

vi.mock("@/lib/auth/admin-api", () => ({
  requireAdmin: mocks.functions.requireAdmin,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    adminSetting: {
      findMany: mocks.functions.findMany,
      upsert: mocks.functions.upsert,
    },
    outreachAuditEvent: {
      create: mocks.functions.createAuditEvent,
    },
  },
}));

vi.mock("@/lib/rate-limit", () => ({
  isRateLimited: mocks.functions.isRateLimited,
  triggerRateLimitCleanup: mocks.functions.triggerRateLimitCleanup,
}));

const OFFICIAL_CHANNEL_URL = "https://t.me/spell0000";

function putRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/admin/outreach/settings", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mocks.state.authMode = "admin";
  mocks.state.settings.clear();
  mocks.state.auditEvents.length = 0;
  vi.clearAllMocks();
});

describe("admin outreach settings API", () => {
  it("requires authorized admin access before reading or writing settings", async () => {
    mocks.state.authMode = "anonymous";
    const unauthenticatedRead = await getOutreachSettingsRoute();
    expect(unauthenticatedRead.status).toBe(401);

    mocks.state.authMode = "non-admin";
    const forbiddenWrite = await putOutreachSettingsRoute(
      putRequest({ "outreach.channel_url": OFFICIAL_CHANNEL_URL })
    );
    expect(forbiddenWrite.status).toBe(403);
    expect(mocks.state.settings.size).toBe(0);
    expect(mocks.functions.upsert).not.toHaveBeenCalled();
  });

  it("persists and reads back the exact owner-confirmed URL through the API", async () => {
    const saveResponse = await putOutreachSettingsRoute(
      putRequest({ "outreach.channel_url": OFFICIAL_CHANNEL_URL })
    );
    expect(saveResponse.status).toBe(200);
    expect(mocks.state.settings.get("outreach.channel_url")).toBe(OFFICIAL_CHANNEL_URL);

    const savePayload = await saveResponse.json();
    expect(savePayload.settings.channelUrl).toBe(OFFICIAL_CHANNEL_URL);

    const readResponse = await getOutreachSettingsRoute();
    const readPayload = await readResponse.json();
    expect(readResponse.status).toBe(200);
    expect(readPayload.settings.channelUrl).toBe(OFFICIAL_CHANNEL_URL);

    expect(mocks.state.auditEvents).toHaveLength(1);
    expect(mocks.state.auditEvents[0]).toMatchObject({
      scope: "settings",
      action: "settings.channel_url_changed",
      actorUserId: "admin-1",
      detail: "keys=outreach.channel_url",
    });
    expect(mocks.state.auditEvents[0].detail).not.toContain(OFFICIAL_CHANNEL_URL);
  });

  it("rejects non-HTTPS URLs without replacing an existing valid setting", async () => {
    mocks.state.settings.set("outreach.channel_url", OFFICIAL_CHANNEL_URL);

    const response = await putOutreachSettingsRoute(
      putRequest({ "outreach.channel_url": "http://t.me/spell0000" })
    );

    expect(response.status).toBe(400);
    expect(mocks.state.settings.get("outreach.channel_url")).toBe(OFFICIAL_CHANNEL_URL);
    expect(mocks.state.auditEvents).toHaveLength(0);
  });
});
