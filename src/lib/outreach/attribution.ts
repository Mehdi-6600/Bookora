import { prisma } from "@/lib/prisma";

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
export async function markFirstBooking(businessId: string): Promise<void> {
  try {
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
        where: { createdAt: { gte: since }, businessId: { in: ids } },
      })
    : 0;

  return { botStarts, registrations, activations, firstBookings };
}
