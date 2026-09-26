import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [activeSubscription, pendingSubscription] = await Promise.all([
      prisma.subscription.findFirst({
        where: { userId: user.id, status: "ACTIVE" },
        orderBy: { createdAt: "desc" },
      }),
      prisma.subscription.findFirst({
        where: { userId: user.id, status: "PENDING" },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    return NextResponse.json({
      subscription: activeSubscription
        ? {
            plan: activeSubscription.plan,
            status: activeSubscription.status,
            expiresAt: activeSubscription.expiresAt,
          }
        : null,
      pendingSubscription: pendingSubscription
        ? {
            plan: pendingSubscription.plan,
            status: pendingSubscription.status,
            createdAt: pendingSubscription.createdAt,
          }
        : null,
    });
  } catch (error) {
    console.error("GET /api/subscription/status failed:", error);

    return NextResponse.json(
      { error: "خطا در دریافت وضعیت اشتراک" },
      { status: 500 }
    );
  }
}
