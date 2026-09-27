import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth/session";

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

    const existing = await prisma.timeOff.findFirst({
      where: { id, business: { ownerId: user.id } },
      select: { id: true },
    });

    if (!existing) {
      return NextResponse.json({ error: "پیدا نشد." }, { status: 404 });
    }

    await prisma.timeOff.delete({ where: { id } });

    return NextResponse.json({ deleted: true });
  } catch (error) {
    console.error("DELETE /api/time-off/[id] failed:", error);

    return NextResponse.json(
      { error: "حذف تعطیلی ناموفق بود." },
      { status: 500 }
    );
  }
}
