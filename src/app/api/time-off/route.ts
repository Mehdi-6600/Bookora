import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth/session";
import { isRateLimited, triggerRateLimitCleanup } from "@/lib/rate-limit";
import {
  activeBookingOverlapWhere,
  expireStalePendingBookings,
  lockBusinessSchedule,
} from "@/lib/booking/schedule";

const createTimeOffSchema = z.object({
  businessId: z.string().min(1).max(100),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  reason: z.string().trim().max(300).nullable().optional(),
});

class TimeOffConflictError extends Error {}

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const businessId = req.nextUrl.searchParams.get("businessId");
    if (!businessId || businessId.length > 100) {
      return NextResponse.json(
        { error: "businessId لازم است." },
        { status: 400 }
      );
    }

    const business = await prisma.business.findFirst({
      where: { id: businessId, ownerId: user.id },
      select: { id: true, timezone: true },
    });
    if (!business) {
      return NextResponse.json(
        { error: "کسب‌وکار پیدا نشد." },
        { status: 404 }
      );
    }

    const timeOffs = await prisma.timeOff.findMany({
      where: { businessId: business.id },
      orderBy: { startAt: "asc" },
      select: { id: true, startAt: true, endAt: true, reason: true },
    });

    return NextResponse.json(
      {
        timezone: business.timezone,
        timeOffs,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error(
      "GET /api/time-off failed:",
      error instanceof Error ? error.name : "UnknownError"
    );
    return NextResponse.json(
      { error: "خطا در دریافت تعطیلات" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const parsed = createTimeOffSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "اطلاعات تعطیلی معتبر نیست." },
        { status: 400 }
      );
    }

    const { businessId, startAt, endAt, reason } = parsed.data;
    const start = new Date(startAt);
    const end = new Date(endAt);
    if (start >= end) {
      return NextResponse.json(
        { error: "زمان شروع باید قبل از پایان باشد." },
        { status: 400 }
      );
    }

    const business = await prisma.business.findFirst({
      where: { id: businessId, ownerId: user.id },
      select: { id: true },
    });
    if (!business) {
      return NextResponse.json(
        { error: "کسب‌وکار پیدا نشد." },
        { status: 404 }
      );
    }

    if (
      await isRateLimited(`time-off-create:${user.id}:${business.id}`, 30, 10 * 60 * 1000)
    ) {
      return NextResponse.json(
        { error: "درخواست‌های زیاد. کمی صبر کنید." },
        { status: 429 }
      );
    }
    triggerRateLimitCleanup();

    const timeOff = await prisma.$transaction(async (tx) => {
      await lockBusinessSchedule(tx, business.id);
      const now = new Date();
      await expireStalePendingBookings(tx, business.id, now);

      if (end > now) {
        const overlapStart = start > now ? start : now;
        const overlappingBooking = await tx.booking.findFirst({
          where: {
            businessId: business.id,
            startAt: { lt: end },
            endAt: { gt: overlapStart },
            ...activeBookingOverlapWhere(now),
          },
          select: { id: true },
        });
        if (overlappingBooking) throw new TimeOffConflictError();
      }

      return tx.timeOff.create({
        data: {
          businessId: business.id,
          startAt: start,
          endAt: end,
          reason: reason || null,
        },
      });
    });

    return NextResponse.json(
      {
        timeOff: {
          id: timeOff.id,
          startAt: timeOff.startAt,
          endAt: timeOff.endAt,
          reason: timeOff.reason,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof TimeOffConflictError) {
      return NextResponse.json(
        { error: "این بازه با رزرو تأییدشده یا پرداخت‌درانتظار هم‌پوشانی دارد." },
        { status: 409 }
      );
    }
    console.error(
      "POST /api/time-off failed:",
      error instanceof Error ? error.name : "UnknownError"
    );
    return NextResponse.json(
      { error: "ثبت تعطیلی ناموفق بود." },
      { status: 500 }
    );
  }
}
