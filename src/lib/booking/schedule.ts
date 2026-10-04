import { Prisma } from "@prisma/client";

export const PENDING_BOOKING_TTL_MS = 15 * 60 * 1000;
export const PENDING_BOOKING_TTL_MINUTES = PENDING_BOOKING_TTL_MS / 60_000;

export function pendingBookingCutoff(now = new Date()): Date {
  return new Date(now.getTime() - PENDING_BOOKING_TTL_MS);
}

export async function lockBusinessSchedule(
  tx: Prisma.TransactionClient,
  businessId: string
): Promise<void> {
  await tx.$queryRaw<Array<{ locked: string }>>`
    SELECT pg_advisory_xact_lock(
      hashtext(${businessId}::text),
      hashtext('bookora:business-schedule'::text)
    )::text AS locked
  `;
}

export async function lockUserSubscriptions(
  tx: Prisma.TransactionClient,
  userId: string
): Promise<void> {
  await tx.$queryRaw<Array<{ locked: string }>>`
    SELECT pg_advisory_xact_lock(
      hashtext(${userId}::text),
      hashtext('bookora:user-subscriptions'::text)
    )::text AS locked
  `;
}

export async function lockPaymentReference(
  tx: Prisma.TransactionClient,
  normalizedReference: string
): Promise<void> {
  await tx.$queryRaw<Array<{ locked: string }>>`
    SELECT pg_advisory_xact_lock(
      hashtext(${normalizedReference}::text),
      hashtext('bookora:payment-reference'::text)
    )::text AS locked
  `;
}

export async function expireStalePendingBookings(
  tx: Prisma.TransactionClient,
  businessId: string,
  now = new Date(),
  batchSize = 500
): Promise<number> {
  const cutoff = pendingBookingCutoff(now);
  const staleBookings = await tx.booking.findMany({
    where: {
      businessId,
      status: "PENDING_PAYMENT",
      paymentStatus: "PENDING",
      createdAt: { lt: cutoff },
    },
    orderBy: { createdAt: "asc" },
    take: batchSize,
    select: { id: true },
  });

  if (staleBookings.length === 0) return 0;

  const ids = staleBookings.map((booking) => booking.id);
  const cancelledAt = now;
  const updated = await tx.booking.updateMany({
    where: {
      id: { in: ids },
      businessId,
      status: "PENDING_PAYMENT",
      paymentStatus: "PENDING",
      createdAt: { lt: cutoff },
    },
    data: {
      status: "CANCELLED",
      cancelledAt,
      paymentStatus: "REJECTED",
    },
  });

  if (updated.count === 0) return 0;

  const expired = await tx.booking.findMany({
    where: {
      id: { in: ids },
      businessId,
      status: "CANCELLED",
      paymentStatus: "REJECTED",
      cancelledAt,
    },
    select: { id: true },
  });

  if (expired.length > 0) {
    await tx.payment.updateMany({
      where: {
        bookingId: { in: expired.map((booking) => booking.id) },
        status: "PENDING",
      },
      data: { status: "REJECTED", rejectedAt: cancelledAt },
    });
  }

  return updated.count;
}

export function activeBookingOverlapWhere(
  now = new Date()
): Prisma.BookingWhereInput {
  return {
    status: { not: "CANCELLED" },
    OR: [
      { status: { not: "PENDING_PAYMENT" } },
      { createdAt: { gte: pendingBookingCutoff(now) } },
    ],
  };
}
