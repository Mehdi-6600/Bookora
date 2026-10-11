import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Critical fix — the race between a withdrawn consent and the outbound send.
 *
 * `evaluateOutreachPolicy` runs in its own transaction, and the message is
 * sent after a second transaction claims the invitation. A /stop that lands in
 * between used to be invisible: the delivery still went out.
 *
 * These tests drive `sendApprovedInvitations` with an in-memory double and
 * inject the withdrawal at the exact points that matter. No Telegram call and
 * no database is involved: `deliverTelegramMessage` is mocked and records what
 * it *would* have sent.
 */

type Row = Record<string, any>;

const state = vi.hoisted(() => ({
  settings: [] as Row[],
  prospects: [] as Row[],
  invitations: [] as Row[],
  consents: [] as Row[],
  suppressions: [] as Row[],
  audit: [] as Row[],
  deliveries: [] as Array<{ id: string; text: string }>,
  /**
   * Consent reads are counted. Once `consentFailAfter` reads have succeeded,
   * every later read throws, so a failure can be injected into the final gate
   * only (after the eligibility check has already passed).
   */
  consentFinds: 0,
  consentFailAfter: -1,
  suppressionFinds: 0,
  suppressionFailAfter: -1,
  /** Runs at the moment the delivery is claimed, i.e. after the eligibility check. */
  onClaim: null as null | (() => void),
}));

vi.mock("@/lib/prisma", () => {
  const prisma: any = {
    adminSetting: {
      findMany: async () => state.settings,
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
      updateMany: async ({ where, data }: any) => {
        const rows = state.prospects.filter((row: Row) => row.id === where?.id);
        rows.forEach((row: Row) => Object.assign(row, data));
        return { count: rows.length };
      },
    },
    outreachInvitation: {
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
            campaign: null,
          })),
      findUnique: async ({ where }: any) =>
        state.invitations.find((row: Row) => row.id === where?.id) ?? null,
      create: async ({ data }: any) => {
        const row = { id: `inv-${state.invitations.length + 1}`, ...data };
        state.invitations.push(row);
        return row;
      },
      update: async ({ where, data }: any) => {
        Object.assign(
          state.invitations.find((row: Row) => row.id === where.id) as Row,
          data
        );
        return data;
      },
      updateMany: async ({ where, data }: any) => {
        // The claim is the update that moves an APPROVED invitation to SENDING.
        if (where?.status === "APPROVED" && data?.status === "SENDING") {
          state.onClaim?.();
        }
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
        state.consentFinds += 1;
        if (
          state.consentFailAfter >= 0 &&
          state.consentFinds > state.consentFailAfter
        ) {
          throw new Error("relation \"telegram_bot_opt_ins\" does not exist");
        }
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
        const rows = state.consents.filter(
          (row: Row) => row.telegramId === where?.telegramId
        );
        rows.forEach((row: Row) => Object.assign(row, data));
        return { count: rows.length };
      },
    },
    outreachSuppression: {
      findFirst: async ({ where }: any) => {
        state.suppressionFinds += 1;
        if (
          state.suppressionFailAfter >= 0 &&
          state.suppressionFinds > state.suppressionFailAfter
        ) {
          throw new Error("relation \"outreach_suppressions\" does not exist");
        }
        return (
          state.suppressions.find((row: Row) =>
            where.identifier.in.includes(row.identifier)
          ) ?? null
        );
      },
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

function seed(overrides: Partial<Row> = {}) {
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
    ...overrides,
  });
  state.invitations.push({
    id: "inv-1",
    prospectId: "p-1",
    campaignId: null,
    status: "APPROVED",
    approvedAt: new Date(),
    body: "hello",
    startParam: "abc",
    deepLink: "https://t.me/BookoraBot?start=abc",
  });
}

function validConsent(overrides: Partial<Row> = {}) {
  state.consents.push({
    telegramId: TELEGRAM_ID,
    prospectId: "p-1",
    startedAt: new Date(),
    revokedAt: null,
    lastUpdateId: 500,
    ...overrides,
  });
}

beforeEach(() => {
  state.settings = outreachSettingsRows();
  state.prospects = [];
  state.invitations = [];
  state.consents = [];
  state.suppressions = [];
  state.audit = [];
  state.deliveries = [];
  state.consentFinds = 0;
  state.consentFailAfter = -1;
  state.suppressionFinds = 0;
  state.suppressionFailAfter = -1;
  state.onClaim = null;
});

describe("a consent withdrawal between the eligibility check and the send", () => {
  it("sends nothing when /stop revokes the consent after the check passed", async () => {
    seed();
    validConsent();
    state.onClaim = () => {
      state.consents[0].revokedAt = new Date();
    };

    const outcomes = await sendApprovedInvitations({ limit: 10 });

    expect(state.deliveries).toHaveLength(0);
    expect(outcomes).toEqual([
      { invitationId: "inv-1", status: "SKIPPED", reason: "consent_revoked" },
    ]);
    // Terminal for automated delivery, and never left mid-flight.
    expect(state.invitations[0].status).toBe("SKIPPED");
    expect(state.invitations[0].failureReason).toBe("consent_revoked");
    expect(
      state.audit.some((row: Row) => row.action === "invitation.delivery_started")
    ).toBe(false);
    expect(state.audit).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "invitation.skipped",
          detail: "reason=consent_revoked",
        }),
      ])
    );
  });

  it("sends nothing when /stop adds a do-not-contact entry after the check passed", async () => {
    seed();
    validConsent();
    state.onClaim = () => {
      state.suppressions.push({ identifier: `user:${TELEGRAM_ID}` });
    };

    const outcomes = await sendApprovedInvitations({ limit: 10 });

    expect(state.deliveries).toHaveLength(0);
    expect(outcomes[0]).toMatchObject({
      status: "SKIPPED",
      reason: "suppressed",
    });
    expect(state.invitations[0].status).toBe("SKIPPED");
  });

  it("sends nothing when the consent expires between the check and the send", async () => {
    seed();
    validConsent();
    state.onClaim = () => {
      state.consents[0].startedAt = new Date(Date.now() - 91 * 86400000);
    };

    const outcomes = await sendApprovedInvitations({ limit: 10 });

    expect(state.deliveries).toHaveLength(0);
    expect(outcomes[0]).toMatchObject({
      status: "SKIPPED",
      reason: "consent_expired",
    });
  });

  it("does not leave the invitation stuck in SENDING when the final gate refuses", async () => {
    seed();
    validConsent();
    state.onClaim = () => {
      state.consents[0].revokedAt = new Date();
    };

    await sendApprovedInvitations({ limit: 10 });

    expect(["SKIPPED", "APPROVED"]).toContain(state.invitations[0].status);
  });
});

describe("unreadable consent and do-not-contact state", () => {
  it("sends nothing and names the reason when the consent table cannot be read at all", async () => {
    seed();
    validConsent();
    state.consentFailAfter = 0; // the very first read fails

    // Fail-closed, per recipient: the read error no longer escapes and aborts
    // the whole run, it resolves to a stated reason for this invitation.
    const outcomes = await sendApprovedInvitations({ limit: 10 });

    expect(state.deliveries).toHaveLength(0);
    expect(outcomes[0]).toMatchObject({
      status: "SKIPPED",
      reason: "consent_unavailable",
    });
    expect(state.invitations[0].status).toBe("SKIPPED");
  });

  it("never reports an unreadable consent as 'no consent' or as eligible", async () => {
    seed();
    validConsent();
    state.consentFailAfter = 0;

    const outcomes = await sendApprovedInvitations({ limit: 10 });

    // The reason is specific on purpose. `not_started_bot` would tell an
    // administrator "this person never consented", which is not what was
    // observed — the consent simply could not be read. `ok` would arm
    // automated delivery, which is the one thing that must never happen.
    expect(outcomes[0].reason).not.toBe("not_started_bot");
    expect(outcomes[0].reason).not.toBe("consent_revoked");
    expect(outcomes[0].reason).not.toBe("ok");
    expect(outcomes[0]).toMatchObject({ status: "SKIPPED" });
  });

  it("skips every recipient when the consent table stays unreadable", async () => {
    seed();
    validConsent();
    // A second, equally eligible recipient.
    state.prospects.push({ ...state.prospects[0], id: "p-2" });
    state.invitations.push({
      ...state.invitations[0],
      id: "inv-2",
      prospectId: "p-2",
    });
    state.consents.push({ ...state.consents[0], prospectId: "p-2" });
    state.consentFailAfter = 0;

    const outcomes = await sendApprovedInvitations({ limit: 10 });

    // The safe stop, at batch level: a consent table that is down sends to
    // nobody at all, not just to the first recipient whose read failed.
    expect(state.deliveries).toHaveLength(0);
    expect(outcomes).toHaveLength(2);
    expect(outcomes.every((outcome) => outcome.status === "SKIPPED")).toBe(true);
    expect(
      outcomes.every((outcome) => outcome.reason === "consent_unavailable")
    ).toBe(true);
  });

  it("sends nothing when consent becomes unreadable at the final gate", async () => {
    seed();
    validConsent();
    state.consentFailAfter = 1; // eligibility passes, the final read fails

    const outcomes = await sendApprovedInvitations({ limit: 10 });

    expect(state.deliveries).toHaveLength(0);
    expect(outcomes[0]).toMatchObject({
      status: "SKIPPED",
      reason: "consent_unavailable",
    });
    expect(state.invitations[0].status).toBe("SKIPPED");
  });

  it("sends nothing when the do-not-contact list cannot be read", async () => {
    seed();
    validConsent();
    state.suppressionFailAfter = 0;

    const outcomes = await sendApprovedInvitations({ limit: 10 });

    expect(state.deliveries).toHaveLength(0);
    expect(outcomes[0]).toMatchObject({
      status: "SKIPPED",
      reason: "suppression_unavailable",
    });
  });

  it("sends nothing when the do-not-contact list fails only at the final gate", async () => {
    seed();
    validConsent();
    state.suppressionFailAfter = 1;

    const outcomes = await sendApprovedInvitations({ limit: 10 });

    expect(state.deliveries).toHaveLength(0);
    expect(outcomes[0]).toMatchObject({
      status: "SKIPPED",
      reason: "suppression_unavailable",
    });
  });
});

describe("zero messages for every invalid consent state", () => {
  const cases: Array<{ name: string; consent: Row | null; reason: string }> = [
    { name: "no consent row at all", consent: null, reason: "not_started_bot" },
    {
      name: "consent revoked",
      consent: { revokedAt: new Date() },
      reason: "consent_revoked",
    },
    {
      name: "consent older than 90 days",
      consent: { startedAt: new Date(Date.now() - 91 * 86400000) },
      reason: "consent_expired",
    },
    {
      name: "non-numeric telegram id",
      consent: { telegramId: "not-a-number" },
      reason: "no_telegram_id",
    },
    {
      name: "consent bound to another prospect",
      consent: { prospectId: "p-other" },
      reason: "not_started_bot",
    },
    {
      name: "consent with no start timestamp",
      consent: { startedAt: null },
      reason: "consent_expired",
    },
  ];

  for (const testCase of cases) {
    it(`sends nothing when the consent is ${testCase.name}`, async () => {
      seed();
      if (testCase.consent) validConsent(testCase.consent);

      const outcomes = await sendApprovedInvitations({ limit: 10 });

      expect(state.deliveries).toHaveLength(0);
      expect(outcomes[0]).toMatchObject({
        status: "SKIPPED",
        reason: testCase.reason,
      });
      expect(state.invitations[0].status).toBe("SKIPPED");
    });
  }
});

describe("the fix does not block a legitimate send", () => {
  it("still delivers to a recipient with current, unrevoked consent", async () => {
    seed();
    validConsent();

    const outcomes = await sendApprovedInvitations({ limit: 10 });

    expect(state.deliveries).toEqual([
      { id: TELEGRAM_ID, text: "hello" },
    ]);
    expect(outcomes[0]).toMatchObject({ status: "DELIVERED" });
    expect(state.invitations[0].status).toBe("DELIVERED");
    expect(state.audit).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "invitation.delivery_started" }),
      ])
    );
  });
});
