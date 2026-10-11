import { prisma } from "@/lib/prisma";
import { parseStartPayload } from "@/lib/outreach/deeplink";

/**
 * Conversion attribution.
 *
 * Links an invited prospect to the moment they actually register a business
 * and to the moment their first real customer booking is created. Every write
 * is best-effort: attribution must never break the booking flow.
 */

/**
 * True for Prisma's unique-constraint error (P2002).
 *
 * Used to turn a concurrent duplicate insert into the idempotent outcome. Any
 * other error is re-thrown so a real database failure is never swallowed.
 */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

async function latestProspectForUser(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { telegramId: true },
  });

  if (!user) return null;

  const start = await prisma.botStart.findFirst({
    where: { telegramId: user.telegramId, prospectId: { not: null } },
    orderBy: { createdAt: "desc" },
    select: { prospectId: true },
  });

  return start?.prospectId ?? null;
}

/** Called after a business is successfully created. */
export async function markRegistered(
  userId: string,
  businessId: string
): Promise<void> {
  try {
    const prospectId = await latestProspectForUser(userId);
    if (!prospectId) return;

    const prospect = await prisma.outreachProspect.findUnique({
      where: { id: prospectId },
      select: { status: true, convertedBusinessId: true },
    });

    if (!prospect) return;

    // Only advance the funnel; never move a closed prospect backwards.
    if (["NOT_INTERESTED", "DO_NOT_CONTACT", "ACTIVATED"].includes(prospect.status)) {
      return;
    }

    await prisma.outreachProspect.update({
      where: { id: prospectId },
      data: {
        status: "REGISTERED",
        convertedUserId: userId,
        convertedBusinessId: prospect.convertedBusinessId ?? businessId,
        nextFollowUpAt: null,
      },
    });
  } catch (error) {
    console.error(
      "markRegistered failed:",
      error instanceof Error ? error.name : "UnknownError"
    );
  }
}

/** Called after a booking is successfully created for a business. */
export async function markFirstBooking(businessId: string, bookingId: string): Promise<void> {
  try {
    const booking = await prisma.booking.findUnique({ where: { id: bookingId },
      select: { businessId: true, isTestBooking: true } });
    if (!booking || booking.businessId !== businessId || booking.isTestBooking) return;
    const prospect = await prisma.outreachProspect.findFirst({
      where: { convertedBusinessId: businessId },
      select: { id: true, status: true },
    });

    if (!prospect) return;
    if (["NOT_INTERESTED", "DO_NOT_CONTACT"].includes(prospect.status)) return;
    if (prospect.status === "ACTIVATED") return;

    await prisma.outreachProspect.update({
      where: { id: prospect.id },
      data: { status: "ACTIVATED", activatedAt: new Date(), nextFollowUpAt: null },
    });
  } catch (error) {
    console.error(
      "markFirstBooking failed:",
      error instanceof Error ? error.name : "UnknownError"
    );
  }
}

/** Totals used by the daily report. */
export async function getConversionCounts(since: Date): Promise<{
  botStarts: number;
  registrations: number;
  activations: number;
  firstBookings: number;
}> {
  const [botStarts, registrations, activations] = await Promise.all([
    prisma.botStart.count({ where: { createdAt: { gte: since } } }),
    prisma.outreachProspect.count({
      where: { createdAt: { gte: since }, status: { in: ["REGISTERED", "ACTIVATED"] } },
    }),
    prisma.outreachProspect.count({
      where: { activatedAt: { gte: since } },
    }),
  ]);

  const activatedBusinesses = await prisma.outreachProspect.findMany({
    where: { activatedAt: { gte: since }, convertedBusinessId: { not: null } },
    select: { convertedBusinessId: true },
  });

  const ids = activatedBusinesses
    .map((row) => row.convertedBusinessId)
    .filter((value): value is string => typeof value === "string");

  const firstBookings = ids.length
    ? await prisma.booking.count({
        where: { createdAt: { gte: since }, businessId: { in: ids }, isTestBooking: false },
      })
    : 0;

  return { botStarts, registrations, activations, firstBookings };
}

/**
 * Record an attributed start of the bot.
 *
 * Called from BOTH places where we can observe a start:
 *   - the Telegram `/start` command handler, and
 *   - the Mini App authentication callback (where Telegram puts the same
 *     `start_param` inside the *signed* initData).
 *
 * The second path is what preserves attribution through the auth redirect —
 * previously the parameter was dropped as soon as the web app authenticated.
 *
 * Idempotent on two independent keys, so a replayed webhook delivery can never
 * inflate the "Bot starts" figure:
 *
 *   - (telegramId, updateId) — one row per Telegram update. This is the only
 *     key that also covers a /start sent *without* a deep-link parameter,
 *     because such a start has no startParam to de-duplicate on. Two genuinely
 *     separate /start commands carry different update ids and are both counted,
 *     so real activity is never collapsed into one row.
 *   - (telegramId, startParam) — one row per deep link, which is what the Mini
 *     App authentication callback relies on: it has no update id, only the
 *     signed `start_param`.
 *
 * Stores no message content and no personal profile data.
 */
export async function recordAttributedStart(input: {
  telegramId: string;
  startParam: string | undefined;
  /**
   * Telegram `update_id` of the update being processed. Present on the
   * webhook/`/start` path, absent on the Mini App auth callback, which has no
   * Telegram update at all.
   */
  updateId?: number | null;
}): Promise<void> {
  try {
    const raw = input.startParam?.trim() || undefined;
    const payload = parseStartPayload(raw);

    const user = await prisma.user.findUnique({
      where: { telegramId: input.telegramId },
      select: { id: true },
    });

    let prospectId: string | null = null;
    let campaignId: string | null = null;

    if (payload.kind === "prospect" && raw) {
      const invitation = await prisma.outreachInvitation.findUnique({
        where: { startParam: raw },
        select: { id: true, prospectId: true, campaignId: true },
      });

      if (invitation) {
        prospectId = invitation.prospectId;
        campaignId = invitation.campaignId;

        await prisma.outreachProspect.update({
          where: { id: invitation.prospectId },
          data: {
            status: "STARTED_BOT",
            convertedUserId: user?.id ?? null,
            lastInteractionAt: new Date(),
          },
        });

        await prisma.outreachInvitation.update({
          where: { id: invitation.id },
          data: { deliveredAt: new Date() },
        });
      }
    } else if (payload.kind === "campaign") {
      const campaign = await prisma.outreachCampaign.findUnique({
        where: { code: payload.code },
        select: { id: true },
      });
      campaignId = campaign?.id ?? null;
    }

  const updateId = typeof input.updateId === "number" ? input.updateId : null;

  const data = {
    telegramId: input.telegramId,
    userId: user?.id ?? null,
    startParam: raw ?? null,
    updateId,
    prospectId,
    campaignId,
    wasExistingUser: Boolean(user),
  };

  // Idempotency guards: one row per (telegramId, updateId), and one per
  // (telegramId, startParam).
  //
  // Each read is only a fast path; the authoritative guards are the two unique
  // indexes added in `prisma/sql/0006_bot_starts_unique.sql`. Two concurrent
  // deliveries of the same update can both pass a read, so the insert itself
  // has to be the arbiter: a duplicate raises P2002 and is the outcome we
  // want, while every other error is a genuine failure and is reported as one.
  //
  // The update-id guard runs first because it is the only one that protects a
  // /start without a startParam. It is skipped when the caller has no update
  // id (the Mini App auth callback), which then falls back to the deep-link
  // guard. A caller with neither — no update id and no startParam — records a
  // row per call, which is unavoidable: there is nothing to de-duplicate on.
  if (updateId !== null) {
    const duplicate = await prisma.botStart.findFirst({
      where: { telegramId: input.telegramId, updateId },
      select: { id: true },
    });
    if (duplicate) return;
  }

  if (raw) {
    const existing = await prisma.botStart.findFirst({
      where: { telegramId: input.telegramId, startParam: raw },
      select: { id: true },
    });
    if (existing) return;
  }

  try {
    await prisma.botStart.create({ data });
  } catch (error) {
    if (isUniqueViolation(error)) return;
    throw error;
  }
  } catch (error) {
    // Attribution must never break the /start or auth response.
    console.error(
      "recordAttributedStart failed:",
      error instanceof Error ? error.name : "UnknownError"
    );
  }
}
