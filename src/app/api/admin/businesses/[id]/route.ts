import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/admin-api";
import {
  canAdminSoftDeleteBusiness,
  getEffectiveBusinessStatus,
} from "@/lib/business/lifecycle";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await requireAdmin();
    if (!guard.ok) return guard.response;

    const { id } = await params;
    const now = new Date();

    const business = await prisma.business.findFirst({
      where: { id, deletedAt: null },
      include: {
        services: {
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        },
        _count: { select: { bookings: true } },
      },
    });

    if (!business) {
      return NextResponse.json(
        { error: "کسب‌وکار پیدا نشد." },
        { status: 404 }
      );
    }

    return NextResponse.json({
      business: {
        id: business.id,
        name: business.name,
        slug: business.slug,
        description: business.description,
        country: business.country,
        currency: business.currency,
        timezone: business.timezone,
        status: getEffectiveBusinessStatus(business, now),
        expiresAt: business.expiresAt,
        canSoftDelete: canAdminSoftDeleteBusiness(business, now),
        services: business.services.map((service) => ({
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
        _count: { bookings: business._count.bookings },
      },
    });
  } catch (error) {
    console.error(
      "GET /api/admin/businesses/[id] failed:",
      error instanceof Error ? error.name : "UnknownError"
    );
    return NextResponse.json(
      { error: "خطا در دریافت کسب‌وکار" },
      { status: 500 }
    );
  }
}

const businessActionSchema = z.object({ action: z.literal("disable") });
const deleteConfirmationSchema = z.object({ confirm: z.boolean().optional() });

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await requireAdmin();
    if (!guard.ok) return guard.response;

    const { id } = await params;
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "درخواست نامعتبر است." }, { status: 400 });
    }
    const parsed = businessActionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "درخواست نامعتبر است." }, { status: 400 });
    }

    const business = await prisma.business.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, status: true, expiresAt: true, deletedAt: true },
    });
    if (!business) {
      return NextResponse.json({ error: "کسب‌وکار پیدا نشد." }, { status: 404 });
    }

    const now = new Date();
    if (getEffectiveBusinessStatus(business, now) !== "ACTIVE") {
      return NextResponse.json(
        { error: "فقط کسب‌وکار فعال را می‌توان غیرفعال کرد." },
        { status: 409 }
      );
    }

    const updated = await prisma.business.updateMany({
      where: {
        id,
        deletedAt: null,
        status: "ACTIVE",
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      data: { status: "DISABLED" },
    });
    if (updated.count !== 1) {
      return NextResponse.json(
        { error: "وضعیت کسب‌وکار تغییر کرده است؛ فهرست را تازه کنید." },
        { status: 409 }
      );
    }

    return NextResponse.json({ status: "DISABLED" });
  } catch (error) {
    console.error(
      "PATCH /api/admin/businesses/[id] failed:",
      error instanceof Error ? error.name : "UnknownError"
    );
    return NextResponse.json({ error: "غیرفعال‌سازی ناموفق بود." }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await requireAdmin();
    if (!guard.ok) return guard.response;

    const { id } = await params;
    let body: unknown = {};
    try {
      body = await req.json();
    } catch {
      // A confirmation-less DELETE is a read-only confirmation request.
    }
    const parsed = deleteConfirmationSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "درخواست نامعتبر است." }, { status: 400 });
    }

    const business = await prisma.business.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        status: true,
        expiresAt: true,
        deletedAt: true,
        createdAt: true,
        _count: { select: { bookings: true } },
      },
    });
    if (!business) {
      return NextResponse.json({ error: "کسب‌وکار پیدا نشد." }, { status: 404 });
    }

    const now = new Date();
    const status = getEffectiveBusinessStatus(business, now);
    if (status === "ACTIVE") {
      return NextResponse.json(
        { error: "برای حذف، ابتدا کسب‌وکار را غیرفعال کنید." },
        { status: 409 }
      );
    }
    if (!canAdminSoftDeleteBusiness(business, now)) {
      return NextResponse.json(
        { error: "پیش‌نویس فقط پس از ۳۰ روز بدون فعال‌سازی قابل حذف است." },
        { status: 409 }
      );
    }

    if (!parsed.data.confirm) {
      return NextResponse.json({
        confirmationRequired: true,
        status,
        bookingCount: business._count.bookings,
      });
    }

    const removed = await prisma.business.updateMany({
      where: {
        id,
        deletedAt: null,
        OR: [
          { status: { not: "ACTIVE" } },
          { status: "ACTIVE", expiresAt: { lte: now } },
        ],
      },
      data: { deletedAt: now, creationKey: null },
    });
    if (removed.count !== 1) {
      return NextResponse.json(
        { error: "وضعیت کسب‌وکار تغییر کرده است؛ فهرست را تازه کنید." },
        { status: 409 }
      );
    }

    return NextResponse.json({
      deleted: true,
      bookingCount: business._count.bookings,
    });
  } catch (error) {
    console.error(
      "DELETE /api/admin/businesses/[id] failed:",
      error instanceof Error ? error.name : "UnknownError"
    );
    return NextResponse.json({ error: "حذف نرم کسب‌وکار ناموفق بود." }, { status: 500 });
  }
}
