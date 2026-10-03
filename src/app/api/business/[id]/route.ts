import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth/session";
import { COUNTRY_CURRENCY, isCountryCode } from "@/lib/currency";
import { isRateLimited, triggerRateLimitCleanup } from "@/lib/rate-limit";
import { lockBusinessSchedule } from "@/lib/booking/schedule";
import { normalizeTimeZone } from "@/lib/booking/time";

const updateBusinessSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).nullable().optional(),
  country: z.string().refine(isCountryCode, "کشور معتبر نیست."),
  timezone: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .refine((value) => normalizeTimeZone(value) !== null, "منطقه زمانی معتبر نیست.")
    .optional(),
  reactivate: z.boolean().optional(),
});

function resolveTimezone(country: string): string {
  return country === "IR" ? "Asia/Tehran" : "UTC";
}

class BusinessNotFoundError extends Error {}

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

    const parsed = updateBusinessSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "اطلاعات کسب‌وکار معتبر نیست.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const existing = await prisma.business.findFirst({
      where: { id, ownerId: user.id },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "کسب‌وکار پیدا نشد." }, { status: 404 });
    }

    if (await isRateLimited(`business-update:${user.id}:${id}`, 60, 10 * 60 * 1000)) {
      return NextResponse.json(
        { error: "درخواست‌های زیاد. کمی صبر کنید." },
        { status: 429 }
      );
    }
    triggerRateLimitCleanup();

    const result = await prisma.$transaction(async (tx) => {
      await lockBusinessSchedule(tx, id);

      const current = await tx.business.findFirst({
        where: { id, ownerId: user.id },
        select: { id: true, country: true, status: true },
      });
      if (!current) throw new BusinessNotFoundError();

      const { name, description, country, reactivate } = parsed.data;
      const countryChanged = current.country !== country;
      const currency = countryChanged ? COUNTRY_CURRENCY[country] : undefined;
      const timezone = parsed.data.timezone
        ? normalizeTimeZone(parsed.data.timezone)!
        : countryChanged
          ? resolveTimezone(country)
          : undefined;
      const status =
        reactivate && current.status === "ARCHIVED" ? "ACTIVE" : undefined;

      const business = await tx.business.update({
        where: { id },
        data: {
          name,
          description: description || null,
          country,
          ...(currency ? { currency } : {}),
          ...(timezone ? { timezone } : {}),
          ...(status ? { status } : {}),
        },
        include: {
          services: {
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          },
          _count: { select: { bookings: true } },
        },
      });

      if (currency) {
        await tx.service.updateMany({
          where: { businessId: id },
          data: { currency },
        });
        const services = await tx.service.findMany({
          where: { businessId: id },
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        });
        return { business, services, currencyChanged: true };
      }

      return { business, services: business.services, currencyChanged: false };
    });

    return NextResponse.json({
      business: {
        id: result.business.id,
        name: result.business.name,
        slug: result.business.slug,
        description: result.business.description,
        country: result.business.country,
        currency: result.business.currency,
        timezone: result.business.timezone,
        status: result.business.status,
        services: result.services.map((service) => ({
          id: service.id,
          name: service.name,
          description: service.description,
          price: service.price.toString(),
          currency: service.currency,
          durationMinutes: service.durationMinutes,
          active: service.active,
          depositType: service.depositType,
          depositValue: service.depositValue.toString(),
        })),
        _count: { bookings: result.business._count.bookings },
      },
      currencyChanged: result.currencyChanged,
    });
  } catch (error) {
    if (error instanceof BusinessNotFoundError) {
      return NextResponse.json({ error: "کسب‌وکار پیدا نشد." }, { status: 404 });
    }
    console.error(
      "PUT /api/business/[id] failed:",
      error instanceof Error ? error.name : "UnknownError"
    );
    return NextResponse.json(
      { error: "ویرایش کسب‌وکار ناموفق بود." },
      { status: 500 }
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const existing = await prisma.business.findFirst({
      where: { id, ownerId: user.id },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "کسب‌وکار پیدا نشد." }, { status: 404 });
    }

    if (await isRateLimited(`business-delete:${user.id}:${id}`, 20, 10 * 60 * 1000)) {
      return NextResponse.json(
        { error: "درخواست‌های زیاد. کمی صبر کنید." },
        { status: 429 }
      );
    }
    triggerRateLimitCleanup();

    const result = await prisma.$transaction(async (tx) => {
      await lockBusinessSchedule(tx, id);
      const business = await tx.business.findFirst({
        where: { id, ownerId: user.id },
        select: { id: true, _count: { select: { bookings: true } } },
      });
      if (!business) throw new BusinessNotFoundError();

      if (business._count.bookings > 0) {
        await tx.business.update({
          where: { id },
          data: { status: "ARCHIVED" },
        });
        return { archived: true, deleted: false };
      }

      await tx.business.delete({ where: { id } });
      return { archived: false, deleted: true };
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof BusinessNotFoundError) {
      return NextResponse.json({ error: "کسب‌وکار پیدا نشد." }, { status: 404 });
    }
    console.error(
      "DELETE /api/business/[id] failed:",
      error instanceof Error ? error.name : "UnknownError"
    );
    return NextResponse.json(
      { error: "حذف کسب‌وکار ناموفق بود." },
      { status: 500 }
    );
  }
}
