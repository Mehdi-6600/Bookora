import { NextRequest, NextResponse } from "next/server";
import { fromZonedTime } from "date-fns-tz";
import { prisma } from "@/lib/prisma";
import { computeAvailableSlots } from "@/lib/availability";
import { isRateLimited, triggerRateLimitCleanup } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/get-client-ip";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const ip = getClientIp(req);

    // نرخ سبک برای endpoint پرترافیک.
    if (await isRateLimited("avail:" + ip, 60, 10 * 60 * 1000)) {
      return NextResponse.json(
        { error: "درخواست‌های زیاد. کمی صبر کنید." },
        { status: 429 }
      );
    }

    triggerRateLimitCleanup();

    const resolved = await params;
    const slug = resolved.slug;
    const serviceId = req.nextUrl.searchParams.get("serviceId");
    const date = req.nextUrl.searchParams.get("date");

    if (!serviceId || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json(
        { error: "پارامترها نامعتبرند." },
        { status: 400 }
      );
    }

    const business = await prisma.business.findFirst({
      where: { slug: slug, status: "ACTIVE" },
      select: { id: true, timezone: true },
    });

    if (!business) {
      return NextResponse.json(
        { error: "کسب‌وکار پیدا نشد." },
        { status: 404 }
      );
    }

    const service = await prisma.service.findFirst({
      where: { id: serviceId, businessId: business.id, active: true },
      select: {
        durationMinutes: true,
        slotIntervalMinutes: true,
      },
    });

    if (!service) {
      return NextResponse.json(
        { error: "سرویس پیدا نشد." },
        { status: 404 }
      );
    }

    const dayOfWeek = new Date(date + "T00:00:00Z").getUTCDay();

    const workingHour = await prisma.workingHour.findUnique({
      where: {
        businessId_dayOfWeek: {
          businessId: business.id,
          dayOfWeek: dayOfWeek,
        },
      },
    });

    if (!workingHour || !workingHour.enabled) {
      return NextResponse.json({ slots: [] });
    }

    const dayStart = fromZonedTime(date + "T00:00:00", business.timezone);
    const dayEnd = fromZonedTime(date + "T23:59:59", business.timezone);

    const timeOffs = await prisma.timeOff.findMany({
      where: {
        businessId: business.id,
        startAt: { lte: dayEnd },
        endAt: { gte: dayStart },
      },
    });

    const bookings = await prisma.booking.findMany({
      where: {
        businessId: business.id,
        status: { not: "CANCELLED" },
        startAt: { lte: dayEnd },
        endAt: { gte: dayStart },
      },
    });

    const busyRanges = [
      ...timeOffs.map((t) => ({ start: t.startAt, end: t.endAt })),
      ...bookings.map((b) => ({ start: b.startAt, end: b.endAt })),
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
      busyRanges: busyRanges,
    });

    const now = Date.now();
    const futureSlots = slots.filter((slot) => slot.getTime() > now);

    return NextResponse.json({
      slots: futureSlots.map((slot) => slot.toISOString()),
    });
  } catch (error) {
    console.error(
      "GET /api/public/business/[slug]/availability failed:",
      error
    );
    return NextResponse.json(
      { error: "خطا در دریافت زمان‌های آزاد" },
      { status: 500 }
    );
  }
}
