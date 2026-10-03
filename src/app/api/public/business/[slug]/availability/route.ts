import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { computeAvailableSlots } from "@/lib/availability";
import { isRateLimited, triggerRateLimitCleanup } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/get-client-ip";
import {
  getBusinessDayBounds,
  getBusinessDayOfWeek,
  isValidDateOnly,
  isWithinBookingWindow,
} from "@/lib/booking/time";
import { activeBookingOverlapWhere } from "@/lib/booking/schedule";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const ip = getClientIp(req);
    if (await isRateLimited(`avail:${ip}`, 60, 10 * 60 * 1000)) {
      return NextResponse.json(
        { error: "درخواست‌های زیاد. کمی صبر کنید." },
        { status: 429 }
      );
    }
    triggerRateLimitCleanup();

    const { slug } = await params;
    const serviceId = req.nextUrl.searchParams.get("serviceId");
    const date = req.nextUrl.searchParams.get("date");

    if (
      !serviceId ||
      serviceId.length > 100 ||
      !date ||
      !isValidDateOnly(date)
    ) {
      return NextResponse.json(
        { error: "پارامترها نامعتبرند." },
        { status: 400 }
      );
    }

    const business = await prisma.business.findFirst({
      where: { slug, status: "ACTIVE" },
      select: { id: true, timezone: true },
    });

    if (!business) {
      return NextResponse.json(
        { error: "کسب‌وکار پیدا نشد." },
        { status: 404 }
      );
    }

    if (!isWithinBookingWindow(date, business.timezone)) {
      return NextResponse.json(
        { error: "این تاریخ خارج از بازه مجاز رزرو است." },
        { status: 400 }
      );
    }

    const service = await prisma.service.findFirst({
      where: { id: serviceId, businessId: business.id, active: true },
      select: { durationMinutes: true, slotIntervalMinutes: true },
    });

    if (!service) {
      return NextResponse.json(
        { error: "سرویس پیدا نشد." },
        { status: 404 }
      );
    }

    const dayOfWeek = getBusinessDayOfWeek(date);
    const workingHour = await prisma.workingHour.findUnique({
      where: {
        businessId_dayOfWeek: { businessId: business.id, dayOfWeek },
      },
    });

    if (!workingHour || !workingHour.enabled) {
      return NextResponse.json({ slots: [] });
    }

    const { start: dayStart, endExclusive: dayEnd } = getBusinessDayBounds(
      date,
      business.timezone
    );
    const now = new Date();

    const [timeOffs, bookings] = await Promise.all([
      prisma.timeOff.findMany({
        where: {
          businessId: business.id,
          startAt: { lt: dayEnd },
          endAt: { gt: dayStart },
        },
        select: { startAt: true, endAt: true },
      }),
      prisma.booking.findMany({
        where: {
          businessId: business.id,
          startAt: { lt: dayEnd },
          endAt: { gt: dayStart },
          ...activeBookingOverlapWhere(now),
        },
        select: { startAt: true, endAt: true },
      }),
    ]);

    const busyRanges = [
      ...timeOffs.map((timeOff) => ({
        start: timeOff.startAt,
        end: timeOff.endAt,
      })),
      ...bookings.map((booking) => ({
        start: booking.startAt,
        end: booking.endAt,
      })),
    ];

    const slots = computeAvailableSlots({
      dateStr: date,
      timezone: business.timezone,
      openTime: workingHour.openTime,
      closeTime: workingHour.closeTime,
      breakStart: workingHour.breakStart,
      breakEnd: workingHour.breakEnd,
      durationMinutes: service.durationMinutes,
      slotIntervalMinutes: service.slotIntervalMinutes,
      busyRanges,
    });

    return NextResponse.json({
      slots: slots
        .filter((slot) => slot.getTime() > now.getTime())
        .map((slot) => slot.toISOString()),
    });
  } catch (error) {
    console.error(
      "GET /api/public/business/[slug]/availability failed:",
      error instanceof Error ? error.name : "UnknownError"
    );
    return NextResponse.json(
      { error: "خطا در دریافت زمان‌های آزاد" },
      { status: 500 }
    );
  }
}
