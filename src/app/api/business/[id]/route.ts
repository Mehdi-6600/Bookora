import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth/session";
import { COUNTRY_CURRENCY, isCountryCode } from "@/lib/currency";

const updateBusinessSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).nullable().optional(),
  country: z.string().refine(isCountryCode, "کشور معتبر نیست."),
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
      select: { id: true, country: true },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "کسب‌وکار پیدا نشد." },
        { status: 404 }
      );
    }

    const { name, description, country } = parsed.data;

    // اگر کشور واقعاً تغییر کرد، ارز هم متناسب با آن به‌روزرسانی می‌شود.
    // ارز خود سرویس‌های قبلی دست‌نخورده می‌ماند تا قیمت‌های تاریخی خراب نشوند؛
    // فقط سرویس‌های جدیدی که بعد از این ساخته می‌شوند ارز جدید را می‌گیرند.
    const countryChanged = existing.country !== country;
    const currency = countryChanged ? COUNTRY_CURRENCY[country] : undefined;

    const business = await prisma.business.update({
      where: { id },
      data: {
        name,
        description: description || null,
        country,
        ...(currency ? { currency } : {}),
      },
      include: {
        services: {
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        },
        _count: { select: { bookings: true } },
      },
    });

    return NextResponse.json({
      business: {
        id: business.id,
        name: business.name,
        slug: business.slug,
        description: business.description,
        country: business.country,
        currency: business.currency,
        services: business.services.map((service) => ({
          id: service.id,
          name: service.name,
          description: service.description,
          price: service.price.toString(),
          currency: service.currency,
          durationMinutes: service.durationMinutes,
          active: service.active,
        })),
        _count: { bookings: business._count.bookings },
      },
      currencyChanged: countryChanged,
    });
  } catch (error) {
    console.error("PUT /api/business/[id] failed:", error);

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
        status: true,
        _count: { select: { bookings: true } },
      },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "کسب‌وکار پیدا نشد." },
        { status: 404 }
      );
    }

    // Business بدون هیچ Booking تاریخی → حذف واقعی (Cascade روی Service/WorkingHour و غیره بی‌خطر است).
    // Business با Booking → به‌جای حذف، فقط Archive می‌شود تا سابقه‌ی مالی/رزرو از بین نرود.
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
    console.error("DELETE /api/business/[id] failed:", error);

    return NextResponse.json(
      { error: "حذف کسب‌وکار ناموفق بود." },
      { status: 500 }
    );
  }
}
