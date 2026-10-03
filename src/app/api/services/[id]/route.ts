import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth/session";
import { serviceOwnerFilter } from "@/lib/auth/ownership";
import { isRateLimited, triggerRateLimitCleanup } from "@/lib/rate-limit";
import { lockBusinessSchedule } from "@/lib/booking/schedule";

const MAX_PRICE = 99_999_999.99;
const isMoneyAmount = (value: number) =>
  Math.abs(value * 100 - Math.round(value * 100)) < 0.000001;

const updateServiceSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(1000).nullable().optional(),
    price: z
      .coerce.number().finite().min(0).max(MAX_PRICE)
      .refine(isMoneyAmount, "قیمت حداکثر دو رقم اعشار دارد."),
    durationMinutes: z.coerce.number().int().min(1).max(1440),
    slotIntervalMinutes: z.coerce
      .number()
      .int()
      .min(5)
      .max(480)
      .optional(),
    active: z.boolean().optional(),
    depositType: z.enum(["NONE", "PERCENTAGE", "FIXED"]).optional(),
    depositValue: z
      .coerce.number().finite().min(0).max(MAX_PRICE)
      .refine(isMoneyAmount, "مبلغ بیعانه حداکثر دو رقم اعشار دارد.")
      .optional(),
  })
  .refine(
    (d) =>
      d.depositType !== "PERCENTAGE" ||
      d.depositValue === undefined ||
      d.depositValue <= 100,
    {
      message: "درصد بیعانه نمی‌تواند بیشتر از ۱۰۰ باشد.",
      path: ["depositValue"],
    }
  );

class ServiceNotFoundError extends Error {}

function serializeService(service: {
  id: string;
  businessId: string;
  name: string;
  description: string | null;
  price: { toString(): string };
  currency: string;
  durationMinutes: number;
  slotIntervalMinutes: number;
  active: boolean;
  depositType: string;
  depositValue: { toString(): string };
}) {
  return {
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
  };
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
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

    const parsed = updateServiceSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "اطلاعات سرویس معتبر نیست.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const existing = await prisma.service.findFirst({
      where: { id, ...serviceOwnerFilter(user) },
      select: {
        id: true,
        businessId: true,
        business: { select: { ownerId: true } },
      },
    });
    if (!existing) {
      return NextResponse.json({ error: "سرویس پیدا نشد." }, { status: 404 });
    }

    if (await isRateLimited(`service-update:${user.id}:${id}`, 60, 10 * 60 * 1000)) {
      return NextResponse.json(
        { error: "درخواست‌های زیاد. کمی صبر کنید." },
        { status: 429 }
      );
    }
    triggerRateLimitCleanup();

    const service = await prisma.$transaction(async (tx) => {
      await lockBusinessSchedule(tx, existing.businessId);
      const current = await tx.service.findFirst({
        where: { id, ...serviceOwnerFilter(user) },
        select: { id: true, businessId: true, business: { select: { ownerId: true } } },
      });
      if (!current) throw new ServiceNotFoundError();

      // ادمین در کسب‌وکار دیگران فقط اجازه‌ی تغییر قیمت را دارد.
      const priceOnly = user.isAdmin && current.business.ownerId !== user.id;
      if (priceOnly) {
        return tx.service.update({
          where: { id: current.id },
          data: { price: parsed.data.price },
        });
      }

      const durationMinutes = parsed.data.durationMinutes;
      const slotIntervalMinutes =
        parsed.data.slotIntervalMinutes === undefined ||
        parsed.data.slotIntervalMinutes > durationMinutes
          ? durationMinutes
          : parsed.data.slotIntervalMinutes;

      return tx.service.update({
        where: { id: current.id },
        data: {
          name: parsed.data.name,
          description: parsed.data.description || null,
          price: parsed.data.price,
          durationMinutes,
          slotIntervalMinutes,
          ...(parsed.data.active !== undefined ? { active: parsed.data.active } : {}),
          ...(parsed.data.depositType !== undefined
            ? { depositType: parsed.data.depositType }
            : {}),
          ...(parsed.data.depositValue !== undefined
            ? { depositValue: parsed.data.depositValue }
            : {}),
        },
      });
    });

    return NextResponse.json({ service: serializeService(service) });
  } catch (error) {
    if (error instanceof ServiceNotFoundError) {
      return NextResponse.json({ error: "سرویس پیدا نشد." }, { status: 404 });
    }
    console.error(
      "PUT /api/services/[id] failed:",
      error instanceof Error ? error.name : "UnknownError"
    );
    return NextResponse.json(
      { error: "ویرایش سرویس ناموفق بود." },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const existing = await prisma.service.findFirst({
      where: { id, ...serviceOwnerFilter(user) },
      select: {
        id: true,
        businessId: true,
        business: { select: { ownerId: true } },
      },
    });
    if (!existing) {
      return NextResponse.json({ error: "سرویس پیدا نشد." }, { status: 404 });
    }

    if (user.isAdmin && existing.business.ownerId !== user.id) {
      return NextResponse.json(
        { error: "ادمین اجازه‌ی حذف سرویس کسب‌وکار دیگران را ندارد." },
        { status: 403 }
      );
    }

    if (await isRateLimited(`service-delete:${user.id}:${id}`, 30, 10 * 60 * 1000)) {
      return NextResponse.json(
        { error: "درخواست‌های زیاد. کمی صبر کنید." },
        { status: 429 }
      );
    }
    triggerRateLimitCleanup();

    const result = await prisma.$transaction(async (tx) => {
      await lockBusinessSchedule(tx, existing.businessId);
      const current = await tx.service.findFirst({
        where: { id, ...serviceOwnerFilter(user) },
        select: {
          id: true,
          businessId: true,
          business: { select: { ownerId: true } },
          _count: { select: { bookings: true } },
        },
      });
      if (!current) throw new ServiceNotFoundError();
      if (user.isAdmin && current.business.ownerId !== user.id) {
        throw new ServiceNotFoundError();
      }

      if (current._count.bookings > 0) {
        await tx.service.update({ where: { id }, data: { active: false } });
        return { deactivated: true };
      }

      await tx.service.delete({ where: { id } });
      return { deleted: true };
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ServiceNotFoundError) {
      return NextResponse.json({ error: "سرویس پیدا نشد." }, { status: 404 });
    }
    console.error(
      "DELETE /api/services/[id] failed:",
      error instanceof Error ? error.name : "UnknownError"
    );
    return NextResponse.json(
      { error: "حذف سرویس ناموفق بود." },
      { status: 500 }
    );
  }
}
