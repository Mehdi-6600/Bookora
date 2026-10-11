import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { formatInTimeZone } from "date-fns-tz";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { computeAvailableSlots } from "@/lib/availability";
import { formatPrice } from "@/lib/currency";
import { notifyUser } from "@/lib/telegram/notify";
import { isRateLimited, triggerRateLimitCleanup } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/get-client-ip";
import { markFirstBooking } from "@/lib/outreach/attribution";
import { recordFunnelEvent } from "@/lib/funnel";
import { getCurrentUser } from "@/lib/auth/session";
import {
  activeBookingOverlapWhere,
  expireStalePendingBookings,
  lockBusinessSchedule,
  pendingBookingCutoff,
} from "@/lib/booking/schedule";
import {
  getBusinessDate,
  getBusinessDayBounds,
  getBusinessDayOfWeek,
  isWithinBookingWindow,
} from "@/lib/booking/time";

const phonePattern = /^[0-9+\- ()]{6,20}$/;
const idempotencySchema = z.string().uuid();

const createBookingSchema = z.object({
  serviceId: z.string().min(1).max(100),
  startAt: z.string().datetime(),
  customerName: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .refine(
      (value) => !/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(value)
    ),
  customerPhone: z
    .string()
    .trim()
    .regex(phonePattern, "phone")
    .refine((value) => (value.match(/[0-9]/g) || []).length >= 6),
  customerEmail: z.string().trim().email().max(254).nullable().optional(),
  isTestBooking: z.boolean().optional(),
});

class SlotTakenError extends Error {}
class BusinessUnavailableError extends Error {}
class ServiceUnavailableError extends Error {}
class InvalidBookingTimeError extends Error {}
class BookingExpiredError extends Error {}
class IdempotencyConflictError extends Error {}

function computeDepositCents(
  depositType: string,
  depositValue: Prisma.Decimal,
  priceCents: number
): number {
  if (!Number.isSafeInteger(priceCents) || priceCents <= 0) return 0;

  const type = depositType.trim().toUpperCase();
  const value = depositValue.toNumber();
  if (!Number.isFinite(value) || value <= 0) return 0;

  if (type === "PERCENTAGE") {
    return Math.min(priceCents, Math.round((priceCents * value) / 100));
  }
  if (type === "FIXED") {
    return Math.min(priceCents, Math.round(depositValue.mul(100).toNumber()));
  }
  return 0;
}

function sameIdempotentRequest(
  existing: {
    businessId: string;
    serviceId: string;
    startAt: Date;
    customerName: string;
    customerPhone: string;
    customerEmail: string | null;
    isTestBooking: boolean;
  },
  input: z.infer<typeof createBookingSchema>,
  businessId: string,
  startAt: Date
): boolean {
  return (
    existing.businessId === businessId &&
    existing.serviceId === input.serviceId &&
    existing.startAt.getTime() === startAt.getTime() &&
    existing.customerName === input.customerName &&
    existing.customerPhone === input.customerPhone &&
    existing.customerEmail === (input.customerEmail || null) &&
    existing.isTestBooking === (input.isTestBooking ?? false)
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function responseForBooking(
  booking: {
    id: string;
    status: string;
    paymentStatus: string;
    depositDue: Prisma.Decimal;
    currency: string;
    receiptToken: string | null;
  },
  hasDepositPayment: boolean,
  paymentMethod: {
    accountHolder: string | null;
    bankName: string | null;
    cardNumber: string | null;
    instructions: string | null;
  } | null
) {
  return {
    booking: {
      id: booking.id,
      confirmed: booking.status === "CONFIRMED",
      requiresDeposit: hasDepositPayment,
      depositDue: booking.depositDue.toString(),
      currency: booking.currency,
      receiptToken: hasDepositPayment ? booking.receiptToken : null,
    },
    paymentMethod: hasDepositPayment ? paymentMethod : null,
  };
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const ip = getClientIp(req);

    if (await isRateLimited("booking:ip:" + ip, 10, 10 * 60 * 1000)) {
      return NextResponse.json(
        { error: "too many requests" },
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
        { error: "invalid booking" },
        { status: 400 }
      );
    }

    // Public callers may request a test booking only with an authenticated
    // administrator session. A client-supplied flag alone is never trusted.
    if (parsed.data.isTestBooking && !(await getCurrentUser())?.isAdmin) {
      return NextResponse.json({ error: "Only an administrator can create a test booking." }, { status: 403 });
    }

    const suppliedKey = req.headers.get("idempotency-key");
    let idempotencyKey: string = crypto.randomUUID();
    if (suppliedKey !== null) {
      const keyResult = idempotencySchema.safeParse(suppliedKey);
      if (!keyResult.success) {
        return NextResponse.json(
          { error: "invalid idempotency key" },
          { status: 400 }
        );
      }
      idempotencyKey = keyResult.data.toLowerCase();
    }

    const businessRef = await prisma.business.findUnique({
      where: { slug },
      select: { id: true },
    });

    if (!businessRef) {
      return NextResponse.json(
        { error: "business not found" },
        { status: 404 }
      );
    }

    const phoneDigits = parsed.data.customerPhone.replace(/\D/g, "");
    if (
      await isRateLimited(
        "booking:phone:" + businessRef.id + ":" + phoneDigits,
        5,
        10 * 60 * 1000
      )
    ) {
      return NextResponse.json(
        { error: "too many requests for this phone" },
        { status: 429 }
      );
    }

    const startAt = new Date(parsed.data.startAt);
    const transactionResult = await prisma.$transaction(async (tx) => {
      await lockBusinessSchedule(tx, businessRef.id);

      const now = new Date();
      await expireStalePendingBookings(tx, businessRef.id, now);

      const existingByKey = await tx.booking.findUnique({
        where: { idempotencyKey: idempotencyKey },
        include: {
          payments: {
            where: { type: "DEPOSIT" },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      });

      if (existingByKey) {
        if (
          !sameIdempotentRequest(
            existingByKey,
            parsed.data,
            businessRef.id,
            startAt
          )
        ) {
          throw new IdempotencyConflictError();
        }

        if (
          existingByKey.status === "CANCELLED" ||
          (existingByKey.status !== "CONFIRMED" &&
            existingByKey.status !== "PENDING_PAYMENT") ||
          (existingByKey.status === "PENDING_PAYMENT" &&
            (existingByKey.createdAt < pendingBookingCutoff(now) ||
              existingByKey.paymentStatus !== "PENDING"))
        ) {
          throw new BookingExpiredError();
        }

        const paymentMethod = existingByKey.payments.length
          ? await tx.paymentMethod.findFirst({
              where: { businessId: businessRef.id, active: true },
              select: {
                accountHolder: true,
                bankName: true,
                cardNumber: true,
                instructions: true,
              },
            })
          : null;

        return {
          booking: existingByKey,
          paymentMethod,
          hasDepositPayment: existingByKey.payments.length > 0,
          created: false,
          business: null,
          service: null,
        };
      }

      const business = await tx.business.findFirst({
        where: {
          id: businessRef.id,
          slug,
          status: "ACTIVE",
        },
        select: {
          id: true,
          name: true,
          currency: true,
          timezone: true,
          owner: { select: { telegramId: true } },
        },
      });

      if (!business) throw new BusinessUnavailableError();

      const service = await tx.service.findFirst({
        where: {
          id: parsed.data.serviceId,
          businessId: business.id,
          active: true,
        },
      });
      if (!service) throw new ServiceUnavailableError();

      if (startAt.getTime() <= now.getTime()) {
        throw new InvalidBookingTimeError();
      }

      const localDate = getBusinessDate(startAt, business.timezone);
      if (!isWithinBookingWindow(localDate, business.timezone, now)) {
        throw new InvalidBookingTimeError();
      }

      const dayOfWeek = getBusinessDayOfWeek(localDate);
      const workingHour = await tx.workingHour.findUnique({
        where: {
          businessId_dayOfWeek: {
            businessId: business.id,
            dayOfWeek,
          },
        },
      });

      if (!workingHour || !workingHour.enabled) {
        throw new InvalidBookingTimeError();
      }

      const bounds = getBusinessDayBounds(localDate, business.timezone);
      const dayStart = bounds.start;
      const dayEnd = bounds.endExclusive;

      const timeOffs = await tx.timeOff.findMany({
        where: {
          businessId: business.id,
          startAt: { lt: dayEnd },
          endAt: { gt: dayStart },
        },
        select: { startAt: true, endAt: true },
      });

      const existingBookings = await tx.booking.findMany({
        where: {
          businessId: business.id,
          startAt: { lt: dayEnd },
          endAt: { gt: dayStart },
          ...activeBookingOverlapWhere(now),
        },
        select: { startAt: true, endAt: true },
      });

      const busyRanges = [
        ...timeOffs.map((timeOff) => ({
          start: timeOff.startAt,
          end: timeOff.endAt,
        })),
        ...existingBookings.map((booking) => ({
          start: booking.startAt,
          end: booking.endAt,
        })),
      ];

      const validSlots = computeAvailableSlots({
        dateStr: localDate,
        timezone: business.timezone,
        openTime: workingHour.openTime,
        closeTime: workingHour.closeTime,
        breakStart: workingHour.breakStart,
        breakEnd: workingHour.breakEnd,
        durationMinutes: service.durationMinutes,
        slotIntervalMinutes: service.slotIntervalMinutes,
        busyRanges,
      });

      const isValidSlot = validSlots.some(
        (slot) => slot.getTime() === startAt.getTime()
      );
      if (!isValidSlot) throw new SlotTakenError();

      const priceCents = service.price.mul(100).toNumber();
      if (!Number.isSafeInteger(priceCents) || priceCents < 0) {
        throw new ServiceUnavailableError();
      }
      const configuredDepositCents = computeDepositCents(
        service.depositType,
        service.depositValue,
        priceCents
      );

      const paymentMethod = await tx.paymentMethod.findFirst({
        where: { businessId: business.id, active: true },
        select: {
          accountHolder: true,
          bankName: true,
          cardNumber: true,
          instructions: true,
        },
      });

      const requiresPaymentConfiguration =
        configuredDepositCents > 0 || Boolean(paymentMethod);
      if (requiresPaymentConfiguration && !paymentMethod) {
        throw new BusinessUnavailableError();
      }

      const paymentDueCents =
        configuredDepositCents > 0
          ? configuredDepositCents
          : paymentMethod
          ? priceCents
          : 0;
      const hasDepositPayment = paymentDueCents > 0;
      const price = new Prisma.Decimal(priceCents).div(100);
      const paymentDue = new Prisma.Decimal(paymentDueCents).div(100);
      const remainingAmount = new Prisma.Decimal(
        priceCents - paymentDueCents
      ).div(100);
      const effectiveDepositType = hasDepositPayment
        ? configuredDepositCents > 0
          ? service.depositType
          : "FIXED"
        : "NONE";

      const receiptToken = hasDepositPayment
        ? crypto.randomUUID().replace(/-/g, "")
        : null;

      const booking = await tx.booking.create({
        data: {
          businessId: business.id,
          serviceId: service.id,
          customerName: parsed.data.customerName,
          customerPhone: parsed.data.customerPhone,
          customerEmail: parsed.data.customerEmail || null,
          isTestBooking: parsed.data.isTestBooking ?? false,
          startAt,
          endAt: new Date(
            startAt.getTime() + service.durationMinutes * 60_000
          ),
          timezone: business.timezone,
          status: hasDepositPayment ? "PENDING_PAYMENT" : "CONFIRMED",
          servicePrice: price,
          finalPrice: price,
          depositType: effectiveDepositType,
          depositValue: hasDepositPayment ? paymentDue : new Prisma.Decimal(0),
          depositDue: paymentDue,
          remainingAmount,
          currency: business.currency,
          paymentStatus: hasDepositPayment ? "PENDING" : "NOT_REQUIRED",
          receiptToken: receiptToken,
          idempotencyKey: idempotencyKey,
        },
      });

      if (hasDepositPayment) {
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

      return {
        booking,
        paymentMethod,
        hasDepositPayment,
        created: true,
        business,
        service,
      };
    });

    if (transactionResult.created && !transactionResult.booking.isTestBooking) {
      // Best-effort growth attribution for genuine bookings only.
      void markFirstBooking(businessRef.id, transactionResult.booking.id);

      // Funnel: a real customer booking was created.
      await recordFunnelEvent({
        event: "booking_created",
        ip,
        userAgent: req.headers.get("user-agent") ?? "",
      });
    }

    if (
      transactionResult.created &&
      !transactionResult.hasDepositPayment &&
      transactionResult.business &&
      transactionResult.service
    ) {
      // A test booking is never presented to the owner as a new customer
      // booking: the message says so, so a pilot conversion can never be
      // mistaken for one. (The notification path itself is still exercised.)
      const isTestBooking = transactionResult.booking.isTestBooking === true;
      const businessTimezone = transactionResult.business.timezone;
      const dateLabel = formatInTimeZone(
        startAt,
        businessTimezone,
        "yyyy-MM-dd"
      );
      const timeLabel = formatInTimeZone(
        startAt,
        businessTimezone,
        "HH:mm"
      );
      const priceLabel = formatPrice(
        transactionResult.booking.servicePrice.toString(),
        transactionResult.business.currency
      );

      const lines = [
        isTestBooking ? "🧪 <b>رزرو آزمایشی (TEST)</b>" : "🎉 <b>رزرو جدید</b>",
        "",
        `🏪 <b>${escapeHtml(transactionResult.business.name)}</b>`,
        "",
        `✂️ سرویس: <b>${escapeHtml(transactionResult.service.name)}</b>`,
        `👤 مشتری: <b>${escapeHtml(parsed.data.customerName)}</b>`,
        `📞 تلفن: <code>${escapeHtml(parsed.data.customerPhone)}</code>`,
        "",
        `📅 تاریخ: <b>${escapeHtml(dateLabel)}</b>`,
        `🕐 ساعت: <b>${escapeHtml(timeLabel)}</b>`,
        `💰 مبلغ: <b>${escapeHtml(priceLabel)}</b>`,
        "",
        "✨ برای مشاهده‌ی جزئیات به بخش «رزروها» در Bookora مراجعه کنید.",
      ];

      void notifyUser(
        transactionResult.business.owner.telegramId,
        lines.join("\n"),
        { parseMode: "HTML" }
      ).catch((err) => {
        console.error(
          "notifyUser failed (new booking):",
          err instanceof Error ? err.name : "UnknownError"
        );
      });
    }

    const result = responseForBooking(
      transactionResult.booking,
      transactionResult.hasDepositPayment,
      transactionResult.paymentMethod
    );

    return NextResponse.json(result, {
      status: transactionResult.created ? 201 : 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof SlotTakenError) {
      return NextResponse.json(
        { error: "slot taken" },
        { status: 409 }
      );
    }
    if (error instanceof InvalidBookingTimeError) {
      return NextResponse.json(
        { error: "invalid booking time" },
        { status: 400 }
      );
    }
    if (error instanceof BookingExpiredError) {
      return NextResponse.json(
        { error: "booking expired" },
        { status: 409 }
      );
    }
    if (error instanceof IdempotencyConflictError) {
      return NextResponse.json(
        { error: "idempotency key conflict" },
        { status: 409 }
      );
    }
    if (error instanceof BusinessUnavailableError) {
      return NextResponse.json(
        { error: "business or payment method unavailable" },
        { status: 409 }
      );
    }
    if (error instanceof ServiceUnavailableError) {
      return NextResponse.json(
        { error: "service unavailable" },
        { status: 404 }
      );
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json(
        { error: "duplicate request" },
        { status: 409 }
      );
    }

    console.error(
      "POST /api/public/business/[slug]/bookings failed:",
      error instanceof Error ? error.name : "UnknownError"
    );
    return NextResponse.json(
      { error: "booking failed" },
      { status: 500 }
    );
  }
}
