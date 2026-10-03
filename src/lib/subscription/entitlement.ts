import type { Prisma } from "@prisma/client";
import type { PlanCode } from "@/lib/subscription/plans";
import { PLANS } from "@/lib/subscription/plans";

const PAID_PLAN_CODES = Object.keys(PLANS) as PlanCode[];

export function activePaidSubscriptionWhere(
  userId: string,
  now = new Date()
): Prisma.SubscriptionWhereInput {
  return {
    userId,
    plan: { in: PAID_PLAN_CODES },
    status: "ACTIVE",
    startedAt: { lte: now },
    OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
  };
}

/**
 * Build the next paid period from the end of any current/future paid period.
 * This keeps a renewal from shortening a longer existing subscription.
 */
export async function nextSubscriptionPeriod(
  tx: Prisma.TransactionClient,
  userId: string,
  durationDays: number,
  now = new Date()
): Promise<{ startedAt: Date; expiresAt: Date | null }> {
  const subscriptions = await tx.subscription.findMany({
    where: {
      userId,
      plan: { in: PAID_PLAN_CODES },
      status: "ACTIVE",
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    select: { expiresAt: true },
  });

  if (subscriptions.some((subscription) => subscription.expiresAt === null)) {
    return { startedAt: now, expiresAt: null };
  }

  const latestExpiry = subscriptions.reduce<Date | null>((latest, row) => {
    if (!row.expiresAt) return latest;
    return !latest || row.expiresAt > latest ? row.expiresAt : latest;
  }, null);

  const startedAt = latestExpiry && latestExpiry > now ? latestExpiry : now;
  return {
    startedAt,
    expiresAt: new Date(startedAt.getTime() + durationDays * 24 * 60 * 60 * 1000),
  };
}
