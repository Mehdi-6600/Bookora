import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth/session";
import { COUNTRY_CURRENCY, isCountryCode } from "@/lib/currency";
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
        {
          error: "اطلاعات کسب‌وکار معتبر نیست.",
          details: parsed.error.flatten(),
        },
        { status: 400 }
      );
    }

    const existing = await prisma.business.findFirst({
      where: { id, ownerId: user.id },
      select: { id: true, country: true, status: true, timezone: true },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "کسب‌وکار پیدا نشد." },
        { status: 404 }
      );
    }

    const { name, description, country, reactivate } = parsed.data;

    const countryChanged = existing.country !== country;
    const currency = countryChanged ? COUNTRY_CURRENCY[country] : undefined;

    const timezone = parsed.data.timezone
      ? normalizeTimeZone(parsed.data.timezone)!
      : countryChanged
      ? country === "IR"
        ? "Asia/Tehran"
        : existing.timezone || "UTC"
      : existing.timezone;

    const status =
      reactivate && existing.status === "ARCHIVED" ? "ACTIVE" : undefined;

    const result = await prisma.$transaction(async (tx) => {
      const business = await tx.business.update({
        where: { id },
        data: {
          name,
          description: description || null,
          country,
          timezone,
          ...(currency ? { currency } : {}),
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

        const refreshed = await tx.service.findMany({
          where: { businessId: id },
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        });

        return { business, services: refreshed };
      }

      return { business, services: business.services };
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
          slotIntervalMinutes: service.slotIntervalMinutes,
          active: service.active,
          depositType: service.depositType,
          depositValue: service.depositValue.toString(),
        })),
        _count: { bookings: result.business._count.bookings },
      },
      currencyChanged: countryChanged,
    });
  } catch (error) {
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
      select: {
        id: true,
        _count: { select: { bookings: true } },
      },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "کسب‌وکار پیدا نشد." },
        { status: 404 }
      );
    }

    if (existing._count.bookings > 0) {
      await prisma.business.update({
        where: { id },
        data: { status: "ARCHIVED" },
      });

      return NextResponse.json({ archived: true });
    }

    await prisma.business.delete({ where: { id } });

    return NextResponse.json({ deleted: true });
  } catch (error) {
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
