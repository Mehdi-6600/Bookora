import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { formatInTimeZone } from "date-fns-tz";
import { prisma } from "@/lib/prisma";
import { notifyUser } from "@/lib/telegram/notify";
import { formatPrice } from "@/lib/currency";
import { isRateLimited, triggerRateLimitCleanup } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/get-client-ip";
import { normalizePaymentReference } from "@/lib/payment-reference";
import { lockPaymentReference } from "@/lib/booking/schedule";

const receiptSchema = z.object({
  receiptToken: z.string().trim().min(10).max(100),
  transactionReference: z.string().trim().min(3).max(200),
});

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
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
        { error: "too many requests" },
        { status: 429 }
      );
    }

    if (await isRateLimited(`receipt:booking:${id}`, 5, 10 * 60 * 1000)) {
      return NextResponse.json(
        { error: "too many requests for this booking" },
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
        { error: "invalid receipt data" },
        { status: 400 }
      );
    }

    const booking = await prisma.booking.findFirst({
      where: {
        id,
        receiptToken: parsed.data.receiptToken,
      },
      include: {
        business: {
          include: {
            owner: { select: { telegramId: true } },
          },
        },
        service: { select: { name: true } },
      },
    });

    if (!booking) {
      return NextResponse.json(
        { error: "booking not found" },
        { status: 404 }
      );
    }

    // A hold that already expired can never be confirmed, so reject it up
    // front instead of accepting a transfer reference that can never settle.
    if (
      booking.status !== "PENDING_PAYMENT" ||
      booking.paymentStatus !== "PENDING"
    ) {
      return NextResponse.json(
        { error: "booking expired" },
        { status: 409 }
      );
    }

    const payment = await prisma.payment.findFirst({
      where: { bookingId: booking.id, type: "DEPOSIT" },
    });

    if (!payment) {
      return NextResponse.json(
        { error: "payment not found" },
        { status: 404 }
      );
    }

    if (payment.status !== "PENDING") {
      return NextResponse.json(
        { error: "payment already reviewed" },
        { status: 409 }
      );
    }

    if (payment.transactionReference) {
      return NextResponse.json(
        { error: "reference already submitted" },
        { status: 409 }
      );
    }

    const normalizedReference = normalizePaymentReference(
      parsed.data.transactionReference
    );

    const result = await prisma.$transaction(async (tx) => {
      await lockPaymentReference(tx, normalizedReference);

      const [duplicatePayment, duplicateSubscription] = await Promise.all([
        tx.payment.findFirst({
          where: {
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
        return { count: 0, duplicate: true };
      }

      const updateResult = await tx.payment.updateMany({
        where: {
          id: payment.id,
          status: "PENDING",
          transactionReference: null,
        },
        data: { transactionReference: normalizedReference },
      });

      return {
        count: updateResult.count,
        duplicate: false,
      };
    });

    if (result.duplicate) {
      return NextResponse.json(
        { error: "این کد پیگیری قبلاً ثبت شده است." },
        { status: 409 }
      );
    }

    if (result.count === 0) {
      return NextResponse.json(
        { error: "payment already reviewed" },
        { status: 409 }
      );
    }

    const dateLabel = formatInTimeZone(
      booking.startAt,
      booking.timezone,
      "yyyy-MM-dd"
    );
    const timeLabel = formatInTimeZone(
      booking.startAt,
      booking.timezone,
      "HH:mm"
    );
    const amountLabel = formatPrice(
      Number(payment.amount),
      payment.currency
    );

    const lines = [
      "💳 <b>بیعانه پرداخت شد</b> — در انتظار تأیید شما",
      "",
      `🏪 <b>${escapeHtml(booking.business.name)}</b>`,
      "",
      `✂️ سرویس: <b>${escapeHtml(booking.service.name)}</b>`,
      `👤 مشتری: <b>${escapeHtml(booking.customerName)}</b>`,
      `📞 تلفن: <code>${escapeHtml(booking.customerPhone)}</code>`,
      "",
      `📅 تاریخ نوبت: <b>${escapeHtml(dateLabel)}</b>`,
      `🕐 ساعت نوبت: <b>${escapeHtml(timeLabel)}</b>`,
      `💰 مبلغ بیعانه: <b>${escapeHtml(amountLabel)}</b>`,
      `🔖 کد واریز: <code>${escapeHtml(normalizedReference)}</code>`,
      "",
      "✅ برای تأیید یا رد، به بخش «رزروها» در Bookora مراجعه کنید.",
    ];

    void notifyUser(
      booking.business.owner.telegramId,
      lines.join("\n"),
      { parseMode: "HTML" }
    ).catch((err) => {
      console.error(
        "notifyUser failed (receipt):",
        err instanceof Error ? err.name : "UnknownError"
      );
    });

    return NextResponse.json(
      { submitted: true },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error(
      "POST /api/public/bookings/[id]/receipt failed:",
      error instanceof Error ? error.name : "UnknownError"
    );
    return NextResponse.json(
      { error: "receipt submission failed" },
      { status: 500 }
    );
  }
}
