import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth/session";
import { isRateLimited, triggerRateLimitCleanup } from "@/lib/rate-limit";
import { lockBusinessSchedule } from "@/lib/booking/schedule";

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
    if (await isRateLimited(`time-off-delete:${user.id}`, 60, 10 * 60 * 1000)) {
      return NextResponse.json(
        { error: "درخواست‌های زیاد. کمی صبر کنید." },
        { status: 429 }
      );
    }
    triggerRateLimitCleanup();

    const reference = await prisma.timeOff.findFirst({
      where: { id, business: { ownerId: user.id } },
      select: { id: true, businessId: true },
    });
    if (!reference) {
      return NextResponse.json({ error: "پیدا نشد." }, { status: 404 });
    }

    const deleted = await prisma.$transaction(async (tx) => {
      await lockBusinessSchedule(tx, reference.businessId);
      const existing = await tx.timeOff.findFirst({
        where: { id: reference.id, business: { ownerId: user.id } },
        select: { id: true },
      });
      if (!existing) return false;
      await tx.timeOff.delete({ where: { id: existing.id } });
      return true;
    });

    if (!deleted) {
      return NextResponse.json({ error: "پیدا نشد." }, { status: 404 });
    }
    return NextResponse.json({ deleted: true });
  } catch (error) {
    console.error(
      "DELETE /api/time-off/[id] failed:",
      error instanceof Error ? error.name : "UnknownError"
    );
    return NextResponse.json(
      { error: "حذف تعطیلی ناموفق بود." },
      { status: 500 }
    );
  }
}
