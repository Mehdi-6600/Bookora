import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { format } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { prisma } from "@/lib/prisma";
import { computeAvailableSlots } from "@/lib/availability";
import { formatPrice } from "@/lib/currency";
import { notifyUser } from "@/lib/telegram/notify";
import { isRateLimited, triggerRateLimitCleanup } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/get-client-ip";

const phonePattern = /^[0-9+\-\s()]{6,20}$/;

const createBookingSchema = z.object({
  serviceId: z.string().min(1),
  startAt: z.string().datetime(),
  customerName: z.string().trim().min(1).max(120),
  customerPhone: z
    .string()
    .trim()
    .regex(phonePattern, "شماره تلفن معتبر نیست."),
  customerEmail: z.string().trim().email().nullable().optional(),
});

function computeDeposit(
  depositType: string,
  depositValue: number,
  price: number
): number {
  const type = String(depositType || "").trim().toUpperCase();
  const value = Number(depositValue);

  if (!Number.isFinite(value) || value <= 0) return 0;
  if (type === "PERCENTAGE") {
    return Math.round(((price * value) / 100) * 100) / 100;
  }
  if (type === "FIXED") {
    return Math.min(value, price);
  }
  return 0;
}

class SlotTakenError extends Error {
  constructor() {
    super("SLOT_TAKEN");
    this.name = "SlotTakenError";
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const resolved = await params;
    const slug = resolved.slug;
    const ip = getClientIp(req);

    if (await isRateLimited("booking:" + ip, 10, 10 * 60 * 1000)) {
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

    const parsed = createBookingSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "اطلاعات رزرو معتبر نیست." },
        { status: 400 }
      );
    }

    const business = await prisma.business.findFirst({
      where: { slug, status: "ACTIVE" },
      include: {
        owner: { select: { telegramId: true } },
      },
    });

    if (!business) {
      return NextResponse.json(
        { error: "کسب‌وکار پیدا نشد." },
        { status: 404 }
      );
    }

    const service = await prisma.service.findFirst({
      where: {
        id: parsed.data.serviceId,
        businessId: business.id,
        active: true,
      },
    });

    if (!service) {
      return NextResponse.json(
        { error: "سرویس پیدا نشد." },
        { status: 404 }
      );
    }

    const startAt = new Date(parsed.data.startAt);
    const durationMs = service.durationMinutes * 60000;
    const endAt = new Date(startAt.getTime() + durationMs);

    if (startAt.getTime() <= Date.now()) {
      return NextResponse.json(
        { error: "این زمان دیگر معتبر نیست." },
        { status: 400 }
      );
    }

    const localDate = toZonedTime(startAt, business.timezone);
    const dateStr = format(localDate, "yyyy-MM-dd");
    const dayOfWeek = localDate.getUTCDay();

    const workingHour = await prisma.workingHour.findUnique({
      where: {
        businessId_dayOfWeek: {
          businessId: business.id,
          dayOfWeek,
        },
      },
    });

    if (!workingHour || !workingHour.enabled) {
      return NextResponse.json(
        { error: "این روز کسب‌وکار تعطیل است." },
        { status: 409 }
      );
    }

    const dayStart = fromZonedTime(
      dateStr + "T00:00:00",
      business.timezone
    );
    const dayEnd = fromZonedTime(
      dateStr + "T23:59:59",
      business.timezone
    );

    const timeOffs = await prisma.timeOff.findMany({
      where: {
        businessId: business.id,
        startAt: { lte: dayEnd },
        endAt: { gte: dayStart },
      },
    });

    const existingBookings = await prisma.booking.findMany({
      where: {
        businessId: business.id,
        status: { not: "CANCELLED" },
        startAt: { lte: dayEnd },
        endAt: { gte: dayStart },
      },
    });

    const timeOffRanges = timeOffs.map((t) => ({
      start: t.startAt,
      end: t.endAt,
    }));

    const bookingRanges = existingBookings.map((b) => ({
      start: b.startAt,
      end: b.endAt,
    }));

    const busyRanges = [...timeOffRanges, ...bookingRanges];

    const validSlots = computeAvailableSlots({
      dateStr,
      timezone: business.timezone,
      openTime: workingHour.openTime,
      closeTime: workingHour.closeTime,
      breakStart: workingHour.breakStart,
      breakEnd: workingHour.breakEnd,
      durationMinutes: service.durationMinutes,
      slotIntervalMinutes: service.slotIntervalMinutes,
      busyRanges,
    });

    const isValid = validSlots.some(
      (slot) => Math.abs(slot.getTime() - startAt.getTime()) < 1000
    );

    if (!isValid) {
      return NextResponse.json(
        {
          error:
            "این زمان دیگر آزاد نیست، لطفاً زمان دیگری انتخاب کنید.",
        },
        { status: 409 }
      );
    }

    const price = Number(service.price);
    const configuredDeposit = computeDeposit(
      String(service.depositType || ""),
      Number(service.depositValue || 0),
      price
    );

    const paymentMethod = await prisma.paymentMethod.findFirst({
      where: { businessId: business.id, active: true },
    });

    const requiresPayment =
      configuredDeposit > 0 || Boolean(paymentMethod);

    if (requiresPayment && !paymentMethod) {
      return NextResponse.json(
        {
          error: "روش پرداخت این کسب‌وکار هنوز تنظیم نشده است.",
        },
        { status: 409 }
      );
    }

    const paymentDue =
      configuredDeposit > 0
        ? configuredDeposit
        : paymentMethod
        ? price
        : 0;

    const paymentRequired = paymentDue > 0;

    const effectiveDepositType = paymentRequired
      ? configuredDeposit > 0
        ? String(service.depositType)
        : "FIXED"
      : "NONE";

    const effectiveDepositValue = paymentRequired ? paymentDue : 0;

    try {
      const result = await prisma.$transaction(async (tx) => {
        // قفل اتمیک روی (businessId, startAt) برای جلوگیری از double booking.
        // pg_advisory_xact_lock در پایان transaction خودکار آزاد می‌شود.
        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(
            hashtext(${business.id}::text),
            hashtext(${startAt.toISOString()}::text)
          )
        `;

        const conflict = await tx.booking.findFirst({
          where: {
            businessId: business.id,
            status: { not: "CANCELLED" },
            startAt: { lt: endAt },
            endAt: { gt: startAt },
          },
        });

        if (conflict) {
          throw new SlotTakenError();
        }

        const initialStatus = paymentRequired
          ? "PENDING_PAYMENT"
          : "CONFIRMED";

        const initialPaymentStatus = paymentRequired
          ? "PENDING"
          : "NOT_REQUIRED";

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
            status: initialStatus,
            servicePrice: price,
            finalPrice: price,
            depositType: effectiveDepositType,
            depositValue: effectiveDepositValue,
            depositDue: paymentDue,
            remainingAmount: price - paymentDue,
            currency: business.currency,
            paymentStatus: initialPaymentStatus,
          },
        });

        if (paymentRequired) {
          await tx.payment.create({
            data: {
              bookingId: booking.id,
              type: "DEPOSIT",
              amount: paymentDue,
              currency: business.currency,
              status: "PENDING",
              method: "MANUAL",
            },
          });
        }

        return booking;
      });

      if (!paymentRequired) {
        const localTime = toZonedTime(startAt, business.timezone);
        const timeLabel = format(localTime, "yyyy-MM-dd HH:mm");
        const priceLabel = formatPrice(price, business.currency);

        const lines = [
          "📅 رزرو جدید در " + business.name,
          "سرویس: " + service.name,
          "مشتری: " + parsed.data.customerName + " (" + parsed.data.customerPhone + ")",
          "زمان: " + timeLabel,
          "مبلغ: " + priceLabel,
        ];

        void notifyUser(business.owner.telegramId, lines.join("\n")).catch(
          (err) => {
            console.error("notifyUser failed (new booking):", err);
          }
        );
      }

      const bookingPayload = {
        id: result.id,
        requiresDeposit: paymentRequired,
        depositDue: paymentDue,
        currency: business.currency,
      };

      const paymentMethodPayload =
        paymentRequired && paymentMethod
          ? {
              accountHolder: paymentMethod.accountHolder,
              bankName: paymentMethod.bankName,
              cardNumber: paymentMethod.cardNumber,
              instructions: paymentMethod.instructions,
            }
          : null;

      return NextResponse.json(
        { booking: bookingPayload, paymentMethod: paymentMethodPayload },
        { status: 201 }
      );
    } catch (txError) {
      if (txError instanceof SlotTakenError) {
        return NextResponse.json(
          { error: "این زمان همین الان توسط شخص دیگری رزرو شد." },
          { status: 409 }
        );
      }
      throw txError;
    }
  } catch (error) {
    console.error(
      "POST /api/public/business/[slug]/bookings failed:",
      error
    );
    return NextResponse.json(
      { error: "ثبت رزرو ناموفق بود." },
      { status: 500 }
    );
  }
}
