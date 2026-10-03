import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth/session";
import { businessOwnerFilter } from "@/lib/auth/ownership";
import { isRateLimited, triggerRateLimitCleanup } from "@/lib/rate-limit";
import { lockBusinessSchedule } from "@/lib/booking/schedule";

const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

const workingHourSchema = z.object({
  businessId: z.string().min(1).max(100),
  dayOfWeek: z.coerce.number().int().min(0).max(6),
  enabled: z.boolean(),
  openTime: z.string().regex(timePattern),
  closeTime: z.string().regex(timePattern),
  breakStart: z.string().regex(timePattern).nullable().optional(),
  breakEnd: z.string().regex(timePattern).nullable().optional(),
});

const updateSchema = z.object({
  businessId: z.string().min(1).max(100),
  days: z.array(workingHourSchema.omit({ businessId: true })).min(1).max(7),
});

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
      where: { id: businessId, ...businessOwnerFilter(user) },
      select: { id: true, timezone: true },
    });
    if (!business) {
      return NextResponse.json(
        { error: "کسب‌وکار پیدا نشد." },
        { status: 404 }
      );
    }

    const hours = await prisma.workingHour.findMany({
      where: { businessId: business.id },
      orderBy: { dayOfWeek: "asc" },
    });

    return NextResponse.json({
      timezone: business.timezone,
      workingHours: hours.map((hour) => ({
        id: hour.id,
        dayOfWeek: hour.dayOfWeek,
        enabled: hour.enabled,
        openTime: hour.openTime,
        closeTime: hour.closeTime,
        breakStart: hour.breakStart,
        breakEnd: hour.breakEnd,
      })),
    });
  } catch (error) {
    console.error(
      "GET /api/working-hours failed:",
      error instanceof Error ? error.name : "UnknownError"
    );
    return NextResponse.json(
      { error: "خطا در دریافت ساعت‌های کاری" },
      { status: 500 }
    );
  }
}

export async function PUT(req: NextRequest) {
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

    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "اطلاعات ساعت کاری معتبر نیست." },
        { status: 400 }
      );
    }

    const { businessId, days } = parsed.data;
    if (new Set(days.map((day) => day.dayOfWeek)).size !== days.length) {
      return NextResponse.json(
        { error: "هر روز هفته فقط یک‌بار می‌تواند ثبت شود." },
        { status: 400 }
      );
    }

    const business = await prisma.business.findFirst({
      where: { id: businessId, ...businessOwnerFilter(user) },
      select: { id: true },
    });
    if (!business) {
      return NextResponse.json(
        { error: "کسب‌وکار پیدا نشد." },
        { status: 404 }
      );
    }

    if (
      await isRateLimited(`working-hours:${user.id}:${business.id}`, 30, 10 * 60 * 1000)
    ) {
      return NextResponse.json(
        { error: "درخواست‌های زیاد. کمی صبر کنید." },
        { status: 429 }
      );
    }
    triggerRateLimitCleanup();

    for (const day of days) {
      const hasBreakStart = Boolean(day.breakStart);
      const hasBreakEnd = Boolean(day.breakEnd);
      if (hasBreakStart !== hasBreakEnd) {
        return NextResponse.json(
          { error: `بازه استراحت روز ${day.dayOfWeek} کامل نیست.` },
          { status: 400 }
        );
      }

      if (day.enabled && day.openTime >= day.closeTime) {
        return NextResponse.json(
          {
            error: `ساعت شروع و پایان برای روز ${day.dayOfWeek} معتبر نیست.`,
          },
          { status: 400 }
        );
      }

      if (day.enabled && day.breakStart && day.breakEnd) {
        if (
          day.breakStart >= day.breakEnd ||
          day.breakStart < day.openTime ||
          day.breakEnd > day.closeTime
        ) {
          return NextResponse.json(
            { error: `ساعت استراحت روز ${day.dayOfWeek} معتبر نیست.` },
            { status: 400 }
          );
        }
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      await lockBusinessSchedule(tx, business.id);

      const currentBusiness = await tx.business.findFirst({
        where: { id: business.id, ...businessOwnerFilter(user) },
        select: { id: true, timezone: true },
      });
      if (!currentBusiness) throw new Error("BUSINESS_NOT_FOUND");

      for (const day of days) {
        await tx.workingHour.upsert({
          where: {
            businessId_dayOfWeek: {
              businessId: business.id,
              dayOfWeek: day.dayOfWeek,
            },
          },
          update: {
            enabled: day.enabled,
            openTime: day.openTime,
            closeTime: day.closeTime,
            breakStart: day.breakStart ?? null,
            breakEnd: day.breakEnd ?? null,
          },
          create: {
            businessId: business.id,
            dayOfWeek: day.dayOfWeek,
            enabled: day.enabled,
            openTime: day.openTime,
            closeTime: day.closeTime,
            breakStart: day.breakStart ?? null,
            breakEnd: day.breakEnd ?? null,
          },
        });
      }

      const hours = await tx.workingHour.findMany({
        where: { businessId: business.id },
        orderBy: { dayOfWeek: "asc" },
      });
      return { hours, timezone: currentBusiness.timezone };
    });

    return NextResponse.json({
      timezone: result.timezone,
      workingHours: result.hours.map((hour) => ({
        id: hour.id,
        dayOfWeek: hour.dayOfWeek,
        enabled: hour.enabled,
        openTime: hour.openTime,
        closeTime: hour.closeTime,
        breakStart: hour.breakStart,
        breakEnd: hour.breakEnd,
      })),
    });
  } catch (error) {
    if (error instanceof Error && error.message === "BUSINESS_NOT_FOUND") {
      return NextResponse.json(
        { error: "کسب‌وکار پیدا نشد." },
        { status: 404 }
      );
    }
    console.error(
      "PUT /api/working-hours failed:",
      error instanceof Error ? error.name : "UnknownError"
    );
    return NextResponse.json(
      { error: "ذخیره ساعت‌های کاری ناموفق بود." },
      { status: 500 }
    );
  }
}
