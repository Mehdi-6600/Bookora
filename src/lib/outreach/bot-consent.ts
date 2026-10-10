import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { parseStartPayload } from "@/lib/outreach/deeplink";

// Consent expires unless a genuine private Bot API /start is seen again.
export const BOT_CONSENT_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

/** Called only from the authenticated Telegram webhook's private /start handler. */
export async function recordBotStartConsent(input: {
  telegramId: string;
  chatId: string;
  updateId: number;
  startParam?: string;
}): Promise<void> {
  if (!/^\d+$/.test(input.telegramId) || input.chatId !== input.telegramId ||
      !Number.isSafeInteger(input.updateId) || input.updateId < 0) {
    throw new Error("Invalid private Bot API start update");
  }
  const payload = parseStartPayload(input.startParam);
  const invitation = payload.kind === "prospect" && input.startParam
    ? await prisma.outreachInvitation.findUnique({
        where: { startParam: input.startParam }, select: { prospectId: true },
      }) : null;
  // Do not infer consent or identity from a username or Mini App login.
  // Only an attributed /start binds a numeric chat ID to a prospect.
  const prospectId = invitation?.prospectId ?? null;
  const data = { startedAt: new Date(), revokedAt: null, prospectId, lastUpdateId: input.updateId };
  const updated = await prisma.telegramBotOptIn.updateMany({
    where: { telegramId: input.telegramId, lastUpdateId: { lt: input.updateId } },
    data,
  });
  if (updated.count) return;
  try {
    await prisma.telegramBotOptIn.create({ data: { telegramId: input.telegramId, ...data } });
  } catch (error) {
    // Another webhook delivery created this row; only a newer update may replace it.
    if (typeof error !== "object" || error === null || !("code" in error) || error.code !== "P2002") throw error;
    await prisma.telegramBotOptIn.updateMany({
      where: { telegramId: input.telegramId, lastUpdateId: { lt: input.updateId } }, data,
    });
  }
}

/** A stop update wins over duplicate/older starts, including out-of-order retries. */
export async function revokeBotConsent(telegramId: string, updateId: number): Promise<void> {
  if (!/^\d+$/.test(telegramId) || !Number.isSafeInteger(updateId) || updateId < 0) {
    throw new Error("Invalid Bot API stop update");
  }
  const data = { revokedAt: new Date(), lastUpdateId: updateId };
  const updated = await prisma.telegramBotOptIn.updateMany({
    where: { telegramId, lastUpdateId: { lt: updateId } }, data,
  });
  if (updated.count) return;
  try {
    await prisma.telegramBotOptIn.create({
      data: { telegramId, startedAt: null, prospectId: null, ...data },
    });
  } catch (error) {
    if (typeof error !== "object" || error === null || !("code" in error) || error.code !== "P2002") throw error;
    await prisma.telegramBotOptIn.updateMany({
      where: { telegramId, lastUpdateId: { lt: updateId } }, data,
    });
  }
}

export async function revokeBlockedConsent(telegramId: string): Promise<void> {
  await prisma.telegramBotOptIn.updateMany({
    where: { telegramId }, data: { revokedAt: new Date() },
  });
}

/** Missing table/read failure must propagate: automated delivery fails closed. */
export async function currentBotConsent(prospectId: string, db: Prisma.TransactionClient = prisma) {
  return db.telegramBotOptIn.findFirst({
    where: {
      prospectId,
      startedAt: { gte: new Date(Date.now() - BOT_CONSENT_MAX_AGE_MS) },
      revokedAt: null,
    },
    orderBy: { startedAt: "desc" },
    select: { telegramId: true, startedAt: true },
  });
}
