import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests the rules that keep campaign outreach safe and attributable:
 *  - only VERIFIED prospects are ever eligible,
 *  - targeting is limited to the four approved cities and two segments,
 *  - a dry run writes no invitations and sends nothing,
 *  - approval requires a dry run and at least one recipient,
 *  - preparation is idempotent and respects the send limit / daily quota,
 *  - nobody who is suppressed, opted out or already pending is re-contacted.
 */

type Row = Record<string, any>;

const db = {
  campaigns: [] as Row[],
  prospects: [] as Row[],
  invitations: [] as Row[],
  templates: [] as Row[],
  suppressions: [] as Row[],
  users: [] as Row[],
  botStarts: [] as Row[],
  settings: [] as Row[],
};

vi.mock("@/lib/prisma", () => {
  const prisma = {
    outreachCampaign: {
      findUnique: async ({ where }: any) =>
        db.campaigns.find(
          (row: Row) => row.id === where.id || row.code === where.code
        ) ?? null,
      update: async ({ where, data }: any) => {
        const row = db.campaigns.find((item: Row) => item.id === where.id) as Row;
        Object.assign(row, data);
        return row;
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const row of db.invitations) {
          if (row.campaignId !== where.campaignId) continue;
          if (row.status !== where.status) continue;
          Object.assign(row, data);
          count += 1;
        }
        return { count };
      },
    },
    outreachProspect: {
      findMany: async ({ where, take }: any) => {
        let rows = db.prospects.filter((row: Row) => {
          if (where?.verificationStatus && row.verificationStatus !== where.verificationStatus)
            return false;
          if (where?.status?.in && !where.status.in.includes(row.status)) return false;
          if (where?.city?.in && !where.city.in.includes(row.city)) return false;
          if (where?.segment?.in && !where.segment.in.includes(row.segment)) return false;
          if ("optedOutAt" in (where ?? {}) && where.optedOutAt === null) {
            if (row.optedOutAt !== null) return false;
          }
          return true;
        });
        rows = rows.slice(0, take ?? rows.length);
        return rows;
      },
      findFirst: async ({ where }: any) =>
        db.prospects.find((row: Row) =>
          Object.entries(where ?? {}).every(([k, v]) => row[k] === v)
        ) ?? null,
      findUnique: async ({ where }: any) =>
        db.prospects.find((row: Row) => row.id === where.id) ?? null,
      update: async ({ where, data }: any) => {
        const row = db.prospects.find((item: Row) => item.id === where.id) as Row;
        Object.assign(row, data);
        return row;
      },
    },
    outreachInvitation: {
      findMany: async ({ where }: any) =>
        db.invitations.filter((row: Row) => {
          if (where?.status?.in) return where.status.in.includes(row.status);
          if (where?.status) return row.status === where.status;
          return true;
        }),
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
        db.invitations.filter((row: Row) => {
          if (where?.status?.in) return where.status.in.includes(row.status);
          return true;
        }).length,
    },
    invitationTemplate: {
      findUnique: async ({ where }: any) =>
        db.templates.find((row: Row) => row.id === where.id) ?? null,
      findFirst: async ({ where }: any) =>
        db.templates.find(
          (row: Row) => row.active === true && row.language === where.language
        ) ?? null,
      findMany: async ({ where }: any) =>
        db.templates.filter(
          (row: Row) =>
            row.active === true &&
            (where?.language ? row.language === where.language : true)
        ),
    },
    outreachSuppression: {
      findFirst: async ({ where }: any) =>
        db.suppressions.find((row: Row) =>
          where.identifier.in.includes(row.identifier)
        ) ?? null,
      upsert: async ({ where, create }: any) => {
        const row = db.suppressions.find(
          (item: Row) => item.identifier === where.identifier
        );
        if (row) return row;
        const created = { id: "sup-" + db.suppressions.length, ...create };
        db.suppressions.push(created);
        return created;
      },
    },
    user: {
      findUnique: async ({ where }: any) =>
        db.users.find((row: Row) => row.telegramId === where.telegramId) ?? null,
      findFirst: async ({ where }: any) =>
        db.users.find((row: Row) => row.telegramUsername === where.telegramUsername.equals) ??
        null,
    },
    adminSetting: {
      findMany: async ({ where }: any) =>
        db.settings.filter((row: Row) => where.key.in.includes(row.key)),
    },
  };
  return { prisma };
});

import {
  approveCampaign,
  dryRunCampaign,
  normalizeTargeting,
  planCampaign,
  prepareCampaign,
  type CampaignLike,
} from "@/lib/outreach/campaigns";

function baseCampaign(overrides: Partial<CampaignLike> = {}): CampaignLike {
  return {
    id: "cmp-1",
    code: "tehran-barbers",
    name: "Tehran barbershops — pilot",
    status: "DRAFT",
    cities: ["TEHRAN"],
    segments: ["MENS_BARBER"],
    language: "fa",
    objective: null,
    templateId: "tpl-1",
    cta: null,
    destinationUrl: null,
    followUpPolicy: "ONE_FOLLOWUP",
    channel: "TELEGRAM_BOT",
    sendLimit: null,
    ...overrides,
  };
}

function prospect(overrides: Partial<Row> = {}): Row {
  return {
    id: "p-" + db.prospects.length,
    publicName: "آرایشگاه مردانه نمونه",
    category: "BARBER",
    city: "TEHRAN",
    segment: "MENS_BARBER",
    neighborhood: null,
    language: "fa",
    publicUrl: "https://instagram.com/sample_barber",
    telegramUsername: null,
    verificationStatus: "VERIFIED",
    status: "NEW",
    optedOutAt: null,
    nextFollowUpAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  db.campaigns = [];
  db.prospects = [];
  db.invitations = [];
  db.templates = [];
  db.suppressions = [];
  db.users = [];
  db.botStarts = [];
  db.settings = [];

  db.templates.push({
    id: "tpl-1",
    code: "invite_fa_default",
    language: "fa",
    category: "ALL",
    active: true,
    body:
      "سلام {businessName} عزیز 👋\n\nلینک رزرو شما: {link}\n\nاگر تمایلی ندارید، اطلاع بدید.",
  });

  db.settings.push({ key: "outreach.daily_invitation_limit", value: "10" });

  // Three clean, verified Tehran barbers.
  db.prospects.push(prospect({ id: "p-1", publicName: "آرایشگاه مردانه یک" }));
  db.prospects.push(prospect({ id: "p-2", publicName: "آرایشگاه مردانه دو" }));
  db.prospects.push(prospect({ id: "p-3", publicName: "آرایشگاه مردانه سه" }));
});

describe("targeting normalisation", () => {
  it("keeps only approved cities and segments, de-duplicated", () => {
    const result = normalizeTargeting({
      cities: ["TEHRAN", "کرج", "isfahan", "tehran"],
      segments: ["MENS_BARBER", "DENTIST", "mens_barber"],
      language: "fa",
    });

    expect(result.cities).toEqual(["TEHRAN", "KARAJ"]);
    expect(result.segments).toEqual(["MENS_BARBER"]);
    expect(result.language).toBe("fa");
  });

  it("accepts Persian city names", () => {
    expect(normalizeTargeting({ cities: ["مشهد"] }).cities).toEqual(["MASHHAD"]);
    expect(normalizeTargeting({ cities: ["شیراز"] }).cities).toEqual(["SHIRAZ"]);
  });
});

describe("campaign planning", () => {
  it("counts only VERIFIED prospects as recipients", async () => {
    db.prospects.push(
      prospect({
        id: "p-9",
        publicName: "آرایشگاه مردانه کشف‌شده",
        verificationStatus: "DISCOVERED",
      })
    );

    const plan = await planCampaign(baseCampaign());

    expect(plan.matched).toBe(3);
    expect(plan.recipients.map((r) => r.prospectId).sort()).toEqual([
      "p-1",
      "p-2",
      "p-3",
    ]);
  });

  it("filters by approved city and never mixes Karaj into Tehran", async () => {
    db.prospects.push(
      prospect({ id: "p-10", publicName: "آرایشگاه مردانه کرج", city: "KARAJ" })
    );
    db.prospects.push(
      prospect({ id: "p-11", publicName: "سالن زیبایی تهران", segment: "WOMENS_SALON" })
    );

    const tehran = await planCampaign(baseCampaign({ cities: ["TEHRAN"] }));
    expect(tehran.recipients.every((r) => r.city === "TEHRAN")).toBe(true);
    expect(tehran.recipients).toHaveLength(3);

    const karaj = await planCampaign(
      baseCampaign({ cities: ["KARAJ"], segments: ["MENS_BARBER"] })
    );
    expect(karaj.recipients.map((r) => r.prospectId)).toEqual(["p-10"]);
  });

  it("filters by segment", async () => {
    db.prospects.push(
      prospect({ id: "p-12", publicName: "سالن زیبایی زنانه", segment: "WOMENS_SALON" })
    );

    const women = await planCampaign(
      baseCampaign({ segments: ["WOMENS_SALON"], cities: [] })
    );
    expect(women.recipients.map((r) => r.prospectId)).toEqual(["p-12"]);
  });

  it("reports a city x segment matrix", async () => {
    db.prospects.push(
      prospect({ id: "p-13", publicName: "سالن زیبایی مشهد", city: "MASHHAD", segment: "WOMENS_SALON" })
    );

    const plan = await planCampaign(baseCampaign({ cities: [], segments: [] }));

    const tehranMen = plan.byCitySegment.find(
      (c) => c.city === "TEHRAN" && c.segment === "MENS_BARBER"
    );
    const mashhadWomen = plan.byCitySegment.find(
      (c) => c.city === "MASHHAD" && c.segment === "WOMENS_SALON"
    );

    expect(tehranMen?.manualOnly).toBe(3);
    expect(mashhadWomen?.manualOnly).toBe(1);
  });

  it("marks someone who started the bot as ELIGIBLE and everyone else MANUAL_ONLY", async () => {
    db.prospects[0].telegramUsername = "started_owner";
    db.users.push({ id: "u-1", telegramId: "111", telegramUsername: "started_owner" });

    const plan = await planCampaign(baseCampaign());
    const byId = new Map(plan.recipients.map((r) => [r.prospectId, r]));

    expect(byId.get("p-1")?.disposition).toBe("ELIGIBLE");
    expect(byId.get("p-1")?.channel).toBe("TELEGRAM_BOT");
    expect(byId.get("p-2")?.disposition).toBe("MANUAL_ONLY");
    expect(byId.get("p-2")?.channel).toBe("MANUAL");
  });

  it("blocks suppressed prospects and never returns an opted-out one", async () => {
    // p-1 opted out: excluded by the query, so it must not appear at all.
    db.prospects[0].optedOutAt = new Date("2026-10-01");
    // p-2 and p-3 share a public URL that is on the do-not-contact list.
    db.suppressions.push({ identifier: "url:instagram.com/sample_barber" });

    const plan = await planCampaign(baseCampaign());

    const ids = [
      ...plan.recipients.map((r) => r.prospectId),
      ...plan.excluded.map((r) => r.prospectId),
    ];
    expect(ids).not.toContain("p-1");

    expect(plan.blocked).toBe(2);
    expect(plan.blockedBreakdown.suppressed).toBe(2);
    expect(plan.excluded.map((r) => r.reason)).toEqual([
      "suppressed",
      "suppressed",
    ]);
    expect(plan.recipients).toHaveLength(0);
  });

  it("holds back recipients beyond the daily quota", async () => {
    db.settings = [{ key: "outreach.daily_invitation_limit", value: "2" }];

    const plan = await planCampaign(baseCampaign());

    expect(plan.recipients).toHaveLength(2);
    expect(plan.sendLimit).toBe(2);
    expect(plan.warnings.some((w) => w.includes("exceed the send limit"))).toBe(true);
    // The held-back prospect is reported, not silently dropped.
    expect(plan.excluded.map((r) => r.reason)).toEqual(["over_send_limit"]);
  });

  it("warns when no template exists for the campaign language", async () => {
    db.templates = [];
    const plan = await planCampaign(baseCampaign());
    expect(plan.templateCode).toBeNull();
    expect(
      plan.warnings.some((w) => w.toLowerCase().includes("template"))
    ).toBe(true);
  });

  it("excludes prospects already holding a pending invitation", async () => {
    db.invitations.push({
      id: "inv-existing",
      prospectId: "p-1",
      status: "APPROVED",
      startParam: "abc",
    });

    const plan = await planCampaign(baseCampaign());

    expect(plan.recipients.map((r) => r.prospectId)).not.toContain("p-1");
    expect(
      plan.excluded.find((r) => r.prospectId === "p-1")?.reason
    ).toBe("already_pending");
  });

  it("does not re-contact a prospect before its follow-up date", async () => {
    db.prospects[0].status = "CONTACTED";
    db.prospects[0].nextFollowUpAt = new Date(Date.now() + 86_400_000);

    const plan = await planCampaign(baseCampaign());
    expect(plan.recipients.map((r) => r.prospectId)).not.toContain("p-1");
  });

  it("renders the exact message body for each recipient", async () => {
    const plan = await planCampaign(baseCampaign());
    const first = plan.recipients[0];

    expect(first.previewBody).toContain(first.publicName);
    expect(first.previewBody).toContain("t.me/");
  });
});

describe("dry run", () => {
  it("creates no invitations and sends nothing", async () => {
    db.campaigns.push(baseCampaign() as Row);

    const result = await dryRunCampaign("cmp-1", "admin-1");

    expect(result.ok).toBe(true);
    expect(db.invitations).toHaveLength(0);
    const campaign = db.campaigns[0];
    expect(campaign.lastDryRunAt).toBeInstanceOf(Date);
    expect(campaign.status).toBe("REVIEW");
  });

  it("fails for an unknown campaign", async () => {
    const result = await dryRunCampaign("nope", "admin-1");
    expect(result.ok).toBe(false);
  });
});

describe("approval", () => {
  it("refuses to approve before a dry run", async () => {
    db.campaigns.push(baseCampaign() as Row);

    const result = await approveCampaign("cmp-1", "admin-1");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/dry run/i);
  });

  it("refuses to approve a campaign that would reach nobody", async () => {
    db.prospects = [];
    db.campaigns.push(baseCampaign({ status: "REVIEW", lastDryRunAt: new Date() } as any) as Row);

    const result = await approveCampaign("cmp-1", "admin-1");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/no eligible recipients/i);
  });

  it("approves after a dry run when there is someone to reach", async () => {
    db.campaigns.push(baseCampaign({ status: "REVIEW", lastDryRunAt: new Date() } as any) as Row);

    const result = await approveCampaign("cmp-1", "admin-1");

    expect(result.ok).toBe(true);
    expect(db.campaigns[0].status).toBe("APPROVED");
    expect(db.campaigns[0].approvedById).toBe("admin-1");
    expect(db.campaigns[0].approvedAt).toBeInstanceOf(Date);
    // Approval must not send anything.
    expect(db.invitations).toHaveLength(0);
  });

  it("refuses to approve twice", async () => {
    db.campaigns.push(baseCampaign({ status: "APPROVED", lastDryRunAt: new Date() } as any) as Row);
    const result = await approveCampaign("cmp-1", "admin-1");
    expect(result.ok).toBe(false);
  });
});

describe("preparation", () => {
  it("refuses to prepare a campaign that is not approved", async () => {
    db.campaigns.push(baseCampaign({ status: "DRAFT" } as any) as Row);
    const result = await prepareCampaign("cmp-1", "admin-1");
    expect(result.ok).toBe(false);
  });

  it("creates one draft per recipient, under the quota", async () => {
    db.settings = [{ key: "outreach.daily_invitation_limit", value: "2" }];
    db.campaigns.push(baseCampaign({ status: "APPROVED", lastDryRunAt: new Date() } as any) as Row);

    const result = await prepareCampaign("cmp-1", "admin-1");

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.prepared).toBe(2);
    expect(db.invitations).toHaveLength(2);
    expect(db.invitations.every((row) => row.status === "DRAFT")).toBe(true);
  });

  it("is idempotent: a second prepare never duplicates a pending invitation", async () => {
    db.campaigns.push(baseCampaign({ status: "APPROVED", lastDryRunAt: new Date() } as any) as Row);

    const first = await prepareCampaign("cmp-1", "admin-1");
    const second = await prepareCampaign("cmp-1", "admin-1");

    expect(first.ok).toBe(true);
    if (first.ok) expect(first.prepared).toBe(3);

    // Every prospect is now pending, so the second run finds nothing to do
    // rather than creating duplicates. This is the retry-safety guarantee.
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toMatch(/no recipients to prepare/i);
    expect(db.invitations).toHaveLength(3);
  });

  it("stamps the campaign id on every invitation it creates", async () => {
    db.campaigns.push(baseCampaign({ status: "APPROVED", lastDryRunAt: new Date() } as any) as Row);

    await prepareCampaign("cmp-1", "admin-1");

    expect(db.invitations.every((row) => row.campaignId === "cmp-1")).toBe(true);
  });
});
