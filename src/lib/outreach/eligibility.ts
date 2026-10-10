import { prisma } from "@/lib/prisma";
import {
  CLOSED_PROSPECT_STATUSES,
  type ProspectStatus,
} from "@/lib/outreach/types";
import {
  buildSuppressionIdentifier,
  normalizeTelegramUsername,
} from "@/lib/outreach/normalize";

/**
 * Delivery eligibility.
 *
 * Telegram does not allow a bot to open a private conversation with an
 * arbitrary user. A bot may only send a private message to someone who has
 * already started it (or who otherwise has an established messaging
 * relationship). This module is the single place where that rule is enforced:
 *
 *   - If we have a `User` row for the numeric Telegram id, the person has
 *     started the bot, so automated delivery is allowed.
 *   - Otherwise the invitation must stay a DRAFT for manual, targeted outreach
 *     through that business's own public contact channels.
 */

export type EligibilityResult = {
  canAutoSend: boolean;
  reason: string;
};

export const ELIGIBILITY_REASONS = {
  OK: "ok",
  NO_TELEGRAM_ID: "no_telegram_id",
  NOT_STARTED_BOT: "not_started_bot",
  OPTED_OUT: "opted_out",
  SUPPRESSED: "suppressed",
  CLOSED_STATUS: "closed_status",
  DAILY_LIMIT: "daily_limit",
} as const;

export function isClosedStatus(status: ProspectStatus | string): boolean {
  return CLOSED_PROSPECT_STATUSES.includes(status as ProspectStatus);
}

/**
 * Check whether a prospect is on the do-not-contact list.
 * `identifiers` should already be normalized (`buildSuppressionIdentifier`).
 */
export async function isSuppressed(
  identifiers: Array<string | null | undefined>
): Promise<boolean> {
  const clean = identifiers.filter(
    (value): value is string => typeof value === "string" && value.length > 0
  );

  if (clean.length === 0) return false;

  try {
    const found = await prisma.outreachSuppression.findFirst({
      where: { identifier: { in: clean } },
      select: { id: true },
    });
    return Boolean(found);
  } catch {
    // Fail closed: if the suppression list cannot be read, do not send.
    return true;
  }
}

export async function checkEligibility(prospect: {
  id: string;
  status: string;
  telegramUsername: string | null;
  publicUrl: string | null;
  telegramUserId: string | null | undefined;
  optedOutAt: Date | null;
}): Promise<EligibilityResult> {
  if (isClosedStatus(prospect.status)) {
    return { canAutoSend: false, reason: ELIGIBILITY_REASONS.CLOSED_STATUS };
  }

  if (prospect.optedOutAt) {
    return { canAutoSend: false, reason: ELIGIBILITY_REASONS.OPTED_OUT };
  }

  const suppressed = await isSuppressed([
    buildSuppressionIdentifier({
      telegramUsername: prospect.telegramUsername,
      publicUrl: prospect.publicUrl,
      telegramId: prospect.telegramUserId ?? null,
    }),
    prospect.telegramUserId ? `user:${prospect.telegramUserId}` : null,
  ]);

  if (suppressed) {
    return { canAutoSend: false, reason: ELIGIBILITY_REASONS.SUPPRESSED };
  }

  if (!prospect.telegramUserId) {
    return { canAutoSend: false, reason: ELIGIBILITY_REASONS.NO_TELEGRAM_ID };
  }

  // A `User` row exists only after the person pressed Start in the bot, which
  // is exactly the condition Telegram requires for automated delivery.
  const user = await prisma.user.findUnique({
    where: { telegramId: prospect.telegramUserId },
    select: { id: true },
  });

  if (!user) {
    return { canAutoSend: false, reason: ELIGIBILITY_REASONS.NOT_STARTED_BOT };
  }

  return { canAutoSend: true, reason: ELIGIBILITY_REASONS.OK };
}

/**
 * Resolve a prospect's numeric Telegram id.
 *
 * We never guess this from a username: Telegram offers no public API to turn a
 * username into a user id. It is only filled in once the person actually starts
 * the bot through the attributed deep link.
 */
export async function resolveTelegramUserId(prospect: {
  telegramUsername: string | null;
}): Promise<string | null> {
  const username = normalizeTelegramUsername(prospect.telegramUsername);
  if (!username) return null;

  const user = await prisma.user.findFirst({
    where: { telegramUsername: { equals: username, mode: "insensitive" } },
    select: { telegramId: true },
  });

  return user?.telegramId ?? null;
}
