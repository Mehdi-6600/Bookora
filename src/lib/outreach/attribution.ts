import { prisma } from "@/lib/prisma";
import { parseStartPayload } from "@/lib/outreach/deeplink";

/**
 * Conversion attribution.
 *
 * Links an invited prospect to the moment they actually register a business
 * and to the moment their first real customer booking is created. Every write
 * is best-effort: attribution must never break the booking flow.
 */

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
 * Idempotent: at most one attributed start per (telegramId, startParam), so a
 * user who triggers both paths is counted once, not twice.
 *
 * Stores no message content and no personal profile data.
 */
export async function recordAttributedStart(input: {
  telegramId: string;
  startParam: string | undefined;
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

    // Idempotency guard: one attributed start per (telegramId, startParam).
    if (raw) {
      const existing = await prisma.botStart.findFirst({
        where: { telegramId: input.telegramId, startParam: raw },
        select: { id: true },
      });
      if (existing) return;
    }

    await prisma.botStart.create({
      data: {
        telegramId: input.telegramId,
        userId: user?.id ?? null,
        startParam: raw ?? null,
        prospectId,
        campaignId,
        wasExistingUser: Boolean(user),
      },
    });
  } catch (error) {
    // Attribution must never break the /start or auth response.
    console.error(
      "recordAttributedStart failed:",
      error instanceof Error ? error.name : "UnknownError"
    );
  }
}
