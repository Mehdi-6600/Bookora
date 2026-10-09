import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth/session";
import { isRateLimited, triggerRateLimitCleanup } from "@/lib/rate-limit";
import {
  expireStalePendingBookings,
  lockBusinessSchedule,
} from "@/lib/booking/schedule";

const reviewSchema = z.object({
  action: z.enum(["approve", "reject"]),
});

class BookingNotFoundError extends Error {}
class PaymentNotFoundError extends Error {}
class PaymentAlreadyReviewedError extends Error {}
class BookingNotPayableError extends Error {}

function settledTotals(
  finalPrice: unknown,
  paidBefore: unknown,
  paymentAmount: unknown
): { depositPaid: number; remainingAmount: number } {
  const final = Number(finalPrice);
  const previous = Number(paidBefore);
  const paid = Number(paymentAmount);

  if (!Number.isFinite(paid)) return { depositPaid: 0, remainingAmount: 0 };

  // A booking may accumulate several partial payments, so add to the amount
  // already settled instead of overwriting it.
  const settled =
    (Number.isFinite(previous) && previous > 0 ? previous : 0) + paid;
  const remaining = Number.isFinite(final) ? Math.max(0, final - settled) : 0;

  return { depositPaid: settled, remainingAmount: remaining };
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; paymentId: string }> }
) {
  try {
    const { id, paymentId } = await params;
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (await isRateLimited(`payment-review:${user.id}`, 120, 10 * 60 * 1000)) {
      return NextResponse.json(
        { error: "درخواست‌های زیاد. کمی صبر کنید." },
        { status: 429 }
      );
    }
    triggerRateLimitCleanup();

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const parsed = reviewSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "اطلاعات معتبر نیست." },
        { status: 400 }
      );
    }

    const reference = await prisma.booking.findFirst({
      where: { id, business: { ownerId: user.id } },
      select: { id: true, businessId: true },
    });

    if (!reference) {
      return NextResponse.json({ error: "رزرو پیدا نشد." }, { status: 404 });
    }

    // Approving confirms the slot, so the transition has to be serialized with
    // booking creation and with stale-hold expiry. Otherwise a hold that was
    // already released (and whose slot was resold) could be confirmed here,
    // producing two confirmed bookings for the same time.
    const outcome = await prisma.$transaction(async (tx) => {
      await lockBusinessSchedule(tx, reference.businessId);
      const now = new Date();

      // Release stale holds first so an abandoned booking cannot be revived.
      await expireStalePendingBookings(tx, reference.businessId, now);

      const booking = await tx.booking.findUnique({
        where: { id: reference.id },
        select: {
          id: true,
          status: true,
          paymentStatus: true,
          finalPrice: true,
          depositPaid: true,
        },
      });
      if (!booking) throw new BookingNotFoundError();

      const payment = await tx.payment.findFirst({
        where: { id: paymentId, bookingId: booking.id },
        select: { id: true, status: true, amount: true },
      });
      if (!payment) throw new PaymentNotFoundError();

      if (payment.status !== "PENDING") {
        throw new PaymentAlreadyReviewedError();
      }

      // Only a live pending-payment booking may be settled. A cancelled or
      // already-settled booking must never be flipped back to CONFIRMED.
      if (
        booking.status !== "PENDING_PAYMENT" ||
        booking.paymentStatus !== "PENDING"
      ) {
        throw new BookingNotPayableError();
      }

      if (parsed.data.action === "reject") {
        const rejectedPayment = await tx.payment.updateMany({
          where: { id: payment.id, status: "PENDING" },
          data: { status: "REJECTED", rejectedAt: now },
        });
        if (rejectedPayment.count === 0) {
          throw new PaymentAlreadyReviewedError();
        }

        // Guarded compare-and-set: only cancel while the booking is still
        // pending, so a concurrent approve cannot be overwritten.
        await tx.booking.updateMany({
          where: {
            id: booking.id,
            status: "PENDING_PAYMENT",
            paymentStatus: "PENDING",
          },
          data: {
            status: "CANCELLED",
            cancelledAt: now,
            paymentStatus: "REJECTED",
          },
        });

        return { status: "REJECTED" as const };
      }

      const approvedPayment = await tx.payment.updateMany({
        where: { id: payment.id, status: "PENDING" },
        data: { status: "APPROVED", verifiedAt: now },
      });

      if (approvedPayment.count === 0) {
        throw new PaymentAlreadyReviewedError();
      }

      const { depositPaid, remainingAmount } = settledTotals(
        booking.finalPrice,
        booking.depositPaid,
        payment.amount
      );

      // Compare-and-set on the booking state. If the hold was cancelled or
      // confirmed concurrently, nothing is written and the whole transaction
      // rolls back, so no slot can end up double-booked.
      const confirmedBooking = await tx.booking.updateMany({
        where: {
          id: booking.id,
          status: "PENDING_PAYMENT",
          paymentStatus: "PENDING",
        },
        data: {
          status: "CONFIRMED",
          paymentStatus: "PAID",
          depositPaid,
          remainingAmount,
        },
      });

      if (confirmedBooking.count === 0) {
        throw new BookingNotPayableError();
      }

      return { status: "APPROVED" as const };
    });

    return NextResponse.json({ status: outcome.status });
  } catch (error) {
    if (error instanceof BookingNotFoundError) {
      return NextResponse.json({ error: "رزرو پیدا نشد." }, { status: 404 });
    }
    if (error instanceof PaymentNotFoundError) {
      return NextResponse.json({ error: "پرداخت پیدا نشد." }, { status: 404 });
    }
    if (error instanceof PaymentAlreadyReviewedError) {
      return NextResponse.json(
        { error: "این پرداخت قبلاً بررسی شده است." },
        { status: 409 }
      );
    }
    if (error instanceof BookingNotPayableError) {
      return NextResponse.json(
        { error: "این رزرو دیگر در وضعیت انتظار پرداخت نیست." },
        { status: 409 }
      );
    }

    console.error(
      "POST /api/bookings/[id]/payments/[paymentId]/review failed:",
      error instanceof Error ? error.name : "UnknownError"
    );
    return NextResponse.json(
      { error: "بررسی پرداخت ناموفق بود." },
      { status: 500 }
    );
  }
}
