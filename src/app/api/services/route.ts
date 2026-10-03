import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth/session";
import { isRateLimited, triggerRateLimitCleanup } from "@/lib/rate-limit";
import { lockBusinessSchedule } from "@/lib/booking/schedule";

const MAX_PRICE = 99_999_999.99;
const isMoneyAmount = (value: number) =>
  Math.abs(value * 100 - Math.round(value * 100)) < 0.000001;

const depositSchema = z
  .object({
    depositType: z.enum(["NONE", "PERCENTAGE", "FIXED"]).default("NONE"),
    depositValue: z
      .coerce.number().finite().min(0).max(MAX_PRICE)
      .refine(isMoneyAmount, "مبلغ بیعانه حداکثر دو رقم اعشار دارد.")
      .default(0),
  })
  .refine(
    (deposit) =>
      deposit.depositType !== "PERCENTAGE" || deposit.depositValue <= 100,
    {
      message: "درصد بیعانه نمی‌تواند بیشتر از ۱۰۰ باشد.",
      path: ["depositValue"],
    }
  );

const createServiceSchema = z
  .object({
    businessId: z.string().min(1).max(100),
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(1000).nullable().optional(),
    price: z
      .coerce.number().finite().min(0).max(MAX_PRICE)
      .refine(isMoneyAmount, "قیمت حداکثر دو رقم اعشار دارد."),
    durationMinutes: z.coerce.number().int().min(1).max(1440),
    slotIntervalMinutes: z.coerce.number().int().min(5).max(480).optional(),
  })
  .and(depositSchema);

class BusinessNotFoundError extends Error {}

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const businessId = req.nextUrl.searchParams.get("businessId");
    if (businessId && businessId.length > 100) {
      return NextResponse.json(
        { error: "businessId نامعتبر است." },
        { status: 400 }
      );
    }

    const services = await prisma.service.findMany({
      where: {
        business: { ownerId: user.id },
        ...(businessId ? { businessId } : {}),
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });

    return NextResponse.json({
      services: services.map((service) => ({
        id: service.id,
        businessId: service.businessId,
        name: service.name,
        description: service.description,
        price: service.price.toString(),
        currency: service.currency,
        durationMinutes: service.durationMinutes,
        slotIntervalMinutes: service.slotIntervalMinutes,
        active: service.active,
        depositType: service.depositType,
        depositValue: service.depositValue.toString(),
      })),
    });
  } catch (error) {
    console.error(
      "GET /api/services failed:",
      error instanceof Error ? error.name : "UnknownError"
    );
    return NextResponse.json(
      { error: "خطا در دریافت سرویس‌ها" },
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

    const parsed = createServiceSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "اطلاعات سرویس معتبر نیست.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const business = await prisma.business.findFirst({
      where: { id: parsed.data.businessId, ownerId: user.id },
      select: { id: true },
    });
    if (!business) {
      return NextResponse.json({ error: "کسب‌وکار پیدا نشد." }, { status: 404 });
    }

    if (
      await isRateLimited(`service-create:${user.id}:${business.id}`, 30, 60 * 60 * 1000)
    ) {
      return NextResponse.json(
        { error: "درخواست‌های زیاد. کمی بعد دوباره تلاش کنید." },
        { status: 429 }
      );
    }
    triggerRateLimitCleanup();

    const slotIntervalMinutes =
      parsed.data.slotIntervalMinutes === undefined ||
      parsed.data.slotIntervalMinutes > parsed.data.durationMinutes
        ? parsed.data.durationMinutes
        : parsed.data.slotIntervalMinutes;

    const service = await prisma.$transaction(async (tx) => {
      await lockBusinessSchedule(tx, business.id);
      const currentBusiness = await tx.business.findFirst({
        where: { id: business.id, ownerId: user.id },
        select: { id: true, currency: true },
      });
      if (!currentBusiness) throw new BusinessNotFoundError();

      const lastService = await tx.service.findFirst({
        where: { businessId: currentBusiness.id },
        orderBy: { sortOrder: "desc" },
        select: { sortOrder: true },
      });

      return tx.service.create({
        data: {
          businessId: currentBusiness.id,
          name: parsed.data.name,
          description: parsed.data.description || null,
          price: parsed.data.price,
          currency: currentBusiness.currency,
          durationMinutes: parsed.data.durationMinutes,
          slotIntervalMinutes,
          sortOrder: (lastService?.sortOrder ?? -1) + 1,
          active: true,
          depositType: parsed.data.depositType,
          depositValue: parsed.data.depositValue,
        },
      });
    });

    return NextResponse.json(
      {
        service: {
          id: service.id,
          businessId: service.businessId,
          name: service.name,
          description: service.description,
          price: service.price.toString(),
          currency: service.currency,
          durationMinutes: service.durationMinutes,
          slotIntervalMinutes: service.slotIntervalMinutes,
          active: service.active,
          depositType: service.depositType,
          depositValue: service.depositValue.toString(),
        },
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof BusinessNotFoundError) {
      return NextResponse.json({ error: "کسب‌وکار پیدا نشد." }, { status: 404 });
    }
    console.error(
      "POST /api/services failed:",
      error instanceof Error ? error.name : "UnknownError"
    );
    return NextResponse.json(
      { error: "ساخت سرویس ناموفق بود." },
      { status: 500 }
    );
  }
}
