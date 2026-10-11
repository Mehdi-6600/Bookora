import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The final gate must re-read the campaign inside the transaction that claims
 * the invitation.
 *
 * Before this, campaign state was checked once, by `evaluateOutreachPolicy`,
 * from a status value the caller had loaded *before* the transaction opened. A
 * campaign completed or paused in between still looked sendable, and the
 * message went out.
 *
 * These tests drive `sendApprovedInvitations` with an in-memory double. No
 * Telegram call and no database is involved: `deliverTelegramMessage` is mocked
 * and records what it *would* have sent.
 *
 * The injection point that matters is `outreachCampaign.findUnique`: it is the
 * read the gate performs inside the transaction, so changing the row there is
 * exactly "the campaign changed after the eligibility check".
 */

type Row = Record<string, any>;

const state = vi.hoisted(() => ({
  settings: [] as Row[],
  prospects: [] as Row[],
  invitations: [] as Row[],
  campaigns: [] as Row[],
  consents: [] as Row[],
  suppressions: [] as Row[],
  audit: [] as Row[],
  deliveries: [] as Array<{ id: string; text: string }>,
  /** Make every campaign read fail, to prove the gate is fail-closed. */
  campaignReadFails: false,
  /** Runs immediately before the gate's campaign read. */
  onCampaignRead: null as null | (() => void),
  /** Counts the gate's campaign reads, so a test can prove it happens. */
  campaignReads: 0,
}));

vi.mock("@/lib/prisma", () => {
  const prisma: any = {
    adminSetting: {
      findMany: async () => state.settings,
    },
    outreachCampaign: {
      findUnique: async ({ where }: any) => {
        state.campaignReads += 1;
        state.onCampaignRead?.();
        if (state.campaignReadFails) {
          throw new Error('relation "outreach_campaigns" does not exist');
        }
        const row = state.campaigns.find((item: Row) => item.id === where?.id);
        return row ? { status: row.status } : null;
      },
    },
    outreachProspect: {
      findMany: async ({ take }: any) =>
        state.prospects.slice(0, take ?? state.prospects.length),
      findUnique: async ({ where }: any) =>
        state.prospects.find((row: Row) => row.id === where.id) ?? null,
      update: async ({ where, data }: any) => {
        Object.assign(
          state.prospects.find((row: Row) => row.id === where.id) as Row,
          data
        );
        return data;
      },
    },
    outreachInvitation: {
      // Mirrors the real query: the campaign status it returns was read before
      // the transaction, which is exactly the value the gate must not trust.
      findMany: async ({ where }: any) =>
        state.invitations
          .filter((row: Row) => {
            if (where?.status?.in) return where.status.in.includes(row.status);
            if (where?.status) return row.status === where.status;
            return true;
          })
          .map((row: Row) => ({
            ...row,
            prospect: state.prospects.find(
              (item: Row) => item.id === row.prospectId
            ),
            campaign: row.campaignId
              ? (state.campaigns.find(
                  (item: Row) => item.id === row.campaignId
                ) ?? null)
              : null,
          })),
      findUnique: async ({ where }: any) =>
        state.invitations.find((row: Row) => row.id === where?.id) ?? null,
      update: async ({ where, data }: any) => {
        Object.assign(
          state.invitations.find((row: Row) => row.id === where.id) as Row,
          data
        );
        return data;
      },
      updateMany: async ({ where, data }: any) => {
        const rows = state.invitations.filter((row: Row) => {
          if (where?.id && row.id !== where.id) return false;
          if (where?.status && row.status !== where.status) return false;
          return true;
        });
        rows.forEach((row: Row) => Object.assign(row, data));
        return { count: rows.length };
      },
    },
    telegramBotOptIn: {
      findFirst: async ({ where }: any) => {
        const rows = state.consents.filter((row: Row) => {
          if (where?.prospectId !== undefined && row.prospectId !== where.prospectId)
            return false;
          return true;
        });
        rows.sort((a: Row, b: Row) => {
          const left = a.startedAt ? a.startedAt.getTime() : 0;
          const right = b.startedAt ? b.startedAt.getTime() : 0;
          return right - left;
        });
        return rows[0] ?? null;
      },
      updateMany: async ({ where, data }: any) => {
        state.consents
          .filter((row: Row) => row.telegramId === where?.telegramId)
          .forEach((row: Row) => Object.assign(row, data));
        return { count: 1 };
      },
    },
    outreachSuppression: {
      findFirst: async ({ where }: any) =>
        state.suppressions.find((row: Row) =>
          where.identifier.in.includes(row.identifier)
        ) ?? null,
    },
    outreachAuditEvent: {
      create: async ({ data }: any) => {
        state.audit.push(data);
        return data;
      },
    },
  };
  prisma.$transaction = async (fn: (tx: any) => Promise<any>) => fn(prisma);
  return { prisma };
});

vi.mock("@/lib/telegram/notify", () => ({
  deliverTelegramMessage: async (id: string, text: string) => {
    state.deliveries.push({ id, text });
    return { ok: true as const, messageId: 1 };
  },
  notifyUser: async () => undefined,
}));

const { sendApprovedInvitations } = await import("@/lib/outreach/invitations");
const { outreachSettingsRows } = await import("./helpers/outreach-settings");

const TELEGRAM_ID = "555001";
const CAMPAIGN_ID = "camp-1";

function seed(options: { campaignId?: string | null } = {}) {
  const campaignId =
    options.campaignId === undefined ? CAMPAIGN_ID : options.campaignId;

  state.prospects.push({
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
  });
  state.invitations.push({
    id: "inv-1",
    prospectId: "p-1",
    campaignId,
    status: "APPROVED",
    approvedAt: new Date(),
    body: "hello",
    startParam: "abc",
    deepLink: "https://t.me/BookoraBot?start=abc",
  });
  state.consents.push({
    telegramId: TELEGRAM_ID,
    prospectId: "p-1",
    startedAt: new Date(),
    revokedAt: null,
    lastUpdateId: 500,
  });
}

function campaign(status: string) {
  state.campaigns.push({
    id: CAMPAIGN_ID,
    code: "c-campaign",
    name: "Sample campaign",
    status,
    active: true,
  });
}

beforeEach(() => {
  state.settings = outreachSettingsRows();
  state.prospects = [];
  state.invitations = [];
  state.campaigns = [];
  state.consents = [];
  state.suppressions = [];
  state.audit = [];
  state.deliveries = [];
  state.campaignReadFails = false;
  state.onCampaignRead = null;
  state.campaignReads = 0;
});

describe("a campaign that is still sendable", () => {
  it.each(["APPROVED", "SENDING"])("delivers when the campaign is %s", async (status) => {
    seed();
    campaign(status);

    const outcomes = await sendApprovedInvitations({ limit: 10 });

    expect(state.deliveries).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({ status: "DELIVERED" });
  });

  it("re-reads the campaign inside the transaction, not only beforehand", async () => {
    seed();
    campaign("APPROVED");

    await sendApprovedInvitations({ limit: 10 });

    // Proves the gate performs its own read at all; without it the status
    // could only come from the pre-transaction value.
    expect(state.campaignReads).toBeGreaterThan(0);
    expect(state.deliveries).toHaveLength(1);
  });

  it("delivers an invitation that has no campaign", async () => {
    seed({ campaignId: null });

    const outcomes = await sendApprovedInvitations({ limit: 10 });

    expect(state.deliveries).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({ status: "DELIVERED" });
    // Nothing to re-read, so no campaign lookup at all.
    expect(state.campaignReads).toBe(0);
  });
});

describe("a campaign that may no longer be delivered", () => {
  // The two sendable states are APPROVED and SENDING; every other declared
  // state is a stop.
  it.each(["DRAFT", "REVIEW", "COMPLETED", "FAILED"])(
    "sends nothing when the campaign is %s",
    async (status) => {
      seed();
      campaign(status);

      const outcomes = await sendApprovedInvitations({ limit: 10 });

      expect(state.deliveries).toHaveLength(0);
      expect(outcomes[0]).toMatchObject({
        status: "SKIPPED",
        reason: "campaign_not_approved",
      });
      // The claim was undone, so a later run can still deliver it.
      expect(state.invitations[0].status).toBe("SKIPPED");
    }
  );

  it("sends nothing when the campaign was deleted", async () => {
    seed();
    // No row in state.campaigns: findUnique returns null, exactly as a missing
    // row would. The invitation still points at the id.
    const outcomes = await sendApprovedInvitations({ limit: 10 });

    expect(state.deliveries).toHaveLength(0);
    expect(outcomes[0]).toMatchObject({
      status: "SKIPPED",
      reason: "campaign_not_approved",
    });
  });

  it("sends nothing when the campaign status is not a recognised value", async () => {
    seed();
    campaign("ARCHIVED-BY-MIGRATION");

    const outcomes = await sendApprovedInvitations({ limit: 10 });

    expect(state.deliveries).toHaveLength(0);
    expect(outcomes[0]).toMatchObject({
      status: "SKIPPED",
      reason: "campaign_not_approved",
    });
  });

  it("sends nothing when the campaign cannot be read", async () => {
    seed();
    campaign("APPROVED");
    state.campaignReadFails = true;

    const outcomes = await sendApprovedInvitations({ limit: 10 });

    expect(state.deliveries).toHaveLength(0);
    // Its own reason: a read failure must not be recorded as a decision about
    // the campaign.
    expect(outcomes[0]).toMatchObject({
      status: "SKIPPED",
      reason: "campaign_unavailable",
    });
    expect(state.invitations[0].status).toBe("SKIPPED");
  });
});

describe("a campaign stopped between the eligibility check and the final gate", () => {
  it("sends nothing, even though the eligibility check saw it approved", async () => {
    seed();
    campaign("APPROVED");

    // The status the caller loaded before the transaction is still APPROVED —
    // `findMany` already ran — so only a re-read inside the gate can catch this.
    state.onCampaignRead = () => {
      state.campaigns[0].status = "COMPLETED";
    };

    const outcomes = await sendApprovedInvitations({ limit: 10 });

    expect(state.deliveries).toHaveLength(0);
    expect(outcomes[0]).toMatchObject({
      status: "SKIPPED",
      reason: "campaign_not_approved",
    });
  });

  it("would have delivered if the campaign had not changed", async () => {
    // The control for the test above: the harness itself does not block the
    // delivery, only the changed status does.
    seed();
    campaign("APPROVED");

    const outcomes = await sendApprovedInvitations({ limit: 10 });

    expect(state.deliveries).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({ status: "DELIVERED" });
  });
});
