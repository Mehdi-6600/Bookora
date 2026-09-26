import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const user = await getCurrentUser();

    if (!user || !user.isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const subscriptions = await prisma.subscription.findMany({
      where: { status: "PENDING" },
      orderBy: { createdAt: "asc" },
      include: {
        user: {
          select: {
            telegramUsername: true,
            firstName: true,
            lastName: true,
            telegramId: true,
          },
        },
        business: {
          select: { name: true },
        },
      },
    });

    return NextResponse.json({
      subscriptions: subscriptions.map((sub) => ({
        id: sub.id,
        plan: sub.plan,
        receiptReference: sub.receiptReference,
        receiptNote: sub.receiptNote,
        createdAt: sub.createdAt,
        businessName: sub.business?.name || null,
        userName:
          sub.user.firstName ||
          sub.user.telegramUsername ||
          sub.user.telegramId,
      })),
    });
  } catch (error) {
    console.error("GET /api/admin/subscriptions failed:", error);

    return NextResponse.json(
      { error: "خطا در دریافت درخواست‌ها" },
      { status: 500 }
    );
  }
}
