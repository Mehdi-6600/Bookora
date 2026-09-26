import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth/session";

const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

const workingHourSchema = z.object({
  businessId: z.string().min(1),
  dayOfWeek: z.coerce.number().int().min(0).max(6),
  enabled: z.boolean(),
  openTime: z.string().regex(timePattern),
  closeTime: z.string().regex(timePattern),
  breakStart: z.string().regex(timePattern).nullable().optional(),
  breakEnd: z.string().regex(timePattern).nullable().optional(),
});

const updateSchema = z.object({
  businessId: z.string().min(1),
  days: z.array(workingHourSchema.omit({ businessId: true })).min(1).max(7),
});

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const businessId = req.nextUrl.searchParams.get("businessId");
    if (!businessId) {
      return NextResponse.json(
        { error: "businessId لازم است." },
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

    const hours = await prisma.workingHour.findMany({
      where: { businessId: business.id },
      orderBy: { dayOfWeek: "asc" },
    });

    return NextResponse.json({
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
    console.error("GET /api/working-hours failed:", error);
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
        {
          error: "اطلاعات ساعت کاری معتبر نیست.",
          details: parsed.error.flatten(),
        },
        { status: 400 }
      );
    }

    const { businessId, days } = parsed.data;

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

    for (const day of days) {
      if (day.enabled && day.openTime >= day.closeTime) {
        return NextResponse.json(
          {
            error: `ساعت شروع و پایان برای روز ${day.dayOfWeek} معتبر نیست.`,
          },
          { status: 400 }
        );
      }

      if (day.breakStart && day.breakEnd) {
        if (day.breakStart >= day.breakEnd) {
          return NextResponse.json(
            {
              error: `ساعت استراحت برای روز ${day.dayOfWeek} معتبر نیست.`,
            },
            { status: 400 }
          );
        }
      }
    }

    await prisma.$transaction(
      days.map((day) =>
        prisma.workingHour.upsert({
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
        })
      )
    );

    const hours = await prisma.workingHour.findMany({
      where: { businessId: business.id },
      orderBy: { dayOfWeek: "asc" },
    });

    return NextResponse.json({
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
    console.error("PUT /api/working-hours failed:", error);
    return NextResponse.json(
      { error: "ذخیره ساعت‌های کاری ناموفق بود." },
      { status: 500 }
    );
  }
}
