import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Critical fix E — full recipient review before approval.
 *
 * The plan must list every matched recipient (not a truncated preview), each
 * with verification, consent, suppression, eligibility and a plain-language
 * reason, plus the exact message that would go out. Approval is blocked while
 * any recipient inside the quota is not eligible.
 */

const state = vi.hoisted(() => ({
  tables: {} as Record<string, Array<Record<string, any>>>,
  seq: 0,
}));

vi.mock("@/lib/prisma", async () => {
  const { createPrismaDouble } = await import("./helpers/prisma-double");
  return { prisma: createPrismaDouble(state) };
});

const { planCampaign, approveCampaign } = await import("@/lib/outreach/campaigns");
const { outreachSettingsRows } = await import("./helpers/outreach-settings");

function table(name: string): Array<Record<string, any>> {
  if (!state.tables[name]) state.tables[name] = [];
  return state.tables[name];
}

function campaign(overrides: Partial<any> = {}): any {
  return {
    id: "cmp-1",
    code: "pilot",
    name: "Pilot campaign",
    status: "DRAFT",
    cities: ["TEHRAN"],
    segments: ["MENS_BARBER"],
    language: "en",
    objective: null,
    templateId: "tpl-1",
    cta: "Claim your booking page",
    destinationUrl: null,
    followUpPolicy: "ONE_FOLLOWUP",
    channel: "TELEGRAM_BOT",
    sendLimit: null,
    lastDryRunAt: new Date(),
    ...overrides,
  };
}

function prospect(id: string, overrides: Record<string, any> = {}) {
  return {
    id,
    publicName: `Business ${id}`,
    category: "BARBER",
    city: "TEHRAN",
    segment: "MENS_BARBER",
    neighborhood: null,
    language: "en",
    publicUrl: null,
    telegramUsername: null,
    verificationStatus: "VERIFIED",
    status: "NEW",
    optedOutAt: null,
    nextFollowUpAt: null,
    ...overrides,
  };
}

/**
 * Ten prospects, one per interesting disposition. Two of them (unverified and
 * closed) sit outside the targetable pool by design: the pool is administrators-
 * verified, non-opted-out businesses, and that rule is documented in the plan.
 */
function seedMixedPool() {
  table("outreachProspect").push(
    prospect("p-1"),
    prospect("p-2"),
    prospect("p-3"),
    prospect("p-4", { verificationStatus: "DISCOVERED" }),
    prospect("p-5", { publicUrl: "https://instagram.com/do_not_contact" }),
    prospect("p-6", { status: "CLOSED" }),
    prospect("p-7", { telegramUsername: "blocked_owner" }),
    prospect("p-8"),
    prospect("p-9"),
    prospect("p-10")
  );
  table("outreachSuppression").push(
    { identifier: "url:instagram.com/do_not_contact" },
    { identifier: "user:777" }
  );
  // Consent for p-1, p-2, p-3, p-8 and p-9 (p-9's is revoked). p-7's consent is
  // on the do-not-contact list; p-10 never started the bot at all.
  table("telegramBotOptIn").push(
    { telegramId: "101", prospectId: "p-1", startedAt: new Date(), revokedAt: null },
    { telegramId: "102", prospectId: "p-2", startedAt: new Date(), revokedAt: null },
    { telegramId: "103", prospectId: "p-3", startedAt: new Date(), revokedAt: null },
    { telegramId: "108", prospectId: "p-8", startedAt: new Date(), revokedAt: null },
    { telegramId: "109", prospectId: "p-9", startedAt: new Date(), revokedAt: new Date() },
    { telegramId: "777", prospectId: "p-7", startedAt: new Date(), revokedAt: null }
  );
  table("invitationTemplate").push({
    id: "tpl-1",
    code: "invite_en_default",
    language: "en",
    category: "ALL",
    active: true,
    body: "Hi {businessName}, your booking link: {link}",
  });
}

beforeEach(() => {
  for (const key of Object.keys(state.tables)) delete state.tables[key];
  table("adminSetting").push(
    ...outreachSettingsRows({ "outreach.daily_invitation_limit": "10" })
  );
  table("outreachCampaign").push(campaign());
});

describe("the plan lists every matched recipient", () => {
  it("does not truncate the list to the first few", async () => {
    seedMixedPool();

    const plan = await planCampaign(campaign());

    // p-4 (unverified) and p-6 (closed) are outside the targetable pool.
    expect(plan.matched).toBe(8);
    expect(plan.recipients).toHaveLength(8);
    const ids = plan.recipients.map((r) => r.prospectId).sort();
    expect(ids).toEqual(["p-1", "p-10", "p-2", "p-3", "p-5", "p-7", "p-8", "p-9"]);
    expect(ids).not.toContain("p-4");
    expect(ids).not.toContain("p-6");
  });

  it("gives each recipient a disposition, a reason and a plain-language label", async () => {
    seedMixedPool();

    const plan = await planCampaign(campaign());
    const byId = new Map(plan.recipients.map((r) => [r.prospectId, r]));

    expect(byId.get("p-1")?.disposition).toBe("ELIGIBLE");
    expect(byId.get("p-5")?.reason).toBe("suppressed");
    expect(byId.get("p-7")?.reason).toBe("suppressed");
    // Revoked consent is never treated as consent.
    expect(byId.get("p-9")?.disposition).toBe("BLOCKED");
    expect(byId.get("p-9")?.reason).toBe("consent_revoked");
    expect(byId.get("p-9")?.reasonLabel).toMatch(/withdrew|revoked|consent/i);
    expect(byId.get("p-8")?.disposition).toBe("ELIGIBLE");
    // Verified but no bot start: reviewable, manually contactable, not automatic.
    expect(byId.get("p-10")?.disposition).toBe("MANUAL_ONLY");
    expect(byId.get("p-10")?.reason).toBe("not_started_bot");
    expect(byId.get("p-10")?.reasonLabel).toMatch(/bot|consent/i);
    expect(byId.get("p-10")?.channel).toBe("MANUAL");
    // Everyone carries the verification status the reviewer needs to see.
    expect(byId.get("p-1")?.verificationStatus).toBe("VERIFIED");
    // And a server-side evaluation timestamp, so a stale plan is detectable.
    expect(byId.get("p-1")?.checkedAt).toBeInstanceOf(Date);
  });

  it("shows the exact outgoing message and CTA for every sendable recipient", async () => {
    seedMixedPool();

    const plan = await planCampaign(campaign());
    const eligible = plan.recipients.filter((r) => r.disposition === "ELIGIBLE");

    expect(eligible).not.toHaveLength(0);
    for (const recipient of eligible) {
      expect(recipient.previewBody).toContain(recipient.publicName);
      expect(recipient.previewBody).toContain("t.me/");
      expect(recipient.cta).toBe("Claim your booking page");
      expect(recipient.channel).toBe("TELEGRAM_BOT");
    }
    // Blocked recipients have no message to send.
    const blocked = plan.recipients.filter((r) => r.disposition === "BLOCKED");
    expect(blocked.every((r) => r.previewBody === null)).toBe(true);
  });

  it("marks who is inside the send quota instead of hiding the rest", async () => {
    seedMixedPool();
    table("adminSetting").length = 0;
    table("adminSetting").push(
      ...outreachSettingsRows({ "outreach.daily_invitation_limit": "2" })
    );

    const plan = await planCampaign(campaign());

    expect(plan.recipients).toHaveLength(8);
    expect(plan.recipients.filter((r) => r.withinQuota)).toHaveLength(2);
    expect(plan.heldOver).toBe(3); // five sendable recipients, quota of two
    expect(plan.recipients.filter((r) => r.heldOver).every((r) => r.withinQuota === false)).toBe(
      true
    );
  });
});

describe("approval is blocked while eligibility is unresolved", () => {
  it("refuses a mixed batch even when most recipients are eligible", async () => {
    seedMixedPool();

    const result = await approveCampaign("cmp-1", "admin-1");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/current bot consent and eligibility/i);
      // The blocked recipient is named so the operator knows what to fix.
      expect(result.error).toMatch(/Business p-10/);
      expect(result.error).toMatch(/bot|consent/i);
    }
    expect(table("outreachCampaign")[0].status).toBe("DRAFT");
  });

  it("approves a campaign whose in-quota recipients are all eligible", async () => {
    table("outreachProspect").push(prospect("p-1"), prospect("p-2"));
    table("telegramBotOptIn").push(
      { telegramId: "101", prospectId: "p-1", startedAt: new Date(), revokedAt: null },
      { telegramId: "102", prospectId: "p-2", startedAt: new Date(), revokedAt: null }
    );
    table("invitationTemplate").push({
      id: "tpl-1",
      code: "invite_en_default",
      language: "en",
      category: "ALL",
      active: true,
      body: "Hi {businessName}, your booking link: {link}",
    });

    const result = await approveCampaign("cmp-1", "admin-1");

    expect(result.ok).toBe(true);
    expect(table("outreachCampaign")[0].status).toBe("APPROVED");
    expect(table("outreachAuditEvent")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "campaign.approved", actorUserId: "admin-1" }),
      ])
    );
  });
});
