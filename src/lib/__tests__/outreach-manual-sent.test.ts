import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Critical fix F — safe manual-sent transitions.
 *
 * An administrator may attest that a human contacted a recipient outside the
 * application, but not by bypassing verification, do-not-contact, opt-out,
 * consent withdrawal, transition or kill-switch rules, and never without
 * evidence the application can store.
 */

const state = vi.hoisted(() => ({
  tables: {} as Record<string, Array<Record<string, any>>>,
  auditFail: false,
  authMode: "admin" as "admin" | "anonymous",
  seq: 0,
}));

vi.mock("@/lib/prisma", async () => {
  const { createPrismaDouble } = await import("./helpers/prisma-double");
  const prisma = createPrismaDouble(state);
  const original = (prisma as any).outreachAuditEvent;
  (prisma as any).outreachAuditEvent = {
    create: async ({ data }: any) => {
      if (state.auditFail) throw new Error("audit table missing");
      return original.create({ data });
    },
    findMany: async (args: any) => original.findMany(args),
    count: async (args: any) => original.count(args),
  };
  return { prisma };
});

vi.mock("@/lib/auth/admin-api", () => ({
  requireAdmin: async () =>
    state.authMode === "admin"
      ? { ok: true as const, user: { id: "admin-1", role: "PLATFORM_ADMIN" } }
      : {
          ok: false as const,
          response: new Response(JSON.stringify({ error: "forbidden" }), { status: 403 }),
        },
}));

vi.mock("@/lib/rate-limit", () => ({
  isRateLimited: async () => false,
  triggerRateLimitCleanup: () => undefined,
}));

vi.mock("@/lib/telegram/notify", () => ({
  deliverTelegramMessage: async () => ({ ok: true as const, messageId: 1 }),
  notifyUser: async () => undefined,
}));

const { PATCH } = await import("@/app/api/admin/outreach/invitations/[id]/route");
const { outreachSettingsRows } = await import("./helpers/outreach-settings");

function table(name: string): Array<Record<string, any>> {
  if (!state.tables[name]) state.tables[name] = [];
  return state.tables[name];
}

function seed(options: {
  invitationStatus?: string;
  prospect?: Record<string, any>;
  consent?: Record<string, any> | null;
  suppressions?: string[];
  settings?: Record<string, string>;
} = {}) {
  table("adminSetting").push(...outreachSettingsRows(options.settings));
  table("outreachProspect").push({
    id: "p-1",
    publicName: "Sample Barber",
    dedupeKey: "name:sample",
    verificationStatus: "VERIFIED",
    status: "NEW",
    telegramUsername: null,
    publicUrl: null,
    optedOutAt: null,
    contactedCount: 0,
    lastContactedAt: null,
    nextFollowUpAt: null,
    ...options.prospect,
  });
  table("outreachInvitation").push({
    id: "inv-1",
    prospectId: "p-1",
    campaignId: null,
    status: options.invitationStatus ?? "APPROVED",
    body: "hello",
    startParam: "p-inv1",
  });
  if (options.consent !== undefined && options.consent !== null) {
    table("telegramBotOptIn").push({ prospectId: "p-1", ...options.consent });
  }
  for (const identifier of options.suppressions ?? []) {
    table("outreachSuppression").push({ identifier });
  }
}

function request(body: Record<string, unknown>): NextRequest {
  return new NextRequest("https://admin.test/api/admin/outreach/invitations/inv-1", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function manualSent(extra: Record<string, unknown> = {}) {
  return PATCH(
    request({
      action: "mark_manual_sent",
      confirmedByOperator: true,
      evidence: "Called the shop on 2026-10-12, spoke to the owner.",
      ...extra,
    }),
    { params: Promise.resolve({ id: "inv-1" }) }
  );
}

beforeEach(() => {
  for (const key of Object.keys(state.tables)) delete state.tables[key];
  state.auditFail = false;
  state.authMode = "admin";
});

describe("an authorised, evidenced manual send", () => {
  it("records SENT — never DELIVERED — with the actor, the time and the evidence", async () => {
    seed();

    const response = await manualSent();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.manual).toBe(true);
    const [invitation] = table("outreachInvitation");
    expect(invitation.status).toBe("SENT");
    expect(invitation.sentAt).toBeInstanceOf(Date);
    // The application did not deliver anything, so deliveredAt stays empty.
    expect(invitation.deliveredAt ?? null).toBeNull();
    const [event] = table("outreachAuditEvent");
    expect(event).toMatchObject({
      action: "invitation.manual_sent",
      actorUserId: "admin-1",
      entityId: "inv-1",
    });
    expect(event.detail).toMatch(/channel=manual_attestation/);
    expect(event.detail).toMatch(/evidence=Called the shop/);
    expect(event.createdAt).toBeInstanceOf(Date);
    // The prospect is marked contacted for the follow-up cadence.
    expect(table("outreachProspect")[0].status).toBe("CONTACTED");
    expect(table("outreachProspect")[0].contactedCount).toBe(1);
  });

  it("is allowed for a recipient who never started the bot, because a call is not a Telegram message", async () => {
    seed({ consent: null });

    const response = await manualSent();

    expect(response.status).toBe(200);
    expect(table("outreachInvitation")[0].status).toBe("SENT");
    expect(table("outreachAuditEvent")[0].detail).toMatch(/consent=MANUAL_ONLY/);
  });
});

describe("rejected transitions", () => {
  it("refuses a DRAFT invitation", async () => {
    seed({ invitationStatus: "DRAFT" });

    const response = await manualSent();

    expect(response.status).toBe(409);
    expect(table("outreachInvitation")[0].status).toBe("DRAFT");
  });

  it("refuses a second recording of the same send", async () => {
    seed({ invitationStatus: "SENT" });

    const response = await manualSent();

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: expect.stringMatching(/only once/i),
    });
  });

  it("refuses a rejected invitation", async () => {
    seed({ invitationStatus: "REJECTED" });

    expect((await manualSent()).status).toBe(409);
  });

  it("refuses a delivered invitation", async () => {
    seed({ invitationStatus: "DELIVERED" });

    expect((await manualSent()).status).toBe(409);
  });

  it("refuses without an explicit operator confirmation", async () => {
    seed();

    const response = await PATCH(
      request({ action: "mark_manual_sent", evidence: "Called them." }),
      { params: Promise.resolve({ id: "inv-1" }) }
    );

    expect(response.status).toBe(409);
    expect(table("outreachInvitation")[0].status).toBe("APPROVED");
  });

  it("refuses a confirmation with no evidence of the contact", async () => {
    seed();

    const response = await PATCH(
      request({ action: "mark_manual_sent", confirmedByOperator: true }),
      { params: Promise.resolve({ id: "inv-1" }) }
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: expect.stringMatching(/evidence/i),
    });
    expect(table("outreachInvitation")[0].status).toBe("APPROVED");
    expect(table("outreachAuditEvent")).toHaveLength(0);
  });

  it("refuses a non-administrator", async () => {
    seed();
    state.authMode = "anonymous";

    const response = await manualSent();

    expect(response.status).toBe(403);
    expect(table("outreachInvitation")[0].status).toBe("APPROVED");
  });
});

describe("policy gates still apply", () => {
  it("refuses an unverified prospect", async () => {
    seed({ prospect: { verificationStatus: "DISCOVERED" } });

    const response = await manualSent();

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ reason: "not_verified" });
    expect(table("outreachInvitation")[0].status).toBe("APPROVED");
    expect(table("outreachAuditEvent")).toHaveLength(0);
  });

  it("refuses a suppressed contact", async () => {
    seed({ prospect: { publicUrl: "https://instagram.com/blocked" }, suppressions: ["url:instagram.com/blocked"] });

    const response = await manualSent();

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ reason: "suppressed" });
  });

  it("refuses an opted-out prospect", async () => {
    seed({ prospect: { optedOutAt: new Date() } });

    expect((await manualSent()).status).toBe(409);
  });

  it("refuses a recipient who withdrew consent", async () => {
    seed({
      consent: {
        telegramId: "555001",
        startedAt: new Date(Date.now() - 86_400_000),
        revokedAt: new Date(),
      },
    });

    const response = await manualSent();

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ reason: "consent_revoked" });
  });

  it("refuses while outreach is switched off", async () => {
    seed({ settings: { "outreach.enabled": "false" } });

    const response = await manualSent();

    expect(response.status).toBe(409);
    expect(table("outreachInvitation")[0].status).toBe("APPROVED");
  });
});

describe("the audit trail is required", () => {
  it("does not record the send when its audit event cannot be written", async () => {
    seed();
    state.auditFail = true;

    const response = await manualSent();

    expect(response.status).toBe(503);
    expect(table("outreachInvitation")[0].status).toBe("APPROVED");
    expect(table("outreachProspect")[0].status).toBe("NEW");
  });
});
