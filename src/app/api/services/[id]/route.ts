import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth/session";

const updateServiceSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).nullable().optional(),
  price: z.coerce.number().finite().min(0).max(99999999.99),
  durationMinutes: z.coerce.number().int().min(1).max(1440),
  active: z.boolean().optional(),
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

    const parsed = updateServiceSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "اطلاعات سرویس معتبر نیست.",
          details: parsed.error.flatten(),
        },
        { status: 400 }
      );
    }

    const existing = await prisma.service.findFirst({
      where: {
        id,
        business: { ownerId: user.id },
      },
      select: { id: true },
    });

    if (!existing) {
      return NextResponse.json({ error: "سرویس پیدا نشد." }, { status: 404 });
    }

    const { name, description, price, durationMinutes, active } = parsed.data;

    const service = await prisma.service.update({
      where: { id },
      data: {
        name,
        description: description || null,
        price,
        durationMinutes,
        ...(active !== undefined ? { active } : {}),
      },
    });

    return NextResponse.json({
      service: {
        id: service.id,
        businessId: service.businessId,
        name: service.name,
        description: service.description,
        price: service.price.toString(),
        currency: service.currency,
        durationMinutes: service.durationMinutes,
        active: service.active,
      },
    });
  } catch (error) {
    console.error("PUT /api/services/[id] failed:", error);

    return NextResponse.json(
      { error: "ویرایش سرویس ناموفق بود." },
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

    const existing = await prisma.service.findFirst({
      where: {
        id,
        business: { ownerId: user.id },
      },
      select: {
        id: true,
        _count: { select: { bookings: true } },
      },
    });

    if (!existing) {
      return NextResponse.json({ error: "سرویس پیدا نشد." }, { status: 404 });
    }

    if (existing._count.bookings > 0) {
      await prisma.service.update({
        where: { id },
        data: { active: false },
      });

      return NextResponse.json({ deactivated: true });
    }

    await prisma.service.delete({ where: { id } });

    return NextResponse.json({ deleted: true });
  } catch (error) {
    console.error("DELETE /api/services/[id] failed:", error);

    return NextResponse.json(
      { error: "حذف سرویس ناموفق بود." },
      { status: 500 }
    );
  }
}
