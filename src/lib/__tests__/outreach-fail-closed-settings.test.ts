import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Critical fix A — fail-closed outreach settings.
 *
 * A settings read failure, a missing kill switch and an invalid value must all
 * resolve to "do not send", and the result has to say which one happened so the
 * administrator sees a real error instead of a silent fallback.
 */

type Row = Record<string, any>;

const state = vi.hoisted(() => ({
  settings: [] as Row[],
  readFails: false,
  prospects: [] as Row[],
  invitations: [] as Row[],
  consents: [] as Row[],
  suppressions: [] as Row[],
  audit: [] as Row[],
  gateReads: 0,
  /** Disables outreach after N kill-switch reads, to prove per-recipient re-checks. */
  disableAfter: -1,
  deliveries: [] as Array<{ id: string; text: string }>,
  seq: 0,
}));

vi.mock("@/lib/prisma", () => {
  const prisma: any = {
    adminSetting: {
      findMany: async () => {
        if (state.readFails) throw new Error("connection terminated");
        state.gateReads += 1;
        if (state.disableAfter >= 0 && state.gateReads > state.disableAfter) {
          return [{ key: "outreach.enabled", value: "false" }];
        }
        return state.settings;
      },
    },
    outreachProspect: {
      findMany: async ({ take }: any) => state.prospects.slice(0, take ?? state.prospects.length),
      findUnique: async ({ where }: any) =>
        state.prospects.find((row: Row) => row.id === where.id) ?? null,
      update: async ({ where, data }: any) => {
        Object.assign(state.prospects.find((row: Row) => row.id === where.id) as Row, data);
        return data;
      },
    },
    outreachInvitation: {
      findMany: async ({ where }: any) =>
        state.invitations.filter((row: Row) => {
          if (where?.status?.in) return where.status.in.includes(row.status);
          if (where?.status) return row.status === where.status;
          return true;
        }).map((row: Row) => ({
          ...row,
          prospect: state.prospects.find((item: Row) => item.id === row.prospectId),
          campaign: null,
        })),
      findUnique: async () => null,
      create: async ({ data }: any) => {
        const row = { id: `inv-${state.invitations.length + 1}`, ...data };
        state.invitations.push(row);
        return row;
      },
      update: async ({ where, data }: any) => {
        Object.assign(state.invitations.find((row: Row) => row.id === where.id) as Row, data);
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
    invitationTemplate: {
      findMany: async () => [
        { id: "tpl-1", code: "tpl", language: "en", category: "ALL", body: "Hi {businessName} {link}", active: true },
      ],
      findFirst: async () => null,
      findUnique: async () => null,
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

const { getOutreachSettings, currentOutreachDeliveryGate } = await import(
  "@/lib/outreach/settings"
);
const { prepareInvitations, sendApprovedInvitations } = await import(
  "@/lib/outreach/invitations"
);
const { outreachSettingsRows } = await import("./helpers/outreach-settings");

function verifiedProspect(overrides: Partial<Row> = {}): Row {
  return {
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
  };
}

beforeEach(() => {
  state.settings = outreachSettingsRows();
  state.readFails = false;
  state.prospects = [];
  state.invitations = [];
  state.consents = [];
  state.suppressions = [];
  state.audit = [];
  state.gateReads = 0;
  state.disableAfter = -1;
  state.deliveries = [];
});

describe("kill-switch semantics", () => {
  it("disables outreach when the settings store cannot be read", async () => {
    state.readFails = true;
    const settings = await getOutreachSettings();

    expect(settings.enabled).toBe(false);
    expect(settings.autoSendEnabled).toBe(false);
    expect(settings.readError).toMatch(/could not be read/i);
    expect(settings.sources).toEqual({ enabled: "error", autoSendEnabled: "error" });
    expect((await currentOutreachDeliveryGate()).ok).toBe(false);
  });

  it("disables outreach when the kill switch was never configured", async () => {
    state.settings = [];
    const settings = await getOutreachSettings();

    expect(settings.enabled).toBe(false);
    expect(settings.autoSendEnabled).toBe(false);
    expect(settings.sources).toEqual({ enabled: "default", autoSendEnabled: "default" });
    expect(settings.warnings.join(" ")).toMatch(/not configured/i);
    expect(settings.readError).toBeUndefined();
  });

  it("disables outreach for an unrecognised value instead of guessing", async () => {
    state.settings = [
      { key: "outreach.enabled", value: "yes" },
      { key: "outreach.auto_send_enabled", value: "TRUE" },
    ];
    const settings = await getOutreachSettings();

    expect(settings.enabled).toBe(false);
    expect(settings.autoSendEnabled).toBe(false);
    expect(settings.sources.enabled).toBe("default");
    expect(settings.warnings.join(" ")).toMatch(/unrecognised value/i);
  });

  it("reports a genuine configured opt-in as configured", async () => {
    const settings = await getOutreachSettings();

    expect(settings.enabled).toBe(true);
    expect(settings.autoSendEnabled).toBe(true);
    expect(settings.sources).toEqual({ enabled: "configured", autoSendEnabled: "configured" });
    expect(settings.warnings).toEqual([]);
    expect((await currentOutreachDeliveryGate()).ok).toBe(true);
  });

  it("names the switch that is off so the admin can fix the right one", async () => {
    state.settings = [
      { key: "outreach.enabled", value: "true" },
      { key: "outreach.auto_send_enabled", value: "false" },
    ];
    const gate = await currentOutreachDeliveryGate();
    expect(gate.ok).toBe(false);
    expect(gate.ok === false && gate.reason).toMatch(/auto_send_enabled/);

    state.settings = [{ key: "outreach.enabled", value: "false" }];
    const disabled = await currentOutreachDeliveryGate();
    expect(disabled.ok === false && disabled.reason).toMatch(/globally disabled/);
  });
});

describe("preparation honours the kill switch", () => {
  it("refuses to draft invitations while outreach is switched off", async () => {
    state.prospects.push(verifiedProspect());
    state.settings = [{ key: "outreach.enabled", value: "false" }];

    await expect(prepareInvitations({ limit: 5 })).rejects.toThrow(/globally disabled/i);
    expect(state.invitations).toHaveLength(0);
  });

  it("refuses to draft invitations when the settings store is unreadable", async () => {
    state.prospects.push(verifiedProspect());
    state.readFails = true;

    await expect(prepareInvitations({ limit: 5 })).rejects.toThrow(/could not be read/i);
    expect(state.invitations).toHaveLength(0);
  });
});

describe("delivery re-checks the kill switch per recipient", () => {
  beforeEach(() => {
    state.prospects.push(verifiedProspect({ id: "p-1" }), verifiedProspect({ id: "p-2" }));
    state.consents.push(
      { telegramId: "111", prospectId: "p-1", startedAt: new Date(), revokedAt: null },
      { telegramId: "222", prospectId: "p-2", startedAt: new Date(), revokedAt: null }
    );
    state.invitations.push(
      { id: "inv-1", prospectId: "p-1", status: "APPROVED", body: "one", campaignId: null },
      { id: "inv-2", prospectId: "p-2", status: "APPROVED", body: "two", campaignId: null }
    );
  });

  it("sends nothing at all when the switch is already off", async () => {
    state.settings = [{ key: "outreach.enabled", value: "false" }];

    await expect(sendApprovedInvitations({ limit: 10 })).rejects.toThrow(/globally disabled/i);
    expect(state.deliveries).toHaveLength(0);
  });

  it("stops mid-batch when the switch is turned off after the first message", async () => {
    // Read 1: batch gate. Reads 2-3: recipient one (policy + gate). Read 4: off.
    state.disableAfter = 3;

    const outcomes = await sendApprovedInvitations({ limit: 10 });

    expect(state.deliveries).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "DELIVERED")).toHaveLength(1);
    expect(outcomes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ invitationId: "inv-2", status: "SKIPPED", reason: "outreach_paused" }),
      ])
    );
    // The second invitation stays APPROVED: a paused switch is a configuration
    // state, not a fact about the recipient, and the pause is audited.
    expect(state.invitations.find((row: Row) => row.id === "inv-2")?.status).toBe("APPROVED");
    expect(state.audit).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "invitation.delivery_paused", detail: "reason=outreach_paused" }),
      ])
    );
  });
});
