import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { format } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { prisma } from "@/lib/prisma";
import { computeAvailableSlots } from "@/lib/availability";
import { formatPrice } from "@/lib/currency";
import { notifyUser } from "@/lib/telegram/notify";
import { isRateLimited } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/get-client-ip";

const phonePattern = /^[0-9+\-\s()]{6,20}$/;

const createBookingSchema = z.object({
  serviceId: z.string().min(1),
  startAt: z.string().datetime(),
  customerName: z.string().trim().min(1).max(120),
  customerPhone: z.string().trim().regex(phonePattern, "شماره تلفن معتبر نیست."),
  customerEmail: z.string().trim().email().nullable().optional(),
});

function computeDeposit(depositType: string, depositValue: number, price: number): number {
  if (depositType === "PERCENTAGE") return Math.round(((price * depositValue) / 100) * 100) / 100;
  if (depositType === "FIXED") return Math.min(depositValue, price);
  return 0;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const ip = getClientIp(req);

    // حداکثر ۱۰ رزرو در ۱۰ دقیقه از هر IP — جلوگیری از اسپم/Bot بدون آسیب به کاربر واقعی.
    if (await isRateLimited(`booking:${ip}`, 10, 10 * 60 * 1000)) {
      return NextResponse.json({ error: "درخواست‌های زیاد. کمی صبر کنید." }, { status: 429 });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const parsed = createBookingSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "اطلاعات رزرو معتبر نیست." }, { status: 400 });
    }

    const business = await prisma.business.findFirst({
      where: { slug, status: "ACTIVE" },
      include: { owner: { select: { telegramId: true } } },
    });
    if (!business) {
      return NextResponse.json({ error: "کسب‌وکار پیدا نشد." }, { status: 404 });
    }

    const service = await prisma.service.findFirst({
      where: { id: parsed.data.serviceId, businessId: business.id, active: true },
    });
    if (!service) {
      return NextResponse.json({ error: "سرویس پیدا نشد." }, { status: 404 });
    }

    const startAt = new Date(parsed.data.startAt);
    const endAt = new Date(startAt.getTime() + service.durationMinutes * 60000);

    if (startAt.getTime() <= Date.now()) {
      return NextResponse.json({ error: "این زمان دیگر معتبر نیست." }, { status: 400 });
    }

    const localDate = toZonedTime(startAt, business.timezone);
    const dateStr = format(localDate, "yyyy-MM-dd");
    const dayOfWeek = localDate.getDay();

    const workingHour = await prisma.workingHour.findUnique({
      where: { businessId_dayOfWeek: { businessId: business.id, dayOfWeek } },
    });
    if (!workingHour || !workingHour.enabled) {
      return NextResponse.json({ error: "این روز کسب‌وکار تعطیل است." }, { status: 409 });
    }

    const dayStart = fromZonedTime(`${dateStr}T00:00:00`, business.timezone);
    const dayEnd = fromZonedTime(`${dateStr}T23:59:59`, business.timezone);

    const [timeOffs, existingBookings] = await Promise.all([
      prisma.timeOff.findMany({
        where: { businessId: business.id, startAt: { lte: dayEnd }, endAt: { gte: dayStart } },
      }),
      prisma.booking.findMany({
        where: {
          businessId: business.id,
          status: { not: "CANCELLED" },
          startAt: { lte: dayEnd },
          endAt: { gte: dayStart },
        },
      }),
    ]);

    const busyRanges = [
      ...timeOffs.map((t) => ({ start: t.startAt, end: t.endAt })),
      ...existingBookings.map((b) => ({ start: b.startAt, end: b.endAt })),
    ];

    const validSlots = computeAvailableSlots({
      dateStr,
      timezone: business.timezone,
      openTime: workingHour.openTime,
      closeTime: workingHour.closeTime,
      breakStart: workingHour.breakStart,
      breakEnd: workingHour.breakEnd,
      durationMinutes: service.durationMinutes,
      busyRanges,
    });

    const isValid = validSlots.some((slot) => Math.abs(slot.getTime() - startAt.getTime()) < 1000);
    if (!isValid) {
      return NextResponse.json(
        { error: "این زمان دیگر آزاد نیست، لطفاً زمان دیگری انتخاب کنید." },
        { status: 409 }
      );
    }

    const price = Number(service.price);
    const depositDue = computeDeposit(service.depositType, Number(service.depositValue), price);
    const requiresDeposit = depositDue > 0;

    try {
      const result = await prisma.$transaction(async (tx) => {
        const conflict = await tx.booking.findFirst({
          where: {
            businessId: business.id,
            status: { not: "CANCELLED" },
            startAt: { lt: endAt },
            endAt: { gt: startAt },
          },
        });
        if (conflict) throw new Error("SLOT_TAKEN");

        const booking = await tx.booking.create({
          data: {
            businessId: business.id,
            serviceId: service.id,
            customerName: parsed.data.customerName,
            customerPhone: parsed.data.customerPhone,
            customerEmail: parsed.data.customerEmail || null,
            startAt,
            endAt,
            timezone: business.timezone,
            status: requiresDeposit ? "PENDING_PAYMENT" : "CONFIRMED",
            servicePrice: price,
            finalPrice: price,
            depositType: service.depositType,
            depositValue: service.depositValue,
            depositDue,
            remainingAmount: price - depositDue,
            currency: business.currency,
            paymentStatus: requiresDeposit ? "PENDING" : "NOT_REQUIRED",
          },
        });

        if (requiresDeposit) {
          await tx.payment.create({
            data: {
              bookingId: booking.id,
              type: "DEPOSIT",
              amount: depositDue,
              currency: business.currency,
              status: "PENDING",
            },
          });
        }

        return booking;
      });

      let paymentMethod = null;
      if (requiresDeposit) {
        paymentMethod = await prisma.paymentMethod.findFirst({ where: { businessId: business.id } });
      }

      const localTime = toZonedTime(startAt, business.timezone);
      const timeLabel = format(localTime, "yyyy-MM-dd HH:mm");

      void notifyUser(
        business.owner.telegramId,
        `📅 رزرو جدید در ${business.name}\n` +
          `سرویس: ${service.name}\n` +
          `مشتری: ${parsed.data.customerName} (${parsed.data.customerPhone})\n` +
          `زمان: ${timeLabel}\n` +
          (requiresDeposit
            ? `بیعانه: ${formatPrice(depositDue, business.currency)} (در انتظار پرداخت)`
            : `مبلغ: ${formatPrice(price, business.currency)}`)
      );

      return NextResponse.json(
        {
          booking: { id: result.id, requiresDeposit, depositDue, currency: business.currency },
          paymentMethod: paymentMethod
            ? {
                accountHolder: paymentMethod.accountHolder,
                bankName: paymentMethod.bankName,
                cardNumber: paymentMethod.cardNumber,
                instructions: paymentMethod.instructions,
              }
            : null,
        },
        { status: 201 }
      );
    } catch (txError) {
      if (txError instanceof Error && txError.message === "SLOT_TAKEN") {
        return NextResponse.json(
          { error: "این زمان همین الان توسط شخص دیگری رزرو شد." },
          { status: 409 }
        );
      }
      throw txError;
    }
  } catch (error) {
    console.error("POST /api/public/business/[slug]/bookings failed:", error);
    return NextResponse.json({ error: "ثبت رزرو ناموفق بود." }, { status: 500 });
  }
}
