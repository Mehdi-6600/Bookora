import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Critical fix B — one consistent eligibility policy.
 *
 * Every surface (planning, individual approval, bulk approval, manual status
 * transitions, delivery) must reach the same verdict, and a concurrent change
 * must never leave an ineligible recipient approved.
 */

type Row = Record<string, any>;

const state = vi.hoisted(() => ({
  settings: [] as Row[],
  prospects: [] as Row[],
  invitations: [] as Row[],
  consents: [] as Row[],
  suppressions: [] as Row[],
  campaigns: [] as Row[],
  audit: [] as Row[],
  auditFail: false,
  /** Simulates a concurrent status change between validation and write. */
  mutateDuringApproval: null as null | (() => void),
  deliveries: [] as Array<{ id: string }>,
  seq: 0,
}));

vi.mock("@/lib/prisma", () => {
  const prisma: any = {
    adminSetting: { findMany: async () => state.settings },
    outreachProspect: {
      findMany: async ({ take }: any) => state.prospects.slice(0, take ?? state.prospects.length),
      findUnique: async ({ where }: any) =>
        state.prospects.find((row: Row) => row.id === where.id) ?? null,
      update: async ({ where, data }: any) => {
        Object.assign(state.prospects.find((row: Row) => row.id === where.id) as Row, data);
        return data;
      },
      updateMany: async ({ where, data }: any) => {
        const rows = state.prospects.filter((row: Row) => row.id === where.id);
        rows.forEach((row: Row) => Object.assign(row, data));
        return { count: rows.length };
      },
    },
    outreachInvitation: {
      findMany: async ({ where, include }: any) =>
        state.invitations
          .filter((row: Row) => {
            if (where?.id?.in) return where.id.in.includes(row.id);
            if (where?.campaignId && row.campaignId !== where.campaignId) return false;
            if (where?.prospectId && row.prospectId !== where.prospectId) return false;
            if (where?.status?.in) return where.status.in.includes(row.status);
            if (where?.status) return row.status === where.status;
            return true;
          })
          .map((row: Row) =>
            include?.prospect
              ? { ...row, prospect: state.prospects.find((p: Row) => p.id === row.prospectId) }
              : row
          ),
      findUnique: async ({ where }: any) => {
        const invitation = state.invitations.find(
          (row: Row) => row.id === where.id || row.startParam === where.startParam
        );
        return invitation ?? null;
      },
      update: async ({ where, data }: any) => {
        Object.assign(state.invitations.find((row: Row) => row.id === where.id) as Row, data);
        return data;
      },
      updateMany: async ({ where, data }: any) => {
        // Conditional update: a concurrent status change makes this a no-op,
        // exactly like a `WHERE status = 'DRAFT'` clause in SQL.
        if (state.mutateDuringApproval) {
          state.mutateDuringApproval();
          state.mutateDuringApproval = null;
        }
        const rows = state.invitations.filter((row: Row) => {
          if (where?.id && row.id !== where.id) return false;
          if (where?.id?.in && !where.id.in.includes(row.id)) return false;
          if (where?.campaignId !== undefined && row.campaignId !== where.campaignId) return false;
          if (where?.status !== undefined && row.status !== where.status) return false;
          if (where?.prospectId !== undefined && row.prospectId !== where.prospectId) return false;
          if (where?.prospect) {
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
      },
    },
    outreachCampaign: {
      findUnique: async ({ where }: any) =>
        state.campaigns.find((row: Row) => row.id === where.id) ?? null,
    },
    telegramBotOptIn: {
      findFirst: async ({ where }: any) => {
        const rows = state.consents.filter((row: Row) => {
          if (where?.prospectId !== undefined && row.prospectId !== where.prospectId) return false;
          if (where?.revokedAt === null && row.revokedAt) return false;
          if (where?.startedAt?.gte && !(row.startedAt && row.startedAt >= where.startedAt.gte))
            return false;
          return true;
        });
        return rows[0] ?? null;
      },
    },
    outreachSuppression: {
      findFirst: async ({ where }: any) =>
        state.suppressions.find((row: Row) => where.identifier.in.includes(row.identifier)) ?? null,
    },
    outreachAuditEvent: {
      create: async ({ data }: any) => {
        if (state.auditFail) throw new Error("audit table missing");
        state.audit.push(data);
        return data;
      },
    },
  };
  prisma.$transaction = async (fn: (tx: any) => Promise<any>) => {
    const snapshot: Row = {
      prospects: structuredClone(state.prospects),
      invitations: structuredClone(state.invitations),
      audit: structuredClone(state.audit),
      campaigns: structuredClone(state.campaigns),
    };
    try {
      return await fn(prisma);
    } catch (error) {
      state.prospects = snapshot.prospects;
      state.invitations = snapshot.invitations;
      state.audit = snapshot.audit;
      state.campaigns = snapshot.campaigns;
      throw error;
    }
  };
  return { prisma };
});

vi.mock("@/lib/telegram/notify", () => ({
  deliverTelegramMessage: async (id: string) => {
    state.deliveries.push({ id });
    return { ok: true as const, messageId: 1 };
  },
  notifyUser: async () => undefined,
}));

const { evaluateOutreachPolicy } = await import("@/lib/outreach/policy");

/** The policy's own prospect shape: `Record<string, any>` has no declared
 * `id`/`status`, so rows are narrowed at the call site. */
function asProspect(row: Row) {
  return row as unknown as {
    id: string;
    status: string;
    verificationStatus: string | null;
    telegramUsername: string | null;
    publicUrl: string | null;
    optedOutAt: Date | null;
  };
}
const { approveCampaignInvitations } = await import("@/lib/outreach/campaigns");
const { outreachSettingsRows } = await import("./helpers/outreach-settings");

const VERIFIED = {
  id: "p-1",
  publicName: "Sample Barber",
  category: "BARBER",
  language: "en",
  verificationStatus: "VERIFIED",
  status: "NEW",
  optedOutAt: null,
  nextFollowUpAt: null,
  telegramUsername: null,
  publicUrl: null,
};

function seed(overrides: Partial<Row> = {}) {
  state.prospects.push({ ...VERIFIED, ...overrides });
}

beforeEach(() => {
  state.settings = outreachSettingsRows();
  state.prospects = [];
  state.invitations = [];
  state.consents = [];
  state.suppressions = [];
  state.campaigns = [];
  state.audit = [];
  state.auditFail = false;
  state.mutateDuringApproval = null;
  state.deliveries = [];
});

describe("the policy verdict", () => {
  it("blocks an unverified prospect even with consent", async () => {
    seed({ verificationStatus: "DISCOVERED" });
    state.consents.push({
      telegramId: "111",
      prospectId: "p-1",
      startedAt: new Date(),
      revokedAt: null,
    });

    const policy = await evaluateOutreachPolicy(
      asProspect(state.prospects[0]));

    expect(policy.decision).toBe("BLOCKED");
    expect(policy.reason).toBe("not_verified");
    expect(policy.canAutoSend).toBe(false);
    expect(policy.canApprove).toBe(false);
    expect(policy.label.en).toMatch(/not verified/i);
  });

  it("blocks a suppressed contact and never offers it for manual outreach", async () => {
    seed();
    state.suppressions.push({ identifier: "tg:sample" });
    state.consents.push({
      telegramId: "111",
      prospectId: "p-1",
      startedAt: new Date(),
      revokedAt: null,
    });

    const policy = await evaluateOutreachPolicy({
      ...asProspect(state.prospects[0]),
      telegramUsername: "sample",
    });

    expect(policy.decision).toBe("BLOCKED");
    expect(policy.reason).toBe("suppressed");
  });

  it("blocks a revoked consent instead of falling back to manual outreach", async () => {
    seed();
    state.consents.push({
      telegramId: "111",
      prospectId: "p-1",
      startedAt: new Date(),
      revokedAt: new Date(),
    });

    const policy = await evaluateOutreachPolicy(
      asProspect(state.prospects[0]));

    expect(policy.decision).toBe("BLOCKED");
    expect(policy.reason).toBe("consent_revoked");
  });

  it("treats consent older than 90 days as expired, not current", async () => {
    seed();
    state.consents.push({
      telegramId: "111",
      prospectId: "p-1",
      startedAt: new Date(Date.now() - 91 * 24 * 60 * 60 * 1000),
      revokedAt: null,
    });

    const policy = await evaluateOutreachPolicy(
      asProspect(state.prospects[0]));

    expect(policy.decision).toBe("MANUAL_ONLY");
    expect(policy.reason).toBe("consent_expired");
    expect(policy.canAutoSend).toBe(false);
  });

  it("allows the bot only with a current, prospect-bound start", async () => {
    seed();
    state.consents.push({
      telegramId: "111",
      prospectId: "p-1",
      startedAt: new Date(),
      revokedAt: null,
    });

    const policy = await evaluateOutreachPolicy(
      asProspect(state.prospects[0]));

    expect(policy.decision).toBe("ELIGIBLE");
    expect(policy.canAutoSend).toBe(true);
    expect(policy.telegramUserId).toBe("111");
    expect(policy.checkedAt).toBeInstanceOf(Date);
  });

  it("blocks an invalid invitation state and an unapproved campaign", async () => {
    seed();
    state.consents.push({
      telegramId: "111",
      prospectId: "p-1",
      startedAt: new Date(),
      revokedAt: null,
    });

    const wrongState = await evaluateOutreachPolicy(
      asProspect(state.prospects[0]), {
      invitation: { id: "inv-1", status: "SENT" },
      allowedInvitationStatuses: ["DRAFT"],
    });
    expect(wrongState.reason).toBe("invalid_invitation_state");

    const wrongCampaign = await evaluateOutreachPolicy(
      asProspect(state.prospects[0]), {
      invitation: { id: "inv-1", status: "DRAFT", campaignId: "cmp-1" },
      campaignStatus: "DRAFT",
      requireApprovedCampaign: true,
    });
    expect(wrongCampaign.reason).toBe("campaign_not_approved");
  });
});

describe("bulk approval", () => {
  function seedCampaign(prospects: Array<Partial<Row>>) {
    state.campaigns.push({
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
    prospects.forEach((overrides, index) => {
      const id = `p-${index + 1}`;
      seed({ id, ...overrides });
      state.invitations.push({
        id: `inv-${index + 1}`,
        prospectId: id,
        campaignId: "cmp-1",
        status: "DRAFT",
        body: "hi",
      });
    });
  }

  it("approves every draft when all of them are eligible", async () => {
    seedCampaign([{}, {}]);
    state.consents.push(
      { telegramId: "111", prospectId: "p-1", startedAt: new Date(), revokedAt: null },
      { telegramId: "222", prospectId: "p-2", startedAt: new Date(), revokedAt: null }
    );

    const result = await approveCampaignInvitations("cmp-1", "admin-1");

    expect(result).toEqual({ ok: true, approved: 2 });
    expect(state.invitations.every((row: Row) => row.status === "APPROVED")).toBe(true);
    expect(state.audit).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "invitations.approved", actorUserId: "admin-1" }),
      ])
    );
  });

  it("approves nothing when one draft has no bot consent", async () => {
    seedCampaign([{}, {}]);
    state.consents.push({
      telegramId: "111",
      prospectId: "p-1",
      startedAt: new Date(),
      revokedAt: null,
    });

    const result = await approveCampaignInvitations("cmp-1", "admin-1");

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/has not started the bot/i);
    expect(state.invitations.every((row: Row) => row.status === "DRAFT")).toBe(true);
    expect(state.audit).toHaveLength(0);
  });

  it("approves nothing when one draft is suppressed, even though the other is eligible", async () => {
    seedCampaign([{}, {}]);
    state.suppressions.push({ identifier: "user:222" });
    state.consents.push(
      { telegramId: "111", prospectId: "p-1", startedAt: new Date(), revokedAt: null },
      { telegramId: "222", prospectId: "p-2", startedAt: new Date(), revokedAt: null }
    );

    const result = await approveCampaignInvitations("cmp-1", "admin-1");

    expect(result.ok).toBe(false);
    expect(state.invitations.every((row: Row) => row.status === "DRAFT")).toBe(true);
  });

  it("rolls the whole batch back when a concurrent request approves the same invitation", async () => {
    seedCampaign([{}, {}]);
    state.consents.push(
      { telegramId: "111", prospectId: "p-1", startedAt: new Date(), revokedAt: null },
      { telegramId: "222", prospectId: "p-2", startedAt: new Date(), revokedAt: null }
    );
    // Another operator (or a second tab) approves invitation two between the
    // policy check and this batch's write.
    state.mutateDuringApproval = () => {
      const row = state.invitations.find((row: Row) => row.id === "inv-2") as Row;
      row.status = "APPROVED";
    };

    const result = await approveCampaignInvitations("cmp-1", "admin-1");

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/state changed/i);
    // Invitation one was written inside the transaction and then rolled back.
    expect(state.invitations.find((row: Row) => row.id === "inv-1")?.status).toBe("DRAFT");
    expect(state.invitations.find((row: Row) => row.id === "inv-2")?.status).toBe("DRAFT");
    expect(state.audit).toHaveLength(0);
  });

  it("surfaces an audit failure instead of approving without a trail", async () => {
    seedCampaign([{}]);
    state.consents.push({
      telegramId: "111",
      prospectId: "p-1",
      startedAt: new Date(),
      revokedAt: null,
    });
    state.auditFail = true;

    await expect(approveCampaignInvitations("cmp-1", "admin-1")).rejects.toThrow();
    expect(state.invitations[0].status).toBe("DRAFT");
  });
});
