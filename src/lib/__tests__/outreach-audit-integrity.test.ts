import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Critical fix D — reliable, visible audit records.
 *
 * A required audit write that fails must fail the operation (not be swallowed),
 * and an audit read failure must reach the administrator as an error rather
 * than as an empty log.
 */

const state = vi.hoisted(() => ({
  tables: {} as Record<string, Array<Record<string, any>>>,
  auditWriteFails: false,
  auditReadFails: false,
  seq: 0,
}));

vi.mock("@/lib/prisma", async () => {
  const { createPrismaDouble } = await import("./helpers/prisma-double");
  const prisma = createPrismaDouble(state);
  const original = (prisma as any).outreachAuditEvent;
  (prisma as any).outreachAuditEvent = {
    create: async ({ data }: any) => {
      if (state.auditWriteFails) throw new Error("audit table missing");
      return original.create({ data });
    },
    findMany: async (args: any) => {
      if (state.auditReadFails) throw new Error("audit read failed");
      return original.findMany(args);
    },
    count: async (args: any) => {
      if (state.auditReadFails) throw new Error("audit read failed");
      return original.count(args);
    },
  };
  return { prisma };
});

vi.mock("@/lib/auth/session", () => ({
  requirePlatformAdmin: async () => ({ id: "admin-1", role: "PLATFORM_ADMIN" }),
  requireAdmin: async () => ({ id: "admin-1", role: "PLATFORM_ADMIN" }),
}));
vi.mock("@/lib/auth/admin-api", () => ({
  requireAdmin: async () => ({ ok: true as const, user: { id: "admin-1", role: "PLATFORM_ADMIN" } }),
}));

const { recordAuditEvent, AuditUnavailableError } = await import("@/lib/outreach/audit");
const { approveCampaignInvitations } = await import("@/lib/outreach/campaigns");
const { sendApprovedInvitations } = await import("@/lib/outreach/invitations");
const { outreachSettingsRows } = await import("./helpers/outreach-settings");

function table(name: string): Array<Record<string, any>> {
  if (!state.tables[name]) state.tables[name] = [];
  return state.tables[name];
}

function seedEligible() {
  table("adminSetting").push(...outreachSettingsRows());
  table("outreachProspect").push({
    id: "p-1",
    publicName: "Sample Barber",
    dedupeKey: "name:sample",
    verificationStatus: "VERIFIED",
    status: "NEW",
    optedOutAt: null,
  });
  table("telegramBotOptIn").push({
    telegramId: "555001",
    prospectId: "p-1",
    startedAt: new Date(),
    revokedAt: null,
  });
}

beforeEach(() => {
  for (const key of Object.keys(state.tables)) delete state.tables[key];
  state.auditWriteFails = false;
  state.auditReadFails = false;
});

describe("writing audit events", () => {
  it("persists the actor, the action and the entity", async () => {
    await recordAuditEvent({
      scope: "invitation",
      entityId: "inv-1",
      action: "invitation.approved",
      actorUserId: "admin-1",
      detail: "campaignId=cmp-1",
    });

    const [event] = table("outreachAuditEvent");
    expect(event).toMatchObject({
      scope: "invitation",
      entityId: "inv-1",
      action: "invitation.approved",
      actorUserId: "admin-1",
    });
    expect(event.createdAt).toBeInstanceOf(Date);
  });

  it("throws instead of silently losing a required event", async () => {
    state.auditWriteFails = true;

    await expect(
      recordAuditEvent({ scope: "invitation", entityId: "inv-1", action: "invitation.approved" })
    ).rejects.toBeInstanceOf(AuditUnavailableError);
    expect(table("outreachAuditEvent")).toHaveLength(0);
  });

  it("keeps secrets and personal data out of the stored detail", async () => {
    await recordAuditEvent({
      scope: "settings",
      entityId: "outreach.enabled",
      action: "settings.updated",
      detail: "telegramBotToken=1234:secret WEBHOOK_SECRET=abc phone=+989123456789",
    });

    const [event] = table("outreachAuditEvent");
    expect(event.detail).not.toMatch(/1234:secret/);
    expect(event.detail).not.toMatch(/=abc/);
    expect(event.detail).not.toMatch(/\+989123456789/);
    expect(event.detail).toMatch(/REDACTED/);
  });
});

describe("state changes are atomic with their audit event", () => {
  beforeEach(() => {
    seedEligible();
    table("outreachCampaign").push({
      id: "cmp-1",
      code: "cmp_test",
      name: "Pilot",
      status: "APPROVED",
      cities: ["TEHRAN"],
      segments: ["MENS_BARBER"],
      language: "en",
      objective: null,
      templateId: null,
      cta: null,
      destinationUrl: null,
      followUpPolicy: "ONE_FOLLOWUP",
      channel: "TELEGRAM_BOT",
      sendLimit: null,
      lastDryRunAt: new Date(),
    });
    table("outreachInvitation").push({
      id: "inv-1",
      prospectId: "p-1",
      campaignId: "cmp-1",
      status: "DRAFT",
      body: "hello",
      startParam: "p-inv1",
    });
  });

  it("rolls the approval back when its audit event cannot be written", async () => {
    state.auditWriteFails = true;

    await expect(approveCampaignInvitations("cmp-1", "admin-1")).rejects.toThrow();

    expect(table("outreachInvitation")[0].status).toBe("DRAFT");
  });

  it("keeps the delivery record and its audit event together", async () => {
    table("outreachInvitation")[0].status = "APPROVED";
    state.auditWriteFails = true;

    await expect(sendApprovedInvitations({ limit: 5 })).rejects.toBeInstanceOf(
      AuditUnavailableError
    );
    // No message was marked sent without a matching audit trail.
    expect(table("outreachInvitation")[0].status).toBe("APPROVED");
  });
});

describe("reading audit events", () => {
  it("reports a read failure as a 503 instead of an empty log", async () => {
    const { GET } = await import("@/app/api/admin/outreach/campaigns/[id]/route");
    const { NextRequest } = await import("next/server");
    seedEligible();
    table("outreachCampaign").push({
      id: "cmp-1",
      code: "cmp_test",
      name: "Pilot",
      status: "APPROVED",
      cities: ["TEHRAN"],
      segments: ["MENS_BARBER"],
      language: "en",
      objective: null,
      templateId: null,
      cta: null,
      destinationUrl: null,
      followUpPolicy: "ONE_FOLLOWUP",
      channel: "TELEGRAM_BOT",
      sendLimit: null,
      lastDryRunAt: new Date(),
    });
    state.auditReadFails = true;

    const response = await GET(new NextRequest("https://admin.test"), {
      params: Promise.resolve({ id: "cmp-1" }),
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: expect.stringMatching(/audit/i),
    });
  });
});
