import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { formatInTimeZone } from "date-fns-tz";
import { prisma } from "@/lib/prisma";
import { notifyUser } from "@/lib/telegram/notify";
import { formatPrice } from "@/lib/currency";
import { isRateLimited, triggerRateLimitCleanup } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/get-client-ip";
import { normalizePaymentReference } from "@/lib/payment-reference";

const receiptSchema = z.object({
  receiptToken: z.string().trim().min(10).max(100),
  transactionReference: z.string().trim().min(3).max(200),
});

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
        { error: "اطلاعات معتبر نیست." },
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
        { error: "رزرو پیدا نشد یا اطلاعات نامعتبر است." },
        { status: 404 }
      );
    }

    const payment = await prisma.payment.findFirst({
      where: { bookingId: booking.id, type: "DEPOSIT" },
    });

    if (!payment) {
      return NextResponse.json(
        {
          error:
            "برای این رزرو نیازی به بیعانه نیست یا پرداخت آن لغو شده است.",
        },
        { status: 404 }
      );
    }

    if (payment.status !== "PENDING") {
      return NextResponse.json(
        { error: "این پرداخت قبلاً بررسی شده است." },
        { status: 409 }
      );
    }

    if (payment.transactionReference) {
      return NextResponse.json(
        { error: "شماره تراکنش قبلاً ثبت شده است." },
        { status: 409 }
      );
    }

    const normalizedReference = normalizePaymentReference(
      parsed.data.transactionReference
    );

    const updateResult = await prisma.payment.updateMany({
      where: {
        id: payment.id,
        status: "PENDING",
        transactionReference: null,
      },
      data: { transactionReference: normalizedReference },
    });

    if (updateResult.count === 0) {
      return NextResponse.json(
        { error: "این پرداخت قبلاً بررسی شده است." },
        { status: 409 }
      );
    }

    const localTime = formatInTimeZone(
      booking.startAt,
      booking.timezone,
      "yyyy-MM-dd HH:mm"
    );
    const amountLabel = formatPrice(
      Number(payment.amount),
      payment.currency
    );
    const customerLabel =
      booking.customerName + " (" + booking.customerPhone + ")";

    const lines = [
      "💳 بیعانه پرداخت شد — در انتظار تأیید شما",
      "",
      `کسب‌وکار: ${booking.business.name}`,
      `سرویس: ${booking.service.name}`,
      `مشتری: ${customerLabel}`,
      `زمان نوبت: ${localTime}`,
      `مبلغ بیعانه: ${amountLabel}`,
      `کد واریز / شناسه پرداخت: ${normalizedReference}`,
      "",
      "برای تأیید یا رد، به بخش «رزروها» در Bookora مراجعه کنید.",
    ];

    void notifyUser(booking.business.owner.telegramId, lines.join("\n")).catch(
      (err) => {
        console.error(
          "notifyUser failed (receipt):",
          err instanceof Error ? err.name : "UnknownError"
        );
      }
    );

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
      { error: "ثبت رسید ناموفق بود." },
      { status: 500 }
    );
  }
}
