import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Critical fix — concurrent processing of Telegram updates.
 *
 * Two webhook deliveries can be in flight at the same time (Telegram retries,
 * a second update arriving while the first is still being written). These
 * tests drive the real webhook route with the real handlers and force the
 * interleaving that a sequential test can never reach: the insert is delayed
 * by one tick so both deliveries observe "no row yet" and race on `create`.
 *
 * Nothing reaches Telegram: a grammY transformer answers every API call inside
 * the process.
 */

const state = vi.hoisted(() => ({
  tables: {} as Record<string, Array<Record<string, any>>>,
  seq: 0,
  apiCalls: [] as Array<{ method: string; payload: any }>,
}));

vi.mock("@prisma/client", () => import("./helpers/prisma-client-stub"));

vi.mock("@/lib/prisma", async () => {
  const { createPrismaDouble } = await import("./helpers/prisma-double");
  return { prisma: createPrismaDouble(state) };
});

const SECRET = "t".repeat(40);

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

function privateStart(updateId: number, startParam?: string) {
  const text = startParam ? `/start ${startParam}` : "/start";
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      date: 0,
      chat: { id: 555001, type: "private", first_name: "Owner" },
      from: { id: 555001, is_bot: false, first_name: "Owner" },
      text,
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

function seedAttributedInvitation() {
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
}

/** Yield once so two in-flight deliveries interleave inside `create`. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

type Restore = () => void;

/**
 * Delay a delegate's `create` by one tick, so two concurrent webhook
 * deliveries both pass their "does a row exist?" read before either inserts.
 */
async function delayCreate(model: string): Promise<Restore> {
  const { prisma } = await import("@/lib/prisma");
  const delegate = (prisma as any)[model];
  const original = delegate.create.bind(delegate);
  delegate.create = async (args: any) => {
    await tick();
    return original(args);
  };
  return () => {
    delegate.create = original;
  };
}

async function failCreate(model: string, message: string): Promise<Restore> {
  const { prisma } = await import("@/lib/prisma");
  const delegate = (prisma as any)[model];
  const original = delegate.create.bind(delegate);
  delegate.create = async () => {
    throw new Error(message);
  };
  return () => {
    delegate.create = original;
  };
}

let restores: Restore[] = [];

beforeEach(() => {
  for (const key of Object.keys(state.tables)) delete state.tables[key];
  state.seq = 0;
  state.apiCalls = [];
  restores = [];
  vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", SECRET);
});

afterEach(() => {
  restores.forEach((restore) => restore());
  restores = [];
});

describe("concurrent /start and /stop", () => {
  it("keeps the consent revoked whichever order the two updates are written in", async () => {
    const { POST, getBot } = await loadWebhookRoute();
    offlineBot(getBot());
    await seedAttributedInvitation();
    restores.push(await delayCreate("telegramBotOptIn"));

    // The stop carries the higher update id, so it must win in both orderings.
    const [startResponse, stopResponse] = await Promise.all([
      POST(webhookRequest(privateStart(101, "p-invite123"), SECRET)),
      POST(webhookRequest(privateStop(102), SECRET)),
    ]);

    expect(startResponse.status).toBe(200);
    expect(stopResponse.status).toBe(200);

    const consents = table("telegramBotOptIn");
    expect(consents).toHaveLength(1);
    expect(consents[0].revokedAt).toBeInstanceOf(Date);
    expect(consents[0].lastUpdateId).toBe(102);
  });

  it("lets a newer /start re-consent after an older /stop, in either order", async () => {
    const { POST, getBot } = await loadWebhookRoute();
    offlineBot(getBot());
    await seedAttributedInvitation();
    restores.push(await delayCreate("telegramBotOptIn"));

    const [stopResponse, startResponse] = await Promise.all([
      POST(webhookRequest(privateStop(101), SECRET)),
      POST(webhookRequest(privateStart(102, "p-invite123"), SECRET)),
    ]);

    expect(stopResponse.status).toBe(200);
    expect(startResponse.status).toBe(200);

    const consents = table("telegramBotOptIn");
    expect(consents).toHaveLength(1);
    expect(consents[0].revokedAt).toBeNull();
    expect(consents[0].startedAt).toBeInstanceOf(Date);
    expect(consents[0].lastUpdateId).toBe(102);
  });

  it("never lets a replayed /start resurrect a consent a newer /stop withdrew", async () => {
    const { POST, getBot } = await loadWebhookRoute();
    offlineBot(getBot());
    await seedAttributedInvitation();

    await POST(webhookRequest(privateStart(10, "p-invite123"), SECRET));
    await POST(webhookRequest(privateStop(11), SECRET));
    // Replay of the older start, then an out-of-order retry with the same id.
    await POST(webhookRequest(privateStart(10, "p-invite123"), SECRET));
    await POST(webhookRequest(privateStart(10, "p-invite123"), SECRET));

    const consents = table("telegramBotOptIn");
    expect(consents).toHaveLength(1);
    expect(consents[0].revokedAt).toBeInstanceOf(Date);
    expect(consents[0].lastUpdateId).toBe(11);
  });
});

describe("concurrent duplicate delivery of one update", () => {
  it("records one consent row and one attributed start", async () => {
    const { POST, getBot } = await loadWebhookRoute();
    offlineBot(getBot());
    await seedAttributedInvitation();
    restores.push(await delayCreate("telegramBotOptIn"));
    restores.push(await delayCreate("botStart"));

    const [first, replay] = await Promise.all([
      POST(webhookRequest(privateStart(200, "p-invite123"), SECRET)),
      POST(webhookRequest(privateStart(200, "p-invite123"), SECRET)),
    ]);

    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);

    const consents = table("telegramBotOptIn");
    expect(consents).toHaveLength(1);
    expect(consents[0].lastUpdateId).toBe(200);
    expect(consents[0].revokedAt).toBeNull();

    // Attribution is idempotent for the same (telegramId, startParam) even when
    // both deliveries reach the insert.
    expect(table("botStart")).toHaveLength(1);
    expect(table("botStart")[0]).toMatchObject({
      telegramId: "555001",
      prospectId: "prospect-1",
      startParam: "p-invite123",
      // Proves the handler forwards `ctx.update.update_id`, not just the
      // deep link: without it the update-id key would be NULL and a /start
      // without a startParam could not be de-duplicated at all.
      updateId: 200,
    });
  });

  it("does not duplicate attribution when the same start is replayed sequentially", async () => {
    const { POST, getBot } = await loadWebhookRoute();
    offlineBot(getBot());
    await seedAttributedInvitation();

    await POST(webhookRequest(privateStart(300, "p-invite123"), SECRET));
    await POST(webhookRequest(privateStart(300, "p-invite123"), SECRET));
    await POST(webhookRequest(privateStart(301, "p-invite123"), SECRET));

    expect(table("telegramBotOptIn")).toHaveLength(1);
    expect(table("botStart")).toHaveLength(1);
    expect(table("telegramBotOptIn")[0].lastUpdateId).toBe(301);
  });
});

describe("a /start without a deep link", () => {
  it("records one attributed start when the same update is replayed concurrently", async () => {
    const { POST, getBot } = await loadWebhookRoute();
    offlineBot(getBot());
    restores.push(await delayCreate("botStart"));

    const [first, replay] = await Promise.all([
      POST(webhookRequest(privateStart(500), SECRET)),
      POST(webhookRequest(privateStart(500), SECRET)),
    ]);

    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);

    // `startParam` is NULL here, so `bot_starts_telegramId_startParam_key`
    // cannot de-duplicate this. Only the update id can.
    expect(table("botStart")).toHaveLength(1);
    expect(table("botStart")[0]).toMatchObject({
      telegramId: "555001",
      startParam: null,
      updateId: 500,
    });
  });

  it("records one attributed start when the same update is replayed sequentially", async () => {
    const { POST, getBot } = await loadWebhookRoute();
    offlineBot(getBot());

    await POST(webhookRequest(privateStart(500), SECRET));
    await POST(webhookRequest(privateStart(500), SECRET));

    expect(table("botStart")).toHaveLength(1);
  });

  it("still counts two separate /start commands", async () => {
    const { POST, getBot } = await loadWebhookRoute();
    offlineBot(getBot());

    // Different update ids are different events. De-duplicating these would
    // understate real activity, which is the opposite failure to a replay.
    await POST(webhookRequest(privateStart(500), SECRET));
    await POST(webhookRequest(privateStart(501), SECRET));

    expect(table("botStart")).toHaveLength(2);
    expect(table("botStart").map((row) => row.updateId)).toEqual([500, 501]);
  });
});

describe("a failing side write must not hide a recorded consent", () => {
  it("keeps the consent when the attribution write fails", async () => {
    const { POST, getBot } = await loadWebhookRoute();
    offlineBot(getBot());
    await seedAttributedInvitation();
    restores.push(await failCreate("botStart", "attribution table unavailable"));

    const response = await POST(
      webhookRequest(privateStart(400, "p-invite123"), SECRET)
    );

    expect(response.status).toBe(200);
    const consents = table("telegramBotOptIn");
    expect(consents).toHaveLength(1);
    expect(consents[0].revokedAt).toBeNull();
    expect(consents[0].prospectId).toBe("prospect-1");
    expect(table("botStart")).toHaveLength(0);
  });

  it("keeps the consent when the audit write fails", async () => {
    const { POST, getBot } = await loadWebhookRoute();
    offlineBot(getBot());
    await seedAttributedInvitation();
    restores.push(
      await failCreate("outreachAuditEvent", "audit table unavailable")
    );

    const response = await POST(
      webhookRequest(privateStart(500, "p-invite123"), SECRET)
    );

    expect(response.status).toBe(200);
    const consents = table("telegramBotOptIn");
    expect(consents).toHaveLength(1);
    expect(consents[0].revokedAt).toBeNull();
    expect(table("outreachAuditEvent")).toHaveLength(0);
  });

  it("still records the withdrawal itself when the audit write fails on /stop", async () => {
    const { POST, getBot } = await loadWebhookRoute();
    offlineBot(getBot());
    await seedAttributedInvitation();
    await POST(webhookRequest(privateStart(600, "p-invite123"), SECRET));

    restores.push(
      await failCreate("outreachAuditEvent", "audit table unavailable")
    );
    const response = await POST(webhookRequest(privateStop(601), SECRET));

    expect(response.status).toBe(200);
    const consents = table("telegramBotOptIn");
    expect(consents[0].revokedAt).toBeInstanceOf(Date);
    expect(consents[0].lastUpdateId).toBe(601);
  });
});
