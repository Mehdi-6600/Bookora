import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { prisma } from "@/lib/prisma";
import { notifyUser } from "@/lib/telegram/notify";
import { formatPrice } from "@/lib/currency";
import { isRateLimited } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/get-client-ip";

const receiptSchema = z.object({
  customerPhone: z.string().trim().min(3).max(30),
  transactionReference: z.string().trim().min(3).max(200),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ip = getClientIp(req);

    if (await isRateLimited(`receipt:${ip}`, 20, 10 * 60 * 1000)) {
      return NextResponse.json(
        { error: "درخواست‌های زیاد. کمی صبر کنید." },
        { status: 429 }
      );
    }

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
        customerPhone: parsed.data.customerPhone,
      },
      include: {
        business: {
          include: {
            owner: {
              select: { telegramId: true },
            },
          },
        },
        service: {
          select: { name: true },
        },
      },
    });

    if (!booking) {
      return NextResponse.json(
        { error: "رزرو پیدا نشد یا شماره تلفن اشتباه است." },
        { status: 404 }
      );
    }

    const payment = await prisma.payment.findFirst({
      where: {
        bookingId: booking.id,
        type: "DEPOSIT",
      },
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

    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        transactionReference: parsed.data.transactionReference,
      },
    });

    const localTime = toZonedTime(booking.startAt, booking.timezone);
    const timeLabel = format(localTime, "yyyy-MM-dd HH:mm");
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
      `زمان نوبت: ${timeLabel}`,
      `مبلغ بیعانه: ${amountLabel}`,
      `کد واریز / شناسه پرداخت: ${parsed.data.transactionReference}`,
      "",
      "برای تأیید یا رد، به بخش «رزروها» در Bookora مراجعه کنید.",
    ];

    void notifyUser(
      booking.business.owner.telegramId,
      lines.join("\n")
    );

    return NextResponse.json({ submitted: true });
  } catch (error) {
    console.error(
      "POST /api/public/bookings/[id]/receipt failed:",
      error
    );
    return NextResponse.json(
      { error: "ثبت رسید ناموفق بود." },
      { status: 500 }
    );
  }
}
