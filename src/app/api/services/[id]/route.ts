import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth/session";
import {
  serviceOwnerFilter,
  isPriceOnlyAdminEdit,
} from "@/lib/auth/ownership";

const updateServiceSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(1000).nullable().optional(),
    price: z.coerce.number().finite().min(0).max(99999999.99),
    durationMinutes: z.coerce.number().int().min(1).max(1440),
    slotIntervalMinutes: z.coerce
      .number()
      .int()
      .min(5)
      .max(480)
      .optional(),
    active: z.boolean().optional(),
    depositType: z.enum(["NONE", "PERCENTAGE", "FIXED"]).optional(),
    depositValue: z.coerce.number().finite().min(0).optional(),
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

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const resolved = await params;
    const id = resolved.id;
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
      where: { id: id, ...serviceOwnerFilter(user) },
      select: { id: true },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "سرویس پیدا نشد." },
        { status: 404 }
      );
    }

    if (isPriceOnlyAdminEdit(user)) {
      const service = await prisma.service.update({
        where: { id: id },
        data: { price: parsed.data.price },
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
          slotIntervalMinutes: service.slotIntervalMinutes,
          active: service.active,
          depositType: service.depositType,
          depositValue: service.depositValue.toString(),
        },
      });
    }

    const name = parsed.data.name;
    const description = parsed.data.description;
    const price = parsed.data.price;
    const durationMinutes = parsed.data.durationMinutes;
    const active = parsed.data.active;
    const depositType = parsed.data.depositType;
    const depositValue = parsed.data.depositValue;

    // اگر slotIntervalMinutes داده نشده بود، برابر durationMinutes شود.
    let slotIntervalMinutes = parsed.data.slotIntervalMinutes;
    if (
      typeof slotIntervalMinutes !== "number" ||
      slotIntervalMinutes <= 0 ||
      slotIntervalMinutes > durationMinutes
    ) {
      slotIntervalMinutes = durationMinutes;
    }

    const service = await prisma.service.update({
      where: { id: id },
      data: {
        name: name,
        description: description || null,
        price: price,
        durationMinutes: durationMinutes,
        slotIntervalMinutes: slotIntervalMinutes,
        ...(active !== undefined ? { active: active } : {}),
        ...(depositType !== undefined ? { depositType: depositType } : {}),
        ...(depositValue !== undefined
          ? { depositValue: depositValue }
          : {}),
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
        slotIntervalMinutes: service.slotIntervalMinutes,
        active: service.active,
        depositType: service.depositType,
        depositValue: service.depositValue.toString(),
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
    const resolved = await params;
    const id = resolved.id;
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (user.isAdmin) {
      return NextResponse.json(
        { error: "ادمین اجازه‌ی حذف سرویس را ندارد." },
        { status: 403 }
      );
    }

    const existing = await prisma.service.findFirst({
      where: { id: id, business: { ownerId: user.id } },
      select: { id: true, _count: { select: { bookings: true } } },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "سرویس پیدا نشد." },
        { status: 404 }
      );
    }

    if (existing._count.bookings > 0) {
      await prisma.service.update({
        where: { id: id },
        data: { active: false },
      });
      return NextResponse.json({ deactivated: true });
    }

    await prisma.service.delete({ where: { id: id } });
    return NextResponse.json({ deleted: true });
  } catch (error) {
    console.error("DELETE /api/services/[id] failed:", error);
    return NextResponse.json(
      { error: "حذف سرویس ناموفق بود." },
      { status: 500 }
    );
  }
}
