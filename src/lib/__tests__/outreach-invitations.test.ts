import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests the rules that keep outreach safe:
 *  - a prospect is never invited twice while an invitation is pending,
 *  - opted-out and do-not-contact businesses are excluded,
 *  - a message is only delivered to someone who already started the bot,
 *  - the daily invitation quota caps how many drafts are prepared.
 */

type Row = Record<string, any>;

const db = {
  prospects: [] as Row[],
  invitations: [] as Row[],
  templates: [] as Row[],
  suppressions: [] as Row[],
  users: [] as Row[],
  deliveries: [] as Array<{ id: string; text: string }>,
  deliveryShouldFail: false,
};

vi.mock("@/lib/prisma", () => {
  const prisma = {
    outreachProspect: {
      findMany: async ({ where, orderBy, take }: any) => {
        let rows = db.prospects.filter((row: Row) => {
          if (where?.status?.in && !where.status.in.includes(row.status)) return false;
          if (where?.id?.in && !where.id.in.includes(row.id)) return false;
          if ("optedOutAt" in (where ?? {}) && where.optedOutAt !== null) {
            return row.optedOutAt === null;
          }
          return true;
        });
        rows = rows.slice(0, take ?? rows.length);
        void orderBy;
        return rows;
      },
      findUnique: async ({ where }: any) =>
        db.prospects.find((row: Row) => row.id === where.id) ?? null,
      update: async ({ where, data }: any) => {
        const row = db.prospects.find((item: Row) => item.id === where.id) as Row;
        for (const [key, value] of Object.entries(data)) {
          if (value && typeof value === "object" && "increment" in (value as any)) {
            row[key] = (row[key] ?? 0) + (value as any).increment;
          } else {
            row[key] = value;
          }
        }
        return row;
      },
    },
    outreachInvitation: {
      findMany: async ({ where, include }: any) =>
        db.invitations
          .filter((row: Row) => {
            if (where?.status?.in) return where.status.in.includes(row.status);
            if (where?.status) return row.status === where.status;
            return true;
          })
          .map((row: Row) =>
            include?.prospect
              ? {
                  ...row,
                  prospect: db.prospects.find((item: Row) => item.id === row.prospectId),
                }
              : row
          ),
      findUnique: async ({ where }: any) =>
        db.invitations.find((row: Row) => row.startParam === where.startParam) ?? null,
      create: async ({ data }: any) => {
        const row = { id: "inv-" + db.invitations.length, ...data };
        db.invitations.push(row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const row = db.invitations.find((item: Row) => item.id === where.id) as Row;
        Object.assign(row, data);
        return row;
      },
      count: async ({ where }: any) =>
        db.invitations.filter((row: Row) => (where?.status?.in ?? []).includes(row.status))
          .length,
    },
    invitationTemplate: {
      findUnique: async ({ where }: any) =>
        db.templates.find((row: Row) => row.id === where.id) ?? null,
      findMany: async ({ where }: any) =>
        db.templates.filter(
          (row: Row) => row.active === true && (where?.language ? row.language === where.language : true)
        ),
    },
    outreachSuppression: {
      findFirst: async ({ where }: any) =>
        db.suppressions.find((row: Row) => where.identifier.in.includes(row.identifier)) ?? null,
      upsert: async ({ where, create }: any) => {
        const existing = db.suppressions.find(
          (row: Row) => row.identifier === where.identifier
        );
        if (existing) {
          Object.assign(existing as Row, create);
          return existing;
        }
        const row = { id: "sup-" + db.suppressions.length, ...create };
        db.suppressions.push(row);
        return row;
      },
    },
    user: {
      findUnique: async ({ where }: any) =>
        db.users.find((row: Row) => row.telegramId === where.telegramId) ?? null,
      findFirst: async ({ where }: any) => {
        const wanted = String(where?.telegramUsername?.equals ?? "").toLowerCase();
        return (
          db.users.find(
            (row: Row) => String(row.telegramUsername ?? "").toLowerCase() === wanted
          ) ?? null
        );
      },
    },
  };

  return { prisma };
});

vi.mock("@/lib/telegram/notify", () => ({
  deliverTelegramMessage: async (id: string, text: string) => {
    if (db.deliveryShouldFail) {
      return { ok: false as const, errorCode: 403, error: "blocked", blocked: true };
    }
    db.deliveries.push({ id, text });
    return { ok: true as const, messageId: 1 };
  },
  notifyUser: async () => undefined,
}));

const { prepareInvitations, sendApprovedInvitations, recordOptOut } = await import(
  "@/lib/outreach/invitations"
);
const { checkEligibility, ELIGIBILITY_REASONS } = await import(
  "@/lib/outreach/eligibility"
);

const TEMPLATE = {
  id: "tpl-en",
  code: "invite_en_default",
  language: "en",
  category: "ALL",
  body: "Hi {businessName}! Your {category} can take bookings here: {link}",
  active: true,
};

function prospect(overrides: Partial<Row> = {}): Row {
  return {
    id: "p" + db.prospects.length,
    publicName: "Mehdi Barber",
    category: "BARBER",
    city: "Tehran",
    language: "en",
    publicUrl: "https://instagram.com/mehdi",
    telegramUsername: "mehdi_barber",
    status: "NEW",
    optedOutAt: null,
    contactedCount: 0,
    campaignId: null,
    ...overrides,
  };
}

beforeEach(() => {
  db.prospects = [];
  db.invitations = [];
  db.templates = [{ ...TEMPLATE }];
  db.suppressions = [];
  db.users = [];
  db.deliveries = [];
  db.deliveryShouldFail = false;
});

describe("preparing invitations", () => {
  it("creates one draft per prospect with a rendered body and a deep link", async () => {
    db.prospects.push(prospect());

    const result = await prepareInvitations({ limit: 10 });

    expect(result.prepared).toHaveLength(1);
    const draft = db.invitations[0];

    expect(draft.status).toBe("DRAFT");
    expect(draft.body).toContain("Mehdi Barber");
    expect(draft.body).toContain("barbershop");
    expect(draft.deepLink).toMatch(/^https:\/\/t\.me\/.+\?start=/);
    expect(draft.startParam.length).toBeLessThanOrEqual(64);
    expect(draft.body).not.toContain("{link}");
  });

  it("respects the daily invitation quota", async () => {
    for (let index = 0; index < 25; index += 1) {
      db.prospects.push(
        prospect({ id: `p${index}`, telegramUsername: `shop${index}`, publicUrl: `https://instagram.com/shop${index}` })
      );
    }

    const result = await prepareInvitations({ limit: 10 });

    expect(result.prepared).toHaveLength(10);
    expect(db.invitations).toHaveLength(10);
  });

  it("never prepares a second invitation while one is pending", async () => {
    db.prospects.push(prospect());

    const first = await prepareInvitations({ limit: 10 });
    const second = await prepareInvitations({ limit: 10 });

    expect(first.prepared).toHaveLength(1);
    expect(second.prepared).toHaveLength(0);
    expect(second.skipped[0].reason).toBe("already_pending");
    expect(db.invitations).toHaveLength(1);
  });

  it("skips prospects that are suppressed", async () => {
    db.prospects.push(prospect());
    db.suppressions.push({ identifier: "tg:mehdi_barber", reason: "OPT_OUT" });

    const result = await prepareInvitations({ limit: 10 });

    expect(result.prepared).toHaveLength(0);
    expect(result.skipped[0].reason).toBe("suppressed");
  });

  it("skips closed prospects", async () => {
    db.prospects.push(prospect({ status: "DO_NOT_CONTACT" }));

    const result = await prepareInvitations({ limit: 10 });

    expect(result.prepared).toHaveLength(0);
  });

  it("gives each invitation a unique start parameter", async () => {
    for (let index = 0; index < 8; index += 1) {
      db.prospects.push(
        prospect({ id: `p${index}`, telegramUsername: `shop${index}`, publicUrl: `https://instagram.com/shop${index}` })
      );
    }

    await prepareInvitations({ limit: 8 });

    const params = db.invitations.map((row: Row) => row.startParam);
    expect(new Set(params).size).toBe(params.length);
  });

  it("reports a missing template instead of failing", async () => {
    db.templates = [];
    db.prospects.push(prospect());

    const result = await prepareInvitations({ limit: 10 });

    expect(result.prepared).toHaveLength(0);
    expect(result.skipped[0].reason).toBe("no_template");
  });
});

describe("delivery eligibility", () => {
  it("refuses to message someone who never started the bot", async () => {
    const result = await checkEligibility({
      id: "p1",
      status: "NEW",
      telegramUsername: "mehdi_barber",
      publicUrl: null,
      telegramUserId: null,
      optedOutAt: null,
    });

    expect(result.canAutoSend).toBe(false);
    expect(result.reason).toBe(ELIGIBILITY_REASONS.NO_TELEGRAM_ID);
  });

  it("refuses to message a resolved user who has no User row", async () => {
    const result = await checkEligibility({
      id: "p1",
      status: "NEW",
      telegramUsername: "mehdi_barber",
      publicUrl: null,
      telegramUserId: "555001",
      optedOutAt: null,
    });

    expect(result.canAutoSend).toBe(false);
    expect(result.reason).toBe(ELIGIBILITY_REASONS.NOT_STARTED_BOT);
  });

  it("allows delivery once the user has started the bot", async () => {
    db.users.push({ id: "u1", telegramId: "555001", telegramUsername: "mehdi_barber" });

    const result = await checkEligibility({
      id: "p1",
      status: "NEW",
      telegramUsername: "mehdi_barber",
      publicUrl: null,
      telegramUserId: "555001",
      optedOutAt: null,
    });

    expect(result.canAutoSend).toBe(true);
    expect(result.reason).toBe(ELIGIBILITY_REASONS.OK);
  });

  it("refuses when the contact opted out or is closed", async () => {
    db.users.push({ id: "u1", telegramId: "555001", telegramUsername: "mehdi_barber" });

    const optedOut = await checkEligibility({
      id: "p1",
      status: "NEW",
      telegramUsername: "mehdi_barber",
      publicUrl: null,
      telegramUserId: "555001",
      optedOutAt: new Date(),
    });
    expect(optedOut.reason).toBe(ELIGIBILITY_REASONS.OPTED_OUT);

    const closed = await checkEligibility({
      id: "p1",
      status: "DO_NOT_CONTACT",
      telegramUsername: "mehdi_barber",
      publicUrl: null,
      telegramUserId: "555001",
      optedOutAt: null,
    });
    expect(closed.reason).toBe(ELIGIBILITY_REASONS.CLOSED_STATUS);
  });

  it("refuses when the contact is suppressed", async () => {
    db.users.push({ id: "u1", telegramId: "555001", telegramUsername: "mehdi_barber" });
    db.suppressions.push({ identifier: "user:555001", reason: "OPT_OUT" });

    const result = await checkEligibility({
      id: "p1",
      status: "NEW",
      telegramUsername: "mehdi_barber",
      publicUrl: null,
      telegramUserId: "555001",
      optedOutAt: null,
    });

    expect(result.canAutoSend).toBe(false);
    expect(result.reason).toBe(ELIGIBILITY_REASONS.SUPPRESSED);
  });
});

describe("sending approved invitations", () => {
  it("delivers only to eligible recipients and records confirmed delivery", async () => {
    db.prospects.push(prospect());
    db.users.push({ id: "u1", telegramId: "555001", telegramUsername: "mehdi_barber" });

    await prepareInvitations({ limit: 1 });
    db.invitations[0].status = "APPROVED";
    db.invitations[0].approvedAt = new Date();

    const outcomes = await sendApprovedInvitations({ limit: 10 });

    expect(db.deliveries).toHaveLength(1);
    expect(outcomes[0].status).toBe("DELIVERED");
    expect(db.invitations[0].status).toBe("DELIVERED");
    expect(db.invitations[0].deliveredAt).toBeInstanceOf(Date);
    expect(db.prospects[0].status).toBe("CONTACTED");
    expect(db.prospects[0].contactedCount).toBe(1);
  });

  it("skips recipients who have not started the bot and leaves them approved", async () => {
    db.prospects.push(prospect());
    // No matching User row: the invitation must stay manual.
    db.users.push({ id: "u1", telegramId: "999999", telegramUsername: "someone_else" });

    await prepareInvitations({ limit: 1 });
    db.invitations[0].status = "APPROVED";

    const outcomes = await sendApprovedInvitations({ limit: 10 });

    expect(db.deliveries).toHaveLength(0);
    expect(outcomes[0].status).toBe("SKIPPED");
    expect(db.invitations[0].status).toBe("SKIPPED");
  });

  it("does not send anything that is not approved", async () => {
    db.prospects.push(prospect());
    db.users.push({ id: "u1", telegramId: "555001", telegramUsername: "mehdi_barber" });

    await prepareInvitations({ limit: 1 });

    await sendApprovedInvitations({ limit: 10 });

    expect(db.deliveries).toHaveLength(0);
    expect(db.invitations[0].status).toBe("DRAFT");
  });

  it("suppresses a contact that blocks the bot", async () => {
    db.prospects.push(prospect());
    db.users.push({ id: "u1", telegramId: "555001", telegramUsername: "mehdi_barber" });
    db.deliveryShouldFail = true;

    await prepareInvitations({ limit: 1 });
    db.invitations[0].status = "APPROVED";

    const outcomes = await sendApprovedInvitations({ limit: 10 });

    expect(outcomes[0].status).toBe("FAILED");
    expect(db.prospects[0].status).toBe("DO_NOT_CONTACT");
  });
});

describe("opt-out", () => {
  it("records every known identifier and closes the prospect", async () => {
    db.prospects.push(prospect());

    await recordOptOut({
      telegramId: "555001",
      telegramUsername: "mehdi_barber",
      prospectId: db.prospects[0].id,
    });

    const identifiers = db.suppressions.map((row: Row) => row.identifier);
    expect(identifiers).toContain("user:555001");
    expect(identifiers).toContain("tg:mehdi_barber");
    expect(db.prospects[0].status).toBe("DO_NOT_CONTACT");
    expect(db.prospects[0].optedOutAt).toBeInstanceOf(Date);
  });

  it("stops future preparation for that prospect", async () => {
    db.prospects.push(prospect());
    await recordOptOut({ telegramUsername: "mehdi_barber" });

    const result = await prepareInvitations({ limit: 10 });

    expect(result.prepared).toHaveLength(0);
    expect(result.skipped[0].reason).toBe("suppressed");
  });
});
