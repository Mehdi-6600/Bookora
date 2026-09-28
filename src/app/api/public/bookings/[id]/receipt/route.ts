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
      where: { id, customerPhone: parsed.data.customerPhone },
      include: {
        business: { include: { owner: { select: { telegramId: true } } } },
        service: { select: { name: true } },
      },
    });
    if (!booking) {
      return NextResponse.json(
        { error: "رزرو پیدا نشد یا شماره تلفن اشتباه است." },
        { status: 404 }
      );
    }

    // FIX: دیگر فیلتر status=PENDING را در کوئری نمی‌گذاریم تا
    // اگر پرداخت قبلاً رد/تأیید شده بود، پیام واضح‌تری به کاربر بدهیم.
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

    await prisma.payment.update({
      where: { id: payment.id transactionReference: parsed.data.transactionReference },
    });

    // پیام به صاحب کسب‌وکار: مشتری receipt فرستاده و منتظر تأیید است.
    const localTime = toZonedTime(booking.startAt, booking.timezone);
    const timeLabel = format(localTime, "yyyy-MM-dd HH:mm");

    void notifyUser(
      booking.business.owner.telegramId,
      `💳 بیعانه پرداخت شد — در انتظار تأیید شما\n\n` +
        `کسب‌وکار: ${booking.business.name}\n` +
        `سرویس: ${booking.service.name}\n` +
        `مشتری: ${booking.customerName} (${booking.customerPhone})\n` +
        `زمان نوبت: ${timeLabel}\n` +
        `مبلغ بیعانه: ${formatPrice(Number(payment.amount), payment.currency)}\n` +
        `کد واریز / شناسه پرداخت: ${parsed.data.transactionReference}\n\n` +
        `برای تأیید یا رد، به بخش «رزروها» در Bookora مراجعه کنید.`
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
