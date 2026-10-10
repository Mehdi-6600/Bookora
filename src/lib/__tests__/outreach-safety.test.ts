import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  consents: [] as Array<{ telegramId: string; prospectId: string | null; startedAt: Date | null; revokedAt: Date | null; lastUpdateId: number }>,
  settingsFail: false,
  auditFail: false,
  audit: [] as Array<Record<string, unknown>>,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    adminSetting: { findMany: async () => {
      if (mock.settingsFail) throw new Error("unavailable");
      return [];
    } },
    outreachInvitation: { findUnique: async ({ where }: any) =>
      where.startParam === "p-invitation" ? { prospectId: "prospect-1" } : null },
    telegramBotOptIn: {
      updateMany: async ({ where, data }: any) => {
        const rows = mock.consents.filter((r) => r.telegramId === where.telegramId &&
          (!where.lastUpdateId || r.lastUpdateId < where.lastUpdateId.lt));
        rows.forEach((row) => Object.assign(row, data));
        return { count: rows.length };
      },
      create: async ({ data }: any) => {
        if (mock.consents.some((r) => r.telegramId === data.telegramId)) throw { code: "P2002" };
        mock.consents.push(data);
        return data;
      },
      findFirst: async ({ where }: any) => mock.consents.find((row) =>
        row.prospectId === where.prospectId && row.revokedAt === null &&
        row.startedAt !== null && row.startedAt >= where.startedAt.gte) ?? null,
    },
    outreachAuditEvent: {
      create: async ({ data }: any) => {
        if (mock.auditFail) throw new Error("unavailable");
        mock.audit.push(data);
        return data;
      },
      findMany: async () => { if (mock.auditFail) throw new Error("unavailable"); return mock.audit; },
    },
  },
}));
const { recordBotStartConsent, revokeBotConsent, currentBotConsent } = await import("@/lib/outreach/bot-consent");
const { getOutreachSettings } = await import("@/lib/outreach/settings");
const { recordAuditEvent, getAuditEvents, AuditUnavailableError } = await import("@/lib/outreach/audit");

beforeEach(() => {
  mock.consents = [];
  mock.audit = [];
  mock.settingsFail = false;
  mock.auditFail = false;
});

describe("authenticated Bot API consent evidence", () => {
  const start = (updateId: number) => recordBotStartConsent({
    telegramId: "123", chatId: "123", updateId, startParam: "p-invitation",
  });
  it("binds an attributed numeric /start, ignores duplicate and older updates", async () => {
    await start(10);
    expect((await currentBotConsent("prospect-1"))?.telegramId).toBe("123");
    await revokeBotConsent("123", 11);
    await start(10);
    expect(await currentBotConsent("prospect-1")).toBeNull();
    await start(12);
    expect(await currentBotConsent("prospect-1")).not.toBeNull();
  });
  it("rejects a mismatched private chat, unaffiliated start, and revoked or stale evidence", async () => {
    await expect(recordBotStartConsent({ telegramId: "123", chatId: "456", updateId: 1 })).rejects.toThrow();
    await recordBotStartConsent({ telegramId: "123", chatId: "123", updateId: 2 });
    expect(await currentBotConsent("prospect-1")).toBeNull();
    await start(3);
    mock.consents[0].startedAt = new Date(Date.now() - 91 * 86400000);
    expect(await currentBotConsent("prospect-1")).toBeNull();
  });
});

describe("fail-closed settings and required audit", () => {
  it("does not enable outreach when settings cannot be read", async () => {
    mock.settingsFail = true;
    expect(await getOutreachSettings()).toMatchObject({ enabled: false, autoSendEnabled: false });
    expect((await getOutreachSettings()).readError).toMatch(/database/i);
  });
  it("surfaces audit write and read failures instead of returning success/empty history", async () => {
    mock.auditFail = true;
    await expect(recordAuditEvent({ scope: "campaign", action: "campaign.approved" })).rejects.toBeInstanceOf(AuditUnavailableError);
    await expect(getAuditEvents({ entityId: "campaign-1" })).rejects.toBeInstanceOf(AuditUnavailableError);
    mock.auditFail = false;
    await recordAuditEvent({ scope: "campaign", action: "campaign.approved", entityId: "campaign-1" });
    expect(mock.audit).toHaveLength(1);
  });
});
