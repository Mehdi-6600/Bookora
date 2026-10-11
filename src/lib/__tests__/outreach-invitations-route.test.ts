import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET as listInvitations } from "@/app/api/admin/outreach/invitations/route";
import { PATCH as patchInvitation } from "@/app/api/admin/outreach/invitations/[id]/route";

/**
 * Route-level guards for the invitation review queue:
 *  - approving an invitation requires a VERIFIED prospect (approval arms
 *    automated delivery, so it must fail closed),
 *  - the list exposes the prospect's verification status so a reviewer can
 *    see what they are approving.
 */

type Row = Record<string, any>;

const mocks = vi.hoisted(() => {
  const state = {
    authMode: "admin" as "admin" | "anonymous",
    prospects: [] as Row[],
    invitations: [] as Row[],
    audit: [] as Row[],
    blocker: null as string | null,
    auditFail: false,
  };

  const functions = {
    requireAdmin: vi.fn(async () => {
      if (state.authMode === "admin") {
        return { ok: true as const, user: { id: "admin-1" } };
      }
      return {
        ok: false as const,
        response: new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        }),
      };
    }),
    findMany: vi.fn(async ({ where }: { where?: { status?: string } }) => {
      return state.invitations
        .filter((row: Row) => (!where?.status ? true : row.status === where.status))
        .map((row: Row) => ({
          ...row,
          prospect: state.prospects.find((item: Row) => item.id === row.prospectId) ?? null,
          template: { id: "tpl-1", code: "invite_fa_default" },
        }));
    }),
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
      const invitation = state.invitations.find((row: Row) => row.id === where.id);
      if (!invitation) return null;
      return {
        ...invitation,
        prospect:
          state.prospects.find((item: Row) => item.id === invitation.prospectId) ?? null,
      };
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Row }) => {
      const invitation = state.invitations.find((row: Row) => row.id === where.id) as Row;
      Object.assign(invitation, data);
      return invitation;
    }),
    updateMany: vi.fn(
      async ({
        where,
        data,
      }: {
        where: { id?: string; status?: string; prospect?: Row };
        data: Row;
      }) => {
        const rows = state.invitations.filter((row: Row) => {
          if (where.id && row.id !== where.id) return false;
          if (where.status && row.status !== where.status) return false;
          if (where.prospect) {
            const prospect = state.prospects.find(
              (item: Row) => item.id === row.prospectId
            ) as Row | undefined;
            if (!prospect) return false;
            for (const [key, condition] of Object.entries(where.prospect)) {
              if (condition === null ? prospect[key] !== null : prospect[key] !== condition)
                return false;
            }
          }
          return true;
        });
        rows.forEach((row: Row) => Object.assign(row, data));
        return { count: rows.length };
      }
    ),
    isRateLimited: vi.fn(async () => false),
    triggerRateLimitCleanup: vi.fn(),
    approvalPolicy: vi.fn(async (prospect: Row) => {
      const blocked =
        state.blocker ??
        (prospect.verificationStatus === "VERIFIED"
          ? null
          : "Only VERIFIED prospects can be approved for outreach.");
      return blocked
        ? {
            canApprove: false,
            canAutoSend: false,
            decision: "BLOCKED" as const,
            reason: "not_verified",
            message: blocked,
          }
        : {
            canApprove: true,
            canAutoSend: true,
            decision: "ELIGIBLE" as const,
            reason: "ok",
            message: "Eligible.",
          };
    }),
    createAudit: vi.fn(async ({ data }: any) => {
      if (state.auditFail) throw new Error("audit unavailable");
      state.audit.push(data); return data;
    }),
  };

  return { state, functions };
});

vi.mock("@/lib/outreach/approval-eligibility", () => ({
  approvalPolicy: mocks.functions.approvalPolicy,
}));

vi.mock("@/lib/auth/admin-api", () => ({
  requireAdmin: mocks.functions.requireAdmin,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    adminSetting: { findMany: async () => outreachSettingsRows() },
    outreachInvitation: {
      findMany: mocks.functions.findMany,
      findUnique: mocks.functions.findUnique,
      update: mocks.functions.update,
      updateMany: mocks.functions.updateMany,
    },
    outreachProspect: { update: vi.fn(async () => ({})) },
    outreachAuditEvent: { create: mocks.functions.createAudit },
    $transaction: async (fn: (tx: any) => Promise<any>) => {
      const snapshot = structuredClone(mocks.state.invitations);
      try { return await fn({
        outreachInvitation: { update: mocks.functions.update,
          updateMany: mocks.functions.updateMany,
          findUnique: mocks.functions.findUnique },
        outreachProspect: { update: vi.fn(async () => ({})) },
        outreachAuditEvent: { create: mocks.functions.createAudit } }); }
      catch (error) { mocks.state.invitations = snapshot; throw error; }
    },
  },
}));

const { outreachSettingsRows } = await import("./helpers/outreach-settings");

vi.mock("@/lib/rate-limit", () => ({
  isRateLimited: mocks.functions.isRateLimited,
  triggerRateLimitCleanup: mocks.functions.triggerRateLimitCleanup,
}));

// The invitations route pulls in the delivery module, which loads the Telegram
// bot (and therefore @prisma/client). Review actions never deliver, so stub it.
vi.mock("@/lib/telegram/notify", () => ({
  deliverTelegramMessage: async () => ({ ok: true as const, messageId: 1 }),
  notifyUser: async () => undefined,
}));

function patchRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/admin/outreach/invitations/inv-1", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function seed(prospect: Partial<Row> = {}, invitation: Partial<Row> = {}) {
  mocks.state.prospects.push({
    id: "p-1",
    verificationStatus: "VERIFIED",
    status: "NEW",
    optedOutAt: null,
    ...prospect,
  });
  mocks.state.invitations.push({
    id: "inv-1",
    prospectId: "p-1",
    status: "DRAFT",
    body: "hello {link}",
    ...invitation,
  });
}

beforeEach(() => {
  mocks.state.authMode = "admin";
  mocks.state.prospects = [];
  mocks.state.invitations = [];
  mocks.state.audit = [];
  mocks.state.blocker = null;
  mocks.state.auditFail = false;
  vi.clearAllMocks();
});

describe("invitation review API", () => {
  it("requires admin access before reviewing invitations", async () => {
    mocks.state.authMode = "anonymous";

    const response = await patchInvitation(patchRequest({ action: "approve" }), {
      params: Promise.resolve({ id: "inv-1" }),
    });

    expect(response.status).toBe(401);
    expect(mocks.functions.update).not.toHaveBeenCalled();
  });

  it("refuses to approve an invitation for an unverified prospect", async () => {
    seed({ verificationStatus: "DISCOVERED" });

    const response = await patchInvitation(patchRequest({ action: "approve" }), {
      params: Promise.resolve({ id: "inv-1" }),
    });

    expect(response.status).toBe(409);
    const payload = await response.json();
    expect(payload.error).toMatch(/VERIFIED/);
    expect(payload.verificationStatus).toBe("DISCOVERED");
    expect(mocks.state.invitations[0].status).toBe("DRAFT");
    expect(mocks.functions.update).not.toHaveBeenCalled();
  });

  it("approves an invitation for a verified prospect", async () => {
    seed({ verificationStatus: "VERIFIED" });

    const response = await patchInvitation(patchRequest({ action: "approve" }), {
      params: Promise.resolve({ id: "inv-1" }),
    });

    expect(response.status).toBe(200);
    expect(mocks.state.invitations[0].status).toBe("APPROVED");
  });

  it("rejects manual-sent without confirmed consent or from an invalid state", async () => {
    seed({}, { status: "APPROVED" });
    const params = { params: Promise.resolve({ id: "inv-1" }) };
    expect((await patchInvitation(patchRequest({ action: "mark_manual_sent" }), params)).status).toBe(409);
    // Confirmation alone is not enough: the operator must record the evidence.
    expect(
      (await patchInvitation(
        patchRequest({ action: "mark_manual_sent", confirmedByOperator: true }),
        params
      )).status
    ).toBe(400);
    mocks.state.blocker = "suppressed";
    expect((await patchInvitation(patchRequest({ action: "mark_manual_sent", confirmedByOperator: true, evidence: "Phone call, spoke to the owner" }), params)).status).toBe(409);
    expect(mocks.state.invitations[0].status).toBe("APPROVED");
    expect(mocks.state.audit).toHaveLength(0);
  });

  it("records manual-sent operator and time atomically or surfaces audit failure", async () => {
    seed({}, { status: "APPROVED" });
    const request = patchRequest({
      action: "mark_manual_sent",
      confirmedByOperator: true,
      evidence: "Phone call, spoke to the owner",
    });
    const params = { params: Promise.resolve({ id: "inv-1" }) };
    mocks.state.auditFail = true;
    const failed = await patchInvitation(request, params);
    expect(failed.status).toBe(503);
    expect(mocks.state.invitations[0].status).toBe("APPROVED");
    mocks.state.auditFail = false;
    const success = await patchInvitation(
      patchRequest({
        action: "mark_manual_sent",
        confirmedByOperator: true,
        evidence: "Phone call, spoke to the owner",
      }),
      params
    );
    expect(success.status).toBe(200);
    expect(mocks.state.invitations[0].sentAt).toBeInstanceOf(Date);
    expect(mocks.state.audit[0]).toMatchObject({ action: "invitation.manual_sent", actorUserId: "admin-1" });
  });

  it("lists invitations with the prospect verification status", async () => {
    seed({ verificationStatus: "DISCOVERED" });

    const response = await listInvitations(
      new NextRequest("http://localhost/api/admin/outreach/invitations")
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.invitations).toHaveLength(1);
    expect(payload.invitations[0].prospect.verificationStatus).toBe("DISCOVERED");
  });
});
