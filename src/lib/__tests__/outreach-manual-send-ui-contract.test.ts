import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * The evidence prompt and the server must agree (critical fixes F and H).
 *
 * PR #14 shipped a server that requires `evidence` (3–500 characters) plus the
 * literal `confirmedByOperator: true` for `mark_manual_sent`, while the panel
 * still posted the action without evidence — a guaranteed 400 in the operator's
 * face. This suite ties the UI helper to the real route: the payload the dialog
 * builds is the payload the server accepts, and the constraints the dialog
 * mirrors are still enforced server-side (the UI never becomes the check).
 */

const state = vi.hoisted(() => ({
  tables: {} as Record<string, Array<Record<string, any>>>,
  seq: 0,
}));

vi.mock("@/lib/prisma", async () => {
  const { createPrismaDouble } = await import("./helpers/prisma-double");
  return { prisma: createPrismaDouble(state) };
});

vi.mock("@/lib/auth/admin-api", () => ({
  requireAdmin: async () => ({
    ok: true as const,
    user: { id: "admin-1", role: "PLATFORM_ADMIN" },
  }),
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
const {
  MANUAL_SEND_MAX_EVIDENCE,
  MANUAL_SEND_MIN_EVIDENCE,
  buildManualSentRequest,
  checkManualSendEvidence,
} = await import("@/lib/outreach/manual-send-evidence");
const { outreachSettingsRows } = await import("./helpers/outreach-settings");

function table(name: string): Array<Record<string, any>> {
  if (!state.tables[name]) state.tables[name] = [];
  return state.tables[name];
}

function seed() {
  table("adminSetting").push(...outreachSettingsRows());
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
  });
  table("outreachInvitation").push({
    id: "inv-1",
    prospectId: "p-1",
    campaignId: null,
    status: "APPROVED",
    body: "hello",
    startParam: "p-inv1",
  });
}

function patch(body: Record<string, unknown>) {
  return PATCH(
    new NextRequest("https://admin.test/api/admin/outreach/invitations/inv-1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "inv-1" }) }
  );
}

beforeEach(() => {
  for (const key of Object.keys(state.tables)) delete state.tables[key];
});

describe("the payload the evidence dialog builds", () => {
  it("carries the action, the literal confirmation and the trimmed evidence", () => {
    const request = buildManualSentRequest({
      evidence: "  Called the salon and spoke to the owner.  ",
      confirmed: true,
    });
    expect(request).toEqual({
      ok: true,
      payload: {
        action: "mark_manual_sent",
        confirmedByOperator: true,
        evidence: "Called the salon and spoke to the owner.",
      },
    });
  });

  it("cannot be built without a real confirmation", () => {
    const request = buildManualSentRequest({
      evidence: "Called the salon and spoke to the owner.",
      confirmed: false,
    });
    expect(request).toEqual({ ok: false, reason: "not_confirmed" });
  });

  it("mirrors the server's length rule: trimmed, at least 3, at most 500", () => {
    expect(MANUAL_SEND_MIN_EVIDENCE).toBe(3);
    expect(MANUAL_SEND_MAX_EVIDENCE).toBe(500);
    expect(checkManualSendEvidence("   ")).toEqual({ ok: false, reason: "missing" });
    expect(checkManualSendEvidence("ab")).toEqual({ ok: false, reason: "too_short" });
    expect(checkManualSendEvidence("abc")).toEqual({ ok: true, evidence: "abc" });
    expect(checkManualSendEvidence("a".repeat(500)).ok).toBe(true);
    expect(checkManualSendEvidence("a".repeat(501))).toEqual({
      ok: false,
      reason: "too_long",
    });
  });
});

describe("the server accepts exactly what the dialog sends", () => {
  it("records SENT (never DELIVERED) for the built payload", async () => {
    seed();
    const request = buildManualSentRequest({
      evidence: "Called the salon line at 10:30 and spoke to the owner.",
      confirmed: true,
    });
    expect(request.ok).toBe(true);
    if (!request.ok) return;

    const response = await patch(request.payload);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.manual).toBe(true);
    const [invitation] = table("outreachInvitation");
    expect(invitation.status).toBe("SENT");
    expect(invitation.deliveredAt ?? null).toBeNull();
    const [audit] = table("outreachAuditEvent");
    expect(audit.action).toBe("invitation.manual_sent");
    expect(audit.detail).toContain("Called the salon line");
  });
});

describe("the UI never weakens server validation", () => {
  it("rejects evidence the dialog refuses to build, even when sent by hand", async () => {
    seed();
    const response = await patch({
      action: "mark_manual_sent",
      confirmedByOperator: true,
      evidence: "ab",
    });
    expect(response.status).toBe(400);
    // The zod schema rejects the short evidence before the handler body runs;
    // either way the attestation is refused and nothing is written.
    expect(JSON.stringify(await response.json())).toMatch(
      /invalid request|at least 3 characters/i
    );
    expect(table("outreachInvitation")[0].status).toBe("APPROVED");
  });

  it("rejects whitespace-only evidence", async () => {
    seed();
    const response = await patch({
      action: "mark_manual_sent",
      confirmedByOperator: true,
      evidence: "      ",
    });
    expect(response.status).toBe(400);
    expect(table("outreachInvitation")[0].status).toBe("APPROVED");
  });

  it("rejects a manual send that omits the operator confirmation", async () => {
    seed();
    const response = await patch({
      action: "mark_manual_sent",
      evidence: "Called the salon line at 10:30 and spoke to the owner.",
    });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/confirmation is required/i);
    expect(table("outreachInvitation")[0].status).toBe("APPROVED");
  });

  it("rejects a manual send that omits the evidence entirely", async () => {
    seed();
    const response = await patch({
      action: "mark_manual_sent",
      confirmedByOperator: true,
    });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/how and where you contacted/i);
    expect(table("outreachInvitation")[0].status).toBe("APPROVED");
  });
});
