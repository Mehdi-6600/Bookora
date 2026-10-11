import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Critical fix C — verifiable Telegram bot opt-in.
 *
 * Only a secret-token-authenticated private Bot API /start may create outreach
 * consent. Mini App authentication, a username match and prospect verification
 * are all explicitly NOT consent. No real Telegram traffic is generated: the
 * Bot API calls are intercepted by a grammy transformer.
 */

const state = vi.hoisted(() => ({
  tables: {} as Record<string, Array<Record<string, any>>>,
  seq: 0,
  apiCalls: [] as Array<{ method: string; payload: any }>,
}));

vi.mock("@/lib/prisma", async () => {
  const { createPrismaDouble } = await import("./helpers/prisma-double");
  return { prisma: createPrismaDouble(state) };
});

const SECRET = "t".repeat(40);

/**
 * Makes the bot usable offline: a known `botInfo` stops grammY from calling
 * `getMe`, and the transformer intercepts every API call, so no request — let
 * alone a message — can reach Telegram.
 */
function offlineBot(bot: any) {
  bot.botInfo = {
    id: 1,
    is_bot: true,
    first_name: "Bookora",
    username: "BookoraBot",
    can_join_groups: true,
    can_read_all_group_messages: false,
    supports_inline_queries: false,
  };
  // A grammY transformer answers the call itself: `(prev, method, payload)`
  // must resolve to the `{ ok, result }` envelope, so nothing reaches Telegram.
  bot.api.config.use((previous: any, method: string, payload: any) => {
    state.apiCalls.push({ method, payload });
    if (method === "sendMessage") {
      return Promise.resolve({
        ok: true,
        result: {
          message_id: 1,
          date: 0,
          chat: { id: 555001, type: "private" },
          text: "",
        },
      }) as any;
    }
    return Promise.resolve({ ok: true, result: true }) as any;
  });
  return bot;
}

function table(name: string): Array<Record<string, any>> {
  if (!state.tables[name]) state.tables[name] = [];
  return state.tables[name];
}

async function loadWebhookRoute() {
  vi.resetModules();
  const module = await import("@/app/api/telegram/webhook/route");
  const { getBot } = await import("@/lib/telegram/bot");
  return { POST: module.POST, getBot };
}

function webhookRequest(update: unknown, secret?: string): NextRequest {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (secret !== undefined) headers["x-telegram-bot-api-secret-token"] = secret;
  return new NextRequest(new URL("/api/telegram/webhook", "https://app.test"), {
    method: "POST",
    headers,
    body: JSON.stringify(update),
  });
}

function privateStart(updateId: number, startParam?: string, chatId = 555001) {
  const text = startParam ? `/start ${startParam}` : "/start";
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      date: 0,
      chat: { id: chatId, type: "private", first_name: "Owner" },
      from: { id: 555001, is_bot: false, first_name: "Owner" },
      text,
      // grammY only treats the message as a command when Telegram reports the
      // bot_command entity, so a realistic update has to carry it.
      entities: [{ type: "bot_command", offset: 0, length: text.split(" ")[0].length }],
    },
  };
}

function privateStop(updateId: number) {
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      date: 0,
      chat: { id: 555001, type: "private", first_name: "Owner" },
      from: { id: 555001, is_bot: false, first_name: "Owner" },
      text: "/stop",
      entities: [{ type: "bot_command", offset: 0, length: 5 }],
    },
  };
}

async function seedAttributedInvitation() {
  table("outreachProspect").push({
    id: "prospect-1",
    publicName: "Sample Barber",
    dedupeKey: "name:sample",
    verificationStatus: "VERIFIED",
    status: "NEW",
    optedOutAt: null,
  });
  table("outreachInvitation").push({
    id: "invitation-1",
    prospectId: "prospect-1",
    startParam: "p-invite123",
    status: "DRAFT",
    body: "hello",
    deepLink: "https://t.me/BookoraBot?start=p-invite123",
  });
  table("adminSetting").push(
    { key: "outreach.enabled", value: "true" },
    { key: "outreach.auto_send_enabled", value: "true" }
  );
}

beforeEach(() => {
  for (const key of Object.keys(state.tables)) delete state.tables[key];
  state.seq = 0;
  state.apiCalls = [];
  vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", SECRET);
});

describe("webhook authentication", () => {
  it("refuses every request when no secret token is configured", async () => {
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", undefined);
    const { POST } = await loadWebhookRoute();

    const response = await POST(webhookRequest(privateStart(1), SECRET));

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: expect.stringMatching(/not configured/i) });
    expect(table("telegramBotOptIn")).toHaveLength(0);
  });

  it("rejects a missing or incorrect secret token before touching the handlers", async () => {
    const { POST, getBot } = await loadWebhookRoute();
    getBot();
    await seedAttributedInvitation();

    const missing = await POST(webhookRequest(privateStart(1)));
    expect(missing.status).toBe(401);

    const wrong = await POST(webhookRequest(privateStart(2), "x".repeat(40)));
    expect(wrong.status).toBe(401);

    expect(table("telegramBotOptIn")).toHaveLength(0);
    expect(state.apiCalls).toHaveLength(0);
  });
});

describe("bot start consent", () => {
  it("records consent, the numeric id and the attribution for a genuine private /start", async () => {
    const { POST, getBot } = await loadWebhookRoute();
    const bot = offlineBot(getBot());
    await seedAttributedInvitation();

    const response = await POST(webhookRequest(privateStart(10, "p-invite123"), SECRET));

    expect(response.status).toBe(200);
    const [consent] = table("telegramBotOptIn");
    expect(consent).toMatchObject({
      telegramId: "555001",
      prospectId: "prospect-1",
      revokedAt: null,
      lastUpdateId: 10,
    });
    expect(consent.startedAt).toBeInstanceOf(Date);
    // The prospect is advanced, and the attribution row is written once.
    expect(table("botStart")).toHaveLength(1);
    expect(table("botStart")[0]).toMatchObject({ telegramId: "555001", prospectId: "prospect-1" });
    // Only the welcome reply goes out — never an unsolicited outreach message.
    expect(state.apiCalls.map((call) => call.method)).toEqual(["sendMessage"]);
  });

  it("is idempotent for a duplicated webhook delivery and ignores an older update", async () => {
    const { POST, getBot } = await loadWebhookRoute();
    const bot = offlineBot(getBot());
    await seedAttributedInvitation();

    const first = await POST(webhookRequest(privateStart(20, "p-invite123"), SECRET));
    const replay = await POST(webhookRequest(privateStart(20, "p-invite123"), SECRET));

    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(table("telegramBotOptIn")).toHaveLength(1);
    expect(table("botStart")).toHaveLength(1);

    // An out-of-order retry of an older update must not overwrite the newer one.
    await POST(webhookRequest(privateStart(19, "p-invite123"), SECRET));
    expect(table("telegramBotOptIn")[0].lastUpdateId).toBe(20);
  });

  it("never records consent for a group chat or a mismatched chat id", async () => {
    const { POST, getBot } = await loadWebhookRoute();
    const bot = offlineBot(getBot());
    await seedAttributedInvitation();

    const group = await POST(
      webhookRequest(privateStart(30, "p-invite123", -1001234567890), SECRET)
    );

    expect(group.status).toBe(200);
    expect(table("telegramBotOptIn")).toHaveLength(0);
  });

  it("does not bind consent when the start parameter is not an invitation", async () => {
    const { POST, getBot } = await loadWebhookRoute();
    const bot = offlineBot(getBot());
    await seedAttributedInvitation();

    await POST(webhookRequest(privateStart(40), SECRET));
    await POST(webhookRequest(privateStart(41, "c-campaign"), SECRET));

    // Consent exists for the person, but it is not bound to any prospect, so
    // no outreach can be addressed to them.
    expect(table("telegramBotOptIn")).toHaveLength(1);
    expect(table("telegramBotOptIn")[0].prospectId).toBeNull();
  });

  it("revokes consent and suppresses the contact on /stop", async () => {
    const { POST, getBot } = await loadWebhookRoute();
    const bot = offlineBot(getBot());
    await seedAttributedInvitation();

    await POST(webhookRequest(privateStart(50, "p-invite123"), SECRET));
    await POST(webhookRequest(privateStop(51), SECRET));

    expect(table("telegramBotOptIn")[0].revokedAt).toBeInstanceOf(Date);
    expect(table("outreachSuppression")).toEqual(
      expect.arrayContaining([expect.objectContaining({ identifier: "user:555001" })])
    );
    expect(table("outreachAuditEvent")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "prospect.opted_out", detail: expect.stringContaining("source=telegram_stop") }),
      ])
    );
  });

  it("acknowledges a permanently invalid update without retrying it forever", async () => {
    const { POST, getBot } = await loadWebhookRoute();
    const bot = offlineBot(getBot());

    const invalid = {
      update_id: 60,
      message: {
        message_id: 60,
        date: 0,
        chat: { id: 1, type: "private" },
        from: { id: 555001, is_bot: false, first_name: "Owner" },
        text: "/start p-invite123",
      },
    };

    const response = await POST(webhookRequest(invalid, SECRET));

    // chat id !== user id: rejected, but acknowledged so Telegram stops retrying.
    expect(response.status).toBe(200);
    expect(table("telegramBotOptIn")).toHaveLength(0);
  });
});

describe("consent drives eligibility", () => {
  it("makes a verified prospect sendable only after a genuine /start", async () => {
    const { POST, getBot } = await loadWebhookRoute();
    const bot = offlineBot(getBot());
    await seedAttributedInvitation();
    const { evaluateOutreachPolicy } = await import("@/lib/outreach/policy");

    const before = await evaluateOutreachPolicy({
      id: "prospect-1",
      status: "NEW",
      verificationStatus: "VERIFIED",
      telegramUsername: null,
      publicUrl: null,
      optedOutAt: null,
    });
    expect(before.decision).toBe("MANUAL_ONLY");
    expect(before.reason).toBe("not_started_bot");

    await POST(webhookRequest(privateStart(70, "p-invite123"), SECRET));

    const after = await evaluateOutreachPolicy({
      id: "prospect-1",
      status: "NEW",
      verificationStatus: "VERIFIED",
      telegramUsername: null,
      publicUrl: null,
      optedOutAt: null,
    });
    expect(after.decision).toBe("ELIGIBLE");
    expect(after.telegramUserId).toBe("555001");

    await POST(webhookRequest(privateStop(71), SECRET));

    const revoked = await evaluateOutreachPolicy({
      id: "prospect-1",
      status: "NEW",
      verificationStatus: "VERIFIED",
      telegramUsername: null,
      publicUrl: null,
      optedOutAt: null,
    });
    expect(revoked.decision).toBe("BLOCKED");
    // The do-not-contact entry written by /stop is reported first.
    expect(["consent_revoked", "suppressed"]).toContain(revoked.reason);
  });
});
