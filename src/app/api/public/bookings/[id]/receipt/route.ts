import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { formatInTimeZone } from "date-fns-tz";
import { prisma } from "@/lib/prisma";
import { notifyUser } from "@/lib/telegram/notify";
import { formatPrice } from "@/lib/currency";
import { isRateLimited, triggerRateLimitCleanup } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/get-client-ip";
import {
  expireStalePendingBookings,
  lockBusinessSchedule,
  lockPaymentReference,
  pendingBookingCutoff,
} from "@/lib/booking/schedule";
import { normalizePaymentReference } from "@/lib/payment-reference";

const referencePattern = /^[\p{L}\p{N}][\p{L}\p{N} .#/_-]*[\p{L}\p{N}]$/u;
const receiptSchema = z.object({
  receiptToken: z.string().trim().min(10).max(100),
  transactionReference: z
    .string()
    .trim()
    .min(3)
    .max(200)
    .regex(referencePattern),
});

class BookingExpiredError extends Error {}
class ReceiptUnavailableError extends Error {}
class ReceiptReferenceConflictError extends Error {}

function safeSingleLine(value: string): string {
  return value.replace(/[\r\n\u0000-\u001f\u007f]/g, " ").slice(0, 160);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ip = getClientIp(req);

    if (await isRateLimited(`receipt:ip:${ip}`, 20, 10 * 60 * 1000)) {
      return NextResponse.json(
        { error: "درخواست‌های زیاد. کمی صبر کنید." },
        { status: 429 }
      );
    }
    if (await isRateLimited(`receipt:booking:${id}`, 5, 10 * 60 * 1000)) {
      return NextResponse.json(
        { error: "درخواست‌های زیاد برای این رزرو. کمی صبر کنید." },
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

    const parsed = receiptSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "اطلاعات رسید معتبر نیست." },
        { status: 400 }
      );
    }

    const normalizedReference = normalizePaymentReference(
      parsed.data.transactionReference
    );

    const bookingRef = await prisma.booking.findFirst({
      where: { id, receiptToken: parsed.data.receiptToken },
      select: { businessId: true },
    });

    if (!bookingRef) {
      return NextResponse.json(
        { error: "رزرو پیدا نشد یا اطلاعات نامعتبر است." },
        { status: 404 }
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      await lockBusinessSchedule(tx, bookingRef.businessId);
      await lockPaymentReference(tx, normalizedReference);

      const now = new Date();
      await expireStalePendingBookings(tx, bookingRef.businessId, now);

      const booking = await tx.booking.findFirst({
        where: {
          id,
          businessId: bookingRef.businessId,
          receiptToken: parsed.data.receiptToken,
        },
        include: {
          business: {
            select: {
              name: true,
              timezone: true,
              owner: { select: { telegramId: true } },
            },
          },
          service: { select: { name: true } },
        },
      });

      if (!booking) throw new ReceiptUnavailableError();

      const payment = await tx.payment.findFirst({
        where: { bookingId: booking.id, type: "DEPOSIT" },
      });
      if (!payment) throw new ReceiptUnavailableError();

      const storedReference = payment.transactionReference
        ? normalizePaymentReference(payment.transactionReference)
        : null;

      // Replaying the same receipt submission is safe and makes timeout retries
      // idempotent, even if the business reviewed it before the retry arrived.
      if (
        storedReference === normalizedReference &&
        (payment.status === "PENDING" || payment.status === "APPROVED")
      ) {
        return { booking, payment, newlySubmitted: false };
      }

      if (
        payment.status !== "PENDING" ||
        booking.status !== "PENDING_PAYMENT" ||
        booking.paymentStatus !== "PENDING" ||
        booking.createdAt < pendingBookingCutoff(now)
      ) {
        throw new BookingExpiredError();
      }

      if (payment.transactionReference) {
        throw new ReceiptReferenceConflictError();
      }

      const [duplicatePayment, duplicateSubscription] = await Promise.all([
        tx.payment.findFirst({
          where: {
            id: { not: payment.id },
            transactionReference: {
              equals: normalizedReference,
              mode: "insensitive",
            },
          },
          select: { id: true },
        }),
        tx.subscription.findFirst({
          where: {
            receiptReference: {
              equals: normalizedReference,
              mode: "insensitive",
            },
          },
          select: { id: true },
        }),
      ]);

      if (duplicatePayment || duplicateSubscription) {
        throw new ReceiptReferenceConflictError();
      }

      const updated = await tx.payment.updateMany({
        where: {
          id: payment.id,
          status: "PENDING",
          transactionReference: null,
        },
        data: { transactionReference: normalizedReference },
      });

      if (updated.count !== 1) throw new ReceiptReferenceConflictError();

      return {
        booking,
        payment: { ...payment, transactionReference: normalizedReference },
        newlySubmitted: true,
      };
    });

    if (result.newlySubmitted) {
      const timeLabel = formatInTimeZone(
        result.booking.startAt,
        result.booking.timezone,
        "yyyy-MM-dd HH:mm"
      );
      const amountLabel = formatPrice(
        result.payment.amount.toString(),
        result.payment.currency
      );
      const customerLabel = `${safeSingleLine(result.booking.customerName)} (${safeSingleLine(
        result.booking.customerPhone
      )})`;
      const lines = [
        "💳 بیعانه اعلام شد — در انتظار تأیید شما",
        "",
        `کسب‌وکار: ${safeSingleLine(result.booking.business.name)}`,
        `سرویس: ${safeSingleLine(result.booking.service.name)}`,
        `مشتری: ${customerLabel}`,
        `زمان نوبت: ${timeLabel}`,
        `مبلغ بیعانه: ${amountLabel}`,
        `کد واریز / شناسه پرداخت: ${safeSingleLine(normalizedReference)}`,
        "",
        "برای تأیید یا رد، به بخش «رزروها» در Bookora مراجعه کنید.",
      ];

      void notifyUser(
        result.booking.business.owner.telegramId,
        lines.join("\n")
      ).catch((err) => {
        console.error(
          "notifyUser failed (receipt):",
          err instanceof Error ? err.name : "UnknownError"
        );
      });
    }

    return NextResponse.json(
      { submitted: true },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    if (error instanceof BookingExpiredError) {
      return NextResponse.json(
        { error: "مهلت این رزرو به پایان رسیده یا وضعیت آن تغییر کرده است." },
        { status: 409 }
      );
    }
    if (error instanceof ReceiptUnavailableError) {
      return NextResponse.json(
        { error: "برای این رزرو پرداخت قابل ثبت نیست." },
        { status: 404 }
      );
    }
    if (error instanceof ReceiptReferenceConflictError) {
      return NextResponse.json(
        { error: "این شماره تراکنش قبلاً ثبت شده یا پرداخت بررسی شده است." },
        { status: 409 }
      );
    }

    console.error(
      "POST /api/public/bookings/[id]/receipt failed:",
      error instanceof Error ? error.name : "UnknownError"
    );
    return NextResponse.json(
      { error: "ثبت رسید ناموفق بود." },
      { status: 500 }
    );
  }
}
