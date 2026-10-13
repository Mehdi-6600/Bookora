import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { isRateLimited, triggerRateLimitCleanup } from "@/lib/rate-limit";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (await isRateLimited(`holiday-delete:${user.id}`, 60, 10 * 60 * 1000)) {
      return NextResponse.json(
        { error: "درخواست‌های زیاد. کمی صبر کنید." },
        { status: 429 }
      );
    }
    triggerRateLimitCleanup();

    const holiday = await prisma.holiday.findFirst({
      where: { id, business: { ownerId: user.id, deletedAt: null } },
      select: { id: true },
    });
    if (!holiday) {
      return NextResponse.json({ error: "تعطیلی پیدا نشد." }, { status: 404 });
    }

    await prisma.holiday.delete({ where: { id: holiday.id } });
    return NextResponse.json({ deleted: true });
  } catch (error) {
    console.error(
      "DELETE /api/holidays/[id] failed:",
      error instanceof Error ? error.name : "UnknownError"
    );
    return NextResponse.json({ error: "حذف تعطیلی ناموفق بود." }, { status: 500 });
  }
}
