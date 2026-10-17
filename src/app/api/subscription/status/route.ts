import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { activePaidSubscriptionWhere } from "@/lib/subscription/entitlement";

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const businessId = req.nextUrl.searchParams.get("businessId");
    if (!businessId || businessId.length > 100) {
      return NextResponse.json({ error: "businessId لازم است." }, { status: 400 });
    }

    const business = await prisma.business.findFirst({
      where: { id: businessId, ownerId: user.id, deletedAt: null },
      select: { id: true },
    });
    if (!business) {
      return NextResponse.json({ error: "کسب‌وکار پیدا نشد." }, { status: 404 });
    }

    const now = new Date();
    const [activeSubscription, pendingSubscription, lastRejectedSubscription] =
      await Promise.all([
        prisma.subscription.findFirst({
          where: activePaidSubscriptionWhere(user.id, now, business.id),
          orderBy: { createdAt: "desc" },
        }),
        prisma.subscription.findFirst({
          where: {
            userId: user.id,
            businessId: business.id,
            status: "PENDING",
          },
          orderBy: { createdAt: "desc" },
        }),
        prisma.subscription.findFirst({
          where: {
            userId: user.id,
            businessId: business.id,
            status: "REJECTED",
          },
          orderBy: { reviewedAt: "desc" },
        }),
      ]);

    return NextResponse.json(
      {
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
        lastRejected:
          !activeSubscription && !pendingSubscription && lastRejectedSubscription
            ? {
                plan: lastRejectedSubscription.plan,
                receiptReference: lastRejectedSubscription.receiptReference,
                adminNote: lastRejectedSubscription.adminNote,
                reviewedAt: lastRejectedSubscription.reviewedAt,
              }
            : null,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error(
      "GET /api/subscription/status failed:",
      error instanceof Error ? error.name : "UnknownError"
    );
    return NextResponse.json(
      { error: "خطا در دریافت وضعیت اشتراک" },
      { status: 500 }
    );
  }
}
