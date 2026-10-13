import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { isValidDateOnly } from "@/lib/booking/time";
import { isRateLimited, triggerRateLimitCleanup } from "@/lib/rate-limit";

const holidaySchema = z.object({
  businessId: z.string().min(1).max(100),
  date: z.string().refine(isValidDateOnly, "تاریخ تعطیلی معتبر نیست."),
  reason: z.string().trim().max(500).nullable().optional(),
});

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const businessId = req.nextUrl.searchParams.get("businessId");
    if (!businessId || businessId.length > 100) {
      return NextResponse.json({ error: "businessId لازم است." }, { status: 400 });
    }

    const business = await prisma.business.findFirst({
      where: { id: businessId, ownerId: user.id, deletedAt: null },
      select: { id: true },
    });
    if (!business) {
      return NextResponse.json({ error: "کسب‌وکار پیدا نشد." }, { status: 404 });
    }

    const holidays = await prisma.holiday.findMany({
      where: { businessId: business.id },
      orderBy: { date: "asc" },
    });

    return NextResponse.json({
      holidays: holidays.map((holiday) => ({
        id: holiday.id,
        date: holiday.date.toISOString().slice(0, 10),
        reason: holiday.reason,
      })),
    });
  } catch (error) {
    console.error(
      "GET /api/holidays failed:",
      error instanceof Error ? error.name : "UnknownError"
    );
    return NextResponse.json({ error: "دریافت تعطیلی‌ها ناموفق بود." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (await isRateLimited(`holiday-create:${user.id}`, 30, 10 * 60 * 1000)) {
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

    const parsed = holidaySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "اطلاعات تعطیلی معتبر نیست." },
        { status: 400 }
      );
    }

    const business = await prisma.business.findFirst({
      where: { id: parsed.data.businessId, ownerId: user.id, deletedAt: null },
      select: { id: true },
    });
    if (!business) {
      return NextResponse.json({ error: "کسب‌وکار پیدا نشد." }, { status: 404 });
    }

    const holiday = await prisma.holiday.create({
      data: {
        businessId: business.id,
        date: new Date(`${parsed.data.date}T00:00:00.000Z`),
        reason: parsed.data.reason || null,
      },
    });

    return NextResponse.json(
      {
        holiday: {
          id: holiday.id,
          date: holiday.date.toISOString().slice(0, 10),
          reason: holiday.reason,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json(
        { error: "برای این روز تعطیلی ثبت شده است." },
        { status: 409 }
      );
    }
    console.error(
      "POST /api/holidays failed:",
      error instanceof Error ? error.name : "UnknownError"
    );
    return NextResponse.json({ error: "ثبت تعطیلی ناموفق بود." }, { status: 500 });
  }
}
