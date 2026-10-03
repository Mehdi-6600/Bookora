import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth/session";
import { isRateLimited, triggerRateLimitCleanup } from "@/lib/rate-limit";
import {
  expireStalePendingBookings,
  lockBusinessSchedule,
  pendingBookingCutoff,
} from "@/lib/booking/schedule";

const reviewSchema = z.object({
  action: z.enum(["approve", "reject"]),
});

class ReviewConflictError extends Error {}
class ReceiptRequiredError extends Error {}
class InvalidPaymentAmountError extends Error {}

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
    if (await isRateLimited(`booking-review:${user.id}`, 60, 10 * 60 * 1000)) {
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

    const bookingRef = await prisma.booking.findFirst({
      where: { id, business: { ownerId: user.id } },
      select: { id: true, businessId: true },
    });

    if (!bookingRef) {
      return NextResponse.json({ error: "رزرو پیدا نشد." }, { status: 404 });
    }

    const status = await prisma.$transaction(async (tx) => {
      await lockBusinessSchedule(tx, bookingRef.businessId);
      const now = new Date();
      await expireStalePendingBookings(tx, bookingRef.businessId, now);

      const booking = await tx.booking.findFirst({
        where: {
          id: bookingRef.id,
          businessId: bookingRef.businessId,
          business: { ownerId: user.id },
        },
      });
      if (!booking) throw new ReviewConflictError();

      const payment = await tx.payment.findFirst({
        where: { id: paymentId, bookingId: booking.id },
      });
      if (!payment) throw new ReviewConflictError();

      if (
        parsed.data.action === "approve" &&
        payment.status === "APPROVED" &&
        booking.status === "CONFIRMED"
      ) {
        return "APPROVED" as const;
      }
      if (
        parsed.data.action === "reject" &&
        payment.status === "REJECTED" &&
        booking.status === "CANCELLED"
      ) {
        return "REJECTED" as const;
      }

      if (
        payment.status !== "PENDING" ||
        payment.type !== "DEPOSIT" ||
        booking.status !== "PENDING_PAYMENT" ||
        booking.paymentStatus !== "PENDING"
      ) {
        throw new ReviewConflictError();
      }

      if (parsed.data.action === "reject") {
        const bookingUpdate = await tx.booking.updateMany({
          where: {
            id: booking.id,
            businessId: bookingRef.businessId,
            status: "PENDING_PAYMENT",
            paymentStatus: "PENDING",
          },
          data: {
            status: "CANCELLED",
            cancelledAt: now,
            paymentStatus: "REJECTED",
          },
        });
        if (bookingUpdate.count !== 1) throw new ReviewConflictError();

        const paymentUpdate = await tx.payment.updateMany({
          where: { id: payment.id, bookingId: booking.id, status: "PENDING" },
          data: { status: "REJECTED", rejectedAt: now },
        });
        if (paymentUpdate.count !== 1) throw new ReviewConflictError();

        return "REJECTED" as const;
      }

      if (!payment.transactionReference?.trim()) {
        throw new ReceiptRequiredError();
      }

      if (
        booking.createdAt < pendingBookingCutoff(now) ||
        payment.currency !== booking.currency ||
        payment.amount.toFixed(2) !== booking.depositDue.toFixed(2) ||
        payment.amount.lte(0) ||
        payment.amount.gt(booking.finalPrice)
      ) {
        throw new InvalidPaymentAmountError();
      }

      const remaining = booking.finalPrice.minus(payment.amount);
      const bookingUpdate = await tx.booking.updateMany({
        where: {
          id: booking.id,
          businessId: bookingRef.businessId,
          status: "PENDING_PAYMENT",
          paymentStatus: "PENDING",
          createdAt: { gte: pendingBookingCutoff(now) },
        },
        data: {
          status: "CONFIRMED",
          paymentStatus: "PAID",
          depositPaid: payment.amount,
          remainingAmount: remaining,
        },
      });
      if (bookingUpdate.count !== 1) throw new ReviewConflictError();

      const paymentUpdate = await tx.payment.updateMany({
        where: { id: payment.id, bookingId: booking.id, status: "PENDING" },
        data: { status: "APPROVED", verifiedAt: now },
      });
      if (paymentUpdate.count !== 1) throw new ReviewConflictError();

      return "APPROVED" as const;
    });

    return NextResponse.json({ status });
  } catch (error) {
    if (error instanceof ReceiptRequiredError) {
      return NextResponse.json(
        { error: "ابتدا باید شماره تراکنش رسید ثبت شود." },
        { status: 409 }
      );
    }
    if (error instanceof InvalidPaymentAmountError) {
      return NextResponse.json(
        { error: "مبلغ یا ارز پرداخت با رزرو مطابقت ندارد یا مهلت آن گذشته است." },
        { status: 409 }
      );
    }
    if (error instanceof ReviewConflictError) {
      return NextResponse.json(
        { error: "این پرداخت قبلاً بررسی شده یا دیگر قابل بررسی نیست." },
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
