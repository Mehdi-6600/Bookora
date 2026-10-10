import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { pendingBookingCutoff } from "@/lib/booking/schedule";
import { hasValidCronAuthorization, isCronSecretConfigured } from "@/lib/security/cron-auth";

const BATCH_SIZE = 200;
const MAX_BATCHES_PER_RUN = 20;

export async function GET(req: NextRequest) {
  if (!isCronSecretConfigured(process.env.CRON_SECRET)) {
    return NextResponse.json(
      { error: "Cron authentication is not configured." },
      { status: 503 }
    );
  }

  if (!hasValidCronAuthorization(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const now = new Date();
    const cutoff = pendingBookingCutoff(now);
    let expired = 0;
    let batches = 0;

    while (batches < MAX_BATCHES_PER_RUN) {
      const staleBookings = await prisma.booking.findMany({
        where: {
          status: "PENDING_PAYMENT",
          paymentStatus: "PENDING",
          createdAt: { lt: cutoff },
        },
        orderBy: { createdAt: "asc" },
        take: BATCH_SIZE,
        select: { id: true },
      });

      if (staleBookings.length === 0) break;

      const ids = staleBookings.map((booking) => booking.id);
      const cancelledCount = await prisma.$transaction(async (tx) => {
        // Update the booking first and conditionally. Payment-review and other
        // cron runs use the same compare-and-set state transition, so only one
        // of approve/reject/expire can win for a booking.
        const bookingsUpdated = await tx.booking.updateMany({
          where: {
            id: { in: ids },
            status: "PENDING_PAYMENT",
            paymentStatus: "PENDING",
            createdAt: { lt: cutoff },
          },
          data: {
            status: "CANCELLED",
            cancelledAt: now,
            paymentStatus: "REJECTED",
          },
        });

        if (bookingsUpdated.count === 0) return 0;

        const cancelledBookings = await tx.booking.findMany({
          where: {
            id: { in: ids },
            status: "CANCELLED",
            paymentStatus: "REJECTED",
            cancelledAt: now,
          },
          select: { id: true },
        });

        if (cancelledBookings.length > 0) {
          await tx.payment.updateMany({
            where: {
              bookingId: { in: cancelledBookings.map((booking) => booking.id) },
              status: "PENDING",
            },
            data: { status: "REJECTED", rejectedAt: now },
          });
        }

        return bookingsUpdated.count;
      });

      expired += cancelledCount;
      batches += 1;
      if (staleBookings.length < BATCH_SIZE) break;
    }

    return NextResponse.json({ expired, batches });
  } catch (error) {
    console.error(
      "cron/expire-pending failed:",
      error instanceof Error ? error.name : "UnknownError"
    );
    return NextResponse.json(
      { error: "Pending-booking cleanup failed." },
      { status: 500 }
    );
  }
}
