import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth/session";

const createTimeOffSchema = z.object({
  businessId: z.string().min(1),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  reason: z.string().trim().max(300).nullable().optional(),
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

    const timeOffs = await prisma.timeOff.findMany({
      where: { businessId: business.id },
      orderBy: { startAt: "asc" },
    });

    return NextResponse.json({
      timeOffs: timeOffs.map((item) => ({
        id: item.id,
        startAt: item.startAt,
        endAt: item.endAt,
        reason: item.reason,
      })),
    });
  } catch (error) {
    console.error("GET /api/time-off failed:", error);

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

    const start = new Date(startAt);
    const end = new Date(endAt);

    if (start >= end) {
      return NextResponse.json(
        { error: "زمان شروع باید قبل از پایان باشد." },
        { status: 400 }
      );
    }

    const timeOff = await prisma.timeOff.create({
      data: {
        businessId: business.id,
        startAt: start,
        endAt: end,
        reason: reason || null,
      },
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
    console.error("POST /api/time-off failed:", error);

    return NextResponse.json(
      { error: "ثبت تعطیلی ناموفق بود." },
      { status: 500 }
    );
  }
}
